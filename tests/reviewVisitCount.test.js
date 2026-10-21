const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'review-visit-count-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const store = require('../services/networkStore');
const reviewPublic = require('../routes/reviewPublic');
const { createMemberPortalToken } = require('../services/networkLinkSign');
const memberApp = require('../routes/memberApp');
const work = require('../services/memberWork');

async function startServer() {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.locals.assetVersion = 'test';
  app.use(memberApp);
  app.use(reviewPublic);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

test('Home banner shows leads; open jobs sit on the secondary line', async () => {
  const network = await store.getOrCreateNetworkForWorkspace(`ws_rv_visit_${Date.now()}`, {
    name: 'Visit Net',
  });
  await store.saveNetwork({
    ...network,
    brand: {
      appName: 'Visit Pros',
      accent: '#0ea5e9',
      // Frozen marketing value — previously stuck the hero while tiles moved.
      statValue: 91,
      statLabel: 'review page visits',
    },
  });
  let member = await store.saveMember(network.id, {
    companyName: 'Visit Pros',
    contactName: 'Alex',
    status: 'active',
  });
  member = await store.ensureReviewSlug(network.id, member, 'visit-pros');
  await store.bumpReviewStats(network.id, member.id, { view: true });
  await store.bumpReviewStats(network.id, member.id, { view: true });
  // Simulate live visits past the frozen brand.statValue.
  for (let i = 0; i < 20; i += 1) {
    await store.bumpReviewStats(network.id, member.id, { view: true });
  }
  const stats = await store.getReviewStats(network.id, member.id);
  assert.equal(stats.views, 22);

  const cust = await work.saveCustomer(network.id, member.id, {
    name: 'Jordan',
    phone: '+15551230001',
  });
  assert.equal(cust.ok, true);
  const leadCust = await work.saveCustomer(network.id, member.id, {
    name: 'Lead Contact',
    phone: '+15551230002',
  });
  assert.equal(leadCust.ok, true);
  await work.setCustomerLeadFlag(network.id, member.id, leadCust.customer.id, true);
  const job1 = await work.saveJob(network.id, member.id, {
    customerId: cust.customer.id,
    title: 'Deck repair',
    status: 'scheduled',
    date: '2026-11-10',
    time: '09:00',
  });
  const job2 = await work.saveJob(network.id, member.id, {
    customerId: cust.customer.id,
    title: 'Fence estimate',
    status: 'estimate',
  });
  const job3 = await work.saveJob(network.id, member.id, {
    customerId: cust.customer.id,
    title: 'Done job',
    status: 'completed',
  });
  assert.equal(job1.ok && job2.ok && job3.ok, true);

  const token = createMemberPortalToken({ networkId: network.id, memberId: member.id });
  const { server, base } = await startServer();
  try {
    const home = await fetch(`${base}/m/${token}`);
    assert.equal(home.status, 200);
    const html = await home.text();
    // Banner shows leads (1) — not frozen brand 91, review visits, or open jobs as the big number.
    assert.match(html, /ma-hero__stat">\s*1\s*<small>leads<\/small>/i);
    assert.doesNotMatch(html, /ma-hero__stat">\s*91\s*</);
    assert.doesNotMatch(html, /ma-hero__stat">\s*22\s*</);
    assert.doesNotMatch(html, /ma-hero__stat">\s*2\s*<small>open jobs<\/small>/i);
    assert.match(html, /2\s*open jobs/i);
    assert.match(html, /22\s*review visits/i);
    // First tile is Leads; open jobs live under the hero number.
    assert.match(html, /ma-tile__label">Leads</i);
    assert.doesNotMatch(html, /ma-tile__label">Open jobs</i);
    assert.doesNotMatch(html, /ma-tile__label">Review visits</i);

    const page = await fetch(`${base}/rv/visit-pros`);
    assert.equal(page.status, 200);
    // Give fire-and-forget view bump a moment.
    await new Promise((r) => setTimeout(r, 50));
    const after = await store.getReviewStats(network.id, member.id);
    assert.equal(after.views, 23);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('bumpReviewStats serializes concurrent view bumps', async () => {
  const network = await store.getOrCreateNetworkForWorkspace(`ws_rv_race_${Date.now()}`, {
    name: 'Race Net',
  });
  const member = await store.saveMember(network.id, {
    companyName: 'Race Co',
    status: 'active',
  });
  await Promise.all(Array.from({ length: 25 }, () => store.bumpReviewStats(network.id, member.id, { view: true })));
  const stats = await store.getReviewStats(network.id, member.id);
  assert.equal(stats.views, 25);
});
