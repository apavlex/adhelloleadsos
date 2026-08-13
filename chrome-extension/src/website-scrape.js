/**
 * Scrape contact + social fields from a generic business website (not directories).
 * Used when the user opens a company site and saves via the extension.
 */
(function () {
  'use strict';

  const SOCIAL_HOSTS = {
    facebook: ['facebook.com', 'fb.com', 'fb.me', 'm.facebook.com'],
    instagram: ['instagram.com', 'instagr.am'],
    twitter: ['twitter.com', 'x.com'],
    linkedin: ['linkedin.com'],
    tiktok: ['tiktok.com'],
    youtube: ['youtube.com', 'youtu.be'],
  };

  const NOISE_HOSTS = [
    'google.com',
    'google.co.uk',
    'google.ca',
    'google.com.au',
    'bing.com',
    'yahoo.com',
    'duckduckgo.com',
    'chrome.google.com',
    'chromewebstore.google.com',
    'accounts.google.com',
    'docs.google.com',
    'drive.google.com',
    'mail.google.com',
    'github.com',
    'gitlab.com',
    'stackoverflow.com',
    'reddit.com',
    'wikipedia.org',
    'w3.org',
    'cloudflare.com',
    'amazon.com',
    'ebay.com',
    'paypal.com',
    'stripe.com',
    'notion.so',
    'figma.com',
    'slack.com',
    'zoom.us',
    'microsoft.com',
    'office.com',
    'live.com',
    'apple.com',
  ];

  const DIRECTORY_OR_SOCIAL_HOSTS = [
    'linkedin.com',
    'facebook.com',
    'fb.com',
    'instagram.com',
    'yelp.com',
    'yellowpages.com',
    'bbb.org',
    'tripadvisor.com',
    'angi.com',
    'homeadvisor.com',
    'thumbtack.com',
    'foursquare.com',
    'manta.com',
    'citysearch.com',
    'superpages.com',
    'groupon.com',
    'craigslist.org',
    'nextdoor.com',
    'houzz.com',
    'zillow.com',
    'mhvillage.com',
    'realtor.com',
    'redfin.com',
    'offerup.com',
    'maps.apple.com',
  ];

  const ASSET_TLDS = new Set([
    'jpg',
    'jpeg',
    'png',
    'gif',
    'webp',
    'svg',
    'css',
    'js',
    'map',
    'woff',
    'woff2',
    'ttf',
    'ico',
  ]);

  const PLACEHOLDER_LOCALS = new Set([
    'user',
    'username',
    'email',
    'name',
    'yourname',
    'you',
    'test',
    'example',
    'sample',
    'placeholder',
    'noreply',
    'no-reply',
    'donotreply',
  ]);

  function hostnameOf(raw) {
    try {
      return new URL(String(raw || '').trim(), window.location.href)
        .hostname.replace(/^www\./i, '')
        .toLowerCase();
    } catch (_) {
      return '';
    }
  }

  function hostMatchesAny(host, list) {
    const h = String(host || '')
      .toLowerCase()
      .replace(/^www\./, '');
    if (!h) return false;
    return (list || []).some((d) => {
      const needle = String(d || '')
        .toLowerCase()
        .replace(/^www\./, '');
      if (!needle) return false;
      // Exact host or subdomain only — never substring (e.g. plumbing.com vs bing.com)
      return h === needle || h.endsWith(`.${needle}`);
    });
  }

  function isGenericBusinessWebsiteCandidate(url) {
    try {
      const u = new URL(String(url || window.location.href));
      if (!/^https?:$/i.test(u.protocol)) return false;
      const host = u.hostname.replace(/^www\./i, '').toLowerCase();
      if (!host || host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return false;
      if (hostMatchesAny(host, DIRECTORY_OR_SOCIAL_HOSTS)) return false;
      if (hostMatchesAny(host, NOISE_HOSTS)) return false;
      if (host.includes('google.') && u.pathname.toLowerCase().includes('/maps')) return false;
      return true;
    } catch (_) {
      return false;
    }
  }

  function isUsableEmail(email) {
    const s = String(email || '')
      .trim()
      .toLowerCase();
    if (!s || s === 'n/a') return false;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return false;
    const [local, domain] = s.split('@');
    if (!local || !domain) return false;
    const tld = domain.split('.').pop() || '';
    if (ASSET_TLDS.has(tld)) return false;
    if (/@[23]x\./i.test(s)) return false;
    if (/\.(jpe?g|png|gif|webp|svg|css|js)(@|$)/i.test(s)) return false;
    if (/(^|[._-])(banner|sprite|logo|icon|hero|thumb|favicon|webpack|chunk)([._-]|$)/i.test(local)) {
      return false;
    }
    if (PLACEHOLDER_LOCALS.has(local)) return false;
    if (/^(noreply|no-reply|donotreply|mailer-daemon)/i.test(local)) return false;
    if (/^[0-9a-f]{24,}$/i.test(local)) return false;
    if (domain === 'domain.com' || domain === 'email.com' || domain === 'example.com') return false;
    if (/^example\./i.test(domain)) return false;
    if (/(^|\.)themes?\.com$/i.test(domain) || /-themes\.com$/i.test(domain)) return false;
    if (domain.includes('sentry') || domain.endsWith('wixpress.com')) return false;
    if (!/^[a-z]{2,24}$/i.test(tld)) return false;
    return true;
  }

  function normalizePhone(raw) {
    const digits = String(raw || '').replace(/\D/g, '');
    if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    if (digits.length === 11 && digits[0] === '1') {
      return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
    }
    return String(raw || '').trim();
  }

  function cleanTitle(raw) {
    let s = String(raw || '').replace(/\s+/g, ' ').trim();
    s = s.replace(/\s*[|\-–—]\s*(home|official\s+site|welcome|contact).*$/i, '').trim();
    // Drop common trailing slogans after a separator when the full title is long
    if (s.length > 56) {
      s = s.replace(/\s*[|\-–—]\s+[^|\-–—]{8,}$/u, '').trim() || s;
    }
    return s;
  }

  function meta(prop) {
    const el = document.querySelector(`meta[property="${prop}"], meta[name="${prop}"]`);
    return el?.content?.trim() || '';
  }

  function flattenJsonLd(node, out) {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach((n) => flattenJsonLd(n, out));
      return;
    }
    if (typeof node !== 'object') return;
    out.push(node);
    if (node['@graph']) flattenJsonLd(node['@graph'], out);
  }

  function allJsonLdNodes() {
    const out = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach((el) => {
      try {
        flattenJsonLd(JSON.parse(el.textContent || 'null'), out);
      } catch (_) {
        /* ignore */
      }
    });
    return out;
  }

  function findBusinessJsonLd() {
    const nodes = allJsonLdNodes();
    const prefer = [
      'localbusiness',
      'organization',
      'store',
      'homeandconstructionbusiness',
      'professionalservice',
      'dentist',
      'attorney',
      'restaurant',
    ];
    for (const type of prefer) {
      const hit = nodes.find((n) => {
        const t = n && n['@type'];
        const types = Array.isArray(t) ? t : [t];
        return types.some((x) => String(x || '').toLowerCase().includes(type));
      });
      if (hit) return hit;
    }
    return nodes.find((n) => n && (n.telephone || n.address || n.email)) || null;
  }

  function platformForHost(host) {
    const h = String(host || '').toLowerCase();
    for (const [platform, hosts] of Object.entries(SOCIAL_HOSTS)) {
      if (hosts.some((d) => h === d || h.endsWith(`.${d}`))) return platform;
    }
    return '';
  }

  function normalizeSocialHref(href, platform) {
    const raw = String(href || '').trim();
    if (!raw || /^(mailto:|javascript:|tel:|#)/i.test(raw)) return '';
    try {
      const u = new URL(raw, window.location.href);
      u.hash = '';
      const host = u.hostname.replace(/^www\./i, '').toLowerCase();
      if (platform && platformForHost(host) !== platform) return '';
      // Skip share / login / intent URLs
      const path = u.pathname.toLowerCase();
      if (/\/(share|sharer|intent|login|signup|oauth|dialog)\b/i.test(path)) return '';
      if (platform === 'facebook' && /^\/+(sharer|share\.php|dialog)\b/i.test(path)) return '';
      if (platform === 'linkedin' && /\/(sharing|sharearticle|uas\/login)/i.test(path)) return '';
      if (platform === 'twitter' && /\/(intent|share)\b/i.test(path)) return '';
      // Prefer profile/company paths over bare homepage when possible
      return u.toString().replace(/\/$/, '') || u.origin;
    } catch (_) {
      return '';
    }
  }

  function collectSocials(root) {
    const scope = root || document;
    const found = {
      facebook: '',
      instagram: '',
      twitter: '',
      linkedin: '',
      tiktok: '',
      youtube: '',
    };
    const anchors = scope.querySelectorAll('a[href]');
    for (const a of anchors) {
      const href = a.href || a.getAttribute('href') || '';
      const host = hostnameOf(href);
      const platform = platformForHost(host);
      if (!platform || found[platform]) continue;
      const normalized = normalizeSocialHref(href, platform);
      if (normalized) found[platform] = normalized;
    }
    return found;
  }

  function collectEmails(root) {
    const scope = root || document;
    const emails = [];
    scope.querySelectorAll('a[href^="mailto:"]').forEach((a) => {
      const href = a.getAttribute('href') || '';
      const email = href.replace(/^mailto:/i, '').split('?')[0].trim();
      if (isUsableEmail(email)) emails.push(email.toLowerCase());
    });
    const text = `${scope.body ? scope.body.innerText : scope.innerText || ''} ${document.documentElement?.innerHTML || ''}`;
    const re = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
    let m;
    while ((m = re.exec(text)) && emails.length < 12) {
      if (isUsableEmail(m[0])) emails.push(m[0].toLowerCase());
    }
    return Array.from(new Set(emails));
  }

  function collectPhones(root) {
    const scope = root || document;
    const phones = [];
    scope.querySelectorAll('a[href^="tel:"]').forEach((a) => {
      const raw = (a.getAttribute('href') || '').replace(/^tel:/i, '');
      const n = normalizePhone(raw || a.textContent);
      if (n && n.replace(/\D/g, '').length >= 10) phones.push(n);
    });
    const text = scope.body ? scope.body.innerText : scope.innerText || '';
    const re = /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/g;
    let m;
    while ((m = re.exec(text)) && phones.length < 8) {
      const n = normalizePhone(m[0]);
      if (n && n.replace(/\D/g, '').length >= 10) phones.push(n);
    }
    return Array.from(new Set(phones));
  }

  function parseAddressFromJsonLd(jsonLd) {
    if (!jsonLd || !jsonLd.address) return null;
    const addr = jsonLd.address;
    if (typeof addr === 'string') {
      const utils = window.AdHelloAddressUtils;
      const geo = utils?.parseCityState ? utils.parseCityState(addr) : { street: addr, city: '', state: '' };
      return {
        address: addr,
        city: geo.city || '',
        state: geo.state || '',
        zip: geo.postalCode || geo.zip || '',
      };
    }
    const street = addr.streetAddress || '';
    const city = addr.addressLocality || '';
    const state = addr.addressRegion || '';
    const zip = addr.postalCode || '';
    const full = [street, city, state, zip].filter(Boolean).join(', ');
    return { address: full || street, city, state, zip };
  }

  function findAddressFromDom(root) {
    const scope = root || document;
    const selectors = [
      '[itemprop="address"]',
      '[itemprop="streetAddress"]',
      'address',
      '.address',
      '.footer-address',
      '.contact-address',
      '[class*="address" i]',
      '[data-address]',
    ];
    for (const sel of selectors) {
      const el = scope.querySelector(sel);
      if (!el) continue;
      const utils = window.AdHelloAddressUtils;
      const raw =
        (utils?.extractAddressFromElement && utils.extractAddressFromElement(el)) ||
        (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!raw || raw.length < 8) continue;
      if (!/\d/.test(raw)) continue;
      if (!/[A-Za-z]{2}/.test(raw)) continue;
      const geo = utils?.parseCityState ? utils.parseCityState(raw) : { street: raw, city: '', state: '' };
      if (geo.city || geo.state || /\d{5}/.test(raw)) {
        return {
          address: utils?.cleanAddress ? utils.cleanAddress(raw) : raw,
          city: geo.city || '',
          state: geo.state || '',
          zip: geo.postalCode || geo.zip || '',
        };
      }
    }
    return null;
  }

  function companyTitle() {
    const ld = findBusinessJsonLd();
    if (ld && ld.name) return cleanTitle(ld.name);
    const siteName = meta('og:site_name');
    if (siteName) return cleanTitle(siteName);
    const ogTitle = meta('og:title');
    if (ogTitle) return cleanTitle(ogTitle);
    const h1 = document.querySelector('h1');
    if (h1 && h1.textContent) return cleanTitle(h1.textContent);
    return cleanTitle(document.title) || hostnameOf(window.location.href) || 'Business website';
  }

  function applySameAsSocials(jsonLd, socials) {
    if (!jsonLd) return socials;
    const sameAs = Array.isArray(jsonLd.sameAs)
      ? jsonLd.sameAs
      : jsonLd.sameAs
        ? [jsonLd.sameAs]
        : [];
    for (const url of sameAs) {
      const host = hostnameOf(url);
      const platform = platformForHost(host);
      if (!platform || socials[platform]) continue;
      const normalized = normalizeSocialHref(url, platform);
      if (normalized) socials[platform] = normalized;
    }
    return socials;
  }

  /**
   * @returns {object} lead-shaped payload for AdHello
   */
  function extractBusinessWebsite() {
    const url = window.location.href.split('?')[0].split('#')[0];
    const origin = window.location.origin;
    const jsonLd = findBusinessJsonLd();
    const socials = applySameAsSocials(jsonLd, collectSocials(document));
    const emails = collectEmails(document);
    const phones = collectPhones(document);
    const fromLdAddr = parseAddressFromJsonLd(jsonLd);
    const fromDomAddr = fromLdAddr || findAddressFromDom(document);
    const phone =
      normalizePhone(jsonLd && jsonLd.telephone) ||
      phones[0] ||
      '';
    let email = '';
    if (jsonLd && jsonLd.email && isUsableEmail(jsonLd.email)) {
      email = String(jsonLd.email).trim().toLowerCase();
    } else {
      email = emails[0] || '';
    }

    const bits = [];
    if (emails.length > 1) bits.push(`${emails.length} emails found`);
    if (phones.length > 1) bits.push(`${phones.length} phones found`);
    const socialCount = ['facebook', 'instagram', 'twitter', 'linkedin', 'tiktok'].filter(
      (k) => socials[k],
    ).length;
    if (socialCount) bits.push(`${socialCount} social link${socialCount === 1 ? '' : 's'}`);

    const lead = {
      title: companyTitle(),
      categoryName: 'Business website',
      phone: phone || 'N/A',
      email: email || 'N/A',
      website: origin || url,
      address: (fromDomAddr && fromDomAddr.address) || 'N/A',
      city: (fromDomAddr && fromDomAddr.city) || '',
      state: (fromDomAddr && fromDomAddr.state) || '',
      zip: (fromDomAddr && fromDomAddr.zip) || '',
      postalCode: (fromDomAddr && fromDomAddr.zip) || '',
      url,
      facebook: socials.facebook || 'N/A',
      instagram: socials.instagram || 'N/A',
      twitter: socials.twitter || 'N/A',
      linkedin: socials.linkedin || 'N/A',
      tiktok: socials.tiktok || 'N/A',
      note: bits.length ? `Scraped from website · ${bits.join(' · ')}` : 'Scraped from business website',
      source: 'chrome_extension',
      sourceChannel: 'business_website',
    };

    if (jsonLd && jsonLd.aggregateRating) {
      const rating = parseFloat(jsonLd.aggregateRating.ratingValue);
      const count = parseInt(jsonLd.aggregateRating.reviewCount || jsonLd.aggregateRating.ratingCount, 10);
      if (Number.isFinite(rating) && rating > 0) lead.totalScore = rating;
      if (Number.isFinite(count) && count > 0) lead.reviewsCount = count;
    }

    return lead;
  }

  window.AdHelloWebsiteScrape = {
    isGenericBusinessWebsiteCandidate,
    isUsableEmail,
    extractBusinessWebsite,
    collectSocials,
    collectEmails,
    collectPhones,
    SOCIAL_HOSTS,
    NOISE_HOSTS,
  };

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.action !== 'scrapeBusinessWebsite') return false;
      try {
        if (!isGenericBusinessWebsiteCandidate(window.location.href)) {
          sendResponse({
            success: false,
            error: 'Not a scrapeable business website.',
            detail: null,
          });
          return true;
        }
        sendResponse({ success: true, detail: extractBusinessWebsite() });
      } catch (err) {
        sendResponse({ success: false, error: err?.message || String(err), detail: null });
      }
      return true;
    });
  }
})();
