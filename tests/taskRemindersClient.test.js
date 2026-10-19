/**
 * Client task-reminder dedupe rules (source inspection).
 * Switching workspaces used to wipe the fired map and re-alert every overdue task.
 */
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const js = fs.readFileSync(path.join(__dirname, '../public/js/task-reminders.js'), 'utf8');

test('fired map is kept across workspace switches (TTL prune, not current-list-only)', () => {
  assert.match(js, /KEEP_FIRED_MS\s*=\s*3\s*\*\s*24/);
  assert.match(js, /now - at < KEEP_FIRED_MS/);
  // Must not only keep keys present in the current task list.
  const pruneFn = js.slice(js.indexOf('function pruneMap'), js.indexOf('function getTasks'));
  assert.match(pruneFn, /current\[k\]\s*\|\|/);
  assert.doesNotMatch(pruneFn, /if \(!tasks \|\| !tasks\.length\) return;/);
});

test('client matches server lookback so ancient overdue tasks stay quiet', () => {
  assert.match(js, /LOOKBACK_MS\s*=\s*30\s*\*\s*60\s*\*\s*1000/);
  assert.match(js, /now - due >= LOOKBACK_MS/);
});

test('boot syncs Mark all reviewed watermark from the server', () => {
  assert.match(js, /\/notifications\/recent\.json/);
  assert.match(js, /syncReviewedFromServer\(\)/);
});
