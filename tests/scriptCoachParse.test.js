const test = require('node:test');
const assert = require('node:assert/strict');
const { parseScriptCoachAiContent } = require('../services/scriptCoachParse');

test('parses clean JSON coach responses', () => {
  const out = parseScriptCoachAiContent(
    JSON.stringify({
      reply: 'Kept it short and warm.',
      refinedScript: 'Hi {{company}}, quick note from our team.',
    }),
  );
  assert.equal(out.reply, 'Kept it short and warm.');
  assert.match(out.refinedScript, /Hi \{\{company\}\}/);
});

test('recovers when refinedScript JSON is slightly broken', () => {
  const raw =
    '{"reply":"Draft ready.","refinedScript":"Hi {{company}},\\n\\nWe help remodelers with pricing."}';
  const out = parseScriptCoachAiContent(raw, {
    userMessage: 'Help me write a personalized email script',
  });
  assert.ok(out);
  assert.match(out.reply, /Draft ready/i);
  assert.match(out.refinedScript, /remodelers/);
});

test('treats plain prose as a draft when user asked to write', () => {
  const prose =
    'Hi {{company}},\n\nI wanted to reach out about flooring installs in your area. Happy to share pricing if useful.\n\nThanks';
  const out = parseScriptCoachAiContent(prose, {
    userMessage: 'Help me write a personalized email script',
  });
  assert.ok(out);
  assert.match(out.reply, /draft/i);
  assert.match(out.refinedScript, /flooring installs/i);
});

test('returns null for empty content', () => {
  assert.equal(parseScriptCoachAiContent(''), null);
  assert.equal(parseScriptCoachAiContent(null), null);
});
