const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const express = require('express');
const session = require('express-session');
const { SqliteSessionStore } = require('../lib/sqliteSessionStore');

const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sessions-')), 'app.db');

function startApp() {
  const db = new Database(dbFile);
  const store = new SqliteSessionStore({ db, pruneEveryMs: 0 });
  const app = express();
  app.use(session({ secret: 'test', store, resave: false, saveUninitialized: false }));
  app.get('/login', (req, res) => { req.session.user = { email: 'owner@example.com' }; res.send('ok'); });
  app.get('/me', (req, res) => res.json({ user: req.session.user || null }));
  app.get('/logout', (req, res) => req.session.destroy(() => res.send('bye')));
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ db, store, server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

async function stop({ server, db }) {
  await new Promise((r) => server.close(r));
  db.close();
}

test('a sign-in survives a server restart', async () => {
  const first = await startApp();
  const login = await fetch(`${first.base}/login`);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  await stop(first);

  const second = await startApp();
  const me = await (await fetch(`${second.base}/me`, { headers: { cookie } })).json();
  assert.deepEqual(me.user, { email: 'owner@example.com' });

  await fetch(`${second.base}/logout`, { headers: { cookie } });
  const after = await (await fetch(`${second.base}/me`, { headers: { cookie } })).json();
  assert.equal(after.user, null);
  await stop(second);
});

test('expired sessions are not returned and get pruned', async () => {
  const db = new Database(dbFile);
  const store = new SqliteSessionStore({ db, pruneEveryMs: 0, touchAfterMs: 0 });
  const past = new Date(Date.now() - 1000).toISOString();
  await new Promise((r) => store.set('old', { cookie: { expires: past }, user: 'x' }, r));
  await new Promise((r) => store.set('new', { cookie: { expires: new Date(Date.now() + 60000).toISOString() } }, r));

  const got = await new Promise((r) => store.get('old', (err, s) => r(s)));
  assert.equal(got, null);
  store.prune();
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM http_sessions WHERE sid = 'old'").get().c, 0);

  await new Promise((r) => store.touch('new', { cookie: { expires: past } }, r));
  assert.equal(await new Promise((r) => store.get('new', (err, s) => r(s))), null);
  db.close();
});

test('touch is throttled so menu hops do not rewrite expires every request', async () => {
  const db = new Database(':memory:');
  const store = new SqliteSessionStore({ db, pruneEveryMs: 0, touchAfterMs: 60_000 });
  const far = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await new Promise((r) => store.set('s1', { cookie: { expires: far }, user: 'a' }, r));
  const before = db.prepare('SELECT expires FROM http_sessions WHERE sid = ?').get('s1').expires;
  await new Promise((r) => setTimeout(r, 5));
  await new Promise((r) => store.touch('s1', { cookie: { expires: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString() } }, r));
  const after = db.prepare('SELECT expires FROM http_sessions WHERE sid = ?').get('s1').expires;
  assert.equal(after, before);
  db.close();
});
