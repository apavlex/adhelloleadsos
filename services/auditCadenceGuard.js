const { isAgencySalesWorkspace } = require('./leadPanelWorkspace');
const { isAuditCadenceTemplate } = require('./sequenceTemplates');

const AUDIT_CADENCE_FORBIDDEN_MSG =
  'Audit cadences are only available in agency sales workspaces (e.g. AdHello).';

/** Whether this workspace may start or run audit-link cadences. */
function workspaceAllowsAuditCadence(ws) {
  return isAgencySalesWorkspace(ws);
}

async function workspaceIdAllowsAuditCadence(workspaceId, dbService) {
  const wid = String(workspaceId || '').trim();
  if (!wid) return false;
  const ws = await dbService.getWorkspace(wid);
  return workspaceAllowsAuditCadence(ws);
}

function filterTemplatesForWorkspace(templates, ws) {
  const list = Array.isArray(templates) ? templates : [];
  if (workspaceAllowsAuditCadence(ws)) return list;
  return list.filter((t) => t && !isAuditCadenceTemplate(t.id));
}

module.exports = {
  AUDIT_CADENCE_FORBIDDEN_MSG,
  workspaceAllowsAuditCadence,
  workspaceIdAllowsAuditCadence,
  filterTemplatesForWorkspace,
  isAuditCadenceTemplate,
};
