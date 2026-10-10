/**
 * AI + template scripts for member-app review requests sent through GHL.
 * Placeholders: {{name}}, {{company}}, {{review_link}}
 */

const { chatCompletion, parseLlmJson } = require('./llmClient');

const DEFAULT_SMS_SCRIPT =
  'Hi {{name}} — thanks for choosing {{company}}! When you have a minute, leave a quick review: {{review_link}}';

const DEFAULT_EMAIL_SUBJECT = 'Thanks for choosing {{company}}';

const DEFAULT_EMAIL_SCRIPT =
  'Hi {{name}},\n\nThanks for choosing {{company}}. If you have a minute, we\'d love a quick review:\n\n{{review_link}}\n\nThank you!';

const MAX_SMS = 480;
const MAX_SCRIPT = 800;
const MAX_EMAIL = 4000;

function cleanScript(value, max = MAX_SCRIPT) {
  return String(value == null ? '' : value).replace(/\r\n/g, '\n').trim().slice(0, max);
}

function firstName(name) {
  const part = String(name || '').trim().split(/\s+/)[0];
  return part || 'there';
}

function fillPlaceholders(script, { name, company, reviewLink }) {
  const contact = firstName(name);
  const biz = String(company || 'us').trim() || 'us';
  const link = String(reviewLink || '').trim();
  return String(script || '')
    .replace(/\{\{\s*name\s*\}\}/gi, contact)
    .replace(/\{\{\s*first_name\s*\}\}/gi, contact)
    .replace(/\{\{\s*company\s*\}\}/gi, biz)
    .replace(/\{\{\s*business_name\s*\}\}/gi, biz)
    .replace(/\{\{\s*review_link\s*\}\}/gi, link)
    .replace(/\{\{\s*review_url\s*\}\}/gi, link)
    .replace(/\{\{\s*link\s*\}\}/gi, link)
    .trim();
}

/** Guarantee the review URL is in the message (AI sometimes drops links). */
function ensureReviewLink(message, reviewLink) {
  const link = String(reviewLink || '').trim();
  let out = String(message || '').trim();
  if (!link) return out;
  if (out.includes(link)) return out;
  // Also accept same path without scheme/host differences
  try {
    const path = new URL(link).pathname;
    if (path && out.includes(path)) return out;
  } catch {
    /* ignore */
  }
  if (!out) return link;
  const sep = /[.!?]$/.test(out) ? ' ' : ': ';
  return `${out}${sep}${link}`.trim();
}

function memberSmsScript(member) {
  return cleanScript(member && member.reviewSmsScript) || DEFAULT_SMS_SCRIPT;
}

function memberEmailScript(member) {
  return cleanScript(member && member.reviewEmailScript, MAX_EMAIL) || DEFAULT_EMAIL_SCRIPT;
}

function memberEmailSubject(member) {
  return cleanScript(member && member.reviewEmailSubject, 180) || DEFAULT_EMAIL_SUBJECT;
}

/**
 * Fill the member's SMS script (or default). Optional AI polish that must keep the review link.
 */
async function buildReviewSms({
  member,
  customerName,
  companyName,
  reviewLink,
  useAi = true,
  scriptOverride,
}) {
  const company = String(companyName || (member && member.companyName) || '').trim() || 'us';
  const baseScript = cleanScript(scriptOverride) || memberSmsScript(member);
  const filled = fillPlaceholders(baseScript, {
    name: customerName,
    company,
    reviewLink,
  });

  if (!useAi) {
    return {
      message: ensureReviewLink(filled, reviewLink).slice(0, MAX_SMS),
      provider: 'script',
      script: baseScript,
    };
  }

  const ai = await chatCompletion({
    messages: [
      {
        role: 'system',
        content: `You write short customer SMS asking for a review after a completed job.

Rules:
- Return JSON only: {"message":"..."}
- Target ~240 chars, hard max ${MAX_SMS} chars.
- Warm, grateful, human. No spammy hype, no markdown, no emojis unless the script already has them.
- You MUST include this exact review URL unchanged somewhere in the message: ${reviewLink}
- Use the customer's first name when natural.
- One clear ask to leave a review via the link.
- Do not invent discounts, ratings, or claims not in the script.`,
      },
      {
        role: 'user',
        content: JSON.stringify({
          customerName: String(customerName || '').trim() || 'there',
          companyName: company,
          reviewLink,
          script: baseScript,
          filledDraft: filled,
        }),
      },
    ],
    jsonObject: true,
    max_tokens: 280,
    temperature: 0.4,
  });

  if (!ai.content || ai.error) {
    return {
      message: ensureReviewLink(filled, reviewLink).slice(0, MAX_SMS),
      provider: 'fallback',
      script: baseScript,
    };
  }

  const parsed = parseLlmJson(ai.content);
  const personalized = String((parsed && parsed.message) || '').trim();
  if (!personalized) {
    return {
      message: ensureReviewLink(filled, reviewLink).slice(0, MAX_SMS),
      provider: 'fallback',
      script: baseScript,
    };
  }

  return {
    message: ensureReviewLink(personalized, reviewLink).slice(0, MAX_SMS),
    provider: ai.provider || 'ai',
    script: baseScript,
  };
}

async function buildReviewEmail({
  member,
  customerName,
  companyName,
  reviewLink,
  useAi = true,
  scriptOverride,
  subjectOverride,
}) {
  const company = String(companyName || (member && member.companyName) || '').trim() || 'us';
  const baseScript = cleanScript(scriptOverride, MAX_EMAIL) || memberEmailScript(member);
  const baseSubject = cleanScript(subjectOverride, 180) || memberEmailSubject(member);
  const filledBody = fillPlaceholders(baseScript, { name: customerName, company, reviewLink });
  const filledSubject = fillPlaceholders(baseSubject, { name: customerName, company, reviewLink });

  if (!useAi) {
    return {
      subject: filledSubject.slice(0, 180),
      body: ensureReviewLink(filledBody, reviewLink).slice(0, MAX_EMAIL),
      provider: 'script',
      script: baseScript,
    };
  }

  const ai = await chatCompletion({
    messages: [
      {
        role: 'system',
        content: `You write a short customer email asking for a review after a completed job.

Rules:
- Return JSON only: {"subject":"...","body":"..."}
- Plain text body, 60–140 words.
- Warm and grateful. No markdown bullets unless the script has them.
- You MUST include this exact review URL unchanged in the body: ${reviewLink}
- One clear CTA. Do not invent claims.`,
      },
      {
        role: 'user',
        content: JSON.stringify({
          customerName: String(customerName || '').trim() || 'there',
          companyName: company,
          reviewLink,
          subjectScript: baseSubject,
          bodyScript: baseScript,
          filledSubject,
          filledBody,
        }),
      },
    ],
    jsonObject: true,
    max_tokens: 500,
    temperature: 0.4,
  });

  if (!ai.content || ai.error) {
    return {
      subject: filledSubject.slice(0, 180),
      body: ensureReviewLink(filledBody, reviewLink).slice(0, MAX_EMAIL),
      provider: 'fallback',
      script: baseScript,
    };
  }

  const parsed = parseLlmJson(ai.content);
  const body = String((parsed && (parsed.body || parsed.message)) || '').trim();
  const subject = String((parsed && parsed.subject) || filledSubject).trim();
  if (!body) {
    return {
      subject: filledSubject.slice(0, 180),
      body: ensureReviewLink(filledBody, reviewLink).slice(0, MAX_EMAIL),
      provider: 'fallback',
      script: baseScript,
    };
  }

  return {
    subject: (subject || filledSubject).slice(0, 180),
    body: ensureReviewLink(body, reviewLink).slice(0, MAX_EMAIL),
    provider: ai.provider || 'ai',
    script: baseScript,
  };
}

/** Prompt an agency can paste into GHL Workflow AI for automated post-job review SMS. */
function buildGhlReviewWorkflowPrompt({ companyName, reviewLink, smsScript }) {
  const company = String(companyName || 'the business').trim();
  const link = String(reviewLink || '').trim();
  const script = cleanScript(smsScript) || DEFAULT_SMS_SCRIPT;
  return [
    `Build a Go High Level workflow that texts happy customers a review request for ${company}.`,
    '',
    'Trigger: when a job/opportunity is marked won/completed (or a “Request review” tag is applied).',
    'Action: Send SMS from this location’s SMS number.',
    '',
    'SMS script (personalize {{contact.first_name}} in GHL; keep the review link exact):',
    fillPlaceholders(script, {
      name: '{{contact.first_name}}',
      company,
      reviewLink: link || '{{custom_values.review_link}}',
    }),
    '',
    'Rules:',
    '- Always include the review link in the SMS.',
    '- Skip contacts who opted out of SMS.',
    '- Send once per contact (add a tag like “review-asked” after send).',
  ].join('\n');
}

module.exports = {
  DEFAULT_SMS_SCRIPT,
  DEFAULT_EMAIL_SCRIPT,
  DEFAULT_EMAIL_SUBJECT,
  cleanScript,
  fillPlaceholders,
  ensureReviewLink,
  memberSmsScript,
  memberEmailScript,
  memberEmailSubject,
  buildReviewSms,
  buildReviewEmail,
  buildGhlReviewWorkflowPrompt,
};
