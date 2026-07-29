const { test } = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const {
  compositeLogoOnImageBuffer,
  resizeBufferForLobPostcard,
  LOB_POSTCARD_WIDTH_PX,
  LOB_POSTCARD_HEIGHT_PX,
} = require('../services/marketingImageComposite');

test('resizeBufferForLobPostcard fills full Lob bleed dimensions', async () => {
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
  const center = await sharp(out).extract({ left: 900, top: 600, width: 40, height: 40 }).raw().toBuffer();
  assert.ok(center[0] > 100, 'full-bleed resize should fill the canvas with artwork');
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

test('resizeBufferForLobPostcard back is full bleed with white address mask only', async () => {
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
  const meta = await sharp(out).metadata();
  assert.equal(meta.width, LOB_POSTCARD_WIDTH_PX);
  assert.equal(meta.height, LOB_POSTCARD_HEIGHT_PX);
  const rect = lobInkFreeRectPx();
  const leftSample = await sharp(out).extract({ left: 120, top: 600, width: 40, height: 40 }).raw().toBuffer();
  assert.ok(leftSample[2] > 100, 'left side should remain full-bleed artwork');
  const addressSample = await sharp(out)
    .extract({ left: rect.left + 20, top: rect.top + 20, width: 40, height: 40 })
    .raw()
    .toBuffer();
  assert.ok(addressSample[0] > 240, 'address zone is cleared for Lob printing');
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
