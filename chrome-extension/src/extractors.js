(function () {
  function meta(prop) {
    const el = document.querySelector(`meta[property="${prop}"], meta[name="${prop}"]`);
    return el?.content?.trim() || '';
  }

  function text(sel) {
    const el = document.querySelector(sel);
    return el?.textContent?.trim() || '';
  }

  function texts(sels) {
    for (const sel of sels) {
      const val = text(sel);
      if (val) return val;
    }
    return '';
  }

  function cleanTitle(raw) {
    return String(raw || '')
      .replace(/\s*[|\-–—]\s*LinkedIn.*$/i, '')
      .replace(/\s*[|\-–—]\s*Facebook.*$/i, '')
      .replace(/\s*[|\-–—]\s*Instagram.*$/i, '')
      .replace(/\s*[|\-–—]\s*Yelp.*$/i, '')
      .replace(/\s*[|\-–—]\s*Google Maps.*$/i, '')
      .replace(/\s*[|\-–—]\s*Tripadvisor.*$/i, '')
      .replace(/\s*[|\-–—]\s*Groupon.*$/i, '')
      .replace(/\s*[|\-–—]\s*Craigslist.*$/i, '')
      .replace(/\s*[|\-–—]\s*Nextdoor.*$/i, '')
      .replace(/\s*[|\-–—]\s*Houzz.*$/i, '')
      .replace(/\(@[^)]+\)/g, '')
      .replace(/\s*-\s*Google Maps$/i, '')
      .trim();
  }

  function canonicalUrl() {
    const link = document.querySelector('link[rel="canonical"]');
    if (link?.href) return link.href.split('?')[0].split('#')[0];
    return window.location.href.split('?')[0].split('#')[0];
  }

  function normalizePhone(raw) {
    const digits = String(raw || '').replace(/\D/g, '');
    if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    if (digits.length === 11 && digits[0] === '1') {
      return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
    }
    return String(raw || '').trim();
  }

  function findTelPhone() {
    const tel = document.querySelector('a[href^="tel:"]');
    if (tel) return normalizePhone(tel.href.replace(/^tel:/i, '') || tel.textContent);
    const phoneMatch = document.body?.innerText?.match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
    return phoneMatch ? normalizePhone(phoneMatch[0]) : '';
  }

  function findExternalWebsite(blocklist) {
    const blocked = blocklist || [];
    const anchors = document.querySelectorAll('a[href^="http"]');
    for (const a of anchors) {
      const href = a.href || '';
      if (blocked.some((d) => href.includes(d))) continue;
      if (/^(mailto:|javascript:)/i.test(href)) continue;
      try {
        const host = new URL(href).hostname;
        if (blocked.some((d) => host.includes(d))) continue;
      } catch (_) {
        continue;
      }
      return href.split('?')[0];
    }
    return '';
  }

  function parseCityState(address) {
    const raw = cleanAddress(address);
    if (!raw) return { city: '', state: '' };
    const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 3) {
      const stateZip = parts[parts.length - 1];
      const state = stateZip.replace(/\d{5}(-\d{4})?.*$/, '').trim();
      return { city: parts[parts.length - 2], state };
    }
    if (parts.length === 2) {
      return { city: parts[0], state: parts[1].replace(/\d{5}(-\d{4})?.*$/, '').trim() };
    }
    return { city: raw, state: '' };
  }

  function parseRating(raw) {
    const m = String(raw || '').match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : 0;
  }

  function parseReviewCount(raw) {
    const s = String(raw || '');
    const labeled = s.replace(/,/g, '').match(/(\d+)\s*reviews?\b/i);
    if (labeled) return parseInt(labeled[1], 10);
    const paren = s.replace(/,/g, '').match(/\((\d+)\)/);
    if (paren) return parseInt(paren[1], 10);
    return 0;
  }

  function findGoogleMapsPlaceRoot() {
    const h1 = document.querySelector('h1.DUwDvf, h1[aria-level="1"]');
    if (!h1) return null;
    return (
      h1.closest('[role="main"]') ||
      h1.closest('.x3AX1-L') ||
      h1.closest('.TIHn2') ||
      h1.parentElement?.parentElement?.parentElement ||
      h1.parentElement
    );
  }

  function textIn(scope, sel) {
    const root = scope || document;
    const el = root.querySelector(sel);
    return el?.textContent?.trim() || '';
  }

  function textsIn(scope, sels) {
    for (const sel of sels) {
      const val = textIn(scope, sel);
      if (val) return val;
    }
    return '';
  }

  const cleanAddress =
    window.AdHelloAddressUtils && typeof window.AdHelloAddressUtils.cleanAddress === 'function'
      ? window.AdHelloAddressUtils.cleanAddress
      : function cleanAddressFallback(raw) {
          return String(raw || '')
            .replace(/[\uE000-\uF8FF\u200B-\u200D\uFEFF]/g, '')
            .replace(/^[^\dA-Za-z#]+/, '')
            .trim();
        };

  const extractAddressFromElement =
    window.AdHelloAddressUtils && typeof window.AdHelloAddressUtils.extractAddressFromElement === 'function'
      ? window.AdHelloAddressUtils.extractAddressFromElement
      : function extractAddressFromElementFallback(el) {
          if (!el) return '';
          return cleanAddress(el.textContent || '');
        };

  function isGenericMapsTitle(title) {
    const s = String(title || '').trim();
    return !s || /^(results?|search)$/i.test(s) || isGenericMapsSeoText(s);
  }

  function isGenericMapsSeoText(text) {
    const s = String(text || '').trim();
    if (!s) return true;
    return /find local businesses|view maps and get driving directions|google maps$/i.test(s);
  }

  function googleMapsAddress(placeRoot) {
    const root = placeRoot || document;
    const selectors = [
      'button[data-item-id="address"]',
      '[data-item-id="address"]',
      'button[aria-label*="Address"]',
      '[data-tooltip="Copy address"]',
    ];
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      const val = extractAddressFromElement(el);
      if (val && !isGenericMapsSeoText(val)) return val;
    }
    const ogDesc = cleanAddress(meta('og:description'));
    return isGenericMapsSeoText(ogDesc) ? '' : ogDesc;
  }

  function isGoogleMapsPlaceDetailPage(url, path) {
    if (path.includes('/maps/place') || /!1s0x|\/place\//.test(url)) return true;
    const h1 = document.querySelector('h1.DUwDvf, h1[aria-level="1"]');
    const title = cleanTitle(h1?.textContent || '');
    if (!title || /^(results?|search)$/i.test(title)) return false;
    const placeRoot = findGoogleMapsPlaceRoot();
    if (!placeRoot) return false;
    const address = googleMapsAddress(placeRoot);
    if (address) return true;
    return !!placeRoot.querySelector('[role="img"][aria-label*="star"], [aria-label*="reviews"]');
  }

  function parseGoogleMapsReviewsFromDom(scope) {
    let reviewsCount = 0;
    let rating = 0;
    const root = scope || findGoogleMapsPlaceRoot() || document;

    function applyCandidate(label, text) {
      const combined = [label, text].filter(Boolean).join(' ');
      const nextRating = parseRating(combined);
      const nextReviews = parseReviewCount(combined);
      if (nextRating > 0) rating = nextRating;
      if (nextReviews > 0) reviewsCount = nextReviews;
    }

    const nice = root.querySelector('.F7nice');
    if (nice) {
      applyCandidate(nice.getAttribute('aria-label') || '', nice.textContent || '');
      const parent = nice.parentElement;
      if (parent) {
        parent.querySelectorAll('button, span, a').forEach((el) => {
          if (reviewsCount > 0 && rating > 0) return;
          applyCandidate(el.getAttribute('aria-label') || '', el.textContent || '');
        });
      }
      if (rating > 0 && reviewsCount > 0) return { rating, reviewsCount };
    }

    const starEl = root.querySelector('[role="img"][aria-label*="star"]');
    if (starEl) {
      applyCandidate(starEl.getAttribute('aria-label') || '', starEl.textContent || '');
      if (rating > 0 && reviewsCount > 0) return { rating, reviewsCount };
    }

    const reviewBtn = root.querySelector(
      'button[aria-label*="reviews"], button[jsaction*="review"], [data-item-id*="review"]',
    );
    if (reviewBtn) {
      applyCandidate(reviewBtn.getAttribute('aria-label') || '', reviewBtn.textContent || '');
    }

    return { rating, reviewsCount };
  }

  function googleMapsReviewSnippet(placeRoot) {
    const root = placeRoot || findGoogleMapsPlaceRoot() || document;
    const skip = /^(more|see all|reviews?|google|translated|original)$/i;
    const selectors = [
      '.MyEned span',
      '.MyEned',
      '.wiI7pd span',
      '.wiI7pd',
      '[data-review-id] .wiI7pd',
      '[data-review-id] span[jslog]',
      'div[aria-label*="review" i] .MyEned',
    ];
    for (const sel of selectors) {
      const nodes = root.querySelectorAll(sel);
      for (const el of nodes) {
        let text = String(el.textContent || '')
          .replace(/\s+/g, ' ')
          .trim()
          .replace(/^["']+|["']+$/g, '')
          .trim();
        if (text.length < 12) continue;
        if (skip.test(text)) continue;
        if (/^\(\d+\)$/.test(text)) continue;
        if (/^\d+(\.\d+)?\s*stars?\b/i.test(text)) continue;
        return text.slice(0, 2000);
      }
    }
    return '';
  }

  function googleMapsSponsored(placeRoot) {
    function isSponsoredEl(el) {
      if (!el) return false;
      const t = String(el.textContent || '').trim();
      const label = String(el.getAttribute('aria-label') || '').trim();
      if (/^sponsored$/i.test(t)) return true;
      if (/\bsponsored\b/i.test(label) && label.length < 48) return true;
      return false;
    }

    const scopes = [];
    if (placeRoot) scopes.push(placeRoot);
    const h1 = document.querySelector('h1.DUwDvf, h1[aria-level="1"]');
    if (h1) {
      const feedItem =
        h1.closest('[role="article"]') ||
        document.querySelector('[role="feed"] [aria-current="true"]') ||
        document.querySelector('[role="feed"] .Nv2PK.HHpBE') ||
        document.querySelector('[role="feed"] .hfpxzc[aria-current]')?.closest('.Nv2PK');
      if (feedItem) scopes.push(feedItem);
    }

    for (const scope of scopes) {
      for (const el of scope.querySelectorAll('span, div, button, label')) {
        if (isSponsoredEl(el)) return true;
      }
    }
    return false;
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

  function findLocalBusinessJsonLd() {
    const types = new Set([
      'LocalBusiness', 'Restaurant', 'Store', 'ProfessionalService',
      'HomeAndConstructionBusiness', 'MedicalBusiness', 'FinancialService',
      'FoodEstablishment', 'LodgingBusiness', 'AutoRepair', 'Dentist', 'Plumber',
    ]);
    const nodes = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
      try { flattenJsonLd(JSON.parse(s.textContent), nodes); } catch (_) { /* ignore */ }
    });
    return nodes.find((n) => {
      const t = n['@type'];
      if (Array.isArray(t)) return t.some((x) => types.has(x));
      return types.has(t);
    }) || null;
  }

  function businessFromJsonLd(jsonLd, defaults) {
    if (!jsonLd) return defaults || {};
    const addr = jsonLd.address || {};
    const address = typeof addr === 'string'
      ? addr
      : [addr.streetAddress, addr.addressLocality, addr.addressRegion, addr.postalCode].filter(Boolean).join(', ');
    const geo = parseCityState(address);
    return {
      title: jsonLd.name || defaults?.title || '',
      phone: normalizePhone(jsonLd.telephone || defaults?.phone || ''),
      website: jsonLd.url || jsonLd.sameAs?.find?.((u) => /^https?:\/\//.test(u)) || defaults?.website || '',
      address: address || defaults?.address || '',
      city: addr.addressLocality || geo.city || defaults?.city || '',
      state: addr.addressRegion || geo.state || defaults?.state || '',
      categoryName: jsonLd['@type'] || jsonLd.category || defaults?.categoryName || '',
      totalScore: parseRating(jsonLd.aggregateRating?.ratingValue || defaults?.totalScore || 0),
      reviewsCount: parseInt(jsonLd.aggregateRating?.reviewCount || defaults?.reviewsCount || 0, 10) || 0,
    };
  }

  function baseBusinessLead({ title, categoryName, url, sourceChannel, blocklist, noteParts }) {
    const jsonLd = findLocalBusinessJsonLd();
    const fromLd = businessFromJsonLd(jsonLd, {});
    const website = fromLd.website || findExternalWebsite(blocklist) || 'N/A';
    const phone = fromLd.phone || findTelPhone() || 'N/A';
    const address = fromLd.address || '';
    const geo = parseCityState(address);

    return {
      title: cleanTitle(title || fromLd.title) || 'Business prospect',
      categoryName: categoryName || fromLd.categoryName || 'Directory listing',
      phone,
      website,
      email: 'N/A',
      address: address || 'N/A',
      city: fromLd.city || geo.city || '',
      state: fromLd.state || geo.state || '',
      totalScore: fromLd.totalScore || 0,
      reviewsCount: fromLd.reviewsCount || 0,
      url,
      note: noteParts.filter(Boolean).join(' · '),
      source: 'chrome_extension',
      sourceChannel,
    };
  }

  const PLATFORMS = {
    linkedin: { hosts: ['linkedin.com'], label: 'LinkedIn' },
    facebook: { hosts: ['facebook.com', 'fb.com'], label: 'Facebook' },
    instagram: { hosts: ['instagram.com'], label: 'Instagram' },
    google_maps: { hosts: ['google.com', 'google.co.uk', 'google.ca'], paths: ['/maps/'], label: 'Google Maps' },
    yelp: { hosts: ['yelp.com'], paths: ['/biz/'], label: 'Yelp' },
    yellowpages: { hosts: ['yellowpages.com'], paths: ['/mip/', '/bp/'], label: 'Yellow Pages' },
    bbb: { hosts: ['bbb.org'], paths: ['/profile/', '/us/'], label: 'BBB' },
    tripadvisor: { hosts: ['tripadvisor.com'], paths: ['/Restaurant_', '/Hotel_', '/Attraction_', '/ShowUserReviews'], label: 'TripAdvisor' },
    angi: { hosts: ['angi.com'], label: 'Angi' },
    homeadvisor: { hosts: ['homeadvisor.com'], label: 'HomeAdvisor' },
    thumbtack: { hosts: ['thumbtack.com'], paths: ['/ca/', '/pro/', '/k/'], label: 'Thumbtack' },
    apple_maps: { hosts: ['maps.apple.com'], label: 'Apple Maps' },
    bing_maps: { hosts: ['bing.com'], paths: ['/maps'], label: 'Bing Maps' },
    foursquare: { hosts: ['foursquare.com'], paths: ['/v/'], label: 'Foursquare' },
    manta: { hosts: ['manta.com'], label: 'Manta' },
    citysearch: { hosts: ['citysearch.com'], label: 'Citysearch' },
    superpages: { hosts: ['superpages.com'], label: 'Superpages' },
    groupon: { hosts: ['groupon.com'], label: 'Groupon' },
    craigslist: { hosts: ['craigslist.org'], label: 'Craigslist' },
    nextdoor: { hosts: ['nextdoor.com'], label: 'Nextdoor' },
    houzz: { hosts: ['houzz.com'], label: 'Houzz' },
  };

  function detectPlatform(url) {
    let host = '';
    let path = '';
    try {
      const u = new URL(url);
      host = u.hostname.replace(/^www\./, '').toLowerCase();
      path = u.pathname.toLowerCase();
    } catch (_) {
      return 'unknown';
    }

    if (host.includes('linkedin.com')) return 'linkedin';
    if (host.includes('facebook.com') || host.includes('fb.com')) {
      if (path.includes('/marketplace/')) return 'facebook_marketplace';
      return 'facebook';
    }
    if (host.includes('instagram.com')) return 'instagram';

    const listingPlatform = window.AdHelloListingExtractors?.detectListingPlatform?.(url);
    if (listingPlatform && listingPlatform !== 'craigslist_listing') return listingPlatform;

    if ((host.endsWith('google.com') || host.startsWith('google.')) && path.includes('/maps')) return 'google_maps';
    if (host.includes('yelp.com')) return 'yelp';
    if (host.includes('yellowpages.com')) return 'yellowpages';
    if (host.includes('bbb.org')) return 'bbb';
    if (host.includes('tripadvisor.')) return 'tripadvisor';
    if (host.includes('angi.com')) return 'angi';
    if (host.includes('homeadvisor.com')) return 'homeadvisor';
    if (host.includes('thumbtack.com')) return 'thumbtack';
    if (host.includes('maps.apple.com')) return 'apple_maps';
    if (host.includes('bing.com') && path.includes('/maps')) return 'bing_maps';
    if (host.includes('foursquare.com')) return 'foursquare';
    if (host.includes('manta.com')) return 'manta';
    if (host.includes('citysearch.com')) return 'citysearch';
    if (host.includes('superpages.com')) return 'superpages';
    if (host.includes('groupon.com')) return 'groupon';
    if (host.includes('craigslist.org')) return 'craigslist';
    if (host.includes('nextdoor.com')) return 'nextdoor';
    if (host.includes('houzz.com')) return 'houzz';

    return 'unknown';
  }

  function extractLinkedIn() {
    const url = canonicalUrl();
    const isCompany = /linkedin\.com\/company\//i.test(url);
    const name = cleanTitle(texts(['h1', '[data-anonymize="person-name"]'])) || cleanTitle(meta('og:title')) || cleanTitle(document.title);
    const headline = texts(['.text-body-medium.break-words', '[data-generated-suggestion-target]', '.org-top-card-summary__tagline']) || meta('og:description');
    const location = texts(['.text-body-small.inline.t-black--light.break-words', '.org-top-card-summary-info-list__info-item']);
    const website = findExternalWebsite(['linkedin.com']) || 'N/A';

    return {
      title: name || 'LinkedIn prospect',
      categoryName: isCompany ? 'LinkedIn Company' : 'LinkedIn Profile',
      url,
      linkedin: url,
      website,
      note: [headline, location].filter(Boolean).join(' · '),
      source: 'chrome_extension',
      sourceChannel: isCompany ? 'linkedin_company' : 'linkedin_profile',
    };
  }

  function extractFacebook() {
    const url = canonicalUrl();
    const name = cleanTitle(texts(['h1'])) || cleanTitle(meta('og:title')) || cleanTitle(document.title);
    const bio = meta('og:description') || texts(['[data-ad-preview="message"]']);
    const website = findExternalWebsite(['facebook.com', 'fb.com']) || 'N/A';

    return {
      title: name || 'Facebook prospect',
      categoryName: 'Facebook Page',
      url,
      facebook: url,
      website,
      note: bio || '',
      source: 'chrome_extension',
      sourceChannel: 'facebook',
    };
  }

  function extractInstagram() {
    const url = canonicalUrl();
    const pathMatch = url.match(/instagram\.com\/([^/?#]+)/i);
    const handle = pathMatch?.[1] && !['p', 'reel', 'stories', 'explore'].includes(pathMatch[1].toLowerCase()) ? pathMatch[1] : '';
    const name = cleanTitle(texts(['header h2', 'header section h1'])) || cleanTitle(meta('og:title')) || (handle ? `@${handle}` : cleanTitle(document.title));
    const bio = meta('og:description') || '';
    const website = findExternalWebsite(['instagram.com']) || 'N/A';

    return {
      title: name || 'Instagram prospect',
      categoryName: 'Instagram Profile',
      url,
      instagram: url,
      website,
      note: bio || '',
      source: 'chrome_extension',
      sourceChannel: 'instagram',
    };
  }

  function extractGoogleMaps() {
    const url = canonicalUrl();
    const blocklist = ['google.com', 'goo.gl', 'googleusercontent.com', 'gstatic.com'];
    const placeRoot = findGoogleMapsPlaceRoot();

    let name =
      cleanTitle(textsIn(placeRoot, ['h1.DUwDvf', 'h1[aria-level="1"]', 'h1', '[data-attrid="title"]'])) ||
      cleanTitle(texts(['h1.DUwDvf', 'h1[aria-level="1"]', 'h1', '[data-attrid="title"]'])) ||
      cleanTitle(meta('og:title')) ||
      cleanTitle(document.title);
    if (isGenericMapsTitle(name)) name = '';

    const category = textsIn(placeRoot, ['button[jsaction*="category"]', '[data-item-id*="category"]', '.DkEaL']);
    const ratingText = textsIn(placeRoot, ['[role="img"][aria-label*="star"]', '.F7nice', '[jsaction*="rating"]']);
    const reviewsText = textsIn(placeRoot, [
      'button[aria-label*="reviews"]',
      'button[aria-label*="review"]',
      '[aria-label*=" reviews"]',
      '.F7nice + span',
      '.F7nice ~ button',
    ]);
    const address = googleMapsAddress(placeRoot);

    const rating = parseRating(ratingText);
    const reviewsCount = parseReviewCount(reviewsText);
    const gmapsReviews = parseGoogleMapsReviewsFromDom(placeRoot);

    const lead = baseBusinessLead({
      title: name,
      categoryName: category || 'Google Maps',
      url,
      sourceChannel: 'google_maps',
      blocklist,
      noteParts: [],
    });

    // JSON-LD on Maps often reflects brand/chain totals — use the visible listing only.
    lead.reviewsCount = 0;
    lead.totalScore = 0;

    if (address && address !== 'N/A') {
      lead.address = address;
      const geo = parseCityState(address);
      lead.city = geo.city;
      lead.state = geo.state;
    }
    const finalRating = rating > 0 ? rating : gmapsReviews.rating;
    const finalReviews = reviewsCount > 0 ? reviewsCount : gmapsReviews.reviewsCount;
    if (finalRating) lead.totalScore = finalRating;
    if (finalReviews) lead.reviewsCount = finalReviews;

    const reviewSnippet = googleMapsReviewSnippet(placeRoot);
    if (reviewSnippet) lead.reviewSnippets = [reviewSnippet];
    if (category) lead.categoryName = category;
    lead.sponsored = googleMapsSponsored(placeRoot);

    lead.note = [
      category,
      finalRating ? `${finalRating}★` : '',
      finalReviews ? `${finalReviews} reviews` : '',
    ]
      .filter(Boolean)
      .join(' · ');

    return lead;
  }

  function extractYelp() {
    const url = canonicalUrl();
    const blocklist = ['yelp.com', 'yelpcdn.com'];

    const name = cleanTitle(texts(['h1', '[data-testid="biz-name"]'])) || cleanTitle(meta('og:title'));
    const category = texts(['span[class*="category"]', '[data-testid="BizHeaderCategory"] a', '.price-category']);
    const ratingText = texts(['[aria-label*="star rating"]', '[data-testid="rating"]']);
    const reviewsText = texts(['[aria-label*="review"]', 'a[href*="#reviews"]']);
    const address = texts(['address', '[data-testid="address"]', 'p[class*="address"]']);

    const lead = baseBusinessLead({
      title: name,
      categoryName: category || 'Yelp',
      url,
      sourceChannel: 'yelp',
      blocklist,
      noteParts: [category, ratingText, reviewsText],
    });

    if (address) {
      lead.address = cleanAddress(address);
      const geo = parseCityState(address);
      lead.city = geo.city;
      lead.state = geo.state;
    }
    lead.totalScore = parseRating(ratingText) || lead.totalScore;
    lead.reviewsCount = parseReviewCount(reviewsText) || lead.reviewsCount;

    return lead;
  }

  function extractGroupon() {
    const url = canonicalUrl();
    const blocklist = ['groupon.com', 'grouponcdn.com'];

    const merchantName =
      cleanTitle(texts([
        'h1[data-bhw="MerchantName"]',
        '[data-testid="merchant-name"]',
        'a[href*="/merchant/"] h2',
        '.merchant-name',
        'h1',
      ])) || cleanTitle(meta('og:title'));

    const dealTitle = texts(['h1[data-bhw="DealTitle"]', '[data-testid="deal-title"]', '.deal-title']);
    const title = merchantName || dealTitle || cleanTitle(document.title);

    const category = texts(['[data-testid="merchant-category"]', '.breadcrumb li:last-child', 'nav[aria-label="breadcrumb"] a:last-child']);
    const address = texts(['[data-testid="merchant-address"]', '[itemprop="address"]', 'address', '.merchant-address']);
    const ratingText = texts(['[aria-label*="rating"]', '.rating-stars', '[itemprop="ratingValue"]']);

    const lead = baseBusinessLead({
      title,
      categoryName: category || 'Groupon',
      url,
      sourceChannel: 'groupon',
      blocklist,
      noteParts: [dealTitle && dealTitle !== title ? `Deal: ${dealTitle}` : '', category, ratingText, address],
    });

    if (address) {
      lead.address = cleanAddress(address);
      const geo = parseCityState(address);
      lead.city = geo.city;
      lead.state = geo.state;
    }
    lead.totalScore = parseRating(ratingText) || lead.totalScore;

    return lead;
  }

  function extractCraigslist() {
    const url = canonicalUrl();

    const rawTitle = texts(['#titletextonly', '.postingtitletext', 'h1', '.postingtitle']);
    const title = cleanTitle(rawTitle.replace(/\([^)]*\)\s*$/, '').trim()) || cleanTitle(document.title);

    const location = texts(['.postingtitletext small', '.mapaddress', '.postinginfo']);
    const body = text('#postingbody') || text('.postingbody');
    const phoneFromBody = body.match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
    const phone = phoneFromBody ? normalizePhone(phoneFromBody[0]) : findTelPhone();

    const websiteMatch = body.match(/https?:\/\/[^\s<>"']+/i);
    const website = websiteMatch ? websiteMatch[0].replace(/[.,;)]+$/, '') : findExternalWebsite(['craigslist.org']);

    const lead = baseBusinessLead({
      title: title || 'Craigslist listing',
      categoryName: 'Craigslist',
      url,
      sourceChannel: 'craigslist',
      blocklist: ['craigslist.org'],
      noteParts: [location, body ? body.slice(0, 280) : ''],
    });

    lead.phone = phone || lead.phone;
    lead.website = website || lead.website;
    if (location) {
      lead.address = location;
      const geo = parseCityState(location);
      lead.city = geo.city;
      lead.state = geo.state;
      lead.note = [location, lead.note].filter(Boolean).join(' · ');
    }

    return lead;
  }

  function extractNextdoor() {
    const url = canonicalUrl();
    const blocklist = ['nextdoor.com', 'nextdoor.io'];

    const name =
      cleanTitle(texts([
        'h1[data-testid="business-name"]',
        '[data-testid="page-title"]',
        'h1',
        '.BusinessPageHeader-title',
      ])) || cleanTitle(meta('og:title'));

    const category = texts(['[data-testid="business-category"]', '.BusinessPageHeader-category', '.category']);
    const address = texts(['[data-testid="business-address"]', 'address', '[itemprop="address"]', '.BusinessPageHeader-address']);
    const ratingText = texts(['[aria-label*="rating"]', '[data-testid="rating"]', '.rating']);

    const lead = baseBusinessLead({
      title: name || 'Nextdoor business',
      categoryName: category || 'Nextdoor',
      url,
      sourceChannel: 'nextdoor',
      blocklist,
      noteParts: [category, ratingText, meta('og:description')],
    });

    if (address) {
      lead.address = cleanAddress(address);
      const geo = parseCityState(address);
      lead.city = geo.city;
      lead.state = geo.state;
    }
    lead.totalScore = parseRating(ratingText) || lead.totalScore;

    return lead;
  }

  function extractHouzz() {
    const url = canonicalUrl();
    const blocklist = ['houzz.com', 'houzzstatic.com'];

    const name =
      cleanTitle(texts([
        'h1.pro-title',
        'h1.header-ProfessionalInfo__name',
        '[data-component="Pro Name"] h1',
        'h1',
      ])) || cleanTitle(meta('og:title'));

    const category = texts(['.pro-category', '.header-ProfessionalInfo__category', '[itemprop="jobTitle"]', '.professional-category']);
    const location = texts(['.pro-location', '.header-ProfessionalInfo__location', '[itemprop="addressLocality"]', '.professional-location']);
    const ratingText = texts(['[itemprop="ratingValue"]', '.review-rating', '[aria-label*="rating"]']);
    const reviewsText = texts(['[itemprop="reviewCount"]', '.review-count']);

    const lead = baseBusinessLead({
      title: name || 'Houzz pro',
      categoryName: category || 'Houzz Pro',
      url,
      sourceChannel: 'houzz',
      blocklist,
      noteParts: [category, location, ratingText, reviewsText],
    });

    if (location) {
      lead.address = location;
      const geo = parseCityState(location);
      lead.city = geo.city;
      lead.state = geo.state;
    }
    lead.totalScore = parseRating(ratingText) || lead.totalScore;
    lead.reviewsCount = parseReviewCount(reviewsText) || lead.reviewsCount;

    return lead;
  }

  function extractGenericDirectory({ sourceChannel, categoryName, blocklist, titleSelectors, addressSelectors }) {
    const url = canonicalUrl();
    const name =
      cleanTitle(texts(titleSelectors || ['h1', '[itemprop="name"]', '.business-name', '.listing-name'])) ||
      cleanTitle(meta('og:title')) ||
      cleanTitle(document.title);

    const category = texts(['[itemprop="category"]', '.category', '.business-category', 'nav[aria-label="breadcrumb"] li:last-child']);
    const address = texts(addressSelectors || ['address', '[itemprop="streetAddress"]', '.address', '.business-address', '[data-testid="address"]']);
    const ratingText = texts(['[itemprop="ratingValue"]', '[aria-label*="rating"]', '.rating', '.stars']);
    const reviewsText = texts(['[itemprop="reviewCount"]', '[aria-label*="review"]', '.review-count']);

    const lead = baseBusinessLead({
      title: name,
      categoryName: categoryName || category || sourceChannel,
      url,
      sourceChannel,
      blocklist: blocklist || [],
      noteParts: [category, ratingText, reviewsText, address],
    });

    if (address) {
      lead.address = cleanAddress(address);
      const geo = parseCityState(address);
      lead.city = geo.city;
      lead.state = geo.state;
    }
    lead.totalScore = parseRating(ratingText) || lead.totalScore;
    lead.reviewsCount = parseReviewCount(reviewsText) || lead.reviewsCount;

    return lead;
  }

  function sanitizeLeadAddress(lead) {
    if (!lead || typeof lead !== 'object') return lead;
    if (lead.address) lead.address = cleanAddress(lead.address);
    return lead;
  }

  function extractLeadFromPage() {
    const url = window.location.href;
    let lead = null;
    try {
      const path = new URL(url).pathname;
      const listingPlatform = window.AdHelloListingExtractors?.detectListingPlatform?.(url);
      if (listingPlatform && window.AdHelloListingExtractors?.isListingPage?.(listingPlatform, url)) {
        lead = window.AdHelloListingExtractors.extractListing(listingPlatform, path);
      }
    } catch (_) {
      /* ignore */
    }

    if (!lead) {
      const platform = detectPlatform(url);
      switch (platform) {
        case 'linkedin':
          lead = extractLinkedIn();
          break;
        case 'facebook':
          lead = extractFacebook();
          break;
        case 'instagram':
          lead = extractInstagram();
          break;
        case 'google_maps':
          lead = extractGoogleMaps();
          break;
        case 'yelp':
          lead = extractYelp();
          break;
        case 'yellowpages':
          lead = extractGenericDirectory({ sourceChannel: 'yellowpages', categoryName: 'Yellow Pages', blocklist: ['yellowpages.com'] });
          break;
        case 'bbb':
          lead = extractGenericDirectory({ sourceChannel: 'bbb', categoryName: 'BBB', blocklist: ['bbb.org'] });
          break;
        case 'tripadvisor':
          lead = extractGenericDirectory({ sourceChannel: 'tripadvisor', categoryName: 'TripAdvisor', blocklist: ['tripadvisor.'] });
          break;
        case 'angi':
          lead = extractGenericDirectory({ sourceChannel: 'angi', categoryName: 'Angi', blocklist: ['angi.com'] });
          break;
        case 'homeadvisor':
          lead = extractGenericDirectory({ sourceChannel: 'homeadvisor', categoryName: 'HomeAdvisor', blocklist: ['homeadvisor.com'] });
          break;
        case 'thumbtack':
          lead = extractGenericDirectory({ sourceChannel: 'thumbtack', categoryName: 'Thumbtack', blocklist: ['thumbtack.com'] });
          break;
        case 'apple_maps':
          lead = extractGenericDirectory({ sourceChannel: 'apple_maps', categoryName: 'Apple Maps', blocklist: ['apple.com', 'maps.apple.com'] });
          break;
        case 'bing_maps':
          lead = extractGenericDirectory({ sourceChannel: 'bing_maps', categoryName: 'Bing Maps', blocklist: ['bing.com', 'microsoft.com'] });
          break;
        case 'foursquare':
          lead = extractGenericDirectory({ sourceChannel: 'foursquare', categoryName: 'Foursquare', blocklist: ['foursquare.com'] });
          break;
        case 'manta':
          lead = extractGenericDirectory({ sourceChannel: 'manta', categoryName: 'Manta', blocklist: ['manta.com'] });
          break;
        case 'citysearch':
          lead = extractGenericDirectory({ sourceChannel: 'citysearch', categoryName: 'Citysearch', blocklist: ['citysearch.com'] });
          break;
        case 'superpages':
          lead = extractGenericDirectory({ sourceChannel: 'superpages', categoryName: 'Superpages', blocklist: ['superpages.com'] });
          break;
        case 'groupon':
          lead = extractGroupon();
          break;
        case 'craigslist':
          lead = extractCraigslist();
          break;
        case 'nextdoor':
          lead = extractNextdoor();
          break;
        case 'houzz':
          lead = extractHouzz();
          break;
        case 'zillow':
        case 'mhvillage':
        case 'realtor':
        case 'redfin':
        case 'offerup':
        case 'ebay':
        case 'facebook_marketplace':
          lead = window.AdHelloListingExtractors?.extractListing?.(platform, new URL(url).pathname) || null;
          break;
        default:
          lead = {
            title: cleanTitle(meta('og:title') || document.title) || 'Web prospect',
            categoryName: 'Web page',
            url: canonicalUrl(),
            website: canonicalUrl(),
            note: meta('og:description') || '',
            source: 'chrome_extension',
            sourceChannel: 'web',
          };
          break;
      }
    }

    return sanitizeLeadAddress(lead);
  }

  function isSupportedPage() {
    const url = window.location.href;
    let path = '';
    try {
      path = new URL(url).pathname.toLowerCase();
    } catch (_) {
      return false;
    }

    const listingPlatform = window.AdHelloListingExtractors?.detectListingPlatform?.(url);
    if (listingPlatform && window.AdHelloListingExtractors?.isListingPage?.(listingPlatform, url)) {
      return true;
    }

    const platform = detectPlatform(url);

    if (platform === 'linkedin') {
      return /\/in\//.test(path) || /\/company\//.test(path) || /\/sales\/lead\//.test(path);
    }
    if (platform === 'unknown') return false;

    if (platform === 'facebook') {
      if (path.includes('/marketplace/')) return false;
      return !['/home', '/watch', '/gaming', '/marketplace', '/groups/feed'].some((p) => path === p || path.startsWith(`${p}/`));
    }
    if (platform === 'instagram') {
      const seg = path.split('/').filter(Boolean)[0] || '';
      return seg && !['p', 'reel', 'stories', 'explore', 'direct', 'accounts'].includes(seg);
    }
    if (platform === 'google_maps') {
      return path.includes('/maps');
    }
    if (platform === 'yelp') return path.includes('/biz/');
    if (platform === 'yellowpages') return path.includes('/mip/') || path.includes('/bp/');
    if (platform === 'bbb') return path.includes('/profile/') || /\/us\/[a-z]{2}\//.test(path);
    if (platform === 'tripadvisor') {
      return ['/restaurant_', '/hotel_', '/attraction_', '/showuserreviews'].some((p) => path.includes(p));
    }
    if (platform === 'angi' || platform === 'homeadvisor' || platform === 'manta') return path.length > 1;
    if (platform === 'thumbtack') return path.includes('/pro/') || path.includes('/ca/') || path.includes('/k/');
    if (platform === 'apple_maps') return path.includes('/place') || path.includes('/search');
    if (platform === 'bing_maps') return path.includes('/maps') && (path.includes('details') || path.includes('place') || url.includes('where='));
    if (platform === 'foursquare') return path.includes('/v/');
    if (platform === 'citysearch' || platform === 'superpages') return path.length > 1;
    if (platform === 'groupon') {
      return path.includes('/deals/') || path.includes('/local/') || path.includes('/merchant/') || path.includes('/coupons/');
    }
    if (platform === 'craigslist') {
      return /\d+\.html$/i.test(path) || /\/d\/[^/]+\/\d+\.html$/i.test(path);
    }
    if (platform === 'nextdoor') {
      return path.includes('/pages/') || path.includes('/business/') || path.includes('/b/') || path.includes('/discover/');
    }
    if (platform === 'houzz') {
      return path.includes('/pro/') || path.includes('/professionals/') || path.includes('/hznb/') || path.includes('/profile/');
    }

    return false;
  }

  window.AdHelloExtractors = {
    detectPlatform,
    extractLeadFromPage,
    isSupportedPage,
    PLATFORMS,
  };
})();
