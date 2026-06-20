/**
 * GEO/SEO website audit + GoHighLevel tool recommendations for agency sales.
 * Uses the cheap OpenRouter audit chain (free → deepseek-v4-flash).
 */

const { auditChatCompletion, parseLlmJson } = require('./llmClient');
const { catalogForPrompt, toolById } = require('./ghlToolsCatalog');
const { SCRIPT_LIBRARY, SCRIPT_LIBRARY_KEYS } = require('./salesConstants');

const SYSTEM_PROMPT = `You are a senior local SEO / GEO strategist and GoHighLevel (GHL) agency seller.
Analyze the business snapshot and return ONLY valid JSON (no markdown) with this exact shape:

{
  "overallScore": <integer 0-100>,
  "grade": <"A+"|"A"|"B"|"C"|"D"|"F">,
  "headline": "<one sentence executive summary for the owner>",
  "geoSeoScore": <integer 0-100 — local + organic findability>,
  "conversionScore": <integer 0-100 — site turns visitors into calls/forms>,
  "gaps": [
    {
      "area": "<Local SEO|Technical SEO|GEO/AI Visibility|Reviews|Conversion|Content>",
      "severity": "<high|medium|low>",
      "finding": "<specific gap tied to data>",
      "impact": "<business impact in plain English>"
    }
  ],
  "quickWins": ["<actionable win>", "<win 2>", "<win 3>"],
  "agencyOffer": {
    "primaryServiceKey": "<exactly one of: ${SCRIPT_LIBRARY_KEYS.join(', ')}>",
    "primaryServiceLabel": "<label from catalog>",
    "rationale": "<2-3 sentences why this is the first retainer to sell>",
    "talkTrack": "<one conversational opener sentence>"
  },
  "ghlRecommendations": [
    {
      "toolId": "<id from GHL catalog below>",
      "toolName": "<GHL tool name>",
      "priority": <1-5, 1 = sell first>,
      "why": "<why this GHL tool fixes their gap>",
      "whatToSell": "<2 sentences: what you implement in GHL and outcome for owner>",
      "setupEffort": "<low|medium|high>"
    }
  ],
  "thirtyDayPlan": [
    { "week": 1, "action": "<specific task>", "ghlTool": "<tool name>" },
    { "week": 2, "action": "...", "ghlTool": "..." },
    { "week": 3, "action": "...", "ghlTool": "..." },
    { "week": 4, "action": "...", "ghlTool": "..." }
  ]
}

Rules:
- gaps: 4-6 items, severity honest based on data (missing HTTPS/mobile/schema/reviews = high).
- ghlRecommendations: exactly 4-6 items; toolId MUST match the GHL catalog ids exactly.
- Map each major gap to at least one GHL tool recommendation.
- agencyOffer.primaryServiceKey MUST be one of the agency catalog keys.
- Grade: 95+ A+, 85-94 A, 70-84 B, 55-69 C, 40-54 D, <40 F.
- Tone: direct, owner-friendly, sales-ready — this report is shown to reps before a call.
- If data is sparse, score conservatively and say what to verify on a discovery call.

Agency service catalog:
${Object.entries(SCRIPT_LIBRARY)
  .map(([id, s]) => `- ${id}: ${s.label}`)
  .join('\n')}

GoHighLevel tools catalog (toolId must match):
${catalogForPrompt()}`;

function buildLeadSnapshot(lead) {
  const l = lead || {};
  const a = l.aiWebsiteAnalysis && typeof l.aiWebsiteAnalysis === 'object' ? l.aiWebsiteAnalysis : {};
  const ps = l.pageSpeedAudit && typeof l.pageSpeedAudit === 'object' ? l.pageSpeedAudit : {};
  return {
    businessName: String(l.title || l.companyName || 'Business').trim(),
    category: String(l.categoryName || l.category || '').trim(),
    city: String(l.city || '').trim(),
    state: String(l.state || '').trim(),
    address: String(l.address || '').trim(),
    website: String(l.website || l.url || '').trim(),
    phone: String(l.phone || '').trim(),
    mapsRating: l.totalScore ?? l.rating ?? null,
    reviewCount: l.reviewsCount ?? l.reviews ?? null,
    geoGaps: String(l.geoGaps || '').trim() || null,
    aeoScore: l.aeoScore ?? null,
    auditSummary: String(l.auditSummary || '').trim() || null,
    siteHealth100: a.siteHealth100 ?? null,
    analysisScore: a.analysisScore ?? null,
    topGapLabels: Array.isArray(a.topGapLabels) ? a.topGapLabels.slice(0, 8) : [],
    pageTitle: a.pageTitle || '',
    metaDescription: a.metaDescription || '',
    signals: Array.isArray(a.signals) ? a.signals : [],
    flags: a.flags || {},
    pageLoadSeconds: a.pageLoadSeconds ?? null,
    pageSpeed: {
      average: ps.averageScore ?? null,
      seo: ps.scores?.seo ?? ps.seo ?? null,
      performance: ps.scores?.performance ?? ps.performance ?? null,
      topIssues: Array.isArray(ps.topIssues) ? ps.topIssues.slice(0, 5) : [],
    },
    enrichment: {
      hasSchemaMarkup: l.hasSchemaMarkup,
      hasChatbot: l.hasChatbot,
      hasClickToCall: l.hasClickToCall,
      isMobileFriendly: l.isMobileFriendly,
      isOutdated: l.isOutdated,
      cmsPlatform: l.cmsPlatform || null,
    },
    reviewIntel: l.reviewIntel && typeof l.reviewIntel === 'object' ? l.reviewIntel : null,
  };
}

function gradeFromScore(score) {
  const s = parseInt(score, 10) || 0;
  if (s >= 95) return 'A+';
  if (s >= 85) return 'A';
  if (s >= 70) return 'B';
  if (s >= 55) return 'C';
  if (s >= 40) return 'D';
  return 'F';
}

function buildHeuristicReport(lead) {
  const snap = buildLeadSnapshot(lead);
  const gaps = [];
  const top = snap.topGapLabels.length ? snap.topGapLabels : snap.pageSpeed.topIssues;

  if (snap.flags?.noSsl) {
    gaps.push({
      area: 'Technical SEO',
      severity: 'high',
      finding: 'Site may not use HTTPS everywhere.',
      impact: 'Trust and rankings suffer; browsers warn visitors away.',
    });
  }
  if (snap.enrichment.isMobileFriendly === false) {
    gaps.push({
      area: 'Technical SEO',
      severity: 'high',
      finding: 'Mobile experience is weak or not mobile-friendly.',
      impact: 'Most local searches happen on phones — you lose calls before they dial.',
    });
  }
  if (!snap.enrichment.hasSchemaMarkup) {
    gaps.push({
      area: 'GEO/AI Visibility',
      severity: 'medium',
      finding: 'No structured data detected for local business signals.',
      impact: 'Harder for Google and AI assistants to cite you confidently.',
    });
  }
  if (parseInt(snap.reviewCount, 10) < 15) {
    gaps.push({
      area: 'Reviews',
      severity: 'medium',
      finding: `Only ${snap.reviewCount || 0} reviews on file — thin social proof.`,
      impact: 'Competitors with more reviews win map pack clicks.',
    });
  }
  if (top[0]) {
    gaps.push({
      area: 'Conversion',
      severity: 'medium',
      finding: top[0],
      impact: 'Paid and organic traffic leaks before it becomes a booked job.',
    });
  }
  if (!gaps.length) {
    gaps.push({
      area: 'Local SEO',
      severity: 'low',
      finding: 'Baseline site signals look acceptable — optimization opportunity is incremental.',
      impact: 'Competitors still outrank you on content depth and review velocity.',
    });
  }

  const ghlPick = (id, priority, why, whatToSell) => {
    const t = toolById(id);
    return {
      toolId: id,
      toolName: t ? t.name : id,
      priority,
      why,
      whatToSell,
      setupEffort: priority <= 2 ? 'medium' : 'low',
    };
  };

  const ghlRecs = [
    ghlPick(
      'listings_seo',
      1,
      'Local findability drives most service calls in ' + (snap.city || 'this market') + '.',
      'We sync listings, tighten NAP, and wire form tracking in GHL so you see which channels book jobs.',
    ),
    ghlPick(
      'reputation_management',
      2,
      'Review count and velocity affect map pack and buyer trust.',
      'Automated post-job review SMS in GHL builds stars without chasing customers manually.',
    ),
    ghlPick(
      'websites_funnels',
      3,
      top[0] ? `Site gap: ${top[0]}` : 'Conversion pages need clearer CTAs and speed.',
      'We deploy a fast landing page with click-to-call and GHL form tracking on your sub-account.',
    ),
    ghlPick(
      'workflows_automation',
      4,
      'Leads go cold when follow-up is manual.',
      'GHL workflows text back missed calls and nurture quotes until they book or opt out.',
    ),
  ];

  const score = Math.max(
    35,
    Math.min(
      88,
      (snap.siteHealth100 || 55) -
        (snap.flags?.noSsl ? 15 : 0) -
        (snap.enrichment.isMobileFriendly === false ? 12 : 0) -
        (parseInt(snap.reviewCount, 10) < 10 ? 8 : 0),
    ),
  );

  return {
    overallScore: score,
    grade: gradeFromScore(score),
    headline: `${snap.businessName} has room to capture more local demand with stronger GEO signals and GHL-powered follow-up.`,
    geoSeoScore: Math.max(30, score - 5),
    conversionScore: Math.max(25, (snap.siteHealth100 || 50) - 10),
    gaps: gaps.slice(0, 6),
    quickWins: [
      'Add click-to-call and a tracked quote form above the fold.',
      'Turn on automated review requests after every completed job.',
      'Publish 3 FAQ pages targeting your top service + city keywords.',
    ],
    agencyOffer: {
      primaryServiceKey: 'aiWebsites',
      primaryServiceLabel: SCRIPT_LIBRARY.aiWebsites?.label || 'AI Website / Conversion',
      rationale:
        'Website and conversion gaps are the fastest path to measurable lift before a full SEO retainer.',
      talkTrack: `I ran a quick GEO/SEO pass on ${snap.businessName} — want to walk through what we would fix first in GoHighLevel?`,
    },
    ghlRecommendations: ghlRecs,
    thirtyDayPlan: [
      { week: 1, action: 'Audit GBP, listings, and site tracking', ghlTool: 'Listings & Local SEO' },
      { week: 2, action: 'Launch review request automation', ghlTool: 'Reputation Management' },
      { week: 3, action: 'Ship conversion landing page + forms', ghlTool: 'Websites & Funnels' },
      { week: 4, action: 'Enable missed-call text-back and nurture', ghlTool: 'Workflows & Automations' },
    ],
    source: 'heuristic',
    generatedAt: new Date().toISOString(),
  };
}

function normalizeReport(raw, meta = {}) {
  const base = buildHeuristicReport({});
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = {
    overallScore: parseInt(r.overallScore, 10) || base.overallScore,
    grade: r.grade || gradeFromScore(r.overallScore),
    headline: String(r.headline || base.headline).trim(),
    geoSeoScore: parseInt(r.geoSeoScore, 10) || base.geoSeoScore,
    conversionScore: parseInt(r.conversionScore, 10) || base.conversionScore,
    gaps: Array.isArray(r.gaps) && r.gaps.length ? r.gaps.slice(0, 8) : base.gaps,
    quickWins: Array.isArray(r.quickWins) && r.quickWins.length ? r.quickWins.slice(0, 6) : base.quickWins,
    agencyOffer: { ...base.agencyOffer, ...(r.agencyOffer || {}) },
    ghlRecommendations: Array.isArray(r.ghlRecommendations) ? r.ghlRecommendations.slice(0, 8) : base.ghlRecommendations,
    thirtyDayPlan: Array.isArray(r.thirtyDayPlan) ? r.thirtyDayPlan.slice(0, 4) : base.thirtyDayPlan,
    source: meta.source || 'openrouter',
    model: meta.model || null,
    provider: meta.provider || null,
    generatedAt: new Date().toISOString(),
  };

  out.ghlRecommendations = out.ghlRecommendations.map((rec, i) => {
    const id = String(rec.toolId || '').trim();
    const known = toolById(id);
    return {
      toolId: id || `tool_${i + 1}`,
      toolName: String(rec.toolName || (known && known.name) || 'GHL Tool').trim(),
      priority: parseInt(rec.priority, 10) || i + 1,
      why: String(rec.why || '').trim(),
      whatToSell: String(rec.whatToSell || '').trim(),
      setupEffort: ['low', 'medium', 'high'].includes(rec.setupEffort) ? rec.setupEffort : 'medium',
    };
  });

  const key = String(out.agencyOffer.primaryServiceKey || '').trim();
  if (!SCRIPT_LIBRARY_KEYS.includes(key)) {
    out.agencyOffer.primaryServiceKey = base.agencyOffer.primaryServiceKey;
  }
  if (SCRIPT_LIBRARY[out.agencyOffer.primaryServiceKey]) {
    out.agencyOffer.primaryServiceLabel = SCRIPT_LIBRARY[out.agencyOffer.primaryServiceKey].label;
  }

  return out;
}

async function generateGeoSeoGhlReport(lead) {
  const snapshot = buildLeadSnapshot(lead);
  const { content, provider, model, error } = await auditChatCompletion({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Analyze this business for GEO/SEO and recommend GHL tools to sell:\n${JSON.stringify(snapshot, null, 2)}` },
    ],
    jsonObject: true,
    max_tokens: 2200,
    temperature: 0.25,
  });

  if (error || !content) {
    const fallback = buildHeuristicReport(lead);
    fallback.source = 'heuristic';
    fallback.provider = provider || 'none';
    fallback.aiUnavailable = true;
    return fallback;
  }

  const parsed = parseLlmJson(content) || (() => {
    try {
      return JSON.parse(content);
    } catch {
      return null;
    }
  })();

  if (!parsed || typeof parsed.overallScore !== 'number') {
    const fallback = buildHeuristicReport(lead);
    fallback.source = 'heuristic';
    fallback.aiUnavailable = true;
    return fallback;
  }

  return normalizeReport(parsed, { source: 'openrouter', provider, model });
}

module.exports = {
  buildLeadSnapshot,
  buildHeuristicReport,
  normalizeReport,
  generateGeoSeoGhlReport,
};
