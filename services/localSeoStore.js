/**
 * Local SEO research scoped to the workspace business profile.
 * Persists under workspace.localSeo (single active research bundle).
 */

const dbService = require('./database');
const { buildLocationName } = require('./localSeoParse');

function emptyLocalSeo(workspaceId) {
  return {
    workspaceId: String(workspaceId || ''),
    profile: {},
    research: null,
    actionPlan: null,
    chat: [],
    lastSyncedAt: null,
    syncStatus: 'new',
    updatedAt: new Date().toISOString(),
  };
}

async function load(workspaceId) {
  const wid = String(workspaceId || '').trim();
  if (!wid) return emptyLocalSeo('');
  const ws = (await dbService.getWorkspace(wid)) || { id: wid };
  const raw = ws.localSeo && typeof ws.localSeo === 'object' ? ws.localSeo : null;
  const base = emptyLocalSeo(wid);
  if (!raw) return { ...base, workspace: ws };
  return {
    ...base,
    ...raw,
    workspaceId: wid,
    profile: raw.profile && typeof raw.profile === 'object' ? raw.profile : {},
    chat: Array.isArray(raw.chat) ? raw.chat : [],
    workspace: ws,
  };
}

async function save(workspaceId, patch) {
  const wid = String(workspaceId || '').trim();
  const ws = (await dbService.getWorkspace(wid)) || { id: wid };
  const prev = ws.localSeo && typeof ws.localSeo === 'object' ? ws.localSeo : emptyLocalSeo(wid);
  const next = {
    ...prev,
    ...patch,
    workspaceId: wid,
    profile: {
      ...(prev.profile && typeof prev.profile === 'object' ? prev.profile : {}),
      ...((patch && patch.profile) || {}),
    },
    chat: Array.isArray(patch && patch.chat) ? patch.chat : prev.chat || [],
    updatedAt: new Date().toISOString(),
  };
  await dbService.saveWorkspace(wid, { ...ws, id: wid, localSeo: next });
  return { ...next, workspace: { ...ws, localSeo: next } };
}

/**
 * Resolve the business profile used for Local SEO research.
 * Prefer explicit localSeo.profile overrides, then workspace sales intake / ICP.
 */
function resolveBusinessProfile(workspace, profileOverrides) {
  const ws = workspace && typeof workspace === 'object' ? workspace : {};
  const intake = ws.salesIntake && typeof ws.salesIntake === 'object' ? ws.salesIntake : {};
  const o = profileOverrides && typeof profileOverrides === 'object' ? profileOverrides : {};
  const businessName = String(o.businessName || intake.businessName || ws.name || '').trim();
  const city = String(o.city || ws.icpCity || '').trim();
  const state = String(o.state || ws.icpState || intake.state || '').trim();
  const vertical = String(o.vertical || intake.vertical || '').trim();
  const website = String(o.website || intake.website || intake.auditLink || '').trim();
  const locationName = buildLocationName({
    city,
    state,
    locationName: o.locationName,
    country: 'United States',
  });
  const placeId = String(o.placeId || '').trim();
  const cid = String(o.cid || '').trim();
  const keywords = Array.isArray(o.keywords)
    ? o.keywords.map((k) => String(k || '').trim()).filter(Boolean).slice(0, 8)
    : String(o.keywordsText || '')
        .split(/\n|,/)
        .map((k) => k.trim())
        .filter(Boolean)
        .slice(0, 8);

  return {
    businessName,
    city,
    state,
    vertical,
    website,
    locationName,
    locationCode: Number(o.locationCode) || 2840,
    languageCode: String(o.languageCode || 'en').slice(0, 8),
    placeId,
    cid,
    keywords,
  };
}

module.exports = {
  emptyLocalSeo,
  load,
  save,
  resolveBusinessProfile,
};
