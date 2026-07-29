const { test } = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { compositeLogoOnImageBuffer } = require('../services/marketingImageComposite');

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
