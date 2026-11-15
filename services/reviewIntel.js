/**
 * AI reputation summary from Google review snippets + rating (OpenRouter).
 * Summaries are customer-facing (Google listing style) — never sales coaching.
 */

const { chatCompletion, parseLlmJson } = require('./llmClient');

/**
 * Strip sales-coaching sentences so public directory copy stays visitor-facing.
 * Safe for already-stored intel that was generated with the old sales-rep prompt.
 * @param {string} text
 * @param {number} [maxLen]
 * @returns {string}
 */
function toPublicReviewSummary(text, maxLen = 800) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  // Reject LLM placeholder leakage from the JSON schema example.
  if (/^paragraph\s*text\.?$/i.test(raw)) return '';
  const salesy =
    /\b(sales angle|sales conversation|good sales|cold\s*-?\s*call|outreach angle|talking point|when you (?:call|pitch|reach out)|pitch (?:them|the owner)|use (?:this|their|the).{0,60}\bto (?:discuss|sell|pitch|close|attract more))\b/i;
  const parts = raw.split(/(?<=[.!?])\s+/).map((p) => p.trim()).filter(Boolean);
  const kept = parts.filter((p) => !salesy.test(p));
  let out = (kept.length ? kept : parts).join(' ').trim();
  if (salesy.test(out)) {
    out = out
      .replace(
        /(?:^|[.!?]\s*)[^.!?]*(?:sales angle|sales conversation|good sales|cold\s*-?\s*call|outreach angle|talking point)[^.!?]*[.!?]?/gi,
        ' ',
      )
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
  if (/^paragraph\s*text\.?$/i.test(out)) return '';
  if (out.length > maxLen) out = `${out.slice(0, Math.max(0, maxLen - 1)).trim()}…`;
  return out;
}

/**
 * Clean hunt-format snippets for public display (drop [Highest rated] labels).
 * @param {string} text
 * @param {number} [maxLen]
 * @returns {string}
 */
function toPublicReviewSnippet(text, maxLen = 400) {
  let s = String(text || '').trim();
  if (!s) return '';
  s = s.replace(/^\[(?:Highest|Lowest)\s+rated\]\s*/i, '');
  const quoted = s.match(
    /^(?:\d+(?:\.\d+)?\s*★\s*[—\-–]\s*)?(?:([^:]{1,80}):\s*)?[“"'‘](.+)[”"'’]\s*$/s,
  );
  if (quoted) {
    const author = String(quoted[1] || '').trim();
    const body = String(quoted[2] || '').trim();
    s = author ? `${author}: ${body}` : body;
  }
  if (s.length > maxLen) s = `${s.slice(0, Math.max(0, maxLen - 1)).trim()}…`;
  return s;
}

/**
 * @param {object} lead
 * @returns {Promise<{ intel: { summary: string, sourceNote: string }, error?: string }|null>}
 */
async function generateReviewSummaryForLead(lead) {
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
        content: `You write concise Google-Maps-style review summaries for a public business listing that customers read when hiring the business.

Input JSON may include verbatim customer quotes in reviewSnippets, star rating mapsRating (0-5), reviewCount, category, location, and auditSummary.

Rules:
- Write ONE paragraph (2-4 sentences, plain language). No bullet lists, no headings.
- Summarize what customers say about the business — quality, reliability, communication, results — using only themes supported by the quotes plus rating/count.
- If reviewSnippets is empty: summarize reputation from mapsRating, reviewCount, category, and location using cautious wording ("Based on their X★ rating…", "With N reviews…"). Do not invent specific incidents.
- Tone: neutral and customer-facing, like the summary on a Google Business Profile. Never coach sales reps, pitch angles, outreach tips, or how to "use" the reviews to sell.
- Do not mention AI, OpenRouter, sales, cold calls, or that you analyzed JSON.

Return JSON only, no markdown:
{"summary":"paragraph text","sourceNote":"One short sentence: quoted reviews vs rating-only inference."}`,
      },
      {
        role: 'user',
        content: JSON.stringify(snapshot),
      },
    ],
    jsonObject: true,
    max_tokens: 600,
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

  const summaryRaw =
    typeof parsed.summary === 'string'
      ? parsed.summary.trim()
      : typeof parsed.text === 'string'
        ? parsed.text.trim()
        : '';

  const summary = toPublicReviewSummary(summaryRaw);
  if (!summary) {
    return { error: 'Invalid AI response' };
  }

  const intel = {
    summary,
    sourceNote: typeof parsed.sourceNote === 'string' ? parsed.sourceNote.trim() : '',
  };

  return { intel };
}

/** @deprecated use generateReviewSummaryForLead */
async function generateReviewIntelForLead(lead) {
  return generateReviewSummaryForLead(lead);
}

module.exports = {
  generateReviewSummaryForLead,
  generateReviewIntelForLead,
  toPublicReviewSummary,
  toPublicReviewSnippet,
};
