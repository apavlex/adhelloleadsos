/**
 * Maps the lead quality badges shown in AdHello (opportunity band, Local Prospector tier,
 * website state, gap labels) to GHL contact tags (prefix AO:), so operators can filter the
 * CRM by the same signals they see in the queue and pipeline.
 *
 * Pure — same inputs as the badges, no I/O.
 */

const { tagKey } = require('./ghlSyncHelpers');
const { scoreLeadRecord } = require('./opportunityScore');
const {
  computeProspectGapLabels,
  getLowReviewsThresholdFromWorkspace,
  normalizeLowReviewsThreshold,
} = require('./prospectGapLabels');

const SIGNAL_TAG_PREFIX = 'AO:';

const AO_SIGNAL_TAGS = Object.freeze({
  HIGH_OPP: `${SIGNAL_TAG_PREFIX} High opp`,
  MEDIUM_OPP: `${SIGNAL_TAG_PREFIX} Medium opp`,
  LOW_OPP: `${SIGNAL_TAG_PREFIX} Low opp`,
  HOT_PROSPECT: `${SIGNAL_TAG_PREFIX} Hot prospect`,
  WARM_PROSPECT: `${SIGNAL_TAG_PREFIX} Warm prospect`,
  LOW_PROSPECT: `${SIGNAL_TAG_PREFIX} Low prospect`,
  SKIP_PROSPECT: `${SIGNAL_TAG_PREFIX} Skip prospect`,
  NO_SITE_FOUND: `${SIGNAL_TAG_PREFIX} No site found`,
  SOCIAL_ONLY: `${SIGNAL_TAG_PREFIX} Social only`,
  MARKETPLACE_SITE: `${SIGNAL_TAG_PREFIX} Marketplace site`,
  WEAK_SITE: `${SIGNAL_TAG_PREFIX} Weak site`,
  HAS_SITE: `${SIGNAL_TAG_PREFIX} Has site`,
  WEAK_SOCIAL: `${SIGNAL_TAG_PREFIX} Weak social`,
  SEO_GAPS: `${SIGNAL_TAG_PREFIX} SEO gaps`,
  LOW_REVIEWS: `${SIGNAL_TAG_PREFIX} Low reviews`,
});

const ALL_SIGNAL_TAG_VALUES = Object.freeze(Object.values(AO_SIGNAL_TAGS));

/** Opportunity badge band — mirrors the `high` / `medium` / `low` tier from scoreLeadRecord. */
const OPP_TAG_BY_TIER = Object.freeze({
  high: AO_SIGNAL_TAGS.HIGH_OPP,
  medium: AO_SIGNAL_TAGS.MEDIUM_OPP,
  low: AO_SIGNAL_TAGS.LOW_OPP,
});

/** Local Prospector tier badge (Hot · No site found). */
const PROSPECT_TAG_BY_TIER = Object.freeze({
  Hot: AO_SIGNAL_TAGS.HOT_PROSPECT,
  Warm: AO_SIGNAL_TAGS.WARM_PROSPECT,
  Low: AO_SIGNAL_TAGS.LOW_PROSPECT,
  Skip: AO_SIGNAL_TAGS.SKIP_PROSPECT,
});

/** Website state badge — one tag per lead, canonical source for "no site" style tags. */
const WEBSITE_TAG_BY_STATUS = Object.freeze({
  no_site: AO_SIGNAL_TAGS.NO_SITE_FOUND,
  social_only: AO_SIGNAL_TAGS.SOCIAL_ONLY,
  marketplace: AO_SIGNAL_TAGS.MARKETPLACE_SITE,
  weak_site: AO_SIGNAL_TAGS.WEAK_SITE,
  has_site: AO_SIGNAL_TAGS.HAS_SITE,
});

/**
 * Pipeline gap badges that are not already covered by the website-state tag.
 * NO WEBSITE → `AO: No site found` and BAD SITE → `AO: Weak site` come from
 * WEBSITE_TAG_BY_STATUS instead, so a contact never carries two website-state tags.
 */
const GAP_TAG_BY_LABEL = Object.freeze({
  'WEAK SOCIAL': AO_SIGNAL_TAGS.WEAK_SOCIAL,
  'SEO GAPS': AO_SIGNAL_TAGS.SEO_GAPS,
  'LOW REVIEWS': AO_SIGNAL_TAGS.LOW_REVIEWS,
});

function isSignalTag(tag) {
  const raw = String(tag || '').trim();
  if (!raw) return false;
  return ALL_SIGNAL_TAG_VALUES.some((t) => tagKey(t) === tagKey(raw));
}

function stripSignalTags(tags) {
  return (Array.isArray(tags) ? tags : []).filter((t) => !isSignalTag(t));
}

/** Review count is only "known" when the lead actually carries a numeric count. */
function hasKnownReviewCount(lead) {
  if (!lead || typeof lead !== 'object') return false;
  const raw =
    lead.reviewsCount != null && lead.reviewsCount !== ''
      ? lead.reviewsCount
      : lead.reviews != null && lead.reviews !== ''
        ? lead.reviews
        : lead.reviews_count;
  if (raw == null || raw === '') return false;
  const n = parseInt(String(raw).replace(/,/g, ''), 10);
  return Number.isFinite(n) && n >= 0;
}

function resolveLowReviewsThreshold(options) {
  const opts = options && typeof options === 'object' ? options : {};
  if (opts.lowReviewsThreshold != null && opts.lowReviewsThreshold !== '') {
    return normalizeLowReviewsThreshold(opts.lowReviewsThreshold);
  }
  return getLowReviewsThresholdFromWorkspace(opts.workspace);
}

/**
 * GHL tag names for the quality badges on a lead.
 * @param {object} lead — saved lead record
 * @param {{ lowReviewsThreshold?: number, workspace?: object }} [options]
 * @returns {string[]}
 */
function computeLeadSignalTags(lead, options) {
  if (!lead || typeof lead !== 'object') return [];

  const lowReviewsThreshold = resolveLowReviewsThreshold(options);
  const scored = scoreLeadRecord(lead, {
    lowReviewsThreshold,
    workspace: options && options.workspace,
    roiProfile: options && options.roiProfile,
  });
  const localProspect = scored.localProspect || {};

  const out = [];
  const push = (tag) => {
    if (!tag) return;
    if (out.some((t) => tagKey(t) === tagKey(tag))) return;
    out.push(tag);
  };

  push(OPP_TAG_BY_TIER[scored.tier]);
  push(PROSPECT_TAG_BY_TIER[localProspect.prospectTier]);
  push(WEBSITE_TAG_BY_STATUS[localProspect.websiteStatus]);

  computeProspectGapLabels(lead, { lowReviewsThreshold, maxLabels: 6 }).forEach((label) => {
    const tag = GAP_TAG_BY_LABEL[label];
    if (!tag) return;
    // Never claim "low reviews" for a lead that was simply never enriched.
    if (tag === AO_SIGNAL_TAGS.LOW_REVIEWS && !hasKnownReviewCount(lead)) return;
    push(tag);
  });

  return out;
}

/** Precise opportunity score for the GHL custom field (badge shows the same number). */
function leadOpportunityScore(lead, options) {
  if (!lead || typeof lead !== 'object') return null;
  const lowReviewsThreshold = resolveLowReviewsThreshold(options);
  const { score } = scoreLeadRecord(lead, {
    lowReviewsThreshold,
    workspace: options && options.workspace,
    roiProfile: options && options.roiProfile,
  });
  if (!Number.isFinite(score)) return null;
  return Math.round(score * 10) / 10;
}

module.exports = {
  SIGNAL_TAG_PREFIX,
  AO_SIGNAL_TAGS,
  ALL_SIGNAL_TAG_VALUES,
  OPP_TAG_BY_TIER,
  PROSPECT_TAG_BY_TIER,
  WEBSITE_TAG_BY_STATUS,
  GAP_TAG_BY_LABEL,
  isSignalTag,
  stripSignalTags,
  hasKnownReviewCount,
  computeLeadSignalTags,
  leadOpportunityScore,
};
