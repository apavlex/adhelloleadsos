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
  TASK_SOURCE_NETWORK,
  TASK_TITLE_MAX_LENGTH,
  validateTaskTitle,
  applyTaskEdits,
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

describe('userTasks editing', () => {
  const norms = {
    normColumn: (c) => (['backlog', 'todo', 'doing', 'done'].includes(c) ? c : 'todo'),
    normScheduledAt: (v) => (v ? new Date(v).toISOString() : null),
  };
  const base = {
    id: 't1',
    title: 'Call back',
    column: 'todo',
    sort: 1,
    scheduledAt: '2026-10-02T15:00:00.000Z',
    leadKey: null,
    source: TASK_SOURCE_LEAD_TASK,
  };

  test('validateTaskTitle trims, collapses whitespace and rejects empty or overlong titles', () => {
    assert.deepEqual(validateTaskTitle('  Send   deck \n'), { ok: true, title: 'Send deck' });
    assert.equal(validateTaskTitle('   ').ok, false);
    assert.equal(validateTaskTitle(null).ok, false);
    assert.equal(validateTaskTitle('x'.repeat(TASK_TITLE_MAX_LENGTH)).ok, true);
    assert.equal(validateTaskTitle('x'.repeat(TASK_TITLE_MAX_LENGTH + 1)).ok, false);
  });

  test('applyTaskEdits updates only the fields sent', () => {
    const r = applyTaskEdits(base, { title: ' Call back Friday ' }, norms);
    assert.equal(r.ok, true);
    assert.deepEqual(r.task, { ...base, title: 'Call back Friday' });
  });

  test('applyTaskEdits rejects an empty or overlong title instead of keeping the old one', () => {
    assert.equal(applyTaskEdits(base, { title: '  ' }, norms).ok, false);
    assert.equal(applyTaskEdits(base, { title: 'x'.repeat(TASK_TITLE_MAX_LENGTH + 1) }, norms).ok, false);
  });

  test('applyTaskEdits changes status, clears the reminder and links a lead', () => {
    const r = applyTaskEdits(base, { column: 'doing', scheduledAt: null, leadKey: 'lead:abc' }, norms);
    assert.equal(r.task.column, 'doing');
    assert.equal(r.task.scheduledAt, null);
    assert.equal(r.task.leadKey, 'lead:abc');
    assert.equal(r.task.source, TASK_SOURCE_LEAD_TASK);
    assert.equal(applyTaskEdits({ ...base, leadKey: 'lead:abc' }, { leadKey: null }, norms).task.leadKey, null);
  });

  test('linking a follow-up task to a new lead promotes it to a checklist task', () => {
    const followUp = { ...base, source: TASK_SOURCE_MANUAL };
    assert.equal(applyTaskEdits(followUp, { leadKey: 'lead:abc' }, norms).task.source, TASK_SOURCE_LEAD_TASK);
    assert.equal(applyTaskEdits({ ...base, source: undefined }, { leadKey: 'lead:abc' }, norms).task.source, TASK_SOURCE_LEAD_TASK);
    assert.equal(applyTaskEdits(followUp, { title: 'Renamed' }, norms).task.source, TASK_SOURCE_MANUAL);
    const network = { ...base, source: TASK_SOURCE_NETWORK };
    assert.equal(applyTaskEdits(network, { leadKey: 'lead:abc' }, norms).task.source, TASK_SOURCE_NETWORK);
  });
});
