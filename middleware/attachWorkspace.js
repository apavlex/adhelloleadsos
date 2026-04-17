const workspaceService = require('../services/workspaceService');

/**
 * After passport auth: bind workspace id (session or default), ensure membership, expose role + ACL on req/res.locals.
 */
async function attachWorkspace(req, res, next) {
  try {
    const email = workspaceService.userEmail(req);
    let wid = req.session && req.session.workspaceId;
    if (!wid || typeof wid !== 'string') wid = 'default';
    req.workspaceId = wid;

    const ws = await workspaceService.ensureWorkspaceAndMember(wid, email);
    const role = workspaceService.roleForEmail(ws, email);
    req.workspaceRole = role;
    req.canManageWorkspace = workspaceService.canManageTeam(role);

    res.locals.workspaceId = wid;
    res.locals.workspaceRole = role;
    res.locals.canManageWorkspace = req.canManageWorkspace;

    next();
  } catch (err) {
    next(err);
  }
}

module.exports = attachWorkspace;
