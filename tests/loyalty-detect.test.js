'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const {
  detectLoyaltyProgram,
  extractLinksFromHtml,
  htmlToText,
  pickCandidateUrls,
} = require(path.join(__dirname, '..', 'chrome-extension', 'src', 'loyalty-detect.js'));

const { parseLoyaltyProgramFields } = require('../services/loyaltyProgramNormalize');

test('detects on-site loyalty program language', () => {
  const result = detectLoyaltyProgram({
    url: 'https://joescoffee.example/',
    html: `
      <html><body>
        <h1>Joe's Coffee</h1>
        <p>Join our rewards club and earn a free drink after 10 visits.</p>
      </body></html>
    `,
  });
  assert.equal(result.found, true);
  assert.match(String(result.evidence), /rewards club/i);
  assert.equal(result.url, 'https://joescoffee.example/');
});

test('detects punch card wording', () => {
  const result = detectLoyaltyProgram({
    url: 'https://pizzaplace.example/',
    text: 'Buy 9 pizzas get 1 free with our punch card.',
  });
  assert.equal(result.found, true);
  assert.match(String(result.evidence), /punch card/i);
});

test('detects same-origin /loyalty footer link', () => {
  const result = detectLoyaltyProgram({
    url: 'https://salon.example/',
    html: `
      <footer>
        <a href="/loyalty">Loyalty program</a>
        <a href="/contact">Contact</a>
      </footer>
    `,
  });
  assert.equal(result.found, true);
  assert.match(String(result.url), /\/loyalty/i);
});

test('does not invent a program from generic third-party rewards copy', () => {
  const result = detectLoyaltyProgram({
    url: 'https://dentist.example/',
    html: `
      <p>We accept American Express. Earn Amex rewards and airline miles on your visit.</p>
      <a href="https://www.americanexpress.com/rewards">Amex Rewards</a>
    `,
  });
  assert.equal(result.found, false);
});

test('generic “rewards” in an ad is not enough without on-site program language', () => {
  const result = detectLoyaltyProgram({
    url: 'https://hvac.example/',
    html: `
      <p>Great service. Employee of the month rewards announced Friday.</p>
      <a href="/about">About us</a>
    `,
  });
  assert.equal(result.found, false);
});

test('uses extra linked page text when the homepage only has a rewards URL', () => {
  const result = detectLoyaltyProgram({
    url: 'https://bakery.example/',
    html: `<nav><a href="/menu">Menu</a></nav>`,
    extraPages: [
      {
        url: 'https://bakery.example/rewards',
        text: 'Join our loyalty program and get points for every visit.',
      },
    ],
  });
  assert.equal(result.found, true);
  assert.match(String(result.url), /\/rewards/i);
  assert.match(String(result.evidence), /loyalty program/i);
});

test('pickCandidateUrls only returns same-origin rewards/loyalty links', () => {
  const snapshot = {
    pageUrl: 'https://cafe.example/contact',
    links: [
      { href: 'https://cafe.example/rewards', text: 'Rewards' },
      { href: 'https://amex.com/rewards', text: 'Amex Rewards' },
      { href: 'mailto:hi@cafe.example', text: 'Email' },
      { href: 'https://cafe.example/about', text: 'About' },
    ],
  };
  const urls = pickCandidateUrls(snapshot, 'https://cafe.example');
  assert.deepEqual(urls, ['https://cafe.example/rewards']);
});

test('htmlToText and extractLinksFromHtml stay usable without a DOM', () => {
  const html = `<a href="/punch-card">Punch card</a><script>alert(1)</script><p>Hello</p>`;
  assert.equal(htmlToText(html).includes('alert'), false);
  assert.match(htmlToText(html), /Hello/);
  const links = extractLinksFromHtml(html, 'https://shop.example/');
  assert.equal(links.length, 1);
  assert.equal(links[0].href, 'https://shop.example/punch-card');
  assert.match(links[0].text, /punch card/i);
});

test('parseLoyaltyProgramFields stores explicit yes and no', () => {
  const yes = parseLoyaltyProgramFields({
    loyaltyProgram: 'yes',
    loyaltyProgramEvidence: 'Join our rewards club',
    loyaltyProgramUrl: 'https://cafe.example/rewards',
  });
  assert.equal(yes.loyaltyProgram, 'yes');
  assert.equal(yes.hasLoyaltyProgram, true);

  const no = parseLoyaltyProgramFields({ hasLoyaltyProgram: false });
  assert.equal(no.loyaltyProgram, 'no');
  assert.equal(no.hasLoyaltyProgram, false);

  assert.equal(parseLoyaltyProgramFields({ title: 'Acme' }), null);
});
