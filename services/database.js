const Database = require('@replit/database');
const fs = require('fs');
const path = require('path');

let db;

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
    // If an email exists, check for an existing lead first to merge
    if (leadData.email && leadData.email !== 'N/A') {
      const existing = await this.findLeadByEmail(leadData.email);
      if (existing) {
        return await this.updateLead(existing.key, leadData);
      }
    } else if (leadData.ip) {
      // Fallback to IP matching for anonymous chats/audits
      const existing = await this.findLeadByIp(leadData.ip);
      if (existing) {
        return await this.updateLead(existing.key, leadData);
      }
    }

    const key = `lead:${Date.now()}`;
    const newLead = { 
      ...leadData, 
      createdAt: new Date().toISOString(),
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

  async findLeadByEmail(email) {
    if (!email || email === 'N/A') return null;
    const leads = await this.getAllLeads();
    return leads.find(l => l.email && l.email.toLowerCase() === email.toLowerCase()) || null;
  },

  async findLeadByIp(ip) {
    if (!ip) return null;
    const leads = await this.getAllLeads();
    // Match only if the lead was created recently or from same source to avoid NAT over-merging
    return leads.find(l => l.ip === ip) || null;
  },

  async getLead(key) {
    const data = await db.get(key);
    if (!data) return null;
    const raw = data && typeof data === 'object' && 'ok' in data ? data.value : data;
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
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
    
    await db.set(key, JSON.stringify(updated));
    return updated;
  },

  async deleteLead(key) {
    await db.delete(key);
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

  async saveVisit(visitData) {
    const timestamp = Date.now();
    const key = `visit:${timestamp}`;
    await db.set(key, JSON.stringify({ 
      ...visitData, 
      timestamp 
    }));
    return key;
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
};
