const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveFollowUpTaskSource } = require('../services/leadDispositionApply');
const {
  TASK_SOURCE_MANUAL,
  TASK_SOURCE_DISPOSITION,
  isManualUserTask,
} = require('../services/userTasks');

describe('leadDispositionApply follow-up task source', () => {
  test('resolveFollowUpTaskSource marks user dispositions as manual', () => {
    assert.equal(resolveFollowUpTaskSource('api'), TASK_SOURCE_MANUAL);
    assert.equal(resolveFollowUpTaskSource(''), TASK_SOURCE_MANUAL);
    assert.equal(resolveFollowUpTaskSource('auto_dial'), TASK_SOURCE_DISPOSITION);
  });

  test('user disposition follow-ups appear on Tasks page filter', () => {
    assert.equal(
      isManualUserTask({ title: 'Callback — Acme Roofing', source: TASK_SOURCE_MANUAL }),
      true,
    );
    assert.equal(
      isManualUserTask({ title: 'Retry no answer', source: TASK_SOURCE_DISPOSITION }),
      false,
    );
  });
});
