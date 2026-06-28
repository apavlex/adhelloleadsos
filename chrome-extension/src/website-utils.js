(function () {
  'use strict';

  /** Hosts that are never a lead's business website (extensions, telco, directories, social). */
  const WEBSITE_NOISE_HOSTS = [
    'voice.google.com',
    'accounts.google.com',
    'google.com',
    'google.co.uk',
    'google.ca',
    'googleapis.com',
    'gstatic.com',
    'chrome.google.com',
    'chromewebstore.google.com',
    'play.google.com',
    'youtube.com',
    'youtu.be',
    'facebook.com',
    'fb.com',
    'instagram.com',
    'twitter.com',
    'x.com',
    'linkedin.com',
    'tiktok.com',
    'pinterest.com',
    'yelp.com',
    'yelpcdn.com',
    'tripadvisor.com',
    'yellowpages.com',
    'bbb.org',
    'bing.com',
    'apple.com',
    'maps.apple.com',
    'goo.gl',
    'bit.ly',
    't.co',
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

  function normalizeBusinessWebsite(href, extraBlocklist) {
    const raw = String(href || '').trim();
    if (!raw) return '';
    const decoded = decodeYelpRedirectUrl(raw) || raw;
    if (isBlockedExternalUrl(decoded, extraBlocklist)) return '';
    try {
      const u = new URL(decoded);
      u.hash = '';
      return u.toString().replace(/\/$/, '');
    } catch (_) {
      return decoded.split('?')[0];
    }
  }

  window.AdHelloWebsiteUtils = {
    WEBSITE_NOISE_HOSTS,
    hostnameFromUrl,
    hostMatchesBlocklist,
    isBlockedExternalUrl,
    decodeYelpRedirectUrl,
    normalizeBusinessWebsite,
  };
})();
