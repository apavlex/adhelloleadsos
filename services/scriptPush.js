/**
 * Push offer scripts (call, SMS, email) from one workspace to other workspaces the user manages.
 * Pushed offers keep a `pushedFrom` link, so pushing again updates the same offer even after a rename.
 */

const dbService = require('./database');
const workspaceService = require('./workspaceService');
const workspaceBootstrap = require('./workspaceBootstrap');
const { SCRIPT_LIBRARY } = require('./salesConstants');
const { ALL_SCRIPT_SECTIONS, clampSectionText } = require('./salesScriptsStorage');
const {
  buildWorkspaceOfferLibrary,
  normalizeOfferCatalogEntry,
  resolveWorkspaceOfferCatalog,
} = require('./workspaceSalesScripts');

const SENDER_FIELDS = ['senderBusinessName', 'vertical', 'auditLink', 'serviceCities', 'serviceStates'];
const MAX_PUSH_LOG = 25;
const MAX_TARGETS = 50;

function canManage(ws, email) {
  return (
    !!ws &&
    !ws.archivedAt &&
    workspaceBootstrap.userCanAccessWorkspace(ws, email) &&
    workspaceService.canManageTeam(workspaceService.roleForEmail(ws, email))
  );
}

function isLinked(row, sourceWid, key) {
  return !!(row && row.pushedFrom && row.pushedFrom.workspaceId === sourceWid && row.pushedFrom.key === key);
}

function findMatch(catalog, sourceWid, source) {
  const linked = catalog.findIndex((r) => isLinked(r, sourceWid, source.key));
  if (linked >= 0) return linked;
  const sameKey = catalog.findIndex((r) => !r.pushedFrom && r.key === source.key);
  if (sameKey >= 0) return sameKey;
  const label = String(source.label || '').trim().toLowerCase();
  if (!label) return -1;
  return catalog.findIndex((r) => !r.pushedFrom && String(r.label || '').trim().toLowerCase() === label);
}

/** Workspaces (other than the source) this user can push scripts into. */
async function listPushTargets(email, sourceWid) {
  const source = await dbService.getWorkspace(sourceWid);
  const sourceKeys = source ? buildWorkspaceOfferLibrary(source, SCRIPT_LIBRARY).keys : [];
  const ids = await workspaceBootstrap.collectWorkspaceIdsForEmail(email);
  const out = [];
  for (const id of ids) {
    if (id === sourceWid) continue;
    const ws = await dbService.getWorkspace(id);
    if (!canManage(ws, email)) continue;
    const catalog = resolveWorkspaceOfferCatalog(ws, SCRIPT_LIBRARY);
    const linked = sourceKeys.filter((key) => catalog.some((r) => isLinked(r, sourceWid, key)));
    out.push({
      id: ws.id,
      name: ws.name || 'Workspace',
      slug: ws.slug || '',
      isDemo: !!ws.isDemo,
      offerCount: catalog.length,
      linkedKeys: linked,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Copy the chosen offers into each target. Matches, in order: an offer previously pushed from this
 * source offer, an offer with the same key, then one with the same name; otherwise adds a new offer.
 * Script text is replaced; the target's sender details are kept unless includeSender is set.
 */
async function pushOffers({ email, sourceWid, offerKeys, targetIds, includeSender = false }) {
  const source = await dbService.getWorkspace(sourceWid);
  if (!canManage(source, email)) return { ok: false, error: 'Manage permission required in this workspace.' };

  const bundle = buildWorkspaceOfferLibrary(source, SCRIPT_LIBRARY);
  const wanted = new Set((Array.isArray(offerKeys) ? offerKeys : []).map(String));
  const offers = bundle.catalog.filter((c) => wanted.has(c.key));
  if (!offers.length) return { ok: false, error: 'Pick at least one offer to push.' };

  const targets = [...new Set((Array.isArray(targetIds) ? targetIds : []).map(String))]
    .filter((id) => id && id !== sourceWid)
    .slice(0, MAX_TARGETS);
  if (!targets.length) return { ok: false, error: 'Pick at least one workspace to push to.' };

  const at = new Date().toISOString();
  const results = [];
  for (const tid of targets) {
    const target = await dbService.getWorkspace(tid);
    if (!canManage(target, email)) {
      results.push({ id: tid, name: (target && target.name) || tid, ok: false, error: 'No manage access' });
      continue;
    }
    const catalog = resolveWorkspaceOfferCatalog(target, SCRIPT_LIBRARY).map((r) => ({ ...r }));
    const overrides = { ...(target.salesScriptBlockOverrides || {}) };
    let created = 0;
    let updated = 0;
    for (const offer of offers) {
      const pushedFrom = { workspaceId: sourceWid, workspaceName: source.name || '', key: offer.key, at };
      const block = {};
      for (const sec of ALL_SCRIPT_SECTIONS) {
        block[sec] = clampSectionText(sec, (bundle.library[offer.key] || {})[sec] || '');
      }
      const idx = findMatch(catalog, sourceWid, offer);
      let row;
      if (idx >= 0) {
        row = { ...catalog[idx], label: offer.label, tabLabel: offer.tabLabel || offer.label, pushedFrom };
        if (includeSender) SENDER_FIELDS.forEach((f) => { row[f] = offer[f] || ''; });
        catalog[idx] = row;
        updated += 1;
      } else {
        const keys = new Set(catalog.map((r) => r.key));
        const seed = { label: offer.label, tabLabel: offer.tabLabel, pushedFrom };
        if (!keys.has(offer.key)) seed.key = offer.key;
        if (includeSender) SENDER_FIELDS.forEach((f) => { seed[f] = offer[f] || ''; });
        row = normalizeOfferCatalogEntry(seed, keys);
        if (!row) continue;
        catalog.push(row);
        created += 1;
      }
      overrides[row.key] = block;
    }
    target.salesScriptOfferCatalog = catalog;
    target.salesScriptBlockOverrides = overrides;
    target.salesScriptsUpdatedAt = at;
    if (!target.salesScriptsSeededAt) target.salesScriptsSeededAt = at;
    await dbService.saveWorkspace(tid, target);
    results.push({ id: tid, name: target.name || 'Workspace', ok: true, created, updated });
  }

  const fresh = (await dbService.getWorkspace(sourceWid)) || source;
  const log = Array.isArray(fresh.scriptPushLog) ? fresh.scriptPushLog : [];
  fresh.scriptPushLog = [
    {
      at,
      by: email,
      offers: offers.map((o) => ({ key: o.key, label: o.label })),
      includeSender: !!includeSender,
      results: results.map((r) => ({ id: r.id, name: r.name, ok: r.ok, created: r.created || 0, updated: r.updated || 0 })),
    },
    ...log,
  ].slice(0, MAX_PUSH_LOG);
  await dbService.saveWorkspace(sourceWid, fresh);

  return { ok: true, offers: offers.map((o) => ({ key: o.key, label: o.label })), results };
}

module.exports = { listPushTargets, pushOffers, findMatch };
