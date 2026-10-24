/**
 * AI + template scripts for member-app review requests sent through GHL.
 * Placeholders: {{name}}, {{company}}, {{review_link}}, {{job}}, {{city}}, {{keywords}}
 * Example keywords: "cabinet install in Camas"
 */

const { chatCompletion, parseLlmJson } = require('./llmClient');
const { getBusinessVcardUrl } = require('../lib/publicBaseUrl');

const DEFAULT_SMS_SCRIPT =
  'Hi {{name}} — thanks for choosing {{company}}! When you have a minute, leave a quick review — mentioning {{keywords}} helps neighbors find us: {{review_link}}';

const DEFAULT_EMAIL_SUBJECT = 'Thanks for choosing {{company}}';

const DEFAULT_EMAIL_SCRIPT =
  'Hi {{name}},\n\nThanks for choosing {{company}}. If you have a minute, we\'d love a quick review — mentioning {{keywords}} helps neighbors find us:\n\n{{review_link}}\n\nThank you!';

/** One-tap insert for owners whose saved script still omits project keywords. */
const KEYWORDS_SCRIPT_SNIPPET =
  ' If you mention {{keywords}}, that helps neighbors find us.';

const MAX_SMS = 480;
const MAX_SCRIPT = 800;
const MAX_EMAIL = 4000;

function cleanScript(value, max = MAX_SCRIPT) {
  return String(value == null ? '' : value).replace(/\r\n/g, '\n').trim().slice(0, max);
}

function cleanPhrase(value, max = 80) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function firstName(name) {
  const part = String(name || '').trim().split(/\s+/)[0];
  return part || 'there';
}

function titleCaseWords(value) {
  return String(value || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length <= 2 && /^[A-Za-z]+$/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

/**
 * Pull a city from a free-text address ("…, Camas, WA 98607" → Camas).
 */
function cityFromAddress(address) {
  const raw = cleanPhrase(address, 200);
  if (!raw) return '';
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    // "WA 98607" / "WA" / "Washington 98607"
    if (/^[A-Za-z]{2}(\s+\d{5}(-\d{4})?)?$/.test(last) || /\d{5}/.test(last)) {
      return titleCaseWords(parts[parts.length - 2]);
    }
    // "Camas WA"
    const m = last.match(/^([A-Za-z][A-Za-z\s.'-]+?)\s+[A-Z]{2}\b/);
    if (m) return titleCaseWords(m[1]);
    return titleCaseWords(parts[parts.length - 2] || parts[0]);
  }
  const one = parts[0] || raw;
  const m2 = one.match(/\b([A-Za-z][A-Za-z\s.'-]{1,40}?)\s+[A-Z]{2}(?:\s+\d{5})?\s*$/);
  if (m2) return titleCaseWords(m2[1]);
  return '';
}

/** Prefer latest completed job with a title; else latest titled job. */
function pickReviewJob(jobs) {
  const list = (Array.isArray(jobs) ? jobs : []).filter((j) => j && cleanPhrase(j.title, 120));
  if (!list.length) return null;
  const completed = list.filter((j) => String(j.status || '') === 'completed');
  const pool = completed.length ? completed : list;
  pool.sort((a, b) =>
    String(b.completedAt || b.updatedAt || b.date || b.createdAt || '').localeCompare(
      String(a.completedAt || a.updatedAt || a.date || a.createdAt || ''),
    ),
  );
  return pool[0] || null;
}

/** "cabinet install in Camas" — SEO-friendly phrase for the review ask. */
function buildKeywordHint({ jobTitle, city, keywords } = {}) {
  const explicit = cleanPhrase(keywords, 100);
  if (explicit) return explicit;
  const job = cleanPhrase(jobTitle, 80);
  const loc = cleanPhrase(city, 40);
  if (job && loc) return `${job} in ${loc}`;
  if (job) return job;
  if (loc) return `work in ${loc}`;
  return '';
}

/** Member-saved defaults used when a customer has no job title / city yet. */
function memberKeywordDefaults(member) {
  return {
    jobTitle: cleanPhrase(member && member.reviewKeywordJob, 80),
    city: cleanPhrase(member && member.reviewKeywordCity, 40),
    keywords: cleanPhrase(member && member.reviewKeywords, 100),
  };
}

/**
 * Resolve SEO keywords for a review ask.
 * Prefer: explicit keywords → customer job + address city → member defaults.
 */
function resolveReviewKeywords({
  customer,
  jobs,
  jobTitle,
  city,
  keywords,
  defaults,
} = {}) {
  const job = pickReviewJob(jobs);
  const defs = defaults && typeof defaults === 'object' ? defaults : {};
  const title =
    cleanPhrase(jobTitle, 80) ||
    (job && job.title) ||
    cleanPhrase(defs.jobTitle, 80) ||
    '';
  const loc =
    cleanPhrase(city, 40) ||
    cityFromAddress(customer && customer.address) ||
    cleanPhrase(defs.city, 40) ||
    '';
  const explicit =
    cleanPhrase(keywords, 100) || cleanPhrase(defs.keywords, 100) || '';
  const hint = buildKeywordHint({ jobTitle: title, city: loc, keywords: explicit });
  return {
    jobTitle: title,
    city: loc,
    keywords: hint,
    keywordHint: hint,
    jobId: job && job.id ? String(job.id) : '',
    fromCustomerJob: !!(job && cleanPhrase(job.title, 80)),
    fromCustomerCity: !!cityFromAddress(customer && customer.address),
  };
}

function fillPlaceholders(script, { name, company, reviewLink, jobTitle, city, keywords } = {}) {
  const contact = firstName(name);
  const biz = String(company || 'us').trim() || 'us';
  const link = String(reviewLink || '').trim();
  const job = cleanPhrase(jobTitle, 80);
  const loc = cleanPhrase(city, 40);
  const kw = buildKeywordHint({ jobTitle: job, city: loc, keywords }) || 'the work we did';
  return String(script || '')
    .replace(/\{\{\s*name\s*\}\}/gi, contact)
    .replace(/\{\{\s*first_name\s*\}\}/gi, contact)
    .replace(/\{\{\s*company\s*\}\}/gi, biz)
    .replace(/\{\{\s*business_name\s*\}\}/gi, biz)
    .replace(/\{\{\s*review_link\s*\}\}/gi, link)
    .replace(/\{\{\s*review_url\s*\}\}/gi, link)
    .replace(/\{\{\s*link\s*\}\}/gi, link)
    .replace(/\{\{\s*job\s*\}\}/gi, job || 'your project')
    .replace(/\{\{\s*project\s*\}\}/gi, job || 'your project')
    .replace(/\{\{\s*city\s*\}\}/gi, loc || 'your area')
    .replace(/\{\{\s*keywords\s*\}\}/gi, kw)
    .replace(/\{\{\s*keyword\s*\}\}/gi, kw)
    .replace(/\bthe\s+your project\b/gi, 'your project')
    .replace(/\bthe\s+the project\b/gi, 'your project')
    .trim();
}

/** True when the saved script intentionally includes a review link. */
function scriptWantsReviewLink(script) {
  const s = String(script || '');
  if (/\{\{\s*(review_link|review_url|link)\s*\}\}/i.test(s)) return true;
  return /https?:\/\/\S+/i.test(s);
}

/**
 * Put the review URL at the end of the message (own paragraph).
 * iMessage / SMS rich previews unfurl much more reliably when the link is last.
 */
function placeReviewLinkAtEnd(message, reviewLink) {
  const link = String(reviewLink || '').trim();
  let out = String(message || '').trim();
  if (!link) return out;
  out = out.split(link).join(' ');
  try {
    const parsed = new URL(link);
    const hostPath = `${parsed.host}${parsed.pathname}`.replace(/\/$/, '');
    if (hostPath) out = out.split(hostPath).join(' ');
    if (parsed.pathname && parsed.pathname.length > 4) {
      out = out.split(parsed.pathname).join(' ');
    }
  } catch {
    /* ignore */
  }
  out = out
    .replace(/https?:\/\/\S*\/rv\/\S+/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([?!,;.])/g, '$1')
    .replace(/[\s:\-–—]+$/g, '')
    .trim();
  if (!out) return link;
  return `${out}\n\n${link}`;
}

/** Guarantee the review URL is in the message (AI sometimes drops links). */
function ensureReviewLink(message, reviewLink) {
  const link = String(reviewLink || '').trim();
  let out = String(message || '').trim();
  if (!link) return out;
  if (out.includes(link)) return placeReviewLinkAtEnd(out, link);
  // Also accept same path without scheme/host differences
  try {
    const path = new URL(link).pathname;
    if (path && out.includes(path)) return placeReviewLinkAtEnd(out, link);
  } catch {
    /* ignore */
  }
  if (!out) return link;
  return placeReviewLinkAtEnd(out, link);
}

/**
 * Only re-append the review URL when the saved script asked for one.
 * Scripts without {{review_link}} / a URL are sent exactly as saved.
 */
function maybeEnsureReviewLink(message, reviewLink, script) {
  if (!scriptWantsReviewLink(script)) return String(message || '').trim();
  return ensureReviewLink(message, reviewLink);
}

function memberAttachVcard(member) {
  return !!(member && member.reviewAttachVcard);
}

function memberVcardUrl(member) {
  return getBusinessVcardUrl(member && member.reviewSlug) || '';
}

/**
 * Append the business vCard URL when the owner opted in.
 * Call after the review link is placed so order is: script → review link → vCard.
 * (Review link stays immediately under the script so iMessage can unfurl the image.)
 */
function maybeAttachVcardUrl(message, vcardUrl, { attach = false } = {}) {
  if (!attach) return String(message || '').trim();
  const url = String(vcardUrl || '').trim();
  if (!url) return String(message || '').trim();
  const out = String(message || '').trim();
  if (out.includes(url)) return out;
  if (!out) return url;
  return `${out}\n\n${url}`;
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
  jobTitle = '',
  city = '',
  keywords = '',
}) {
  const company = String(companyName || (member && member.companyName) || '').trim() || 'us';
  const baseScript = cleanScript(scriptOverride) || memberSmsScript(member);
  const keywordFields = {
    jobTitle,
    city,
    keywords: keywords || buildKeywordHint({ jobTitle, city }),
  };
  const filled = fillPlaceholders(baseScript, {
    name: customerName,
    company,
    reviewLink,
    ...keywordFields,
  });

  const wantsLink = scriptWantsReviewLink(baseScript);
  const vcardUrl = memberVcardUrl(member);
  const attachVcard = memberAttachVcard(member);
  const finishSms = (draft) => maybeAttachVcardUrl(
    maybeEnsureReviewLink(draft, reviewLink, baseScript),
    vcardUrl,
    { attach: attachVcard },
  ).slice(0, MAX_SMS);

  if (!useAi) {
    return {
      message: finishSms(filled),
      provider: 'script',
      script: baseScript,
      keywords: keywordFields.keywords,
    };
  }

  const linkRule = wantsLink
    ? `- You MUST include this exact review URL unchanged somewhere in the message: ${reviewLink}`
    : '- Do NOT add a review URL — the saved script intentionally has no link.';
  const keywordRule = keywordFields.keywords
    ? `- When natural, invite them to mention this project/location in their Google review (helps local search): "${keywordFields.keywords}". Do not invent other project details.`
    : '- Do not invent project titles, cities, or SEO keywords.';
  const vcardRule = attachVcard && vcardUrl
    ? `- Do not invent a contact-card link; a vCard URL is appended after you write.`
    : '';

  const ai = await chatCompletion({
    messages: [
      {
        role: 'system',
        content: `You write short customer SMS asking for a review after a completed job.

Rules:
- Return JSON only: {"message":"..."}
- Target ~240 chars, hard max ${MAX_SMS} chars.
- Warm, grateful, human. No spammy hype, no markdown, no emojis unless the script already has them.
${linkRule}
${keywordRule}
${vcardRule}
- Use the customer's first name when natural.
- Stay faithful to the saved script; do not invent discounts, ratings, or claims not in the script.`,
      },
      {
        role: 'user',
        content: JSON.stringify({
          customerName: String(customerName || '').trim() || 'there',
          companyName: company,
          reviewLink: wantsLink ? reviewLink : '',
          jobTitle: keywordFields.jobTitle || '',
          city: keywordFields.city || '',
          keywords: keywordFields.keywords || '',
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
      message: finishSms(filled),
      provider: 'fallback',
      script: baseScript,
      keywords: keywordFields.keywords,
    };
  }

  const parsed = parseLlmJson(ai.content);
  const personalized = String((parsed && parsed.message) || '').trim();
  if (!personalized) {
    return {
      message: finishSms(filled),
      provider: 'fallback',
      script: baseScript,
      keywords: keywordFields.keywords,
    };
  }

  return {
    message: finishSms(personalized),
    provider: ai.provider || 'ai',
    script: baseScript,
    keywords: keywordFields.keywords,
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
  jobTitle = '',
  city = '',
  keywords = '',
}) {
  const company = String(companyName || (member && member.companyName) || '').trim() || 'us';
  const baseScript = cleanScript(scriptOverride, MAX_EMAIL) || memberEmailScript(member);
  const baseSubject = cleanScript(subjectOverride, 180) || memberEmailSubject(member);
  const keywordFields = {
    jobTitle,
    city,
    keywords: keywords || buildKeywordHint({ jobTitle, city }),
  };
  const filledBody = fillPlaceholders(baseScript, {
    name: customerName,
    company,
    reviewLink,
    ...keywordFields,
  });
  const filledSubject = fillPlaceholders(baseSubject, {
    name: customerName,
    company,
    reviewLink,
    ...keywordFields,
  });

  const wantsLink = scriptWantsReviewLink(baseScript);

  if (!useAi) {
    return {
      subject: filledSubject.slice(0, 180),
      body: maybeEnsureReviewLink(filledBody, reviewLink, baseScript).slice(0, MAX_EMAIL),
      provider: 'script',
      script: baseScript,
      keywords: keywordFields.keywords,
    };
  }

  const linkRule = wantsLink
    ? `- You MUST include this exact review URL unchanged in the body: ${reviewLink}`
    : '- Do NOT add a review URL — the saved script intentionally has no link.';
  const keywordRule = keywordFields.keywords
    ? `- When natural, invite them to mention "${keywordFields.keywords}" in their public review. Do not invent other project details.`
    : '- Do not invent project titles, cities, or SEO keywords.';

  const ai = await chatCompletion({
    messages: [
      {
        role: 'system',
        content: `You write a short customer email asking for a review after a completed job.

Rules:
- Return JSON only: {"subject":"...","body":"..."}
- Plain text body, 60–140 words.
- Warm and grateful. No markdown bullets unless the script has them.
${linkRule}
${keywordRule}
- Stay faithful to the saved script. Do not invent claims.`,
      },
      {
        role: 'user',
        content: JSON.stringify({
          customerName: String(customerName || '').trim() || 'there',
          companyName: company,
          reviewLink: wantsLink ? reviewLink : '',
          jobTitle: keywordFields.jobTitle || '',
          city: keywordFields.city || '',
          keywords: keywordFields.keywords || '',
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
      body: maybeEnsureReviewLink(filledBody, reviewLink, baseScript).slice(0, MAX_EMAIL),
      provider: 'fallback',
      script: baseScript,
      keywords: keywordFields.keywords,
    };
  }

  const parsed = parseLlmJson(ai.content);
  const body = String((parsed && (parsed.body || parsed.message)) || '').trim();
  const subject = String((parsed && parsed.subject) || filledSubject).trim();
  if (!body) {
    return {
      subject: filledSubject.slice(0, 180),
      body: maybeEnsureReviewLink(filledBody, reviewLink, baseScript).slice(0, MAX_EMAIL),
      provider: 'fallback',
      script: baseScript,
      keywords: keywordFields.keywords,
    };
  }

  return {
    subject: (subject || filledSubject).slice(0, 180),
    body: maybeEnsureReviewLink(body, reviewLink, baseScript).slice(0, MAX_EMAIL),
    provider: ai.provider || 'ai',
    script: baseScript,
    keywords: keywordFields.keywords,
  };
}

/** Prompt an agency can paste into GHL CRM Workflow AI for automated post-job review SMS. */
function buildGhlReviewWorkflowPrompt({ companyName, reviewLink, smsScript, attachVcard, vcardUrl }) {
  const company = String(companyName || 'the business').trim();
  const link = String(reviewLink || '').trim();
  const script = cleanScript(smsScript) || DEFAULT_SMS_SCRIPT;
  const card = String(vcardUrl || '').trim();
  const filled = fillPlaceholders(script, {
    name: '{{contact.first_name}}',
    company,
    reviewLink: link || '{{custom_values.review_link}}',
  });
  const withLink = scriptWantsReviewLink(script)
    ? maybeEnsureReviewLink(filled, link, script)
    : filled;
  const smsExample = maybeAttachVcardUrl(withLink, card, {
    attach: !!attachVcard && !!card,
  });
  return [
    `Build a GHL CRM workflow that texts happy customers a review request for ${company}.`,
    '',
    'Trigger: when a job/opportunity is marked won/completed (or a “Request review” tag is applied).',
    'Action: Send SMS from this location’s SMS number.',
    '',
    scriptWantsReviewLink(script)
      ? 'SMS script (personalize {{contact.first_name}} in GHL CRM; keep the review link exact):'
      : 'SMS script (personalize {{contact.first_name}} in GHL CRM; do not add a review link):',
    smsExample,
    '',
    'Rules:',
    scriptWantsReviewLink(script)
      ? '- Include the review link exactly as written in the script.'
      : '- Do not add a review URL; use the script as saved.',
    attachVcard && card
      ? `- Include this contact-card (vCard) URL so they can save the business: ${card}`
      : '',
    '- Skip contacts who opted out of SMS.',
    '- Send once per contact (add a tag like “review-asked” after send).',
  ].filter(Boolean).join('\n');
}

module.exports = {
  DEFAULT_SMS_SCRIPT,
  DEFAULT_EMAIL_SCRIPT,
  DEFAULT_EMAIL_SUBJECT,
  KEYWORDS_SCRIPT_SNIPPET,
  cleanScript,
  cleanPhrase,
  cityFromAddress,
  pickReviewJob,
  buildKeywordHint,
  memberKeywordDefaults,
  resolveReviewKeywords,
  fillPlaceholders,
  scriptWantsReviewLink,
  placeReviewLinkAtEnd,
  ensureReviewLink,
  maybeEnsureReviewLink,
  maybeAttachVcardUrl,
  memberAttachVcard,
  memberVcardUrl,
  memberSmsScript,
  memberEmailScript,
  memberEmailSubject,
  buildReviewSms,
  buildReviewEmail,
  buildGhlReviewWorkflowPrompt,
};
