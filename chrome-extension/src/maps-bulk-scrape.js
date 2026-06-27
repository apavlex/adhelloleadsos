/**
 * Google Maps search-results bulk scraper for AdHello Leads.
 * Scrolls the results feed and extracts visible listings.
 */
(function () {
  'use strict';

  const PHONE_RE = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/;
  const SKIP_LABEL_RE =
    /^(Open|Closed|Opens?|Closes?|Order online|Book online|Reserve|Directions|Website|Call|Menu|View|Save|Share|Search|More|View all|See all|Filter|Sort)$/i;
  const SOCIAL_BLOCK = ['facebook.com', 'instagram.com', 'twitter.com', 'yelp.com'];
  const AD_HOST_BLOCK = [
    'google.com',
    'goo.gl',
    'googleadservices',
    'gclid=',
    '/pagead/',
    'doubleclick.net',
  ];

  let stopPreload = false;

  function isGoogleMapsPage() {
    const host = window.location.hostname.toLowerCase();
    return (
      host.includes('google.com/maps') ||
      host.includes('maps.google.com') ||
      (host.includes('google.com') && window.location.pathname.startsWith('/maps'))
    );
  }

  function isSkipLabel(text) {
    return SKIP_LABEL_RE.test(String(text || '').trim());
  }

  function looksLikeAddress(text) {
    const s = String(text || '').trim();
    if (!s || s.length < 5 || s.length > 150) return false;
    if (!/\d/.test(s) || !/[a-zA-Z]/.test(s)) return false;
    if (/^(Open|Closed|Opens?|Closes?)/i.test(s)) return false;
    if (PHONE_RE.test(s)) return false;
    return /\b(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|pl|place|ct|court|pkwy|parkway|hwy|highway|cir|circle|\d{5})\b/i.test(
      s,
    );
  }

  function isLikelyCategory(text) {
    const s = String(text || '').trim();
    if (!s || s.length < 3 || s.length > 50) return false;
    return ![
      PHONE_RE,
      /@/,
      /\b\d{5}(-\d{4})?\b/,
      /\?/,
      /^\d+(\.\d+)?$/,
      /\(\d+\s*reviews?\)/i,
      /^no\s*reviews?$/i,
      /^(website|directions|book\s*online|order\s*online|call|menu|reserve|share|save|claim|more\s*info)$/i,
    ].some((re) => re.test(s));
  }

  function isCleanWebsite(url) {
    if (!url) return false;
    const t = url.toLowerCase();
    return !AD_HOST_BLOCK.some((h) => t.includes(h));
  }

  function findBusinessContainers() {
    const feed = document.querySelector('div[role="feed"]');
    if (!feed) return [];
    return Array.from(feed.children).filter((el) => {
      if (el.textContent.trim().length < 20) return false;
      const stars = el.querySelector('[aria-label*="star"]') || el.querySelector('[aria-label*="stars"]');
      const placeLink = el.querySelector('a[href*="/maps/place/"]');
      return !!(stars || placeLink);
    });
  }

  function extractFromContainer(container) {
    const row = {
      'Business Name': '',
      Address: '',
      Rating: '',
      'Review Count': '',
      Category: '',
      Sponsored: 'No',
      'Google Maps URL': '',
      'Phone Number': '',
      Website: '',
      'Review Snippet': '',
      'Extraction Date': new Date().toISOString().split('T')[0],
    };

    const leafNodes = Array.from(container.querySelectorAll('div, span')).filter(
      (el) => !el.querySelector('div, span'),
    );
    const ariaNodes = container.querySelectorAll('[aria-label]');
    const links = container.querySelectorAll('a[href^="http"]');
    const textBlob = container.textContent || '';

    if (textBlob.includes('Sponsored') || textBlob.includes('Ad ·') || container.querySelector('[aria-label*="Sponsored"]')) {
      row.Sponsored = 'Yes';
    }

    const placeLink = container.querySelector('a[href*="/maps/place/"]');
    if (placeLink) {
      const label = placeLink.getAttribute('aria-label') || placeLink.textContent.trim();
      if (label && !isSkipLabel(label)) {
        row['Business Name'] = label;
        row['Google Maps URL'] = placeLink.href;
      }
    }

    const starsEl = container.querySelector('[aria-label*="star"]') || container.querySelector('[aria-label*="stars"]');
    if (starsEl) {
      const label = starsEl.getAttribute('aria-label') || '';
      const ratingMatch = label.match(/(\d+\.?\d*)\s*star/i);
      if (ratingMatch) row.Rating = ratingMatch[1];
      const reviewMatch = label.match(/(\d{1,3}(?:,\d{3})*|\d+)\s*review/i);
      if (reviewMatch) row['Review Count'] = reviewMatch[1].replace(/,/g, '');
    }

    for (const el of leafNodes) {
      const t = el.textContent.trim();
      if (looksLikeAddress(t)) {
        row.Address = t.replace(/^[^·]+·\s*/, '').trim();
        break;
      }
    }

    for (const el of ariaNodes) {
      const label = el.getAttribute('aria-label') || '';
      if (/\d-star hotel/i.test(label)) {
        const m = label.match(/(\d-star hotel)/i);
        if (m) {
          row.Category = m[1];
          break;
        }
      }
    }

    if (!row.Category) {
      const skipWords = new Set([
        'Free breakfast',
        'Free Wi-Fi',
        'Free parking',
        'Pool',
        'Sponsored',
      ]);
      for (const el of leafNodes) {
        const t = el.textContent.trim();
        if (skipWords.has(t)) continue;
        if (/\d-star hotel/i.test(t)) {
          const m = t.match(/(\d-star hotel)/i);
          if (m) {
            row.Category = m[1];
            break;
          }
        }
        if (
          isLikelyCategory(t) &&
          t !== row['Business Name'] &&
          t !== row.Address &&
          !/\d/.test(t) &&
          !t.includes('$') &&
          !/^(Open|Closed|Opens?|Closes?)/i.test(t)
        ) {
          row.Category = t;
          break;
        }
      }
    }

    for (const el of leafNodes) {
      const t = el.textContent.trim();
      if (t.startsWith('"') && t.length > 20 && !t.includes('Order online')) {
        row['Review Snippet'] = t.replace(/\s+(Order online|Check wait time|View menu).*$/i, '').trim();
        break;
      }
    }

    const telLink = container.querySelector('a[href^="tel:"]');
    if (telLink) {
      row['Phone Number'] = telLink.href.replace(/^tel:/i, '').trim();
    } else {
      for (const el of leafNodes) {
        const t = el.textContent.trim();
        const m = t.match(PHONE_RE);
        if (!m) continue;
        const phone = m[0];
        const mostlyPhone = t === phone || t.length < phone.length + 10;
        const notMeta = !t.includes('reviews') && !t.includes('Stars') && !/^\(\d+\)$/.test(t);
        if (mostlyPhone && notMeta) {
          row['Phone Number'] = phone;
          break;
        }
      }
    }

    for (const link of links) {
      const href = link.href;
      if ([...SOCIAL_BLOCK, 'opentable.com', 'resy.com'].some((d) => href.includes(d))) continue;
      if (!isCleanWebsite(href)) continue;
      const label = (link.textContent + ' ' + (link.getAttribute('aria-label') || '')).toLowerCase();
      if (label.includes('website') || label.includes('visit')) {
        row.Website = href;
        break;
      }
    }

    return row['Business Name'] ? row : null;
  }

  function extractAllCompanies() {
    const containers = findBusinessContainers();
    const companies = [];
    const seen = new Set();
    containers.forEach((container, idx) => {
      try {
        const row = extractFromContainer(container);
        if (!row) return;
        const key = `${row['Business Name']}|${row['Phone Number']}|${row.Address}`.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        companies.push(row);
      } catch (err) {
        console.warn('[AdHello bulk] container error', idx, err);
      }
    });
    return companies;
  }

  function findScrollContainer() {
    const feed = document.querySelector('div[role="feed"]');
    if (feed && feed.scrollHeight > feed.clientHeight) return feed;
    if (feed) {
      let parent = feed.parentElement;
      while (parent && parent !== document.body) {
        if (parent.scrollHeight > parent.clientHeight + 100) return parent;
        parent = parent.parentElement;
      }
    }
    let best = null;
    let bestScore = 0;
    for (const el of document.querySelectorAll('div')) {
      if (el.scrollHeight <= el.clientHeight + 50) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 200 || rect.height < 300) continue;
      if (rect.left > window.innerWidth * 0.5) continue;
      const score = (el.scrollHeight - el.clientHeight) * rect.height;
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return best;
  }

  function countVisibleRows() {
    const articles = document.querySelectorAll(
      'div[role="feed"] > div[role="article"], div[role="feed"] > div > div[role="article"]',
    );
    if (articles.length) return articles.length;
    const feed = document.querySelector('div[role="feed"]');
    if (!feed) return 0;
    return Array.from(feed.children).filter((el) => {
      if (el.textContent.trim().length < 20) return false;
      return el.getBoundingClientRect().height >= 50;
    }).length;
  }

  function waitForFeedIdle(container, idleMs = 800, maxMs = 10000) {
    return new Promise((resolve) => {
      let idleTimer = null;
      let maxTimer = null;
      const done = (reason) => {
        if (idleTimer) clearTimeout(idleTimer);
        if (maxTimer) clearTimeout(maxTimer);
        observer.disconnect();
        resolve(reason);
      };
      const observer = new MutationObserver(() => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => done('idle'), idleMs);
      });
      observer.observe(container, { childList: true, subtree: true });
      idleTimer = setTimeout(() => done('idle'), idleMs);
      maxTimer = setTimeout(() => done('timeout'), maxMs);
    });
  }

  async function preloadAllResults(onProgress) {
    stopPreload = false;
    const container = findScrollContainer();
    if (!container) return { success: false, reason: 'no_container', businessCount: 0, scrollAttempts: 0 };

    let noGrowth = 0;
    let attempts = 0;
    const maxAttempts = 200;

    while (noGrowth < 3 && attempts < maxAttempts && !stopPreload) {
      attempts += 1;
      const beforeCount = countVisibleRows();
      const beforeHeight = container.scrollHeight;
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
      await waitForFeedIdle(container);
      const afterCount = countVisibleRows();
      const afterHeight = container.scrollHeight;
      const grew = afterHeight > beforeHeight || afterCount > beforeCount;

      if (typeof onProgress === 'function') {
        onProgress({ scrollAttempts: attempts, businessCount: afterCount });
      }
      try {
        chrome.runtime.sendMessage({
          action: 'bulkScrapeProgress',
          businessCount: afterCount,
          scrollAttempts: attempts,
        });
      } catch (_) {
        /* ignore */
      }

      if (grew) noGrowth = 0;
      else noGrowth += 1;
    }

    const businessCount = countVisibleRows();
    return {
      success: true,
      businessCount,
      scrollAttempts: attempts,
      reachedEnd: noGrowth >= 3,
      stoppedByUser: stopPreload,
    };
  }

  function readSearchQuery() {
    const pathMatch = window.location.href.match(/\/maps\/search\/([^/@]+)/);
    if (pathMatch) return decodeURIComponent(pathMatch[1].replace(/\+/g, ' '));
    const q = new URLSearchParams(window.location.search).get('q');
    if (q) return q;
    const input = document.querySelector('input#searchboxinput');
    return input?.value?.trim() || 'maps-scrape';
  }

  function parseCityStateFromAddress(address) {
    if (window.AdHelloAddressUtils?.parseCityState) {
      return window.AdHelloAddressUtils.parseCityState(address);
    }
    const parts = String(address || '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length < 2) return { city: '', state: '' };
    const last = parts[parts.length - 1];
    const stateMatch = last.match(/\b([A-Z]{2})\b/);
    const city = parts.length >= 3 ? parts[parts.length - 2] : parts[0];
    return { city: city || '', state: stateMatch ? stateMatch[1] : '' };
  }

  function mapCompanyToCsvRow(company) {
    const address = String(company.Address || '').trim();
    const geo = parseCityStateFromAddress(address);
    const reviewCount = String(company['Review Count'] || '').replace(/[^\d]/g, '');
    let snippet = String(company['Review Snippet'] || '').trim();
    if (snippet.startsWith('"') && snippet.endsWith('"')) {
      snippet = snippet.slice(1, -1).trim();
    }
    return {
      company_name: company['Business Name'] || '',
      phone_number: company['Phone Number'] || '',
      company_location: address,
      city: geo.city,
      state: geo.state,
      company_type: company.Category || '',
      rating: company.Rating || '',
      review_count: reviewCount,
      review_snippet: snippet,
      sponsored: company.Sponsored || '',
      company_website: company.Website || '',
      google_maps_url: company['Google Maps URL'] || '',
      source: 'chrome_extension_maps_bulk',
    };
  }

  function companiesToCsv(companies) {
    if (!companies.length) return '';
    const rows = companies.map(mapCompanyToCsvRow);
    const headers = [
      'company_name',
      'phone_number',
      'company_location',
      'city',
      'state',
      'company_type',
      'rating',
      'review_count',
      'review_snippet',
      'sponsored',
      'company_website',
      'google_maps_url',
      'source',
    ];
    const esc = (val) => {
      const s = val == null ? '' : String(val);
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    let csv = headers.join(',') + '\n';
    rows.forEach((row) => {
      csv += headers.map((h) => esc(row[h] ?? '')).join(',') + '\n';
    });
    return csv;
  }

  window.AdHelloMapsBulk = {
    isGoogleMapsPage,
    extractAllCompanies,
    preloadAllResults,
    companiesToCsv,
    mapCompanyToCsvRow,
    readSearchQuery,
    stopPreload: () => {
      stopPreload = true;
    },
  };

  if (!isGoogleMapsPage()) return;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const action = message?.action;
    if (action === 'bulkGetCompanies') {
      try {
        const companies = extractAllCompanies();
        sendResponse({ companies, searchQuery: readSearchQuery() });
      } catch (err) {
        sendResponse({ companies: [], searchQuery: readSearchQuery(), error: err.message });
      }
      return true;
    }
    if (action === 'bulkPreload') {
      preloadAllResults()
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ success: false, reason: 'error', error: err.message }));
      return true;
    }
    if (action === 'bulkStopPreload') {
      stopPreload = true;
      sendResponse({ success: true });
      return true;
    }
    return false;
  });
})();
