/**
 * Workspace-scoped sales scripts: offer catalog, reach scripts, merged libraries.
 */

const { mergeScriptLibrary, SCRIPT_SECTIONS } = require('./salesScriptsStorage');

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
  return {
    key,
    label,
    tabLabel,
    senderBusinessName: String(raw.senderBusinessName || '').trim().slice(0, MAX_LABEL_LEN),
    vertical: String(raw.vertical || '').trim().slice(0, 80),
    auditLink: String(raw.auditLink || '').trim().slice(0, 500),
  };
}

function defaultOfferCatalog(baseLib) {
  return Object.keys(baseLib || {}).map((key) => {
    const block = baseLib[key] || {};
    return {
      key,
      label: String(block.label || key).trim() || key,
      tabLabel: String(block.tabLabel || block.label || key).trim() || key,
    };
  });
}

function resolveWorkspaceOfferCatalog(ws, baseLib) {
  const custom = ws && Array.isArray(ws.salesScriptOfferCatalog) ? ws.salesScriptOfferCatalog : null;
  if (custom && custom.length) {
    const keys = new Set();
    return custom.map((row) => normalizeOfferCatalogEntry(row, keys)).filter(Boolean);
  }
  return defaultOfferCatalog(baseLib);
}

function emptyOfferBlock(entry) {
  const block = { label: entry.label, tabLabel: entry.tabLabel || entry.label };
  for (const sec of SCRIPT_SECTIONS) block[sec] = '';
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
  return defaultOfferCatalog(baseLib).map((row) => ({ ...row }));
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
    for (const sec of SCRIPT_SECTIONS) {
      if (!Object.prototype.hasOwnProperty.call(row, sec)) continue;
      let s = row[sec] == null ? '' : String(row[sec]);
      if (s.length > MAX_REACH_TEXT) s = s.slice(0, MAX_REACH_TEXT);
      block[sec] = s;
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
  patchOfferOutreachFields,
};
