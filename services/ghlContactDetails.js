/**
 * Every email, phone and named person on a lead → the lead's single GHL contact.
 *
 * One GHL contact per business: people from lead.contacts[] / decision maker are not created as separate GHL
 * contacts, because tag-triggered GHL workflows would then fire once per person and GHL's email/phone
 * uniqueness would make re-syncs collide. Instead:
 *   - secondary emails / phones go on the contact's native additionalEmails / additionalPhones (best-effort —
 *     undocumented for writes, max 10 each), merged with any GHL already has;
 *   - "AdHello All Emails" and "AdHello Contacts" custom fields always carry the full lists (overwritten, so
 *     repeat syncs never pile up notes or duplicates).
 * Remote values are compared first, so an unchanged lead makes no writes.
 */
const ghlClient = require('./ghlClient');
const { findFieldInList } = require('./ghlPhoneLineFields');
const { buildModel } = require('../public/js/contact-finder-cell');

const GHL_MAX_ADDITIONAL = 10;

const ALL_EMAILS_FIELD = {
  cacheKey: 'all_emails',
  name: 'AdHello All Emails',
  fieldKey: 'contact.adhello_all_emails',
  envKey: 'GHL_ALL_EMAILS_FIELD_ID',
  dataType: 'LARGE_TEXT',
  placeholder: 'Every email on the lead, one per line',
  position: 12,
};
const CONTACTS_FIELD = {
  cacheKey: 'contacts',
  name: 'AdHello Contacts',
  fieldKey: 'contact.adhello_contacts',
  envKey: 'GHL_CONTACTS_FIELD_ID',
  dataType: 'LARGE_TEXT',
  placeholder: 'Named people at the business with title, email, phone',
  position: 13,
};

const fieldIdsByLocation = new Map();
/** `${locationId}:${field}` for channels GHL rejected as "property … should not exist". */
const unsupportedChannels = new Set();

function parseList(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

/** One line per named person (and per unnamed phone-only entry) for the "AdHello Contacts" field. */
function buildPeopleLines(lead) {
  const L = lead || {};
  const m = buildModel(L);
  const lines = m.people.map((p) => {
    const bits = [p.title ? `${p.name} — ${p.title}` : p.name];
    if (p.email) bits.push(p.email.toLowerCase());
    if (p.phone) bits.push(ghlClient.normalizePhoneE164(p.phone));
    if (p.linkedin) bits.push(p.linkedin);
    return bits.join(' · ');
  });
  parseList(L.contacts).forEach((c) => {
    if (!c || String(c.name || '').trim()) return;
    const phone = String(c.phone || '').trim();
    if (!phone || phone === 'N/A') return;
    const role = String(c.role || '').trim();
    lines.push(`${role && !/^(phone|email|contact|primary)$/i.test(role) ? role : 'Phone'}: ${ghlClient.normalizePhoneE164(phone)}`);
  });
  return lines;
}

function buildGhlContactDetails(lead) {
  const emails = ghlClient.collectLeadEmailsForGhl(lead);
  const phones = ghlClient.collectLeadPhonesForGhl(lead);
  const extraEmails = emails.slice(1);
  const extraPhones = phones.slice(1);
  return {
    emails,
    phones,
    primaryEmail: emails[0] || '',
    primaryPhone: phones[0] || '',
    additionalEmails: extraEmails.slice(0, GHL_MAX_ADDITIONAL),
    additionalPhones: extraPhones.slice(0, GHL_MAX_ADDITIONAL),
    allEmailsText: emails.length > 1 ? emails.join('\n') : '',
    contactsText: buildPeopleLines(lead).join('\n'),
  };
}

function remoteList(list, key, normalize) {
  return (Array.isArray(list) ? list : [])
    .map((item) => normalize(item && typeof item === 'object' ? item[key] : item))
    .filter(Boolean);
}

const normEmail = (v) => String(v || '').trim().toLowerCase();
const normPhone = (v) => (String(v || '').trim() ? ghlClient.normalizePhoneE164(v) : '');
const phoneDigits = (v) => String(v || '').replace(/\D/g, '');

function mergeKeep(local, remote, exclude, keyFn) {
  const out = [];
  const seen = new Set(exclude.map(keyFn).filter(Boolean));
  [...local, ...remote].forEach((v) => {
    const k = keyFn(v);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(v);
  });
  return out.slice(0, GHL_MAX_ADDITIONAL);
}

function sameSet(a, b, keyFn) {
  const ka = new Set(a.map(keyFn));
  const kb = new Set(b.map(keyFn));
  return ka.size === kb.size && [...ka].every((k) => kb.has(k));
}

function remoteFieldValue(remote, fieldId) {
  const list = Array.isArray(remote && remote.customFields) ? remote.customFields : [];
  const hit = list.find((f) => f && String(f.id || '') === fieldId);
  if (!hit) return '';
  const v = hit.value != null ? hit.value : hit.fieldValue;
  return v == null ? '' : String(v);
}

/**
 * Pure diff of what to write. Local secondaries merge with GHL's (GHL-only ones are kept), primaries excluded.
 * @returns {{ channels: { additionalEmails?: string[], additionalPhones?: string[] } | null, customFields: { id: string, value: string }[] }}
 */
function planContactDetailsPush(details, remoteContact, fieldIds = {}) {
  const remote = remoteContact && typeof remoteContact === 'object' ? remoteContact : {};
  const remoteEmails = remoteList(remote.additionalEmails, 'email', normEmail);
  const remotePhones = remoteList(remote.additionalPhones, 'phone', normPhone);

  const wantEmails = mergeKeep(details.additionalEmails, remoteEmails, [details.primaryEmail, normEmail(remote.email)], normEmail);
  const wantPhones = mergeKeep(details.additionalPhones, remotePhones, [details.primaryPhone, normPhone(remote.phone)], phoneDigits);

  const channels = {};
  if (details.additionalEmails.length && !sameSet(wantEmails, remoteEmails, normEmail)) channels.additionalEmails = wantEmails;
  if (details.additionalPhones.length && !sameSet(wantPhones, remotePhones, phoneDigits)) channels.additionalPhones = wantPhones;

  const customFields = [];
  [
    [fieldIds.allEmails, details.allEmailsText],
    [fieldIds.contacts, details.contactsText],
  ].forEach(([id, value]) => {
    if (id && value && remoteFieldValue(remote, id) !== value) customFields.push({ id, value });
  });

  return { channels: Object.keys(channels).length ? channels : null, customFields };
}

async function ensureFieldId(integrationEnv, spec) {
  const { locationId } = ghlClient.resolveConfig(integrationEnv);
  if (!locationId) return null;
  const cacheKey = `${locationId}:${spec.cacheKey}`;
  const env = integrationEnv || {};
  const fromEnv = String(env[spec.envKey] || process.env[spec.envKey] || '').trim();
  if (fromEnv) return fromEnv;
  if (fieldIdsByLocation.has(cacheKey)) return fieldIdsByLocation.get(cacheKey);
  try {
    const fields = await ghlClient.listLocationContactCustomFields(integrationEnv);
    const existing = findFieldInList(fields, spec);
    let id = existing && existing.id ? String(existing.id).trim() : '';
    if (!id) {
      const created = await ghlClient.createLocationContactCustomField(integrationEnv, spec);
      id = String((created && created.id) || '').trim();
    }
    if (!id) return null;
    fieldIdsByLocation.set(cacheKey, id);
    return id;
  } catch (e) {
    console.warn('[ghl contact details field]', spec.name, e.message || e);
    return null;
  }
}

function isUnknownPropertyError(err, prop) {
  const body = err && err.body;
  const msgs = [].concat(body && body.message ? body.message : [], err && err.message ? err.message : []);
  return msgs.some((m) => new RegExp(`${prop}\\s+should not exist`, 'i').test(String(m)));
}

async function pushChannels(contactId, channels, integrationEnv, locationId) {
  const keys = Object.keys(channels).filter((k) => !unsupportedChannels.has(`${locationId}:${k}`));
  if (!keys.length) return { status: 'unsupported' };
  const body = {};
  keys.forEach((k) => {
    body[k] = channels[k];
  });
  try {
    await ghlClient.updateContactChannels(contactId, body, integrationEnv);
    return { status: 'updated', fields: keys };
  } catch (err) {
    // Retry one field at a time so a rejected phone doesn't block emails (or vice versa).
    const done = [];
    const failed = {};
    for (const k of keys) {
      if (isUnknownPropertyError(err, k)) {
        unsupportedChannels.add(`${locationId}:${k}`);
        failed[k] = 'unsupported';
        continue;
      }
      if (keys.length === 1) {
        failed[k] = err.message || 'update_failed';
        continue;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        await ghlClient.updateContactChannels(contactId, { [k]: channels[k] }, integrationEnv);
        done.push(k);
      } catch (e2) {
        if (isUnknownPropertyError(e2, k)) unsupportedChannels.add(`${locationId}:${k}`);
        failed[k] = e2.message || 'update_failed';
      }
    }
    return { status: done.length ? 'partial' : 'failed', fields: done, errors: failed };
  }
}

/**
 * @param {string} contactId
 * @param {object} lead
 * @param {object} integrationEnv
 */
async function pushLeadContactDetails(contactId, lead, integrationEnv) {
  const id = String(contactId || '').trim();
  if (!id || !lead) return { skipped: true, reason: 'missing_contact_or_lead' };
  const details = buildGhlContactDetails(lead);
  const summary = {
    emails: details.emails.length,
    phones: details.phones.length,
    people: details.contactsText ? details.contactsText.split('\n').length : 0,
  };
  const hasExtras =
    details.additionalEmails.length || details.additionalPhones.length || details.allEmailsText || details.contactsText;
  if (!hasExtras) return { skipped: true, reason: 'nothing_extra', ...summary };

  let remote = null;
  try {
    remote = await ghlClient.getContact(id, integrationEnv);
  } catch (_) {
    remote = null;
  }
  const fieldIds = {};
  if (details.allEmailsText) fieldIds.allEmails = await ensureFieldId(integrationEnv, ALL_EMAILS_FIELD);
  if (details.contactsText) fieldIds.contacts = await ensureFieldId(integrationEnv, CONTACTS_FIELD);

  const plan = planContactDetailsPush(details, remote, fieldIds);
  const result = { ok: true, ...summary, customFieldsWritten: 0, channels: { status: 'unchanged' } };

  if (plan.customFields.length) {
    try {
      await ghlClient.patchContactCustomFields(id, plan.customFields, integrationEnv);
      result.customFieldsWritten = plan.customFields.length;
    } catch (e) {
      result.customFieldsError = e.message || 'custom_fields_failed';
    }
  }
  if (plan.channels) {
    const { locationId } = ghlClient.resolveConfig(integrationEnv);
    result.channels = await pushChannels(id, plan.channels, integrationEnv, locationId);
  }
  return result;
}

module.exports = {
  GHL_MAX_ADDITIONAL,
  ALL_EMAILS_FIELD,
  CONTACTS_FIELD,
  buildPeopleLines,
  buildGhlContactDetails,
  planContactDetailsPush,
  pushLeadContactDetails,
};
