/**
 * AI reputation summary (strengths / weaknesses) from review snippets + rating.
 */

const { chatCompletion, parseLlmJson } = require('./llmClient');

/**
 * @param {object} lead
 * @returns {Promise<{ intel: { strengths: string[], weaknesses: string[], sourceNote: string }, error?: string }|null>}
 */
async function generateReviewIntelForLead(lead) {
  if (!lead || typeof lead !== 'object') return null;

  const snippets = Array.isArray(lead.reviewSnippets) ? lead.reviewSnippets : [];
  const snapshot = {
    company: lead.title,
    category: lead.categoryName,
    city: lead.city,
    state: lead.state,
    mapsRating: lead.totalScore,
    reviewCount: lead.reviewsCount,
    auditSummary: lead.auditSummary || '',
    reviewSnippets: snippets,
  };

  const ai = await chatCompletion({
    messages: [
      {
        role: 'system',
        content: `You analyze local business reputation for agency sales. Input is JSON with optional verbatim customer quotes in reviewSnippets, star rating mapsRating (0-5), reviewCount, category, location, and auditSummary.

Rules:
- If reviewSnippets has one or more strings: derive strengths and weaknesses only from themes in those quotes plus rating/count. Do not invent incidents not supported by the quotes.
- If reviewSnippets is empty: infer plausible strengths and weaknesses from category, location, mapsRating, reviewCount, and auditSummary only. Use cautious wording ("Often…", "May…", "Typical risk…"). Do not claim you read specific reviews.

Return JSON only, no markdown:
{"strengths":["bullet 1",...],"weaknesses":["bullet 1",...],"sourceNote":"One sentence: cite verbatim snippets vs rating-only inference."}`,
      },
      {
        role: 'user',
        content: JSON.stringify(snapshot),
      },
    ],
    jsonObject: true,
    max_tokens: 800,
    temperature: 0.35,
  });

  if (!ai.content || ai.error) {
    return {
      error: 'No AI provider configured (set OPENROUTER_API_KEY) or request failed.',
    };
  }

  const parsed = parseLlmJson(ai.content);
  if (!parsed) {
    return { error: 'Invalid AI response' };
  }

  const intel = {
    strengths: Array.isArray(parsed.strengths)
      ? parsed.strengths.map((s) => String(s || '').trim()).filter(Boolean)
      : [],
    weaknesses: Array.isArray(parsed.weaknesses)
      ? parsed.weaknesses.map((s) => String(s || '').trim()).filter(Boolean)
      : [],
    sourceNote: typeof parsed.sourceNote === 'string' ? parsed.sourceNote.trim() : '',
  };

  return { intel };
}

module.exports = {
  generateReviewIntelForLead,
};
