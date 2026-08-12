/**
 * Seed workspace-scoped sales scripts on create and lazy-migrate workspaces
 * that still rely on the global agency SCRIPT_LIBRARY fallback.
 */
const dbService = require('./database');
const { SCRIPT_PRESETS } = require('../config/workspaceScriptPresets');
const { sanitizeOfferCatalogInput } = require('./workspaceSalesScripts');

const KNOWN_PRESET_KEYS = new Set(Object.keys(SCRIPT_PRESETS));

function inferScriptPresetKey(ws) {
  ws = ws || {};
  const intake = ws.pipelineIntake && typeof ws.pipelineIntake === 'object' ? ws.pipelineIntake : {};
  const preset = String(intake.presetKey || '').trim().toLowerCase();
  if (preset && KNOWN_PRESET_KEYS.has(preset)) return preset;

  const slug = String(ws.slug || '').toLowerCase();
  const name = String(ws.name || '').toLowerCase();
  const coach = String(ws.coachPrompt || '').toLowerCase();
  const keyword = String((ws.icp && ws.icp.keyword) || ws.icpKeyword || '').toLowerCase();
  const bizDesc = String(intake.businessDescription || '').toLowerCase();

  if (
    slug.includes('adhello-agency') ||
    slug.includes('adhello') ||
    name.includes('adhello agency') ||
    coach.includes('digital ad agency')
  ) {
    return 'agency';
  }
  if (
    name.includes('flooring') ||
    coach.includes('flooring') ||
    keyword.includes('flooring') ||
    bizDesc.includes('flooring') ||
    coach.includes('retail/install')
  ) {
    return 'retail_install';
  }
  if (coach.includes('saas') || bizDesc.includes('saas') || preset === 'saas') return 'saas';
  if (preset === 'ecommerce_b2b') return 'ecommerce_b2b';
  if (coach.includes('local service') || preset === 'local_service') return 'local_service';

  return 'local_service';
}

function buildWorkspaceScriptSeed(ws, presetKeyOverride) {
  const presetKey = presetKeyOverride || inferScriptPresetKey(ws);
  const preset = SCRIPT_PRESETS[presetKey] || SCRIPT_PRESETS.local_service;
  const businessName = String((ws && ws.name) || '').trim();

  const catalog = preset.catalog.map((row) => {
    const entry = { ...row };
    if (businessName && !entry.senderBusinessName && presetKey === 'retail_install') {
      entry.senderBusinessName = businessName;
    }
    return entry;
  });

  return {
    presetKey,
    salesScriptOfferCatalog: catalog,
    salesScriptBlockOverrides: { ...preset.blockOverrides },
  };
}

function applyScriptSeedToWorkspace(doc, seed) {
  if (!doc || !seed) return doc;
  doc.salesScriptOfferCatalog = sanitizeOfferCatalogInput(seed.salesScriptOfferCatalog || []);
  doc.salesScriptBlockOverrides =
    seed.salesScriptBlockOverrides && typeof seed.salesScriptBlockOverrides === 'object'
      ? { ...seed.salesScriptBlockOverrides }
      : {};
  doc.salesScriptsPresetKey = seed.presetKey || inferScriptPresetKey(doc);
  doc.salesScriptsSeededAt = new Date().toISOString();
  return doc;
}

function copyLegacyScriptFields(target, source) {
  if (!source || typeof source !== 'object') return;
  if (Array.isArray(source.salesScriptOfferCatalog) && source.salesScriptOfferCatalog.length) {
    target.salesScriptOfferCatalog = source.salesScriptOfferCatalog.map((row) => ({ ...row }));
  }
  if (source.salesScriptBlockOverrides && typeof source.salesScriptBlockOverrides === 'object') {
    target.salesScriptBlockOverrides = { ...source.salesScriptBlockOverrides };
  }
  if (Array.isArray(source.salesScriptLibraryItems)) {
    target.salesScriptLibraryItems = source.salesScriptLibraryItems.map((row) => ({ ...row }));
  }
  if (source.reachScripts && typeof source.reachScripts === 'object') {
    target.reachScripts = JSON.parse(JSON.stringify(source.reachScripts));
  }
  if (source.salesScriptsSeededAt) target.salesScriptsSeededAt = source.salesScriptsSeededAt;
  if (source.salesScriptsPresetKey) target.salesScriptsPresetKey = source.salesScriptsPresetKey;
}

function workspaceHasScriptCatalog(ws) {
  return !!(ws && Array.isArray(ws.salesScriptOfferCatalog) && ws.salesScriptOfferCatalog.length);
}

function workspaceScriptsAlreadySeeded(ws) {
  return !!(ws && ws.salesScriptsSeededAt);
}

/**
 * @param {object} ws workspace document (mutated in memory; caller saves)
 * @param {{ presetKey?: string }} [options]
 */
function seedWorkspaceScriptsOnCreate(ws, options = {}) {
  if (!ws || typeof ws !== 'object') return ws;
  if (workspaceHasScriptCatalog(ws) || workspaceScriptsAlreadySeeded(ws)) return ws;
  const presetKey =
    options.presetKey ||
    (ws.pipelineIntake && ws.pipelineIntake.presetKey) ||
    inferScriptPresetKey(ws);
  const seed = buildWorkspaceScriptSeed(ws, String(presetKey || '').trim() || undefined);
  return applyScriptSeedToWorkspace(ws, seed);
}

/**
 * Idempotent: ensures workspace has its own offer catalog (not global fallback).
 * @param {string} workspaceId
 */
async function ensureWorkspaceScriptsSeeded(workspaceId) {
  const wid = String(workspaceId || '').trim();
  if (!wid) return null;

  let ws = await dbService.getWorkspace(wid);
  if (!ws) return null;

  if (workspaceScriptsAlreadySeeded(ws)) return ws;

  if (workspaceHasScriptCatalog(ws)) {
    const next = {
      ...ws,
      salesScriptsSeededAt: ws.salesScriptsUpdatedAt || new Date().toISOString(),
      salesScriptsPresetKey: ws.salesScriptsPresetKey || inferScriptPresetKey(ws),
    };
    await dbService.saveWorkspace(wid, next);
    return next;
  }

  const seeded = seedWorkspaceScriptsOnCreate({ ...ws });
  await dbService.saveWorkspace(wid, seeded);
  return seeded;
}

module.exports = {
  inferScriptPresetKey,
  buildWorkspaceScriptSeed,
  applyScriptSeedToWorkspace,
  copyLegacyScriptFields,
  seedWorkspaceScriptsOnCreate,
  ensureWorkspaceScriptsSeeded,
  workspaceHasScriptCatalog,
  workspaceScriptsAlreadySeeded,
};
