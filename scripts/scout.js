#!/usr/bin/env node
/**
 * Scout: Find businesses without websites and push into AdHello Leads OS
 * 
 * Usage:
 *   node scout.js --city "Portland" --state "OR" --keyword "hvac" --max 20
 *   node scout.js --city "Spokane" --state "WA" --keyword "plumbing" --max 50
 * 
 * Requires: API_INGEST_KEY env var (same as Leads OS)
 */

const https = require('https');
const http = require('http');

const API_BASE = process.env.LEADS_API || 'https://adhelloleadsos.onrender.com';
const API_KEY = process.env.API_INGEST_KEY || 'a83843d84df7cf9457d6b674847c8938';

// Parse args
const args = process.argv.slice(2);
const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const city = get('--city') || 'Portland';
const state = get('--state') || 'OR';
const keyword = get('--keyword') || 'hvac';
const maxResults = parseInt(get('--max') || '20', 10);

function post(path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const url = new URL(path, API_BASE);
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-api-key': API_KEY,
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'x-api-key': API_KEY } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    }).on('error', reject);
  });
}

async function run() {
  console.log(`\n🔍 Scouting "${keyword}" in ${city}, ${state} (max ${maxResults})...\n`);

  // Step 1: Trigger autonomous search
  const searchResult = await post('/autonomous/search', {
    keyword,
    city,
    state,
    maxResults,
    workspaceId: 'default',
  });

  if (!searchResult.success) {
    console.error('Search failed:', searchResult.error);
    process.exit(1);
  }

  const { searchId } = searchResult;
  console.log(`✅ Search started: ${searchId}`);
  console.log('⏳ Waiting for results...');

  // Poll for results
  let results = [];
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const status = await fetchJSON(`${API_BASE}/autonomous/search/${encodeURIComponent(searchId)}`);
    if (status && status.status === 'complete') {
      results = status.results || [];
      console.log(`✅ Found ${results.length} businesses`);
      break;
    }
    if (i % 5 === 4) console.log(`  Still waiting... (${(i + 1) * 2}s)`);
  }

  if (results.length === 0) {
    console.log('❌ No results found');
    process.exit(1);
  }

  // Filter: only businesses WITHOUT websites
  const noWebsite = results.filter(r => {
    const site = (r.website || r.Website || r.url || '').trim();
    return !site || site === 'N/A' || site === '';
  });

  console.log(`📬 ${noWebsite.length}/${results.length} have no website\n`);

  // Save each as a lead
  let saved = 0;
  for (const biz of noWebsite) {
    const title = biz.title || biz.name || biz.Title || `${keyword} business`;
    const phone = biz.phone || biz.phoneNumber || biz.Phone || '';
    const addr = biz.address || biz.Address || biz.full_address || '';
    const reviewCount = parseInt(biz.reviewsCount || biz.review_count || biz.Reviews || 0, 10);
    const rating = parseFloat(biz.totalScore || biz.rating || biz.Rating || 0);
    const facebook = biz.facebook || biz.facebook_url || '';
    const instagram = biz.instagram || biz.instagram_url || '';

    const leadData = {
      title,
      phone,
      website: '',
      email: '',
      city,
      state,
      address: addr,
      reviewsCount: reviewCount,
      totalScore: rating,
      facebook,
      instagram,
      source: 'scout_no_website',
      pipelineStage: 'new',
      categoryName: keyword,
    };

    const result = await post('/leads/save', leadData);
    if (result && (result.success || result.key)) {
      saved++;
      console.log(`  ✅ Saved: ${title} (key: ${result.key || 'ok'})`);
    } else {
      console.log(`  ❌ Failed: ${title} (${JSON.stringify(result)})`);
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n🏁 Done! Saved ${saved}/${noWebsite.length} leads with no website`);
  console.log(`   View at: ${API_BASE}/leads?stage=new&source=scout_no_website`);
}

run().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
