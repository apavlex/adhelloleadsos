/**
 * GHL contact custom field "AdHello Last Prospected" — sortable recency for synced imports.
 * GHL does not expose lastActivity via API; this DATE field is updated on every push.
 */

const ghlClient = require('./ghlClient');

const FIELD_NAME = 'AdHello Last Prospected';
const FIELD_KEY = 'contact.adhello_last_prospected';
const fieldIdByLocation = new Map();

function todayDateValue(date = new Date()) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  return d.toISOString().slice(0, 10);
}

function configuredFieldId(integrationEnv) {
  const env = integrationEnv || {};
  return String(env.GHL_LAST_PROSPECTED_FIELD_ID || process.env.GHL_LAST_PROSPECTED_FIELD_ID || '').trim();
}

function findFieldInList(fields) {
  const list = Array.isArray(fields) ? fields : [];
  const wantName = FIELD_NAME.toLowerCase();
  const wantKey = FIELD_KEY.toLowerCase();
  return (
    list.find((f) => String(f.fieldKey || '').trim().toLowerCase() === wantKey) ||
    list.find((f) => String(f.name || '').trim().toLowerCase() === wantName) ||
    null
  );
}

/**
 * Resolve (or create) the contact DATE field used for sort-by-recency in GHL.
 * @returns {Promise<string|null>} custom field id
 */
async function ensureLastProspectedFieldId(integrationEnv) {
  const { locationId } = ghlClient.resolveConfig(integrationEnv);
  if (!locationId) return null;

  const fromEnv = configuredFieldId(integrationEnv);
  if (fromEnv) {
    fieldIdByLocation.set(locationId, fromEnv);
    return fromEnv;
  }

  if (fieldIdByLocation.has(locationId)) {
    return fieldIdByLocation.get(locationId);
  }

  try {
    const fields = await ghlClient.listLocationContactCustomFields(integrationEnv);
    const existing = findFieldInList(fields);
    if (existing && existing.id) {
      const id = String(existing.id).trim();
      fieldIdByLocation.set(locationId, id);
      return id;
    }

    const created = await ghlClient.createLocationContactCustomField(integrationEnv, {
      name: FIELD_NAME,
      dataType: 'DATE',
      placeholder: 'Last AdHello prospect sync',
      position: 0,
    });
    const id = String((created && created.id) || '').trim();
    if (!id) return null;
    fieldIdByLocation.set(locationId, id);
    return id;
  } catch (e) {
    console.warn('[ghl last prospected field]', e.message || e);
    return null;
  }
}

/**
 * @param {string} contactId
 * @param {object} integrationEnv
 * @param {Date} [when]
 */
async function pushLastProspectedField(contactId, integrationEnv, when = new Date()) {
  const id = String(contactId || '').trim();
  if (!id) return { skipped: true, reason: 'missing_contact' };

  const fieldId = await ensureLastProspectedFieldId(integrationEnv);
  if (!fieldId) return { skipped: true, reason: 'field_unavailable' };

  const value = todayDateValue(when);
  try {
    await ghlClient.patchContactCustomFields(id, [{ id: fieldId, value }], integrationEnv);
    return { ok: true, fieldId, value, fieldName: FIELD_NAME };
  } catch (e) {
    return { ok: false, error: e.message || 'custom_field_failed' };
  }
}

module.exports = {
  FIELD_NAME,
  FIELD_KEY,
  todayDateValue,
  ensureLastProspectedFieldId,
  pushLastProspectedField,
  findFieldInList,
};
