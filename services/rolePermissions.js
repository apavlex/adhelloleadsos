/**
 * Per-workspace role access: which sidebar pages each role can open and which
 * leads they see. Owners always get everything. Stored on `workspace.rolePermissions`.
 */

const EDITABLE_ROLES = ['admin', 'sdr', 'viewer'];
const ROLE_LABELS = { owner: 'Owner', admin: 'Admin', sdr: 'SDR', viewer: 'Viewer' };
const ROLE_HINTS = {
  owner: 'Everything, always.',
  admin: 'Can invite people and change settings.',
  sdr: 'Works leads assigned to them.',
  viewer: 'Uses the app, cannot manage the team.',
};

/** Sidebar pages. `paths` are URL prefixes that belong to the page. */
const PAGES = [
  { id: 'chat', label: 'Ask AI', group: 'General', paths: ['/chat'] },
  { id: 'today', label: 'Today', group: 'General', paths: ['/today'] },
  { id: 'opportunities', label: 'Opportunities', group: 'Sales', paths: ['/opportunities'] },
  { id: 'leads', label: 'Leads (find, queue, pipeline, folders)', group: 'Sales', paths: ['/leads', '/prospecting', '/pipeline', '/history'] },
  { id: 'focus', label: 'Call mode', group: 'Sales', paths: ['/focus'] },
  { id: 'automate', label: 'Automate', group: 'Sales', paths: ['/ceo'] },
  { id: 'tasks', label: 'Tasks', group: 'Sales', paths: ['/tasks'] },
  { id: 'activity', label: 'Activity', group: 'Sales', paths: ['/activity', '/team-history', '/messages'] },
  { id: 'engagement', label: 'Engagement', group: 'Sales', paths: ['/engagement'] },
  { id: 'scripts', label: 'Scripts', group: 'Sales', paths: ['/scripts', '/sales/personas'] },
  { id: 'network', label: 'Network', group: 'Referrals', paths: ['/network'] },
  { id: 'referrals', label: 'Referral Partners', group: 'Referrals', paths: ['/referrals'] },
  { id: 'appointments', label: 'Appointments', group: 'Referrals', paths: ['/appointments'] },
  { id: 'direct-mail', label: 'Marketing Studio', group: 'Marketing', paths: ['/direct-mail'] },
  { id: 'social-posts', label: 'Social Posts', group: 'Marketing', paths: ['/social-posts'] },
  { id: 'fb-groups', label: 'FB Groups', group: 'Marketing', paths: ['/fb-groups'] },
  { id: 'reports', label: 'Reports', group: 'Insights', paths: ['/reports', '/analytics'] },
  { id: 'resources', label: 'Resources', group: 'Insights', paths: ['/resources', '/sops'] },
  { id: 'settings', label: 'Workspace settings', group: 'Settings', paths: ['/workspace'] },
];
const PAGE_IDS = PAGES.map((p) => p.id);

/** Always reachable so nobody gets stranded (invite links, switching, the Team page itself for admins). */
const ALWAYS_OPEN = [/^\/workspace\/invite\//, /^\/workspaces?\/(switch|open)(\/|$)/, /^\/logout$/];

function defaultsFor(role) {
  const pages = {};
  for (const id of PAGE_IDS) pages[id] = true;
  return { pages, leads: role === 'sdr' ? 'assigned' : 'all' };
}

function normalizeRole(raw, role) {
  const base = defaultsFor(role);
  const src = raw && typeof raw === 'object' ? raw : {};
  const pages = { ...base.pages };
  if (src.pages && typeof src.pages === 'object') {
    for (const id of PAGE_IDS) {
      if (Object.prototype.hasOwnProperty.call(src.pages, id)) pages[id] = src.pages[id] !== false;
    }
  }
  const leads = src.leads === 'assigned' || src.leads === 'all' ? src.leads : base.leads;
  return { pages, leads };
}

/** Full matrix for the editable roles, defaults filled in. */
function resolve(ws) {
  const stored = ws && ws.rolePermissions && typeof ws.rolePermissions === 'object' ? ws.rolePermissions : {};
  const out = {};
  for (const role of EDITABLE_ROLES) out[role] = normalizeRole(stored[role], role);
  return out;
}

function pageForPath(path) {
  const p = String(path || '');
  for (const page of PAGES) {
    if (page.paths.some((pre) => p === pre || p.startsWith(`${pre}/`) || p.startsWith(`${pre}?`))) return page.id;
  }
  return '';
}

function canAccessPage(ws, role, pageId) {
  if (!pageId || role === 'owner') return true;
  if (!EDITABLE_ROLES.includes(role)) return true;
  return resolve(ws)[role].pages[pageId] !== false;
}

function leadScope(ws, role) {
  if (role === 'owner' || !EDITABLE_ROLES.includes(role)) return 'all';
  return resolve(ws)[role].leads;
}

/** First page this role can open, for redirects. */
function homePath(ws, role) {
  const order = ['today', 'opportunities', 'leads', 'tasks', 'chat', ...PAGE_IDS];
  for (const id of order) {
    if (canAccessPage(ws, role, id)) return PAGES.find((p) => p.id === id).paths[0];
  }
  return '';
}

function isAlwaysOpen(path) {
  return ALWAYS_OPEN.some((re) => re.test(String(path || '')));
}

/** Parse the Team page form: `page.<role>.<pageId>=on` checkboxes and `leads.<role>=all|assigned`. */
function fromForm(body) {
  const b = body && typeof body === 'object' ? body : {};
  const out = {};
  for (const role of EDITABLE_ROLES) {
    const pages = {};
    for (const id of PAGE_IDS) pages[id] = b[`page.${role}.${id}`] === 'on';
    const leads = b[`leads.${role}`] === 'assigned' ? 'assigned' : 'all';
    out[role] = { pages, leads };
  }
  return out;
}

module.exports = {
  EDITABLE_ROLES,
  ROLE_LABELS,
  ROLE_HINTS,
  PAGES,
  PAGE_IDS,
  defaultsFor,
  resolve,
  pageForPath,
  canAccessPage,
  leadScope,
  homePath,
  isAlwaysOpen,
  fromForm,
};
