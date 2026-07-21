const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolvePavlexToolLlm,
  hasPavlexToolLlm,
  resolveOpenAiDirectKey,
} = require('../services/pavlex/pavlexLlmConfig');

describe('pavlexLlmConfig', () => {
  it('prefers OPENAI_API_KEY when set', () => {
    const prev = process.env.OPENAI_API_KEY;
    const prevOr = process.env.OPENROUTER_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.OPENROUTER_API_KEY = 'or-test';
    try {
      const llm = resolvePavlexToolLlm();
      assert.equal(llm.provider, 'openai');
      assert.equal(llm.apiKey, 'sk-test');
    } finally {
      if (prev === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prev;
      if (prevOr === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = prevOr;
    }
  });

  it('falls back to OPENROUTER_API_KEY', () => {
    const prev = process.env.OPENAI_API_KEY;
    const prevOr = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENAI_API_KEY;
    process.env.OPENROUTER_API_KEY = 'or-test';
    try {
      const llm = resolvePavlexToolLlm();
      assert.equal(llm.provider, 'openrouter');
    } finally {
      if (prev === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prev;
      if (prevOr === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = prevOr;
    }
  });

  it('reports no key when unset', () => {
    const prev = process.env.OPENAI_API_KEY;
    const prevOr = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    try {
      assert.equal(resolvePavlexToolLlm(), null);
      assert.equal(hasPavlexToolLlm(), false);
      assert.equal(resolveOpenAiDirectKey(), null);
    } finally {
      if (prev === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prev;
      if (prevOr === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = prevOr;
    }
  });
});
