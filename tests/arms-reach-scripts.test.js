const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ARMS_REACH_FACEBOOK_SEEDS,
  ARMS_REACH_FACEBOOK_STYLE_EXAMPLES,
} = require('../config/armsReachScripts');
const { sanitizeArmsReachScript } = require('../services/armsReachScriptAi');

test('facebook seeds include original LMV examples', () => {
  assert.equal(ARMS_REACH_FACEBOOK_SEEDS.length, 2);
  assert.match(ARMS_REACH_FACEBOOK_SEEDS[0], /extra revenue/i);
  assert.match(ARMS_REACH_FACEBOOK_SEEDS[1], /few new customers/i);
});

test('style examples include quick question variations', () => {
  assert.ok(ARMS_REACH_FACEBOOK_STYLE_EXAMPLES.length >= 5);
  const joined = ARMS_REACH_FACEBOOK_STYLE_EXAMPLES.join('\n');
  assert.match(joined, /Quick question for my network/i);
  assert.match(joined, /random question/i);
});

test('sanitizeArmsReachScript strips meta prefix', () => {
  assert.equal(
    sanitizeArmsReachScript("Here's a new variation: Hey friends, tag someone."),
    'Hey friends, tag someone.',
  );
});
