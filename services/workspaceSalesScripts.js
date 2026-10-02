/**
 * Workspace-scoped sales scripts: offer catalog, reach scripts, merged libraries.
 */

const { mergeScriptLibrary, ALL_SCRIPT_SECTIONS, clampSectionText } = require('./salesScriptsStorage');

const MAX_OFFER_KEY_LEN = 64;
const MAX_LABEL_LEN = 120;
const MAX_REACH_TEXT = 24_000;
const MAX_FB_POSTS = 12;

function slugifyOfferKey(label) {
  const base = String(label || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return base || 'offer';
}

function normalizeOfferCatalogEntry(raw, existingKeys) {
  if (!raw || typeof raw !== 'object') return null;
  let key = String(raw.key || '').trim();
  const label = String(raw.label || '').trim().slice(0, MAX_LABEL_LEN);
  if (!label) return null;
  if (!key) {
    const slug = slugifyOfferKey(label);
    key = slug;
    let n = 2;
    while (existingKeys.has(key)) {
      key = `${slug}_${n}`;
      n += 1;
    }
  }
  key = key.slice(0, MAX_OFFER_KEY_LEN);
  if (!/^[a-z][a-z0-9_]*$/i.test(key)) return null;
  existingKeys.add(key);
  const tabLabel = String(raw.tabLabel || raw.label || label).trim().slice(0, MAX_LABEL_LEN) || label;
  const pushedFrom = normalizePushedFrom(raw.pushedFrom);
  return {
    key,
    label,
    tabLabel,
    senderBusinessName: String(raw.senderBusinessName || '').trim().slice(0, MAX_LABEL_LEN),
    vertical: String(raw.vertical || '').trim().slice(0, 80),
    auditLink: String(raw.auditLink || '').trim().slice(0, 500),
    serviceCities: String(raw.serviceCities || '').trim().slice(0, 400),
    serviceStates: String(raw.serviceStates || '').trim().slice(0, 80),
    ...(pushedFrom ? { pushedFrom } : {}),
  };
}

/** Link from an offer copied in by "Push to workspaces" back to its source offer. */
function normalizePushedFrom(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const workspaceId = String(raw.workspaceId || '').trim().slice(0, 80);
  const key = String(raw.key || '').trim().slice(0, MAX_OFFER_KEY_LEN);
  if (!workspaceId || !key) return null;
  return {
    workspaceId,
    workspaceName: String(raw.workspaceName || '').trim().slice(0, MAX_LABEL_LEN),
    key,
    at: String(raw.at || '').slice(0, 40),
  };
}

function resolveWorkspaceOfferCatalog(ws, baseLib) {
  const custom = ws && Array.isArray(ws.salesScriptOfferCatalog) ? ws.salesScriptOfferCatalog : null;
  if (custom && custom.length) {
    const keys = new Set();
    return custom.map((row) => normalizeOfferCatalogEntry(row, keys)).filter(Boolean);
  }
  // Do not fall back to global agency SCRIPT_LIBRARY — each workspace owns its catalog.
  return [];
}

function emptyOfferBlock(entry) {
  const block = { label: entry.label, tabLabel: entry.tabLabel || entry.label };
  for (const sec of ALL_SCRIPT_SECTIONS) block[sec] = '';
  return block;
}

function buildWorkspaceOfferLibrary(ws, baseLib) {
  const catalog = resolveWorkspaceOfferCatalog(ws, baseLib);
  const keys = catalog.map((c) => c.key);
  const baseSubset = {};
  catalog.forEach((entry) => {
    baseSubset[entry.key] = baseLib[entry.key]
      ? { ...baseLib[entry.key] }
      : emptyOfferBlock(entry);
    baseSubset[entry.key].label = entry.label;
    baseSubset[entry.key].tabLabel = entry.tabLabel || entry.label;
  });
  const overrides =
    ws && ws.salesScriptBlockOverrides && typeof ws.salesScriptBlockOverrides === 'object'
      ? ws.salesScriptBlockOverrides
      : {};
  const library = mergeScriptLibrary(baseSubset, overrides);
  catalog.forEach((entry) => {
    if (library[entry.key]) {
      library[entry.key].label = entry.label;
      library[entry.key].tabLabel = entry.tabLabel || entry.label;
    }
  });
  return { library, keys, catalog };
}

function sanitizeOfferCatalogInput(arr) {
  if (!Array.isArray(arr)) return [];
  const keys = new Set();
  const out = [];
  for (const row of arr) {
    const one = normalizeOfferCatalogEntry(row, keys);
    if (one) out.push(one);
  }
  return out;
}

/** Copy default catalog into a mutable array when workspace has no custom catalog yet. */
function materializeOfferCatalog(ws, baseLib) {
  if (Array.isArray(ws.salesScriptOfferCatalog) && ws.salesScriptOfferCatalog.length) {
    return ws.salesScriptOfferCatalog.map((row) => ({ ...row }));
  }
  return [];
}

const OFFER_NAME_STOPWORDS = new Set([
  'the', 'for', 'and', 'with', 'to', 'of', 'a', 'an', 'my', 'our',
  'script', 'scripts', 'offer', 'offers', 'sms', 'text', 'email', 'call', 'template',
]);

function offerNameTokens(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length >= 3 && !OFFER_NAME_STOPWORDS.has(t));
}

/** Match "overflow" or "The Overflow (siding)" to the "Overflow Referral" offer. Null when unclear. */
function findOfferByName(catalog, ref) {
  const rows = Array.isArray(catalog) ? catalog : [];
  const raw = String(ref || '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const exact = rows.find(
    (r) => r.key === raw || String(r.label || '').toLowerCase() === lower || String(r.tabLabel || '').toLowerCase() === lower,
  );
  if (exact) return exact;
  const want = offerNameTokens(raw);
  if (!want.length) return null;
  let best = null;
  let bestScore = 0;
  let tie = false;
  for (const r of rows) {
    const have = new Set([...offerNameTokens(r.label), ...offerNameTokens(r.tabLabel), ...offerNameTokens(r.key)]);
    const score = want.filter((t) => have.has(t)).length;
    if (score > bestScore) {
      best = r;
      bestScore = score;
      tie = false;
    } else if (score && score === bestScore) {
      tie = true;
    }
  }
  return bestScore && !tie ? best : null;
}

/**
 * Re-add offers the open page still shows but the stored catalog lost, so typing into
 * them saves instead of vanishing. Only keys being saved are restored. Returns restored keys.
 */
function restoreMissingOffers(ws, wantedKeys, clientOffers) {
  if (!ws || !Array.isArray(clientOffers) || !clientOffers.length) return [];
  const catalog = Array.isArray(ws.salesScriptOfferCatalog) ? ws.salesScriptOfferCatalog.slice() : [];
  const have = new Set(catalog.map((row) => row && row.key));
  const wanted = new Set((wantedKeys || []).map((k) => String(k || '').trim()));
  const restored = [];
  for (const raw of clientOffers.slice(0, 50)) {
    const key = raw && String(raw.key || '').trim();
    if (!key || have.has(key) || !wanted.has(key)) continue;
    const entry = normalizeOfferCatalogEntry({ ...raw, key }, have);
    if (!entry) continue;
    catalog.push(entry);
    restored.push(key);
  }
  if (restored.length) ws.salesScriptOfferCatalog = catalog;
  return restored;
}

function patchOfferOutreachFields(row, profile) {
  const base = row && typeof row === 'object' ? row : {};
  const p = profile && typeof profile === 'object' ? profile : {};
  return {
    ...base,
    senderBusinessName: Object.prototype.hasOwnProperty.call(p, 'senderBusinessName')
      ? String(p.senderBusinessName || '').trim().slice(0, MAX_LABEL_LEN)
      : String(base.senderBusinessName || '').trim().slice(0, MAX_LABEL_LEN),
    vertical: Object.prototype.hasOwnProperty.call(p, 'vertical')
      ? String(p.vertical || '').trim().slice(0, 80)
      : String(base.vertical || '').trim().slice(0, 80),
    auditLink: Object.prototype.hasOwnProperty.call(p, 'auditLink')
      ? String(p.auditLink || '').trim().slice(0, 500)
      : String(base.auditLink || '').trim().slice(0, 500),
    serviceCities: Object.prototype.hasOwnProperty.call(p, 'serviceCities')
      ? String(p.serviceCities || '').trim().slice(0, 400)
      : String(base.serviceCities || '').trim().slice(0, 400),
    serviceStates: Object.prototype.hasOwnProperty.call(p, 'serviceStates')
      ? String(p.serviceStates || '').trim().slice(0, 80)
      : String(base.serviceStates || '').trim().slice(0, 80),
  };
}

function sanitizeBlockOverridesForCatalog(input, catalogKeys) {
  const allow = new Set(catalogKeys || []);
  const src = input && typeof input === 'object' ? input : {};
  const out = {};
  for (const k of Object.keys(src)) {
    if (!allow.has(k)) continue;
    const row = src[k];
    if (!row || typeof row !== 'object') continue;
    const block = {};
    for (const sec of ALL_SCRIPT_SECTIONS) {
      if (!Object.prototype.hasOwnProperty.call(row, sec)) continue;
      block[sec] = clampSectionText(sec, row[sec]);
    }
    if (Object.keys(block).length) out[k] = block;
  }
  return out;
}

function trimReachText(raw) {
  return String(raw == null ? '' : raw).slice(0, MAX_REACH_TEXT);
}

function resolveArmsReachScripts(ws, defaults) {
  const d = defaults || {};
  const stored = ws && ws.reachScripts && ws.reachScripts.armsReach ? ws.reachScripts.armsReach : {};
  const fbDefault = Array.isArray(d.facebookPosts) ? d.facebookPosts : [];
  const fbStored = Array.isArray(stored.facebookPosts) ? stored.facebookPosts.map(trimReachText) : [];
  const facebookPosts = fbStored.length ? fbStored : fbDefault.map(trimReachText);
  return {
    facebookPosts: facebookPosts.slice(0, MAX_FB_POSTS),
    referralSeed: trimReachText(stored.referralSeed || d.referralSeed || ''),
    defaultOwner: String(stored.defaultOwner || d.defaultOwner || '').trim().slice(0, 80),
    defaultReferrer: String(stored.defaultReferrer || d.defaultReferrer || '').trim().slice(0, 120),
    referralMessage: trimReachText(stored.referralMessage || ''),
  };
}

function sanitizeArmsReachPatch(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  if (Array.isArray(src.facebookPosts)) {
    out.facebookPosts = src.facebookPosts
      .map(trimReachText)
      .filter((t) => t.length > 0)
      .slice(0, MAX_FB_POSTS);
  }
  if (src.referralSeed != null) out.referralSeed = trimReachText(src.referralSeed);
  if (src.defaultOwner != null) out.defaultOwner = String(src.defaultOwner).trim().slice(0, 80);
  if (src.defaultReferrer != null) out.defaultReferrer = String(src.defaultReferrer).trim().slice(0, 120);
  if (src.referralMessage != null) out.referralMessage = trimReachText(src.referralMessage);
  return out;
}

function resolveCarsReachSpecialties(ws, defaults) {
  const list = defaults && Array.isArray(defaults.specialties) ? defaults.specialties : [];
  const stored =
    ws && ws.reachScripts && ws.reachScripts.carsReach && Array.isArray(ws.reachScripts.carsReach.specialties)
      ? ws.reachScripts.carsReach.specialties
      : null;
  if (stored && stored.length) {
    const keys = new Set();
    return stored
      .map((row) => {
        const key = String(row && row.key ? row.key : '')
          .trim()
          .slice(0, 64);
        const label = String(row && row.label ? row.label : '')
          .trim()
          .slice(0, MAX_LABEL_LEN);
        if (!key || !label || keys.has(key)) return null;
        keys.add(key);
        return { key, label };
      })
      .filter(Boolean);
  }
  return list.map((s) => ({ key: s.key, label: s.label }));
}

function resolveCarsReachSaved(ws) {
  const stored =
    ws && ws.reachScripts && ws.reachScripts.carsReach && ws.reachScripts.carsReach.saved
      ? ws.reachScripts.carsReach.saved
      : {};
  return {
    elevator: trimReachText(stored.elevator),
    followup: trimReachText(stored.followup),
    appointment: trimReachText(stored.appointment),
    elevatorName: String(stored.elevatorName || '').trim().slice(0, 80),
    followTheirName: String(stored.followTheirName || '').trim().slice(0, 80),
    followBusiness: String(stored.followBusiness || '').trim().slice(0, 120),
    followWhere: String(stored.followWhere || '').trim().slice(0, 120),
    apptTime: String(stored.apptTime || '').trim().slice(0, 80),
    elevatorSpecialty: String(stored.elevatorSpecialty || '').trim().slice(0, 64),
  };
}

function sanitizeCarsReachPatch(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  if (Array.isArray(src.specialties)) {
    const keys = new Set();
    out.specialties = src.specialties
      .map((row) => {
        const key = String(row && row.key ? row.key : slugifyOfferKey(row && row.label))
          .trim()
          .slice(0, 64);
        const label = String(row && row.label ? row.label : '')
          .trim()
          .slice(0, MAX_LABEL_LEN);
        if (!key || !label || keys.has(key)) return null;
        keys.add(key);
        return { key, label };
      })
      .filter(Boolean);
  }
  if (src.saved && typeof src.saved === 'object') {
    const saved = {};
    const fields = [
      'elevator',
      'followup',
      'appointment',
      'elevatorName',
      'followTheirName',
      'followBusiness',
      'followWhere',
      'apptTime',
      'elevatorSpecialty',
    ];
    fields.forEach((f) => {
      if (src.saved[f] != null) {
        saved[f] =
          f === 'elevator' || f === 'followup' || f === 'appointment'
            ? trimReachText(src.saved[f])
            : String(src.saved[f]).trim().slice(0, 120);
      }
    });
    if (Object.keys(saved).length) out.saved = saved;
  }
  return out;
}

function resolveUpworkServices(ws, defaults) {
  const list = defaults && Array.isArray(defaults) ? defaults : [];
  const stored =
    ws && ws.reachScripts && ws.reachScripts.computersReach && Array.isArray(ws.reachScripts.computersReach.services)
      ? ws.reachScripts.computersReach.services
      : null;
  if (stored && stored.length) {
    const keys = new Set();
    return stored
      .map((row) => {
        const key = String(row && row.key ? row.key : '')
          .trim()
          .slice(0, 64);
        const label = String(row && row.label ? row.label : '')
          .trim()
          .slice(0, MAX_LABEL_LEN);
        if (!key || !label || keys.has(key)) return null;
        keys.add(key);
        return { key, label };
      })
      .filter(Boolean);
  }
  return list.map((s) => ({ key: s.key, label: s.label }));
}

function sanitizeComputersReachPatch(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  if (!Array.isArray(src.services)) return {};
  const keys = new Set();
  return {
    services: src.services
      .map((row) => {
        const key = String(row && row.key ? row.key : slugifyOfferKey(row && row.label))
          .trim()
          .slice(0, 64);
        const label = String(row && row.label ? row.label : '')
          .trim()
          .slice(0, MAX_LABEL_LEN);
        if (!key || !label || keys.has(key)) return null;
        keys.add(key);
        return { key, label };
      })
      .filter(Boolean),
  };
}

function mergeReachScripts(ws, section, patch) {
  const next = { ...(ws.reachScripts && typeof ws.reachScripts === 'object' ? ws.reachScripts : {}) };
  const prev = next[section] && typeof next[section] === 'object' ? next[section] : {};
  const merged = { ...prev, ...patch };
  if (section === 'carsReach' && patch.saved && prev.saved) {
    merged.saved = { ...prev.saved, ...patch.saved };
  }
  next[section] = merged;
  return next;
}

module.exports = {
  MAX_FB_POSTS,
  resolveWorkspaceOfferCatalog,
  buildWorkspaceOfferLibrary,
  sanitizeOfferCatalogInput,
  sanitizeBlockOverridesForCatalog,
  resolveArmsReachScripts,
  sanitizeArmsReachPatch,
  resolveCarsReachSpecialties,
  resolveCarsReachSaved,
  sanitizeCarsReachPatch,
  resolveUpworkServices,
  sanitizeComputersReachPatch,
  mergeReachScripts,
  slugifyOfferKey,
  normalizeOfferCatalogEntry,
  materializeOfferCatalog,
  restoreMissingOffers,
  findOfferByName,
  patchOfferOutreachFields,
};
