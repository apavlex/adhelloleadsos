/**
 * Push the my.adhello.ai website-build URL onto the GHL contact.
 */
const ghlClient = require('./ghlClient');
const { findFieldInList } = require('./ghlPhoneLineFields');
const { websiteBuildPublicUrl } = require('./websiteBuildLinks');

const FIELD_NAME = 'AdHello Website Build';
const FIELD_KEY = 'contact.adhello_website_build';
const fieldIdByLocation = new Map();

function configuredFieldId(integrationEnv) {
  const env = integrationEnv || {};
  return String(env.GHL_WEBSITE_BUILD_FIELD_ID || process.env.GHL_WEBSITE_BUILD_FIELD_ID || '').trim();
}

async function ensureWebsiteBuildFieldId(integrationEnv) {
  const { locationId } = ghlClient.resolveConfig(integrationEnv);
  if (!locationId) return null;

  const fromEnv = configuredFieldId(integrationEnv);
  if (fromEnv) {
    fieldIdByLocation.set(locationId, fromEnv);
    return fromEnv;
  }
  if (fieldIdByLocation.has(locationId)) return fieldIdByLocation.get(locationId);

  try {
    const fields = await ghlClient.listLocationContactCustomFields(integrationEnv);
    const existing = findFieldInList(fields, { name: FIELD_NAME, fieldKey: FIELD_KEY });
    if (existing && existing.id) {
      const id = String(existing.id).trim();
      fieldIdByLocation.set(locationId, id);
      return id;
    }
    const created = await ghlClient.createLocationContactCustomField(integrationEnv, {
      name: FIELD_NAME,
      dataType: 'TEXT',
      placeholder: 'https://business.my.adhello.ai',
      position: 11,
    });
    const id = String((created && created.id) || '').trim();
    if (!id) return null;
    fieldIdByLocation.set(locationId, id);
    return id;
  } catch (e) {
    console.warn('[ghl website build field]', e.message || e);
    return null;
  }
}

async function pushWebsiteBuildField(contactId, lead, integrationEnv) {
  const id = String(contactId || '').trim();
  if (!id || !lead) return { skipped: true, reason: 'missing_contact_or_lead' };

  const url = websiteBuildPublicUrl(lead);
  const fieldId = await ensureWebsiteBuildFieldId(integrationEnv);
  if (!fieldId) return { skipped: true, reason: 'field_unavailable', url };

  try {
    await ghlClient.patchContactCustomFields(id, [{ id: fieldId, value: url }], integrationEnv);
    return { ok: true, url };
  } catch (e) {
    return { ok: false, error: e.message || 'custom_field_failed', url };
  }
}

module.exports = {
  FIELD_NAME,
  FIELD_KEY,
  ensureWebsiteBuildFieldId,
  pushWebsiteBuildField,
};
