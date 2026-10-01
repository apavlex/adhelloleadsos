/**
 * Member referral app (installable PWA), white-labeled per network. No login:
 * the signed member token lives in the path so a Home Screen bookmark keeps working.
 *
 *   /m/:token            Home
 *   /m/:token/referrals  received + sent referrals, accept / booked / won / lost
 *   /m/:token/send       send a referral to another member
 *   /m/:token/enroll     invite a business to join (operator approves)
 *   /m/:token/review     review link-in-bio page settings + QR
 *   /m/login             text me a new link
 */

const express = require('express');
const dbService = require('../services/database');
const store = require('../services/networkStore');
const ex = require('../services/referralExchange');
const trades = require('../services/networkTrades');
const notify = require('../services/networkNotify');
const networkReferrals = require('../services/networkReferrals');
const networkBrand = require('../services/networkBrand');
const { verifyNetworkToken } = require('../services/networkLinkSign');
const { ICONS } = require('../services/memberAppIcons');

const router = express.Router();
const form = express.urlencoded({ extended: true, limit: '64kb' });

const OK_MESSAGES = {
  sent: 'Referral sent. They were notified.',
  matched: 'Referral received. The network will match it with a member.',
  accept: 'Accepted. Reach out to the customer.',
  decline: 'Declined. The network will reassign it.',
  book: 'Marked booked.',
  win: 'Marked won. Thanks for reporting the job value.',
  lose: 'Marked lost.',
  note: 'Note saved.',
  invited: 'Thanks! The network will review them and send their app link.',
  saved: 'Review links saved.',
};

const MEMBER_ACTIONS = new Set(['accept', 'decline', 'book', 'win', 'lose', 'note']);
const MAX_PENDING_INVITES = 25;

function noStore(res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

function firstName(member) {
  const contact = String(member.contactName || '').trim().split(/\s+/)[0];
  return contact || member.companyName;
}

async function loadContext(token) {
  const payload = verifyNetworkToken(token, 'mem');
  if (!payload) return null;
  const network = await store.getNetwork(payload.networkId);
  if (!network) return null;
  const member = await store.getMember(network.id, payload.memberId);
  if (!member) return null;
  return {
    network,
    member,
    token,
    base: `/m/${encodeURIComponent(token)}`,
    brand: networkBrand.brandView(network),
    greetingName: firstName(member),
  };
}

function renderInvalid(res, status, message) {
  noStore(res);
  return res.status(status || 404).render('member_app/invalid', {
    message: message || 'This app link has expired or was replaced.',
    brand: networkBrand.brandView(null),
    icons: ICONS,
  });
}

function render(res, view, ctx, extra, status) {
  noStore(res);
  return res.status(status || 200).render(`member_app/${view}`, {
    ...ctx,
    active: view,
    flash: null,
    icons: ICONS,
    ...(extra || {}),
  });
}

function flashFromQuery(req) {
  const ok = OK_MESSAGES[String(req.query.ok || '')];
  return ok ? { ok } : null;
}

function withMember(handler) {
  return async (req, res) => {
    try {
      const ctx = await loadContext(req.params.token);
      if (!ctx) return renderInvalid(res);
      return await handler(req, res, ctx);
    } catch (err) {
      console.error('[member-app]', req.method, req.path.replace(/\/m\/[^/]+/, '/m/:token'), err.message);
      return renderInvalid(res, 500, 'Something went wrong. Try again in a moment.');
    }
  };
}

function money(n) {
  return n ? `$${Math.round(Number(n) || 0).toLocaleString('en-US')}` : '';
}

function when(iso) {
  const ms = Date.parse(iso || '');
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function presentReceived(ref, membersById) {
  const from = ref.fromMemberId === 'operator'
    ? 'the network'
    : ((membersById[ref.fromMemberId] || {}).companyName || 'a member');
  return {
    id: ref.id,
    status: ref.status,
    statusLabel: ex.STATUS_LABELS[ref.status] || ref.status,
    trade: trades.tradeLabel(ref.tradeSlug),
    customer: ref.homeowner || {},
    from,
    value: money(ref.value),
    when: when(ref.createdAt),
    actions: ex.allowedActions(ref),
    notes: (ref.events || []).filter((e) => e.type === 'note').slice(-3).reverse(),
  };
}

function presentSent(ref, membersById) {
  return {
    id: ref.id,
    status: ref.status,
    statusLabel: ref.status === 'unrouted' ? 'Being matched' : (ex.STATUS_LABELS[ref.status] || ref.status),
    trade: trades.tradeLabel(ref.tradeSlug),
    customer: ref.homeowner || {},
    to: ref.toMemberId ? ((membersById[ref.toMemberId] || {}).companyName || 'Member') : 'Being matched',
    value: money(ref.value),
    when: when(ref.createdAt),
  };
}

async function directoryFor(network, member) {
  const [members, zones] = await Promise.all([store.listMembers(network.id), store.listZones(network.id)]);
  const membersById = Object.fromEntries(members.map((m) => [m.id, m]));
  return trades.tradesForNetwork(network)
    .filter((t) => !member.trades.includes(t.slug))
    .map((t) => {
      const holders = zones
        .map((z) => ex.seatHolder(z, t.slug))
        .filter(Boolean)
        .map((id) => membersById[id])
        .filter((m) => m && m.status === 'active' && m.id !== member.id);
      return { slug: t.slug, name: t.name, holders: [...new Set(holders.map((m) => m.companyName))] };
    });
}

// ── Public assets (before /m/:token) ─────────────────────────────────────────

router.get('/m/brand/:networkId/:kind', async (req, res) => {
  try {
    const kind = String(req.params.kind || '');
    if (!networkBrand.IMAGE_KINDS.has(kind)) return res.status(404).end();
    const img = await store.getBrandImage(String(req.params.networkId || ''), kind);
    if (!img) return res.status(404).end();
    res.setHeader('Content-Type', img.contentType);
    res.setHeader('Cache-Control', 'public, max-age=604800');
    return res.end(img.buffer);
  } catch (err) {
    return res.status(404).end();
  }
});

// ── Lost link ────────────────────────────────────────────────────────────────

const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX = 5;

function loginAllowed(ip) {
  const now = Date.now();
  const recent = (loginAttempts.get(ip) || []).filter((t) => now - t < LOGIN_WINDOW_MS);
  if (recent.length >= LOGIN_MAX) {
    loginAttempts.set(ip, recent);
    return false;
  }
  recent.push(now);
  loginAttempts.set(ip, recent);
  if (loginAttempts.size > 5000) loginAttempts.clear();
  return true;
}

function phoneDigits(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

function matchesContact(member, { digits, email }) {
  if (digits && phoneDigits(member.phone) === digits) return true;
  if (email && String(member.email || '').trim().toLowerCase() === email) return true;
  return false;
}

router.get('/m/login', (req, res) => {
  noStore(res);
  res.render('member_app/login', { brand: networkBrand.brandView(null), icons: ICONS, sent: false, error: '' });
});

router.post('/m/login', form, async (req, res) => {
  noStore(res);
  const brand = networkBrand.brandView(null);
  const raw = String((req.body && req.body.contact) || '').trim();
  const email = raw.includes('@') ? raw.toLowerCase() : '';
  const digits = email ? '' : phoneDigits(raw);
  if (!email && !digits) {
    return res.status(400).render('member_app/login', { brand, icons: ICONS, sent: false, error: 'Enter the mobile number or email the network has for you.' });
  }
  const ip = String(req.ip || req.socket.remoteAddress || 'unknown');
  if (loginAllowed(ip)) {
    try {
      const all = await store.listAllMembers();
      const matches = all.filter((row) => row.member.status === 'active' && matchesContact(row.member, { digits, email })).slice(0, 3);
      const baseUrl = notify.baseUrlFromReq(req);
      for (const row of matches) {
        const network = await store.getNetwork(row.networkId);
        if (network) await notify.sendMemberPortalLink({ network, member: row.member, baseUrl }).catch(() => {});
      }
    } catch (err) {
      console.error('[member-app] login lookup failed:', err.message);
    }
  }
  return res.render('member_app/login', { brand, icons: ICONS, sent: true, error: '' });
});

// ── PWA manifest + icons ─────────────────────────────────────────────────────

router.get('/m/:token/manifest.webmanifest', withMember(async (req, res, ctx) => {
  const { brand, base } = ctx;
  res.setHeader('Content-Type', 'application/manifest+json');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.send(JSON.stringify({
    name: brand.appName,
    short_name: brand.shortName,
    description: `${brand.appName} referral app`,
    id: base,
    start_url: `${base}?source=pwa`,
    scope: `${base}`,
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f4f5f7',
    theme_color: '#ffffff',
    icons: [
      { src: `${base}/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `${base}/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `${base}/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }));
}));

router.get('/m/:token/icon-:size.png', withMember(async (req, res, ctx) => {
  const size = [180, 192, 512].includes(parseInt(req.params.size, 10)) ? parseInt(req.params.size, 10) : 192;
  const logo = ctx.brand.logoUrl && ctx.brand.logoUrl.startsWith(`/m/brand/${ctx.network.id}/`)
    ? await store.getBrandImage(ctx.network.id, 'logo')
    : null;
  const png = await networkBrand.renderIcon({ brand: ctx.brand, logo, size });
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  return res.end(png);
}));

// ── Home ─────────────────────────────────────────────────────────────────────

router.get('/m/:token', withMember(async (req, res, ctx) => {
  const [referrals, members] = await Promise.all([store.listReferrals(ctx.network.id), store.listMembers(ctx.network.id)]);
  const membersById = Object.fromEntries(members.map((m) => [m.id, m]));
  const stats = ex.memberStats(referrals, ctx.member.id);
  const waiting = referrals
    .filter((r) => r.toMemberId === ctx.member.id && r.status === 'sent')
    .slice(0, 3)
    .map((r) => presentReceived(r, membersById));
  return render(res, 'home', ctx, {
    tiles: [
      { key: 'sent', label: 'Sent', value: stats.given, href: `${ctx.base}/referrals?view=sent` },
      { key: 'received', label: 'Received', value: stats.received, href: `${ctx.base}/referrals` },
      { key: 'pending', label: 'Pending', value: stats.open, href: `${ctx.base}/referrals` },
      { key: 'completed', label: 'Completed', value: stats.won, href: `${ctx.base}/referrals` },
    ],
    wonValue: money(stats.wonValue),
    waiting,
    flash: flashFromQuery(req),
  });
}));

// ── Referrals ────────────────────────────────────────────────────────────────

async function renderReferrals(req, res, ctx, flash, status) {
  const view = req.query.view === 'sent' ? 'sent' : 'received';
  const [referrals, members] = await Promise.all([store.listReferrals(ctx.network.id), store.listMembers(ctx.network.id)]);
  const membersById = Object.fromEntries(members.map((m) => [m.id, m]));
  const received = referrals.filter((r) => r.toMemberId === ctx.member.id).slice(0, 60).map((r) => presentReceived(r, membersById));
  const sent = referrals.filter((r) => r.fromMemberId === ctx.member.id).slice(0, 60).map((r) => presentSent(r, membersById));
  return render(res, 'referrals', ctx, { view, received, sent, flash: flash || flashFromQuery(req) }, status);
}

router.get('/m/:token/referrals', withMember((req, res, ctx) => renderReferrals(req, res, ctx)));

router.post('/m/:token/referrals/:id', form, withMember(async (req, res, ctx) => {
  const action = String((req.body && req.body.action) || '').trim();
  if (!MEMBER_ACTIONS.has(action)) return renderReferrals(req, res, ctx, { error: 'Unknown action.' }, 400);
  const result = await networkReferrals.actOnReferral({
    network: ctx.network,
    referralId: String(req.params.id || ''),
    action,
    opts: { value: req.body.value, text: req.body.text, by: ctx.member.companyName },
    actorMemberId: ctx.member.id,
    baseUrl: notify.baseUrlFromReq(req),
  });
  if (!result.ok) return renderReferrals(req, res, ctx, { error: result.error }, 400);
  return res.redirect(303, `${ctx.base}/referrals?ok=${action}#ref-${encodeURIComponent(req.params.id)}`);
}));

// ── Send ─────────────────────────────────────────────────────────────────────

async function renderSend(req, res, ctx, flash, formValues, status) {
  const directory = await directoryFor(ctx.network, ctx.member);
  return render(res, 'send', ctx, { directory, flash: flash || flashFromQuery(req), formValues: formValues || {} }, status);
}

router.get('/m/:token/send', withMember((req, res, ctx) => renderSend(req, res, ctx)));

router.post('/m/:token/send', form, withMember(async (req, res, ctx) => {
  const body = req.body || {};
  if (ctx.member.status !== 'active') {
    return renderSend(req, res, ctx, { error: 'Your membership is paused. Contact the network.' }, body, 403);
  }
  if (ctx.member.trades.includes(String(body.tradeSlug || ''))) {
    return renderSend(req, res, ctx, { error: 'Pick a trade other than your own.' }, body, 400);
  }
  const result = await networkReferrals.sendReferral({
    network: ctx.network,
    input: body,
    fromMemberId: ctx.member.id,
    by: ctx.member.companyName,
    baseUrl: notify.baseUrlFromReq(req),
  });
  if (!result.ok) return renderSend(req, res, ctx, { error: result.error }, body, 400);
  return res.redirect(303, `${ctx.base}?ok=${result.referral.status === 'sent' ? 'sent' : 'matched'}`);
}));

// ── Enroll ───────────────────────────────────────────────────────────────────

async function renderEnroll(req, res, ctx, flash, formValues, status) {
  const applications = await store.listApplications(ctx.network.id);
  const mine = applications
    .filter((a) => a.invitedByMemberId === ctx.member.id)
    .slice(0, 30)
    .map((a) => ({
      ...a,
      tradeLabel: a.tradeSlug ? trades.tradeLabel(a.tradeSlug) : '',
      statusLabel: a.status === 'approved' ? 'Joined' : (a.status === 'rejected' ? 'Not accepted' : 'Pending'),
      when: when(a.createdAt),
    }));
  return render(res, 'enroll', ctx, {
    trades: trades.tradesForNetwork(ctx.network).map((t) => ({ slug: t.slug, name: t.name })),
    invites: mine,
    flash: flash || flashFromQuery(req),
    formValues: formValues || {},
  }, status);
}

router.get('/m/:token/enroll', withMember((req, res, ctx) => renderEnroll(req, res, ctx)));

router.post('/m/:token/enroll', form, withMember(async (req, res, ctx) => {
  const body = req.body || {};
  if (ctx.member.status !== 'active') {
    return renderEnroll(req, res, ctx, { error: 'Your membership is paused. Contact the network.' }, body, 403);
  }
  const draft = store.normalizeApplication({
    companyName: body.companyName,
    contactName: body.contactName,
    phone: body.phone,
    email: body.email,
    tradeSlug: ctx.network.trades.includes(String(body.tradeSlug || '')) ? body.tradeSlug : '',
    city: body.city,
    note: body.note,
    invitedByMemberId: ctx.member.id,
  });
  if (!draft.companyName) return renderEnroll(req, res, ctx, { error: 'Add the business name.' }, body, 400);
  if (!draft.phone && !draft.email) return renderEnroll(req, res, ctx, { error: 'Add a phone or email for the business.' }, body, 400);
  const existing = await store.listApplications(ctx.network.id);
  const pendingMine = existing.filter((a) => a.invitedByMemberId === ctx.member.id && a.status === 'pending');
  if (pendingMine.length >= MAX_PENDING_INVITES) {
    return renderEnroll(req, res, ctx, { error: 'You have a lot of invites waiting. The network will review them first.' }, body, 429);
  }
  if (pendingMine.some((a) => a.companyName.toLowerCase() === draft.companyName.toLowerCase())) {
    return renderEnroll(req, res, ctx, { error: `You already invited ${draft.companyName}.` }, body, 400);
  }
  const application = await store.saveApplication(ctx.network.id, draft);
  await notify.notifyApplication({ network: ctx.network, application, invitedBy: ctx.member }).catch(() => {});
  return res.redirect(303, `${ctx.base}/enroll?ok=invited`);
}));

// ── Review settings ──────────────────────────────────────────────────────────

function googleReviewUrlFromLead(lead) {
  const placeId = String((lead && (lead.placeId || lead.place_id)) || '').trim();
  return /^[A-Za-z0-9_-]{10,}$/.test(placeId)
    ? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`
    : '';
}

/** First visit: claim a review slug and pre-fill Google from the member's Maps listing. */
async function ensureReviewSetup(ctx) {
  let member = ctx.member;
  if (member.reviewSlug) return member;
  member = await store.ensureReviewSlug(ctx.network.id, member);
  if (!member.reviewLinks.google) {
    const lead = member.leadKey ? await dbService.getLead(member.leadKey, ctx.network.ownerWorkspaceId) : null;
    const google = googleReviewUrlFromLead(lead);
    if (google) member = await store.saveMember(ctx.network.id, { ...member, reviewLinks: { ...member.reviewLinks, google } });
  }
  return member;
}

async function renderReview(req, res, ctx, flash, status) {
  const member = await ensureReviewSetup(ctx);
  const [stats, feedback] = await Promise.all([
    store.getReviewStats(ctx.network.id, member.id),
    store.listFeedback(ctx.network.id, member.id),
  ]);
  const baseUrl = notify.baseUrlFromReq(req);
  const totalStars = Object.values(stats.stars).reduce((a, b) => a + b, 0);
  return render(res, 'review', { ...ctx, member }, {
    reviewUrl: `${baseUrl}/rv/${member.reviewSlug}`,
    reviewPath: `/rv/${member.reviewSlug}`,
    stats,
    totalStars,
    feedback: feedback.slice(0, 10).map((f) => ({ ...f, when: when(f.createdAt) })),
    flash: flash || flashFromQuery(req),
  }, status);
}

router.get('/m/:token/review', withMember((req, res, ctx) => renderReview(req, res, ctx)));

router.post('/m/:token/review', form, withMember(async (req, res, ctx) => {
  const body = req.body || {};
  const labels = [].concat(body.otherLabel || []);
  const urls = [].concat(body.otherUrl || []);
  const links = store.normalizeReviewLinks({
    google: body.google,
    facebook: body.facebook,
    yelp: body.yelp,
    other: labels.map((label, i) => ({ label, url: urls[i] })),
  });
  const typed = ['google', 'facebook', 'yelp'].filter((k) => String(body[k] || '').trim() && !links[k]);
  if (typed.length) {
    return renderReview(req, res, ctx, { error: `That ${typed[0]} link doesn't look like a web address.` }, 400);
  }
  await store.saveMember(ctx.network.id, { ...ctx.member, reviewLinks: links });
  return res.redirect(303, `${ctx.base}/review?ok=saved`);
}));

module.exports = router;
module.exports.googleReviewUrlFromLead = googleReviewUrlFromLead;
module.exports.phoneDigits = phoneDigits;
