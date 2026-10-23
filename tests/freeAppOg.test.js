const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const freeAppOg = require('../services/freeAppOg');

describe('freeAppOg', () => {
  beforeEach(() => {
    freeAppOg._resetCacheForTests();
  });

  it('copyForOffer emphasizes reviews app and referrals', () => {
    const def = freeAppOg.copyForOffer('');
    assert.match(def.title, /Reviews/i);
    assert.match(def.subtitle, /referrals/i);
    assert.match(def.kicker, /Reviews app/i);
    const flooring = freeAppOg.copyForOffer('flooring');
    assert.match(flooring.subtitle, /referrals|quotes/i);
  });

  it('ogImagePath includes cache-bust version', () => {
    assert.match(freeAppOg.ogImagePath(''), /\/app\/og\.jpg\?v=/);
    assert.match(freeAppOg.ogImagePath('flooring'), /\/app\/flooring\/og\.jpg\?v=/);
    assert.match(freeAppOg.ogImageAbsoluteUrl('https://reviews.adhello.io', ''), /reviews\.adhello\.io\/app\/og\.jpg/);
  });

  it('renderFreeAppOgImage returns a JPEG around 1200×630', async () => {
    const pack = await freeAppOg.renderFreeAppOgImage({});
    assert.equal(pack.contentType, 'image/jpeg');
    assert.ok(pack.buffer.length > 8000);
    assert.equal(pack.buffer[0], 0xff);
    assert.equal(pack.buffer[1], 0xd8);
    assert.equal(pack.version, freeAppOg.OG_VERSION);

    const again = await freeAppOg.renderFreeAppOgImage({});
    assert.equal(again.buffer, pack.buffer, 'cached buffer reused');
  });

  it('signup page and route expose OG image + reviews/referrals title', () => {
    const view = fs.readFileSync(path.join(__dirname, '../views/free_app.ejs'), 'utf8');
    const route = fs.readFileSync(path.join(__dirname, '../routes/freeApp.js'), 'utf8');
    assert.match(view, /og:image/);
    assert.match(view, /ogImageUrl/);
    assert.match(view, /twitter:card/);
    assert.match(view, /Reviews app/);
    assert.doesNotMatch(view, /pay-per-performance leads &amp; referrals/);
    assert.match(route, /\/app\/og\.jpg/);
    assert.match(route, /\/app\/flooring\/og\.jpg/);
    assert.match(route, /freeAppOg/);
    assert.match(route, /ogImageUrl/);
  });
});
