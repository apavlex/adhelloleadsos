/**
 * Map workspace script library sections to outreach channels (call, text, voicemail, email).
 */

const CHANNELS = ['call', 'text', 'voicemail', 'email'];

function scriptForChannel(serviceDef, channel) {
  const def = serviceDef && typeof serviceDef === 'object' ? serviceDef : {};
  const opening = String(def.opening || '').trim();
  const discovery = String(def.discovery || '').trim();
  const valueProp = String(def.valueProp || '').trim();
  const objection = String(def.objectionHandling || '').trim();
  const close = String(def.close || '').trim();

  switch (String(channel || '').toLowerCase()) {
    case 'call': {
      const parts = [opening, discovery].filter(Boolean);
      return parts.join('\n\n');
    }
    case 'text':
      return opening || valueProp;
    case 'voicemail':
      return opening || valueProp;
    case 'email': {
      const body = valueProp || opening;
      if (!body) return '';
      return body;
    }
    default:
      return opening;
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
