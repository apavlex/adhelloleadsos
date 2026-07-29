const test = require('node:test');
const assert = require('node:assert/strict');

// Mirror client incremental-edit detection
function userWantsIncrementalEdit(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (/^INCREMENTAL EDIT/i.test(t)) return true;
  return (
    /^(remove|delete|take out|get rid of|drop|hide|eliminate|without|no more|lose the|take off|strip|move the|swap the|replace the|fix the|adjust the|change only|just change|only change|make the .+ (bigger|smaller|lighter|darker|bolder|smaller))/i.test(
      t,
    ) ||
    /\b(remove|delete|take out|get rid of|drop|hide|without)\s+(the|this|that|my)\b/i.test(t) ||
    /\b(no|without)\s+(more|longer)\s+/i.test(t)
  );
}

test('userWantsIncrementalEdit detects remove/change requests', () => {
  assert.equal(userWantsIncrementalEdit('remove the gold seal'), true);
  assert.equal(userWantsIncrementalEdit('delete the badge on the left'), true);
  assert.equal(userWantsIncrementalEdit('make the headline smaller'), true);
  assert.equal(userWantsIncrementalEdit('create a bold flooring ad'), false);
});
