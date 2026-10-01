const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  stripThinking,
  looksLikeLeakedReasoning,
  extractTextToolCalls,
  sanitizeAssistantText,
  sanitizeHistory,
} = require('../services/pavlex/pavlexReplyParse');
const { extractOpenRouterApiError } = require('../services/llmClient');
const { chatUnavailableMessage } = require('../services/pavlex/pavlexCrmIntent');
const {
  resolvePavlexToolLlmChain,
  isUnreliableToolModel,
} = require('../services/pavlex/pavlexLlmConfig');

const KNOWN = ['suggest_daily_leads', 'save_script', 'list_folders'];

describe('extractTextToolCalls', () => {
  it('parses a bare tool name in <tool_call>', () => {
    const out = extractTextToolCalls('Let me get those.\n<tool_call>suggest_daily_leads</tool_call>', KNOWN);
    assert.deepEqual(out.calls, [{ name: 'suggest_daily_leads', arguments: {} }]);
    assert.equal(out.cleaned, 'Let me get those.');
  });

  it('parses JSON bodies with arguments / parameters / function wrappers', () => {
    const a = extractTextToolCalls(
      '<tool_call>{"name":"save_script","arguments":{"name":"Referral SMS","body":"Hi {{name}}","section":"sms"}}</tool_call>',
      KNOWN,
    );
    assert.deepEqual(a.calls, [
      { name: 'save_script', arguments: { name: 'Referral SMS', body: 'Hi {{name}}', section: 'sms' } },
    ]);
    const b = extractTextToolCalls('<tool_call>{"name":"suggest_daily_leads","parameters":{"limit":5}}</tool_call>', KNOWN);
    assert.deepEqual(b.calls[0].arguments, { limit: 5 });
    const c = extractTextToolCalls(
      '<tool_call>{"function":{"name":"suggest_daily_leads","arguments":"{\\"limit\\":3}"}}</tool_call>',
      KNOWN,
    );
    assert.deepEqual(c.calls[0], { name: 'suggest_daily_leads', arguments: { limit: 3 } });
  });

  it('parses name {json}, name({json}), <function=name> and unclosed blocks', () => {
    assert.deepEqual(extractTextToolCalls('<tool_call>suggest_daily_leads {"limit": 2}</tool_call>', KNOWN).calls[0].arguments, {
      limit: 2,
    });
    assert.deepEqual(extractTextToolCalls('<tool_call>suggest_daily_leads({"limit": 4})</tool_call>', KNOWN).calls[0].arguments, {
      limit: 4,
    });
    assert.deepEqual(extractTextToolCalls('<function=list_folders>{}</function>', KNOWN).calls, [
      { name: 'list_folders', arguments: {} },
    ]);
    assert.equal(extractTextToolCalls('Sure. <tool_call>list_folders', KNOWN).calls[0].name, 'list_folders');
  });

  it('parses several blocks and a JSON array body', () => {
    const out = extractTextToolCalls(
      '<tool_call>list_folders</tool_call>\n<tool_call>[{"name":"suggest_daily_leads","arguments":{}}]</tool_call>',
      KNOWN,
    );
    assert.deepEqual(out.calls.map((c) => c.name), ['list_folders', 'suggest_daily_leads']);
  });

  it('accepts a whole-message JSON tool call only for known tools', () => {
    const out = extractTextToolCalls('```json\n{"name":"suggest_daily_leads","arguments":{"limit":5}}\n```', KNOWN);
    assert.equal(out.calls[0].name, 'suggest_daily_leads');
    assert.equal(out.cleaned, '');
    assert.equal(extractTextToolCalls('{"name":"Bob","arguments":{}}', KNOWN).calls.length, 0);
  });

  it('ignores unknown tool names and plain prose', () => {
    assert.equal(extractTextToolCalls('<tool_call>delete_everything</tool_call>', KNOWN).calls.length, 0);
    assert.equal(extractTextToolCalls('Call Acme today, then save the script.', KNOWN).calls.length, 0);
  });
});

describe('thinking / reasoning stripping', () => {
  it('removes <think> blocks, stray </think> prefixes and unclosed <think>', () => {
    assert.equal(stripThinking('<think>user wants leads</think>Here are 3 leads.'), 'Here are 3 leads.');
    assert.equal(stripThinking('I should call the tool.</think>\nDone — saved.'), 'Done — saved.');
    assert.equal(stripThinking('<think>still thinking about it'), '');
  });

  it('flags reasoning-model preambles like the production leak', () => {
    assert.equal(
      looksLikeLeakedReasoning(
        'The user is asking "What should I work on today?" This sounds like they want daily suggestions. Looking at the available tools...',
      ),
      true,
    );
    assert.equal(looksLikeLeakedReasoning('Okay, the user wants a referral SMS.'), true);
    assert.equal(looksLikeLeakedReasoning('Let me check the rules first.'), true);
    assert.equal(looksLikeLeakedReasoning('Here are your top 5 leads for today:'), false);
    assert.equal(looksLikeLeakedReasoning('Saved "Referral request SMS" to Scripts.'), false);
  });

  it('sanitizeAssistantText removes markup and keeps the answer', () => {
    assert.equal(
      sanitizeAssistantText('<think>x</think>Done.<tool_call>unknown_tool</tool_call>', KNOWN),
      'Done.',
    );
  });

  it('sanitizeHistory drops leaked-reasoning and tool-markup replies', () => {
    const out = sanitizeHistory(
      [
        { role: 'user', content: 'What should I work on today?' },
        { role: 'assistant', content: 'The user is asking what to work on. Let me call it.' },
        { role: 'user', content: 'Ok' },
        { role: 'assistant', content: '<tool_call>suggest_daily_leads</tool_call>' },
        { role: 'assistant', content: 'Here are 2 leads.' },
      ],
      KNOWN,
    );
    assert.deepEqual(out, [
      { role: 'user', content: 'What should I work on today?' },
      { role: 'user', content: 'Ok' },
      { role: 'assistant', content: 'Here are 2 leads.' },
    ]);
  });
});

describe('provider errors', () => {
  it('surfaces the upstream reason OpenRouter hides behind "Provider returned error"', () => {
    const msg = extractOpenRouterApiError(
      {
        error: {
          message: 'Provider returned error',
          code: 400,
          metadata: { provider_name: 'Chutes', raw: '{"error":{"message":"tool_choice required is not supported"}}' },
        },
      },
      400,
    );
    assert.match(msg, /Provider returned error/);
    assert.match(msg, /Chutes: tool_choice required is not supported/);
    assert.match(msg, /HTTP 400/);
  });

  it('turns provider failures into friendly messages without "MCP connection failed"', () => {
    const generic = chatUnavailableMessage('openrouter openai/gpt-4o-mini: Provider returned error (HTTP 502)');
    assert.doesNotMatch(generic, /MCP|Provider returned error/);
    assert.match(chatUnavailableMessage('x: (HTTP 402) Insufficient credits'), /out of credits/);
    assert.match(chatUnavailableMessage('x: rate limit (HTTP 429)'), /busy/);
    assert.match(chatUnavailableMessage('No LLM key (OPENAI_API_KEY or OPENROUTER_API_KEY)'), /OPENROUTER_API_KEY/);
    assert.match(chatUnavailableMessage('x', { toolsRan: true }), /may already have run/);
  });
});

describe('tool model chain', () => {
  function withEnv(vars, fn) {
    const keys = ['OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'OPENROUTER_MODEL', 'OPENROUTER_TOOL_MODEL', 'OPENAI_TOOL_MODEL', 'OPENAI_MODEL', 'OPENAI_RESPONSES_MODEL'];
    const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    for (const k of keys) delete process.env[k];
    Object.assign(process.env, vars);
    try {
      return fn();
    } finally {
      for (const k of keys) {
        if (prev[k] === undefined) delete process.env[k];
        else process.env[k] = prev[k];
      }
    }
  }

  it('skips free / reasoning OPENROUTER_MODEL for tool turns and keeps a tool-capable fallback', () => {
    withEnv({ OPENROUTER_API_KEY: 'or', OPENROUTER_MODEL: 'openrouter/free' }, () => {
      assert.deepEqual(resolvePavlexToolLlmChain().map((c) => c.model), ['openai/gpt-4o-mini']);
    });
    withEnv({ OPENROUTER_API_KEY: 'or', OPENROUTER_MODEL: 'x-ai/grok-4', OPENROUTER_TOOL_MODEL: 'anthropic/claude-haiku-4.5' }, () => {
      assert.deepEqual(resolvePavlexToolLlmChain().map((c) => c.model), [
        'anthropic/claude-haiku-4.5',
        'x-ai/grok-4',
        'openai/gpt-4o-mini',
      ]);
    });
    withEnv({ OPENAI_API_KEY: 'sk', OPENROUTER_API_KEY: 'or' }, () => {
      assert.deepEqual(resolvePavlexToolLlmChain().map((c) => c.provider), ['openai', 'openrouter']);
    });
  });

  it('classifies unreliable tool models', () => {
    assert.equal(isUnreliableToolModel('qwen/qwen3-coder:free'), true);
    assert.equal(isUnreliableToolModel('deepseek/deepseek-r1'), true);
    assert.equal(isUnreliableToolModel('openai/gpt-4o-mini'), false);
    assert.equal(isUnreliableToolModel('deepseek/deepseek-v4-flash'), false);
  });
});
