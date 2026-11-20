const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-registry-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const ejs = require('ejs');
const { JOB_TYPES, normalizeJobType } = require('../services/scrapeJobTypes');
const { computeDedupeKey } = require('../services/leadDedupe');
const dbService = require('../services/database');
const {
  CONTRACTOR_TRADES,
  cleanPhone,
  tagTradeWa,
  tagTradeOr,
  normalizeWa,
  normalizeOr,
  dedupeContractors,
  capByTrade,
  parseContractorSearchInput,
  recordToLead,
  collectContractorRecords,
} = require('../services/contractorRegistry');
const { persistContractorRecords } = require('../services/contractorLeadPersist');

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
    async json() {
      return body;
    },
  };
}

test('cleanPhone keeps 10-digit numbers and drops extensions', () => {
  assert.equal(cleanPhone('(360) 555-0101'), '3605550101');
  assert.equal(cleanPhone('1-503-555-0199'), '5035550199');
  assert.equal(cleanPhone('555'), null);
  assert.equal(cleanPhone(''), null);
});

test('WA license type beats specialty, and known non-trades are skipped', () => {
  assert.equal(
    tagTradeWa({ contractorlicensetypecodedesc: 'ELECTRICAL CONTRACTOR', specialtycode1desc: 'GENERAL' }),
    'electricians'
  );
  assert.equal(tagTradeWa({ specialtycode1desc: 'ROOFING' }), 'roofers');
  assert.equal(tagTradeWa({ specialtycode1desc: 'LANDSCAPING' }), 'handymen');
  assert.equal(tagTradeOr({ endorsement_text: 'HOME INSPECTOR SERVICES CONTRACTOR' }), null);
  assert.equal(tagTradeOr({ endorsement_text: 'RESIDENTIAL GENERAL CONTRACTOR' }), 'remodelers');
  assert.equal(tagTradeOr({ endorsement_text: 'ROOFING' }), 'roofers');
});

test('normalize drops unmapped rows and dedupes by phone, then name and city', () => {
  const wa = normalizeWa([
    {
      businessname: 'SPARK ELECTRIC',
      contractorlicensetypecodedesc: 'ELECTRICAL CONTRACTOR',
      city: 'VANCOUVER',
      zip: '98661-1234',
      phonenumber: '(360) 555-0101',
      contractorlicensenumber: 'SPARK123',
      primaryprincipalname: 'JANE DOE',
      licenseexpirationdate: '2027-01-01T00:00:00.000',
    },
    {
      businessname: 'SPARK ELECTRIC SOUTH',
      contractorlicensetypecodedesc: 'ELECTRICAL CONTRACTOR',
      city: 'CAMAS',
      zip: '98607',
      phonenumber: '3605550101',
      contractorlicensenumber: 'DUP',
    },
    {
      businessname: 'NO TRADE CO',
      specialtycode1desc: 'SOMETHING ELSE',
      city: 'KELSO',
      phonenumber: '3605550000',
    },
  ]);
  assert.equal(wa.length, 2);
  assert.equal(wa[0].city, 'Vancouver');
  assert.equal(wa[0].zip, '98661');
  assert.equal(wa[0].principal, 'Jane Doe');
  assert.equal(wa[0].license_expires, '2027-01-01');

  const ore = normalizeOr([
    {
      full_name: 'QUIET HANDY',
      endorsement_text: 'RESIDENTIAL LIMITED CONTRACTOR',
      city: 'PORTLAND',
      zip_code: '97214',
      rmi_name: 'sam lee',
    },
    {
      full_name: 'Quiet Handy',
      endorsement_text: 'RESIDENTIAL LIMITED CONTRACTOR',
      city: 'Portland',
      phone_number: '',
    },
    {
      full_name: 'SKIP INSPECTOR',
      endorsement_text: 'OREGON CERTIFIED HOME INSPECTOR',
      city: 'GRESHAM',
      phone_number: '5035552222',
    },
  ]);
  assert.equal(ore.length, 2);
  assert.equal(ore[0].trade, 'handymen');
  assert.equal(ore[0].principal, 'Sam Lee');

  const deduped = dedupeContractors([
    ...wa,
    { ...wa[0], license_number: 'OTHER', business_name: 'Other Spark' },
    ...ore,
  ]);
  assert.equal(deduped.length, 2);
});

test('capByTrade spreads a short list across trades', () => {
  const records = [
    { trade: 'electricians', business_name: 'A' },
    { trade: 'electricians', business_name: 'B' },
    { trade: 'roofers', business_name: 'C' },
    { trade: 'roofers', business_name: 'D' },
  ];
  const capped = capByTrade(records, 2).map((r) => r.business_name);
  assert.deepEqual(capped, ['A', 'C']);
});

test('parseContractorSearchInput defaults both registries and splits until a folder is chosen', () => {
  const all = parseContractorSearchInput({});
  assert.equal(all.ok, true);
  assert.deepEqual(all.params.registries, ['wa', 'or']);
  assert.equal(all.params.splitByTrade, true);
  assert.equal(all.params.maxResults, 400);
  assert.deepEqual(all.params.trades, []);

  const picked = parseContractorSearchInput({ folderKey: 'folder:1', contractorTrades: 'roofers', contractorFull: 'on' });
  assert.equal(picked.params.splitByTrade, false);
  assert.deepEqual(picked.params.trades, ['roofers']);
  assert.equal(picked.params.maxResults, 5000);

  const none = parseContractorSearchInput({ contractorTradesSubmitted: '1' });
  assert.equal(none.ok, false);
  assert.match(none.error, /trade/);

  const bad = parseContractorSearchInput({ trades: ['not-a-trade'] });
  assert.equal(bad.ok, false);
});

test('recordToLead keeps a phone-matched website and keys dedupe on the license', () => {
  const lead = recordToLead({
    source: 'WA_L&I',
    business_name: 'SPARK ELECTRIC',
    license_number: 'SPARK123',
    trade: 'electricians',
    city: 'Vancouver',
    state: 'WA',
    zip: '98661',
    phone: '3605550101',
    google_website: 'https://spark.example',
    google_place_id: 'abc',
    google_rating: 4.8,
    google_review_count: 12,
    google_match_confidence: 'phone',
  });
  assert.equal(lead.title, 'SPARK ELECTRIC');
  assert.equal(lead.phone, '(360) 555-0101');
  assert.equal(lead.website, 'https://spark.example');
  assert.equal(lead.categoryName, 'Electricians');
  assert.equal(lead.jobType, JOB_TYPES.CONTRACTORS);
  assert.equal(lead.contractorLicenseNumber, 'SPARK123');
  assert.equal(lead.contractorRegistry, 'WA_L&I');
  assert.equal(lead.city, 'Vancouver');
  assert.equal(computeDedupeKey(lead), 'contractor:wa:spark123');

  const nameOnly = recordToLead({
    business_name: 'MAYBE ROOFING',
    license_number: 'R1',
    trade: 'roofers',
    state: 'OR',
    source: 'OR_CCB',
    google_website: 'https://maybe.example',
    google_match_confidence: 'name_only',
  });
  assert.equal(nameOnly.website, undefined);
  assert.match(nameOnly.notes, /maybe\.example/);

  const withCoi = recordToLead({
    business_name: 'RAIN ROOFING',
    license_number: '999',
    trade: 'roofers',
    state: 'OR',
    source: 'OR_CCB',
    license_expires: '2027-05-14',
    insurance_expires: '2026-12-01',
    insurance_company: 'SCOTTSDALE INSURANCE CO',
  });
  assert.equal(withCoi.contractorLicenseExpires, '2027-05-14');
  assert.equal(withCoi.contractorCoiExpires, '2026-12-01');
  assert.match(withCoi.notes, /COI expires 2026-12-01/);
});

test('normalizeOr maps CCB lic_exp_date and COI ins_exp_date', () => {
  const rows = normalizeOr([
    {
      full_name: 'RAIN ROOFING',
      endorsement_text: 'ROOFING',
      city: 'PORTLAND',
      zip_code: '97201',
      phone_number: '5035550199',
      license_number: '999',
      lic_exp_date: '05/14/2027',
      ins_exp_date: '12/01/2026',
      ins_amount: '1000000',
      ins_company: 'SCOTTSDALE INSURANCE CO',
    },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].license_expires, '2027-05-14');
  assert.equal(rows[0].insurance_expires, '2026-12-01');
});

test('collectContractorRecords pages both registries, skips non-trades, and enriches a phone match', async () => {
  const waRow = {
    businessname: 'SPARK ELECTRIC',
    contractorlicensetypecodedesc: 'ELECTRICAL CONTRACTOR',
    city: 'VANCOUVER',
    zip: '98661',
    phonenumber: '3605550101',
    contractorlicensenumber: 'SPARK123',
    primaryprincipalname: 'JANE DOE',
    licenseexpirationdate: '2027-06-01',
  };
  const orSkip = {
    full_name: 'SKIP INSPECTOR',
    endorsement_text: 'HOME INSPECTOR SERVICES CONTRACTOR',
    city: 'PORTLAND',
    zip_code: '97201',
    phone_number: '5035550000',
    license_number: '0',
  };
  const orKeep = {
    full_name: 'RAIN ROOFING',
    endorsement_text: 'ROOFING',
    city: 'PORTLAND',
    zip_code: '97201',
    phone_number: '5035550199',
    license_number: '999',
    rmi_name: 'SAM LEE',
  };

  const fetched = [];
  async function fetchImpl(url) {
    const href = String(url);
    fetched.push(href);
    if (href.includes('data.wa.gov')) return jsonResponse([waRow]);
    if (href.includes('data.oregon.gov')) return jsonResponse([orSkip, orKeep]);
    if (href.includes('textsearch')) {
      return jsonResponse({
        status: 'OK',
        results: [{ place_id: 'place-1', rating: 4.5, user_ratings_total: 8, types: ['electrician'] }],
      });
    }
    if (href.includes('place/details')) {
      return jsonResponse({
        status: 'OK',
        result: { formatted_phone_number: '(360) 555-0101', website: 'https://spark.example' },
      });
    }
    throw new Error(`unexpected url ${href}`);
  }

  const parsed = parseContractorSearchInput({
    contractorRegistries: ['wa', 'or'],
    contractorTrades: ['electricians', 'roofers'],
    contractorMaxResults: 10,
    contractorPlaces: 'on',
  });
  const collected = await collectContractorRecords(parsed.params, {
    fetchImpl,
    placesKey: 'test-key',
  });
  assert.equal(collected.records.length, 2);
  assert.equal(collected.summary.withPhone, 2);
  assert.equal(collected.summary.placesMatched, 2);
  const spark = collected.records.find((r) => r.license_number === 'SPARK123');
  assert.equal(spark.google_match_confidence, 'phone');
  assert.equal(spark.google_website, 'https://spark.example');
  const rain = collected.records.find((r) => r.license_number === '999');
  assert.equal(rain.google_match_confidence, 'name_only');
  assert.ok(fetched.some((u) => u.includes('986%')));
  assert.ok(fetched.some((u) => u.includes('Multnomah')));
});

test('a registry failure is kept when the other registry returns contractors', async () => {
  async function fetchImpl(url) {
    const href = String(url);
    if (href.includes('data.wa.gov')) {
      return jsonResponse({ message: 'nope' }, 503);
    }
    return jsonResponse([
      {
        full_name: 'RAIN ROOFING',
        endorsement_text: 'ROOFING',
        city: 'PORTLAND',
        zip_code: '97201',
        phone_number: '5035550199',
        license_number: '999',
      },
    ]);
  }
  const parsed = parseContractorSearchInput({ registries: ['wa', 'or'], maxResults: 5 });
  const collected = await collectContractorRecords(parsed.params, { fetchImpl });
  assert.equal(collected.records.length, 1);
  assert.equal(collected.records[0].trade, 'roofers');
  assert.match(collected.errors[0], /WA L&I/);
});

test('persist files each trade into a trade folder and merges a repeat license', async () => {
  const wid = 'ws_contractors';
  await dbService.saveWorkspace(wid, { id: wid, name: 'HomeElk', members: {} });
  const records = [
    {
      source: 'WA_L&I',
      business_name: 'SPARK ELECTRIC',
      license_number: 'SPARK123',
      trade: 'electricians',
      city: 'Vancouver',
      state: 'WA',
      zip: '98661',
      phone: '3605550101',
      principal: 'Jane Doe',
    },
    {
      source: 'OR_CCB',
      business_name: 'RAIN ROOFING',
      license_number: '999',
      trade: 'roofers',
      city: 'Portland',
      state: 'OR',
      zip: '97201',
      phone: '5035550199',
    },
  ];
  const first = await persistContractorRecords(wid, records, { splitByTrade: true });
  assert.equal(first.savedCount, 2);
  assert.equal(first.mergedCount, 0);
  assert.equal(first.folders.length, 2);

  const folders = await dbService.listFolders(wid);
  const electrical = folders.find((f) => f.tradeSlug === 'electrical');
  const roofers = folders.find((f) => f.name === 'Roofers');
  assert.ok(electrical);
  assert.equal(electrical.name, 'Electricians');
  assert.ok(roofers);
  assert.ok(roofers.parentFolderKey);

  const leads = await dbService.getAllLeads(wid);
  assert.equal(leads.length, 2);
  const spark = leads.find((l) => l.contractorLicenseNumber === 'SPARK123');
  assert.equal(spark.folderKey, electrical.key);
  assert.equal(spark.categoryName, 'Electricians');
  assert.equal(spark.source, 'contractor_registry_search');

  const again = await persistContractorRecords(wid, records, { splitByTrade: true });
  assert.equal(again.savedCount, 0);
  assert.equal(again.mergedCount, 2);
  assert.equal((await dbService.getAllLeads(wid)).length, 2);
});

test('the find page exposes the contractor license panel', async () => {
  const html = await ejs.renderFile(
    path.join(__dirname, '../views/partials/find_panel_contractors.ejs'),
    { findType: 'contractors', contractorTrades: CONTRACTOR_TRADES },
    { root: path.join(__dirname, '../views') }
  );
  assert.match(html, /data-find-panel="contractors"/);
  assert.match(html, /WA L&amp;I/);
  assert.match(html, /value="electricians"/);
  assert.match(html, /value="tile_masonry"/);
  assert.equal(CONTRACTOR_TRADES.length, 11);

  const index = fs.readFileSync(path.join(__dirname, '../views/index.ejs'), 'utf8');
  assert.match(index, /find_panel_contractors/);
  assert.match(index, /action: '\/contractors\/search'/);
  const appJs = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
  assert.match(appJs, /type === 'contractors'/);
  assert.equal(normalizeJobType('homeelk'), JOB_TYPES.CONTRACTORS);
});
