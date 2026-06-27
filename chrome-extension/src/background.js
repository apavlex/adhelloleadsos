const DEFAULTS = {
  apiBaseUrl: 'https://adhelloleadsos.onrender.com',
  apiKey: '',
  workspaceId: 'default',
  defaultFolderName: '',
};

async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  return {
    apiBaseUrl: String(stored.apiBaseUrl || DEFAULTS.apiBaseUrl).replace(/\/+$/, ''),
    apiKey: String(stored.apiKey || '').trim(),
    workspaceId: String(stored.workspaceId || DEFAULTS.workspaceId).trim() || 'default',
    defaultFolderName: String(stored.defaultFolderName || '').trim(),
  };
}

async function saveLeadToAdHello(lead) {
  const settings = await getSettings();
  if (!settings.apiKey) {
    throw new Error('Add your API key in extension settings.');
  }

  const payload = { ...lead };
  if (!payload.folderName && settings.defaultFolderName) {
    payload.folderName = settings.defaultFolderName;
  }

  const res = await fetch(`${settings.apiBaseUrl}/autonomous/leads`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.apiKey,
      'x-workspace-id': settings.workspaceId,
    },
    body: JSON.stringify(payload),
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

async function importCsvToAdHello({ csvContent, fileName, folderName }) {
  const settings = await getSettings();
  if (!settings.apiKey) {
    throw new Error('Add your API key in extension settings.');
  }
  const name = String(folderName || settings.defaultFolderName || '').trim();
  if (!name) {
    throw new Error('Enter a folder name for this import.');
  }
  if (!csvContent) {
    throw new Error('Choose a CSV or Excel file first.');
  }

  const res = await fetch(`${settings.apiBaseUrl}/autonomous/import-csv`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.apiKey,
      'x-workspace-id': settings.workspaceId,
    },
    body: JSON.stringify({
      csvContent,
      fileName: fileName || 'import.csv',
      folderName: name,
      source: 'chrome_extension',
      leadSource: 'chrome_extension',
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error('Unauthorized — check your API key in Settings.');
    }
    throw new Error(data.error || data.message || `Import failed (${res.status})`);
  }
  return data;
}

async function apiFetch(path, options = {}) {
  const settings = await getSettings();
  if (!settings.apiKey) {
    throw new Error('Add your API key in extension settings.');
  }
  const res = await fetch(`${settings.apiBaseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.apiKey,
      'x-workspace-id': settings.workspaceId,
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error('Unauthorized — check your API key in Settings.');
    }
    throw new Error(data.error || data.message || `Request failed (${res.status})`);
  }
  return data;
}

async function getReEnrichQueue({ folderName, limit = 150 }) {
  const name = String(folderName || '').trim();
  if (!name) throw new Error('Enter a folder name to re-enrich.');
  const params = new URLSearchParams({ folderName: name, limit: String(limit) });
  return apiFetch(`/autonomous/re-enrich-queue?${params.toString()}`);
}

async function patchLeadContact({ leadKey, patch }) {
  const key = encodeURIComponent(String(leadKey || '').replace(/^lead:/, ''));
  if (!key) throw new Error('Lead key is required.');
  return apiFetch(`/autonomous/leads/${key}`, {
    method: 'PATCH',
    body: JSON.stringify(patch || {}),
  });
}

const PARALLEL_ENRICH_CONCURRENCY = 5;
const ENRICH_SCRIPTS = ['src/address-utils.js', 'src/maps-bulk-scrape.js'];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hostnameFromWebsite(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s.includes('://') ? s : `https://${s}`);
    return u.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

function parseCityStateSimple(address) {
  const raw = String(address || '').trim();
  if (!raw) return { city: '', state: '' };
  const full = raw.match(/,\s*([^,]+),\s*([A-Z]{2})(?:\s+\d{5})?\s*$/i);
  if (full) return { city: full[1].trim(), state: full[2].toUpperCase() };
  return { city: '', state: '' };
}

function waitForTabComplete(tabId, maxMs = 22000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    };
    const onUpdated = (updatedId, info) => {
      if (updatedId === tabId && info.status === 'complete') finish();
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || tab?.status === 'complete') finish();
    });
    setTimeout(finish, maxMs);
  });
}

async function scrapeMapsPlaceUrl(mapsUrl) {
  const url = String(mapsUrl || '').trim();
  if (!url) throw new Error('Missing Maps URL');
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await waitForTabComplete(tab.id);
    await sleep(850);
    for (const file of ENRICH_SCRIPTS) {
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [file] });
      } catch (_) {
        /* script may already be injected */
      }
    }
    await sleep(300);
    return await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tab.id, { action: 'bulkScrapePlacePage' }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response?.detail || {});
      });
    });
  } finally {
    try {
      await chrome.tabs.remove(tab.id);
    } catch (_) {
      /* tab may already be closed */
    }
  }
}

async function runParallelPool(items, worker, concurrency) {
  if (!items.length) return [];
  const results = new Array(items.length);
  let nextIndex = 0;
  async function runWorker() {
    while (nextIndex < items.length) {
      const i = nextIndex;
      nextIndex += 1;
      results[i] = await worker(items[i], i);
    }
  }
  const workers = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workers }, runWorker));
  return results;
}

function emitEnrichProgress(payload) {
  try {
    chrome.runtime.sendMessage({ action: 'bulkScrapeProgress', ...payload });
  } catch (_) {
    /* popup may be closed */
  }
}

function needsCompanyEnrichment(company) {
  const mapsUrl = String(company['Google Maps URL'] || '').trim();
  if (!mapsUrl) return false;
  if (!String(company.Website || '').trim()) return true;
  if (!String(company.Address || '').includes(',')) return true;
  if (!String(company.City || '').trim() || !String(company.State || '').trim()) return true;
  return false;
}

function mergeDetailIntoCompany(company, detail) {
  const out = { ...company };
  if (detail.Website && !out.Website) out.Website = detail.Website;
  if (detail.Address && (!out.Address || !out.Address.includes(','))) out.Address = detail.Address;
  if (detail['Phone Number'] && !out['Phone Number']) out['Phone Number'] = detail['Phone Number'];
  if (detail.City && !out.City) out.City = detail.City;
  if (detail.State && !out.State) out.State = detail.State;
  if (out.Address && (!out.City || !out.State)) {
    const geo = parseCityStateSimple(out.Address);
    if (!out.City && geo.city) out.City = geo.city;
    if (!out.State && geo.state) out.State = geo.state;
  }
  return out;
}

function buildReEnrichPatchFromDetail(detail, lead) {
  const patch = {};
  const missing = new Set(lead.missing || []);
  const website = String(detail?.Website || '').trim();
  if (website && missing.has('website')) {
    patch.website = website;
    const domain = hostnameFromWebsite(website);
    if (domain) patch.companyDomain = domain;
  }
  const address = String(detail?.Address || '').trim();
  if (address) {
    const geo = parseCityStateSimple(address);
    if (missing.has('city') && geo.city) patch.city = geo.city;
    if (missing.has('state') && geo.state) patch.state = geo.state;
    if (missing.has('city') && detail?.City) patch.city = detail.City;
    if (missing.has('state') && detail?.State) patch.state = detail.State;
    patch.address = address;
  }
  const phone = String(detail?.['Phone Number'] || '').trim();
  if (phone && missing.has('phone')) patch.phone = phone;
  else if (phone && !lead.phone) patch.phone = phone;
  return patch;
}

async function parallelEnrichCompanies(companies, concurrency = PARALLEL_ENRICH_CONCURRENCY) {
  const updated = companies.map((c) => ({ ...c }));
  const targets = updated
    .map((company, index) => ({ company, index }))
    .filter(({ company }) => needsCompanyEnrichment(company));

  let enrichedCount = 0;
  let completed = 0;

  await runParallelPool(
    targets,
    async ({ company, index }) => {
      try {
        const detail = await scrapeMapsPlaceUrl(company['Google Maps URL']);
        const beforeWebsite = updated[index].Website;
        updated[index] = mergeDetailIntoCompany(updated[index], detail);
        if (updated[index].Website && !beforeWebsite) enrichedCount += 1;
      } catch (_) {
        /* skip failed place */
      }
      completed += 1;
      emitEnrichProgress({
        phase: 'enrich-parallel',
        current: completed,
        total: targets.length,
        businessCount: companies.length,
      });
    },
    concurrency,
  );

  return { companies: updated, enrichedCount };
}

async function parallelReEnrichFolder({ folderName, limit = 150, concurrency = PARALLEL_ENRICH_CONCURRENCY }) {
  const queue = await getReEnrichQueue({ folderName, limit });
  const leads = queue.leads || [];
  if (!leads.length) {
    return {
      updated: 0,
      attempted: 0,
      totalNeeding: 0,
      folderName: queue.folderName || folderName,
      empty: true,
    };
  }
  let updated = 0;
  let completed = 0;

  await runParallelPool(
    leads,
    async (lead) => {
      try {
        const detail = await scrapeMapsPlaceUrl(lead.mapsUrl);
        const patch = buildReEnrichPatchFromDetail(detail, lead);
        if (Object.keys(patch).length) {
          const res = await patchLeadContact({ leadKey: lead.key, patch });
          if (res?.updated) updated += 1;
        }
      } catch (_) {
        /* skip */
      }
      completed += 1;
      emitEnrichProgress({
        phase: 're-enrich-parallel',
        current: completed,
        total: leads.length,
      });
    },
    concurrency,
  );

  return {
    updated,
    attempted: leads.length,
    totalNeeding: queue.totalNeeding || leads.length,
    folderName: queue.folderName || folderName,
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'SAVE_LEAD') {
    saveLeadToAdHello(message.lead)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
  }

  if (message?.type === 'IMPORT_CSV') {
    importCsvToAdHello(message)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
  }

  if (message?.type === 'GET_SETTINGS') {
    getSettings().then((settings) => sendResponse({ ok: true, settings }));
    return true;
  }

  if (message?.type === 'GET_REENRICH_QUEUE') {
    getReEnrichQueue(message)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
  }

  if (message?.type === 'PATCH_LEAD') {
    patchLeadContact({ leadKey: message.leadKey, patch: message.patch })
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
  }

  if (message?.type === 'PARALLEL_ENRICH_COMPANIES') {
    parallelEnrichCompanies(message.companies, message.concurrency)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
  }

  if (message?.type === 'PARALLEL_REENRICH_FOLDER') {
    parallelReEnrichFolder(message)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
  }
});
