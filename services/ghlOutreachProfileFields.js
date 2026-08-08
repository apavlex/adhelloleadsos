/**
 * Push sender business profile (offer catalog context) to GHL for multi-business auto-outreach.
 */
const dbService = require('./database');
const ghlClient = require('./ghlClient');
const { resolveOutreachSenderProfile } = require('./outreachSenderProfile');
const { findFieldInList } = require('./ghlPhoneLineFields');

const SENDER_BUSINESS_FIELD_NAME = 'AdHello Sender Business';
const SENDER_BUSINESS_FIELD_KEY = 'contact.adhello_sender_business';
const SENDER_VERTICAL_FIELD_NAME = 'AdHello Sender Vertical';
const SENDER_VERTICAL_FIELD_KEY = 'contact.adhello_sender_vertical';
const SENDER_OFFER_FIELD_NAME = 'AdHello Sender Offer';
const SENDER_OFFER_FIELD_KEY = 'contact.adhello_sender_offer';
const SENDER_PITCH_FIELD_NAME = 'AdHello Sender Pitch';
const SENDER_PITCH_FIELD_KEY = 'contact.adhello_sender_pitch';
const AUDIT_LINK_FIELD_NAME = 'AdHello Audit Link';
const AUDIT_LINK_FIELD_KEY = 'contact.adhello_audit_link';

const fieldIdsByLocation = new Map();

function configuredFieldId(integrationEnv, envKey) {
  const env = integrationEnv || {};
  return String(env[envKey] || process.env[envKey] || '').trim();
}

async function ensureCustomFieldId(integrationEnv, spec) {
  const { locationId } = ghlClient.resolveConfig(integrationEnv);
  if (!locationId) return null;

  const cacheKey = `${locationId}:${spec.cacheKey}`;
  const fromEnv = configuredFieldId(integrationEnv, spec.envKey);
  if (fromEnv) {
    fieldIdsByLocation.set(cacheKey, fromEnv);
    return fromEnv;
  }
  if (fieldIdsByLocation.has(cacheKey)) {
    return fieldIdsByLocation.get(cacheKey);
  }

  try {
    const fields = await ghlClient.listLocationContactCustomFields(integrationEnv);
    const existing = findFieldInList(fields, spec);
    if (existing && existing.id) {
      const id = String(existing.id).trim();
      fieldIdsByLocation.set(cacheKey, id);
      return id;
    }

    const created = await ghlClient.createLocationContactCustomField(integrationEnv, {
      name: spec.name,
      dataType: spec.dataType,
      placeholder: spec.placeholder,
      position: spec.position,
    });
    const id = String((created && created.id) || '').trim();
    if (!id) return null;
    fieldIdsByLocation.set(cacheKey, id);
    return id;
  } catch (e) {
    console.warn('[ghl outreach profile fields]', spec.name, e.message || e);
    return null;
  }
}

const FIELD_SPECS = [
  {
    cacheKey: 'sender_business',
    envKey: 'GHL_SENDER_BUSINESS_FIELD_ID',
    name: SENDER_BUSINESS_FIELD_NAME,
    fieldKey: SENDER_BUSINESS_FIELD_KEY,
    dataType: 'TEXT',
    placeholder: 'Your business name reaching out',
    position: 6,
    profileKey: 'senderBusinessName',
  },
  {
    cacheKey: 'sender_vertical',
    envKey: 'GHL_SENDER_VERTICAL_FIELD_ID',
    name: SENDER_VERTICAL_FIELD_NAME,
    fieldKey: SENDER_VERTICAL_FIELD_KEY,
    dataType: 'TEXT',
    placeholder: 'Industry or vertical',
    position: 7,
    profileKey: 'vertical',
  },
  {
    cacheKey: 'sender_offer',
    envKey: 'GHL_SENDER_OFFER_FIELD_ID',
    name: SENDER_OFFER_FIELD_NAME,
    fieldKey: SENDER_OFFER_FIELD_KEY,
    dataType: 'TEXT',
    placeholder: 'Offer / profile label',
    position: 8,
    profileKey: 'offerLabel',
  },
  {
    cacheKey: 'sender_pitch',
    envKey: 'GHL_SENDER_PITCH_FIELD_ID',
    name: SENDER_PITCH_FIELD_NAME,
    fieldKey: SENDER_PITCH_FIELD_KEY,
    dataType: 'TEXT',
    placeholder: 'Short value proposition',
    position: 9,
    profileKey: 'pitch',
  },
  {
    cacheKey: 'audit_link',
    envKey: 'GHL_AUDIT_LINK_FIELD_ID',
    name: AUDIT_LINK_FIELD_NAME,
    fieldKey: AUDIT_LINK_FIELD_KEY,
    dataType: 'TEXT',
    placeholder: 'GHL audit widget or landing page URL',
    position: 10,
    profileKey: 'auditLink',
  },
];

/**
 * @param {string} contactId
 * @param {object} lead
 * @param {object} integrationEnv
 * @param {string} [workspaceId]
 */
async function pushOutreachProfileFields(contactId, lead, integrationEnv, workspaceId) {
  const id = String(contactId || '').trim();
  if (!id || !lead) return { skipped: true, reason: 'missing_contact_or_lead' };

  const wid = String(workspaceId || lead.workspaceId || 'default').trim() || 'default';
  const ws = (await dbService.getWorkspace(wid)) || {};
  let folder = null;
  const folderKey = String(lead.folderKey || '').trim();
  if (folderKey) {
    folder = await dbService.getFolder(wid, folderKey);
  }

  const profile = resolveOutreachSenderProfile(ws, lead, folder);
  if (!profile.offerKey && !profile.senderBusinessName) {
    return { skipped: true, reason: 'no_profile', profile };
  }

  const customFields = [];
  for (const spec of FIELD_SPECS) {
    const value = String(profile[spec.profileKey] || '').trim();
    if (!value) continue;
    // eslint-disable-next-line no-await-in-loop
    const fieldId = await ensureCustomFieldId(integrationEnv, spec);
    if (fieldId) customFields.push({ id: fieldId, value });
  }

  if (!customFields.length) {
    return { skipped: true, reason: 'field_unavailable', profile };
  }

  try {
    await ghlClient.patchContactCustomFields(id, customFields, integrationEnv);
    return { ok: true, profile, fieldsPushed: customFields.length };
  } catch (e) {
    return { ok: false, error: e.message || 'custom_field_failed', profile };
  }
}

module.exports = {
  SENDER_BUSINESS_FIELD_NAME,
  SENDER_VERTICAL_FIELD_NAME,
  SENDER_OFFER_FIELD_NAME,
  SENDER_PITCH_FIELD_NAME,
  AUDIT_LINK_FIELD_NAME,
  pushOutreachProfileFields,
};
