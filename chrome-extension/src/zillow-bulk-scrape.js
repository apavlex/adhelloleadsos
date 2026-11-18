/**
 * Zillow search-results bulk scraper for AdHello Leads.
 * Collects /homedetails/ links from the search list, then the background
 * opens each listing in a tab (Maps-style) to scrape property + agent card.
 */
(function () {
  'use strict';

  let stopPreload = false;

  function isZillowPage() {
    try {
      return window.location.hostname.replace(/^www\./, '').toLowerCase().includes('zillow.com');
    } catch (_) {
      return false;
    }
  }

  function isZillowSearchPage() {
    if (!isZillowPage()) return false;
    const path = window.location.pathname.toLowerCase();
    if (path.includes('/homedetails/')) return false;
    if (path.includes('/profile/') || path.includes('/agent/')) return false;
    return (
      path.includes('/homes') ||
      path.includes('/for_sale') ||
      path.includes('/for_rent') ||
      path.includes('/sold') ||
      /\/[a-z0-9-]+-[a-z]{2}(-\d+)?\//i.test(path) ||
      !!document.querySelector(
        '#search-page-list-container, [data-testid="search-page-list-container"], ul.photo-cards, [data-test="property-card"]',
      )
    );
  }

  function isZillowDetailPage() {
    if (!isZillowPage()) return false;
    return window.location.pathname.toLowerCase().includes('/homedetails/');
  }

  function normalizeHomedetailsUrl(href) {
    if (!href) return '';
    try {
      const u = new URL(href, window.location.origin);
      if (!u.hostname.includes('zillow.com')) return '';
      if (!u.pathname.includes('/homedetails/')) return '';
      u.hash = '';
      u.search = '';
      return u.toString();
    } catch (_) {
      return '';
    }
  }

  function collectListingUrlsFromDom() {
    const urls = [];
    const seen = new Set();
    const anchors = document.querySelectorAll(
      'a[href*="/homedetails/"], article a[href*="/homedetails/"], [data-test="property-card"] a[href*="/homedetails/"]',
    );
    anchors.forEach((a) => {
      const url = normalizeHomedetailsUrl(a.href || a.getAttribute('href'));
      if (!url || seen.has(url)) return;
      seen.add(url);
      urls.push(url);
    });
    return urls;
  }

  function findScrollContainer() {
    const selectors = [
      '#search-page-list-container',
      '[data-testid="search-page-list-container"]',
      '[data-testid="search-page-list"]',
      'div.search-page-list-container',
      'ul.photo-cards',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      if (el.scrollHeight > el.clientHeight + 40) return el;
      let parent = el.parentElement;
      while (parent && parent !== document.body) {
        if (parent.scrollHeight > parent.clientHeight + 80) return parent;
        parent = parent.parentElement;
      }
    }

    let best = null;
    let bestScore = 0;
    for (const el of document.querySelectorAll('div, main, section, ul')) {
      if (el.scrollHeight <= el.clientHeight + 80) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 220 || rect.height < 280) continue;
      if (rect.left > window.innerWidth * 0.65) continue;
      const hasCards =
        el.querySelector('a[href*="/homedetails/"]') ||
        el.querySelector('[data-test="property-card"]') ||
        el.querySelector('article');
      if (!hasCards) continue;
      const score = (el.scrollHeight - el.clientHeight) * rect.height;
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return best;
  }

  function countVisibleListings() {
    return collectListingUrlsFromDom().length;
  }

  function waitForListIdle(container, idleMs = 900, maxMs = 10000) {
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
    if (!container) {
      return {
        success: false,
        reason: 'no_container',
        businessCount: countVisibleListings(),
        scrollAttempts: 0,
      };
    }

    let noGrowth = 0;
    let attempts = 0;
    const maxAttempts = 160;

    while (noGrowth < 3 && attempts < maxAttempts && !stopPreload) {
      attempts += 1;
      const beforeCount = countVisibleListings();
      const beforeHeight = container.scrollHeight;
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
      await waitForListIdle(container);
      const afterCount = countVisibleListings();
      const afterHeight = container.scrollHeight;
      const grew = afterHeight > beforeHeight || afterCount > beforeCount;

      if (typeof onProgress === 'function') {
        onProgress({ scrollAttempts: attempts, businessCount: afterCount });
      }
      try {
        chrome.runtime.sendMessage({
          action: 'bulkScrapeProgress',
          phase: 'scroll',
          businessCount: afterCount,
          scrollAttempts: attempts,
        });
      } catch (_) {
        /* ignore */
      }

      if (grew) noGrowth = 0;
      else noGrowth += 1;
    }

    const businessCount = countVisibleListings();
    return {
      success: true,
      businessCount,
      scrollAttempts: attempts,
      reachedEnd: noGrowth >= 3,
      stoppedByUser: stopPreload,
    };
  }

  function readSearchQuery() {
    try {
      const q = new URLSearchParams(window.location.search).get('searchQueryState');
      if (q) {
        const parsed = JSON.parse(q);
        const users = parsed?.usersSearchTerm || parsed?.filterState?.usersSearchTerm;
        if (users) return String(users);
      }
    } catch (_) {
      /* ignore */
    }
    const path = window.location.pathname.replace(/^\/|\/$/g, '');
    if (path) {
      return decodeURIComponent(path.replace(/-/g, ' ')).slice(0, 80);
    }
    return 'zillow-scrape';
  }

  function scrapeListingDetail() {
    const extractors = window.AdHelloListingExtractors;
    if (!extractors?.extractListing) {
      throw new Error('Listing extractors not loaded');
    }
    const platform = extractors.detectListingPlatform(window.location.href) || 'zillow';
    const lead = extractors.extractListing(platform, window.location.pathname);
    if (!lead) throw new Error('Could not extract Zillow listing');
    const agent =
      typeof extractors.extractZillowAgentCard === 'function' ? extractors.extractZillowAgentCard() : null;
    return {
      lead,
      agent: agent || null,
      url: window.location.href.split('?')[0].split('#')[0],
    };
  }

  window.AdHelloZillowBulk = {
    isZillowPage,
    isZillowSearchPage,
    isZillowDetailPage,
    collectListingUrlsFromDom,
    preloadAllResults,
    readSearchQuery,
    scrapeListingDetail,
    stopPreload: () => {
      stopPreload = true;
    },
  };

  if (!isZillowPage()) return;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const action = message?.action;

    if (action === 'zillowBulkGetListingUrls') {
      try {
        sendResponse({
          urls: collectListingUrlsFromDom(),
          searchQuery: readSearchQuery(),
          isSearchPage: isZillowSearchPage(),
        });
      } catch (err) {
        sendResponse({ urls: [], error: err.message || String(err) });
      }
      return true;
    }

    if (action === 'zillowBulkPreload') {
      preloadAllResults()
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ success: false, reason: 'error', error: err.message }));
      return true;
    }

    if (action === 'zillowBulkScrapeListing') {
      try {
        const detail = scrapeListingDetail();
        sendResponse({ success: true, ...detail });
      } catch (err) {
        sendResponse({ success: false, error: err.message || String(err) });
      }
      return true;
    }

    if (action === 'zillowBulkStopPreload') {
      stopPreload = true;
      sendResponse({ success: true });
      return true;
    }

    return false;
  });
})();
