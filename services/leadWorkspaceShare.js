/**
 * Copy (share) leads from one workspace into other workspaces the user manages.
 * Modeled on scriptPush — copy only; source leads stay put.
 */

const dbService = require('./database');
const workspaceService = require('./workspaceService');
const workspaceBootstrap = require('./workspaceBootstrap');

const MAX_TARGETS = 25;
const MAX_LEADS = 200;
const MAX_SHARE_LOG = 25;

/** Workspace-local / integration fields that must not be copied into the target. */
const STRIP_KEYS = new Set([
  'key',
  'workspaceId',
  'createdAt',
  'updatedAt',
  'folderKey',
  'folderName',
  'stageId',
  'pipelineStage',
  'pipelineSchemaVersion',
  'opportunityPipelineId',
  'opportunityStageId',
  'onPipelineBoard',
  'assignedTo',
  'assignedAt',
  'assignedBy',
  'tags',
  'tagKeys',
  'bookmarked',
  'bookmarkFolderKey',
  'ghlContactId',
  'ghlOpportunityId',
  'ghlLocationId',
  'ghlSyncedAt',
  'ghlSyncError',
  'ghlLastPushAt',
  'sequenceState',
  'sequenceId',
  'sequencePersona',
  'cadenceId',
  'cadenceState',
  'autoOutreach',
  'autoOutreachAt',
  'doNotCall',
  'dedupeKey',
  'emailNorm',
  'domainNorm',
  'phoneNorm',
  'nameNorm',
  'geoNorm',
  'mapsPlaceKey',
  'legacyStageNumber',
  'sharedFrom',
  'sharedTo',
  'contactFinder',
  'lastContactHuntAt',
  'forceFolderKey',
]);

/** Owner, admin, or manager on the workspace (same bar as lead assignment). */
function canShareLeads(ws, email) {
  return (
    !!ws &&
    !ws.archivedAt &&
    workspaceBootstrap.userCanAccessWorkspace(ws, email) &&
    workspaceService.canAssignWork(workspaceService.roleForEmail(ws, email))
  );
}

function str(v) {
  return String(v == null ? '' : v).trim();
}

function normalizeLeadKey(raw) {
  const s = str(raw);
  if (!s) return '';
  return s.startsWith('lead:') ? s : `lead:${s}`;
}

/**
 * Build a clean lead payload for the target workspace.
 * @param {object} source
 * @param {{ sourceWid: string, sourceName: string, by: string, folderKey?: string }} meta
 */
function buildSharedLeadPayload(source, meta) {
  const out = {};
  for (const [k, v] of Object.entries(source || {})) {
    if (STRIP_KEYS.has(k)) continue;
    if (v === undefined) continue;
    out[k] = v;
  }
  out.workspaceId = meta.targetWid;
  out.source = out.source || 'workspace_share';
  out.sourceChannel = out.sourceChannel || 'workspace_share';
  if (meta.folderKey) {
    out.folderKey = meta.folderKey;
    out.forceFolderKey = true;
  }
  out.sharedFrom = {
    workspaceId: meta.sourceWid,
    workspaceName: meta.sourceName || '',
    leadKey: source.key || '',
    by: meta.by || '',
    at: meta.at,
  };
  const note = `Shared from ${meta.sourceName || 'another workspace'}${source.title ? `: ${source.title}` : ''}`;
  const logs = Array.isArray(out.logs) ? out.logs.slice(-20) : [];
  out.logs = [
    ...logs,
    { type: 'share_in', message: note, timestamp: meta.at },
  ].slice(-40);
  return out;
}

/** Workspaces (other than the source) this user can share leads into. */
async function listShareTargets(email, sourceWid) {
  const ids = await workspaceBootstrap.collectWorkspaceIdsForEmail(email);
  const out = [];
  for (const id of ids) {
    if (id === sourceWid) continue;
    const ws = await dbService.getWorkspace(id);
    if (!canShareLeads(ws, email)) continue;
    out.push({
      id: ws.id,
      name: ws.name || 'Workspace',
      slug: ws.slug || '',
      isDemo: !!ws.isDemo,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Copy selected leads into each target workspace.
 * @param {{
 *   email: string,
 *   sourceWid: string,
 *   leadKeys: string[],
 *   targetIds: string[],
 *   folderKey?: string,
 * }} opts
 */
async function shareLeadsToWorkspaces(opts) {
  const email = str(opts.email).toLowerCase();
  const sourceWid = str(opts.sourceWid);
  const source = await dbService.getWorkspace(sourceWid);
  if (!canShareLeads(source, email)) {
    return { ok: false, error: 'Owner, admin, or manager permission required in this workspace.' };
  }

  const keys = [...new Set((Array.isArray(opts.leadKeys) ? opts.leadKeys : []).map(normalizeLeadKey).filter(Boolean))].slice(
    0,
    MAX_LEADS,
  );
  if (!keys.length) return { ok: false, error: 'Pick at least one lead to share.' };

  const targets = [...new Set((Array.isArray(opts.targetIds) ? opts.targetIds : []).map(String))]
    .filter((id) => id && id !== sourceWid)
    .slice(0, MAX_TARGETS);
  if (!targets.length) return { ok: false, error: 'Pick at least one workspace to share to.' };

  const folderKey = str(opts.folderKey) || '';
  const at = new Date().toISOString();
  const sourceName = (source && source.name) || 'Workspace';

  const loaded = [];
  for (const key of keys) {
    const lead = await dbService.getLead(key, sourceWid);
    if (!lead) continue;
    if (str(lead.workspaceId) && str(lead.workspaceId) !== sourceWid) continue;
    loaded.push(lead);
  }
  if (!loaded.length) return { ok: false, error: 'None of the selected leads were found in this workspace.' };

  const results = [];
  for (const tid of targets) {
    const target = await dbService.getWorkspace(tid);
    if (!canShareLeads(target, email)) {
      results.push({
        id: tid,
        name: (target && target.name) || tid,
        ok: false,
        error: 'Need owner, admin, or manager on that workspace',
      });
      continue;
    }
    let created = 0;
    let merged = 0;
    let failed = 0;
    const copiedKeys = [];
    for (const lead of loaded) {
      try {
        const payload = buildSharedLeadPayload(lead, {
          sourceWid,
          sourceName,
          targetWid: tid,
          by: email,
          at,
          folderKey: folderKey || undefined,
        });
        const saved = await dbService.saveLeadWithMeta(payload);
        if (saved && saved.merged) merged += 1;
        else created += 1;
        if (saved && saved.key) copiedKeys.push(saved.key);
      } catch (e) {
        failed += 1;
        console.warn('[leadWorkspaceShare] copy failed:', e && e.message);
      }
    }
    results.push({
      id: tid,
      name: target.name || 'Workspace',
      ok: failed < loaded.length,
      created,
      merged,
      failed,
      copied: created + merged,
    });
  }

  // Annotate source leads that they were shared out.
  const okTargets = results.filter((r) => r.ok);
  if (okTargets.length) {
    for (const lead of loaded) {
      try {
        const sharedTo = Array.isArray(lead.sharedTo) ? lead.sharedTo.slice(-19) : [];
        sharedTo.push({
          at,
          by: email,
          targets: okTargets.map((r) => ({ id: r.id, name: r.name, created: r.created, merged: r.merged })),
        });
        await dbService.updateLead(
          lead.key,
          {
            sharedTo,
            logs: [
              {
                type: 'share_out',
                message: `Shared to ${okTargets.map((r) => r.name).join(', ')}`,
                timestamp: at,
              },
            ],
          },
          sourceWid,
        );
      } catch (e) {
        console.warn('[leadWorkspaceShare] source annotate failed:', e && e.message);
      }
    }
  }

  const fresh = (await dbService.getWorkspace(sourceWid)) || source;
  const log = Array.isArray(fresh.leadShareLog) ? fresh.leadShareLog : [];
  fresh.leadShareLog = [
    {
      at,
      by: email,
      leadCount: loaded.length,
      results: results.map((r) => ({
        id: r.id,
        name: r.name,
        ok: r.ok,
        created: r.created || 0,
        merged: r.merged || 0,
        failed: r.failed || 0,
      })),
    },
    ...log,
  ].slice(0, MAX_SHARE_LOG);
  await dbService.saveWorkspace(sourceWid, fresh);

  return {
    ok: true,
    leadCount: loaded.length,
    results,
  };
}

module.exports = {
  listShareTargets,
  shareLeadsToWorkspaces,
  buildSharedLeadPayload,
  canShareLeads,
  STRIP_KEYS,
  MAX_LEADS,
  MAX_TARGETS,
};
