/**
 * Notification review checkpoint — catch up so phone alerts do not feel like they repeat.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'notif-review-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const review = require('../services/notificationReview');

test('markReviewed stores a per-user watermark', () => {
  assert.equal(review.getReviewedAt('nobody@x.com'), null);
  const { reviewedAt } = review.markReviewed('Owner@Example.com', Date.parse('2026-10-18T20:00:00Z'));
  assert.equal(reviewedAt, '2026-10-18T20:00:00.000Z');
  assert.equal(review.getReviewedAt('owner@example.com'), reviewedAt);
  assert.equal(review.isNewerThanReview('owner@example.com', '2026-10-18T19:00:00Z'), false);
  assert.equal(review.isNewerThanReview('owner@example.com', '2026-10-18T21:00:00Z'), true);
});

test('bell and history templates expose Mark reviewed', () => {
  const nav = fs.readFileSync(path.join(__dirname, '../views/partials/navbar.ejs'), 'utf8');
  const page = fs.readFileSync(path.join(__dirname, '../views/notifications.ejs'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '../public/js/nav-notifications.js'), 'utf8');
  const sw = fs.readFileSync(path.join(__dirname, '../public/sw.js'), 'utf8');
  assert.match(nav, /notificationMarkReviewed/);
  assert.match(nav, /Mark all reviewed/);
  assert.match(page, /Mark all reviewed/);
  assert.match(js, /\/notifications\/reviewed/);
  assert.match(js, /CLEAR_NOTIFICATIONS/);
  assert.match(sw, /CLEAR_NOTIFICATIONS/);
  assert.match(js, /loadRecentBellNotifications/);
  assert.match(js, /Keep unread search\/client items visible until Mark all reviewed/);
  assert.match(js, /getRegistration/);
  assert.match(js, /applyCaughtUpBellUi/);
  assert.match(js, /Update bell immediately/);
  assert.match(js, /AgencyTaskReminders\.markAllCaughtUp/);
  // Must use getRegistration (not .ready) — ready hangs when no SW is registered.
  const clearFn = js.slice(js.indexOf('function clearOsNotifications'), js.indexOf('function escBell'));
  assert.match(clearFn, /getRegistration/);
  assert.doesNotMatch(clearFn, /\.ready\b/);
  assert.doesNotMatch(
    js.slice(js.indexOf('processingIndicator.addEventListener(\'click\''), js.indexOf('var markReviewedBtn')),
    /\/api\/notifications\/read/,
  );

  const taskReminders = fs.readFileSync(path.join(__dirname, '../public/js/task-reminders.js'), 'utf8');
  assert.match(taskReminders, /markAllCaughtUp/);
  assert.match(taskReminders, /agencyOsTaskRemindersReviewedAt/);
  assert.match(taskReminders, /KEEP_FIRED_MS/);
  assert.match(taskReminders, /LOOKBACK_MS/);
  assert.match(taskReminders, /switching workspaces/);
  assert.match(taskReminders, /syncReviewedFromServer/);
  assert.match(taskReminders, /renotify:\s*false/);
});
