/**
 * LaML (TwiML-compatible) documents for the agent dial-in flow.
 *
 * Every inbound branch must answer with a valid document. When SignalWire cannot
 * parse a document — or gets a non-2xx / slow response — it drops the call and the
 * caller hears the carrier "your call cannot be completed at this time" intercept
 * with no clue what broke. Keeping the XML here (pure, no I/O) makes each branch
 * testable and keeps the webhook handler free of string building.
 */

function xmlEscape(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Strip characters SignalWire's TTS reads badly and cap length. */
function speakable(text) {
  return String(text == null ? '' : text)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 480);
}

function voiceOptions(opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  return {
    voice: String(o.voice || process.env.TELEPHONY_VOICE_NAME || 'alice').trim() || 'alice',
    language: String(o.language || process.env.TELEPHONY_VOICE_LANGUAGE || 'en-US').trim() || 'en-US',
  };
}

function sayTag(text, opts) {
  const { voice, language } = voiceOptions(opts);
  return `<Say voice="${xmlEscape(voice)}" language="${xmlEscape(language)}">${xmlEscape(
    speakable(text),
  )}</Say>`;
}

function document(inner) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;
}

/** Speak one line, then hang up — the safe default for every dead end. */
function buildSpeakLaml(message, opts) {
  return document(`${sayTag(message, opts)}<Hangup/>`);
}

const MESSAGES = {
  noSession:
    'No call is waiting on this line. Open Ad Hello, tap Call on the lead you want, then dial this number again.',
  noLead:
    'No call is waiting on this line. Open Ad Hello, tap Call on the lead you want, then dial this number again.',
  testOk:
    'Ad Hello dial in works. When you tap Call on a lead, dial this same number from your cell and we will connect the lead.',
  unauthorized:
    'Ad Hello phone routing is misconfigured. The webhook token on this number does not match the app, so we cannot look up your call. Update the number in Workspace, Phone settings, then try again.',
  error:
    'Ad Hello hit an error connecting this call. Nothing was dialed. Please tap Call in Ad Hello and dial in again.',
};

function buildNoSessionLaml(opts) {
  return buildSpeakLaml(MESSAGES.noSession, opts);
}

function buildNoLeadLaml(opts) {
  return buildSpeakLaml(MESSAGES.noLead, opts);
}

function buildTestDialInLaml(opts) {
  return buildSpeakLaml(MESSAGES.testOk, opts);
}

function buildUnauthorizedLaml(opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  return buildSpeakLaml(o.message || MESSAGES.unauthorized, o);
}

function buildErrorLaml(opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  return buildSpeakLaml(o.message || MESSAGES.error, o);
}

/**
 * Bridge the agent (already on the line) to the lead.
 * `actionUrl` is optional — it keeps the agent connected for the next queued lead.
 */
function buildBridgeLaml(opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const dialTo = String(o.dialTo || '').trim();
  if (!dialTo) return buildNoLeadLaml(o);
  const callerId = String(o.callerId || '').trim();
  const timeout = Number.isFinite(Number(o.timeoutSec)) && Number(o.timeoutSec) > 0 ? Number(o.timeoutSec) : 45;
  const actionUrl = String(o.actionUrl || '').trim();
  const attrs = [
    'answerOnBridge="true"',
    `timeout="${timeout}"`,
    callerId ? `callerId="${xmlEscape(callerId)}"` : '',
    actionUrl ? `action="${xmlEscape(actionUrl)}" method="POST"` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const intro = o.message === null ? '' : sayTag(o.message || 'Connecting the lead now.', o);
  return document(`${intro}<Dial ${attrs}><Number>${xmlEscape(dialTo)}</Number></Dial>`);
}

module.exports = {
  MESSAGES,
  xmlEscape,
  speakable,
  buildSpeakLaml,
  buildNoSessionLaml,
  buildNoLeadLaml,
  buildTestDialInLaml,
  buildUnauthorizedLaml,
  buildErrorLaml,
  buildBridgeLaml,
};
