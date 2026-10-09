/**
 * Sold appointment packages for businesses — inventory + Domino's-style tracker.
 * Syncs booked/closed appointments from GHL calendars when configured.
 */

const crypto = require('crypto');
const dbService = require('./database');
const ghlClient = require('./ghlClient');
const workspaceIntegrations = require('./workspaceIntegrations');

const STATUSES = ['open', 'booked', 'closed', 'cancelled'];
const TRACKER_STEPS = [
  { id: 'sold', label: 'Sold' },
  { id: 'open', label: 'Open' },
  { id: 'booked', label: 'Booked' },
  { id: 'closed', label: 'Closed' },
];

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function str(v) {
  return v == null ? '' : String(v).trim();
}

function clampPurchased(n) {
  const x = Math.round(Number(n));
  if (!Number.isFinite(x)) return 1;
  return Math.min(500, Math.max(1, x));
}

function normalizeStatus(raw) {
  const s = str(raw).toLowerCase();
  if (s === 'completed' || s === 'showed' || s === 'done' || s === 'closed') return 'closed';
  if (s === 'cancelled' || s === 'canceled' || s === 'no_show' || s === 'noshow') return 'cancelled';
  if (s === 'confirmed' || s === 'scheduled' || s === 'booked' || s === 'new' || s === 'pending') {
    return 'booked';
  }
  if (s === 'open' || s === 'available') return 'open';
  return 'booked';
}

function statusFromGhlAppointment(appt) {
  if (!appt || typeof appt !== 'object') return 'booked';
  if (appt.deleted === true || appt.deleted === 'true') return 'cancelled';
  const raw = str(appt.appointmentStatus || appt.status).toLowerCase();
  if (/cancel|no.?show|invalid/.test(raw)) return 'cancelled';
  if (/complete|showed|closed|done/.test(raw)) return 'closed';
  return 'booked';
}

function emptyStore() {
  return { packages: [], lastSyncAt: null, updatedAt: null };
}

function normalizeAppointment(raw) {
  const a = raw && typeof raw === 'object' ? raw : {};
  const status = normalizeStatus(a.status || 'open');
  return {
    id: str(a.id) || newId('appt'),
    ghlEventId: str(a.ghlEventId) || null,
    status,
    title: str(a.title).slice(0, 160) || null,
    startAt: str(a.startAt) || null,
    endAt: str(a.endAt) || null,
    contactName: str(a.contactName).slice(0, 120) || null,
    contactId: str(a.contactId) || null,
    bookedAt: str(a.bookedAt) || null,
    closedAt: str(a.closedAt) || null,
    updatedAt: str(a.updatedAt) || nowIso(),
  };
}

function normalizePackage(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const purchased = clampPurchased(p.purchased);
  const appointments = Array.isArray(p.appointments)
    ? p.appointments.map(normalizeAppointment).slice(0, purchased + 50)
    : [];
  return {
    id: str(p.id) || newId('pkg'),
    businessName: str(p.businessName).slice(0, 120) || 'Business',
    leadKey: str(p.leadKey) || null,
    contactEmail: str(p.contactEmail).slice(0, 160) || null,
    ghlCalendarId: str(p.ghlCalendarId) || null,
    ghlCalendarName: str(p.ghlCalendarName).slice(0, 120) || null,
    bookingUrl: str(p.bookingUrl).slice(0, 500) || null,
    purchased,
    notes: str(p.notes).slice(0, 500) || null,
    appointments,
    createdAt: str(p.createdAt) || nowIso(),
    updatedAt: str(p.updatedAt) || nowIso(),
  };
}

function normalizeStore(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    packages: Array.isArray(s.packages) ? s.packages.map(normalizePackage) : [],
    lastSyncAt: str(s.lastSyncAt) || null,
    updatedAt: str(s.updatedAt) || null,
  };
}

function countsFor(pkg) {
  const appts = Array.isArray(pkg.appointments) ? pkg.appointments : [];
  let open = 0;
  let booked = 0;
  let closed = 0;
  let cancelled = 0;
  appts.forEach((a) => {
    if (a.status === 'open') open += 1;
    else if (a.status === 'booked') booked += 1;
    else if (a.status === 'closed') closed += 1;
    else if (a.status === 'cancelled') cancelled += 1;
  });
  const used = booked + closed;
  const remaining = Math.max(0, Number(pkg.purchased) - used);
  // Fill implied open slots so inventory always accounts for unsold-capacity seats.
  const impliedOpen = Math.max(0, remaining - open);
  open += impliedOpen;
  return { open, booked, closed, cancelled, remaining, used, purchased: Number(pkg.purchased) || 0 };
}

function currentStepId(counts) {
  if (counts.purchased <= 0) return 'sold';
  if (counts.closed >= counts.purchased) return 'closed';
  if (counts.booked > 0 || counts.closed > 0) return 'booked';
  if (counts.open > 0 || counts.remaining > 0) return 'open';
  return 'sold';
}

function trackerFor(pkg) {
  const counts = countsFor(pkg);
  const current = currentStepId(counts);
  const order = TRACKER_STEPS.map((s) => s.id);
  const curIdx = order.indexOf(current);
  const steps = TRACKER_STEPS.map((step, idx) => ({
    ...step,
    state: idx < curIdx ? 'done' : idx === curIdx ? 'current' : 'todo',
  }));
  const pct = counts.purchased
    ? Math.max(0, Math.min(100, Math.round((counts.closed / counts.purchased) * 100)))
    : 0;
  return { counts, current, steps, pct };
}

async function loadStore(workspaceId) {
  const ws = (await dbService.getWorkspace(workspaceId)) || {};
  return normalizeStore(ws.appointmentPackages);
}

async function saveStore(workspaceId, store) {
  const wid = workspaceId || 'default';
  const ws = (await dbService.getWorkspace(wid)) || { id: wid, members: {} };
  const next = normalizeStore({
    ...store,
    updatedAt: nowIso(),
  });
  await dbService.saveWorkspace(wid, { ...ws, appointmentPackages: next });
  return next;
}

async function listPackages(workspaceId) {
  const store = await loadStore(workspaceId);
  return store.packages;
}

async function getPackage(workspaceId, packageId) {
  const store = await loadStore(workspaceId);
  return store.packages.find((p) => p.id === packageId) || null;
}

async function createPackage(workspaceId, input = {}) {
  const store = await loadStore(workspaceId);
  const pkg = normalizePackage({
    id: newId('pkg'),
    businessName: input.businessName,
    leadKey: input.leadKey,
    contactEmail: input.contactEmail,
    ghlCalendarId: input.ghlCalendarId,
    ghlCalendarName: input.ghlCalendarName,
    bookingUrl: input.bookingUrl,
    purchased: input.purchased,
    notes: input.notes,
    appointments: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  store.packages.unshift(pkg);
  await saveStore(workspaceId, store);
  return pkg;
}

async function updatePackage(workspaceId, packageId, patch = {}) {
  const store = await loadStore(workspaceId);
  const idx = store.packages.findIndex((p) => p.id === packageId);
  if (idx < 0) return null;
  const prev = store.packages[idx];
  const next = normalizePackage({
    ...prev,
    ...patch,
    id: prev.id,
    createdAt: prev.createdAt,
    appointments: patch.appointments != null ? patch.appointments : prev.appointments,
    updatedAt: nowIso(),
  });
  store.packages[idx] = next;
  await saveStore(workspaceId, store);
  return next;
}

async function deletePackage(workspaceId, packageId) {
  const store = await loadStore(workspaceId);
  const before = store.packages.length;
  store.packages = store.packages.filter((p) => p.id !== packageId);
  if (store.packages.length === before) return false;
  await saveStore(workspaceId, store);
  return true;
}

/**
 * Apply a GHL appointment event onto matching packages (by calendar id, or first with booking URL).
 * Used by sync + webhooks.
 */
function applyGhlEventToStore(store, event, { calendarId } = {}) {
  const ev = event && typeof event === 'object' ? event : {};
  const eventId = str(ev.id || ev.eventId || ev.appointmentId);
  if (!eventId) return { matched: false, changed: false };
  const calId = str(calendarId || ev.calendarId);
  const status = statusFromGhlAppointment(ev);
  const title = str(ev.title || ev.name).slice(0, 160) || null;
  const startAt = str(ev.startTime || ev.startAt) || null;
  const endAt = str(ev.endTime || ev.endAt) || null;
  const contactName = str(
    ev.contactName ||
      (ev.contact && (ev.contact.name || `${ev.contact.firstName || ''} ${ev.contact.lastName || ''}`)),
  ).slice(0, 120) || null;
  const contactId = str(ev.contactId || (ev.contact && ev.contact.id)) || null;

  let targets = store.packages;
  if (calId) {
    const byCal = store.packages.filter((p) => p.ghlCalendarId && p.ghlCalendarId === calId);
    if (byCal.length) targets = byCal;
  }

  let matched = false;
  let changed = false;
  for (const pkg of targets) {
    const existing = pkg.appointments.find((a) => a.ghlEventId === eventId);
    if (existing) {
      matched = true;
      const nextStatus = status;
      if (
        existing.status !== nextStatus ||
        existing.title !== title ||
        existing.startAt !== startAt ||
        existing.contactName !== contactName
      ) {
        existing.status = nextStatus;
        existing.title = title;
        existing.startAt = startAt;
        existing.endAt = endAt;
        existing.contactName = contactName;
        existing.contactId = contactId;
        existing.updatedAt = nowIso();
        if (nextStatus === 'closed' && !existing.closedAt) existing.closedAt = nowIso();
        if (nextStatus === 'booked' && !existing.bookedAt) existing.bookedAt = nowIso();
        pkg.updatedAt = nowIso();
        changed = true;
      }
      break;
    }
  }

  if (matched) return { matched: true, changed };

  // New booking: attach to the first target package that still has remaining capacity.
  for (const pkg of targets) {
    const c = countsFor(pkg);
    if (c.remaining <= 0 && status !== 'cancelled') continue;
    if (status === 'cancelled') continue;
    pkg.appointments.push(
      normalizeAppointment({
        id: newId('appt'),
        ghlEventId: eventId,
        status,
        title,
        startAt,
        endAt,
        contactName,
        contactId,
        bookedAt: nowIso(),
        closedAt: status === 'closed' ? nowIso() : null,
      }),
    );
    pkg.updatedAt = nowIso();
    return { matched: true, changed: true, packageId: pkg.id };
  }

  return { matched: false, changed: false };
}

async function syncFromGhl(workspaceId, { packageId } = {}) {
  const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(workspaceId);
  if (!ghlClient.isConfigured(integrationEnv)) {
    return {
      ok: false,
      error:
        'GHL is not configured. Add API key and Location ID in Workspace → Integrations to sync calendars.',
      store: await loadStore(workspaceId),
    };
  }

  const store = await loadStore(workspaceId);
  let packages = store.packages;
  if (packageId) packages = packages.filter((p) => p.id === packageId);
  if (!packages.length) {
    return { ok: true, synced: 0, store, message: 'No appointment packages to sync.' };
  }

  const startTime = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const endTime = Date.now() + 180 * 24 * 60 * 60 * 1000;
  let synced = 0;
  let changed = 0;
  const errors = [];

  for (const pkg of packages) {
    if (!pkg.ghlCalendarId) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      const data = await ghlClient.listCalendarEvents(integrationEnv, {
        calendarId: pkg.ghlCalendarId,
        startTime,
        endTime,
      });
      const events = Array.isArray(data.events) ? data.events : Array.isArray(data) ? data : [];
      events.forEach((ev) => {
        synced += 1;
        const result = applyGhlEventToStore(store, ev, { calendarId: pkg.ghlCalendarId });
        if (result.changed) changed += 1;
      });
    } catch (e) {
      errors.push(`${pkg.businessName}: ${e && e.message ? e.message : 'sync failed'}`);
    }
  }

  store.lastSyncAt = nowIso();
  await saveStore(workspaceId, store);
  return {
    ok: errors.length === 0,
    synced,
    changed,
    errors,
    store: await loadStore(workspaceId),
    error: errors[0] || null,
  };
}

async function listGhlCalendars(workspaceId) {
  const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(workspaceId);
  if (!ghlClient.isConfigured(integrationEnv)) {
    return { configured: false, calendars: [], error: 'GHL is not configured.' };
  }
  try {
    const data = await ghlClient.listCalendars(integrationEnv);
    const calendars = Array.isArray(data.calendars) ? data.calendars : [];
    return {
      configured: true,
      calendars: calendars.map((c) => ({
        id: str(c.id),
        name: str(c.name) || 'Calendar',
      })).filter((c) => c.id),
    };
  } catch (e) {
    return {
      configured: true,
      calendars: [],
      error: e && e.message ? e.message : 'Could not load calendars',
    };
  }
}

function buildTodayView(store, { ghlConfigured = false } = {}) {
  const packages = (store.packages || []).map((pkg) => {
    const tracker = trackerFor(pkg);
    return {
      ...pkg,
      ...tracker,
      bookingHref: pkg.bookingUrl || null,
    };
  });
  const totals = packages.reduce(
    (acc, p) => {
      acc.purchased += p.counts.purchased;
      acc.remaining += p.counts.remaining;
      acc.open += p.counts.open;
      acc.booked += p.counts.booked;
      acc.closed += p.counts.closed;
      return acc;
    },
    { purchased: 0, remaining: 0, open: 0, booked: 0, closed: 0 },
  );
  const overallPct = totals.purchased
    ? Math.max(0, Math.min(100, Math.round((totals.closed / totals.purchased) * 100)))
    : 0;
  return {
    packages,
    totals,
    overallPct,
    lastSyncAt: store.lastSyncAt || null,
    ghlConfigured: !!ghlConfigured,
    steps: TRACKER_STEPS,
  };
}

async function loadTodayView(workspaceId) {
  const store = await loadStore(workspaceId);
  const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(workspaceId);
  return buildTodayView(store, { ghlConfigured: ghlClient.isConfigured(integrationEnv) });
}

/**
 * Webhook path: AppointmentCreate / AppointmentUpdate / AppointmentDelete payloads.
 */
async function processAppointmentWebhook(body, { workspaceId } = {}) {
  const payload = body && typeof body === 'object' ? body : {};
  const type = str(payload.type || payload.eventType || payload.webhookType).toLowerCase();
  const isAppt =
    /appointment/.test(type) ||
    !!(payload.appointment && typeof payload.appointment === 'object') ||
    !!(payload.calendar && payload.appointment);
  if (!isAppt && !payload.appointment) {
    return { ignored: true, reason: 'not_appointment_event' };
  }

  const wid = workspaceId || 'default';
  const store = await loadStore(wid);
  const appt = payload.appointment && typeof payload.appointment === 'object'
    ? payload.appointment
    : payload;
  if (/delete|cancel/.test(type)) {
    appt.appointmentStatus = appt.appointmentStatus || 'cancelled';
    appt.deleted = true;
  }
  const result = applyGhlEventToStore(store, appt, { calendarId: appt.calendarId });
  if (result.changed) {
    store.lastSyncAt = nowIso();
    await saveStore(wid, store);
  }
  return {
    ignored: false,
    workspaceId: wid,
    matched: result.matched,
    changed: result.changed,
    packageId: result.packageId || null,
  };
}

module.exports = {
  TRACKER_STEPS,
  STATUSES,
  normalizeStore,
  normalizePackage,
  countsFor,
  trackerFor,
  loadStore,
  saveStore,
  listPackages,
  getPackage,
  createPackage,
  updatePackage,
  deletePackage,
  syncFromGhl,
  listGhlCalendars,
  buildTodayView,
  loadTodayView,
  applyGhlEventToStore,
  processAppointmentWebhook,
  statusFromGhlAppointment,
};
