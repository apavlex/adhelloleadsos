/**
 * Go High Level (LeadConnector) API v2 client.
 * Docs: https://highlevel.stoplight.io/docs/integrations
 */

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const GHL_API_VERSION = '2021-07-28';
const GHL_CONVERSATIONS_API_VERSION = '2021-04-15';

const { mergeTagLists, tagsToAdd, parseGhlNotesResponse } = require('./ghlSyncHelpers');

function resolveConfig(integrationEnv) {
  const env = integrationEnv || {};
  const apiKey = String(env.GHL_API_KEY || process.env.GHL_API_KEY || '').trim();
  const locationId = String(env.GHL_LOCATION_ID || process.env.GHL_LOCATION_ID || '').trim();
  const emailFrom = String(env.GHL_EMAIL_FROM || process.env.GHL_EMAIL_FROM || '').trim();
  const smsFromNumber = String(env.GHL_SMS_FROM_NUMBER || process.env.GHL_SMS_FROM_NUMBER || '').trim();
  return { apiKey, locationId, emailFrom, smsFromNumber };
}

function isConfigured(integrationEnv) {
  const { apiKey, locationId } = resolveConfig(integrationEnv);
  return !!(apiKey && locationId);
}

async function ghlRequest(method, path, { integrationEnv, body, query, apiVersion } = {}) {
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
      Version: apiVersion || GHL_API_VERSION,
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

function leadToGhlContactPayload(lead, locationId, { includeTags = true } = {}) {
  const title = String(lead.title || '').trim();
  const { firstName, lastName, companyName } = splitName(title);
  const email = lead.email && lead.email !== 'N/A' ? String(lead.email).trim() : '';
  const phone = normalizePhoneE164(lead.phone && lead.phone !== 'N/A' ? lead.phone : '');
  const website = lead.website && lead.website !== 'N/A' ? String(lead.website).trim() : '';
  const address = lead.address && lead.address !== 'N/A' ? String(lead.address).trim() : '';
  const tags = Array.isArray(lead.ghlTagNamesForPush)
    ? lead.ghlTagNamesForPush.map((t) => String(t).trim()).filter(Boolean)
    : Array.isArray(lead.tags)
      ? lead.tags.map((t) => String(t).trim()).filter(Boolean)
      : [];

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
  };

  if (includeTags && tags.length) payload.tags = tags;

  Object.keys(payload).forEach((k) => {
    if (payload[k] === undefined || payload[k] === '') delete payload[k];
  });

  return payload;
}

function ghlContactToLeadPatch(contact, existingLead) {
  if (!contact || typeof contact !== 'object') return null;
  const id = String(contact.id || '').trim();
  const company =
    String(contact.companyName || contact.businessName || contact.name || '').trim() ||
    [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim();
  if (!company && !id) return null;

  const email = contact.email ? String(contact.email).trim() : 'N/A';
  const phone = contact.phone ? String(contact.phone).trim() : 'N/A';
  const website = contact.website ? String(contact.website).trim() : 'N/A';
  const ghlTags = Array.isArray(contact.tags) ? contact.tags : [];
  const localTags = existingLead && Array.isArray(existingLead.tags) ? existingLead.tags : [];

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
    tags: mergeTagLists(localTags, ghlTags),
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
  const payload = leadToGhlContactPayload(lead, locationId, { includeTags: false });
  delete payload.locationId;
  const data = await ghlRequest('PUT', `/contacts/${encodeURIComponent(contactId)}`, {
    integrationEnv,
    body: payload,
  });
  return data.contact || data;
}

async function addTagsToContact(contactId, tags, integrationEnv) {
  const list = (Array.isArray(tags) ? tags : [])
    .map((t) => String(t || '').trim())
    .filter(Boolean);
  if (!list.length) return null;
  return ghlRequest('POST', `/contacts/${encodeURIComponent(contactId)}/tags`, {
    integrationEnv,
    body: { tags: list },
  });
}

async function removeTagsFromContact(contactId, tags, integrationEnv) {
  const list = (Array.isArray(tags) ? tags : [])
    .map((t) => String(t || '').trim())
    .filter(Boolean);
  if (!list.length) return null;
  return ghlRequest('DELETE', `/contacts/${encodeURIComponent(contactId)}/tags`, {
    integrationEnv,
    body: { tags: list },
  });
}

async function syncContactTags(contactId, leadTags, integrationEnv, options = {}) {
  const replaceActionTags = options.replaceActionTags !== false;
  const isActionTagFn =
    typeof options.isActionTag === 'function'
      ? options.isActionTag
      : (t) => String(t || '').trim().toLowerCase().startsWith('ao:');

  const contact = await getContact(contactId, integrationEnv);
  let remoteTags = Array.isArray(contact && contact.tags) ? contact.tags : [];
  const localTags = Array.isArray(leadTags) ? leadTags : [];

  if (replaceActionTags) {
    const toRemove = remoteTags.filter((t) => isActionTagFn(t));
    if (toRemove.length) {
      await removeTagsFromContact(contactId, toRemove, integrationEnv);
      remoteTags = remoteTags.filter((t) => !toRemove.some((r) => tagKey(r) === tagKey(t)));
    }
  }

  const toAdd = tagsToAdd(remoteTags, localTags);
  if (toAdd.length) {
    await addTagsToContact(contactId, toAdd, integrationEnv);
  }
  return mergeTagLists(remoteTags, localTags);
}

async function listContactNotes(contactId, integrationEnv) {
  const data = await ghlRequest('GET', `/contacts/${encodeURIComponent(contactId)}/notes`, {
    integrationEnv,
  });
  return parseGhlNotesResponse(data);
}

async function createContactNote(contactId, body, integrationEnv) {
  const text = String(body || '').trim();
  if (!text) throw new Error('Note body is required');
  const data = await ghlRequest('POST', `/contacts/${encodeURIComponent(contactId)}/notes`, {
    integrationEnv,
    body: { body: text },
  });
  return data.note || data;
}

async function createContactTask(contactId, task, integrationEnv) {
  const title = String((task && task.title) || 'Follow-up').trim();
  const dueDate = String((task && task.dueDate) || '').trim();
  if (!title || !dueDate) throw new Error('Task title and dueDate are required');
  const body = {
    title,
    dueDate,
    completed: false,
  };
  const notes = String((task && task.body) || '').trim();
  if (notes) body.body = notes;
  const data = await ghlRequest('POST', `/contacts/${encodeURIComponent(contactId)}/tasks`, {
    integrationEnv,
    body,
  });
  return data.task || data;
}

async function updateContactTask(contactId, taskId, task, integrationEnv) {
  const id = String(taskId || '').trim();
  if (!id) throw new Error('Task id is required');
  const body = {
    title: String((task && task.title) || 'Follow-up').trim(),
    dueDate: String((task && task.dueDate) || '').trim(),
    completed: !!(task && task.completed),
  };
  const notes = String((task && task.body) || '').trim();
  if (notes) body.body = notes;
  const data = await ghlRequest(
    'PUT',
    `/contacts/${encodeURIComponent(contactId)}/tasks/${encodeURIComponent(id)}`,
    { integrationEnv, body },
  );
  return data.task || data;
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

/** Send SMS or Email via GHL Conversations API. */
async function sendConversationMessage(payload, integrationEnv) {
  const { locationId } = resolveConfig(integrationEnv);
  const body = { ...(payload || {}) };
  if (locationId && !body.locationId) body.locationId = locationId;
  return ghlRequest('POST', '/conversations/messages', {
    integrationEnv,
    body,
    apiVersion: GHL_CONVERSATIONS_API_VERSION,
  });
}

module.exports = {
  resolveConfig,
  isConfigured,
  testConnection,
  leadToGhlContactPayload,
  ghlContactToLeadPatch,
  createContact,
  updateContact,
  addTagsToContact,
  removeTagsFromContact,
  syncContactTags,
  getContact,
  searchContactByEmailOrPhone,
  listContacts,
  listContactNotes,
  createContactNote,
  createContactTask,
  updateContactTask,
  normalizePhoneE164,
  sendConversationMessage,
  GHL_CONVERSATIONS_API_VERSION,
};
