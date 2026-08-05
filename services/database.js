const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { clampPipelineStage, PIPELINE_SCHEMA_VERSION } = require('./pipelineConstants');
const {
  normalizeEmail,
  normalizeDomain,
  normalizePhone,
  normalizeName,
  normalizeGeo,
  computeDedupeKey,
  findExistingLead,
  leadMapsPlaceKey,
  shouldResyncIngestSource,
  shouldApplyIncomingFolderKey,
} = require('./leadDedupe');
const { normalizeLeadForPanel } = require('./leadPanelNormalize');
const { normalizeWorkspaceAccentHex } = require('../lib/workspaceAccent');

const TAG_COLOR_PALETTE = ['#EAB308', '#3B82F6', '#10B981', '#F43F5E', '#8B5CF6', '#F97316', '#06B6D4', '#EC4899'];

function normalizeTagColor(raw, fallback) {
  return normalizeWorkspaceAccentHex(raw) || (fallback ? normalizeWorkspaceAccentHex(fallback) : null) || '#94A3B8';
}

// ── SQLite setup ──────────────────────────────────────────────────────────────
function resolveDbDir() {
  const custom = process.env.APP_DATA_DIR && String(process.env.APP_DATA_DIR).trim();
  return custom ? path.resolve(custom) : path.join(__dirname, '..', 'data');
}

const DB_DIR = resolveDbDir();
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}
const DB_PATH = path.join(DB_DIR, 'app.db');

function getPersistenceStats() {
  let dbSizeBytes = 0;
  let dbExists = false;
  try {
    dbExists = fs.existsSync(DB_PATH);
    if (dbExists) dbSizeBytes = fs.statSync(DB_PATH).size;
  } catch {
    /* ignore */
  }
  let kvCount = 0;
  let leadKeyCount = 0;
  try {
    const row = sqlite.prepare('SELECT COUNT(*) AS c FROM kv').get();
    kvCount = row && row.c != null ? row.c : 0;
    leadKeyCount = kvList('lead:').length;
  } catch {
    /* db not ready */
  }
  return {
    dbDir: DB_DIR,
    dbPath: DB_PATH,
    dbExists,
    dbSizeBytes,
    kvCount,
    leadKeyCount,
  };
}

const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

// ── Schema ────────────────────────────────────────────────────────────────────
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_kv_key_prefix ON kv(key);

  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL DEFAULT 'ceo',
    role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
    content TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'web',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_messages(session_id, created_at);
`);

// ── Helpers ───────────────────────────────────────────────────────────────────
function isBlankValue(v) {
  if (v == null) return true;
  if (typeof v === 'string') {
    const s = v.trim();
    return s === '' || s.toLowerCase() === 'n/a' || s === '—' || s === '-';
  }
  return false;
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
    if (k === 'listing') continue;
    if (k === 'importFields' && incoming.importFields && typeof incoming.importFields === 'object') {
      out.importFields = { ...(existing.importFields || {}), ...incoming.importFields };
      continue;
    }
    if (k === 'pipelineStage' || k === 'status') continue;
    if (k === 'folderKey') {
      const incomingFolder = v != null ? String(v).trim() : '';
      if (incomingFolder && shouldApplyIncomingFolderKey(existing, incoming)) {
        out.folderKey = incomingFolder;
      }
      continue;
    }
    if (isBlankValue(v)) continue;
    const cur = existing ? existing[k] : undefined;
    if (isBlankValue(cur)) out[k] = v;
  }

  if (!existing) return out;

  if (!isBlankValue(incoming?.status) && isBlankValue(existing.status)) out.status = incoming.status;
  if (incoming?.pipelineStage !== undefined && existing.pipelineStage == null) out.pipelineStage = incoming.pipelineStage;

  const incRev = parseInt(String(incoming?.reviewsCount ?? ''), 10);
  const curRev = parseInt(String(existing?.reviewsCount ?? ''), 10);
  if (Number.isFinite(incRev) && incRev > 0 && (!Number.isFinite(curRev) || curRev === 0)) {
    out.reviewsCount = incoming.reviewsCount;
  } else if (
    shouldResyncIngestSource(incoming?.source) &&
    Number.isFinite(incRev) &&
    incRev > 0 &&
    incRev !== curRev
  ) {
    out.reviewsCount = incoming.reviewsCount;
  }
  const incRating = parseFloat(String(incoming?.totalScore ?? ''));
  const curRating = parseFloat(String(existing?.totalScore ?? ''));
  if (Number.isFinite(incRating) && incRating > 0 && (!Number.isFinite(curRating) || curRating === 0)) {
    out.totalScore = incoming.totalScore;
  } else if (
    shouldResyncIngestSource(incoming?.source) &&
    Number.isFinite(incRating) &&
    incRating > 0 &&
    incRating !== curRating
  ) {
    out.totalScore = incoming.totalScore;
  }
  if (isBlankValue(existing?.gbpClaimStatus) && !isBlankValue(incoming?.gbpClaimStatus)) {
    out.gbpClaimStatus = incoming.gbpClaimStatus;
  }
  if (isBlankValue(existing?.gbpOptimizationScore) && !isBlankValue(incoming?.gbpOptimizationScore)) {
    out.gbpOptimizationScore = incoming.gbpOptimizationScore;
  }

  const incSnippets = Array.isArray(incoming?.reviewSnippets)
    ? incoming.reviewSnippets.map((s) => String(s || '').trim()).filter(Boolean)
    : [];
  const curSnippets = Array.isArray(existing?.reviewSnippets)
    ? existing.reviewSnippets.map((s) => String(s || '').trim()).filter(Boolean)
    : [];
  if (
    incSnippets.length &&
    (!curSnippets.length || shouldResyncIngestSource(incoming?.source))
  ) {
    out.reviewSnippets = incSnippets;
  }

  if (shouldResyncIngestSource(incoming?.source) && typeof incoming?.sponsored === 'boolean') {
    out.sponsored = incoming.sponsored;
  }

  const incCat = String(incoming?.categoryName || '').trim();
  const curCat = String(existing?.categoryName || '').trim();
  const genericCategory = /^(n\/a|na|imported|google maps|directory listing)$/i;
  if (
    incCat &&
    !genericCategory.test(incCat) &&
    (!curCat || genericCategory.test(curCat) || shouldResyncIngestSource(incoming?.source))
  ) {
    out.categoryName = incCat;
  }

  if (shouldResyncIngestSource(incoming?.source)) {
    for (const field of ['address', 'city', 'state', 'zip', 'postalCode', 'website', 'url', 'phone', 'email']) {
      if (!isBlankValue(incoming[field])) out[field] = incoming[field];
    }
    const mapsKey = leadMapsPlaceKey(incoming);
    if (mapsKey) out.mapsPlaceKey = mapsKey;
  }

  if (incoming?.listing && typeof incoming.listing === 'object') {
    const curListing =
      existing?.listing && typeof existing.listing === 'object' ? { ...existing.listing } : {};
    for (const [lk, lv] of Object.entries(incoming.listing)) {
      if (isBlankValue(lv)) continue;
      if (isBlankValue(curListing[lk])) curListing[lk] = lv;
      else if (shouldResyncIngestSource(incoming?.source)) curListing[lk] = lv;
    }
    out.listing = curListing;
  }

  return out;
}

// ── KV helpers (SQLite-backed) ────────────────────────────────────────────────
function kvGet(key) {
  const row = sqlite.prepare('SELECT value FROM kv WHERE key = ?').get(key);
  return row ? row.value : null;
}

function kvSet(key, value) {
  sqlite.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, datetime(\'now\'))').run(key, value);
}

function kvList(prefix = '') {
  const rows = sqlite.prepare('SELECT key FROM kv WHERE key LIKE ? ORDER BY key').all(`${prefix}%`);
  return rows.map(r => r.key);
}

/** Batch-read KV values (avoids N round-trips when loading many leads). */
function kvGetMany(keys) {
  if (!Array.isArray(keys) || keys.length === 0) return new Map();
  const uniq = [...new Set(keys.filter(Boolean))];
  const out = new Map();
  const CHUNK = 200;
  for (let i = 0; i < uniq.length; i += CHUNK) {
    const slice = uniq.slice(i, i + CHUNK);
    const ph = slice.map(() => '?').join(',');
    const rows = sqlite.prepare(`SELECT key, value FROM kv WHERE key IN (${ph})`).all(...slice);
    rows.forEach((r) => out.set(r.key, r.value));
  }
  return out;
}

function kvDelete(key) {
  sqlite.prepare('DELETE FROM kv WHERE key = ?').run(key);
}

// ── Workspace helper ──────────────────────────────────────────────────────────
function assertLeadScopedWorkspaceId(workspaceId, methodName) {
  const ok = workspaceId != null && String(workspaceId).trim() !== '';
  if (ok) return;
  const label = methodName || 'Lead-scoped query';
  const msg = `[workspace] ${label} requires workspaceId`;
  if (process.env.NODE_ENV !== 'production') throw new Error(msg);
  console.warn(msg);
}

// ── Module exports (identical API surface) ────────────────────────────────────
module.exports = {
  getPersistenceStats,
  getDbPath() {
    return DB_PATH;
  },

  async saveSearch(searchData) {
    // Use searchId from data if provided, otherwise generate timestamp key
    const key = searchData.searchId ? `search:${searchData.searchId}` : `search:${Date.now()}`;
    kvSet(key, JSON.stringify(searchData));
    return key;
  },

  async getSearch(key) {
    const raw = kvGet(key);
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  },

  async listSearches() {
    const keys = kvList('search:');
    return keys.sort((a, b) => {
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
    kvDelete(key);
  },

  // --- Leads (bookmarked businesses) ---

  async _resolveWorkspaceIdForWrite(raw) {
    let wid = raw != null && raw !== '' ? String(raw).trim() : '';
    if (wid === 'default' || wid === '') {
      const alias = kvGet('sys:legacy_default_workspace_id');
      const a = typeof alias === 'string' ? alias.trim() : '';
      if (a) return a;
    }
    return wid || '';
  },

  /** Match getAllLeads workspace filter — legacy `default`/empty → alias id. */
  _normalizeLeadWorkspaceId(leadWorkspaceId) {
    const aliasVal = kvGet('sys:legacy_default_workspace_id');
    const aliasStr = typeof aliasVal === 'string' ? aliasVal.trim() : '';
    const x = leadWorkspaceId || 'default';
    if ((x === 'default' || x === '') && aliasStr) return aliasStr;
    return x;
  },

  async leadBelongsToWorkspace(lead, workspaceId) {
    if (!lead) return false;
    const wid = await this._resolveWorkspaceIdForWrite(workspaceId);
    if (!wid) return false;
    return this._normalizeLeadWorkspaceId(lead.workspaceId) === wid;
  },

  async saveLeadWithMeta(leadData) {
    const resolved = await this._resolveWorkspaceIdForWrite(leadData.workspaceId);
    assertLeadScopedWorkspaceId(resolved, 'saveLead');
    const wid = resolved;
    const incoming = { ...(leadData || {}), workspaceId: wid };
    incoming.emailNorm = normalizeEmail(incoming.email);
    incoming.domainNorm = normalizeDomain(incoming.website);
    incoming.phoneNorm = normalizePhone(incoming.phone);
    incoming.nameNorm = normalizeName(incoming.title);
    incoming.geoNorm = normalizeGeo(incoming.city, incoming.state);
    incoming.mapsPlaceKey = leadMapsPlaceKey(incoming) || undefined;

    const { analyzeLead } = require('./omnichannel');
    const channelAnalysis = analyzeLead(incoming);
    if (channelAnalysis.labels.length > 0) {
      incoming.labels = channelAnalysis.labels;
    }
    if (channelAnalysis.next_channel) {
      incoming.next_channel = channelAnalysis.next_channel;
    }

    incoming.dedupeKey = computeDedupeKey(incoming);

    const leads = await this.getAllLeads(wid);
    const existing = findExistingLead(leads, incoming, wid);

    if (existing) {
      const patch = mergePreferExisting(existing, incoming);

      patch.emailNorm = existing.emailNorm || incoming.emailNorm || undefined;
      patch.domainNorm = existing.domainNorm || incoming.domainNorm || undefined;
      patch.phoneNorm = existing.phoneNorm || incoming.phoneNorm || undefined;
      patch.nameNorm = existing.nameNorm || incoming.nameNorm || undefined;
      patch.geoNorm = existing.geoNorm || incoming.geoNorm || undefined;
      patch.dedupeKey = existing.dedupeKey || incoming.dedupeKey || undefined;
      patch.mapsPlaceKey = existing.mapsPlaceKey || incoming.mapsPlaceKey || undefined;

      patch.updates = appendUpdates(existing.updates, incoming.updates);

      patch.logs = [
        {
          type: 'merge',
          message: `Merged incoming lead data from ${incoming.source || 'ingest'}`,
          timestamp: new Date().toISOString(),
        },
      ];

      await this.updateLead(existing.key, patch, wid);
      return { key: existing.key, merged: true, lead: { ...existing, ...patch, key: existing.key } };
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

    try {
      const phoneLineType = require('./phoneLineType');
      const linePatch = await phoneLineType.refreshIfNeeded(newLead, null);
      if (linePatch) Object.assign(newLead, linePatch);
    } catch (e) {
      console.warn('[saveLead] phone line type refresh skipped:', e && e.message);
    }

    kvSet(key, JSON.stringify(newLead));
    return { key, merged: false, lead: { key, ...newLead } };
  },

  async saveLead(leadData) {
    const result = await this.saveLeadWithMeta(leadData);
    return result.key;
  },

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

  async getLead(key, workspaceId) {
    const storageKey =
      (await this.resolveLeadStorageKey(key, workspaceId)) || String(key || '').trim();
    if (!storageKey) return null;
    const raw = kvGet(storageKey);
    if (!raw) return null;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object') return null;
    return normalizeLeadForPanel({
      ...parsed,
      key: parsed.key || storageKey,
    });
  },

  async listLeads(workspaceId) {
    return this.getAllLeads(workspaceId);
  },

  async getAllLeads(workspaceId) {
    const wid = await this._resolveWorkspaceIdForWrite(workspaceId);
    assertLeadScopedWorkspaceId(wid, 'getAllLeads');
    const normLeadW = (lw) => this._normalizeLeadWorkspaceId(lw);
    const keys = kvList('lead:');
    keys.sort((a, b) => {
      const tsA = parseInt(String(a.split(':')[1] || ''), 10);
      const tsB = parseInt(String(b.split(':')[1] || ''), 10);
      return (Number.isFinite(tsB) ? tsB : 0) - (Number.isFinite(tsA) ? tsA : 0);
    });
    const valueMap = kvGetMany(keys);
    const leads = [];
    for (const key of keys) {
      const raw = valueMap.get(key);
      if (!raw) continue;
      let parsed;
      try {
        parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch {
        continue;
      }
      if (!parsed || typeof parsed !== 'object') continue;
      if (normLeadW(parsed.workspaceId) !== wid) continue;
      leads.push({ ...parsed, key, workspaceId: wid });
    }
    return leads;
  },

  async getAllLeadsUnscoped() {
    const keys = kvList('lead:');
    const sorted = keys.sort((a, b) => {
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
    return kvList(prefix);
  },

  async deleteStorageKey(key) {
    kvDelete(key);
  },

  async peekStorageKey(key) {
    return kvGet(key);
  },

  async putStorageKey(key, value) {
    const payload = typeof value === 'string' ? value : JSON.stringify(value);
    kvSet(key, payload);
  },

  async getUserPrefs(email) {
    const fragment = this._emailKeyFragment(email);
    const storageKey = `userprefs:${fragment}`;
    const raw = kvGet(storageKey);
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
    kvSet(storageKey, JSON.stringify(next));
    return next;
  },

  async getGoogleDriveTokens(email) {
    const em = String(email || '').trim().toLowerCase();
    const fragment = this._emailKeyFragment(em);
    const key = `gdrv_oauth:${fragment}`;
    const raw = kvGet(key);
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
    kvSet(key, JSON.stringify(next));
    return next;
  },

  async clearGoogleDriveTokens(email) {
    const em = String(email || '').trim().toLowerCase();
    const fragment = this._emailKeyFragment(em);
    const key = `gdrv_oauth:${fragment}`;
    kvDelete(key);
  },

  async getUserWorkspaceIds(email) {
    const fragment = this._emailKeyFragment(email);
    const storageKey = `userwork:${fragment}`;
    const raw = kvGet(storageKey);
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
    kvSet(storageKey, JSON.stringify(list));
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
    const s = String(slug || '').trim().toLowerCase();
    if (!s) return null;
    const raw = kvGet(`wslug:${s}`);
    if (raw == null) return null;
    const id = typeof raw === 'string' ? raw.trim() : String(raw);
    return id || null;
  },

  async saveWorkspaceSlug(slug, workspaceId) {
    const s = String(slug || '').trim().toLowerCase();
    if (!s) throw new Error('slug required');
    kvSet(`wslug:${s}`, String(workspaceId));
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

    const chatHistory =
      updateData.chatHistoryMode === 'replace' && Array.isArray(updateData.chatHistory)
        ? updateData.chatHistory
        : [...(existing.chatHistory || []), ...(updateData.chatHistory || [])];
    const logs =
      updateData.logsMode === 'replace' && Array.isArray(updateData.logs)
        ? updateData.logs
        : [...(existing.logs || []), ...(updateData.logs || [])];

    const { logsMode, chatHistoryMode, ...leadPatch } = updateData;

    const updated = {
      ...existing,
      ...leadPatch,
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

    try {
      const phoneLineType = require('./phoneLineType');
      const linePatch = await phoneLineType.refreshIfNeeded(updated, existing);
      if (linePatch) Object.assign(updated, linePatch);
    } catch (e) {
      console.warn('[updateLead] phone line type refresh skipped:', e && e.message);
    }

    kvSet(key, JSON.stringify(updated));
    return {
      ...updated,
      key: updated.key || key,
    };
  },

  async deleteLead(key) {
    kvDelete(key);
    return true;
  },

  /** Resolve KV storage key from UI/checkbox key (handles legacy parsed.key mismatches). */
  async resolveLeadStorageKey(rawKey, workspaceId) {
    const k = String(rawKey || '').trim();
    if (!k) return null;
    const variants = [];
    variants.push(k);
    if (/^lead:/i.test(k)) variants.push(k.replace(/^lead:/i, ''));
    else variants.push(`lead:${k}`);
    for (let i = 0; i < variants.length; i += 1) {
      const v = variants[i];
      const storageKey = /^lead:/i.test(v) ? v : `lead:${v}`;
      if (kvGet(storageKey)) return storageKey;
    }
    const wid = workspaceId != null && String(workspaceId).trim() !== ''
      ? await this._resolveWorkspaceIdForWrite(workspaceId)
      : null;
    if (!wid) return null;
    const norm = k.replace(/^lead:/i, '');
    const keys = kvList('lead:');
    for (const storageKey of keys) {
      const raw = kvGet(storageKey);
      if (!raw) continue;
      let parsed;
      try {
        parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch {
        continue;
      }
      if (!parsed || typeof parsed !== 'object') continue;
      if (this._normalizeLeadWorkspaceId(parsed.workspaceId) !== wid) continue;
      const pk = String(parsed.key || '').trim();
      const sk = String(storageKey || '').trim();
      if (
        sk === k ||
        sk.replace(/^lead:/i, '') === norm ||
        (pk && (pk === k || pk.replace(/^lead:/i, '') === norm))
      ) {
        return storageKey;
      }
    }
    return null;
  },

  // --- Add log entry to a lead (used by stitch-sync and other routes) ---

  async addLog(leadKey, logEntry) {
    const existing = await this.getLead(leadKey);
    if (!existing) return null;
    const logs = [...(existing.logs || []), logEntry];
    return this.updateLead(leadKey, { logs });
  },

  // --- Folders ---

  async listFolders(workspaceId) {
    const wid = workspaceId || 'default';
    const keys = kvList(`folder:${wid}:`);
    const out = [];
    for (const key of keys) {
      const raw = kvGet(key);
      if (!raw) continue;
      const f = typeof raw === 'string' ? JSON.parse(raw) : raw;
      out.push({ key, ...f });
    }
    return out.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  },

  async createFolder(workspaceId, name, meta = {}) {
    const wid = workspaceId || 'default';
    const key = `folder:${wid}:${Date.now()}`;
    const folder = {
      name: String(name || '').trim(),
      workspaceId: wid,
      createdAt: new Date().toISOString(),
    };
    if (meta && meta.jobType) folder.jobType = String(meta.jobType);
    if (meta && meta.isPipelineDefault) folder.isPipelineDefault = true;
    if (meta && meta.parentFolderKey) folder.parentFolderKey = String(meta.parentFolderKey);
    if (meta && meta.isTradeFolder) folder.isTradeFolder = true;
    if (meta && meta.tradeSlug) folder.tradeSlug = String(meta.tradeSlug);
    if (meta && meta.searchPreset && typeof meta.searchPreset === 'object') {
      folder.searchPreset = meta.searchPreset;
    }
    if (meta && meta.infoPack && typeof meta.infoPack === 'object') {
      folder.infoPack = meta.infoPack;
    }
    kvSet(key, JSON.stringify(folder));
    return { key, ...folder };
  },

  async renameFolder(workspaceId, folderKey, name) {
    const wid = workspaceId || 'default';
    const fullKey = folderKey.startsWith('folder:') ? folderKey : `folder:${wid}:${folderKey}`;
    const raw = kvGet(fullKey);
    if (!raw) return null;
    const existing = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if ((existing.workspaceId || 'default') !== wid) return null;
    const updated = { ...existing, name: String(name || '').trim(), updatedAt: new Date().toISOString() };
    kvSet(fullKey, JSON.stringify(updated));
    return { key: fullKey, ...updated };
  },

  async deleteFolder(workspaceId, folderKey) {
    const wid = workspaceId || 'default';
    const fullKey = folderKey.startsWith('folder:') ? folderKey : `folder:${wid}:${folderKey}`;
    const raw = kvGet(fullKey);
    if (raw) {
      const existing = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if ((existing.workspaceId || 'default') === wid) {
        kvDelete(fullKey);
      }
    }
  },

  async getFolder(workspaceId, folderKey) {
    const wid = workspaceId || 'default';
    const fullKey = folderKey.startsWith('folder:') ? folderKey : `folder:${wid}:${folderKey}`;
    const raw = kvGet(fullKey);
    if (!raw) return null;
    try {
      const f = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if ((f.workspaceId || 'default') !== wid) return null;
      return { key: fullKey, ...f };
    } catch {
      return null;
    }
  },

  async updateFolder(workspaceId, folderKey, patch) {
    const wid = workspaceId || 'default';
    const fullKey = folderKey.startsWith('folder:') ? folderKey : `folder:${wid}:${folderKey}`;
    const raw = kvGet(fullKey);
    if (!raw) return null;
    const existing = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if ((existing.workspaceId || 'default') !== wid) return null;
    const updated = {
      ...existing,
      ...patch,
      workspaceId: wid,
      updatedAt: new Date().toISOString(),
    };
    if (Object.prototype.hasOwnProperty.call(patch, 'infoPack') && patch.infoPack == null) {
      delete updated.infoPack;
    }
    kvSet(fullKey, JSON.stringify(updated));
    return { key: fullKey, ...updated };
  },

  async unassignLeadsFromFolder(workspaceId, folderKey) {
    const wid = workspaceId || 'default';
    const fk = String(folderKey || '').trim();
    if (!fk) return 0;
    const keys = kvList('lead:');
    let count = 0;
    for (const key of keys) {
      const lead = await this.getLead(key);
      if (!lead || (lead.workspaceId || 'default') !== wid) continue;
      if (String(lead.folderKey || '').trim() !== fk) continue;
      // eslint-disable-next-line no-await-in-loop
      await this.updateLead(key, { folderKey: '' });
      count += 1;
    }
    return count;
  },

  async reassignLeadsToFolder(workspaceId, fromFolderKey, toFolderKey) {
    const wid = workspaceId || 'default';
    const fromKey = String(fromFolderKey || '').trim();
    const toKey = String(toFolderKey || '').trim();
    if (!fromKey || !toKey || fromKey === toKey) return 0;
    const keys = kvList('lead:');
    let count = 0;
    for (const key of keys) {
      const lead = await this.getLead(key);
      if (!lead || (lead.workspaceId || 'default') !== wid) continue;
      if (String(lead.folderKey || '').trim() !== fromKey) continue;
      // eslint-disable-next-line no-await-in-loop
      await this.updateLead(key, { folderKey: toKey });
      count += 1;
    }
    return count;
  },

  // --- Tags (workspace label catalog + per-lead tag keys) ---

  normalizeTagKeys(raw) {
    if (!Array.isArray(raw)) return [];
    return [...new Set(raw.map((k) => String(k || '').trim()).filter(Boolean))];
  },

  async listTags(workspaceId) {
    const wid = workspaceId || 'default';
    const keys = kvList(`tag:${wid}:`);
    const out = [];
    for (const key of keys) {
      const raw = kvGet(key);
      if (!raw) continue;
      const t = typeof raw === 'string' ? JSON.parse(raw) : raw;
      out.push({
        key,
        ...t,
        isActive: t.isActive === false ? false : true,
      });
    }
    return out.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));
  },

  async createTag(workspaceId, name, color) {
    const wid = workspaceId || 'default';
    const label = String(name || '').trim();
    if (!label) throw new Error('Tag name is required.');
    const key = `tag:${wid}:${Date.now()}`;
    const tag = {
      name: label,
      color: normalizeTagColor(color, TAG_COLOR_PALETTE[Math.floor(Math.random() * TAG_COLOR_PALETTE.length)]),
      workspaceId: wid,
      isActive: true,
      createdAt: new Date().toISOString(),
    };
    kvSet(key, JSON.stringify(tag));
    return { key, ...tag };
  },

  async setTagActive(workspaceId, tagKey, isActive) {
    const wid = workspaceId || 'default';
    const fullKey = tagKey.startsWith('tag:') ? tagKey : `tag:${wid}:${tagKey}`;
    const raw = kvGet(fullKey);
    if (!raw) return null;
    const existing = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if ((existing.workspaceId || 'default') !== wid) return null;
    const updated = {
      ...existing,
      isActive: isActive === true,
      updatedAt: new Date().toISOString(),
    };
    kvSet(fullKey, JSON.stringify(updated));
    return { key: fullKey, ...updated };
  },

  async renameTag(workspaceId, tagKey, name) {
    const wid = workspaceId || 'default';
    const fullKey = tagKey.startsWith('tag:') ? tagKey : `tag:${wid}:${tagKey}`;
    const raw = kvGet(fullKey);
    if (!raw) return null;
    const existing = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if ((existing.workspaceId || 'default') !== wid) return null;
    const updated = {
      ...existing,
      name: String(name || '').trim(),
      updatedAt: new Date().toISOString(),
    };
    kvSet(fullKey, JSON.stringify(updated));
    return { key: fullKey, ...updated };
  },

  async setTagColor(workspaceId, tagKey, color) {
    const wid = workspaceId || 'default';
    const fullKey = tagKey.startsWith('tag:') ? tagKey : `tag:${wid}:${tagKey}`;
    const raw = kvGet(fullKey);
    if (!raw) return null;
    const existing = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if ((existing.workspaceId || 'default') !== wid) return null;
    const updated = {
      ...existing,
      color: normalizeTagColor(color, existing.color),
      updatedAt: new Date().toISOString(),
    };
    kvSet(fullKey, JSON.stringify(updated));
    return { key: fullKey, ...updated };
  },

  async deleteTag(workspaceId, tagKey) {
    const wid = workspaceId || 'default';
    const fullKey = tagKey.startsWith('tag:') ? tagKey : `tag:${wid}:${tagKey}`;
    const raw = kvGet(fullKey);
    if (raw) {
      const existing = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if ((existing.workspaceId || 'default') === wid) {
        kvDelete(fullKey);
      }
    }
    const leads = await this.getAllLeads(wid);
    for (const lead of leads) {
      const tags = this.normalizeTagKeys(lead.tags);
      if (!tags.includes(fullKey)) continue;
      // eslint-disable-next-line no-await-in-loop
      await this.updateLead(lead.key, { tags: tags.filter((t) => t !== fullKey) });
    }
  },

  async setLeadTags(leadKey, tagKeys, workspaceId) {
    const storageKey =
      (await this.resolveLeadStorageKey(leadKey, workspaceId)) || String(leadKey || '').trim();
    if (!storageKey) return null;
    const tags = this.normalizeTagKeys(tagKeys);
    return this.updateLead(storageKey, { tags }, workspaceId);
  },

  // --- Schedules ---

  async saveSchedule(scheduleData) {
    const key = `schedule:${Date.now()}`;
    kvSet(key, JSON.stringify({ ...scheduleData, lastRun: null }));
    return key;
  },

  async getSchedule(key) {
    const raw = kvGet(key);
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  },

  async listSchedules() {
    const keys = kvList('schedule:');
    const schedules = [];
    for (const key of keys) {
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
    kvSet(key, JSON.stringify(updated));
    return updated;
  },

  async deleteSchedule(key) {
    kvDelete(key);
  },

  // --- Site Metadata Cache ---

  async getSiteMetadata(url) {
    if (!url || url === 'N/A') return null;
    const domain = url.replace(/^(?:https?:\/\/)?(?:www\.)?/i, "").split('/')[0].toLowerCase();
    const key = `site_meta:${domain}`;
    const raw = kvGet(key);
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
    kvSet(key, JSON.stringify(enriched));
    return key;
  },

  // --- Analytics (Visits) ---

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
      const keys = kvList('visit:');
      const sortedKeys = keys
        .sort((a, b) => parseInt(b.split(':')[1], 10) - parseInt(a.split(':')[1], 10))
        .slice(0, scanCap);

      for (const key of sortedKeys) {
        const raw = kvGet(key);
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
    kvSet(key, JSON.stringify(payload));
    return { key, deduped: false };
  },

  async getAllVisits() {
    const keys = kvList('visit:');
    const sortedKeys = keys.sort((a, b) => {
      const tsA = parseInt(a.split(':')[1]);
      const tsB = parseInt(b.split(':')[1]);
      return tsB - tsA;
    });

    const visits = [];
    for (const key of sortedKeys) {
      const raw = kvGet(key);
      if (raw) {
        try {
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
          visits.push(parsed);
        } catch (e) {
          console.error(`Error parsing visit ${key}:`, e.message);
        }
      }
    }
    return visits;
  },

  // --- Background Tasks / Notifications ---

  async setActiveJob(jobData) {
    const key = 'active_job';
    kvSet(key, JSON.stringify({
      ...jobData,
      status: 'processing',
      startedAt: new Date().toISOString()
    }));
  },

  async getActiveJob() {
    const raw = kvGet('active_job');
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  },

  async clearActiveJob(meta = {}) {
    const active = await this.getActiveJob();
    if (active) {
      const finishedAt = new Date().toISOString();
      if (meta.failed) {
        kvSet(
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
        kvSet(
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
    kvDelete('active_job');
  },

  async getLatestFinishedJob() {
    const raw = kvGet('latest_finished_job');
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  },

  async markNotificationRead() {
    const data = await this.getLatestFinishedJob();
    if (data) {
      kvSet('latest_finished_job', JSON.stringify({ ...data, isRead: true }));
    }
  },

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
    kvSet(
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

  // --- Daily action tracker ---

  _emailKeyFragment(email) {
    return String(email || 'anon').replace(/[^a-zA-Z0-9]/g, '_');
  },

  async saveDailyTracker(workspaceId, email, dateStr, metrics) {
    const wid = await this._resolveWorkspaceIdForWrite(workspaceId);
    assertLeadScopedWorkspaceId(wid, 'saveDailyTracker');
    const fragment = this._emailKeyFragment(email);
    const key = `daily_tracker:${wid}:${fragment}:${dateStr}`;
    const existingRaw = kvGet(key);
    let existing = {};
    if (existingRaw) {
      try {
        existing = typeof existingRaw === 'string' ? JSON.parse(existingRaw) : existingRaw;
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
    kvSet(key, JSON.stringify(merged));
    return merged;
  },

  async getDailyTracker(workspaceId, email, dateStr) {
    const wid = await this._resolveWorkspaceIdForWrite(workspaceId);
    assertLeadScopedWorkspaceId(wid, 'getDailyTracker');
    const fragment = this._emailKeyFragment(email);
    const key = `daily_tracker:${wid}:${fragment}:${dateStr}`;
    let raw = kvGet(key);
    if (!raw) {
      const legacyKey = `daily_tracker:${fragment}:${dateStr}`;
      raw = kvGet(legacyKey);
    }
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
    const keys = kvList(prefix);
    const sorted = keys.sort((a, b) => {
      const da = (a && a.split(':').pop()) || '';
      const db = (b && b.split(':').pop()) || '';
      return db.localeCompare(da);
    });
    const slice = sorted.slice(0, limit);
    const rows = [];
    for (const key of slice) {
      const raw = kvGet(key);
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

  _actionPlanMonthKey(workspaceId, email, year, month) {
    const wid = workspaceId || 'default';
    const frag = this._emailKeyFragment(email);
    const y = parseInt(year, 10);
    const m = Math.min(12, Math.max(1, parseInt(month, 10)));
    return `action_plan:${wid}:${frag}:${y}-${String(m).padStart(2, '0')}`;
  },

  async getActionPlanMonth(workspaceId, email, year, month) {
    const wid = await this._resolveWorkspaceIdForWrite(workspaceId);
    assertLeadScopedWorkspaceId(wid, 'getActionPlanMonth');
    const key = this._actionPlanMonthKey(wid, email, year, month);
    const raw = kvGet(key);
    if (!raw) return null;
    try {
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return null;
    }
  },

  async saveActionPlanMonth(workspaceId, email, year, month, data) {
    const wid = await this._resolveWorkspaceIdForWrite(workspaceId);
    assertLeadScopedWorkspaceId(wid, 'saveActionPlanMonth');
    const key = this._actionPlanMonthKey(wid, email, year, month);
    const existing = (await this.getActionPlanMonth(wid, email, year, month)) || {};
    const merged = {
      ...existing,
      ...(data || {}),
      email,
      year: parseInt(year, 10),
      month: parseInt(month, 10),
      updatedAt: new Date().toISOString(),
    };
    kvSet(key, JSON.stringify(merged));
    return merged;
  },

  _actionPlanCatalogKey(workspaceId, email) {
    const wid = workspaceId || 'default';
    const frag = this._emailKeyFragment(email);
    return `action_plan_catalog:${wid}:${frag}`;
  },

  async getActionPlanCatalog(workspaceId, email) {
    const wid = await this._resolveWorkspaceIdForWrite(workspaceId);
    assertLeadScopedWorkspaceId(wid, 'getActionPlanCatalog');
    const key = this._actionPlanCatalogKey(wid, email);
    const raw = kvGet(key);
    if (!raw) return null;
    try {
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return null;
    }
  },

  async saveActionPlanCatalog(workspaceId, email, data) {
    const wid = await this._resolveWorkspaceIdForWrite(workspaceId);
    assertLeadScopedWorkspaceId(wid, 'saveActionPlanCatalog');
    const key = this._actionPlanCatalogKey(wid, email);
    const merged = {
      ...(data || {}),
      email,
      updatedAt: new Date().toISOString(),
    };
    kvSet(key, JSON.stringify(merged));
    return merged;
  },

  // --- Personal tasks (checklist + kanban) ---

  _userTaskKey(workspaceId, email, taskId) {
    const wid = workspaceId || 'default';
    const frag = this._emailKeyFragment(email);
    return `user_task:${wid}:${frag}:${taskId}`;
  },

  async listUserTasks(workspaceId, email) {
    const wid = workspaceId || 'default';
    const frag = this._emailKeyFragment(email);
    const prefix = `user_task:${wid}:${frag}:`;
    const keys = kvList(prefix);
    const tasks = [];
    for (const key of keys) {
      const raw = kvGet(key);
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
    let remindMinutesBefore = null;
    if (task.remindMinutesBefore != null && task.remindMinutesBefore !== '') {
      const n = parseInt(task.remindMinutesBefore, 10);
      if (Number.isFinite(n) && n > 0) remindMinutesBefore = Math.min(n, 24 * 60);
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
      remindMinutesBefore,
    };
    const key = this._userTaskKey(workspaceId, email, id);
    kvSet(key, JSON.stringify(payload));
    return payload;
  },

  async deleteUserTask(workspaceId, email, taskId) {
    const key = this._userTaskKey(workspaceId, email, taskId);
    kvDelete(key);
  },

  // --- Saved resources (per workspace + user) ---

  _userResourceKey(workspaceId, email, resourceId) {
    const wid = workspaceId || 'default';
    const frag = this._emailKeyFragment(email);
    return `user_resource:${wid}:${frag}:${resourceId}`;
  },

  async listUserResources(workspaceId, email) {
    const wid = workspaceId || 'default';
    const frag = this._emailKeyFragment(email);
    const prefix = `user_resource:${wid}:${frag}:`;
    const keys = kvList(prefix);
    const resources = [];
    for (const key of keys) {
      const raw = kvGet(key);
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
    kvSet(key, JSON.stringify(payload));
    return payload;
  },

  async deleteUserResource(workspaceId, email, resourceId) {
    const key = this._userResourceKey(workspaceId, email, resourceId);
    kvDelete(key);
  },

  // --- Workspace resources (shared links) ---

  _workspaceResourceKey(workspaceId, resourceId) {
    const wid = String(workspaceId || 'default').trim();
    const id = String(resourceId || '').trim();
    return `ws_resource:${wid}:${id}`;
  },

  async listWorkspaceResources(workspaceId) {
    const wid = String(workspaceId || 'default').trim();
    const prefix = `ws_resource:${wid}:`;
    const keys = kvList(prefix);
    const resources = [];
    for (const key of keys) {
      const raw = kvGet(key);
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
    kvSet(key, JSON.stringify(payload));
    return payload;
  },

  async deleteWorkspaceResource(workspaceId, resourceId) {
    const wid = String(workspaceId || 'default').trim();
    const key = this._workspaceResourceKey(wid, resourceId);
    kvDelete(key);
  },

  async mergeUserResourcesIntoWorkspace(workspaceId, email) {
    const wid = String(workspaceId || 'default').trim();
    if (!wid || !email) return;
    const frag = this._emailKeyFragment(email);
    const legacyPrefix = `user_resource:${wid}:${frag}:`;
    const keys = kvList(legacyPrefix);
    if (!keys.length) return;

    const workspaceList = await this.listWorkspaceResources(wid);
    const urls = new Set(workspaceList.map((r) => r.url).filter(Boolean));

    for (const key of keys) {
      const raw = kvGet(key);
      if (!raw) continue;
      let r;
      try {
        r = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch {
        kvDelete(key);
        continue;
      }
      if (!r || !r.url) {
        kvDelete(key);
        continue;
      }
      const urlNorm = String(r.url).trim();
      if (urls.has(urlNorm)) {
        kvDelete(key);
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
        kvDelete(key);
      } catch {
        /* keep legacy key if save failed */
      }
    }
  },

  // --- Workspaces (multi-seat) ---

  async getWorkspace(workspaceId) {
    const id = workspaceId != null ? String(workspaceId).trim() : '';
    if (!id) return null;
    const raw = kvGet(`workspace:${id}`);
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
    kvSet(`workspace:${id}`, JSON.stringify({ ...doc, id }));
  },

  // --- 7-day activation ---

  async getActivationState(email) {
    const fragment = this._emailKeyFragment(email);
    const key = `activation:${fragment}`;
    const raw = kvGet(key);
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
    kvSet(key, JSON.stringify(state));
  },

  _morningBriefKey(workspaceId, ymd) {
    return `morningBrief:${workspaceId || 'default'}:${ymd}`;
  },

  async getMorningBrief(workspaceId, ymd) {
    const key = this._morningBriefKey(workspaceId, ymd);
    const raw = kvGet(key);
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
    kvSet(
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
    kvDelete(this._morningBriefKey(workspaceId, ymd));
  },

  _prospectingCoachKey(workspaceId) {
    return `pc_coach:${String(workspaceId || 'default').trim()}`;
  },

  async getProspectingCoachCache(workspaceId) {
    const key = this._prospectingCoachKey(workspaceId);
    const raw = kvGet(key);
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
    kvSet(
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
    kvDelete(this._prospectingCoachKey(workspaceId));
  },

  async listWorkspaceIds() {
    const keys = kvList('workspace:');
    return keys
      .map((k) => String(k).replace(/^workspace:/, ''))
      .filter(Boolean);
  },

  // --- Hosted site-audit open tracking ---

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
      viewedAt,
      ip_hash: String(ipHash || '').slice(0, 64),
      user_agent: String(userAgent || '').slice(0, 512),
      duration_seconds: 0,
      workspace_id: wid,
    };
    kvSet(this._reportViewStorageKey(wid, id), JSON.stringify(row));
    return row;
  },

  async getReportView(workspaceId, viewId) {
    const wid = String(workspaceId || 'default').trim();
    const vid = String(viewId || '').trim();
    if (!vid) return null;
    const raw = kvGet(this._reportViewStorageKey(wid, vid));
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
    kvSet(this._reportViewStorageKey(wid, viewId), JSON.stringify(row));
    return true;
  },

  async listReportViewsForWorkspaceSince(workspaceId, sinceIso, cap = 500) {
    const wid = String(workspaceId || 'default').trim();
    const prefix = `reportview:${wid}:`;
    const keys = kvList(prefix);
    const sinceMs = Date.parse(sinceIso);
    const sinceOk = Number.isFinite(sinceMs) ? sinceMs : 0;
    const scanLimit = Math.min(Math.max(40, cap), 2000);
    const sortedKeys = keys
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
      const raw = kvGet(key);
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

  // ── Chat Message Persistence ──────────────────────────────────────────────────

  saveChatMessage(sessionId, role, content, source) {
    const sid = sessionId || 'ceo';
    const src = source || 'web';
    const stmt = sqlite.prepare(
      'INSERT INTO chat_messages (session_id, role, content, source) VALUES (?, ?, ?, ?)'
    );
    const result = stmt.run(sid, role, content, src);
    return { id: result.lastInsertRowid, session_id: sid, role, content, source: src };
  },

  getChatHistory(sessionId, limit) {
    const sid = sessionId || 'ceo';
    const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const rows = sqlite
      .prepare(
        'SELECT id, role, content, source, created_at FROM chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT ?'
      )
      .all(sid, lim);
    return rows.reverse();
  },

  getRecentChatContext(sessionId, pairCount) {
    const history = this.getChatHistory(sessionId, (pairCount || 10) * 2);
    return history
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role, content: m.content }));
  },

  deleteChatHistory(sessionId) {
    const sid = sessionId || 'ceo';
    sqlite.prepare('DELETE FROM chat_messages WHERE session_id = ?').run(sid);
    return true;
  },

  // ── Social Posts ────────────────────────────────────────────────────────────

  async saveSocialPost(post, workspaceId) {
    const wid = String(workspaceId || 'default').trim() || 'default';
    const key = `social:post:${wid}:${post.id}`;
    kvSet(key, JSON.stringify(post));
    // Also maintain an index
    const idxKey = `social:posts:${wid}`;
    const idxRaw = kvGet(idxKey);
    let idx = [];
    try { idx = idxRaw ? JSON.parse(idxRaw) : []; } catch { idx = []; }
    if (!idx.includes(post.id)) {
      idx.unshift(post.id);
      kvSet(idxKey, JSON.stringify(idx.slice(0, 200))); // keep last 200
    }
    return post.id;
  },

  async getSocialPosts(workspaceId) {
    const wid = String(workspaceId || 'default').trim() || 'default';
    const idxKey = `social:posts:${wid}`;
    const idxRaw = kvGet(idxKey);
    let ids = [];
    try { ids = idxRaw ? JSON.parse(idxRaw) : []; } catch { ids = []; }
    const posts = [];
    for (const id of ids) {
      const raw = kvGet(`social:post:${wid}:${id}`);
      if (raw) {
        try { posts.push(typeof raw === 'string' ? JSON.parse(raw) : raw); } catch { /* skip */ }
      }
    }
    return posts;
  },

  async deleteSocialPost(postId, workspaceId) {
    const wid = String(workspaceId || 'default').trim() || 'default';
    kvDelete(`social:post:${wid}:${postId}`);
    const idxKey = `social:posts:${wid}`;
    const idxRaw = kvGet(idxKey);
    try {
      const idx = idxRaw ? JSON.parse(idxRaw) : [];
      const filtered = idx.filter(id => id !== postId);
      kvSet(idxKey, JSON.stringify(filtered));
    } catch { /* ignore */ }
    return true;
  },

  async getSocialStyleProfile(workspaceId) {
    const wid = String(workspaceId || 'default').trim() || 'default';
    const raw = kvGet(`social:style:${wid}`);
    if (!raw) return null;
    try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
  },

  async updateSocialStyleProfile(workspaceId, update) {
    const wid = String(workspaceId || 'default').trim() || 'default';
    const existing = await this.getSocialStyleProfile(wid) || {};
    const merged = { ...existing, ...update, workspaceId: wid, updatedAt: new Date().toISOString() };
    kvSet(`social:style:${wid}`, JSON.stringify(merged));
    return merged;
  },

  // ── Local Content (Clark County / zip.guide) ─────────────────────────────────

  async saveLocalContent(entry, workspaceId) {
    const wid = String(workspaceId || 'default').trim() || 'default';
    const id = entry.id || `lc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const record = {
      id,
      title: entry.title || '',
      summary: entry.summary || '',
      postIdea: entry.postIdea || '',
      category: entry.category || 'general',
      source: entry.source || '',
      createdAt: entry.createdAt || new Date().toISOString(),
      workspaceId: wid,
    };
    const key = `local:content:${wid}:${id}`;
    kvSet(key, JSON.stringify(record));
    // Maintain date-indexed list (YYYY-MM-DD → [id, ...])
    const dateKey = record.createdAt.slice(0, 10);
    const idxKey = `local:content:idx:${wid}`;
    const idxRaw = kvGet(idxKey);
    let idx = {};
    try { idx = idxRaw ? JSON.parse(idxRaw) : {}; } catch { idx = {}; }
    if (!idx[dateKey]) idx[dateKey] = [];
    if (!idx[dateKey].includes(id)) idx[dateKey].unshift(id);
    kvSet(idxKey, JSON.stringify(idx));
    return record;
  },

  async getLocalContent(workspaceId, limit = 50) {
    const wid = String(workspaceId || 'default').trim() || 'default';
    const idxKey = `local:content:idx:${wid}`;
    const idxRaw = kvGet(idxKey);
    let idx = {};
    try { idx = idxRaw ? JSON.parse(idxRaw) : {}; } catch { idx = {}; }
    // Flatten all IDs, most recent date first
    const dates = Object.keys(idx).sort().reverse();
    const results = [];
    for (const date of dates) {
      for (const id of (idx[date] || [])) {
        if (results.length >= limit) break;
        const raw = kvGet(`local:content:${wid}:${id}`);
        if (raw) {
          try { results.push(typeof raw === 'string' ? JSON.parse(raw) : raw); } catch { /* skip */ }
        }
      }
      if (results.length >= limit) break;
    }
    return results;
  },

  async deleteLocalContent(entryId, workspaceId) {
    const wid = String(workspaceId || 'default').trim() || 'default';
    kvDelete(`local:content:${wid}:${entryId}`);
    const idxKey = `local:content:idx:${wid}`;
    const idxRaw = kvGet(idxKey);
    try {
      const idx = idxRaw ? JSON.parse(idxRaw) : {};
      for (const date of Object.keys(idx)) {
        idx[date] = (idx[date] || []).filter(id => id !== entryId);
        if (idx[date].length === 0) delete idx[date];
      }
      kvSet(idxKey, JSON.stringify(idx));
    } catch { /* ignore */ }
    return true;
  },

  normalizeDomain,
};
