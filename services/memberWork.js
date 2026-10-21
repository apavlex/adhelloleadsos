/**
 * A member's own customers and jobs (the Customers tab of the member app).
 * Scoped per network + member; ids for the scope always come from the signed
 * member token, never from the request.
 *
 *   netcust:<networkId>:<memberId>:<id>   customer
 *   netjob:<networkId>:<memberId>:<id>    job / project for a customer
 */

const crypto = require('crypto');
const dbService = require('./database');
const jobMedia = require('./memberJobMedia');

const JOB_STATUSES = ['lead', 'estimate', 'scheduled', 'in_progress', 'completed', 'on_hold', 'cancelled'];
const JOB_STATUS_LABELS = {
  lead: 'Lead',
  estimate: 'Estimate',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  completed: 'Completed',
  on_hold: 'On hold',
  cancelled: 'Cancelled',
};
const PIPELINE = ['lead', 'estimate', 'scheduled', 'in_progress', 'completed'];
const CLOSED = new Set(['completed', 'cancelled']);

const MAX_CUSTOMERS = 1000;
const MAX_JOBS = 3000;
const MAX_JOB_PHOTOS = 12;
const MAX_VALUE = 10000000;
const MAX_DURATION = 7 * 24 * 60;

/** Minutes before visit start — 0 means reminders off. */
const REMIND_BEFORE_OPTIONS = [
  { value: 0, label: 'Off' },
  { value: 60, label: '1 hour before' },
  { value: 120, label: '2 hours before' },
  { value: 180, label: '3 hours before' },
  { value: 1440, label: '1 day before' },
  { value: 2880, label: '2 days before' },
];
const REMIND_BEFORE_SET = new Set(REMIND_BEFORE_OPTIONS.map((o) => o.value));

// Hex/base36 only: kv listing uses SQL LIKE, where "_" and "%" are wildcards.
/** Member / network ids — allow staff_* workspace seats (underscore). */
const SCOPE_ID = /^[a-z0-9_]{1,64}$/i;
const RECORD_ID = /^[a-z0-9]{6,40}$/;

function newId() {
  return `${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Google Maps search URL so the business profile / place card can surface
 * (Apple Maps links do not). Prefer name + address when both exist.
 */
function googleMapsSearchUrl({ name = '', address = '' } = {}) {
  const n = String(name || '').replace(/\s+/g, ' ').trim();
  const a = String(address || '').replace(/\s+/g, ' ').trim();
  const query = [n, a].filter(Boolean).join(', ');
  if (!query) return '';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function scope(networkId, memberId) {
  const net = String(networkId || '');
  const mem = String(memberId || '');
  if (!SCOPE_ID.test(net) || !SCOPE_ID.test(mem)) throw new Error('memberWork: invalid scope');
  return `${net}:${mem}`;
}

function isRecordId(id) {
  return RECORD_ID.test(String(id || ''));
}

function cleanLine(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanBlock(value, max) {
  return String(value == null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

function cleanEmail(value) {
  return cleanLine(value, 200).toLowerCase();
}

function emailLooksValid(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function parseMoney(value) {
  const n = Number(String(value == null ? '' : value).replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_VALUE, Math.round(n * 100) / 100);
}

/** "2026-10-14" only when it is a real calendar date. */
function cleanDate(value) {
  const raw = String(value == null ? '' : value).trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 2000 || y > 2100) return '';
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? raw : '';
}

function cleanTime(value) {
  const m = String(value == null ? '' : value).trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return m ? `${m[1]}:${m[2]}` : '';
}

function cleanDuration(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_DURATION, n);
}

function cleanRemindMins(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return REMIND_BEFORE_SET.has(n) ? n : 0;
}

function cleanTimeZone(value) {
  const tz = String(value == null ? '' : value).trim();
  if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(tz)) return '';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return '';
  }
}

const MAX_PHOTO_CAPTION = 500;

function normalizePhotos(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.id || '');
    if (!RECORD_ID.test(id)) continue;
    out.push({
      id,
      caption: cleanBlock(item.caption, MAX_PHOTO_CAPTION),
      createdAt: item.createdAt || '',
    });
    if (out.length >= MAX_JOB_PHOTOS) break;
  }
  return out;
}

// ── Records ──────────────────────────────────────────────────────────────────

const CUSTOMER_SOURCES = new Set(['manual', 'csv', 'ghl', 'referral']);

function phoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

const MAX_CUSTOMER_TAGS = 40;

function normalizeCustomerTags(raw) {
  return dbService.normalizeTagKeys(raw).slice(0, MAX_CUSTOMER_TAGS);
}

function normalizeSharedPeers(raw, idKey) {
  const key = idKey === 'customerId' ? 'customerId' : 'jobId';
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = new Set();
  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    const memberId = String(row.memberId || '').trim();
    const peerId = String(row[key] || row.jobId || row.customerId || '').trim();
    if (!SCOPE_ID.test(memberId) || !isRecordId(peerId) || seen.has(memberId)) continue;
    seen.add(memberId);
    out.push({
      memberId,
      [key]: peerId,
      at: row.at ? String(row.at) : '',
    });
    if (out.length >= 40) break;
  }
  return out;
}

function normalizeSharedWith(raw) {
  return normalizeSharedPeers(raw, 'jobId');
}

function normalizeCustomer(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const source = String(c.source || '').trim().toLowerCase();
  return {
    id: String(c.id || ''),
    name: cleanLine(c.name, 120),
    phone: cleanLine(c.phone, 40),
    email: cleanEmail(c.email),
    address: cleanLine(c.address, 200),
    notes: cleanBlock(c.notes, 2000),
    tags: normalizeCustomerTags(c.tags),
    /** CRM contacts that are referral businesses, not homeowners. */
    isReferralPartner: c.isReferralPartner === true,
    /**
     * Member marked this contact as a lead (e.g. inbound SMS/call).
     * Shows under Leads & Referrals → Received → From contacts.
     */
    isLead: c.isLead === true,
    markedAsLeadAt: c.isLead === true && c.markedAsLeadAt ? String(c.markedAsLeadAt) : '',
    referralId: isRecordId(c.referralId) ? c.referralId : '',
    ghlContactId: cleanLine(c.ghlContactId, 80),
    ghlSyncedAt: c.ghlSyncedAt ? String(c.ghlSyncedAt) : '',
    source: CUSTOMER_SOURCES.has(source) ? source : (c.ghlContactId ? 'ghl' : 'manual'),
    /** Copied onto a teammate’s book — points back to the sharer’s customer. */
    sharedFromMemberId: SCOPE_ID.test(String(c.sharedFromMemberId || ''))
      ? String(c.sharedFromMemberId)
      : '',
    sharedFromCustomerId: isRecordId(c.sharedFromCustomerId) ? c.sharedFromCustomerId : '',
    /** On the source customer: teammates who received a copy (+ their projects). */
    sharedWith: normalizeSharedPeers(c.sharedWith, 'customerId'),
    createdAt: c.createdAt || new Date().toISOString(),
    updatedAt: c.updatedAt || c.createdAt || new Date().toISOString(),
  };
}

/** Match an existing customer by GHL id, email, or phone digits. */
function findCustomerMatch(customers, { ghlContactId, email, phone } = {}) {
  const list = Array.isArray(customers) ? customers : [];
  const ghlId = cleanLine(ghlContactId, 80);
  if (ghlId) {
    const byId = list.find((c) => c.ghlContactId && c.ghlContactId === ghlId);
    if (byId) return byId;
  }
  const em = cleanEmail(email);
  if (em) {
    const byEmail = list.find((c) => c.email && c.email === em);
    if (byEmail) return byEmail;
  }
  const digits = phoneDigits(phone);
  if (digits.length >= 7) {
    const byPhone = list.find((c) => {
      const d = phoneDigits(c.phone);
      return d && (d === digits || d.endsWith(digits) || digits.endsWith(d));
    });
    if (byPhone) return byPhone;
  }
  return null;
}

function normalizeJob(raw) {
  const j = raw && typeof raw === 'object' ? raw : {};
  return {
    id: String(j.id || ''),
    customerId: String(j.customerId || ''),
    title: cleanLine(j.title, 120),
    status: JOB_STATUSES.includes(j.status) ? j.status : 'lead',
    value: parseMoney(j.value),
    date: cleanDate(j.date),
    time: cleanTime(j.time),
    durationMins: cleanDuration(j.durationMins),
    notes: cleanBlock(j.notes, 2000),
    photos: normalizePhotos(j.photos),
    remindOwnerBeforeMins: cleanRemindMins(j.remindOwnerBeforeMins),
    remindCustomerBeforeMins: cleanRemindMins(j.remindCustomerBeforeMins),
    ownerRemindedAt: j.ownerRemindedAt ? String(j.ownerRemindedAt) : '',
    customerRemindedAt: j.customerRemindedAt ? String(j.customerRemindedAt) : '',
    timeZone: cleanTimeZone(j.timeZone) || 'America/Los_Angeles',
    referralId: isRecordId(j.referralId) ? j.referralId : '',
    /** Copied onto a teammate’s calendar — points back to the sharer’s job. */
    sharedFromMemberId: SCOPE_ID.test(String(j.sharedFromMemberId || ''))
      ? String(j.sharedFromMemberId)
      : '',
    sharedFromJobId: isRecordId(j.sharedFromJobId) ? j.sharedFromJobId : '',
    /** On the source job: teammates who received a copy. */
    sharedWith: normalizeSharedWith(j.sharedWith),
    completedAt: j.completedAt || '',
    createdAt: j.createdAt || new Date().toISOString(),
    updatedAt: j.updatedAt || j.createdAt || new Date().toISOString(),
  };
}

/** Validate form input for a customer. Returns { ok, fields } or { ok: false, error }. */
function validateCustomer(input) {
  const body = input && typeof input === 'object' ? input : {};
  const fields = {
    name: cleanLine(body.name, 120),
    phone: cleanLine(body.phone, 40),
    email: cleanEmail(body.email),
    address: cleanLine(body.address, 200),
    notes: cleanBlock(body.notes, 2000),
  };
  if (!fields.name) return { ok: false, error: 'Add the customer name.' };
  if (fields.email && !emailLooksValid(fields.email)) return { ok: false, error: "That email doesn't look right." };
  return { ok: true, fields };
}

/** Validate form input for a job. Returns { ok, fields } or { ok: false, error }. */
function validateJob(input) {
  const body = input && typeof input === 'object' ? input : {};
  const status = String(body.status || 'lead');
  const rawDate = String(body.date || '').trim();
  const rawTime = String(body.time || '').trim();
  const fields = {
    title: cleanLine(body.title, 120),
    status: JOB_STATUSES.includes(status) ? status : '',
    value: parseMoney(body.value),
    date: cleanDate(rawDate),
    time: cleanTime(rawTime),
    durationMins: cleanDuration(body.durationMins),
    notes: cleanBlock(body.notes, 2000),
    remindOwnerBeforeMins: cleanRemindMins(body.remindOwnerBeforeMins),
    remindCustomerBeforeMins: cleanRemindMins(body.remindCustomerBeforeMins),
  };
  if (!fields.title) return { ok: false, error: 'Add what the job is.' };
  if (!fields.status) return { ok: false, error: 'Pick a status.' };
  if (rawDate && !fields.date) return { ok: false, error: 'Pick a valid date.' };
  if (rawTime && !fields.time) return { ok: false, error: 'Pick a valid time.' };
  if (fields.time && !fields.date) return { ok: false, error: 'Pick a date for that time.' };
  if (fields.status === 'scheduled' && !fields.date) return { ok: false, error: 'Pick a date to schedule this job.' };
  if ((fields.remindOwnerBeforeMins || fields.remindCustomerBeforeMins) && !fields.date) {
    return { ok: false, error: 'Pick a date before turning on visit reminders.' };
  }
  return { ok: true, fields };
}

// ── Storage ──────────────────────────────────────────────────────────────────

async function readJson(key) {
  const raw = await dbService.peekStorageKey(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

async function readAll(prefix) {
  const keys = await dbService.listStorageKeysWithPrefix(prefix);
  const rows = [];
  for (const key of keys) {
    if (!isRecordId(key.slice(prefix.length))) continue;
    const row = await readJson(key);
    if (row) rows.push(row);
  }
  return rows;
}

async function countKeys(prefix) {
  return (await dbService.listStorageKeysWithPrefix(prefix)).length;
}

const custPrefix = (networkId, memberId) => `netcust:${scope(networkId, memberId)}:`;
const jobPrefix = (networkId, memberId) => `netjob:${scope(networkId, memberId)}:`;

function toTouchMs(raw) {
  const t = Date.parse(String(raw || ''));
  return Number.isFinite(t) ? t : 0;
}

/**
 * Latest local touch on a customer: profile edits, CRM sync, and job activity.
 * Optional lastTouchMs (e.g. from matched GHL SMS/call) wins when newer.
 */
function customerLastTouchMs(customer, jobsForCustomer = []) {
  let best = Number(customer && customer.lastTouchMs) || 0;
  const bump = (v) => {
    const t = toTouchMs(v);
    if (t > best) best = t;
  };
  bump(customer && customer.updatedAt);
  bump(customer && customer.createdAt);
  bump(customer && customer.ghlSyncedAt);
  for (const j of Array.isArray(jobsForCustomer) ? jobsForCustomer : []) {
    bump(j && j.updatedAt);
    bump(j && j.createdAt);
    bump(j && j.completedAt);
  }
  return best;
}

/** Newest touch first (SMS/call/job/update), then name. */
function compareCustomersRecentFirst(a, b) {
  const aMs = customerLastTouchMs(a);
  const bMs = customerLastTouchMs(b);
  if (aMs !== bMs) return bMs - aMs;
  return String((a && a.name) || '').localeCompare(String((b && b.name) || ''));
}

/**
 * Index latest CRM lead activity (inbound SMS/calls + updates) by GHL id / phone
 * so the Customers list can sort like the notifications inbox.
 */
function buildLeadTouchIndex(leads) {
  const byGhlId = new Map();
  const byPhone = new Map();
  const bump = (map, key, ms) => {
    const k = String(key || '').trim();
    if (!k || !ms) return;
    const prev = map.get(k) || 0;
    if (ms > prev) map.set(k, ms);
  };
  for (const lead of Array.isArray(leads) ? leads : []) {
    if (!lead || typeof lead !== 'object') continue;
    let best = toTouchMs(lead.updatedAt) || toTouchMs(lead.createdAt);
    const events = Array.isArray(lead.inboundEvents) ? lead.inboundEvents : [];
    for (const ev of events) {
      const t = toTouchMs(ev && ev.at);
      if (t > best) best = t;
    }
    const updates = Array.isArray(lead.updates) ? lead.updates : [];
    for (const u of updates) {
      const t = toTouchMs(u && u.timestamp);
      if (t > best) best = t;
    }
    if (!best) continue;
    bump(byGhlId, lead.ghlContactId, best);
    const digits = phoneDigits(lead.phone);
    if (digits.length >= 7) bump(byPhone, digits.slice(-10), best);
  }
  return { byGhlId, byPhone };
}

function leadTouchMsForCustomer(customer, touchIndex) {
  if (!customer || !touchIndex) return 0;
  const ghlId = String(customer.ghlContactId || '').trim();
  let best = 0;
  if (ghlId && touchIndex.byGhlId && touchIndex.byGhlId.has(ghlId)) {
    best = Math.max(best, touchIndex.byGhlId.get(ghlId) || 0);
  }
  const digits = phoneDigits(customer.phone);
  if (digits.length >= 7 && touchIndex.byPhone) {
    best = Math.max(best, touchIndex.byPhone.get(digits.slice(-10)) || 0);
  }
  return best;
}

async function listCustomers(networkId, memberId) {
  const rows = await readAll(custPrefix(networkId, memberId));
  return rows.map(normalizeCustomer).sort(compareCustomersRecentFirst);
}

async function getCustomer(networkId, memberId, id) {
  if (!isRecordId(id)) return null;
  const raw = await readJson(`${custPrefix(networkId, memberId)}${id}`);
  return raw ? normalizeCustomer(raw) : null;
}

/** Contacts the member marked as leads (SMS/call inbound → Leads folder). */
async function listContactLeads(networkId, memberId) {
  const rows = await listCustomers(networkId, memberId);
  return rows
    .filter((c) => c && c.isLead)
    .sort((a, b) => String(b.markedAsLeadAt || b.updatedAt || '').localeCompare(String(a.markedAsLeadAt || a.updatedAt || '')));
}

/** Toggle “show in Leads” without changing contact details. */
async function setCustomerLeadFlag(networkId, memberId, id, isLead) {
  const existing = await getCustomer(networkId, memberId, id);
  if (!existing) return { ok: false, error: 'Customer not found.' };
  const want = isLead === true;
  if (existing.isLead === want) return { ok: true, customer: existing, unchanged: true };
  const customer = await writeCustomer(networkId, memberId, {
    ...existing,
    isLead: want,
    markedAsLeadAt: want ? (existing.markedAsLeadAt || new Date().toISOString()) : '',
  });
  return { ok: true, customer };
}

/** Create (no id) or update (id of an existing customer in this scope). */
async function saveCustomer(networkId, memberId, input, opts = {}) {
  const { id, referralId, ghlContactId, ghlSyncedAt, source, tags, isReferralPartner } = opts;
  const prefix = custPrefix(networkId, memberId);
  const checked = validateCustomer(input);
  if (!checked.ok) return checked;
  const now = new Date().toISOString();
  let existing = null;
  if (id) {
    existing = await getCustomer(networkId, memberId, id);
    if (!existing) return { ok: false, error: 'Customer not found.' };
  } else if (await countKeys(prefix) >= MAX_CUSTOMERS) {
    return { ok: false, error: `You can keep up to ${MAX_CUSTOMERS} customers.` };
  }
  const nextGhlId =
    ghlContactId !== undefined ? cleanLine(ghlContactId, 80) : (existing && existing.ghlContactId) || '';
  const nextSynced =
    ghlSyncedAt !== undefined
      ? (ghlSyncedAt ? String(ghlSyncedAt) : '')
      : (existing && existing.ghlSyncedAt) || '';
  const nextSource =
    source !== undefined
      ? String(source || '').trim().toLowerCase()
      : (existing && existing.source) || (nextGhlId ? 'ghl' : 'manual');
  const nextTags =
    tags !== undefined
      ? normalizeCustomerTags(tags)
      : normalizeCustomerTags(existing && existing.tags);
  const nextPartner =
    isReferralPartner !== undefined
      ? isReferralPartner === true
      : !!(existing && existing.isReferralPartner);
  const customer = normalizeCustomer({
    ...(existing || {}),
    ...checked.fields,
    id: existing ? existing.id : newId(),
    tags: nextTags,
    isReferralPartner: nextPartner,
    referralId: existing ? existing.referralId : (referralId || ''),
    ghlContactId: nextGhlId,
    ghlSyncedAt: nextSynced,
    source: nextSource,
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
  });
  await dbService.putStorageKey(`${prefix}${customer.id}`, customer);
  return { ok: true, customer, created: !existing };
}

/** Replace customer tag keys (workspace catalog keys). */
async function setCustomerTags(networkId, memberId, id, tagKeys) {
  const existing = await getCustomer(networkId, memberId, id);
  if (!existing) return { ok: false, error: 'Customer not found.' };
  return saveCustomer(
    networkId,
    memberId,
    {
      name: existing.name,
      phone: existing.phone,
      email: existing.email,
      address: existing.address,
      notes: existing.notes,
    },
    {
      id: existing.id,
      tags: tagKeys,
      ghlContactId: existing.ghlContactId,
      ghlSyncedAt: existing.ghlSyncedAt,
      source: existing.source,
      referralId: existing.referralId,
    },
  );
}

/** Remaining slots before MAX_CUSTOMERS. */
async function remainingCustomerSlots(networkId, memberId) {
  const used = await countKeys(custPrefix(networkId, memberId));
  return Math.max(0, MAX_CUSTOMERS - used);
}

async function listJobs(networkId, memberId) {
  const rows = await readAll(jobPrefix(networkId, memberId));
  return rows.map(normalizeJob).sort(compareJobs);
}

async function getJob(networkId, memberId, id) {
  if (!isRecordId(id)) return null;
  const raw = await readJson(`${jobPrefix(networkId, memberId)}${id}`);
  return raw ? normalizeJob(raw) : null;
}

/** Create (no id) or update a job. The customer must belong to the same member. */
async function saveJob(networkId, memberId, input, { id, referralId, timeZone } = {}) {
  const prefix = jobPrefix(networkId, memberId);
  const checked = validateJob(input);
  if (!checked.ok) return checked;
  const customerId = String((input && input.customerId) || '');
  const customer = await getCustomer(networkId, memberId, customerId);
  if (!customer) return { ok: false, error: 'Pick a customer for this job.' };
  const now = new Date().toISOString();
  let existing = null;
  if (id) {
    existing = await getJob(networkId, memberId, id);
    if (!existing) return { ok: false, error: 'Job not found.' };
  } else if (await countKeys(prefix) >= MAX_JOBS) {
    return { ok: false, error: `You can keep up to ${MAX_JOBS} jobs.` };
  }
  const status = checked.fields.status;
  const tz = cleanTimeZone(timeZone) || (existing && existing.timeZone) || 'America/Los_Angeles';
  let ownerRemindedAt = existing ? existing.ownerRemindedAt : '';
  let customerRemindedAt = existing ? existing.customerRemindedAt : '';
  if (existing) {
    const scheduleChanged =
      existing.date !== checked.fields.date
      || existing.time !== checked.fields.time
      || existing.timeZone !== tz;
    if (scheduleChanged || existing.remindOwnerBeforeMins !== checked.fields.remindOwnerBeforeMins) {
      ownerRemindedAt = '';
    }
    if (scheduleChanged || existing.remindCustomerBeforeMins !== checked.fields.remindCustomerBeforeMins) {
      customerRemindedAt = '';
    }
  }
  const job = normalizeJob({
    ...(existing || {}),
    ...checked.fields,
    photos: existing ? existing.photos : [],
    ownerRemindedAt,
    customerRemindedAt,
    timeZone: tz,
    customerId: customer.id,
    id: existing ? existing.id : newId(),
    referralId: existing ? existing.referralId : (referralId || ''),
    completedAt: status === 'completed' ? ((existing && existing.completedAt) || now) : '',
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
  });
  await dbService.putStorageKey(`${prefix}${job.id}`, job);
  return { ok: true, job, customer };
}

async function writeJob(networkId, memberId, job) {
  const next = normalizeJob({ ...job, updatedAt: new Date().toISOString() });
  await dbService.putStorageKey(`${jobPrefix(networkId, memberId)}${next.id}`, next);
  return next;
}

async function writeCustomer(networkId, memberId, customer) {
  const next = normalizeCustomer({ ...customer, updatedAt: new Date().toISOString() });
  await dbService.putStorageKey(`${custPrefix(networkId, memberId)}${next.id}`, next);
  return next;
}

/**
 * Find an open job for a customer, or create a lightweight "Site visit" so
 * photos can be attached without forcing the full job form first.
 */
async function ensureOpenJobForPhotos(networkId, memberId, customerId, { timeZone } = {}) {
  const customer = await getCustomer(networkId, memberId, customerId);
  if (!customer) return { ok: false, error: 'Customer not found.' };
  const jobs = (await listJobs(networkId, memberId)).filter((j) => j.customerId === customer.id);
  const open = jobs.find((j) => isOpen(j));
  if (open) return { ok: true, job: open, created: false };
  const saved = await saveJob(networkId, memberId, {
    customerId: customer.id,
    title: 'Site visit',
    status: 'lead',
    notes: '',
  }, { timeZone });
  if (!saved.ok) return saved;
  return { ok: true, job: saved.job, created: true };
}

/** Attach a prepared photo to a job (updates the job record + KV blob). */
async function addJobPhoto(networkId, memberId, jobId, prepared, { caption } = {}) {
  const job = await getJob(networkId, memberId, jobId);
  if (!job) return { ok: false, error: 'Job not found.' };
  if (job.photos.length >= MAX_JOB_PHOTOS) {
    return { ok: false, error: `You can add up to ${MAX_JOB_PHOTOS} photos per job.` };
  }
  const photoId = newId();
  const now = new Date().toISOString();
  await jobMedia.saveJobPhoto(networkId, memberId, job.id, photoId, prepared);
  const photos = normalizePhotos([
    ...job.photos,
    { id: photoId, caption: cleanBlock(caption, MAX_PHOTO_CAPTION), createdAt: now },
  ]);
  const saved = await writeJob(networkId, memberId, { ...job, photos });
  return { ok: true, job: saved, photoId };
}

async function removeJobPhoto(networkId, memberId, jobId, photoId) {
  const job = await getJob(networkId, memberId, jobId);
  if (!job) return { ok: false, error: 'Job not found.' };
  if (!job.photos.some((p) => p.id === photoId)) return { ok: false, error: 'Photo not found.' };
  await jobMedia.deleteJobPhoto(networkId, memberId, job.id, photoId);
  const photos = job.photos.filter((p) => p.id !== photoId);
  const saved = await writeJob(networkId, memberId, { ...job, photos });
  return { ok: true, job: saved };
}

/** Update only the caption / note on an existing job photo. */
async function updateJobPhotoCaption(networkId, memberId, jobId, photoId, caption) {
  const job = await getJob(networkId, memberId, jobId);
  if (!job) return { ok: false, error: 'Job not found.' };
  if (!job.photos.some((p) => p.id === photoId)) return { ok: false, error: 'Photo not found.' };
  const nextCaption = cleanBlock(caption, MAX_PHOTO_CAPTION);
  const photos = job.photos.map((p) => (p.id === photoId ? { ...p, caption: nextCaption } : p));
  const saved = await writeJob(networkId, memberId, { ...job, photos });
  return { ok: true, job: saved, caption: nextCaption };
}

/**
 * Quick status change from the job chips / pending advance button.
 * Scheduling without a date defaults to today so the chip works like the others
 * (full job form still requires an explicit date when saving as Scheduled).
 */
async function setJobStatus(networkId, memberId, id, status, opts = {}) {
  const job = await getJob(networkId, memberId, id);
  if (!job) return { ok: false, error: 'Job not found.' };
  const next = { ...job, status };
  if (String(status) === 'scheduled' && !next.date) {
    const today = cleanDate(opts.today) || todayIn(opts.timeZone || 'UTC');
    if (today) next.date = today;
  }
  return saveJob(networkId, memberId, next, { id: job.id });
}

async function deleteJob(networkId, memberId, id) {
  const job = await getJob(networkId, memberId, id);
  if (!job) return { ok: false, error: 'Job not found.' };
  await jobMedia.deleteAllJobPhotos(networkId, memberId, job.id).catch(() => 0);
  await dbService.deleteStorageKey(`${jobPrefix(networkId, memberId)}${job.id}`);
  return { ok: true, job };
}

/** Deleting a customer also deletes their jobs. */
async function deleteCustomer(networkId, memberId, id) {
  const customer = await getCustomer(networkId, memberId, id);
  if (!customer) return { ok: false, error: 'Customer not found.' };
  const jobs = (await listJobs(networkId, memberId)).filter((j) => j.customerId === customer.id);
  for (const job of jobs) await dbService.deleteStorageKey(`${jobPrefix(networkId, memberId)}${job.id}`);
  await dbService.deleteStorageKey(`${custPrefix(networkId, memberId)}${customer.id}`);
  return { ok: true, customer, removedJobs: jobs.length };
}

// ── Referrals → customers ────────────────────────────────────────────────────

const CONVERTIBLE = new Set(['accepted', 'booked', 'won']);
const STATUS_FROM_REFERRAL = { accepted: 'lead', booked: 'scheduled', won: 'completed' };

/**
 * One tap: turn a referral this member received into a customer + job.
 * Returns the existing customer/job when it was already converted.
 */
async function convertReferral(networkId, memberId, referral, { tradeLabel, today } = {}) {
  if (!referral || referral.toMemberId !== memberId) return { ok: false, error: 'Referral not found.' };
  if (!CONVERTIBLE.has(referral.status)) return { ok: false, error: 'Accept the referral first.' };
  const refId = String(referral.id || '');
  if (!isRecordId(refId)) return { ok: false, error: 'Referral not found.' };
  const [customers, jobs] = await Promise.all([listCustomers(networkId, memberId), listJobs(networkId, memberId)]);
  const existingJob = jobs.find((j) => j.referralId === refId);
  if (existingJob) {
    return { ok: true, existing: true, job: existingJob, customer: customers.find((c) => c.id === existingJob.customerId) || null };
  }
  const h = referral.homeowner || {};
  let customer = customers.find((c) => c.referralId === refId);
  if (!customer) {
    const address = [h.address, [h.city, h.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    const created = await saveCustomer(networkId, memberId, {
      name: h.name || 'Referral customer',
      phone: h.phone,
      email: emailLooksValid(cleanEmail(h.email)) ? h.email : '',
      address,
      notes: h.note,
    }, { referralId: refId });
    if (!created.ok) return created;
    customer = created.customer;
  }
  const status = STATUS_FROM_REFERRAL[referral.status] || 'lead';
  const job = await saveJob(networkId, memberId, {
    customerId: customer.id,
    title: tradeLabel ? `${tradeLabel} referral` : 'Referral job',
    status,
    value: referral.value,
    date: status === 'scheduled' ? cleanDate(today) : '',
    notes: h.note,
  }, { referralId: refId });
  if (!job.ok) return job;
  return { ok: true, existing: false, customer, job: job.job };
}

/**
 * Share a contact/lead with a teammate — copies the customer and every project
 * (job) for that lead onto their book. Calendars stay separate. Idempotent.
 */
async function shareCustomerWithTeammate(networkId, fromMemberId, toMemberId, customerId, { sharedByName } = {}) {
  const fromId = String(fromMemberId || '');
  const toId = String(toMemberId || '');
  if (!SCOPE_ID.test(fromId) || !SCOPE_ID.test(toId)) {
    return { ok: false, error: 'Pick a teammate to share with.' };
  }
  if (fromId === toId) return { ok: false, error: 'Pick a teammate — not yourself.' };

  const sourceCustomer = await getCustomer(networkId, fromId, customerId);
  if (!sourceCustomer) return { ok: false, error: 'Customer not found.' };

  const theirCustomers = await listCustomers(networkId, toId);
  let theirCustomer = theirCustomers.find(
    (c) => c.sharedFromMemberId === fromId && c.sharedFromCustomerId === sourceCustomer.id,
  ) || findCustomerMatch(theirCustomers, {
    phone: sourceCustomer.phone,
    email: sourceCustomer.email,
  });
  let customerExisting = !!(
    theirCustomer
    && theirCustomer.sharedFromMemberId === fromId
    && theirCustomer.sharedFromCustomerId === sourceCustomer.id
  );

  if (!theirCustomer) {
    const who = cleanLine(sharedByName, 80);
    const shareNote = who ? `Shared by ${who}.` : 'Shared by a teammate.';
    const notes = [shareNote, sourceCustomer.notes].filter(Boolean).join('\n\n').slice(0, 2000);
    const created = await saveCustomer(networkId, toId, {
      name: sourceCustomer.name,
      phone: sourceCustomer.phone,
      email: sourceCustomer.email,
      address: sourceCustomer.address,
      notes,
    }, { source: 'manual' });
    if (!created.ok) return created;
    theirCustomer = await writeCustomer(networkId, toId, {
      ...created.customer,
      sharedFromMemberId: fromId,
      sharedFromCustomerId: sourceCustomer.id,
    });
  } else {
    // Fill blanks only — don’t overwrite their contact notes/tags.
    const patch = {
      name: theirCustomer.name || sourceCustomer.name,
      phone: theirCustomer.phone || sourceCustomer.phone,
      email: theirCustomer.email || sourceCustomer.email,
      address: theirCustomer.address || sourceCustomer.address,
      notes: theirCustomer.notes,
    };
    if (
      patch.phone !== theirCustomer.phone
      || patch.email !== theirCustomer.email
      || patch.address !== theirCustomer.address
      || !theirCustomer.sharedFromCustomerId
    ) {
      const updated = await saveCustomer(networkId, toId, patch, {
        id: theirCustomer.id,
        tags: theirCustomer.tags,
        ghlContactId: theirCustomer.ghlContactId,
        ghlSyncedAt: theirCustomer.ghlSyncedAt,
        source: theirCustomer.source,
        referralId: theirCustomer.referralId,
        isReferralPartner: theirCustomer.isReferralPartner,
      });
      if (updated.ok) {
        theirCustomer = await writeCustomer(networkId, toId, {
          ...updated.customer,
          sharedFromMemberId: fromId,
          sharedFromCustomerId: sourceCustomer.id,
          sharedWith: theirCustomer.sharedWith,
        });
      }
    }
  }

  const sourceJobs = (await listJobs(networkId, fromId))
    .filter((j) => j.customerId === sourceCustomer.id);
  const theirJobs = await listJobs(networkId, toId);
  const who = cleanLine(sharedByName, 80);
  const shareNote = who ? `Shared by ${who}.` : 'Shared by a teammate.';
  const jobsOut = [];
  let jobsCreated = 0;

  for (const sourceJob of sourceJobs) {
    let theirJob = theirJobs.find(
      (j) => j.sharedFromMemberId === fromId && j.sharedFromJobId === sourceJob.id,
    );
    if (!theirJob) {
      const notes = [shareNote, sourceJob.notes].filter(Boolean).join('\n\n').slice(0, 2000);
      const created = await saveJob(networkId, toId, {
        customerId: theirCustomer.id,
        title: sourceJob.title,
        status: sourceJob.status === 'cancelled' ? 'lead' : sourceJob.status,
        value: sourceJob.value,
        date: sourceJob.date,
        time: sourceJob.time,
        durationMins: sourceJob.durationMins,
        notes,
        remindOwnerBeforeMins: 0,
        remindCustomerBeforeMins: 0,
      }, { timeZone: sourceJob.timeZone });
      if (!created.ok) return created;
      theirJob = await writeJob(networkId, toId, {
        ...created.job,
        sharedFromMemberId: fromId,
        sharedFromJobId: sourceJob.id,
        photos: [],
      });
      jobsCreated += 1;
    }

    const now = new Date().toISOString();
    const sharedWith = normalizeSharedWith([
      ...(sourceJob.sharedWith || []).filter((r) => r.memberId !== toId),
      { memberId: toId, jobId: theirJob.id, at: now },
    ]);
    await writeJob(networkId, fromId, { ...sourceJob, sharedWith });
    jobsOut.push(theirJob);
  }

  const now = new Date().toISOString();
  const sourceSharedWith = normalizeSharedPeers([
    ...(sourceCustomer.sharedWith || []).filter((r) => r.memberId !== toId),
    { memberId: toId, customerId: theirCustomer.id, at: now },
  ], 'customerId');
  const updatedSource = await writeCustomer(networkId, fromId, {
    ...sourceCustomer,
    sharedWith: sourceSharedWith,
  });

  return {
    ok: true,
    existing: customerExisting && jobsCreated === 0,
    sourceCustomer: updatedSource,
    customer: theirCustomer,
    jobs: jobsOut,
    jobsShared: jobsOut.length,
    jobsCreated,
  };
}

/**
 * Share a job with a teammate — shares the contact/lead and all of their
 * projects, then returns the copy of this specific job for deep-linking.
 */
async function shareJobWithTeammate(networkId, fromMemberId, toMemberId, jobId, { sharedByName } = {}) {
  const sourceJob = await getJob(networkId, fromMemberId, jobId);
  if (!sourceJob) return { ok: false, error: 'Job not found.' };
  const shared = await shareCustomerWithTeammate(
    networkId,
    fromMemberId,
    toMemberId,
    sourceJob.customerId,
    { sharedByName },
  );
  if (!shared.ok) return shared;
  const theirJob = (shared.jobs || []).find(
    (j) => j.sharedFromMemberId === String(fromMemberId) && j.sharedFromJobId === sourceJob.id,
  );
  if (!theirJob) return { ok: false, error: 'Could not share that job.' };
  return {
    ok: true,
    existing: shared.existing,
    sourceJob,
    job: theirJob,
    customer: shared.customer,
    jobsShared: shared.jobsShared,
    jobsCreated: shared.jobsCreated,
  };
}

// ── Views: calendar, overview ────────────────────────────────────────────────

function compareJobs(a, b) {
  const ad = a.date || '9999-99-99';
  const bd = b.date || '9999-99-99';
  if (ad !== bd) return ad < bd ? -1 : 1;
  const at = a.time || '99:99';
  const bt = b.time || '99:99';
  if (at !== bt) return at < bt ? -1 : 1;
  return String(b.updatedAt).localeCompare(String(a.updatedAt));
}

function isOpen(job) {
  return !CLOSED.has(job.status);
}

function nextStatus(status) {
  const i = PIPELINE.indexOf(status);
  if (status === 'on_hold') return 'scheduled';
  return i >= 0 && i < PIPELINE.length - 1 ? PIPELINE[i + 1] : '';
}

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

function parseYmd(value) {
  const d = cleanDate(value);
  return d ? new Date(`${d}T00:00:00Z`) : null;
}

function addDays(value, days) {
  const d = parseYmd(value);
  if (!d) return '';
  d.setUTCDate(d.getUTCDate() + days);
  return ymd(d);
}

/** Today's date in an IANA time zone (falls back to UTC). */
function todayIn(timeZone, now) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now || new Date());
  } catch {
    return ymd(now || new Date());
  }
}

/** Sunday–Saturday week containing the date. */
function weekRange(today) {
  const d = parseYmd(today) || parseYmd(ymd(new Date()));
  const start = addDays(ymd(d), -d.getUTCDay());
  return { start, end: addDays(start, 6) };
}

/** Month grid (Sunday first) with job counts per day. `month` is "YYYY-MM". */
function monthGrid(month, jobs, { today, selected } = {}) {
  const m = String(month || '').match(/^(\d{4})-(\d{2})$/);
  const base = m ? parseYmd(`${m[1]}-${m[2]}-01`) : null;
  const first = base || parseYmd(`${String(today || ymd(new Date())).slice(0, 7)}-01`);
  const y = first.getUTCFullYear();
  const mo = first.getUTCMonth();
  const key = ymd(first).slice(0, 7);
  const byDate = {};
  (jobs || []).forEach((job) => {
    if (!job.date || job.status === 'cancelled') return;
    const row = byDate[job.date] || (byDate[job.date] = { count: 0, open: 0 });
    row.count += 1;
    if (isOpen(job)) row.open += 1;
  });
  const start = addDays(ymd(first), -first.getUTCDay());
  const weeks = [];
  let cursor = start;
  for (let w = 0; w < 6; w += 1) {
    const week = [];
    for (let i = 0; i < 7; i += 1) {
      const info = byDate[cursor] || { count: 0, open: 0 };
      week.push({
        date: cursor,
        day: Number(cursor.slice(8)),
        inMonth: cursor.slice(0, 7) === key,
        isToday: cursor === today,
        isSelected: cursor === selected,
        count: info.count,
        open: info.open,
      });
      cursor = addDays(cursor, 1);
    }
    if (w >= 4 && !week.some((d) => d.inMonth)) break;
    weeks.push(week);
  }
  const prev = new Date(Date.UTC(y, mo - 1, 1));
  const next = new Date(Date.UTC(y, mo + 1, 1));
  return {
    month: key,
    label: first.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    prev: ymd(prev).slice(0, 7),
    next: ymd(next).slice(0, 7),
    weeks,
  };
}

/** Counts for the Pending cards at the top of the Customers tab. */
function overview(jobs, { today, pendingReferrals } = {}) {
  const list = Array.isArray(jobs) ? jobs : [];
  const open = list.filter(isOpen);
  const { start, end } = weekRange(today);
  const thisWeek = open.filter((j) => j.date && j.date >= start && j.date <= end);
  return {
    pendingJobs: open.length,
    pendingValue: open.reduce((sum, j) => sum + (Number(j.value) || 0), 0),
    thisWeek: thisWeek.length,
    week: { start, end },
    pendingReferrals: Math.max(0, parseInt(pendingReferrals, 10) || 0),
  };
}

function upcoming(jobs, today, limit) {
  return (Array.isArray(jobs) ? jobs : [])
    .filter((j) => isOpen(j) && j.date && j.date >= today)
    .sort(compareJobs)
    .slice(0, limit || 20);
}

// ── Calendar file ────────────────────────────────────────────────────────────

function icsEscape(value) {
  return String(value == null ? '' : value)
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/([,;])/g, '\\$1');
}

function icsFold(line) {
  const out = [];
  let rest = line;
  while (Buffer.byteLength(rest, 'utf8') > 75) {
    let cut = 75;
    while (Buffer.byteLength(rest.slice(0, cut), 'utf8') > 75) cut -= 1;
    out.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  out.push(rest);
  return out.join('\r\n');
}

function icsStamp(iso) {
  const d = new Date(iso || Date.now());
  return `${d.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
}

/**
 * .ics for one job. Timed jobs use floating local time so the phone shows
 * the time the member typed; untimed jobs are all-day.
 */
function buildIcs(job, customer, { appName, host } = {}) {
  if (!job || !job.date) return '';
  const day = job.date.replace(/-/g, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${icsEscape(appName || 'Referral network')}//Member app//EN`,
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${job.id}@${String(host || 'member-app').replace(/[^a-z0-9.-]/gi, '')}`,
    `DTSTAMP:${icsStamp(job.updatedAt)}`,
  ];
  if (job.time) {
    const startMs = Date.parse(`${job.date}T${job.time}:00Z`);
    const endMs = startMs + (job.durationMins || 60) * 60000;
    const fmt = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').slice(0, 15);
    lines.push(`DTSTART:${fmt(startMs)}`, `DTEND:${fmt(endMs)}`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${day}`, `DTEND;VALUE=DATE:${addDays(job.date, 1).replace(/-/g, '')}`);
  }
  const c = customer || {};
  const summary = c.name ? `${job.title} · ${c.name}` : job.title;
  const desc = [c.phone && `Phone: ${c.phone}`, c.email && `Email: ${c.email}`, job.notes].filter(Boolean).join('\n');
  lines.push(`SUMMARY:${icsEscape(summary)}`);
  if (c.address) lines.push(`LOCATION:${icsEscape(c.address)}`);
  if (desc) lines.push(`DESCRIPTION:${icsEscape(desc)}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return `${lines.map(icsFold).join('\r\n')}\r\n`;
}

module.exports = {
  JOB_STATUSES,
  JOB_STATUS_LABELS,
  PIPELINE,
  MAX_CUSTOMERS,
  MAX_JOBS,
  MAX_JOB_PHOTOS,
  REMIND_BEFORE_OPTIONS,
  CUSTOMER_SOURCES,
  googleMapsSearchUrl,
  MAX_CUSTOMER_TAGS,
  isRecordId,
  isOpen,
  nextStatus,
  cleanDate,
  cleanTime,
  cleanRemindMins,
  cleanTimeZone,
  phoneDigits,
  validateCustomer,
  validateJob,
  normalizeCustomer,
  normalizeCustomerTags,
  normalizeJob,
  findCustomerMatch,
  toTouchMs,
  customerLastTouchMs,
  compareCustomersRecentFirst,
  buildLeadTouchIndex,
  leadTouchMsForCustomer,
  listCustomers,
  listContactLeads,
  getCustomer,
  saveCustomer,
  setCustomerLeadFlag,
  setCustomerTags,
  remainingCustomerSlots,
  deleteCustomer,
  listJobs,
  getJob,
  saveJob,
  writeJob,
  ensureOpenJobForPhotos,
  addJobPhoto,
  removeJobPhoto,
  updateJobPhotoCaption,
  setJobStatus,
  deleteJob,
  convertReferral,
  shareCustomerWithTeammate,
  shareJobWithTeammate,
  writeCustomer,
  todayIn,
  addDays,
  weekRange,
  monthGrid,
  overview,
  upcoming,
  buildIcs,
};
