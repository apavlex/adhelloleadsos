/**
 * Normalize the browser page the user is looking at for Alex SESSION context.
 * Clients send path/title plus optional ui fields (open folder, selected leads).
 */

function clip(value, max) {
  return String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function parsePageUrl(page) {
  const raw = String(page || '').trim();
  if (!raw) return { path: '', query: new URLSearchParams() };
  try {
    const u = new URL(raw, 'https://app.local');
    return { path: u.pathname || '', query: u.searchParams };
  } catch {
    const q = raw.indexOf('?');
    if (q === -1) return { path: raw, query: new URLSearchParams() };
    return { path: raw.slice(0, q), query: new URLSearchParams(raw.slice(q + 1)) };
  }
}

function pageLabel(path, tab) {
  const p = String(path || '');
  const t = String(tab || '').toLowerCase();
  if (p.startsWith('/prospecting') || p === '/leads') {
    if (t === 'folders') return 'Folders';
    if (t === 'pipeline' || !t) return 'Pipeline';
    if (t === 'opportunities') return 'Opportunities';
    return `Prospecting (${t})`;
  }
  if (p.startsWith('/directory')) return 'Directory';
  if (p.startsWith('/business-reviews') || p.startsWith('/reviews')) return 'Reviews';
  if (p.startsWith('/seo-qa') || p.startsWith('/qa')) return 'Q&A';
  if (p.startsWith('/local-seo')) return 'Local SEO';
  if (p.startsWith('/seo-gap')) return 'SEO Gap';
  if (p.startsWith('/backlinks')) return 'Backlinks';
  if (p.startsWith('/chat')) return 'Alex chat page';
  if (p.startsWith('/ceo') || p.startsWith('/automate')) return 'CEO / Automate';
  if (p.startsWith('/workspace')) return 'Workspace';
  if (p.startsWith('/focus')) return 'Lead focus';
  if (p.startsWith('/messages')) return 'Messages';
  if (p.startsWith('/tasks')) return 'Tasks';
  if (p.startsWith('/network')) return 'Network';
  return p || 'unknown';
}

/**
 * @param {object} [raw]
 * @returns {{
 *   path: string,
 *   title: string,
 *   tab: string,
 *   view: string,
 *   folderKey: string,
 *   folderName: string,
 *   leadKey: string,
 *   leadTitle: string,
 *   activePage: string,
 *   selectedCount: number,
 *   selectedLeadKeys: string[],
 * }}
 */
function normalizeUiContext(raw) {
  const ui = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const selected = Array.isArray(ui.selectedLeadKeys)
    ? ui.selectedLeadKeys.map((k) => clip(k, 120)).filter(Boolean).slice(0, 25)
    : [];
  const selectedCount = Math.max(
    0,
    Math.min(500, parseInt(ui.selectedCount, 10) || selected.length || 0),
  );
  return {
    path: clip(ui.path, 300),
    title: clip(ui.title || ui.pageTitle, 160),
    tab: clip(ui.tab, 40),
    view: clip(ui.view, 40),
    folderKey: clip(ui.folderKey, 160),
    folderName: clip(ui.folderName, 120),
    leadKey: clip(ui.leadKey || ui.lead, 120),
    leadTitle: clip(ui.leadTitle, 160),
    activePage: clip(ui.activePage, 60),
    selectedCount,
    selectedLeadKeys: selected,
  };
}

/**
 * Merge URL page string + optional ui payload into one SESSION description.
 * @param {string} [page]
 * @param {string} [pageTitle]
 * @param {object} [uiRaw]
 */
function describePageForSession(page, pageTitle, uiRaw) {
  const parsed = parsePageUrl(page);
  const ui = normalizeUiContext(uiRaw);
  const path = ui.path || parsed.path || clip(page, 300);
  const query = parsed.query;
  const tab = ui.tab || clip(query.get('tab'), 40);
  const view = ui.view || clip(query.get('view'), 40);
  const folderKey =
    ui.folderKey || clip(query.get('folderKey') || query.get('folder'), 160);
  const leadKey = ui.leadKey || clip(query.get('lead'), 120);
  const title = ui.title || clip(pageTitle, 160);
  const label = pageLabel(path, tab);

  const qs = query && [...query.keys()].length ? `?${query.toString()}` : '';
  const lines = [
    `- Looking at: ${label}`,
    `- URL: ${path || 'unknown'}${qs}`,
  ];
  if (title) lines.push(`- Page title: ${title}`);
  if (ui.activePage) lines.push(`- Nav section: ${ui.activePage}`);
  if (tab) lines.push(`- Tab: ${tab}`);
  if (view) lines.push(`- View: ${view}`);
  if (folderKey || ui.folderName) {
    lines.push(
      `- Open folder: ${ui.folderName || '(unnamed)'} (key=${folderKey || 'unknown'})`,
    );
  }
  if (leadKey || ui.leadTitle) {
    lines.push(
      `- Open / focused lead: ${ui.leadTitle || '(unnamed)'} (key=${leadKey || 'unknown'})`,
    );
  }
  if (ui.selectedCount > 0) {
    const keysBit = ui.selectedLeadKeys.length
      ? `; keys: ${ui.selectedLeadKeys.join(', ')}`
      : '';
    lines.push(`- Selected leads on page: ${ui.selectedCount}${keysBit}`);
  }
  lines.push(
    '- When the user says "these", "here", "this folder", "this page", or "them", prefer the open folder / selected leads above before asking which folder.',
  );
  return {
    text: lines.join('\n'),
    path,
    tab,
    folderKey,
    folderName: ui.folderName,
    leadKey,
    selectedCount: ui.selectedCount,
  };
}

/**
 * Compact folder catalog for SESSION (names the model can use with list_leads).
 * @param {Array<{key?:string,name?:string,parentFolderKey?:string}>} folders
 */
function formatFolderCatalog(folders) {
  const list = Array.isArray(folders) ? folders.filter((f) => f && f.key) : [];
  if (!list.length) return '- (no folders yet)';
  const byKey = new Map(list.map((f) => [String(f.key), f]));
  const pathOf = (folder) => {
    const names = [];
    let cur = folder;
    const seen = new Set();
    while (cur && !seen.has(cur.key)) {
      seen.add(cur.key);
      names.unshift(cur.name || 'Folder');
      const pk = String(cur.parentFolderKey || '').trim();
      cur = pk ? byKey.get(pk) : null;
    }
    return names.join(' / ');
  };
  const lines = list
    .slice(0, 120)
    .map((f) => `- ${pathOf(f)} (key=${f.key})`)
    .sort((a, b) => a.localeCompare(b));
  const extra = list.length > 120 ? `\n- …and ${list.length - 120} more (call list_folders)` : '';
  return `${lines.join('\n')}${extra}`;
}

module.exports = {
  normalizeUiContext,
  describePageForSession,
  formatFolderCatalog,
  pageLabel,
};
