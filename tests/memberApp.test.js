const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'member-app-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const dbService = require('../services/database');
const store = require('../services/networkStore');
const networkBrand = require('../services/networkBrand');
const reviewPage = require('../services/reviewPage');
const networkMembers = require('../services/networkMembers');
const { createMemberPortalToken } = require('../services/networkLinkSign');
const memberApp = require('../routes/memberApp');
const reviewPublic = require('../routes/reviewPublic');

let wsCounter = 0;

async function setupNetwork() {
  wsCounter += 1;
  const network = await store.getOrCreateNetworkForWorkspace(`ws_member_app_${wsCounter}`, { name: 'Test network' });
  const zone = await store.saveZone(network.id, { name: 'Camas', cities: ['Camas'], zips: ['98607'] });
  return { network, zone };
}

async function addMember(network, zone, { title, trade, phone }) {
  const saved = await dbService.saveLeadWithMeta({ workspaceId: network.ownerWorkspaceId, title, phone: phone || 'N/A', city: 'Camas', placeId: 'ChIJabcdefghijk123' });
  const { member } = await require('../services/networkReferrals').saveMemberWithSeats(network, {
    leadKey: saved.key,
    companyName: title,
    contactName: 'Pat Smith',
    phone: '',
    status: 'active',
  }, { trades: [trade], zoneIds: [zone.id] });
  return member;
}

function startApp() {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use('/', memberApp);
  app.use('/', reviewPublic);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

test('brand normalization keeps safe values and readable accent text', () => {
  const brand = networkBrand.normalizeBrand({
    accent: 'not-a-color',
    logoUrl: 'javascript:alert(1)',
    heroUrl: '//evil.example/x.png',
    statValue: '846,429',
    appName: '  Discount   Home Services ',
  });
  assert.equal(brand.accent, networkBrand.DEFAULT_ACCENT);
  assert.equal(brand.logoUrl, '');
  assert.equal(brand.heroUrl, '');
  assert.equal(brand.statValue, 846429);
  assert.equal(brand.appName, 'Discount Home Services');
  assert.equal(networkBrand.normalizeImageUrl('/m/brand/abc/logo?v=1'), '/m/brand/abc/logo?v=1');
  assert.equal(networkBrand.onAccentColor('#FFDB3A'), '#0f172a');
  assert.equal(networkBrand.onAccentColor('#1d4ed8'), '#ffffff');
  const view = networkBrand.brandView({ name: 'Acme network', brand: { statValue: 1200 } });
  assert.equal(view.appName, 'Acme network');
  assert.equal(view.statValueLabel, '1,200');
  const defaults = networkBrand.brandView({});
  assert.equal(defaults.appName, 'Partner network');
  assert.match(defaults.tagline, /review/i);
  assert.match(defaults.subtitle, /Reviews/);
});

test('review gate always keeps public review links visible', () => {
  for (const rating of [1, 2, 3]) {
    const gate = reviewPage.reviewGate(rating);
    assert.equal(gate.stage, 'unhappy');
    assert.equal(gate.feedbackFirst, true);
    assert.equal(gate.showPublicLinks, true);
  }
  for (const rating of [4, 5]) {
    const gate = reviewPage.reviewGate(rating);
    assert.equal(gate.stage, 'happy');
    assert.equal(gate.publicProminent, true);
  }
  assert.equal(reviewPage.reviewGate('x').stage, 'ask');
});

test('review click-throughs only go to links the member saved', () => {
  const links = store.normalizeReviewLinks({
    google: 'https://g.page/r/abc/review',
    yelp: 'javascript:alert(1)',
    other: [{ label: 'Porch', url: 'porch.com/pro/acme' }],
  });
  assert.equal(links.yelp, '');
  assert.equal(reviewPage.destinationFor(links, 'google'), 'https://g.page/r/abc/review');
  assert.equal(reviewPage.destinationFor(links, 'yelp'), '');
  assert.equal(reviewPage.destinationFor(links, 'evil'), '');
  assert.equal(reviewPage.destinationFor(links, 'other', 0), 'https://porch.com/pro/acme');
  const dests = reviewPage.reviewDestinations(links, 'acme');
  assert.deepEqual(dests.map((d) => d.href), ['/rv/acme/go/google', '/rv/acme/go/other/0']);
});

test('built-in review sites, legacy custom rows and the custom-link cap', () => {
  const links = store.normalizeReviewLinks({
    thumbtack: 'thumbtack.com/wa/camas/flooring/acme/service/123',
    bbb: 'not a url',
    other: [
      { label: 'angi', url: 'https://angi.com/companylist/us/wa/acme.htm' },
      { label: 'Thumbtack', url: 'https://thumbtack.com/dupe' },
      ...Array.from({ length: 12 }, (_, i) => ({ label: `Site ${i}`, url: `https://site${i}.example` })),
    ],
  });
  assert.equal(links.thumbtack, 'https://thumbtack.com/wa/camas/flooring/acme/service/123');
  assert.equal(links.angi, 'https://angi.com/companylist/us/wa/acme.htm');
  assert.equal(links.bbb, '');
  assert.equal(links.other.length, reviewPage.MAX_OTHER_LINKS);
  assert.equal(links.other[0].label, 'Thumbtack');
  assert.equal(reviewPage.countLinks(links), 2 + reviewPage.MAX_OTHER_LINKS);
  assert.equal(reviewPage.otherFormRows(links).length, reviewPage.MAX_OTHER_LINKS);
  assert.equal(reviewPage.otherFormRows({ other: [] }).length, 2);

  const dests = reviewPage.reviewDestinations(links, 'acme');
  assert.deepEqual(dests.slice(0, 2).map((d) => d.label), ['Thumbtack', 'Angi']);
  assert.equal(reviewPage.destinationFor(links, 'thumbtack'), links.thumbtack);

  const body = { yelp: 'nope', thumbtack: 'https://thumbtack.com/x', otherLabel: ['Porch', ''], otherUrl: ['porch.com/pro/acme', ''] };
  const cleaned = store.normalizeReviewLinks(reviewPage.linksFromForm(body));
  assert.equal(reviewPage.firstRejectedLink(body, cleaned), 'Yelp');
  assert.deepEqual(cleaned.other, [{ label: 'Porch', url: 'https://porch.com/pro/acme' }]);
});

test('google review link is built from a Maps place id', () => {
  assert.equal(
    memberApp.googleReviewUrlFromLead({ placeId: 'ChIJabcdefghijk123' }),
    'https://search.google.com/local/writereview?placeid=ChIJabcdefghijk123',
  );
  assert.equal(memberApp.googleReviewUrlFromLead({ placeId: 'bad id!' }), '');
  assert.equal(memberApp.googleReviewUrlFromLead(null), '');
});

test('review slugs are unique across members with the same name', async () => {
  const { network, zone } = await setupNetwork();
  const a = await addMember(network, zone, { title: 'Bright Plumbing', trade: 'plumbing' });
  const b = await addMember(network, zone, { title: 'Bright Plumbing LLC', trade: 'hvac' });
  const first = await store.ensureReviewSlug(network.id, a, 'bright-plumbing');
  const second = await store.ensureReviewSlug(network.id, b, 'bright-plumbing');
  assert.equal(first.reviewSlug, 'bright-plumbing');
  assert.equal(second.reviewSlug, 'bright-plumbing-2');
  const resolved = await store.resolveReviewSlug('bright-plumbing-2');
  assert.equal(resolved.memberId, b.id);
});

test('approving an application adds the member and records the GHL sub-account', async () => {
  const { network, zone } = await setupNetwork();
  await dbService.saveWorkspace(network.ownerWorkspaceId, { name: 'AdHello Agency', slug: 'adhello-agency', salesScriptsPresetKey: 'agency' });
  const application = await store.saveApplication(network.id, {
    companyName: 'Summit Roofing',
    contactName: 'Dana',
    email: 'dana@summit.example',
    tradeSlug: 'roofing',
    city: 'Camas',
  });
  let provisioned = null;
  const result = await networkMembers.approveApplication({
    network,
    applicationId: application.id,
    zoneIds: [zone.id],
    baseUrl: 'http://localhost',
    provision: async (net, member) => {
      provisioned = member;
      const saved = await store.saveMember(net.id, { ...member, ghlLocationId: 'loc_123', ghlSubaccountUrl: 'https://app.example/loc_123' });
      return { ok: true, created: true, locationId: 'loc_123', member: saved };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(provisioned.companyName, 'Summit Roofing');
  assert.equal(result.member.ghlLocationId, 'loc_123');
  assert.deepEqual(result.member.trades, ['roofing']);
  const lead = await dbService.getLead(result.member.leadKey, network.ownerWorkspaceId);
  assert.equal(lead.title, 'Summit Roofing');
  const after = await store.getApplication(network.id, application.id);
  assert.equal(after.status, 'approved');
  assert.equal(after.memberId, result.member.id);
  const again = await networkMembers.approveApplication({ network, applicationId: application.id, baseUrl: '' });
  assert.equal(again.ok, false);
});

test('non-agency workspaces like Flooring never create GHL sub-accounts on approval', async () => {
  const { network, zone } = await setupNetwork();
  await dbService.saveWorkspace(network.ownerWorkspaceId, { name: 'AdHello Flooring', slug: 'adhello-flooring' });
  assert.equal(await networkMembers.ghlSubaccountsAllowed(network), false);
  const application = await store.saveApplication(network.id, { companyName: 'Rose City Tile', tradeSlug: 'roofing', city: 'Camas' });
  let provisioned = false;
  const result = await networkMembers.approveApplication({
    network,
    applicationId: application.id,
    zoneIds: [zone.id],
    baseUrl: 'http://localhost',
    provision: async () => { provisioned = true; return { ok: true }; },
  });
  assert.equal(result.ok, true);
  assert.equal(provisioned, false);
  assert.equal(result.ghl, null);
});

test('a failed GHL sub-account is recorded on the member without throwing', async () => {
  const { network, zone } = await setupNetwork();
  const member = await addMember(network, zone, { title: 'Clearview Windows', trade: 'windows' });
  const failed = await networkMembers.provisionGhlSubaccount(network, member, {
    createForLead: async () => ({ ok: false, error: 'GHL API key is not configured.' }),
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.member.ghlError, 'GHL API key is not configured.');
  const ok = await networkMembers.provisionGhlSubaccount(network, failed.member, {
    createForLead: async () => ({ ok: true, created: true, locationId: 'loc_9', url: 'https://app.example/loc_9' }),
  });
  assert.equal(ok.member.ghlLocationId, 'loc_9');
  assert.equal(ok.member.ghlError, '');
  assert.match(networkMembers.ghlNotice(ok), /created/);
});

test('member app pages, manifest, send, enroll and the review page work end to end', async () => {
  const { network, zone } = await setupNetwork();
  await store.saveNetwork({ ...network, brand: { appName: 'Discount Home Services', accent: '#f26b1d', statValue: 846429, statLabel: 'Homes serviced' } });
  const sender = await addMember(network, zone, { title: 'Camas Flooring', trade: 'flooring' });
  const receiver = await addMember(network, zone, { title: 'Camas Electric', trade: 'electrical' });
  const token = createMemberPortalToken({ networkId: network.id, memberId: sender.id });
  const { server, base } = await startApp();
  try {
    const bad = await fetch(`${base}/m/not-a-token`);
    assert.equal(bad.status, 404);

    const home = await fetch(`${base}/m/${token}`);
    assert.equal(home.status, 200);
    const homeHtml = await home.text();
    assert.match(homeHtml, /Discount Home Services/);
    assert.match(homeHtml, /846,429/);
    assert.match(homeHtml, /Hi, Pat/);
    assert.match(homeHtml, /manifest\.webmanifest/);
    // One Request review button in dash actions — not a second full-width duplicate.
    const requestReviewButtons = homeHtml.match(/>\s*Request a? ?review\s*</gi) || [];
    assert.equal(requestReviewButtons.length, 1);
    assert.match(homeHtml, /ma-hero__upload/);
    assert.match(homeHtml, /brand\/hero/);
    assert.match(homeHtml, /Upload banner image/);
    // Install-as-app modal + top-bar open control (works from workspace PWA too).
    assert.match(homeHtml, /id="maInstall"/);
    assert.match(homeHtml, /ma-install-modal/);
    assert.match(homeHtml, /data-ma-install-open/);
    assert.match(homeHtml, /data-ma-install-panel="workspace"/);
    assert.match(homeHtml, /data-ma-install-copy/);
    assert.match(homeHtml, /Save as a phone app/);
    assert.match(homeHtml, /class="ma-tabbar"/);
    assert.match(homeHtml, /member-app\.css/);

    const manifest = await (await fetch(`${base}/m/${token}/manifest.webmanifest`)).json();
    assert.equal(manifest.name, 'Discount Home Services');
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.start_url, `/m/${token}?source=pwa`);

    const icon = await fetch(`${base}/m/${token}/icon-192.png`);
    assert.equal(icon.headers.get('content-type'), 'image/png');

    const sent = await fetch(`${base}/m/${token}/send`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ tradeSlug: 'electrical', name: 'Jamie Lee', phone: '3605550100', zip: '98607', consent: 'on' }),
    });
    assert.equal(sent.status, 303);
    const referrals = await store.listReferrals(network.id);
    const ref = referrals.find((r) => r.fromMemberId === sender.id);
    assert.equal(ref.toMemberId, receiver.id);
    assert.equal(ref.status, 'sent');

    const own = await fetch(`${base}/m/${token}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ tradeSlug: 'flooring', name: 'X', phone: '1', consent: 'on' }),
    });
    assert.equal(own.status, 400);

    const receiverToken = createMemberPortalToken({ networkId: network.id, memberId: receiver.id });
    const accept = await fetch(`${base}/m/${receiverToken}/referrals/${ref.id}`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ action: 'accept' }),
    });
    assert.equal(accept.status, 303);
    assert.equal((await store.getReferral(network.id, ref.id)).status, 'accepted');

    const stolen = await fetch(`${base}/m/${token}/referrals/${ref.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ action: 'book' }),
    });
    assert.equal(stolen.status, 400);

    const enroll = await fetch(`${base}/m/${token}/enroll`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ companyName: 'Evergreen Landscaping', phone: '3605550199', tradeSlug: 'landscaping', city: 'Camas' }),
    });
    assert.equal(enroll.status, 303);
    const apps = await store.listApplications(network.id);
    assert.ok(apps.some((a) => a.companyName === 'Evergreen Landscaping' && a.invitedByMemberId === sender.id && a.status === 'pending'));

    const reviewTab = await fetch(`${base}/m/${token}/review`);
    assert.equal(reviewTab.status, 200);
    const withSlug = await store.getMember(network.id, sender.id);
    assert.equal(withSlug.reviewSlug, 'camas-flooring');
    assert.match(withSlug.reviewLinks.google, /writereview\?placeid=ChIJabcdefghijk123/);
    const reviewHtml = await reviewTab.text();
    assert.match(reviewHtml, /review\/send/);
    assert.match(reviewHtml, /Send review request/);
    assert.match(reviewHtml, /Go High Level/);
    assert.match(reviewHtml, /\{\{review_link\}\}/);
    assert.match(reviewHtml, /SMS script/);
    assert.match(reviewHtml, /Use AI/);
    assert.match(reviewHtml, /Copy for GHL/);
    assert.match(reviewHtml, /https:\/\/leads\.adhello\.io\/rv\/camas-flooring/);
    assert.match(reviewHtml, /AdHello\.io/);
    assert.match(reviewHtml, /Share from this phone/);
    assert.match(reviewHtml, /ma-qr/);
    assert.match(reviewHtml, /review\/settings/);
    assert.match(reviewHtml, /aria-label="Review settings"/);
    assert.match(reviewHtml, /Show your QR/);
    assert.match(reviewHtml, /review\/preview/);
    assert.ok(!/target="_blank"[^>]*>Preview/.test(reviewHtml));

    const previewTab = await fetch(`${base}/m/${token}/review/preview`);
    assert.equal(previewTab.status, 200);
    const previewHtml = await previewTab.text();
    assert.match(previewHtml, /rv-preview-bar/);
    assert.match(previewHtml, /Back to Review/);
    assert.match(previewHtml, /How was your experience/);
    assert.match(previewHtml, /review\/preview\?r=5/);
    assert.match(previewHtml, /review\/preview/);
    assert.match(reviewHtml, /ma-fold/);
    assert.match(reviewHtml, /shareImage/);
    assert.match(reviewHtml, /<details class="ma-fold"/);
    // QR / share is pinned at the top — before the send-request fold.
    assert.ok(reviewHtml.indexOf('ma-qr') < reviewHtml.indexOf('id="maAskForm"'));
    assert.ok(!/Your review links/.test(reviewHtml));
    assert.ok(!/Link preview image/.test(reviewHtml));

    const settingsTab = await fetch(`${base}/m/${token}/review/settings`);
    assert.equal(settingsTab.status, 200);
    const settingsHtml = await settingsTab.text();
    assert.match(settingsHtml, /Your review links/);
    assert.match(settingsHtml, /Thumbtack profile/);
    assert.match(settingsHtml, /Default preview image/);
    assert.match(settingsHtml, /Request page logo/);
    assert.match(settingsHtml, /review\/logo/);
    assert.match(settingsHtml, /\/rv\/camas-flooring\/og\.jpg/);
    assert.match(settingsHtml, /name="next" value="settings"/);

    const ogPage = await fetch(`${base}/rv/camas-flooring`);
    assert.equal(ogPage.status, 200);
    const ogHtml = await ogPage.text();
    assert.match(ogHtml, /property="og:image"/);
    assert.match(ogHtml, /\/rv\/camas-flooring\/og\.jpg/);
    assert.match(ogHtml, /og:site_name" content="AdHello\.io"/);
    assert.match(ogHtml, /rv-initials/);
    assert.ok(!/\/rv\/camas-flooring\/logo\.png/.test(ogHtml));

    // Tiny 1×1 PNG for logo upload
    const tinyPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const logoBoundary = '----maLogoBoundary7MA4YWxk';
    const logoBody = Buffer.concat([
      Buffer.from(
        `--${logoBoundary}\r\n`
        + 'Content-Disposition: form-data; name="logo"; filename="logo.png"\r\n'
        + 'Content-Type: image/png\r\n\r\n',
      ),
      tinyPng,
      Buffer.from(`\r\n--${logoBoundary}--\r\n`),
    ]);
    const logoUpload = await fetch(`${base}/m/${token}/review/logo`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': `multipart/form-data; boundary=${logoBoundary}` },
      body: logoBody,
    });
    assert.equal(logoUpload.status, 303);
    assert.match(logoUpload.headers.get('location') || '', /review\/settings\?ok=logo_saved/);
    const withLogo = await store.getMember(network.id, sender.id);
    assert.ok(withLogo.reviewLogoUpdatedAt);

    const logoImg = await fetch(`${base}/rv/camas-flooring/logo.png`);
    assert.equal(logoImg.status, 200);
    assert.match(logoImg.headers.get('content-type') || '', /image\/png/);

    const brandedPage = await (await fetch(`${base}/rv/camas-flooring`)).text();
    assert.match(brandedPage, /\/rv\/camas-flooring\/logo\.png/);
    assert.ok(!/rv-initials/.test(brandedPage));

    const ogImg = await fetch(`${base}/rv/camas-flooring/og.jpg`);
    assert.equal(ogImg.status, 200);
    assert.match(ogImg.headers.get('content-type') || '', /image\/jpeg/);
    const ogBuf = Buffer.from(await ogImg.arrayBuffer());
    assert.ok(ogBuf.length > 1000);

    const reviewSend = await fetch(`${base}/m/${token}/review/send`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ phone: '3605550199', name: 'Jamie', channel: 'sms' }),
    });
    assert.equal(reviewSend.status, 400);
    assert.match(await reviewSend.text(), /Go High Level|Integrations|SMS from number/i);

    const savedLinks = await fetch(`${base}/m/${token}/review`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams([
        ['google', withSlug.reviewLinks.google],
        ['thumbtack', 'https://thumbtack.com/wa/camas/camas-flooring/service/1'],
        ['otherLabel', 'Porch'], ['otherUrl', 'https://porch.com/pro/camas-flooring'],
        ['otherLabel', ''], ['otherUrl', ''],
      ]),
    });
    assert.equal(savedLinks.status, 303);
    const afterSave = await store.getMember(network.id, sender.id);
    assert.equal(afterSave.reviewLinks.thumbtack, 'https://thumbtack.com/wa/camas/camas-flooring/service/1');
    assert.deepEqual(afterSave.reviewLinks.other, [{ label: 'Porch', url: 'https://porch.com/pro/camas-flooring' }]);

    const unhappy = await (await fetch(`${base}/rv/camas-flooring?r=2`)).text();
    assert.match(unhappy, /What went wrong\?/);
    assert.match(unhappy, /\/rv\/camas-flooring\/go\/google/);

    const happy = await (await fetch(`${base}/rv/camas-flooring?r=5`)).text();
    assert.match(happy, /Review us on Google/);
    assert.match(happy, /Review us on Thumbtack/);
    assert.match(happy, /Review us on Porch/);

    const go = await fetch(`${base}/rv/camas-flooring/go/google`, { redirect: 'manual' });
    assert.equal(go.status, 302);
    assert.match(go.headers.get('location'), /search\.google\.com/);

    const fb = await fetch(`${base}/rv/camas-flooring/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ rating: '2', name: 'Sam', message: 'Showed up late' }),
    });
    assert.equal(fb.status, 200);
    assert.match(await fb.text(), /went straight to the owner/);
    const feedback = await store.listFeedback(network.id, sender.id);
    assert.equal(feedback[0].message, 'Showed up late');
    const stats = await store.getReviewStats(network.id, sender.id);
    assert.equal(stats.stars[2], 1);
    assert.equal(stats.stars[5], 1);
    assert.equal(stats.clicks.google, 1);

    const qr = await fetch(`${base}/rv/camas-flooring/qr.png?download=1`);
    assert.equal(qr.headers.get('content-type'), 'image/png');
    assert.match(qr.headers.get('content-disposition'), /camas-flooring-review-qr\.png/);

    const legacy = await fetch(`${base}/rv/nope`);
    assert.equal(legacy.status, 404);
  } finally {
    server.close();
  }
});
