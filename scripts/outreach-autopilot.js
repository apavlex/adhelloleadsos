#!/usr/bin/env node
/**
 * AdHello Outreach Autopilot
 * 
 * Daily pipeline: Scout → Save Lead → GBP Audit Score → Outreach Draft
 * 
 * Usage:
 *   node outreach-autopilot.js --city "Portland" --state "OR" --keyword "hvac" --max 5
 * 
 * Requires: API_INGEST_KEY env var
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const API_BASE = process.env.LEADS_API || 'https://adhelloleadsos.onrender.com';
const API_KEY = process.env.API_INGEST_KEY || 'a83843d84df7cf9457d6b674847c8938';

const args = process.argv.slice(2);
const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const city = get('--city') || 'Portland';
const state = get('--state') || 'OR';
const keyword = get('--keyword') || 'hvac';
const maxResults = parseInt(get('--max') || '5', 10);

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function post(path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const url = new URL(path, API_BASE);
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: url.hostname, port: url.port, path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-api-key': API_KEY,
      },
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ _raw: d }); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function getJSON(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);
    const mod = url.protocol === 'https:' ? https : http;
    mod.get(url.toString(), { headers: { 'x-api-key': API_KEY } }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    }).on('error', reject);
  });
}

// ── Local GBP scoring (fallback when Maps API unavailable) ────────────────────

function localScoreGBP(business) {
  const s = {};
  const r = [];

  // Reviews (0-20)
  const rc = business.reviewsCount || 0;
  s.reviews = rc >= 100 ? 20 : rc >= 50 ? 16 : rc >= 20 ? 12 : rc >= 5 ? 8 : rc > 0 ? 4 : 0;
  if (rc < 20) r.push({ priority: 'HIGH', cat: 'Reviews', issue: `${rc} reviews`, action: 'Get 5+ new reviews/month' });

  // Rating (0-15)
  const rt = business.totalScore || business.rating || 0;
  s.rating = rt >= 4.5 ? 15 : rt >= 4.0 ? 10 : rt >= 3.5 ? 5 : rt > 0 ? 2 : 0;
  if (rt < 4.0 && rt > 0) r.push({ priority: 'HIGH', cat: 'Rating', issue: `${rt} stars`, action: 'Address negative reviews, ask happy customers to review' });

  // Website (0-10)
  const hasWeb = business.website && business.website !== 'N/A' && business.website !== '';
  s.website = hasWeb ? 10 : 0;
  if (!hasWeb) r.push({ priority: 'HIGH', cat: 'Website', issue: 'No website', action: 'Add website URL to GBP or create a simple landing page' });

  // Phone (0-5)
  s.phone = (business.phone && business.phone !== 'N/A' && business.phone !== '') ? 5 : 0;
  if (!s.phone) r.push({ priority: 'MEDIUM', cat: 'Phone', issue: 'No phone on GBP', action: 'Add direct phone number' });

  // Social (0-10)
  let social = 0;
  if (business.facebook && business.facebook !== 'N/A') social++;
  if (business.instagram && business.instagram !== 'N/A') social++;
  s.social = Math.min(10, social * 5);

  // Category (0-5)
  s.category = business.categoryName ? 5 : 0;

  // Email (0-5)
  s.email = (business.email && business.email !== 'N/A') ? 5 : 0;

  // Address (0-5)
  s.address = (business.address && business.city) ? 5 : 0;

  // Hours assumption (0-5)
  s.hours = business.hours ? 5 : 2;

  // Photos assumption (0-5)
  s.photos = business.photoCount > 10 ? 5 : business.photoCount > 0 ? 3 : 0;

  // Position placeholder (0-10)
  s.position = 5;

  const total = Object.values(s).reduce((a, b) => a + b, 0);
  return {
    totalScore: Math.min(100, total),
    maxScore: 100,
    grade: total >= 90 ? 'A' : total >= 75 ? 'B' : total >= 60 ? 'C' : total >= 40 ? 'D' : 'F',
    scores: s,
    recommendations: r,
    competitorCount: 0,
    source: 'local_fallback',
  };
}

// ── Outreach draft generator ──────────────────────────────────────────────────

function generateOutreach(business, audit) {
  const bizName = business.title || 'there';
  const gbpScore = audit?.totalScore || 0;
  const reviewCount = business.reviewsCount || 0;
  const hasWebsite = business.website && business.website !== 'N/A' && business.website !== '';
  
  let hook = '';
  let teaser = '';

  if (gbpScore < 40) {
    hook = `I ran a free Google Business Profile audit for ${bizName} — scored ${gbpScore}/100. A few specific issues are likely costing you calls.`;
    teaser = `Most of your competitors in ${city} are scoring higher. The good news: the fixes are quick.`;
  } else if (gbpScore < 60) {
    hook = `Quick note — I audited ${bizName}'s Google presence and found some low-hanging fruit that could drive more calls.`;
    teaser = `Your GBP score: ${gbpScore}/100. A handful of improvements could move you up the map pack.`;
  } else if (!hasWebsite) {
    hook = `I searched for ${bizName} online and couldn't find a website. Meanwhile, your competitors are showing up everywhere.`;
    teaser = `No website = an estimated 30-40% of potential customers going to competitors.`;
  } else if (reviewCount < 20) {
    hook = `${bizName} is doing decent on Google, but with only ${reviewCount} reviews, you're leaving visibility on the table.`;
    teaser = `Competitors in ${city} with 50+ reviews get 2-3x more calls from Google Maps.`;
  } else {
    hook = `I've been auditing ${keyword} businesses in ${city} — ${bizName} scored ${gbpScore}/100 on our GBP audit.`;
    teaser = `The audit shows exactly where you stand vs competitors and 3 quick fixes to get more calls.`;
  }

  const draft = {
    subject: `${bizName} — free Google audit (${city})`,
    body: `Hi ${bizName} team,

${hook}

${teaser}

I put together a detailed (free) Google Business Profile audit for ${bizName} that shows:
• Your current score vs local competitors
• Exactly what's hurting your Google Maps ranking
• 3 quick fixes you can do today (under 30 minutes)

No pitch. Just the audit.

Want me to send it over?

— Alex Pavlenko
AdHello | Helping ${keyword} businesses get found in ${city}
https://adhelloleadsos.onrender.com`,

    followUpDay3: `Hi ${bizName} team,

Following up — did you get a chance to look at the Google audit?

One ${keyword} company in ${city} went from 3 to 14 calls/week just by fixing their profile.

Happy to walk you through it if useful.

— Alex`,

    followUpDay7: `Hi ${bizName} team,

Last follow-up. If more calls from Google isn't a priority, no worries.

If it is, just reply "send" and I'll forward the audit.

— Alex`,
  };

  return draft;
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

async function run() {
  const today = new Date().toISOString().slice(0, 10);
  console.log(`\n🚀 AdHello Outreach Autopilot — ${today}`);
  console.log(`   Target: ${keyword} in ${city}, ${state} | Max: ${maxResults}`);
  console.log('='.repeat(60));

  // Step 1: Scout
  console.log('\n📡 Step 1: Scouting...');
  const searchResult = await post('/autonomous/search', {
    keyword, city, state, maxResults: maxResults * 2, workspaceId: 'default',
  });

  if (!searchResult.success) {
    console.error('❌ Search failed:', searchResult.error);
    process.exit(1);
  }

  const searchId = searchResult.searchId;
  let rawResults = [];
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const status = await getJSON(`/autonomous/search/${encodeURIComponent(searchId)}`);
    if (status && status.status === 'complete') {
      rawResults = (status.results || []).slice(0, maxResults);
      console.log(`   ✅ Found ${rawResults.length} businesses`);
      break;
    }
    if (i % 5 === 4) console.log(`   ⏳ Still waiting... (${(i + 1) * 2}s)`);
  }

  if (rawResults.length === 0) {
    console.log('❌ No results found');
    process.exit(1);
  }

  // Step 2: Save + Score + Draft
  console.log('\n📝 Step 2: Saving leads + scoring + drafting...');
  const outreachList = [];

  for (const biz of rawResults) {
    const title = biz.title || biz.name || `${keyword} business`;
    const phone = biz.phone || biz.phoneNumber || '';
    const reviewsCount = parseInt(biz.reviewsCount || biz.review_count || 0, 10);
    const rating = parseFloat(biz.totalScore || biz.rating || 0);
    const website = biz.website || biz.url || '';
    const facebook = biz.facebook || '';
    const instagram = biz.instagram || '';

    // Save as lead
    let leadKey = 'unknown';
    try {
      const res = await post('/leads/save', {
        title, phone, website, email: biz.email || '', city, state,
        address: biz.address || '', reviewsCount, totalScore: rating,
        facebook, instagram, source: 'outreach_autopilot',
        pipelineStage: 'new', categoryName: keyword,
      });
      leadKey = res?.key || res?.leadKey || 'saved';
    } catch (e) {
      console.log(`   ⚠️ Save failed: ${e.message}`);
    }

    // Try API audit first, fall back to local scoring
    let audit = null;
    try {
      const apiAudit = await post('/api/audit/gbp', {
        businessName: title, city, state, category: keyword,
      });
      if (apiAudit.success && apiAudit.audit) {
        audit = apiAudit.audit;
      }
    } catch (e) { /* API audit not available, use fallback */ }

    if (!audit) {
      audit = localScoreGBP({ title, reviewsCount, rating, website, phone, facebook, instagram });
    }

    // Generate outreach
    const draft = generateOutreach({ title, reviewsCount, rating, website }, audit);

    outreachList.push({
      leadKey,
      business: { title, phone, website, reviewsCount, rating, city, state },
      auditScore: audit.totalScore || 'N/A',
      auditGrade: audit.grade || 'N/A',
      draft,
      source: audit.source || 'api',
    });

    console.log(`   ✅ ${title} | Score: ${audit.totalScore}/100 (${audit.grade}) | ${leadKey !== 'unknown' ? 'Saved' : 'Not saved'}`);
    await new Promise(r => setTimeout(r, 500));
  }

  // Save output
  const outDir = '/opt/data/adhelloleadsos/outreach';
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `outreach-${today}-${keyword}-${city}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ date: today, keyword, city, state, leads: outreachList }, null, 2));

  // Print summary
  console.log(`\n📊 Outreach Summary — ${outreachList.length} leads`);
  console.log('='.repeat(60));
  outreachList.forEach((item, i) => {
    console.log(`\n${i + 1}. ${item.business.title}`);
    console.log(`   Grade: ${item.auditGrade} (${item.auditScore}/100) | Reviews: ${item.business.reviewsCount} | Source: ${item.source}`);
    console.log(`   Subject: ${item.draft.subject}`);
  });

  console.log(`\n\n✅ Saved to: ${outFile}`);
  console.log(`\n📤 Next: Review drafts, send emails, check follow-ups in 3 days`);
}

run().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
