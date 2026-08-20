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

function fallbackPersonalizedEmail(scriptText, snapshot) {
  const body = fallbackPersonalizedMessage(scriptText, snapshot);
  const company = snapshot.company || 'your business';
  const contact = snapshot.contact || 'there';
  const cityState = snapshot.cityState || 'your area';
  const filled =
    body ||
    `Hi ${contact},\n\nFollowing up after our call — a few ideas that could help ${company} in ${cityState} capture more local demand.\n\nOpen to a short next step this week?\n\nBest,\n[your name]`;
  return {
    subject: `Following up — ${company}`,
    body: filled,
  };
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

/**
 * @param {object} lead
 * @param {string} scriptText
 * @param {{ context?: 'cadence'|'outreach', subject?: string }} [opts]
 */
async function personalizeEmailForLead(lead, scriptText, opts = {}) {
  const base = String(scriptText || '').trim();
  if (!base) throw new Error('scriptText is required.');

  const snapshot = buildLeadSmsSnapshot(lead);
  const fallback = fallbackPersonalizedEmail(base, snapshot);
  const subjectHint = String(opts.subject || fallback.subject).trim();
  const contextNote =
    opts.context === 'cadence'
      ? 'This is a scheduled cadence email — keep it timely.'
      : 'This is a follow-up email after a phone call to selected leads. Personalize; do not send an identical blast.';

  const ai = await chatCompletion({
    messages: [
      {
        role: 'system',
        content: `You personalize outbound follow-up email for local-business sales.

Rules:
- Return JSON only: {"subject":"...","body":"..."}
- Plain text body, 80–170 words, no markdown bullets unless the script already has them.
- Use lead name, company, city/category when relevant.
- One clear CTA. Human, not spammy. Do not invent metrics.
- If the script already includes a real sender name, company, phone, or email, keep those. Otherwise you may leave [your name] / [your company] for the app to fill.
- ${contextNote}`,
      },
      {
        role: 'user',
        content: `Lead context:\n${JSON.stringify(snapshot)}\n\nSuggested subject:\n${subjectHint}\n\nBase script:\n${base}`,
      },
    ],
    jsonObject: true,
    max_tokens: 700,
    temperature: 0.45,
  });

  if (!ai.content || ai.error) {
    return { ...fallback, provider: 'fallback' };
  }

  const parsed = parseLlmJson(ai.content);
  const body = String((parsed && (parsed.body || parsed.message)) || '').trim();
  const subject = String((parsed && parsed.subject) || subjectHint).trim();
  if (!body) {
    return { ...fallback, provider: 'fallback' };
  }

  return {
    subject: (subject || fallback.subject).slice(0, 180),
    body: body.slice(0, 8000),
    provider: ai.provider || 'unknown',
  };
}

module.exports = {
  buildLeadSmsSnapshot,
  personalizeSmsForLead,
  personalizeEmailForLead,
  fallbackPersonalizedMessage,
  fallbackPersonalizedEmail,
};
