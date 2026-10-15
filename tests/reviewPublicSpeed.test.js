const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'review-public-speed-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const sharp = require('sharp');
const store = require('../services/networkStore');
const reviewPublic = require('../routes/reviewPublic');

async function startServer() {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.locals.assetVersion = 'test';
  app.use(reviewPublic);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

test('public /rv page paints fast assets: compressed avatar + async CSS', async () => {
  const network = await store.getOrCreateNetworkForWorkspace(`ws_rv_speed_${Date.now()}`, {
    name: 'Speed Net',
  });
  let member = await store.saveMember(network.id, {
    companyName: 'Speed Pros',
    status: 'active',
  });
  member = await store.ensureReviewSlug(network.id, member, 'speed-pros');
  const photoAt = new Date().toISOString();
  await store.saveProfilePhoto(network.id, member.id, {
    contentType: 'image/png',
    buffer: await sharp({
      create: { width: 512, height: 512, channels: 3, background: { r: 30, g: 90, b: 160 } },
    }).png().toBuffer(),
  });
  member = await store.saveMember(network.id, { ...member, profilePhotoUpdatedAt: photoAt });

  const { server, base } = await startServer();
  try {
    const page = await fetch(`${base}/rv/speed-pros`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /\/rv\/speed-pros\/avatar\.png/);
    assert.match(html, /rel="preload" as="image"/);
    assert.match(html, /member-app\.css[^>]*media="print" onload="this\.media='all'"/);
    assert.match(html, /\.rv-wrap\{/);

    const avatar = await fetch(`${base}/rv/speed-pros/avatar.png`);
    assert.equal(avatar.status, 200);
    assert.match(String(avatar.headers.get('content-type') || ''), /image\/jpeg/);
    const buf = Buffer.from(await avatar.arrayBuffer());
    assert.ok(buf.length < 40_000, `compressed avatar still large: ${buf.length}`);
    const meta = await sharp(buf).metadata();
    assert.equal(meta.width, 192);
    assert.equal(meta.height, 192);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
