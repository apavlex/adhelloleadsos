/**
 * Push phone line type (mobile / landline / VoIP) to GHL for SMS workflow branching.
 */
const ghlClient = require('./ghlClient');
const phoneLineType = require('./phoneLineType');

const LINE_TYPE_FIELD_NAME = 'AdHello Phone Line Type';
const LINE_TYPE_FIELD_KEY = 'contact.adhello_phone_line_type';
const SMS_OK_FIELD_NAME = 'AdHello SMS OK';
const SMS_OK_FIELD_KEY = 'contact.adhello_sms_ok';
const CARRIER_FIELD_NAME = 'AdHello Phone Carrier';
const CARRIER_FIELD_KEY = 'contact.adhello_phone_carrier';

const fieldIdsByLocation = new Map();

function configuredFieldId(integrationEnv, envKey) {
  const env = integrationEnv || {};
  return String(env[envKey] || process.env[envKey] || '').trim();
}

function findFieldInList(fields, { name, fieldKey }) {
  const list = Array.isArray(fields) ? fields : [];
  const wantName = String(name || '').trim().toLowerCase();
  const wantKey = String(fieldKey || '').trim().toLowerCase();
  return (
    list.find((f) => String(f.fieldKey || '').trim().toLowerCase() === wantKey) ||
    list.find((f) => String(f.name || '').trim().toLowerCase() === wantName) ||
    null
  );
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
    console.warn('[ghl phone line fields]', spec.name, e.message || e);
    return null;
  }
}

function valuesFromLead(lead) {
  const badge = phoneLineType.badgeForLead(lead);
  const lineLabel = badge ? badge.label : 'Unknown';
  const carrier = badge && badge.carrier ? badge.carrier : '';
  const smsOk = phoneLineType.isSmsAllowed(lead) ? 'Yes' : 'No';
  return { lineLabel, carrier, smsOk };
}

/**
 * @param {string} contactId
 * @param {object} lead
 * @param {object} integrationEnv
 */
async function pushPhoneLineFields(contactId, lead, integrationEnv) {
  const id = String(contactId || '').trim();
  if (!id || !lead) return { skipped: true, reason: 'missing_contact_or_lead' };
  if (!phoneLineType.hasUsablePhone(lead.phone)) {
    return { skipped: true, reason: 'no_phone' };
  }

  const { lineLabel, carrier, smsOk } = valuesFromLead(lead);
  const customFields = [];

  const lineFieldId = await ensureCustomFieldId(integrationEnv, {
    cacheKey: 'line_type',
    envKey: 'GHL_PHONE_LINE_TYPE_FIELD_ID',
    name: LINE_TYPE_FIELD_NAME,
    fieldKey: LINE_TYPE_FIELD_KEY,
    dataType: 'TEXT',
    placeholder: 'Mobile, Landline, VoIP, or Unknown',
    position: 3,
  });
  if (lineFieldId) customFields.push({ id: lineFieldId, value: lineLabel });

  const smsFieldId = await ensureCustomFieldId(integrationEnv, {
    cacheKey: 'sms_ok',
    envKey: 'GHL_SMS_OK_FIELD_ID',
    name: SMS_OK_FIELD_NAME,
    fieldKey: SMS_OK_FIELD_KEY,
    dataType: 'TEXT',
    placeholder: 'Yes or No',
    position: 4,
  });
  if (smsFieldId) customFields.push({ id: smsFieldId, value: smsOk });

  if (carrier) {
    const carrierFieldId = await ensureCustomFieldId(integrationEnv, {
      cacheKey: 'carrier',
      envKey: 'GHL_PHONE_CARRIER_FIELD_ID',
      name: CARRIER_FIELD_NAME,
      fieldKey: CARRIER_FIELD_KEY,
      dataType: 'TEXT',
      placeholder: 'Wireless carrier name',
      position: 5,
    });
    if (carrierFieldId) customFields.push({ id: carrierFieldId, value: carrier });
  }

  if (!customFields.length) {
    return { skipped: true, reason: 'field_unavailable', lineLabel, smsOk };
  }

  try {
    await ghlClient.patchContactCustomFields(id, customFields, integrationEnv);
    return {
      ok: true,
      lineLabel,
      smsOk,
      carrier,
      fieldsPushed: customFields.length,
    };
  } catch (e) {
    return {
      ok: false,
      error: e.message || 'custom_field_failed',
      lineLabel,
      smsOk,
    };
  }
}

module.exports = {
  LINE_TYPE_FIELD_NAME,
  SMS_OK_FIELD_NAME,
  CARRIER_FIELD_NAME,
  valuesFromLead,
  pushPhoneLineFields,
  findFieldInList,
};
