#!/usr/bin/env node
/**
 * Refresh services/permitStackCities.js from permit-stack.com (search + coverage pages).
 * Usage: node scripts/syncPermitStackCities.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let d = '';
        res.on('data', (c) => {
          d += c;
        });
        res.on('end', () => resolve(d));
      })
      .on('error', reject);
  });
}

function inferState(city) {
  const suffix = city.match(/\s([A-Z]{2})$/);
  if (suffix) return suffix[1];
  const glued = city.match(/([A-Z]{2})$/);
  if (glued && city.length > 4 && /[a-z][A-Z]{2}$/.test(city)) return glued[1];
  return '';
}

async function main() {
  const [coverageHtml, searchHtml] = await Promise.all([
    get('https://permit-stack.com/coverage.html'),
    get('https://permit-stack.com/search.html'),
  ]);

  const stateByCity = new Map();
  for (const m of coverageHtml.matchAll(/<td><strong>([^<]+)<\/strong><\/td><td>([A-Z]{2})<\/td>/g)) {
    stateByCity.set(m[1].trim(), m[2]);
  }

  const opts = [...searchHtml.matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)]
    .map((m) => ({ city: m[1].trim(), label: m[2].trim() }))
    .filter((o) => o.city);

  const cities = opts.map((o) => ({
    city: o.city,
    label: o.label,
    state: stateByCity.get(o.city) || stateByCity.get(o.label) || inferState(o.city) || '',
  }));

  cities.sort((a, b) => {
    const sa = a.state || 'ZZ';
    const sb = b.state || 'ZZ';
    if (sa !== sb) return sa.localeCompare(sb);
    return a.label.localeCompare(b.label);
  });

  const outPath = path.join(__dirname, '..', 'services', 'permitStackCities.js');
  const body = `/** Supported Permit Stack search cities (synced from permit-stack.com/search.html). */
/** Run: node scripts/syncPermitStackCities.js */

const PERMIT_STACK_CITIES = ${JSON.stringify(cities, null, 2)};

function normalizePermitStackCity(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  return (
    PERMIT_STACK_CITIES.find(
      (c) => c.city.toLowerCase() === lower || c.label.toLowerCase() === lower
    ) || null
  );
}

function permitCitiesByState() {
  const groups = new Map();
  for (const row of PERMIT_STACK_CITIES) {
    const st = row.state || '—';
    if (!groups.has(st)) groups.set(st, []);
    groups.get(st).push(row);
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

module.exports = {
  PERMIT_STACK_CITIES,
  normalizePermitStackCity,
  permitCitiesByState,
};
`;

  fs.writeFileSync(outPath, body);
  console.log(`Wrote ${cities.length} cities to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
