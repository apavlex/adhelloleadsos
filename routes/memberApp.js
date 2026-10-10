/**
 * Partner app (installable PWA), white-labeled per network. No login:
 * the signed member token lives in the path so a Home Screen bookmark keeps working.
 *
 * Hierarchy: reviews → customers/work → referrals & leads.
 *
 *   /m/:token            Home
 *   /m/:token/review     QR / share + send review requests
 *   /m/:token/review/settings  review links + default preview image
 *   /m/:token/customers  customers, jobs and schedule
 *   /m/:token/referrals  received + sent referrals
 *   /m/:token/send       send a referral
 *   /m/:token/leads      website/GHL form leads (when linked to an appointment package)
 *   /m/:token/packages   request / buy more appointments & lead credits
 *   /m/:token/enroll     invite a business to join
 *   /m/login             text me a new link
 */

const express = require('express');
const multer = require('multer');
const dbService = require('../services/database');
const store = require('../services/networkStore');
const ex = require('../services/referralExchange');
const trades = require('../services/networkTrades');
const notify = require('../services/networkNotify');
const networkReferrals = require('../services/networkReferrals');
const networkBrand = require('../services/networkBrand');
const work = require('../services/memberWork');
const reviewPage = require('../services/reviewPage');
const reviewRequestScript = require('../services/reviewRequestScript');
const reviewShareImage = require('../services/reviewShareImage');
const contractorPortal = require('../services/contractorPortal');
const memberAppointmentLink = require('../services/memberAppointmentLink');
const appointmentPackages = require('../services/appointmentPackages');
const { verifyNetworkToken } = require('../services/networkLinkSign');
const { ICONS } = require('../services/memberAppIcons');

const router = express.Router();
const form = express.urlencoded({ extended: true, limit: '64kb' });
const reviewUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: reviewShareImage.MAX_UPLOAD_BYTES, files: 1 },
  fileFilter(req, file, cb) {
    const ok = /^image\/(jpeg|jpg|png|webp|gif)$/i.test(String(file.mimetype || ''));
    cb(ok ? null : new Error('Upload a JPG, PNG, WebP, or GIF image.'), ok);
  },
});

function withReviewUpload(fieldName) {
  return (req, res, next) => {
    reviewUpload.single(fieldName)(req, res, (err) => {
      if (!err) return next();
      return renderInvalid(res, 400, err.message || 'Could not upload that image.');
    });
  };
}

const OK_MESSAGES = {
  sent: 'Referral sent. They were notified.',
  matched: 'Referral received. The network will match it with a member.',
  accept: 'Accepted. Reach out to the customer.',
  claim: 'Claimed. This referral is yours — reach out to the customer.',
  decline: 'Declined. The network will reassign it.',
  book: 'Marked booked.',
  win: 'Marked won. Thanks for reporting the job value.',
  lose: 'Marked lost.',
  note: 'Note saved.',
  invited: 'Thanks! The network will review them and send their app link.',
  saved: 'Review links saved.',
  script_saved: 'Review SMS script saved. AI will use it when you send via GHL.',
  share_image_saved: 'Link preview image saved. Messages will show this photo.',
  share_image_cleared: 'Custom preview image removed. The AdHello default will be used.',
  logo_saved: 'Review page logo saved. Customers will see it on your request page.',
  logo_cleared: 'Custom logo removed. Your review page will use the network logo or initials.',
  hero_saved: 'Home banner image updated.',
  hero_cleared: 'Home banner image removed.',
  review_sms: 'Review request sent by text via Go High Level.',
  review_email: 'Review request sent by email via Go High Level.',
  customer: 'Customer saved.',
  customer_deleted: 'Customer deleted.',
  job: 'Job saved.',
  job_deleted: 'Job deleted.',
  moved: 'Job updated.',
  converted: 'Added to your customers.',
  already: 'That referral is already in your customers.',
};

const MEMBER_ACTIONS = new Set(['accept', 'decline', 'book', 'win', 'lose', 'note', 'claim']);
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

async function attachAppointment(ctx) {
  const workspaceId = ctx.network && ctx.network.ownerWorkspaceId;
  if (!workspaceId) return { ...ctx, appointment: null };
  const pkg = await memberAppointmentLink.findPackageForMember(workspaceId, ctx.member);
  if (!pkg || pkg.portalEnabled === false) return { ...ctx, appointment: null };

  // Persist an explicit link once we auto-match so future lookups are stable.
  if (!ctx.member.appointmentPackageId || ctx.member.appointmentPackageId !== pkg.id) {
    try {
      const saved = await store.saveMember(ctx.network.id, {
        ...ctx.member,
        appointmentPackageId: pkg.id,
      });
      ctx.member = saved;
    } catch (e) {
      console.warn('[member-app] could not persist appointmentPackageId:', e && e.message);
    }
  }

  const home = contractorPortal.buildPortalHome(pkg);
  const portalToken = await contractorPortal.ensurePortalToken(workspaceId, pkg.id);
  const portalPath = contractorPortal.portalPath(portalToken);
  return {
    ...ctx,
    appointment: {
      workspaceId,
      package: pkg,
      packageId: pkg.id,
      ...home,
      portalToken,
      /** Standalone contractor portal (appointments packages). Leads show in /m. */
      portalPath,
      portalLeadsPath: `${ctx.base}/leads`,
      portalPackagesPath: `${portalPath}/packages`,
    },
  };
}

async function loadContext(token) {
  const payload = verifyNetworkToken(token, 'mem');
  if (!payload) return null;
  const network = await store.getNetwork(payload.networkId);
  if (!network) return null;
  const member = await store.getMember(network.id, payload.memberId);
  if (!member) return null;
  const base = {
    network,
    member,
    token,
    base: `/m/${encodeURIComponent(token)}`,
    brand: networkBrand.brandView(network),
    greetingName: firstName(member),
    appointment: null,
  };
  return attachAppointment(base);
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

const ERR_MESSAGES = {
  hero: 'Could not update the banner image. Try a JPG, PNG, WebP, or GIF under 6 MB.',
};

function flashFromQuery(req) {
  const ok = OK_MESSAGES[String(req.query.ok || '')];
  if (ok) return { ok };
  const error = ERR_MESSAGES[String(req.query.err || '')];
  return error ? { error } : null;
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

function presentReceived(ref, membersById, network) {
  const from = ref.fromMemberId === 'operator'
    ? 'the network'
    : ((membersById[ref.fromMemberId] || {}).companyName || 'a member');
  return {
    id: ref.id,
    status: ref.status,
    statusLabel: ex.STATUS_LABELS[ref.status] || ref.status,
    trade: trades.tradeLabel(ref.tradeSlug, network),
    customer: ref.homeowner || {},
    from,
    value: money(ref.value),
    when: when(ref.createdAt),
    actions: ex.allowedActions(ref),
    notes: (ref.events || []).filter((e) => e.type === 'note').slice(-3).reverse(),
  };
}

function presentSent(ref, membersById, network) {
  return {
    id: ref.id,
    status: ref.status,
    statusLabel: ref.status === 'unrouted' ? 'Being matched' : (ex.STATUS_LABELS[ref.status] || ref.status),
    trade: trades.tradeLabel(ref.tradeSlug, network),
    customer: ref.homeowner || {},
    to: ref.toMemberId ? ((membersById[ref.toMemberId] || {}).companyName || 'Member') : 'Being matched',
    value: money(ref.value),
    when: when(ref.createdAt),
  };
}

/** IANA zone the app stored in the ma_tz cookie, so "today" matches the member's phone. */
function memberTimeZone(req) {
  const match = String(req.headers.cookie || '').match(/(?:^|;\s*)ma_tz=([^;]+)/);
  let tz = '';
  try { tz = match ? decodeURIComponent(match[1]) : ''; } catch { tz = ''; }
  if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(tz)) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

function dayLabel(date, today) {
  if (!date) return '';
  if (date === today) return 'Today';
  if (date === work.addDays(today, 1)) return 'Tomorrow';
  const d = new Date(`${date}T00:00:00Z`);
  const sameYear = date.slice(0, 4) === String(today || '').slice(0, 4);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric', timeZone: 'UTC' });
}

function timeLabel(time) {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function durationLabel(mins) {
  if (!mins) return '';
  if (mins % 1440 === 0) return `${mins / 1440} day${mins === 1440 ? '' : 's'}`;
  if (mins < 60) return `${mins} min`;
  const hours = Math.round((mins / 60) * 10) / 10;
  return `${hours} hr`;
}

function presentJob(job, customersById, base, today) {
  const customer = customersById[job.customerId] || {};
  const next = work.nextStatus(job.status);
  return {
    ...job,
    statusLabel: work.JOB_STATUS_LABELS[job.status],
    valueLabel: money(job.value),
    customerName: customer.name || 'Customer',
    customerPhone: customer.phone || '',
    dayLabel: dayLabel(job.date, today),
    timeLabel: timeLabel(job.time),
    durationLabel: durationLabel(job.durationMins),
    whenLabel: [dayLabel(job.date, today), timeLabel(job.time)].filter(Boolean).join(' · '),
    overdue: !!(job.date && today && job.date < today && work.isOpen(job) && job.status !== 'on_hold'),
    href: `${base}/customers/jobs/${job.id}`,
    next,
    nextLabel: next ? work.JOB_STATUS_LABELS[next] : '',
  };
}

async function directoryFor(network, member) {
  const [members, zones] = await Promise.all([store.listMembers(network.id), store.listZones(network.id)]);
  const membersById = Object.fromEntries(members.map((m) => [m.id, m]));
  return trades.tradesForNetwork(network)
    .filter((t) => !member.trades.includes(t.slug))
    .map((t) => {
      const holders = zones
        .flatMap((z) => ex.seatHolders(z, t.slug))
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
    description: `${brand.appName} — reviews, customers, and referrals`,
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
  const [referrals, members, jobs, customers, reviewStats] = await Promise.all([
    store.listReferrals(ctx.network.id),
    store.listMembers(ctx.network.id),
    work.listJobs(ctx.network.id, ctx.member.id),
    work.listCustomers(ctx.network.id, ctx.member.id),
    store.getReviewStats(ctx.network.id, ctx.member.id),
  ]);
  const membersById = Object.fromEntries(members.map((m) => [m.id, m]));
  const customersById = Object.fromEntries(customers.map((c) => [c.id, c]));
  const stats = ex.memberStats(referrals, ctx.member.id);
  const waiting = referrals
    .filter((r) => r.toMemberId === ctx.member.id && r.status === 'sent')
    .slice(0, 3)
    .map((r) => presentReceived(r, membersById, ctx.network));
  const today = work.todayIn(memberTimeZone(req));
  const openJobCount = jobs.filter((j) => j && ['lead', 'estimate', 'scheduled', 'in_progress', 'on_hold'].includes(String(j.status || '').toLowerCase())).length;
  return render(res, 'home', ctx, {
    upcoming: work.upcoming(jobs, today, 2).map((j) => presentJob(j, customersById, ctx.base, today)),
    // Reviews → customers/work → referrals (network is tertiary).
    tiles: [
      { key: 'reviews', label: 'Review visits', value: reviewStats.views || 0, href: `${ctx.base}/review?ask=1`, icon: 'review' },
      { key: 'customers', label: 'Customers', value: customers.length, href: `${ctx.base}/customers`, icon: 'customers' },
      { key: 'pending', label: 'Pending refs', value: stats.open, href: `${ctx.base}/referrals`, icon: 'pending' },
      { key: 'sent', label: 'Sent', value: stats.given, href: `${ctx.base}/referrals?view=sent`, icon: 'send' },
    ],
    reviewViews: reviewStats.views || 0,
    customerCount: customers.length,
    openJobCount,
    wonValue: money(stats.wonValue),
    waiting,
    flash: flashFromQuery(req),
  });
}));

/** Upload or clear the network Home banner (hero) image from the member app. */
router.post('/m/:token/brand/hero', (req, res, next) => {
  const ct = String(req.headers['content-type'] || '');
  if (ct.includes('multipart/form-data')) return withReviewUpload('hero')(req, res, next);
  return form(req, res, next);
}, withMember(async (req, res, ctx) => {
  const body = req.body || {};
  const brand = { ...(ctx.network.brand || {}) };
  if (body.remove === '1' || body.remove === 'on') {
    await store.deleteBrandImage(ctx.network.id, 'hero');
    brand.heroUrl = '';
    await store.saveNetwork({ ...ctx.network, brand });
    return res.redirect(303, `${ctx.base}?ok=hero_cleared`);
  }
  if (!req.file || !req.file.buffer) {
    return res.redirect(303, `${ctx.base}?err=hero`);
  }
  try {
    const prepared = await networkBrand.prepareImage('hero', req.file.buffer);
    const stamp = await store.saveBrandImage(ctx.network.id, 'hero', prepared);
    brand.heroUrl = `/m/brand/${ctx.network.id}/hero?v=${Date.parse(stamp) || Date.now()}`;
    await store.saveNetwork({ ...ctx.network, brand });
    return res.redirect(303, `${ctx.base}?ok=hero_saved`);
  } catch (err) {
    console.error('[member-app] hero upload failed:', err.message);
    return res.redirect(303, `${ctx.base}?err=hero`);
  }
}));

// ── Referrals ────────────────────────────────────────────────────────────────

async function renderReferrals(req, res, ctx, flash, status) {
  const view = ['sent', 'pool'].includes(req.query.view) ? req.query.view : 'received';
  const [referrals, members, jobs] = await Promise.all([
    store.listReferrals(ctx.network.id),
    store.listMembers(ctx.network.id),
    work.listJobs(ctx.network.id, ctx.member.id),
  ]);
  const membersById = Object.fromEntries(members.map((m) => [m.id, m]));
  const jobByRef = Object.fromEntries(jobs.filter((j) => j.referralId).map((j) => [j.referralId, j]));
  const received = referrals.filter((r) => r.toMemberId === ctx.member.id).slice(0, 60).map((r) => ({
    ...presentReceived(r, membersById, ctx.network),
    jobHref: jobByRef[r.id] ? `${ctx.base}/customers/jobs/${jobByRef[r.id].id}` : '',
    convertible: ['accepted', 'booked', 'won'].includes(r.status),
  }));
  const sent = referrals.filter((r) => r.fromMemberId === ctx.member.id).slice(0, 60).map((r) => presentSent(r, membersById, ctx.network));
  const pool = ex.poolReferralsForMember(referrals, ctx.member).slice(0, 40).map((r) => ({
    ...presentReceived(r, membersById, ctx.network),
    statusLabel: 'Open · Claim',
    actions: ['claim'],
    convertible: false,
  }));
  return render(res, 'referrals', ctx, {
    view,
    received,
    sent,
    pool,
    flash: flash || flashFromQuery(req),
  }, status);
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
  const back = action === 'claim' ? `${ctx.base}/referrals?ok=claim` : `${ctx.base}/referrals?ok=${action}#ref-${encodeURIComponent(req.params.id)}`;
  return res.redirect(303, back);
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

// ── Customers (the member's own jobs and schedule) ───────────────────────────

const CUSTOMER_VIEWS = new Set(['list', 'calendar', 'pending']);
const OPEN_REFERRAL = new Set(['sent', 'accepted', 'booked']);
const DURATIONS = [30, 60, 90, 120, 180, 240, 360, 480, 1440, 2880];

async function loadWork(ctx) {
  const [customers, jobs] = await Promise.all([
    work.listCustomers(ctx.network.id, ctx.member.id),
    work.listJobs(ctx.network.id, ctx.member.id),
  ]);
  return { customers, jobs, customersById: Object.fromEntries(customers.map((c) => [c.id, c])) };
}

async function pendingReferralsFor(ctx, jobs) {
  const [referrals, members] = await Promise.all([store.listReferrals(ctx.network.id), store.listMembers(ctx.network.id)]);
  const membersById = Object.fromEntries(members.map((m) => [m.id, m]));
  const jobByRef = Object.fromEntries(jobs.filter((j) => j.referralId).map((j) => [j.referralId, j]));
  return referrals
    .filter((r) => r.toMemberId === ctx.member.id && OPEN_REFERRAL.has(r.status))
    .slice(0, 30)
    .map((r) => {
      const job = jobByRef[r.id];
      return { ...presentReceived(r, membersById, ctx.network), jobHref: job ? `${ctx.base}/customers/jobs/${job.id}` : '' };
    });
}

function customersHref(base, params) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
  return `${base}/customers${qs ? `?${qs}` : ''}`;
}

async function renderCustomers(req, res, ctx, flash, status) {
  const view = CUSTOMER_VIEWS.has(req.query.view) ? req.query.view : 'list';
  const today = work.todayIn(memberTimeZone(req));
  const { customers, jobs, customersById } = await loadWork(ctx);
  const pendingRefs = await pendingReferralsFor(ctx, jobs);
  const present = (j) => presentJob(j, customersById, ctx.base, today);
  const extra = {
    active: 'customers',
    view,
    today,
    pendingRefs,
    flash: flash || flashFromQuery(req),
    hrefFor: (params) => customersHref(ctx.base, params),
    customerCount: customers.length,
  };

  if (view === 'list') {
    const q = String(req.query.q || '').trim().slice(0, 80);
    const needle = q.toLowerCase();
    const rows = customers
      .filter((c) => !needle || [c.name, c.phone, c.email, c.address].join(' ').toLowerCase().includes(needle))
      .map((c) => {
        const mine = jobs.filter((j) => j.customerId === c.id);
        const open = mine.filter(work.isOpen);
        const lead = open[0] || mine[mine.length - 1];
        return {
          ...c,
          href: `${ctx.base}/customers/c/${c.id}`,
          jobCount: mine.length,
          openCount: open.length,
          top: lead ? present(lead) : null,
          sortKey: lead ? lead.updatedAt : c.updatedAt,
        };
      })
      .sort((a, b) => (b.openCount > 0) - (a.openCount > 0) || String(b.sortKey).localeCompare(String(a.sortKey)));
    Object.assign(extra, { q, rows });
  } else if (view === 'calendar') {
    const month = /^\d{4}-\d{2}$/.test(String(req.query.m || '')) ? req.query.m : today.slice(0, 7);
    const picked = work.cleanDate(req.query.d);
    const selected = picked || (month === today.slice(0, 7) ? today : `${month}-01`);
    const grid = work.monthGrid(month, jobs, { today, selected });
    Object.assign(extra, {
      grid,
      selected,
      selectedLabel: dayLabel(selected, today),
      dayJobs: jobs.filter((j) => j.date === selected).map(present),
    });
  } else {
    const groups = ['in_progress', 'scheduled', 'estimate', 'lead', 'on_hold'].map((key) => ({
      key,
      label: work.JOB_STATUS_LABELS[key],
      jobs: jobs.filter((j) => j.status === key).map(present),
    })).filter((g) => g.jobs.length);
    Object.assign(extra, { groups });
  }
  return render(res, 'customers', ctx, extra, status);
}

router.get('/m/:token/customers', withMember((req, res, ctx) => renderCustomers(req, res, ctx)));

function renderCustomerPage(res, ctx, { customer, jobs, today, formValues, flash, status }) {
  return render(res, 'customer', ctx, {
    active: 'customers',
    customer,
    jobs: jobs || [],
    formValues: formValues || customer || {},
    flash: flash || null,
    today,
  }, status);
}

router.get('/m/:token/customers/new', withMember((req, res, ctx) => renderCustomerPage(res, ctx, {
  customer: null,
  today: work.todayIn(memberTimeZone(req)),
})));

router.post('/m/:token/customers/new', form, withMember(async (req, res, ctx) => {
  const result = await work.saveCustomer(ctx.network.id, ctx.member.id, req.body || {});
  if (!result.ok) {
    return renderCustomerPage(res, ctx, { customer: null, formValues: req.body, flash: { error: result.error }, status: 400 });
  }
  return res.redirect(303, `${ctx.base}/customers/c/${result.customer.id}?ok=customer`);
}));

async function customerPageData(req, ctx, id) {
  const customer = await work.getCustomer(ctx.network.id, ctx.member.id, id);
  if (!customer) return null;
  const today = work.todayIn(memberTimeZone(req));
  const { jobs, customersById } = await loadWork(ctx);
  const mine = jobs
    .filter((j) => j.customerId === customer.id)
    .sort((a, b) => work.isOpen(b) - work.isOpen(a))
    .map((j) => presentJob(j, customersById, ctx.base, today));
  return { customer, jobs: mine, today };
}

router.get('/m/:token/customers/c/:id', withMember(async (req, res, ctx) => {
  const data = await customerPageData(req, ctx, req.params.id);
  if (!data) return res.redirect(303, `${ctx.base}/customers`);
  return renderCustomerPage(res, ctx, { ...data, flash: flashFromQuery(req) });
}));

router.post('/m/:token/customers/c/:id', form, withMember(async (req, res, ctx) => {
  const result = await work.saveCustomer(ctx.network.id, ctx.member.id, req.body || {}, { id: req.params.id });
  if (!result.ok) {
    const data = await customerPageData(req, ctx, req.params.id);
    if (!data) return res.redirect(303, `${ctx.base}/customers`);
    return renderCustomerPage(res, ctx, { ...data, formValues: req.body, flash: { error: result.error }, status: 400 });
  }
  return res.redirect(303, `${ctx.base}/customers/c/${result.customer.id}?ok=customer`);
}));

router.post('/m/:token/customers/c/:id/delete', form, withMember(async (req, res, ctx) => {
  await work.deleteCustomer(ctx.network.id, ctx.member.id, req.params.id);
  return res.redirect(303, `${ctx.base}/customers?ok=customer_deleted`);
}));

/** Request a review for this customer via GHL SMS/email. */
router.post('/m/:token/customers/c/:id/request-review', form, withMember(async (req, res, ctx) => {
  const data = await customerPageData(req, ctx, req.params.id);
  if (!data) return res.redirect(303, `${ctx.base}/customers`);
  const member = await ensureReviewSetup(ctx);
  if (!reviewPage.countLinks(member.reviewLinks)) {
    return res.redirect(303, `${ctx.base}/review?ask=1&name=${encodeURIComponent(data.customer.name || '')}&phone=${encodeURIComponent(data.customer.phone || '')}&email=${encodeURIComponent(data.customer.email || '')}`);
  }
  if (ctx.member.status !== 'active') {
    return renderCustomerPage(res, ctx, {
      ...data,
      flash: { error: 'Your membership is paused, so review requests can’t be sent.' },
      status: 403,
    });
  }
  const channel = String((req.body && req.body.channel) || 'auto').trim() || 'auto';
  const result = await notify.sendReviewRequest({
    network: ctx.network,
    member,
    baseUrl: notify.baseUrlFromReq(req),
    toPhone: data.customer.phone,
    toEmail: data.customer.email,
    customerName: data.customer.name,
    channel,
    useAi: true,
  });
  if (!result.ok) {
    return renderCustomerPage(res, ctx, {
      ...data,
      flash: { error: result.error || 'Could not send the review request.' },
      status: 400,
    });
  }
  const ok = result.channel === 'email' ? 'review_email' : 'review_sms';
  return res.redirect(303, `${ctx.base}/customers/c/${data.customer.id}?ok=${ok}`);
}));

async function renderJobPage(req, res, ctx, { job, formValues, flash, status }) {
  const today = work.todayIn(memberTimeZone(req));
  const { customers, customersById } = await loadWork(ctx);
  return render(res, 'job', ctx, {
    active: 'customers',
    job: job ? presentJob(job, customersById, ctx.base, today) : null,
    customer: job ? customersById[job.customerId] || null : null,
    customers,
    statuses: work.JOB_STATUSES.map((s) => ({ value: s, label: work.JOB_STATUS_LABELS[s] })),
    durations: DURATIONS.map((m) => ({ value: m, label: durationLabel(m) })),
    formValues: formValues || job || {},
    flash: flash || null,
    today,
  }, status);
}

router.get('/m/:token/customers/jobs/new', withMember((req, res, ctx) => {
  const date = work.cleanDate(req.query.date);
  return renderJobPage(req, res, ctx, {
    job: null,
    formValues: {
      customerId: work.isRecordId(req.query.customer) ? req.query.customer : '',
      date,
      status: date ? 'scheduled' : 'lead',
      durationMins: 120,
    },
  });
}));

router.post('/m/:token/customers/jobs/new', form, withMember(async (req, res, ctx) => {
  const body = { ...(req.body || {}) };
  const fail = (error) => renderJobPage(req, res, ctx, { job: null, formValues: body, flash: { error }, status: 400 });
  const checked = work.validateJob(body);
  if (!checked.ok) return fail(checked.error);
  if (body.customerId === 'new') {
    const created = await work.saveCustomer(ctx.network.id, ctx.member.id, { name: body.newCustomerName, phone: body.newCustomerPhone });
    if (!created.ok) return fail(created.error);
    body.customerId = created.customer.id;
  }
  const result = await work.saveJob(ctx.network.id, ctx.member.id, body);
  if (!result.ok) return fail(result.error);
  return res.redirect(303, `${ctx.base}/customers/c/${result.customer.id}?ok=job`);
}));

router.get('/m/:token/customers/jobs/:id', withMember(async (req, res, ctx) => {
  const job = await work.getJob(ctx.network.id, ctx.member.id, req.params.id);
  if (!job) return res.redirect(303, `${ctx.base}/customers?view=pending`);
  return renderJobPage(req, res, ctx, { job, flash: flashFromQuery(req) });
}));

router.post('/m/:token/customers/jobs/:id', form, withMember(async (req, res, ctx) => {
  const job = await work.getJob(ctx.network.id, ctx.member.id, req.params.id);
  if (!job) return res.redirect(303, `${ctx.base}/customers?view=pending`);
  const result = await work.saveJob(ctx.network.id, ctx.member.id, req.body || {}, { id: job.id });
  if (!result.ok) return renderJobPage(req, res, ctx, { job, formValues: req.body, flash: { error: result.error }, status: 400 });
  return res.redirect(303, `${ctx.base}/customers/jobs/${job.id}?ok=job`);
}));

function safeReturn(ctx, value, fallback) {
  const to = String(value || '');
  const ok = [`${ctx.base}/customers`, `${ctx.base}/referrals`].some((p) => to === p || to.startsWith(`${p}?`) || to.startsWith(`${p}/`));
  return ok && !/[\r\n]/.test(to) ? to : fallback;
}

router.post('/m/:token/customers/jobs/:id/status', form, withMember(async (req, res, ctx) => {
  const back = safeReturn(ctx, req.body && req.body.back, `${ctx.base}/customers/jobs/${encodeURIComponent(req.params.id)}`);
  const result = await work.setJobStatus(ctx.network.id, ctx.member.id, req.params.id, String((req.body && req.body.status) || ''));
  if (!result.ok) {
    const job = await work.getJob(ctx.network.id, ctx.member.id, req.params.id);
    if (!job) return res.redirect(303, `${ctx.base}/customers?view=pending`);
    return renderJobPage(req, res, ctx, { job, flash: { error: result.error }, status: 400 });
  }
  return res.redirect(303, `${back}${back.includes('?') ? '&' : '?'}ok=moved`);
}));

router.post('/m/:token/customers/jobs/:id/delete', form, withMember(async (req, res, ctx) => {
  const result = await work.deleteJob(ctx.network.id, ctx.member.id, req.params.id);
  const to = result.ok ? `${ctx.base}/customers/c/${result.job.customerId}` : `${ctx.base}/customers`;
  return res.redirect(303, `${to}?ok=job_deleted`);
}));

router.get('/m/:token/customers/jobs/:id/calendar.ics', withMember(async (req, res, ctx) => {
  const job = await work.getJob(ctx.network.id, ctx.member.id, req.params.id);
  if (!job || !job.date) return res.redirect(303, `${ctx.base}/customers`);
  const customer = await work.getCustomer(ctx.network.id, ctx.member.id, job.customerId);
  noStore(res);
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="job-${job.date}.ics"`);
  return res.send(work.buildIcs(job, customer, { appName: ctx.brand.appName, host: req.hostname }));
}));

router.post('/m/:token/customers/from-referral/:id', form, withMember(async (req, res, ctx) => {
  const back = safeReturn(ctx, req.body && req.body.back, `${ctx.base}/customers?view=pending`);
  const fail = (error) => renderCustomers({ headers: req.headers, query: { view: 'pending' } }, res, ctx, { error }, 400);
  let referral = await store.getReferral(ctx.network.id, String(req.params.id || ''));
  if (!referral || referral.toMemberId !== ctx.member.id) return fail('Referral not found.');
  if (referral.status === 'sent') {
    const accepted = await networkReferrals.actOnReferral({
      network: ctx.network,
      referralId: referral.id,
      action: 'accept',
      opts: { by: ctx.member.companyName },
      actorMemberId: ctx.member.id,
      baseUrl: notify.baseUrlFromReq(req),
    });
    if (!accepted.ok) return fail(accepted.error);
    referral = accepted.referral;
  }
  const result = await work.convertReferral(ctx.network.id, ctx.member.id, referral, {
    tradeLabel: trades.tradeLabel(referral.tradeSlug, ctx.network),
    today: work.todayIn(memberTimeZone(req)),
  });
  if (!result.ok) return fail(result.error);
  if (result.existing) return res.redirect(303, `${back}${back.includes('?') ? '&' : '?'}ok=already`);
  return res.redirect(303, `${ctx.base}/customers/jobs/${result.job.id}?ok=converted`);
}));

// ── Enroll ───────────────────────────────────────────────────────────────────

async function renderEnroll(req, res, ctx, flash, formValues, status) {
  const applications = await store.listApplications(ctx.network.id);
  const mine = applications
    .filter((a) => a.invitedByMemberId === ctx.member.id)
    .slice(0, 30)
    .map((a) => ({
      ...a,
      tradeLabel: a.tradeSlug ? trades.tradeLabel(a.tradeSlug, ctx.network) : '',
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

function reviewPageLocals(member, extras) {
  const reviewUrl = notify.reviewPageLink(member);
  const shareImagePath = reviewShareImage.shareImagePath(member.reviewSlug, 'default');
  const hasCustomLogo = reviewShareImage.hasCustomLogo(member);
  return {
    reviewUrl,
    reviewPath: `/rv/${member.reviewSlug}`,
    platforms: reviewPage.PLATFORMS,
    otherRows: reviewPage.otherFormRows(member.reviewLinks),
    linkCount: reviewPage.countLinks(member.reviewLinks),
    shareImagePath: `${shareImagePath}?v=${encodeURIComponent(member.reviewShareImageUpdatedAt || 'default')}`,
    shareImageUrl: reviewShareImage.shareImageAbsoluteUrl(member.reviewSlug, 'default'),
    hasCustomShareImage: !!member.reviewShareImageUpdatedAt,
    hasCustomLogo,
    reviewLogoPath: hasCustomLogo
      ? reviewShareImage.reviewLogoPath(member.reviewSlug, member.reviewLogoUpdatedAt)
      : '',
    ...(extras || {}),
  };
}

async function renderReview(req, res, ctx, flash, status, formValues) {
  const member = await ensureReviewSetup(ctx);
  const [stats, feedback, messaging] = await Promise.all([
    store.getReviewStats(ctx.network.id, member.id),
    store.listFeedback(ctx.network.id, member.id),
    notify.messagingReadyForNetwork(ctx.network),
  ]);
  const totalStars = Object.values(stats.stars).reduce((a, b) => a + b, 0);
  const q = req.query || {};
  const defaults = {
    phone: String((formValues && formValues.phone) || q.phone || '').trim(),
    email: String((formValues && formValues.email) || q.email || '').trim(),
    name: String((formValues && formValues.name) || q.name || '').trim(),
    channel: String((formValues && formValues.channel) || q.channel || 'auto').trim() || 'auto',
    useAi: formValues && Object.prototype.hasOwnProperty.call(formValues, 'useAi')
      ? !!formValues.useAi
      : String(q.useAi || '1') !== '0',
  };
  const reviewUrl = notify.reviewPageLink(member);
  const smsScript = reviewRequestScript.memberSmsScript(member);
  const ghlWorkflowPrompt = reviewRequestScript.buildGhlReviewWorkflowPrompt({
    companyName: member.companyName,
    reviewLink: reviewUrl,
    smsScript,
  });
  return render(res, 'review', { ...ctx, member }, reviewPageLocals(member, {
    stats,
    totalStars,
    totalClicks: Object.values(stats.clicks).reduce((a, b) => a + b, 0),
    feedback: feedback.slice(0, 10).map((f) => ({ ...f, when: when(f.createdAt) })),
    askShare: String(q.ask || '') === '1',
    messaging,
    formValues: defaults,
    smsScript,
    defaultSmsScript: reviewRequestScript.DEFAULT_SMS_SCRIPT,
    ghlWorkflowPrompt,
    flash: flash || flashFromQuery(req),
  }), status);
}

async function renderReviewSettings(req, res, ctx, flash, status) {
  const member = await ensureReviewSetup(ctx);
  return render(res, 'review_settings', { ...ctx, member }, {
    ...reviewPageLocals(member),
    active: 'review',
    flash: flash || flashFromQuery(req),
  }, status);
}

router.get('/m/:token/review', withMember((req, res, ctx) => renderReview(req, res, ctx)));
router.get('/m/:token/review/settings', withMember((req, res, ctx) => renderReviewSettings(req, res, ctx)));

router.post('/m/:token/review', form, withMember(async (req, res, ctx) => {
  const body = req.body || {};
  const toSettings = String(body.next || '') === 'settings';
  const links = store.normalizeReviewLinks(reviewPage.linksFromForm(body));
  const rejected = reviewPage.firstRejectedLink(body, links);
  if (rejected) {
    const errFlash = { error: `That ${rejected} link doesn't look like a web address.` };
    return toSettings
      ? renderReviewSettings(req, res, ctx, errFlash, 400)
      : renderReview(req, res, ctx, errFlash, 400);
  }
  await store.saveMember(ctx.network.id, { ...ctx.member, reviewLinks: links });
  return res.redirect(303, `${ctx.base}/review${toSettings ? '/settings' : ''}?ok=saved`);
}));

/** Save the AI/GHL review SMS script (placeholders {{name}}, {{company}}, {{review_link}}). */
router.post('/m/:token/review/script', form, withMember(async (req, res, ctx) => {
  const member = await ensureReviewSetup(ctx);
  const body = req.body || {};
  const script = reviewRequestScript.cleanScript(body.smsScript);
  const saved = await store.saveMember(ctx.network.id, {
    ...member,
    reviewSmsScript: script || reviewRequestScript.DEFAULT_SMS_SCRIPT,
  });
  if (String(body.next || '') === 'stay') {
    return renderReview(req, res, { ...ctx, member: saved }, { ok: OK_MESSAGES.script_saved });
  }
  return res.redirect(303, `${ctx.base}/review?ok=script_saved`);
}));

/** Save or clear the default link-preview image shown when the review link is shared. */
router.post('/m/:token/review/share-image', (req, res, next) => {
  const ct = String(req.headers['content-type'] || '');
  if (ct.includes('multipart/form-data')) return withReviewUpload('shareImage')(req, res, next);
  return form(req, res, next);
}, withMember(async (req, res, ctx) => {
  const member = await ensureReviewSetup(ctx);
  const body = req.body || {};
  const toSettings = String(body.next || '') === 'settings';
  const settingsPath = `${ctx.base}/review${toSettings ? '/settings' : ''}`;
  if (body.remove === '1' || body.remove === 'on') {
    await reviewShareImage.deleteDefaultShareImage(ctx.network.id, member.id);
    await store.saveMember(ctx.network.id, { ...member, reviewShareImageUpdatedAt: '' });
    return res.redirect(303, `${settingsPath}?ok=share_image_cleared`);
  }
  if (!req.file || !req.file.buffer) {
    const errFlash = { error: 'Choose a photo to use as the link preview.' };
    return toSettings
      ? renderReviewSettings(req, res, { ...ctx, member }, errFlash, 400)
      : renderReview(req, res, { ...ctx, member }, errFlash, 400);
  }
  try {
    const prepared = await reviewShareImage.prepareShareImage(req.file.buffer);
    const stamp = await reviewShareImage.saveDefaultShareImage(ctx.network.id, member.id, prepared);
    await store.saveMember(ctx.network.id, { ...member, reviewShareImageUpdatedAt: stamp });
    return res.redirect(303, `${settingsPath}?ok=share_image_saved`);
  } catch (err) {
    const errFlash = { error: err.message || 'Could not save that image.' };
    return toSettings
      ? renderReviewSettings(req, res, { ...ctx, member }, errFlash, 400)
      : renderReview(req, res, { ...ctx, member }, errFlash, 400);
  }
}));

/** Save or clear the logo shown on the public review request page (/rv/:slug). */
router.post('/m/:token/review/logo', (req, res, next) => {
  const ct = String(req.headers['content-type'] || '');
  if (ct.includes('multipart/form-data')) return withReviewUpload('logo')(req, res, next);
  return form(req, res, next);
}, withMember(async (req, res, ctx) => {
  const member = await ensureReviewSetup(ctx);
  const body = req.body || {};
  const settingsPath = `${ctx.base}/review/settings`;
  if (body.remove === '1' || body.remove === 'on') {
    await reviewShareImage.deleteReviewLogo(ctx.network.id, member.id);
    await store.saveMember(ctx.network.id, { ...member, reviewLogoUpdatedAt: '' });
    return res.redirect(303, `${settingsPath}?ok=logo_cleared`);
  }
  if (!req.file || !req.file.buffer) {
    return renderReviewSettings(req, res, { ...ctx, member }, {
      error: 'Choose a logo image for your review request page.',
    }, 400);
  }
  try {
    const prepared = await reviewShareImage.prepareReviewLogo(req.file.buffer);
    const stamp = await reviewShareImage.saveReviewLogo(ctx.network.id, member.id, prepared);
    await store.saveMember(ctx.network.id, { ...member, reviewLogoUpdatedAt: stamp });
    return res.redirect(303, `${settingsPath}?ok=logo_saved`);
  } catch (err) {
    return renderReviewSettings(req, res, { ...ctx, member }, {
      error: err.message || 'Could not save that logo.',
    }, 400);
  }
}));

/** Send a review request to a customer through the network workspace's GHL SMS/email. */
router.post('/m/:token/review/send', withReviewUpload('shareImage'), withMember(async (req, res, ctx) => {
  const member = await ensureReviewSetup(ctx);
  const body = req.body || {};
  const rawAi = Array.isArray(body.useAi) ? body.useAi[body.useAi.length - 1] : body.useAi;
  const formValues = {
    phone: String(body.phone || '').trim(),
    email: String(body.email || '').trim(),
    name: String(body.name || '').trim(),
    channel: String(body.channel || 'auto').trim() || 'auto',
    useAi: rawAi === undefined || rawAi === ''
      ? true
      : !(String(rawAi) === '0' || String(rawAi).toLowerCase() === 'false'),
    keepShareImage: body.keepShareImage === '1' || body.keepShareImage === 'on',
  };
  if (!reviewPage.countLinks(member.reviewLinks)) {
    return renderReview(req, res, { ...ctx, member }, {
      error: 'Add at least one review link in Settings before sending a request.',
    }, 400, formValues);
  }
  if (ctx.member.status !== 'active') {
    return renderReview(req, res, { ...ctx, member }, {
      error: 'Your membership is paused, so review requests can’t be sent.',
    }, 403, formValues);
  }

  let imageId = '';
  let memberForSend = member;
  if (req.file && req.file.buffer) {
    try {
      const prepared = await reviewShareImage.prepareShareImage(req.file.buffer);
      if (formValues.keepShareImage) {
        const stamp = await reviewShareImage.saveDefaultShareImage(ctx.network.id, member.id, prepared);
        memberForSend = await store.saveMember(ctx.network.id, { ...member, reviewShareImageUpdatedAt: stamp });
      } else {
        imageId = await reviewShareImage.saveRequestShareImage(ctx.network.id, member.id, prepared);
      }
    } catch (err) {
      return renderReview(req, res, { ...ctx, member }, {
        error: err.message || 'Could not use that preview image.',
      }, 400, formValues);
    }
  }

  const result = await notify.sendReviewRequest({
    network: ctx.network,
    member: memberForSend,
    baseUrl: notify.baseUrlFromReq(req),
    toPhone: formValues.phone,
    toEmail: formValues.email,
    customerName: formValues.name,
    channel: formValues.channel,
    useAi: formValues.useAi,
    imageId,
  });
  if (!result.ok) {
    return renderReview(req, res, { ...ctx, member: memberForSend }, { error: result.error || 'Could not send.' }, 400, formValues);
  }
  const ok = result.channel === 'email' ? 'review_email' : 'review_sms';
  return res.redirect(303, `${ctx.base}/review?ok=${ok}`);
}));

// ── Leads (website forms + agency push) live in the partner app ─────────────

function flashLeads(req) {
  const ok = String(req.query.ok || '');
  if (ok === 'closed') return { ok: 'Lead marked closed.' };
  if (ok === 'push') return { ok: 'Lead alerts are on for this phone.' };
  return flashFromQuery(req);
}

router.get('/m/:token/leads', withMember(async (req, res, ctx) => {
  const appt = ctx.appointment;
  return render(res, 'leads', ctx, {
    formLeads: appt ? (appt.formLeads || []) : [],
    openLeadCount: appt ? (appt.openLeadCount || 0) : 0,
    leadCredits: appt ? (appt.leadCredits || { remaining: 0 }) : { remaining: 0 },
    flash: flashLeads(req),
  });
}));

router.post('/m/:token/leads/:leadId/close', form, withMember(async (req, res, ctx) => {
  if (!ctx.appointment) {
    return res.redirect(303, `${ctx.base}/leads`);
  }
  const leadId = String(req.params.leadId || '').trim();
  const pkg = ctx.appointment.package;
  const formLeads = (pkg.formLeads || []).map((f) =>
    (f.id === leadId ? { ...f, status: 'closed' } : f),
  );
  await appointmentPackages.updatePackage(ctx.appointment.workspaceId, ctx.appointment.packageId, { formLeads });
  return res.redirect(303, `${ctx.base}/leads?ok=closed`);
}));

/** Web Push for lead alerts — scoped to the linked appointment package. */
router.get('/m/:token/push/key', withMember(async (req, res) => {
  const push = require('../services/pushNotifications');
  return res.json({ success: true, publicKey: push.publicKey() });
}));

router.post('/m/:token/push/subscribe', express.json(), withMember(async (req, res, ctx) => {
  if (!ctx.appointment) {
    return res.status(400).json({ success: false, error: 'Link an appointment package to get lead alerts.' });
  }
  const push = require('../services/pushNotifications');
  const result = push.savePortalSubscription({
    subscription: req.body && req.body.subscription,
    workspaceId: ctx.appointment.workspaceId,
    packageId: ctx.appointment.packageId,
    userAgent: req.get('user-agent'),
  });
  if (!result.ok) return res.status(400).json({ success: false, error: result.error });
  return res.json({ success: true });
}));

router.post('/m/:token/push/unsubscribe', express.json(), withMember(async (req, res, ctx) => {
  const push = require('../services/pushNotifications');
  const endpoint = req.body && req.body.endpoint;
  if (endpoint && ctx.appointment) {
    push.removePortalSubscription(endpoint, ctx.appointment.packageId);
  }
  return res.json({ success: true });
}));

router.post('/m/:token/push/test', express.json(), withMember(async (req, res, ctx) => {
  if (!ctx.appointment) {
    return res.status(400).json({ success: false, error: 'No package linked.' });
  }
  const push = require('../services/pushNotifications');
  const { sent } = await push.sendPortalPush(
    { packageId: ctx.appointment.packageId, workspaceId: ctx.appointment.workspaceId },
    {
      title: 'Lead alerts are on',
      body: `You’ll get website and agency leads for ${ctx.appointment.package.businessName} here.`,
      url: `${ctx.base}/leads`,
      tag: 'member-push-test',
    },
  );
  return res.json({ success: true, sent });
}));

router.get('/m/:token/packages', withMember(async (req, res, ctx) => {
  if (!ctx.appointment) {
    return renderInvalid(res, 404, 'No contractor app is linked yet. Ask your agency to sell you appointments.');
  }
  return res.redirect(303, ctx.appointment.portalPackagesPath);
}));

router.get('/m/:token/contractor-app', withMember(async (req, res, ctx) => {
  if (!ctx.appointment) {
    return renderInvalid(res, 404, 'No contractor app is linked yet. Ask your agency to sell you appointments.');
  }
  return res.redirect(303, ctx.appointment.portalPath);
}));

module.exports = router;
module.exports.googleReviewUrlFromLead = googleReviewUrlFromLead;
module.exports.phoneDigits = phoneDigits;
