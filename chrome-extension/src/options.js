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

load();
