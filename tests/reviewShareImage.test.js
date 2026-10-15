const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'review-share-img-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const store = require('../services/networkStore');
const reviewShareImage = require('../services/reviewShareImage');

test('renderDefaultShareImage returns a baseline JPEG buffer', async () => {
  const img = await reviewShareImage.renderDefaultShareImage({
    companyName: 'Brightline Electric',
    brand: { accent: '#0d9488' },
  });
  assert.equal(img.contentType, 'image/jpeg');
  assert.ok(img.buffer.length > 1000);
  const meta = await sharp(img.buffer).metadata();
  assert.equal(meta.width, 1200);
  assert.equal(meta.height, 630);
  // iMessage Link Presentation often skips progressive JPEGs.
  assert.equal(meta.isProgressive, false);
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

test('getShareImageBuffer falls back to Home hero before the gradient', async () => {
  const network = await store.getOrCreateNetworkForWorkspace(`ws_share_hero_${Date.now()}`, { name: 'Hero Net' });
  const member = await store.saveMember(network.id, {
    companyName: 'Van Co',
    status: 'active',
    reviewSlug: 'van-co',
  });
  const heroSrc = await sharp({
    create: { width: 900, height: 500, channels: 3, background: { r: 20, g: 120, b: 200 } },
  }).jpeg().toBuffer();
  await store.saveMemberHero(network.id, member.id, { contentType: 'image/jpeg', buffer: heroSrc });

  const loaded = await reviewShareImage.getShareImageBuffer(network.id, member.id, 'default', {
    companyName: 'Van Co',
    brand: { accent: '#F26B1D' },
  });
  assert.equal(loaded.contentType, 'image/jpeg');
  const meta = await sharp(loaded.buffer).metadata();
  assert.equal(meta.width, 1200);
  assert.equal(meta.height, 630);
  // Hero is solid blue — gradient default would mix orange/dark; sample center pixel.
  const { data } = await sharp(loaded.buffer)
    .extract({ left: 600, top: 300, width: 1, height: 1 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.ok(data[2] > 150, 'expected blue-ish hero fallback, not orange gradient');
});

test('shareImageAbsoluteUrl includes cache-bust version', () => {
  const url = reviewShareImage.shareImageAbsoluteUrl('van-co', 'default', 'abc123');
  assert.match(url, /^https:\/\/leads\.adhello\.io\/rv\/van-co\/og\.jpg\?v=abc123$/);
  assert.match(
    reviewShareImage.shareImageVersion(
      { reviewShareImageUpdatedAt: '', heroUpdatedAt: '2026-10-11T00:00:00.000Z' },
      {},
    ),
    /^[a-f0-9]{12}$/,
  );
});

test('compressPublicPageLogo shrinks a large PNG to a small JPEG', async () => {
  const src = await sharp({
    create: { width: 512, height: 512, channels: 3, background: { r: 40, g: 120, b: 200 } },
  }).png().toBuffer();
  const out = await reviewShareImage.compressPublicPageLogo(src);
  assert.equal(out.contentType, 'image/jpeg');
  const meta = await sharp(out.buffer).metadata();
  assert.equal(meta.width, reviewShareImage.PUBLIC_PAGE_LOGO_PX);
  assert.equal(meta.height, reviewShareImage.PUBLIC_PAGE_LOGO_PX);
  assert.ok(out.buffer.length < 40_000);
});

test('getPublicPageLogoBuffer serves a compressed avatar', async () => {
  const network = await store.getOrCreateNetworkForWorkspace(`ws_pub_logo_${Date.now()}`, { name: 'Pub Logo Net' });
  const member = await store.saveMember(network.id, {
    companyName: 'Pub Co',
    status: 'active',
    reviewSlug: 'pub-co',
  });
  const src = await sharp({
    create: { width: 512, height: 512, channels: 3, background: '#224466' },
  }).png().toBuffer();
  await store.saveProfilePhoto(network.id, member.id, { contentType: 'image/png', buffer: src });
  const first = await reviewShareImage.getPublicPageLogoBuffer(network.id, member.id, 'avatar');
  const second = await reviewShareImage.getPublicPageLogoBuffer(network.id, member.id, 'avatar');
  assert.equal(first.contentType, 'image/jpeg');
  assert.equal(first.buffer.length, second.buffer.length);
  const meta = await sharp(first.buffer).metadata();
  assert.equal(meta.width, 192);
});

test('requestPageLogoUrl prefers Profile photo over request-page logo', () => {
  const member = {
    reviewSlug: 'zippy-blinds',
    profilePhotoUpdatedAt: '2026-10-11T12:00:00.000Z',
    reviewLogoUpdatedAt: '2026-10-10T12:00:00.000Z',
  };
  assert.match(
    reviewShareImage.requestPageLogoUrl(member, { logoUrl: '/m/brand/x/logo' }),
    /^\/rv\/zippy-blinds\/avatar\.png\?v=/,
  );
  assert.equal(
    reviewShareImage.requestPageLogoUrl(
      { reviewSlug: 'zippy-blinds', reviewLogoUpdatedAt: '2026-10-10T12:00:00.000Z' },
      { logoUrl: '/m/brand/x/logo' },
    ),
    reviewShareImage.reviewLogoPath('zippy-blinds', '2026-10-10T12:00:00.000Z'),
  );
  assert.equal(
    reviewShareImage.requestPageLogoUrl({ reviewSlug: 'zippy-blinds' }, { logoUrl: '/m/brand/x/logo' }),
    '/m/brand/x/logo',
  );
});
