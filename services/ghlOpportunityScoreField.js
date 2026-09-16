/**
 * Push the precise opportunity score (x.x/10) onto the GHL contact.
 * The banded tag (AO: High/Medium/Low opp) stays stable; the number lives here.
 */
const ghlClient = require('./ghlClient');
const { findFieldInList } = require('./ghlPhoneLineFields');
const { leadOpportunityScore } = require('./leadSignalTags');

const FIELD_NAME = 'AdHello Opportunity Score';
const FIELD_KEY = 'contact.adhello_opportunity_score';
const fieldIdByLocation = new Map();

function configuredFieldId(integrationEnv) {
  const env = integrationEnv || {};
  return String(
    env.GHL_OPPORTUNITY_SCORE_FIELD_ID || process.env.GHL_OPPORTUNITY_SCORE_FIELD_ID || '',
  ).trim();
}

async function ensureOpportunityScoreFieldId(integrationEnv) {
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
      dataType: 'NUMERICAL',
      placeholder: 'Gap / opportunity score out of 10 (e.g. 7.5)',
      position: 12,
    });
    const id = String((created && created.id) || '').trim();
    if (!id) return null;
    fieldIdByLocation.set(locationId, id);
    return id;
  } catch (e) {
    console.warn('[ghl opportunity score field]', e.message || e);
    return null;
  }
}

/**
 * @param {string} contactId
 * @param {object} lead
 * @param {object} integrationEnv
 * @param {{ lowReviewsThreshold?: number, workspace?: object }} [options]
 */
async function pushOpportunityScoreField(contactId, lead, integrationEnv, options) {
  const id = String(contactId || '').trim();
  if (!id || !lead) return { skipped: true, reason: 'missing_contact_or_lead' };

  const score = leadOpportunityScore(lead, options);
  if (score == null) return { skipped: true, reason: 'no_score' };

  const fieldId = await ensureOpportunityScoreFieldId(integrationEnv);
  if (!fieldId) return { skipped: true, reason: 'field_unavailable', score };

  try {
    await ghlClient.patchContactCustomFields(id, [{ id: fieldId, value: String(score) }], integrationEnv);
    return { ok: true, score };
  } catch (e) {
    return { ok: false, error: e.message || 'custom_field_failed', score };
  }
}

module.exports = {
  FIELD_NAME,
  FIELD_KEY,
  ensureOpportunityScoreFieldId,
  pushOpportunityScoreField,
};
