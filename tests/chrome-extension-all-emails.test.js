'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'all-emails-'));

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { addEmailContacts, mergeContactLists } = require('../services/leadEmailContacts');

const SCRIPT = fs.readFileSync(path.join(__dirname, '..', 'chrome-extension', 'src', 'website-scrape.js'), 'utf8');

function loadPage(html, { url = 'https://www.markupandprofit.com/', pages = {} } = {}) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  const w = dom.window;
  const fetched = [];
  w.fetch = async (href) => {
    fetched.push(href);
    const body = pages[href];
    if (body == null) return { ok: false, status: 404, headers: { get: () => 'text/html' }, text: async () => '' };
    return { ok: true, status: 200, headers: { get: () => 'text/html; charset=utf-8' }, text: async () => body };
  };
  w.eval(SCRIPT);
  return { api: w.AdHelloWebsiteScrape, fetched };
}

test('extractBusinessWebsite returns every email on the page, main one first', () => {
  const { api } = loadPage(`<html><head><title>Markup &amp; Profit</title></head><body>
    <a href="mailto:info@markupandprofit.com">Email us</a>
    <p>Sales: sales@markupandprofit.com · Support: support@markupandprofit.com</p>
    <a href="mailto:Michael@MarkupAndProfit.com?subject=Hi">Michael</a>
    <img src="logo@2x.png" alt="">
  </body></html>`);
  const lead = api.extractBusinessWebsite();
  assert.equal(lead.email, 'info@markupandprofit.com');
  assert.deepEqual([...lead.emails], [
    'info@markupandprofit.com',
    'michael@markupandprofit.com',
    'sales@markupandprofit.com',
    'support@markupandprofit.com',
  ]);
});

test('collectSiteEmails scans same-site Contact / About / Team pages', async () => {
  const origin = 'https://www.markupandprofit.com';
  const { api, fetched } = loadPage(
    `<html><body>
      <a href="/contact-us">Contact</a>
      <a href="/about">About us</a>
      <a href="/our-team">Meet the team</a>
      <a href="/blog/pricing">Blog</a>
      <a href="https://facebook.com/markup/contact">FB</a>
      <a href="/files/contact.pdf">PDF</a>
    </body></html>`,
    {
      pages: {
        [`${origin}/contact-us`]: '<body><a href="mailto:office@markupandprofit.com">office</a> info@markupandprofit.com</body>',
        [`${origin}/our-team`]: '<body>Michael Stone — michael@markupandprofit.com; Will — will@markupandprofit.com</body>',
      },
    },
  );
  const res = await api.collectSiteEmails({ maxPages: 5 });
  assert.deepEqual(fetched.sort(), [`${origin}/about`, `${origin}/contact-us`, `${origin}/our-team`]);
  assert.equal(res.pagesChecked.length, 2);
  assert.deepEqual(
    [...res.emails].map((e) => e.email),
    ['office@markupandprofit.com', 'info@markupandprofit.com', 'michael@markupandprofit.com', 'will@markupandprofit.com'],
  );
  assert.equal(res.emails[2].page, `${origin}/our-team`);
});

test('collectSiteEmails falls back to /contact when no contact links exist', async () => {
  const origin = 'https://acme.example';
  const { api, fetched } = loadPage('<html><body><p>Welcome</p></body></html>', { url: `${origin}/` });
  const res = await api.collectSiteEmails();
  assert.deepEqual(fetched, [`${origin}/contact`, `${origin}/contact-us`, `${origin}/about`]);
  assert.equal(res.emails.length, 0);
});

test('addEmailContacts keeps extra emails as email-only contacts without duplicates', () => {
  const isValid = (e) => !e.endsWith('@example.com');
  const existing = [{ role: 'Owner', name: 'Mike', phone: '(360) 335-1100', email: 'michael@markupandprofit.com', primary: true }];
  const { contacts, added } = addEmailContacts(
    existing,
    'INFO@markupandprofit.com',
    ['info@markupandprofit.com', 'Michael@markupandprofit.com', 'sales@markupandprofit.com', 'x@example.com', 'sales@markupandprofit.com'],
    isValid,
  );
  assert.equal(added, 1);
  assert.equal(contacts.length, 2);
  assert.deepEqual(contacts[1], { role: 'Email', name: '', phone: '', email: 'sales@markupandprofit.com', primary: false });

  const merged = mergeContactLists(existing, [{ email: 'MICHAEL@markupandprofit.com' }, { email: 'new@markupandprofit.com' }]);
  assert.equal(merged.length, 2);
  assert.equal(merged[1].email, 'new@markupandprofit.com');
});

test('saving the same business again appends newly found emails to its contacts', async () => {
  const dbService = require('../services/database');
  const wid = 'ws_emails';
  const base = { title: 'Markup and Profit', website: 'https://www.markupandprofit.com', workspaceId: wid, email: 'info@markupandprofit.com' };
  const first = await dbService.saveLeadWithMeta({
    ...base,
    contacts: [{ role: 'Email', name: '', phone: '', email: 'sales@markupandprofit.com', primary: false }],
  });
  const second = await dbService.saveLeadWithMeta({
    ...base,
    contacts: [
      { role: 'Email', name: '', phone: '', email: 'sales@markupandprofit.com', primary: false },
      { role: 'Email', name: '', phone: '', email: 'michael@markupandprofit.com', primary: false },
    ],
  });
  assert.equal(second.key, first.key);
  assert.equal(second.merged, true);
  const lead = await dbService.getLead(first.key);
  assert.deepEqual(lead.contacts.map((c) => c.email), ['sales@markupandprofit.com', 'michael@markupandprofit.com']);
});
