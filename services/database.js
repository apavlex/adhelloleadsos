const Database = require('@replit/database');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { clampPipelineStage, PIPELINE_SCHEMA_VERSION } = require('./pipelineConstants');

let db;

function isBlankValue(v) {
  if (v == null) return true;
  if (typeof v === 'string') {
    const s = v.trim();
    return s === '' || s.toLowerCase() === 'n/a' || s === '—' || s === '-';
  }
  return false;
}

function normalizeEmail(email) {
  if (!email || email === 'N/A') return '';
  return String(email).trim().toLowerCase();
}

function normalizeDomain(website) {
  if (!website || website === 'N/A') return '';
  let s = String(website).trim();
  if (!s) return '';
  s = s.replace(/^https?:\/\//i, '');
  s = s.replace(/^www\./i, '');
  s = s.split(/[/?#]/)[0] || '';
  return s.trim().toLowerCase();
}

function normalizePhone(phone) {
  if (!phone || phone === 'N/A') return '';
  const digits = String(phone).replace(/\D+/g, '');
  if (!digits) return '';
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function normalizeName(name) {
  if (!name) return '';
  return String(name)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\b(llc|inc|corp|co|company|ltd|pllc|pc|group|studio)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeGeo(city, state) {
  const c = city ? String(city).trim().toLowerCase() : '';
  const st = state ? String(state).trim().toLowerCase() : '';
  if (!c || !st) return '';
  return `${c}|${st}`;
}

function computeDedupeKey(lead) {
  const em = normalizeEmail(lead.email);
  if (em) return `email:${em}`;
  const dom = normalizeDomain(lead.website);
  if (dom) return `domain:${dom}`;
  const ph = normalizePhone(lead.phone);
  if (ph) return `phone:${ph}`;
  const nm = normalizeName(lead.title);
  const geo = normalizeGeo(lead.city, lead.state);
  if (nm && geo) return `namegeo:${nm}|${geo}`;
  return '';
}

function appendUpdates(existingUpdates, incomingUpdates) {
  const base = Array.isArray(existingUpdates) ? existingUpdates : [];
  const add = Array.isArray(incomingUpdates) ? incomingUpdates : [];
  if (add.length === 0) return base;
  return [...base, ...add];
}

function mergePreferExisting(existing, incoming) {
  const out = {};
  for (const [k, v] of Object.entries(incoming || {})) {
    if (k === 'key' || k === 'workspaceId' || k === 'createdAt') continue;
    if (k === 'logs' || k === 'chatHistory') continue;
    if (k === 'updates') continue;
    if (k === 'importFields' && incoming.importFields && typeof incoming.importFields === 'object') {
      out.importFields = { ...(existing.importFields || {}), ...incoming.importFields };
      continue;
    }
    if (k === 'pipelineStage' || k === 'status') continue;
    if (isBlankValue(v)) continue;
    const cur = existing ? existing[k] : undefined;
    if (isBlankValue(cur)) out[k] = v;
  }

  if (!existing) return out;

  if (!isBlankValue(incoming?.status) && isBlankValue(existing.status)) out.status = incoming.status;
  if (incoming?.pipelineStage !== undefined && existing.pipelineStage == null) out.pipelineStage = incoming.pipelineStage;

  // Re-import from LeadGorilla / GBP CSV: replace stored 0 when the file has real review stats
  const incRev = parseInt(String(incoming?.reviewsCount ?? ''), 10);
  const curRev = parseInt(String(existing?.reviewsCount ?? ''), 10);
  if (Number.isFinite(incRev) && incRev > 0 && (!Number.isFinite(curRev) || curRev === 0)) {
    out.reviewsCount = incoming.reviewsCount;
  }
  const incRating = parseFloat(String(incoming?.totalScore ?? ''));
  const curRating = parseFloat(String(existing?.totalScore ?? ''));
  if (Number.isFinite(incRating) && incRating > 0 && (!Number.isFinite(curRating) || curRating === 0)) {
    out.totalScore = incoming.totalScore;
  }
  if (
    isBlankValue(existing?.gbpClaimStatus) &&
    !isBlankValue(incoming?.gbpClaimStatus)
  ) {
    out.gbpClaimStatus = incoming.gbpClaimStatus;
  }
  if (
    isBlankValue(existing?.gbpOptimizationScore) &&
    !isBlankValue(incoming?.gbpOptimizationScore)
  ) {
    out.gbpOptimizationScore = incoming.gbpOptimizationScore;
  }

  return out;
}

// On Replit, auto-connects via REPLIT_DB_URL env var
// For local dev, falls back to a file-backed store so data persists across restarts
if (process.env.REPLIT_DB_URL) {
  db = new Database();
} else {
  const DB_FILE = path.join(__dirname, '..', 'data', 'local-db.json');

  // Ensure data directory exists
  const dataDir = path.dirname(DB_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Load existing data from file
  let store = {};
  if (fs.existsSync(DB_FILE)) {
    try {
      store = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
    } catch {
      store = {};
    }
  }

  function persist() {
    fs.writeFileSync(DB_FILE, JSON.stringify(store, null, 2));
  }

  console.log('REPLIT_DB_URL not found. Using file-backed local database (data/local-db.json).');
  db = {
    get: async (key) => store[key] || null,
    set: async (key, value) => { store[key] = value; persist(); },
    list: async (prefix = '') => Object.keys(store).filter((k) => k.startsWith(prefix)),
    delete: async (key) => { delete store[key]; persist(); },
  };
}

function assertLeadScopedWorkspaceId(workspaceId, methodName) {
  const ok = workspaceId != null && String(workspaceId).trim() !== '';
  if (ok) return;
  const label = methodName || 'Lead-scoped query';
  const msg = `[workspace] ${label} requires workspaceId`;
  if (process.env.NODE_ENV !== 'production') throw new Error(msg);
  console.warn(msg);
}

module.exports = {
  async saveSearch(searchData) {
    const key = `search:${Date.now()}`;
    await db.set(key, JSON.stringify(searchData));
    return key;
  },

  async getSearch(key) {
    const data = await db.get(key);
    if (!data) return null;
    // Handle both v2 (raw string) and v3 ({ ok, value }) return formats
    const raw = data && typeof data === 'object' && 'ok' in data ? data.value : data;
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  },

  async listSearches() {
    const keys = await db.list('search:');
    // Handle v3 format if needed
    const keyList = Array.isArray(keys) ? keys : (keys && keys.ok ? keys.value : []);
    return keyList.sort((a, b) => {
      const tsA = parseInt(a.split(':')[1]);
      const tsB = parseInt(b.split(':')[1]);
      return tsB - tsA;
    });
  },

  async getAllSearches() {
    const keys = await this.listSearches();
    const searches = [];
    for (const key of keys) {
      const data = await this.getSearch(key);
      if (data) {
        searches.push({ key, ...data });
      }
    }
    return searches;
  },

  async deleteSearch(key) {
    await db.delete(key);
  },

  // --- Leads (bookmarked businesses) ---

  async _resolveWorkspaceIdForWrite(raw) {
    let wid = raw != null && raw !== '' ? String(raw).trim() : '';
    if (wid === 'default' || wid === '') {
      const aliasRaw = await db.get('sys:legacy_default_workspace_id');
      const alias =
        aliasRaw && typeof aliasRaw === 'object' && 'ok' in aliasRaw ? aliasRaw.value : aliasRaw;
      const a = typeof alias === 'string' ? alias.trim() : '';
      if (a) return a;
    }
    return wid || '';
  },

  async saveLead(leadData) {
    const resolved = await this._resolveWorkspaceIdForWrite(leadData.workspaceId);
    assertLeadScopedWorkspaceId(resolved, 'saveLead');
    const wid = resolved;
    const incoming = { ...(leadData || {}), workspaceId: wid };
    incoming.emailNorm = normalizeEmail(incoming.email);
    incoming.domainNorm = normalizeDomain(incoming.website);
    incoming.phoneNorm = normalizePhone(incoming.phone);
    incoming.nameNorm = normalizeName(incoming.title);
    incoming.geoNorm = normalizeGeo(incoming.city, incoming.state);
    incoming.dedupeKey = computeDedupeKey(incoming);

    // Find existing lead to merge into (workspace-scoped)
    const leads = await this.getAllLeads(wid);
    const sameWorkspace = (l) => (l.workspaceId || 'default') === wid;
    const findBy = (pred) => leads.find((l) => sameWorkspace(l) && pred(l)) || null;

    const existing =
      (incoming.emailNorm ? findBy((l) => normalizeEmail(l.email) === incoming.emailNorm) : null) ||
      (incoming.domainNorm ? findBy((l) => normalizeDomain(l.website) === incoming.domainNorm) : null) ||
      (incoming.phoneNorm ? findBy((l) => normalizePhone(l.phone) === incoming.phoneNorm) : null) ||
      (incoming.nameNorm && incoming.geoNorm
        ? findBy(
            (l) => normalizeName(l.title) === incoming.nameNorm && normalizeGeo(l.city, l.state) === incoming.geoNorm
          )
        : null) ||
      (incoming.ip ? findBy((l) => l.ip === incoming.ip) : null);

    if (existing) {
      const patch = mergePreferExisting(existing, incoming);

      // Persist canonical keys for future dedupe and analytics
      patch.emailNorm = existing.emailNorm || incoming.emailNorm || undefined;
      patch.domainNorm = existing.domainNorm || incoming.domainNorm || undefined;
      patch.phoneNorm = existing.phoneNorm || incoming.phoneNorm || undefined;
      patch.nameNorm = existing.nameNorm || incoming.nameNorm || undefined;
      patch.geoNorm = existing.geoNorm || incoming.geoNorm || undefined;
      patch.dedupeKey = existing.dedupeKey || incoming.dedupeKey || undefined;

      // Merge updates (notes/enrichment updates)
      patch.updates = appendUpdates(existing.updates, incoming.updates);

      // Log merge source (updateLead already merges logs arrays)
      patch.logs = [
        {
          type: 'merge',
          message: `Merged incoming lead data from ${incoming.source || 'ingest'}`,
          timestamp: new Date().toISOString(),
        },
      ];

      await this.updateLead(existing.key, patch, wid);
      return existing.key;
    }

    const key = `lead:${Date.now()}`;
    const newLead = {
      ...incoming,
      createdAt: new Date().toISOString(),
      pipelineSchemaVersion: PIPELINE_SCHEMA_VERSION,
      pipelineStage: clampPipelineStage(
        leadData.pipelineStage !== undefined && leadData.pipelineStage !== null
          ? leadData.pipelineStage
          : 1
      ),
      status: leadData.status || 'Lead Captured',
      logs: [{ 
        type: 'creation', 
        message: `Lead created from ${leadData.source || 'ingest'}`, 
        timestamp: new Date().toISOString() 
      }]
    };

    if (wid) {
      try {
        const pss = require('./pipelineStagesService');
        const stages = await pss.ensureWorkspaceStagesSeeded(wid);
        if (stages.length) {
          const sid =
            incoming.stageId && stages.some((s) => s.id === incoming.stageId)
              ? incoming.stageId
              : pss.resolveStageIdForLead({ ...incoming, stageId: incoming.stageId }, stages);
          Object.assign(newLead, pss.patchLeadStageFields(incoming, stages, sid));
          const legacyNum = parseInt(incoming.pipelineStage, 10);
          if (Number.isFinite(legacyNum)) {
            newLead.legacyStageNumber = legacyNum;
          }
        }
      } catch (e) {
        console.warn('[saveLead] pipeline attach:', e.message);
      }
    }

    await db.set(key, JSON.stringify(newLead));
    return key;
  },

  /**
   * @param {string} email
   * @param {string} [workspaceId] When set, only match leads in that workspace (recommended for imports).
   */
  async findLeadByEmail(email, workspaceId) {
    if (!email || email === 'N/A') return null;
    const em = String(email).trim().toLowerCase();
    const wid =
      workspaceId != null && workspaceId !== ''
        ? await this._resolveWorkspaceIdForWrite(workspaceId)
        : null;
    const leads = wid ? await this.getAllLeads(wid) : await this.getAllLeadsUnscoped();
    return (
      leads.find((l) => {
        if (!l.email || String(l.email).toLowerCase() !== em) return false;
        return true;
      }) || null
    );
  },

  async findLeadByIp(ip, workspaceId) {
    if (!ip) return null;
    const wid =
      workspaceId != null && workspaceId !== ''
        ? await this._resolveWorkspaceIdForWrite(workspaceId)
        : null;
    const leads = wid ? await this.getAllLeads(wid) : await this.getAllLeadsUnscoped();
    return (
      leads.find((l) => {
        if (l.ip !== ip) return false;
        return true;
      }) || null
    );
  },

  async getLead(key) {
    const storageKey = String(key || '').trim();
    if (!storageKey) return null;
    const data = await db.get(storageKey);
    if (!data) return null;
    const raw = data && typeof data === 'object' && 'ok' in data ? data.value : data;
    if (!raw) return null;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      ...parsed,
      key: parsed.key || storageKey,
    };
  },

  /** @param {string} [workspaceId] When omitted, only allowed for trusted internal callers via {@link getAllLeadsUnscoped}. */
  async listLeads(workspaceId) {
    return this.getAllLeads(workspaceId);
  },

  /**
   * All leads in one workspace (efficient: skips other workspaces on disk).
   * @param {string} workspaceId
   */
  async getAllLeads(workspaceId) {
    const wid = await this._resolveWorkspaceIdForWrite(workspaceId);
    assertLeadScopedWorkspaceId(wid, 'getAllLeads');
    const aliasRaw = await db.get('sys:legacy_default_workspace_id');
    const aliasVal =
      aliasRaw && typeof aliasRaw === 'object' && 'ok' in aliasRaw ? aliasRaw.value : aliasRaw;
    const aliasStr = typeof aliasVal === 'string' ? aliasVal.trim() : '';
    const normLeadW = (lw) => {
      const x = lw || 'default';
      if (x === 'default' && aliasStr) return aliasStr;
      return x;
    };
    const keys = await db.list('lead:');
    const keyList = Array.isArray(keys) ? keys : (keys && keys.ok ? keys.value : []);
    const sorted = keyList.sort((a, b) => {
      const tsA = parseInt(a.split(':')[1]);
      const tsB = parseInt(b.split(':')[1]);
      return tsB - tsA;
    });
    const leads = [];
    for (const key of sorted) {
      const data = await this.getLead(key);
      if (!data) continue;
      if (normLeadW(data.workspaceId) !== wid) continue;
      leads.push({ key, ...data, workspaceId: wid });
    }
    return leads;
  },

  /** Migration, cron, and sequence runner only — loads every lead row. */
  async getAllLeadsUnscoped() {
    const keys = await db.list('lead:');
    const keyList = Array.isArray(keys) ? keys : (keys && keys.ok ? keys.value : []);
    const sorted = keyList.sort((a, b) => {
      const tsA = parseInt(a.split(':')[1]);
      const tsB = parseInt(b.split(':')[1]);
      return tsB - tsA;
    });
    const leads = [];
    for (const key of sorted) {
      const data = await this.getLead(key);
      if (data) {
        leads.push({ key, ...data });
      }
    }
    return leads;
  },

  async listStorageKeysWithPrefix(prefix) {
    const keys = await db.list(prefix);
    return Array.isArray(keys) ? keys : (keys && keys.ok ? keys.value : []);
  },

  async deleteStorageKey(key) {
    await db.delete(key);
  },

  /** Low-level read for migrations (string or JSON-serialized value). */
  async peekStorageKey(key) {
    const data = await db.get(key);
    const raw = data && typeof data === 'object' && 'ok' in data ? data.value : data;
    return raw != null ? raw : null;
  },

  /** Low-level write for migrations. */
  async putStorageKey(key, value) {
    const payload = typeof value === 'string' ? value : JSON.stringify(value);
    await db.set(key, payload);
  },

  async getUserPrefs(email) {
    const fragment = this._emailKeyFragment(email);
    const storageKey = `userprefs:${fragment}`;
    const data = await db.get(storageKey);
    if (!data) return null;
    const raw = data && typeof data === 'object' && 'ok' in data ? data.value : data;
    if (!raw) return null;
    try {
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return null;
    }
  },

  async saveUserPrefs(email, partial) {
    const fragment = this._emailKeyFragment(email);
    const storageKey = `userprefs:${fragment}`;
    const cur = (await this.getUserPrefs(email)) || {};
    const em = String(email || '').trim().toLowerCase();
    const next = {
      ...cur,
      ...partial,
      email: em || cur.email,
      updatedAt: new Date().toISOString(),
    };
    if (!cur.createdAt) next.createdAt = new Date().toISOString();
    await db.set(storageKey, JSON.stringify(next));
    return next;
  },

  /** Google Drive read scope tokens (per user email) for CSV import from Drive. */
  async getGoogleDriveTokens(email) {
    const em = String(email || '').trim().toLowerCase();
    const fragment = this._emailKeyFragment(em);
    const key = `gdrv_oauth:${fragment}`;
    const data = await db.get(key);
    if (!data) return null;
    const raw = data && typeof data === 'object' && 'ok' in data ? data.value : data;
    if (!raw) return null;
    try {
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return null;
    }
  },

  async mergeGoogleDriveTokens(
    email,
    { accessToken, refreshToken, expiresIn, googleAccountEmail, googleAccountName }
  ) {
    const em = String(email || '').trim().toLowerCase();
    const fragment = this._emailKeyFragment(em);
    const key = `gdrv_oauth:${fragment}`;
    const cur = (await this.getGoogleDriveTokens(em)) || {};
    const ttl = expiresIn != null ? Number(expiresIn) : NaN;
    let expiresAt = cur.expiresAt;
    if (accessToken && Number.isFinite(ttl) && ttl > 0) {
      expiresAt = Date.now() + ttl * 1000;
    } else if (accessToken && !expiresAt) {
      expiresAt = Date.now() + 3600 * 1000;
    }
    const next = {
      ...cur,
      accessToken: accessToken || cur.accessToken || '',
      refreshToken: refreshToken || cur.refreshToken || '',
      expiresAt,
      updatedAt: new Date().toISOString(),
    };
    if (!next.refreshToken && cur.refreshToken) next.refreshToken = cur.refreshToken;
    if (googleAccountEmail) next.googleAccountEmail = String(googleAccountEmail).trim().toLowerCase();
    if (googleAccountName) next.googleAccountName = String(googleAccountName).trim();
    await db.set(key, JSON.stringify(next));
    return next;
  },

  async clearGoogleDriveTokens(email) {
    const em = String(email || '').trim().toLowerCase();
    const fragment = this._emailKeyFragment(em);
    const key = `gdrv_oauth:${fragment}`;
    await db.delete(key);
  },

  async getUserWorkspaceIds(email) {
    const fragment = this._emailKeyFragment(email);
    const storageKey = `userwork:${fragment}`;
    const data = await db.get(storageKey);
    if (!data) return [];
    const raw = data && typeof data === 'object' && 'ok' in data ? data.value : data;
    if (!raw) return [];
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return Array.isArray(parsed) ? parsed.filter(Boolean).map(String) : [];
    } catch {
      return [];
    }
  },

  async setUserWorkspaceIds(email, ids) {
    const fragment = this._emailKeyFragment(email);
    const storageKey = `userwork:${fragment}`;
    const list = Array.isArray(ids) ? [...new Set(ids.map(String).filter(Boolean))] : [];
    await db.set(storageKey, JSON.stringify(list));
    return list;
  },

  async addUserWorkspaceId(email, workspaceId) {
    const wid = String(workspaceId || '').trim();
    if (!wid) return this.getUserWorkspaceIds(email);
    const cur = await this.getUserWorkspaceIds(email);
    if (!cur.includes(wid)) cur.push(wid);
    return this.setUserWorkspaceIds(email, cur);
  },

  async getWorkspaceIdForSlug(slug) {
    const s = String(slug || '')
      .trim()
      .toLowerCase();
    if (!s) return null;
    const data = await db.get(`wslug:${s}`);
    const raw = data && typeof data === 'object' && 'ok' in data ? data.value : data;
    if (raw == null) return null;
    const id = typeof raw === 'string' ? raw.trim() : String(raw);
    return id || null;
  },

  async saveWorkspaceSlug(slug, workspaceId) {
    const s = String(slug || '')
      .trim()
      .toLowerCase();
    if (!s) throw new Error('slug required');
    await db.set(`wslug:${s}`, String(workspaceId));
  },

  async updateLead(key, updateData, expectWorkspaceId) {
    const existing = await this.getLead(key);
    if (!existing) return null;

    if (process.env.NODE_ENV !== 'production' && expectWorkspaceId != null && expectWorkspaceId !== '') {
      const ew = String(expectWorkspaceId).trim();
      const lw = String(existing.workspaceId || '').trim();
      if (!lw) {
        throw new Error(`[workspace] updateLead: lead ${key} is missing workspaceId`);
      }
      if (ew && lw !== ew) {
        throw new Error(`[workspace] updateLead: workspace mismatch for ${key}`);
      }
    }
    
    // Merge arrays (chatHistory, logs) instead of overwriting
    const chatHistory = [...(existing.chatHistory || []), ...(updateData.chatHistory || [])];
    const logs = [...(existing.logs || []), ...(updateData.logs || [])];
    
    const updated = { 
      ...existing, 
      ...updateData,
      chatHistory: chatHistory.length > 0 ? chatHistory : existing.chatHistory,
      logs: logs.length > 0 ? logs : existing.logs,
      updatedAt: new Date().toISOString()
    };

    if (updateData.pipelineStage !== undefined) {
      updated.pipelineStage = clampPipelineStage(updateData.pipelineStage);
    }

    if (updated.pipelineStage === 8 && !existing.enteredStage8At) {
      updated.enteredStage8At = new Date().toISOString();
    }
    
    await db.set(key, JSON.stringify(updated));
    return {
      ...updated,
      key: updated.key || key,
    };
  },

  async deleteLead(key) {
    await db.delete(key);
  },

  // --- Folders (user-defined lead buckets) ---

  async listFolders(workspaceId) {
    const wid = workspaceId || 'default';
    const keys = await db.list(`folder:${wid}:`);
    const keyList = Array.isArray(keys) ? keys : (keys && keys.ok ? keys.value : []);
    const out = [];
    for (const key of keyList) {
      const data = await db.get(key);
      const raw = data && typeof data === 'object' && 'ok' in data ? data.value : data;
      if (!raw) continue;
      const f = typeof raw === 'string' ? JSON.parse(raw) : raw;
      out.push({ key, ...f });
    }
    return out.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  },

  async createFolder(workspaceId, name) {
    const wid = workspaceId || 'default';
    const key = `folder:${wid}:${Date.now()}`;
    const folder = {
      name: String(name || '').trim(),
      workspaceId: wid,
      createdAt: new Date().toISOString(),
    };
    await db.set(key, JSON.stringify(folder));
    return { key, ...folder };
  },

  async renameFolder(workspaceId, folderKey, name) {
    const wid = workspaceId || 'default';
    const fullKey = folderKey.startsWith('folder:') ? folderKey : `folder:${wid}:${folderKey}`;
    const data = await db.get(fullKey);
    const raw = data && typeof data === 'object' && 'ok' in data ? data.value : data;
    if (!raw) return null;
    const existing = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if ((existing.workspaceId || 'default') !== wid) return null;
    const updated = { ...existing, name: String(name || '').trim(), updatedAt: new Date().toISOString() };
    await db.set(fullKey, JSON.stringify(updated));
    return { key: fullKey, ...updated };
  },

  async deleteFolder(workspaceId, folderKey) {
    const wid = workspaceId || 'default';
    const fullKey = folderKey.startsWith('folder:') ? folderKey : `folder:${wid}:${folderKey}`;
    const data = await db.get(fullKey);
    const raw = data && typeof data === 'object' && 'ok' in data ? data.value : data;
    if (raw) {
      const existing = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if ((existing.workspaceId || 'default') === wid) {
        await db.delete(fullKey);
      }
    }
  },

  // --- Schedules (recurring scrapes) ---

  async saveSchedule(scheduleData) {
    const key = `schedule:${Date.now()}`;
    await db.set(key, JSON.stringify({ ...scheduleData, lastRun: null }));
    return key;
  },

  async getSchedule(key) {
    const data = await db.get(key);
    if (!data) return null;
    const raw = data && typeof data === 'object' && 'ok' in data ? data.value : data;
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  },

  async listSchedules() {
    const keys = await db.list('schedule:');
    const keyList = Array.isArray(keys) ? keys : (keys && keys.ok ? keys.value : []);
    const schedules = [];
    for (const key of keyList) {
      const data = await this.getSchedule(key);
      if (data) {
        schedules.push({ key, ...data });
      }
    }
    return schedules;
  },

  async updateSchedule(key, updateData) {
    const existing = await this.getSchedule(key);
    if (!existing) return null;
    const updated = { ...existing, ...updateData };
    await db.set(key, JSON.stringify(updated));
    return updated;
  },

  async deleteSchedule(key) {
    await db.delete(key);
  },

  // --- Site Metadata Cache (Enrichment) ---

  async getSiteMetadata(url) {
    if (!url || url === 'N/A') return null;
    const domain = url.replace(/^(?:https?:\/\/)?(?:www\.)?/i, "").split('/')[0].toLowerCase();
    const key = `site_meta:${domain}`;
    const data = await db.get(key);
    if (!data) return null;
    const raw = data && typeof data === 'object' && 'ok' in data ? data.value : data;
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  },

  async saveSiteMetadata(url, metaData) {
    if (!url || url === 'N/A') return;
    const domain = url.replace(/^(?:https?:\/\/)?(?:www\.)?/i, "").split('/')[0].toLowerCase();
    const key = `site_meta:${domain}`;
    const enriched = { 
      ...metaData, 
      lastEnriched: new Date().toISOString() 
    };
    await db.set(key, JSON.stringify(enriched));
    return key;
  },

  // --- Analytics (Visits) ---

  /** Strip query/hash and trailing slash so / and /?x match for dedupe. */
  normalizeVisitPath(p) {
    if (!p || typeof p !== 'string') return '/';
    let s = p.trim() || '/';
    const hash = s.indexOf('#');
    if (hash >= 0) s = s.slice(0, hash);
    const q = s.indexOf('?');
    if (q >= 0) s = s.slice(0, q);
    if (s.length > 1 && s.endsWith('/')) s = s.replace(/\/+$/, '');
    return s || '/';
  },

  normalizeVisitIp(ip) {
    if (!ip) return '';
    let s = String(ip).split(',')[0].trim();
    if (s.startsWith('::ffff:')) s = s.slice(7);
    return s;
  },

  /**
   * Stores one row per “visit burst”: same IP + path within VISIT_DEDUPE_WINDOW_MS (default 2m)
   * counts once. Stops React double-mount / duplicate beacons from inflating totals.
   */
  async saveVisit(visitData) {
    const windowMs = Math.max(
      5000,
      parseInt(process.env.VISIT_DEDUPE_WINDOW_MS || '120000', 10) || 120000
    );
    const scanCap = Math.max(20, parseInt(process.env.VISIT_DEDUPE_SCAN || '200', 10) || 200);

    const ipNorm = this.normalizeVisitIp(visitData.ip);
    const pathNorm = this.normalizeVisitPath(visitData.path);
    const now = Date.now();

    const skipDedupe =
      !ipNorm || ipNorm === '127.0.0.1' || ipNorm === '::1' || ipNorm === 'unknown';

    if (!skipDedupe) {
      const keys = await db.list('visit:');
      const keyList = Array.isArray(keys) ? keys : (keys && keys.ok ? keys.value : []);
      const sortedKeys = keyList
        .sort((a, b) => parseInt(b.split(':')[1], 10) - parseInt(a.split(':')[1], 10))
        .slice(0, scanCap);

      for (const key of sortedKeys) {
        const data = await db.get(key);
        if (!data) continue;
        const raw = data && typeof data === 'object' && 'ok' in data ? data.value : data;
        if (!raw) continue;
        try {
          const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
          const vIp = this.normalizeVisitIp(v.ip);
          const vPath = this.normalizeVisitPath(v.path);
          const ts =
            typeof v.timestamp === 'number' ? v.timestamp : parseInt(key.split(':')[1], 10);
          if (vIp === ipNorm && vPath === pathNorm && now - ts < windowMs) {
            return { key, deduped: true };
          }
        } catch (_) {
          /* ignore corrupt row */
        }
      }
    }

    const timestamp = Date.now();
    const key = `visit:${timestamp}`;
    const payload = {
      ...visitData,
      ip: ipNorm || visitData.ip,
      path: pathNorm,
      timestamp,
    };
    await db.set(key, JSON.stringify(payload));
    return { key, deduped: false };
  },

  async getAllVisits() {
    const keys = await db.list('visit:');
    const keyList = Array.isArray(keys) ? keys : (keys && keys.ok ? keys.value : []);
    const sortedKeys = keyList.sort((a, b) => {
      const tsA = parseInt(a.split(':')[1]);
      const tsB = parseInt(b.split(':')[1]);
      return tsB - tsA;
    });
    
    const visits = [];
    for (const key of sortedKeys) {
      const data = await db.get(key);
      if (data) {
        // Support Replit DB v3 format
        const raw = data && typeof data === 'object' && 'ok' in data ? data.value : data;
        if (raw) {
          try {
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            visits.push(parsed);
          } catch (e) {
            console.error(`Error parsing visit ${key}:`, e.message);
          }
        }
      }
    }
    return visits;
  },

  // --- Background Tasks / Notifications ---

  async setActiveJob(jobData) {
    const key = 'active_job';
    await db.set(key, JSON.stringify({ 
      ...jobData, 
      status: 'processing',
      startedAt: new Date().toISOString() 
    }));
  },

  async getActiveJob() {
    const data = await db.get('active_job');
    if (!data) return null;
    const raw = data && typeof data === 'object' && 'ok' in data ? data.value : data;
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  },

  /**
   * @param {{ failed?: boolean, error?: string, resultCount?: number, searchKey?: string }} [meta]
   */
  async clearActiveJob(meta = {}) {
    const active = await this.getActiveJob();
    if (active) {
      const finishedAt = new Date().toISOString();
      if (meta.failed) {
        await db.set(
          'latest_finished_job',
          JSON.stringify({
            ...active,
            status: 'failed',
            error: String(meta.error || 'Search failed'),
            finishedAt,
            isRead: false,
            source: 'run',
          })
        );
      } else {
        await db.set(
          'latest_finished_job',
          JSON.stringify({
            ...active,
            status: 'completed',
            finishedAt,
            isRead: false,
            source: 'run',
            resultCount: meta.resultCount != null ? meta.resultCount : active.resultCount,
            searchKey: meta.searchKey != null ? meta.searchKey : active.searchKey,
          })
        );
      }
    }
    await db.delete('active_job');
  },

  async getLatestFinishedJob() {
    const data = await db.get('latest_finished_job');
    if (!data) return null;
    const raw = data && typeof data === 'object' && 'ok' in data ? data.value : data;
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  },

  async markNotificationRead() {
    const data = await this.getLatestFinishedJob();
    if (data) {
      await db.set('latest_finished_job', JSON.stringify({ ...data, isRead: true }));
    }
  },

  /**
   * Publish bell + /api/status when a server-side scheduled scrape completes.
   */
  async recordCompletedSearchNotification({
    keyword,
    city,
    state,
    maxResults,
    resultCount,
    source = 'scheduled',
    workspaceId,
    workspaceName,
  }) {
    const finishedAt = new Date().toISOString();
    await db.set(
      'latest_finished_job',
      JSON.stringify({
        type: 'search',
        keyword: String(keyword || ''),
        city: String(city || ''),
        state: String(state || ''),
        maxResults: maxResults != null ? maxResults : 20,
        resultCount: resultCount != null ? resultCount : 0,
        status: 'completed',
        finishedAt,
        isRead: false,
        source: String(source || 'scheduled'),
        workspaceId: workspaceId != null ? String(workspaceId) : '',
        workspaceName: workspaceName != null ? String(workspaceName) : '',
      })
    );
  },

  // --- Daily action tracker (per user email, per calendar day) ---

  _emailKeyFragment(email) {
    return String(email || 'anon').replace(/[^a-zA-Z0-9]/g, '_');
  },

  async saveDailyTracker(workspaceId, email, dateStr, metrics) {
    const wid = await this._resolveWorkspaceIdForWrite(workspaceId);
    assertLeadScopedWorkspaceId(wid, 'saveDailyTracker');
    const fragment = this._emailKeyFragment(email);
    const key = `daily_tracker:${wid}:${fragment}:${dateStr}`;
    const existingRaw = await db.get(key);
    const existingParsed =
      existingRaw &&
      (typeof existingRaw === 'object' && 'ok' in existingRaw
        ? existingRaw.value
        : existingRaw);
    let existing = {};
    if (existingParsed) {
      try {
        existing = typeof existingParsed === 'string' ? JSON.parse(existingParsed) : existingParsed;
      } catch {
        existing = {};
      }
    }
    const merged = {
      ...existing,
      coldEmails: metrics.coldEmails != null ? metrics.coldEmails : existing.coldEmails ?? 0,
      coldDms: metrics.coldDms != null ? metrics.coldDms : existing.coldDms ?? 0,
      coldCalls: metrics.coldCalls != null ? metrics.coldCalls : existing.coldCalls ?? 0,
      upworkBids: metrics.upworkBids != null ? metrics.upworkBids : existing.upworkBids ?? 0,
      socialPosts: metrics.socialPosts != null ? metrics.socialPosts : existing.socialPosts ?? 0,
      adCreatives: metrics.adCreatives != null ? metrics.adCreatives : existing.adCreatives ?? 0,
      notes: metrics.notes != null ? metrics.notes : existing.notes ?? '',
      callNotes: metrics.callNotes != null ? metrics.callNotes : existing.callNotes ?? '',
      email,
      date: dateStr,
      updatedAt: new Date().toISOString(),
    };
    await db.set(key, JSON.stringify(merged));
    return merged;
  },

  async getDailyTracker(workspaceId, email, dateStr) {
    const wid = await this._resolveWorkspaceIdForWrite(workspaceId);
    assertLeadScopedWorkspaceId(wid, 'getDailyTracker');
    const fragment = this._emailKeyFragment(email);
    const key = `daily_tracker:${wid}:${fragment}:${dateStr}`;
    let data = await db.get(key);
    if (!data) {
      const legacyKey = `daily_tracker:${fragment}:${dateStr}`;
      data = await db.get(legacyKey);
    }
    if (!data) return null;
    const raw = data && typeof data === 'object' && 'ok' in data ? data.value : data;
    if (!raw) return null;
    try {
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return null;
    }
  },

  async listDailyTrackers(workspaceId, email, limit = 14) {
    const wid = await this._resolveWorkspaceIdForWrite(workspaceId);
    assertLeadScopedWorkspaceId(wid, 'listDailyTrackers');
    const fragment = this._emailKeyFragment(email);
    const prefix = `daily_tracker:${wid}:${fragment}:`;
    const keys = await db.list(prefix);
    const keyList = Array.isArray(keys) ? keys : keys && keys.ok ? keys.value : [];
    const sorted = keyList.sort((a, b) => {
      const da = (a && a.split(':').pop()) || '';
      const db = (b && b.split(':').pop()) || '';
      return db.localeCompare(da);
    });
    const slice = sorted.slice(0, limit);
    const rows = [];
    for (const key of slice) {
      const data = await db.get(key);
      if (!data) continue;
      const raw = data && typeof data === 'object' && 'ok' in data ? data.value : data;
      if (!raw) continue;
      try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        rows.push(parsed);
      } catch {
        /* skip */
      }
    }
    return rows;
  },

  // --- Personal tasks (checklist + kanban, per workspace + user email) ---

  _userTaskKey(workspaceId, email, taskId) {
    const wid = workspaceId || 'default';
    const frag = this._emailKeyFragment(email);
    return `user_task:${wid}:${frag}:${taskId}`;
  },

  async listUserTasks(workspaceId, email) {
    const wid = workspaceId || 'default';
    const frag = this._emailKeyFragment(email);
    const prefix = `user_task:${wid}:${frag}:`;
    const keys = await db.list(prefix);
    const keyList = Array.isArray(keys) ? keys : keys && keys.ok ? keys.value : [];
    const tasks = [];
    for (const key of keyList) {
      const data = await db.get(key);
      if (!data) continue;
      const raw = data && typeof data === 'object' && 'ok' in data ? data.value : data;
      if (!raw) continue;
      try {
        const t = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (t && t.id) tasks.push(t);
      } catch {
        /* skip */
      }
    }
    const colOrder = { backlog: 0, todo: 1, doing: 2, done: 3 };
    tasks.sort((a, b) => {
      const ca = colOrder[a.column] ?? 9;
      const cb = colOrder[b.column] ?? 9;
      if (ca !== cb) return ca - cb;
      return (a.sort || 0) - (b.sort || 0);
    });
    return tasks;
  },

  async saveUserTask(workspaceId, email, task) {
    const id = String(task.id || '').trim();
    if (!id) throw new Error('Task id is required.');
    const now = new Date().toISOString();
    let scheduledAt = null;
    if (task.scheduledAt != null && task.scheduledAt !== '') {
      const ts = Date.parse(String(task.scheduledAt));
      if (Number.isFinite(ts)) scheduledAt = new Date(ts).toISOString();
    }
    let leadKey = null;
    if (task.leadKey != null && String(task.leadKey).trim() !== '') {
      const lk = String(task.leadKey).trim();
      if (lk.startsWith('lead:')) leadKey = lk.slice(0, 200);
    }
    const payload = {
      id,
      title: String(task.title || '').trim() || 'Untitled',
      column: task.column || 'todo',
      sort: typeof task.sort === 'number' ? task.sort : Date.now(),
      createdAt: task.createdAt || now,
      updatedAt: now,
      scheduledAt,
      leadKey,
    };
    const key = this._userTaskKey(workspaceId, email, id);
    await db.set(key, JSON.stringify(payload));
    return payload;
  },

  async deleteUserTask(workspaceId, email, taskId) {
    const key = this._userTaskKey(workspaceId, email, taskId);
    await db.delete(key);
  },

  // --- Saved resources (links: YouTube, Drive, X, etc.; per workspace + user) ---

  _userResourceKey(workspaceId, email, resourceId) {
    const wid = workspaceId || 'default';
    const frag = this._emailKeyFragment(email);
    return `user_resource:${wid}:${frag}:${resourceId}`;
  },

  async listUserResources(workspaceId, email) {
    const wid = workspaceId || 'default';
    const frag = this._emailKeyFragment(email);
    const prefix = `user_resource:${wid}:${frag}:`;
    const keys = await db.list(prefix);
    const keyList = Array.isArray(keys) ? keys : keys && keys.ok ? keys.value : [];
    const resources = [];
    for (const key of keyList) {
      const data = await db.get(key);
      if (!data) continue;
      const raw = data && typeof data === 'object' && 'ok' in data ? data.value : data;
      if (!raw) continue;
      try {
        const r = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (r && r.id && r.url) resources.push(r);
      } catch {
        /* skip */
      }
    }
    resources.sort((a, b) => {
      const ta = Date.parse(a.updatedAt || a.createdAt || '') || 0;
      const tb = Date.parse(b.updatedAt || b.createdAt || '') || 0;
      return tb - ta;
    });
    return resources;
  },

  async saveUserResource(workspaceId, email, resource) {
    const id = String(resource.id || '').trim();
    if (!id) throw new Error('Resource id is required.');
    const now = new Date().toISOString();
    const url = String(resource.url || '').trim();
    if (!url) throw new Error('URL is required.');
    const kind = String(resource.kind || 'link').toLowerCase();
    const allowedKinds = new Set(['youtube', 'drive', 'x', 'link']);
    const safeKind = allowedKinds.has(kind) ? kind : 'link';
    const payload = {
      id,
      url,
      title: String(resource.title || '').trim() || url,
      note: String(resource.note || '').trim(),
      kind: safeKind,
      createdAt: resource.createdAt || now,
      updatedAt: now,
    };
    const key = this._userResourceKey(workspaceId, email, id);
    await db.set(key, JSON.stringify(payload));
    return payload;
  },

  async deleteUserResource(workspaceId, email, resourceId) {
    const key = this._userResourceKey(workspaceId, email, resourceId);
    await db.delete(key);
  },

  // --- Workspace resources (shared links; same shape as user resources) ---

  _workspaceResourceKey(workspaceId, resourceId) {
    const wid = String(workspaceId || 'default').trim();
    const id = String(resourceId || '').trim();
    return `ws_resource:${wid}:${id}`;
  },

  async listWorkspaceResources(workspaceId) {
    const wid = String(workspaceId || 'default').trim();
    const prefix = `ws_resource:${wid}:`;
    const keys = await db.list(prefix);
    const keyList = Array.isArray(keys) ? keys : keys && keys.ok ? keys.value : [];
    const resources = [];
    for (const key of keyList) {
      const data = await db.get(key);
      if (!data) continue;
      const raw = data && typeof data === 'object' && 'ok' in data ? data.value : data;
      if (!raw) continue;
      try {
        const r = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (r && r.id && r.url) resources.push(r);
      } catch {
        /* skip */
      }
    }
    resources.sort((a, b) => {
      const ta = Date.parse(a.updatedAt || a.createdAt || '') || 0;
      const tb = Date.parse(b.updatedAt || b.createdAt || '') || 0;
      return tb - ta;
    });
    return resources;
  },

  async saveWorkspaceResource(workspaceId, resource) {
    const wid = String(workspaceId || 'default').trim();
    const id = String(resource.id || '').trim();
    if (!id) throw new Error('Resource id is required.');
    const now = new Date().toISOString();
    const url = String(resource.url || '').trim();
    if (!url) throw new Error('URL is required.');
    const kind = String(resource.kind || 'link').toLowerCase();
    const allowedKinds = new Set(['youtube', 'drive', 'x', 'link']);
    const safeKind = allowedKinds.has(kind) ? kind : 'link';
    const payload = {
      id,
      url,
      title: String(resource.title || '').trim() || url,
      note: String(resource.note || '').trim(),
      kind: safeKind,
      createdAt: resource.createdAt || now,
      updatedAt: now,
    };
    if (resource.addedBy) payload.addedBy = String(resource.addedBy).trim().slice(0, 320);
    if (resource.sourceType) payload.sourceType = String(resource.sourceType).trim().slice(0, 32);
    if (resource.fileName) payload.fileName = String(resource.fileName).trim().slice(0, 320);
    if (resource.mimeType) payload.mimeType = String(resource.mimeType).trim().slice(0, 160);
    if (resource.storagePath) payload.storagePath = String(resource.storagePath).trim().slice(0, 1200);
    if (resource.sizeBytes != null) {
      const n = Number(resource.sizeBytes);
      if (Number.isFinite(n) && n >= 0) payload.sizeBytes = Math.round(n);
    }
    const key = this._workspaceResourceKey(wid, id);
    await db.set(key, JSON.stringify(payload));
    return payload;
  },

  async deleteWorkspaceResource(workspaceId, resourceId) {
    const wid = String(workspaceId || 'default').trim();
    const key = this._workspaceResourceKey(wid, resourceId);
    await db.delete(key);
  },

  /**
   * One-time style migration: copy this user's legacy user_resource:* rows into ws_resource:*,
   * then delete the legacy keys. Skips URLs already present on the workspace list.
   */
  async mergeUserResourcesIntoWorkspace(workspaceId, email) {
    const wid = String(workspaceId || 'default').trim();
    if (!wid || !email) return;
    const frag = this._emailKeyFragment(email);
    const legacyPrefix = `user_resource:${wid}:${frag}:`;
    const keys = await db.list(legacyPrefix);
    const keyList = Array.isArray(keys) ? keys : keys && keys.ok ? keys.value : [];
    if (!keyList.length) return;

    const workspaceList = await this.listWorkspaceResources(wid);
    const urls = new Set(workspaceList.map((r) => r.url).filter(Boolean));

    for (const key of keyList) {
      const data = await db.get(key);
      if (!data) continue;
      const raw = data && typeof data === 'object' && 'ok' in data ? data.value : data;
      if (!raw) continue;
      let r;
      try {
        r = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch {
        await db.delete(key);
        continue;
      }
      if (!r || !r.url) {
        await db.delete(key);
        continue;
      }
      const urlNorm = String(r.url).trim();
      if (urls.has(urlNorm)) {
        await db.delete(key);
        continue;
      }
      const newId = `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
      try {
        await this.saveWorkspaceResource(wid, {
          ...r,
          id: newId,
          addedBy: email,
        });
        urls.add(urlNorm);
        await db.delete(key);
      } catch {
        /* keep legacy key if save failed */
      }
    }
  },

  // --- Workspaces (multi-seat) ---

  async getWorkspace(workspaceId) {
    const id = workspaceId != null ? String(workspaceId).trim() : '';
    if (!id) return null;
    const key = `workspace:${id}`;
    const data = await db.get(key);
    if (!data) return null;
    const raw = data && typeof data === 'object' && 'ok' in data ? data.value : data;
    if (!raw) return null;
    try {
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return null;
    }
  },

  async saveWorkspace(workspaceId, doc) {
    const id = workspaceId != null ? String(workspaceId).trim() : '';
    if (!id) throw new Error('saveWorkspace requires workspaceId');
    await db.set(`workspace:${id}`, JSON.stringify({ ...doc, id }));
  },

  // --- 7-day activation ---

  async getActivationState(email) {
    const fragment = this._emailKeyFragment(email);
    const key = `activation:${fragment}`;
    const data = await db.get(key);
    if (!data) return null;
    const raw = data && typeof data === 'object' && 'ok' in data ? data.value : data;
    if (!raw) return null;
    try {
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return null;
    }
  },

  async saveActivationState(email, state) {
    const fragment = this._emailKeyFragment(email);
    const key = `activation:${fragment}`;
    await db.set(key, JSON.stringify(state));
  },

  _morningBriefKey(workspaceId, ymd) {
    return `morningBrief:${workspaceId || 'default'}:${ymd}`;
  },

  async getMorningBrief(workspaceId, ymd) {
    const key = this._morningBriefKey(workspaceId, ymd);
    const data = await db.get(key);
    if (!data) return null;
    const raw = data && typeof data === 'object' && 'ok' in data ? data.value : data;
    if (!raw) return null;
    try {
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return null;
    }
  },

  async setMorningBrief(workspaceId, ymd, payload) {
    const id = workspaceId || 'default';
    const key = this._morningBriefKey(id, ymd);
    await db.set(
      key,
      JSON.stringify({
        ...payload,
        workspaceId: id,
        date: ymd,
        cachedAt: new Date().toISOString(),
      })
    );
  },

  async deleteMorningBrief(workspaceId, ymd) {
    await db.delete(this._morningBriefKey(workspaceId, ymd));
  },

  /** Last good prospecting coach (Today page). Fallback if morningBrief key missing; same workspace calendar day. */
  _prospectingCoachKey(workspaceId) {
    return `pc_coach:${String(workspaceId || 'default').trim()}`;
  },

  async getProspectingCoachCache(workspaceId) {
    const key = this._prospectingCoachKey(workspaceId);
    const data = await db.get(key);
    if (!data) return null;
    const raw = data && typeof data === 'object' && 'ok' in data ? data.value : data;
    if (!raw) return null;
    try {
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return null;
    }
  },

  async setProspectingCoachCache(workspaceId, ymd, payload) {
    const id = String(workspaceId || 'default').trim();
    const y = String(ymd || '').slice(0, 10);
    const key = this._prospectingCoachKey(id);
    const base = payload && typeof payload === 'object' ? payload : {};
    await db.set(
      key,
      JSON.stringify({
        ...base,
        forYmd: y,
        workspaceId: id,
        cachedAt: new Date().toISOString(),
      })
    );
  },

  async deleteProspectingCoachCache(workspaceId) {
    await db.delete(this._prospectingCoachKey(workspaceId));
  },

  async listWorkspaceIds() {
    const keys = await db.list('workspace:');
    const keyList = Array.isArray(keys) ? keys : (keys && keys.ok ? keys.value : []);
    return keyList
      .map((k) => String(k).replace(/^workspace:/, ''))
      .filter(Boolean);
  },

  /** Hosted site-audit open tracking (KV rows: reportview:{workspaceId}:{id}). */
  _reportViewStorageKey(workspaceId, viewId) {
    const wid = String(workspaceId || 'default').trim();
    return `reportview:${wid}:${String(viewId || '').trim()}`;
  },

  async createReportView({ workspaceId, leadId, ipHash, userAgent }) {
    const wid = String(workspaceId || 'default').trim();
    const id = `rv_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    const viewedAt = new Date().toISOString();
    const row = {
      id,
      lead_id: String(leadId || '').trim(),
      viewed_at: viewedAt,
      ip_hash: String(ipHash || '').slice(0, 64),
      user_agent: String(userAgent || '').slice(0, 512),
      duration_seconds: 0,
      workspace_id: wid,
    };
    await db.set(this._reportViewStorageKey(wid, id), JSON.stringify(row));
    return row;
  },

  async getReportView(workspaceId, viewId) {
    const wid = String(workspaceId || 'default').trim();
    const vid = String(viewId || '').trim();
    if (!vid) return null;
    const data = await db.get(this._reportViewStorageKey(wid, vid));
    if (!data) return null;
    const raw = data && typeof data === 'object' && 'ok' in data ? data.value : data;
    if (!raw) return null;
    try {
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return null;
    }
  },

  async updateReportViewDuration(workspaceId, viewId, durationSeconds, expectedLeadId) {
    const row = await this.getReportView(workspaceId, viewId);
    if (!row) return false;
    const wid = String(workspaceId || 'default').trim();
    if (String(row.workspace_id || '') !== wid) return false;
    if (expectedLeadId && String(row.lead_id) !== String(expectedLeadId)) return false;
    const next = Math.max(
      Number(row.duration_seconds) || 0,
      Math.min(86400, Math.max(0, Math.round(Number(durationSeconds) || 0))),
    );
    row.duration_seconds = next;
    await db.set(this._reportViewStorageKey(wid, viewId), JSON.stringify(row));
    return true;
  },

  /**
   * Report views for a workspace with viewed_at >= sinceIso (ISO string).
   * Scans up to `cap` newest keys by embedded rv_<ms>_ id (best-effort under KV list limits).
   */
  async listReportViewsForWorkspaceSince(workspaceId, sinceIso, cap = 500) {
    const wid = String(workspaceId || 'default').trim();
    const prefix = `reportview:${wid}:`;
    const keys = await db.list(prefix);
    const keyList = Array.isArray(keys) ? keys : (keys && keys.ok ? keys.value : []);
    const sinceMs = Date.parse(sinceIso);
    const sinceOk = Number.isFinite(sinceMs) ? sinceMs : 0;
    const scanLimit = Math.min(Math.max(40, cap), 2000);
    const sortedKeys = keyList
      .map((k) => String(k))
      .sort((a, b) => {
        const ida = a.split(':').pop() || '';
        const idb = b.split(':').pop() || '';
        const ta = parseInt((ida.match(/^rv_(\d+)_/) || [, '0'])[1], 10) || 0;
        const tb = parseInt((idb.match(/^rv_(\d+)_/) || [, '0'])[1], 10) || 0;
        return tb - ta;
      })
      .slice(0, scanLimit);

    const rows = [];
    for (const key of sortedKeys) {
      const data = await db.get(key);
      if (!data) continue;
      const raw = data && typeof data === 'object' && 'ok' in data ? data.value : data;
      if (!raw) continue;
      try {
        const r = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const t = Date.parse(r.viewed_at || '');
        if (Number.isFinite(t) && t >= sinceOk) rows.push(r);
      } catch {
        /* skip corrupt */
      }
    }
    rows.sort((a, b) => Date.parse(b.viewed_at || 0) - Date.parse(a.viewed_at || 0));
    return rows;
  },
};
