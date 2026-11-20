const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_EMPLOYEE_ID,
  listEmployees,
  getEmployee,
  normalizeEmployeeId,
  employeeForClient,
} = require('../services/pavlex/pavlexEmployees');
const { resolvePavlexToolLlmChain } = require('../services/pavlex/pavlexLlmConfig');

describe('pavlexEmployees', () => {
  it('lists Alex and Grokbot by default', () => {
    const list = listEmployees();
    assert.ok(list.length >= 2);
    assert.equal(list[0].id, 'alex');
    assert.ok(list.some((e) => e.id === 'grokbot'));
    assert.equal(DEFAULT_EMPLOYEE_ID, 'alex');
  });

  it('normalizes aliases and unknown ids', () => {
    assert.equal(normalizeEmployeeId('grok'), 'grokbot');
    assert.equal(normalizeEmployeeId('Grok-Bot'), 'grokbot');
    assert.equal(normalizeEmployeeId('mystery'), 'alex');
    assert.equal(normalizeEmployeeId(''), 'alex');
  });

  it('exposes Grok preferred OpenRouter models for Grokbot', () => {
    const grok = getEmployee('grokbot');
    assert.ok(grok.preferredOpenRouterModels.some((m) => String(m).startsWith('x-ai/grok')));
    const client = employeeForClient('grokbot');
    assert.equal(client.name, 'Grokbot');
    assert.ok(client.suggestions.length > 0);
  });

  it('prepends preferred OpenRouter models in the tool LLM chain', () => {
    const prev = {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
      OPENROUTER_MODEL: process.env.OPENROUTER_MODEL,
      OPENROUTER_TOOL_MODEL: process.env.OPENROUTER_TOOL_MODEL,
    };
    delete process.env.OPENAI_API_KEY;
    process.env.OPENROUTER_API_KEY = 'or-test';
    delete process.env.OPENROUTER_MODEL;
    delete process.env.OPENROUTER_TOOL_MODEL;
    try {
      const chain = resolvePavlexToolLlmChain({
        preferredOpenRouterModels: getEmployee('grokbot').preferredOpenRouterModels,
      });
      assert.equal(chain[0].provider, 'openrouter');
      assert.equal(chain[0].model, 'x-ai/grok-4');
      assert.ok(chain.some((c) => c.model === 'openai/gpt-4o-mini'));
    } finally {
      Object.keys(prev).forEach((k) => {
        if (prev[k] === undefined) delete process.env[k];
        else process.env[k] = prev[k];
      });
    }
  });
});
