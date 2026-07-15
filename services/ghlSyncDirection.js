/**
 * Workspace-wide default for Go High Level sync direction.
 */

const GHL_SYNC_DIRECTIONS = ['pull', 'push', 'both'];
const DEFAULT_GHL_SYNC_DIRECTION = 'both';

function normalizeGhlSyncDirection(raw) {
  const d = String(raw || '')
    .trim()
    .toLowerCase();
  if (d === 'pull' || d === 'push') return d;
  return DEFAULT_GHL_SYNC_DIRECTION;
}

function getWorkspaceGhlSyncDirection(workspace) {
  return normalizeGhlSyncDirection(workspace && workspace.ghlSyncDirection);
}

function allowsGhlPush(direction) {
  const d = normalizeGhlSyncDirection(direction);
  return d === 'push' || d === 'both';
}

function allowsGhlPull(direction) {
  const d = normalizeGhlSyncDirection(direction);
  return d === 'pull' || d === 'both';
}

module.exports = {
  GHL_SYNC_DIRECTIONS,
  DEFAULT_GHL_SYNC_DIRECTION,
  normalizeGhlSyncDirection,
  getWorkspaceGhlSyncDirection,
  allowsGhlPush,
  allowsGhlPull,
};
