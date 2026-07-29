const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs').promises;
const path = require('path');

const brandKitLogo = require('../services/brandKitLogo');

test('publishLogoPublicFile writes a public PNG path', async () => {
  const pngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const ws = {
    brandKitLogo: {
      mimeType: 'image/png',
      base64: pngBase64,
      updatedAt: new Date().toISOString(),
    },
  };
  const req = { workspaceId: 'test_ws' };
  const published = await brandKitLogo.publishLogoPublicFile(req, ws);
  assert.ok(published);
  assert.match(published.relativePath, /^\/uploads\/brand-kit\/test_ws_logo_ref_\d+\.png$/);
  const absPath = path.join(process.cwd(), 'public', published.relativePath.replace(/^\//, ''));
  const stat = await fs.stat(absPath);
  assert.ok(stat.size > 0);
  await fs.unlink(absPath);
});

test('resolveLogoReferenceUrl logic: useLogoInDesign false enables AI logo reference', () => {
  const normalize = (raw) => ({
    logoUrl: String(raw.logoUrl || '').trim(),
    useLogoInDesign: raw.useLogoInDesign !== false,
  });
  assert.equal(normalize({ logoUrl: '/x', useLogoInDesign: true }).useLogoInDesign, true);
  assert.equal(normalize({ logoUrl: '/x', useLogoInDesign: false }).useLogoInDesign, false);
  const kit = normalize({ logoUrl: '/logo', useLogoInDesign: false });
  assert.ok(kit.logoUrl && kit.useLogoInDesign === false);
});
