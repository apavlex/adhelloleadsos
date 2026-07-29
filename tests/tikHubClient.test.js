const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const tikHub = require('../services/tikHubClient');

describe('tikHubClient', () => {
  it('scores business name overlap', () => {
    const lead = { title: 'Joe Plumbing', city: 'Portland', state: 'OR' };
    const good = { username: 'joeplumbingpdx', full_name: 'Joe Plumbing Portland', biography: 'Local plumber in Portland OR' };
    const weak = { username: 'randomchef', full_name: 'Chef Tips Daily', biography: 'Food content' };
    assert.ok(tikHub.scoreCandidate(lead, good) > tikHub.scoreCandidate(lead, weak));
  });

  it('builds profile URLs', () => {
    assert.equal(tikHub.instagramProfileUrl({ username: 'acme_roof' }), 'https://www.instagram.com/acme_roof/');
    assert.equal(tikHub.tiktokProfileUrl({ unique_id: 'acmeroof' }), 'https://www.tiktok.com/@acmeroof');
    assert.equal(tikHub.twitterProfileUrl({ screen_name: 'AcmeRoof' }), 'https://x.com/AcmeRoof');
  });

  it('detects extract signal', () => {
    assert.equal(tikHub.extractHasSignal({ instagram: 'https://instagram.com/x' }), true);
    assert.equal(tikHub.extractHasSignal({}), false);
  });
});
