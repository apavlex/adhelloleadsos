/**
 * Contractor business portal — appointments + website form leads + package requests.
 */
const dbService = require('./database');
const appointmentPackages = require('./appointmentPackages');
const { createContractorPortalToken, verifyContractorPortalToken } = require('./contractorPortalSign');
const userTasks = require('./userTasks');
const whiteLabel = require('./whiteLabel');

function portalPath(token) {
  return `/p/${encodeURIComponent(token)}`;
}

function portalUrl(req, token) {
  const base = `${req.protocol}://${req.get('host')}`.replace(/\/$/, '');
  return `${base}${portalPath(token)}`;
}

async function ensurePortalToken(workspaceId, packageId) {
  return createContractorPortalToken({ workspaceId, packageId });
}

async function loadPortalContext(token) {
  const payload = verifyContractorPortalToken(token);
  if (!payload) return null;
  const pkg = await appointmentPackages.getPackage(payload.workspaceId, payload.packageId);
  if (!pkg || pkg.portalEnabled === false) return null;
  const ws = (await dbService.getWorkspace(payload.workspaceId)) || {};
  const brand = typeof whiteLabel.brandForWorkspace === 'function'
    ? whiteLabel.brandForWorkspace(ws)
    : {
        appName: ws.name || 'AdHello',
        accentColor: ws.accentColor || '#FFDB3A',
      };
  return {
    token,
    workspaceId: payload.workspaceId,
    packageId: payload.packageId,
    package: pkg,
    workspace: ws,
    brand,
    base: portalPath(token),
    greetingName: String(pkg.businessName || 'there').split(/\s+/)[0],
  };
}

function buildPortalHome(pkg) {
  const tracker = appointmentPackages.trackerFor(pkg);
  const leadCredits = appointmentPackages.normalizeLeadCredits(pkg.leadCredits);
  const formLeads = [...(pkg.formLeads || [])].sort(
    (a, b) => Date.parse(b.at || 0) - Date.parse(a.at || 0),
  );
  const openLeads = formLeads.filter((f) => f.status !== 'closed');
  const pendingRequests = (pkg.requests || []).filter((r) => r.status === 'pending');
  return {
    tracker,
    leadCredits,
    formLeads: formLeads.slice(0, 40),
    recentLeads: openLeads.slice(0, 8),
    openLeadCount: openLeads.length,
    pendingRequests,
    bookingUrl: pkg.bookingUrl || null,
    websiteUrl: pkg.websiteUrl || null,
  };
}

async function agencyOwnerEmails(workspace) {
  const emails = new Set();
  const owner = String((workspace && workspace.ownerUserId) || '').toLowerCase().trim();
  if (owner) emails.add(owner);
  const members = (workspace && workspace.members) || {};
  Object.entries(members).forEach(([email, meta]) => {
    const role = String((meta && meta.role) || '').toLowerCase();
    if (role === 'owner' || role === 'admin') {
      const em = String(email || '').toLowerCase().trim();
      if (em) emails.add(em);
    }
  });
  return [...emails];
}

async function notifyAgencyOfRequest(workspaceId, pkg, request) {
  const ws = (await dbService.getWorkspace(workspaceId)) || {};
  const emails = await agencyOwnerEmails(ws);
  const kind = request.type === 'appointments' ? 'appointments' : 'leads';
  const title = `${pkg.businessName} requested ${request.quantity} more ${kind}`;
  const results = [];
  for (const email of emails) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const task = await userTasks.upsertOpenTaskForLead(workspaceId, email, {
        title,
        column: 'todo',
        leadKey: pkg.leadKey || null,
        source: 'manual',
      });
      results.push({ email, taskId: task && task.id });
    } catch (e) {
      results.push({ email, error: e && e.message });
    }
  }
  return results;
}

async function submitRequest(workspaceId, packageId, input) {
  const created = await appointmentPackages.createPortalRequest(workspaceId, packageId, input);
  if (!created) return null;
  const notices = await notifyAgencyOfRequest(workspaceId, created.package, created.request);
  return { ...created, notices };
}

module.exports = {
  portalPath,
  portalUrl,
  ensurePortalToken,
  loadPortalContext,
  buildPortalHome,
  submitRequest,
  notifyAgencyOfRequest,
  agencyOwnerEmails,
};
