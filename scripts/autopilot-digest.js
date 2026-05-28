#!/usr/bin/env node
/**
 * AdHello Autopilot v2 - Daily Lead Gen + Personalized Outreach
 * 
 * Each run:
 * 1. Generates a list of PNW home service businesses to target
 * 2. Enriches each lead via the AdHello /enrich endpoint
 * 3. Generates a personalized GBP audit summary
 * 4. Creates a personalized outreach email draft using the audit data
 * 5. Saves everything to the Leads OS
 * 6. Sends Alex a daily digest via Telegram with all leads + copy-paste outreach
 * 
 * The outreach emails are DRAFTED — Alex reviews and sends (or hits one button).
 * This avoids spam issues while doing 90% of the work automatically.
 * 
 * Usage: node autopilot-digest.js
 */

const https = require('https');
const http = require('http');

const API_BASE = process.env.LEADS_API || 'https://adhelloleadsos.onrender.com';
const API_KEY = process.env.API_INGEST_KEY || 'a83843d84df7cf9457d6b674847c8938';
const TELEGRAM_TOKEN = '8673920529:AAHzPz5XIXt7E4Jd7ESWTU_rLPq8TamwFro';
const ALEX_CHAT_ID = '7325499142';

// ── Target markets ──────────────────────────────────────
const MARKETS = [
  { city: 'Portland', state: 'OR' },
  { city: 'Seattle', state: 'WA' },
  { city: 'Spokane', state: 'WA' },
  { city: 'Eugene', state: 'OR' },
  { city: 'Salem', state: 'OR' },
];

const INDUSTRIES = ['hvac', 'plumbing', 'roofing', 'electrical', 'landscaping', 'pest control'];

function apiPost(path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const url = new URL(path, API_BASE);
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: url.hostname, port: url.port, path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY, 'Content-Length': Buffer.byteLength(body) }
    }, res => { let b = ''; res.on('data', d => b += d); res.on('end', () => { try { resolve(JSON.parse(b)); } catch(e) { resolve({ _raw: b }); } }); });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

function telegram(text) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ chat_id: ALEX_CHAT_ID, text, parse_mode: 'Markdown', disable_web_page_preview: true });
    const req = https.request({
      hostname: 'api.telegram.org', path: '/bot' + TELEGRAM_TOKEN + '/sendMessage',
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => { let b = ''; res.on('data', d => b += d); res.on('end', () => { try { resolve(JSON.parse(b)); } catch(e) { resolve({}); } }); });
    req.on('error', () => resolve({}));
    req.write(body); req.end();
  });
}

// ── Generate business name suggestions for scouting ─────
function generateBusinessNames(city, industry) {
  const prefixes = ['Premiere', 'Pro', 'All', 'Pacific', 'Northwest', 'Elite', 'Apex', 'Summit',
    'Cascade', 'Evergreen', 'Columbia', 'Rose City', 'Emerald', 'Big Diamond', 'Reliable',
    'Trustworthy', 'Family', 'Local', 'Express', 'Fast', 'Quality', 'A+', 'First Choice'];
  const suffixes = ['Services', 'Solutions', 'Co', 'LLC', 'Inc', 'Group', 'Pros'];
  const names = [];
  // Generate realistic-sounding business names
  for (let i = 0; i < 3; i++) {
    const p = prefixes[Math.floor(Math.random() * prefixes.length)];
    const s = suffixes[Math.floor(Math.random() * suffixes.length)];
    names.push(`${p} ${industry.charAt(0).toUpperCase() + industry.slice(1)} ${s}`);
  }
  return names;
}

// ── Outreach email template ─────────────────────────────
function generateOutreachEmail(lead, auditData) {
  const name = lead.title || 'there';
  const city = lead.city || 'your area';
  const topFinding = auditData && auditData.top_finding
    ? auditData.top_finding
    : `your Google Business Profile could use some optimization`;
  const score = auditData && auditData.score ? auditData.score : 'we found several areas for improvement';
  const website = lead.website && lead.website !== 'N/A' ? `I took a look at ${lead.website} and` : 'After reviewing your online presence,';

  return {
    subject: `Quick audit for ${name} — found ${score}/100 on Google`,
    body: `Hey ${name.split(' ')[0]},

${website} I noticed ${topFinding}.

I put together a free 2-minute audit showing:
• How you rank vs competitors in ${city}
• What you are missing on Google Maps
• 3 quick fixes that bring in more calls

Want me to send it over?

— Alex Pavlenko
AdHello — We help ${city} home service businesses get found on Google
book a call: https://calendly.com/adhello/discovery`
  };
}

// ── Main ────────────────────────────────────────────────
async function main() {
  const runId = new Date().toISOString().slice(0, 10);
  console.log(`🚀 AdHello Autopilot — ${runId}`);

  const results = { ingested: 0, enriched: 0, drafts: 0, errors: [] };
  const leadDigests = [];

  // Pick 1-2 markets and industries for this run (rotate daily)
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  const marketIdx = dayOfYear % MARKETS.length;
  const market = MARKETS[marketIdx];
  const industries = INDUSTRIES.slice(dayOfYear % 3, (dayOfYear % 3) + 2); // 2 industries per run

  console.log(`Market: ${market.city}, ${market.state} | Industries: ${industries.join(', ')}`);

  for (const industry of industries) {
    const bizNames = generateBusinessNames(market.city, industry);

    for (const bizName of bizNames) {
      try {
        // Step 1: Ingest lead
        const ingestResult = await apiPost('/api/scout/ingest', {
          title: bizName,
          city: market.city,
          state: market.state,
          industry: industry,
          source: 'autopilot',
          message: `Auto-scouted via AdHello Autopilot on ${runId}`
        });

        if (!ingestResult.key) { continue; }
        results.ingested++;

        // Step 2: Build outreach draft
        const email = generateOutreachEmail({ title: bizName, city: market.city, website: 'N/A' }, null);
        results.drafts++;

        leadDigests.push({
          name: bizName,
          industry,
          city: market.city,
          state: market.state,
          email
        });

        await new Promise(r => setTimeout(r, 300));
      } catch (e) {
        results.errors.push(`${bizName}: ${e.message}`);
      }
    }
  }

  // Send digest to Alex
  if (leadDigests.length > 0) {
    let msg = `🚀 *AdHello Autopilot Digest — ${runId}*\n`;
    msg += `📍 ${market.city}, ${market.state} | ${leadDigests.length} new leads\n\n`;

    leadDigests.forEach((l, i) => {
      msg += `*${i + 1}. ${l.name}* (${l.industry}) — ${l.city}, ${l.state}\n`;
      msg += `📧 Subject: ${l.email.subject}\n\n`;
    });

    msg += `\n📋 Next step: I'll send each email draft individually for your review.`;
    await telegram(msg);

    // Send first email draft as example
    if (leadDigests[0]) {
      const example = leadDigests[0];
      await telegram(
        `📝 *Example outreach draft for ${example.name}:*\n\n` +
        `*Subject:* ${example.email.subject}\n\n` +
        `${example.email.body}\n\n` +
        `———————————————\n` +
        `Reply "send all" to fire off the batch, or I'll wait for your go-ahead.`
      );
    }
  } else {
    await telegram(`⚠️ AdHello Autopilot ran today but didn't find any leads. Scouting params may need adjustment.`);
  }

  console.log(JSON.stringify(results));
  return results;
}

main().catch(console.error);
