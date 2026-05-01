const websiteAiAnalysis = require('./websiteAiAnalysis');

function resolveHealth100(analysis) {
  const a = analysis || {};
  if (a.siteHealth100 != null && Number.isFinite(Number(a.siteHealth100))) {
    return Math.min(100, Math.max(0, Math.round(Number(a.siteHealth100))));
  }
  const raw = Number(a.analysisScore || 0);
  if (raw > 10) return Math.min(100, Math.max(0, Math.round(raw)));
  if (raw > 0) return Math.min(100, Math.max(0, 100 - Math.round(raw) * 10));
  return 0;
}

function tierLabelForHealth(health) {
  const h = Number(health) || 0;
  if (h >= 85) return 'Strong';
  if (h >= 70) return 'Good';
  if (h >= 50) return 'Needs Work';
  if (h >= 35) return 'At Risk';
  return 'Critical';
}

/**
 * Token map for cadence copy (emails, voicemails, SMS). Pass baseUrl like https://host
 * so {{report_link}} is absolute when a signed token exists on sequenceState.
 */
function buildCadenceTokenMap(lead, opts = {}) {
  const baseUrl = String(opts.baseUrl || '').replace(/\/$/, '');
  const analysis = (lead && lead.aiWebsiteAnalysis) || {};
  const health = resolveHealth100(analysis);
  const tier = tierLabelForHealth(health);
  const gaps = websiteAiAnalysis.computeTopGapLabels(analysis, 3);
  const topFinding = gaps[0] || 'No headline crawl gap flagged yet — run AI analysis on the lead.';

  const domain = String((lead && lead.website) || '')
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .replace(/^www\./i, '');

  const st = (lead && lead.sequenceState) || {};
  const token = st.publicAuditToken ? String(st.publicAuditToken) : '';
  const reportLink =
    token && baseUrl ? `${baseUrl}/audit/report/${token}` : token ? `/audit/report/${token}` : '';

  const compName = String((lead && (lead.competitorName || lead.competitor_name)) || '').trim();
  const compGap = String((lead && (lead.competitorGap || lead.competitor_gap)) || '').trim();
  let competitorWithMeta = 'many nearby competitors already show a hand-written Google snippet';
  if (compName && compGap) {
    competitorWithMeta = `${compName} is stronger on ${compGap}`;
  } else if (compName) {
    competitorWithMeta = `${compName} is winning more of the same-ranking clicks`;
  }

  return {
    business_name: String((lead && lead.title) || 'your business').trim() || 'your business',
    domain: domain || 'your website',
    city: String((lead && lead.city) || '').trim() || 'your area',
    score: String(health),
    tier,
    top_finding: topFinding,
    competitor_with_meta_desc: competitorWithMeta,
    report_link: reportLink,
    calendly_or_book: String(process.env.ADHELLO_BOOK_URL || 'https://adhello.ai/book').trim(),
  };
}

function expandCadenceText(text, lead, opts = {}) {
  const map = buildCadenceTokenMap(lead, opts);
  const re = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;
  return String(text || '').replace(re, (_, key) => {
    const k = String(key || '').toLowerCase();
    const v = map[k];
    return v == null ? '' : String(v);
  });
}

module.exports = {
  buildCadenceTokenMap,
  expandCadenceText,
  resolveHealth100,
  tierLabelForHealth,
};
