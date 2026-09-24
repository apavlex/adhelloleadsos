/**
 * Plain-text outreach bodies (SMS + email) — strip call-script HTML/CSS junk and
 * reject empty sends before GHL only appends compliance footers.
 */

const { htmlToPlain, looksLikeScriptHtml } = require('./scriptMarkup');

const MIN_SMS_LEN = 12;
const MIN_EMAIL_LEN = 20;

function looksLikeOutreachCssJunk(raw) {
  const s = String(raw || '');
  return (
    /--tw-|border-spacing|translate-x|skew-x|gradient-from-position|scroll-snap-strictness|pinch-zoom|ordinal\s*:/i.test(
      s,
    ) || (/style\s*=/i.test(s) && s.length > 400)
  );
}

/**
 * @param {string} raw
 * @param {'sms'|'email'} [channel]
 * @returns {string}
 */
function sanitizeOutreachComposerText(raw, channel = 'sms') {
  let s = String(raw || '');
  if (!s.trim()) return '';
  const hasHtml = looksLikeScriptHtml(s) || /<[a-z][\s\S]*>/i.test(s);
  if (hasHtml || looksLikeOutreachCssJunk(s)) {
    s = htmlToPlain(s);
  }
  if (looksLikeOutreachCssJunk(s)) return '';
  s = String(s || '').trim();
  if (channel === 'sms') {
    // Keep intentional line breaks; collapse runaway whitespace.
    s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  }
  return s.trim();
}

/**
 * @param {string} raw
 * @param {'sms'|'email'} [channel]
 * @returns {{ ok: boolean, text: string, error?: string }}
 */
function validateOutreachComposerBody(raw, channel = 'sms') {
  const text = sanitizeOutreachComposerText(raw, channel);
  const minLen = channel === 'email' ? MIN_EMAIL_LEN : MIN_SMS_LEN;
  if (!text || text.length < minLen) {
    const hadContent = String(raw || '').trim().length > 0;
    return {
      ok: false,
      text: text || '',
      error:
        channel === 'email'
          ? hadContent
            ? 'That email copy looked like call-script HTML/CSS and was stripped. Paste plain follow-up text, or fix the Email field under Workspace → Scripts.'
            : 'Email body is empty. Add plain follow-up copy under Workspace → Scripts, then try again.'
          : hadContent
            ? 'That SMS looked like call-script HTML/CSS and was stripped after personalize. Your composer text is fine — try Send again (we keep the original), or paste plain SMS under Workspace → Scripts.'
            : 'SMS body is empty. Add plain SMS text under Workspace → Scripts, then try again.',
    };
  }
  if (!/[a-zA-Z]/.test(text)) {
    return {
      ok: false,
      text,
      error: 'Message must include real words — not only symbols or formatting.',
    };
  }
  return { ok: true, text };
}

module.exports = {
  looksLikeOutreachCssJunk,
  sanitizeOutreachComposerText,
  validateOutreachComposerBody,
  MIN_SMS_LEN,
  MIN_EMAIL_LEN,
};
