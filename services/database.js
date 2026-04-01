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
    const key = `lead:${Date.now()}`;
    await db.set(key, JSON.stringify(leadData));
    return key;
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
    const updated = { ...existing, ...updateData };
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
};
