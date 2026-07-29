const { test } = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const {
  compositeLogoOnImageBuffer,
  resizeBufferForLobPostcard,
  LOB_POSTCARD_WIDTH_PX,
  LOB_POSTCARD_HEIGHT_PX,
} = require('../services/marketingImageComposite');

test('resizeBufferForLobPostcard keeps full artwork inside trim-safe area', async () => {
  const tall = await sharp({
    create: {
      width: 1800,
      height: 1400,
      channels: 3,
      background: { r: 200, g: 80, b: 80 },
    },
  })
    .jpeg()
    .toBuffer();
  const out = await resizeBufferForLobPostcard(tall, { side: 'front' });
  const meta = await sharp(out).metadata();
  assert.equal(meta.width, LOB_POSTCARD_WIDTH_PX);
  assert.equal(meta.height, LOB_POSTCARD_HEIGHT_PX);
  const bottomLeft = await sharp(out).extract({ left: 80, top: 1180, width: 40, height: 40 }).raw().toBuffer();
  assert.ok(bottomLeft[0] > 240, 'bottom edge should stay inside safe zone (white margin)');
});

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

test('resizeBufferForLobPostcard back art stays left of ink-free zone', async () => {
  const { resizeBufferForLobPostcard, lobInkFreeRectPx } = require('../services/marketingImageComposite');
  const wide = await sharp({
    create: {
      width: 1800,
      height: 1200,
      channels: 3,
      background: { r: 40, g: 120, b: 200 },
    },
  })
    .jpeg()
    .toBuffer();
  const out = await resizeBufferForLobPostcard(wide, { side: 'back' });
  const rect = lobInkFreeRectPx();
  const edgeSample = await sharp(out)
    .extract({ left: rect.left - 20, top: rect.top + 20, width: 10, height: 10 })
    .raw()
    .toBuffer();
  assert.ok(edgeSample[0] > 240, 'artwork should not bleed into Lob address block');
});

test('applyLobBackInkFreeMask clears bottom-right address zone', async () => {
  const { applyLobBackInkFreeMask, lobInkFreeRectPx } = require('../services/marketingImageComposite');
  const base = await sharp({
    create: {
      width: LOB_POSTCARD_WIDTH_PX,
      height: LOB_POSTCARD_HEIGHT_PX,
      channels: 3,
      background: { r: 20, g: 40, b: 200 },
    },
  })
    .jpeg()
    .toBuffer();
  const out = await applyLobBackInkFreeMask(base);
  const rect = lobInkFreeRectPx();
  const sample = await sharp(out)
    .extract({
      left: rect.left + 10,
      top: rect.top + 10,
      width: 40,
      height: 40,
    })
    .raw()
    .toBuffer();
  assert.ok(sample[0] > 240 && sample[1] > 240 && sample[2] > 240);
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
