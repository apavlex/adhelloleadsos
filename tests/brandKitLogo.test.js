const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs').promises;
const path = require('path');
const {
  BRAND_KIT_LOGO_PATH,
  buildLogoWorkspacePatch,
  hasStoredLogo,
  isLegacyDiskLogoUrl,
  loadLogoBuffer,
  logoDisplayUrl,
  migrateLegacyLogoIfNeeded,
  normalizeStoredLogo,
} = require('../services/brandKitLogo');

test('logoDisplayUrl uses stable API path with cache buster', () => {
  const url = logoDisplayUrl('2026-07-29T12:00:00.000Z');
  assert.ok(url.startsWith(BRAND_KIT_LOGO_PATH));
  assert.ok(url.includes('?v='));
  assert.ok(url.includes('2026-07-29T12%3A00%3A00.000Z'));
});

test('buildLogoWorkspacePatch stores base64 and stable logoUrl', () => {
  const buffer = Buffer.from('fake-png-bytes');
  const { brandKitLogo, brandKitPatch } = buildLogoWorkspacePatch({}, {
    buffer,
    mimeType: 'image/png',
  });
  assert.equal(brandKitLogo.mimeType, 'image/png');
  assert.equal(Buffer.from(brandKitLogo.base64, 'base64').toString(), 'fake-png-bytes');
  assert.ok(brandKitPatch.logoUrl.startsWith(BRAND_KIT_LOGO_PATH));
  assert.ok(brandKitPatch.updatedAt);
});

test('loadLogoBuffer prefers workspace storage over legacy disk path', async () => {
  const buffer = Buffer.from('stored-logo');
  const { brandKitLogo } = buildLogoWorkspacePatch({}, { buffer, mimeType: 'image/png' });
  const ws = {
    brandKitLogo,
    brandKit: { logoUrl: '/uploads/brand-kit/old.png' },
  };
  const loaded = await loadLogoBuffer(ws);
  assert.equal(loaded.buffer.toString(), 'stored-logo');
  assert.equal(loaded.mimeType, 'image/png');
});

test('migrateLegacyLogoIfNeeded imports existing disk logo into workspace', async () => {
  const rel = '/uploads/brand-kit/test_legacy_logo.png';
  const absDir = path.join(process.cwd(), 'public', 'uploads', 'brand-kit');
  const absPath = path.join(absDir, 'test_legacy_logo.png');
  await fs.mkdir(absDir, { recursive: true });
  await fs.writeFile(absPath, Buffer.from('legacy-logo'));

  try {
    const ws = {
      brandKit: { logoUrl: rel, businessName: 'Acme' },
    };
    assert.ok(isLegacyDiskLogoUrl(rel));
    assert.equal(hasStoredLogo(ws), false);

    const migrated = await migrateLegacyLogoIfNeeded(ws);
    assert.ok(hasStoredLogo(migrated));
    assert.ok(migrated.brandKit.logoUrl.startsWith(BRAND_KIT_LOGO_PATH));
    assert.equal(normalizeStoredLogo(migrated.brandKitLogo).mimeType, 'image/png');

    const loaded = await loadLogoBuffer(migrated);
    assert.equal(loaded.buffer.toString(), 'legacy-logo');
  } finally {
    await fs.unlink(absPath).catch(() => {});
  }
});
