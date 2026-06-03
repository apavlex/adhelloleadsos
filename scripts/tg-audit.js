#!/usr/bin/env node
/**
 * Trigger a full audit (GBP + PageSpeed) for a business via the AdHello API.
 * Usage: node scripts/tg-audit.js "Business Name" "City" "State" [category]
 * Output: JSON with reportUrl, gbpScore, gbpGrade, websiteScore
 */

const API_BASE = process.env.ADHELLO_API_BASE || 'https://adhelloleadsos.onrender.com';
const API_KEY = process.env.API_INGEST_KEY || process.env.ADHELLO_API_KEY || '';

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.error('Usage: node tg-audit.js "Business Name" "City" "State" [category]');
    process.exit(1);
  }

  const [businessName, city, state, category] = args;

  if (!API_KEY) {
    console.error('Set API_INGEST_KEY or ADHELLO_API_KEY env var.');
    process.exit(1);
  }

  console.error(`Running audit for "${businessName}" in ${city}, ${state}...`);

  const res = await fetch(`${API_BASE}/autonomous/audit/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
    },
    body: JSON.stringify({ businessName, city, state, category: category || undefined }),
  });

  const data = await res.json();

  if (!data.success) {
    console.error(`Audit failed: ${data.error}`);
    process.exit(1);
  }

  console.log(JSON.stringify({
    reportUrl: data.reportUrl,
    business: data.business,
    gbpScore: data.gbpScore,
    gbpGrade: data.gbpGrade,
    websiteScore: data.websiteScore,
    topRecommendations: data.recommendations,
  }, null, 2));
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
