/**
 * Signup / first-open push nudge — modal next to History install sheet,
 * Home banner, and post-signup copy that stresses phone alerts.
 */
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');

test('Reviews tabbar includes Turn on phone alerts nudge modal', () => {
  const tabbar = fs.readFileSync(path.join(root, 'views/member_app/_tabbar.ejs'), 'utf8');
  assert.match(tabbar, /id="maPushNudge"/);
  assert.match(tabbar, /Turn on phone alerts/);
  assert.match(tabbar, /data-ma-push-nudge-enable/);
  assert.match(tabbar, /News &amp; updates/);
  assert.match(tabbar, /member-app-push-nudge\.js/);
});

test('Home shows persistent Turn on alerts banner hook', () => {
  const home = fs.readFileSync(path.join(root, 'views/member_app/home.ejs'), 'utf8');
  assert.match(home, /id="maPushNudgeBanner"/);
  assert.match(home, /data-ma-push-nudge-open/);
  assert.match(home, /Turn on phone alerts/);
});

test('push nudge script chains after install sheet and registers /m/sw.js', () => {
  const js = fs.readFileSync(path.join(root, 'public/js/member-app-push-nudge.js'), 'utf8');
  assert.match(js, /ma-install-closed/);
  assert.match(js, /register\('\/m\/sw\.js'/);
  assert.match(js, /\/push\/subscribe/);
  assert.match(js, /ma-push-nudge-snooze/);
  const appJs = fs.readFileSync(path.join(root, 'public/js/member-app.js'), 'utf8');
  assert.match(appJs, /ma-install-closed/);
});

test('signup success screen tells people to turn on phone alerts', () => {
  const page = fs.readFileSync(path.join(root, 'views/free_app.ejs'), 'utf8');
  assert.match(page, /fa-sent-steps/);
  assert.match(page, /Turn on phone alerts/);
  assert.match(page, /Add to Home Screen/);
});
