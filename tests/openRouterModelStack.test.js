const test = require('node:test');
const assert = require('node:assert/strict');
const {
  describeOpenRouterModelStack,
  OPENROUTER_FREE_ROUTER,
  OPENROUTER_FREE_MODEL,
  OPENROUTER_PAID_FALLBACK_MODEL,
} = require('../services/llmClient');

test('describeOpenRouterModelStack defaults to free auto-router', () => {
  const prev = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'test';
  delete process.env.OPENROUTER_MODEL;
  delete process.env.OPENROUTER_ALLOW_PAID_FALLBACK;
  try {
    const stack = describeOpenRouterModelStack({});
    assert.equal(stack.mode, 'free_only');
    assert.equal(stack.steps[0], OPENROUTER_FREE_ROUTER);
    assert.equal(stack.steps[1], OPENROUTER_FREE_MODEL);
  } finally {
    if (prev == null) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = prev;
  }
});

test('describeOpenRouterModelStack shows flash when paid fallback enabled', () => {
  const prevKey = process.env.OPENROUTER_API_KEY;
  const prevPaid = process.env.OPENROUTER_ALLOW_PAID_FALLBACK;
  process.env.OPENROUTER_API_KEY = 'test';
  process.env.OPENROUTER_ALLOW_PAID_FALLBACK = '1';
  delete process.env.OPENROUTER_MODEL;
  try {
    const stack = describeOpenRouterModelStack({});
    assert.equal(stack.mode, 'free_then_paid');
    assert.equal(stack.steps[1], OPENROUTER_PAID_FALLBACK_MODEL);
    assert.match(stack.summary, /deepseek\/deepseek-v4-flash/);
  } finally {
    if (prevKey == null) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = prevKey;
    if (prevPaid == null) delete process.env.OPENROUTER_ALLOW_PAID_FALLBACK;
    else process.env.OPENROUTER_ALLOW_PAID_FALLBACK = prevPaid;
  }
});
