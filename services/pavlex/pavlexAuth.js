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

  return {
    userId: email || null,
    email: email || null,
    workspaceId,
    permissions: {
      canManageWorkspace: canManage,
      canReadCrm: Boolean(email && workspaceId),
      canWriteCrm: Boolean(email && workspaceId && canManage),
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
