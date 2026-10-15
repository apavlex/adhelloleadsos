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

test('Home hero uses live review views when brand label is review page visits', async () => {
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

  const token = createMemberPortalToken({ networkId: network.id, memberId: member.id });
  const { server, base } = await startServer();
  try {
    const home = await fetch(`${base}/m/${token}`);
    assert.equal(home.status, 200);
    const html = await home.text();
    // Hero and tile both show live 22 — not the frozen brand 91.
    assert.match(html, />\s*22\s*</);
    assert.doesNotMatch(html, /ma-hero__stat">\s*91\s*</);
    assert.match(html, /review page visits/i);
    assert.match(html, /Review visits/i);

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
