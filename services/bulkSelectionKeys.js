const { shortLeadKey } = require('./focusQueue');

function parseBulkSelectionKeys(raw) {
  const text = String(raw || '').trim();
  if (!text) return [];
  const seen = new Set();
  const keys = [];
  text.split(',').forEach((part) => {
    const key = String(part || '').trim().replace(/^lead:/i, '');
    if (!key || seen.has(key)) return;
    seen.add(key);
    keys.push(key);
  });
  return keys;
}

function orderLeadsByKeys(leads, keyOrder) {
  if (!Array.isArray(keyOrder) || !keyOrder.length) return null;
  const byKey = new Map();
  (Array.isArray(leads) ? leads : []).forEach((l) => {
    if (!l) return;
    const raw = String(l.key || '').trim();
    const short = shortLeadKey(l);
    [short, raw, raw.replace(/^lead:/i, ''), short ? `lead:${short}` : ''].forEach((k) => {
      if (k) byKey.set(k, l);
    });
  });
  return keyOrder.map((k) => byKey.get(k)).filter(Boolean);
}

module.exports = {
  parseBulkSelectionKeys,
  orderLeadsByKeys,
};
