/**
 * Pavlex lead-gen tools — lead folders, Maps lead searches, bookmarks, script library.
 * Each tool reuses the code path behind the matching app UI action and touches only ctx.workspaceId.
 */
const dbService = require('../database');
const workspaceIntegrations = require('../workspaceIntegrations');
const mapsSearch = require('../mapsSearch');
const directoryLeadSearch = require('../directoryLeadSearch');
const { kickoffFolderSearchInBackground } = require('../folderSearchRun');
const { normalizeSearchPreset } = require('../folderSearchPreset');
const { JOB_TYPES } = require('../scrapeJobTypes');
const { SCRIPT_LIBRARY } = require('../salesConstants');
const workspaceSalesScripts = require('../workspaceSalesScripts');
const {
  normalizeLibraryItem,
  dedupeLibraryItems,
  appendLibraryItemIdempotent,
  splitOfferScriptForSave,
  clampSectionText,
} = require('../salesScriptsStorage');
const { filterLeadsForRequest } = require('../workspaceService');
const { buildReqLike, resolveFolderRef, mapFolderSummary } = require('./mcpCrmService');
const { recordActivity } = require('./mcpPavlexOps');

const MAX_FOLDERS_PER_CALL = 25;
const MAX_FOLDER_NAME_LEN = 120;
const DEFAULT_MAX_RESULTS = 20;
const MAX_RESULTS_CAP = 60;
const MAX_BOOKMARK_LEADS = 100;
const SEARCH_POLL_MS = 5000;
const MAX_TRACKED_SEARCHES = 200;
const SCRIPT_SECTIONS = new Set([
  'opening',
  'discovery',
  'valueProp',
  'objectionHandling',
  'close',
  'sms',
  'email',
]);

const US_STATES = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
  connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY',
  louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR',
  pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD',
  tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA',
  'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
};
const STATE_CODES = new Set(Object.values(US_STATES));

function invalid(message, code = 'INVALID_ARGUMENT') {
  const err = new Error(message);
  err.code = code;
  return err;
}

function requireWorkspace(ctx) {
  const wid = String((ctx && ctx.workspaceId) || '').trim();
  if (!wid) throw invalid('A workspace is required.', 'UNAUTHORIZED');
  return wid;
}

function cleanFolderName(raw) {
  return String(raw || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_FOLDER_NAME_LEN);
}

function folderNameKey(raw) {
  return cleanFolderName(raw).toLowerCase();
}

function findFolderByExactName(folders, name) {
  const want = folderNameKey(name);
  if (!want) return null;
  return (folders || []).find((f) => f && f.key && folderNameKey(f.name) === want) || null;
}

function hasFolderRef(input, prefix = '') {
  return Boolean(
    String(input[`${prefix}folder_id`] || '').trim() || String(input[`${prefix}folder_name`] || '').trim(),
  );
}

/* dbService.createFolder keys folders by Date.now(); two creates in the same millisecond collide. */
let lastFolderCreateMs = 0;
async function nextFolderTimestampSlot() {
  while (Date.now() <= lastFolderCreateMs) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 1));
  }
  lastFolderCreateMs = Date.now();
}

/** Same write as POST /folders (Folder manager), plus exact-name idempotency. */
async function ensureFolder(ctx, name, { parent = null, jobType = '', description = '' } = {}) {
  const wid = requireWorkspace(ctx);
  const clean = cleanFolderName(name);
  if (!clean) throw invalid('Folder name is required.');
  const folders = await dbService.listFolders(wid);
  const existing = findFolderByExactName(folders, clean);
  if (existing) return { folder: existing, existed: true };

  const meta = {};
  if (parent && parent.key) {
    meta.parentFolderKey = String(parent.key);
    if (parent.jobType) meta.jobType = String(parent.jobType);
  }
  if (!meta.jobType && jobType) meta.jobType = jobType;
  await nextFolderTimestampSlot();
  let folder = await dbService.createFolder(wid, clean, meta);
  const desc = String(description || '').trim().slice(0, 500);
  if (desc && folder && folder.key) {
    folder = (await dbService.updateFolder(wid, folder.key, { description: desc })) || folder;
  }
  recordActivity(ctx, { category: 'leads', action: 'folder_create', summary: `Created folder "${clean}"` });
  return { folder, existed: false };
}

async function resolveParentFolder(ctx, input) {
  if (!hasFolderRef(input, 'parent_')) return null;
  return resolveFolderRef(ctx.workspaceId, {
    folder_id: input.parent_folder_id,
    folder_name: input.parent_folder_name,
  });
}

function folderOut(folder, existed) {
  return {
    ...mapFolderSummary(folder, undefined),
    description: folder.description || '',
    existed: !!existed,
  };
}

async function createFolder(ctx, input = {}) {
  requireWorkspace(ctx);
  const rawNames = Array.isArray(input.names) ? input.names : [];
  if (input.name != null) rawNames.unshift(input.name);
  const names = [];
  const seen = new Set();
  for (const raw of rawNames) {
    const clean = cleanFolderName(raw);
    if (!clean || seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());
    names.push(clean);
  }
  if (!names.length) throw invalid('Provide a folder name (name) or a list of names (names).');
  if (names.length > MAX_FOLDERS_PER_CALL) {
    throw invalid(`Maximum ${MAX_FOLDERS_PER_CALL} folders per create_folder call.`);
  }
  const parent = await resolveParentFolder(ctx, input);
  const out = [];
  for (const name of names) {
    // eslint-disable-next-line no-await-in-loop
    const { folder, existed } = await ensureFolder(ctx, name, {
      parent,
      description: names.length === 1 ? input.description : '',
    });
    out.push(folderOut(folder, existed));
  }
  const createdCount = out.filter((f) => !f.existed).length;
  return {
    folder: out.length === 1 ? out[0] : undefined,
    existed: out.length === 1 ? out[0].existed : undefined,
    folders: out,
    created: createdCount,
    alreadyExisted: out.length - createdCount,
    parentFolder: parent ? { key: parent.key, name: parent.name } : null,
    kind: 'lead_folder',
  };
}

async function renameFolder(ctx, input = {}) {
  const wid = requireWorkspace(ctx);
  const newName = cleanFolderName(input.new_name || input.newName);
  if (!newName) throw invalid('new_name is required.');
  const folder = await resolveFolderRef(wid, input);
  const oldName = folder.name || 'folder';
  const clash = findFolderByExactName(await dbService.listFolders(wid), newName);
  if (clash && clash.key !== folder.key) {
    throw invalid(`Another folder is already named "${clash.name}".`, 'CONFLICT');
  }
  const renamed = await dbService.renameFolder(wid, folder.key, newName);
  if (!renamed) throw invalid('Folder not found.', 'NOT_FOUND');
  recordActivity(ctx, {
    category: 'leads',
    action: 'folder_rename',
    summary: `Renamed folder "${oldName}" → "${newName}"`,
  });
  return { folder: folderOut(renamed, false), previousName: oldName };
}

// ── Lead search (folder "Run search" path) ───────────────────────────────────

function parseState(raw) {
  const s = String(raw || '').replace(/\./g, '').trim();
  if (!s) return '';
  if (s.length === 2 && STATE_CODES.has(s.toUpperCase())) return s.toUpperCase();
  return US_STATES[s.toLowerCase()] || '';
}

function parseLocation(input = {}) {
  let city = String(input.city || '').trim();
  let state = parseState(input.state);
  const loc = String(input.location || '').trim();
  if (loc && (!city || !state)) {
    const cleaned = loc.replace(/\s+\d{5}(-\d{4})?$/, '').replace(/,?\s*(usa|us|united states)$/i, '');
    const parts = cleaned.split(',').map((p) => p.trim()).filter(Boolean);
    let locCity = '';
    let locState = '';
    if (parts.length >= 2) {
      locState = parseState(parts[parts.length - 1]);
      if (locState) locCity = parts.slice(0, -1).join(', ');
    } else if (parts.length === 1) {
      const words = parts[0].split(/\s+/);
      for (let n = Math.min(3, words.length - 1); n >= 1 && !locState; n -= 1) {
        locState = parseState(words.slice(-n).join(' '));
        if (locState) locCity = words.slice(0, -n).join(' ');
      }
    }
    city = city || locCity || (locState ? '' : parts[0] || '');
    state = state || locState;
  }
  return { city, state };
}

function clampMaxResults(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_RESULTS;
  return Math.min(n, MAX_RESULTS_CAP);
}

function titleCase(s) {
  return String(s || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

/** In-process search queue: the app runs one background search at a time (global active_job). */
const searchJobs = new Map();
const searchQueue = [];
let runningSearchId = null;
let pumpTimer = null;
let pumping = false;
let pollMs = SEARCH_POLL_MS;

function trimTrackedSearches() {
  if (searchJobs.size <= MAX_TRACKED_SEARCHES) return;
  for (const [id, job] of searchJobs) {
    if (searchJobs.size <= MAX_TRACKED_SEARCHES) break;
    if (job.status === 'completed' || job.status === 'failed') searchJobs.delete(id);
  }
}

function schedulePump(ms = pollMs) {
  if (pumpTimer) return;
  pumpTimer = setTimeout(() => {
    pumpTimer = null;
    pumpSearchQueue().catch((e) => console.warn('[pavlex-search] pump failed:', e && e.message));
  }, ms);
  if (pumpTimer && typeof pumpTimer.unref === 'function') pumpTimer.unref();
}

async function finalizeRunningSearch() {
  const job = searchJobs.get(runningSearchId);
  runningSearchId = null;
  if (!job) return;
  const finished = await dbService.getLatestFinishedJob().catch(() => null);
  job.finishedAt = new Date().toISOString();
  const matches = finished && String(finished.targetFolderKey || '') === job.folderKey;
  if (matches && finished.status === 'failed') {
    job.status = 'failed';
    job.error = String(finished.error || 'Search failed');
  } else {
    job.status = 'completed';
    if (matches) {
      job.resultCount = finished.resultCount != null ? finished.resultCount : null;
      job.savedCount = finished.savedCount != null ? finished.savedCount : null;
      job.searchKey = finished.searchKey || null;
    }
  }
}

async function startQueuedSearch(job) {
  const folder = await dbService.getFolder(job.workspaceId, job.folderKey);
  if (!folder) {
    job.status = 'failed';
    job.error = 'Target folder no longer exists.';
    job.finishedAt = new Date().toISOString();
    return false;
  }
  job.status = 'running';
  job.startedAt = new Date().toISOString();
  runningSearchId = job.id;
  await kickoffFolderSearchInBackground({ workspaceId: job.workspaceId, folder, preset: job.preset });
  const where = [job.city, job.state].filter(Boolean).join(', ');
  recordActivity(job.activityCtx, {
    category: 'search',
    action: 'folder_search',
    summary: `Ran folder search for "${folder.name || 'folder'}" · "${job.keyword}"${where ? ` in ${where}` : ''}`,
    meta: { folderKey: folder.key, searchId: job.id },
  });
  return true;
}

async function pumpSearchQueue() {
  if (pumping) return;
  pumping = true;
  try {
    if (runningSearchId) {
      if (await dbService.getActiveJob()) {
        schedulePump();
        return;
      }
      await finalizeRunningSearch();
    }
    while (searchQueue.length) {
      if (await dbService.getActiveJob()) {
        schedulePump();
        return;
      }
      const job = searchJobs.get(searchQueue.shift());
      if (!job) continue;
      // eslint-disable-next-line no-await-in-loop
      const started = await startQueuedSearch(job);
      if (started) {
        schedulePump();
        return;
      }
    }
  } finally {
    pumping = false;
  }
}

function publicSearchJob(job) {
  const out = {
    search_id: job.id,
    status: job.status,
    keyword: job.keyword,
    city: job.city,
    state: job.state,
    maxResults: job.maxResults,
    folder: { key: job.folderKey, name: job.folderName },
    queuedAt: job.queuedAt,
    startedAt: job.startedAt || null,
    finishedAt: job.finishedAt || null,
  };
  if (job.status === 'queued') out.queuePosition = searchQueue.indexOf(job.id) + 1;
  if (job.resultCount != null) out.resultCount = job.resultCount;
  if (job.savedCount != null) out.newLeadsSaved = job.savedCount;
  if (job.error) out.error = job.error;
  return out;
}

async function resolveSearchTargetFolder(ctx, input, keyword) {
  const wid = ctx.workspaceId;
  const folderId = String(input.folder_id || '').trim();
  if (folderId) {
    const folder = await resolveFolderRef(wid, { folder_id: folderId });
    return { folder, created: false };
  }
  const name = cleanFolderName(input.folder_name) || titleCase(keyword);
  const parent = await resolveParentFolder(ctx, input);
  const { folder, existed } = await ensureFolder(ctx, name, {
    parent,
    jobType: JOB_TYPES.MAPS_BUSINESS,
  });
  return { folder, created: !existed };
}

async function findLeads(ctx, input = {}) {
  const wid = requireWorkspace(ctx);
  const keyword = String(input.query || input.keyword || input.trade || '').replace(/\s+/g, ' ').trim();
  if (!keyword) throw invalid('query is required (the trade / business type, e.g. "Interior Designers").');
  const { city, state } = parseLocation(input);
  if (!city || !state) {
    throw invalid(
      'A city and US state are required, e.g. location "Camas, WA" (or city + 2-letter state).',
      'NEED_LOCATION',
    );
  }
  const maxResults = clampMaxResults(input.max_results);

  const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(wid);
  if (!mapsSearch.isMapsSearchConfigured(integrationEnv)) {
    throw invalid(
      'Lead search is not configured for this workspace. Add a RapidAPI, SearchAPI.io, SerpAPI, Outscraper, Monid, or Apify key under Workspace → API integrations.',
      'PROVIDER_NOT_CONFIGURED',
    );
  }

  const { folder, created } = await resolveSearchTargetFolder(ctx, input, keyword);
  const preset = normalizeSearchPreset(
    {
      jobType: JOB_TYPES.MAPS_BUSINESS,
      keyword,
      city,
      state,
      maxResults,
      mapsProvider: 'auto',
      directorySupplement: directoryLeadSearch.directorySupplementEnabled(integrationEnv),
      minRating: input.min_rating,
      minReviews: input.min_reviews,
    },
    { defaultKeyword: '' },
  );

  const email = String(ctx.userEmail || '').trim().toLowerCase();
  const job = {
    id: `pavlex_search_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    workspaceId: wid,
    folderKey: folder.key,
    folderName: folder.name,
    keyword,
    city: preset.city || city,
    state: preset.state || state,
    maxResults: preset.maxResults,
    preset,
    status: 'queued',
    queuedAt: new Date().toISOString(),
    activityCtx: { workspaceId: wid, userEmail: email },
  };
  searchJobs.set(job.id, job);
  searchQueue.push(job.id);
  trimTrackedSearches();
  await pumpSearchQueue();
  if (job.status === 'queued') schedulePump();

  const where = `${job.city}, ${job.state}`;
  let message;
  if (job.status === 'running') {
    message = `Search started in the background: up to ${job.maxResults} "${keyword}" in ${where} → folder "${folder.name}". New leads land there in a few minutes (duplicates merge). Use get_search_status to check.`;
  } else if (job.status === 'queued') {
    message = `Another search is running, so this one is queued (#${searchQueue.indexOf(job.id) + 1}). It will run automatically: "${keyword}" in ${where} → folder "${folder.name}".`;
  } else {
    message = job.error || 'Search could not start.';
  }
  return {
    ...publicSearchJob(job),
    folderCreated: created,
    async: true,
    message,
  };
}

async function getSearchStatus(ctx, input = {}) {
  const wid = requireWorkspace(ctx);
  await pumpSearchQueue();
  const id = String(input.search_id || '').trim();
  const mine = [...searchJobs.values()].filter((j) => j.workspaceId === wid);
  const active = await dbService.getActiveJob();
  const activeInWorkspace =
    active && String(active.targetFolderKey || '').startsWith(`folder:${wid}:`)
      ? {
          keyword: active.keyword || '',
          city: active.city || '',
          state: active.state || '',
          folder: { key: active.targetFolderKey, name: active.targetFolderName || '' },
          startedAt: active.startedAt || null,
        }
      : null;
  const base = {
    anySearchRunning: !!active,
    activeSearch: activeInWorkspace,
  };
  if (id) {
    const job = searchJobs.get(id);
    if (!job || job.workspaceId !== wid) {
      return {
        ...base,
        search: null,
        message:
          'Unknown search id (the server may have restarted). Check the target folder with count_leads / list_leads.',
      };
    }
    return { ...base, search: publicSearchJob(job) };
  }
  const recent = mine.slice(-10).reverse().map(publicSearchJob);
  return { ...base, searches: recent };
}

// ── Bookmarks (same flag as POST /leads/:key/update { bookmarked }) ─────────

async function bookmarkLeads(ctx, input = {}) {
  const wid = requireWorkspace(ctx);
  const raw = Array.isArray(input.lead_ids) ? input.lead_ids : [];
  const leadIds = [...new Set(raw.map((k) => String(k || '').trim()).filter(Boolean))];
  if (!leadIds.length) throw invalid('lead_ids must be a non-empty array.');
  if (leadIds.length > MAX_BOOKMARK_LEADS) {
    throw invalid(`Maximum ${MAX_BOOKMARK_LEADS} leads per bookmark_leads call.`);
  }
  const want = input.bookmarked === undefined ? true : input.bookmarked === true || input.bookmarked === 'true';
  const visible = filterLeadsForRequest(
    buildReqLike(wid, ctx.userEmail),
    await dbService.getAllLeads(wid),
  );
  const byKey = new Map(visible.map((l) => [l.key, l]));
  const results = [];
  let changed = 0;
  for (const rawId of leadIds) {
    const norm = rawId.startsWith('lead:') ? rawId : `lead:${rawId}`;
    let lead = byKey.get(norm) || byKey.get(rawId);
    if (!lead) {
      // eslint-disable-next-line no-await-in-loop
      const resolved = await dbService.resolveLeadStorageKey(rawId, wid);
      if (resolved) lead = byKey.get(resolved);
    }
    if (!lead) {
      results.push({ lead_id: rawId, success: false, error: 'Lead not found in this workspace.', code: 'NOT_FOUND' });
      continue;
    }
    if (!!lead.bookmarked === want) {
      results.push({ lead_id: lead.key, title: lead.title || '', success: true, bookmarked: want, unchanged: true });
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const updated = await dbService.updateLead(lead.key, { bookmarked: want }, wid);
    if (!updated) {
      results.push({ lead_id: lead.key, success: false, error: 'Lead not found.', code: 'NOT_FOUND' });
      continue;
    }
    changed += 1;
    recordActivity(ctx, {
      category: 'leads',
      action: 'lead_edit',
      summary: want ? 'Bookmarked' : 'Removed bookmark',
      leadKey: lead.key,
      leadTitle: updated.title || lead.title || '',
    });
    results.push({ lead_id: lead.key, title: updated.title || lead.title || '', success: true, bookmarked: want });
  }
  const ok = results.filter((r) => r.success).length;
  return {
    bookmarked: want,
    changed,
    unchanged: ok - changed,
    failed: results.length - ok,
    results,
  };
}

// ── Script library (same write as POST /workspace/scripts/library) ─────────

async function saveScript(ctx, input = {}) {
  const wid = requireWorkspace(ctx);
  const body = String(input.body || input.text || '').trim();
  if (!body) throw invalid('body is required (write the full script text).');
  let title = String(input.name || input.title || '').trim().slice(0, 200);
  let folder = null;
  if (hasFolderRef(input)) {
    folder = await resolveFolderRef(wid, { folder_id: input.folder_id, folder_name: input.folder_name });
    const fname = String(folder.name || '').trim();
    if (fname && !title.toLowerCase().includes(fname.toLowerCase())) {
      title = `${fname} — ${title || 'Opening script'}`.slice(0, 200);
    }
  }
  const sectionRaw = String(input.section || 'opening').trim();
  const section = SCRIPT_SECTIONS.has(sectionRaw) ? sectionRaw : 'opening';

  const ws = await dbService.getWorkspace(wid);
  if (!ws) throw invalid('Workspace not found.', 'NOT_FOUND');
  const offerRef = String(input.offer || input.offer_key || '').trim();
  if (offerRef) return saveScriptToOffer(ws, offerRef, { body, section, title });
  const { keys, catalog } = workspaceSalesScripts.buildWorkspaceOfferLibrary(ws, SCRIPT_LIBRARY);
  const item = normalizeLibraryItem(
    { title: title || 'Opening script', text: body, section, serviceKey: input.offer_key || '' },
    keys,
  );
  if (!item) throw invalid('Script text required.');
  const cur = dedupeLibraryItems(Array.isArray(ws.salesScriptLibraryItems) ? ws.salesScriptLibraryItems : []);
  const appended = appendLibraryItemIdempotent(cur, item);
  ws.salesScriptLibraryItems = appended.items;
  ws.salesScriptsUpdatedAt = new Date().toISOString();
  await dbService.saveWorkspace(wid, ws);
  const saved = appended.item || item;
  return {
    script: {
      id: saved.id,
      title: saved.title,
      section: saved.section || section,
      offerKey: saved.serviceKey || '',
      savedAt: saved.savedAt,
      length: String(saved.text || '').length,
    },
    duplicate: !!appended.duplicate,
    folder: folder ? { key: folder.key, name: folder.name } : null,
    folderScriptsSupported: false,
    location: 'Scripts → Saved library',
    offers: catalog.map((c) => c.label),
    message:
      (folder
        ? `Saved to the workspace script library as "${saved.title}" (the app has no per-folder scripts, so the folder name is in the title).`
        : `Saved to the workspace script library as "${saved.title}".`) +
      ' To put it in an offer\'s call/SMS/email box on Scripts → By offer, call save_script again with offer set.',
  };
}

/** Write the script into an offer's call / SMS / email box (Scripts → By offer); creates the offer if missing. */
async function saveScriptToOffer(ws, offerRef, { body, section, title }) {
  const wid = ws.id;
  const catalog = workspaceSalesScripts.resolveWorkspaceOfferCatalog(ws, SCRIPT_LIBRARY);
  let entry = workspaceSalesScripts.findOfferByName(catalog, offerRef);
  let created = false;
  if (!entry) {
    entry = workspaceSalesScripts.normalizeOfferCatalogEntry(
      { label: offerRef.slice(0, 120) },
      new Set(catalog.map((c) => c.key)),
    );
    if (!entry) throw invalid(`Could not create an offer named "${offerRef}".`);
    catalog.push(entry);
    created = true;
  }
  const prevAll =
    ws.salesScriptBlockOverrides && typeof ws.salesScriptBlockOverrides === 'object' ? ws.salesScriptBlockOverrides : {};
  const prev = prevAll[entry.key] && typeof prevAll[entry.key] === 'object' ? prevAll[entry.key] : {};
  const next =
    section === 'opening'
      ? { ...prev, ...splitOfferScriptForSave(clampSectionText('opening', body)), sms: prev.sms || '', email: prev.email || '' }
      : { ...prev, [section]: clampSectionText(section, body) };
  ws.salesScriptOfferCatalog = catalog;
  ws.salesScriptBlockOverrides = { ...prevAll, [entry.key]: next };
  ws.salesScriptsUpdatedAt = new Date().toISOString();
  await dbService.saveWorkspace(wid, ws);
  const box = section === 'sms' ? 'SMS script' : section === 'email' ? 'Email script' : 'Call script';
  return {
    script: { title: title || entry.label, section, offerKey: entry.key, length: body.length },
    offer: { key: entry.key, label: entry.label, created },
    location: `Scripts → By offer → ${entry.label} → ${box}`,
    message: `${created ? `Created the "${entry.label}" offer and saved` : 'Saved'} the ${box.toLowerCase()} in Scripts → By offer → ${entry.label}.`,
  };
}

function _resetSearchQueueForTests({ pollIntervalMs } = {}) {
  searchJobs.clear();
  searchQueue.length = 0;
  runningSearchId = null;
  if (pumpTimer) clearTimeout(pumpTimer);
  pumpTimer = null;
  pumping = false;
  pollMs = pollIntervalMs || SEARCH_POLL_MS;
}

module.exports = {
  DEFAULT_MAX_RESULTS,
  MAX_RESULTS_CAP,
  MAX_FOLDERS_PER_CALL,
  createFolder,
  renameFolder,
  ensureFolder,
  findLeads,
  getSearchStatus,
  bookmarkLeads,
  saveScript,
  parseLocation,
  _resetSearchQueueForTests,
};
