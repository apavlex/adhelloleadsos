/**
 * Push Google Maps rating + review count to GHL contact custom fields on sync.
 */

const ghlClient = require('./ghlClient');
const { leadReviewValues, formatReviewSummaryForNote } = require('./ghlReviewFieldValues');

const RATING_FIELD_NAME = 'AdHello Google Rating';
const RATING_FIELD_KEY = 'contact.adhello_google_rating';
const REVIEWS_FIELD_NAME = 'AdHello Google Reviews';
const REVIEWS_FIELD_KEY = 'contact.adhello_google_review_count';

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

async function ensureReviewFieldId(integrationEnv, spec) {
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
    console.warn('[ghl review fields]', spec.name, e.message || e);
    return null;
  }
}

async function ensureRatingFieldId(integrationEnv) {
  return ensureReviewFieldId(integrationEnv, {
    cacheKey: 'rating',
    envKey: 'GHL_GOOGLE_RATING_FIELD_ID',
    name: RATING_FIELD_NAME,
    fieldKey: RATING_FIELD_KEY,
    dataType: 'NUMERICAL',
    placeholder: 'Maps star rating (e.g. 4.7)',
    position: 1,
  });
}

async function ensureReviewsFieldId(integrationEnv) {
  return ensureReviewFieldId(integrationEnv, {
    cacheKey: 'reviews',
    envKey: 'GHL_GOOGLE_REVIEWS_FIELD_ID',
    name: REVIEWS_FIELD_NAME,
    fieldKey: REVIEWS_FIELD_KEY,
    dataType: 'NUMERICAL',
    placeholder: 'Total Google review count',
    position: 2,
  });
}

/**
 * @param {string} contactId
 * @param {object} lead
 * @param {object} integrationEnv
 */
async function pushReviewFields(contactId, lead, integrationEnv) {
  const id = String(contactId || '').trim();
  if (!id) return { skipped: true, reason: 'missing_contact' };

  const { rating, reviews } = leadReviewValues(lead);
  if (rating <= 0 && reviews <= 0) {
    return { skipped: true, reason: 'no_review_data' };
  }

  const customFields = [];
  if (rating > 0) {
    const fieldId = await ensureRatingFieldId(integrationEnv);
    if (fieldId) {
      customFields.push({ id: fieldId, value: String(Number(rating.toFixed(1))) });
    }
  }
  if (reviews > 0) {
    const fieldId = await ensureReviewsFieldId(integrationEnv);
    if (fieldId) {
      customFields.push({ id: fieldId, value: String(reviews) });
    }
  }

  if (!customFields.length) {
    return { skipped: true, reason: 'field_unavailable', rating, reviews };
  }

  try {
    await ghlClient.patchContactCustomFields(id, customFields, integrationEnv);
    return {
      ok: true,
      rating: rating > 0 ? Number(rating.toFixed(1)) : 0,
      reviews,
      fieldsPushed: customFields.length,
    };
  } catch (e) {
    return {
      ok: false,
      error: e.message || 'custom_field_failed',
      rating,
      reviews,
    };
  }
}

module.exports = {
  RATING_FIELD_NAME,
  RATING_FIELD_KEY,
  REVIEWS_FIELD_NAME,
  REVIEWS_FIELD_KEY,
  leadReviewValues,
  findFieldInList,
  ensureRatingFieldId,
  ensureReviewsFieldId,
  pushReviewFields,
  formatReviewSummaryForNote,
};
