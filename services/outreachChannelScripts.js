/**
 * Map workspace script library sections to outreach channels (call, text, voicemail, email).
 */

const { htmlToMarkdown, htmlToPlain, looksLikeScriptHtml } = require('./scriptMarkup');

const CHANNELS = ['call', 'text', 'voicemail', 'email'];

function asChannelCopy(raw, channel) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const ch = String(channel || '').toLowerCase();
  if (ch === 'text') {
    // SMS must be plain text — never rich-editor HTML / Tailwind style dumps.
    if (looksLikeScriptHtml(s) || /<[a-z][\s\S]*>/i.test(s) || /--tw-/i.test(s)) {
      return htmlToPlain(s);
    }
    return s;
  }
  if (ch === 'voicemail' && looksLikeScriptHtml(s)) {
    return htmlToMarkdown(s);
  }
  return s;
}

function scriptForChannel(serviceDef, channel) {
  const def = serviceDef && typeof serviceDef === 'object' ? serviceDef : {};
  const opening = String(def.opening || '').trim();
  const discovery = String(def.discovery || '').trim();
  const valueProp = String(def.valueProp || '').trim();
  const objection = String(def.objectionHandling || '').trim();
  const close = String(def.close || '').trim();
  const sms = String(def.sms || '').trim();
  const email = String(def.email || '').trim();

  switch (String(channel || '').toLowerCase()) {
    case 'call': {
      const parts = [opening, discovery].filter(Boolean);
      return asChannelCopy(parts.join('\n\n'), 'call');
    }
    case 'text':
      return asChannelCopy(sms || opening || valueProp, 'text');
    case 'voicemail':
      return asChannelCopy(opening || valueProp, 'voicemail');
    case 'email': {
      const body = email || valueProp || opening;
      if (!body) return '';
      return asChannelCopy(body, 'email');
    }
    default:
      return asChannelCopy(opening, channel);
  }
}

function buildOutreachLibrary(mergedLibrary, keys) {
  const library = {};
  (keys || []).forEach((key) => {
    const def = mergedLibrary[key];
    if (!def) return;
    const channels = {};
    CHANNELS.forEach((ch) => {
      const text = scriptForChannel(def, ch);
      if (text) channels[ch] = text;
    });
    library[key] = {
      label: def.label || key,
      channels,
    };
  });
  return library;
}

module.exports = {
  CHANNELS,
  scriptForChannel,
  buildOutreachLibrary,
};
