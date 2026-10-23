/**
 * Partner cards keep Sent/Received count metrics only — Connected/Intro are pills.
 * Admin share link for workspace network signup sits above the summary cards.
 */
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'views/referrals.ejs'), 'utf8');
const route = fs.readFileSync(path.join(root, 'routes/referrals.js'), 'utf8');

test('referrals partner metrics only include sent and received count cards', () => {
  const start = html.indexOf('<div class="ref-metrics">');
  assert.ok(start >= 0);
  const block = html.slice(start, start + 900);
  assert.match(block, /data-ref-metric="sent"/);
  assert.match(block, /data-ref-metric="received"/);
  assert.doesNotMatch(block, /data-ref-metric="connected"/);
  assert.doesNotMatch(block, /data-ref-metric="intro"/);
});

test('connected and intro status remain as pills', () => {
  assert.match(html, /ref-pill-connected/);
  assert.match(html, /ref-pill-intro/);
  assert.match(html, /data-ref-pill/);
});

test('top summary drops Free and Paid cards', () => {
  const start = html.indexOf('grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6');
  assert.ok(start >= 0);
  const block = html.slice(start, html.indexOf('</div>', html.indexOf('data-ref-total="received"', start)) + 6);
  assert.match(block, /Partners/);
  assert.match(block, /Connected/);
  assert.match(block, /Leads sent/);
  assert.match(block, /Leads received/);
  assert.doesNotMatch(block, />Free</);
  assert.doesNotMatch(block, />Paid</);
  assert.doesNotMatch(block, /data-ref-total="free"/);
  assert.doesNotMatch(block, /data-ref-total="paid"/);
});

test('admin workspace signup link renders above the summary cards', () => {
  assert.match(route, /getOrEnsureJoinSlug/);
  assert.match(route, /getNetworkJoinUrl/);
  assert.match(route, /networkJoinUrl/);
  assert.match(html, /id="ref-join-link"/);
  assert.match(html, /Workspace signup link/);
  assert.match(html, /refJoinCopyBtn/);
  assert.match(html, /networkJoinUrl/);
  const joinAt = html.indexOf('id="ref-join-link"');
  const cardsAt = html.indexOf('grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6');
  assert.ok(joinAt > -1 && cardsAt > joinAt, 'signup link should sit above the metric cards');
});

test('News & updates sits under the workspace signup link on Referral Network', () => {
  assert.match(html, /partials\/network_news_updates/);
  assert.match(route, /networkMemberTotals/);
  assert.match(route, /networkNewsPosts/);
  assert.match(route, /networkNews\.list/);
  const joinAt = html.indexOf('id="ref-join-link"');
  const newsAt = html.indexOf("include('partials/network_news_updates')");
  const cardsAt = html.indexOf('grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6');
  assert.ok(joinAt > -1 && newsAt > joinAt, 'News & updates should sit under the signup link');
  assert.ok(cardsAt > newsAt, 'News & updates should sit above the Partners / Connected cards');
});
