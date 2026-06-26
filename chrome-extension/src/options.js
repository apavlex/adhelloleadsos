const form = document.getElementById('settingsForm');
const statusEl = document.getElementById('status');

const DEFAULTS = {
  apiBaseUrl: 'https://adhelloleadsos.onrender.com',
  apiKey: '',
  workspaceId: 'default',
};

async function load() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  form.apiBaseUrl.value = stored.apiBaseUrl || DEFAULTS.apiBaseUrl;
  form.apiKey.value = stored.apiKey || '';
  form.workspaceId.value = stored.workspaceId || DEFAULTS.workspaceId;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  await chrome.storage.sync.set({
    apiBaseUrl: form.apiBaseUrl.value.trim().replace(/\/+$/, ''),
    apiKey: form.apiKey.value.trim(),
    workspaceId: form.workspaceId.value.trim() || 'default',
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

load();
