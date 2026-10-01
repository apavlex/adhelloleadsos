const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pavlex-runtime-'));
process.env.APP_DATA_DIR = tmpDataDir;

const { describe, it, before, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');
const { pavlexChatWithCrmTools } = require('../services/mcp/mcpChatRuntime');

const WS = 'ws_runtime_a';
const EMAIL = 'owner@runtime.test';
const req = { workspaceId: WS, user: { emails: [{ value: EMAIL }] } };
const INSTRUCTIONS = 'You are Alex.';

const ENV_KEYS = [
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'OPENROUTER_MODEL',
  'OPENROUTER_TOOL_MODEL',
  'OPENROUTER_ALLOW_PAID_FALLBACK',
  'KIE_AI_API_KEY',
  'KIE_API_KEY',
  'GEMINI_API_KEY',
];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const realFetch = global.fetch;
let calls = [];

function json(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function reply(message) {
  return json(200, { choices: [{ message: { role: 'assistant', ...message } }] });
}

/** handler(body, n) → response; records every request body. */
function stubFetch(handler) {
  calls = [];
  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ url, body });
    return handler(body, calls.length);
  };
}

function lastToolMessages(body) {
  return body.messages.filter((m) => m.role === 'tool');
}

before(async () => {
  await dbService.saveWorkspace(WS, { id: WS, name: 'Camas Flooring', members: { [EMAIL]: { role: 'owner' } } });
});

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.OPENROUTER_API_KEY = 'or-test';
});

afterEach(() => {
  global.fetch = realFetch;
});

after(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  fs.rmSync(tmpDataDir, { recursive: true, force: true });
});

describe('pavlexChatWithCrmTools', () => {
  it('writes a referral SMS and saves it to Scripts via a native tool call', async () => {
    process.env.OPENROUTER_MODEL = 'openrouter/free';
    const sms = 'Hi {{name}}, thanks for choosing us! Know anyone who needs new floors? Send them our way — we will take great care of them.';
    stubFetch((body, n) => {
      if (n === 1) {
        return reply({
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'save_script',
                arguments: JSON.stringify({ name: 'Referral request SMS', body: sms, section: 'sms' }),
              },
            },
          ],
        });
      }
      return reply({ content: `Saved "Referral request SMS" to Scripts:\n\n${sms}`, reasoning: 'internal thoughts' });
    });

    const out = await pavlexChatWithCrmTools({
      req,
      instructions: INSTRUCTIONS,
      message: 'Make Mae a referral request sms and save it in scripts',
    });

    assert.equal(out.error, undefined, out.detail);
    assert.equal(out.mcpMode, 'inline_tools');
    assert.deepEqual(out.toolsUsed, ['save_script']);
    assert.match(out.content, /Saved "Referral request SMS"/);
    assert.doesNotMatch(out.content, /internal thoughts/);

    assert.equal(calls[0].body.model, 'openai/gpt-4o-mini', 'free router is not used for tool turns');
    assert.equal(calls[0].body.tool_choice, 'required');
    assert.ok(calls[0].body.tools.some((t) => t.function.name === 'save_script'));
    const toolMsg = lastToolMessages(calls[1].body)[0];
    assert.equal(toolMsg.tool_call_id, 'call_1');
    assert.equal(JSON.parse(toolMsg.content).success, true);

    const ws = await dbService.getWorkspace(WS);
    const saved = ws.salesScriptLibraryItems.find((i) => i.title === 'Referral request SMS');
    assert.ok(saved, 'script is in the workspace library');
    assert.equal(saved.section, 'sms');
    assert.equal(saved.text, sms);
  });

  it('retries without tool_choice "required" and executes a text-form tool call', async () => {
    stubFetch((body, n) => {
      if (body.tool_choice === 'required') {
        return json(400, {
          error: { message: 'Provider returned error', code: 400, metadata: { provider_name: 'X', raw: 'required unsupported' } },
        });
      }
      if (lastToolMessages(body).length === 0) {
        return reply({ content: 'On it.\n<tool_call>{"name":"list_folders","arguments":{}}</tool_call>' });
      }
      return reply({ content: 'You have no lead folders yet.' });
    });

    const out = await pavlexChatWithCrmTools({ req, instructions: INSTRUCTIONS, message: 'What lead folders do I have right now?' });

    assert.equal(out.error, undefined, out.detail);
    assert.deepEqual(out.toolsUsed, ['list_folders']);
    assert.equal(out.content, 'You have no lead folders yet.');
    assert.equal(calls[0].body.tool_choice, 'required');
    assert.equal(calls[1].body.tool_choice, 'auto');
    const assistantWithCall = calls[2].body.messages.find((m) => m.role === 'assistant' && m.tool_calls);
    assert.equal(assistantWithCall.tool_calls[0].function.name, 'list_folders');
    assert.equal(lastToolMessages(calls[2].body)[0].tool_call_id, assistantWithCall.tool_calls[0].id);
  });

  it('never returns leaked reasoning: nudges the model, then runs the tool it described', async () => {
    stubFetch((body) => {
      const nudged = body.messages.some((m) => m.role === 'user' && /Reply to me directly now/.test(m.content));
      if (!nudged) {
        return reply({
          content:
            'The user is asking "What should I work on today?" Looking at the available tools, suggest_daily_leads seems right. Let me call it.',
        });
      }
      if (lastToolMessages(body).length === 0) {
        return reply({
          content: '',
          tool_calls: [{ id: 'c9', type: 'function', function: { name: 'suggest_daily_leads', arguments: '{}' } }],
        });
      }
      return reply({ content: '<think>summarize</think>Nothing urgent today — your pipeline is empty. Want me to find new leads?' });
    });

    const out = await pavlexChatWithCrmTools({ req, instructions: INSTRUCTIONS, message: 'What should I work on today?' });

    assert.equal(out.error, undefined, out.detail);
    assert.deepEqual(out.toolsUsed, ['suggest_daily_leads']);
    assert.equal(out.content, 'Nothing urgent today — your pipeline is empty. Want me to find new leads?');
    assert.doesNotMatch(out.content, /The user is asking/);
  });

  it('falls back to the general chain, skips reasoning-only replies, and executes text tool calls', async () => {
    stubFetch((body) => {
      if (body.tools) {
        return json(502, { error: { message: 'Provider returned error', code: 502, metadata: { provider_name: 'Up', raw: 'boom' } } });
      }
      if (body.model === 'openrouter/free') {
        return reply({ content: '', reasoning: 'The user is asking what to work on. Let me call suggest_daily_leads.' });
      }
      const hasResults = body.messages.some((m) => m.role === 'user' && /^TOOL RESULTS/.test(m.content));
      if (!hasResults) return reply({ content: '<tool_call>suggest_daily_leads</tool_call>' });
      return reply({ content: 'No leads to work today yet — add some to your pipeline first.' });
    });

    const out = await pavlexChatWithCrmTools({ req, instructions: INSTRUCTIONS, message: 'What should I work on today?' });

    assert.equal(out.error, undefined, out.detail);
    assert.equal(out.mcpMode, 'text_tools');
    assert.deepEqual(out.toolsUsed, ['suggest_daily_leads']);
    assert.equal(out.content, 'No leads to work today yet — add some to your pipeline first.');
    assert.doesNotMatch(out.content, /tool_call|The user is asking/);
    const generalSystem = calls.find((c) => !c.body.tools).body.messages[0].content;
    assert.match(generalSystem, /<tool_call>\{"name"/);
  });

  it('returns a friendly message and logs the real reason when every provider fails', async () => {
    stubFetch(() =>
      json(502, { error: { message: 'Provider returned error', code: 502, metadata: { provider_name: 'Up', raw: 'upstream down' } } }),
    );

    const out = await pavlexChatWithCrmTools({ req, instructions: INSTRUCTIONS, message: 'Make a referral request sms and save it in scripts' });

    assert.equal(out.error, true);
    assert.match(out.detail, /upstream down/);
    assert.doesNotMatch(out.userMessage, /MCP|Provider returned error/);
    assert.match(out.userMessage, /try again/i);
  });
});
