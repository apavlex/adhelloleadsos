const Database = require('@replit/database');
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
    if (k === 'pipelineStage' || k === 'status') continue;
    if (isBlankValue(v)) continue;
    const cur = existing ? existing[k] : undefined;
    if (isBlankValue(cur)) out[k] = v;
  }

  if (!existing) return out;

  if (!isBlankValue(incoming?.status) && isBlankValue(existing.status)) out.status = incoming.status;
  if (incoming?.pipelineStage !== undefined && existing.pipelineStage == null) out.pipelineStage = incoming.pipelineStage;

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

  async saveLead(leadData) {
    const wid = leadData.workspaceId || 'default';
    const incoming = { ...(leadData || {}), workspaceId: wid };
    incoming.emailNorm = normalizeEmail(incoming.email);
    incoming.domainNorm = normalizeDomain(incoming.website);
    incoming.phoneNorm = normalizePhone(incoming.phone);
    incoming.nameNorm = normalizeName(incoming.title);
    incoming.geoNorm = normalizeGeo(incoming.city, incoming.state);
    incoming.dedupeKey = computeDedupeKey(incoming);

    // Find existing lead to merge into (workspace-scoped)
    const leads = await this.getAllLeads();
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

      await this.updateLead(existing.key, patch);
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
    const leads = await this.getAllLeads();
    return (
      leads.find((l) => {
        if (!l.email || String(l.email).toLowerCase() !== em) return false;
        if (workspaceId == null || workspaceId === '') return true;
        return (l.workspaceId || 'default') === workspaceId;
      }) || null
    );
  },

  async findLeadByIp(ip, workspaceId) {
    if (!ip) return null;
    const leads = await this.getAllLeads();
    return (
      leads.find((l) => {
        if (l.ip !== ip) return false;
        if (workspaceId == null || workspaceId === '') return true;
        return (l.workspaceId || 'default') === workspaceId;
      }) || null
    );
  },

  async getLead(key) {
    const data = await db.get(key);
    if (!data) return null;
    const raw = data && typeof data === 'object' && 'ok' in data ? data.value : data;
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  },

  /** Alias for callers expecting list semantics (e.g. stitch-sync). */
  async listLeads() {
    return this.getAllLeads();
  },

  async getAllLeads() {
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

  async updateLead(key, updateData) {
    const existing = await this.getLead(key);
    if (!existing) return null;
    
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
    return updated;
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

  // --- Schedules (Autopilot) ---

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

  async clearActiveJob() {
    // Before clearing, we store it as the latest completed job for notifications
    const active = await this.getActiveJob();
    if (active) {
      await db.set('latest_finished_job', JSON.stringify({
        ...active,
        status: 'completed',
        finishedAt: new Date().toISOString(),
        isRead: false
      }));
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

  // --- Daily action tracker (per user email, per calendar day) ---

  _emailKeyFragment(email) {
    return String(email || 'anon').replace(/[^a-zA-Z0-9]/g, '_');
  },

  async saveDailyTracker(email, dateStr, metrics) {
    const fragment = this._emailKeyFragment(email);
    const key = `daily_tracker:${fragment}:${dateStr}`;
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
      notes: metrics.notes != null ? metrics.notes : existing.notes ?? '',
      callNotes: metrics.callNotes != null ? metrics.callNotes : existing.callNotes ?? '',
      email,
      date: dateStr,
      updatedAt: new Date().toISOString(),
    };
    await db.set(key, JSON.stringify(merged));
    return merged;
  },

  async getDailyTracker(email, dateStr) {
    const fragment = this._emailKeyFragment(email);
    const key = `daily_tracker:${fragment}:${dateStr}`;
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

  async listDailyTrackers(email, limit = 14) {
    const fragment = this._emailKeyFragment(email);
    const prefix = `daily_tracker:${fragment}:`;
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

  // --- Workspaces (multi-seat) ---

  async getWorkspace(workspaceId) {
    const key = `workspace:${workspaceId || 'default'}`;
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
    const id = workspaceId || 'default';
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
};
