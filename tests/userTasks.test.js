const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');
const {
  isManualUserTask,
  filterManualUserTasks,
  isAutomationTaskTitle,
  upsertOpenTaskForLead,
  dedupeOpenLeadTasks,
  TASK_SOURCE_CADENCE,
  TASK_SOURCE_MANUAL,
  TASK_SOURCE_LEAD_TASK,
  TASK_SOURCE_DISPOSITION,
} = require('../services/userTasks');

describe('userTasks lead checklist tasks', () => {
  let store;
  const originals = {};

  beforeEach(() => {
    store = new Map();
    ['listUserTasks', 'saveUserTask', 'deleteUserTask'].forEach((m) => {
      originals[m] = dbService[m];
    });
    dbService.listUserTasks = async () => [...store.values()];
    dbService.saveUserTask = async (_ws, _email, task) => {
      const saved = { ...task, updatedAt: new Date().toISOString() };
      store.set(saved.id, saved);
      return saved;
    };
    dbService.deleteUserTask = async (_ws, _email, id) => {
      store.delete(id);
    };
  });

  afterEach(() => {
    Object.keys(originals).forEach((m) => {
      dbService[m] = originals[m];
    });
  });

  test('a lead keeps every open task added with Add task', async () => {
    await upsertOpenTaskForLead('ws', 'a@b.c', { title: 'Test', leadKey: 'lead:abc', source: TASK_SOURCE_LEAD_TASK });
    await upsertOpenTaskForLead('ws', 'a@b.c', { title: 'Test 2', leadKey: 'lead:abc', source: TASK_SOURCE_LEAD_TASK });
    await dedupeOpenLeadTasks('ws', 'a@b.c');
    assert.deepEqual([...store.values()].map((t) => t.title).sort(), ['Test', 'Test 2']);
    assert.equal(isManualUserTask({ title: 'Test', source: TASK_SOURCE_LEAD_TASK }), true);
  });

  test('follow-up upserts still replace the old follow-up but leave checklist tasks alone', async () => {
    await upsertOpenTaskForLead('ws', 'a@b.c', { title: 'Send deck', leadKey: 'lead:abc', source: TASK_SOURCE_LEAD_TASK });
    await upsertOpenTaskForLead('ws', 'a@b.c', { title: 'Callback 1', leadKey: 'lead:abc', source: TASK_SOURCE_MANUAL });
    await upsertOpenTaskForLead('ws', 'a@b.c', { title: 'Callback 2', leadKey: 'lead:abc', source: TASK_SOURCE_MANUAL });
    assert.deepEqual([...store.values()].map((t) => t.title).sort(), ['Callback 2', 'Send deck']);
  });
});

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
