'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadWebsiteScrape() {
  const file = path.join(__dirname, '..', 'chrome-extension', 'src', 'website-scrape.js');
  const code = fs.readFileSync(file, 'utf8');
  const sandbox = {
    window: {},
    document: {
      querySelector: () => null,
      querySelectorAll: () => [],
      title: 'Acme Plumbing | Official Site',
      documentElement: { innerHTML: '' },
      body: { innerText: '' },
    },
    location: {
      href: 'https://www.acmeplumbing.com/contact',
      origin: 'https://www.acmeplumbing.com',
      hostname: 'www.acmeplumbing.com',
      pathname: '/contact',
      protocol: 'https:',
    },
    URL,
    Set,
    Array,
    String,
    Number,
    parseFloat,
    parseInt,
    Object,
    console,
  };
  sandbox.window = sandbox;
  sandbox.document.defaultView = sandbox.window;
  vm.runInNewContext(code, sandbox);
  return sandbox.window.AdHelloWebsiteScrape;
}

test('website-scrape loads AdHelloWebsiteScrape helpers', () => {
  const api = loadWebsiteScrape();
  assert.ok(api);
  assert.equal(typeof api.isUsableEmail, 'function');
  assert.equal(typeof api.isGenericBusinessWebsiteCandidate, 'function');
  assert.equal(typeof api.extractBusinessWebsite, 'function');
});

test('isUsableEmail rejects asset and placeholder emails', () => {
  const { isUsableEmail } = loadWebsiteScrape();
  assert.equal(isUsableEmail('m-home-banner@2x.jpg'), false);
  assert.equal(isUsableEmail('chosen-sprite@2x.png'), false);
  assert.equal(isUsableEmail('user@domain.com'), false);
  assert.equal(isUsableEmail('office@mikado-themes.com'), false);
  assert.equal(isUsableEmail('info@acmeplumbing.com'), true);
  assert.equal(isUsableEmail('cpia@servpluswaterdamage.com'), true);
});

test('isGenericBusinessWebsiteCandidate allows company sites and blocks directories', () => {
  const { isGenericBusinessWebsiteCandidate, isAdHelloAppUrl } = loadWebsiteScrape();
  assert.equal(isGenericBusinessWebsiteCandidate('https://www.acmeplumbing.com/'), true);
  assert.equal(isGenericBusinessWebsiteCandidate('https://servpluswaterdamage.com/contact'), true);
  assert.equal(isGenericBusinessWebsiteCandidate('https://www.yelp.com/biz/acme'), false);
  assert.equal(isGenericBusinessWebsiteCandidate('https://www.linkedin.com/company/acme'), false);
  assert.equal(isGenericBusinessWebsiteCandidate('https://www.google.com/search?q=plumber'), false);
  assert.equal(isGenericBusinessWebsiteCandidate('https://maps.google.com/maps?q=x'), false);
  assert.equal(isGenericBusinessWebsiteCandidate('https://leads.adhello.ai/today'), false);
  assert.equal(isGenericBusinessWebsiteCandidate('https://adhelloleadsos.onrender.com/leads'), false);
  assert.equal(isAdHelloAppUrl('https://leads.adhello.ai/today'), true);
  assert.equal(isAdHelloAppUrl('https://www.acmeplumbing.com/'), false);
});

test('manifest includes website-scrape and broad https matches', () => {
  const manifestPath = path.join(__dirname, '..', 'chrome-extension', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.version, '1.8.5');
  const scripts = manifest.content_scripts[0].js;
  assert.ok(scripts.includes('src/website-scrape.js'));
  assert.ok(manifest.content_scripts[0].matches.includes('https://*/*'));
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'chrome-extension', 'src', 'website-scrape.js')));
});

test('website-scrape registers scrapeBusinessWebsite message action', () => {
  const file = path.join(__dirname, '..', 'chrome-extension', 'src', 'website-scrape.js');
  const code = fs.readFileSync(file, 'utf8');
  assert.match(code, /scrapeBusinessWebsite/);
  assert.match(code, /extractBusinessWebsite/);
});
