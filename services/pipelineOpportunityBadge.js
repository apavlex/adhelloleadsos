/**
 * Pipeline Opportunity column badges — SSR HTML aligned with public/js/app.js
 * (calculateOpportunityScore + computeProspectGapLabelsClient + renderOpportunityBadges).
 * Persist scores on first paint so folder switches do not flash “Scoring…”.
 */

const {
  computeProspectGapLabels,
  normalizeLowReviewsThreshold,
  getLowReviewsThresholdFromWorkspace,
} = require('./prospectGapLabels');

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function hasSocial(val) {
  return !!(val && String(val).trim() && String(val).trim() !== 'N/A');
}

function parseBuyingSignals(lead) {
  if (!lead || lead.buyingSignals == null || lead.buyingSignals === 'undefined') return [];
  if (Array.isArray(lead.buyingSignals)) return lead.buyingSignals;
  try {
    const parsed = JSON.parse(lead.buyingSignals);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Match app.js getAiAuditGap10FromDataset (aiWebsiteAnalysisScore or dataset aiScore). */
function getAiAuditGap10(lead) {
  const raw =
    lead && lead.aiWebsiteAnalysisScore != null && lead.aiWebsiteAnalysisScore !== ''
      ? Number(lead.aiWebsiteAnalysisScore)
      : lead && lead.aiScore != null && lead.aiScore !== ''
        ? Number(lead.aiScore)
        : NaN;
  if (!Number.isFinite(raw) || raw <= 0) return null;
  if (raw > 10) return Math.min(10, Math.max(0, Math.round((100 - raw) / 10)));
  return Math.min(10, Math.max(0, raw));
}

/**
 * Client-aligned rules score (agency gap) — same weights as app.js calculateOpportunityScore.
 * @param {object} lead
 * @param {{ lowReviewsThreshold?: number, workspace?: object }} [options]
 */
function calculateClientOpportunityScore(lead, options) {
  let score = 0;
  const website = lead && lead.website && String(lead.website).trim() && lead.website !== 'N/A';
  const reviews = parseInt(lead && (lead.reviews != null ? lead.reviews : lead.reviewsCount), 10) || 0;
  const rating = parseFloat(lead && (lead.rating != null ? lead.rating : lead.totalScore)) || 0;
  const hasFB = hasSocial(lead && lead.facebook) || hasSocial(lead && lead.facebook_url);
  const hasIG = hasSocial(lead && lead.instagram) || hasSocial(lead && lead.instagram_url);
  const lowReviewsThreshold =
    options && options.lowReviewsThreshold != null
      ? normalizeLowReviewsThreshold(options.lowReviewsThreshold)
      : getLowReviewsThresholdFromWorkspace(options && options.workspace);

  const isOutdated = lead && (lead.isOutdated === 'true' || lead.isOutdated === true);
  const noMobile = lead && (lead.isMobileFriendly === 'false' || lead.isMobileFriendly === false);
  const noSchema = lead && (lead.hasSchemaMarkup === 'false' || lead.hasSchemaMarkup === false);
  const noChatbot = lead && (lead.hasChatbot === 'false' || lead.hasChatbot === false);
  const noClickToCall = lead && (lead.hasClickToCall === 'false' || lead.hasClickToCall === false);
  const aeoScore = parseInt((lead && lead.aeoScore) || 0, 10) || 0;
  const cms = String((lead && lead.cmsPlatform) || '').toLowerCase();
  const buyingSignals = parseBuyingSignals(lead);

  if (!website) score += 4.5;
  else {
    if (isOutdated) score += 2.5;
    if (noMobile) score += 3.0;
    if (noSchema) score += 2.0;
    if (noChatbot) score += 1.5;
    if (noClickToCall) score += 1.5;
    if (aeoScore > 0 && aeoScore < 3) score += 1.5;
    if (!hasFB || !hasIG) score += 1.0;
    if ((cms === 'wix' || cms === 'squarespace') && noChatbot) score += 1.5;
    else if ((cms === 'shopify' || cms === 'webflow') && noChatbot) score += 1.0;
  }

  if (buyingSignals.length > 0) score += Math.min(2, buyingSignals.length * 0.5);
  if (reviews <= lowReviewsThreshold) score += 1.5;
  if (rating > 0 && rating < 4.2) score += 1.5;

  return Math.min(10, score);
}

function getUnifiedClientScore(lead, options) {
  const aiGap = getAiAuditGap10(lead);
  if (aiGap != null) return aiGap;
  return calculateClientOpportunityScore(lead || {}, options);
}

function gapBadgeClass(label) {
  const key = String(label || '').trim().toUpperCase();
  if (key === 'LOW REVIEWS') {
    return 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/20';
  }
  if (key === 'NO WEBSITE') {
    return 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20';
  }
  if (key === 'BAD SITE') {
    return 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-brand-yellow/10 dark:text-brand-yellow dark:border-brand-yellow/20';
  }
  if (key === 'WEAK SOCIAL') {
    return 'bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-300 dark:border-indigo-500/20';
  }
  if (key === 'SEO GAPS') {
    return 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/20';
  }
  return 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800/50 dark:text-slate-400 dark:border-white/5';
}

function scoreBadgeClass(score) {
  if (score >= 7) {
    return 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20';
  }
  if (score >= 4) {
    return 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-brand-yellow/10 dark:text-brand-yellow dark:border-brand-yellow/20';
  }
  return 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800/50 dark:text-slate-400 dark:border-white/5';
}

/**
 * @param {object} lead
 * @param {{ lowReviewsThreshold?: number, workspace?: object, maxLabels?: number }} [options]
 * @returns {{ score: number, gapLabels: string[], html: string }}
 */
function buildPipelineOpportunityBadge(lead, options) {
  const threshold =
    options && options.lowReviewsThreshold != null
      ? normalizeLowReviewsThreshold(options.lowReviewsThreshold)
      : getLowReviewsThresholdFromWorkspace(options && options.workspace);
  const scoreOpts = { ...(options || {}), lowReviewsThreshold: threshold };
  const score = getUnifiedClientScore(lead, scoreOpts);
  const gapLabels = computeProspectGapLabels(lead, {
    lowReviewsThreshold: threshold,
    maxLabels: (options && options.maxLabels) || 3,
  });
  const label = `${Math.round(score)}/10`;
  const gapHtml = gapLabels
    .map(
      (tag) =>
        `<span class="px-2 py-0.5 rounded-md ${gapBadgeClass(tag)} text-[8px] font-black border uppercase tracking-tight shadow-sm">${esc(tag)}</span>`,
    )
    .join('');
  const html = `<div class="flex flex-col items-center justify-center gap-1 py-0.5"><span class="px-2 py-0.5 rounded-md ${scoreBadgeClass(score)} text-[9px] font-black border tabular-nums tracking-tight shadow-sm">${esc(label)}</span>${
    gapHtml ? `<div class="flex flex-wrap gap-1 items-center justify-center max-w-[11rem]">${gapHtml}</div>` : ''
  }</div>`;
  return { score, gapLabels, html };
}

/** app.locals helper — returns HTML only. */
function renderPipelineOpportunityBadge(lead, options) {
  return buildPipelineOpportunityBadge(lead, options).html;
}

module.exports = {
  getAiAuditGap10,
  calculateClientOpportunityScore,
  getUnifiedClientScore,
  gapBadgeClass,
  buildPipelineOpportunityBadge,
  renderPipelineOpportunityBadge,
};
