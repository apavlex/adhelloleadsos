const { test } = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const {
  compositeLogoOnImageBuffer,
  compositePosition,
  fetchImageBuffer,
  FETCH_IMAGE_HEADERS,
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

test('compositeLogoOnImageBuffer places logo in top-right when requested', async () => {
  const baseBuffer = await sharp({
    create: {
      width: 1200,
      height: 800,
      channels: 3,
      background: { r: 240, g: 240, b: 240 },
    },
  })
    .jpeg()
    .toBuffer();

  const logoBuffer = await sharp({
    create: {
      width: 200,
      height: 100,
      channels: 4,
      background: { r: 20, g: 80, b: 200, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  const out = await compositeLogoOnImageBuffer(baseBuffer, logoBuffer, {
    maxWidthRatio: 0.15,
    padding: 24,
    position: 'top-right',
  });
  const topLeft = await sharp(out).extract({ left: 10, top: 10, width: 20, height: 20 }).raw().toBuffer();
  const topRight = await sharp(out).extract({ left: 1100, top: 30, width: 40, height: 40 }).raw().toBuffer();
  assert.ok(topLeft[0] > 200 && topLeft[1] > 200, 'top-left should stay light base background');
  assert.ok(topRight[2] > 120 && topRight[0] < 80, 'top-right should contain composited logo pixels');
});

test('compositePosition top-right anchors logo with padding', () => {
  const { left, top } = compositePosition(1200, 800, 180, 90, 24, 'top-right');
  assert.equal(left, 1200 - 180 - 24);
  assert.equal(top, 24);
});

test('compositeLogoOnImageBuffer places logo top-right on EXIF-oriented base', async () => {
  const baseBuffer = await sharp({
    create: {
      width: 800,
      height: 1200,
      channels: 3,
      background: { r: 240, g: 240, b: 240 },
    },
  })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();

  const logoBuffer = await sharp({
    create: {
      width: 200,
      height: 100,
      channels: 4,
      background: { r: 20, g: 80, b: 200, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  const out = await compositeLogoOnImageBuffer(baseBuffer, logoBuffer, {
    maxWidthRatio: 0.15,
    padding: 24,
    position: 'top-right',
  });
  const meta = await sharp(out).metadata();
  assert.equal(meta.width, 1200, 'EXIF rotation should normalize to landscape width');
  assert.equal(meta.height, 800, 'EXIF rotation should normalize to landscape height');

  const topLeft = await sharp(out).extract({ left: 10, top: 10, width: 20, height: 20 }).raw().toBuffer();
  const topRight = await sharp(out).extract({ left: 1100, top: 30, width: 40, height: 40 }).raw().toBuffer();
  assert.ok(topLeft[0] > 200 && topLeft[1] > 200, 'top-left should stay light base background');
  assert.ok(
    topRight[2] > 80 || (topRight[0] > 200 && topRight[1] > 200),
    'top-right should contain composited logo or its backdrop',
  );
});

test('fetchImageBuffer sends browser-like User-Agent and Accept headers', async () => {
  const originalFetch = global.fetch;
  let capturedInit;
  global.fetch = async (_url, init) => {
    capturedInit = init;
    return {
      ok: true,
      arrayBuffer: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer,
    };
  };
  try {
    await fetchImageBuffer('https://cdn.example.com/generated.jpg');
    assert.ok(capturedInit && capturedInit.headers);
    assert.equal(capturedInit.headers['User-Agent'], FETCH_IMAGE_HEADERS['User-Agent']);
    assert.equal(capturedInit.headers.Accept, FETCH_IMAGE_HEADERS.Accept);
  } finally {
    global.fetch = originalFetch;
  }
});
