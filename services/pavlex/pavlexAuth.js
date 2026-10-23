/**
 * Pavlex AI gateway — authenticated user + workspace context.
 */
const { userEmail } = require('../workspaceService');

/**
 * @param {import('express').Request} req
 */
function resolvePavlexAuth(req) {
  const email = userEmail(req);
  const workspaceId = req.workspaceId || null;
  const canManage = Boolean(req.canManageWorkspace);
  // Managers and SDRs can run most CRM write tools; only viewers are read-only in the prompt.
  // (Individual tools still enforce owner/admin vs manager gates themselves.)
  const role = String(req.workspaceRole || '').toLowerCase();
  const isViewer = role === 'viewer';
  const canWrite = Boolean(email && workspaceId && !isViewer);

  return {
    userId: email || null,
    email: email || null,
    workspaceId,
    permissions: {
      canManageWorkspace: canManage,
      canReadCrm: Boolean(email && workspaceId),
      canWriteCrm: canWrite,
    },
    authenticated: Boolean(email && workspaceId),
  };
}

function assertPavlexAuth(req) {
  const auth = resolvePavlexAuth(req);
  if (!auth.authenticated) {
    const err = new Error('Sign in required.');
    err.status = 401;
    throw err;
  }
  return auth;
}

module.exports = {
  resolvePavlexAuth,
  assertPavlexAuth,
};
