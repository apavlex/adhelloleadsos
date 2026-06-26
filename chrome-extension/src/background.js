const DEFAULTS = {
  apiBaseUrl: 'https://adhelloleadsos.onrender.com',
  apiKey: '',
  workspaceId: 'default',
};

async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  return {
    apiBaseUrl: String(stored.apiBaseUrl || DEFAULTS.apiBaseUrl).replace(/\/+$/, ''),
    apiKey: String(stored.apiKey || '').trim(),
    workspaceId: String(stored.workspaceId || DEFAULTS.workspaceId).trim() || 'default',
  };
}

async function saveLeadToAdHello(lead) {
  const settings = await getSettings();
  if (!settings.apiKey) {
    throw new Error('Add your API key in extension settings.');
  }

  const res = await fetch(`${settings.apiBaseUrl}/autonomous/leads`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.apiKey,
      'x-workspace-id': settings.workspaceId,
    },
    body: JSON.stringify(lead),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error(
        'Unauthorized — API key does not match server API_INGEST_KEY. In Render (or .env), copy the full API_INGEST_KEY into extension Settings → Save, then try again.',
      );
    }
    throw new Error(data.error || data.message || `Save failed (${res.status})`);
  }
  return data;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'SAVE_LEAD') {
    saveLeadToAdHello(message.lead)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
  }

  if (message?.type === 'GET_SETTINGS') {
    getSettings().then((settings) => sendResponse({ ok: true, settings }));
    return true;
  }
});
