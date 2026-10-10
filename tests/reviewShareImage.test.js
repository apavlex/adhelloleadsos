const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'review-share-img-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const store = require('../services/networkStore');
const reviewShareImage = require('../services/reviewShareImage');

test('renderDefaultShareImage returns a JPEG buffer', async () => {
  const img = await reviewShareImage.renderDefaultShareImage({
    companyName: 'Brightline Electric',
    brand: { accent: '#0d9488' },
  });
  assert.equal(img.contentType, 'image/jpeg');
  assert.ok(img.buffer.length > 1000);
  const meta = await sharp(img.buffer).metadata();
  assert.equal(meta.width, 1200);
  assert.equal(meta.height, 630);
});

test('prepareShareImage crops uploads to OG size', async () => {
  const src = await sharp({
    create: { width: 800, height: 400, channels: 3, background: '#112233' },
  }).png().toBuffer();
  const prepared = await reviewShareImage.prepareShareImage(src);
  const meta = await sharp(prepared.buffer).metadata();
  assert.equal(meta.width, 1200);
  assert.equal(meta.height, 630);
  assert.equal(prepared.contentType, 'image/jpeg');
});

test('share image paths and absolute AdHello URLs', () => {
  assert.equal(reviewShareImage.shareImagePath('brightline-electric'), '/rv/brightline-electric/og.jpg');
  assert.equal(
    reviewShareImage.shareImagePath('brightline-electric', 'abc123def456'),
    '/rv/brightline-electric/og/abc123def456.jpg',
  );
  assert.match(
    reviewShareImage.shareImageAbsoluteUrl('brightline-electric'),
    /^https:\/\/leads\.adhello\.io\/rv\/brightline-electric\/og\.jpg$/,
  );
});

test('save/load default share image in store', async () => {
  const network = await store.getOrCreateNetworkForWorkspace(`ws_share_img_${Date.now()}`, { name: 'Share Img Net' });
  const member = await store.saveMember(network.id, { companyName: 'Acme', status: 'active', reviewSlug: 'acme-co' });
  const prepared = await reviewShareImage.renderDefaultShareImage({ companyName: 'Acme', brand: {} });
  await reviewShareImage.saveDefaultShareImage(network.id, member.id, prepared);
  const loaded = await reviewShareImage.getShareImageBuffer(network.id, member.id, 'default', {
    companyName: 'Acme',
    brand: {},
  });
  assert.ok(loaded.buffer.length > 500);
  await reviewShareImage.deleteDefaultShareImage(network.id, member.id);
});
