'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const WEBSITE_NOISE_HOSTS = [
  'voice.google.com',
  'google.com',
  'yelp.com',
  'facebook.com',
];

function hostnameFromUrl(raw) {
  try {
    const u = new URL(String(raw || '').trim());
    return u.hostname.replace(/^www\./i, '').toLowerCase();
  } catch (_) {
    return '';
  }
}

function hostMatchesBlocklist(host, blocklist) {
  const h = String(host || '').toLowerCase();
  if (!h) return true;
  return (blocklist || []).some((d) => {
    const needle = String(d || '').toLowerCase().replace(/^www\./, '');
    return needle && h.includes(needle);
  });
}

function isBlockedExternalUrl(href, extraBlocklist) {
  const url = String(href || '').trim();
  if (!url || /^(mailto:|javascript:|tel:|#)/i.test(url)) return true;
  const host = hostnameFromUrl(url);
  if (!host) return true;
  const blocklist = WEBSITE_NOISE_HOSTS.concat(extraBlocklist || []);
  return hostMatchesBlocklist(host, blocklist);
}

function decodeYelpRedirectUrl(href) {
  const raw = String(href || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw, 'https://www.yelp.com');
    if (!/\/(biz_redir|adredir)/i.test(u.pathname)) {
      return isBlockedExternalUrl(raw, ['yelp.com']) ? '' : raw;
    }
    const target = u.searchParams.get('url') || u.searchParams.get('redirect_url') || '';
    if (!target) return '';
    const decoded = decodeURIComponent(target);
    return isBlockedExternalUrl(decoded, ['yelp.com']) ? '' : decoded;
  } catch (_) {
    return '';
  }
}

test('isBlockedExternalUrl rejects Google Voice extension links', () => {
  assert.equal(isBlockedExternalUrl('http://voice.google.com/calls', []), true);
  assert.equal(isBlockedExternalUrl('https://voice.google.com/calls?a=1', []), true);
});

test('isBlockedExternalUrl allows real business domains', () => {
  assert.equal(isBlockedExternalUrl('https://www.solidwoodfloorsinc.com/', []), false);
  assert.equal(isBlockedExternalUrl('https://example-flooring.com/contact', []), false);
});

test('decodeYelpRedirectUrl extracts business website from biz_redir', () => {
  const href =
    'https://www.yelp.com/biz_redir?url=https%3A%2F%2Fwww.solidwoodfloorsinc.com&cachebuster=123';
  assert.equal(decodeYelpRedirectUrl(href), 'https://www.solidwoodfloorsinc.com');
});

test('decodeYelpRedirectUrl rejects yelp.com targets', () => {
  const href = 'https://www.yelp.com/biz_redir?url=https%3A%2F%2Fwww.yelp.com%2Fbiz%2Ffoo';
  assert.equal(decodeYelpRedirectUrl(href), '');
});
