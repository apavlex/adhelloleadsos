/**
 * Persist SEO gap projects on the workspace document (MVP warehouse).
 * Shape lives under workspace.seoGap.projects[id]
 */

const crypto = require('crypto');
const dbService = require('./database');

function newId() {
  return `seo_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
}

function emptyBundle(workspaceId) {
  return {
    workspaceId: String(workspaceId || ''),
    projects: {},
    updatedAt: new Date().toISOString(),
  };
}

async function loadBundle(workspaceId) {
  const wid = String(workspaceId || '').trim();
  if (!wid) return emptyBundle('');
  const ws = (await dbService.getWorkspace(wid)) || { id: wid };
  const bundle =
    ws.seoGap && typeof ws.seoGap === 'object' ? ws.seoGap : emptyBundle(wid);
  return {
    workspaceId: wid,
    projects: bundle.projects && typeof bundle.projects === 'object' ? bundle.projects : {},
    updatedAt: bundle.updatedAt || null,
  };
}

async function saveBundle(workspaceId, bundle) {
  const wid = String(workspaceId || '').trim();
  const ws = (await dbService.getWorkspace(wid)) || { id: wid };
  const next = {
    workspaceId: wid,
    projects: (bundle && bundle.projects) || {},
    updatedAt: new Date().toISOString(),
  };
  await dbService.saveWorkspace(wid, { ...ws, id: wid, seoGap: next });
  return next;
}

async function listProjects(workspaceId) {
  const bundle = await loadBundle(workspaceId);
  return Object.values(bundle.projects)
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

async function getProject(workspaceId, projectId) {
  const bundle = await loadBundle(workspaceId);
  const p = bundle.projects[String(projectId || '')];
  return p || null;
}

async function upsertProject(workspaceId, project) {
  const bundle = await loadBundle(workspaceId);
  const id = String((project && project.id) || newId());
  const prev = bundle.projects[id] || {};
  const next = {
    ...prev,
    ...project,
    id,
    workspaceId: String(workspaceId),
    updatedAt: new Date().toISOString(),
    createdAt: prev.createdAt || new Date().toISOString(),
  };
  bundle.projects[id] = next;
  await saveBundle(workspaceId, bundle);
  return next;
}

async function deleteProject(workspaceId, projectId) {
  const bundle = await loadBundle(workspaceId);
  const id = String(projectId || '');
  if (!bundle.projects[id]) return false;
  delete bundle.projects[id];
  await saveBundle(workspaceId, bundle);
  return true;
}

module.exports = {
  newId,
  loadBundle,
  saveBundle,
  listProjects,
  getProject,
  upsertProject,
  deleteProject,
};
