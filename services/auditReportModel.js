const websiteAiAnalysis = require('./websiteAiAnalysis');

const TIER = {
  strong: { label: 'STRONG', min: 85, arc: '#22c55e', pill: '#22c55e' },
  good: { label: 'GOOD', min: 70, arc: '#84cc16', pill: '#84cc16' },
  needs: { label: 'NEEDS WORK', min: 50, arc: '#f97316', pill: '#f97316' },
  weak: { label: 'AT RISK', min: 35, arc: '#eab308', pill: '#eab308' },
  critical: { label: 'CRITICAL', min: 0, arc: '#ef4444', pill: '#ef4444' },
};

function tierForHealth(health) {
  const h = Number(health) || 0;
  if (h >= 85) return TIER.strong;
  if (h >= 70) return TIER.good;
  if (h >= 50) return TIER.needs;
  if (h >= 35) return TIER.weak;
  return TIER.critical;
}

function slugifyFilename(name) {
  return String(name || 'business')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'business';
}

/** Category scores for PDF bars (derived from crawl + lead; not a third-party API). */
function computeCategoryBreakdown(analysis, lead) {
  const a = analysis || {};
  const flags = a.flags || {};
  const meta = String(a.metaDescription || '').trim();
  const title = String(a.pageTitle || '').trim();
  const hasCta = Array.isArray(a.signals) && a.signals.length > 0;
  const hasContact = (Array.isArray(a.emails) && a.emails.length) || (Array.isArray(a.phones) && a.phones.length);
  const cy = parseInt(String(a.copyrightYear || '').trim(), 10);
  const nowY = new Date().getFullYear();
  const load = Number(a.pageLoadSeconds || 0);
  const rev = Number((lead && lead.reviewsCount) || 0);

  let find = 0;
  if (title.length >= 2) find += 8;
  else find += 2;
  if (meta) find += 10;
  if (a.hasHttps) find += 7;

  let conv = 0;
  if (hasCta) conv += 15;
  else conv += 2;
  if (hasContact) conv += 10;
  else conv += 2;

  let trust = 0;
  if (Number.isFinite(cy) && cy >= nowY - 1) trust += 8;
  else if (Number.isFinite(cy)) trust += 3;
  else trust += 4;
  if (a.hasHttps) trust += 6;
  if (rev >= 20) trust += 6;
  else if (rev >= 5) trust += 4;
  else if (rev > 0) trust += 2;
  else trust += 1;

  let perf = 0;
  if (load > 0 && load <= 2.5) perf += 12;
  else if (load <= 5) perf += 8;
  else if (load <= 8) perf += 4;
  else perf += 1;
  if (a.mobileResponsive) perf += 8;
  else perf += 2;

  let tech = 0;
  if (!flags.returned404) tech += 5;
  if (!flags.noSsl) tech += 3;
  if (!flags.slowLoad) tech += 2;

  const rows = [
    { key: 'findability', name: 'Findability', score: Math.round(Math.min(25, find)), max: 25 },
    { key: 'conversion', name: 'Conversion', score: Math.round(Math.min(25, conv)), max: 25 },
    { key: 'trust', name: 'Trust', score: Math.round(Math.min(20, trust)), max: 20 },
    { key: 'performance', name: 'Performance', score: Math.round(Math.min(20, perf)), max: 20 },
    { key: 'technical', name: 'Technical', score: Math.round(Math.min(10, tech)), max: 10 },
  ];
  for (const r of rows) {
    r.pct = r.max ? Math.round((100 * r.score) / r.max) : 0;
    const ratio = r.max ? r.score / r.max : 1;
    r.barColor = ratio >= 0.75 ? '#22c55e' : ratio >= 0.55 ? '#84cc16' : ratio >= 0.4 ? '#eab308' : ratio >= 0.25 ? '#f97316' : '#ef4444';
  }
  return rows;
}

const IMPACT_BY_GAP = {
  'Meta description':
    'Google is auto-generating snippets in search results, which often lowers click-through compared to listings with a hand-written line.',
  'HTTPS / SSL':
    'Browsers flag insecure pages; that friction costs calls before visitors read your offer.',
  'Homepage availability (404)':
    'Prospects who hit a dead homepage assume you are closed or hard to reach.',
  'Homepage load speed':
    'Slow first paint means mobile visitors bounce before they see your pitch.',
  'Mobile viewport / responsiveness':
    'Without a proper mobile layout, tap-to-call and forms underperform on phones.',
  'Copyright / freshness signal':
    'An outdated year signals low maintenance and quietly erodes trust.',
  'Above-the-fold call to action':
    'Visitors land but are not being asked to take a clear next step, so ready buyers drift to competitors.',
  'Page title strength':
    'Weak titles dilute relevance in tabs, bookmarks, and search snippets.',
  'Visible contact info':
    'Hidden or missing contact paths add friction when someone is ready to call.',
  'No major crawl gaps flagged':
    'Fine-tuning copy and offers can still unlock calls competitors are winning.',
  'Valid public website URL':
    'No crawlable site was attached, so search and AI assistants have nowhere to send intent.',
  'General homepage polish':
    'Small clarity and trust upgrades compound — tightening copy, proof, and navigation often lifts calls without a full redesign.',
};

const TIME_BY_GAP = {
  'Meta description': '30 min fix',
  'HTTPS / SSL': '1–2 hours',
  'Homepage availability (404)': 'Same day',
  'Homepage load speed': '1–3 hours',
  'Mobile viewport / responsiveness': '2–4 hours',
  'Copyright / freshness signal': '30 min fix',
  'Above-the-fold call to action': '1–2 hours',
  'Page title strength': '15 min fix',
  'Visible contact info': '30 min fix',
  'No major crawl gaps flagged': 'Strategy call',
  'Valid public website URL': 'Setup',
  'General homepage polish': '1–2 hours',
};

const HOOK_BY_KEY = {
  findability:
    'Your findability layer is the softest part of this scan — search snippets and on-page signals are not doing enough of the selling for you.',
  conversion:
    'Your conversion score is the weakest area — visitors are landing but are not being nudged toward a clear next step.',
  trust: 'Trust signals trail the rest of the picture — small credibility gaps compound into fewer booked calls.',
  performance:
    'Performance is holding you back — speed and mobile polish determine whether people wait long enough to read your offer.',
  technical:
    'Technical hygiene needs attention first — broken or insecure experiences lose leads before copy even matters.',
};

function pickWeakestCategory(categories) {
  let worst = categories[0];
  let worstRatio = 2;
  for (const c of categories) {
    const r = c.max ? c.score / c.max : 1;
    if (r < worstRatio) {
      worstRatio = r;
      worst = c;
    }
  }
  return worst;
}

function buildPrioritiesFromGaps(analysis) {
  const pool =
    Array.isArray(analysis && analysis.topGapLabels) && analysis.topGapLabels.length
      ? [...analysis.topGapLabels]
      : websiteAiAnalysis.computeTopGapLabels(analysis || {}, 6);
  const seen = new Set();
  const labels = [];
  for (const x of pool) {
    if (!x || seen.has(x)) continue;
    seen.add(x);
    labels.push(x);
    if (labels.length >= 3) break;
  }
  if (labels.length < 3) {
    for (const x of websiteAiAnalysis.computeTopGapLabels(analysis || {}, 8)) {
      if (!x || seen.has(x)) continue;
      seen.add(x);
      labels.push(x);
      if (labels.length >= 3) break;
    }
  }
  while (labels.length < 3) labels.push('General homepage polish');
  return labels.slice(0, 3).map((title, i) => ({
    n: i + 1,
    title,
    impact: IMPACT_BY_GAP[title] || 'This gap quietly costs you qualified traffic and calls compared to sharper local listings.',
    timeLabel: TIME_BY_GAP[title] || '1–2 hours',
  }));
}

function quickStatsRows(analysis, lead) {
  const a = analysis || {};
  const flags = a.flags || {};
  const meta = String(a.metaDescription || '').trim();
  const title = String(a.pageTitle || '').trim();
  const cy = String(a.copyrightYear || '').trim();
  const nowY = new Date().getFullYear();
  const cyNum = parseInt(cy, 10);
  let copyrightVal = '—';
  if (cy) {
    copyrightVal =
      Number.isFinite(cyNum) && cyNum < nowY - 1 ? `⚠️ Outdated (${cy})` : `✅ ${cy}`;
  }
  const primaryEmail = websiteAiAnalysis.pickPrimaryEmail(a.emails || []);
  const phone = (a.phones && a.phones[0]) || (lead && lead.phone) || '';
  const contactLine = [primaryEmail, phone].filter(Boolean).join(' · ') || '—';

  const titleOk = title.length > 1;
  return [
    { label: 'HTTPS Secure', value: a.hasHttps ? '✅ Yes' : '❌ No' },
    { label: 'Mobile Responsive', value: a.mobileResponsive ? '✅ Yes' : '❌ No' },
    {
      label: 'Broken Links',
      value: flags.returned404 ? '❌ Homepage 404' : '✅ None detected',
    },
    { label: 'Page Title', value: titleOk ? '✅ Present' : '❌ Missing or weak' },
    { label: 'Meta Description', value: meta ? '✅ Present' : '❌ Missing' },
    { label: 'Copyright Year', value: copyrightVal },
    {
      label: 'Visible CTA',
      value: (a.signals || []).length ? `✅ ${(a.signals || []).join(', ')}` : '❌ Not detected',
    },
    { label: 'Primary Contact', value: contactLine },
  ];
}

/**
 * View model for hosted HTML + PDF (same template).
 * @param {object} lead
 * @param {object} analysis aiWebsiteAnalysis
 * @param {object} opts { baseUrl }
 */
function buildAuditReportViewModel(lead, analysis, opts) {
  const baseUrl = String((opts && opts.baseUrl) || '').replace(/\/$/, '');
  const health = Number(analysis && analysis.siteHealth100);
  const health100 = Number.isFinite(health)
    ? Math.min(100, Math.max(0, Math.round(health)))
    : (() => {
        const raw = Number((analysis && analysis.analysisScore) || 0);
        if (raw > 10) return Math.min(100, Math.max(0, Math.round(raw)));
        if (raw > 0) return Math.min(100, Math.max(0, 100 - Math.round(raw) * 10));
        return 0;
      })();

  const tier = tierForHealth(health100);
  const categories = computeCategoryBreakdown(analysis, lead);
  const weakest = pickWeakestCategory(categories);
  const hookItalic =
    HOOK_BY_KEY[weakest.key] ||
    'Your site is costing you leads that competitors are capturing. The good news: the top issues are quick fixes.';

  const auditedIso =
    (analysis && analysis.auditedAt) || (lead && lead.aiWebsiteAnalysisUpdatedAt) || new Date().toISOString();
  const auditedDate = new Date(auditedIso);
  const auditDateFormatted = Number.isNaN(auditedDate.getTime())
    ? ''
    : auditedDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const domain = String((lead && lead.website) || '')
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .replace(/^www\./i, '');

  const businessName = String((lead && lead.title) || 'Business').trim() || 'Business';
  const slug = slugifyFilename(businessName);
  const dateSlug = Number.isNaN(auditedDate.getTime())
    ? new Date().toISOString().slice(0, 10)
    : auditedDate.toISOString().slice(0, 10);
  const pdfFilename = `${slug}-website-audit-${dateSlug}.pdf`;

  const bookUrl = String(process.env.ADHELLO_BOOK_URL || 'https://adhello.ai/book').trim();
  const salesPhone = String(process.env.ADHELLO_SALES_PHONE || '').trim();
  const methodologyUrl = String(
    process.env.ADHELLO_METHODOLOGY_URL || 'https://adhello.ai/audit-methodology',
  ).trim();

  const gaugePct = health100;
  const gaugeR = 78;
  const gaugeCirc = 2 * Math.PI * gaugeR;
  const gaugeSweep = 0.72;
  const gaugeDash = (health100 / 100) * gaugeSweep * gaugeCirc;

  return {
    businessName,
    domain: domain || '—',
    auditDateFormatted,
    auditedIso,
    score: health100,
    tierLabel: tier.label,
    tierArcColor: tier.arc,
    tierPillColor: tier.pill,
    hookItalic,
    categories,
    priorities: buildPrioritiesFromGaps(analysis),
    quickStats: quickStatsRows(analysis, lead),
    rubricVersion: (analysis && analysis.rubricVersion) || websiteAiAnalysis.AUDIT_RUBRIC_VERSION,
    bookUrl,
    salesPhone,
    methodologyUrl,
    baseUrl,
    pdfFilename,
    gaugePct,
    gaugeR,
    gaugeCirc,
    gaugeDash,
    prior: analysis && analysis.priorAuditSnapshot,
  };
}

module.exports = {
  buildAuditReportViewModel,
  computeCategoryBreakdown,
  tierForHealth,
};
