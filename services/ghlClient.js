/**
 * Go High Level (LeadConnector) API v2 client.
 * Docs: https://highlevel.stoplight.io/docs/integrations
 */

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const GHL_API_VERSION = '2021-07-28';

function resolveConfig(integrationEnv) {
  const env = integrationEnv || {};
  const apiKey = String(env.GHL_API_KEY || process.env.GHL_API_KEY || '').trim();
  const locationId = String(env.GHL_LOCATION_ID || process.env.GHL_LOCATION_ID || '').trim();
  return { apiKey, locationId };
}

function isConfigured(integrationEnv) {
  const { apiKey, locationId } = resolveConfig(integrationEnv);
  return !!(apiKey && locationId);
}

async function ghlRequest(method, path, { integrationEnv, body, query } = {}) {
  const { apiKey, locationId } = resolveConfig(integrationEnv);
  if (!apiKey) throw new Error('GHL API key is not configured.');
  if (!locationId && !String(path || '').includes('/locations/')) {
    throw new Error('GHL location ID is not configured.');
  }

  const url = new URL(path.startsWith('http') ? path : `${GHL_API_BASE}${path.startsWith('/') ? path : `/${path}`}`);
  if (query && typeof query === 'object') {
    Object.entries(query).forEach(([k, v]) => {
      if (v != null && String(v).trim() !== '') url.searchParams.set(k, String(v));
    });
  }

  const res = await fetch(url.toString(), {
    method: method || 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Version: GHL_API_VERSION,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_) {
    data = { raw: text };
  }

  if (!res.ok) {
    const msg =
      (data && data.message) ||
      (data && data.error) ||
      (data && data.msg) ||
      `GHL API error (${res.status})`;
    const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    err.status = res.status;
    err.body = data;
    throw err;
  }

  return data;
}

/** Ping connection — list 1 contact for the configured location. */
async function testConnection(integrationEnv) {
  const { locationId } = resolveConfig(integrationEnv);
  const data = await ghlRequest('GET', '/contacts/', {
    integrationEnv,
    query: { locationId, limit: 1 },
  });
  const contacts = Array.isArray(data.contacts) ? data.contacts : [];
  return {
    ok: true,
    message: `Connected — location ${locationId.slice(0, 12)}… (${contacts.length ? 'contacts readable' : 'no contacts yet'})`,
  };
}

function normalizePhoneE164(raw) {
  const digits = String(raw || '').replace(/[^\d+]/g, '');
  if (!digits) return '';
  if (digits.startsWith('+')) return digits;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}

function splitName(title) {
  const t = String(title || '').trim();
  if (!t) return { firstName: '', lastName: '', companyName: '' };
  const parts = t.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '', companyName: t };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
    companyName: t,
  };
}

function leadToGhlContactPayload(lead, locationId) {
  const title = String(lead.title || '').trim();
  const { firstName, lastName, companyName } = splitName(title);
  const email = lead.email && lead.email !== 'N/A' ? String(lead.email).trim() : '';
  const phone = normalizePhoneE164(lead.phone && lead.phone !== 'N/A' ? lead.phone : '');
  const website = lead.website && lead.website !== 'N/A' ? String(lead.website).trim() : '';
  const address = lead.address && lead.address !== 'N/A' ? String(lead.address).trim() : '';
  const tags = Array.isArray(lead.tags) ? lead.tags.map((t) => String(t).trim()).filter(Boolean) : [];

  const payload = {
    locationId,
    firstName: firstName || companyName || 'Lead',
    lastName: lastName || '',
    name: title || companyName || 'Lead',
    companyName: companyName || title,
    email: email || undefined,
    phone: phone || undefined,
    address1: address || undefined,
    city: lead.city ? String(lead.city).trim() : undefined,
    state: lead.state ? String(lead.state).trim() : undefined,
    website: website || undefined,
    source: 'Agency OS',
    tags: tags.length ? tags : undefined,
  };

  Object.keys(payload).forEach((k) => {
    if (payload[k] === undefined || payload[k] === '') delete payload[k];
  });

  return payload;
}

function ghlContactToLeadPatch(contact) {
  if (!contact || typeof contact !== 'object') return null;
  const id = String(contact.id || '').trim();
  const company =
    String(contact.companyName || contact.businessName || contact.name || '').trim() ||
    [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim();
  if (!company && !id) return null;

  const email = contact.email ? String(contact.email).trim() : 'N/A';
  const phone = contact.phone ? String(contact.phone).trim() : 'N/A';
  const website = contact.website ? String(contact.website).trim() : 'N/A';

  return {
    title: company || 'GHL Contact',
    email: email || 'N/A',
    phone: phone || 'N/A',
    website: website || 'N/A',
    address: contact.address1 ? String(contact.address1).trim() : 'N/A',
    city: contact.city ? String(contact.city).trim() : '',
    state: contact.state ? String(contact.state).trim() : '',
    ghlContactId: id,
    source: 'ghl_sync',
    ghlSyncedAt: new Date().toISOString(),
    tags: Array.isArray(contact.tags) ? contact.tags : undefined,
  };
}

async function createContact(lead, integrationEnv) {
  const { locationId } = resolveConfig(integrationEnv);
  const payload = leadToGhlContactPayload(lead, locationId);
  const data = await ghlRequest('POST', '/contacts/', { integrationEnv, body: payload });
  const contact = data.contact || data;
  return contact && contact.id ? contact : data;
}

async function updateContact(contactId, lead, integrationEnv) {
  const { locationId } = resolveConfig(integrationEnv);
  const payload = leadToGhlContactPayload(lead, locationId);
  delete payload.locationId;
  const data = await ghlRequest('PUT', `/contacts/${encodeURIComponent(contactId)}`, {
    integrationEnv,
    body: payload,
  });
  return data.contact || data;
}

async function getContact(contactId, integrationEnv) {
  const data = await ghlRequest('GET', `/contacts/${encodeURIComponent(contactId)}`, { integrationEnv });
  return data.contact || data;
}

async function searchContactByEmailOrPhone(lead, integrationEnv) {
  const { locationId } = resolveConfig(integrationEnv);
  const email = lead.email && lead.email !== 'N/A' ? String(lead.email).trim().toLowerCase() : '';
  const phone = normalizePhoneE164(lead.phone && lead.phone !== 'N/A' ? lead.phone : '');
  const query = email || phone.replace(/^\+/, '');
  if (!query) return null;

  const data = await ghlRequest('GET', '/contacts/', {
    integrationEnv,
    query: { locationId, query, limit: 5 },
  });
  const contacts = Array.isArray(data.contacts) ? data.contacts : [];
  if (!contacts.length) return null;

  if (email) {
    const match = contacts.find(
      (c) => c && String(c.email || '').trim().toLowerCase() === email,
    );
    if (match) return match;
  }
  if (phone) {
    const match = contacts.find((c) => {
      const p = normalizePhoneE164(c && c.phone);
      return p && p === phone;
    });
    if (match) return match;
  }
  return contacts[0];
}

async function listContacts(integrationEnv, { limit = 100, startAfterId } = {}) {
  const { locationId } = resolveConfig(integrationEnv);
  const query = { locationId, limit: Math.min(Math.max(limit, 1), 100) };
  if (startAfterId) query.startAfterId = String(startAfterId);
  const data = await ghlRequest('GET', '/contacts/', { integrationEnv, query });
  const contacts = Array.isArray(data.contacts) ? data.contacts : [];
  const meta = data.meta || {};
  return {
    contacts,
    nextStartAfterId: meta.nextPageUrl ? meta.startAfterId : meta.startAfterId || null,
    meta,
  };
}

module.exports = {
  resolveConfig,
  isConfigured,
  testConnection,
  leadToGhlContactPayload,
  ghlContactToLeadPatch,
  createContact,
  updateContact,
  getContact,
  searchContactByEmailOrPhone,
  listContacts,
  normalizePhoneE164,
};
