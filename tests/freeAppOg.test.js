const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const freeAppOg = require('../services/freeAppOg');

describe('freeAppOg', () => {
  beforeEach(() => {
    freeAppOg._resetCacheForTests();
  });

  it('copyForOffer uses sales-style Get more reviews & referrals naming', () => {
    const def = freeAppOg.copyForOffer('');
    assert.match(def.title, /Get more reviews/i);
    assert.match(def.titleLine2, /& referrals app/i);
    assert.match(def.badge, /GET MORE/i);
    assert.match(def.subtitle, /referrals/i);
    const flooring = freeAppOg.copyForOffer('flooring');
    assert.match(flooring.titleLine2, /& referrals app/i);
    assert.match(flooring.subtitle, /referrals|quotes/i);
  });

  it('ogImagePath includes cache-bust version', () => {
    assert.match(freeAppOg.ogImagePath(''), /\/app\/og\.jpg\?v=/);
    assert.match(freeAppOg.ogImagePath('flooring'), /\/app\/flooring\/og\.jpg\?v=/);
    assert.match(freeAppOg.ogImageAbsoluteUrl('https://reviews.adhello.io', ''), /reviews\.adhello\.io\/app\/og\.jpg/);
    assert.match(freeAppOg.OG_VERSION, /v2|reviews-referrals/);
  });

  it('vendors Liberation Sans so Docker can draw overlay text', () => {
    assert.ok(fs.existsSync(freeAppOg.FONT_BOLD_PATH), 'bold font missing');
    assert.ok(fs.existsSync(freeAppOg.FONT_REGULAR_PATH), 'regular font missing');
    const svc = fs.readFileSync(path.join(__dirname, '../services/freeAppOg.js'), 'utf8');
    assert.match(svc, /base64/);
    assert.match(svc, /OgSans/);
    assert.doesNotMatch(svc, /Helvetica,\s*Arial/);
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
    assert.match(view, /Get more reviews/);
    assert.doesNotMatch(view, /AdHello Reviews app/);
    assert.doesNotMatch(view, /pay-per-performance leads &amp; referrals/);
    assert.match(route, /\/app\/og\.jpg/);
    assert.match(route, /\/app\/flooring\/og\.jpg/);
    assert.match(route, /freeAppOg/);
    assert.match(route, /ogImageUrl/);
  });
});
