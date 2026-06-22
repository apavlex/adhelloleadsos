const test = require('node:test');
const assert = require('node:assert/strict');
const { safeJsonForScript } = require('../services/safeJson');

test('safeJsonForScript escapes script-breaking sequences', () => {
  const payload = [{ title: '</script><script>alert(1)</script>', note: 'A & B' }];
  const out = safeJsonForScript(payload);
  assert.ok(!out.includes('</script>'), 'must not contain raw closing script tag');
  assert.deepEqual(JSON.parse(out.replace(/\\u003c/g, '<').replace(/\\u003e/g, '>').replace(/\\u0026/g, '&')), payload);
});
