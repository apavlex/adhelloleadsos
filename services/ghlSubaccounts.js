/**
 * Create GHL agency sub-accounts (locations) from selected pipeline leads.
 */

const dbService = require('./database');
const ghlClient = require('./ghlClient');
const { ghlLocationDashboardUrl } = require('./websiteBuildLinks');

const CA_PROVINCES = new Set([
  'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT',
]);
const MAX_BULK = 25;

function namesMatch(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function pickLeadEmail(lead) {
  const candidates = [];
  if (lead && lead.email) candidates.push(lead.email);
  const contacts = Array.isArray(lead && lead.contacts) ? lead.contacts : [];
  for (const c of contacts) {
    if (c && c.email) candidates.push(c.email);
  }
  for (const raw of candidates) {
    const s = String(raw || '').trim();
    if (ghlClient.isValidEmailForGhl(s)) return s;
  }
  return '';
}

function pickLeadPhone(lead) {
  const raw = lead && lead.phone && lead.phone !== 'N/A' ? lead.phone : '';
  if (raw) return ghlClient.normalizePhoneE164(raw);
  const contacts = Array.isArray(lead && lead.contacts) ? lead.contacts : [];
  for (const c of contacts) {
    if (c && c.phone && String(c.phone).trim() && c.phone !== 'N/A') {
      return ghlClient.normalizePhoneE164(c.phone);
    }
  }
  return '';
}

function inferCountry(lead) {
  const explicit = String((lead && lead.country) || '').trim().toUpperCase();
  if (explicit.length === 2) return explicit;
  if (/^canada$/i.test(explicit) || explicit === 'CAN') return 'CA';
  if (/^united states$/i.test(explicit) || explicit === 'USA') return 'US';
  const state = String((lead && lead.state) || '').trim().toUpperCase();
  if (CA_PROVINCES.has(state)) return 'CA';
  if (/^[A-Z]{2}$/.test(state)) return 'US';
  const addr = String((lead && lead.address) || '').toUpperCase();
  if (/\bCANADA\b/.test(addr) || /\b(BC|ON|AB|QC|NS|MB|SK)\b/.test(addr)) return 'CA';
  return 'US';
}

function leadToCreateLocationPayload(lead, { companyId, snapshotId } = {}) {
  const name = String((lead && (lead.title || lead.company)) || '').trim();
  if (!name) throw new Error('Business name is required to create a GHL sub-account.');
  const cid = String(companyId || '').trim();
  if (!cid) throw new Error('GHL company ID is required to create a sub-account.');

  const payload = { name, companyId: cid };
  const phone = pickLeadPhone(lead);
  if (phone) payload.phone = phone;
  const address = lead && lead.address && lead.address !== 'N/A' ? String(lead.address).trim() : '';
  if (address) payload.address = address;
  const city = lead && lead.city ? String(lead.city).trim() : '';
  if (city) payload.city = city;
  const state = lead && lead.state ? String(lead.state).trim() : '';
  if (state) payload.state = state;
  payload.country = inferCountry(lead);
  const postal = String((lead && (lead.postalCode || lead.zip)) || '').trim();
  if (postal) payload.postalCode = postal;
  const website = lead && lead.website && lead.website !== 'N/A' ? String(lead.website).trim() : '';
  if (website) payload.website = website;

  const email = pickLeadEmail(lead);
  if (email) {
    const { firstName, lastName } = ghlClient.splitName(name);
    payload.prospectInfo = {
      firstName: firstName || name.split(/\s+/)[0] || 'Owner',
      lastName: lastName || name,
      email,
    };
  }

  const snap = String(snapshotId || '').trim();
  if (snap) payload.snapshotId = snap;
  return payload;
}

async function resolveCompanyId(integrationEnv) {
  const cfg = ghlClient.resolveConfig(integrationEnv);
  if (cfg.companyId) return cfg.companyId;
  if (!cfg.locationId) return '';
  const data = await ghlClient.getLocation(cfg.locationId, integrationEnv);
  return ghlClient.extractCompanyId(data);
}

async function findExistingLocationByName(name, companyId, integrationEnv) {
  const target = String(name || '').trim();
  if (!target || !companyId) return null;
  try {
    const data = await ghlClient.searchLocations({ companyId, limit: 100 }, integrationEnv);
    const list = ghlClient.locationsFromSearch(data);
    return list.find((loc) => namesMatch(loc && loc.name, target)) || null;
  } catch (_) {
    return null;
  }
}

function subaccountUrlFor(locationId, integrationEnv) {
  return ghlLocationDashboardUrl({
    dashboardUrl: (integrationEnv && integrationEnv.GHL_DASHBOARD_URL) || process.env.GHL_DASHBOARD_URL,
    locationId,
  });
}

async function persistLeadSubaccount(lead, locationId, integrationEnv, { reused } = {}) {
  const id = String(locationId || '').trim();
  const url = subaccountUrlFor(id, integrationEnv);
  const now = new Date().toISOString();
  const patch = {
    ghlSubaccountId: id,
    ghlSubaccountUrl: url,
    ghlSubaccountCreatedAt: lead.ghlSubaccountCreatedAt || now,
    logs: [
      {
        type: 'ghl_subaccount',
        message: reused
          ? `Linked existing GHL sub-account ${id}`
          : `Created GHL sub-account ${id}`,
        timestamp: now,
      },
    ],
  };
  const updated = await dbService.updateLead(lead.key, patch, lead.workspaceId);
  return { lead: updated || lead, locationId: id, url, reused: !!reused };
}

async function createSubaccountForLead(lead, integrationEnv) {
  if (!lead || !lead.key) return { ok: false, error: 'lead_not_found' };
  const existingId = String(lead.ghlSubaccountId || '').trim();
  if (existingId) {
    const url = String(lead.ghlSubaccountUrl || '').trim() || subaccountUrlFor(existingId, integrationEnv);
    return {
      ok: true,
      skipped: true,
      reason: 'already_created',
      locationId: existingId,
      url,
      key: lead.key,
      title: lead.title || '',
    };
  }

  const cfg = ghlClient.resolveConfig(integrationEnv);
  if (!cfg.apiKey) {
    return { ok: false, error: 'GHL API key is not configured.', key: lead.key, title: lead.title || '' };
  }

  const companyId = await resolveCompanyId(integrationEnv);
  if (!companyId) {
    return {
      ok: false,
      error: 'GHL company ID is missing. Save Agency Company ID in Workspace → Integrations, or set GHL_COMPANY_ID.',
      key: lead.key,
      title: lead.title || '',
    };
  }

  const name = String(lead.title || lead.company || '').trim();
  const found = await findExistingLocationByName(name, companyId, integrationEnv);
  if (found && found.id) {
    const saved = await persistLeadSubaccount(lead, found.id, integrationEnv, { reused: true });
    return {
      ok: true,
      skipped: true,
      reason: 'name_exists',
      locationId: saved.locationId,
      url: saved.url,
      key: lead.key,
      title: lead.title || '',
    };
  }

  let payload;
  try {
    payload = leadToCreateLocationPayload(lead, { companyId, snapshotId: cfg.snapshotId });
  } catch (e) {
    return { ok: false, error: e.message || 'invalid_payload', key: lead.key, title: lead.title || '' };
  }

  try {
    const created = await ghlClient.createLocation(payload, integrationEnv);
    const locationId = ghlClient.extractLocationId(created);
    if (!locationId) {
      return { ok: false, error: 'GHL did not return a location id.', key: lead.key, title: lead.title || '' };
    }
    const saved = await persistLeadSubaccount(lead, locationId, integrationEnv);
    return {
      ok: true,
      created: true,
      locationId: saved.locationId,
      url: saved.url,
      key: lead.key,
      title: lead.title || '',
    };
  } catch (e) {
    return {
      ok: false,
      error: e.message || 'create_failed',
      key: lead.key,
      title: lead.title || '',
    };
  }
}

function normalizeLeadStorageKey(leadKey) {
  const k = String(leadKey || '').trim();
  if (!k) return '';
  return k.startsWith('lead:') ? k : `lead:${k}`;
}

async function createSubaccountsForLeads({ workspaceId, integrationEnv, leadKeys } = {}) {
  const wid = workspaceId || 'default';
  const keys = Array.isArray(leadKeys)
    ? leadKeys.map((k) => String(k || '').trim()).filter(Boolean).slice(0, MAX_BULK)
    : [];
  const results = [];
  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const rawKey of keys) {
    const storageKey =
      (await dbService.resolveLeadStorageKey(rawKey, wid)) || normalizeLeadStorageKey(rawKey);
    const lead = storageKey ? await dbService.getLead(storageKey) : null;
    if (!lead) {
      failed += 1;
      results.push({ ok: false, key: rawKey, error: 'lead_not_found' });
      continue;
    }
    if (!lead.workspaceId) lead.workspaceId = wid;
    // eslint-disable-next-line no-await-in-loop
    const result = await createSubaccountForLead(lead, integrationEnv);
    results.push(result);
    if (result.ok && result.created) created += 1;
    else if (result.ok && result.skipped) skipped += 1;
    else failed += 1;
  }

  return { created, skipped, failed, total: keys.length, results };
}

module.exports = {
  MAX_BULK,
  namesMatch,
  pickLeadEmail,
  inferCountry,
  leadToCreateLocationPayload,
  resolveCompanyId,
  createSubaccountForLead,
  createSubaccountsForLeads,
};
