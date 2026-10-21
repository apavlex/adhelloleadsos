/**
 * Partner app (installable PWA), white-labeled per network. No login:
 * the signed member token lives in the path so a Home Screen bookmark keeps working.
 *
 * Hierarchy: reviews → customers/work → referrals & leads.
 *
 *   /m/:token            Home
 *   /m/:token/profile    profile photo + contact + settings hub
 *   /m/:token/review     QR / share + send review requests
 *   /m/:token/review/settings  review links + default preview image
 *   /m/:token/customers  customers, jobs and schedule
 *   /m/:token/voice/transcribe  field speech-to-text (Reviews + paid apps)
 *   /m/:token/voice/parse-customer  turn spoken blob into customer fields
 *   /m/:token/referrals  website/agency leads + network referrals (Leads & Referrals)
 *   /m/:token/send       send a referral (partners)
 *   /m/:token/join       free-plan upgrade / benefits (replaces Send in the tab bar)
 *   /m/:token/leads      redirects to /referrals (legacy)
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
const memberCustomerCsv = require('../services/memberCustomerCsv');
const memberCustomerGhl = require('../services/memberCustomerGhl');
const memberCustomerGhlActivity = require('../services/memberCustomerGhlActivity');
const reviewPage = require('../services/reviewPage');
const reviewRequestScript = require('../services/reviewRequestScript');
const reviewShareImage = require('../services/reviewShareImage');
const reviewAsk = require('../services/reviewAsk');
const reviewReferralReward = require('../services/reviewReferralReward');
const memberLeadRequests = require('../services/memberLeadRequests');
const memberActivity = require('../services/memberActivity');
const memberGhlAlerts = require('../services/memberGhlAlerts');
const { GHL_ACTIVITY_TYPES } = require('../services/inboundEvents');
const freeAppSignup = require('../services/freeAppSignup');
const freeAppListWorkspace = require('../services/freeAppListWorkspace');
const memberShareInvite = require('../services/memberShareInvite');
const jobMedia = require('../services/memberJobMedia');
const contractorPortal = require('../services/contractorPortal');
const memberAppointmentLink = require('../services/memberAppointmentLink');
const appointmentPackages = require('../services/appointmentPackages');
const { verifyNetworkToken, createMemberPortalToken } = require('../services/networkLinkSign');
const memberShortLinks = require('../services/memberShortLinks');
const ownerAppBrand = require('../services/ownerAppBrand');
const whiteLabel = require('../services/whiteLabel');
const demoWorkspace = require('../services/demoWorkspace');
const workspaceTeammatePush = require('../services/workspaceTeammatePush');
const workspaceService = require('../services/workspaceService');
const { getPublicBaseUrl } = require('../lib/publicBaseUrl');
const { ICONS } = require('../services/memberAppIcons');
const voiceTranscription = require('../services/voiceTranscription');
const memberVoiceCustomerParse = require('../services/memberVoiceCustomerParse');

/** Invite line pasted/shared with Review app short links (/a/…). */
const REVIEW_APP_SHARE_INVITE = 'Here is a link to view and save your reviews app!';

/** Soft GHL pull for owner Home so customer counts match CRM (15 min TTL). */
const OWNER_GHL_SYNC_MS = 15 * 60 * 1000;
/** Prevent stacked background syncs when Home is hit repeatedly. */
const ownerGhlSyncInflight = new Set();

async function maybeSyncOwnerCustomers(ctx) {
  if (!ctx || !ctx.member || !ctx.network) return;
  if (freeAppSignup.isAppFreeMember(ctx.member)) return;
  if (!ownerAppBrand.isOwnerMember(ctx.member, ctx.network)) return;
  // Demo workspaces never connect to GHL — sample customers are seeded locally.
  const wid = ctx.network.ownerWorkspaceId;
  if (wid) {
    try {
      const ws = await dbService.getWorkspace(wid);
      if (ws && ws.isDemo) return;
    } catch (_) { /* ignore */ }
  }
  const last = Date.parse(ctx.member.customersGhlSyncedAt || '') || 0;
  if (last && Date.now() - last < OWNER_GHL_SYNC_MS) return;
  try {
    await memberCustomerGhl.syncCustomersWithGhl(ctx.network, ctx.member.id, {
      maxPages: 3,
      pushLimit: 50,
    });
  } catch (err) {
    console.warn('[member] owner GHL customer sync skipped:', err && err.message ? err.message : err);
  }
  // Stamp even on soft failure so we don't retry every Home load (15 min TTL).
  try {
    const saved = await store.saveMember(ctx.network.id, {
      ...ctx.member,
      customersGhlSyncedAt: new Date().toISOString(),
    });
    ctx.member = saved || ctx.member;
  } catch (_) { /* ignore */ }
}

/** Run owner GHL sync after Home HTML is on its way — never block TTFB. */
function scheduleOwnerCustomerSync(ctx) {
  if (!ctx || !ctx.member || !ctx.network) return;
  if (freeAppSignup.isAppFreeMember(ctx.member)) return;
  if (!ownerAppBrand.isOwnerMember(ctx.member, ctx.network)) return;
  const last = Date.parse(ctx.member.customersGhlSyncedAt || '') || 0;
  if (last && Date.now() - last < OWNER_GHL_SYNC_MS) return;
  const key = `${ctx.network.id}:${ctx.member.id}`;
  if (ownerGhlSyncInflight.has(key)) return;
  ownerGhlSyncInflight.add(key);
  setImmediate(() => {
    maybeSyncOwnerCustomers(ctx)
      .catch(() => {})
      .finally(() => ownerGhlSyncInflight.delete(key));
  });
}

/** Cache-bust version for <link rel="icon"> without decoding image buffers. */
function appIconVersionHint(ctx) {
  // Prefer business logo over profile photo (matches resolveAppIconSource).
  if (ctx && ctx.brand && ctx.brand.fromWorkspace && ctx.brand.logoUrl) {
    return String(ctx.brand.logoUrl);
  }
  if (ctx && ctx.brand && ctx.brand.logoUrl) {
    return String(ctx.brand.logoUrl);
  }
  if (ctx && ctx.member && ctx.member.profilePhotoUpdatedAt) {
    return String(ctx.member.profilePhotoUpdatedAt);
  }
  return String((ctx && ctx.brand && ctx.brand.accent) || '1');
}

const router = express.Router();
const form = express.urlencoded({ extended: true, limit: '64kb' });
const reviewUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: reviewShareImage.MAX_UPLOAD_BYTES, files: 1 },
  fileFilter(req, file, cb) {
    const ok = /^image\/(jpeg|jpg|png|webp|gif|heic|heif)$/i.test(String(file.mimetype || ''));
    cb(ok ? null : new Error('Upload a JPG, PNG, WebP, GIF, or HEIC image.'), ok);
  },
});
const customerImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024, files: 1 },
  fileFilter(req, file, cb) {
    const name = String(file.originalname || '');
    const mime = String(file.mimetype || '');
    const ok =
      /\.(csv|xlsx|xls|txt)$/i.test(name) ||
      /csv|excel|spreadsheet|text\/plain|octet-stream/i.test(mime);
    cb(ok ? null : new Error('Upload a CSV or Excel (.xlsx) customer list.'), ok);
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
  script_saved: 'Review SMS script saved. AI will use it when you send via GHL CRM.',
  share_image_saved: 'Link preview image saved. Messages will show this photo.',
  share_image_cleared: 'Custom preview image removed. The AdHello default will be used.',
  logo_saved: 'Review page logo saved. Customers will see it on your request page.',
  logo_cleared: 'Custom logo removed. Your review page will use the network logo or initials.',
  hero_saved: 'Home banner image updated.',
  hero_cleared: 'Home banner image removed.',
  profile_saved: 'Profile saved.',
  photo_saved: 'Profile photo saved.',
  photo_cleared: 'Profile photo removed.',
  branding_saved: 'App branding saved. Same logo and name as Workspace → White label. Re-add the app to refresh the Home Screen icon (iPhone keeps the old one until then).',
  branding_cleared: 'App logo removed from Workspace → White label.',
  review_sms: 'Review request sent by text via GHL CRM.',
  review_email: 'Review request sent by email via GHL CRM.',
  customer: 'Customer saved.',
  customer_deleted: 'Customer deleted.',
  tag: 'Tags updated and synced with GHL CRM.',
  job: 'Job saved.',
  job_deleted: 'Job deleted.',
  job_photo: 'Photo saved.',
  job_photo_deleted: 'Photo removed.',
  job_photo_note: 'Photo note saved.',
  moved: 'Job updated.',
  converted: 'Added to your customers.',
  already: 'That referral is already in your customers.',
  customers_imported: 'Customer list imported.',
  customers_synced: 'Customers synced with your CRM.',
  crm_sync_upgrade: 'CRM sync is on the monthly plan. Upgrade to activate it.',
  referrals_upgrade: 'Referrals are on the monthly plan. Upgrade to start getting referrals for your business.',
  review_send_upgrade: 'Texting and emailing review requests needs a GHL CRM account on the monthly plan. Use Share or QR for free, or upgrade to send via GHL CRM.',
  leads_requested: 'Lead request sent — your agency was pinged that you’re ready for more work.',
  closed: 'Lead marked closed.',
  push: 'Lead alerts are on for this phone.',
  reward_saved: 'Referral reward settings saved.',
  reward_sent: 'Review confirmed — referral reward offer sent to the customer.',
  reward_skipped: 'Skipped — no referral reward sent for this review.',
  reward_upgrade: 'Referral rewards and customer referral offers are on the monthly plan. Upgrade to unlock them.',
  job_shared: 'Shared with your teammate — they got the contact, projects, and a text/email link.',
  customer_shared: 'Shared with your teammate — they got this contact, all projects, and a text/email link.',
  share_invited: 'Invite sent — they’ll join on the spot and get this contact plus all projects.',
  share_existing: 'They’re already on your network — contact and projects are on their book.',
  lead_referred: 'Sent to your partner — they got the lead details and a text/email.',
  lead_referred_pool: 'Sent to the network pool — eligible partners can claim it.',
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

function profilePhotoUrl(base, member) {
  if (!member || !member.profilePhotoUpdatedAt) return '';
  const v = encodeURIComponent(member.profilePhotoUpdatedAt);
  return `${base}/avatar.png?v=${v}`;
}

function hasProfilePhoto(member) {
  return !!(member && member.profilePhotoUpdatedAt);
}

async function attachAppointment(ctx) {
  const workspaceId = ctx.network && ctx.network.ownerWorkspaceId;
  if (!workspaceId) return { ...ctx, appointment: null };
  const pkg = await memberAppointmentLink.findPackageForMember(workspaceId, ctx.member, ctx.network);
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

  // Owner with no referral partners: show website/agency leads from every package.
  const isOwner = memberAppointmentLink.isOwnerMember(ctx.member, ctx.network);
  if (isOwner && !(await memberAppointmentLink.networkHasReferralPartners(ctx.network))) {
    const allLeads = await memberAppointmentLink.listOwnerFormLeads(workspaceId, { limit: 40 });
    if (allLeads.length) {
      home.formLeads = allLeads;
      home.openLeadCount = allLeads.filter((f) => f && f.status !== 'closed').length;
    }
  }

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
      portalLeadsPath: `${ctx.base}/referrals`,
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
  const pathBase = `/m/${encodeURIComponent(token)}`;
  const free = freeAppSignup.isAppFreeMember(member);
  const memberHeroUrl = free && member.heroUpdatedAt
    ? `${pathBase}/hero.jpg?v=${encodeURIComponent(member.heroUpdatedAt)}`
    : '';
  const baseBrand = networkBrand.brandView(network, member, { heroUrl: memberHeroUrl });
  const brand = await ownerAppBrand.applyWorkspaceBrand(baseBrand, network, member);
  const draft = {
    network,
    member,
    token,
    base: pathBase,
    brand,
    greetingName: firstName(member),
    profilePhotoUrl: profilePhotoUrl(pathBase, member),
    hasProfilePhoto: hasProfilePhoto(member),
    isAppFree: free,
    appointment: null,
  };
  // Don't decode logo/photo buffers on every page — only for /icon-*.png routes.
  draft.appIconVersion = appIconVersionHint(draft);
  return attachAppointment(draft);
}

/**
 * Demo Review apps: backfill sample customers / photos / socials when the
 * workspace was created before rich seed (or never Reset). Owner only.
 * Reloads member + brand when seed ran so Home shows the new hero.
 */
async function maybeEnsureDemoOwnerReviewApp(ctx) {
  if (!ctx || !ctx.network || !ctx.member) return ctx;
  if (!ownerAppBrand.isOwnerMember(ctx.member, ctx.network)) return ctx;
  const wid = ctx.network.ownerWorkspaceId;
  if (!wid) return ctx;
  let out;
  try {
    out = await demoWorkspace.ensureDemoOwnerReviewApp(wid, {
      email: ctx.member.email || '',
    });
  } catch (err) {
    console.warn('[member] demo Review app seed skipped:', err && err.message ? err.message : err);
    return ctx;
  }
  if (!out || !out.seeded) return ctx;
  const network = await store.getNetwork(ctx.network.id) || ctx.network;
  const member = await store.getMember(network.id, ctx.member.id) || ctx.member;
  const free = freeAppSignup.isAppFreeMember(member);
  const memberHeroUrl = free && member.heroUpdatedAt
    ? `${ctx.base}/hero.jpg?v=${encodeURIComponent(member.heroUpdatedAt)}`
    : '';
  const baseBrand = networkBrand.brandView(network, member, { heroUrl: memberHeroUrl });
  const brand = await ownerAppBrand.applyWorkspaceBrand(baseBrand, network, member);
  return {
    ...ctx,
    network,
    member,
    brand,
    greetingName: firstName(member),
    profilePhotoUrl: profilePhotoUrl(ctx.base, member),
    hasProfilePhoto: hasProfilePhoto(member),
    appIconVersion: appIconVersionHint({ member, brand }),
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
    googleMapsSearchUrl: work.googleMapsSearchUrl,
    ...(extra || {}),
  });
}

const ERR_MESSAGES = {
  hero: 'Could not update the banner image. Try a JPG, PNG, WebP, or GIF under 6 MB.',
  photo: 'Could not update the profile photo. Try a JPG, PNG, WebP, or GIF under 6 MB.',
  job_photo: 'Could not save that photo. Try a JPG, PNG, WebP, GIF, or HEIC under 6 MB.',
  leads_subscribe: 'Requesting leads is on the monthly plan. The app stays free — subscribe to unlock leads, SMS, and email.',
  leads_cooldown: 'You already requested leads recently. Your agency was pinged — try again tomorrow.',
  leads_request: 'Could not send that lead request. Try again.',
};

function flashFromQuery(req) {
  const ok = OK_MESSAGES[String(req.query.ok || '')];
  if (ok) {
    const detail = String(req.query.detail || '').trim().slice(0, 180);
    return { ok: detail ? `${ok} ${detail}` : ok };
  }
  const error = ERR_MESSAGES[String(req.query.err || '')];
  if (error) return { error };
  const errMsg = String(req.query.errmsg || '').trim().slice(0, 200);
  return errMsg ? { error: errMsg } : null;
}

function withMember(handler) {
  return async (req, res) => {
    try {
      const ctx = await loadContext(req.params.token);
      if (!ctx) return renderInvalid(res);
      if (freeAppSignup.isAppTrialExpired(ctx.member)) {
        return renderInvalid(
          res,
          403,
          'Your 30-day reviews app trial has ended. Ask your agency to activate your account.',
        );
      }
      ctx.appTrial = freeAppSignup.appTrialStatus(ctx.member);
      return await handler(req, res, ctx);
    } catch (err) {
      console.error('[member-app]', req.method, req.path.replace(/\/m\/[^/]+/, '/m/:token'), err.message);
      return renderInvalid(res, 500, 'Something went wrong. Try again in a moment.');
    }
  };
}

/** Same as withMember but always returns JSON (voice / API helpers). */
function withMemberApi(handler) {
  return async (req, res) => {
    try {
      const ctx = await loadContext(req.params.token);
      if (!ctx) return res.status(401).json({ success: false, error: 'Open your app link again.' });
      if (freeAppSignup.isAppTrialExpired(ctx.member)) {
        return res.status(403).json({
          success: false,
          error: 'Your 30-day reviews app trial has ended. Ask your agency to activate your account.',
        });
      }
      ctx.appTrial = freeAppSignup.appTrialStatus(ctx.member);
      return await handler(req, res, ctx);
    } catch (err) {
      console.error('[member-app]', req.method, req.path.replace(/\/m\/[^/]+/, '/m/:token'), err.message);
      return res.status(500).json({ success: false, error: 'Something went wrong. Try again in a moment.' });
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
  const photos = (job.photos || []).map((p) => ({
    ...p,
    href: `${base}/customers/jobs/${job.id}/photos/${p.id}`,
  }));
  return {
    ...job,
    photos,
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

function shortWhen(iso) {
  const ms = Date.parse(iso || '');
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Status chip for the latest review ask on a customer. */
function presentReviewAskStatus(ask) {
  if (!ask) return null;
  if (ask.rewardSentAt) {
    return {
      status: 'reward_sent',
      label: 'Referral reward sent',
      detail: [
        ask.rating ? `${ask.rating}★` : '',
        ask.reviewConfirmedAt ? `Confirmed ${shortWhen(ask.reviewConfirmedAt)}` : '',
        `Offer sent ${shortWhen(ask.rewardSentAt)}`,
      ].filter(Boolean).join(' · '),
      askId: ask.id,
      rating: ask.rating || 0,
      channel: ask.channel,
    };
  }
  if (ask.rewardSkippedAt) {
    return {
      status: 'reward_skipped',
      label: 'Reward skipped',
      detail: ask.rating
        ? `${ask.rating}★ · skipped ${shortWhen(ask.rewardSkippedAt)}`
        : `Skipped ${shortWhen(ask.rewardSkippedAt)}`,
      askId: ask.id,
      rating: ask.rating || 0,
      channel: ask.channel,
    };
  }
  if (reviewAsk.pendingRewardConfirm(ask)) {
    return {
      status: 'reward_pending',
      label: `${ask.rating || 5}★ — confirm their review`,
      detail: 'When you see the public review, confirm to text them your referral reward offer.',
      askId: ask.id,
      rating: ask.rating || 0,
      canConfirm: true,
      channel: ask.channel,
    };
  }
  if (ask.reviewConfirmedAt && !ask.rewardSentAt) {
    return {
      status: 'reward_pending',
      label: 'Review confirmed — send reward',
      detail: 'Confirm again to retry sending the referral reward offer.',
      askId: ask.id,
      rating: ask.rating || 0,
      canConfirm: true,
      channel: ask.channel,
    };
  }
  const engaged = reviewAsk.isEngaged(ask);
  let status = 'asked';
  let label = 'Asked';
  if (ask.clickedAt) {
    status = 'clicked';
    label = 'Clicked a review site';
  } else if (ask.openedAt) {
    status = 'opened';
    label = 'Opened the review link';
  } else if (ask.remindedAt) {
    status = 'reminded';
    label = 'Reminded';
  } else if (ask.ratedAt && ask.rating >= 4) {
    status = 'rated';
    label = `${ask.rating}★ on review page`;
  }
  const bits = [];
  if (ask.askedAt) bits.push(`${ask.channel === 'email' ? 'Emailed' : 'Texted'} ${shortWhen(ask.askedAt)}`);
  if (ask.openedAt && !ask.clickedAt) bits.push(`Opened ${shortWhen(ask.openedAt)}`);
  if (ask.clickedAt) bits.push(`Clicked ${shortWhen(ask.clickedAt)}`);
  if (ask.ratedAt && ask.rating) bits.push(`${ask.rating}★ ${shortWhen(ask.ratedAt)}`);
  if (ask.remindedAt) bits.push(`Reminded ${shortWhen(ask.remindedAt)}`);
  else if (!engaged && ask.remindAfterAt) bits.push('Auto-reminder if no click in ~48h');
  return {
    status,
    label,
    detail: bits.join(' · '),
    askId: ask.id,
    rating: ask.rating || 0,
    channel: ask.channel,
  };
}

function presentPendingReward(ask) {
  if (!ask || !reviewAsk.pendingRewardConfirm(ask)) return null;
  return {
    askId: ask.id,
    name: ask.name || 'Customer',
    rating: ask.rating || 5,
    customerId: ask.customerId || '',
    phone: ask.phone || '',
    when: shortWhen(ask.ratedAt || ask.rewardNotifiedAt),
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

/**
 * Resolve a short /a/:code to network + member, or render invalid.
 * @returns {Promise<{ code: string, network: object, member: object }|null>}
 */
async function loadShortAppTarget(req, res) {
  const code = memberShortLinks.cleanCode(req.params.code);
  if (!code) {
    await renderInvalid(res);
    return null;
  }
  const row = await memberShortLinks.readCode(code);
  if (!row) {
    await renderInvalid(res, 404, 'That app link is invalid or expired.');
    return null;
  }
  const network = await store.getNetwork(row.networkId);
  const member = network ? await store.getMember(network.id, row.memberId) : null;
  if (!network || !member) {
    await renderInvalid(res, 404, 'That app link is invalid or expired.');
    return null;
  }
  if (member.status === 'paused') {
    await renderInvalid(res, 403, 'Your membership is paused. Contact the network.');
    return null;
  }
  if (freeAppSignup.isAppTrialExpired(member)) {
    await renderInvalid(
      res,
      403,
      'Your 30-day reviews app trial has ended. Ask your agency to activate your account.',
    );
    return null;
  }
  return { code, network, member };
}

/**
 * Short SMS links: /a/:code → /m/:signedToken (path + query preserved).
 * Example: /a/x7k2m9qp/review?ask=1
 */
async function redirectShortAppLink(req, res) {
  noStore(res);
  const target = await loadShortAppTarget(req, res);
  if (!target) return;
  const { code, network, member } = target;
  const token = createMemberPortalToken({ networkId: network.id, memberId: member.id });
  const prefix = `/a/${code}`;
  const original = String(req.originalUrl || req.url || '');
  let rest = original.startsWith(prefix) ? original.slice(prefix.length) : '';
  if (rest === '/') rest = '';
  // Bare /a/:code is handled by the OG share landing (so iMessage can unfurl).
  if (!rest || rest === '/og.jpg') {
    return res.redirect(302, `/m/${encodeURIComponent(token)}`);
  }
  return res.redirect(302, `/m/${encodeURIComponent(token)}${rest}`);
}

/** Public OG image for Review-app short links — hero / share photo, crawlable. */
router.get('/a/:code/og.jpg', async (req, res, next) => {
  try {
    const target = await loadShortAppTarget(req, res);
    if (!target) return;
    const { network, member } = target;
    const brand = await ownerAppBrand.applyWorkspaceBrand(
      networkBrand.brandView(network, member),
      network,
      member,
    );
    const img = await reviewShareImage.getShareImageBuffer(network.id, member.id, 'default', {
      companyName: brand.appName || member.companyName,
      brand,
    });
    const buffer = img && img.buffer ? img.buffer : null;
    if (!buffer) return res.status(404).end();
    res.setHeader('Content-Type', img.contentType || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.end(buffer);
  } catch (err) {
    return next(err);
  }
});

/**
 * Bare /a/:code — crawlable share landing with invite copy + og:image.
 * Humans are auto-sent into the signed /m/… app; bots keep the HTML for previews.
 */
router.get('/a/:code', async (req, res, next) => {
  try {
    const target = await loadShortAppTarget(req, res);
    if (!target) return;
    const { code, network, member } = target;
    const token = createMemberPortalToken({ networkId: network.id, memberId: member.id });
    const openPath = `/m/${encodeURIComponent(token)}`;
    const brand = await ownerAppBrand.applyWorkspaceBrand(
      networkBrand.brandView(network, member),
      network,
      member,
    );
    const base = getPublicBaseUrl(req) || '';
    const ogUrl = `${base}/a/${encodeURIComponent(code)}`;
    const shareVersion = reviewShareImage.shareImageVersion(member, brand) || String(Date.now());
    const ogImageUrl = `${base}/a/${encodeURIComponent(code)}/og.jpg?v=${encodeURIComponent(shareVersion)}`;
    const appName = brand.appName || member.companyName || 'Review app';
    const iconUrl = brand.logoUrl
      ? `${openPath}/icon-192.png`
      : '/images/adhello-app-icon-192.png';
    // Public + indexable so iMessage/SMS can load og:image (noindex kills unfurls).
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=120');
    res.setHeader('Referrer-Policy', 'no-referrer');
    return res.status(200).render('member_app/app_link_share', {
      brand,
      ogTitle: `${appName} — Review app`,
      ogDescription: REVIEW_APP_SHARE_INVITE,
      ogUrl,
      ogImageUrl,
      openPath,
      iconUrl,
      shareInvite: REVIEW_APP_SHARE_INVITE,
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/a/:code/*', (req, res, next) => {
  redirectShortAppLink(req, res).catch(next);
});

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

/**
 * Home Screen / PWA icon: business logo first (white-label, then network brand),
 * then profile photo, then initials. Profile pic stays in the top bar only.
 * Free-app members skip shared network logos and use their profile photo.
 */
async function resolveAppIconSource(ctx) {
  const free = !!(ctx.brand && ctx.brand.isFreeApp);
  if (!free) {
    const wsLogo = await ownerAppBrand.workspaceLogoForBrand(ctx.brand, ctx.network).catch(() => null);
    if (wsLogo && wsLogo.buffer) {
      return {
        logo: wsLogo,
        mode: 'logo',
        version: String((ctx.brand && ctx.brand.logoUrl) || ctx.brand.accent || 'ws'),
      };
    }
    const brandLogo = await store.getBrandImage(ctx.network.id, 'logo').catch(() => null);
    if (brandLogo && brandLogo.buffer) {
      return {
        logo: brandLogo,
        mode: 'logo',
        version: String(brandLogo.updatedAt || (ctx.brand && ctx.brand.logoUrl) || ctx.brand.accent || 'brand'),
      };
    }
  }
  const photo = await store.getProfilePhoto(ctx.network.id, ctx.member.id).catch(() => null);
  if (photo && photo.buffer) {
    return {
      logo: photo,
      mode: 'photo',
      version: String(ctx.member.profilePhotoUpdatedAt || photo.updatedAt || Date.now()),
    };
  }
  return {
    logo: null,
    mode: 'initials',
    version: String((ctx.brand && ctx.brand.accent) || '1'),
  };
}

function appIconUrl(base, size, version) {
  const v = encodeURIComponent(String(version || '1'));
  return `${base}/icon-${size}.png?v=${v}`;
}

router.get('/m/:token/manifest.webmanifest', withMember(async (req, res, ctx) => {
  const { brand, base } = ctx;
  const icon = await resolveAppIconSource(ctx);
  res.setHeader('Content-Type', 'application/manifest+json');
  res.setHeader('Cache-Control', 'private, max-age=60');
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
      { src: appIconUrl(base, 192, icon.version), sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: appIconUrl(base, 512, icon.version), sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: appIconUrl(base, 512, icon.version), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }));
}));

router.get('/m/:token/icon-:size.png', withMember(async (req, res, ctx) => {
  const size = [180, 192, 512].includes(parseInt(req.params.size, 10)) ? parseInt(req.params.size, 10) : 192;
  const source = await resolveAppIconSource(ctx);
  const png = await networkBrand.renderIcon({
    brand: ctx.brand,
    logo: source.logo,
    size,
    mode: source.mode,
  });
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  if (source.version) res.setHeader('ETag', `"${String(source.version).replace(/"/g, '')}"`);
  return res.end(png);
}));

router.get('/m/:token/avatar.png', withMember(async (req, res, ctx) => {
  const img = await store.getProfilePhoto(ctx.network.id, ctx.member.id);
  if (!img || !img.buffer) return res.status(404).end();
  res.setHeader('Content-Type', img.contentType || 'image/png');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  return res.end(img.buffer);
}));

/** Per-member Home hero (free-app uploads). Paid networks still use /m/brand/:id/hero. */
router.get('/m/:token/hero.jpg', withMember(async (req, res, ctx) => {
  const img = await store.getMemberHero(ctx.network.id, ctx.member.id);
  if (!img || !img.buffer) return res.status(404).end();
  res.setHeader('Content-Type', img.contentType || 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  return res.end(img.buffer);
}));

// ── Profile / settings ───────────────────────────────────────────────────────

async function ownerWorkspaceBrandForProfile(ctx) {
  if (!ctx || !ctx.network || !ctx.member) return null;
  if (freeAppSignup.isAppFreeMember(ctx.member)) return null;
  if (!ownerAppBrand.isOwnerMember(ctx.member, ctx.network)) return null;
  const wid = ctx.network.ownerWorkspaceId;
  if (!wid) return null;
  const ws = await dbService.getWorkspace(wid).catch(() => null);
  if (!ws) return null;
  return whiteLabel.brandForWorkspace(ws);
}

async function renderProfile(req, res, ctx, flash, formValues, status) {
  const member = ctx.member;
  const fv = formValues || {
    companyName: member.companyName || '',
    contactName: member.contactName || '',
    phone: member.phone || '',
    email: member.email || '',
  };
  const workspaceBrand = await ownerWorkspaceBrandForProfile(ctx);
  return render(res, 'profile', ctx, {
    active: 'profile',
    formValues: fv,
    flash: flash || flashFromQuery(req),
    workspaceBrand,
    canEditWorkspaceBrand: !!workspaceBrand,
  }, status);
}

router.get('/m/:token/profile', withMember(async (req, res, ctx) => renderProfile(req, res, ctx)));

router.post('/m/:token/profile', form, withMember(async (req, res, ctx) => {
  const body = req.body || {};
  const companyName = String(body.companyName || '').trim().slice(0, 160);
  const contactName = String(body.contactName || '').trim().slice(0, 120);
  const phone = String(body.phone || '').trim().slice(0, 40);
  const email = String(body.email || '').trim().slice(0, 200);
  const formValues = { companyName, contactName, phone, email };
  if (!companyName) {
    return renderProfile(req, res, ctx, { error: 'Add your business name.' }, formValues, 400);
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return renderProfile(req, res, ctx, { error: 'That email doesn’t look right.' }, formValues, 400);
  }
  await store.saveMember(ctx.network.id, {
    ...ctx.member,
    companyName,
    contactName,
    phone,
    email,
  });
  return res.redirect(303, `${ctx.base}/profile?ok=profile_saved`);
}));

router.post('/m/:token/profile/photo', (req, res, next) => {
  const ct = String(req.headers['content-type'] || '');
  if (!ct.includes('multipart/form-data')) return form(req, res, next);
  // Keep errors on the profile page (withMember needs to run) instead of a dead invalid screen.
  return reviewUpload.single('photo')(req, res, (err) => {
    if (err) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      req.maUploadError = tooBig
        ? 'That photo is too large (max 6 MB). Try a smaller image.'
        : (err.message || 'Could not upload that image.');
    }
    return next();
  });
}, withMember(async (req, res, ctx) => {
  if (req.maUploadError) {
    return renderProfile(req, res, ctx, { error: req.maUploadError }, null, 400);
  }
  const body = req.body || {};
  if (body.remove === '1' || body.remove === 'on') {
    await store.deleteProfilePhoto(ctx.network.id, ctx.member.id);
    await store.saveMember(ctx.network.id, { ...ctx.member, profilePhotoUpdatedAt: '' });
    return res.redirect(303, `${ctx.base}/profile?ok=photo_cleared`);
  }
  if (!req.file || !req.file.buffer) {
    return renderProfile(req, res, ctx, { error: 'Choose a photo for your profile.' }, null, 400);
  }
  try {
    const prepared = await networkBrand.prepareImage('logo', req.file.buffer);
    const stamp = await store.saveProfilePhoto(ctx.network.id, ctx.member.id, prepared);
    await store.saveMember(ctx.network.id, { ...ctx.member, profilePhotoUpdatedAt: stamp });
    return res.redirect(303, `${ctx.base}/profile?ok=photo_saved`);
  } catch (err) {
    console.error('[member-app] profile photo upload failed:', err.message);
    return renderProfile(req, res, ctx, {
      error: err.message || ERR_MESSAGES.photo,
    }, null, 400);
  }
}));

/**
 * Owner: edit Workspace → White label (app name + logo) from Profile.
 * Partners / free-app members cannot change workspace branding.
 */
router.post('/m/:token/profile/branding', (req, res, next) => {
  const ct = String(req.headers['content-type'] || '');
  if (!ct.includes('multipart/form-data')) return form(req, res, next);
  return reviewUpload.single('logo')(req, res, (err) => {
    if (err) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      req.maUploadError = tooBig
        ? 'That logo is too large (max 6 MB). Try a smaller image.'
        : (err.message || 'Could not upload that image.');
    }
    return next();
  });
}, withMember(async (req, res, ctx) => {
  if (req.maUploadError) {
    return renderProfile(req, res, ctx, { error: req.maUploadError }, null, 400);
  }
  if (freeAppSignup.isAppFreeMember(ctx.member) || !ownerAppBrand.isOwnerMember(ctx.member, ctx.network)) {
    return res.redirect(303, `${ctx.base}/profile`);
  }
  const body = req.body || {};
  const removeLogo = body.remove_logo === '1' || body.remove_logo === 'on';
  const patch = {
    appName: Object.prototype.hasOwnProperty.call(body, 'appName') ? body.appName : undefined,
    logoBuffer: req.file && req.file.buffer ? req.file.buffer : null,
    removeLogo,
  };
  if (patch.appName === undefined && !patch.logoBuffer && !removeLogo) {
    return renderProfile(req, res, ctx, { error: 'Add an app name or choose a logo.' }, null, 400);
  }
  const out = await ownerAppBrand.saveOwnerWorkspaceBranding(ctx.network, ctx.member, patch);
  if (!out.ok) {
    return renderProfile(req, res, ctx, { error: out.error || 'Could not save branding.' }, null, 400);
  }
  if (out.network) ctx.network = out.network;
  // Refresh brand overlay for the next paint if they stay on Profile.
  try {
    const baseBrand = networkBrand.brandView(ctx.network, ctx.member);
    ctx.brand = await ownerAppBrand.applyWorkspaceBrand(baseBrand, ctx.network, ctx.member);
  } catch (_) { /* ignore */ }
  return res.redirect(303, `${ctx.base}/profile?ok=${removeLogo ? 'branding_cleared' : 'branding_saved'}`);
}));

// ── Home ─────────────────────────────────────────────────────────────────────

router.get('/m/:token', withMember(async (req, res, ctx) => {
  ctx = await maybeEnsureDemoOwnerReviewApp(ctx);
  const [referrals, members, jobs, customers, reviewStats, leadRequest] = await Promise.all([
    store.listReferrals(ctx.network.id),
    store.listMembers(ctx.network.id),
    work.listJobs(ctx.network.id, ctx.member.id),
    work.listCustomers(ctx.network.id, ctx.member.id),
    store.getReviewStats(ctx.network.id, ctx.member.id),
    memberLeadRequests.leadRequestState(ctx),
  ]);
  const membersById = Object.fromEntries(members.map((m) => [m.id, m]));
  const customersById = Object.fromEntries(customers.map((c) => [c.id, c]));
  const stats = ex.memberStats(referrals, ctx.member.id);
  const leadDetailsAllowed = await memberLeadRequests.planAllowsLeadDetails(ctx.network, ctx.member);
  const waiting = referrals
    .filter((r) => r.toMemberId === ctx.member.id && r.status === 'sent')
    .slice(0, 3)
    .map((r) => memberLeadRequests.presentReferralTeaser(
      presentReceived(r, membersById, ctx.network),
      { detailsAllowed: leadDetailsAllowed },
    ));
  const today = work.todayIn(memberTimeZone(req));
  const openJobCount = jobs.filter((j) => j && ['lead', 'estimate', 'scheduled', 'in_progress', 'on_hold'].includes(String(j.status || '').toLowerCase())).length;
  // Appointment recent leads: name-only teasers for free / trial members.
  if (ctx.appointment && Array.isArray(ctx.appointment.recentLeads) && !leadDetailsAllowed) {
    ctx.appointment = {
      ...ctx.appointment,
      recentLeads: ctx.appointment.recentLeads.map((lead) =>
        memberLeadRequests.presentFormLead(lead, { detailsAllowed: false })),
      formLeads: (ctx.appointment.formLeads || []).map((lead) =>
        memberLeadRequests.presentFormLead(lead, { detailsAllowed: false })),
    };
  }
  render(res, 'home', ctx, {
    upcoming: work.upcoming(jobs, today, 2).map((j) => presentJob(j, customersById, ctx.base, today)),
    // Open jobs → customers → referrals (review visits live on the banner secondary line).
    tiles: [
      { key: 'jobs', label: 'Open jobs', value: openJobCount, href: `${ctx.base}/customers`, icon: 'customers' },
      { key: 'customers', label: 'Customers', value: customers.length, href: `${ctx.base}/customers`, icon: 'customers' },
      { key: 'pending', label: 'Pending refs', value: stats.open, href: `${ctx.base}/referrals`, icon: 'pending' },
      { key: 'sent', label: 'Sent', value: stats.given, href: `${ctx.base}/referrals?view=sent`, icon: 'send' },
    ],
    reviewViews: reviewStats.views || 0,
    customerCount: customers.length,
    openJobCount,
    wonValue: money(stats.wonValue),
    waiting,
    leadRequest,
    leadDetailsLocked: !leadDetailsAllowed,
    upgradeHref: '/signup',
    flash: flashFromQuery(req),
  });
  // CRM sync in the background so Home stays snappy on mobile.
  scheduleOwnerCustomerSync(ctx);
}));

/**
 * Upload or clear the Home banner (hero) image from the member app.
 * Free-app members store a personal hero; paid network members update the shared brand hero.
 */
router.post('/m/:token/brand/hero', (req, res, next) => {
  const ct = String(req.headers['content-type'] || '');
  if (ct.includes('multipart/form-data')) return withReviewUpload('hero')(req, res, next);
  return form(req, res, next);
}, withMember(async (req, res, ctx) => {
  const body = req.body || {};
  const free = freeAppSignup.isAppFreeMember(ctx.member);

  if (free) {
    if (body.remove === '1' || body.remove === 'on') {
      await store.deleteMemberHero(ctx.network.id, ctx.member.id);
      await store.saveMember(ctx.network.id, { ...ctx.member, heroUpdatedAt: '' });
      return res.redirect(303, `${ctx.base}?ok=hero_cleared`);
    }
    if (!req.file || !req.file.buffer) {
      return res.redirect(303, `${ctx.base}?err=hero`);
    }
    try {
      const prepared = await networkBrand.prepareImage('hero', req.file.buffer);
      const stamp = await store.saveMemberHero(ctx.network.id, ctx.member.id, prepared);
      await store.saveMember(ctx.network.id, { ...ctx.member, heroUpdatedAt: stamp });
      return res.redirect(303, `${ctx.base}?ok=hero_saved`);
    } catch (err) {
      console.error('[member-app] member hero upload failed:', err.message);
      return res.redirect(303, `${ctx.base}?err=hero`);
    }
  }

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
  const [referrals, members, jobs, leadRequest] = await Promise.all([
    store.listReferrals(ctx.network.id),
    store.listMembers(ctx.network.id),
    work.listJobs(ctx.network.id, ctx.member.id),
    memberLeadRequests.leadRequestState(ctx),
  ]);
  const membersById = Object.fromEntries(members.map((m) => [m.id, m]));
  const jobByRef = Object.fromEntries(jobs.filter((j) => j.referralId).map((j) => [j.referralId, j]));
  const detailsAllowed = await memberLeadRequests.planAllowsLeadDetails(ctx.network, ctx.member);
  const received = referrals.filter((r) => r.toMemberId === ctx.member.id).slice(0, 60).map((r) =>
    memberLeadRequests.presentReferralTeaser({
      ...presentReceived(r, membersById, ctx.network),
      jobHref: jobByRef[r.id] ? `${ctx.base}/customers/jobs/${jobByRef[r.id].id}` : '',
      convertible: ['accepted', 'booked', 'won'].includes(r.status),
    }, { detailsAllowed }));
  const sent = referrals.filter((r) => r.fromMemberId === ctx.member.id).slice(0, 60).map((r) =>
    memberLeadRequests.presentReferralTeaser(
      presentSent(r, membersById, ctx.network),
      { detailsAllowed },
    ));
  const pool = ex.poolReferralsForMember(referrals, ctx.member).slice(0, 40).map((r) =>
    memberLeadRequests.presentReferralTeaser({
      ...presentReceived(r, membersById, ctx.network),
      statusLabel: detailsAllowed ? 'Open · Claim' : 'Upgrade to claim',
      actions: detailsAllowed ? ['claim'] : [],
      convertible: false,
    }, { detailsAllowed }));
  const appt = ctx.appointment;
  const formLeads = (appt ? (appt.formLeads || []) : []).map((lead) =>
    memberLeadRequests.presentFormLead(lead, { detailsAllowed }));
  // Free app + unpaid/expired trial: name teasers only (paid unlocks details).
  const referralsLocked = !detailsAllowed;
  let partnerDirectory = [];
  let partnerMembers = [];
  if (!referralsLocked && formLeads.some((l) => l && l.status !== 'closed')) {
    partnerDirectory = await directoryFor(ctx.network, ctx.member);
    partnerMembers = members
      .filter((m) => m && m.id !== ctx.member.id && m.status === 'active')
      .map((m) => ({
        id: m.id,
        label: m.companyName || m.contactName || 'Partner',
        trades: Array.isArray(m.trades) ? m.trades : [],
        tradeLabel: (Array.isArray(m.trades) ? m.trades : [])
          .map((slug) => trades.tradeLabel(slug, ctx.network))
          .filter(Boolean)
          .slice(0, 2)
          .join(', '),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }
  return render(res, 'referrals', ctx, {
    view,
    received,
    sent,
    pool,
    formLeads,
    partnerDirectory,
    partnerMembers,
    openLeadCount: appt ? (appt.openLeadCount || 0) : 0,
    leadCredits: appt ? (appt.leadCredits || { remaining: 0 }) : { remaining: 0 },
    leadRequest,
    flash: flash || flashFromQuery(req),
    referralsLocked,
    leadDetailsLocked: !detailsAllowed,
    upgradeHref: '/signup',
  }, status);
}

router.get('/m/:token/referrals', withMember((req, res, ctx) => renderReferrals(req, res, ctx)));

router.post('/m/:token/referrals/:id', form, withMember(async (req, res, ctx) => {
  if (!(await memberLeadRequests.planAllowsLeadDetails(ctx.network, ctx.member))) {
    return res.redirect(303, `${ctx.base}/referrals?ok=referrals_upgrade`);
  }
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

// ── Join (free members) / Send (partners) ────────────────────────────────────

async function renderJoin(req, res, ctx) {
  if (!freeAppSignup.isAppFreeMember(ctx.member)) {
    return res.redirect(303, `${ctx.base}/send`);
  }
  return render(res, 'join', ctx, {
    upgradeHref: '/signup',
    flash: flashFromQuery(req),
  });
}

router.get('/m/:token/join', withMember((req, res, ctx) => renderJoin(req, res, ctx)));

async function renderSend(req, res, ctx, flash, formValues, status) {
  // Free-app members use Join instead of Send; paid/trial partners keep Send.
  const locked = freeAppSignup.isAppFreeMember(ctx.member);
  if (locked) {
    return res.redirect(303, `${ctx.base}/join`);
  }
  const directory = await directoryFor(ctx.network, ctx.member);
  return render(res, 'send', ctx, {
    directory,
    flash: flash || flashFromQuery(req),
    formValues: formValues || {},
    referralsLocked: false,
    upgradeHref: '/signup',
  }, status);
}

router.get('/m/:token/send', withMember((req, res, ctx) => {
  const q = req.query || {};
  const formValues = {
    name: String(q.name || '').slice(0, 120),
    phone: String(q.phone || '').slice(0, 40),
    email: String(q.email || '').slice(0, 200),
    note: String(q.note || '').slice(0, 1000),
    zip: String(q.zip || '').slice(0, 10),
    city: String(q.city || '').slice(0, 80),
    address: String(q.address || '').slice(0, 200),
    tradeSlug: String(q.tradeSlug || '').slice(0, 60),
    consent: q.consent === '1' || q.consent === 'on' ? 'on' : '',
  };
  const hasPrefill = Object.values(formValues).some((v) => v);
  return renderSend(req, res, ctx, null, hasPrefill ? formValues : undefined);
}));

router.post('/m/:token/send', form, withMember(async (req, res, ctx) => {
  if (freeAppSignup.isAppFreeMember(ctx.member)) {
    return res.redirect(303, `${ctx.base}/join`);
  }
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
    toMemberId: String(body.toMemberId || '').trim(),
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
    crmSyncLocked: freeAppSignup.isAppFreeMember(ctx.member),
    upgradeHref: '/signup',
  };

  if (view === 'list') {
    // Full list is rendered; live client search filters as you type (same ranking as review ask).
    const q = String(req.query.q || '').trim().slice(0, 80);
    const showPartners = String(req.query.partners || '') === '1';
    const tagCatalog = ctx.network && ctx.network.ownerWorkspaceId
      ? await memberCustomerGhl.listActiveWorkspaceTags(ctx.network.ownerWorkspaceId)
      : [];
    const tagNameByKey = new Map(tagCatalog.map((t) => [t.key, t.name]));
    const annotated = customers.map((c) => {
      const mine = jobs.filter((j) => j.customerId === c.id);
      const open = mine.filter(work.isOpen);
      const lead = open[0] || mine[mine.length - 1];
      const isPartner = memberCustomerGhl.customerLooksLikePartner(c, tagNameByKey);
      return {
        ...c,
        href: `${ctx.base}/customers/c/${c.id}`,
        jobCount: mine.length,
        openCount: open.length,
        top: lead ? present(lead) : null,
        sortKey: lead ? lead.updatedAt : c.updatedAt,
        isPartner,
      };
    });
    const partnerCount = annotated.filter((c) => c.isPartner).length;
    const rows = annotated
      .filter((c) => showPartners || !c.isPartner)
      .sort((a, b) => (b.openCount > 0) - (a.openCount > 0) || String(b.sortKey).localeCompare(String(a.sortKey)));
    Object.assign(extra, {
      q,
      rows,
      showPartners,
      partnerCount,
      hiddenPartnerCount: showPartners ? 0 : partnerCount,
    });
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

router.get('/m/:token/customers', withMember(async (req, res, ctx) => {
  ctx = await maybeEnsureDemoOwnerReviewApp(ctx);
  return renderCustomers(req, res, ctx);
}));

async function customerTagViews(ctx, customer) {
  const workspaceId = ctx.network && ctx.network.ownerWorkspaceId;
  if (!workspaceId || !customer) {
    return { customerTags: [], availableTags: [] };
  }
  const [customerTags, availableTags] = await Promise.all([
    memberCustomerGhl.presentCustomerTags(workspaceId, customer),
    memberCustomerGhl.availableCustomerTags(workspaceId, customer),
  ]);
  return { customerTags, availableTags };
}

async function renderCustomerPage(res, ctx, {
  customer, jobs, today, formValues, flash, status, reviewAskStatus, inviteUrl, customerTab, ghlActivity,
}) {
  const [tagViews, teammates] = await Promise.all([
    customerTagViews(ctx, customer),
    customer ? listShareTeammates(ctx) : Promise.resolve([]),
  ]);
  const sharedWithLabels = (customer && customer.sharedWith || []).map((row) => {
    const mate = teammates.find((t) => t.id === row.memberId);
    return {
      ...row,
      label: mate ? mate.label : 'Teammate',
    };
  });
  return render(res, 'customer', ctx, {
    active: 'customers',
    customer,
    jobs: jobs || [],
    teammates,
    sharedWithLabels,
    formValues: formValues || customer || {},
    flash: flash || null,
    inviteUrl: inviteUrl || '',
    today,
    customerTab: customerTab === 'bulk' ? 'bulk' : 'one',
    reviewAskStatus: reviewAskStatus || null,
    reviewSendLocked: freeAppSignup.isAppFreeMember(ctx.member),
    upgradeHref: '/signup',
    ghlActivity: ghlActivity || null,
    ...tagViews,
  }, status);
}

router.get('/m/:token/customers/new', withMember((req, res, ctx) => renderCustomerPage(res, ctx, {
  customer: null,
  today: work.todayIn(memberTimeZone(req)),
  flash: flashFromQuery(req),
  customerTab: String(req.query.tab || '') === 'bulk' ? 'bulk' : 'one',
})));

router.get('/m/:token/customers/import-template.csv', withMember((req, res, ctx) => {
  const csv = memberCustomerCsv.customerImportTemplateCsv();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="customer-import-template.csv"');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  return res.send(csv);
}));

router.post('/m/:token/customers/new', form, withMember(async (req, res, ctx) => {
  const result = await work.saveCustomer(ctx.network.id, ctx.member.id, req.body || {}, { source: 'manual' });
  if (!result.ok) {
    return renderCustomerPage(res, ctx, { customer: null, formValues: req.body, flash: { error: result.error }, status: 400 });
  }
  // Best-effort: new customers land in GHL so review requests reuse the same contact.
  await memberCustomerGhl.pushCustomerToGhl(ctx.network, ctx.member.id, result.customer).catch(() => null);
  return res.redirect(303, `${ctx.base}/customers/c/${result.customer.id}?ok=customer`);
}));

router.post('/m/:token/customers/import', (req, res, next) => {
  customerImportUpload.single('file')(req, res, (err) => {
    if (!err) return next();
    req.customerImportError = err.message || 'Upload failed.';
    return next();
  });
}, withMember(async (req, res, ctx) => {
  const fromNew = String((req.body && req.body.from) || '') === 'new';
  const back = fromNew ? `${ctx.base}/customers/new?tab=bulk` : `${ctx.base}/customers`;
  if (req.customerImportError) {
    return res.redirect(303, `${back}${fromNew ? '&' : '?'}errmsg=${encodeURIComponent(req.customerImportError)}`);
  }
  const parsed = memberCustomerCsv.parseCustomerImportFile(
    req.file && req.file.buffer,
    req.file && req.file.originalname,
  );
  if (!parsed.ok) {
    return res.redirect(303, `${back}${fromNew ? '&' : '?'}errmsg=${encodeURIComponent(parsed.error)}`);
  }
  const out = await memberCustomerCsv.importCustomers(ctx.network.id, ctx.member.id, parsed.rows, {
    pushToGhl: async (saved) => memberCustomerGhl.pushCustomersMissingGhl(ctx.network, ctx.member.id, saved, { limit: 100 }),
  });
  let workspaceDetail = '';
  if (freeAppSignup.isAppFreeMember(ctx.member) && (out.created > 0 || out.updated > 0)) {
    try {
      const wsOut = await freeAppListWorkspace.syncListUpload({
        network: ctx.network,
        member: ctx.member,
        rows: parsed.rows,
      });
      if (wsOut && wsOut.workspaceId && !wsOut.skipped) {
        if (wsOut.created) {
          workspaceDetail = ', Agency OS workspace created for your list';
        } else if (wsOut.imported) {
          const n = (wsOut.imported.created || 0) + (wsOut.imported.merged || 0);
          if (n > 0) workspaceDetail = `, ${n} synced to Agency OS workspace`;
        }
        if (wsOut.member) ctx.member = wsOut.member;
      }
    } catch (err) {
      console.warn(
        '[member] free-app list workspace sync skipped:',
        err && err.message ? err.message : err,
      );
    }
  }
  const detail = `(${out.created} new, ${out.updated} updated${out.ghl && out.ghl.pushed ? `, ${out.ghl.pushed} synced to GHL CRM` : ''}${workspaceDetail})`;
  return res.redirect(303, `${back}${fromNew ? '&' : '?'}ok=customers_imported&detail=${encodeURIComponent(detail)}`);
}));

router.post('/m/:token/customers/sync-ghl', form, withMember(async (req, res, ctx) => {
  if (freeAppSignup.isAppFreeMember(ctx.member)) {
    return res.redirect(303, `${ctx.base}/customers?ok=crm_sync_upgrade`);
  }
  const wid = ctx.network && ctx.network.ownerWorkspaceId;
  if (wid) {
    try {
      const ws = await dbService.getWorkspace(wid);
      if (ws && ws.isDemo) {
        ctx = await maybeEnsureDemoOwnerReviewApp(ctx);
        return res.redirect(303, `${ctx.base}/customers?ok=customers_synced&detail=${encodeURIComponent('(demo sample data)')}`);
      }
    } catch (_) { /* ignore */ }
  }
  const out = await memberCustomerGhl.syncCustomersWithGhl(ctx.network, ctx.member.id, { maxPages: 5, pushLimit: 100 });
  if (!out.ok) {
    return res.redirect(303, `${ctx.base}/customers?errmsg=${encodeURIComponent(out.error || 'CRM sync failed.')}`);
  }
  return res.redirect(303, `${ctx.base}/customers?ok=customers_synced&detail=${encodeURIComponent(`(${out.summary})`)}`);
}));

async function customerPageData(req, ctx, id, { refreshTags = false, loadGhlActivity = false } = {}) {
  let customer = await work.getCustomer(ctx.network.id, ctx.member.id, id);
  if (!customer) return null;
  if (refreshTags && customer.ghlContactId) {
    const pulled = await memberCustomerGhl
      .pullCustomerTagsFromGhl(ctx.network, ctx.member.id, customer)
      .catch(() => null);
    if (pulled && pulled.ok && pulled.customer) customer = pulled.customer;
  }
  const today = work.todayIn(memberTimeZone(req));
  const { jobs, customersById } = await loadWork(ctx);
  const mine = jobs
    .filter((j) => j.customerId === customer.id)
    .sort((a, b) => work.isOpen(b) - work.isOpen(a))
    .map((j) => presentJob(j, customersById, ctx.base, today));
  const ask = await reviewAsk.latestAskForCustomer(ctx.network.id, ctx.member.id, customer.id);
  let reviewAskStatus = presentReviewAskStatus(ask);
  // Referral-reward confirm is paid-only (same gate as network referrals).
  if (reviewAskStatus && reviewAskStatus.canConfirm && freeAppSignup.isAppFreeMember(ctx.member)) {
    reviewAskStatus = { ...reviewAskStatus, canConfirm: false };
  }
  let ghlActivity = null;
  if (loadGhlActivity) {
    ghlActivity = await memberCustomerGhlActivity.listForCustomer(ctx.network, customer);
  }
  return { customer, jobs: mine, today, reviewAskStatus, ghlActivity };
}

router.get('/m/:token/customers/c/:id', withMember(async (req, res, ctx) => {
  // Paint the profile first; Calls & texts loads via ghl-activity.json so the
  // contact doesn't sit unresponsive while GHL history is fetched.
  const data = await customerPageData(req, ctx, req.params.id, {
    refreshTags: true,
    loadGhlActivity: false,
  });
  if (!data) return res.redirect(303, `${ctx.base}/customers`);
  return renderCustomerPage(res, ctx, { ...data, flash: flashFromQuery(req) });
}));

/** JSON: GHL call + SMS history for a synced customer contact. */
router.get('/m/:token/customers/c/:id/ghl-activity.json', withMember(async (req, res, ctx) => {
  noStore(res);
  const customer = await work.getCustomer(ctx.network.id, ctx.member.id, req.params.id);
  if (!customer) return res.status(404).json({ success: false, error: 'Customer not found.' });
  const activity = await memberCustomerGhlActivity.listForCustomer(ctx.network, customer);
  return res.json({ success: true, ...activity });
}));

router.post('/m/:token/customers/c/:id', form, withMember(async (req, res, ctx) => {
  const result = await work.saveCustomer(ctx.network.id, ctx.member.id, req.body || {}, { id: req.params.id });
  if (!result.ok) {
    const data = await customerPageData(req, ctx, req.params.id);
    if (!data) return res.redirect(303, `${ctx.base}/customers`);
    return renderCustomerPage(res, ctx, { ...data, formValues: req.body, flash: { error: result.error }, status: 400 });
  }
  if (!result.customer.ghlContactId) {
    await memberCustomerGhl.pushCustomerToGhl(ctx.network, ctx.member.id, result.customer).catch(() => null);
  }
  return res.redirect(303, `${ctx.base}/customers/c/${result.customer.id}?ok=customer`);
}));

router.post('/m/:token/customers/c/:id/tags/add', form, withMember(async (req, res, ctx) => {
  const body = req.body || {};
  const result = await memberCustomerGhl.setCustomerTag(
    ctx.network,
    ctx.member.id,
    req.params.id,
    body.tagKey,
    { add: true, tagName: body.tagName || body.q || body.tag },
  );
  if (!result.ok) {
    const data = await customerPageData(req, ctx, req.params.id);
    if (!data) return res.redirect(303, `${ctx.base}/customers`);
    return renderCustomerPage(res, ctx, {
      ...data,
      flash: { error: result.error || 'Could not add that tag.' },
      status: 400,
    });
  }
  return res.redirect(303, `${ctx.base}/customers/c/${req.params.id}?ok=tag`);
}));

router.post('/m/:token/customers/c/:id/tags/remove', form, withMember(async (req, res, ctx) => {
  const result = await memberCustomerGhl.setCustomerTag(
    ctx.network,
    ctx.member.id,
    req.params.id,
    req.body && req.body.tagKey,
    { add: false },
  );
  if (!result.ok) {
    const data = await customerPageData(req, ctx, req.params.id);
    if (!data) return res.redirect(303, `${ctx.base}/customers`);
    return renderCustomerPage(res, ctx, {
      ...data,
      flash: { error: result.error || 'Could not remove that tag.' },
      status: 400,
    });
  }
  return res.redirect(303, `${ctx.base}/customers/c/${req.params.id}?ok=tag`);
}));

router.post('/m/:token/customers/c/:id/delete', form, withMember(async (req, res, ctx) => {
  await work.deleteCustomer(ctx.network.id, ctx.member.id, req.params.id);
  return res.redirect(303, `${ctx.base}/customers?ok=customer_deleted`);
}));

/**
 * Legacy POST: always open Review ask with this customer prefilled.
 * Sending happens from the Review tab after the member confirms the message.
 */
router.post('/m/:token/customers/c/:id/request-review', form, withMember(async (req, res, ctx) => {
  const data = await customerPageData(req, ctx, req.params.id);
  if (!data) return res.redirect(303, `${ctx.base}/customers`);
  await ensureReviewSetup(ctx);
  const qs = new URLSearchParams({
    ask: '1',
    customer: data.customer.id,
    name: data.customer.name || '',
    phone: data.customer.phone || '',
    email: data.customer.email || '',
  });
  return res.redirect(303, `${ctx.base}/review?${qs.toString()}`);
}));

/**
 * Legacy Team field work / notify links used /customers/:id (no /c/).
 * Keep those bookmarks working; real customer pages live under /customers/c/:id.
 */
const CUSTOMER_PATH_RESERVED = new Set([
  'new',
  'jobs',
  'c',
  'import',
  'import-template.csv',
  'sync-ghl',
  'from-referral',
]);
router.get('/m/:token/customers/:id', withMember((req, res, ctx) => {
  const id = String(req.params.id || '').trim();
  if (!id || CUSTOMER_PATH_RESERVED.has(id)) {
    return res.redirect(303, `${ctx.base}/customers`);
  }
  const qIdx = req.url.indexOf('?');
  const q = qIdx >= 0 ? req.url.slice(qIdx) : '';
  return res.redirect(302, `${ctx.base}/customers/c/${encodeURIComponent(id)}${q}`);
}));

/**
 * Ensure Team & assign seats exist as network members so Share can pick them
 * (free workspace teammates — not only referral-network partners).
 */
async function ensureWorkspaceShareTeammates(ctx) {
  const wid = ctx.network && ctx.network.ownerWorkspaceId;
  if (!wid) return;
  const self = ctx.member;
  const isOwner = ownerAppBrand.isOwnerMember(self, ctx.network);
  const isStaff = !!(self && self.workspaceStaff);
  // Partners outside the workspace keep the network-only picker.
  if (!isOwner && !isStaff) return;

  let workspace;
  try {
    workspace = await dbService.getWorkspace(wid);
  } catch (_) {
    return;
  }
  if (!workspace || !workspace.members) return;

  const actorEmail = String((self && self.email) || '').trim().toLowerCase();
  const targets = workspaceTeammatePush.listTeammateTargets(workspace, actorEmail);
  for (const t of targets) {
    try {
      await workspaceTeammatePush.ensureTeammateMember(ctx.network, workspace, t.email);
    } catch (err) {
      console.warn('[member-app] ensure workspace teammate skipped:', t.email, err && err.message);
    }
  }
}

function shareTeammateLabel(m, workspace) {
  if (m && m.workspaceStaff) {
    const name = String(m.contactName || '').trim();
    if (name) return name;
    const email = String(m.email || '').trim().toLowerCase();
    if (email) return email.split('@')[0];
  }
  return (m && (m.companyName || m.contactName)) || 'Teammate';
}

function shareTeammateContact(m, workspace) {
  if (m && m.workspaceStaff) {
    const email = String(m.email || '').trim().toLowerCase();
    const role = workspace && email
      ? String(workspaceService.roleForEmail(workspace, email) || '').toUpperCase()
      : '';
    const bits = [];
    if (role && role !== 'OWNER') bits.push(role);
    bits.push('workspace team');
    return bits.join(' · ');
  }
  return (m && m.contactName) || '';
}

async function listShareTeammates(ctx) {
  await ensureWorkspaceShareTeammates(ctx);
  const wid = ctx.network && ctx.network.ownerWorkspaceId;
  let workspace = null;
  if (wid) {
    try {
      workspace = await dbService.getWorkspace(wid);
    } catch (_) {
      workspace = null;
    }
  }
  const members = await store.listMembers(ctx.network.id);
  return members
    .filter((m) => m && m.id !== ctx.member.id && m.status === 'active')
    .map((m) => {
      const label = shareTeammateLabel(m, workspace);
      const contact = shareTeammateContact(m, workspace);
      return {
        id: m.id,
        label,
        contact,
        phone: m.phone || '',
        email: m.email || '',
        workspaceStaff: !!m.workspaceStaff,
        canNotify: !!(m.phone && m.phone !== 'N/A') || !!(m.email && m.email !== 'N/A'),
      };
    })
    .sort((a, b) => {
      // Workspace team first, then network partners A–Z.
      if (!!a.workspaceStaff !== !!b.workspaceStaff) return a.workspaceStaff ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
}

async function renderJobPage(req, res, ctx, { job, formValues, flash, status, inviteUrl }) {
  const today = work.todayIn(memberTimeZone(req));
  const [{ customers, customersById }, teammates] = await Promise.all([
    loadWork(ctx),
    job ? listShareTeammates(ctx) : Promise.resolve([]),
  ]);
  const presented = job ? presentJob(job, customersById, ctx.base, today) : null;
  const sharedWithLabels = (presented && presented.sharedWith || []).map((row) => {
    const mate = teammates.find((t) => t.id === row.memberId);
    return {
      ...row,
      label: mate ? mate.label : 'Teammate',
    };
  });
  return render(res, 'job', ctx, {
    active: 'customers',
    job: presented,
    customer: job ? customersById[job.customerId] || null : null,
    customers,
    teammates,
    sharedWithLabels,
    statuses: work.JOB_STATUSES.map((s) => ({ value: s, label: work.JOB_STATUS_LABELS[s] })),
    durations: DURATIONS.map((m) => ({ value: m, label: durationLabel(m) })),
    remindOptions: work.REMIND_BEFORE_OPTIONS,
    maxJobPhotos: work.MAX_JOB_PHOTOS,
    formValues: formValues || job || {},
    flash: flash || null,
    inviteUrl: inviteUrl || '',
    today,
  }, status);
}

/**
 * Field speech-to-text for Reviews + paid partner apps (PWA / while driving).
 * Body: raw audio, same contract as POST /api/voice/transcribe.
 */
router.post(
  '/m/:token/voice/transcribe',
  (req, res, next) => {
    const declared = Number(req.get('content-length') || 0);
    if (declared > voiceTranscription.MAX_BYTES) {
      return res.status(413).json({ success: false, error: 'Recording is too long. Keep it under 2 minutes.' });
    }
    return next();
  },
  express.raw({ type: ['audio/*', 'application/octet-stream'], limit: voiceTranscription.MAX_BYTES }),
  withMemberApi(async (req, res, ctx) => {
    const rateKey = `member:${ctx.member.id}|${ctx.network.id}`;
    if (!voiceTranscription.takeRateSlot(rateKey)) {
      return res.status(429).json({
        success: false,
        error: 'Too many voice messages. Wait a few minutes and try again.',
      });
    }
    const mime = String(req.get('content-type') || 'audio/webm').split(';')[0].trim() || 'audio/webm';
    const langRaw = String(req.query.lang || '').trim().toLowerCase();
    const language = /^[a-z]{2}$/.test(langRaw) ? langRaw : '';
    const brandName = (ctx.brand && ctx.brand.appName) || networkBrand.FREE_APP_NAME;
    const result = await voiceTranscription.transcribeAudio({
      audio: req.body,
      mime,
      language,
      workspaceId: ctx.network && ctx.network.ownerWorkspaceId,
      prompt: voiceTranscription.memberFieldPromptHint(brandName),
    });
    if (!result.ok) return res.status(result.status).json({ success: false, error: result.error });
    return res.json({ success: true, text: result.text });
  }),
);

// JSON errors for oversized / unreadable voice uploads (express.raw).
router.use((err, req, res, next) => {
  if (!err || !req.path || !/\/voice\/transcribe\/?$/.test(req.path)) return next(err);
  if (err.type === 'entity.too.large' || err.status === 413) {
    return res.status(413).json({ success: false, error: 'Recording is too long. Keep it under 2 minutes.' });
  }
  if (err.status && err.status < 500) {
    return res.status(err.status).json({ success: false, error: 'Could not read the recording.' });
  }
  return next(err);
});

/** Speak-once → structured customer fields for the New customer form. */
router.post(
  '/m/:token/voice/parse-customer',
  express.json({ limit: '32kb' }),
  withMemberApi(async (req, res, ctx) => {
    const rateKey = `member-parse:${ctx.member.id}|${ctx.network.id}`;
    if (!voiceTranscription.takeRateSlot(rateKey)) {
      return res.status(429).json({
        success: false,
        error: 'Too many voice parses. Wait a few minutes and try again.',
      });
    }
    const text = String((req.body && req.body.text) || '').trim();
    const parsed = await memberVoiceCustomerParse.parseCustomerFromSpeech(text, {
      workspaceId: ctx.network && ctx.network.ownerWorkspaceId,
    });
    if (!parsed.ok) {
      return res.status(400).json({ success: false, error: parsed.error || 'Could not parse that.' });
    }
    return res.json({
      success: true,
      fields: parsed.fields,
      warning: parsed.warning || '',
      transcript: parsed.transcript || text,
      source: parsed.source || '',
    });
  }),
);

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
  const result = await work.saveJob(ctx.network.id, ctx.member.id, body, { timeZone: memberTimeZone(req) });
  if (!result.ok) return fail(result.error);
  return res.redirect(303, `${ctx.base}/customers/jobs/${result.job.id}?ok=job`);
}));

router.get('/m/:token/customers/jobs/:id', withMember(async (req, res, ctx) => {
  const job = await work.getJob(ctx.network.id, ctx.member.id, req.params.id);
  if (!job) return res.redirect(303, `${ctx.base}/customers?view=pending`);
  return renderJobPage(req, res, ctx, { job, flash: flashFromQuery(req) });
}));

router.post('/m/:token/customers/jobs/:id', form, withMember(async (req, res, ctx) => {
  const job = await work.getJob(ctx.network.id, ctx.member.id, req.params.id);
  if (!job) return res.redirect(303, `${ctx.base}/customers?view=pending`);
  const result = await work.saveJob(ctx.network.id, ctx.member.id, req.body || {}, {
    id: job.id,
    timeZone: memberTimeZone(req),
  });
  if (!result.ok) return renderJobPage(req, res, ctx, { job, formValues: req.body, flash: { error: result.error }, status: 400 });
  return res.redirect(303, `${ctx.base}/customers/jobs/${job.id}?ok=job`);
}));

router.get('/m/:token/customers/jobs/:id/photos/:photoId', withMember(async (req, res, ctx) => {
  const job = await work.getJob(ctx.network.id, ctx.member.id, req.params.id);
  if (!job || !job.photos.some((p) => p.id === req.params.photoId)) return res.status(404).end();
  const photo = await jobMedia.getJobPhoto(ctx.network.id, ctx.member.id, job.id, req.params.photoId);
  if (!photo) return res.status(404).end();
  res.setHeader('Content-Type', photo.contentType || 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  return res.send(photo.buffer);
}));

async function handleJobPhotoUpload(req, res, ctx, job, { fallbackPath } = {}) {
  const back = safeReturn(
    ctx,
    req.body && req.body.returnTo,
    fallbackPath || `${ctx.base}/customers/jobs/${job.id}`,
  );
  const fail = async (error) => {
    if (back.includes('/customers/c/')) {
      const customerId = job.customerId;
      const data = customerId ? await customerPageData(req, ctx, customerId) : null;
      if (data) return renderCustomerPage(res, ctx, { ...data, flash: { error }, status: 400 });
    }
    return renderJobPage(req, res, ctx, { job, flash: { error }, status: 400 });
  };
  if (req.maUploadError) return fail(req.maUploadError);
  if (!req.file || !req.file.buffer) return fail('Choose a photo to upload.');
  try {
    const prepared = await jobMedia.prepareJobPhoto(req.file.buffer);
    const result = await work.addJobPhoto(ctx.network.id, ctx.member.id, job.id, prepared, {
      caption: req.body && req.body.caption,
    });
    if (!result.ok) return fail(result.error);
    const sep = back.includes('?') ? '&' : '?';
    return res.redirect(303, `${back}${sep}ok=job_photo`);
  } catch (err) {
    console.error('[member-app] job photo', err.message);
    return fail(err.message || ERR_MESSAGES.job_photo);
  }
}

router.post('/m/:token/customers/jobs/:id/photos', (req, res, next) => {
  return reviewUpload.single('photo')(req, res, (err) => {
    if (err) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      req.maUploadError = tooBig
        ? 'That photo is too large (max 6 MB). Try a smaller image.'
        : (err.message || 'Could not upload that image.');
    }
    return next();
  });
}, withMember(async (req, res, ctx) => {
  const job = await work.getJob(ctx.network.id, ctx.member.id, req.params.id);
  if (!job) return res.redirect(303, `${ctx.base}/customers?view=pending`);
  return handleJobPhotoUpload(req, res, ctx, job);
}));

/** Customer-page photo upload: attach to open job, or create a Site visit first. */
router.post('/m/:token/customers/c/:id/photos', (req, res, next) => {
  return reviewUpload.single('photo')(req, res, (err) => {
    if (err) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      req.maUploadError = tooBig
        ? 'That photo is too large (max 6 MB). Try a smaller image.'
        : (err.message || 'Could not upload that image.');
    }
    return next();
  });
}, withMember(async (req, res, ctx) => {
  const customerId = req.params.id;
  const back = safeReturn(ctx, req.body && req.body.returnTo, `${ctx.base}/customers/c/${customerId}`);
  const fail = async (error) => {
    const data = await customerPageData(req, ctx, customerId);
    if (!data) return res.redirect(303, `${ctx.base}/customers`);
    return renderCustomerPage(res, ctx, { ...data, flash: { error }, status: 400 });
  };
  if (req.maUploadError) return fail(req.maUploadError);
  if (!req.file || !req.file.buffer) return fail('Choose a photo to upload.');

  const ensured = await work.ensureOpenJobForPhotos(ctx.network.id, ctx.member.id, customerId, {
    timeZone: memberTimeZone(req),
  });
  if (!ensured.ok) return fail(ensured.error);

  try {
    const prepared = await jobMedia.prepareJobPhoto(req.file.buffer);
    const result = await work.addJobPhoto(ctx.network.id, ctx.member.id, ensured.job.id, prepared, {
      caption: req.body && req.body.caption,
    });
    if (!result.ok) return fail(result.error);
    const sep = back.includes('?') ? '&' : '?';
    return res.redirect(303, `${back}${sep}ok=job_photo`);
  } catch (err) {
    console.error('[member-app] customer photo', err.message);
    return fail(err.message || ERR_MESSAGES.job_photo);
  }
}));

router.post('/m/:token/customers/jobs/:id/photos/:photoId/delete', form, withMember(async (req, res, ctx) => {
  const result = await work.removeJobPhoto(ctx.network.id, ctx.member.id, req.params.id, req.params.photoId);
  if (!result.ok) {
    const job = await work.getJob(ctx.network.id, ctx.member.id, req.params.id);
    if (!job) return res.redirect(303, `${ctx.base}/customers?view=pending`);
    return renderJobPage(req, res, ctx, { job, flash: { error: result.error }, status: 400 });
  }
  return res.redirect(303, `${ctx.base}/customers/jobs/${req.params.id}?ok=job_photo_deleted`);
}));

router.post('/m/:token/customers/jobs/:id/photos/:photoId/caption', form, withMember(async (req, res, ctx) => {
  const jobId = req.params.id;
  const photoId = req.params.photoId;
  const job = await work.getJob(ctx.network.id, ctx.member.id, jobId);
  const back = safeReturn(
    ctx,
    req.body && req.body.returnTo,
    job ? `${ctx.base}/customers/jobs/${job.id}` : `${ctx.base}/customers`,
  );
  const fail = async (error) => {
    if (back.includes('/customers/c/') && job && job.customerId) {
      const data = await customerPageData(req, ctx, job.customerId);
      if (data) return renderCustomerPage(res, ctx, { ...data, flash: { error }, status: 400 });
    }
    if (!job) return res.redirect(303, `${ctx.base}/customers?view=pending`);
    return renderJobPage(req, res, ctx, { job, flash: { error }, status: 400 });
  };
  if (!job) return fail('Job not found.');
  const result = await work.updateJobPhotoCaption(
    ctx.network.id,
    ctx.member.id,
    jobId,
    photoId,
    req.body && req.body.caption,
  );
  if (!result.ok) return fail(result.error);
  const sep = back.includes('?') ? '&' : '?';
  return res.redirect(303, `${back}${sep}ok=job_photo_note`);
}));

function safeReturn(ctx, value, fallback) {
  const to = String(value || '');
  const ok = [`${ctx.base}/customers`, `${ctx.base}/referrals`, `${ctx.base}/review`].some((p) => (
    to === p || to.startsWith(`${p}?`) || to.startsWith(`${p}/`)
  ));
  return ok && !/[\r\n]/.test(to) ? to : fallback;
}

function wantsJson(req) {
  const accept = String(req.get('accept') || '');
  return req.get('x-requested-with') === 'fetch' || /application\/json/i.test(accept);
}

router.post('/m/:token/customers/jobs/:id/status', form, withMember(async (req, res, ctx) => {
  const back = safeReturn(ctx, req.body && req.body.back, `${ctx.base}/customers/jobs/${encodeURIComponent(req.params.id)}`);
  const tz = memberTimeZone(req);
  const result = await work.setJobStatus(
    ctx.network.id,
    ctx.member.id,
    req.params.id,
    String((req.body && req.body.status) || ''),
    { today: work.todayIn(tz), timeZone: tz },
  );
  if (wantsJson(req)) {
    if (!result.ok) {
      return res.status(result.error === 'Job not found.' ? 404 : 400).json({ ok: false, error: result.error || 'Could not update status.' });
    }
    return res.json({
      ok: true,
      status: result.job.status,
      statusLabel: work.JOB_STATUS_LABELS[result.job.status] || result.job.status,
      date: result.job.date || '',
    });
  }
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

/** Share a job onto a teammate’s calendar, or invite someone outside by phone/email. */
router.post('/m/:token/customers/jobs/:id/share', form, withMember(async (req, res, ctx) => {
  const jobId = String(req.params.id || '');
  const body = req.body || {};
  const toMemberId = String(body.memberId || '').trim();
  const invitePhone = String(body.invitePhone || '').trim();
  const inviteEmail = String(body.inviteEmail || '').trim();
  const back = `${ctx.base}/customers/jobs/${encodeURIComponent(jobId)}`;
  const job = await work.getJob(ctx.network.id, ctx.member.id, jobId);
  if (!job) return res.redirect(303, `${ctx.base}/customers?view=pending`);

  if (!toMemberId && (invitePhone || inviteEmail)) {
    const result = await memberShareInvite.createOrShare({
      network: ctx.network,
      fromMember: ctx.member,
      customerId: job.customerId,
      phone: invitePhone,
      email: inviteEmail,
      companyName: String(body.inviteCompany || '').trim(),
      contactName: String(body.inviteName || '').trim(),
      baseUrl: notify.baseUrlFromReq(req),
    });
    if (!result.ok) {
      return renderJobPage(req, res, ctx, {
        job,
        flash: { error: result.error || 'Could not send that invite.' },
        status: 400,
      });
    }
    if (result.mode === 'existing_member') {
      return res.redirect(303, `${back}?ok=share_existing`);
    }
    if (!result.notified || !result.notified.ok) {
      return renderJobPage(req, res, ctx, {
        job,
        flash: {
          ok: `Invite ready — ${(result.notified && result.notified.error) || 'copy this link and send it yourself:'} ${result.url}`,
        },
        inviteUrl: result.url,
      });
    }
    return res.redirect(303, `${back}?ok=share_invited`);
  }

  const teammates = await listShareTeammates(ctx);
  const mate = teammates.find((t) => t.id === toMemberId);
  if (!mate) {
    return renderJobPage(req, res, ctx, {
      job,
      flash: { error: 'Pick a teammate, or enter a phone/email to invite someone new.' },
      status: 400,
    });
  }
  if (!mate.canNotify) {
    return renderJobPage(req, res, ctx, {
      job,
      flash: { error: 'That teammate needs a phone or email on their profile before we can notify them.' },
      status: 400,
    });
  }

  const toMember = await store.getMember(ctx.network.id, mate.id);
  if (!toMember || toMember.status !== 'active') {
    return renderJobPage(req, res, ctx, {
      job,
      flash: { error: 'That teammate is not available.' },
      status: 400,
    });
  }

  const shared = await work.shareJobWithTeammate(
    ctx.network.id,
    ctx.member.id,
    toMember.id,
    job.id,
    { sharedByName: ctx.member.contactName || ctx.member.companyName },
  );
  if (!shared.ok) {
    return renderJobPage(req, res, ctx, {
      job,
      flash: { error: shared.error || 'Could not share that job.' },
      status: 400,
    });
  }

  const ping = await notify.notifyCustomerSharedWithTeammate({
    network: ctx.network,
    fromMember: ctx.member,
    toMember,
    customer: shared.customer,
    jobsShared: shared.jobsShared || 1,
    focusJob: shared.job,
    baseUrl: notify.baseUrlFromReq(req),
  }).catch((err) => ({ ok: false, error: err.message }));

  if (!ping || !ping.ok) {
    return res.redirect(303, `${back}?ok=job_shared&detail=${encodeURIComponent(
      `(contact + projects added${ping && ping.error ? ` — notify failed: ${ping.error}` : ''})`,
    )}`);
  }
  return res.redirect(303, `${back}?ok=job_shared`);
}));

/** Share a contact/lead (+ projects) with a teammate, or invite someone outside by phone/email. */
router.post('/m/:token/customers/c/:id/share', form, withMember(async (req, res, ctx) => {
  const customerId = String(req.params.id || '');
  const body = req.body || {};
  const toMemberId = String(body.memberId || '').trim();
  const invitePhone = String(body.invitePhone || '').trim();
  const inviteEmail = String(body.inviteEmail || '').trim();
  const back = `${ctx.base}/customers/c/${encodeURIComponent(customerId)}`;
  const data = await customerPageData(req, ctx, customerId);
  if (!data) return res.redirect(303, `${ctx.base}/customers`);

  if (!toMemberId && (invitePhone || inviteEmail)) {
    const result = await memberShareInvite.createOrShare({
      network: ctx.network,
      fromMember: ctx.member,
      customerId,
      phone: invitePhone,
      email: inviteEmail,
      companyName: String(body.inviteCompany || '').trim(),
      contactName: String(body.inviteName || '').trim(),
      baseUrl: notify.baseUrlFromReq(req),
    });
    if (!result.ok) {
      return renderCustomerPage(res, ctx, {
        ...data,
        flash: { error: result.error || 'Could not send that invite.' },
        status: 400,
      });
    }
    if (result.mode === 'existing_member') {
      return res.redirect(303, `${back}?ok=share_existing`);
    }
    if (!result.notified || !result.notified.ok) {
      return renderCustomerPage(res, ctx, {
        ...data,
        flash: {
          ok: `Invite ready — ${(result.notified && result.notified.error) || 'copy this link and send it yourself:'} ${result.url}`,
        },
        inviteUrl: result.url,
      });
    }
    return res.redirect(303, `${back}?ok=share_invited`);
  }

  const teammates = await listShareTeammates(ctx);
  const mate = teammates.find((t) => t.id === toMemberId);
  if (!mate) {
    return renderCustomerPage(res, ctx, {
      ...data,
      flash: { error: 'Pick a teammate, or enter a phone/email to invite someone new.' },
      status: 400,
    });
  }
  if (!mate.canNotify) {
    return renderCustomerPage(res, ctx, {
      ...data,
      flash: { error: 'That teammate needs a phone or email on their profile before we can notify them.' },
      status: 400,
    });
  }
  const toMember = await store.getMember(ctx.network.id, mate.id);
  if (!toMember || toMember.status !== 'active') {
    return renderCustomerPage(res, ctx, {
      ...data,
      flash: { error: 'That teammate is not available.' },
      status: 400,
    });
  }

  const shared = await work.shareCustomerWithTeammate(
    ctx.network.id,
    ctx.member.id,
    toMember.id,
    customerId,
    { sharedByName: ctx.member.contactName || ctx.member.companyName },
  );
  if (!shared.ok) {
    return renderCustomerPage(res, ctx, {
      ...data,
      flash: { error: shared.error || 'Could not share that contact.' },
      status: 400,
    });
  }

  const ping = await notify.notifyCustomerSharedWithTeammate({
    network: ctx.network,
    fromMember: ctx.member,
    toMember,
    customer: shared.customer,
    jobsShared: shared.jobsShared || 0,
    baseUrl: notify.baseUrlFromReq(req),
  }).catch((err) => ({ ok: false, error: err.message }));

  if (!ping || !ping.ok) {
    return res.redirect(303, `${back}?ok=customer_shared&detail=${encodeURIComponent(
      `(${shared.jobsShared || 0} project${(shared.jobsShared || 0) === 1 ? '' : 's'} added${ping && ping.error ? ` — notify failed: ${ping.error}` : ''})`,
    )}`);
  }
  return res.redirect(303, `${back}?ok=customer_shared`);
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

function reviewPageLocals(member, extras, brand) {
  const reviewUrl = notify.reviewPageLink(member);
  const shareImagePath = reviewShareImage.shareImagePath(member.reviewSlug, 'default');
  const shareVersion = reviewShareImage.shareImageVersion(member, brand)
    || member.reviewShareImageUpdatedAt
    || member.heroUpdatedAt
    || 'default';
  const hasCustomLogo = reviewShareImage.hasCustomLogo(member);
  const hasProfilePhoto = reviewShareImage.hasProfilePhoto(member);
  const requestLogoUrl = reviewShareImage.requestPageLogoUrl(member, brand);
  return {
    reviewUrl,
    reviewPath: `/rv/${member.reviewSlug}`,
    platforms: reviewPage.PLATFORMS,
    otherRows: reviewPage.otherFormRows(member.reviewLinks),
    linkCount: reviewPage.countLinks(member.reviewLinks),
    shareImagePath: `${shareImagePath}?v=${encodeURIComponent(shareVersion)}`,
    shareImageUrl: reviewShareImage.shareImageAbsoluteUrl(member.reviewSlug, 'default', shareVersion),
    hasCustomShareImage: !!member.reviewShareImageUpdatedAt,
    hasCustomLogo,
    hasProfilePhoto,
    requestLogoUrl,
    reviewLogoPath: hasCustomLogo
      ? reviewShareImage.reviewLogoPath(member.reviewSlug, member.reviewLogoUpdatedAt)
      : '',
    ...(extras || {}),
  };
}

async function renderReview(req, res, ctx, flash, status, formValues) {
  const member = await ensureReviewSetup(ctx);
  const rewardLocked = freeAppSignup.isAppFreeMember(member);
  const [stats, feedback, messaging, customers, pendingRewardAsks] = await Promise.all([
    store.getReviewStats(ctx.network.id, member.id),
    store.listFeedback(ctx.network.id, member.id),
    notify.messagingReadyForNetwork(ctx.network),
    work.listCustomers(ctx.network.id, member.id),
    rewardLocked
      ? Promise.resolve([])
      : reviewAsk.listPendingRewardConfirms({
        networkId: ctx.network.id,
        memberId: member.id,
        limit: 20,
      }),
  ]);
  const totalStars = Object.values(stats.stars).reduce((a, b) => a + b, 0);
  const q = req.query || {};
  let phone = String((formValues && formValues.phone) || q.phone || '').trim();
  let email = String((formValues && formValues.email) || q.email || '').trim();
  let name = String((formValues && formValues.name) || q.name || '').trim();
  let customerId = String((formValues && formValues.customerId) || q.customer || '').trim();
  // Prefer a real saved customer so the ask form shows the selected row, not "Name (new person)".
  if (customerId && work.isRecordId(customerId)) {
    const picked = customers.find((c) => c.id === customerId);
    if (picked) {
      name = name || picked.name || '';
      phone = phone || picked.phone || '';
      email = email || picked.email || '';
    } else {
      customerId = '';
    }
  } else {
    customerId = '';
    const matched = work.findCustomerMatch(customers, { phone, email });
    if (matched) {
      customerId = matched.id;
      name = name || matched.name || '';
      phone = phone || matched.phone || '';
      email = email || matched.email || '';
    }
  }
  const defaults = {
    phone,
    email,
    name,
    customerId,
    channel: String((formValues && formValues.channel) || q.channel || 'auto').trim() || 'auto',
    useAi: formValues && Object.prototype.hasOwnProperty.call(formValues, 'useAi')
      ? !!formValues.useAi
      : String(q.useAi || '1') !== '0',
  };
  const reviewUrl = notify.reviewPageLink(member);
  const smsScript = reviewRequestScript.memberSmsScript(member);
  const keywordDefaults = reviewRequestScript.memberKeywordDefaults(member);
  let keywordCtx = reviewRequestScript.resolveReviewKeywords({
    defaults: keywordDefaults,
  });
  if (customerId && work.isRecordId(customerId)) {
    const picked = customers.find((c) => c.id === customerId) || await work.getCustomer(ctx.network.id, ctx.member.id, customerId);
    const jobs = await work.listJobs(ctx.network.id, ctx.member.id);
    const forCustomer = jobs.filter((j) => j.customerId === customerId);
    keywordCtx = reviewRequestScript.resolveReviewKeywords({
      customer: picked,
      jobs: forCustomer,
      defaults: keywordDefaults,
    });
  }
  // Use the saved script as-is — do not force-append the review URL.
  // fillPlaceholders only substitutes {{review_link}} when that placeholder exists.
  const shareSmsText = reviewRequestScript.fillPlaceholders(smsScript, {
    name: defaults.name || 'there',
    company: member.companyName,
    reviewLink: reviewRequestScript.scriptWantsReviewLink(smsScript) ? reviewUrl : '',
    jobTitle: keywordCtx.jobTitle,
    city: keywordCtx.city,
    keywords: keywordCtx.keywords,
  });
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
    customers: customers.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone || '',
      email: c.email || '',
      ghl: !!c.ghlContactId,
    })),
    formValues: defaults,
    smsScript,
    shareSmsText,
    keywordHint: keywordCtx.keywordHint || '',
    keywordJobTitle: keywordCtx.jobTitle || '',
    keywordCity: keywordCtx.city || '',
    keywordDefaults,
    keywordsSnippet: reviewRequestScript.KEYWORDS_SCRIPT_SNIPPET,
    defaultSmsScript: reviewRequestScript.DEFAULT_SMS_SCRIPT,
    ghlWorkflowPrompt,
    pendingRewards: pendingRewardAsks.map(presentPendingReward).filter(Boolean),
    rewardSettings: reviewReferralReward.settingsFromMember(member),
    rewardLocked,
    reviewSendLocked: freeAppSignup.isAppFreeMember(ctx.member),
    upgradeHref: '/signup',
    flash: flash || flashFromQuery(req),
  }, ctx.brand), status);
}

async function renderReviewSettings(req, res, ctx, flash, status) {
  const member = await ensureReviewSetup(ctx);
  const reward = reviewReferralReward.settingsFromMember(member);
  const rewardLocked = freeAppSignup.isAppFreeMember(member);
  return render(res, 'review_settings', { ...ctx, member }, {
    ...reviewPageLocals(member, null, ctx.brand),
    active: 'review',
    rewardSettings: reward,
    rewardDefaultScript: reviewReferralReward.DEFAULT_SCRIPT,
    rewardLocked,
    upgradeHref: '/signup',
    flash: flash || flashFromQuery(req),
  }, status);
}

router.get('/m/:token/review', withMember((req, res, ctx) => renderReview(req, res, ctx)));
router.get('/m/:token/review/settings', withMember((req, res, ctx) => renderReviewSettings(req, res, ctx)));

/**
 * Owner preview of the public request page — served under /m/:token so it stays
 * inside the installed Referral / workspace PWA (scope includes /m/…), not Safari.
 */
async function renderReviewPreview(req, res, ctx, { rating, thanks, error, formValues } = {}, status) {
  const member = await ensureReviewSetup(ctx);
  const pageBase = `${ctx.base}/review/preview`;
  const logoUrl = reviewShareImage.requestPageLogoUrl(member, ctx.brand);
  noStore(res);
  return res.status(status || 200).render('review_public', {
    network: ctx.network,
    member,
    slug: member.reviewSlug,
    brand: ctx.brand,
    logoUrl,
    pageBase,
    previewMode: true,
    previewBack: `${ctx.base}/review`,
    gate: reviewPage.reviewGate(rating),
    destinations: reviewPage.reviewDestinations(member.reviewLinks, member.reviewSlug),
    thanks: !!thanks,
    error: error || '',
    formValues: formValues || {},
    icons: ICONS,
  });
}

router.get('/m/:token/review/preview', withMember(async (req, res, ctx) => {
  const rating = reviewPage.parseRating(req.query.r);
  return renderReviewPreview(req, res, ctx, { rating });
}));

router.post('/m/:token/review/preview/feedback', form, withMember(async (req, res, ctx) => {
  const member = await ensureReviewSetup(ctx);
  const body = req.body || {};
  const rating = reviewPage.parseRating(body.rating);
  // Preview only — do not save real customer feedback from the owner sandbox.
  if (String(body.website || '').trim()) {
    return renderReviewPreview(req, res, ctx, { rating, thanks: true });
  }
  const message = String(body.message || '').trim();
  if (!message) {
    return renderReviewPreview(req, res, ctx, {
      rating,
      error: 'Tell us what happened so we can make it right.',
      formValues: body,
    }, 400);
  }
  return renderReviewPreview(req, res, ctx, { rating, thanks: true });
}));

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

/** Save the AI/GHL review SMS script + default project keywords. */
router.post('/m/:token/review/script', form, withMember(async (req, res, ctx) => {
  const member = await ensureReviewSetup(ctx);
  const body = req.body || {};
  const script = reviewRequestScript.cleanScript(body.smsScript);
  const saved = await store.saveMember(ctx.network.id, {
    ...member,
    reviewSmsScript: script || reviewRequestScript.DEFAULT_SMS_SCRIPT,
    reviewKeywordJob: reviewRequestScript.cleanPhrase(body.keywordJob, 80),
    reviewKeywordCity: reviewRequestScript.cleanPhrase(body.keywordCity, 40),
    reviewKeywords: reviewRequestScript.cleanPhrase(body.keywords, 100),
  });
  if (String(body.next || '') === 'stay') {
    return renderReview(req, res, { ...ctx, member: saved }, { ok: OK_MESSAGES.script_saved });
  }
  return res.redirect(303, `${ctx.base}/review?ok=script_saved`);
}));

/** Save post–4–5★ referral reward offer (gift card / discount / prize). */
router.post('/m/:token/review/reward', form, withMember(async (req, res, ctx) => {
  if (freeAppSignup.isAppFreeMember(ctx.member)) {
    return res.redirect(303, `${ctx.base}/review/settings?ok=reward_upgrade`);
  }
  const member = await ensureReviewSetup(ctx);
  const reward = reviewReferralReward.settingsFromBody(req.body || {});
  if (reward.enabled && !reward.rewardLabel) {
    return renderReviewSettings(req, res, { ...ctx, member }, {
      error: 'Add what they get (e.g. “$25 gift card”) before turning the reward on.',
    }, 400);
  }
  await store.saveMember(ctx.network.id, { ...member, reviewReward: reward });
  return res.redirect(303, `${ctx.base}/review/settings?ok=reward_saved`);
}));

function rewardReturnPath(ctx, body, ask) {
  const raw = String((body && body.returnTo) || '').trim();
  if (raw.startsWith(`${ctx.base}/`)) return raw.split('?')[0];
  if (ask && ask.customerId) {
    return `${ctx.base}/customers/c/${encodeURIComponent(ask.customerId)}`;
  }
  return `${ctx.base}/review`;
}

/** Business confirms the public review → send the configured referral-reward offer. */
router.post('/m/:token/review/reward/:askId/confirm', form, withMember(async (req, res, ctx) => {
  if (freeAppSignup.isAppFreeMember(ctx.member)) {
    return res.redirect(303, `${ctx.base}/review/settings?ok=reward_upgrade`);
  }
  const askId = String(req.params.askId || '');
  const ask = await reviewAsk.getAsk(askId);
  if (!ask || ask.networkId !== ctx.network.id || ask.memberId !== ctx.member.id) {
    return res.redirect(303, `${ctx.base}/review?errmsg=${encodeURIComponent('That review request was not found.')}`);
  }
  const returnTo = rewardReturnPath(ctx, req.body, ask);
  if (ask.rewardSentAt) {
    return res.redirect(303, `${returnTo}?ok=reward_sent`);
  }
  if (ask.rewardSkippedAt) {
    return res.redirect(303, `${returnTo}?errmsg=${encodeURIComponent('This one was already skipped.')}`);
  }
  const settings = reviewReferralReward.settingsFromMember(ctx.member);
  if (!reviewReferralReward.qualifies(settings, ask.rating || 5, ctx.member)) {
    return res.redirect(303, `${ctx.base}/review/settings?errmsg=${encodeURIComponent('Set up your referral reward offer in Review settings first.')}`);
  }
  const confirmed = await reviewAsk.markReviewConfirmed(ask.id, { by: ctx.member.id });
  const sent = await notify.sendReviewReferralReward({
    network: ctx.network,
    member: ctx.member,
    ask: confirmed || ask,
  }).catch((err) => ({ ok: false, error: err.message }));
  if (!sent || !sent.ok) {
    return res.redirect(303, `${returnTo}?errmsg=${encodeURIComponent((sent && sent.error) || 'Could not send the reward offer.')}`);
  }
  await reviewAsk.markRewardSent(ask.id, sent.messageId);
  return res.redirect(303, `${returnTo}?ok=reward_sent`);
}));

/** Skip sending a referral reward for this ask (e.g. no public review found). */
router.post('/m/:token/review/reward/:askId/skip', form, withMember(async (req, res, ctx) => {
  if (freeAppSignup.isAppFreeMember(ctx.member)) {
    return res.redirect(303, `${ctx.base}/review/settings?ok=reward_upgrade`);
  }
  const askId = String(req.params.askId || '');
  const ask = await reviewAsk.getAsk(askId);
  if (!ask || ask.networkId !== ctx.network.id || ask.memberId !== ctx.member.id) {
    return res.redirect(303, `${ctx.base}/review?errmsg=${encodeURIComponent('That review request was not found.')}`);
  }
  const returnTo = rewardReturnPath(ctx, req.body, ask);
  if (!ask.rewardSentAt && !ask.rewardSkippedAt) {
    await reviewAsk.markRewardSkipped(ask.id);
  }
  return res.redirect(303, `${returnTo}?ok=reward_skipped`);
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
  if (freeAppSignup.isAppFreeMember(ctx.member)) {
    return res.redirect(303, `${ctx.base}/review?ok=review_send_upgrade`);
  }
  const member = await ensureReviewSetup(ctx);
  const body = req.body || {};
  const rawAi = Array.isArray(body.useAi) ? body.useAi[body.useAi.length - 1] : body.useAi;
  let phone = String(body.phone || '').trim();
  let email = String(body.email || '').trim();
  let name = String(body.name || '').trim();
  const customerId = String(body.customerId || '').trim();
  if (customerId && work.isRecordId(customerId)) {
    const picked = await work.getCustomer(ctx.network.id, ctx.member.id, customerId);
    if (picked) {
      name = name || picked.name;
      phone = phone || picked.phone || '';
      email = email || picked.email || '';
      if (!picked.ghlContactId) {
        await memberCustomerGhl.pushCustomerToGhl(ctx.network, ctx.member.id, picked).catch(() => null);
      }
    }
  }
  const formValues = {
    phone,
    email,
    name,
    customerId,
    channel: String(body.channel || 'auto').trim() || 'auto',
    useAi: rawAi === undefined || rawAi === ''
      ? true
      : !(String(rawAi) === '0' || String(rawAi).toLowerCase() === 'false'),
    keepShareImage: body.keepShareImage === '1' || body.keepShareImage === 'on',
    keywordJob: reviewRequestScript.cleanPhrase(body.keywordJob, 80),
    keywordCity: reviewRequestScript.cleanPhrase(body.keywordCity, 40),
    keywords: reviewRequestScript.cleanPhrase(body.keywords, 100),
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

  let resolvedCustomerId = formValues.customerId && work.isRecordId(formValues.customerId)
    ? formValues.customerId
    : '';
  if (!resolvedCustomerId && (formValues.name || formValues.phone || formValues.email)) {
    const existing = work.findCustomerMatch(
      await work.listCustomers(ctx.network.id, ctx.member.id),
      { phone: formValues.phone, email: formValues.email },
    );
    if (existing) {
      resolvedCustomerId = existing.id;
    } else if (formValues.name) {
      const created = await work.saveCustomer(ctx.network.id, ctx.member.id, {
        name: formValues.name,
        phone: formValues.phone,
        email: formValues.email,
      }, { source: 'manual' });
      if (created.ok) resolvedCustomerId = created.customer.id;
    }
  }

  const keywordDefaults = reviewRequestScript.memberKeywordDefaults(memberForSend);
  let cust = null;
  let jobsForCustomer = [];
  if (resolvedCustomerId) {
    cust = await work.getCustomer(ctx.network.id, ctx.member.id, resolvedCustomerId);
    jobsForCustomer = (await work.listJobs(ctx.network.id, ctx.member.id))
      .filter((j) => j.customerId === resolvedCustomerId);
  }
  // Form overrides win; else customer job/city; else member defaults from SMS script settings.
  const kw = reviewRequestScript.resolveReviewKeywords({
    customer: cust,
    jobs: jobsForCustomer,
    jobTitle: formValues.keywordJob || '',
    city: formValues.keywordCity || '',
    keywords: formValues.keywords || '',
    defaults: keywordDefaults,
  });
  const jobTitle = kw.jobTitle;
  const city = kw.city;
  const keywords = kw.keywords;
  const result = await notify.sendReviewRequest({
    network: ctx.network,
    member: memberForSend,
    baseUrl: notify.baseUrlFromReq(req),
    toPhone: formValues.phone,
    toEmail: formValues.email,
    customerName: formValues.name,
    customerId: resolvedCustomerId,
    channel: formValues.channel,
    useAi: formValues.useAi,
    imageId,
    jobTitle,
    city,
    keywords,
  });
  if (!result.ok) {
    return renderReview(req, res, { ...ctx, member: memberForSend }, { error: result.error || 'Could not send.' }, 400, formValues);
  }
  const ok = result.channel === 'email' ? 'review_email' : 'review_sms';
  return res.redirect(303, `${ctx.base}/review?ok=${ok}`);
}));

// ── In-app lead activity bell (member PWA) ───────────────────────────────────

/** GHL texts/calls also land in memberActivity for push history — hide them from
 *  the Leads & referrals list when the Waiting on a reply (ghlItems) section is on. */
function bellActivityItems(networkId, memberId, { excludeGhlKinds = false } = {}) {
  const rows = memberActivity.list(networkId, memberId);
  if (!excludeGhlKinds) return rows;
  return rows.filter((it) => !it || !GHL_ACTIVITY_TYPES.has(String(it.kind || '').toLowerCase()));
}

function bellActivityUnread(networkId, memberId, { excludeGhlKinds = false } = {}) {
  return bellActivityItems(networkId, memberId, { excludeGhlKinds }).filter((e) => e && !e.read).length;
}

router.get('/m/:token/activity.json', withMember(async (req, res, ctx) => {
  noStore(res);
  const ghlAvailable = memberGhlAlerts.canUseGhlAlerts(ctx.member, ctx.network);
  const ghlEnabled = ghlAvailable && memberGhlAlerts.isEnabled(ctx.member);
  const ghlItems = ghlEnabled
    ? await memberGhlAlerts.listPendingForMember(ctx.member, ctx.network)
    : [];
  // When GHL alerts are on, sms/missed_call/voicemail belong only under Waiting on a reply.
  const items = bellActivityItems(ctx.network.id, ctx.member.id, { excludeGhlKinds: ghlEnabled }).slice(0, 40);
  const activityUnread = bellActivityUnread(ctx.network.id, ctx.member.id, { excludeGhlKinds: ghlEnabled });
  return res.json({
    success: true,
    unread: activityUnread + ghlItems.length,
    items,
    ghlItems,
    ghlAlertsAvailable: ghlAvailable,
    ghlAlertsEnabled: ghlEnabled,
    pushAvailable: !!(ctx.appointment && ctx.appointment.packageId),
  });
}));

router.post('/m/:token/activity/read', express.json(), withMember(async (req, res, ctx) => {
  noStore(res);
  const ids = req.body && req.body.ids;
  const result = ids == null || ids === 'all'
    ? memberActivity.markAllRead(ctx.network.id, ctx.member.id)
    : memberActivity.markRead(ctx.network.id, ctx.member.id, ids);
  const ghlEnabled = memberGhlAlerts.canUseGhlAlerts(ctx.member, ctx.network)
    && memberGhlAlerts.isEnabled(ctx.member);
  const ghlPending = ghlEnabled
    ? (await memberGhlAlerts.listPendingForMember(ctx.member, ctx.network)).length
    : 0;
  return res.json({
    success: true,
    updated: result.updated,
    unread: bellActivityUnread(ctx.network.id, ctx.member.id, { excludeGhlKinds: ghlEnabled }) + ghlPending,
  });
}));

/** Opt in/out of GHL missed-call & text alerts in the Reviews app. */
router.post('/m/:token/activity/ghl-alerts', express.json(), withMember(async (req, res, ctx) => {
  noStore(res);
  const enabled = !!(req.body && req.body.enabled);
  const result = await memberGhlAlerts.setEnabled(ctx.network, ctx.member, enabled);
  if (!result.ok) return res.status(400).json({ success: false, error: result.error });
  ctx.member = result.member;
  const ghlItems = result.enabled
    ? await memberGhlAlerts.listPendingForMember(ctx.member, ctx.network)
    : [];
  return res.json({
    success: true,
    ghlAlertsEnabled: result.enabled,
    ghlAlertsAvailable: true,
    ghlItems,
    unread: bellActivityUnread(ctx.network.id, ctx.member.id, { excludeGhlKinds: result.enabled }) + ghlItems.length,
  });
}));

/** Mark a GHL inbound lead done from the Reviews bell (same as Agency OS Done). */
router.post('/m/:token/activity/ghl-done', express.json(), withMember(async (req, res, ctx) => {
  noStore(res);
  const done = await memberGhlAlerts.markLeadDone(ctx.member, ctx.network, req.body && req.body.leadKey);
  if (!done.ok) return res.status(400).json({ success: false, error: done.error });
  const ghlItems = await memberGhlAlerts.listPendingForMember(ctx.member, ctx.network);
  const ghlEnabled = memberGhlAlerts.isEnabled(ctx.member);
  return res.json({
    success: true,
    ghlItems,
    unread: bellActivityUnread(ctx.network.id, ctx.member.id, { excludeGhlKinds: ghlEnabled }) + ghlItems.length,
  });
}));

// ── Website / agency leads (actions live here; UI is on Leads & Referrals) ───

/** Legacy /leads URL → unified Leads & Referrals page. */
router.get('/m/:token/leads', withMember((req, res, ctx) => {
  const qs = new URLSearchParams(req.query).toString();
  return res.redirect(303, `${ctx.base}/referrals${qs ? `?${qs}` : ''}`);
}));

/** Freemium: request a lead pack — pings agency admins that this business wants more work. */
router.post('/m/:token/leads/request', form, withMember(async (req, res, ctx) => {
  const quantity = Math.round(Number((req.body && req.body.quantity) || memberLeadRequests.DEFAULT_QTY));
  const note = String((req.body && req.body.note) || '').trim();
  const result = await memberLeadRequests.requestMoreLeads(ctx, { quantity, note });
  const backHome = String((req.body && req.body.back) || '').includes('home');
  if (!result.ok) {
    const back = backHome ? ctx.base : `${ctx.base}/referrals`;
    const q = result.code === 'subscribe' ? 'err=leads_subscribe'
      : result.code === 'cooldown' ? 'err=leads_cooldown'
        : 'err=leads_request';
    return res.redirect(303, `${back}?${q}`);
  }
  const back = backHome
    ? `${ctx.base}?ok=leads_requested`
    : `${ctx.base}/referrals?ok=leads_requested`;
  return res.redirect(303, back);
}));

router.post('/m/:token/leads/:leadId/close', form, withMember(async (req, res, ctx) => {
  if (!ctx.appointment) {
    return res.redirect(303, `${ctx.base}/referrals`);
  }
  if (!(await memberLeadRequests.planAllowsLeadDetails(ctx.network, ctx.member))) {
    return res.redirect(303, `${ctx.base}/referrals?ok=referrals_upgrade`);
  }
  const leadId = String(req.params.leadId || '').trim();
  const pkg = ctx.appointment.package;
  const formLeads = (pkg.formLeads || []).map((f) =>
    (f.id === leadId ? { ...f, status: 'closed' } : f),
  );
  await appointmentPackages.updatePackage(ctx.appointment.workspaceId, ctx.appointment.packageId, { formLeads });
  return res.redirect(303, `${ctx.base}/referrals?ok=closed`);
}));

/**
 * Push a website/agency form lead to a network partner as a referral —
 * no copy/paste. Prefills name/phone/email/note from the form lead.
 */
router.post('/m/:token/leads/:leadId/refer', form, withMember(async (req, res, ctx) => {
  const back = `${ctx.base}/referrals`;
  if (!(await memberLeadRequests.planAllowsLeadDetails(ctx.network, ctx.member))) {
    return res.redirect(303, `${back}?ok=referrals_upgrade`);
  }
  if (!ctx.appointment) {
    return res.redirect(303, back);
  }
  if (ctx.member.status !== 'active') {
    return renderReferrals(req, res, ctx, { error: 'Your membership is paused. Contact the network.' }, 403);
  }

  const leadId = String(req.params.leadId || '').trim();
  const body = req.body || {};
  const pkg = ctx.appointment.package;
  const lead = (pkg.formLeads || []).find((f) => f && f.id === leadId);
  if (!lead || lead.status === 'closed') {
    return renderReferrals(req, res, ctx, { error: 'That lead is not available.' }, 404);
  }
  if (!lead.phone && !lead.email) {
    return renderReferrals(req, res, ctx, { error: 'This lead needs a phone or email before you can send it.' }, 400);
  }

  let tradeSlug = String(body.tradeSlug || '').trim();
  const toMemberId = String(body.toMemberId || '').trim();
  if (toMemberId) {
    const target = (await store.listMembers(ctx.network.id)).find((m) => m.id === toMemberId && m.status === 'active');
    if (!target) {
      return renderReferrals(req, res, ctx, { error: 'Pick a partner on your network.' }, 400);
    }
    if (target.id === ctx.member.id) {
      return renderReferrals(req, res, ctx, { error: 'Pick a partner other than yourself.' }, 400);
    }
    if (!tradeSlug) {
      const theirs = (Array.isArray(target.trades) ? target.trades : [])
        .filter((slug) => ctx.network.trades.includes(slug) && !ctx.member.trades.includes(slug));
      tradeSlug = theirs[0] || (Array.isArray(target.trades) ? target.trades[0] : '') || '';
    }
  }
  if (!tradeSlug) {
    return renderReferrals(req, res, ctx, { error: 'Pick a trade or a partner to send this lead to.' }, 400);
  }
  if (ctx.member.trades.includes(tradeSlug)) {
    return renderReferrals(req, res, ctx, { error: 'Pick a trade other than your own.' }, 400);
  }

  const noteBits = [
    lead.preview || '',
    lead.source === 'agency' ? 'Sent by agency' : (lead.formName ? `From ${lead.formName}` : 'Website form'),
  ].filter(Boolean);
  const result = await networkReferrals.sendReferral({
    network: ctx.network,
    input: {
      tradeSlug,
      name: lead.name || 'Lead',
      phone: lead.phone || '',
      email: lead.email || '',
      note: noteBits.join(' · ').slice(0, 1000),
      consent: 'on',
    },
    fromMemberId: ctx.member.id,
    by: ctx.member.companyName,
    baseUrl: notify.baseUrlFromReq(req),
    toMemberId,
  });
  if (!result.ok) {
    return renderReferrals(req, res, ctx, { error: result.error || 'Could not send that lead.' }, 400);
  }

  const formLeads = (pkg.formLeads || []).map((f) => (
    f.id === leadId
      ? {
        ...f,
        status: 'closed',
        preview: [f.preview, `Referred to network ${new Date().toLocaleDateString()}`].filter(Boolean).join(' · ').slice(0, 240),
      }
      : f
  ));
  await appointmentPackages.updatePackage(ctx.appointment.workspaceId, ctx.appointment.packageId, { formLeads });

  const ok = result.referral.status === 'sent' ? 'lead_referred' : 'lead_referred_pool';
  return res.redirect(303, `${back}?ok=${ok}&view=sent`);
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
      url: `${ctx.base}/referrals`,
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
