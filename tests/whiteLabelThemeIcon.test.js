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

test('logoNeedsAccentTile only for wide or tall marks', () => {
  assert.equal(networkBrand.logoNeedsAccentTile(512, 512), false);
  assert.equal(networkBrand.logoNeedsAccentTile(100, 100), false);
  assert.equal(networkBrand.logoNeedsAccentTile(120, 100), false); // 1.2 boundary still square-ish
  assert.equal(networkBrand.logoNeedsAccentTile(121, 100), true);
  assert.equal(networkBrand.logoNeedsAccentTile(100, 121), true);
  assert.equal(networkBrand.logoNeedsAccentTile(800, 200), true);
  assert.equal(networkBrand.logoNeedsAccentTile(0, 100), true);
});

test('renderIcon is edge-to-edge for square logos (no accent gutter)', async () => {
  const sharp = require('sharp');
  // Solid red square — corners of the icon must stay red, not the accent.
  const squareLogo = await sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 220, g: 40, b: 40 } },
  }).png().toBuffer();
  const png = await networkBrand.renderIcon({
    brand: { accent: '#0F4CAE', initials: 'TI' },
    logo: { buffer: squareLogo, contentType: 'image/png' },
    size: 64,
  });
  const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const r = data[0];
  const g = data[1];
  const b = data[2];
  assert.ok(r > 180 && g < 80 && b < 80, `expected red edge-to-edge corner, got rgb(${r},${g},${b})`);
});

test('renderIcon paints wide logos on the accent tile', async () => {
  const sharp = require('sharp');
  // Wide near-white bar — corners must be accent blue.
  const wideLogo = await sharp({
    create: { width: 120, height: 40, channels: 3, background: { r: 250, g: 250, b: 250 } },
  }).png().toBuffer();
  const png = await networkBrand.renderIcon({
    brand: { accent: '#0F4CAE', initials: 'TI' },
    logo: { buffer: wideLogo, contentType: 'image/png' },
    size: 64,
  });
  assert.ok(Buffer.isBuffer(png) && png.length > 80);
  const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
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
  assert.match(html, /logoNeedsAccentTile/);
  assert.match(html, /edge to edge/i);
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
  assert.match(maHead, /preferredThemeAt/);
  assert.match(maHead, /data-ma-workspace-theme/);
  assert.match(maHead, /ma-theme-pinned/);
  assert.match(maHead, /ma-theme-pinned-at/);
  // Must be unescaped <%- so JSON quotes are valid JS (<%= turns " into &#34; and forces light).
  assert.match(maHead, /workspacePref = <%- JSON\.stringify/);
  assert.match(maHead, /workspaceAt = <%- JSON\.stringify/);
  // White-label light/dark must win over a stale device localStorage value.
  assert.match(maHead, /workspacePref === 'light' \|\| workspacePref === 'dark'/);
  assert.match(maHead, /Number\(pinnedAt\) >= Number\(workspaceAt\)/);

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
  assert.match(ownerBrand, /preferredThemeAt/);

  const maJs = fs.readFileSync(path.join(root, 'public/js/member-app.js'), 'utf8');
  assert.match(maJs, /THEME_PIN_KEY/);
  assert.match(maJs, /THEME_PIN_AT_KEY/);
  assert.match(maJs, /workspaceThemePref/);
  assert.match(maJs, /themePinValid/);
  assert.match(maJs, /ma-theme-pinned/);

  const branding = fs.readFileSync(path.join(root, 'views/workspace/sections/branding.ejs'), 'utf8');
  assert.match(branding, /syncReviewAppThemeLocal/);
  assert.match(branding, /ma-theme-pinned-at/);
  // Theme is read from a data attribute — never inject EJS tags inside the <script> block.
  assert.match(branding, /id="wl-appearance"[^>]*data-wl-theme="<%= _wlTheme %>"/);
  assert.match(branding, /getAttribute\('data-wl-theme'\)/);
  assert.doesNotMatch(branding, /savedTheme = <%[-=]/);
  assert.match(branding, /Reloading to apply/);
  // Comments / script body must not contain raw EJS openers — EJS still parses them.
  const scriptMatch = branding.match(/<script>[\s\S]*?<\/script>/g) || [];
  for (const block of scriptMatch) {
    assert.doesNotMatch(block, /<%/, 'EJS delimiter inside <script> breaks White label render');
  }
});

test('preferredThemeAt is stored and exposed on the brand', () => {
  const brand = whiteLabel.brandForWorkspace({
    id: 'ws_theme',
    whiteLabel: { preferredTheme: 'dark', preferredThemeAt: '1792098000000' },
  });
  assert.equal(brand.preferredTheme, 'dark');
  assert.equal(brand.preferredThemeAt, '1792098000000');
});
