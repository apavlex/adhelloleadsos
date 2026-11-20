/**
 * Prospect gap labels for pipeline Opportunity column.
 * Agency: bad site / low reviews / weak social / SEO gaps.
 * HomeElk (license_renewal): CCB / COI expiry tags drive the Opportunity column instead.
 */

const {
  normalizeRoiProfile,
  resolveRoiProfileFromOptions,
  ROI_PROFILES,
} = require('./workspaceRoiProfile');
const { resolveComplianceExpiry, formatLicenseStatusLabel } = require('./localProspectScore');

const DEFAULT_LOW_REVIEWS_THRESHOLD = 30;

function normalizeLowReviewsThreshold(raw) {
  if (raw == null || raw === '') return DEFAULT_LOW_REVIEWS_THRESHOLD;
  const n = parseInt(String(raw).replace(/,/g, ''), 10);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_LOW_REVIEWS_THRESHOLD;
  return Math.min(10000, n);
}

function getLowReviewsThresholdFromWorkspace(ws) {
  const p = ws && ws.prospecting && typeof ws.prospecting === 'object' ? ws.prospecting : {};
  return normalizeLowReviewsThreshold(p.lowReviewsThreshold);
}

function normalizeProspectingSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const roiProfile = normalizeRoiProfile(s.roiProfile) || '';
  return {
    lowReviewsThreshold: normalizeLowReviewsThreshold(s.lowReviewsThreshold),
    roiProfile,
  };
}

function hasSocial(val) {
  return !!(val && String(val).trim() && String(val).trim() !== 'N/A');
}

function parseReviews(lead) {
  return parseInt(lead && (lead.reviewsCount != null ? lead.reviewsCount : lead.reviews), 10) || 0;
}

function isLowReviews(reviewsCount, threshold) {
  const t = normalizeLowReviewsThreshold(threshold);
  return parseReviews({ reviewsCount }) <= t;
}

function boolGapFalse(lead, key) {
  const v = lead && lead[key];
  return v === false || v === 'false';
}

/**
 * @param {object} lead — row dataset or saved lead
 * @param {{ lowReviewsThreshold?: number, maxLabels?: number, roiProfile?: string }} [options]
 * @returns {string[]}
 */
function computeProspectGapLabels(lead, options) {
  const cap = Math.min(6, Math.max(1, Number(options && options.maxLabels) || 4));
  const threshold = normalizeLowReviewsThreshold(options && options.lowReviewsThreshold);
  const roiProfile = resolveRoiProfileFromOptions(options);
  const out = [];
  const push = (label) => {
    if (out.length >= cap) return;
    if (label && !out.includes(label)) out.push(label);
  };

  if (!lead || typeof lead !== 'object') return out;

  if (roiProfile === ROI_PROFILES.LICENSE_RENEWAL) {
    const resolved = resolveComplianceExpiry(lead);
    if (resolved.days == null) {
      push('NO CCB/COI DATE');
    } else {
      const label = formatLicenseStatusLabel(resolved.days, resolved.kind).toUpperCase();
      push(label);
      if (resolved.ccbDays != null && resolved.coiDays != null && resolved.ccbDays !== resolved.coiDays) {
        const otherKind = resolved.kind === 'coi' ? 'ccb' : 'coi';
        const otherDays = otherKind === 'coi' ? resolved.coiDays : resolved.ccbDays;
        if (otherDays != null && otherDays <= 180) {
          push(formatLicenseStatusLabel(otherDays, otherKind).toUpperCase());
        }
      }
    }
    return out.slice(0, cap);
  }

  const website = lead.website && String(lead.website).trim() && lead.website !== 'N/A';
  const reviews = parseReviews(lead);
  const hasFB = hasSocial(lead.facebook) || hasSocial(lead.facebook_url);
  const hasIG = hasSocial(lead.instagram) || hasSocial(lead.instagram_url);
  const isOutdated = lead.isOutdated === true || lead.isOutdated === 'true';
  const noMobile = boolGapFalse(lead, 'isMobileFriendly');
  const noSchema = boolGapFalse(lead, 'hasSchemaMarkup');
  const aeoScore = parseInt(lead.aeoScore, 10) || 0;

  if (roiProfile === ROI_PROFILES.PARTNER_FIT) {
    if (!website) push('NO WEBSITE');
    else if (isOutdated || noMobile) push('BAD SITE');
    if (isLowReviews(reviews, threshold)) push('LOW REVIEWS');
    if (!hasFB && !hasIG) push('WEAK SOCIAL');
    return out.slice(0, cap);
  }

  if (!website) push('NO WEBSITE');
  else {
    if (isOutdated || noMobile) push('BAD SITE');
    if (!hasFB && !hasIG) push('WEAK SOCIAL');
    if (noSchema || (aeoScore > 0 && aeoScore < 3)) push('SEO GAPS');
  }

  if (isLowReviews(reviews, threshold)) push('LOW REVIEWS');

  return out.slice(0, cap);
}

module.exports = {
  DEFAULT_LOW_REVIEWS_THRESHOLD,
  normalizeLowReviewsThreshold,
  getLowReviewsThresholdFromWorkspace,
  normalizeProspectingSettings,
  isLowReviews,
  computeProspectGapLabels,
};
