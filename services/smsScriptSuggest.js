/**
 * Turn an offer's call script into SMS-length copy: drop email furniture,
 * keep merge tags intact, and clamp to something a rep can send.
 */

const { htmlToPlain } = require('./scriptMarkup');

const MAX_SMS_SUGGESTION_LEN = 320;
/** A text message is a couple of sentences, not a condensed call script. */
const MAX_SMS_SENTENCES = 3;

const SUBJECT_LINE_RE = /^\s*(?:re|subject|subject line|email subject)\s*:.*$/i;
const SIGN_OFF_RE =
  /^\s*(?:best|best regards|regards|kind regards|warm regards|thanks|thank you|thanks so much|cheers|sincerely|talk soon|speak soon|all the best)\s*[,.!—-]*\s*$/i;

/** Collapse a script (plain or rich-editor HTML) into single-spaced lines. */
function toPlainLines(raw) {
  return htmlToPlain(raw)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim());
}

/**
 * Strip subject lines, signature blocks, and `--` sig delimiters.
 * @param {string} raw call script or model output
 * @returns {string} one paragraph of body copy
 */
function stripEmailFurniture(raw) {
  const lines = toPlainLines(raw);
  const kept = [];
  for (const line of lines) {
    if (!line) continue;
    if (SUBJECT_LINE_RE.test(line)) continue;
    if (/^-{2,}$/.test(line) || /^_{2,}$/.test(line)) break;
    if (SIGN_OFF_RE.test(line)) break;
    kept.push(line);
  }
  return kept.join(' ').replace(/\s+/g, ' ').trim();
}

/** Drop wrapping quotes and label prefixes models like to add. */
function stripSuggestionWrapper(raw) {
  let s = String(raw == null ? '' : raw).trim();
  s = s.replace(/^(?:sms|text|text message|suggested sms|suggestion)\s*:\s*/i, '');
  if (s.length > 1 && /^["'“‘]/.test(s) && /["'”’]$/.test(s)) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

/**
 * Cut to `max` characters without leaving a half-written merge tag or mid-word.
 * @param {string} raw
 * @param {number} [max]
 */
function clampSmsText(raw, max = MAX_SMS_SUGGESTION_LEN) {
  const s = String(raw == null ? '' : raw);
  if (s.length <= max) return s.trim();
  let cut = s.slice(0, max);
  const openIdx = cut.lastIndexOf('{{');
  if (openIdx > -1 && cut.indexOf('}}', openIdx) === -1) cut = cut.slice(0, openIdx);
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > Math.floor(max / 2)) cut = cut.slice(0, lastSpace);
  return cut.replace(/[\s,;:—–-]+$/, '').trim();
}

function splitSentences(text) {
  const matches = String(text || '').match(/[^.!?]+[.!?]*/g);
  return (matches || []).map((s) => s.trim()).filter(Boolean);
}

/**
 * Shape any SMS candidate (model output or local condensation) into one
 * sendable paragraph.
 * @param {string} raw
 * @param {{ maxLength?: number }} [options]
 */
function normalizeSmsSuggestion(raw, options = {}) {
  const max = options.maxLength || MAX_SMS_SUGGESTION_LEN;
  // Furniture first: a leading `Subject:` line hides the quotes that wrap the body.
  return clampSmsText(stripSuggestionWrapper(stripEmailFurniture(raw)), max);
}

/**
 * Deterministic fallback when no model is available: keep the opening
 * sentences, which is where the hook and merge tags live.
 * @param {string} raw call script text
 * @param {{ maxLength?: number, maxSentences?: number }} [options]
 */
function condenseCallScriptToSms(raw, options = {}) {
  const max = options.maxLength || MAX_SMS_SUGGESTION_LEN;
  const maxSentences = options.maxSentences || MAX_SMS_SENTENCES;
  const body = stripEmailFurniture(raw);
  if (!body) return '';
  const sentences = splitSentences(body);
  let out = '';
  for (let i = 0; i < sentences.length && i < maxSentences; i += 1) {
    const next = out ? `${out} ${sentences[i]}` : sentences[i];
    if (next.length > max) break;
    out = next;
  }
  return out ? out.trim() : clampSmsText(sentences[0] || body, max);
}

/** Merge tags present in the source that survived into the suggestion. */
function mergeTagsIn(text) {
  const found = String(text || '').match(/\{\{\s*[a-z0-9_.]+\s*\}\}/gi) || [];
  return [...new Set(found.map((t) => t.toLowerCase().replace(/\s+/g, '')))];
}

module.exports = {
  MAX_SMS_SUGGESTION_LEN,
  MAX_SMS_SENTENCES,
  stripEmailFurniture,
  stripSuggestionWrapper,
  clampSmsText,
  normalizeSmsSuggestion,
  condenseCallScriptToSms,
  mergeTagsIn,
};
