#!/usr/bin/env node
/**
 * Telegram Outreach Automation
 * 
 * Runs full pipeline: Search → Save → Score → Draft → Sequence
 * Called from Hermes/Telegram/cron.
 * 
 * Usage:
 *   node scripts/telegram-outreach.js --keyword "hvac" --city "Portland" --state "OR" --max 10
 *   node scripts/telegram-outreach.js --keyword "plumbing" --city "Seattle" --state "WA" --max 5 --dry-run
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const API_BASE = process.env.LEADS_API || 'https://adhelloleadsos.onrender.com';
const API_KEY = process.env.API_INGEST_KEY || 'a83843d84df7cf9457d6b674847c8938';

const DEFAULT_TRADES = [
  'hvac', 'plumbing', 'roofing', 'electrical', 'flooring',
  'painting', 'landscaping', 'pest control', 'window cleaning',
  'pressure washing', 'chimney sweep', 'garage door repair',
  'appliance repair', 'carpet cleaning', 'tree service',
  'pool service', 'fence installation', 'gutter cleaning',
  'water damage restoration', 'fireplace repair'
];

const argv = process.argv.slice(2);
const getF = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
const getMultiple = (flag) => {
  const val = getF(flag);
  if (val) return val.split(',').map(s => s.trim()).filter(Boolean);
  return null;
};
const keyword = getF('--keyword') || null;          // single keyword override (backwards compat)
const tradesFlag = getMultiple('--trades');          // --trades "hvac,plumbing,roofing"
const trades = tradesFlag || (keyword ? [keyword] : null);  // null = use ALL defaults
const city = getF('--city') || 'Portland';
const state = getF('--state') || 'OR';
const maxResults = parseInt(getF('--max') || '5', 10);  // max per trade
const dryRun = argv.includes('--dry-run');
const sep = '='.repeat(60);

function api(method, urlPath, data) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, API_BASE);
    const mod = url.protocol === 'https:' ? https : http;
    const body = data ? JSON.stringify(data) : null;
    const h = { 'x-api-key': API_KEY };
    if (body) { h['Content-Type'] = 'application/json'; h['Content-Length'] = Buffer.byteLength(body); }
    const req = mod.request({ hostname: url.hostname, port: url.port, path: url.pathname, method, headers: h }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ _raw: d.substring(0, 200) }); } });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function scoreGBP(biz) {
  const s = {};
  const rc = biz.reviewsCount || 0;
  s.reviews = rc >= 100 ? 20 : rc >= 50 ? 16 : rc >= 20 ? 12 : rc >= 5 ? 8 : 0;
  const rt = biz.rating || 0;
  s.rating = rt >= 4.5 ? 15 : rt >= 4.0 ? 10 : rt >= 3.5 ? 5 : 0;
  s.website = (biz.website && biz.website !== 'N/A' && biz.website !== '') ? 10 : 0;
  s.phone = (biz.phone && biz.phone !== 'N/A' && biz.phone !== '') ? 5 : 0;
  s.email = (biz.email && biz.email !== 'N/A' && biz.email !== '') ? 5 : 0;
  s.fb = (biz.facebook && biz.facebook !== 'N/A') ? 5 : 0;
  s.ig = (biz.instagram && biz.instagram !== 'N/A') ? 5 : 0;
  s.address = (biz.city) ? 5 : 0;
  s.position = 5;
  const total = Object.values(s).reduce((a, b) => a + b, 0);
  const clamped = Math.min(100, total);
  return {
    totalScore: clamped,
    grade: clamped >= 90 ? 'A' : clamped >= 75 ? 'B' : clamped >= 60 ? 'C' : clamped >= 40 ? 'D' : 'F',
  };
}

function draftEmail(biz, audit, trade) {
  const name = biz.title || 'there';
  const score = audit.totalScore;
  const tradeLabel = trade || 'home service';
  let hook, teaser;
  if (score < 40) {
    hook = `I ran a free Google Business Profile audit for ${name} — scored ${score}/100. A few specific issues are likely costing you calls.`;
    teaser = `Most competitors in ${city} are scoring higher. The good news: the fixes are quick.`;
  } else if (score < 60) {
    hook = `Quick note — I audited ${name}'s Google presence and found some low-hanging fruit that could drive more calls.`;
    teaser = `GBP score: ${score}/100. A handful of improvements could move you up the map pack.`;
  } else {
    hook = `I've been auditing ${tradeLabel} businesses in ${city} — ${name} scored ${score}/100 on our GBP audit.`;
    teaser = `The audit shows exactly where you stand vs competitors and 3 quick fixes to get more calls.`;
  }
  return {
    subject: `${name} — free Google audit (${city})`,
    body: `Hi ${name} team,\n\n${hook}\n\n${teaser}\n\nI put together a detailed (free) audit that shows your score vs local competitors, what's hurting your ranking, and 3 quick fixes.\n\nNo pitch. Just the audit.\n\nWant me to send it over?\n\n— Alex Pavlenko\nAdHello | Helping ${tradeLabel} businesses get found in ${city}`,
  };
}

async function run() {
  const today = new Date().toISOString().slice(0, 10);
  const activeTrades = trades || DEFAULT_TRADES;
  console.log(`\n🚀 Telegram Outreach — ${today}`);
  console.log(`   Trades: ${activeTrades.length} (${activeTrades.slice(0, 5).join(', ')}${activeTrades.length > 5 ? '...' : ''})`);
  console.log(`   ${city}, ${state} | Max per trade: ${maxResults} | Dry-run: ${dryRun}`);
  console.log(sep);

  const allResults = [];

  for (const trade of activeTrades) {
    console.log(`\n🔧 ${trade.toUpperCase()}`);

    // Step 1: Search
    console.log(`   📡 Scouting...`);
    const sr = await api('POST', '/autonomous/search', { keyword: trade, city, state, maxResults: Math.min(maxResults * 2, 50) });
    if (!sr.success) {
      console.error(`   ❌ Search failed: ${sr.error}`);
      continue;
    }

    let leads = [];
    for (let i = 0; i < 40; i++) {
      await sleep(2000);
      const st = await api('GET', `/autonomous/search/${encodeURIComponent(sr.searchId)}`);
      if (st && st.status === 'complete') { leads = (st.results || []).slice(0, maxResults); console.log(`   ✅ Found ${leads.length}`); break; }
      if (st && st.status === 'failed') { console.error(`   ❌ ${st.error}`); break; }
      if (i % 10 === 9) console.log(`   ⏳ ${(i + 1) * 2}s...`);
    }
    if (!leads.length) { console.log('   ⚠️ No results'); continue; }

    // Step 2: Score + Save + Draft + Sequence
    console.log(`   📝 Scoring, drafting, sequencing...`);
    for (const biz of leads) {
      const title = biz.title || biz.name || 'Unknown';
      const phone = biz.phone || biz.phoneNumber || 'N/A';
      const website = biz.website || biz.url || 'N/A';
      const email = biz.email || 'N/A';
      const reviewsCount = parseInt(biz.reviewsCount || 0, 10);
      const rating = parseFloat(biz.totalScore || biz.rating || 0);

      const audit = scoreGBP({ title, reviewsCount, rating, website, phone, email, city, state });
      const draft = draftEmail({ title, reviewsCount, rating, website }, audit, trade);

      let leadKey = null;
      let seqStatus = 'skip';
      if (!dryRun) {
        try {
          const saved = await api('POST', '/autonomous/leads', {
            title, phone, website, email, city, state,
            reviewsCount, totalScore: rating,
            source: 'telegram_autopilot', categoryName: trade,
          });
          leadKey = saved.key || null;
          if (leadKey) {
            await api('POST', `/autonomous/leads/${encodeURIComponent(leadKey)}/sequence`, { templateId: 'audit_local_14' });
            seqStatus = '✅';
          }
        } catch (e) { seqStatus = '⚠️'; }
      } else {
        seqStatus = 'dry';
      }

      allResults.push({ trade, title, phone, email, score: audit.totalScore, grade: audit.grade, leadKey, seq: seqStatus, draft });
      console.log(`   ✅ ${title} | ${audit.totalScore}/100 (${audit.grade}) | ${seqStatus}`);
      await sleep(300);
    }
  }

  // Save + output
  const out = { date: today, trades: activeTrades, city, state, dryRun, total: allResults.length, leads: allResults };
  if (!dryRun) {
    const dir = '/opt/data/adhelloleadsos/outreach';
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `tg-${today}-${city}-alltrades.json`), JSON.stringify(out, null, 2));
  }

  console.log(`\n📊 ${allResults.length} total leads across ${activeTrades.length} trades ${dryRun ? '(DRY RUN)' : 'saved+sequenced'}`);
  console.log(sep);
  allResults.slice(0, 10).forEach((r, i) => {
    console.log(`\n${i + 1}. [${r.trade}] ${r.title} | ${r.score}/100 (${r.grade})`);
    console.log(`   📧 ${r.draft.subject}`);
  });
  console.log(`\n---JSON---`);
  console.log(JSON.stringify({ trades: activeTrades, city, state, total: allResults.length, dryRun }));
}

run().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
