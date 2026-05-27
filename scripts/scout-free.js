#!/usr/bin/env node
/**
 * Scout v2 — Business lead finder without website
 * Uses DuckDuckGo + Google search + direct site scraping with better bypass
 */

const https = require('https');
const http = require('http');

const API_BASE = process.env.LEADS_API || 'https://adhelloleadsos.onrender.com';
const API_KEY = process.env.API_INGEST_KEY || 'a83843d84df7cf9457d6b674847c8938';

const dargs = process.argv.slice(2);
const dget = (f) => { const i = dargs.indexOf(f); return i >= 0 ? dargs[i + 1] : null; };
const city = dget('--city') || 'Portland';
const state = dget('--state') || 'OR';
const keyword = dget('--keyword') || 'hvac';
const maxResults = parseInt(dget('--max') || '20', 10);

function fetchOpts(url, extra = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        ...extra,
      },
      timeout: 20000,
    }, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location;
        const nextUrl = loc.startsWith('http') ? loc : new URL(loc, url).href;
        return fetchOpts(nextUrl, extra).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ html: data, status: res.statusCode, url: url }));
    });
    req.on('error', reject);
    req.end();
  });
}

function postLead(path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const url = new URL(path, API_BASE);
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'x-api-key': API_KEY },
    }, (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

// ── Source 1: DuckDuckGo ────────────────────────────────────────────────────
async function searchDDG(keyword, city, state, max) {
  const q = encodeURIComponent(`site:bbb.org OR site:yelp.com ${keyword} ${city} ${state} phone number`);
  console.log(`  🦆 DuckDuckGo: "${keyword}" ${city}, ${state}...`);
  
  try {
    const { html } = await fetchOpts(`https://html.duckduckgo.com/html/?q=${q}&kl=us-en`);
    const results = [];
    
    // DuckDuckGo HTML results - extract actual business listings
    const resultBlocks = html.matchAll(/<div class="result[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g);
    for (const block of resultBlocks) {
      if (results.length >= max) break;
      
      const raw = block[0];
      const text = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      
      // Skip BBB/Yelp/Whitepages category pages — we want actual business names
      if (text.includes('Better Business Bureau') || text.includes('Category:') || 
          text.includes('Near Me |') || text.includes('Whitepages') ||
          text.includes('THE BEST 10') || text.includes('Yelp')) continue;
      
      // Extract business name from result title
      const titleM = raw.match(/<a[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>/);
      const title = titleM ? titleM[1].replace(/<[^>]+>/g, '').trim() : '';
      
      // Extract URL
      const urlM = raw.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"/);
      const siteUrl = urlM ? urlM[1] : '';
      
      // Extract phone from snippet
      const phoneM = text.match(/(\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4})/);
      
      // Only include if it looks like a real business (has phone or local domain)
      const isLocal = siteUrl.includes(city.toLowerCase()) || siteUrl.includes('.com') || siteUrl.includes('.net');
      const hasPhone = !!phoneM;
      
      if (title && title.length > 2 && title.length < 80 && (hasPhone || isLocal) && !title.includes('Search')) {
        results.push({
          title,
          phone: hasPhone ? phoneM[1] : '',
          website: siteUrl.startsWith('http') ? siteUrl : '',
          city, state, rating: 0, reviewsCount: 0, address: '',
          source: 'ddg',
        });
      }
    }

    console.log(`  ✅ DDG: ${results.length} results`);
    return results.slice(0, max);
  } catch (e) {
    console.log(`  ❌ DDG: ${e.message}`);
    return [];
  }
}

// ── Source 2: Google search (lite) ───────────────────────────────────────────
async function searchGoogle(keyword, city, state, max) {
  const q = encodeURIComponent(`"${keyword}" "${city}" "${state}" "phone" -site:facebook.com -site:linkedin.com`);
  console.log(`  🔵 Google: "${keyword}" ${city}, ${state}...`);
  
  try {
    const { html } = await fetchOpts(`https://www.google.com/search?q=${q}&num=${Math.min(max, 30)}&hl=en`);
    const results = [];

    // Extract from Google's result snippets
    const snippetBlocks = html.matchAll(/<div[^>]*class="[^"]*tF2Cxc[^"]*"[^>]*>([\s\S]*?)<\/div>/g);
    for (const block of snippetBlocks) {
      if (results.length >= max) break;
      
      const titleM = block[0].match(/<h3[^>]*>([^<]+)<\/h3>/);
      const title = titleM ? titleM[1].trim() : '';
      const linkM = block[0].match(/<a[^>]*href="([^"]+)"/);
      const link = linkM ? linkM[1] : '';
      const text = block[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      const phoneM = text.match(/(\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4})/);
      
      if (title && title.length > 2) {
        results.push({
          title, phone: phoneM ? phoneM[1] : '',
          website: link.startsWith('/url?') ? '' : link,
          city, state, rating: 0, reviewsCount: 0, address: '',
          source: 'google',
        });
      }
    }

    console.log(`  ✅ Google: ${results.length} results`);
    return results.slice(0, max);
  } catch (e) {
    console.log(`  ❌ Google: ${e.message}`);
    return [];
  }
}

// ── Source 3: YellowPages ────────────────────────────────────────────────────
async function searchYP(keyword, city, state, max) {
  const q = encodeURIComponent(keyword);
  const loc = encodeURIComponent(`${city}, ${state}`);
  console.log(`  📒 YellowPages: "${keyword}" ${city}, ${state}...`);
  
  try {
    const { html } = await fetchOpts(`https://www.yellowpages.com/search?search_terms=${q}&geo_location_terms=${loc}`);
    const results = [];

    // YP result cards
    const cards = html.matchAll(/<div[^>]*class="[^"]*result[^"]*"[^>]*data-business-name="([^"]+)"[^>]*>/g);
    for (const card of cards) {
      if (results.length >= max) break;
      const name = decodeURIComponent(card[1].replace(/\+/g, ' '));
      results.push({ title: name, phone: '', website: '', city, state, rating: 0, reviewsCount: 0, address: '', source: 'yp' });
    }

    // Also try JSON-LD
    const jsonLd = html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g);
    for (const m of jsonLd) {
      try {
        const j = JSON.parse(m[1]);
        const items = Array.isArray(j) ? j : [j];
        for (const item of items) {
          if ((item['@type'] === 'LocalBusiness' || item['@type'] === 'Business') && !items.find(r => r.title === item.name)) {
            results.push({
              title: item.name || '', phone: item.telephone || '',
              address: typeof item.address === 'object' ? [item.address.streetAddress, item.address.addressLocality].filter(Boolean).join(', ') : (item.address || ''),
              city: city, state: state, rating: 0, reviewsCount: 0,
              website: item.url || '', source: 'yp_json',
            });
          }
        }
      } catch {}
    }

    console.log(`  ✅ YP: ${results.length} results`);
    return results.slice(0, max);
  } catch (e) {
    console.log(`  ❌ YP: ${e.message}`);
    return [];
  }
}

// ── Deduplicate ──────────────────────────────────────────────────────────────
function dedupe(list) {
  const seen = new Set();
  return list.filter(b => {
    const k = `${(b.title || '').toLowerCase().trim()}|${b.phone || ''}`;
    if (seen.has(k) || !b.title) return false;
    seen.add(k);
    return true;
  });
}

// ── Save lead ────────────────────────────────────────────────────────────────
async function saveLead(biz, keyword, city, state) {
  return postLead('/api/scout/ingest', {
    title: biz.title,
    phone: biz.phone || '',
    website: biz.website || '',
    email: '',
    city: biz.city || city,
    state: biz.state || state,
    source: `scout_${biz.source}`,
    pipelineStage: 0,
    industry: keyword,
    message: `Scouted: ${keyword} in ${city}, ${state} via ${biz.source}`,
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🔍 Scout v2: "${keyword}" in ${city}, ${state} (max ${maxResults})\n`);

  const [ddg, google, yp] = await Promise.all([
    searchDDG(keyword, city, state, maxResults).catch(() => []),
    searchGoogle(keyword, city, state, maxResults).catch(() => []),
    searchYP(keyword, city, state, maxResults).catch(() => []),
  ]);

  const all = dedupe([...ddg, ...google, ...yp]);
  console.log(`\n📊 Total unique: ${all.length}`);

  if (all.length === 0) {
    console.log('\n⚠️  No results from any source. Bot protection may be blocking.');
    console.log('   Consider: add RapidAPI key for reliable Google Maps results.');
    process.exit(0);
  }

  // Save all as leads (they're from search, so they likely have websites — we filter after enrichment)
  let saved = 0;
  for (const biz of all) {
    try {
      const r = await saveLead(biz, keyword, city, state);
      if (r && (r.success || r.key)) {
        saved++;
        const ch = r.next_channel || '?';
        console.log(`  ✅ ${biz.title} → next: ${ch}`);
      } else {
        console.log(`  ⚠️  ${biz.title} → ${JSON.stringify(r).slice(0, 60)}`);
      }
    } catch (e) {
      console.log(`  ❌ ${biz.title} → ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\n🏁 Saved ${saved}/${all.length} new leads`);
  console.log(`   Leads: ${API_BASE}/leads?stage=new`);
  console.log(`   Dashboard: ${API_BASE}/leads/omnichannel\n`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
