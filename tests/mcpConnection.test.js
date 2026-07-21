const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  extractResponsesOutputText,
  defaultResponsesModel,
} = require('../services/mcp/mcpResponsesClient');
const {
  getMcpServerUrl,
  envMcpBearerToken,
  isResponsesMcpReady,
  CRM_MCP_TOOL_NAMES,
} = require('../services/mcp/mcpConnection');

describe('mcpConnection', () => {
  it('builds server URL from BASE_URL', () => {
    const prev = process.env.BASE_URL;
    process.env.BASE_URL = 'https://leads.adhello.ai';
    assert.equal(getMcpServerUrl(), 'https://leads.adhello.ai/ceo/mcp');
    process.env.BASE_URL = prev;
  });

  it('checks Responses MCP readiness', () => {
    assert.equal(
      isResponsesMcpReady({
        openaiApiKey: 'sk-test',
        serverUrl: 'https://example.com/ceo/mcp',
        bearerToken: 'tok',
      }),
      true,
    );
    assert.equal(
      isResponsesMcpReady({
        openaiApiKey: '',
        serverUrl: 'https://example.com/ceo/mcp',
        bearerToken: 'tok',
      }),
      false,
    );
  });

  it('scopes env bearer token to workspace when MCP_WORKSPACE_ID set', () => {
    const prevToken = process.env.MCP_ACCESS_TOKEN;
    const prevWid = process.env.MCP_WORKSPACE_ID;
    process.env.MCP_ACCESS_TOKEN = 'secret';
    process.env.MCP_WORKSPACE_ID = 'ws-a';
    assert.equal(envMcpBearerToken('ws-a'), 'secret');
    assert.equal(envMcpBearerToken('ws-b'), null);
    process.env.MCP_ACCESS_TOKEN = prevToken;
    process.env.MCP_WORKSPACE_ID = prevWid;
  });

  it('exports CRM tool names', () => {
    assert.ok(CRM_MCP_TOOL_NAMES.includes('list_folders'));
    assert.ok(CRM_MCP_TOOL_NAMES.includes('count_leads'));
    assert.ok(CRM_MCP_TOOL_NAMES.includes('search_leads'));
  });
});

describe('mcpResponsesClient output parsing', () => {
  it('reads output_text', () => {
    assert.equal(extractResponsesOutputText({ output_text: 'Hello' }), 'Hello');
  });

  it('reads nested message content', () => {
    const text = extractResponsesOutputText({
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: 'CRM reply' }],
        },
      ],
    });
    assert.equal(text, 'CRM reply');
  });

  it('defaultResponsesModel falls back to gpt-4.1', () => {
    const prev = process.env.OPENAI_RESPONSES_MODEL;
    const prevModel = process.env.OPENAI_MODEL;
    delete process.env.OPENAI_RESPONSES_MODEL;
    delete process.env.OPENAI_MODEL;
    assert.equal(defaultResponsesModel(), 'gpt-4.1');
    process.env.OPENAI_RESPONSES_MODEL = prev;
    process.env.OPENAI_MODEL = prevModel;
  });
});
