/**
 * Public reviews-app signup (AdHello.io → /app, /app/flooring).
 * Creates (or reopens) a network member with plan "app_free" (30-day trial on
 * the AdHello Agency network) or "app_flooring" (material-purchase access on
 * the TPR Flooring network by default, no timed trial), then texts/emails the
 * installable /m/:token link.
 * Does not create an Agency OS workspace trial or GHL sub-account at signup.
 * A managed Agency OS workspace is created later on first customer-list upload
 * (see freeAppListWorkspace) so ops can run that list from the CRM.
 * Platform / network admins can activate the member to a paid partner plan early.
 */

const crypto = require('crypto');
const dbService = require('./database');
const store = require('./networkStore');
const notify = require('./networkNotify');
const referralNetwork = require('./referralNetwork');
const { upsertOpenTaskForLead, TASK_SOURCE_NETWORK } = require('./userTasks');

const PLAN_APP_FREE = 'app_free';
/** Flooring partners: no timed trial — access while they buy material from the supplier. */
const PLAN_APP_FLOORING = 'app_flooring';
const OFFER_FLOORING = 'flooring';
const DEFAULT_WORKSPACE_SLUG = 'adhello-agency';
/** Default host for /app/flooring — material quotes go to this network’s owner. */
const DEFAULT_FLOORING_WORKSPACE_SLUG = 'tpr-flooring';
const DAY_MS = 86400000;
const TERMS_VERSION_FLOORING = 'reviews-flooring-material-v1';
const IP_DAY_PREFIX = 'freeAppSignupIp:';
const MAX_PER_IP_PER_DAY = 8;

function envInt(name, fallback) {
  const n = parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Reviews-app trial length (days). Override with FREE_APP_TRIAL_DAYS. */
function appTrialDays() {
  return envInt('FREE_APP_TRIAL_DAYS', 30);
}
/** Per-contact lock while a signup/send is in flight (blocks double-click races). */
const INFLIGHT_PREFIX = 'freeAppSignupInflight:';
const INFLIGHT_TTL_MS = 60 * 1000;
/** Skip a second welcome/resend SMS for the same contact within this window. */
const SEND_COOLDOWN_PREFIX = 'freeAppSignupSend:';
const SEND_COOLDOWN_MS = 60 * 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function contactLockKey({ digits, email }) {
  if (digits) return `p:${digits}`;
  if (email) return `e:${String(email).trim().toLowerCase()}`;
  return '';
}

function wasRecentlySent(key, now = Date.now()) {
  if (!key) return false;
  const raw = dbService.getKvSync(`${SEND_COOLDOWN_PREFIX}${key}`);
  const ts = parseInt(raw || '0', 10) || 0;
  return ts > 0 && now - ts < SEND_COOLDOWN_MS;
}

function markSent(key, now = Date.now()) {
  if (!key) return;
  dbService.setKvSync(`${SEND_COOLDOWN_PREFIX}${key}`, String(now));
}

function tryAcquireInflight(key, now = Date.now()) {
  if (!key) return true;
  const kv = `${INFLIGHT_PREFIX}${key}`;
  const raw = dbService.getKvSync(kv);
  const ts = parseInt(raw || '0', 10) || 0;
  if (ts > 0 && now - ts < INFLIGHT_TTL_MS) return false;
  dbService.setKvSync(kv, String(now));
  return true;
}

function releaseInflight(key) {
  if (!key) return;
  dbService.deleteKvSync(`${INFLIGHT_PREFIX}${key}`);
}

function envSlug() {
  return String(process.env.FREE_APP_WORKSPACE_SLUG || DEFAULT_WORKSPACE_SLUG)
    .trim()
    .toLowerCase() || DEFAULT_WORKSPACE_SLUG;
}

function envNetworkId() {
  return String(process.env.FREE_APP_NETWORK_ID || '').trim();
}

function flooringEnvSlug() {
  return String(process.env.FREE_APP_FLOORING_WORKSPACE_SLUG || DEFAULT_FLOORING_WORKSPACE_SLUG)
    .trim()
    .toLowerCase() || DEFAULT_FLOORING_WORKSPACE_SLUG;
}

function flooringEnvNetworkId() {
  return String(process.env.FREE_APP_FLOORING_NETWORK_ID || '').trim();
}

function phoneDigits(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

function cleanEmail(value) {
  const e = String(value || '').trim().toLowerCase().slice(0, 200);
  return e.includes('@') && e.includes('.') ? e : '';
}

function dayKey(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

function ipHash(ip) {
  return crypto.createHash('sha256').update(String(ip || 'unknown')).digest('hex').slice(0, 16);
}

function takeIpSlot(ip, now = Date.now()) {
  const key = `${IP_DAY_PREFIX}${dayKey(now)}:${ipHash(ip)}`;
  const n = parseInt(dbService.getKvSync(key) || '0', 10) || 0;
  if (n >= MAX_PER_IP_PER_DAY) return false;
  dbService.setKvSync(key, String(n + 1));
  return true;
}

/** Checkbox truthy values from the public signup form. */
function acceptedTerms(body = {}) {
  const raw = body.acceptTerms != null ? body.acceptTerms : body.terms;
  const v = String(raw == null ? '' : raw).trim().toLowerCase();
  return v === 'on' || v === '1' || v === 'true' || v === 'yes';
}

/** Current Reviews app signup terms id (pay-per-performance / lead commission). */
const TERMS_VERSION = 'reviews-ppp-v1';

function normalizeSignupOffer(raw) {
  const o = String(raw || '').trim().toLowerCase();
  return o === OFFER_FLOORING || o === 'flooring_material' || o === 'material' ? OFFER_FLOORING : '';
}

function isFlooringOffer(offerOrMember) {
  if (!offerOrMember) return false;
  if (typeof offerOrMember === 'string') return normalizeSignupOffer(offerOrMember) === OFFER_FLOORING;
  const plan = String(offerOrMember.plan || '');
  const offer = String(offerOrMember.signupOffer || '');
  return plan === PLAN_APP_FLOORING || normalizeSignupOffer(offer) === OFFER_FLOORING;
}

/** Max drive distance options (miles) for Reviews signup service area. */
const DRIVE_MILES_OPTIONS = [10, 15, 20, 25, 30, 45, 60, 75, 100];

function parseDriveMiles(raw) {
  const n = parseInt(String(raw == null ? '' : raw).trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (DRIVE_MILES_OPTIONS.includes(n)) return n;
  // Allow typed values in a sensible band (e.g. 40).
  if (n >= 5 && n <= 200) return n;
  return 0;
}

/** @returns {{ form: object, errors: string[] }} */
function readForm(body = {}) {
  const pick = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
  const termsOk = acceptedTerms(body);
  const serviceTrades = pick(
    body.serviceTrades || body.workTrades || body.trades || body.areas,
    200,
  );
  const serviceCity = pick(body.serviceCity || body.city || body.workCity, 80);
  const serviceRadiusMiles = parseDriveMiles(body.serviceRadiusMiles || body.driveMiles || body.driveRadius);
  const form = {
    contactName: pick(body.contactName || body.name, 120),
    companyName: pick(body.companyName || body.company, 160),
    phone: pick(body.phone, 40),
    email: pick(body.email, 200),
    serviceTrades,
    serviceCity,
    serviceRadiusMiles,
    acceptTerms: termsOk,
  };
  const errors = [];
  if (!form.contactName) errors.push('Add your name.');
  if (!form.companyName) errors.push('Add your business name.');
  if (!form.serviceTrades) errors.push('Add the trades or areas you work in.');
  if (!form.serviceCity) errors.push('Add the city you work in.');
  if (!form.serviceRadiusMiles) {
    errors.push('Choose how far you’re willing to drive for reviews and referrals.');
  }
  const digits = phoneDigits(form.phone);
  const email = cleanEmail(form.email);
  if (!digits && !email) errors.push('Add a mobile number or email so we can send your app link.');
  if (form.phone && !digits) errors.push('That phone number does not look valid.');
  if (form.email && !email) errors.push('That email does not look valid.');
  if (!termsOk) {
    errors.push('Agree to the Terms & Conditions (pay-per-performance commission on direct website/CRM leads) to continue.');
  }
  return {
    form: { ...form, email: email || form.email, phone: form.phone },
    errors,
    digits,
    email,
  };
}

function cleanJoinSlug(slug) {
  return String(slug || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function slugifyJoinName(name) {
  return cleanJoinSlug(name) || 'network';
}

async function ownerEmailFromWorkspace(ws) {
  const direct = String((ws && ws.ownerEmail) || '').trim().toLowerCase();
  if (direct) return direct;
  const members = ws && ws.members && typeof ws.members === 'object' ? ws.members : {};
  const owner = Object.entries(members).find(([, row]) => row && row.role === 'owner');
  return owner ? String(owner[0] || '').trim().toLowerCase() : '';
}

async function resolveFreeAppNetwork() {
  const forcedId = envNetworkId();
  if (forcedId) {
    const network = await store.getNetwork(forcedId);
    if (!network) throw new Error('Free-app network is not configured.');
    return network;
  }
  const slug = envSlug();
  const workspaceId = await dbService.getWorkspaceIdForSlug(slug);
  if (!workspaceId) throw new Error('AdHello Agency workspace is not set up yet.');
  const ws = await dbService.getWorkspace(workspaceId);
  return store.getOrCreateNetworkForWorkspace(workspaceId, {
    name: (ws && ws.name) || 'AdHello',
    ownerEmail: await ownerEmailFromWorkspace(ws),
  });
}

/**
 * Prefer slug mapping; if missing, find a workspace named like TPR Flooring and
 * ensure the flooring slug points at it (so /app/flooring works without a
 * manual slug edit on an existing workspace).
 */
async function resolveFlooringWorkspaceId(slug) {
  const bySlug = await dbService.getWorkspaceIdForSlug(slug);
  if (bySlug) {
    const bySlugWs = await dbService.getWorkspace(bySlug);
    // Never treat Bright Electric / Agency as the flooring host, even if the
    // slug mapping was pointed there by mistake.
    if (bySlugWs && !isExcludedFlooringHostWorkspace(bySlugWs)) return bySlug;
  }
  try {
    const ids = await dbService.listWorkspaceIds();
    for (const id of ids || []) {
      // eslint-disable-next-line no-await-in-loop
      const ws = await dbService.getWorkspace(id);
      if (!ws || isExcludedFlooringHostWorkspace(ws)) continue;
      const name = String(ws.name || '').trim().toLowerCase();
      if (name !== 'tpr flooring' && !/^tpr\b.*\bflooring\b/.test(name)) continue;
      const existingSlug = cleanJoinSlug(ws.slug);
      if (!existingSlug || existingSlug === slug) {
        await dbService.saveWorkspace(ws.id, { ...ws, slug });
      }
      await dbService.saveWorkspaceSlug(slug, ws.id);
      return ws.id;
    }
  } catch (_) {
    /* fall through */
  }
  return '';
}

/**
 * Network that receives /app/flooring partners (material quotes → owner).
 * Defaults to the TPR Flooring workspace; override with FREE_APP_FLOORING_*.
 */
async function resolveFlooringAppNetwork() {
  const forcedId = flooringEnvNetworkId();
  if (forcedId) {
    const network = await store.getNetwork(forcedId);
    if (!network) throw new Error('Flooring-app network is not configured.');
    if (network.ownerWorkspaceId) {
      const forcedWs = await dbService.getWorkspace(network.ownerWorkspaceId);
      if (isExcludedFlooringHostWorkspace(forcedWs)) {
        throw new Error('Flooring-app network cannot be Bright Electric or AdHello Agency.');
      }
    }
    return network;
  }
  const slug = flooringEnvSlug();
  const workspaceId = await resolveFlooringWorkspaceId(slug);
  if (!workspaceId) {
    throw new Error('TPR Flooring workspace is not set up yet (slug: ' + slug + ').');
  }
  const ws = await dbService.getWorkspace(workspaceId);
  if (isExcludedFlooringHostWorkspace(ws)) {
    throw new Error('Flooring partners belong on TPR Flooring, not Bright Electric / Agency.');
  }
  return store.getOrCreateNetworkForWorkspace(workspaceId, {
    name: (ws && ws.name) || 'TPR Flooring',
    ownerEmail: await ownerEmailFromWorkspace(ws),
  });
}

/** Workspaces that must never host /app/flooring (electric / agency demos). */
function isExcludedFlooringHostWorkspace(ws) {
  if (!ws) return false;
  const slug = cleanJoinSlug(ws.slug);
  const name = String(ws.name || '').trim().toLowerCase();
  if (slug === 'bright-electric' || slug === 'adhello-agency') return true;
  if (name === 'bright electric' || name === 'adhello agency') return true;
  return false;
}

/** True when this Agency OS workspace hosts the public /app/flooring offer. */
function isFlooringHostWorkspace(ws) {
  if (!ws || isExcludedFlooringHostWorkspace(ws)) return false;
  const slug = cleanJoinSlug(ws.slug);
  if (slug && slug === flooringEnvSlug()) return true;
  // Name fallback for the default TPR host (slug may not be set yet).
  if (flooringEnvSlug() !== DEFAULT_FLOORING_WORKSPACE_SLUG) return false;
  const name = String(ws.name || '').trim().toLowerCase();
  return name === 'tpr flooring' || /^tpr\b.*\bflooring\b/.test(name);
}

async function isFlooringHostNetwork(network) {
  if (!network || !network.ownerWorkspaceId) return false;
  const forcedId = flooringEnvNetworkId();
  if (forcedId && String(network.id) === forcedId) return true;
  try {
    const ws = await dbService.getWorkspace(network.ownerWorkspaceId);
    return isFlooringHostWorkspace(ws);
  } catch (_) {
    return false;
  }
}

/**
 * Resolve a network from a public join slug (workspace slug).
 * @returns {Promise<object|null>}
 */
async function resolveNetworkByJoinSlug(joinSlug) {
  const slug = cleanJoinSlug(joinSlug);
  if (!slug) return null;
  const workspaceId = await dbService.getWorkspaceIdForSlug(slug);
  if (!workspaceId) return null;
  return store.getNetworkForWorkspace(workspaceId);
}

/**
 * Workspace slug used in https://reviews.adhello.io/join/{slug}.
 * Ensures the slug KV mapping exists; creates a slug from the workspace name if missing.
 */
async function getOrEnsureJoinSlug(network) {
  if (!network || !network.ownerWorkspaceId) return '';
  const ws = await dbService.getWorkspace(network.ownerWorkspaceId);
  if (!ws) return '';
  let slug = cleanJoinSlug(ws.slug);
  if (!slug) {
    const base = slugifyJoinName(ws.name || network.name || 'network');
    slug = base;
    for (let i = 0; i < 40; i += 1) {
      const candidate = i === 0 ? base : `${base}-${i + 1}`;
      // eslint-disable-next-line no-await-in-loop
      const taken = await dbService.getWorkspaceIdForSlug(candidate);
      if (!taken || taken === ws.id) {
        slug = candidate;
        break;
      }
    }
    await dbService.saveWorkspace(ws.id, { ...ws, slug });
  }
  await dbService.saveWorkspaceSlug(slug, ws.id);
  return slug;
}

/**
 * Supplier / retail-install workspaces (e.g. Flooring, TPR Flooring) share a
 * flooring-partner signup link so joiners get Quote access on *that* network —
 * not the public AdHello /app/flooring pool.
 */
function isFlooringNetworkWorkspace(ws) {
  if (!ws || typeof ws !== 'object') return false;
  const name = String(ws.name || '').toLowerCase();
  if (name.includes('flooring')) return true;
  const vertical = String(
    (ws.salesIntake && ws.salesIntake.vertical) ||
      (ws.pipelineIntake && ws.pipelineIntake.vertical) ||
      '',
  ).toLowerCase();
  if (vertical.includes('flooring')) return true;
  const preset = String(
    ws.salesScriptsPresetKey ||
      (ws.pipelineIntake && ws.pipelineIntake.presetKey) ||
      ws.presetKey ||
      '',
  ).toLowerCase();
  return (
    preset === 'flooring_install' ||
    preset === 'commercial_flooring' ||
    preset === 'retail_install'
  );
}

function matchesContact(member, { digits, email }) {
  if (digits && phoneDigits(member.phone) === digits) return true;
  if (email && cleanEmail(member.email) === email) return true;
  return false;
}

async function findExistingMember(networkId, { digits, email }) {
  if (!digits && !email) return null;
  const members = await store.listMembers(networkId);
  return members.find((m) => matchesContact(m, { digits, email })) || null;
}

async function notifyOperatorNewFreeApp({ network, member }) {
  let owner = String(network.ownerEmail || '').trim().toLowerCase();
  if (!owner) {
    const ws = await dbService.getWorkspace(network.ownerWorkspaceId);
    const members = ws && ws.members && typeof ws.members === 'object' ? ws.members : {};
    const row = Object.entries(members).find(([, m]) => m && m.role === 'owner');
    owner = row ? row[0] : '';
  }
  if (!owner) return null;
  try {
    return await upsertOpenTaskForLead(network.ownerWorkspaceId, owner, {
      title: `Reviews app trial: ${member.companyName}${member.contactName ? ` (${member.contactName})` : ''}`.slice(0, 240),
      leadKey: member.leadKey || null,
      scheduledAt: new Date().toISOString(),
      source: TASK_SOURCE_NETWORK,
    });
  } catch (err) {
    console.warn('[free-app] operator task failed:', err.message);
    return null;
  }
}

/**
 * Create or reopen a free app member and send their portal link.
 * Double-submit safe: per-contact inflight lock + short send cooldown.
 * @returns {{ ok: true, member, network, notified, created: boolean } | { ok: false, error: string, code?: string }}
 */
async function signupFreeApp({
  form,
  digits,
  email,
  baseUrl,
  ip,
  network: networkOpt = null,
  joinSlug = '',
  offer: offerOpt = '',
} = {}) {
  const lockKey = contactLockKey({ digits, email });
  const viaJoin = !!cleanJoinSlug(joinSlug) || !!(networkOpt && networkOpt.id);
  let offer = normalizeSignupOffer(offerOpt || (form && form.signupOffer));
  let flooring = offer === OFFER_FLOORING;

  let network = networkOpt || null;
  if (!network && joinSlug) {
    network = await resolveNetworkByJoinSlug(joinSlug);
    if (!network) {
      return { ok: false, code: 'not_found', error: 'That signup link is not valid or the network was removed.' };
    }
  }
  // Join links on the flooring host workspace always create flooring partners
  // (material quotes → that workspace owner), even without ?offer=flooring.
  if (network && !flooring && viaJoin && (await isFlooringHostNetwork(network))) {
    flooring = true;
    offer = OFFER_FLOORING;
  }
  const memberPlan = flooring ? PLAN_APP_FLOORING : PLAN_APP_FREE;
  const termsVersion = flooring ? TERMS_VERSION_FLOORING : TERMS_VERSION;

  if (!network) {
    try {
      network = flooring
        ? await resolveFlooringAppNetwork()
        : await resolveFreeAppNetwork();
    } catch (err) {
      return { ok: false, code: 'config', error: err.message || 'Free app signup is not available right now.' };
    }
  }

  // Fast path: same contact just got a link (classic double-click after first send).
  if (wasRecentlySent(lockKey)) {
    const existing = await findExistingMember(network.id, { digits, email });
    return {
      ok: true,
      member: existing,
      network,
      notified: { ok: true, skipped: 'cooldown' },
      created: false,
    };
  }

  if (!tryAcquireInflight(lockKey)) {
    // Another request is creating/sending for this contact — wait briefly, then succeed without a second SMS.
    let existing = null;
    for (let i = 0; i < 20; i += 1) {
      await sleep(50);
      existing = await findExistingMember(network.id, { digits, email });
      if (existing) break;
    }
    return {
      ok: true,
      member: existing,
      network,
      notified: { ok: true, skipped: 'inflight' },
      created: false,
    };
  }

  try {
    if (!takeIpSlot(ip)) {
      return {
        ok: false,
        code: 'rate_limit',
        error: 'Too many signups from this network today. Try again tomorrow or text us.',
      };
    }

    // Re-check after lock: the winner of a race may have finished.
    if (wasRecentlySent(lockKey)) {
      const existing = await findExistingMember(network.id, { digits, email });
      return {
        ok: true,
        member: existing,
        network,
        notified: { ok: true, skipped: 'cooldown' },
        created: false,
      };
    }

    const existing = await findExistingMember(network.id, { digits, email });
    if (existing) {
      let member = existing;
      // Returning visitor: reopen if paused; keep partner plans, else mark freemium plan.
      const patch = {};
      if (member.status === 'paused' && !isAppTrialExpired(member)) patch.status = 'active';
      // Don't re-apply freemium after an admin activated them to a partner seat.
      if (!member.plan && !member.planActivatedAt) patch.plan = memberPlan;
      // Flooring partners: move trial members onto material-access plan (no expiry).
      if (flooring && !member.planActivatedAt && (member.plan === PLAN_APP_FREE || !member.plan)) {
        patch.plan = PLAN_APP_FLOORING;
        patch.signupOffer = OFFER_FLOORING;
        patch.trialEndsAt = '';
      }
      // Backfill trial end for legacy free signups that never had one (not flooring).
      if (!flooring
        && (patch.plan || member.plan) === PLAN_APP_FREE
        && !member.trialEndsAt
        && !member.planActivatedAt) {
        const start = Date.parse(member.joinedAt || '') || Date.now();
        patch.trialEndsAt = new Date(start + appTrialDays() * DAY_MS).toISOString();
      }
      // Record / refresh Terms acceptance from this signup submit.
      if (form.acceptTerms) {
        patch.termsAcceptedAt = new Date().toISOString();
        patch.termsVersion = termsVersion;
      }
      // Refresh service area from this signup (trades, city, drive radius).
      if (form.serviceTrades) patch.serviceTrades = form.serviceTrades;
      if (form.serviceCity) {
        patch.serviceCity = form.serviceCity;
        if (!member.reviewKeywordCity) patch.reviewKeywordCity = form.serviceCity;
      }
      if (form.serviceRadiusMiles) patch.serviceRadiusMiles = form.serviceRadiusMiles;
      if (Object.keys(patch).length) {
        member = await store.saveMember(network.id, { ...member, ...patch });
      }
      const notified = await notify.sendMemberPortalLink({ network, member, baseUrl, welcome: false })
        .catch((err) => ({ ok: false, error: err.message }));
      if (notified && notified.ok) markSent(lockKey);
      return { ok: true, member, network, notified, created: false };
    }

    const areaBits = [
      form.serviceTrades ? `Trades/areas: ${form.serviceTrades}` : '',
      form.serviceCity ? `City: ${form.serviceCity}` : '',
      form.serviceRadiusMiles ? `Drive: ${form.serviceRadiusMiles} mi` : '',
    ].filter(Boolean).join(' · ');
    const saved = await dbService.saveLeadWithMeta({
      workspaceId: network.ownerWorkspaceId,
      title: form.companyName,
      contactName: form.contactName || '',
      phone: form.phone || 'N/A',
      email: email || form.email || 'N/A',
      city: form.serviceCity || '',
      source: viaJoin
        ? 'network_join_signup'
        : (flooring ? 'flooring_partner_signup' : 'free_app_signup'),
      message: [
        viaJoin
          ? `Joined ${network.name || 'network'} via public signup link`
          : (flooring
            ? 'Signed up for Reviews App as a flooring partner (material purchase access)'
            : 'Signed up for the AdHello reviews app trial'),
        areaBits,
      ].filter(Boolean).join(' — '),
    });
    const lead = await dbService.getLead(saved.key, network.ownerWorkspaceId);
    if (!lead || !lead.key) {
      return { ok: false, code: 'failed', error: 'Could not create your account. Try again.' };
    }
    const connected = referralNetwork.applyPartnerAction(lead, 'connect');
    if (connected.ok) {
      await dbService.updateLead(lead.key, { referralPartner: connected.referralPartner }, network.ownerWorkspaceId);
    }

    const joinedAt = new Date().toISOString();
    const trialEndsAt = flooring
      ? ''
      : new Date(Date.parse(joinedAt) + appTrialDays() * DAY_MS).toISOString();
    const member = await store.saveMember(network.id, {
      leadKey: lead.key,
      companyName: form.companyName,
      contactName: form.contactName,
      phone: form.phone || '',
      email: email || '',
      status: 'active',
      plan: memberPlan,
      signupOffer: offer || '',
      trialEndsAt,
      joinedAt,
      termsAcceptedAt: joinedAt,
      termsVersion,
      serviceTrades: form.serviceTrades || '',
      serviceCity: form.serviceCity || '',
      serviceRadiusMiles: form.serviceRadiusMiles || 0,
      // Seed review keyword city from the city they said they work in.
      reviewKeywordCity: form.serviceCity || '',
    });

    const notified = await notify.sendMemberPortalLink({ network, member, baseUrl, welcome: true })
      .catch((err) => ({ ok: false, error: err.message }));
    if (notified && notified.ok) markSent(lockKey);

    setImmediate(() => {
      notifyOperatorNewFreeApp({ network, member }).catch(() => {});
      // Reviews-app 7-day onboarding (separate from Agency OS leader drip).
      // Day 1 = welcome just sent; schedule Days 2–7.
      try {
        const reviewsOnboardingDrip = require('./reviewsOnboardingDrip');
        reviewsOnboardingDrip
          .enrollMember({ network, member, baseUrl, skipDay1: true })
          .catch((err) => console.error('[REVIEWS-ONBOARDING] enroll failed:', err.message));
      } catch (err) {
        console.error('[REVIEWS-ONBOARDING] enroll setup failed:', err.message);
      }
    });

    return { ok: true, member, network, notified, created: true };
  } finally {
    releaseInflight(lockKey);
  }
}

function isAppFreeMember(member) {
  const plan = String((member && member.plan) || '');
  return plan === PLAN_APP_FREE || plan === PLAN_APP_FLOORING;
}

/**
 * Reviews-app trial status for an app_free / flooring member.
 * @returns {null | { state: 'trial'|'expired'|'active', daysLeft: number, endsAt: string, label: string }}
 */
function appTrialStatus(member, now = Date.now()) {
  if (!member || !isAppFreeMember(member)) {
    if (member && member.planActivatedAt) {
      return { state: 'active', daysLeft: 0, endsAt: '', label: 'Active' };
    }
    return null;
  }
  // Flooring partners: no clock — access while they buy material.
  if (isFlooringOffer(member)) {
    return { state: 'active', daysLeft: 0, endsAt: '', label: 'Flooring partner' };
  }
  const endsMs = Date.parse(member.trialEndsAt || '') || 0;
  // Legacy free signups without trialEndsAt: treat as still on trial for 30 days from join.
  const fallbackStart = Date.parse(member.joinedAt || '') || now;
  const effectiveEnds = endsMs || fallbackStart + appTrialDays() * DAY_MS;
  const msLeft = effectiveEnds - now;
  if (msLeft > 0) {
    const daysLeft = Math.ceil(msLeft / DAY_MS);
    return {
      state: 'trial',
      daysLeft,
      endsAt: new Date(effectiveEnds).toISOString(),
      label: daysLeft <= 1 ? 'Trial · last day' : `Trial · ${daysLeft}d`,
    };
  }
  return {
    state: 'expired',
    daysLeft: 0,
    endsAt: new Date(effectiveEnds).toISOString(),
    label: 'Expired',
  };
}

function isAppTrialExpired(member, now = Date.now()) {
  const st = appTrialStatus(member, now);
  return !!(st && st.state === 'expired');
}

/**
 * Convert an app_free trial member to a paid partner (clears freemium plan).
 * Can be done any time — no need to wait for the trial to end.
 */
async function activateAppMember(networkId, member, { by } = {}) {
  if (!member || !member.id) throw new Error('Member not found.');
  if (!isAppFreeMember(member)) {
    return { member, already: true };
  }
  const now = new Date().toISOString();
  const saved = await store.saveMember(networkId, {
    ...member,
    plan: '',
    planActivatedAt: now,
    status: 'active',
    trialEndsAt: member.trialEndsAt || '',
  });
  return { member: saved, already: false, by: by || '', at: now };
}

/** Normalize `?plan=` on Network → Members (`free` | `partner` | ''). */
function normalizeMemberPlanFilter(value) {
  const q = String(value || '').trim().toLowerCase();
  if (q === 'free' || q === 'trial' || q === 'partner') return q === 'trial' ? 'free' : q;
  return '';
}

function matchesMemberPlanFilter(member, filter) {
  const plan = normalizeMemberPlanFilter(filter);
  if (!plan) return true;
  const free = isAppFreeMember(member);
  return plan === 'free' ? free : !free;
}

module.exports = {
  PLAN_APP_FREE,
  PLAN_APP_FLOORING,
  OFFER_FLOORING,
  DEFAULT_WORKSPACE_SLUG,
  DEFAULT_FLOORING_WORKSPACE_SLUG,
  TERMS_VERSION,
  TERMS_VERSION_FLOORING,
  SEND_COOLDOWN_PREFIX,
  INFLIGHT_PREFIX,
  appTrialDays,
  contactLockKey,
  cleanJoinSlug,
  flooringEnvSlug,
  normalizeSignupOffer,
  isFlooringOffer,
  isFlooringHostWorkspace,
  isFlooringHostNetwork,
  readForm,
  phoneDigits,
  DRIVE_MILES_OPTIONS,
  parseDriveMiles,
  cleanEmail,
  takeIpSlot,
  resolveFreeAppNetwork,
  resolveFlooringAppNetwork,
  resolveNetworkByJoinSlug,
  getOrEnsureJoinSlug,
  isFlooringNetworkWorkspace,
  findExistingMember,
  signupFreeApp,
  isAppFreeMember,
  appTrialStatus,
  isAppTrialExpired,
  activateAppMember,
  normalizeMemberPlanFilter,
  matchesMemberPlanFilter,
};
