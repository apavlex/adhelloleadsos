importScripts('bulk-import-utils.js');

const DEFAULTS = {
  apiBaseUrl: 'https://adhelloleadsos.onrender.com',
  apiKey: '',
  accountEmail: '',
  workspaceId: 'default',
  defaultFolderName: '',
};

async function getSettings(overrides = {}) {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  const workspaceOverride = overrides.workspaceId != null ? String(overrides.workspaceId).trim() : '';
  return {
    apiBaseUrl: String(stored.apiBaseUrl || DEFAULTS.apiBaseUrl).replace(/\/+$/, ''),
    apiKey: String(stored.apiKey || '').trim(),
    accountEmail: String(stored.accountEmail || '').trim().toLowerCase(),
    workspaceId:
      workspaceOverride ||
      String(stored.workspaceId || DEFAULTS.workspaceId).trim() ||
      'default',
    defaultFolderName: String(stored.defaultFolderName || '').trim(),
  };
}

async function saveLeadToAdHello(lead, opts = {}) {
  const settings = await getSettings({ workspaceId: opts.workspaceId });
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

async function importCsvToAdHello({ csvContent, fileName, folderName, workspaceId }) {
  const settings = await getSettings({ workspaceId });
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

async function apiFetch(path, options = {}, workspaceOverride) {
  const settings = await getSettings({ workspaceId: workspaceOverride });
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

async function getReEnrichQueue({ folderName, limit = 150, workspaceId }) {
  const name = String(folderName || '').trim();
  if (!name) throw new Error('Enter a folder name to re-enrich.');
  const params = new URLSearchParams({ folderName: name, limit: String(limit) });
  return apiFetch(`/autonomous/re-enrich-queue?${params.toString()}`, {}, workspaceId);
}

async function patchLeadContact({ leadKey, patch, workspaceId }) {
  const key = encodeURIComponent(String(leadKey || '').replace(/^lead:/, ''));
  if (!key) throw new Error('Lead key is required.');
  return apiFetch(
    `/autonomous/leads/${key}`,
    {
      method: 'PATCH',
      body: JSON.stringify(patch || {}),
    },
    workspaceId,
  );
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

async function parallelReEnrichFolder({
  folderName,
  limit = 150,
  concurrency = PARALLEL_ENRICH_CONCURRENCY,
  workspaceId,
}) {
  const queue = await getReEnrichQueue({ folderName, limit, workspaceId });
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
          const res = await patchLeadContact({ leadKey: lead.key, patch, workspaceId });
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

const BULK_IMPORT_BATCH_SIZE = AdHelloBulkImport.BULK_IMPORT_BATCH_SIZE;

let bulkScrapeJobRunning = false;
let bulkScrapeStopRequested = false;

function emitBulkJobProgress(payload) {
  try {
    chrome.runtime.sendMessage({ action: 'bulkScrapeProgress', ...payload });
  } catch (_) {
    /* popup may be closed */
  }
  chrome.storage.local.set({
    bulkScrapeJob: { ...payload, updatedAt: Date.now() },
  });
}

async function ensureBulkScript(tabId) {
  const files = ['src/address-utils.js', 'src/maps-bulk-scrape.js'];
  for (const file of files) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: [file] });
    } catch (_) {
      /* content script may already be present */
    }
  }
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

async function importCompaniesInBatches(companies, folderName, fileSlug, onProgress, workspaceId) {
  let created = 0;
  let updated = 0;
  let failed = 0;
  let folderLabel = folderName;
  let folderKey = '';
  let folderUrl = '';
  const total = companies.length;

  for (let i = 0; i < total; i += BULK_IMPORT_BATCH_SIZE) {
    const chunk = companies.slice(i, i + BULK_IMPORT_BATCH_SIZE);
    const batchNum = Math.floor(i / BULK_IMPORT_BATCH_SIZE) + 1;
    const batchTotal = Math.ceil(total / BULK_IMPORT_BATCH_SIZE);
    if (onProgress) {
      onProgress(
        `Importing batch ${batchNum}/${batchTotal} (${Math.min(i + chunk.length, total)}/${total} businesses)…`,
      );
    }

    const data = await importCsvToAdHello({
      csvContent: AdHelloBulkImport.companiesToCsv(chunk),
      fileName: `${fileSlug || 'maps-scrape'}-batch-${batchNum}.csv`,
      folderName,
      workspaceId,
    });

    created += data.created || 0;
    updated += data.updated || 0;
    failed += data.failed || 0;
    if (data.folderName) folderLabel = data.folderName;
    if (data.folderKey) folderKey = data.folderKey;
    if (data.folderUrl) folderUrl = data.folderUrl;
  }

  return { created, updated, failed, folderName: folderLabel, folderKey, folderUrl };
}

function slugFromSearchQuery(searchQuery) {
  return String(searchQuery || 'maps-scrape')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 40);
}

async function runBulkScrapeJob({ tabId, folderName, scrollAll, enrichDetails, workspaceId }) {
  if (bulkScrapeJobRunning) {
    throw new Error('A bulk scrape is already running. Wait for it to finish or reload the extension.');
  }

  bulkScrapeJobRunning = true;
  bulkScrapeStopRequested = false;

  try {
    emitBulkJobProgress({ phase: 'start', folderName });

    await chrome.tabs.update(tabId, { active: true });
    await ensureBulkScript(tabId);

    if (scrollAll) {
      emitBulkJobProgress({ phase: 'scroll', businessCount: 0, scrollAttempts: 0 });
      const preload = await sendTabMessage(tabId, { action: 'bulkPreload' });
      if (!preload?.success) {
        throw new Error(
          preload?.reason === 'no_container'
            ? 'Could not find the Maps results list. Try opening the left-side results panel.'
            : 'Could not scroll the results list.',
        );
      }
      if (bulkScrapeStopRequested || preload.stoppedByUser) {
        emitBulkJobProgress({
          phase: 'scroll-stopped',
          businessCount: preload.businessCount || 0,
        });
      }
    }

    emitBulkJobProgress({ phase: 'extract' });
    const extract = await sendTabMessage(tabId, {
      action: 'bulkGetCompanies',
      enrichDetails: false,
    });
    const companies = extract?.companies || [];
    if (!companies.length) {
      throw new Error('No businesses found. Scroll the Maps list manually, then try again.');
    }

    const searchSlug = slugFromSearchQuery(extract?.searchQuery);
    const importData = await importCompaniesInBatches(
      companies,
      folderName,
      searchSlug,
      (msg) => {
        emitBulkJobProgress({ phase: 'import', message: msg });
      },
      workspaceId,
    );

    emitBulkJobProgress({
      phase: 'import-done',
      businessCount: companies.length,
      created: importData.created,
      updated: importData.updated,
      failed: importData.failed,
      folderName: importData.folderName || folderName,
      folderKey: importData.folderKey || '',
      folderUrl: importData.folderUrl || '',
    });

    let enrichData = null;
    const targetFolder = importData.folderName || folderName;
    if (enrichDetails) {
      emitBulkJobProgress({ phase: 're-enrich-start', folderName: targetFolder });
      enrichData = await parallelReEnrichFolder({
        folderName: targetFolder,
        limit: Math.max(companies.length, 150),
        workspaceId,
      });
    }

    const result = {
      companiesCount: companies.length,
      ...importData,
      enrichData,
    };
    emitBulkJobProgress({ phase: 'done', ...result });
    return result;
  } catch (err) {
    emitBulkJobProgress({ phase: 'error', error: err.message || String(err) });
    throw err;
  } finally {
    bulkScrapeJobRunning = false;
    bulkScrapeStopRequested = false;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'SAVE_LEAD') {
    saveLeadToAdHello(message.lead, { workspaceId: message.workspaceId })
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

  if (message?.type === 'RUN_BULK_SCRAPE') {
    runBulkScrapeJob(message)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
  }

  if (message?.type === 'BULK_SCRAPE_STOP') {
    bulkScrapeStopRequested = true;
    if (message?.tabId) {
      sendTabMessage(message.tabId, { action: 'bulkStopPreload' }).catch(() => {});
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === 'GET_BULK_SCRAPE_STATUS') {
    chrome.storage.local.get('bulkScrapeJob').then(({ bulkScrapeJob }) => {
      sendResponse({ ok: true, job: bulkScrapeJob || null, running: bulkScrapeJobRunning });
    });
    return true;
  }
});
