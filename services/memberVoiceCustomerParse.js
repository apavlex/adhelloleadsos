/**
 * Turn free-form spoken text into customer form fields for the member app.
 */
const { chatCompletion, parseLlmJson } = require('./llmClient');
const { getResolvedIntegrationEnv } = require('./workspaceIntegrations');
const work = require('./memberWork');

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const PHONE_RE =
  /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}|\d{3}[-.\s]\d{3}[-.\s]\d{4})/;

function heuristicParse(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return { name: '', phone: '', email: '', address: '', notes: '' };

  let rest = raw;
  let email = '';
  let phone = '';
  const emailMatch = rest.match(EMAIL_RE);
  if (emailMatch) {
    email = emailMatch[0];
    rest = rest.replace(emailMatch[0], ' ').replace(/\s+/g, ' ').trim();
  }
  const phoneMatch = rest.match(PHONE_RE);
  if (phoneMatch) {
    phone = phoneMatch[0].trim();
    rest = rest.replace(phoneMatch[0], ' ').replace(/\s+/g, ' ').trim();
  }

  let name = '';
  let address = '';
  let notes = '';

  const nameCue = rest.match(
    /(?:(?:customer|client|homeowner|contact)?\s*name is|this is|adding|new customer)\s+([A-Z][\w.'-]+(?:\s+[A-Z][\w.'-]+){0,3})/i,
  );
  if (nameCue) {
    name = nameCue[1].trim();
    rest = rest.replace(nameCue[0], ' ').replace(/\s+/g, ' ').trim();
  }

  const addrCue = rest.match(
    /(?:lives? (?:at|on)|address(?: is)?|located at)\s+(.+?)(?:\.|$)/i,
  );
  if (addrCue) {
    address = addrCue[1].trim().replace(/[,;]+$/, '');
    rest = rest.replace(addrCue[0], ' ').replace(/\s+/g, ' ').trim();
  } else {
    const street = rest.match(
      /\b(\d{1,6}\s+[A-Za-z0-9][\w.'-]*(?:\s+[A-Za-z0-9][\w.'-]*){0,6}(?:\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Ln|Lane|Dr|Drive|Ct|Court|Way|Hwy|Highway)\.?)?(?:,?\s*[A-Za-z .]+)?(?:,?\s*[A-Z]{2})?(?:\s+\d{5}(?:-\d{4})?)?)\b/i,
    );
    if (street) {
      address = street[1].trim();
      rest = rest.replace(street[0], ' ').replace(/\s+/g, ' ').trim();
    }
  }

  if (!name) {
    const firstChunk = rest.split(/[.,;]| and | with | phone | email | at /i)[0] || '';
    const words = firstChunk.trim().split(/\s+/).filter(Boolean);
    if (words.length >= 1 && words.length <= 4 && !/^\d/.test(words[0])) {
      name = words.join(' ');
      rest = rest.slice(firstChunk.length).replace(/^[\s,.;:-]+/, '').trim();
    }
  }

  notes = rest;
  return { name, phone, email, address, notes };
}

function normalizeFields(raw) {
  const attempt = {
    name: raw && raw.name,
    phone: raw && raw.phone,
    email: raw && raw.email,
    address: raw && raw.address,
    notes: raw && raw.notes,
  };
  let checked = work.validateCustomer(attempt);
  if (!checked.ok && /email/i.test(String(checked.error || ''))) {
    checked = work.validateCustomer({ ...attempt, email: '' });
  }
  if (checked.ok) return { ok: true, fields: checked.fields, warning: '' };
  // Allow preview even without a perfect name — UI will require name before create.
  const soft = {
    name: String((raw && raw.name) || '').trim().slice(0, 120),
    phone: String((raw && raw.phone) || '').trim().slice(0, 40),
    email: '',
    address: String((raw && raw.address) || '').trim().slice(0, 200),
    notes: String((raw && raw.notes) || '').trim().slice(0, 2000),
  };
  return {
    ok: true,
    fields: soft,
    warning: soft.name ? checked.error || '' : 'I couldn’t catch a name — add one before creating.',
  };
}

async function llmParse(text, integrationEnv) {
  const result = await chatCompletion({
    messages: [
      {
        role: 'system',
        content:
          'Extract a single customer contact from field-worker dictation. ' +
          'Return ONLY JSON with keys: name, phone, email, address, notes. ' +
          'Use empty strings for missing values. Put leftover details in notes. ' +
          'Normalize phone to digits with optional leading +. Keep name as spoken (Title Case when clear).',
      },
      {
        role: 'user',
        content: `Dictation:\n"""${String(text).slice(0, 4000)}"""`,
      },
    ],
    jsonObject: true,
    temperature: 0.1,
    max_tokens: 400,
    integrationEnv: integrationEnv || null,
    timeoutMs: 20000,
    allowReasoningFallback: false,
  });
  if (!result || result.error || !result.content) return null;
  const parsed = parseLlmJson(result.content);
  if (!parsed || typeof parsed !== 'object') return null;
  return {
    name: parsed.name,
    phone: parsed.phone,
    email: parsed.email,
    address: parsed.address,
    notes: parsed.notes,
  };
}

/**
 * @param {string} text
 * @param {{ workspaceId?: string }} [opts]
 */
async function parseCustomerFromSpeech(text, opts = {}) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return { ok: false, error: 'No speech captured. Tap the mic and try again.' };
  if (cleaned.length < 2) return { ok: false, error: 'That was too short — say the name and any details.' };

  let extracted = null;
  let source = 'heuristic';
  try {
    let integrationEnv = null;
    if (opts.workspaceId) {
      try {
        integrationEnv = await getResolvedIntegrationEnv(opts.workspaceId);
      } catch (_) {
        integrationEnv = null;
      }
    }
    extracted = await llmParse(cleaned, integrationEnv);
    if (extracted) source = 'llm';
  } catch (err) {
    console.warn('[member-voice-customer] llm parse failed', err && err.message ? err.message : err);
  }

  if (!extracted) extracted = heuristicParse(cleaned);
  const normalized = normalizeFields(extracted);
  return {
    ...normalized,
    source,
    transcript: cleaned.slice(0, 4000),
  };
}

module.exports = {
  parseCustomerFromSpeech,
  heuristicParse,
  normalizeFields,
};
