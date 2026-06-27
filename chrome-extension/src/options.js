const form = document.getElementById('settingsForm');
const statusEl = document.getElementById('status');
const importForm = document.getElementById('importForm');
const importStatusEl = document.getElementById('importStatus');

const DEFAULTS = {
  apiBaseUrl: 'https://adhelloleadsos.onrender.com',
  apiKey: '',
  workspaceId: 'default',
  defaultFolderName: '',
};

async function load() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  form.apiBaseUrl.value = stored.apiBaseUrl || DEFAULTS.apiBaseUrl;
  form.apiKey.value = stored.apiKey || '';
  form.workspaceId.value = stored.workspaceId || DEFAULTS.workspaceId;
  form.defaultFolderName.value = stored.defaultFolderName || '';
  if (importForm) {
    importForm.importFolderName.value = stored.defaultFolderName || '';
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  await chrome.storage.sync.set({
    apiBaseUrl: form.apiBaseUrl.value.trim().replace(/\/+$/, ''),
    apiKey: form.apiKey.value.trim(),
    workspaceId: form.workspaceId.value.trim() || 'default',
    defaultFolderName: form.defaultFolderName.value.trim(),
  });
  statusEl.textContent = 'Settings saved.';
  setTimeout(() => { statusEl.textContent = ''; }, 2500);
});

document.getElementById('testConnectionBtn')?.addEventListener('click', async () => {
  statusEl.textContent = 'Testing connection…';
  statusEl.className = '';
  const apiBaseUrl = form.apiBaseUrl.value.trim().replace(/\/+$/, '');
  const apiKey = form.apiKey.value.trim();
  const workspaceId = form.workspaceId.value.trim() || 'default';
  if (!apiKey) {
    statusEl.textContent = 'Enter your API key first.';
    statusEl.className = 'status status--error';
    return;
  }
  try {
    const res = await fetch(`${apiBaseUrl}/autonomous/ghl/status`, {
      headers: { 'x-api-key': apiKey, 'x-workspace-id': workspaceId },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        res.status === 401
          ? 'Unauthorized — key does not match server API_INGEST_KEY.'
          : data.error || `HTTP ${res.status}`,
      );
    }
    statusEl.textContent = `Connected · workspace ${data.workspaceId || workspaceId}`;
    statusEl.className = 'status status--ok';
  } catch (err) {
    statusEl.textContent = err.message || 'Connection failed';
    statusEl.className = 'status status--error';
  }
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

    const res = await chrome.runtime.sendMessage({
      type: 'IMPORT_CSV',
      csvContent,
      fileName: file.name || 'import.csv',
      folderName,
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
