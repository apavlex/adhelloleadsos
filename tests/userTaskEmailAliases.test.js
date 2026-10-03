const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'user-task-aliases-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');

const WID = 'ws_task_alias';

test('tasks saved as alex@adhello.io show up for alex@adhello.ai (and vice versa)', async () => {
  await dbService.saveUserTask(WID, 'alex@adhello.io', { id: 't_phone', title: 'Made on phone', source: 'lead_task' });
  await dbService.saveUserTask(WID, 'alex@adhello.ai', { id: 't_desk', title: 'Made on desktop', source: 'lead_task' });
  const fromAi = (await dbService.listUserTasks(WID, 'alex@adhello.ai')).map((t) => t.id).sort();
  const fromIo = (await dbService.listUserTasks(WID, 'alex@adhello.io')).map((t) => t.id).sort();
  assert.deepEqual(fromAi, ['t_desk', 't_phone']);
  assert.deepEqual(fromIo, ['t_desk', 't_phone']);
});

test('legacy mixed-case keys are found, and edits keep a single copy', async () => {
  // Older saves used the email exactly as signed in (case-sensitive).
  dbService.setKvSync(`user_task:${WID}:Alex_AdHello_io:t_legacy`, {
    id: 't_legacy',
    title: 'Old casing',
    column: 'todo',
    source: 'lead_task',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  let tasks = await dbService.listUserTasks(WID, 'alex@adhello.ai');
  assert.ok(tasks.some((t) => t.id === 't_legacy'));

  await dbService.saveUserTask(WID, 'alex@adhello.ai', { id: 't_legacy', title: 'Edited on desktop', column: 'done', source: 'lead_task' });
  tasks = await dbService.listUserTasks(WID, 'Alex@AdHello.io');
  const copies = tasks.filter((t) => t.id === 't_legacy');
  assert.equal(copies.length, 1);
  assert.equal(copies[0].title, 'Edited on desktop');
  assert.equal(copies[0].column, 'done');
  assert.equal(dbService.listKvKeysSync(`user_task:${WID}:`).filter((k) => k.endsWith(':t_legacy')).length, 1);
});

test('deleting from either domain removes the task everywhere', async () => {
  await dbService.deleteUserTask(WID, 'alex@adhello.ai', 't_phone');
  const left = (await dbService.listUserTasks(WID, 'alex@adhello.io')).map((t) => t.id);
  assert.ok(!left.includes('t_phone'));
});

test('other people stay separate', async () => {
  await dbService.saveUserTask(WID, 'rep@example.com', { id: 't_rep', title: 'Rep task', source: 'lead_task' });
  const mine = (await dbService.listUserTasks(WID, 'alex@adhello.ai')).map((t) => t.id);
  assert.ok(!mine.includes('t_rep'));
  assert.deepEqual((await dbService.listUserTasks(WID, 'rep@example.com')).map((t) => t.id), ['t_rep']);
});
