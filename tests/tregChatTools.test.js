const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'treg-chat-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const tregSearchMode = require('../services/tregSearchMode');
const tregChatTools = require('../services/tregChatTools');
const { executeCrmTool } = require('../services/mcp/mcpToolExecutor');

function mockResponse({ status = 200, headers = {}, json = {} }) {
  const lower = {};
  for (const [key, value] of Object.entries(headers)) lower[key.toLowerCase()] = value;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => lower[String(name).toLowerCase()] || null },
    text: async () => JSON.stringify(json),
  };
}

test('chat tools appear only while the workspace is on Treg', () => {
  const previous = process.env.TREG_TOKEN;
  delete process.env.TREG_TOKEN;
  assert.equal(tregChatTools.appendTools([{ type: 'function', function: { name: 'list_folders' } }], { SEARCH_ENGINE: 'treg' }).length, 1);
  process.env.TREG_TOKEN = 'treg_test_token';
  try {
    const off = tregChatTools.appendTools([], { SEARCH_ENGINE: 'default' });
    assert.equal(off.length, 0);
    const on = tregChatTools.appendTools([], { SEARCH_ENGINE: 'treg' });
    assert.deepEqual(on.map((t) => t.function.name), tregChatTools.TOOL_NAMES);
  } finally {
    if (previous == null) delete process.env.TREG_TOKEN;
    else process.env.TREG_TOKEN = previous;
  }
});

test('a Treg chat turn searches the catalog and calls one tool', async () => {
  const previous = process.env.TREG_TOKEN;
  process.env.TREG_TOKEN = 'treg_test_token';
  tregSearchMode.setMode('ws-chat', 'treg');
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/catalog/search')) {
      return mockResponse({
        json: {
          results: [
            { id: 'treg.web.search', name: 'web search', summary: 'organic results', cost: { usd: 0.002 } },
          ],
        },
      });
    }
    if (String(url).includes('/catalog/endpoints/')) {
      return mockResponse({
        json: {
          endpoint: {
            id: 'treg.web.search',
            method: 'POST',
            summary: 'organic web results',
            cost: { usd: 0.002 },
            input: { body: { q: { type: 'string', required: true } } },
          },
        },
      });
    }
    return mockResponse({
      headers: { 'x-treg-call-id': 'chat_1', 'x-treg-cost-micro': '2000', 'x-treg-served-by': 'treg' },
      json: { output: { results: [{ url: 'https://example.com', title: 'Example' }] } },
    });
  };
  const ctx = { workspaceId: 'ws-chat', userEmail: 'a@b.c' };

  try {
    const found = await tregChatTools.execute(ctx, 'treg_catalog_search', { query: 'web search' }, { fetchImpl });
    assert.equal(found.tools[0].id, 'treg.web.search');
    assert.equal(found.tools[0].costUsd, 0.002);
    assert.match(calls[0].init.headers['X-Treg-Meta'], /customer=ws-chat, feature=chat-catalog/);

    const spec = await tregChatTools.execute(ctx, 'treg_catalog_get', { endpoint: 'treg.web.search' }, { fetchImpl });
    assert.equal(spec.method, 'POST');
    assert.equal(spec.cost.usd, 0.002);

    const ran = await tregChatTools.execute(
      ctx,
      'treg_call',
      { endpoint: 'treg.web.search', method: 'POST', body: { q: 'roofers Camas' }, max_cost_usd: 0.05 },
      { fetchImpl },
    );
    assert.equal(ran.callId, 'chat_1');
    assert.equal(ran.costUsd, 0.002);
    assert.equal(ran.result.output.results[0].title, 'Example');
    const sent = calls[2];
    assert.match(sent.url, /\/call\/treg\.web\.search$/);
    assert.equal(sent.init.headers['X-Treg-Route-Max-Cost'], '0.05');
    assert.equal(sent.init.headers['X-Treg-Meta'], 'customer=ws-chat, feature=chat');
    assert.equal(JSON.parse(sent.init.body).q, 'roofers Camas');

    await assert.rejects(
      () => tregChatTools.execute({ workspaceId: 'ws-chat' }, 'treg_call', { endpoint: 'https://evil.example' }),
      /endpoint id/i,
    );

    await tregChatTools.execute(
      ctx,
      'treg_call',
      { endpoint: 'acme/sheets', method: 'GET', query: { range: 'A1' }, max_cost_usd: 0.01 },
      { fetchImpl },
    );
    assert.match(calls[3].url, /\/call\/acme\/sheets\?range=A1$/);
  } finally {
    tregSearchMode.setMode('ws-chat', 'default');
    if (previous == null) delete process.env.TREG_TOKEN;
    else process.env.TREG_TOKEN = previous;
  }
});

test('a chat message stops before the turn spend cap', async () => {
  const previous = process.env.TREG_TOKEN;
  process.env.TREG_TOKEN = 'treg_test_token';
  tregSearchMode.setMode('ws-cap', 'treg');
  const fetchImpl = async () =>
    mockResponse({
      headers: { 'x-treg-cost-micro': '3000000' },
      json: { ok: true },
    });
  const ctx = { workspaceId: 'ws-cap' };
  try {
    await tregChatTools.execute(ctx, 'treg_call', { endpoint: 'treg.web.search', max_cost_usd: 3 }, { fetchImpl });
    await tregChatTools.execute(ctx, 'treg_call', { endpoint: 'treg.web.search', max_cost_usd: 3 }, { fetchImpl });
    await assert.rejects(
      () => tregChatTools.execute(ctx, 'treg_call', { endpoint: 'treg.web.search', max_cost_usd: 3 }, { fetchImpl }),
      /\$8/,
    );
  } finally {
    tregSearchMode.setMode('ws-cap', 'default');
    if (previous == null) delete process.env.TREG_TOKEN;
    else process.env.TREG_TOKEN = previous;
  }
});

test('the CRM tool executor runs a Treg catalog search for a switched workspace', async () => {
  const previous = process.env.TREG_TOKEN;
  process.env.TREG_TOKEN = 'treg_test_token';
  tregSearchMode.setMode('ws-exec', 'treg');
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('/catalog/search')) {
      return mockResponse({ json: { results: [{ id: 'treg.tiktok.search.videos', name: 'tiktok', summary: 'videos' }] } });
    }
    return mockResponse({ status: 404, json: { message: 'no' } });
  };
  try {
    const off = await executeCrmTool({ workspaceId: 'ws-off' }, 'treg_catalog_search', { query: 'tiktok videos' });
    assert.equal(off.success, false);
    assert.match(off.error, /off for this workspace/i);

    const on = await executeCrmTool({ workspaceId: 'ws-exec' }, 'treg_catalog_search', { query: 'tiktok videos' });
    assert.equal(on.success, true);
    assert.equal(on.tools[0].id, 'treg.tiktok.search.videos');
  } finally {
    global.fetch = originalFetch;
    tregSearchMode.setMode('ws-exec', 'default');
    if (previous == null) delete process.env.TREG_TOKEN;
    else process.env.TREG_TOKEN = previous;
  }
});
