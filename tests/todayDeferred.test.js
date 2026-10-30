const test = require('node:test');
const assert = require('node:assert/strict');
const {
  countQueueNeedingAction,
  enrichTasksWithLeadsForToday,
  followUpTasksNeedingAttention,
} = require('../services/todayDeferred');

test('countQueueNeedingAction counts early pipeline stages only', () => {
  assert.equal(
    countQueueNeedingAction([
      { pipelineStage: 1 },
      { pipelineStage: 2 },
      { pipelineStage: 5 },
      { pipelineStage: 'x' },
    ]),
    3,
  );
});

test('enrichTasksWithLeadsForToday attaches lead titles', () => {
  const out = enrichTasksWithLeadsForToday(
    [{ id: 1, leadKey: 'lead:1', title: 'Call' }],
    [{ key: 'lead:1', title: 'Acme Flooring' }],
  );
  assert.equal(out[0].leadTitle, 'Acme Flooring');
});

test('followUpTasksNeedingAttention keeps due tasks and drops done', () => {
  const now = new Date();
  const due = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9).toISOString();
  const out = followUpTasksNeedingAttention([
    { id: 'a', scheduledAt: due, column: 'todo', title: 'A' },
    { id: 'b', scheduledAt: due, column: 'done', title: 'B' },
    { id: 'c', title: 'No date' },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'a');
});
