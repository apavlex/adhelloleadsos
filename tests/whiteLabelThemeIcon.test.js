/**
 * White-label: preferred light/dark theme for client onboarding,
 * and Home Screen icons that keep light logos visible on the accent tile.
 */
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const whiteLabel = require('../services/whiteLabel');
const networkBrand = require('../services/networkBrand');

test('preferredTheme cleans to light, dark, or system', () => {
  assert.equal(whiteLabel.cleanPreferredTheme('dark'), 'dark');
  assert.equal(whiteLabel.cleanPreferredTheme('LIGHT'), 'light');
  assert.equal(whiteLabel.cleanPreferredTheme('system'), 'system');
  assert.equal(whiteLabel.cleanPreferredTheme('nope'), 'system');
  assert.equal(whiteLabel.settings({ whiteLabel: { preferredTheme: 'dark' } }).preferredTheme, 'dark');
});

test('brandForWorkspace exposes preferredTheme and accent-busted icon URLs', () => {
  const brand = whiteLabel.brandForWorkspace({
    id: 'ws_demo',
    accentColor: '#0F4CAE',
    whiteLabel: { appName: 'Truckers Ins', logoVersion: '123', preferredTheme: 'light' },
  });
  assert.equal(brand.preferredTheme, 'light');
  assert.match(brand.iconUrl(512), /\/brand\/ws\/ws_demo\/icon-512\.png\?v=/);
  assert.match(brand.iconUrl(512), /0[fF]4[cC][aA][eE]/);
});

test('renderIcon paints logos on the accent tile (not flat white)', async () => {
  // 1×1 near-white PNG so a white tile would hide it; accent blue must remain in the output.
  const whiteLogo = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
    'base64',
  );
  const png = await networkBrand.renderIcon({
    brand: { accent: '#0F4CAE', initials: 'TI' },
    logo: { buffer: whiteLogo, contentType: 'image/png' },
    size: 64,
  });
  assert.ok(Buffer.isBuffer(png) && png.length > 80);
  // Sharp PNG of solid #0F4CAE includes those RGB bytes in the IDAT stream often compressed —
  // assert via a re-sample average color instead.
  const sharp = require('sharp');
  const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // Corner pixel should be accent blue, not white.
  const r = data[0];
  const g = data[1];
  const b = data[2];
  assert.ok(b > r && b > g, `expected blue accent corner, got rgb(${r},${g},${b})`);
  assert.ok(r < 80 && g < 120, `expected dark-blue accent, got rgb(${r},${g},${b})`);
});

test('white-label settings UI has appearance + dual phone previews', () => {
  const html = fs.readFileSync(path.join(root, 'views/workspace/sections/branding.ejs'), 'utf8');
  assert.match(html, /Default appearance/);
  assert.match(html, /wlPreferredTheme/);
  assert.match(html, /data-wl-phone="light"/);
  assert.match(html, /data-wl-phone="dark"/);
  assert.match(html, /data-wl-icon-tile/);
  assert.match(html, /preferredTheme/);

  const head = fs.readFileSync(path.join(root, 'views/partials/head.ejs'), 'utf8');
  assert.match(head, /preferredTheme/);
  assert.match(head, /wsPref/);

  const route = fs.readFileSync(path.join(root, 'routes/workspace.js'), 'utf8');
  assert.match(route, /preferredTheme/);
  assert.match(route, /cleanPreferredTheme/);
});

test('sidebar and mobile chrome use accent iconUrl when a logo is set', () => {
  const sidebar = fs.readFileSync(path.join(root, 'views/partials/app_sidebar.ejs'), 'utf8');
  assert.match(sidebar, /hasLogo \? _sbWl\.iconUrl\(192\) : _sbWl\.logoUrl/);
  assert.doesNotMatch(sidebar, /hasLogo \? ' bg-white'/);
  assert.match(sidebar, /object-cover/);

  const nav = fs.readFileSync(path.join(root, 'views/partials/navbar.ejs'), 'utf8');
  assert.match(nav, /hasLogo \? _navWl\.iconUrl\(192\) : _navWl\.logoUrl/);
  assert.match(nav, /object-cover/);
});
