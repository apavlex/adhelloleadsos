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
const MAX_VALUE = 10000000;
const MAX_DURATION = 7 * 24 * 60;

// Hex/base36 only: kv listing uses SQL LIKE, where "_" and "%" are wildcards.
const SCOPE_ID = /^[a-z0-9]{1,64}$/i;
const RECORD_ID = /^[a-z0-9]{6,40}$/;

function newId() {
  return `${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
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

// ── Records ──────────────────────────────────────────────────────────────────

const CUSTOMER_SOURCES = new Set(['manual', 'csv', 'ghl', 'referral']);

function phoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
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
    referralId: isRecordId(c.referralId) ? c.referralId : '',
    ghlContactId: cleanLine(c.ghlContactId, 80),
    ghlSyncedAt: c.ghlSyncedAt ? String(c.ghlSyncedAt) : '',
    source: CUSTOMER_SOURCES.has(source) ? source : (c.ghlContactId ? 'ghl' : 'manual'),
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
    referralId: isRecordId(j.referralId) ? j.referralId : '',
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
  };
  if (!fields.title) return { ok: false, error: 'Add what the job is.' };
  if (!fields.status) return { ok: false, error: 'Pick a status.' };
  if (rawDate && !fields.date) return { ok: false, error: 'Pick a valid date.' };
  if (rawTime && !fields.time) return { ok: false, error: 'Pick a valid time.' };
  if (fields.time && !fields.date) return { ok: false, error: 'Pick a date for that time.' };
  if (fields.status === 'scheduled' && !fields.date) return { ok: false, error: 'Pick a date to schedule this job.' };
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

async function listCustomers(networkId, memberId) {
  const rows = await readAll(custPrefix(networkId, memberId));
  return rows.map(normalizeCustomer).sort((a, b) => a.name.localeCompare(b.name));
}

async function getCustomer(networkId, memberId, id) {
  if (!isRecordId(id)) return null;
  const raw = await readJson(`${custPrefix(networkId, memberId)}${id}`);
  return raw ? normalizeCustomer(raw) : null;
}

/** Create (no id) or update (id of an existing customer in this scope). */
async function saveCustomer(networkId, memberId, input, opts = {}) {
  const { id, referralId, ghlContactId, ghlSyncedAt, source } = opts;
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
  const customer = normalizeCustomer({
    ...(existing || {}),
    ...checked.fields,
    id: existing ? existing.id : newId(),
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
async function saveJob(networkId, memberId, input, { id, referralId } = {}) {
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
  const job = normalizeJob({
    ...(existing || {}),
    ...checked.fields,
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

async function setJobStatus(networkId, memberId, id, status) {
  const job = await getJob(networkId, memberId, id);
  if (!job) return { ok: false, error: 'Job not found.' };
  return saveJob(networkId, memberId, { ...job, status }, { id: job.id });
}

async function deleteJob(networkId, memberId, id) {
  const job = await getJob(networkId, memberId, id);
  if (!job) return { ok: false, error: 'Job not found.' };
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
  CUSTOMER_SOURCES,
  isRecordId,
  isOpen,
  nextStatus,
  cleanDate,
  cleanTime,
  phoneDigits,
  validateCustomer,
  validateJob,
  normalizeCustomer,
  findCustomerMatch,
  listCustomers,
  getCustomer,
  saveCustomer,
  remainingCustomerSlots,
  deleteCustomer,
  listJobs,
  getJob,
  saveJob,
  setJobStatus,
  deleteJob,
  convertReferral,
  todayIn,
  addDays,
  weekRange,
  monthGrid,
  overview,
  upcoming,
  buildIcs,
};
