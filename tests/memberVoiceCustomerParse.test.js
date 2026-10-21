const test = require('node:test');
const assert = require('node:assert/strict');
const parse = require('../services/memberVoiceCustomerParse');

test('heuristicParse pulls name phone email address from a spoken blob', () => {
  const out = parse.heuristicParse(
    'New customer Jane Doe phone 360-555-0199 email jane@example.com lives at 123 Main St Camas. Gate code 4411.',
  );
  assert.match(out.name, /Jane/i);
  assert.match(out.phone, /360/);
  assert.match(out.email, /jane@example\.com/i);
  assert.match(out.address, /123 Main/i);
  assert.match(out.notes, /Gate code/i);
});

test('parseCustomerFromSpeech returns fields without LLM via heuristic fallback', async () => {
  const result = await parse.parseCustomerFromSpeech(
    'Customer name is Sam Rivera phone 503-555-0100 at 88 Oak Ave Portland',
  );
  assert.equal(result.ok, true);
  assert.ok(result.fields.name);
  assert.match(result.fields.name, /Sam/i);
  assert.match(result.fields.phone, /503/);
});

test('empty speech is rejected', async () => {
  const result = await parse.parseCustomerFromSpeech('  ');
  assert.equal(result.ok, false);
});
