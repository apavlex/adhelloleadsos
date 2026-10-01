/**
 * Public live demo: anyone with the link gets a private, throwaway copy of the
 * demo workspace (no Google sign-in). Sandboxes expire, are rate limited, and run
 * behind lib/guestEgress so they can only reach AI chat within a small budget.
 */
const crypto = require('crypto');
const dbService = require('./database');
const demoWorkspace = require('./demoWorkspace');
const { emailAliases } = require('./workspaceService');

const CONFIG_KEY = 'publicDemo:config';
const SANDBOX_PREFIX = 'publicDemo:sandbox:';
const LAUNCH_DAY_PREFIX = 'publicDemo:launches:';
const AI_DAY_PREFIX = 'publicDemo:ai:';
const LAUNCH_LOG_KEY = 'publicDemo:recent';
const GUEST_DOMAIN = 'demo-guest.invalid';

function envInt(name, fallback) {
  const n = parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function limits() {
  return {
    ttlMs: envInt('PUBLIC_DEMO_TTL_HOURS', 24) * 3600000,
    perIpPerHour: envInt('PUBLIC_DEMO_PER_IP_PER_HOUR', 3),
    perDay: envInt('PUBLIC_DEMO_PER_DAY', 150),
    maxActive: envInt('PUBLIC_DEMO_MAX_ACTIVE', 150),
    aiPerSandbox: envInt('PUBLIC_DEMO_AI_CALLS_PER_SANDBOX', 40),
    aiPerDay: envInt('PUBLIC_DEMO_AI_CALLS_PER_DAY', 1500),
  };
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

function dayKey(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

function newKey() {
  return crypto.randomBytes(9).toString('base64url');
}

function isGuestEmail(email) {
  return String(email || '').trim().toLowerCase().endsWith(`@${GUEST_DOMAIN}`);
}

function cleanCtaUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
  } catch {
    return '';
  }
}

function getConfig() {
  const cfg = readJson(CONFIG_KEY) || {};
  return {
    enabled: Boolean(cfg.enabled && cfg.key),
    key: String(cfg.key || ''),
    ctaUrl: cleanCtaUrl(cfg.ctaUrl),
    ctaLabel: String(cfg.ctaLabel || '').trim().slice(0, 40) || 'Book a call',
    updatedAt: cfg.updatedAt || null,
    updatedBy: cfg.updatedBy || null,
  };
}

function saveConfig(patch, byEmail) {
  const cur = readJson(CONFIG_KEY) || {};
  const next = { ...cur };
  if (patch.enabled !== undefined) next.enabled = Boolean(patch.enabled);
  if (patch.regenerate || (next.enabled && !next.key)) next.key = newKey();
  if (patch.ctaUrl !== undefined) {
    const url = cleanCtaUrl(patch.ctaUrl);
    if (String(patch.ctaUrl || '').trim() && !url) throw new Error('Button link must start with https://');
    next.ctaUrl = url;
  }
  if (patch.ctaLabel !== undefined) next.ctaLabel = String(patch.ctaLabel || '').trim().slice(0, 40);
  next.updatedAt = new Date().toISOString();
  next.updatedBy = byEmail || null;
  dbService.setKvSync(CONFIG_KEY, next);
  return getConfig();
}

function keyMatches(candidate) {
  const cfg = getConfig();
  if (!cfg.enabled) return false;
  const a = Buffer.from(String(candidate || ''));
  const b = Buffer.from(cfg.key);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Owners/admins of the main agency workspace (or PUBLIC_DEMO_ADMIN_EMAILS) manage the link. */
async function canManage(email) {
  const em = String(email || '').trim().toLowerCase();
  if (!em || isGuestEmail(em)) return false;
  const allow = String(process.env.PUBLIC_DEMO_ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const aliases = emailAliases(em);
  if (aliases.some((a) => allow.includes(a))) return true;
  const wid = await dbService.getWorkspaceIdForSlug('adhello-agency');
  const ws = wid ? await dbService.getWorkspace(wid) : null;
  if (!ws || ws.archivedAt) return false;
  return aliases.some((a) => {
    if (String(ws.ownerUserId || '').toLowerCase() === a) return true;
    const m = ws.members && ws.members[a];
    return Boolean(m && (m.role === 'owner' || m.role === 'admin'));
  });
}

// ── Sandbox registry ─────────────────────────────────────────────────────────

function getSandbox(workspaceId) {
  return readJson(`${SANDBOX_PREFIX}${workspaceId}`);
}

function listSandboxes() {
  return dbService
    .listKvKeysSync(SANDBOX_PREFIX)
    .map((k) => readJson(k))
    .filter((s) => s && s.workspaceId);
}

function isSandboxLive(guest, now = Date.now()) {
  if (!guest || !guest.workspaceId) return false;
  const sb = getSandbox(guest.workspaceId);
  return Boolean(sb && Date.parse(sb.expiresAt) > now);
}

async function purgeSandbox(workspaceId) {
  const wid = String(workspaceId || '').trim();
  if (!wid) return null;
  const sb = getSandbox(wid);
  const ws = await dbService.getWorkspace(wid);
  if (ws && !ws.publicDemoSandbox) throw new Error('Refusing to purge a workspace that is not a public demo sandbox');
  const link = readJson(`wsnetwork:${wid}`);
  const ownerEmail = (sb && sb.email) || (ws && ws.ownerUserId) || '';
  const result = dbService.purgeWorkspaceStorage(wid, {
    networkId: link && link.networkId,
    ownerEmail: isGuestEmail(ownerEmail) ? ownerEmail : '',
  });
  dbService.deleteKvSync(`${SANDBOX_PREFIX}${wid}`);
  aiCounts.delete(wid);
  return result;
}

async function purgeExpired(now = Date.now()) {
  let purged = 0;
  for (const sb of listSandboxes()) {
    if (Date.parse(sb.expiresAt) > now) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      await purgeSandbox(sb.workspaceId);
      purged += 1;
    } catch (e) {
      console.warn('[publicDemo] purge failed', sb.workspaceId, e.message);
    }
  }
  return purged;
}

async function evictOverflow(maxActive) {
  const live = listSandboxes().sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  while (live.length >= maxActive) {
    const oldest = live.shift();
    // eslint-disable-next-line no-await-in-loop
    await purgeSandbox(oldest.workspaceId).catch((e) => console.warn('[publicDemo] evict failed', e.message));
  }
}

// ── Rate limits ──────────────────────────────────────────────────────────────

const ipLaunches = new Map();

function ipHash(ip) {
  return crypto.createHash('sha256').update(`pd:${String(ip || '')}`).digest('hex').slice(0, 16);
}

function takeIpSlot(ip, perHour, now = Date.now()) {
  const h = ipHash(ip);
  const recent = (ipLaunches.get(h) || []).filter((t) => now - t < 3600000);
  if (recent.length >= perHour) {
    ipLaunches.set(h, recent);
    return false;
  }
  recent.push(now);
  ipLaunches.set(h, recent);
  return true;
}

function readCount(key) {
  return parseInt(dbService.getKvSync(key) || '0', 10) || 0;
}

function bumpCount(key) {
  const n = readCount(key) + 1;
  dbService.setKvSync(key, String(n));
  return n;
}

const aiCounts = new Map();

/** Counts one AI request for a sandbox; false once the sandbox or the day is over budget. */
function takeAiCall(workspaceId, now = Date.now()) {
  const lim = limits();
  const sb = getSandbox(workspaceId);
  if (!sb) return false;
  const used = aiCounts.has(workspaceId) ? aiCounts.get(workspaceId) : sb.aiCalls || 0;
  if (used >= lim.aiPerSandbox) return false;
  const dayKeyAi = `${AI_DAY_PREFIX}${dayKey(now)}`;
  if (readCount(dayKeyAi) >= lim.aiPerDay) return false;
  aiCounts.set(workspaceId, used + 1);
  bumpCount(dayKeyAi);
  dbService.setKvSync(`${SANDBOX_PREFIX}${workspaceId}`, { ...sb, aiCalls: used + 1 });
  return true;
}

function logLaunch(entry) {
  const log = readJson(LAUNCH_LOG_KEY);
  const rows = Array.isArray(log) ? log : [];
  rows.unshift(entry);
  dbService.setKvSync(LAUNCH_LOG_KEY, rows.slice(0, 50));
}

function recentLaunches(limit = 10) {
  const log = readJson(LAUNCH_LOG_KEY);
  return (Array.isArray(log) ? log : []).slice(0, limit);
}

function stats(now = Date.now()) {
  const live = listSandboxes().filter((s) => Date.parse(s.expiresAt) > now);
  return {
    active: live.length,
    launchesToday: readCount(`${LAUNCH_DAY_PREFIX}${dayKey(now)}`),
    aiCallsToday: readCount(`${AI_DAY_PREFIX}${dayKey(now)}`),
    limits: limits(),
  };
}

// ── Launch ───────────────────────────────────────────────────────────────────

class DemoLimitError extends Error {
  constructor(message, reason) {
    super(message);
    this.reason = reason;
  }
}

function cleanVisitor(raw = {}) {
  const pick = (v, n) => String(v || '').trim().slice(0, n);
  return { name: pick(raw.name, 80), email: pick(raw.email, 120), source: pick(raw.source, 60) };
}

async function allocateSandboxSlug() {
  for (let i = 0; i < 5; i += 1) {
    const slug = `live-demo-${crypto.randomBytes(4).toString('hex')}`;
    // eslint-disable-next-line no-await-in-loop
    if (!(await dbService.getWorkspaceIdForSlug(slug))) return slug;
  }
  return `live-demo-${crypto.randomUUID()}`;
}

/**
 * Build a fresh sandbox and return the passport user for it.
 * @returns {Promise<{ user: object, sandbox: object }>}
 */
async function launchSandbox({ ip, visitor } = {}, now = Date.now()) {
  const lim = limits();
  if (!takeIpSlot(ip, lim.perIpPerHour, now)) {
    throw new DemoLimitError('You have opened a few demos already. Try again in an hour.', 'ip');
  }
  const launchKey = `${LAUNCH_DAY_PREFIX}${dayKey(now)}`;
  if (readCount(launchKey) >= lim.perDay) {
    throw new DemoLimitError('The live demo is busy right now. Please try again tomorrow.', 'daily');
  }

  await purgeExpired(now);
  await evictOverflow(lim.maxActive);

  const email = `guest-${crypto.randomBytes(6).toString('hex')}@${GUEST_DOMAIN}`;
  const { workspaceId } = await demoWorkspace.createDemoWorkspace(email, { allocateSlug: allocateSandboxSlug });
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + lim.ttlMs).toISOString();

  const ws = await dbService.getWorkspace(workspaceId);
  await dbService.saveWorkspace(workspaceId, { ...ws, publicDemoSandbox: { createdAt, expiresAt } });

  const who = cleanVisitor(visitor);
  const sandbox = { workspaceId, email, createdAt, expiresAt, ipHash: ipHash(ip), visitor: who, aiCalls: 0 };
  dbService.setKvSync(`${SANDBOX_PREFIX}${workspaceId}`, sandbox);
  bumpCount(launchKey);
  logLaunch({ at: createdAt, name: who.name, email: who.email, source: who.source });

  const user = {
    id: email,
    displayName: who.name || 'Demo visitor',
    emails: [{ value: email }],
    photos: [],
    demoGuest: { workspaceId, expiresAt },
  };
  return { user, sandbox };
}

let cleanupTimer = null;

function startCleanup(intervalMs = 30 * 60000) {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    purgeExpired().catch((e) => console.warn('[publicDemo] cleanup failed', e.message));
  }, intervalMs);
  if (cleanupTimer.unref) cleanupTimer.unref();
}

module.exports = {
  GUEST_DOMAIN,
  startCleanup,
  DemoLimitError,
  limits,
  getConfig,
  saveConfig,
  keyMatches,
  canManage,
  isGuestEmail,
  getSandbox,
  listSandboxes,
  isSandboxLive,
  launchSandbox,
  purgeSandbox,
  purgeExpired,
  takeAiCall,
  recentLaunches,
  stats,
  _resetForTests() {
    ipLaunches.clear();
    aiCounts.clear();
  },
};
