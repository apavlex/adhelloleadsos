/**
 * Public free member-app signup (AdHello.io → /app).
 * Creates (or reopens) a network member on the AdHello Agency network with
 * plan "app_free", then texts/emails the installable /m/:token link.
 * Does not create a workspace trial or GHL sub-account.
 */

const crypto = require('crypto');
const dbService = require('./database');
const store = require('./networkStore');
const notify = require('./networkNotify');
const referralNetwork = require('./referralNetwork');
const { upsertOpenTaskForLead, TASK_SOURCE_NETWORK } = require('./userTasks');

const PLAN_APP_FREE = 'app_free';
const DEFAULT_WORKSPACE_SLUG = 'adhello-agency';
const IP_DAY_PREFIX = 'freeAppSignupIp:';
const MAX_PER_IP_PER_DAY = 8;

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
      title: `Free app signup: ${member.companyName}${member.contactName ? ` (${member.contactName})` : ''}`.slice(0, 240),
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
 * @returns {{ ok: true, member, network, notified, created: boolean } | { ok: false, error: string, code?: string }}
 */
async function signupFreeApp({ form, digits, email, baseUrl, ip }) {
  if (!takeIpSlot(ip)) {
    return {
      ok: false,
      code: 'rate_limit',
      error: 'Too many signups from this network today. Try again tomorrow or text us.',
    };
  }

  let network;
  try {
    network = await resolveFreeAppNetwork();
  } catch (err) {
    return { ok: false, code: 'config', error: err.message || 'Free app signup is not available right now.' };
  }

  const existing = await findExistingMember(network.id, { digits, email });
  if (existing) {
    let member = existing;
    // Returning visitor: reopen if paused, but do not overwrite a partner plan.
    if (member.status === 'paused') {
      member = await store.saveMember(network.id, { ...member, status: 'active' });
    }
    const notified = await notify.sendMemberPortalLink({ network, member, baseUrl, welcome: false })
      .catch((err) => ({ ok: false, error: err.message }));
    return { ok: true, member, network, notified, created: false };
  }

  const saved = await dbService.saveLeadWithMeta({
    workspaceId: network.ownerWorkspaceId,
    title: form.companyName,
    contactName: form.contactName || '',
    phone: form.phone || 'N/A',
    email: email || form.email || 'N/A',
    source: 'free_app_signup',
    message: 'Signed up for the free AdHello member app',
  });
  const lead = await dbService.getLead(saved.key, network.ownerWorkspaceId);
  if (!lead || !lead.key) {
    return { ok: false, code: 'failed', error: 'Could not create your account. Try again.' };
  }
  const connected = referralNetwork.applyPartnerAction(lead, 'connect');
  if (connected.ok) {
    await dbService.updateLead(lead.key, { referralPartner: connected.referralPartner }, network.ownerWorkspaceId);
  }

  const member = await store.saveMember(network.id, {
    leadKey: lead.key,
    companyName: form.companyName,
    contactName: form.contactName,
    phone: form.phone || '',
    email: email || '',
    status: 'active',
    plan: PLAN_APP_FREE,
    joinedAt: new Date().toISOString(),
  });

  const notified = await notify.sendMemberPortalLink({ network, member, baseUrl, welcome: true })
    .catch((err) => ({ ok: false, error: err.message }));

  setImmediate(() => {
    notifyOperatorNewFreeApp({ network, member }).catch(() => {});
  });

  return { ok: true, member, network, notified, created: true };
}

function isAppFreeMember(member) {
  return String((member && member.plan) || '') === PLAN_APP_FREE;
}

module.exports = {
  PLAN_APP_FREE,
  DEFAULT_WORKSPACE_SLUG,
  readForm,
  phoneDigits,
  cleanEmail,
  takeIpSlot,
  resolveFreeAppNetwork,
  findExistingMember,
  signupFreeApp,
  isAppFreeMember,
};
