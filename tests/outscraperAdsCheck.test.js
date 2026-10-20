'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const outscraper = require('../services/outscraperClient');
const outscraperAdsCheck = require('../services/outscraperAdsCheck');

describe('outscraperAdsCheck', () => {
  test('summarizeAds formats google / linkedin / none', () => {
    assert.match(outscraperAdsCheck.summarizeAds({ ads: false }), /No paid ads/i);
    assert.match(
      outscraperAdsCheck.summarizeAds({ ads: true, google: true, linkedin: false }),
      /Google/,
    );
    assert.match(
      outscraperAdsCheck.summarizeAds({ ads: true, google: true, linkedin: true }),
      /LinkedIn/,
    );
  });

  test('checkLeadAds skips when Outscraper missing or no website', async () => {
    const noCfg = await outscraperAdsCheck.checkLeadAds(
      { website: 'https://acme.com' },
      {},
    );
    assert.equal(noCfg.reason, 'not_configured');

    const noSite = await outscraperAdsCheck.checkLeadAds(
      { title: 'Acme' },
      { OUTSCRAPER_API_KEY: 'k' },
    );
    assert.equal(noSite.reason, 'no_website');
  });

  test('checkLeadAds maps Outscraper row into lead patch', async () => {
    const original = outscraper.fetchAdsChecker;
    outscraper.fetchAdsChecker = async () => ({
      query: 'acme.com',
      ads: true,
      google: true,
      linkedin: false,
    });
    try {
      const pack = await outscraperAdsCheck.checkLeadAds(
        { website: 'https://www.acme.com/about' },
        { OUTSCRAPER_API_KEY: 'k' },
      );
      assert.equal(pack.used, true);
      assert.equal(pack.patch.adsRunning, true);
      assert.equal(pack.patch.adsRunningGoogle, true);
      assert.equal(pack.patch.adsRunningLinkedin, false);
      assert.equal(pack.patch.adsCheckDomain, 'acme.com');
      assert.match(pack.message, /Google/);
    } finally {
      outscraper.fetchAdsChecker = original;
    }
  });

  test('UI wires Check running ads in panel and Money mode', () => {
    const root = path.join(__dirname, '..');
    const panel = fs.readFileSync(path.join(root, 'views/partials/lead_detail_panel.ejs'), 'utf8');
    const focus = fs.readFileSync(path.join(root, 'views/focus.ejs'), 'utf8');
    const route = fs.readFileSync(path.join(root, 'routes/leads.js'), 'utf8');
    const client = fs.readFileSync(path.join(root, 'services/outscraperClient.js'), 'utf8');
    assert.match(panel, /leadPanelAdsCheckBtn/);
    assert.match(panel, /Check running ads/);
    assert.match(panel, /lead-ads-check\.js/);
    assert.match(focus, /focus-ads-check-btn/);
    assert.match(focus, /Check running ads/);
    assert.match(route, /\/:key\/check-ads/);
    assert.match(client, /ads-checker/);
    assert.match(client, /fetchAdsChecker/);
  });
});
