/**
 * Google Maps search-results bulk scraper for AdHello Leads.
 * Scrolls the results feed and extracts visible listings.
 */
(function () {
  'use strict';

  const PHONE_RE = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/;
  const SKIP_LABEL_RE =
    /^(Open|Closed|Opens?|Closes?|Order online|Book online|Reserve|Directions|Website|Call|Menu|View|Save|Share|Search|More|View all|See all|Filter|Sort)$/i;
  const SOCIAL_BLOCK = ['facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'yelp.com'];
  const BOOKING_BLOCK = [
    'opentable.com',
    'resy.com',
    'bookatable.',
    'tock.com',
    'thumbtack.com',
    'angi.com',
    'homeadvisor.com',
    'calendly.com',
    'booksy.com',
    'setmore.com',
  ];
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

  function isBlockedWebsite(url) {
    if (!url) return true;
    const t = url.toLowerCase();
    if (AD_HOST_BLOCK.some((h) => t.includes(h))) return true;
    if (SOCIAL_BLOCK.some((d) => t.includes(d))) return true;
    if (BOOKING_BLOCK.some((d) => t.includes(d))) return true;
    return false;
  }

  function pickWebsiteFromLinks(links, requireLabel = false) {
    for (const link of links) {
      const href = link.href;
      if (!href || !/^https?:\/\//i.test(href)) continue;
      if (isBlockedWebsite(href)) continue;
      const label = `${link.textContent || ''} ${link.getAttribute('aria-label') || ''}`.toLowerCase();
      if (requireLabel && !label.includes('website') && !label.includes('visit')) continue;
      return href.split('?')[0];
    }
    if (requireLabel) return '';
    for (const link of links) {
      const href = link.href;
      if (!href || !/^https?:\/\//i.test(href)) continue;
      if (isBlockedWebsite(href)) continue;
      return href.split('?')[0];
    }
    return '';
  }

  function extractAddressFromContainer(container) {
    for (const el of container.querySelectorAll('[aria-label*="Address"], [data-tooltip*="address" i]')) {
      const val = window.AdHelloAddressUtils?.extractAddressFromElement?.(el) || '';
      if (val && val.length >= 5) return val;
    }

    const leafNodes = Array.from(container.querySelectorAll('div, span')).filter(
      (el) => !el.querySelector('div, span'),
    );
    for (const el of leafNodes) {
      const t = el.textContent.trim();
      if (!looksLikeAddress(t)) continue;
      let addr = t.replace(/^[^·]+·\s*/, '').trim();
      if (addr.includes('·')) {
        const parts = t
          .split('·')
          .map((p) => p.trim())
          .filter(Boolean);
        if (parts.length >= 2) addr = `${parts[0]} · ${parts.slice(1).join(', ')}`;
      }
      return addr;
    }
    return '';
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
      City: '',
      State: '',
      Rating: '',
      'Review Count': '',
      Category: '',
      Sponsored: 'No',
      'Google Maps URL': '',
      'Phone Number': '',
      Website: '',
      'Booking URL': '',
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

    const addrFromContainer = extractAddressFromContainer(container);
    if (addrFromContainer) {
      row.Address = addrFromContainer;
    } else {
      for (const el of leafNodes) {
        const t = el.textContent.trim();
        if (looksLikeAddress(t)) {
          row.Address = t.replace(/^[^·]+·\s*/, '').trim();
          break;
        }
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

    row.Website = pickWebsiteFromLinks(links, true) || pickWebsiteFromLinks(links, false);

    for (const link of links) {
      const href = link.href;
      if (!href || isBlockedWebsite(href)) continue;
      if (!BOOKING_BLOCK.some((d) => href.includes(d))) continue;
      row['Booking URL'] = href.split('?')[0];
      break;
    }

    const geo = parseCityStateFromAddress(row.Address);
    if (geo.city) row.City = geo.city;
    if (geo.state) row.State = geo.state;

    return row['Business Name'] ? row : null;
  }

  function readSearchAreaContext() {
    const href = window.location.href;
    const inMatch = href.match(/\/in\/([^/@]+)/i);
    if (inMatch) {
      const decoded = decodeURIComponent(inMatch[1].replace(/\+/g, ' ')).trim();
      const parts = decoded.split(',').map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        return { city: parts[0], state: parts[parts.length - 1].replace(/\d{5}.*/, '').trim() };
      }
      return { city: decoded, state: '' };
    }

    const q = readSearchQuery();
    const nearMatch = q.match(/\bnear\s+(.+)$/i);
    if (nearMatch) {
      const parts = nearMatch[1].split(',').map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        return { city: parts[0], state: parts[parts.length - 1].replace(/\d{5}.*/, '').trim() };
      }
    }

    const stateTail = q.match(/(.+?)[,\s]+([A-Z]{2})\s*$/);
    if (stateTail) {
      const cityPart = stateTail[1]
        .replace(/^.*\b(in|near)\b\s+/i, '')
        .trim()
        .split(/\s+/)
        .slice(-2)
        .join(' ');
      return { city: cityPart, state: stateTail[2].toUpperCase() };
    }

    return { city: '', state: '' };
  }

  function waitMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitForDetailPanel(businessName, maxMs = 6000) {
    const needle = String(businessName || '')
      .trim()
      .slice(0, 12)
      .toLowerCase();
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const h1 = document.querySelector('h1.DUwDvf, h1[aria-level="1"]');
      const title = (h1?.textContent || '').trim().toLowerCase();
      if (needle && title.includes(needle)) {
        const hasDetail =
          document.querySelector('[data-item-id="address"], a[data-item-id="authority"], button[data-item-id="address"]');
        if (hasDetail) return true;
      }
      await waitMs(120);
    }
    return false;
  }

  function scrapeOpenDetailPanel() {
    const out = { Website: '', Address: '', 'Phone Number': '' };
    const websiteEl = document.querySelector(
      'a[data-item-id="authority"], a[aria-label*="website" i][href^="http"], a[data-tooltip*="website" i][href^="http"]',
    );
    if (websiteEl?.href && !isBlockedWebsite(websiteEl.href)) {
      out.Website = websiteEl.href.split('?')[0];
    }

    const addressEl = document.querySelector(
      'button[data-item-id="address"], [data-item-id="address"], button[aria-label*="Address"]',
    );
    if (addressEl) {
      const addr = window.AdHelloAddressUtils?.extractAddressFromElement?.(addressEl) || '';
      if (addr) out.Address = addr;
    }

    const tel = document.querySelector('button[data-item-id^="phone"], a[href^="tel:"]');
    if (tel) {
      const phone = tel.getAttribute('href')?.replace(/^tel:/i, '') || tel.textContent || '';
      if (phone) out['Phone Number'] = phone.trim();
    }

    return out;
  }

  function findContainerForCompany(containers, company) {
    const name = String(company['Business Name'] || '').trim().toLowerCase();
    if (!name) return null;
    return (
      containers.find((container) => {
        const link = container.querySelector('a[href*="/maps/place/"]');
        const label = (link?.getAttribute('aria-label') || link?.textContent || '').trim().toLowerCase();
        return label === name || label.startsWith(name) || name.startsWith(label);
      }) || null
    );
  }

  async function enrichCompaniesFromDetailPanels(companies, onProgress) {
    const containers = findBusinessContainers();
    const area = readSearchAreaContext();
    let enrichedCount = 0;

    for (let i = 0; i < companies.length; i += 1) {
      const company = companies[i];
      if (typeof onProgress === 'function') {
        onProgress({ phase: 'enrich', current: i + 1, total: companies.length, name: company['Business Name'] });
      }
      try {
        chrome.runtime.sendMessage({
          action: 'bulkScrapeProgress',
          phase: 'enrich',
          current: i + 1,
          total: companies.length,
          businessCount: companies.length,
        });
      } catch (_) {
        /* ignore */
      }

      const container = findContainerForCompany(containers, company);
      if (!container) continue;

      const needsDetail =
        !company.Website ||
        !String(company.Address || '').includes(',') ||
        !company['Phone Number'];
      if (!needsDetail && company.City && company.State) continue;

      const link = container.querySelector('a[href*="/maps/place/"]');
      if (!link) continue;

      link.scrollIntoView({ block: 'center', behavior: 'instant' in Object ? 'instant' : 'auto' });
      link.click();
      const loaded = await waitForDetailPanel(company['Business Name']);
      if (!loaded) continue;

      const detail = scrapeOpenDetailPanel();
      if (detail.Website && !company.Website) {
        company.Website = detail.Website;
        enrichedCount += 1;
      }
      if (detail.Address && (!company.Address || !company.Address.includes(','))) {
        company.Address = detail.Address;
      }
      if (detail['Phone Number'] && !company['Phone Number']) {
        company['Phone Number'] = detail['Phone Number'];
      }

      if (!company.City && area.city) company.City = area.city;
      if (!company.State && area.state) company.State = area.state;
    }

    return { companies, enrichedCount };
  }

  async function extractAllCompanies(options = {}) {
    const containers = findBusinessContainers();
    const companies = [];
    const seen = new Set();
    const area = readSearchAreaContext();

    containers.forEach((container, idx) => {
      try {
        const row = extractFromContainer(container);
        if (!row) return;
        const key = `${row['Business Name']}|${row['Phone Number']}|${row.Address}`.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        if (!row.City && area.city) row.City = area.city;
        if (!row.State && area.state) row.State = area.state;
        if (row.Address && (!row.City || !row.State)) {
          const geo = parseCityStateFromAddress(row.Address);
          if (!row.City && geo.city) row.City = geo.city;
          if (!row.State && geo.state) row.State = geo.state;
        }
        companies.push(row);
      } catch (err) {
        console.warn('[AdHello bulk] container error', idx, err);
      }
    });

    if (options.enrichDetails) {
      return enrichCompaniesFromDetailPanels(companies, options.onProgress);
    }
    return { companies, enrichedCount: 0 };
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
      const parsed = window.AdHelloAddressUtils.parseCityState(address);
      return { city: parsed.city || '', state: parsed.state || '' };
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
    const parsed = window.AdHelloAddressUtils?.parseCityState
      ? window.AdHelloAddressUtils.parseCityState(address)
      : { street: address, city: '', state: '' };
    const city = String(company.City || parsed.city || '').trim();
    const state = String(company.State || parsed.state || '').trim();
    const street = parsed.street || address;
    const fullAddress =
      city && state ? `${street}, ${city}, ${state}` : city ? `${street}, ${city}` : street;
    const reviewCount = String(company['Review Count'] || '').replace(/[^\d]/g, '');
    let snippet = String(company['Review Snippet'] || '').trim();
    if (snippet.startsWith('"') && snippet.endsWith('"')) {
      snippet = snippet.slice(1, -1).trim();
    }
    const website = String(company.Website || '').trim();
    const domain = window.AdHelloAddressUtils?.hostnameFromUrl?.(website) || '';
    return {
      company_name: company['Business Name'] || '',
      phone_number: company['Phone Number'] || '',
      company_location: fullAddress || address,
      address: fullAddress || address,
      city,
      state,
      company_type: company.Category || '',
      category: company.Category || '',
      rating: company.Rating || '',
      review_count: reviewCount,
      review_snippet: snippet,
      sponsored: company.Sponsored || '',
      company_website: website,
      website: website,
      company_domain: domain,
      domain: domain,
      google_maps_url: company['Google Maps URL'] || '',
      booking_url: company['Booking URL'] || '',
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
      'address',
      'city',
      'state',
      'company_type',
      'category',
      'rating',
      'review_count',
      'review_snippet',
      'sponsored',
      'company_website',
      'website',
      'company_domain',
      'domain',
      'google_maps_url',
      'booking_url',
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
      const enrichDetails = !!message?.enrichDetails;
      extractAllCompanies({
        enrichDetails,
        onProgress: () => {},
      })
        .then(({ companies, enrichedCount }) => {
          sendResponse({ companies, searchQuery: readSearchQuery(), enrichedCount });
        })
        .catch((err) => {
          sendResponse({ companies: [], searchQuery: readSearchQuery(), error: err.message });
        });
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
