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
  assert.match(html, /name="hero"/);
  assert.match(html, /Home banner/);
  assert.match(html, /Text the Review app link/);
  assert.match(html, /data-get-app-share-url/);
  assert.match(html, /Copy \/ share for SMS/);
  // QR must render inline (data URL) so a broken /qr.png fetch never blanks the slot.
  assert.match(html, /reviewAppQrDataUrl/);
  assert.match(html, /_wlQrSrc/);
  assert.match(html, /onerror=.*\/get-app\/qr\.png/);

  const head = fs.readFileSync(path.join(root, 'views/partials/head.ejs'), 'utf8');
  assert.match(head, /preferredTheme/);
  assert.match(head, /wsPref/);

  const route = fs.readFileSync(path.join(root, 'routes/workspace.js'), 'utf8');
  assert.match(route, /preferredTheme/);
  assert.match(route, /cleanPreferredTheme/);
  assert.match(route, /name: 'hero'/);
  assert.match(route, /ensureOwnerReferralApp/);
  assert.match(route, /syncWhiteLabelToNetworkBrand/);
  assert.match(route, /reviewAppQrPng/);
  assert.match(route, /reviewAppQrDataUrl/);
  assert.match(route, /\/white-label\/qr\.png/);
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

test('Review app seeds preferredTheme and uses accent icon on Home badge', () => {
  const maHead = fs.readFileSync(path.join(root, 'views/member_app/_head.ejs'), 'utf8');
  assert.match(maHead, /workspacePref/);
  assert.match(maHead, /brand\.preferredTheme/);
  assert.match(maHead, /data-ma-workspace-theme/);
  assert.match(maHead, /ma-theme-pinned/);
  // White-label light/dark must win over a stale device localStorage value.
  assert.match(maHead, /workspacePref === 'light' \|\| workspacePref === 'dark'/);

  const home = fs.readFileSync(path.join(root, 'views/member_app/home.ejs'), 'utf8');
  assert.match(home, /icon-192\.png/);
  assert.match(home, /ma-hero__badge/);

  const top = fs.readFileSync(path.join(root, 'views/member_app/_top.ejs'), 'utf8');
  assert.match(top, /ma-top__logo/);
  assert.match(top, /icon-192\.png/);
  assert.doesNotMatch(top, /ma-top__logo" src="<%= brand\.logoUrl %>"/);

  const css = fs.readFileSync(path.join(root, 'public/css/member-app.css'), 'utf8');
  assert.match(css, /\.ma-hero__badge img[\s\S]*background:\s*var\(--acc\)/);
  assert.match(css, /\.ma-top__logo[\s\S]*background:\s*var\(--acc\)/);

  const ownerBrand = fs.readFileSync(path.join(root, 'services/ownerAppBrand.js'), 'utf8');
  assert.match(ownerBrand, /preferredTheme:\s*wl\.preferredTheme/);

  const maJs = fs.readFileSync(path.join(root, 'public/js/member-app.js'), 'utf8');
  assert.match(maJs, /THEME_PIN_KEY/);
  assert.match(maJs, /workspaceThemePref/);
  assert.match(maJs, /ma-theme-pinned/);
});
