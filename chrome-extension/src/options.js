const form = document.getElementById('settingsForm');
const statusEl = document.getElementById('status');
const importForm = document.getElementById('importForm');
const importStatusEl = document.getElementById('importStatus');
const optionsWorkspaceSelect = document.getElementById('optionsWorkspaceSelect');
const headerWorkspaceSelect = document.getElementById('workspaceSelect');
const workspaceThemeRow = document.getElementById('workspaceThemeRow');

const DEFAULTS = {
  apiBaseUrl: 'https://adhelloleadsos.onrender.com',
  apiKey: '',
  accountEmail: '',
  workspaceId: 'default',
  defaultFolderName: '',
  showSaveLeadFab: true,
};

function readFormSettings() {
  return {
    apiBaseUrl: form.apiBaseUrl.value.trim().replace(/\/+$/, ''),
    apiKey: form.apiKey.value.trim(),
    accountEmail: form.accountEmail.value.trim().toLowerCase(),
    workspaceId: form.workspaceId.value.trim() || 'default',
    defaultFolderName: form.defaultFolderName.value.trim(),
    showSaveLeadFab: !!form.showSaveLeadFab?.checked,
  };
}

async function refreshWorkspaceLists(settings) {
  if (!window.AdHelloTheme) return;
  const cfg = settings || readFormSettings();
  if (!cfg.apiKey) return;

  try {
    const data = await window.AdHelloTheme.fetchWorkspaces(cfg);
    const activeId = cfg.workspaceId || data.activeWorkspaceId || 'default';
    window.AdHelloTheme.renderWorkspaceSelect(optionsWorkspaceSelect, data.workspaces, activeId);
    if (headerWorkspaceSelect) {
      window.AdHelloTheme.renderWorkspaceSelect(headerWorkspaceSelect, data.workspaces, activeId);
      workspaceThemeRow?.classList.remove('hidden');
    }
    const active =
      data.workspaces.find((w) => w.id === activeId) ||
      data.workspaces[0] ||
      null;
    if (active) {
      await window.AdHelloTheme.applyWorkspaceTheme(active);
    } else {
      await window.AdHelloTheme.fetchAndApplyTheme(cfg);
    }
  } catch (_) {
    const fallback = cfg.workspaceId || 'default';
    window.AdHelloTheme.renderWorkspaceSelect(
      optionsWorkspaceSelect,
      [{ id: fallback, name: fallback }],
      fallback,
    );
  }
}

async function refreshThemeFromForm() {
  if (!window.AdHelloTheme || typeof window.AdHelloTheme.fetchAndApplyTheme !== 'function') return null;
  return window.AdHelloTheme.fetchAndApplyTheme(readFormSettings());
}

async function load() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  form.apiBaseUrl.value = stored.apiBaseUrl || DEFAULTS.apiBaseUrl;
  form.apiKey.value = stored.apiKey || '';
  form.accountEmail.value = stored.accountEmail || '';
  form.workspaceId.value = stored.workspaceId || DEFAULTS.workspaceId;
  form.defaultFolderName.value = stored.defaultFolderName || '';
  if (form.showSaveLeadFab) {
    form.showSaveLeadFab.checked = stored.showSaveLeadFab !== false;
  }
  if (importForm) {
    importForm.importFolderName.value = stored.defaultFolderName || '';
  }
  await refreshWorkspaceLists({
    apiBaseUrl: form.apiBaseUrl.value.trim().replace(/\/+$/, ''),
    apiKey: form.apiKey.value.trim(),
    accountEmail: form.accountEmail.value.trim().toLowerCase(),
    workspaceId: form.workspaceId.value.trim() || 'default',
  });
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const next = readFormSettings();
  await chrome.storage.sync.set(next);
  statusEl.textContent = 'Settings saved.';
  await refreshWorkspaceLists(next);
  setTimeout(() => { statusEl.textContent = ''; }, 2500);
});

document.getElementById('testConnectionBtn')?.addEventListener('click', async () => {
  statusEl.textContent = 'Testing connection…';
  statusEl.className = '';
  const cfg = readFormSettings();
  if (!cfg.apiKey) {
    statusEl.textContent = 'Enter your API key first.';
    statusEl.className = 'status status--error';
    return;
  }
  try {
    const res = await fetch(`${cfg.apiBaseUrl}/autonomous/status`, {
      headers: {
        'x-api-key': cfg.apiKey,
        'x-workspace-id': cfg.workspaceId,
        ...(cfg.accountEmail ? { 'x-user-email': cfg.accountEmail } : {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        res.status === 401
          ? 'Unauthorized — key does not match server API_INGEST_KEY.'
          : data.error || `HTTP ${res.status}`,
      );
    }
    const wsName = data.workspace?.name || data.workspaceId || cfg.workspaceId;
    statusEl.textContent = `Connected · ${wsName}`;
    statusEl.className = 'status status--ok';
    await refreshWorkspaceLists(cfg);
  } catch (err) {
    statusEl.textContent = err.message || 'Connection failed';
    statusEl.className = 'status status--error';
  }
});

form.accountEmail?.addEventListener('blur', () => {
  refreshWorkspaceLists().catch(() => {});
});
form.apiKey?.addEventListener('blur', () => {
  refreshWorkspaceLists().catch(() => {});
});
form.showSaveLeadFab?.addEventListener('change', async () => {
  await chrome.storage.sync.set({ showSaveLeadFab: !!form.showSaveLeadFab.checked });
});

form.workspaceId?.addEventListener('change', () => {
  refreshThemeFromForm().catch(() => {});
});
headerWorkspaceSelect?.addEventListener('change', () => {
  form.workspaceId.value = headerWorkspaceSelect.value;
  refreshThemeFromForm().catch(() => {});
});

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.readAsText(file);
  });
}

importForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  importStatusEl.textContent = '';
  importStatusEl.className = 'status';

  const folderName = importForm.importFolderName.value.trim();
  const file = importForm.importFile.files && importForm.importFile.files[0];
  if (!folderName) {
    importStatusEl.textContent = 'Folder name is required.';
    importStatusEl.className = 'status status--error';
    return;
  }
  if (!file) {
    importStatusEl.textContent = 'Choose a CSV or Excel file.';
    importStatusEl.className = 'status status--error';
    return;
  }

  const importBtn = document.getElementById('importBtn');
  importBtn.disabled = true;
  importBtn.textContent = 'Importing…';

  try {
    let csvContent = '';
    const lower = String(file.name || '').toLowerCase();
    if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
      throw new Error('Excel import from the extension is coming soon — export as CSV first, or import .xlsx from AdHello → Leads.');
    }
    csvContent = await readFileAsText(file);

    const stored = await chrome.storage.sync.get(DEFAULTS);
    const res = await chrome.runtime.sendMessage({
      type: 'IMPORT_CSV',
      csvContent,
      fileName: file.name || 'import.csv',
      folderName,
      workspaceId: stored.workspaceId || DEFAULTS.workspaceId,
    });
    if (!res?.ok) throw new Error(res?.error || 'Import failed');

    const data = res.data || {};
    const folderLabel = data.folderName ? ` into “${data.folderName}”` : '';
    importStatusEl.textContent = `Imported ${data.created || 0} lead(s)${folderLabel}${data.failed ? ` · ${data.failed} failed` : ''}.`;
    importStatusEl.className = 'status status--ok';
    importForm.reset();
    importForm.importFolderName.value = folderName;
  } catch (err) {
    importStatusEl.textContent = err.message || 'Import failed';
    importStatusEl.className = 'status status--error';
  } finally {
    importBtn.disabled = false;
    importBtn.textContent = 'Import list to AdHello';
  }
});

load();
