/**
 * Public reviews-app signup (AdHello.io → /app).
 * Creates (or reopens) a network member on the AdHello Agency network with
 * plan "app_free" on a 30-day trial, then texts/emails the installable /m/:token link.
 * Does not create an Agency OS workspace trial or GHL sub-account.
 * Platform / network admins can activate the member to a paid partner plan early.
 */

const crypto = require('crypto');
const dbService = require('./database');
const store = require('./networkStore');
const notify = require('./networkNotify');
const referralNetwork = require('./referralNetwork');
const { upsertOpenTaskForLead, TASK_SOURCE_NETWORK } = require('./userTasks');

const PLAN_APP_FREE = 'app_free';
const DEFAULT_WORKSPACE_SLUG = 'adhello-agency';
const DAY_MS = 86400000;
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

/** @returns {{ form: object, errors: string[] }} */
function readForm(body = {}) {
  const pick = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
  const form = {
    contactName: pick(body.contactName || body.name, 120),
    companyName: pick(body.companyName || body.company, 160),
    phone: pick(body.phone, 40),
    email: pick(body.email, 200),
  };
  const errors = [];
  if (!form.contactName) errors.push('Add your name.');
  if (!form.companyName) errors.push('Add your business name.');
  const digits = phoneDigits(form.phone);
  const email = cleanEmail(form.email);
  if (!digits && !email) errors.push('Add a mobile number or email so we can send your app link.');
  if (form.phone && !digits) errors.push('That phone number does not look valid.');
  if (form.email && !email) errors.push('That email does not look valid.');
  return {
    form: { ...form, email: email || form.email, phone: form.phone },
    errors,
    digits,
    email,
  };
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
  const ownerEmail = String((ws && ws.ownerEmail) || '').trim().toLowerCase()
    || (() => {
      const members = ws && ws.members && typeof ws.members === 'object' ? ws.members : {};
      const owner = Object.entries(members).find(([, row]) => row && row.role === 'owner');
      return owner ? owner[0] : '';
    })();
  return store.getOrCreateNetworkForWorkspace(workspaceId, {
    name: (ws && ws.name) || 'AdHello',
    ownerEmail,
  });
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
async function signupFreeApp({ form, digits, email, baseUrl, ip }) {
  const lockKey = contactLockKey({ digits, email });

  let network;
  try {
    network = await resolveFreeAppNetwork();
  } catch (err) {
    return { ok: false, code: 'config', error: err.message || 'Free app signup is not available right now.' };
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
      // Returning visitor: reopen if paused; keep partner plans, else mark app_free.
      const patch = {};
      if (member.status === 'paused' && !isAppTrialExpired(member)) patch.status = 'active';
      // Don't re-apply freemium after an admin activated them to a partner seat.
      if (!member.plan && !member.planActivatedAt) patch.plan = PLAN_APP_FREE;
      // Backfill trial end for legacy free signups that never had one.
      if ((patch.plan || member.plan) === PLAN_APP_FREE && !member.trialEndsAt && !member.planActivatedAt) {
        const start = Date.parse(member.joinedAt || '') || Date.now();
        patch.trialEndsAt = new Date(start + appTrialDays() * DAY_MS).toISOString();
      }
      if (Object.keys(patch).length) {
        member = await store.saveMember(network.id, { ...member, ...patch });
      }
      const notified = await notify.sendMemberPortalLink({ network, member, baseUrl, welcome: false })
        .catch((err) => ({ ok: false, error: err.message }));
      if (notified && notified.ok) markSent(lockKey);
      return { ok: true, member, network, notified, created: false };
    }

    const saved = await dbService.saveLeadWithMeta({
      workspaceId: network.ownerWorkspaceId,
      title: form.companyName,
      contactName: form.contactName || '',
      phone: form.phone || 'N/A',
      email: email || form.email || 'N/A',
      source: 'free_app_signup',
      message: 'Signed up for the AdHello reviews app trial',
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
    const trialEndsAt = new Date(Date.parse(joinedAt) + appTrialDays() * DAY_MS).toISOString();
    const member = await store.saveMember(network.id, {
      leadKey: lead.key,
      companyName: form.companyName,
      contactName: form.contactName,
      phone: form.phone || '',
      email: email || '',
      status: 'active',
      plan: PLAN_APP_FREE,
      trialEndsAt,
      joinedAt,
    });

    const notified = await notify.sendMemberPortalLink({ network, member, baseUrl, welcome: true })
      .catch((err) => ({ ok: false, error: err.message }));
    if (notified && notified.ok) markSent(lockKey);

    setImmediate(() => {
      notifyOperatorNewFreeApp({ network, member }).catch(() => {});
    });

    return { ok: true, member, network, notified, created: true };
  } finally {
    releaseInflight(lockKey);
  }
}

function isAppFreeMember(member) {
  return String((member && member.plan) || '') === PLAN_APP_FREE;
}

/**
 * Reviews-app trial status for an app_free member.
 * @returns {null | { state: 'trial'|'expired'|'active', daysLeft: number, endsAt: string, label: string }}
 */
function appTrialStatus(member, now = Date.now()) {
  if (!member || !isAppFreeMember(member)) {
    if (member && member.planActivatedAt) {
      return { state: 'active', daysLeft: 0, endsAt: '', label: 'Active' };
    }
    return null;
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
  DEFAULT_WORKSPACE_SLUG,
  SEND_COOLDOWN_PREFIX,
  INFLIGHT_PREFIX,
  appTrialDays,
  contactLockKey,
  readForm,
  phoneDigits,
  cleanEmail,
  takeIpSlot,
  resolveFreeAppNetwork,
  findExistingMember,
  signupFreeApp,
  isAppFreeMember,
  appTrialStatus,
  isAppTrialExpired,
  activateAppMember,
  normalizeMemberPlanFilter,
  matchesMemberPlanFilter,
};
