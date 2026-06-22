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

/**
 * Resolve explicitly selected leads for bulk actions (Focus, direct mail, etc.).
 * Searches all workspace-visible leads first (includes foldered pipeline rows), then
 * falls back to direct DB lookup for any keys still missing.
 */
async function resolveLeadsBySelectedKeys({ dbService, workspaceId, visibleLeads, keyOrder }) {
  const order = parseBulkSelectionKeys(Array.isArray(keyOrder) ? keyOrder.join(',') : keyOrder);
  if (!order.length) return [];

  let matched = orderLeadsByKeys(visibleLeads, order) || [];
  if (matched.length >= order.length) return matched;

  const found = new Set(matched.map((l) => shortLeadKey(l)));
  const extras = [];
  for (const k of order) {
    if (found.has(k)) continue;
    const storageKey = k.startsWith('lead:') ? k : `lead:${k}`;
    // eslint-disable-next-line no-await-in-loop
    const lead = await dbService.getLead(storageKey);
    if (!lead) continue;
    // eslint-disable-next-line no-await-in-loop
    const belongs = await dbService.leadBelongsToWorkspace(lead, workspaceId);
    if (!belongs) continue;
    extras.push({ ...lead, key: lead.key || storageKey });
    found.add(shortLeadKey(lead));
  }

  if (extras.length) {
    matched = orderLeadsByKeys([...(visibleLeads || []), ...extras], order) || [];
  }

  return matched;
}

module.exports = {
  parseBulkSelectionKeys,
  orderLeadsByKeys,
  resolveLeadsBySelectedKeys,
};
