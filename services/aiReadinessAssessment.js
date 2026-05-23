/**
 * AI Readiness Assessment
 *
 * Analyzes a lead's website + enrichment data to produce an "AI Readiness" score
 * that shows how visible / competitive the business is in the AI-search era.
 *
 * Score 0–100 with category breakdowns:
 *   - Technical Foundation  (HTTPS, mobile, speed, uptime)
 *   - Content & SEO Signals (meta, schema, freshness, signals)
 *   - AI Search Readiness  (structured data, FAQ, review richness, NAP consistency)
 *   - Conversion Layer     (CTA, chatbot, click-to-call, forms)
 *
 * The free inline result is a summary. The CTA promotes the $1,000 full assessment.
 */

const { chatCompletion } = require('./llmClient');

const SYSTEM_PROMPT = `You are a senior digital strategist auditing local businesses for "AI Readiness" — how well their website and digital presence positions them to be found and recommended by AI search engines (ChatGPT, Gemini, Perplexity, AI Overviews) and modern local SEO.

You will receive a JSON object with the business's current website audit data and enrichment fields. Analyze it and return a JSON response with this exact shape:

{
  "overallScore": <number 0-100>,
  "grade": <"A+"|"A"|"B"|"C"|"D"|"F">,
  "headline": "<one sentence summary, e.g. 'This business has a solid technical foundation but is invisible to AI search engines due to missing structured data.'>",
  "categories": [
    {
      "name": "Technical Foundation",
      "score": <0-100>,
      "icon": "shield",
      "findings": ["<concise finding 1>", "<finding 2>"]
    },
    {
      "name": "Content & SEO Signals",
      "score": <0-100>,
      "icon": "search",
      "findings": ["<finding 1>", "<finding 2>"]
    },
    {
      "name": "AI Search Readiness",
      "score": <0-100>,
      "icon": "sparkles",
      "findings": ["<finding 1>", "<finding 2>"]
    },
    {
      "name": "Conversion Layer",
      "score": <0-100>,
      "icon": "cursor",
      "findings": ["<finding 1>", "<finding 2>"]
    }
  ],
  "topRisk": "<the single biggest risk to their AI visibility — one sentence>",
  "quickWins": ["<actionable win 1>", "<actionable win 2>", "<actionable win 3>"],
  "fullAssessmentCTA": "<one sentence pitching a comprehensive $1,000 AI Readiness Blueprint — what they'd get: competitive benchmark, AI citation audit, structured data roadmap, content Gap analysis, 30-day action plan, and a private strategy call>"
}

Rules:
- Scores must be integers 0–100.
- Each category must have exactly 2–3 findings, concise (under 15 words each).
- Base scores on the actual data provided — penalize hard for missing critical signals (no HTTPS, no mobile, no schema, no SSL, 404s, slow load times).
- Reward strongly for: HTTPS, fast load, mobile-friendly, schema markup, review volume, fresh content year, clear CTAs.
- The tone of findings should be direct but constructive — speak to a business owner, not a developer.
- If audit data is sparse or missing, score conservatively and note the gap in findings.
- Grade mapping: 95+ = A+, 85-94 = A, 70-84 = B, 55-69 = C, 40-54 = D, <40 = F.
`;

function buildLeadContext(lead, analysis) {
  const l = lead || {};
  const a = analysis || {};

  return {
    businessName: l.title || l.companyName || 'Unknown',
    category: l.categoryName || l.category || '',
    website: l.website || l.url || '',
    phone: l.phone || '',
    email: l.email || '',
    address: l.address || l.formattedAddress || '',
    rating: l.ratings || l.rating || null,
    reviewCount: l.reviewsCount || l.reviews || null,
    // Technical
    hasHttps: a.flags ? !a.flags.noSsl : undefined,
    isMobileFriendly: a.isMobileFriendly,
    pageLoadSeconds: a.pageLoadSeconds || null,
    returned404: a.flags ? !!a.flags.returned404 : undefined,
    // Content
    hasMetaDescription: !!(a.metaDescription && String(a.metaDescription).trim()),
    metaDescription: a.metaDescription || '',
    pageTitle: a.pageTitle || '',
    copyrightYear: a.copyrightYear || null,
    // Signals
    signals: a.signals || [],
    hasSchemaMarkup: undefined, // will be filled by caller from lead fields
    hasChatbot: undefined,
    hasClickToCall: undefined,
    isOutdated: undefined,
    // Score
    siteHealth100: a.siteHealth100 || null,
    analysisScore: a.analysisScore || null,
  };
}

async function assessLead(lead, enrichmentData = {}) {
  const analysis = lead.aiWebsiteAnalysis || {};
  const ctx = buildLeadContext(lead, analysis);

  // Fill dataset-level fields that aren't in the analysis object
  ctx.hasSchemaMarkup = enrichmentData.hasSchemaMarkup;
  ctx.hasChatbot = enrichmentData.hasChatbot;
  ctx.hasClickToCall = enrichmentData.hasClickToCall;
  ctx.isOutdated = enrichmentData.isOutdated;

  const userMessage = `Analyze this business for AI Readiness:\n${JSON.stringify(ctx, null, 2)}`;

  const { content, error } = await chatCompletion({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
    jsonObject: true,
    max_tokens: 1200,
    temperature: 0.3,
  });

  if (error || !content) {
    return null;
  }

  try {
    const parsed = JSON.parse(content);
    // Validate shape
    if (!parsed || typeof parsed.overallScore !== 'number') {
      console.warn('[aiReadinessAssessment] LLM returned invalid shape');
      return null;
    }
    return parsed;
  } catch (e) {
    console.warn('[aiReadinessAssessment] JSON parse failed:', e.message, content.slice(0, 200));
    return null;
  }
}

module.exports = { assessLead };
