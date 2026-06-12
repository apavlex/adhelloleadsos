#!/usr/bin/env node
/**
 * AdHello Outreach Autopilot — Manual Scrape Fallback
 * Runs the save → score → draft pipeline using browser-scraped leads
 * when Maps API providers are down.
 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const API_BASE = process.env.LEADS_API || 'https://adhelloleadsos.onrender.com';
const API_KEY = 'a83843d84df7cf9457d6b674847c8938';

// ── HTTP helpers ──
function post(p, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const url = new URL(p, API_BASE);
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
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ _raw: d, _status: res.statusCode }); } });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

// ── Local GBP scoring (replicated from outreach-autopilot.js) ──
function localScoreGBP(biz) {
  const s = {};
  const r = [];
  const rc = biz.reviewsCount || 0;
  s.reviews = rc >= 100 ? 20 : rc >= 50 ? 16 : rc >= 20 ? 12 : rc >= 5 ? 8 : rc > 0 ? 4 : 0;
  if (rc < 20) r.push({ priority: 'HIGH', cat: 'Reviews', issue: `${rc} reviews`, action: 'Get 5+ new reviews/month' });
  else if (rc < 50) r.push({ priority: 'MEDIUM', cat: 'Reviews', issue: `Only ${rc} reviews`, action: `Competitors average 80-120. Launch a review-generation campaign.` });

  const rt = biz.totalScore || biz.rating || 0;
  s.rating = rt >= 4.5 ? 15 : rt >= 4.0 ? 10 : rt >= 3.5 ? 5 : rt > 0 ? 2 : 0;
  if (rt < 4.0 && rt > 0) r.push({ priority: 'HIGH', cat: 'Rating', issue: `${rt} stars`, action: 'Address negative reviews, ask happy customers to review' });
  else if (rt >= 4.0 && rt < 4.5) r.push({ priority: 'MEDIUM', cat: 'Rating', issue: `${rt} stars — good but improvable`, action: 'Push for 4.5+ with a review response strategy' });

  s.website = biz.website ? 10 : 0;
  if (!biz.website) r.push({ priority: 'HIGH', cat: 'Website', issue: 'No website', action: 'Build a website' });

  s.phone = biz.phone ? 5 : 0;
  s.address = (biz.address && biz.address.length > 10) ? 5 : 0;
  s.email = biz.email ? 5 : 0;

  s.social = 0;
  if (biz.facebook) s.social = Math.min(s.social + 3, 10);
  if (biz.instagram) s.social = Math.min(s.social + 3, 10);
  if (s.social === 0) r.push({ priority: 'LOW', cat: 'Social', issue: 'No social links on GBP', action: 'Add Facebook/Instagram to Google profile' });

  s.mapsPresence = 5;
  s.category = 5;

  // Always add at least one recommendation
  if (r.length === 0) {
    r.push({ priority: 'LOW', cat: 'Photos', issue: 'GBP photos may be limited', action: 'Upload fresh project photos weekly to boost engagement' });
  }

  const totalScore = Object.values(s).reduce((a, b) => a + b, 0);
  const grade = totalScore >= 90 ? 'A' : totalScore >= 75 ? 'B' : totalScore >= 60 ? 'C' : totalScore >= 40 ? 'D' : 'F';

  return {
    totalScore,
    grade,
    dimensions: s,
    recommendations: r,
    source: 'local_scraper_fallback',
  };
}

// ── Outreach generator (replicated from outreach-autopilot.js) ──
function generateOutreach(business, audit) {
  const bizName = business.title || 'there';
  const city = business.city || '';
  const keyword = business.keyword || '';
  const website = business.website || '';
  const reviewsCount = business.reviewsCount || 0;
  const rating = business.rating || 0;

  // Find the hook based on audit findings
  let teaser = `I noticed your Google Business Profile could be performing better for "${keyword}" searches in ${city}.`;
  if (audit.recommendations && audit.recommendations.length > 0) {
    const top = audit.recommendations[0];
    if (top.cat === 'Reviews' && reviewsCount < 20) {
      teaser = `With only ${reviewsCount} reviews on Google, you're leaving calls on the table — competitors with 50+ reviews get 3x more inquiries.`;
    } else if (top.cat === 'Website' && !website) {
      teaser = `I noticed you don't have a website listed on your Google profile — that's costing you about 40% of potential calls.`;
    } else if (top.cat === 'Rating' && rating < 4.0) {
      teaser = `Your ${rating}-star rating is below the ${city} average for ${keyword} — that's turning potential customers away.`;
    }
  }

  const subject = `Quick question about your ${bizName} Google listing`;
  
  return {
    subject,
    body: `Hi there,

My name is Alex — I run AdHello, a digital marketing agency.

${teaser}

Here's what I found:
${audit.recommendations.slice(0, 3).map(r => `• ${r.issue} — ${r.action}`).join('\n')}

Businesses with fully optimized Google listings get 2.7x more calls.

I'd like to send you a free 1-page audit — no strings attached.

Want me to send it over?

Best,
Alex Pavlenko
AdHello — adhello.ai`,
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
}

// ── Scraped leads (from browser-based Google Maps scraping) ──
const portlandHVAC = [
  { title: 'Bull Mountain Heating & Cooling', phone: '(503) 612-6677', website: 'https://bullmountainheating.com', reviewsCount: 85, rating: 4.9, address: '17300 SW Upper Boones Ferry Rd, Portland, OR', city: 'Portland', state: 'OR', keyword: 'hvac' },
  { title: 'AAA Heating & Cooling', phone: '(503) 284-2173', website: 'https://aaaheatingandcoolinginc.com', reviewsCount: 120, rating: 4.9, address: '6040 N Cutter Cir #303, Portland, OR', city: 'Portland', state: 'OR', keyword: 'hvac' },
  { title: 'Pyramid Heating & Cooling', phone: '(503) 783-8488', website: 'https://www.pyramidheating.com', reviewsCount: 200, rating: 4.8, address: '9409 NE Colfax St, Portland, OR', city: 'Portland', state: 'OR', keyword: 'hvac' },
  { title: 'Sunset Heating & Cooling', phone: '(503) 500-5855', website: 'https://www.sunsethc.com', reviewsCount: 150, rating: 4.8, address: '607 S Idaho St #100, Portland, OR', city: 'Portland', state: 'OR', keyword: 'hvac' },
  { title: 'Jacobs Heating & Air Conditioning, Inc.', phone: '(503) 234-7331', website: 'https://jacobsheating.com', reviewsCount: 45, rating: 4.3, address: '4474 SE Milwaukie Ave, Portland, OR', city: 'Portland', state: 'OR', keyword: 'hvac' },
];

const seattlePlumbing = [
  { title: 'Gene Johnson Plumbing', phone: '(360) 218-7611', website: 'https://www.genejohnsonplumbing.com', reviewsCount: 95, rating: 4.8, address: '10011 Greenwood Ave N, Seattle, WA', city: 'Seattle', state: 'WA', keyword: 'plumbing' },
  { title: 'Beacon Plumbing, Heating, Electrical & Mechanical Inc', phone: '(206) 365-0376', website: 'https://www.beaconplumbing.net', reviewsCount: 60, rating: 4.5, address: '515 7th Ave S, Seattle, WA', city: 'Seattle', state: 'WA', keyword: 'plumbing' },
  { title: 'Best Plumbing', phone: '(206) 633-1700', website: 'https://bestplumbing.com', reviewsCount: 180, rating: 4.6, address: '8820 Aurora Ave N, Seattle, WA', city: 'Seattle', state: 'WA', keyword: 'plumbing' },
  { title: '2 Sons Plumbing, Sewer, Septic, Electric, Heating & Air', phone: '(206) 337-4070', website: 'https://www.2sonsplumbing.com', reviewsCount: 250, rating: 4.9, address: '2208 NW Market St #316a, Seattle, WA', city: 'Seattle', state: 'WA', keyword: 'plumbing' },
  { title: 'Craftsman Plumbing', phone: '(206) 737-2266', website: 'https://craftsman-plumbing.com', reviewsCount: 40, rating: 4.8, address: '4778 Shilshole Ave NW, Seattle, WA', city: 'Seattle', state: 'WA', keyword: 'plumbing' },
];

// ── Process a batch ──
async function processBatch(leads, label) {
  const today = new Date().toISOString().slice(0, 10);
  const first = leads[0];
  const keyword = first.keyword;
  const city = first.city;
  const outDir = '/opt/data/adhelloleadsos/outreach';
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`\n📡 Processing ${label}: ${keyword} in ${city}`);
  console.log('='.repeat(60));

  const outreachList = [];

  for (const biz of leads) {
    const phone = biz.phone || '';
    const website = biz.website || '';

    // Save as lead
    let leadKey = 'unknown';
    try {
      const res = await post('/leads/save', {
        title: biz.title, phone, website, email: biz.email || '',
        city: biz.city, state: biz.state, address: biz.address || '',
        reviewsCount: biz.reviewsCount, totalScore: biz.rating,
        facebook: biz.facebook || '', instagram: biz.instagram || '',
        source: 'outreach_autopilot_fallback',
        pipelineStage: 'new', categoryName: keyword,
      });
      leadKey = res?.key || res?.leadKey || 'saved';
    } catch (e) {
      console.log(`   ⚠️ Save failed for ${biz.title}: ${e.message}`);
    }

    // Score locally
    const audit = localScoreGBP(biz);
    // Generate outreach
    const draft = generateOutreach({ ...biz }, audit);

    outreachList.push({
      leadKey,
      business: { title: biz.title, phone, website, reviewsCount: biz.reviewsCount, rating: biz.rating, city: biz.city, state: biz.state },
      auditScore: audit.totalScore,
      auditGrade: audit.grade,
      draft,
      recommendations: audit.recommendations,
      source: audit.source || 'local_scraper_fallback',
    });

    console.log(`   ✅ ${biz.title} | Score: ${audit.totalScore}/100 (${audit.grade}) | Reviews: ${biz.reviewsCount} | ${leadKey !== 'unknown' ? '✓ Saved' : '✗ Not saved'}`);
    await new Promise(r => setTimeout(r, 500));
  }

  // Save output JSON
  const outFile = path.join(outDir, `outreach-${today}-${keyword}-${city}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ date: today, keyword, city, state: first.state, leads: outreachList }, null, 2));
  console.log(`\n📁 Saved to: ${outFile}`);
  return outreachList;
}

// ── Main ──
async function main() {
  console.log('🚀 AdHello Outreach Autopilot — Fallback Mode (Browser-Scraped Leads)');
  console.log(`   Date: ${new Date().toISOString().slice(0, 10)}`);
  console.log('   Maps API: OFFLINE (RapidAPI params missing + Apify invoices unpaid)');
  console.log('   Source: Google Maps browser scraping');

  const pdx = await processBatch(portlandHVAC, 'Portland HVAC');
  const sea = await processBatch(seattlePlumbing, 'Seattle Plumbing');

  const all = [...pdx, ...sea];
  console.log(`\n\n📊 FINAL SUMMARY — ${all.length} total leads`);
  console.log('='.repeat(60));

  // Sort by score (lowest = biggest opportunity)
  const sorted = [...all].sort((a, b) => a.auditScore - b.auditScore);
  
  console.log('\n🏆 Top 3 by Opportunity (lowest scores):');
  sorted.slice(0, 3).forEach((item, i) => {
    console.log(`  ${i + 1}. ${item.business.title} (${item.business.city}) — Score: ${item.auditScore}/100 (${item.auditGrade})`);
    console.log(`     Reviews: ${item.business.reviewsCount} | Rating: ${item.business.rating}`);
    console.log(`     Subject: ${item.draft.subject}`);
    if (item.recommendations && item.recommendations.length > 0) {
      item.recommendations.forEach(r => console.log(`     • ${r.cat}: ${r.issue}`));
    }
  });

  console.log('\n📧 All Subject Lines:');
  all.forEach((item, i) => {
    console.log(`  ${i + 1}. [${item.business.city}] ${item.business.title}: "${item.draft.subject}" (${item.auditGrade})`);
  });

  // Write combined summary for cron delivery
  const summaryDir = '/opt/data/adhelloleadsos/outreach';
  const summaryFile = path.join(summaryDir, `outreach-summary-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(summaryFile, JSON.stringify({
    date: new Date().toISOString().slice(0, 10),
    totalLeads: all.length,
    byCity: {
      Portland: { keyword: 'hvac', count: pdx.length, leads: pdx },
      Seattle: { keyword: 'plumbing', count: sea.length, leads: sea },
    },
    topOpportunities: sorted.slice(0, 3).map(item => ({
      business: item.business.title,
      city: item.business.city,
      score: item.auditScore,
      grade: item.auditGrade,
      subject: item.draft.subject,
      keyIssues: (item.recommendations || []).map(r => `${r.cat}: ${r.issue}`),
    })),
    allSubjectLines: all.map(item => ({
      business: item.business.title,
      city: item.business.city,
      subject: item.draft.subject,
      grade: item.auditGrade,
    })),
  }, null, 2));
  console.log(`\n📁 Summary saved to: ${summaryFile}`);

  // Write to stdout for easy capture
  console.log('\n\n=== PIPELINE COMPLETE ===');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
