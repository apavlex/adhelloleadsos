/**
 * Agency OS per-user pause/resume for GHL call & text notifications.
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ghl-notif-prefs-'));

const root = path.join(__dirname, '..');
const dbService = require('../services/database');
const prefs = require('../services/ghlNotificationPrefs');

describe('ghlNotificationPrefs', () => {
  const email = 'owner@example.com';

  beforeEach(() => {
    const key = prefs.PREFIX + dbService._emailKeyFragment(email);
    if (key) dbService.deleteKvSync(key);
  });

  it('defaults to resumed (on) and can pause/resume', () => {
    assert.equal(prefs.isPaused(email), false);
    assert.equal(prefs.isEnabled(email), true);

    const paused = prefs.setPaused(email, true);
    assert.equal(paused.paused, true);
    assert.equal(paused.enabled, false);
    assert.equal(prefs.isPaused(email), true);

    const resumed = prefs.setEnabled(email, true);
    assert.equal(resumed.paused, false);
    assert.equal(resumed.enabled, true);
    assert.equal(prefs.isPaused(email), false);
  });

  it('allowPushEmail skips paused users for GHL call/text types only', () => {
    prefs.setPaused(email, true);
    assert.equal(prefs.allowPushEmail(email, 'missed_call', () => true), false);
    assert.equal(prefs.allowPushEmail(email, 'sms', () => true), false);
    assert.equal(prefs.allowPushEmail(email, 'voicemail', () => true), false);
    assert.equal(prefs.allowPushEmail(email, 'missed_call_text_sent', () => true), false);
    // Form / email inbound still deliver when GHL calls & texts are paused.
    assert.equal(prefs.allowPushEmail(email, 'form', () => true), true);
    assert.equal(prefs.allowPushEmail(email, 'email', () => true), true);
    assert.equal(prefs.allowPushEmail(email, 'missed_call', () => false), false);
  });

  it('navbar + routes expose pause/resume control', () => {
    const nav = fs.readFileSync(path.join(root, 'views/partials/navbar.ejs'), 'utf8');
    const js = fs.readFileSync(path.join(root, 'public/js/nav-inbound.js'), 'utf8');
    const route = fs.readFileSync(path.join(root, 'routes/notifications.js'), 'utf8');
    const push = fs.readFileSync(path.join(root, 'services/inboundPush.js'), 'utf8');

    assert.match(nav, /navGhlAlertsToggle/);
    assert.match(nav, /GHL calls &amp; texts/);
    assert.match(js, /\/notifications\/ghl-alerts/);
    assert.match(js, /setGhlPaused/);
    assert.match(js, /Paused/);
    // Inbound rows: Open + Done only (no Call in LC / Lead Connector pill).
    assert.match(js, /btn-primary[^>]*>Open</);
    assert.match(js, /data-nav-inbound-done/);
    assert.match(js, /moneyModeHref|__adhelloMoneyModeLeadUrl/);
    assert.doesNotMatch(js, /pipeline\?focusLead/);
    assert.doesNotMatch(js, /Call in LC/);
    assert.doesNotMatch(js, /callHref/);
    assert.match(route, /ghlNotificationPrefs/);
    assert.match(route, /router\.post\('\/ghl-alerts'/);
    assert.match(route, /ghlNotificationsPaused/);
    assert.match(push, /ghlNotificationPrefs\.allowPushEmail/);
  });
});
