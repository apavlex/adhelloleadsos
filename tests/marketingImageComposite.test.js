const { test } = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const {
  compositeLogoOnImageBuffer,
  resizeBufferForLobPostcard,
  LOB_POSTCARD_WIDTH_PX,
  LOB_POSTCARD_HEIGHT_PX,
} = require('../services/marketingImageComposite');

test('resizeBufferForLobPostcard outputs Lob 4x6 bleed dimensions', async () => {
  const portrait = await sharp({
    create: {
      width: 2336,
      height: 3504,
      channels: 3,
      background: { r: 200, g: 210, b: 220 },
    },
  })
    .jpeg()
    .toBuffer();
  const out = await resizeBufferForLobPostcard(portrait);
  const meta = await sharp(out).metadata();
  assert.equal(meta.width, LOB_POSTCARD_WIDTH_PX);
  assert.equal(meta.height, LOB_POSTCARD_HEIGHT_PX);
  assert.equal(LOB_POSTCARD_WIDTH_PX, 1875);
  assert.equal(LOB_POSTCARD_HEIGHT_PX, 1275);
});

test('compositeLogoOnImageBuffer preserves logo aspect ratio on base image', async () => {
  const baseBuffer = await sharp({
    create: {
      width: 800,
      height: 800,
      channels: 3,
      background: { r: 240, g: 240, b: 240 },
    },
  })
    .jpeg()
    .toBuffer();

  const logoBuffer = await sharp({
    create: {
      width: 400,
      height: 200,
      channels: 4,
      background: { r: 20, g: 80, b: 200, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  const out = await compositeLogoOnImageBuffer(baseBuffer, logoBuffer, {
    maxWidthRatio: 0.2,
    padding: 20,
    position: 'top-left',
  });
  assert.ok(out && out.length > 0);

  const meta = await sharp(out).metadata();
  assert.equal(meta.width, 800);
  assert.equal(meta.height, 800);
});
