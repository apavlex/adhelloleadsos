/**
 * Self-serve signups: a public form + Google sign-in creates a workspace on a
 * 7-day trial. Trial workspaces share the server's scraper / AI keys under a
 * daily cap, can't text, email or call from the agency's own accounts, and lock
 * when the trial ends until a platform admin extends or activates them.
 */
const crypto = require('crypto');
const { randomUUID } = crypto;
const dbService = require('./database');
const workspaceScriptBootstrap = require('./workspaceScriptBootstrap');
const pipelineStagesService = require('./pipelineStagesService');
const workspaceBootstrap = require('./workspaceBootstrap');
const { PRESETS } = require('../lib/pipeline/presets');
const { normalizeStages } = require('../lib/pipeline/normalize');
const guestEgress = require('../lib/guestEgress');

const SIGNUP_PREFIX = 'signup:';
const USAGE_PREFIX = 'trialUsage:';
const IP_DAY_PREFIX = 'trialSignupIp:';
const DAY_MS = 86400000;

const TEAM_SIZES = ['Just me', '2-5', '6-10', '11-25', '26+'];
const SOURCES = ['Google', 'Facebook', 'Instagram', 'YouTube', 'TikTok', 'LinkedIn', 'Referral', 'Other'];

function envInt(name, fallback) {
  const n = parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function defaults() {
  return {
    days: envInt('TRIAL_DAYS', 7),
    paidCallsPerDay: envInt('TRIAL_PAID_CALLS_PER_DAY', 300),
    aiCallsPerDay: envInt('TRIAL_AI_CALLS_PER_DAY', 200),
    signupsPerIpPerDay: envInt('TRIAL_SIGNUPS_PER_IP_PER_DAY', 3),
  };
}

function normEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function dayKey(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

function readJson(key) {
  const raw = dbService.getKvSync(key);
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

// ── Signup form ──────────────────────────────────────────────────────────────

function cleanWebsite(raw) {
  let s = String(raw || '').trim().slice(0, 200);
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    return /\./.test(u.hostname) ? u.href.replace(/\/$/, '') : '';
  } catch {
    return '';
  }
}

/** @returns {{ form: object, errors: string[] }} */
function readSignupForm(body = {}) {
  const pick = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
  const form = {
    name: pick(body.name, 80),
    phone: pick(body.phone, 30),
    company: pick(body.company, 100),
    website: pick(body.website, 200),
    niche: pick(body.niche, 120),
    teamSize: TEAM_SIZES.includes(pick(body.teamSize, 20)) ? pick(body.teamSize, 20) : '',
    source: SOURCES.includes(pick(body.source, 20)) ? pick(body.source, 20) : '',
    sourceOther: pick(body.sourceOther, 120),
  };
  const errors = [];
  if (!form.name) errors.push('Add your full name.');
  if (form.phone.replace(/\D/g, '').length < 10) errors.push('Add a phone number with area code.');
  if (!form.company) errors.push('Add your company or agency name.');
  if (form.website && !cleanWebsite(form.website)) errors.push('That website doesn’t look right.');
  if (!form.niche) errors.push('Tell us the niche or industry you target.');
  if (!form.teamSize) errors.push('Pick your team size.');
  if (!form.source) errors.push('Tell us how you heard about us.');
  if (form.website) form.website = cleanWebsite(form.website);
  if (form.source !== 'Other') form.sourceOther = '';
  return { form, errors };
}

// ── Signup records ───────────────────────────────────────────────────────────

function getSignup(email) {
  const em = normEmail(email);
  return em ? readJson(`${SIGNUP_PREFIX}${em}`) : null;
}

function saveSignup(record) {
  dbService.setKvSync(`${SIGNUP_PREFIX}${normEmail(record.email)}`, record);
  return record;
}

function listSignups() {
  return dbService
    .listKvKeysSync(SIGNUP_PREFIX)
    .map((k) => readJson(k))
    .filter((s) => s && s.email)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

function ipHash(ip) {
  return crypto.createHash('sha256').update(`trial:${String(ip || '')}`).digest('hex').slice(0, 16);
}

/** One slot per signup; false once this IP has created too many trials today. */
function takeIpSlot(ip, now = Date.now()) {
  const key = `${IP_DAY_PREFIX}${dayKey(now)}:${ipHash(ip)}`;
  const n = parseInt(dbService.getKvSync(key) || '0', 10) || 0;
  if (n >= defaults().signupsPerIpPerDay) return false;
  dbService.setKvSync(key, String(n + 1));
  return true;
}

// ── Trial status ─────────────────────────────────────────────────────────────

/**
 * @returns {null | { state: 'trial'|'expired'|'active', endsAt: string, daysLeft: number, limits: object }}
 * null for workspaces that never had a trial.
 */
function status(ws, now = Date.now()) {
  const t = ws && ws.trial;
  if (!t || typeof t !== 'object') return null;
  const d = defaults();
  const limits = {
    paidCallsPerDay: Number(t.limits && t.limits.paidCallsPerDay) || d.paidCallsPerDay,
    aiCallsPerDay: Number(t.limits && t.limits.aiCallsPerDay) || d.aiCallsPerDay,
  };
  const endsMs = Date.parse(t.endsAt) || 0;
  if (t.activatedAt) return { state: 'active', endsAt: t.endsAt, daysLeft: 0, limits };
  const msLeft = endsMs - now;
  return {
    state: msLeft > 0 ? 'trial' : 'expired',
    endsAt: t.endsAt,
    daysLeft: msLeft > 0 ? Math.ceil(msLeft / DAY_MS) : 0,
    limits,
  };
}

/** True while the workspace is on an unpaid trial (running or ended). */
function isRestricted(ws, now = Date.now()) {
  const s = status(ws, now);
  return Boolean(s && s.state !== 'active');
}

// ── Usage caps ───────────────────────────────────────────────────────────────

const usageCache = new Map();

function usageKey(wid, now) {
  return `${USAGE_PREFIX}${wid}:${dayKey(now)}`;
}

function usageFor(wid, now = Date.now()) {
  const key = usageKey(wid, now);
  if (usageCache.has(key)) return usageCache.get(key);
  const row = readJson(key) || {};
  const u = { paid: Number(row.paid) || 0, ai: Number(row.ai) || 0 };
  usageCache.set(key, u);
  return u;
}

/** Count one outbound call of `kind` ('paid' | 'ai'); false once today's cap is reached. */
function takeCall(ws, kind, now = Date.now()) {
  const s = status(ws, now);
  if (!s || s.state === 'active') return true;
  if (s.state === 'expired') return false;
  const u = usageFor(ws.id, now);
  const cap = kind === 'ai' ? s.limits.aiCallsPerDay : s.limits.paidCallsPerDay;
  if (u[kind] >= cap) return false;
  u[kind] += 1;
  dbService.setKvSync(usageKey(ws.id, now), u);
  return true;
}

function limitError(kind) {
  const what = kind === 'ai' ? 'AI' : 'lead search and enrichment';
  const err = new Error(
    `Your free trial's daily ${what} limit is used up. It resets tomorrow — or contact us to upgrade.`,
  );
  err.code = 'TRIAL_LIMIT';
  err.trialBlocked = true;
  return err;
}

function callingError() {
  const err = new Error('Calling is turned off during the free trial. Contact us to turn it on.');
  err.code = 'TRIAL_LIMIT';
  err.trialBlocked = true;
  return err;
}

const AI_HOSTS = ['openrouter.ai', 'api.openai.com', 'generativelanguage.googleapis.com', 'api.kie.ai', 'api.anthropic.com'];
const PAID_HOSTS = [
  'apify.com',
  'outscraper.com',
  'outscraper.cloud',
  'serpapi.com',
  'searchapi.io',
  'rapidapi.com',
  'firecrawl.dev',
  'oxylabs.io',
  'bettercontact.rocks',
  'permit-stack.com',
  'tikhub.io',
  'monid.ai',
  'geoapify.com',
  'maps.googleapis.com',
  'places.googleapis.com',
  'pagespeedonline.googleapis.com',
];
const CALL_HOSTS = ['signalwire.com'];

function hostMatches(host, list) {
  const h = String(host || '').toLowerCase();
  return list.some((d) => h === d || h.endsWith(`.${d}`));
}

/** 'ai' | 'paid' | 'call' | '' for an outbound host. */
function classifyHost(host) {
  if (hostMatches(host, AI_HOSTS)) return 'ai';
  if (hostMatches(host, PAID_HOSTS)) return 'paid';
  if (hostMatches(host, CALL_HOSTS)) return 'call';
  return '';
}

/** guestEgress `check` hook for a trial workspace. */
function egressCheck(ws) {
  return (host) => {
    const kind = classifyHost(host);
    if (!kind) return { ok: true };
    if (kind === 'call') return { ok: false, reason: 'trial_calling', error: callingError() };
    if (takeCall(ws, kind)) return { ok: true };
    return { ok: false, reason: `trial_${kind}`, error: limitError(kind) };
  };
}

/**
 * Run background work for a workspace under its trial meter (no-op for normal
 * workspaces). Throws TRIAL_LIMIT when the trial has ended.
 */
function runMetered(ws, fn) {
  const s = status(ws);
  if (!s || s.state === 'active') return fn();
  if (s.state === 'expired') return Promise.reject(Object.assign(new Error('Free trial has ended.'), { code: 'TRIAL_LIMIT' }));
  return guestEgress.run({ trial: true, workspaceId: ws.id, check: egressCheck(ws) }, fn);
}

/** Where an ended trial should get in touch (TRIAL_CONTACT_URL, else the public demo's CTA button). */
function contactInfo() {
  const cfg = require('./publicDemo').getConfig();
  const url = String(process.env.TRIAL_CONTACT_URL || '').trim() || cfg.ctaUrl;
  const email = String(process.env.TRIAL_CONTACT_EMAIL || 'hello@adhello.ai').trim();
  return { url, email, label: url ? cfg.ctaLabel || 'Book a call' : 'Email us' };
}

// ── Workspace ────────────────────────────────────────────────────────────────

function slugify(name) {
  const s = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return s || 'workspace';
}

async function allocateSlug(name) {
  const base = slugify(name);
  for (let i = 0; i < 50; i += 1) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    // eslint-disable-next-line no-await-in-loop
    if (!(await dbService.getWorkspaceIdForSlug(candidate))) return candidate;
  }
  return `${base}-${randomUUID().slice(0, 8)}`;
}

/**
 * Create the trial workspace + signup record for a freshly signed-in user.
 * @returns {Promise<{ workspaceId: string, signup: object }>}
 */
async function createTrialWorkspace({ email, form, googleName, ip }, now = Date.now()) {
  const em = normEmail(email);
  if (!em) throw new Error('Sign in with Google first.');
  const d = defaults();
  const startedAt = new Date(now).toISOString();
  const endsAt = new Date(now + d.days * DAY_MS).toISOString();
  const name = form.company || `${form.name || googleName || em.split('@')[0]}'s workspace`;
  const newId = randomUUID();
  const slug = await allocateSlug(name);

  const doc = {
    id: newId,
    ownerUserId: em,
    name,
    slug,
    accentColor: '#CA8A04',
    coachPrompt: workspaceBootstrap.DEFAULT_COACH_AGENCY,
    icp: { keyword: form.niche || '', city: '', state: '', qty: 20 },
    settings: {},
    pipelineIntake: { setupPath: 'preset', presetKey: 'agency' },
    salesIntake: { businessName: name, vertical: form.niche || '' },
    members: {
      [em]: { role: 'owner', joinedAt: startedAt, userId: em },
    },
    roundRobinIndex: 0,
    createdAt: startedAt,
    archivedAt: null,
    trial: { startedAt, endsAt, signupEmail: em },
  };
  workspaceScriptBootstrap.seedWorkspaceScriptsOnCreate(doc, { presetKey: 'agency' });
  workspaceScriptBootstrap.applySalesIntakeToFirstOffer(doc, doc.salesIntake);

  await dbService.saveWorkspace(newId, doc);
  await dbService.saveWorkspaceSlug(slug, newId);
  await dbService.addUserWorkspaceId(em, newId);
  await dbService.saveUserPrefs(em, { activeWorkspaceId: newId });
  await pipelineStagesService.deleteAllStages(newId);
  await pipelineStagesService.persistNormalizedStages(newId, normalizeStages(PRESETS.agency.stages));

  const signup = saveSignup({
    email: em,
    googleName: String(googleName || '').slice(0, 120),
    ...form,
    workspaceId: newId,
    workspaceSlug: slug,
    createdAt: startedAt,
    ipHash: ip ? ipHash(ip) : '',
  });
  return { workspaceId: newId, signup };
}

/**
 * Admin changes. action: 'extend' (+days), 'end', 'activate', 'deactivate', 'limits'.
 * @returns {Promise<object>} updated workspace
 */
async function adminUpdate(workspaceId, { action, days, paidCallsPerDay, aiCallsPerDay, by }, now = Date.now()) {
  const ws = await dbService.getWorkspace(workspaceId);
  if (!ws || !ws.trial) throw new Error('That workspace is not a trial workspace.');
  const t = { ...ws.trial };
  const log = Array.isArray(t.log) ? t.log.slice(-19) : [];
  if (action === 'extend') {
    const n = Math.min(Math.max(parseInt(days, 10) || 7, 1), 365);
    const from = Math.max(Date.parse(t.endsAt) || 0, now);
    t.endsAt = new Date(from + n * DAY_MS).toISOString();
    log.push({ at: new Date(now).toISOString(), by, action: `extend ${n}d` });
  } else if (action === 'end') {
    t.endsAt = new Date(now - 1000).toISOString();
    delete t.activatedAt;
    log.push({ at: new Date(now).toISOString(), by, action: 'end' });
  } else if (action === 'activate') {
    t.activatedAt = new Date(now).toISOString();
    log.push({ at: t.activatedAt, by, action: 'activate' });
  } else if (action === 'deactivate') {
    delete t.activatedAt;
    log.push({ at: new Date(now).toISOString(), by, action: 'deactivate' });
  } else if (action === 'limits') {
    const p = parseInt(paidCallsPerDay, 10);
    const a = parseInt(aiCallsPerDay, 10);
    t.limits = {
      paidCallsPerDay: Number.isFinite(p) && p > 0 ? Math.min(p, 100000) : undefined,
      aiCallsPerDay: Number.isFinite(a) && a > 0 ? Math.min(a, 100000) : undefined,
    };
    log.push({ at: new Date(now).toISOString(), by, action: `limits ${p || '-'}/${a || '-'}` });
  } else {
    throw new Error('Unknown action.');
  }
  t.log = log;
  const next = { ...ws, trial: t };
  await dbService.saveWorkspace(workspaceId, next);
  return next;
}

/** Give a platform admin access to a signup's workspace (as an admin member). */
async function grantAdminAccess(workspaceId, adminEmail) {
  const em = normEmail(adminEmail);
  const ws = await dbService.getWorkspace(workspaceId);
  if (!ws || !em) throw new Error('Workspace not found.');
  const members = { ...(ws.members || {}) };
  if (!members[em]) {
    members[em] = { role: 'admin', joinedAt: new Date().toISOString(), userId: em, platformSupport: true };
    await dbService.saveWorkspace(workspaceId, { ...ws, members });
  }
  await dbService.addUserWorkspaceId(em, workspaceId);
  return ws;
}

module.exports = {
  TEAM_SIZES,
  SOURCES,
  defaults,
  readSignupForm,
  getSignup,
  listSignups,
  takeIpSlot,
  status,
  isRestricted,
  usageFor,
  takeCall,
  classifyHost,
  egressCheck,
  runMetered,
  contactInfo,
  createTrialWorkspace,
  adminUpdate,
  grantAdminAccess,
  _resetForTests() {
    usageCache.clear();
  },
};
