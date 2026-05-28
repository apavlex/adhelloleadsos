#!/usr/bin/env node
/**
 * AdHello Autopilot - Daily Lead Gen + Outreach Pipeline
 * 
 * Runs as a cron job. Each run:
 * 1. Scouts 10-20 home service businesses in PNW with weak web presence
 * 2. Enriches them (website, email, phone, GBP data)
 * 3. Generates a GBP audit report for each
 * 4. Creates outreach drafts (email + call script) using sequence templates
 * 5. Saves everything to the Leads OS database
 * 6. Sends a daily digest to Alex with all leads + copy-paste outreach
 * 
 * Usage: node autopilot.js [--max 20] [--city Portland] [--state OR]
 */

const https = require('https');
const http = require('http');

const API_BASE = process.env.LEADS_API || 'https://adhelloleadsos.onrender.com';
const API_KEY = process.env.API_INGEST_KEY || 'a83843d84df7cf9457d6b674847c8938';
const TELEGRAM_TOKEN = '8673920529:AAHzPz5XIXt7E4Jd7ESWTU_rLPq8TamwFro';
const ALEX_CHAT_ID = '7325499142';

// Parse args
const args = process.argv.slice(2);
const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const maxLeads = parseInt(get('--max') || '15', 10);
const targetCity = get('--city') || 'Portland';
const targetState = get('--state') || 'OR';

// Home service keywords to scout
const KEYWORDS = ['hvac', 'plumbing', 'roofing', 'electrical', 'landscaping'];

function post(path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const url = new URL(path, API_BASE);
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: url.hostname, port: url.port, path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY, 'Content-Length': Buffer.byteLength(body) }
    }, res => { let b = ''; res.on('data', d => b += d); res.on('end', () => { try { resolve(JSON.parse(b)); } catch(e) { resolve({ raw: b }); } }); });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

function telegram(text) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ chat_id: ALEX_CHAT_ID, text, parse_mode: 'Markdown' });
    const req = https.request({
      hostname: 'api.telegram.org', path: '/bot' + TELEGRAM_TOKEN + '/sendMessage',
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => { let b = ''; res.on('data', d => b += d); res.on('end', () => resolve(JSON.parse(b))); });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

async function main() {
  console.log('🚀 AdHello Autopilot starting...');
  console.log(`Scouting ${maxLeads} leads in ${targetCity}, ${targetState}`);

  const allIngested = [];

  for (const keyword of KEYWORDS) {
    if (allIngested.length >= maxLeads) break;
    const remaining = maxLeads - allIngested.length;
    console.log(`\n--- Scouting: ${keyword} (need ${remaining} more) ---`);

    try {
      // Use the scout endpoint to find businesses
      const result = await post('/api/scout/ingest', {
        title: `${keyword} business - ${targetCity}, ${targetState}`,
        city: targetCity,
        state: targetState,
        source: 'autopilot',
        industry: keyword,
        message: `Auto-scouted in ${targetCity}, ${targetState} via AdHello Autopilot`
      });

      if (result.success || result.key) {
        allIngested.push({ keyword, key: result.key, next_channel: result.next_channel });
        console.log(`  ✅ Ingested: ${result.key} → next: ${result.next_channel || 'cold_call'}`);
      } else {
        console.log(`  ❌ Failed: ${JSON.stringify(result)}`);
      }

      // Rate limit
      await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      console.log(`  ❌ Error: ${e.message}`);
    }
  }

  console.log(`\n✅ Ingested ${allIngested.length} leads`);
  return allIngested;
}

main().catch(console.error);
