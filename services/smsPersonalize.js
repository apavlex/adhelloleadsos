/**
 * AI-personalized outbound SMS copy for a lead.
 */

const { chatCompletion, parseLlmJson } = require('./llmClient');

function buildLeadSmsSnapshot(lead) {
  const company = String(lead.title || 'your business').trim() || 'your business';
  const contact =
    String(lead.contactName || '').trim() ||
    (lead.email && lead.email !== 'N/A' ? String(lead.email).split('@')[0].replace(/[._]+/g, ' ') : '') ||
    'there';
  const cityState = [lead.city, lead.state].filter(Boolean).join(', ');
  const insight = lead.kieServiceInsight && typeof lead.kieServiceInsight === 'object' ? lead.kieServiceInsight : {};
  return {
    company,
    contact,
    cityState,
    category: lead.categoryName || '',
    rating: lead.totalScore || 0,
    reviewCount: lead.reviewsCount || 0,
    website: lead.website || '',
    primaryServiceLabel: insight.primaryServiceLabel || '',
    rationale: insight.rationale || '',
    talkTrack: insight.talkTrack || '',
    auditSummary: lead.auditSummary || '',
    buyingSignals: Array.isArray(lead.buyingSignals) ? lead.buyingSignals : [],
  };
}

function fallbackPersonalizedMessage(scriptText, snapshot) {
  const contact = snapshot.contact || 'there';
  const company = snapshot.company || 'your business';
  const cityState = snapshot.cityState || 'your area';
  return String(scriptText || '')
    .replace(/\{\{name\}\}/gi, contact)
    .replace(/\{\{company\}\}/gi, company)
    .replace(/\{\{city\}\}/gi, cityState)
    .replace(/\{\{business_name\}\}/gi, company)
    .trim();
}

/**
 * @param {object} lead
 * @param {string} scriptText — base script or cadence hint
 * @param {{ context?: 'cadence'|'outreach' }} [opts]
 */
async function personalizeSmsForLead(lead, scriptText, opts = {}) {
  const base = String(scriptText || '').trim();
  if (!base) throw new Error('scriptText is required.');

  const snapshot = buildLeadSmsSnapshot(lead);
  const contextNote =
    opts.context === 'cadence'
      ? 'This is a scheduled cadence text touch — keep it timely and reference the cadence intent.'
      : 'This is a one-off prospect outreach SMS.';

  const ai = await chatCompletion({
    messages: [
      {
        role: 'system',
        content: `You personalize outbound SMS for local-business sales.

Rules:
- Return JSON only: {"message":"..."}
- Keep message concise: target 280 chars, hard max 480 chars.
- Keep tone human, respectful, and non-spammy.
- Use specific lead context when relevant (city/category/reviews/offer fit).
- Include one clear CTA.
- Do not use markdown, bullet points, or emojis unless already present.
- If the script already includes a real sender name, company, phone, or email, keep those. Otherwise you may leave [your name] / [your company] for the app to fill.
- ${contextNote}`,
      },
      {
        role: 'user',
        content: `Lead context:\n${JSON.stringify(snapshot)}\n\nBase script or cadence note:\n${base}`,
      },
    ],
    jsonObject: true,
    max_tokens: 300,
    temperature: 0.45,
  });

  if (!ai.content || ai.error) {
    return {
      message: fallbackPersonalizedMessage(base, snapshot).slice(0, 480),
      provider: 'fallback',
    };
  }

  const parsed = parseLlmJson(ai.content);
  const personalized = String((parsed && parsed.message) || '').trim();
  if (!personalized) {
    throw new Error('AI did not return a message.');
  }

  return {
    message: personalized.slice(0, 480),
    provider: ai.provider || 'unknown',
  };
}

module.exports = {
  buildLeadSmsSnapshot,
  personalizeSmsForLead,
  fallbackPersonalizedMessage,
};
