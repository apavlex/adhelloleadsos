'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const contactFinder = require('../services/contactFinder');
const cell = require('../public/js/contact-finder-cell');

const ROOT = path.join(__dirname, '..');
const OUTSCRAPER_ENV = { OUTSCRAPER_API_KEY: 'k' };

const outscraperRow = {
  query: 'kipshardwoodflooring.com',
  emails: [
    { value: 'info@kipshardwoodflooring.com' },
    { value: 'kip@kipshardwoodflooring.com', full_name: 'Kip Walker', title: 'Owner' },
    { value: 'logo@2x.png' },
  ],
  phones: [{ value: '+1 503-762-0000' }],
  socials: { facebook: 'https://www.facebook.com/kipshardwood', linkedin: 'https://www.linkedin.com/company/kips-hardwood' },
  contacts: [
    { full_name: 'Kip Walker', title: 'Owner', emails: [{ value: 'kip@kipshardwoodflooring.com' }] },
    { first_name: 'Dana', last_name: 'Ruiz', title: 'Office Manager', emails: ['dana@kipshardwoodflooring.com'], phones: ['(503) 555-0111'] },
  ],
};

const lead = { key: 'lead:k', title: 'Kip Hardwood', website: 'https://www.kipshardwoodflooring.com/', email: 'N/A', phone: 'N/A', facebook: 'N/A' };

test('findContactsForLead maps every Outscraper decision maker, email, phone and social', async () => {
  let query = '';
  const result = await contactFinder.findContactsForLead(lead, OUTSCRAPER_ENV, {
    deps: {
      fetchContactsAndLeads: async (args) => {
        query = args.query;
        return outscraperRow;
      },
      runApify: async () => assert.fail('Apify should not run when Outscraper found contacts'),
    },
  });
  assert.equal(query, 'kipshardwoodflooring.com');
  assert.deepEqual(result.sources, ['Outscraper']);
  assert.deepEqual(
    result.people.map((p) => [p.name, p.title, p.email, p.phone]),
    [
      ['Kip Walker', 'Owner', 'kip@kipshardwoodflooring.com', ''],
      ['Dana Ruiz', 'Office Manager', 'dana@kipshardwoodflooring.com', '(503) 555-0111'],
    ],
  );
  assert.deepEqual(result.emails.sort(), ['dana@kipshardwoodflooring.com', 'info@kipshardwoodflooring.com', 'kip@kipshardwoodflooring.com']);
  assert.deepEqual(result.phones, ['+1 503-762-0000']);
  assert.match(result.socials.facebook, /facebook\.com\/kipshardwood/);
  assert.match(result.socials.linkedin, /linkedin\.com\/company\/kips-hardwood/);
});

test('Apify website crawl is the fallback when Outscraper is missing or empty', async () => {
  const items = [
    { url: 'https://acme.example/', emails: ['hello@acme.example'], phones: ['360-555-0199'], facebooks: ['https://facebook.com/acmefloors'], linkedIns: ['https://www.linkedin.com/in/someone', 'https://www.linkedin.com/company/acme'] },
    { url: 'https://acme.example/contact', emails: ['hello@acme.example', 'jobs@acme.example'], instagrams: ['https://instagram.com/acmefloors'] },
  ];
  const site = { website: 'acme.example' };
  const onlyApify = await contactFinder.findContactsForLead(site, { APIFY_API_TOKEN: 't' }, { deps: { runApify: async () => items } });
  assert.deepEqual(onlyApify.sources, ['Apify']);
  assert.deepEqual(onlyApify.emails, ['hello@acme.example', 'jobs@acme.example']);
  assert.match(onlyApify.socials.linkedin, /company\/acme/);
  assert.match(onlyApify.socials.instagram, /instagram\.com\/acmefloors/);

  const both = await contactFinder.findContactsForLead(site, { ...OUTSCRAPER_ENV, APIFY_API_TOKEN: 't' }, {
    deps: { fetchContactsAndLeads: async () => ({ emails: [], contacts: [] }), runApify: async () => items },
  });
  assert.deepEqual(both.sources, ['Outscraper', 'Apify']);
  assert.equal(both.emails.length, 2);
});

test('findContactsForLead explains missing website and missing integrations', async () => {
  await assert.rejects(contactFinder.findContactsForLead({ website: 'N/A' }, OUTSCRAPER_ENV), { code: 'no_website' });
  await assert.rejects(contactFinder.findContactsForLead({ website: 'acme.example' }, {}), { code: 'not_configured' });
});

test('buildLeadPatchFromFinder fills blanks, appends people + extra emails, keeps existing values', async () => {
  const result = await contactFinder.findContactsForLead(lead, OUTSCRAPER_ENV, { deps: { fetchContactsAndLeads: async () => outscraperRow } });
  const existing = { ...lead, facebook: 'https://facebook.com/already', contacts: [{ role: 'Primary', name: '', phone: '(503) 111-2222', email: '', primary: true }] };
  const { patch, filled } = contactFinder.buildLeadPatchFromFinder(existing, result);
  assert.equal(patch.email, 'info@kipshardwoodflooring.com');
  assert.equal(patch.phone, '+1 503-762-0000');
  assert.equal(patch.facebook, undefined, 'existing social is not overwritten');
  assert.match(patch.linkedin, /company\/kips-hardwood/);
  assert.equal(patch.decisionMakerName, 'Kip Walker');
  assert.equal(patch.decisionMakerTitle, 'Owner');
  assert.deepEqual(
    patch.contacts.map((c) => [c.role, c.name, c.email]),
    [
      ['Primary', '', ''],
      ['Owner', 'Kip Walker', 'kip@kipshardwoodflooring.com'],
      ['Office Manager', 'Dana Ruiz', 'dana@kipshardwoodflooring.com'],
    ],
  );
  assert.equal(patch.contactFinder.status, 'found');
  assert.equal(patch.contactFinder.people, 2);
  assert.ok(filled.includes('contacts') && filled.includes('email'));

  const again = contactFinder.buildLeadPatchFromFinder({ ...existing, ...patch }, result);
  assert.equal(again.patch.contacts, undefined, 'searching twice does not duplicate contacts');

  const none = contactFinder.buildLeadPatchFromFinder(lead, { ...contactFinder.emptyResult('x.com'), sources: ['Outscraper'] });
  assert.equal(none.patch.contactFinder.status, 'none');
  const failed = contactFinder.buildLeadPatchFromFinder(lead, { ...contactFinder.emptyResult('x.com'), errors: ['Outscraper: 401'] });
  assert.equal(failed.patch.contactFinder.status, 'error');
  assert.match(failed.patch.contactFinder.error, /401/);
});

test('contactsPatchFromOutscraperRow gives the Enrich pipeline every decision maker', () => {
  const { contacts } = contactFinder.contactsPatchFromOutscraperRow(
    { ...lead, email: 'info@kipshardwoodflooring.com' },
    outscraperRow,
  );
  assert.deepEqual(contacts.map((c) => c.name), ['Kip Walker', 'Dana Ruiz']);
});

test('find-contact cell renders search, found, no-result and no-website states', () => {
  const text = (html) => html.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  assert.equal(text(cell.renderCell({ website: 'https://a.com' })), 'Find a contact Emails, people &amp; socials');
  assert.match(cell.renderCell({ website: 'https://a.com' }), /js-find-contact-search/);
  assert.equal(text(cell.renderCell({ website: 'N/A' })), 'Find a contact Needs a website');
  const found = cell.renderCell({
    website: 'a.com',
    email: 'info@a.com',
    contacts: JSON.stringify([
      { role: 'Owner', name: 'Kip Walker', email: 'kip@a.com' },
      { role: 'Email', name: '', email: 'sales@a.com' },
    ]),
  });
  assert.equal(text(found), 'KW Kip Walker Owner · +1 more');
  assert.match(found, /js-find-contact-open/);
  assert.equal(
    text(cell.renderCell({ website: 'a.com', contactFinder: { status: 'none', at: '2026-09-27T18:00:00Z' } }, { formatDate: () => 'Sep 27' })),
    'No contacts found Searched Sep 27 · Try again',
  );
  assert.equal(text(cell.renderCell({ website: 'a.com', decisionMakerName: 'Pat Lee', decisionMakerTitle: 'CEO' })), 'PL Pat Lee CEO');
  assert.match(cell.renderCell({ website: 'a.com' }, { loading: true }), /Searching…/);
  assert.doesNotMatch(cell.renderCell({ website: 'a.com', contacts: [{ name: '<img src=x>', role: 'Owner' }] }), /<img/);
});

test('column registries list Find a contact first and match the table header order', () => {
  const core = fs.readFileSync(path.join(ROOT, 'views/partials/leads_pipeline_core.ejs'), 'utf8');
  const rows = fs.readFileSync(path.join(ROOT, 'views/partials/pipeline_lead_rows.ejs'), 'utf8');
  const thIds = [...core.matchAll(/<th data-plc="(\w+)"/g)].map((m) => m[1]);
  const tdIds = [...rows.matchAll(/<td data-plc="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(tdIds, thIds);
  const detail = thIds.filter((id) => !/^(check|permit|listing|city|state)/.test(id)).slice(0, 7);
  assert.deepEqual(detail, ['company', 'findContact', 'category', 'reviews', 'contactGroup', 'phone', 'email']);
  assert.equal(thIds[thIds.indexOf('domain') + 1], 'opportunity');

  const primeSrc = fs.readFileSync(path.join(ROOT, 'public/js/pipeline-prefs-prime.js'), 'utf8');
  const primeIds = [...primeSrc.match(/var PLC_META = \[([\s\S]*?)\];/)[1].matchAll(/id: '(\w+)'/g)].map((m) => m[1]);
  const appSrc = fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8');
  const appIds = [...appSrc.match(/const PLC_META = \[([\s\S]*?)\];/)[1].matchAll(/id: '(\w+)'/g)].map((m) => m[1]);
  assert.deepEqual(appIds, primeIds);
  assert.deepEqual(primeIds, thIds.filter((id) => id !== 'check' && id !== 'contactGroup'));
});

test('server-rendered rows keep saved contacts readable after a page reload', async () => {
  const ejs = require('ejs');
  const { viewDateFormatters } = require('../services/workspaceTimezone');
  const contacts = [
    { role: 'Email', name: '', phone: '', email: 'darrellpetty62@gmail.com', primary: false },
    { role: 'Email', name: '', phone: '', email: 'micah@micahrich.com', primary: false },
  ];
  const html = await ejs.renderFile(
    path.join(ROOT, 'views/partials/leads_pipeline_core.ejs'),
    {
      leads: [{ key: 'lead:ac', workspaceId: 'w', title: 'AC & "Sons" Electric', website: 'https://acelectric.com', email: 'eben@eyebytes.com', phone: 'N/A', contacts, contactFinder: { status: 'found', emails: 3 } }],
      pipelineStages: [],
      canManageWorkspace: true,
      ...viewDateFormatters(null),
      renderFindContactCell: cell.renderCell,
    },
    { root: path.join(ROOT, 'views') },
  );
  const dom = new JSDOM(`<body>${html}</body>`, { url: 'https://leads.example/prospecting', runScripts: 'outside-only' });
  const w = dom.window;
  w.eval(fs.readFileSync(path.join(ROOT, 'public/js/contact-finder-cell.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(ROOT, 'public/js/contact-finder.js'), 'utf8'));
  const row = w.document.querySelector('tr.result-row');
  assert.equal(row.dataset.title, 'AC & "Sons" Electric');
  assert.deepEqual(JSON.parse(row.dataset.contacts).map((c) => c.email), ['darrellpetty62@gmail.com', 'micah@micahrich.com']);
  assert.equal(JSON.parse(row.dataset.contactFinder).status, 'found');

  row.querySelector('td[data-plc="findContact"] .js-find-contact-open').click();
  const pop = w.document.querySelector('.lead-find-contact-popover');
  assert.match(pop.textContent, /Company emails \(3\)/);
  assert.match(pop.textContent, /micah@micahrich\.com/);
  assert.ok(pop.classList.contains('portaled-popover-surface'), 'popover gets the solid portaled surface');
});

test('clicking Find a contact searches, fills the row and lists everyone in the popover', async () => {
  const ejs = require('ejs');
  const { viewDateFormatters } = require('../services/workspaceTimezone');
  const html = await ejs.renderFile(
    path.join(ROOT, 'views/partials/leads_pipeline_core.ejs'),
    {
      leads: [{ key: 'lead:k', workspaceId: 'w', title: 'Kip Hardwood', website: 'https://kipshardwoodflooring.com', email: 'N/A', phone: 'N/A' }],
      pipelineStages: [],
      canManageWorkspace: true,
      ...viewDateFormatters(null),
      renderFindContactCell: cell.renderCell,
    },
    { root: path.join(ROOT, 'views') },
  );
  const dom = new JSDOM(`<body>${html}</body>`, { url: 'https://leads.example/prospecting', runScripts: 'outside-only' });
  const w = dom.window;
  const calls = [];
  w.fetch = async (url, init) => {
    calls.push({ url, method: init && init.method, body: init && init.body });
    if (url.endsWith('/find-contacts')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          message: 'Found 2 people, 2 emails via Outscraper.',
          lead: {
            key: 'lead:k',
            email: 'info@kipshardwoodflooring.com',
            decisionMakerName: 'Kip Walker',
            decisionMakerTitle: 'Owner',
            contacts: [
              { role: 'Owner', name: 'Kip Walker', email: 'kip@kipshardwoodflooring.com', phone: '', primary: false },
              { role: 'Office Manager', name: 'Dana Ruiz', email: 'dana@kipshardwoodflooring.com', phone: '(503) 555-0111', primary: false },
            ],
            contactFinder: { at: '2026-09-28T20:00:00Z', status: 'found', people: 2, emails: 2, sources: ['Outscraper'] },
          },
        }),
      };
    }
    return { ok: true, status: 200, json: async () => ({ success: true }) };
  };
  w.eval(fs.readFileSync(path.join(ROOT, 'public/js/contact-finder-cell.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(ROOT, 'public/js/contact-finder.js'), 'utf8'));

  const d = w.document;
  const row = d.querySelector('tr.result-row');
  const td = () => row.querySelector('td[data-plc="findContact"]');
  const flush = () => new Promise((r) => setTimeout(r, 0));

  td().querySelector('.js-find-contact-search').click();
  assert.match(td().textContent, /Searching…/);
  await flush();
  await flush();
  assert.equal(calls[0].url, '/leads/lead%3Ak/find-contacts');
  assert.equal(calls[0].method, 'POST');
  assert.match(td().textContent, /Kip Walker\s*Owner · \+1 more/);
  assert.match(td().textContent, /Found 2 people/);
  assert.equal(row.querySelector('.lead-contact-row-email a').textContent, 'info@kipshardwoodflooring.com');
  const chip = row.querySelector('.lead-contact-more-emails');
  assert.equal(chip.textContent, '+2');
  assert.equal(chip.classList.contains('hidden'), false);
  assert.equal(JSON.parse(row.dataset.contactFinder).status, 'found');

  td().querySelector('.js-find-contact-open').click();
  const pop = d.querySelector('.lead-find-contact-popover');
  assert.ok(pop, 'popover opens');
  assert.match(pop.textContent, /Contacts at\s*Kip Hardwood/);
  assert.match(pop.textContent, /Dana Ruiz[\s\S]*Office Manager[\s\S]*dana@kipshardwoodflooring\.com[\s\S]*\(503\) 555-0111/);

  pop.querySelector('.js-find-contact-make-main[data-email="dana@kipshardwoodflooring.com"]').click();
  await flush();
  await flush();
  const update = calls.find((c) => c.url.endsWith('/update'));
  assert.deepEqual(JSON.parse(update.body), { email: 'dana@kipshardwoodflooring.com', keepPreviousEmail: true });
  assert.equal(row.dataset.email, 'dana@kipshardwoodflooring.com');

  d.body.click();
  assert.equal(d.querySelector('.lead-find-contact-popover'), null, 'outside click closes the popover');
});
