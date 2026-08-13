const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  isManualUserTask,
  filterManualUserTasks,
  isAutomationTaskTitle,
  TASK_SOURCE_CADENCE,
  TASK_SOURCE_MANUAL,
  TASK_SOURCE_DISPOSITION,
} = require('../services/userTasks');

describe('userTasks manual filter', () => {
  test('isAutomationTaskTitle detects cadence step titles', () => {
    assert.equal(
      isAutomationTaskTitle('[CALL] Day 1 — Cold call + text (opener)'),
      true,
    );
    assert.equal(isAutomationTaskTitle('Call back about proposal'), false);
  });

  test('isManualUserTask respects source field', () => {
    assert.equal(isManualUserTask({ title: 'Follow up', source: TASK_SOURCE_MANUAL }), true);
    assert.equal(
      isManualUserTask({ title: 'Anything', source: TASK_SOURCE_CADENCE }),
      false,
    );
    assert.equal(
      isManualUserTask({ title: 'Auto retry', source: TASK_SOURCE_DISPOSITION }),
      false,
    );
  });

  test('filterManualUserTasks hides cadence tasks without source', () => {
    const tasks = [
      { id: '1', title: 'Call back tomorrow', source: TASK_SOURCE_MANUAL },
      { id: '2', title: '[CALL] Day 1 — Cold call', source: TASK_SOURCE_CADENCE },
      { id: '3', title: '[EMAIL] Day 3 — Follow-up' },
      { id: '4', title: 'Send contract' },
      {
        id: '5',
        title: '[CALL] Day 1— Cold call + text (opener) — Call first. Voicemail (~15s)',
      },
    ];
    const manual = filterManualUserTasks(tasks);
    assert.deepEqual(manual.map((t) => t.id), ['1', '4']);
  });
});
