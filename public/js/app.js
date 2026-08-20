window.__openWarRoomFromSelectionImpl = null;
window.__openWarRoomFromSelection = function openWarRoomFromSelectionBridge() {
  if (typeof window.__openWarRoomFromSelectionImpl === 'function') {
    return window.__openWarRoomFromSelectionImpl();
  }
  let attempts = 0;
  const retry = () => {
    if (typeof window.__openWarRoomFromSelectionImpl === 'function') {
      window.__openWarRoomFromSelectionImpl();
      return;
    }
    if (++attempts < 120) {
      setTimeout(retry, 50);
      return;
    }
    const msg = 'Call room failed to load. Refresh the page and try again.';
    if (typeof window.showProspectToast === 'function') window.showProspectToast(msg);
    else window.alert(msg);
  };
  retry();
};

document.addEventListener('DOMContentLoaded', () => {
  try {
    const raw = localStorage.getItem('adhello_panel_notes_v1');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        window.__leadPanelNotesByKey = { ...parsed, ...(window.__leadPanelNotesByKey || {}) };
      }
    }
  } catch (_) {
    /* ignore */
  }
  // Hoisted function — available immediately; bulk bar must not wait for ~13k lines of init.
  window.__openWarRoomFromSelectionImpl = openWarRoomFromSelection;
  window.__openWarRoomFromSelection = openWarRoomFromSelection;

  (function initWebsiteLinkHoldPreview() {
    const preview = document.getElementById('websitePreview');
    if (!preview) return;
    const iframe = document.getElementById('previewIframe');
    const img = document.getElementById('previewImage');
    const fallback = document.getElementById('previewFallback');
    const loading = document.getElementById('previewLoading');
    const urlText = document.getElementById('previewUrlText');
    const openBtn = document.getElementById('previewNewTabBtn');
    const HOLD_MS = 420;
    let holdTimer = null;
    let holdShown = false;
    let suppressClick = false;
    let activeLink = null;

    function normalizeWebsiteHref(raw) {
      const w = String(raw || '').trim();
      if (!w || w === 'N/A') return '';
      if (/^https?:\/\//i.test(w)) return w;
      return `https://${w.replace(/^\/\//, '')}`;
    }

    function clearHoldTimer() {
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
    }

    function positionPreview(anchor) {
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const w = Math.min(520, Math.max(320, window.innerWidth - 24));
      const h = Math.min(380, Math.max(240, window.innerHeight - 24));
      preview.style.width = `${w}px`;
      preview.style.height = `${h}px`;
      let left = rect.left + rect.width / 2;
      let top = rect.top - 8;
      const halfW = w / 2;
      left = Math.max(halfW + 12, Math.min(window.innerWidth - halfW - 12, left));
      if (top - h < 12) top = Math.min(window.innerHeight - 12, rect.bottom + h + 8);
      preview.style.left = `${left}px`;
      preview.style.top = `${top}px`;
    }

    function tagHoldHint(link) {
      if (!link) return;
      const base = String(link.getAttribute('title') || link.dataset.url || '').trim();
      if (base && !/hold to preview/i.test(base)) {
        link.setAttribute('title', `Hold to preview · ${base}`);
      }
    }

    function showPreview(url, anchor) {
      holdShown = true;
      suppressClick = true;
      activeLink = anchor;
      positionPreview(anchor);
      if (urlText) urlText.textContent = url.replace(/^https?:\/\//i, '').split('?')[0];
      if (openBtn) openBtn.href = url;
      if (loading) loading.classList.remove('hidden');
      if (fallback) fallback.classList.add('hidden');
      if (iframe) iframe.src = 'about:blank';
      const w = Math.min(520, Math.max(320, window.innerWidth - 24));
      const h = Math.min(380, Math.max(240, window.innerHeight - 24));
      const shotH = Math.max(180, h - 40);
      if (img) {
        img.classList.add('hidden');
        img.onload = () => {
          if (loading) loading.classList.add('hidden');
          img.classList.remove('hidden');
        };
        img.onerror = () => {
          if (loading) loading.classList.add('hidden');
          img.classList.add('hidden');
          if (fallback) fallback.classList.remove('hidden');
        };
        img.src = `/leads/website-preview?url=${encodeURIComponent(url)}&w=${w}&h=${shotH}`;
      }
      preview.classList.remove('hidden', 'opacity-0');
      preview.classList.add('opacity-100');
      preview.style.pointerEvents = 'auto';
      anchor.classList.add('website-link--holding');
    }

    function hidePreview() {
      clearHoldTimer();
      holdShown = false;
      suppressClick = false;
      if (activeLink) {
        activeLink.classList.remove('website-link--holding');
        activeLink = null;
      }
      preview.classList.add('hidden', 'opacity-0');
      preview.classList.remove('opacity-100');
      preview.style.pointerEvents = 'none';
      if (iframe) iframe.src = 'about:blank';
      if (img) {
        img.onload = null;
        img.onerror = null;
        img.removeAttribute('src');
        img.classList.add('hidden');
      }
      if (fallback) fallback.classList.add('hidden');
      if (loading) loading.classList.remove('hidden');
    }

    function startHold(link, pointerEvent) {
      if (pointerEvent && pointerEvent.button != null && pointerEvent.button !== 0) return;
      const url = normalizeWebsiteHref(link.dataset.url || link.getAttribute('href'));
      if (!url) return;
      clearHoldTimer();
      holdShown = false;
      suppressClick = false;
      holdTimer = setTimeout(() => showPreview(url, link), HOLD_MS);
    }

    function endHold() {
      clearHoldTimer();
      if (holdShown) hidePreview();
    }

    document.addEventListener(
      'mousedown',
      (e) => {
        const link = e.target.closest('a.website-link');
        if (!link || e.target.closest('#websitePreview')) return;
        startHold(link, e);
      },
      true,
    );

    document.addEventListener('mouseup', endHold, true);
    document.addEventListener(
      'touchstart',
      (e) => {
        const link = e.target.closest('a.website-link');
        if (!link) return;
        startHold(link, e);
      },
      { passive: true, capture: true },
    );
    document.addEventListener('touchend', endHold, true);
    document.addEventListener('touchcancel', endHold, true);
    document.addEventListener(
      'touchmove',
      () => {
        if (!holdShown) clearHoldTimer();
      },
      { passive: true, capture: true },
    );

    document.addEventListener(
      'click',
      (e) => {
        if (suppressClick && e.target.closest('a.website-link')) {
          e.preventDefault();
          e.stopPropagation();
          suppressClick = false;
        }
      },
      true,
    );

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && holdShown) hidePreview();
    });

    document.querySelectorAll('a.website-link').forEach(tagHoldHint);
    const mo = new MutationObserver((mutations) => {
      mutations.forEach((m) => {
        m.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          if (node.matches && node.matches('a.website-link')) tagHoldHint(node);
          node.querySelectorAll('a.website-link').forEach(tagHoldHint);
        });
      });
    });
    mo.observe(document.body, { childList: true, subtree: true });
  })();

  window.__runBulkEnhanceSelectedLeads = async function runBulkEnhanceBridge() {
    if (typeof window.__runBulkEnhanceSelectedLeadsImpl === 'function') {
      return window.__runBulkEnhanceSelectedLeadsImpl();
    }
    if (typeof window.__runBulkEnhanceFromBarEarly === 'function') {
      return window.__runBulkEnhanceFromBarEarly();
    }
    for (let i = 0; i < 240; i += 1) {
      if (typeof window.__runBulkEnhanceSelectedLeadsImpl === 'function') {
        return window.__runBulkEnhanceSelectedLeadsImpl();
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
    const msg =
      'Enhance failed to load. Hard-refresh the page, or confirm Firecrawl/Monid keys under Workspace → Integrations.';
    if (typeof window.showBulkActionConfirmation === 'function') {
      window.showBulkActionConfirmation(msg, 'error');
    } else if (typeof window.showProspectToast === 'function') {
      window.showProspectToast(msg);
    } else {
      window.alert(msg);
    }
  };

  window.__runBulkSocialEnrichmentSelectedLeads = async function runBulkSocialEnrichmentBridge() {
    if (typeof window.__runBulkSocialEnrichmentSelectedLeadsImpl === 'function') {
      return window.__runBulkSocialEnrichmentSelectedLeadsImpl();
    }
    if (typeof window.__runBulkSocialFromBarEarly === 'function') {
      return window.__runBulkSocialFromBarEarly();
    }
    for (let i = 0; i < 240; i += 1) {
      if (typeof window.__runBulkSocialEnrichmentSelectedLeadsImpl === 'function') {
        return window.__runBulkSocialEnrichmentSelectedLeadsImpl();
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
    const msg =
      'Social search failed to load. Hard-refresh the page, or add a TikHub API key under Workspace → Integrations.';
    if (typeof window.showBulkActionConfirmation === 'function') {
      window.showBulkActionConfirmation(msg, 'error');
    } else if (typeof window.showProspectToast === 'function') {
      window.showProspectToast(msg);
    } else {
      window.alert(msg);
    }
  };

  window.__openBulkSmsModal = async function openBulkSmsModalBridge(phoneKeys) {
    if (typeof window.__openBulkSmsModalImpl === 'function') {
      return window.__openBulkSmsModalImpl(phoneKeys);
    }
    const modal = document.getElementById('smsScriptModal');
    if (!modal) {
      return { ok: false, error: 'no_modal', message: 'SMS composer failed to load. Refresh the page.' };
    }
    for (let i = 0; i < 240; i += 1) {
      if (typeof window.__openBulkSmsModalImpl === 'function') {
        return window.__openBulkSmsModalImpl(phoneKeys);
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
    return {
      ok: false,
      error: 'not_ready',
      message: 'SMS composer is still loading. Wait a moment and try again.',
    };
  };

  // --- Lead Gen Productivity Features (CSV, Scoring, Outreach) ---

  // Bell + processing ring + /api/status: public/js/nav-notifications.js (navbar)
  const updateProcessingStatus =
    typeof window.updateProcessingStatus === 'function' ? window.updateProcessingStatus : () => {};

  /** Must init before panel paint (paintPanelHeaderContactStrip, syncRowReviewsDisplay, etc.). */
  const renderStarsInElement =
    typeof window.__renderStarsInElement === 'function'
      ? window.__renderStarsInElement
      : function renderStarsInElementFallback(element, rating, starSizeClass = 'w-3 h-3') {
          if (!element) return;
          element.textContent = rating > 0 ? `${Number(rating).toFixed(1)} ★` : '—';
        };

  const calculateOpportunityScore = (lead) => {
    let score = 0;
    const website = lead.website && lead.website !== 'N/A';
    const reviews = parseInt(lead.reviews || lead.reviewsCount) || 0;
    const rating = parseFloat(lead.rating || lead.totalScore) || 0;
    const hasFB = (lead.facebook && lead.facebook !== 'N/A') || (lead.facebook_url && lead.facebook_url !== 'N/A');
    const hasIG = (lead.instagram && lead.instagram !== 'N/A') || (lead.instagram_url && lead.instagram_url !== 'N/A');
    const lowReviewsThreshold = getLowReviewsThreshold();
    
    // New Audit Signals - Support both JS bools and HTML strings
    const isOutdated = lead.isOutdated === 'true' || lead.isOutdated === true;
    const noMobile = lead.isMobileFriendly === 'false' || lead.isMobileFriendly === false;
    const noSchema = lead.hasSchemaMarkup === 'false' || lead.hasSchemaMarkup === false;
    const noChatbot = lead.hasChatbot === 'false' || lead.hasChatbot === false;
    const noClickToCall = lead.hasClickToCall === 'false' || lead.hasClickToCall === false;
    const aeoScore = parseInt(lead.aeoScore || 0);
    const cms = String(lead.cmsPlatform || '').toLowerCase();

    let buyingSignals = [];
    try {
      if (lead.buyingSignals && lead.buyingSignals !== 'undefined') {
        const parsed = JSON.parse(lead.buyingSignals);
        if (Array.isArray(parsed)) buyingSignals = parsed;
      }
    } catch (_) {}

    // Logic: Agencies want leads with GAPS (weighted for high opportunity)
    if (!website) score += 4.5;
    else {
        if (isOutdated) score += 2.5;
        if (noMobile) score += 3.0;
        if (noSchema) score += 2.0;
        if (noChatbot) score += 1.5;
        if (noClickToCall) score += 1.5;
        if (aeoScore > 0 && aeoScore < 3) score += 1.5;
        if (!hasFB || !hasIG) score += 1.0;
        if ((cms === 'wix' || cms === 'squarespace') && noChatbot) score += 1.5;
        else if ((cms === 'shopify' || cms === 'webflow') && noChatbot) score += 1.0;
    }

    if (buyingSignals.length > 0) score += Math.min(2, buyingSignals.length * 0.5);
    
    if (reviews <= lowReviewsThreshold) score += 1.5;
    if (rating > 0 && rating < 4.2) score += 1.5;
    
    return Math.min(10, score);
  };

  function getLowReviewsThreshold() {
    const raw =
      window.WORKSPACE_PROSPECTING &&
      window.WORKSPACE_PROSPECTING.lowReviewsThreshold != null
        ? window.WORKSPACE_PROSPECTING.lowReviewsThreshold
        : 30;
    const n = parseInt(String(raw).replace(/,/g, ''), 10);
    return Number.isFinite(n) && n >= 0 ? Math.min(10000, n) : 30;
  }

  function computeProspectGapLabelsClient(lead, maxLabels) {
    const cap = Math.min(6, Math.max(1, Number(maxLabels) || 4));
    const threshold = getLowReviewsThreshold();
    const out = [];
    const push = (label) => {
      if (out.length >= cap) return;
      if (label && !out.includes(label)) out.push(label);
    };
    if (!lead || typeof lead !== 'object') return out;

    const website = lead.website && String(lead.website).trim() && lead.website !== 'N/A';
    const reviews = parseInt(lead.reviews || lead.reviewsCount, 10) || 0;
    const hasFB =
      (lead.facebook && lead.facebook !== 'N/A') || (lead.facebook_url && lead.facebook_url !== 'N/A');
    const hasIG =
      (lead.instagram && lead.instagram !== 'N/A') || (lead.instagram_url && lead.instagram_url !== 'N/A');
    const isOutdated = lead.isOutdated === 'true' || lead.isOutdated === true;
    const noMobile = lead.isMobileFriendly === 'false' || lead.isMobileFriendly === false;
    const noSchema = lead.hasSchemaMarkup === 'false' || lead.hasSchemaMarkup === false;
    const aeoScore = parseInt(lead.aeoScore || 0, 10) || 0;

    if (!website) push('NO WEBSITE');
    else {
      if (isOutdated || noMobile) push('BAD SITE');
      if (!hasFB && !hasIG) push('WEAK SOCIAL');
      if (noSchema || (aeoScore > 0 && aeoScore < 3)) push('SEO GAPS');
    }
    if (reviews <= threshold) push('LOW REVIEWS');

    return out.slice(0, cap);
  }

  function gapBadgeClass(label) {
    const key = String(label || '').trim().toUpperCase();
    if (key === 'LOW REVIEWS') {
      return 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/20';
    }
    if (key === 'NO WEBSITE') {
      return 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20';
    }
    if (key === 'BAD SITE') {
      return 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-brand-yellow/10 dark:text-brand-yellow dark:border-brand-yellow/20';
    }
    if (key === 'WEAK SOCIAL') {
      return 'bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-300 dark:border-indigo-500/20';
    }
    if (key === 'SEO GAPS') {
      return 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/20';
    }
    return 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800/50 dark:text-slate-400 dark:border-white/5';
  }

  /** AI website audit score on the row: 1–10 gap (new), or legacy 11–100 “health” saved before the scale fix. */
  const getAiAuditGap10FromDataset = (lead) => {
    const raw = lead && lead.aiScore != null ? Number(lead.aiScore) : NaN;
    if (!Number.isFinite(raw) || raw <= 0) return null;
    if (raw > 10) return Math.min(10, Math.max(0, Math.round((100 - raw) / 10)));
    return Math.min(10, Math.max(0, raw));
  };

  const getUnifiedClientScore = (lead) => {
    const aiGap = getAiAuditGap10FromDataset(lead);
    if (aiGap != null) return aiGap;
    return calculateOpportunityScore(lead || {});
  };

  const isSearchResultsTablePage = () => !!document.getElementById('searchResultsLeadsTable');

  const markOpportunityReady = (row) => {
    if (row && row.dataset) row.dataset.opportunityReady = '1';
  };

  const paintOpportunityBadgeForRow = (row) => {
    if (!row) return;
    try {
      const badgeContainer = row.querySelector('.opportunity-badge');
      if (badgeContainer) {
        badgeContainer.innerHTML = renderOpportunityBadges(row);
        badgeContainer.dataset.score = getUnifiedClientScore(row.dataset);
      }
    } catch (err) {
      console.error('Error rendering opportunity badge for row:', err);
    }
  };

  const revealOpportunityForRow = (row) => {
    markOpportunityReady(row);
    paintOpportunityBadgeForRow(row);
  };

  const renderOpportunityBadges = (row) => {
    const l = row.dataset;
    const score = getUnifiedClientScore(l);
    const label = `${Math.round(score)}/10`;
    let scoreColor = 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800/50 dark:text-slate-400 dark:border-white/5';

    if (score >= 7) {
        scoreColor = 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20';
    } else if (score >= 4) {
        scoreColor = 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-brand-yellow/10 dark:text-brand-yellow dark:border-brand-yellow/20';
    }

    const gapLabels = computeProspectGapLabelsClient(l, 3);
    if (row && row.dataset) {
      row.dataset.gapLabels = gapLabels.join('|');
    }
    const gapHtml = gapLabels
      .map(
        (tag) =>
          `<span class="px-2 py-0.5 rounded-md ${gapBadgeClass(tag)} text-[8px] font-black border uppercase tracking-tight shadow-sm">${tag}</span>`,
      )
      .join('');

    return `<div class="flex flex-col items-center justify-center gap-1 py-0.5"><span class="px-2 py-0.5 rounded-md ${scoreColor} text-[9px] font-black border tabular-nums tracking-tight shadow-sm">${label}</span>${gapHtml ? `<div class="flex flex-wrap gap-1 items-center justify-center max-w-[11rem]">${gapHtml}</div>` : ''}</div>`;
  };

  const updateOpportunityBadges = () => {
    const searchPage = isSearchResultsTablePage();
    document.querySelectorAll('.result-row:not(.pipeline-row-page-hidden)').forEach((row) => {
      if (searchPage && row.dataset.opportunityReady !== '1') return;
      paintOpportunityBadgeForRow(row);
    });
    if (typeof applyTableStars === 'function') applyTableStars();
    else if (typeof window.__renderSearchResultStars === 'function') window.__renderSearchResultStars();
  };

  // Pipeline: defer badge paint so server row order stays put.
  // Search results: do not auto-vet — Opportunity stays empty until Enhance / AI audit.
  (function scheduleInitialOpportunityBadges() {
    if (isSearchResultsTablePage()) return;
    const run = () => updateOpportunityBadges();
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(run, { timeout: 1800 });
    } else {
      setTimeout(run, 600);
    }
  })();
  
  const getProspectTableBody = () => document.querySelector('#prospectLeadsTable tbody');

  const sortLeadsByOpportunity = (isAscending) => {
    const tableBody = getProspectTableBody() || document.querySelector('tbody');
    if (!tableBody) return;
    const rows = Array.from(tableBody.querySelectorAll('.result-row'));

    rows.sort((a, b) => {
      const scoreA = getUnifiedClientScore(a.dataset);
      const scoreB = getUnifiedClientScore(b.dataset);
      return isAscending ? scoreA - scoreB : scoreB - scoreA;
    });

    rows.forEach((row) => tableBody.appendChild(row));
  };

  const rowIsBookmarkedForSort = (row) => {
    if (!row || !row.dataset) return false;
    if (row.dataset.bookmarked === '1') return true;
    if (row.dataset.bookmarked === '0') return false;
    const btn = row.querySelector('.bookmark-btn');
    return !!(btn && (btn.dataset.saved === '1' || btn.classList.contains('bookmark-btn--saved')));
  };

  const sortBookmarkedLeadsToTop = () => {
    const tableBody = getProspectTableBody() || document.querySelector('#prospectLeadsTable tbody');
    if (!tableBody) return 0;
    const rows = Array.from(tableBody.querySelectorAll('.result-row'));
    let bookmarkedCount = 0;
    rows.sort((a, b) => {
      const aOn = rowIsBookmarkedForSort(a);
      const bOn = rowIsBookmarkedForSort(b);
      if (aOn === bOn) return 0;
      return aOn ? -1 : 1;
    });
    rows.forEach((row) => {
      if (rowIsBookmarkedForSort(row)) bookmarkedCount += 1;
      tableBody.appendChild(row);
    });
    return bookmarkedCount;
  };

  /** Prospect table: count phone + email + website present (not N/A). */
  const prospectContactCompleteness = (ds) => {
    let n = 0;
    if (ds.phone && ds.phone !== 'N/A') n += 1;
    if (ds.email && ds.email !== 'N/A') n += 1;
    if (ds.website && ds.website !== 'N/A') n += 1;
    return n;
  };

  const prospectHasWebsite = (ds) => {
    const w = String((ds && ds.website) || '').trim();
    return !!(w && w !== 'N/A' && w !== '—');
  };

  const prospectSocialCount = (ds) => {
    if (!ds) return 0;
    let n = 0;
    ['facebook', 'instagram', 'twitter'].forEach((field) => {
      const v = String(ds[field] || '').trim();
      if (v && v !== 'N/A' && v !== 'undefined') n += 1;
    });
    return n;
  };

  const prospectSortDefaultDesc = (key) =>
    ![
      'company',
      'category',
      'cadence',
      'pipeline',
      'status',
      'claimstatus',
      'email',
      'phone',
      'domain',
      'city',
      'state',
      'listingsource',
    ].includes(key);

  let prospectSortState = { key: null, desc: true };

  const prospectSortKeyFromTh = (th) => {
    if (!th) return null;
    const btn = th.querySelector('[data-prospect-sort]');
    if (btn) return btn.getAttribute('data-prospect-sort');
    const plc = th.getAttribute('data-plc');
    const fallback = {
      company: 'company',
      permitNumber: 'permitnumber',
      permitCategoryCol: 'permitcategory',
      permitStatus: 'permitstatus',
      permitValue: 'permitvalue',
      permitStatusDate: 'permitstatusdate',
      permitContractor: 'permitcontractor',
      permitOwner: 'permitowner',
      listingPrice: 'listingprice',
      listingBeds: 'listingbeds',
      listingBaths: 'listingbaths',
      city: 'city',
      state: 'state',
      listingSource: 'listingsource',
      lastTouch: 'lasttouch',
      engagementSignal: 'engagement',
      cadence: 'cadence',
      category: 'category',
      reviews: 'reviews',
      website: 'website',
      claimStatus: 'claimstatus',
      optimizationScore: 'gbpscore',
      phone: 'phone',
      email: 'email',
      domain: 'domain',
      contactGroup: 'contact',
      socials: 'socials',
      added: 'added',
      pipeline: 'pipeline',
      opportunity: 'actions',
      methods: 'phone',
      actions: 'actions',
    };
    return fallback[plc] || null;
  };

  const toggleProspectSort = (columnKey) => {
    const key = String(columnKey || '').trim();
    if (!key) return;
    if (prospectSortState.key === key) prospectSortState.desc = !prospectSortState.desc;
    else {
      prospectSortState.key = key;
      prospectSortState.desc = prospectSortDefaultDesc(key);
    }
    sortProspectTableBy(key, prospectSortState.desc);
  };

  const updateProspectSortHeaderUi = (activeKey, desc) => {
    document.querySelectorAll('[data-prospect-sort]').forEach((btn) => {
      const k = btn.getAttribute('data-prospect-sort');
      const active = activeKey != null && k === activeKey;
      btn.classList.toggle('prospect-sort-btn--active', active);
      btn.removeAttribute('aria-sort');
      const ind = btn.querySelector('.prospect-sort-indicator');
      if (ind) ind.textContent = '';
      if (active) {
        btn.setAttribute('aria-sort', desc ? 'descending' : 'ascending');
        if (ind) ind.textContent = desc ? '↓' : '↑';
      }
    });
  };

  /** Review count for pipeline sort — prefers row data-*; falls back to visible (N) in the cell. */
  const prospectReviewCountFromRow = (row) => {
    if (!row || !row.dataset) return 0;
    let count = parseInt(String(row.dataset.reviews || '').replace(/,/g, ''), 10) || 0;
    if (typeof row.querySelector === 'function') {
      const line = row.querySelector('.lead-reviews-line');
      const txt = line ? String(line.textContent || '') : '';
      const m = txt.match(/\(\s*([\d,]+)\s*\)/);
      if (m) {
        const domCount = parseInt(m[1].replace(/,/g, ''), 10) || 0;
        if (domCount > count) count = domCount;
      }
    }
    if (count > 0 && String(row.dataset.reviews || '') !== String(count)) {
      row.dataset.reviews = String(count);
    }
    return count;
  };

  const sortProspectTableBy = (columnKey, descending) => {
    const tableBody = getProspectTableBody();
    if (!tableBody) return;
    const rows = Array.from(tableBody.querySelectorAll('.result-row'));
    const mult = descending ? -1 : 1;
    const cmpStr = (x, y) => String(x || '').localeCompare(String(y || ''), undefined, { sensitivity: 'base' });

    rows.sort((ra, rb) => {
      const a = ra.dataset;
      const b = rb.dataset;
      let c = 0;
      switch (columnKey) {
        case 'company':
          c = cmpStr((a.title || '').trim(), (b.title || '').trim());
          break;
        case 'category':
          c = cmpStr((a.category || '').trim(), (b.category || '').trim());
          if (c === 0) c = cmpStr(a.title || '', b.title || '');
          break;
        case 'added': {
          const ta = parseInt(a.createdSort, 10) || 0;
          const tb = parseInt(b.createdSort, 10) || 0;
          c = ta - tb;
          if (c === 0) c = cmpStr(a.title || '', b.title || '');
          break;
        }
        case 'lasttouch': {
          const ta = parseInt(a.lastTouchMs, 10) || 0;
          const tb = parseInt(b.lastTouchMs, 10) || 0;
          c = ta - tb;
          if (c === 0) c = cmpStr(a.title || '', b.title || '');
          break;
        }
        case 'engagement': {
          const ta = parseInt(a.engagementSignalMs, 10) || 0;
          const tb = parseInt(b.engagementSignalMs, 10) || 0;
          c = ta - tb;
          if (c === 0) c = cmpStr(a.title || '', b.title || '');
          break;
        }
        case 'cadence': {
          c = cmpStr((a.cadenceSort || a.lastTouchChannel || '').trim(), (b.cadenceSort || b.lastTouchChannel || '').trim());
          if (c === 0) c = cmpStr(a.title || '', b.title || '');
          break;
        }
        case 'pipeline': {
          const na = parseInt(a.pipelineStage, 10) || 0;
          const nb = parseInt(b.pipelineStage, 10) || 0;
          c = na - nb;
          if (c === 0) c = cmpStr(a.title || '', b.title || '');
          break;
        }
        case 'contact': {
          const ca = prospectContactCompleteness(a);
          const cb = prospectContactCompleteness(b);
          c = ca - cb;
          if (c === 0) c = cmpStr(a.title || '', b.title || '');
          break;
        }
        case 'reviews': {
          const nca = prospectReviewCountFromRow(ra);
          const ncb = prospectReviewCountFromRow(rb);
          c = nca - ncb;
          if (c === 0) c = cmpStr(a.title || '', b.title || '');
          break;
        }
        case 'website': {
          c = Number(prospectHasWebsite(a)) - Number(prospectHasWebsite(b));
          if (c === 0) c = cmpStr(a.website || '', b.website || '');
          if (c === 0) c = cmpStr(a.title || '', b.title || '');
          break;
        }
        case 'claimstatus': {
          c = cmpStr((a.gbpClaimStatus || '').trim(), (b.gbpClaimStatus || '').trim());
          if (c === 0) c = cmpStr(a.title || '', b.title || '');
          break;
        }
        case 'gbpscore': {
          const ga = parseFloat(a.gbpOptimizationScore);
          const gb = parseFloat(b.gbpOptimizationScore);
          const na = Number.isFinite(ga) ? ga : -1;
          const nb = Number.isFinite(gb) ? gb : -1;
          c = na - nb;
          if (c === 0) c = cmpStr(a.title || '', b.title || '');
          break;
        }
        case 'socials': {
          c = prospectSocialCount(a) - prospectSocialCount(b);
          if (c === 0) c = cmpStr(a.title || '', b.title || '');
          break;
        }
        case 'phone': {
          const pa = a.phone && a.phone !== 'N/A' ? 1 : 0;
          const pb = b.phone && b.phone !== 'N/A' ? 1 : 0;
          c = pa - pb;
          if (c === 0) c = cmpStr(a.phone || '', b.phone || '');
          if (c === 0) c = cmpStr(a.title || '', b.title || '');
          break;
        }
        case 'email': {
          const ea = a.email && a.email !== 'N/A' ? 1 : 0;
          const eb = b.email && b.email !== 'N/A' ? 1 : 0;
          c = ea - eb;
          if (c === 0) c = cmpStr(a.email || '', b.email || '');
          if (c === 0) c = cmpStr(a.title || '', b.title || '');
          break;
        }
        case 'domain': {
          c = Number(prospectHasWebsite(a)) - Number(prospectHasWebsite(b));
          if (c === 0) c = cmpStr(a.website || '', b.website || '');
          if (c === 0) c = cmpStr(a.title || '', b.title || '');
          break;
        }
        case 'listingprice': {
          const pa = parseFloat(a.listingPrice);
          const pb = parseFloat(b.listingPrice);
          const na = Number.isFinite(pa) ? pa : -1;
          const nb = Number.isFinite(pb) ? pb : -1;
          c = na - nb;
          if (c === 0) c = cmpStr(a.title || '', b.title || '');
          break;
        }
        case 'listingbeds': {
          const ba = parseFloat(a.listingBeds);
          const bb = parseFloat(b.listingBeds);
          const na = Number.isFinite(ba) ? ba : -1;
          const nb = Number.isFinite(bb) ? bb : -1;
          c = na - nb;
          if (c === 0) c = cmpStr(a.title || '', b.title || '');
          break;
        }
        case 'listingbaths': {
          const ba = parseFloat(a.listingBaths);
          const bb = parseFloat(b.listingBaths);
          const na = Number.isFinite(ba) ? ba : -1;
          const nb = Number.isFinite(bb) ? bb : -1;
          c = na - nb;
          if (c === 0) c = cmpStr(a.title || '', b.title || '');
          break;
        }
        case 'city': {
          c = cmpStr((a.city || '').trim(), (b.city || '').trim());
          if (c === 0) c = cmpStr(a.title || '', b.title || '');
          break;
        }
        case 'state': {
          c = cmpStr((a.state || '').trim(), (b.state || '').trim());
          if (c === 0) c = cmpStr(a.title || '', b.title || '');
          break;
        }
        case 'listingsource': {
          c = cmpStr((a.listingSource || '').trim(), (b.listingSource || '').trim());
          if (c === 0) c = cmpStr(a.title || '', b.title || '');
          break;
        }
        case 'permitnumber': {
          c = cmpStr((a.permitNumber || '').trim(), (b.permitNumber || '').trim());
          if (c === 0) c = cmpStr(a.title || '', b.title || '');
          break;
        }
        case 'permitcategory': {
          c = cmpStr((a.permitCategory || '').trim(), (b.permitCategory || '').trim());
          if (c === 0) c = cmpStr(a.title || '', b.title || '');
          break;
        }
        case 'permitstatus': {
          c = cmpStr((a.permitStatus || '').trim(), (b.permitStatus || '').trim());
          if (c === 0) c = cmpStr(a.title || '', b.title || '');
          break;
        }
        case 'permitvalue': {
          const pa = parseFloat(a.permitValue);
          const pb = parseFloat(b.permitValue);
          const na = Number.isFinite(pa) ? pa : -1;
          const nb = Number.isFinite(pb) ? pb : -1;
          c = na - nb;
          if (c === 0) c = cmpStr(a.title || '', b.title || '');
          break;
        }
        case 'permitstatusdate': {
          const ta = parseInt(a.permitStatusDateMs, 10) || 0;
          const tb = parseInt(b.permitStatusDateMs, 10) || 0;
          c = ta - tb;
          if (c === 0) c = cmpStr(a.title || '', b.title || '');
          break;
        }
        case 'permitcontractor': {
          c = cmpStr((a.permitContractor || '').trim(), (b.permitContractor || '').trim());
          if (c === 0) c = cmpStr(a.title || '', b.title || '');
          break;
        }
        case 'permitowner': {
          c = cmpStr((a.permitOwner || '').trim(), (b.permitOwner || '').trim());
          if (c === 0) c = cmpStr(a.title || '', b.title || '');
          break;
        }
        case 'status':
          c = cmpStr((a.status || '').trim(), (b.status || '').trim());
          break;
        case 'actions':
          c = getUnifiedClientScore(a) - getUnifiedClientScore(b);
          if (c === 0) c = cmpStr(a.title || '', b.title || '');
          break;
        default:
          return 0;
      }
      return mult * c;
    });

    const frag = document.createDocumentFragment();
    rows.forEach((row) => frag.appendChild(row));
    tableBody.appendChild(frag);
    updateProspectSortHeaderUi(columnKey, descending);
    if (typeof window.__pipelineTablePagingResetToFirst === 'function') {
      window.__pipelineTablePagingResetToFirst();
    } else if (typeof window.__pipelineTablePagingApply === 'function') {
      window.__pipelineTablePagingApply();
    }
    const paintStars = () => {
      if (typeof window.__applyReviewStars !== 'function') return;
      window.__applyReviewStars(
        tableBody.querySelectorAll('tr.result-row:not(.pipeline-row-page-hidden)'),
      );
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(paintStars);
    } else {
      paintStars();
    }
    if (typeof window.__updateBulkActionBar === 'function') {
      window.__updateBulkActionBar();
    }
  };

  const PIPELINE_PAGE_SIZE_KEY = 'pipelineTablePageSize';
  const PIPELINE_PAGE_SIZE_OPTIONS = window.__PIPELINE_TABLE_PAGE_SIZE_OPTIONS || [25, 50, 100, 200];

  function readPipelinePageSize() {
    if (typeof window.__readPipelineTablePageSize === 'function') {
      return window.__readPipelineTablePageSize();
    }
    const n = parseInt(localStorage.getItem(PIPELINE_PAGE_SIZE_KEY) || '25', 10);
    return PIPELINE_PAGE_SIZE_OPTIONS.includes(n) ? n : 25;
  }

  function savePipelinePageSize(size) {
    try {
      localStorage.setItem(PIPELINE_PAGE_SIZE_KEY, String(size));
    } catch (_) {
      /* ignore */
    }
  }

  const prospectTable = document.getElementById('prospectLeadsTable');
  if (prospectTable) {
    queueMicrotask(() => {
      if (typeof window.__bindLeadsTableBulkSelection === 'function') {
        window.__bindLeadsTableBulkSelection(prospectTable);
      }
    });
    (function initPipelineTablePaging() {
      const table = prospectTable;
      const tbody = table.querySelector('tbody');
      const statusEl = document.getElementById('pipelineTablePageStatus');
      const loadMoreBtn = document.getElementById('pipelineTableLoadMore');
      const pageSizeSelect = document.getElementById('pipelineTablePageSizeSelect');
      const pagingWrap = document.getElementById('pipelineTablePaging');
      if (!tbody || !statusEl || !loadMoreBtn || !pagingWrap) return;

      let pageSize = readPipelinePageSize();
      let visibleLimit = pageSize;
      if (pageSizeSelect) {
        pageSizeSelect.value = String(pageSize);
        pageSizeSelect.addEventListener('change', () => {
          const next = parseInt(pageSizeSelect.value, 10);
          pageSize = PIPELINE_PAGE_SIZE_OPTIONS.includes(next) ? next : 25;
          savePipelinePageSize(pageSize);
          visibleLimit = pageSize;
          applyPipelinePaging();
          const scrollHost = document.getElementById('prospectPipelineTableScroll');
          if (scrollHost) scrollHost.scrollTop = 0;
        });
      }
      const rowsAlreadyPaged = tbody.querySelector('tr.result-row.pipeline-row-page-hidden');

      function pipelineRows() {
        return Array.from(tbody.querySelectorAll('tr.result-row'));
      }

      function applyPipelinePaging() {
        const rows = pipelineRows();
        const total = rows.length;
        rows.forEach((row, index) => {
          row.classList.toggle('pipeline-row-page-hidden', index >= visibleLimit);
        });
        const shown = Math.min(visibleLimit, total);
        statusEl.textContent =
          total > 0
            ? `Showing ${shown} of ${total} lead${total === 1 ? '' : 's'} · ${pageSize} per page`
            : '';
        const hasMore = total > visibleLimit;
        loadMoreBtn.classList.toggle('hidden', !hasMore);
        pagingWrap.classList.toggle('hidden', total === 0);
        if (hasMore) {
          const nextBatch = Math.min(pageSize, total - visibleLimit);
          loadMoreBtn.textContent = `Load more (${nextBatch} more)`;
          loadMoreBtn.disabled = false;
        }
        if (typeof window.__syncSelectAllLeadCheckbox === 'function') {
          window.__syncSelectAllLeadCheckbox();
        }
        if (typeof window.__updateBulkActionBar === 'function') {
          window.__updateBulkActionBar();
        }
        if (typeof window.__applyReviewStars === 'function') {
          window.__applyReviewStars(
            tbody.querySelectorAll('tr.result-row:not(.pipeline-row-page-hidden)'),
          );
        }
        if (typeof window.__initLeadRowTags === 'function') {
          window.__initLeadRowTags();
        }
      }

      loadMoreBtn.addEventListener('click', () => {
        visibleLimit += pageSize;
        applyPipelinePaging();
      });

      window.__pipelineTablePagingApply = applyPipelinePaging;
      window.__pipelineTablePagingResetToFirst = function pipelineTablePagingResetToFirst() {
        pageSize = readPipelinePageSize();
        visibleLimit = pageSize;
        if (pageSizeSelect) pageSizeSelect.value = String(pageSize);
        applyPipelinePaging();
        const scrollHost = document.getElementById('prospectPipelineTableScroll');
        if (scrollHost) scrollHost.scrollLeft = 0;
      };
      if (!rowsAlreadyPaged) {
        applyPipelinePaging();
      } else {
        const rows = pipelineRows();
        const total = rows.length;
        const shown = Math.min(visibleLimit, total);
        statusEl.textContent =
          total > 0
            ? `Showing ${shown} of ${total} lead${total === 1 ? '' : 's'} · ${pageSize} per page`
            : '';
        const hasMore = total > visibleLimit;
        loadMoreBtn.classList.toggle('hidden', !hasMore);
        pagingWrap.classList.toggle('hidden', total === 0);
        if (hasMore) {
          const nextBatch = Math.min(pageSize, total - visibleLimit);
          loadMoreBtn.textContent = `Load more (${nextBatch} more)`;
          loadMoreBtn.disabled = false;
        }
      }
    })();

    (function initPipelineToolbarEarly() {
      const table = prospectTable;
      const densityKey = 'prospectLeadTableDensity';
      function applyTableDensity(mode) {
        const d = mode === 'compact' ? 'compact' : 'comfortable';
        table.classList.remove('prospect-leads-table--comfortable', 'prospect-leads-table--compact');
        table.classList.add(
          d === 'compact' ? 'prospect-leads-table--compact' : 'prospect-leads-table--comfortable'
        );
        document.documentElement.setAttribute('data-prospect-density', d);
        document.querySelectorAll('#tableView .lead-density-btn').forEach((btn) => {
          const on = (btn.dataset.density || 'compact') === d;
          btn.classList.toggle('lead-density-btn--active', on);
          btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        try {
          localStorage.setItem(densityKey, d);
        } catch (_) {
          /* ignore */
        }
        if (typeof window.__syncPipelineStickyColumnOffsets === 'function') {
          window.__syncPipelineStickyColumnOffsets();
        }
        if (typeof window.__syncPipelineContactColumnLayout === 'function') {
          window.__syncPipelineContactColumnLayout();
        }
      }
      const savedDensity =
        document.documentElement.getAttribute('data-prospect-density') ||
        (localStorage.getItem(densityKey) === 'comfortable' ? 'comfortable' : 'compact');
      const alreadyPrimed = table.dataset.pipelinePrefsPrimed === '1';
      if (!alreadyPrimed || !table.classList.contains('prospect-leads-table--' + savedDensity)) {
        applyTableDensity(savedDensity);
      } else {
        document.querySelectorAll('#tableView .lead-density-btn').forEach((btn) => {
          const on = (btn.dataset.density || 'compact') === savedDensity;
          btn.classList.toggle('lead-density-btn--active', on);
        });
      }
      document.addEventListener('click', (e) => {
        const btn = e.target.closest('#tableView .lead-density-btn');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        applyTableDensity(btn.dataset.density || 'compact');
      });
    })();

    (function initPipelineTableToolbar() {
      const table = prospectTable;
      const boxHost = document.getElementById('pipelineColumnsCheckboxes');
      const colBtn = document.getElementById('pipelineColumnsBtn');
      const pop = document.getElementById('pipelineColumnsPopover');
      const resetW = document.getElementById('pipelineColumnsResetWidths');
      if (!table || !boxHost || !colBtn || !pop) return;

      function syncPipelineStickyColumnOffsets() {
        const host =
          document.getElementById('prospectPipelineTableScroll') ||
          document.querySelector('#tableView .overflow-x-auto');
        if (!host) return;
        const th = table.querySelector('thead th[data-plc="check"]');
        if (!th || th.classList.contains('plc-col-hidden')) {
          host.style.setProperty('--plc-check-sticky-w', '0px');
          return;
        }
        const w = th.getBoundingClientRect().width;
        host.style.setProperty('--plc-check-sticky-w', `${Math.round(w * 1000) / 1000}px`);
      }

      let _stickyOffTimer = null;
      function scheduleSyncPipelineStickyOffsets() {
        if (_stickyOffTimer) clearTimeout(_stickyOffTimer);
        _stickyOffTimer = setTimeout(() => {
          _stickyOffTimer = null;
          syncPipelineStickyColumnOffsets();
        }, 50);
      }
      window.__syncPipelineStickyColumnOffsets = scheduleSyncPipelineStickyOffsets;
      window.addEventListener('resize', scheduleSyncPipelineStickyOffsets, { passive: true });
      if (table.dataset.pipelinePrefsPrimed === '1') {
        if (typeof requestIdleCallback === 'function') {
          requestIdleCallback(scheduleSyncPipelineStickyOffsets, { timeout: 800 });
        } else {
          setTimeout(scheduleSyncPipelineStickyOffsets, 100);
        }
      } else {
        scheduleSyncPipelineStickyOffsets();
      }

      const PLC_META = [
        { id: 'company', label: 'Company' },
        { id: 'permitNumber', label: 'Permit', defaultHidden: true },
        { id: 'permitCategoryCol', label: 'Permit category', defaultHidden: true },
        { id: 'permitStatus', label: 'Permit status', defaultHidden: true },
        { id: 'permitValue', label: 'Permit value', defaultHidden: true },
        { id: 'permitStatusDate', label: 'Status date', defaultHidden: true },
        { id: 'permitContractor', label: 'Contractor', defaultHidden: true },
        { id: 'permitOwner', label: 'Property owner', defaultHidden: true },
        { id: 'listingPrice', label: 'Price', defaultHidden: true },
        { id: 'listingBeds', label: 'Beds', defaultHidden: true },
        { id: 'listingBaths', label: 'Baths', defaultHidden: true },
        { id: 'city', label: 'City', defaultHidden: true },
        { id: 'state', label: 'State', defaultHidden: true },
        { id: 'listingSource', label: 'Source', defaultHidden: true },
        { id: 'lastTouch', label: 'Last touch' },
        { id: 'engagementSignal', label: 'Signal' },
        { id: 'cadence', label: 'Cadence' },
        { id: 'category', label: 'Category' },
        { id: 'reviews', label: 'Reviews' },
        { id: 'reviewSnippet', label: 'Review snippet' },
        { id: 'sponsored', label: 'Sponsored' },
        { id: 'website', label: 'Website (Yes / No)', defaultHidden: true },
        { id: 'claimStatus', label: 'Claim status', defaultHidden: true },
        { id: 'optimizationScore', label: 'GBP optimization score', defaultHidden: true },
        { id: 'phone', label: 'Phone' },
        { id: 'email', label: 'Email' },
        { id: 'domain', label: 'Domain' },
        { id: 'socials', label: 'Socials' },
        { id: 'added', label: 'Added' },
        { id: 'pipeline', label: 'Pipeline' },
        { id: 'opportunity', label: 'Opportunity' },
        { id: 'methods', label: 'Methods (Call / Email)' },
        { id: 'actions', label: 'Actions' },
      ];
      const REAL_ESTATE_IMPORT_COLUMNS = [
        'company',
        'listingPrice',
        'listingBeds',
        'listingBaths',
        'city',
        'state',
        'listingSource',
        'reviews',
        'website',
        'phone',
        'email',
        'domain',
      ];
      const PERMITS_IMPORT_COLUMNS = [
        'company',
        'permitNumber',
        'permitCategoryCol',
        'permitStatus',
        'permitValue',
        'permitStatusDate',
        'permitContractor',
        'permitOwner',
        'city',
        'state',
      ];
      const PLC_MIN_WIDTH = {
        socials: 120,
        contactGroup: 168,
        phone: 88,
        email: 96,
        domain: 120,
        website: 72,
        methods: 88,
        listingPrice: 72,
        listingSource: 96,
        permitNumber: 88,
        permitCategoryCol: 96,
        permitStatus: 72,
        permitValue: 80,
        permitStatusDate: 88,
        permitContractor: 112,
        permitOwner: 112,
      };

      function migrateContactColumnVis(map) {
        if (!map || typeof map !== 'object') return map;
        if (!Object.prototype.hasOwnProperty.call(map, 'contact')) return map;
        const on = map.contact !== false;
        if (!Object.prototype.hasOwnProperty.call(map, 'phone')) map.phone = on;
        if (!Object.prototype.hasOwnProperty.call(map, 'email')) map.email = on;
        if (!Object.prototype.hasOwnProperty.call(map, 'domain')) map.domain = on;
        delete map.contact;
        return map;
      }

      function contactGroupVisible(map) {
        return (
          pipelineColVisible(map, 'phone') ||
          pipelineColVisible(map, 'email') ||
          pipelineColVisible(map, 'domain')
        );
      }

      function applyRealEstateImportColumnVis(map) {
        REAL_ESTATE_IMPORT_COLUMNS.forEach((id) => {
          map[id] = true;
        });
        return map;
      }

      function applyPermitsImportColumnVis(map) {
        PERMITS_IMPORT_COLUMNS.forEach((id) => {
          map[id] = true;
        });
        return map;
      }

      function wantsRealEstateColumnPreset() {
        try {
          const params = new URLSearchParams(window.location.search || '');
          return params.get('realEstate') === '1' || params.get('preset') === 'real_estate';
        } catch (_) {
          return false;
        }
      }

      function wantsPermitsColumnPreset() {
        try {
          const params = new URLSearchParams(window.location.search || '');
          if (params.get('permits') === '1' || params.get('preset') === 'permits') return true;
          return window.PROSPECTING_PERMITS_VIEW === true;
        } catch (_) {
          return false;
        }
      }

      function pipelineColVisible(map, id) {
        const meta = PLC_META.find((x) => x.id === id);
        const defaultOn = !(meta && meta.defaultHidden);
        if (!Object.prototype.hasOwnProperty.call(map, id)) return defaultOn;
        return map[id] !== false;
      }
      const VIS_KEY = 'pipelineTableColVisibility';
      const WIDTH_KEY = 'pipelineTableColWidths';

      function loadVis() {
        try {
          const raw = localStorage.getItem(VIS_KEY);
          return migrateContactColumnVis(raw ? JSON.parse(raw) : {});
        } catch (_) {
          return {};
        }
      }

      function saveVis(obj) {
        try {
          localStorage.setItem(VIS_KEY, JSON.stringify(obj));
        } catch (_) {
          /* ignore */
        }
      }

      const COMPACT_PIPELINE_COLUMNS = new Set(['check', 'company', 'reviews', 'contactGroup', 'socials']);

      function isPipelineCompactDensity() {
        return (
          table.classList.contains('prospect-leads-table--compact') ||
          document.documentElement.getAttribute('data-prospect-density') === 'compact'
        );
      }

      function pipelineColumnDisplayed(id, map) {
        if (id === 'check') return true;
        if (isPipelineCompactDensity()) {
          return COMPACT_PIPELINE_COLUMNS.has(id);
        }
        const isSplitContact = id === 'phone' || id === 'email' || id === 'domain';
        if (isSplitContact && contactGroupVisible(map)) return false;
        return pipelineColVisible(map, id);
      }

      function contactGroupColumnDisplayed(map) {
        if (isPipelineCompactDensity()) return true;
        return contactGroupVisible(map);
      }

      function applyVisibility(map) {
        table.querySelectorAll('[data-plc="check"]').forEach((el) => {
          el.classList.toggle('plc-col-hidden', !pipelineColumnDisplayed('check', map));
        });
        PLC_META.forEach(({ id }) => {
          const on = pipelineColumnDisplayed(id, map);
          table.querySelectorAll(`[data-plc="${id}"]`).forEach((el) => {
            el.classList.toggle('plc-col-hidden', !on);
          });
        });
        const groupOn = contactGroupColumnDisplayed(map);
        table.querySelectorAll('[data-plc="contactGroup"]').forEach((el) => {
          el.classList.toggle('plc-col-hidden', !groupOn);
        });
        const showPhoneRow = groupOn && (isPipelineCompactDensity() || pipelineColVisible(map, 'phone'));
        const showEmailRow = groupOn && (isPipelineCompactDensity() || pipelineColVisible(map, 'email'));
        const showDomainRow = groupOn && (isPipelineCompactDensity() || pipelineColVisible(map, 'domain'));
        table.querySelectorAll('.lead-contact-row-phone').forEach((el) => {
          el.classList.toggle('hidden', !showPhoneRow);
        });
        table.querySelectorAll('.lead-contact-row-email').forEach((el) => {
          el.classList.toggle('hidden', !showEmailRow);
        });
        table.querySelectorAll('.lead-contact-row-domain').forEach((el) => {
          el.classList.toggle('hidden', !showDomainRow);
        });
        syncLiveColumnCss(map);
      }

      function syncLiveColumnCss(map) {
        let el = document.getElementById('pipelineColVisLive');
        if (!el) {
          el = document.createElement('style');
          el.id = 'pipelineColVisLive';
          document.head.appendChild(el);
        }
        const css = [];
        css.push(
          `#prospectLeadsTable [data-plc="check"]{display:${pipelineColumnDisplayed('check', map) ? 'table-cell' : 'none'}!important}`,
        );
        PLC_META.forEach(({ id }) => {
          const on = pipelineColumnDisplayed(id, map);
          css.push(
            `#prospectLeadsTable [data-plc="${id}"]{display:${on ? 'table-cell' : 'none'}!important}`,
          );
        });
        const groupOn = contactGroupColumnDisplayed(map);
        css.push(
          `#prospectLeadsTable [data-plc="contactGroup"]{display:${groupOn ? 'table-cell' : 'none'}!important}`,
        );
        const showPhoneRow = groupOn && (isPipelineCompactDensity() || pipelineColVisible(map, 'phone'));
        const showEmailRow = groupOn && (isPipelineCompactDensity() || pipelineColVisible(map, 'email'));
        const showDomainRow = groupOn && (isPipelineCompactDensity() || pipelineColVisible(map, 'domain'));
        css.push(
          `#prospectLeadsTable .lead-contact-row-phone{display:${showPhoneRow ? 'flex' : 'none'}!important}`,
        );
        css.push(
          `#prospectLeadsTable .lead-contact-row-email{display:${showEmailRow ? 'flex' : 'none'}!important}`,
        );
        css.push(
          `#prospectLeadsTable .lead-contact-row-domain{display:${showDomainRow ? 'flex' : 'none'}!important}`,
        );
        el.textContent = css.join('\n');
      }

      window.__syncPipelineContactColumnLayout = () => {
        syncLiveColumnCss(loadVis());
        applyVisibility(loadVis());
      };

      function applyWidths(obj) {
        if (!obj || typeof obj !== 'object') return;
        Object.keys(obj).forEach((id) => {
          let px = Number(obj[id]);
          const floor = PLC_MIN_WIDTH[id] || 48;
          if (!Number.isFinite(px)) return;
          px = Math.max(floor, px);
          table.querySelectorAll(`[data-plc="${id}"]`).forEach((el) => {
            el.style.width = `${px}px`;
            el.style.minWidth = `${px}px`;
            el.style.maxWidth = `${px}px`;
          });
        });
      }

      function clearAllWidths() {
        table.querySelectorAll('[data-plc]').forEach((el) => {
          el.style.width = '';
          el.style.minWidth = '';
          el.style.maxWidth = '';
        });
      }

      let vis = migrateContactColumnVis(window.__pipelinePrefsPrimedVis || loadVis());
      if (wantsRealEstateColumnPreset()) {
        vis = applyRealEstateImportColumnVis({ ...vis });
        saveVis(vis);
      }
      if (wantsPermitsColumnPreset()) {
        vis = applyPermitsImportColumnVis({ ...vis });
        saveVis(vis);
      }
      if (vis && vis.check === false) {
        delete vis.check;
        saveVis(vis);
      }
      if (!table.dataset.pipelinePrefsPrimed) {
        applyVisibility(vis);
        try {
          applyWidths(JSON.parse(localStorage.getItem(WIDTH_KEY) || '{}'));
        } catch (_) {
          /* ignore */
        }
      } else {
        syncLiveColumnCss(vis);
      }
      scheduleSyncPipelineStickyOffsets();

      let columnCheckboxesBuilt = false;
      function ensureColumnCheckboxesBuilt() {
        if (columnCheckboxesBuilt || !boxHost) return;
        columnCheckboxesBuilt = true;
        PLC_META.forEach(({ id, label }) => {
          const wrap = document.createElement('label');
          wrap.className = 'flex items-center gap-3 cursor-pointer text-brand-dark dark:text-slate-200 py-0.5';
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = pipelineColVisible(vis, id);
          cb.className = 'rounded border-brand-border text-brand-yellow focus:ring-brand-yellow';
          cb.addEventListener('change', () => {
            vis[id] = cb.checked;
            saveVis(vis);
            applyVisibility(vis);
            scheduleSyncPipelineStickyOffsets();
          });
          wrap.appendChild(cb);
          const span = document.createElement('span');
          span.textContent = label;
          wrap.appendChild(span);
          boxHost.appendChild(wrap);
        });
      }

      const colWrap = colBtn.closest('.js-pipeline-columns-wrap');

      function positionColumnsPopover() {
        if (pop.parentElement !== document.body) {
          document.body.appendChild(pop);
        }
        const rect = colBtn.getBoundingClientRect();
        pop.style.position = 'fixed';
        pop.style.top = `${Math.round(rect.bottom + 8)}px`;
        pop.style.right = `${Math.max(12, Math.round(window.innerWidth - rect.right))}px`;
        pop.style.left = 'auto';
        pop.style.bottom = 'auto';
        pop.style.zIndex = '10050';
        pop.style.width = 'min(calc(100vw - 2rem), 17rem)';
      }

      function repositionColumnsPopoverIfOpen() {
        if (pop.classList.contains('hidden')) return;
        positionColumnsPopover();
        applyColumnsPopoverSurface();
      }

      window.addEventListener('resize', repositionColumnsPopoverIfOpen, { passive: true });
      window.addEventListener('scroll', repositionColumnsPopoverIfOpen, { passive: true, capture: true });

      function closePop() {
        pop.classList.add('hidden');
        colBtn.setAttribute('aria-expanded', 'false');
        if (colWrap) colWrap.classList.remove('js-pipeline-columns-wrap--open');
      }

      function pipelineColumnsPopoverSolidBg() {
        return document.documentElement.classList.contains('dark') ? '#0f172a' : '#ffffff';
      }

      function applyColumnsPopoverSurface() {
        if (typeof window.applyPortaledPopoverSurface === 'function') {
          window.applyPortaledPopoverSurface(pop);
          return;
        }
        const bg = pipelineColumnsPopoverSolidBg();
        pop.style.setProperty('background-color', bg, 'important');
        pop.style.setProperty('background', bg, 'important');
        pop.style.setProperty('backdrop-filter', 'none', 'important');
        pop.style.setProperty('-webkit-backdrop-filter', 'none', 'important');
        pop.style.setProperty('opacity', '1', 'important');
      }

      function openColumnsPopover() {
        ensureColumnCheckboxesBuilt();
        positionColumnsPopover();
        applyColumnsPopoverSurface();
        pop.classList.remove('hidden');
        colBtn.setAttribute('aria-expanded', 'true');
        if (colWrap) colWrap.classList.add('js-pipeline-columns-wrap--open');
        requestAnimationFrame(function () {
          positionColumnsPopover();
          applyColumnsPopoverSurface();
        });
      }

      function toggleColumnsPopover() {
        if (pop.classList.contains('hidden')) openColumnsPopover();
        else closePop();
      }
      window.__togglePipelineColumnsPopover = toggleColumnsPopover;

      colBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleColumnsPopover();
      });

      pop.addEventListener('click', (e) => {
        e.stopPropagation();
      });

      document.addEventListener('click', (e) => {
        if (pop.classList.contains('hidden')) return;
        if (e.target.closest('#pipelineColumnsPopover') || e.target.closest('#pipelineColumnsBtn')) return;
        closePop();
      });

      if (resetW) {
        resetW.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          try {
            localStorage.removeItem(WIDTH_KEY);
          } catch (_) {
            /* ignore */
          }
          clearAllWidths();
          scheduleSyncPipelineStickyOffsets();
        });
      }

      let dragPlc = null;
      let dragStartX = 0;
      let dragStartW = 0;
      let dragWidths = null;
      let dragResizeRaf = null;

      document.addEventListener('mousedown', (e) => {
        const h = e.target.closest('.plc-col-resize');
        if (!h || !table.contains(h)) return;
        e.preventDefault();
        const plc = h.getAttribute('data-plc-resize');
        if (!plc) return;
        const th = h.closest('th');
        if (!th) return;
        dragPlc = plc;
        dragStartX = e.clientX;
        dragStartW = th.getBoundingClientRect().width;
        try {
          dragWidths = JSON.parse(localStorage.getItem(WIDTH_KEY) || '{}');
        } catch (_) {
          dragWidths = {};
        }
        h.classList.add('plc-col-resize--active');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
      });

      document.addEventListener('mousemove', (e) => {
        if (!dragPlc) return;
        e.preventDefault();
        const dx = e.clientX - dragStartX;
        const floor = PLC_MIN_WIDTH[dragPlc] || 48;
        const next = Math.max(floor, dragStartW + dx);
        if (!dragWidths) dragWidths = {};
        dragWidths[dragPlc] = next;
        if (dragResizeRaf) return;
        dragResizeRaf = requestAnimationFrame(() => {
          dragResizeRaf = null;
          if (dragWidths) applyWidths(dragWidths);
        });
      });

      document.addEventListener('mouseup', () => {
        if (!dragPlc) return;
        if (dragResizeRaf) {
          cancelAnimationFrame(dragResizeRaf);
          dragResizeRaf = null;
        }
        if (dragWidths) {
          try {
            localStorage.setItem(WIDTH_KEY, JSON.stringify(dragWidths));
          } catch (_) {
            /* ignore */
          }
          applyWidths(dragWidths);
        }
        dragPlc = null;
        dragWidths = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        table.querySelectorAll('.plc-col-resize--active').forEach((x) => x.classList.remove('plc-col-resize--active'));
        scheduleSyncPipelineStickyOffsets();
      });
    })();

    (function bindProspectTableSortHandlers() {
      const table = prospectTable;
      if (!table || table.dataset.prospectSortBound === '1') return;
      table.dataset.prospectSortBound = '1';

      const runProspectSortFromEvent = (e) => {
        if (e.target.closest('.plc-col-resize')) return;
        if (e.target.closest('input[type="checkbox"]')) return;
        if (e.target.closest('.prospect-bookmark-top-btn')) return;
        const sortBtn = e.target.closest('[data-prospect-sort]');
        const th = e.target.closest('th[data-plc]');
        if (!sortBtn && !th) return;
        if (th && th.getAttribute('data-plc') === 'check') return;
        const key = sortBtn
          ? sortBtn.getAttribute('data-prospect-sort')
          : prospectSortKeyFromTh(th);
        if (!key) return;
        e.preventDefault();
        e.stopPropagation();
        toggleProspectSort(key);
        if (sortBtn && typeof sortBtn.blur === 'function') sortBtn.blur();
      };

      table.querySelectorAll('[data-prospect-sort]').forEach((btn) => {
        btn.addEventListener('click', runProspectSortFromEvent);
      });

      const thead = table.querySelector('thead');
      if (thead) {
        thead.addEventListener('click', (e) => {
          if (e.target.closest('[data-prospect-sort]')) return;
          if (e.target.closest('.prospect-bookmark-top-btn')) return;
          runProspectSortFromEvent(e);
        });
      }

      const bookmarkTopBtn = document.getElementById('sortBookmarkedTopBtn');
      if (bookmarkTopBtn && bookmarkTopBtn.dataset.bound !== '1') {
        bookmarkTopBtn.dataset.bound = '1';
        bookmarkTopBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const n = sortBookmarkedLeadsToTop();
          bookmarkTopBtn.classList.add('prospect-bookmark-top-btn--active', 'bg-brand-yellow/25', 'border-brand-yellow/60', 'text-brand-dark');
          bookmarkTopBtn.setAttribute('aria-pressed', 'true');
          const svg = bookmarkTopBtn.querySelector('svg');
          if (svg) svg.setAttribute('fill', 'currentColor');
          if (typeof window.showProspectToast === 'function') {
            window.showProspectToast(
              n > 0
                ? `${n} bookmarked lead${n === 1 ? '' : 's'} moved to the top`
                : 'No bookmarked leads in this view',
            );
          }
          if (typeof bookmarkTopBtn.blur === 'function') bookmarkTopBtn.blur();
        });
      }
    })();

    (function scheduleBusinessesDefaultSort() {
      if (!window.PROSPECTING_BUSINESSES_VIEW) return;
      const run = () => {
        prospectSortState = { key: 'website', desc: false };
        sortProspectTableBy('website', false);
        updateProspectSortHeaderUi('website', false);
      };
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(run, { timeout: 1200 });
      } else {
        setTimeout(run, 400);
      }
    })();
  }

  // Attach Sort Listener
  const sortOppBtn = document.getElementById('sortOpportunity');
  if (sortOppBtn) {
    let asc = false;
    sortOppBtn.addEventListener('click', () => {
      asc = !asc;
      prospectSortState = { key: null, desc: true };
      updateProspectSortHeaderUi(null, true);
      sortLeadsByOpportunity(asc);
      const svg = sortOppBtn.querySelector('svg');
      if (svg) svg.style.transform = asc ? 'rotate(180deg)' : 'rotate(0deg)';
      sortOppBtn.classList.add('text-brand-dark');
    });
  }

  function collectLeadDatasetsForBulkExport() {
    const selectedCheckboxes = document.querySelectorAll('.row-checkbox:checked, .lead-checkbox:checked');
    const leadsToExport = [];
    if (selectedCheckboxes.length > 0) {
      selectedCheckboxes.forEach((cb) => {
        const row = cb.closest('.result-row');
        if (row) leadsToExport.push(row.dataset);
      });
    } else {
      document.querySelectorAll('.result-row').forEach((row) => {
        leadsToExport.push(row.dataset);
      });
    }
    return leadsToExport;
  }

  function buildLeadsCsvFromDatasets(leadsToExport) {
    const headers = [
      'Company',
      'Category',
      'Phone',
      'Website',
      'Email',
      'Address',
      'City',
      'State',
      'Zip',
      'Price',
      'Beds',
      'Baths',
      'Sqft',
      'Source',
      'Listing URL',
      'Rating',
      'Reviews',
      'Claim status',
      'GBP optimization score',
      'Signal',
      'Facebook',
      'Instagram',
      'Twitter',
      'Opportunity (unified /10)',
    ];
    const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const rows = leadsToExport.map((l) => {
      const priceRaw = l.listingPrice || l.listingprice || '';
      const priceNum = parseFloat(String(priceRaw).replace(/[^\d.]/g, ''));
      const price =
        Number.isFinite(priceNum) && priceNum > 0 ? `$${Math.round(priceNum).toLocaleString('en-US')}` : priceRaw;
      return [
        esc(l.title),
        esc(l.category),
        esc(l.phone),
        esc(l.website),
        esc(l.email),
        esc(l.address),
        esc(l.city),
        esc(l.state),
        esc(l.zip),
        esc(price),
        esc(l.listingBeds || l.listingbeds || ''),
        esc(l.listingBaths || l.listingbaths || ''),
        esc(l.listingSqft || l.listingsqft || ''),
        esc(l.listingSource || l.listingsource || l.source || ''),
        esc(l.url),
        l.rating,
        l.reviews,
        esc(String(l.gbpClaimStatus || '').replace(/"/g, '""')),
        esc(String(l.gbpOptimizationScore || '').replace(/"/g, '""')),
        esc(String(l.ownerSignal || '').replace(/"/g, '""')),
        esc(l.facebook),
        esc(l.instagram),
        esc(l.twitter),
        getUnifiedClientScore(l),
      ];
    });
    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }

  function defaultLeadsExportFilename() {
    return `AdHello_Leads_${new Date().toISOString().split('T')[0]}.csv`;
  }

  // Export CSV — all `.js-bulk-export-csv` buttons (avoids duplicate id on /leads floating bar vs header bar)
  document.querySelectorAll('.js-bulk-export-csv').forEach((exportBtn) => {
    exportBtn.addEventListener('click', (e) => {
      if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
      const leadsToExport = collectLeadDatasetsForBulkExport();
      if (leadsToExport.length === 0) return alert('No leads found to export.');
      const csvContent = buildLeadsCsvFromDatasets(leadsToExport);
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.setAttribute('download', defaultLeadsExportFilename());
      link.click();
    });
  });

  // Save list to Google Drive (Pipeline — requires Connect Google Drive)
  document.querySelectorAll('.js-bulk-save-drive').forEach((saveBtn) => {
    saveBtn.addEventListener('click', (e) => {
      if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
      const leadsToExport = collectLeadDatasetsForBulkExport();
      if (leadsToExport.length === 0) return alert('No leads found to save.');
      const csvContent = buildLeadsCsvFromDatasets(leadsToExport);
      const filename = defaultLeadsExportFilename();
      saveBtn.disabled = true;
      saveBtn.setAttribute('aria-busy', 'true');
      const fetchJsonFn = typeof window.fetchJson === 'function' ? window.fetchJson : null;
      const uploadReq = fetchJsonFn
        ? fetchJsonFn('/leads/google-drive/upload-csv', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ csv: csvContent, filename }),
          })
        : fetch('/leads/google-drive/upload-csv', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ csv: csvContent, filename }),
          }).then((r) => r.json().then((j) => ({ ok: r.ok, j })));
      uploadReq
        .then((pack) => {
          if (!pack.ok || !pack.j || !pack.j.success) {
            const msg = (pack.j && pack.j.error) || 'Could not save to Google Drive.';
            if (pack.j && pack.j.needsReconnect) {
              if (
                window.confirm(
                  msg + '\n\nOpen Google Drive connection now? (You may need to approve save access.)'
                )
              ) {
                window.location.href = '/auth/google/drive-link';
              }
              return;
            }
            throw new Error(msg);
          }
          const link = pack.j.webViewLink;
          const name = pack.j.name || filename;
          if (link && window.confirm(`Saved "${name}" to Google Drive (AdHello Leads folder).\n\nOpen in Drive?`)) {
            window.open(link, '_blank', 'noopener,noreferrer');
          } else {
            alert(`Saved "${name}" to your Google Drive (AdHello Leads folder).`);
          }
        })
        .catch((e) => {
          alert(e && e.message ? e.message : 'Could not save to Google Drive.');
        })
        .finally(() => {
          saveBtn.disabled = false;
          saveBtn.removeAttribute('aria-busy');
        });
    });
  });

  function escapeHtmlAttr(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escapeHtmlText(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  const PIPELINE_PHONE_CALL_ICON_SVG =
    '<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>';

  function renderPipelinePhoneControlHtml(phone, leadKey) {
    const p = phone && phone !== 'N/A' ? String(phone).trim() : '';
    if (!p) {
      return '<span class="lead-contact-phone-slot text-xs font-semibold text-brand-muted/60 dark:text-slate-500">—</span>';
    }
    const keyAttr = leadKey ? ` data-lead-key="${escapeHtmlAttr(leadKey)}"` : '';
    return `<button type="button" class="lead-contact-phone-slot js-click-to-call-btn js-click-to-call-number flex flex-nowrap items-center gap-2 min-w-0 w-full max-w-full text-left text-xs font-semibold text-brand-dark dark:text-slate-200 hover:text-brand-yellow transition-colors focus:outline-none focus:ring-2 focus:ring-brand-yellow/40 rounded-md" title="${escapeHtmlAttr(
      p
    )}" data-phone="${escapeHtmlAttr(p)}"${keyAttr} aria-label="Call ${escapeHtmlAttr(
      p
    )}" onclick="if(window.__adhelloPipelinePhoneClick){window.__adhelloPipelinePhoneClick(this,event);}else{event.stopPropagation();}"><span class="shrink-0 w-7 h-7 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25 flex items-center justify-center hover:bg-emerald-500/25 transition-colors pointer-events-none" aria-hidden="true">${PIPELINE_PHONE_CALL_ICON_SVG}</span><span class="lead-contact-phone-label truncate flex-1 min-w-0 tabular-nums pointer-events-none">${escapeHtmlText(
      p
    )}</span></button>`;
  }

  function replacePipelinePhoneSlot(row, phone) {
    if (!row || typeof row.querySelector !== 'function') return;
    const slot = row.querySelector('.lead-contact-phone-slot');
    if (!slot) return;
    const key = row.dataset.leadKey || '';
    slot.outerHTML = renderPipelinePhoneControlHtml(phone, key);
    syncPipelineRowCallButton(row, phone);
  }

  function closeEmailIntelModal() {
    const modal = document.getElementById('emailIntelModal');
    if (modal) {
      modal.classList.add('hidden');
      modal.setAttribute('aria-hidden', 'true');
    }
    document.body.style.overflow = '';
    emailIntelActiveRow = null;
  }

  /** Plain-text outreach script templates (idx 0–5). */
  function getEmailIntelOfferScripts(company) {
    const c = company || 'there';
    return [
      {
        subject: `Website & conversions — ${c}`,
        body: `Hi,\n\nI’ve been looking at ${c} online and wanted to reach out about speed, clarity, and conversion (CRO). We help teams turn more of the traffic they already get into booked calls and form fills.\n\nWould you be open to a short call this week?\n\nBest,`,
      },
      {
        subject: `Reviews & reputation — ${c}`,
        body: `Hi,\n\nGiven how visible ${c} is locally, protecting and growing reviews usually has a fast ROI. We help with review rhythm, listings/GEO, and AI-assisted responses so nothing slips.\n\nOpen to a quick conversation?\n\nBest,`,
      },
      {
        subject: `Social & content — ${c}`,
        body: `Hi,\n\nI’m reaching out about ${c}’s social presence — consistent posting, community replies, and content that actually supports leads (not just vanity metrics).\n\nWorth a 10-minute chat?\n\nBest,`,
      },
      {
        subject: `Paid ads — ${c}`,
        body: `Hi,\n\nIf ${c} is running (or considering) Meta/Google ads, we help with tracking, creative testing, and weekly optimization so spend maps to real bookings.\n\nWould you like a second opinion on the account?\n\nBest,`,
      },
      {
        subject: `AI automation — ${c}`,
        body: `Hi,\n\nQuick note on ${c}: many teams claw back hours with light AI workflows — follow-ups, scheduling, CRM hygiene, after-hours capture — without adding headcount.\n\nHappy to share one concrete idea if you’re open to it.\n\nBest,`,
      },
      {
        subject: `Strategy & consulting — ${c}`,
        body: `Hi,\n\nI’d love to explore a focused engagement with ${c} — growth priorities, channel mix, and a simple plan you can execute with or without us long-term.\n\nAre you open to a discovery call?\n\nBest,`,
      },
    ];
  }

  async function copyEmailIntelScript(text, label) {
    const body = String(text || '').trim();
    if (!body) return;
    try {
      await navigator.clipboard.writeText(body);
      if (typeof window.showAppToast === 'function') {
        window.showAppToast(label ? `${label} copied` : 'Script copied');
      }
    } catch (_) {
      const draftEl = document.getElementById('emailIntelDraft');
      if (draftEl) {
        draftEl.value = body;
        draftEl.focus();
        draftEl.select();
      }
    }
  }

  function wireEmailIntelOfferLinks(company) {
    const offers = getEmailIntelOfferScripts(company);
    document.querySelectorAll('.email-intel-offer-link').forEach((btn, i) => {
      const idx = parseInt(btn.getAttribute('data-offer-idx'), 10);
      const offerIdx = Number.isFinite(idx) ? idx : i;
      const o = offers[Math.min(Math.max(0, offerIdx), offers.length - 1)];
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const draftEl = document.getElementById('emailIntelDraft');
        const draftSection = document.getElementById('emailIntelDraftSection');
        if (draftEl) draftEl.value = o.body;
        if (draftSection) draftSection.classList.remove('hidden');
        copyEmailIntelScript(o.body, 'Template script');
      };
    });
  }

  let emailIntelRequestSeq = 0;

  function interpolateOutreachScriptTemplate(text, row) {
    const company = String((row && row.dataset && row.dataset.title) || '').trim() || 'your business';
    const city =
      [row && row.dataset && row.dataset.city, row && row.dataset && row.dataset.state]
        .filter(Boolean)
        .join(', ') || 'your area';
    return String(text || '')
      .replace(/\{\{company\}\}/g, company)
      .replace(/\{\{name\}\}/g, 'there')
      .replace(/\{\{city\}\}/g, city);
  }

  function pickEmailDraftFromOutreachLibrary(library, serviceKey) {
    const svc = library && library[serviceKey];
    if (!svc || !svc.channels) return '';
    return String(svc.channels.email || svc.channels.call || svc.channels.text || '').trim();
  }

  function renderEmailIntelInsightHtml(data) {
    const label = escapeHtmlText(data.primaryServiceLabel || 'Recommended offer');
    const rationale = data.rationale ? escapeHtmlText(data.rationale) : '';
    const track = data.talkTrack ? escapeHtmlText(data.talkTrack) : '';
    let html = `<div class="rounded-2xl bg-brand-yellow/10 dark:bg-brand-yellow/15 border border-brand-yellow/30 p-4 mb-3">
            <p class="text-[10px] font-black uppercase tracking-widest text-brand-yellow mb-1">Recommended focus</p>
            <p class="font-bold text-brand-dark dark:text-white">${label}</p>
          </div>`;
    if (rationale) {
      html += `<p class="text-sm text-brand-muted dark:text-slate-400 leading-relaxed">${rationale.replace(/\n/g, '<br>')}</p>`;
    }
    if (track) {
      html += `<p class="text-xs font-semibold text-brand-dark dark:text-slate-300 mt-4 leading-relaxed">Suggested opener: <span class="italic">“${track}”</span></p>`;
    }
    if (data.cached) {
      html += `<p class="text-[9px] font-bold uppercase tracking-widest text-brand-muted/60 mt-3">Cached insight · ${escapeHtmlText(data.provider || '')}</p>`;
    } else if (data.provider === 'heuristic') {
      html += `<p class="text-[9px] font-bold uppercase tracking-widest text-brand-muted/60 mt-3">Smart match · template library</p>`;
    }
    return html;
  }

  let emailIntelActiveRow = null;

  async function openEmailIntelModal(row) {
    const modal = document.getElementById('emailIntelModal');
    const titleEl = document.getElementById('emailIntelTitle');
    const emailLineEl = document.getElementById('emailIntelEmailLine');
    const aiBody = document.getElementById('emailIntelAiBody');
    const draftSection = document.getElementById('emailIntelDraftSection');
    const draftEl = document.getElementById('emailIntelDraft');
    const copyDraftBtn = document.getElementById('emailIntelCopyDraft');
    const sendGhlBtn = document.getElementById('emailIntelSendGhlBtn');
    if (!modal || !row) return;

    emailIntelActiveRow = resolvePanelActionRow() || row;
    if (emailIntelActiveRow) currentRow = emailIntelActiveRow;

    const reqId = ++emailIntelRequestSeq;

    if (modal.parentElement !== document.body) {
      document.body.appendChild(modal);
    }

    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    const company = emailIntelActiveRow.dataset.title || 'Lead';
    if (titleEl) titleEl.textContent = company;

    const emailRaw = (emailIntelActiveRow.dataset.email || '').trim();
    const email = emailRaw && emailRaw !== 'N/A' ? emailRaw : '';
    if (emailLineEl) {
      emailLineEl.textContent = email
        ? `Email on file: ${email} · send via Go High Level`
        : 'No email on file — copy script or push contact to GHL for SMS';
    }
    if (sendGhlBtn) {
      sendGhlBtn.classList.toggle('hidden', !email);
    }

    wireEmailIntelOfferLinks(company);

    const intelRef = { label: '', rationale: '', talkTrack: '', draft: '' };

    if (draftSection) draftSection.classList.add('hidden');
    if (draftEl) draftEl.value = '';

    if (copyDraftBtn) {
      copyDraftBtn.onclick = async () => {
        const text = draftEl && draftEl.value ? draftEl.value : intelRef.draft;
        await copyEmailIntelScript(text, 'Script');
      };
    }

    if (aiBody) {
      aiBody.innerHTML =
        '<p class="text-sm text-brand-muted dark:text-slate-500 animate-pulse">Loading outreach script…</p>';
    }

    let key = emailIntelActiveRow.dataset.leadKey ? String(emailIntelActiveRow.dataset.leadKey).trim() : '';
    try {
      if (!key && typeof ensureRowHasLeadKey === 'function') {
        key = await ensureRowHasLeadKey(emailIntelActiveRow);
      } else if (key) {
        key = key.startsWith('lead:') ? key : `lead:${key}`;
      }
    } catch (err) {
      if (reqId !== emailIntelRequestSeq) return;
      if (aiBody) {
        aiBody.innerHTML = `<p class="text-sm text-rose-600 dark:text-rose-400">${escapeHtmlText(err.message || 'Could not prepare this lead for AI email.')}</p>`;
      }
      return;
    }

    if (key) {
      try {
        await hydrateLeadRowFromPanelData(emailIntelActiveRow);
      } catch (_) {
        /* non-fatal — fall back to row dataset */
      }
    }
    if (reqId !== emailIntelRequestSeq) return;

    const showDraft = (text) => {
      const body = String(text || '').trim();
      if (!body) return false;
      intelRef.draft = body;
      if (draftEl) draftEl.value = body;
      if (draftSection) draftSection.classList.remove('hidden');
      return true;
    };

    if (key && aiBody) {
      try {
        const keyParam = encodeURIComponent(key.replace(/^lead:/, ''));
        const [insightRes, promptRes] = await Promise.all([
          fetch(`/leads/${keyParam}/insights`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({}),
          }),
          fetch(`/leads/${keyParam}/generate-prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ preview: true }),
          }),
        ]);
        if (reqId !== emailIntelRequestSeq) return;

        const data = await insightRes.json().catch(() => ({}));
        const promptData = await promptRes.json().catch(() => ({}));

        if (promptData.success && promptData.prompt) {
          showDraft(String(promptData.prompt).trim());
        } else if (!showDraft(String(row.dataset.outreachPrompt || '').trim())) {
          try {
            const scriptsData = await fetchLeadOutreachScripts(row);
            if (reqId !== emailIntelRequestSeq) return;
            const svcKey = scriptsData.defaultServiceKey || '';
            const fromLib = pickEmailDraftFromOutreachLibrary(scriptsData.library, svcKey);
            if (fromLib) showDraft(interpolateOutreachScriptTemplate(fromLib, row));
          } catch (_) {
            /* library fallback optional */
          }
        }

        if (data.success) {
          intelRef.label = data.primaryServiceLabel || '';
          intelRef.rationale = data.rationale || '';
          intelRef.talkTrack = data.talkTrack || '';
          aiBody.innerHTML = renderEmailIntelInsightHtml(data);
        } else if (intelRef.draft) {
          aiBody.innerHTML =
            '<p class="text-sm text-brand-muted dark:text-slate-400">Script is ready below — review and send when it looks good.</p>';
        } else {
          const offers = getEmailIntelOfferScripts(company);
          if (offers[0] && showDraft(offers[0].body)) {
            aiBody.innerHTML =
              '<p class="text-sm text-brand-muted dark:text-slate-400">Pick a template below or copy the draft script.</p>';
          } else {
            aiBody.innerHTML =
              '<p class="text-sm text-rose-600 dark:text-rose-400">Could not load a script for this lead. Try again or use a quick template below.</p>';
          }
        }
      } catch {
        if (reqId !== emailIntelRequestSeq) return;
        if (
          !showDraft(String(row.dataset.outreachPrompt || '').trim()) &&
          !showDraft(getEmailIntelOfferScripts(company)[0]?.body || '')
        ) {
          if (aiBody) {
            aiBody.innerHTML =
              '<p class="text-sm text-rose-600 dark:text-rose-400">Could not load outreach script.</p>';
          }
        } else if (aiBody) {
          aiBody.innerHTML =
            '<p class="text-sm text-brand-muted dark:text-slate-400">Script is ready below.</p>';
        }
      }
    } else if (aiBody) {
      const offers = getEmailIntelOfferScripts(company);
      if (showDraft(offers[0]?.body || '')) {
        aiBody.innerHTML =
          '<p class="text-sm text-brand-muted dark:text-slate-400">Save this lead to unlock personalized AI — template draft below.</p>';
      } else {
        aiBody.innerHTML =
          '<p class="text-sm text-brand-muted dark:text-slate-500">Save this lead to unlock personalized recommendations.</p>';
      }
    }
  }
  window.__openEmailIntelModal = openEmailIntelModal;

  document.addEventListener('click', (e) => {
    const intelBtn = e.target.closest('.email-intel-btn');
    if (intelBtn) {
      e.preventDefault();
      e.stopPropagation();
      const row = intelBtn.closest('.result-row');
      if (row) openEmailIntelModal(row);
      return;
    }
    if (e.target.closest('.email-intel-close') || e.target.closest('.email-intel-backdrop')) {
      closeEmailIntelModal();
      return;
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const modal = document.getElementById('emailIntelModal');
    if (modal && !modal.classList.contains('hidden')) closeEmailIntelModal();
    const wr = document.getElementById('warRoomModal');
    if (wr && !wr.classList.contains('hidden') && typeof closeWarRoomModal === 'function') closeWarRoomModal();
  });

  // Quick outreach — open scripts popup (copy-only, no mail client)
  document.addEventListener('click', (e) => {
    const outreachBtn = e.target.closest('.quick-outreach-btn');
    if (outreachBtn) {
      e.preventDefault();
      e.stopPropagation();
      const row = outreachBtn.closest('.result-row') || currentRow;
      if (row) openEmailIntelModal(row);
    }
  });

  // Theme toggle: public/js/theme-toggle.js (included from partials/navbar on all app pages)

  const __socialBrand =
    typeof window !== 'undefined' && window.AdhelloSocialBrand ? window.AdhelloSocialBrand : null;

  // --- Track saved leads (title -> key mapping) ---
  function normalizeLeadTitleKey(title) {
    return String(title || '').trim().replace(/\s+/g, ' ');
  }

  const savedLeads = new Map();
  if (window.INITIAL_SAVED_LEADS && Array.isArray(window.INITIAL_SAVED_LEADS)) {
    window.INITIAL_SAVED_LEADS.forEach(l => {
      if (l.title && l.key) {
        savedLeads.set(normalizeLeadTitleKey(l.title), l.key);
      }
    });
  }
  window.__savedLeadsByTitle = savedLeads;

  function findInitialSavedLeadRecord(row) {
    const list = window.INITIAL_SAVED_LEADS;
    if (!Array.isArray(list) || !row) return null;
    const rawKey = String(row.dataset.leadKey || '').trim();
    const keyNorm = rawKey.replace(/^lead:/i, '');
    const titleKey = normalizeLeadTitleKey(row.dataset.title || '');
    return (
      list.find((l) => {
        if (!l) return false;
        const lk = String(l.key || '').trim();
        const lkNorm = lk.replace(/^lead:/i, '');
        if (rawKey && (lk === rawKey || lkNorm === keyNorm)) return true;
        if (titleKey && normalizeLeadTitleKey(l.title) === titleKey) return true;
        return false;
      }) || null
    );
  }

  /** Hydrate table row from SSR lead JSON embedded on pipeline pages (instant, no fetch). */
  function syncRowFromInitialSavedLeads(row) {
    const lead = findInitialSavedLeadRecord(row);
    if (!lead || !row || !row.dataset) return false;
    const ds = row.dataset;
    if (lead.title && isEmptyLeadField(ds.title)) ds.title = String(lead.title).trim();
    assignRowDatasetFieldIfBetter(ds, 'phone', lead.phone);
    assignRowDatasetFieldIfBetter(ds, 'website', lead.website);
    assignRowDatasetFieldIfBetter(ds, 'email', lead.email);
    assignRowDatasetFieldIfBetter(ds, 'address', lead.address);
    assignRowDatasetFieldIfBetter(ds, 'url', lead.url);
    assignRowDatasetFieldIfBetter(ds, 'facebook', lead.facebook);
    assignRowDatasetFieldIfBetter(ds, 'instagram', lead.instagram);
    assignRowDatasetFieldIfBetter(ds, 'twitter', lead.twitter);
    if (lead.categoryName && isEmptyLeadField(ds.category)) {
      ds.category = String(lead.categoryName).trim();
    }
    assignRowDatasetScoreIfBetter(ds, lead.totalScore, lead.reviewsCount);
    const snippets = reviewSnippetsFromLeadObj(lead);
    if (snippets.length) {
      try {
        ds.reviewSnippets = JSON.stringify(snippets);
      } catch (_) {
        /* ignore */
      }
    }
    if (Array.isArray(lead.updates) && lead.updates.length) {
      try {
        const raw = ds.updates;
        if (!raw || raw === 'undefined' || raw === '[]') {
          ds.updates = JSON.stringify(lead.updates);
        }
      } catch (_) {
        /* ignore */
      }
    }
    if (Array.isArray(lead.logs) && lead.logs.length) {
      try {
        if (!ds.logsSnippet || ds.logsSnippet === '[]') {
          ds.logsSnippet = JSON.stringify(lead.logs.slice(-14));
        }
      } catch (_) {
        /* ignore */
      }
    }
    if (Array.isArray(lead.leadLocations)) {
      try {
        ds.leadLocations = JSON.stringify(lead.leadLocations);
      } catch (_) {
        ds.leadLocations = '[]';
      }
    }
    if (Array.isArray(lead.alternateTitles)) {
      try {
        ds.alternateTitles = JSON.stringify(lead.alternateTitles);
      } catch (_) {
        ds.alternateTitles = '[]';
      }
    }
    if (Array.isArray(lead.tags)) {
      try {
        ds.tags = JSON.stringify(lead.tags);
      } catch (_) {
        ds.tags = '[]';
      }
    }
    if (ds.bookmarkClient !== '1') {
      if (lead.bookmarked) {
        ds.bookmarked = '1';
      } else if (lead.bookmarked === false) {
        ds.bookmarked = '0';
      }
    }
    return true;
  }

  function isPipelineBookmarkTable() {
    return !!document.getElementById('prospectLeadsTable');
  }

  function rowPipelineBookmarked(row) {
    if (!row || !row.dataset) return false;
    if (row.dataset.bookmarked === '1') return true;
    if (row.dataset.bookmarked === '0') return false;
    const lead = findInitialSavedLeadRecord(row);
    return !!(lead && lead.bookmarked);
  }

  function bookmarkBtnTitles(saved) {
    if (isPipelineBookmarkTable()) {
      return saved
        ? { title: 'Bookmarked — click to remove', label: 'Remove bookmark' }
        : { title: 'Bookmark lead', label: 'Bookmark lead' };
    }
    return saved
      ? { title: 'Saved — click to remove', label: 'Remove saved lead' }
      : { title: 'Save lead', label: 'Save lead' };
  }

  function isLeadTitleSaved(title) {
    const key = normalizeLeadTitleKey(title);
    return key !== '' && savedLeads.has(key);
  }
  window.__isLeadTitleSaved = isLeadTitleSaved;

  // Sync bookmark icons in table on load
  const syncBookmarkIcons = () => {
      const pipelineTable = isPipelineBookmarkTable();
      document.querySelectorAll('.result-row').forEach(row => {
          const bookmarkBtn = row.querySelector('.bookmark-btn');
          if (!bookmarkBtn) return;

          if (pipelineTable && row.dataset.leadKey) {
            if (row.dataset.bookmarkClient === '1' || bookmarkBtn.dataset.bookmarkBusy === '1') {
              return;
            }
            if (rowPipelineBookmarked(row)) markBookmarkSaved(bookmarkBtn);
            else markBookmarkUnsaved(bookmarkBtn);
            return;
          }

          const title = row.dataset.title;
          if (title && isLeadTitleSaved(title)) {
              const mapKey = normalizeLeadTitleKey(title);
              const leadKey = savedLeads.get(mapKey);
              row.dataset.leadKey = leadKey;
              markBookmarkSaved(bookmarkBtn);
          }
      });
  };
  syncBookmarkIcons();

  // --- Search Form Handling (POST /search → Apify in background) ---
  const searchForm = document.getElementById('searchForm');
  const btn = document.getElementById('searchBtn');
  const loader = document.getElementById('loadingIndicator');
  const modeRunNow = document.getElementById('modeRunNow');
  const modeSchedule = document.getElementById('modeSchedule');
  const searchModeInput = document.getElementById('searchModeInput');
  const userTimezoneInput = document.getElementById('userTimezone');
  const searchBtnLabel = btn ? btn.querySelector('#searchBtnText') : null;
  const scheduleSubmitBtn = document.getElementById('scheduleSubmitBtn');
  const searchBackgroundNotice = document.getElementById('leadRunProgressBanner');
  const searchFolderKey = document.getElementById('searchFolderKey');
  const searchNewFolderWrap = document.getElementById('searchNewFolderWrap');
  const searchNewFolderName = document.getElementById('searchNewFolderName');
  const runNowAlso = document.getElementById('runNowAlso');

  if (userTimezoneInput) {
    userTimezoneInput.value = Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  function getScheduleDateInput() {
    return document.getElementById('findScheduleDateInput') || document.getElementById('scheduledDateInput');
  }

  function setScheduledDateDefaults() {
    const dateEl = getScheduleDateInput();
    if (!dateEl) return;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const y = tomorrow.getFullYear();
    const m = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const d = String(tomorrow.getDate()).padStart(2, '0');
    const isoLocal = `${y}-${m}-${d}`;
    dateEl.min = isoLocal;
    if (!dateEl.value) dateEl.value = isoLocal;
  }

  if (modeRunNow && modeSchedule && searchModeInput) {
    const scheduledSearchSettings = document.getElementById('scheduledSearchSettings');
    const setModeButtonClasses = (mode) => {
      if (mode === 'run') {
        modeRunNow.className = 'flex-1 h-full rounded-lg text-[9px] font-black uppercase transition-all bg-white dark:bg-slate-700 text-brand-dark dark:text-slate-100 shadow-sm border border-brand-border/10';
        modeSchedule.className = 'flex-1 h-full rounded-lg text-[9px] font-black uppercase transition-all text-brand-muted dark:text-slate-400 hover:text-brand-dark dark:hover:text-slate-100';
      } else {
        modeSchedule.className = 'flex-1 h-full rounded-lg text-[9px] font-black uppercase transition-all bg-white dark:bg-slate-700 text-brand-dark dark:text-slate-100 shadow-sm border border-brand-border/10';
        modeRunNow.className = 'flex-1 h-full rounded-lg text-[9px] font-black uppercase transition-all text-brand-muted dark:text-slate-400 hover:text-brand-dark dark:hover:text-slate-100';
      }
    };

    modeRunNow.addEventListener('click', () => {
      searchModeInput.value = 'run';
      setModeButtonClasses('run');

      if (scheduledSearchSettings) {
        scheduledSearchSettings.classList.add('hidden');
      }
      if (runNowAlso) runNowAlso.checked = false;
      const dateEl = getScheduleDateInput();
      if (dateEl) dateEl.required = false;

      if (typeof window.syncFindSubmitLabel === 'function') {
        window.syncFindSubmitLabel(false);
      } else if (searchBtnLabel) {
        searchBtnLabel.innerHTML = 'Start search<svg class="w-4 h-4 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>';
      }
    });

    modeSchedule.addEventListener('click', () => {
      searchModeInput.value = 'schedule';
      setModeButtonClasses('schedule');

      if (scheduledSearchSettings) {
        scheduledSearchSettings.classList.remove('hidden');
      }
      setScheduledDateDefaults();

      if (typeof window.syncFindSubmitLabel === 'function') {
        window.syncFindSubmitLabel(true);
      } else if (searchBtnLabel) {
        searchBtnLabel.innerHTML = 'Schedule search<svg class="w-4 h-4 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>';
      }
    });

    setModeButtonClasses(searchModeInput.value === 'run' ? 'run' : 'schedule');
    if (typeof window.syncFindSubmitLabel === 'function') {
      window.syncFindSubmitLabel(searchModeInput.value === 'schedule');
    } else if (searchBtnLabel && searchModeInput.value === 'schedule') {
      searchBtnLabel.innerHTML = 'Schedule search<svg class="w-4 h-4 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>';
    }
  }

  if (searchForm) {
    const syncSearchFolderMode = () => {
      if (!searchFolderKey || !searchNewFolderWrap || !searchNewFolderName) return;
      const isCreate = searchFolderKey.value === '__new__';
      searchNewFolderWrap.classList.toggle('hidden', !isCreate);
      searchNewFolderName.required = isCreate;
      if (isCreate) {
        searchNewFolderName.focus();
      } else {
        searchNewFolderName.value = '';
      }
    };

    if (searchFolderKey) {
      searchFolderKey.addEventListener('change', syncSearchFolderMode);
      syncSearchFolderMode();
    }

    searchForm.addEventListener('submit', () => {
      if (searchFolderKey && searchFolderKey.value === '__new__') {
        searchFolderKey.value = '';
      }
      updateProcessingStatus(true);
      const loadingOverlay = document.getElementById('loadingOverlay');
      if (loadingOverlay) loadingOverlay.classList.remove('hidden');

      const isSchedule = searchModeInput && searchModeInput.value === 'schedule';
      if (!isSchedule && btn) {
        btn.disabled = true;
        btn.innerHTML = `
            <svg class="w-4 h-4 animate-spin text-brand-dark" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            <span class="ml-2">Searching...</span>
          `;
        btn.classList.add('opacity-50', 'cursor-not-allowed', 'animate-pulse');
      }
      if (!isSchedule && loader) {
        loader.classList.remove('hidden');
      }
      if (!isSchedule && searchBackgroundNotice) {
        searchBackgroundNotice.classList.remove('hidden');
      }
      if (!isSchedule && typeof window.showLeadRunProgressBanner === 'function') {
        var kwEl = document.getElementById('searchKeywordField');
        var cityEl = document.getElementById('findManualCity');
        var stateEl = document.getElementById('findManualState');
        var folderEl = document.getElementById('searchFolderKey');
        var folderKey =
          folderEl && folderEl.value && folderEl.value !== '__new__'
            ? String(folderEl.value).trim()
            : typeof window.ACTIVE_FOLDER_KEY === 'string'
              ? window.ACTIVE_FOLDER_KEY.trim()
              : '';
        var folderName = '';
        if (folderKey && Array.isArray(window.WORKSPACE_FOLDERS)) {
          var match = window.WORKSPACE_FOLDERS.find(function (f) {
            return f && f.key === folderKey;
          });
          folderName = match && match.name ? String(match.name) : '';
        }
        window.showLeadRunProgressBanner({
          keyword: kwEl && kwEl.value ? kwEl.value.trim() : '',
          city: cityEl && cityEl.value ? cityEl.value.trim() : '',
          state: stateEl && stateEl.value ? stateEl.value.trim() : '',
          targetFolderKey: folderKey,
          targetFolderName: folderName,
        });
      }
      if (!isSchedule) {
        const bellBadge = document.getElementById('bulkEnhanceBellBadge');
        const pingDot = document.getElementById('notificationPing');
        if (bellBadge) {
          bellBadge.textContent = 'RUN';
          bellBadge.classList.remove('hidden');
          bellBadge.setAttribute('title', 'Lead search running in background');
        }
        if (pingDot) pingDot.classList.remove('hidden');
      }
      if (isSchedule && runNowAlso && runNowAlso.checked && btn) {
        btn.disabled = true;
        btn.classList.add('opacity-50', 'cursor-not-allowed');
      }
      if (isSchedule && scheduleSubmitBtn) {
        scheduleSubmitBtn.disabled = true;
        scheduleSubmitBtn.classList.add('opacity-50', 'cursor-not-allowed');
      }
    });
  }

  // Find Leads wizard (2-step: area → search)
  const wizardPanels = document.querySelectorAll('[data-step-panel]');
  if (wizardPanels && wizardPanels.length) {
    const findWizardScrollTarget = document.getElementById('searchContainer');

    function findTypeRequiresLocation() {
      const form = document.getElementById('searchForm');
      const type = form && form.getAttribute('data-find-type');
      if (type === 'products' || type === 'wholesale' || type === 'business_formations') return false;
      return true;
    }

    function applyTypedFindLocation() {
      if (typeof window.applyTypedFindLocationFromQuery === 'function') {
        return window.applyTypedFindLocationFromQuery();
      }
      const queryEl = document.getElementById('findLocationQuery');
      const helper = window.AdhelloFindLocation;
      if (!queryEl || !helper || typeof helper.parseCityStateFromQuery !== 'function') return false;
      const parsed = helper.parseCityStateFromQuery(queryEl.value);
      if (!parsed.city || !parsed.state) return false;
      const city = document.getElementById('findManualCity');
      const state = document.getElementById('findManualState');
      if (city) city.value = parsed.city;
      if (state) state.value = parsed.state;
      return true;
    }

    function hasFindLocation() {
      if (!findTypeRequiresLocation()) return true;
      const form = document.getElementById('searchForm');
      const type = form && form.getAttribute('data-find-type');
      if (type === 'permits') {
        const sel = document.getElementById('findPermitCity');
        return Boolean(sel && String(sel.value || '').trim());
      }
      const city = document.getElementById('findManualCity');
      const state = document.getElementById('findManualState');
      if (city && state && String(city.value || '').trim() && String(state.value || '').trim()) {
        return true;
      }
      return applyTypedFindLocation();
    }

    function showFindLocationRequired() {
      const form = document.getElementById('searchForm');
      const type = form && form.getAttribute('data-find-type');
      const summary = document.getElementById('findLocationSummaryText');
      applyTypedFindLocation();
      if (type !== 'permits' && hasFindLocation()) {
        trySetStep('2');
        return;
      }
      if (type !== 'permits' && typeof window.resolveFindLocationFromQuery === 'function') {
        window.resolveFindLocationFromQuery(() => {
          if (hasFindLocation()) trySetStep('2');
        });
        return;
      }
      if (summary) {
        summary.textContent =
          type === 'permits'
            ? 'Select a supported Permit Stack city from the dropdown.'
            : 'Enter a city and state (e.g. Vancouver, WA).';
        summary.classList.remove('text-brand-muted');
        summary.classList.add('text-brand-dark', 'dark:text-white');
      }
      const focusEl =
        type === 'permits'
          ? document.getElementById('findPermitCityTrigger') || document.getElementById('findPermitCitySearch')
          : document.getElementById('findLocationQuery') || document.getElementById('findManualCity');
      if (focusEl) {
        focusEl.focus();
        if (type === 'permits') {
          var picker = document.querySelector('[data-permit-city-picker]');
          if (picker && typeof picker.openPermitCityPicker === 'function') {
            picker.openPermitCityPicker();
          }
        }
      }
    }

    const trySetStep = (stepNo) => {
      const step = String(stepNo);
      if (step === '2') {
        applyTypedFindLocation();
        if (!hasFindLocation()) {
          showFindLocationRequired();
          return;
        }
        closeFindAreaMapPanelIfOpen();
      }
      setStep(step);
    };

    function closeFindAreaMapPanelIfOpen() {
      const panel = document.getElementById('findAreaMapPanel');
      if (panel && !panel.classList.contains('hidden')) panel.classList.add('hidden');
    }

    const setStep = (stepNo) => {
      wizardPanels.forEach((panel) => {
        panel.classList.toggle('hidden', String(panel.getAttribute('data-step-panel')) !== String(stepNo));
      });
      document.querySelectorAll('[data-step-indicator]').forEach((el) => {
        const active = String(el.getAttribute('data-step-indicator')) === String(stepNo);
        const num = el.querySelector('span.flex.h-7');
        el.classList.toggle('border-brand-yellow/50', active);
        el.classList.toggle('bg-brand-yellow/15', active);
        el.classList.toggle('text-brand-dark', active);
        el.classList.toggle('dark:text-white', active);
        if (num) {
          num.classList.toggle('bg-brand-yellow', active);
          num.classList.toggle('text-brand-dark', active);
          num.classList.toggle('bg-brand-cream', !active);
          num.classList.toggle('dark:bg-slate-800', !active);
        }
        if (active) {
          el.classList.remove('border-brand-border/40', 'dark:border-white/10', 'text-brand-muted');
        } else {
          el.classList.remove('border-brand-yellow/50', 'bg-brand-yellow/15', 'text-brand-dark', 'dark:text-white');
          el.classList.add('border-brand-border/40', 'dark:border-white/10', 'text-brand-muted');
        }
      });
      const scrollEl = findWizardScrollTarget || document.getElementById('searchForm');
      if (scrollEl && typeof scrollEl.scrollIntoView === 'function') {
        scrollEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };

    document.querySelectorAll('[data-step-next]').forEach((btnNext) => {
      btnNext.addEventListener('click', () => trySetStep(btnNext.getAttribute('data-step-next')));
    });
    document.querySelectorAll('[data-step-prev]').forEach((btnPrev) => {
      btnPrev.addEventListener('click', () => setStep(btnPrev.getAttribute('data-step-prev')));
    });
    document.querySelectorAll('[data-step-goto]').forEach((btnGoto) => {
      btnGoto.addEventListener('click', () => trySetStep(btnGoto.getAttribute('data-step-goto')));
    });

    document.addEventListener('find:locationModeChanged', (ev) => {
      const detail = (ev && ev.detail) || {};
      if (detail.requiresLocation === false) {
        setStep(2);
      } else if (detail.requiresLocation === true) {
        setStep(1);
      }
    });

    setStep(findTypeRequiresLocation() ? 1 : 2);
  }

  // --- Navigation & Menu ---
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const mobileMenu = document.getElementById('mobileMenu');
  const closeMobileMenu = document.getElementById('closeMobileMenu');

  if (mobileMenuBtn && mobileMenu) {
    const mobileMenuPanel = mobileMenu.querySelector('div.absolute.inset-y-0.left-0');
    mobileMenuBtn.addEventListener('click', () => {
      mobileMenu.classList.remove('hidden');
      setTimeout(() => {
        mobileMenu.classList.add('open');
        if (mobileMenuPanel) mobileMenuPanel.classList.remove('-translate-x-full');
      }, 10);
    });

    const closeNav = () => {
      if (mobileMenuPanel) mobileMenuPanel.classList.add('-translate-x-full');
      mobileMenu.classList.remove('open');
      setTimeout(() => mobileMenu.classList.add('hidden'), 300);
    };

    if (closeMobileMenu) closeMobileMenu.addEventListener('click', closeNav);
    mobileMenu.addEventListener('click', (e) => {
      if (e.target === mobileMenu) closeNav();
    });
  }

  // --- Detail panel & rows (must not depend on mobile nav; panel exists on Prospecting / leads pages) ---
  const mobilePanel = document.getElementById('mobilePanel');
  const getLeadDetailPanel = () => document.getElementById('mobilePanel');
  function getLeadPanelEl(id) {
    const panel = getLeadDetailPanel();
    if (panel && id) {
      const scoped = panel.querySelector('#' + String(id).replace(/^#/, ''));
      if (scoped) return scoped;
    }
    return document.getElementById(id);
  }
  const LEAD_PANEL_INLINE_PROPS = ['display', 'opacity', 'pointer-events', 'visibility', 'z-index'];
  function clearLeadDetailPanelForceStyles(el) {
    if (!el || !el.style) return;
    LEAD_PANEL_INLINE_PROPS.forEach((p) => el.style.removeProperty(p));
  }

  function dismissLeadDetailPanel() {
    const panel = getLeadDetailPanel();
    if (!panel) return;
    panel.classList.remove('open');
    panel.classList.replace('opacity-100', 'opacity-0');
    panel.classList.add('hidden', 'pointer-events-none');
    clearLeadDetailPanelForceStyles(panel);
    panel.style.pointerEvents = 'none';
    document.body.style.overflow = '';
    const innerSheet = panel.querySelector(':scope > div');
    if (innerSheet) {
      innerSheet.classList.add('translate-y-full', 'translate-x-full');
      innerSheet.style.removeProperty('display');
    }
    disposeLeadPanelJsMap();
    rows.forEach((r) => r.classList.remove('selected'));
    currentRow = null;
    currentIndex = -1;
  }

  function ensureLeadDetailPanelNotBlockingPage() {
    const panel = getLeadDetailPanel();
    if (!panel) return;
    if (new URLSearchParams(window.location.search).get('focusLead')) return;
    const intentionallyOpen =
      panel.classList.contains('open') &&
      !panel.classList.contains('hidden') &&
      panel.classList.contains('opacity-100');
    if (intentionallyOpen) return;
    const inlineDisplay = panel.style.getPropertyValue('display');
    const inlinePe = panel.style.getPropertyValue('pointer-events');
    const stuckOverlay =
      inlinePe === 'auto' ||
      (inlineDisplay && inlineDisplay.includes('flex') && !panel.classList.contains('hidden'));
    if (stuckOverlay) dismissLeadDetailPanel();
  }

  const closeMobileBtn = document.getElementById('closeMobilePanel');
  const prevLeadBtn = document.getElementById('prevLeadBtn');
  const nextLeadBtn = document.getElementById('nextLeadBtn');
  let rows = document.querySelectorAll('.result-row');
  const navigableRows = () =>
    Array.from(document.querySelectorAll('.result-row')).filter(
      (r) =>
        !r.classList.contains('workflow-filtered-out') &&
        !r.classList.contains('result-row--panel-source')
    );
  let currentRow = null;
  let currentIndex = -1;

  function fillLeadScriptPlaceholdersForNote(text, row) {
    if (!text) return '';
    const title = String((row && row.dataset && row.dataset.title) || '').trim();
    const city = String((row && row.dataset && row.dataset.city) || '').trim();
    const storedOwner = String((row && row.dataset && row.dataset.ownerFirstName) || '').trim();
    const ownerInp = document.getElementById('leadPanelOwnerFirstName');
    const typedOwner = ownerInp ? String(ownerInp.value || '').trim() : '';
    const ownerTok = (typedOwner || storedOwner).split(/\s+/)[0] || '';
    const helper = typeof window !== 'undefined' ? window.AdHelloScripts : null;
    if (helper && helper.fillScriptPlaceholders) {
      return helper.fillScriptPlaceholders(text, {
        sender: helper.getScriptProfile ? helper.getScriptProfile() : window.__ADHELLO_SCRIPT_PROFILE__,
        prospect: { name: ownerTok || title, company: title, city },
      });
    }
    let t = String(text);
    t = t.replace(/\{\{company\}\}/gi, title || 'your business');
    t = t.replace(/\{\{name\}\}/gi, ownerTok || title || 'there');
    t = t.replace(/\{\{city\}\}/gi, city || 'your area');
    return t;
  }

  function formatSellingScriptForChannel(rawText, channel, row) {
    let t = fillLeadScriptPlaceholdersForNote(rawText, row);
    const ch = String(channel || 'call').toLowerCase();
    const ownerInp = document.getElementById('leadPanelOwnerFirstName');
    const owner = ownerInp
      ? String(ownerInp.value || '').trim().split(/\s+/)[0]
      : String((row && row.dataset && row.dataset.ownerFirstName) || '')
          .trim()
          .split(/\s+/)[0];
    if (ch === 'voicemail') {
      const hi = owner ? `Hi ${owner}, ` : 'Hi, ';
      const helper = typeof window !== 'undefined' ? window.AdHelloScripts : null;
      const sender = helper && helper.getScriptProfile ? helper.getScriptProfile() : (window.__ADHELLO_SCRIPT_PROFILE__ || {});
      const agency = String((sender && sender.company) || '').trim();
      const yourName = String((sender && sender.name) || '').trim();
      const yourNumber = String((sender && sender.phone) || '').trim();
      if (!/^hi\b/i.test(t.trim())) {
        t = `${hi}this is ${yourName || '[your name]'} with ${agency || '[agency]'}. ${t}`;
      }
      if (!/call\s+back/i.test(t)) {
        t = `${t.trim()} Give me a call back at ${yourNumber || '[your number]'} when you have a minute.`;
      }
    }
    if (ch === 'email') {
      const title = String((row && row.dataset && row.dataset.title) || 'your business').trim();
      if (!/^subject:/im.test(t)) {
        t = `Subject: Quick idea for ${title}\n\n${t}`;
      }
    }
    return t;
  }

  let leadOutreachScriptsCache = {
    workspaceId: '',
    leadKey: '',
    data: null,
    loading: null,
    loadingKey: '',
    workspaceData: null,
    workspaceLoading: null,
  };
  if (!window.__leadOutreachChannel) window.__leadOutreachChannel = 'call';

  function getActiveWorkspaceIdForScripts() {
    return String(
      (typeof window !== 'undefined' && window.__ADHELLO_WORKSPACE_ID__) ||
        (document.documentElement && document.documentElement.dataset.workspaceId) ||
        '',
    ).trim();
  }

  function invalidateLeadOutreachScriptsCacheIfWorkspaceChanged() {
    const wid = getActiveWorkspaceIdForScripts();
    if (!wid) return;
    if (leadOutreachScriptsCache.workspaceId && leadOutreachScriptsCache.workspaceId !== wid) {
      leadOutreachScriptsCache.workspaceData = null;
      leadOutreachScriptsCache.workspaceLoading = null;
      leadOutreachScriptsCache.leadKey = '';
      leadOutreachScriptsCache.data = null;
      leadOutreachScriptsCache.loading = null;
      leadOutreachScriptsCache.loadingKey = '';
      window.__ADHELLO_OUTREACH_LIBRARY__ = null;
    }
    leadOutreachScriptsCache.workspaceId = wid;
  }

  function seedLeadOutreachScriptsCacheFromEmbedded(row) {
    const embedded = getEmbeddedOutreachScriptsPayload(row);
    if (!embedded) return;
    const key = normalizeLeadKeyForScriptsFetch(row && row.dataset ? row.dataset.leadKey : '');
    if (key) {
      leadOutreachScriptsCache.leadKey = key;
      leadOutreachScriptsCache.data = embedded;
    } else if (!leadOutreachScriptsCache.workspaceData) {
      leadOutreachScriptsCache.workspaceData = embedded;
    }
  }

  function getActiveOutreachScriptsData(row) {
    const key = normalizeLeadKeyForScriptsFetch(row && row.dataset ? row.dataset.leadKey : '');
    if (
      key &&
      leadOutreachScriptsCache.leadKey === key &&
      leadOutreachScriptsCache.data &&
      outreachLibraryHasScripts(leadOutreachScriptsCache.data.library)
    ) {
      return leadOutreachScriptsCache.data;
    }
    if (
      !key &&
      leadOutreachScriptsCache.workspaceData &&
      outreachLibraryHasScripts(leadOutreachScriptsCache.workspaceData.library)
    ) {
      return leadOutreachScriptsCache.workspaceData;
    }
    const embedded = getEmbeddedOutreachScriptsPayload(row);
    if (embedded) return embedded;
    if (leadOutreachScriptsCache.workspaceData) return leadOutreachScriptsCache.workspaceData;
    return null;
  }

  function applyLeadPanelSellingScriptFromCache(row) {
    const target = row || currentRow;
    if (!target) return false;
    const data = getActiveOutreachScriptsData(target);
    if (!data || !outreachLibraryHasScripts(data.library)) return false;
    syncLeadOutreachChannelButtons();
    applyLeadPanelSellingScriptFromData(target, data);
    return true;
  }

  /** Sync script for current service + channel without re-fetch when library is already loaded. */
  function applyLeadPanelSellingScriptNow(row) {
    return applyLeadPanelSellingScriptFromCache(row);
  }

  function onLeadPanelOutreachScriptInputsChanged(row, opts) {
    const target = row || currentRow;
    if (!target) return;
    if (applyLeadPanelSellingScriptNow(target) && !(opts && opts.forceFetch)) {
      return;
    }
    const fetchOpts = { ...(opts || {}), skipLoading: !!(opts && opts.skipLoading) };
    syncLeadPanelSellingScript(target, fetchOpts).catch(() => {});
  }

  function setLeadOutreachChannel(channel) {
    const ch = String(channel || 'call').toLowerCase();
    window.__leadOutreachChannel = ['call', 'text', 'voicemail', 'email'].includes(ch) ? ch : 'call';
    syncLeadOutreachChannelButtons();
    syncLeadSmsThreadSectionVisibility();
  }

  let leadSmsThreadPollTimer = null;

  function escapeSmsHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatSmsThreadTime(ts) {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function syncLeadSmsThreadSectionVisibility() {
    const section = document.getElementById('leadSmsThreadSection');
    if (!section) return;
    const channel = window.__leadOutreachChannel || 'call';
    const row = resolvePanelActionRow ? resolvePanelActionRow() : currentRow;
    const phone = row && row.dataset ? readPipelineRowDisplayPhone(row) : '';
    const show = channel === 'text' && !!String(phone || '').trim() && String(phone).trim() !== '—';
    section.classList.toggle('hidden', !show);
    if (show && row) {
      loadLeadSmsThread(row, { sync: true }).catch(() => {});
      startLeadSmsThreadPolling(row);
    } else {
      stopLeadSmsThreadPolling();
    }
  }

  function stopLeadSmsThreadPolling() {
    if (leadSmsThreadPollTimer) {
      clearInterval(leadSmsThreadPollTimer);
      leadSmsThreadPollTimer = null;
    }
  }

  function startLeadSmsThreadPolling(row) {
    stopLeadSmsThreadPolling();
    if (!row) return;
    leadSmsThreadPollTimer = setInterval(() => {
      if ((window.__leadOutreachChannel || 'call') !== 'text') return;
      const active = resolvePanelActionRow ? resolvePanelActionRow() : currentRow;
      if (!active || active !== row) return;
      loadLeadSmsThread(row, { sync: true, quiet: true }).catch(() => {});
    }, 45000);
  }

  function renderLeadSmsThread(messages) {
    const list = document.getElementById('leadSmsThreadList');
    if (!list) return;
    const items = Array.isArray(messages) ? messages : [];
    if (!items.length) {
      list.innerHTML = '<p class="text-[11px] text-brand-muted italic m-0">No messages yet.</p>';
      return;
    }
    list.innerHTML = items
      .map((msg) => {
        const inbound = String(msg.direction || '').toLowerCase() === 'inbound';
        const time = formatSmsThreadTime(msg.timestamp);
        const body = escapeSmsHtml(msg.body || '');
        if (inbound) {
          return `<div class="flex flex-col items-start max-w-[92%]"><div class="rounded-2xl rounded-tl-sm bg-brand-cream/80 dark:bg-slate-800 border border-brand-border/20 dark:border-white/10 px-3 py-2 text-[11px] font-semibold text-brand-dark dark:text-slate-200 leading-relaxed">${body}</div><span class="text-[8px] font-bold uppercase tracking-widest text-brand-muted mt-1">${time ? time + ' · ' : ''}Lead</span></div>`;
        }
        return `<div class="flex flex-col items-end ml-auto max-w-[92%]"><div class="rounded-2xl rounded-tr-sm bg-brand-yellow/90 text-brand-dark px-3 py-2 text-[11px] font-semibold leading-relaxed shadow-sm">${body}</div><span class="text-[8px] font-bold uppercase tracking-widest text-brand-muted mt-1">${time ? time + ' · ' : ''}You</span></div>`;
      })
      .join('');
    list.scrollTop = list.scrollHeight;
  }

  function setLeadSmsThreadStatus(text, isError) {
    const el = document.getElementById('leadSmsThreadStatus');
    if (!el) return;
    el.textContent = String(text || '');
    el.classList.toggle('text-rose-600', !!isError);
    el.classList.toggle('dark:text-rose-400', !!isError);
    el.classList.toggle('text-brand-muted', !isError);
  }

  async function loadLeadSmsThread(row, opts) {
    const options = opts || {};
    const key = normalizeLeadKeyForApi(row && row.dataset ? row.dataset.leadKey : '');
    if (!key) return;
    if (!options.quiet) setLeadSmsThreadStatus('Loading messages…');
    const syncQ = options.sync ? '?sync=1' : '';
    const res = await fetch(`/leads/${encodeURIComponent(key)}/sms-thread${syncQ}`, {
      headers: { Accept: 'application/json' },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      throw new Error((data && data.error) || `HTTP ${res.status}`);
    }
    renderLeadSmsThread(data.messages || []);
    if (data.lead && row) {
      syncPersistedLeadToRowDataset(row, data.lead);
      if (typeof refreshLeadActivityTimeline === 'function') {
        refreshLeadActivityTimeline(row);
      }
    }
    if (!options.quiet) {
      const n = Array.isArray(data.messages) ? data.messages.length : 0;
      const synced = data.synced || 0;
      setLeadSmsThreadStatus(
        synced > 0 ? `${n} messages · ${synced} new from GHL` : n ? `${n} messages` : 'Ready',
      );
    }
    return data;
  }

  async function sendLeadSmsCompose() {
    const input = document.getElementById('leadSmsComposeInput');
    const btn = document.getElementById('leadSmsComposeSendBtn');
    const row = resolvePanelActionRow ? resolvePanelActionRow() : currentRow;
    const key = normalizeLeadKeyForApi(row && row.dataset ? row.dataset.leadKey : '');
    const body = String((input && input.value) || '').trim();
    if (!key || !body) return;
    if (btn) btn.disabled = true;
    setLeadSmsThreadStatus('Sending…');
    try {
      await sendSmsToLeadKey(key, body);
      if (input) input.value = '';
      const countEl = document.getElementById('leadSmsComposeCount');
      if (countEl) countEl.textContent = '0';
      await loadLeadSmsThread(row, { sync: true });
      setLeadSmsThreadStatus('Sent');
    } catch (err) {
      setLeadSmsThreadStatus((err && err.message) || 'Send failed', true);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  window.__loadLeadSmsThread = loadLeadSmsThread;
  window.__syncLeadSmsThreadSectionVisibility = syncLeadSmsThreadSectionVisibility;

  const leadSmsComposeInput = document.getElementById('leadSmsComposeInput');
  const leadSmsComposeCount = document.getElementById('leadSmsComposeCount');
  if (leadSmsComposeInput && leadSmsComposeCount) {
    const syncComposeCount = () => {
      leadSmsComposeCount.textContent = String((leadSmsComposeInput.value || '').length);
    };
    leadSmsComposeInput.addEventListener('input', syncComposeCount);
    leadSmsComposeInput.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        void sendLeadSmsCompose();
      }
    });
  }

  function outreachLibraryHasScripts(library) {
    return !!(library && typeof library === 'object' && Object.keys(library).length > 0);
  }

  function getEmbeddedOutreachScriptsPayload(row) {
    const library =
      typeof window !== 'undefined' && window.__ADHELLO_OUTREACH_LIBRARY__
        ? window.__ADHELLO_OUTREACH_LIBRARY__
        : null;
    if (!outreachLibraryHasScripts(library)) return null;
    const services = Array.isArray(window.ADHELLO_SERVICE_OFFERS) ? window.ADHELLO_SERVICE_OFFERS : [];
    const keys = services.map((s) => s && s.key).filter(Boolean);
    const rowKey = String((row && row.dataset && row.dataset.primaryServiceKey) || '').trim();
    let defaultServiceKey = keys.includes(rowKey) ? rowKey : keys[0] || '';
    if (!defaultServiceKey) {
      const libKeys = Object.keys(library);
      defaultServiceKey = libKeys[0] || '';
    }
    return {
      success: true,
      library,
      services,
      defaultServiceKey,
    };
  }

  async function fetchWorkspaceOutreachLibrary() {
    invalidateLeadOutreachScriptsCacheIfWorkspaceChanged();
    const wid = getActiveWorkspaceIdForScripts();
    if (
      leadOutreachScriptsCache.workspaceData &&
      (!wid || leadOutreachScriptsCache.workspaceId === wid)
    ) {
      return leadOutreachScriptsCache.workspaceData;
    }
    if (leadOutreachScriptsCache.workspaceLoading) return leadOutreachScriptsCache.workspaceLoading;
    const p = (async () => {
      const url = '/leads/outreach-library';
      const fetchJsonFn = typeof window.fetchJson === 'function' ? window.fetchJson : null;
      let data;
      if (fetchJsonFn) {
        const { ok, j } = await fetchJsonFn(url, {
          method: 'GET',
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
        });
        if (!ok || !j.success) throw new Error((j && j.error) || 'Scripts failed');
        data = j;
      } else {
        const res = await fetch(url, {
          method: 'GET',
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
        });
        data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.error || 'Scripts failed');
      }
      if (!outreachLibraryHasScripts(data.library)) {
        throw new Error('No scripts in library');
      }
      if (Array.isArray(data.services) && data.services.length) {
        window.ADHELLO_SERVICE_OFFERS = data.services.map((s) => ({
          key: s.key,
          label: s.label || s.key,
        }));
        ensureLeadPanelPrimaryServiceSelectOptions(true);
      }
      window.__ADHELLO_OUTREACH_LIBRARY__ = data.library;
      leadOutreachScriptsCache.workspaceId = wid || getActiveWorkspaceIdForScripts();
      leadOutreachScriptsCache.workspaceData = data;
      return data;
    })();
    leadOutreachScriptsCache.workspaceLoading = p;
    try {
      return await p;
    } finally {
      leadOutreachScriptsCache.workspaceLoading = null;
    }
  }

  function resolveLeadPanelServiceKey(row, data) {
    const sel = document.getElementById('leadPanelPrimaryServiceSelect');
    const library = data && data.library && typeof data.library === 'object' ? data.library : {};
    const explicit = sel ? String(sel.value || '').trim() : '';
    if (explicit && library[explicit]) return explicit;
    if (!explicit && row && row.dataset) {
      const rowKey = String(row.dataset.primaryServiceKey || '').trim();
      if (rowKey && library[rowKey]) return rowKey;
    }
    const def = String((data && data.defaultServiceKey) || '').trim();
    if (def && library[def]) return def;
    const first = Object.keys(library)[0] || '';
    return first;
  }

  function applyLeadPanelSellingScriptFromData(row, data) {
    const scriptEl = document.getElementById('leadPanelSellingScript');
    if (!scriptEl || !row) return;
    const library = data && data.library && typeof data.library === 'object' ? data.library : null;
    if (!outreachLibraryHasScripts(library)) {
      scriptEl.textContent = 'Add scripts in Sales → Script library to use this panel.';
      return;
    }
    const channel = window.__leadOutreachChannel || 'call';
    const serviceKey = resolveLeadPanelServiceKey(row, data);
    const svc = serviceKey && library ? library[serviceKey] : null;
    const auditSell = document.getElementById('mobilePanelAuditSell');
    if (auditSell && svc && svc.label) auditSell.textContent = svc.label;
    const raw =
      svc && svc.channels && svc.channels[channel] ? String(svc.channels[channel]) : '';
    if (!raw) {
      scriptEl.textContent = serviceKey
        ? 'No script for this channel yet. Add one in Sales → Script library.'
        : 'Pick a service above to load your script.';
      return;
    }
    scriptEl.innerHTML = '';
    const filled = formatSellingScriptForChannel(raw, channel, row);
    const helper = typeof window !== 'undefined' ? window.AdHelloScripts : null;
    if (helper && helper.sanitizeScriptHtml && /<(?:b|strong|i|em|u|br|p|div)\b/i.test(filled)) {
      scriptEl.innerHTML = helper.sanitizeScriptHtml(filled);
    } else {
      scriptEl.textContent = filled;
    }
    resetLeadPanelSellHint();
  }

  function refreshLeadPanelSellingScript(row, opts) {
    const target = row || currentRow;
    if (!target) return Promise.resolve();
    if (opts && opts.cacheOnly) {
      applyLeadPanelSellingScriptFromCache(target);
      return Promise.resolve();
    }
    return syncLeadPanelSellingScript(target, opts);
  }

  if (typeof window !== 'undefined') {
    window.refreshLeadPanelSellingScript = refreshLeadPanelSellingScript;
  }

  async function fetchLeadOutreachScripts(row) {
    const key = normalizeLeadKeyForScriptsFetch(row && row.dataset ? row.dataset.leadKey : '');
    const embedded = getEmbeddedOutreachScriptsPayload(row);
    if (!key) {
      if (embedded) return embedded;
      return fetchWorkspaceOutreachLibrary();
    }
    if (leadOutreachScriptsCache.leadKey === key && leadOutreachScriptsCache.data) {
      return leadOutreachScriptsCache.data;
    }
    if (leadOutreachScriptsCache.loading && leadOutreachScriptsCache.loadingKey === key) {
      return leadOutreachScriptsCache.loading;
    }
    const p = (async () => {
      const fetchJsonFn = typeof window.fetchJson === 'function' ? window.fetchJson : null;
      const url = `/leads/${encodeURIComponent(key)}/outreach-scripts`;
      let data;
      try {
        if (fetchJsonFn) {
          const { ok, j } = await fetchJsonFn(url, {
            method: 'GET',
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
          });
          if (!ok || !j.success) throw new Error((j && j.error) || 'Scripts failed');
          data = j;
        } else {
          const res = await fetch(url, {
            method: 'GET',
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
          });
          data = await res.json().catch(() => ({}));
          if (!res.ok || !data.success) throw new Error(data.error || 'Scripts failed');
        }
      } catch (err) {
        if (embedded) return embedded;
        try {
          return await fetchWorkspaceOutreachLibrary();
        } catch (_) {
          throw err;
        }
      }
      if (Array.isArray(data.services) && data.services.length) {
        window.ADHELLO_SERVICE_OFFERS = data.services.map((s) => ({
          key: s.key,
          label: s.label || s.key,
        }));
        ensureLeadPanelPrimaryServiceSelectOptions(true);
      }
      if (outreachLibraryHasScripts(data.library)) {
        window.__ADHELLO_OUTREACH_LIBRARY__ = data.library;
      }
      leadOutreachScriptsCache = {
        workspaceId: leadOutreachScriptsCache.workspaceId || getActiveWorkspaceIdForScripts(),
        leadKey: key,
        data,
        loading: null,
        loadingKey: key,
        workspaceData: leadOutreachScriptsCache.workspaceData,
        workspaceLoading: null,
      };
      return data;
    })();
    leadOutreachScriptsCache.loading = p;
    leadOutreachScriptsCache.loadingKey = key;
    try {
      return await p;
    } catch (err) {
      if (leadOutreachScriptsCache.loadingKey === key) {
        leadOutreachScriptsCache.loading = null;
      }
      if (embedded) return embedded;
      try {
        return await fetchWorkspaceOutreachLibrary();
      } catch (_) {
        throw err;
      }
    }
  }

  function syncLeadOutreachChannelButtons() {
    const channel = window.__leadOutreachChannel || 'call';
    document.querySelectorAll('.lead-outreach-channel').forEach((btn) => {
      const on = btn.getAttribute('data-outreach-channel') === channel;
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.classList.toggle('border-brand-yellow/50', on);
      btn.classList.toggle('bg-white', on);
      btn.classList.toggle('dark:bg-slate-900', on);
      btn.classList.toggle('text-brand-dark', on);
      btn.classList.toggle('dark:text-white', on);
      btn.classList.toggle('shadow-sm', on);
      btn.classList.toggle('border-brand-border/30', !on);
      btn.classList.toggle('text-brand-muted', !on);
    });
  }

  const LEAD_PANEL_SELL_HINT_DEFAULT =
    'Pick any service, or leave blank for AI recommendation. Scripts load from your library when you pick Call, Text, Voicemail, or Email.';

  function resetLeadPanelSellHint() {
    const hint = document.getElementById('mobilePanelAuditSellHint');
    const sel = document.getElementById('leadPanelPrimaryServiceSelect');
    if (!hint) return;
    const aiMode = sel && !String(sel.value || '').trim();
    if (aiMode && currentRow) {
      const data = getActiveOutreachScriptsData(currentRow);
      const serviceKey = data ? resolveLeadPanelServiceKey(currentRow, data) : '';
      const svc = serviceKey && data && data.library ? data.library[serviceKey] : null;
      if (svc && svc.label) {
        hint.textContent = `AI recommends ${svc.label}. Scripts load from your library for Call, Text, Voicemail, or Email.`;
        return;
      }
    }
    hint.textContent = LEAD_PANEL_SELL_HINT_DEFAULT;
  }

  async function fetchKieInsightForLead(row) {
    const key = normalizeLeadKeyForScriptsFetch(row && row.dataset ? row.dataset.leadKey : '');
    if (!key) return null;
    try {
      const res = await fetch(`/leads/${encodeURIComponent(key)}/insights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success && data.primaryServiceKey && row.dataset) {
        row.dataset.primaryServiceKey = String(data.primaryServiceKey);
        return data;
      }
    } catch (_) {
      /* ignore — fall back to library default */
    }
    return null;
  }

  async function syncLeadPanelSellingScript(row, opts) {
    const scriptEl = document.getElementById('leadPanelSellingScript');
    if (!scriptEl || !row) return;
    syncLeadOutreachChannelButtons();

    const sel = document.getElementById('leadPanelPrimaryServiceSelect');
    const aiMode = sel && !String(sel.value || '').trim();
    const showLoading = !(opts && opts.skipLoading);

    if (showLoading) scriptEl.textContent = 'Loading script…';

    if (
      opts &&
      opts.fetchAiRecommend &&
      aiMode &&
      normalizeLeadKeyForScriptsFetch(row.dataset ? row.dataset.leadKey : '')
    ) {
      await fetchKieInsightForLead(row);
    }

    if (row !== currentRow) return;

    try {
      const data = await fetchLeadOutreachScripts(row);
      if (row !== currentRow) return;
      if (!data || !outreachLibraryHasScripts(data.library)) {
        scriptEl.textContent = 'Add scripts in Sales → Script library to use this panel.';
        resetLeadPanelSellHint();
        return;
      }
      applyLeadPanelSellingScriptFromData(row, data);
      resetLeadPanelSellHint();
    } catch (e) {
      if (row !== currentRow) return;
      scriptEl.textContent = (e && e.message) || 'Could not load script.';
      resetLeadPanelSellHint();
    }
  }

  function normalizeLeadKeyForScriptsFetch(raw) {
    const k = String(raw || '').trim();
    if (!k) return '';
    return k.replace(/^lead:/i, '').trim();
  }

  function openLeadPanelComposer() {
    if (typeof openLeadPanelNotepad === 'function') openLeadPanelNotepad();
    openLeadPanelQuickLog();
    const ni = document.getElementById('noteInput');
    if (ni) {
      try {
        ni.focus();
      } catch (_) {
        /* ignore */
      }
    }
  }

  function closeLeadPanelComposer() {
    /* Note lives in the always-open quick log block — nothing to collapse. */
  }

  function toggleLeadPanelComposer() {
    openLeadPanelComposer();
  }

  function openLeadPanelQuickLog() {
    const d = document.getElementById('leadPanelQuickLogDrawer');
    const btn = document.getElementById('leadPanelQuickLogToggle');
    const ch = document.getElementById('leadPanelQuickLogChevron');
    if (d) d.classList.add('lead-panel-quicklog-drawer--open');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    if (ch) {
      ch.classList.remove('rotate-180');
      ch.style.transform = '';
    }
  }

  function closeLeadPanelQuickLog() {
    const d = document.getElementById('leadPanelQuickLogDrawer');
    const btn = document.getElementById('leadPanelQuickLogToggle');
    const ch = document.getElementById('leadPanelQuickLogChevron');
    if (d) d.classList.remove('lead-panel-quicklog-drawer--open');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    if (ch) {
      ch.classList.add('rotate-180');
      ch.style.transform = '';
    }
  }

  function toggleLeadPanelQuickLog() {
    const drawer = document.getElementById('leadPanelQuickLogDrawer');
    if (!drawer) return;
    if (drawer.classList.contains('lead-panel-quicklog-drawer--open')) {
      closeLeadPanelQuickLog();
    } else {
      openLeadPanelQuickLog();
    }
  }

  function syncLeadPanelSendInfoExpanded() {
    const drawer = document.getElementById('leadPanelOutreachDrawer');
    const notepad = document.getElementById('leadPanelNotepadBody');
    const card = document.getElementById('leadPanelSendInfoCard');
    const sendRoot = document.getElementById('leadPanelSendInfo');
    const customizeOpen = !!(
      sendRoot &&
      sendRoot.querySelector('.lead-send-info-pack-details[open]')
    );
    const drawerOpen = !!(drawer && drawer.classList.contains('lead-panel-outreach-drawer--open'));
    const expanded = drawerOpen || customizeOpen;
    if (notepad) notepad.classList.toggle('lead-panel-notepad-body--send-expanded', expanded);
    if (card) card.classList.toggle('lead-panel-send-info-card--open', drawerOpen);
  }

  function openLeadPanelOutreach() {
    const d = document.getElementById('leadPanelOutreachDrawer');
    const btn = document.getElementById('leadPanelOutreachToggle');
    const ch = document.getElementById('leadPanelOutreachChevron');
    if (d) d.classList.add('lead-panel-outreach-drawer--open');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    if (ch) {
      ch.classList.remove('rotate-180');
      ch.style.transform = '';
    }
    syncLeadPanelSendInfoExpanded();
    window.setTimeout(function () {
      const root = document.getElementById('leadPanelSendInfo');
      if (root && root.scrollIntoView) root.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 80);
  }

  function closeLeadPanelOutreach() {
    const d = document.getElementById('leadPanelOutreachDrawer');
    const btn = document.getElementById('leadPanelOutreachToggle');
    const ch = document.getElementById('leadPanelOutreachChevron');
    if (d) d.classList.remove('lead-panel-outreach-drawer--open');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    if (ch) {
      ch.classList.add('rotate-180');
      ch.style.transform = '';
    }
    syncLeadPanelSendInfoExpanded();
  }

  window.__syncLeadPanelSendInfoExpanded = syncLeadPanelSendInfoExpanded;

  function toggleLeadPanelOutreach() {
    const drawer = document.getElementById('leadPanelOutreachDrawer');
    if (!drawer) return;
    if (drawer.classList.contains('lead-panel-outreach-drawer--open')) {
      closeLeadPanelOutreach();
    } else {
      openLeadPanelOutreach();
    }
  }

  const LEAD_PANEL_CADENCE_PLAYBOOK_COLLAPSED_KEY = 'adhelloLeadPanelCadencePlaybookCollapsed';

  function openLeadPanelCadencePlaybook() {
    const drawer = document.getElementById('leadPanelCadencePlaybookDrawer');
    const btn = document.getElementById('leadPanelCadencePlaybookToggle');
    const ch = document.getElementById('leadPanelCadencePlaybookChevron');
    if (drawer) drawer.classList.add('lead-panel-cadence-playbook-drawer--open');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    if (ch) {
      ch.classList.remove('rotate-180');
      ch.style.transform = '';
    }
    try {
      sessionStorage.setItem(LEAD_PANEL_CADENCE_PLAYBOOK_COLLAPSED_KEY, '0');
    } catch (_) { /* ignore */ }
  }

  function closeLeadPanelCadencePlaybook() {
    const drawer = document.getElementById('leadPanelCadencePlaybookDrawer');
    const btn = document.getElementById('leadPanelCadencePlaybookToggle');
    const ch = document.getElementById('leadPanelCadencePlaybookChevron');
    if (drawer) drawer.classList.remove('lead-panel-cadence-playbook-drawer--open');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    if (ch) {
      ch.classList.add('rotate-180');
      ch.style.transform = '';
    }
    try {
      sessionStorage.setItem(LEAD_PANEL_CADENCE_PLAYBOOK_COLLAPSED_KEY, '1');
    } catch (_) { /* ignore */ }
  }

  function toggleLeadPanelCadencePlaybook() {
    const drawer = document.getElementById('leadPanelCadencePlaybookDrawer');
    if (!drawer) return;
    if (drawer.classList.contains('lead-panel-cadence-playbook-drawer--open')) {
      closeLeadPanelCadencePlaybook();
    } else {
      openLeadPanelCadencePlaybook();
    }
  }

  function restoreLeadPanelCadencePlaybookCollapsedState() {
    if (!document.getElementById('leadPanelCadencePlaybookDrawer')) return;
    try {
      if (sessionStorage.getItem(LEAD_PANEL_CADENCE_PLAYBOOK_COLLAPSED_KEY) === '0') {
        openLeadPanelCadencePlaybook();
      } else {
        closeLeadPanelCadencePlaybook();
      }
    } catch (_) {
      closeLeadPanelCadencePlaybook();
    }
  }

  restoreLeadPanelCadencePlaybookCollapsedState();

  const LEAD_PANEL_AI_TOOLS_COLLAPSED_KEY = 'adhelloLeadPanelAiToolsCollapsed';

  function openLeadPanelAiTools() {
    const drawer = document.getElementById('leadPanelAiToolsDrawer');
    const btn = document.getElementById('leadPanelAiToolsToggle');
    const ch = document.getElementById('leadPanelAiToolsChevron');
    if (drawer) drawer.classList.add('lead-panel-ai-tools-drawer--open');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    if (ch) {
      ch.classList.remove('rotate-180');
      ch.style.transform = '';
    }
    try {
      sessionStorage.setItem(LEAD_PANEL_AI_TOOLS_COLLAPSED_KEY, '0');
    } catch (_) { /* ignore */ }
  }

  function closeLeadPanelAiTools() {
    const drawer = document.getElementById('leadPanelAiToolsDrawer');
    const btn = document.getElementById('leadPanelAiToolsToggle');
    const ch = document.getElementById('leadPanelAiToolsChevron');
    if (drawer) drawer.classList.remove('lead-panel-ai-tools-drawer--open');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    if (ch) {
      ch.classList.add('rotate-180');
      ch.style.transform = '';
    }
    try {
      sessionStorage.setItem(LEAD_PANEL_AI_TOOLS_COLLAPSED_KEY, '1');
    } catch (_) { /* ignore */ }
  }

  function toggleLeadPanelAiTools() {
    const drawer = document.getElementById('leadPanelAiToolsDrawer');
    if (!drawer) return;
    if (drawer.classList.contains('lead-panel-ai-tools-drawer--open')) {
      closeLeadPanelAiTools();
    } else {
      openLeadPanelAiTools();
    }
  }

  function restoreLeadPanelAiToolsCollapsedState() {
    if (!document.getElementById('leadPanelAiToolsDrawer')) return;
    try {
      if (sessionStorage.getItem(LEAD_PANEL_AI_TOOLS_COLLAPSED_KEY) === '0') {
        openLeadPanelAiTools();
      } else {
        closeLeadPanelAiTools();
      }
    } catch (_) {
      closeLeadPanelAiTools();
    }
  }

  restoreLeadPanelAiToolsCollapsedState();

  const LEAD_PANEL_NOTEPAD_COLLAPSED_KEY = 'adhelloLeadPanelNotepadCollapsed';

  function openLeadPanelNotepad() {
    const body = document.getElementById('leadPanelNotepadBody');
    const btn = document.getElementById('leadPanelNotepadToggle');
    const ch = document.getElementById('leadPanelNotepadChevron');
    const shell = document.getElementById('leadPanelNotepad');
    if (body) body.classList.add('lead-panel-notepad-body--open');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    if (ch) {
      ch.classList.remove('rotate-180');
      ch.style.transform = '';
    }
    if (shell) shell.classList.remove('lead-panel-notepad--collapsed');
    try {
      sessionStorage.setItem(LEAD_PANEL_NOTEPAD_COLLAPSED_KEY, '0');
    } catch (_) { /* ignore */ }
  }

  function closeLeadPanelNotepad() {
    const body = document.getElementById('leadPanelNotepadBody');
    const btn = document.getElementById('leadPanelNotepadToggle');
    const ch = document.getElementById('leadPanelNotepadChevron');
    const shell = document.getElementById('leadPanelNotepad');
    if (body) body.classList.remove('lead-panel-notepad-body--open');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    if (ch) {
      ch.classList.add('rotate-180');
      ch.style.transform = '';
    }
    if (shell) shell.classList.add('lead-panel-notepad--collapsed');
    try {
      sessionStorage.setItem(LEAD_PANEL_NOTEPAD_COLLAPSED_KEY, '1');
    } catch (_) { /* ignore */ }
  }

  function toggleLeadPanelNotepad() {
    const body = document.getElementById('leadPanelNotepadBody');
    if (!body) return;
    if (body.classList.contains('lead-panel-notepad-body--open')) {
      closeLeadPanelNotepad();
    } else {
      openLeadPanelNotepad();
    }
  }

  function restoreLeadPanelNotepadCollapsedState() {
    try {
      if (sessionStorage.getItem(LEAD_PANEL_NOTEPAD_COLLAPSED_KEY) === '1') {
        closeLeadPanelNotepad();
      } else {
        openLeadPanelNotepad();
      }
    } catch (_) {
      openLeadPanelNotepad();
    }
  }

  restoreLeadPanelNotepadCollapsedState();

  const QUICK_LOG_TAG_CONFIG =
    (window.__QUICK_LOG && window.__QUICK_LOG.tagConfig) || {
      Gatekeeper: { disposition: 'gatekeeper' },
      'No pickup': { disposition: 'no_answer' },
      'Left VM': { disposition: 'voicemail' },
      'Not interested': { disposition: 'not_interested', status: 'Closed - Lost' },
      'Callback requested': { disposition: 'callback' },
      'DM connected': { disposition: 'connected' },
      'Send info': { disposition: 'send_info', status: 'Email Sent' },
      'Site audit': { disposition: 'site_audit' },
    };

  function resolveActiveQuickLogLabel(row) {
    if (!row || !row.dataset) return '';
    const disp = String(row.dataset.lastDisposition || '').trim().toLowerCase();
    const items = (window.__QUICK_LOG && window.__QUICK_LOG.items) || [];
    if (disp) {
      const fromDisp = items.find((i) => i.disposition === disp);
      if (fromDisp) return fromDisp.label;
    }
    const status = String(row.dataset.status || '').trim();
    if (status) {
      const fromStatus = items.find((i) => i.status === status);
      if (fromStatus) return fromStatus.label;
    }
    return '';
  }

  function resolveLeadTouchPill(row) {
    if (!row || !row.dataset) {
      return { text: 'Cold', variant: 'cold', title: 'Cold lead' };
    }
    const src = String(row.dataset.source || '').trim();
    if (src.startsWith('adhello_')) {
      return { text: 'Warm', variant: 'warm', title: 'Warm inbound lead' };
    }
    const qlLabel = resolveActiveQuickLogLabel(row);
    if (qlLabel) {
      return { text: qlLabel, variant: 'quick_log', title: `Last touch: ${qlLabel}` };
    }
    if (src.includes('csv') || src === 'import' || src === 'manual') {
      return { text: 'Imported', variant: 'imported', title: 'Imported lead' };
    }
    return { text: 'Cold', variant: 'cold', title: 'Not contacted yet' };
  }

  function touchPillClassName(variant, scope) {
    const panel = scope === 'panel';
    const base = panel
      ? 'shrink-0 whitespace-nowrap px-2.5 py-0.5 rounded-full border text-[9px] font-black uppercase tracking-widest'
      : 'lead-row-touch-pill shrink-0 whitespace-nowrap px-1.5 py-0.5 rounded-full border text-[8px] font-black uppercase tracking-widest sm:px-2 sm:text-[9px]';
    if (variant === 'warm') {
      return `${base} bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30`;
    }
    if (variant === 'imported') {
      return `${base} bg-brand-yellow/15 text-brand-yellow border-brand-yellow/30`;
    }
    if (variant === 'quick_log') {
      return `${base} bg-brand-yellow/15 text-brand-dark dark:text-brand-yellow border-brand-yellow/50 dark:border-brand-yellow/40`;
    }
    return `${base} bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 border-brand-border/30 dark:border-white/10`;
  }

  function syncLeadTouchPill(row) {
    if (!row) return;
    const pill = resolveLeadTouchPill(row);
    const display = String(pill.text || '').toUpperCase();
    const rowPill = row.querySelector('.lead-row-touch-pill');
    if (rowPill) {
      rowPill.textContent = display;
      rowPill.className = touchPillClassName(pill.variant, 'row');
      rowPill.setAttribute('data-touch-variant', pill.variant);
      rowPill.title = pill.title || display;
    }
    if (currentRow === row) {
      const sourcePill = document.getElementById('mobilePanelSourcePill');
      if (sourcePill) {
        sourcePill.classList.remove('hidden');
        sourcePill.textContent = display;
        sourcePill.className = touchPillClassName(pill.variant, 'panel');
        sourcePill.title = pill.title || display;
      }
    }
  }

  function resolvePhoneLineTypePill(row) {
    const phone = String((row && row.dataset && row.dataset.phone) || '').trim();
    if (!phone || phone === 'N/A') return null;
    const type = String((row && row.dataset && row.dataset.phoneLineType) || '')
      .trim()
      .toLowerCase();
    const carrier = String((row && row.dataset && row.dataset.phoneCarrier) || '').trim();
    let label = 'Unknown';
    let pillClass =
      'text-brand-muted dark:text-slate-400 bg-brand-cream/80 dark:bg-slate-800 border-brand-border/40 dark:border-white/10';
    if (type === 'mobile') {
      label = 'Mobile';
      pillClass =
        'text-sky-800 dark:text-sky-200 bg-sky-500/15 dark:bg-sky-950/40 border-sky-500/35';
    } else if (type === 'landline') {
      label = 'Landline';
      pillClass =
        'text-amber-800 dark:text-amber-200 bg-amber-500/15 dark:bg-amber-950/40 border-amber-500/35';
    } else if (type === 'voip') {
      label = 'VoIP';
      pillClass =
        'text-violet-800 dark:text-violet-200 bg-violet-500/15 dark:bg-violet-950/40 border-violet-500/35';
    }
    const title = carrier ? `${label} · ${carrier}` : label;
    return { label, pillClass, title, type: type || 'unknown' };
  }

  function syncPhoneLineTypePill(row) {
    if (!row) return;
    const pillInfo = resolvePhoneLineTypePill(row);
    const phoneCell = row.querySelector('[data-plc="phone"]');
    if (!phoneCell) return;
    let pill = phoneCell.querySelector('.lead-row-phone-line-pill');
    if (!pillInfo) {
      if (pill) pill.remove();
      return;
    }
    if (!pill) {
      pill = document.createElement('span');
      pill.className =
        'lead-row-phone-line-pill shrink-0 self-start px-1.5 py-0.5 rounded-full border text-[8px] font-black uppercase tracking-widest';
      const wrap = phoneCell.querySelector('.flex.flex-col') || phoneCell;
      wrap.appendChild(pill);
    }
    pill.textContent = pillInfo.label;
    pill.title = pillInfo.title;
    pill.className = `lead-row-phone-line-pill shrink-0 self-start px-1.5 py-0.5 rounded-full border text-[8px] font-black uppercase tracking-widest ${pillInfo.pillClass}`;
  }

  function syncLeadPanelQuickLogPills(row) {
    const host = document.getElementById('leadNotepadTagRow');
    if (!host) return;
    const activeLabel = resolveActiveQuickLogLabel(row);
    host.querySelectorAll('.lead-notepad-tag').forEach((b) => {
      const label = b.getAttribute('data-tag') || '';
      const on = !!activeLabel && label === activeLabel;
      b.setAttribute('data-active', on ? 'true' : 'false');
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    syncLeadTouchPill(row);
  }

  function isLeadDetailPanelOpen() {
    const panel = getLeadDetailPanel();
    if (!panel) return false;
    if (panel.classList.contains('open')) return true;
    const disp = panel.style && panel.style.display;
    if (disp && disp !== 'none') return true;
    return !panel.classList.contains('hidden');
  }

  function leadKeyParamForFetch(key) {
    return String(key || '')
      .trim()
      .replace(/^lead:/i, '');
  }

  const NOTE_POST_BTN_SPINNER =
    '<svg class="animate-spin h-4 w-4 text-white dark:text-brand-dark mx-auto" viewBox="0 0 24 24" aria-hidden="true"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>';

  let leadPanelNoteSubmitInflight = false;
  let leadPanelNotePostSuccessTimer = null;
  let leadPanelNoteLastPostAt = 0;
  let leadPanelNoteLastPostBody = '';

  function setLeadPanelNotePostLoading(loading) {
    const addNoteBtn = getLeadPanelEl('addNoteBtn');
    if (!addNoteBtn) return;
    if (loading) {
      if (leadPanelNotePostSuccessTimer) {
        clearTimeout(leadPanelNotePostSuccessTimer);
        leadPanelNotePostSuccessTimer = null;
      }
      if (!addNoteBtn.getAttribute('data-default-label')) {
        addNoteBtn.setAttribute('data-default-label', addNoteBtn.textContent.trim() || 'Post');
      }
      addNoteBtn.disabled = true;
      addNoteBtn.setAttribute('aria-busy', 'true');
      addNoteBtn.innerHTML = NOTE_POST_BTN_SPINNER;
      return;
    }
    addNoteBtn.disabled = false;
    addNoteBtn.removeAttribute('aria-busy');
    addNoteBtn.textContent = addNoteBtn.getAttribute('data-default-label') || 'Post';
  }

  function setLeadPanelNotePostSuccess() {
    const addNoteBtn = getLeadPanelEl('addNoteBtn');
    if (!addNoteBtn) return;
    if (leadPanelNotePostSuccessTimer) clearTimeout(leadPanelNotePostSuccessTimer);
    addNoteBtn.disabled = false;
    addNoteBtn.removeAttribute('aria-busy');
    addNoteBtn.textContent = 'Posted ✓';
    addNoteBtn.classList.add(
      '!bg-emerald-600',
      '!text-white',
      'dark:!bg-emerald-500',
      'dark:!text-white',
    );
    leadPanelNotePostSuccessTimer = setTimeout(() => {
      leadPanelNotePostSuccessTimer = null;
      addNoteBtn.textContent = addNoteBtn.getAttribute('data-default-label') || 'Post';
      addNoteBtn.classList.remove(
        '!bg-emerald-600',
        '!text-white',
        'dark:!bg-emerald-500',
        'dark:!text-white',
      );
    }, 2000);
  }

  async function postLeadPanelActivity(key, payload) {
    const keyParam = leadKeyParamForFetch(key);
    if (!keyParam) {
      throw new Error('Lead key missing — select a saved lead and try again.');
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(`/leads/${encodeURIComponent(keyParam)}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload || {}),
        signal: ctrl.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error((data && data.error) || 'Could not save activity');
      }
      return data;
    } catch (err) {
      if (err && err.name === 'AbortError') {
        throw new Error('Saving the note timed out. Try again.');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  function panelNotesStorageKey(row) {
    return resolvePanelActivityKey(row);
  }

  const PANEL_NOTES_LS_KEY = 'adhello_panel_notes_v1';

  function hydratePanelNotesCache() {
    try {
      const raw = localStorage.getItem(PANEL_NOTES_LS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;
      window.__leadPanelNotesByKey = { ...(parsed || {}), ...(window.__leadPanelNotesByKey || {}) };
    } catch (_) {
      /* ignore */
    }
  }
  hydratePanelNotesCache();

  function persistPanelNotesCache() {
    try {
      localStorage.setItem(
        PANEL_NOTES_LS_KEY,
        JSON.stringify(window.__leadPanelNotesByKey || {}),
      );
    } catch (_) {
      /* ignore */
    }
  }

  function resolvePanelActivityKey(row) {
    if (row && row.dataset) {
      const lk = String(row.dataset.leadKey || '').trim().replace(/^lead:/i, '');
      if (lk) return lk;
      const tk = normalizeLeadTitleKey(row.dataset.title || '');
      if (tk) return `title:${tk.toLowerCase()}`;
    }
    const ak = String(window.__leadPanelActiveRowKey || '').trim().replace(/^lead:/i, '');
    if (ak) return ak;
    const titleEl = document.getElementById('mobilePanelTitle');
    const panelTitle = titleEl ? String(titleEl.textContent || '').trim() : '';
    const tk2 = normalizeLeadTitleKey(panelTitle);
    if (tk2 && tk2 !== normalizeLeadTitleKey('Company Name')) return `title:${tk2.toLowerCase()}`;
    return '';
  }

  function readCachedPanelNotes(key) {
    if (!key) return [];
    window.__leadPanelNotesByKey = window.__leadPanelNotesByKey || {};
    return Array.isArray(window.__leadPanelNotesByKey[key])
      ? window.__leadPanelNotesByKey[key]
      : [];
  }

  function collectPanelActivityKeys(row) {
    const keys = [];
    const add = (k) => {
      const v = String(k || '').trim();
      if (v && !keys.includes(v)) keys.push(v);
    };
    add(resolvePanelActivityKey(row));
    if (row && row.dataset) {
      const lk = String(row.dataset.leadKey || '').trim().replace(/^lead:/i, '');
      add(lk);
      const tk = normalizeLeadTitleKey(row.dataset.title || '');
      if (tk) add(`title:${tk.toLowerCase()}`);
    }
    const ak = String(window.__leadPanelActiveRowKey || '').trim().replace(/^lead:/i, '');
    add(ak);
    const titleEl = document.getElementById('mobilePanelTitle');
    const panelTitle = titleEl ? String(titleEl.textContent || '').trim() : '';
    const tk2 = normalizeLeadTitleKey(panelTitle);
    if (tk2 && tk2 !== normalizeLeadTitleKey('Company Name')) add(`title:${tk2.toLowerCase()}`);
    return keys;
  }

  function readCachedPanelNotesForRow(row) {
    const out = [];
    const seen = new Set();
    collectPanelActivityKeys(row).forEach((key) => {
      readCachedPanelNotes(key).forEach((note) => {
        if (!note) return;
        const id = `${String(note.timestamp || '')}|${String(note.value || '')}`;
        if (seen.has(id)) return;
        seen.add(id);
        out.push(note);
      });
    });
    return out;
  }

  function cachePanelNoteEntryUnderKey(key, entry) {
    if (!key || !entry) return;
    window.__leadPanelNotesByKey = window.__leadPanelNotesByKey || {};
    const list = window.__leadPanelNotesByKey[key] || [];
    const exists = list.some(
      (n) =>
        n &&
        String(n.timestamp || '') === String(entry.timestamp || '') &&
        String(n.value || '') === String(entry.value || ''),
    );
    if (!exists) {
      window.__leadPanelNotesByKey[key] = [...list, entry];
    }
  }

  function migratePanelNotesCacheOnSelect(row) {
    if (!row || !row.dataset) return;
    const lk = String(row.dataset.leadKey || '').trim().replace(/^lead:/i, '');
    const tk = normalizeLeadTitleKey(row.dataset.title || '');
    if (!lk || !tk) return;
    const titleKey = `title:${tk.toLowerCase()}`;
    const titleNotes = readCachedPanelNotes(titleKey);
    if (!titleNotes.length) return;
    const leadNotes = readCachedPanelNotes(lk);
    const seen = new Set(
      leadNotes.map((n) => `${String(n.timestamp || '')}|${String(n.value || '')}`),
    );
    titleNotes.forEach((note) => {
      const id = `${String(note.timestamp || '')}|${String(note.value || '')}`;
      if (seen.has(id)) return;
      seen.add(id);
      cachePanelNoteEntryUnderKey(lk, note);
    });
    if (window.__leadPanelNotesByKey && window.__leadPanelNotesByKey[titleKey]) {
      delete window.__leadPanelNotesByKey[titleKey];
      persistPanelNotesCache();
    }
  }

  function readMergedRowUpdates(row) {
    const base = row && row.dataset ? readRowUpdatesArray(row) : [];
    const cached = readCachedPanelNotesForRow(row);
    if (!cached.length) return base;
    const merged = base.slice();
    cached.forEach((note) => {
      if (!note) return;
      const exists = merged.some(
        (u) =>
          u &&
          String(u.type) === 'note' &&
          String(u.timestamp || '') === String(note.timestamp || '') &&
          String(u.value || '') === String(note.value || ''),
      );
      if (!exists) merged.push(note);
    });
    merged.sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0));
    return merged;
  }

  function cachePanelNoteEntry(row, entry) {
    if (!entry) return;
    const keys = collectPanelActivityKeys(row);
    if (!keys.length) return;
    keys.forEach((key) => cachePanelNoteEntryUnderKey(key, entry));
    persistPanelNotesCache();
  }

  function removePanelNoteFromCache(row, timestamp, value) {
    if (window.__adhelloLeadPanelNotes && typeof window.__adhelloLeadPanelNotes.removeNote === 'function') {
      window.__adhelloLeadPanelNotes.removeNote(timestamp, value, row);
      return;
    }
    const ts = String(timestamp || '').trim();
    const val = String(value || '').trim();
    window.__leadPanelNotesByKey = window.__leadPanelNotesByKey || {};
    let changed = false;
    Object.keys(window.__leadPanelNotesByKey).forEach((key) => {
      const list = window.__leadPanelNotesByKey[key];
      if (!Array.isArray(list) || !list.length) return;
      const next = list.filter(
        (n) =>
          !(
            n &&
            panelNoteTimestampsMatch(n.timestamp || '', ts) &&
            (!val || String(n.value || '') === val)
          ),
      );
      if (next.length !== list.length) {
        if (next.length) window.__leadPanelNotesByKey[key] = next;
        else delete window.__leadPanelNotesByKey[key];
        changed = true;
      }
    });
    if (changed) persistPanelNotesCache();
  }

  function syncPanelNotesCacheFromRow(row) {
    const key = resolvePanelActivityKey(row);
    if (!key || !row) return;
    const notes = readRowUpdatesArray(row).filter((u) => u && String(u.type) === 'note');
    if (!notes.length) return;
    window.__leadPanelNotesByKey = window.__leadPanelNotesByKey || {};
    window.__leadPanelNotesByKey[key] = notes.slice();
    persistPanelNotesCache();
  }

  function resolveLeadPanelNoteRow() {
    if (typeof resolvePanelActionRow === 'function') {
      const actionRow = resolvePanelActionRow();
      if (actionRow) return resolvePipelineTableRowForPanel(actionRow) || actionRow;
    }
    if (currentRow) return resolvePipelineTableRowForPanel(currentRow) || currentRow;
    const selected = document.querySelector(
      '#prospectLeadsTable tbody tr.result-row.selected, tr.result-row.selected:not(.result-row--panel-source)',
    );
    if (selected) {
      currentRow = selected;
      return resolvePipelineTableRowForPanel(selected) || selected;
    }
    const activeKey = String(window.__leadPanelActiveRowKey || '').trim().replace(/^lead:/i, '');
    if (activeKey) {
      const byKey = document.querySelector(
        `#prospectLeadsTable tbody tr.result-row[data-lead-key="${CSS.escape(activeKey)}"], #prospectLeadsTable tbody tr.result-row[data-lead-key="lead:${CSS.escape(activeKey)}"]`,
      );
      if (byKey) {
        currentRow = byKey;
        return byKey;
      }
    }
    const host = document.getElementById('leadPanelDatasetHost');
    if (host && host.dataset && host.dataset.leadKey) return host;
    return null;
  }

  async function persistLeadPanelNoteToServer(rowOrKey, content) {
    let key = '';
    let row = null;
    if (typeof rowOrKey === 'string') {
      if (String(rowOrKey).startsWith('title:')) {
        return { success: true, localOnly: true };
      }
      key = normalizeLeadKeyForApi(rowOrKey);
      row = resolveLeadPanelNoteRow();
    } else {
      row = rowOrKey;
      key = await withTimeout(
        ensureRowHasLeadKey(rowOrKey),
        20000,
        'Saving this lead timed out. Your note is still shown here — try Post again in a moment.',
      );
    }
    const data = await postLeadPanelActivity(key, {
      content,
      type: 'note',
      deferGhlSync: true,
    });
    if (row) {
      if (data.lead) {
        syncPersistedLeadToRowDataset(row, data.lead);
      } else if (Array.isArray(data.updates)) {
        applyServerUpdatesToRow(row, data.updates);
      }
      syncPanelNotesCacheFromRow(row);
      refreshLeadActivityTimeline(row, 'notes');
    }
    return data;
  }

  async function submitLeadPanelNote() {
    if (leadPanelNoteSubmitInflight) {
      return false;
    }

    const row = resolveLeadPanelNoteRow();
    const activityKey = resolvePanelActivityKey(row);
    if (row && row !== currentRow) currentRow = row;

    const noteInput = getLeadPanelEl('noteInput');
    const content = noteInput ? String(noteInput.value || '').trim() : '';
    if (!content) {
      if (!leadPanelNoteSubmitInflight && typeof window.showAppToast === 'function') {
        window.showAppToast('Type a note first.', { variant: 'error' });
      }
      return false;
    }
    const now = Date.now();
    if (content === leadPanelNoteLastPostBody && now - leadPanelNoteLastPostAt < 800) {
      return false;
    }
    if (!row && !activityKey) {
      const msg = 'Open a lead from the pipeline first, then post your note.';
      if (typeof window.showAppToast === 'function') {
        window.showAppToast(msg, { variant: 'error' });
      }
      return false;
    }

    leadPanelNoteSubmitInflight = true;
    leadPanelNoteLastPostBody = content;
    leadPanelNoteLastPostAt = now;

    try {
      const clickedAt = new Date().toISOString();
      const noteEntry = {
        type: 'note',
        value: content,
        timestamp: clickedAt,
        source: 'panel_post',
        manual: true,
      };
      if (row) appendRowActivityEntry(row, noteEntry);
      cachePanelNoteEntry(row, noteEntry);

      if (noteInput) noteInput.value = '';

      window.__leadActivityFilter = 'notes';
      syncLeadActivityFilterButtons('notes');
      if (typeof window.__adhelloPaintLeadPanelNotes === 'function') {
        window.__adhelloPaintLeadPanelNotes('notes');
      } else {
        renderLeadActivityTimeline(row || resolveLeadPanelNoteRow(), 'notes');
      }
      if (typeof scrollLeadPanelToSection === 'function') {
        scrollLeadPanelToSection('leadPanelHistorySection');
      }

      setLeadPanelNotePostSuccess();

      const persistTarget =
        row ||
        (activityKey && !String(activityKey).startsWith('title:') ? activityKey : null);
      if (persistTarget) {
        void persistLeadPanelNoteToServer(persistTarget, content)
          .then(() => {
            if (typeof window.showAppToast === 'function') {
              window.showAppToast('Note saved.', { variant: 'success' });
            }
          })
          .catch((err) => {
            console.error('Note save failed:', err);
            const msg =
              (err && err.message) ||
              'Note is shown here but could not save to the server. Try Post again.';
            if (typeof window.showAppToast === 'function') {
              window.showAppToast(msg, { variant: 'error' });
            }
          });
      }

      return true;
    } catch (err) {
      console.error('Note addition failed:', err);
      const msg = err && err.message ? err.message : 'Failed to add note.';
      if (typeof window.showAppToast === 'function') {
        window.showAppToast(msg, { variant: 'error' });
      } else {
        alert(msg);
      }
      refreshLeadActivityTimeline(row, 'notes');
      setLeadPanelNotePostLoading(false);
      return false;
    } finally {
      leadPanelNoteSubmitInflight = false;
    }
  }

  window.__adhelloSubmitLeadPanelNote = submitLeadPanelNote;
  window.__adhelloSubmitLeadPanelNoteImpl = submitLeadPanelNote;
  window.__applyLeadPanelQuickLogTag = applyLeadPanelQuickLogTag;

  function panelNoteTimestampsMatch(stored, requested) {
    const a = String(stored || '').trim();
    const b = String(requested || '').trim();
    if (!a || !b) return false;
    if (a === b) return true;
    const ta = Date.parse(a);
    const tb = Date.parse(b);
    if (Number.isFinite(ta) && Number.isFinite(tb)) {
      return Math.floor(ta / 1000) === Math.floor(tb / 1000);
    }
    return false;
  }

  function leadPanelNoteMatchEntry(entry, timestamp, value) {
    if (!entry || String(entry.type) !== 'note') return false;
    if (entry.source === 'quick_log_pill') return false;
    if (entry.disposition || entry.statusChange) return false;
    const ts = String(timestamp || '').trim();
    const val = String(value || '').trim();
    if (!panelNoteTimestampsMatch(entry.timestamp || entry.ts || '', ts)) return false;
    const body = String(entry.value || entry.content || entry.message || '').trim();
    if (val && body !== val) return false;
    return true;
  }

  function removeNoteFromRowLocal(row, timestamp, value) {
    if (!row) return;
    const updates = readRowUpdatesArray(row).filter(
      (u) => !leadPanelNoteMatchEntry(u, timestamp, value),
    );
    writeRowUpdatesArray(row, updates);
    let logs = [];
    try {
      logs = JSON.parse(row.dataset.logsSnippet || '[]');
    } catch {
      logs = [];
    }
    if (!Array.isArray(logs)) logs = [];
    const ts = String(timestamp || '').trim();
    const val = String(value || '').trim();
    logs = logs.filter((log) => {
      if (String(log.type || '') !== 'note') return true;
      if (!panelNoteTimestampsMatch(log.timestamp || '', ts)) return true;
      if (val && String(log.message || '').trim() !== val) return true;
      return false;
    });
    row.dataset.logsSnippet = JSON.stringify(logs);
    const embedded = findInitialSavedLeadRecord(row);
    if (embedded) embedded.logs = logs.slice();
  }

  let leadPanelNoteDeleteInflight = false;

  async function deleteLeadPanelNote(row, timestamp, value) {
    if (leadPanelNoteDeleteInflight) return false;
    const ts = String(timestamp || '').trim();
    const text = String(value || '').trim();
    if (!ts) return false;
    if (!row) {
      if (typeof window.showAppToast === 'function') {
        window.showAppToast('Select a lead first.', { variant: 'error' });
      }
      return false;
    }
    if (!window.confirm('Delete this note?')) return false;

    leadPanelNoteDeleteInflight = true;
    const prevUpdates = readRowUpdatesArray(row).slice();
    removeNoteFromRowLocal(row, ts, text);
    removePanelNoteFromCache(row, ts, text);
    refreshLeadActivityTimeline(row);

    try {
      const key = await ensureRowHasLeadKey(row);
      const res = await fetch(
        `/leads/${encodeURIComponent(leadKeyParamForFetch(key))}/notes/delete`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ timestamp: ts, value: text }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        const errMsg = (data && data.error) || 'Could not delete note';
        const notFound = res.status === 404 || /not found/i.test(String(errMsg));
        if (notFound) {
          removePanelNoteFromCache(row, ts, text);
          refreshLeadActivityTimeline(row, 'notes');
          if (typeof window.showAppToast === 'function') {
            window.showAppToast('Note removed.', { variant: 'success' });
          }
          return true;
        }
        throw new Error(errMsg);
      }
      if (Array.isArray(data.updates)) {
        writeRowUpdatesArray(row, data.updates);
      } else if (data.lead && Array.isArray(data.lead.updates)) {
        writeRowUpdatesArray(row, data.lead.updates);
      }
      if (data.lead && Array.isArray(data.lead.logs)) {
        try {
          row.dataset.logsSnippet = JSON.stringify(data.lead.logs.slice(-14));
        } catch (_) {
          /* ignore */
        }
      }
      removePanelNoteFromCache(row, ts, text);
      refreshLeadActivityTimeline(row, 'notes');
      if (typeof window.showAppToast === 'function') {
        window.showAppToast('Note deleted.', { variant: 'success' });
      }
      return true;
    } catch (err) {
      writeRowUpdatesArray(row, prevUpdates);
      refreshLeadActivityTimeline(row, 'notes');
      if (typeof window.showAppToast === 'function') {
        window.showAppToast(err.message || 'Failed to delete note.', { variant: 'error' });
      }
      return false;
    } finally {
      leadPanelNoteDeleteInflight = false;
    }
  }

  window.__deleteLeadPanelNote = deleteLeadPanelNote;

  async function postLeadPanelNote(key, content) {
    const data = await postLeadPanelActivity(key, { content, type: 'note' });
    if (currentRow && data.updates) {
      applyServerUpdatesToRow(currentRow, data.updates);
    } else if (currentRow && data.lead) {
      syncPersistedLeadToRowDataset(currentRow, data.lead);
    }
    refreshLeadActivityTimeline(currentRow);
    return data;
  }

  async function applyLeadPanelDisposition(code, notes, opts = {}) {
    if (!currentRow || !currentRow.dataset.leadKey) {
      throw new Error('Save this lead before logging a disposition.');
    }
    const key = String(currentRow.dataset.leadKey).trim();
    const body = { code, notes: notes || '' };
    if (opts.deferGhlSync) body.deferGhlSync = true;
    if (opts.scheduledAt) body.scheduledAt = opts.scheduledAt;
    if (opts.skipFollowUp === true) body.skipFollowUp = true;
    const res = await fetch(`/leads/${encodeURIComponent(key)}/disposition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      throw new Error((data && data.error) || 'Disposition failed');
    }
    if (data.lead) syncPersistedLeadToRowDataset(currentRow, data.lead);
    const statusSel = document.getElementById('leadStatusSelect');
    if (statusSel && data.status) statusSel.value = data.status;
    return data;
  }

  function readRowUpdatesArray(row) {
    if (!row || !row.dataset) return [];
    const raw = row.dataset.updates;
    if (!raw || raw === 'undefined') return [];
    const tryParse = (s) => {
      const parsed = JSON.parse(s);
      return Array.isArray(parsed) ? parsed : [];
    };
    try {
      return tryParse(raw);
    } catch {
      try {
        const el = document.createElement('textarea');
        el.innerHTML = raw;
        return tryParse(el.value);
      } catch {
        return [];
      }
    }
  }

  function writeRowUpdatesArray(row, updates) {
    if (!row || !row.dataset) return;
    const list = Array.isArray(updates) ? updates : [];
    row.dataset.updates = JSON.stringify(list);
    const embedded = findInitialSavedLeadRecord(row);
    if (embedded) embedded.updates = list.slice();
  }

  function applyServerUpdatesToRow(row, serverUpdates) {
    if (!row) return;
    const existing = readRowUpdatesArray(row);
    const localQuick = existing.filter((u) => u && String(u.type) === 'quick_log');
    const localNotes = existing.filter(
      (u) =>
        u &&
        String(u.type) === 'note' &&
        (u.source === 'panel_post' || u.manual === true),
    );
    const server = Array.isArray(serverUpdates) ? serverUpdates : [];
    const merged = server.slice();
    localQuick.forEach((ql) => {
      const exists = merged.some(
        (u) =>
          u &&
          String(u.type) === 'quick_log' &&
          String(u.timestamp || '') === String(ql.timestamp || '') &&
          String(u.value || '') === String(ql.value || ''),
      );
      if (!exists) merged.push(ql);
    });
    localNotes.forEach((note) => {
      const exists = merged.some(
        (u) =>
          u &&
          String(u.type) === 'note' &&
          String(u.timestamp || '') === String(note.timestamp || '') &&
          String(u.value || '') === String(note.value || ''),
      );
      if (!exists) merged.push(note);
    });
    merged.sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0));
    writeRowUpdatesArray(row, merged);
  }

  function appendRowActivityEntry(row, entry) {
    if (!row || !entry) return;
    const updates = readRowUpdatesArray(row);
    const rec = {
      type: entry.type || 'quick_log',
      value: entry.value != null ? String(entry.value) : '',
      timestamp: entry.timestamp || new Date().toISOString(),
      disposition: entry.disposition || '',
      statusChange: entry.statusChange || '',
    };
    if (entry.source) rec.source = entry.source;
    if (entry.manual === true) rec.manual = true;
    updates.push(rec);
    writeRowUpdatesArray(row, updates);
    cachePanelNoteEntry(row, rec);
  }

  function refreshLeadActivityTimeline(row, filter) {
    if (filter) {
      window.__leadActivityFilter = filter;
    }
    window.__leadActivityFilter = window.__leadActivityFilter || 'all';
    const target =
      (row && resolvePipelineTableRowForPanel(row)) ||
      row ||
      resolveLeadPanelNoteRow() ||
      (typeof resolvePanelActionRow === 'function' ? resolvePanelActionRow() : null) ||
      null;
    renderLeadActivityTimeline(target, window.__leadActivityFilter);
    syncLeadActivityFilterButtons(window.__leadActivityFilter);
  }

  async function refreshLeadActivityFromServer(row) {
    if (!row) return;
    const key = String(row.dataset.leadKey || '')
      .trim()
      .replace(/^lead:/i, '');
    if (!key) return;
    try {
      const res = await fetch(`/leads/${encodeURIComponent(key)}/panel-data`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (!data.success || !data.lead || currentRow !== row) return;
      syncPersistedLeadToRowDataset(row, data.lead);
      refreshLeadActivityTimeline(row);
    } catch (err) {
      console.warn('[Lead panel] activity refresh failed:', err);
    }
  }

  const __panelDataHydrateInflight = new Map();

  /** Refresh row dataset from persisted lead — map, phone, reviews, activity, scripts. */
  async function hydrateLeadRowFromPanelData(row) {
    if (!row || !row.dataset) return;
    const keyParam = String(row.dataset.leadKey || '')
      .trim()
      .replace(/^lead:/i, '');
    if (!keyParam) return;

    if (__panelDataHydrateInflight.has(keyParam)) {
      try {
        await __panelDataHydrateInflight.get(keyParam);
      } catch (_) {
        /* sibling request failed */
      }
      const tableRow = resolvePipelineTableRowForPanel(row) || row;
      if (currentRow === tableRow) {
        if (typeof paintLeadPanelFromRow === 'function') paintLeadPanelFromRow(tableRow);
        populatePanel(tableRow);
      }
      return;
    }

    const p = (async () => {
      const res = await fetch(`/leads/${encodeURIComponent(keyParam)}/panel-data`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (!data.success || !data.lead) {
        throw new Error((data && data.error) || 'panel-data unavailable');
      }
      const tableRow = resolvePipelineTableRowForPanel(row) || row;
      syncPersistedLeadToRowDataset(tableRow, data.lead);
      prepareLeadRowForPanel(tableRow);
      if (typeof window.__paintPanelFromLeadRecord === 'function') {
        window.__paintPanelFromLeadRecord(data.lead, tableRow);
      }
      return { lead: data.lead, needsBackgroundEnhance: !!data.needsBackgroundEnhance };
    })();

    __panelDataHydrateInflight.set(keyParam, p);
    try {
      const panelResult = await p;
      const leadRecord = panelResult.lead || panelResult;
      const needsBackgroundEnhance = !!panelResult.needsBackgroundEnhance;
      const tableRow = resolvePipelineTableRowForPanel(row) || row;
      if (currentRow === tableRow) {
        if (typeof window.__paintPanelFromLeadRecord === 'function') {
          window.__paintPanelFromLeadRecord(leadRecord, tableRow);
        }
        if (typeof paintLeadPanelFromRow === 'function') paintLeadPanelFromRow(tableRow);
        populatePanel(tableRow);
        if (needsBackgroundEnhance) {
          maybeAutoBackgroundEnhance(tableRow, leadRecord);
        }
        if (typeof paintLeadPanelBuiltWith === 'function') paintLeadPanelBuiltWith(tableRow);
      }
    } catch (err) {
      console.warn('[Lead panel] panel-data hydrate failed:', err);
      const tableRow = resolvePipelineTableRowForPanel(row) || row;
      if (syncRowFromInitialSavedLeads(tableRow) && currentRow === tableRow) {
        if (typeof paintLeadPanelFromRow === 'function') paintLeadPanelFromRow(tableRow);
        populatePanel(tableRow);
      }
    } finally {
      if (__panelDataHydrateInflight.get(keyParam) === p) {
        __panelDataHydrateInflight.delete(keyParam);
      }
    }
  }

  async function applyLeadPanelQuickLogTag(tag) {
    const label = String(tag || '').trim();
    if (!label) return;
    if (!currentRow) {
      if (typeof window.showAppToast === 'function') {
        window.showAppToast('Select a lead first.', { variant: 'error' });
      }
      return;
    }
    const key = String(currentRow.dataset.leadKey || '').trim();
    if (!key) {
      if (typeof window.showAppToast === 'function') {
        window.showAppToast('Save this lead before using Quick log.', { variant: 'error' });
      }
      return;
    }
    const cfg = QUICK_LOG_TAG_CONFIG[label] || {};
    const clickedAt = new Date().toISOString();
    const stamp = new Date(clickedAt).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
    const noteLine = `[${stamp}] ${label}`;
    const tagBtns = document.querySelectorAll('.lead-notepad-tag');
    tagBtns.forEach((b) => {
      const on = (b.getAttribute('data-tag') || '') === label;
      b.setAttribute('data-active', on ? 'true' : 'false');
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    if (cfg.disposition) currentRow.dataset.lastDisposition = cfg.disposition;
    if (cfg.status) currentRow.dataset.status = cfg.status;
    syncLeadTouchPill(currentRow);

    appendRowActivityEntry(currentRow, {
      type: 'quick_log',
      value: label,
      timestamp: clickedAt,
      disposition: cfg.disposition || '',
      statusChange: cfg.status || '',
    });
    window.__leadActivityFilter = window.__leadActivityFilter || 'all';
    refreshLeadActivityTimeline(currentRow);

    try {
      if (cfg.disposition) {
        const data = await applyLeadPanelDisposition(cfg.disposition, noteLine);
        if (data.lead) syncPersistedLeadToRowDataset(currentRow, data.lead);
      } else if (cfg.status) {
        const res = await fetch(`/leads/${encodeURIComponent(key)}/update`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ status: cfg.status }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
          throw new Error((data && data.error) || 'Status update failed');
        }
        if (data.lead) syncPersistedLeadToRowDataset(currentRow, data.lead);
        else currentRow.dataset.status = cfg.status;
        const statusSel = document.getElementById('leadStatusSelect');
        if (statusSel) statusSel.value = cfg.status;
      }

      const actData = await postLeadPanelActivity(key, {
        content: noteLine,
        type: 'quick_log',
        disposition: cfg.disposition || '',
        statusChange: cfg.status || '',
      });
      if (actData.lead) syncPersistedLeadToRowDataset(currentRow, actData.lead);
      else if (Array.isArray(actData.updates)) applyServerUpdatesToRow(currentRow, actData.updates);

      populatePanel(currentRow);
      refreshLeadActivityTimeline(currentRow);

      if (cfg.disposition === 'send_info' && typeof window.__leadSendInfoOpenWithAudit === 'function') {
        window.__leadSendInfoOpenWithAudit({ rootId: 'leadPanelSendInfo', scroll: true });
      }

      const msg =
        cfg.disposition || cfg.status
          ? `Logged: ${label}`
          : `Logged: ${label}`;
      if (typeof window.showAppToast === 'function') {
        window.showAppToast(msg, { variant: 'success' });
      }

      openLeadPanelComposer();
      const inp = document.getElementById('noteInput');
      if (inp && !String(inp.value || '').includes(label)) {
        inp.value = `${noteLine}${inp.value ? `\n${inp.value}` : ''}`;
      }
    } catch (err) {
      if (typeof window.showAppToast === 'function') {
        window.showAppToast(err.message || 'Quick log failed', { variant: 'error' });
      } else {
        alert(err.message || 'Quick log failed');
      }
    } finally {
      syncLeadPanelQuickLogPills(currentRow);
    }
  }

  function notifyLeadPanelDial(message, variant) {
    if (typeof isLeadDetailPanelOpen === 'function' && isLeadDetailPanelOpen()) {
      setLeadPanelOutreachFeedback(message, variant);
    }
    if (typeof window.showAppToast === 'function') {
      window.showAppToast(message, { variant: variant || 'info' });
    } else if (typeof window.showProspectToast === 'function') {
      window.showProspectToast(message);
    } else {
      alert(message);
    }
  }

  let __leadPanelOutreachFeedbackTimer = null;
  const __leadPanelOutreachBtnLabels = new WeakMap();

  function setLeadPanelOutreachFeedback(message, variant) {
    const el = document.getElementById('leadPanelOutreachFeedback');
    if (!el) return;
    clearTimeout(__leadPanelOutreachFeedbackTimer);
    const msg = String(message || '').trim();
    if (!msg) {
      el.textContent = '';
      el.className = 'hidden mx-3 mt-3 mb-0 rounded-xl px-3 py-2 text-[11px] font-semibold leading-snug border';
      return;
    }
    el.textContent = msg;
    el.className =
      'mx-3 mt-3 mb-0 rounded-xl px-3 py-2 text-[11px] font-semibold leading-snug border lead-panel-outreach-feedback--' +
      (variant === 'success' ? 'success' : variant === 'error' ? 'error' : 'info');
    __leadPanelOutreachFeedbackTimer = setTimeout(
      () => {
        el.textContent = '';
        el.className = 'hidden mx-3 mt-3 mb-0 rounded-xl px-3 py-2 text-[11px] font-semibold leading-snug border';
      },
      variant === 'error' ? 12000 : 7000,
    );
  }

  function flashOutreachBtn(btn, label) {
    if (!btn) return;
    if (!__leadPanelOutreachBtnLabels.has(btn)) {
      __leadPanelOutreachBtnLabels.set(btn, btn.textContent);
    }
    btn.textContent = label;
  }

  function resetOutreachBtn(btn) {
    if (!btn) return;
    const original = __leadPanelOutreachBtnLabels.get(btn);
    if (original != null) btn.textContent = original;
  }

  function confirmOutreachBtnSuccess(btn, tempLabel) {
    flashOutreachBtn(btn, tempLabel || '✓ Done');
    setTimeout(() => resetOutreachBtn(btn), 1600);
  }

  function openLeadPanelSoftphone(phone, leadKey, options) {
    const raw = String(phone || '').trim();
    if (!raw) return false;
    if (typeof openLeadPanelNotepad === 'function') openLeadPanelNotepad();
    const opts = { autoDial: true, leadKey: String(leadKey || '').trim(), ...(options || {}) };
    if (typeof window.__adhelloOpenSoftphoneWithDial !== 'function') return false;
    const opened = window.__adhelloOpenSoftphoneWithDial(raw, opts);
    if (!opened) return false;
    requestAnimationFrame(() => {
      if (typeof window.__adhelloRefreshSoftphonePosition === 'function') {
        window.__adhelloRefreshSoftphonePosition();
      }
      if (typeof window.__adhelloFocusSoftphone === 'function') {
        window.__adhelloFocusSoftphone();
      }
    });
    return true;
  }

  function triggerLeadPanelEmail() {
    const btn = document.getElementById('leadPanelOutreachEmailBtn');
    flashOutreachBtn(btn, 'Opening…');
    notifyLeadPanelDial('Opening email composer…', 'info');
    const row = resolvePanelActionRow();
    if (!row) {
      notifyLeadPanelDial('Select a lead first.', 'error');
      resetOutreachBtn(btn);
      return;
    }
    if (!rowDatasetHasUsableEmail(row)) {
      notifyLeadPanelDial('No email on file — run Hunt contacts or Sync to GHL first.', 'error');
      resetOutreachBtn(btn);
      return;
    }
    if (typeof openEmailIntelModal === 'function') {
      openEmailIntelModal(row);
      notifyLeadPanelDial('Email script ready — edit and send via GHL.', 'success');
      confirmOutreachBtnSuccess(btn, '✓ Opened');
      resetOutreachBtn(btn);
      return;
    }
    const email = readPipelineRowDisplayEmail(row);
    if (!email) {
      notifyLeadPanelDial('This lead has no email on file.', 'error');
      resetOutreachBtn(btn);
      return;
    }
    window.location.href = `mailto:${encodeURIComponent(email)}`;
    resetOutreachBtn(btn);
  }

  async function triggerLeadPanelVoicemail() {
    const btn = document.getElementById('voicemailDropBtn');
    const row = resolvePanelActionRow();
    if (!row) {
      notifyLeadPanelDial('Select a lead first.', 'error');
      return;
    }
    if (!rowDatasetHasUsablePhone(row)) {
      notifyLeadPanelDial('This lead has no phone number.', 'error');
      return;
    }
    const ok = window.confirm(
      'Start a voicemail drop attempt for this lead? This places an outbound call immediately.',
    );
    if (!ok) {
      notifyLeadPanelDial('Voicemail drop cancelled.', 'info');
      return;
    }
    flashOutreachBtn(btn, 'Starting…');
    notifyLeadPanelDial('Starting voicemail drop via GHL…', 'info');
    try {
      await runLeadTelephonyAction('/voicemail-drop', {}, 'Voicemail drop started');
      notifyLeadPanelDial('Voicemail drop started.', 'success');
      confirmOutreachBtnSuccess(btn, '✓ Started');
    } catch (err) {
      notifyLeadPanelDial(err.message || 'Failed to start voicemail drop.', 'error');
    } finally {
      resetOutreachBtn(btn);
    }
  }

  async function triggerLeadPanelSms() {
    const btn = document.getElementById('sendSmsBtn');
    const row = resolvePanelActionRow();
    if (!row) {
      notifyLeadPanelDial('Select a lead first.', 'error');
      return;
    }
    if (!rowDatasetHasUsablePhone(row)) {
      notifyLeadPanelDial('Add a phone number first — or run Hunt contacts.', 'error');
      return;
    }
    flashOutreachBtn(btn, 'Opening…');
    notifyLeadPanelDial('Opening SMS composer…', 'info');
    try {
      await ensureRowHasLeadKey(row);
    } catch (err) {
      notifyLeadPanelDial(err.message || 'Save this lead first.', 'error');
      resetOutreachBtn(btn);
      return;
    }
    if (typeof openSmsModal !== 'function') {
      notifyLeadPanelDial('SMS modal failed to load. Refresh the page.', 'error');
      resetOutreachBtn(btn);
      return;
    }
    openSmsModal();
    try {
      await loadSmsScriptOptions(row.dataset.leadKey);
      const bodyInput = document.getElementById('smsBodyInput');
      if (bodyInput) bodyInput.focus();
      notifyLeadPanelDial('Type your message, use Improve text if needed, then Send SMS.', 'success');
      confirmOutreachBtnSuccess(btn, '✓ Opened');
    } catch (err) {
      notifyLeadPanelDial(err.message || 'Could not load SMS scripts.', 'error');
    } finally {
      resetOutreachBtn(btn);
    }
  }

  function readLeadPanelSelectedQuickLog() {
    const active = document.querySelector('.lead-notepad-tag[data-active="true"]');
    if (!active) return null;
    const label = String(active.getAttribute('data-tag') || '').trim();
    if (!label) return null;
    const cfg = QUICK_LOG_TAG_CONFIG[label] || {};
    return { label, ...cfg };
  }

  async function saveLeadPanelContextBeforeGhlSync(row) {
    const selection = readLeadPanelSelectedQuickLog();
    if (!selection) return;
    const noteInput = document.getElementById('noteInput');
    const notes = noteInput ? String(noteInput.value || '').trim() : '';
    if (selection.disposition) {
      const data = await applyLeadPanelDisposition(selection.disposition, notes, { deferGhlSync: true });
      if (data.lead) syncPersistedLeadToRowDataset(row, data.lead);
      return;
    }
    if (selection.status) {
      const key = String(row.dataset.leadKey || '').trim();
      if (!key) return;
      const res = await fetch(`/leads/${encodeURIComponent(key)}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ status: selection.status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error((data && data.error) || 'Status update failed');
      }
      if (data.lead) syncPersistedLeadToRowDataset(row, data.lead);
    }
  }

  function leadPanelGhlPushPayload(row, key) {
    const payload = { leadKeys: [key] };
    if (rowDatasetMissingWebsite(row)) payload.tagNoWebsite = true;
    const selection = readLeadPanelSelectedQuickLog();
    const noteInput = document.getElementById('noteInput');
    const notes = noteInput ? String(noteInput.value || '').trim() : '';
    if (selection && selection.disposition) {
      payload.disposition = selection.disposition;
      if (notes) payload.dispositionNotes = notes;
    } else if (notes) {
      payload.pendingNote = notes;
    }
    return payload;
  }

  async function pushLeadPanelToGhl() {
    const row = resolvePanelActionRow();
    if (!row) {
      notifyLeadPanelDial('Select a lead first.', 'error');
      return;
    }
    const btn = document.getElementById('leadPanelPushGhlBtn');
    const labelDefault = 'Sync GHL';
    const original = btn ? String(btn.textContent || '').trim() || labelDefault : labelDefault;
    notifyLeadPanelDial('Syncing contact to Go High Level…', 'info');
    if (btn) {
      __leadPanelOutreachBtnLabels.set(btn, original);
      btn.disabled = true;
      btn.textContent = 'Syncing…';
    }
    try {
      const key = await ensureRowHasLeadKey(row);
      await saveLeadPanelContextBeforeGhlSync(row);
      const payload = leadPanelGhlPushPayload(row, key);
      const res = await fetch('/ghl/push', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error((data && data.error) || `HTTP ${res.status}`);
      }
      if (data.results && data.results[0] && data.results[0].ghlContactId) {
        row.dataset.ghlContactId = String(data.results[0].ghlContactId);
      }
      const result = data.results && data.results[0] ? data.results[0] : null;
      const actionTags = result && Array.isArray(result.actionTags) ? result.actionTags : [];
      const tagLabel = actionTags.length
        ? actionTags[0].replace(/^AO:\s*/i, '')
        : (payload.disposition ? payload.disposition.replace(/_/g, ' ') : '');
      let msg = 'GHL sync complete';
      if (tagLabel) msg += ` · AO: ${tagLabel}`;
      if (payload.tagNoWebsite) msg += ' · no website';
      if (payload.pendingNote || payload.dispositionNotes) msg += ' · notes synced';
      notifyLeadPanelDial(msg, 'success');
      if (payload.pendingNote || payload.dispositionNotes) {
        const noteInput = document.getElementById('noteInput');
        if (noteInput) noteInput.value = '';
        if (payload.pendingNote) {
          appendRowActivityEntry(row, {
            type: 'note',
            value: payload.pendingNote,
            timestamp: new Date().toISOString(),
            source: 'panel_post',
          });
          refreshLeadActivityTimeline(row);
        }
      }
      confirmOutreachBtnSuccess(btn, '✓ Synced');
    } catch (err) {
      notifyLeadPanelDial(err.message || 'GHL sync failed.', 'error');
      resetOutreachBtn(btn);
    } finally {
      if (btn) {
        btn.disabled = false;
        syncLeadPanelOutreachIntelButtons(row);
      }
    }
  }

  async function triggerLeadPanelCall() {
    const row = resolvePanelActionRow();
    if (!row) {
      notifyLeadPanelDial('Select a lead first.', 'error');
      return;
    }
    let key = String(row.dataset.leadKey || '').trim();
    if (!key) {
      try {
        key = await ensureRowHasLeadKey(row);
      } catch (err) {
        notifyLeadPanelDial(err.message || 'Save this lead first before calling.', 'error');
        return;
      }
    }
    const phone = resolveCurrentLeadDialPhone();
    if (!phone) {
      notifyLeadPanelDial('This lead has no valid phone number.', 'error');
      return;
    }
    const clickToCallBtn = document.getElementById('clickToCallBtn');
    const original = clickToCallBtn ? clickToCallBtn.textContent : 'Call';
    if (clickToCallBtn) {
      clickToCallBtn.disabled = true;
      clickToCallBtn.textContent = 'Opening dialer…';
    }
    try {
      const opened = openLeadPanelSoftphone(phone, key, { autoDial: true });
      if (opened) {
        notifyLeadPanelDial('AdHello dialer opened — number loaded.', 'success');
        confirmOutreachBtnSuccess(clickToCallBtn, '✓ Dialer open');
        return;
      }
      if (typeof window.__adhelloOpenSoftphoneWithDial !== 'function') {
        notifyLeadPanelDial(
          'Dialer is still loading. Use the phone icon in the top bar, or refresh and try again.',
          'error'
        );
        return;
      }
      notifyLeadPanelDial('Could not open the dialer for this number. Check the phone format.', 'error');
      await requestLeadCallByKey(key, phone);
      notifyLeadPanelDial('Calling lead via workspace routing…', 'success');
      populatePanel(currentRow);
    } catch (err) {
      notifyLeadPanelDial(err.message || 'Failed to start call.', 'error');
    } finally {
      if (clickToCallBtn) {
        clickToCallBtn.disabled = false;
        clickToCallBtn.textContent = original;
      }
    }
  }

  function syncLeadPanelCallDock(detail) {
    const dock = document.getElementById('leadPanelCallDock');
    if (!dock) return;
    const d = detail && typeof detail === 'object' ? detail : {};
    const state = String(d.state || 'idle').toLowerCase();
    const active = state === 'dialing' || state === 'in_call' || state === 'ended';
    const sessionLead = String(d.leadKey || '').trim();
    const rowLead = currentRow ? String(currentRow.dataset.leadKey || '').trim() : '';
    const forThisLead = !sessionLead || !rowLead || sessionLead === rowLead;
    const show = !!d.modalOpen && active && forThisLead;
    dock.classList.toggle('hidden', !show);
    const statusEl = document.getElementById('leadPanelCallDockStatus');
    const numberEl = document.getElementById('leadPanelCallDockNumber');
    if (statusEl) {
      let label = 'Call active';
      if (state === 'dialing') label = `Dialing · ${d.timer || '00:00'}`;
      else if (state === 'in_call') label = `On call · ${d.timer || '00:00'}`;
      else if (state === 'ended') label = 'Wrap-up';
      statusEl.textContent = label;
    }
    if (numberEl) {
      const num = String(d.number || resolveCurrentLeadDialPhone() || '').trim();
      numberEl.textContent = num || '—';
    }
  }

  function bindLeadPanelQuickLogTagRow() {
    const tagRow = document.getElementById('leadNotepadTagRow');
    if (!tagRow || tagRow.dataset.qlBound === '1') return;
    tagRow.dataset.qlBound = '1';
    tagRow.addEventListener(
      'click',
      async (e) => {
        const tagBtn = e.target.closest('.lead-notepad-tag');
        if (!tagBtn) return;
        e.preventDefault();
        e.stopPropagation();
        await applyLeadPanelQuickLogTag(tagBtn.getAttribute('data-tag') || '');
      },
      true,
    );
  }

  function bindLeadPanelBottomActions() {
    if (window.__leadPanelBottomActionsBound) return;
    window.__leadPanelBottomActionsBound = true;

    bindLeadPanelQuickLogTagRow();

    document.addEventListener('adhello-softphone-state', (e) => {
      syncLeadPanelCallDock((e && e.detail) || {});
    });

    const dockFocus = document.getElementById('leadPanelCallDockFocus');
    if (dockFocus) {
      dockFocus.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof window.__adhelloFocusSoftphone === 'function') {
          window.__adhelloFocusSoftphone();
        } else if (typeof window.__adhelloOpenSoftphoneWithDial === 'function') {
          const phone = resolveCurrentLeadDialPhone();
          if (phone) window.__adhelloOpenSoftphoneWithDial(phone, { autoDial: false });
        }
      });
    }
    const dockHangup = document.getElementById('leadPanelCallDockHangup');
    if (dockHangup) {
      dockHangup.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof window.__adhelloSoftphoneHangup === 'function') {
          window.__adhelloSoftphoneHangup();
        }
      });
    }

    document.addEventListener('click', async (e) => {
      if (!isLeadDetailPanelOpen()) return;
      const inBottom =
        e.target.closest('#leadPanelNotepad') || e.target.closest('#leadPanelOutreachDrawer');
      if (!inBottom) return;

      if (e.target.closest('#clickToCallBtn')) {
        e.preventDefault();
        e.stopPropagation();
        await triggerLeadPanelCall();
        return;
      }

      if (e.target.closest('#leadPanelPushGhlBtn')) {
        e.preventDefault();
        e.stopPropagation();
        await pushLeadPanelToGhl();
        return;
      }

      if (e.target.closest('#leadPanelSmsBtn')) {
        e.preventDefault();
        e.stopPropagation();
        await openLeadPanelSmsComposer();
        return;
      }

    });

    const noteInputEl = getLeadPanelEl('noteInput');
    if (noteInputEl && !noteInputEl.dataset.adhelloNoteBound) {
      noteInputEl.dataset.adhelloNoteBound = '1';
      noteInputEl.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        e.stopPropagation();
        void submitLeadPanelNote();
      });
    }
  }

  // Determine page type
  const isLeadsPage = !!document.getElementById('mobilePanelRemoveBtn');
  const isResultsPage = !!document.getElementById('mobilePanelSaveBtn');

  // --- Fetch saved leads on results page to pre-fill bookmark states ---
  if (isResultsPage && rows.length > 0) {
    fetch('/leads/saved', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then((res) => res.json())
      .then((savedList) => {
        savedList.forEach(({ key, title }) => {
          savedLeads.set(normalizeLeadTitleKey(title), key);
        });
        // Pre-fill bookmark icons for already-saved leads
        rows.forEach((row) => {
          const title = row.dataset.title;
          if (isLeadTitleSaved(title)) {
            row.dataset.leadKey = savedLeads.get(normalizeLeadTitleKey(title));
            const bookmarkBtn = row.querySelector('.bookmark-btn');
            if (bookmarkBtn) markBookmarkSaved(bookmarkBtn);
          }
        });
      })
      .catch((err) => console.error('Failed to fetch saved leads:', err));
  }

  // --- Centralized Row Selection Logic ---
  const selectRow = async (row) => {
    if (!row) return;
    const tableRow = resolvePipelineTableRowForPanel(row) || row;

    // Remove existing selection
    rows.forEach((r) => r.classList.remove('selected'));
    tableRow.classList.add('selected');
    
    currentRow = tableRow;
    window.__leadPanelActiveRowKey = String(tableRow.dataset.leadKey || '').trim();
    migratePanelNotesCacheOnSelect(tableRow);
    const panelRootForCtx = getLeadDetailPanel();
    if (panelRootForCtx && panelRootForCtx.dataset) {
      const lk = String(tableRow.dataset.leadKey || '').trim().replace(/^lead:/i, '');
      const title = normalizeLeadTitleKey(tableRow.dataset.title || '');
      if (lk) panelRootForCtx.dataset.adhelloLeadKey = lk;
      if (title) panelRootForCtx.dataset.adhelloLeadTitleKey = `title:${title.toLowerCase()}`;
    }
    if (window.__adhelloLeadPanelNotes && typeof window.__adhelloLeadPanelNotes.syncFromRow === 'function') {
      window.__adhelloLeadPanelNotes.syncFromRow(tableRow);
    }
    const nav = navigableRows();
    currentIndex = nav.indexOf(tableRow);

    // Update nav button visibility/state (workflow page may hide filtered-out rows)
    if (prevLeadBtn) prevLeadBtn.style.opacity = currentIndex > 0 ? '1' : '0.3';
    if (nextLeadBtn) nextLeadBtn.style.opacity = currentIndex >= 0 && currentIndex < nav.length - 1 ? '1' : '0.3';

    // OPEN SIDEBAR / PANEL before populatePanel: if populate throws (bad row JSON, partial DOM),
    // the sheet must still appear; previously the open block never ran after a throw.
    const panelRoot = getLeadDetailPanel();
    if (panelRoot) {
      panelRoot.classList.remove('hidden');
      panelRoot.classList.add('open');
      panelRoot.classList.remove('opacity-0');
      panelRoot.classList.add('opacity-100');
      /* Defeat Tailwind `hidden` vs `flex` conflicts and ensure overlay is above app chrome */
      panelRoot.style.setProperty('display', 'flex', 'important');
      panelRoot.style.setProperty('opacity', '1', 'important');
      panelRoot.style.setProperty('pointer-events', 'auto', 'important');
      panelRoot.style.setProperty('visibility', 'visible', 'important');
      panelRoot.style.setProperty('z-index', '400', 'important');

      document.body.style.overflow = 'hidden';

      const innerSheet = panelRoot.querySelector(':scope > div');
      if (innerSheet) {
        innerSheet.classList.remove('translate-y-full', 'translate-x-full');
        innerSheet.style.display = 'flex';
      }

      requestAnimationFrame(() => {
        const panelScroll = document.getElementById('leadPanelTabScroll');
        if (panelScroll) panelScroll.scrollTop = 0;
        const stickyTitle = document.getElementById('stickyPanelTitle');
        if (stickyTitle) {
          stickyTitle.classList.add('opacity-0', 'pointer-events-none');
          stickyTitle.classList.remove('opacity-100');
        }
        if (typeof window.__adhelloRefreshSoftphonePosition === 'function') {
          window.__adhelloRefreshSoftphonePosition();
        }
      });
    } else {
      console.warn('[Lead detail panel] #mobilePanel not found — detail sidebar cannot open on this page.');
    }

    prepareLeadRowForPanel(tableRow);
    syncPanelNotesCacheFromRow(tableRow);
    window.__leadActivityFilter = window.__leadActivityFilter || 'all';
    try {
      renderLeadActivityTimeline(tableRow, window.__leadActivityFilter);
      syncLeadActivityFilterButtons(window.__leadActivityFilter);
    } catch (earlyActivityErr) {
      console.warn('[Lead panel] early activity paint failed:', earlyActivityErr);
    }

    if (typeof window.__paintPanelFromLeadRecord === 'function') {
      const emb =
        typeof findInitialSavedLeadRecord === 'function'
          ? findInitialSavedLeadRecord(tableRow)
          : typeof window.__findLeadRecordForPanel === 'function'
            ? window.__findLeadRecordForPanel(tableRow)
            : null;
      try {
        window.__paintPanelFromLeadRecord(emb, tableRow);
      } catch (paintRecErr) {
        console.warn('[Lead panel] direct record paint failed:', paintRecErr);
      }
    }

    try {
      if (typeof paintLeadPanelFromRow === 'function') paintLeadPanelFromRow(tableRow);
    } catch (earlyErr) {
      console.warn('[Lead panel] early row paint failed:', earlyErr);
    }

    try {
      populatePanel(tableRow);
      setLeadPanelOutreachFeedback('');
    } catch (err) {
      console.error('[Lead detail panel] populatePanel failed:', err);
      setLeadPanelOutreachFeedback(
        (err && err.message) || 'Could not load outreach panel for this lead.',
        'error',
      );
      try {
        if (typeof paintLeadPanelFromRow === 'function') paintLeadPanelFromRow(tableRow);
      } catch (retryErr) {
        console.warn('[Lead panel] retry row paint failed:', retryErr);
      }
      try {
        renderLeadActivityTimeline(tableRow, window.__leadActivityFilter || 'all');
        syncLeadActivityFilterButtons(window.__leadActivityFilter || 'all');
      } catch (activityErr) {
        console.warn('[Lead panel] activity paint after populate failure:', activityErr);
      }
    }

    try {
      await hydrateLeadRowFromPanelData(tableRow);
    } catch (hydrateErr) {
      console.warn('[Lead panel] panel-data hydrate failed:', hydrateErr);
    }

    // Update panel save button state (results page)
    if (isResultsPage) {
      const mobileSaveBtn = document.getElementById('mobilePanelSaveBtn');
      if (mobileSaveBtn) {
        if (isLeadTitleSaved(tableRow.dataset.title)) {
          markPanelBtnSaved(mobileSaveBtn);
        } else {
          markPanelBtnUnsaved(mobileSaveBtn);
        }
      }
    }
  };

  function shouldIgnoreRowOpenClick(target) {
    if (!target) return true;
    if (target.closest('.bookmark-btn')) return true;
    if (target.closest('[data-plc="company"]')) return true;
    const sel = window.getSelection && window.getSelection();
    if (sel && String(sel.toString() || '').trim()) return true;
    return !!(
      target.type === 'checkbox' ||
      target.closest('.view-detail-btn') ||
      target.closest('.ai-analysis-btn') ||
      target.closest('.lead-category-input') ||
      target.closest('select') ||
      target.closest('form') ||
      target.closest('a') ||
      target.closest('button') ||
      target.closest('.plc-col-resize') ||
      target.closest('.js-pipeline-columns-wrap')
    );
  }

  /** Pipeline table: inline row handler runs on bubble at tr before document — survives lost bubbling */
  function pipelineRowActivateFromInline(ev, tr) {
    if (!ev || !tr || !tr.classList || !tr.classList.contains('result-row')) return;
    if (tr.classList.contains('result-row--panel-source')) return;
    if (ev.shiftKey) return;
    const t = ev.target;
    if (!t || !t.closest) return;
    if (shouldIgnoreRowOpenClick(t)) return;
    ev.stopPropagation();
    selectRow(tr);
  }
  window.__pipelineRowActivate = pipelineRowActivateFromInline;

  ensureLeadDetailPanelNotBlockingPage();

  // Row clicks: delegated handler only (avoids double-invoke + works for dynamically added rows)
  document.addEventListener('click', (e) => {
    const deleteNoteBtn = e.target.closest('.lead-activity-note-delete');
    if (deleteNoteBtn && deleteNoteBtn.closest('#mobilePanel')) {
      e.preventDefault();
      e.stopPropagation();
      const activityRow =
        typeof resolvePanelActionRow === 'function' ? resolvePanelActionRow() : currentRow;
      const ts = deleteNoteBtn.getAttribute('data-note-ts') || '';
      let val = deleteNoteBtn.getAttribute('data-note-value') || '';
      try {
        val = decodeURIComponent(val);
      } catch {
        /* keep raw */
      }
      if (activityRow) void deleteLeadPanelNote(activityRow, ts, val);
      return;
    }

    const activityFilterBtn = e.target.closest('.lead-activity-filter');
    if (activityFilterBtn && activityFilterBtn.closest('#mobilePanel')) {
      e.preventDefault();
      e.stopPropagation();
      window.__leadActivityFilter = activityFilterBtn.getAttribute('data-activity-filter') || 'all';
      syncLeadActivityFilterButtons(window.__leadActivityFilter);
      const activityRow = resolveLeadPanelNoteRow();
      renderLeadActivityTimeline(activityRow, window.__leadActivityFilter);
      return;
    }
    const chBtn = e.target.closest('#leadPanelWhatToSellCard .lead-outreach-channel');
    if (chBtn) {
      e.preventDefault();
      e.stopPropagation();
      setLeadOutreachChannel(chBtn.getAttribute('data-outreach-channel') || 'call');
      onLeadPanelOutreachScriptInputsChanged(currentRow);
      return;
    }
    if (e.target.closest('#leadSmsThreadSyncBtn')) {
      e.preventDefault();
      const row = resolvePanelActionRow ? resolvePanelActionRow() : currentRow;
      if (row) {
        loadLeadSmsThread(row, { sync: true }).catch((err) => {
          setLeadSmsThreadStatus((err && err.message) || 'Sync failed', true);
        });
      }
      return;
    }
    if (e.target.closest('#leadSmsComposeSendBtn')) {
      e.preventDefault();
      void sendLeadSmsCompose();
      return;
    }
    if (e.target.closest('#leadSmsImproveTextBtn')) {
      e.preventDefault();
      void improveLeadSmsComposeText();
      return;
    }
    const row = e.target.closest('.result-row');
    if (!row || row.classList.contains('result-row--panel-source')) return;
    if (e.shiftKey) return;
    if (shouldIgnoreRowOpenClick(e.target)) return;
    selectRow(row);
  });

  // Bookmark icons — capture phase so tr onclick / row handlers cannot swallow the click
  document.addEventListener(
    'click',
    async (e) => {
      const bookmarkBtn = e.target.closest('.bookmark-btn');
      if (!bookmarkBtn) return;

      const isPipelineBtn =
        bookmarkBtn.classList.contains('pipeline-bookmark-btn') ||
        (isPipelineBookmarkTable() && bookmarkBtn.closest('#prospectLeadsTable'));

      // pipeline-bookmark.js owns pipeline clicks. Do not stop the event first —
      // that used to swallow the dedicated handler when app.js registered earlier.
      if (isPipelineBtn && window.__PIPELINE_BOOKMARK_BOUND === '1') return;

      e.stopPropagation();
      e.preventDefault();
      e.stopImmediatePropagation();

      const row = bookmarkBtn.closest('.result-row');
      if (!row) return;

      // Pipeline leads are already saved — never fall through to search save/unsave.
      if (isPipelineBtn) {
        await togglePipelineLeadBookmark(row, bookmarkBtn);
        return;
      }

      const title = row.dataset.title;
      if (!title) return;

      const isSaved = isLeadTitleSaved(title);

      if (isSaved) {
        await unsaveLead(row);
        if (currentRow === row) {
          ['panelSaveBtn', 'mobilePanelSaveBtn'].forEach((id) => {
            const b = document.getElementById(id);
            if (b) markPanelBtnUnsaved(b);
          });
        }
      } else {
        markBookmarkSaved(bookmarkBtn);
        const ok = await saveLead(row);
        if (!ok) markBookmarkUnsaved(bookmarkBtn);
        if (currentRow === row) {
          ['panelSaveBtn', 'mobilePanelSaveBtn'].forEach((id) => {
            const b = document.getElementById(id);
            if (b) markPanelBtnSaved(b);
          });
        }
      }
    },
    true,
  );

  // Specific Detail Button Trigger (Reliability)
  document.addEventListener('click', (e) => {
    const detailBtn = e.target.closest('.view-detail-btn');
    if (detailBtn) {
      e.stopPropagation();
      const row = detailBtn.closest('.result-row');
      if (row) selectRow(row);
    }
  });

  // Explicit right-chevron trigger fallback (covers icon wrappers/nested taps)
  document.addEventListener('click', (e) => {
    const chevronTrigger =
      e.target.closest('.view-detail-btn') ||
      e.target.closest('[aria-label="Open lead details"]') ||
      e.target.closest('[title="Open lead details"]');
    if (!chevronTrigger) return;
    e.preventDefault();
    e.stopPropagation();
    const row = chevronTrigger.closest('.result-row');
    if (row) selectRow(row);
  });

  async function runAiAnalysisForRow(row) {
    if (!row) return null;
    const leadKey = String(row.dataset.leadKey || '').trim();
    const website = String(row.dataset.website || '').trim();
    if (!leadKey) throw new Error('Lead key missing');
    if (!website || website === 'N/A') throw new Error('This lead has no website URL');

    const fetchJsonFn = typeof window.fetchJson === 'function' ? window.fetchJson : null;
    let data;
    if (fetchJsonFn) {
      const { ok, j } = await fetchJsonFn(`/leads/${encodeURIComponent(leadKey)}/ai-analysis`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({}),
      });
      if (!ok || !j.success) throw new Error((j && j.error) || 'AI analysis failed');
      data = j;
    } else {
      const res = await fetch(`/leads/${encodeURIComponent(leadKey)}/ai-analysis`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({}),
      });
      data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'AI analysis failed');
    }
    const analysis = data.analysis || {};
    const ownerSignal = String(data.ownerSignal || (data.lead && data.lead.ownerSignal) || '').trim();
    const score = Number(analysis.analysisScore || 0);
    row.dataset.aiScore = String(Math.min(10, Math.max(0, Math.round(score))));
    row.dataset.aiAnalysis = JSON.stringify(analysis);
    if (ownerSignal) row.dataset.ownerSignal = ownerSignal;
    revealOpportunityForRow(row);
    if (currentRow === row) {
      leadOutreachScriptsCache = {
        workspaceId: getActiveWorkspaceIdForScripts(),
        leadKey: '',
        data: null,
        loading: null,
        loadingKey: '',
        workspaceData: null,
        workspaceLoading: null,
      };
      if (typeof populatePanel === 'function') populatePanel(row);
      else {
        syncLeadCallAiAnalyzeCta(row);
        syncLeadPanelSellingScript(row).catch(() => {});
      }
    }
    const rowSignal = row.querySelector('.lead-owner-signal');
    if (rowSignal) rowSignal.textContent = ownerSignal || '';
    return data;
  }

  async function fetchAuditReportLinkBundle(row) {
    const leadKey = String(row.dataset.leadKey || '').trim();
    if (!leadKey) throw new Error('Lead key missing');
    const url = `/leads/${encodeURIComponent(leadKey)}/audit-report-link`;
    const fetchJsonFn = typeof window.fetchJson === 'function' ? window.fetchJson : null;
    if (fetchJsonFn) {
      const { ok, j } = await fetchJsonFn(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({}),
      });
      if (!ok || !j.success) throw new Error((j && j.error) || 'Could not create report link');
      return j;
    }
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.error || 'Could not create report link');
    return data;
  }

  function getAiToolsAssessmentFromRow(row) {
    if (!row) return null;
    try {
      const attr = row.getAttribute('data-ai-tools-assessment');
      if (!attr || attr === 'null') return null;
      const parsed = JSON.parse(attr);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function setAiToolsAssessmentOnRow(row, assessment) {
    if (!row || !assessment) return;
    try {
      row.dataset.aiToolsAssessment = JSON.stringify(assessment);
      row.dataset.aiToolsAssessmentAt = new Date().toISOString();
    } catch (_) {}
  }

  async function fetchAiToolsReportLinkBundle(row) {
    const leadKey = String(row.dataset.leadKey || '').trim();
    if (!leadKey) throw new Error('Lead key missing');
    const url = `/leads/${encodeURIComponent(leadKey)}/ai-tools-report-link`;
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error((data && data.error) || 'Could not create assessment link');
    return data;
  }

  async function generateAiToolsAssessmentForRow(row) {
    const leadKey = await ensureRowHasLeadKey(row);
    const url = `/leads/${encodeURIComponent(leadKey)}/ai-tools-assessment/generate`;
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error((data && data.error) || 'Assessment generation failed');
    if (data.assessment) setAiToolsAssessmentOnRow(row, data.assessment);
    return data;
  }

  function syncLeadPanelAiToolsSection(row) {
    const statusEl = document.getElementById('leadPanelAiToolsStatus');
    const assessment = row ? getAiToolsAssessmentFromRow(row) : null;
    const hasAssessment = !!(assessment && (assessment.clientName || assessment.pain || (assessment.quickWins && assessment.quickWins[0] && assessment.quickWins[0].pain)));
    if (statusEl) {
      if (hasAssessment) {
        statusEl.textContent = 'Ready to share';
        statusEl.classList.remove('hidden', 'text-brand-muted');
        statusEl.classList.add('text-orange-600', 'dark:text-orange-400');
      } else {
        statusEl.textContent = 'Not generated yet';
        statusEl.classList.remove('hidden', 'text-orange-600', 'dark:text-orange-400');
        statusEl.classList.add('text-brand-muted');
      }
    }
    document.querySelectorAll('.js-ai-tools-trigger[data-ai-tools-action]').forEach(function (btn) {
      const action = btn.getAttribute('data-ai-tools-action');
      if (action === 'generate') {
        btn.removeAttribute('aria-disabled');
        btn.classList.remove('opacity-50', 'cursor-not-allowed');
        return;
      }
      btn.setAttribute('aria-disabled', hasAssessment ? 'false' : 'true');
      btn.classList.toggle('opacity-50', !hasAssessment);
      btn.classList.toggle('cursor-not-allowed', !hasAssessment);
    });
  }

  function aiToolsPreviewUrlForRow(row) {
    const leadKey = String(row && row.dataset && row.dataset.leadKey ? row.dataset.leadKey : '').trim();
    if (!leadKey) return '';
    return `/leads/${encodeURIComponent(leadKey)}/ai-tools-assessment/preview`;
  }

  function getWorkspaceCouponLink() {
    const store = document.getElementById('workspaceCouponLinkStore');
    return String((store && store.dataset && store.dataset.couponLink) || '').trim();
  }

  function appendCouponLineToReportBody(body) {
    const includeCoupon = document.getElementById('sidebarIncludeCoupon');
    const couponLink = getWorkspaceCouponLink();
    if (!includeCoupon || !includeCoupon.checked || !couponLink) return body;
    return `${body}\n\nAlso, if it helps, here is a free coffee coupon link for your team: ${couponLink}`;
  }

  async function ensureLeadAiAnalysis(row, opts) {
    const options = opts && typeof opts === 'object' ? opts : {};
    let analysis = getAiAnalysisFromRow(row);
    if (analysis) return analysis;
    const hasWebsite = row && row.dataset && row.dataset.website && row.dataset.website !== 'N/A';
    if (!hasWebsite) {
      throw new Error('This lead needs a website URL. Add one or run AI analyze from call mode.');
    }
    if (options.toast !== false && typeof window.showAppToast === 'function') {
      window.showAppToast('Running AI analysis to build your report…', { variant: 'info' });
    }
    const result = await runAiAnalysisForRow(row);
    analysis = (result && result.analysis) || getAiAnalysisFromRow(row);
    if (!analysis) throw new Error('AI analysis did not return usable data. Try again in a moment.');
    return analysis;
  }

  function toDisplayValue(value, fallback) {
    const fb = fallback === undefined ? 'N/A' : fallback;
    if (value == null) return fb;
    const s = String(value).trim();
    return s && s !== 'N/A' ? s : fb;
  }

  function normalizeList(value) {
    if (Array.isArray(value)) return value.map((v) => String(v || '').trim()).filter(Boolean);
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    }
    return [];
  }

  function filterReportEmails(list) {
    const arr = normalizeList(list);
    return arr.filter((e) => {
      const x = String(e || '').trim().toLowerCase();
      if (!x.includes('@')) return false;
      const [local, host] = x.split('@');
      if (!host) return false;
      const h = host.replace(/^www\./, '');
      if (h.includes('sentry') && (h.includes('wix') || h.endsWith('wixpress.com'))) return false;
      if (h === 'sentry.io' || h.endsWith('.sentry.io')) return false;
      if (/^noreply|no-reply|donotreply|mailer-daemon/.test(local)) return false;
      if (/^[0-9a-f]{24,}$/i.test(local)) return false;
      return true;
    });
  }

  function pickPrimaryEmailForReport(emails) {
    const list = filterReportEmails(emails || []);
    if (!list.length) return '';
    for (const p of ['info', 'contact', 'hello', 'sales', 'office', 'support', 'team']) {
      const hit = list.find((e) => e.startsWith(p + '@'));
      if (hit) return hit;
    }
    return [...list].sort((a, b) => a.length - b.length)[0];
  }

  function reportDomainFromWebsite(website) {
    const w = String(website || '').trim();
    if (!w || w === 'N/A') return '';
    try {
      const u = new URL(/^https?:\/\//i.test(w) ? w : `https://${w}`);
      return u.hostname.replace(/^www\./i, '');
    } catch {
      return w.replace(/^https?:\/\//i, '').split('/')[0].split('?')[0] || '';
    }
  }

  function resolveSiteHealth100(analysis) {
    if (!analysis || typeof analysis !== 'object') return 0;
    if (analysis.siteHealth100 != null && Number.isFinite(Number(analysis.siteHealth100))) {
      return Math.min(100, Math.max(0, Math.round(Number(analysis.siteHealth100))));
    }
    const raw = Number(analysis.analysisScore || 0);
    if (raw > 10) return Math.min(100, Math.max(0, Math.round(raw)));
    if (raw > 0) return Math.min(100, Math.max(0, 100 - Math.round(raw) * 10));
    return 0;
  }

  function formatAuditDateShort(iso) {
    const d = iso ? new Date(iso) : null;
    if (!d || Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  /** Mirrors server `computeTopGapLabels` for saved rows missing `topGapLabels`. */
  function computeTopGapLabelsClient(a, maxLabels) {
    const cap = Math.min(10, Math.max(1, Number(maxLabels) || 3));
    const out = [];
    if (!a || typeof a !== 'object') return out;
    const flags = a.flags || {};
    const meta = String(a.metaDescription || '').trim();
    const title = String(a.pageTitle || '').trim();
    const emails = a.emails || [];
    const phones = a.phones || [];
    const signals = a.signals || [];
    const copyYear = parseInt(String(a.copyrightYear || '').trim(), 10);
    const nowYear = new Date().getFullYear();
    const push = (label) => {
      if (out.length >= cap) return;
      if (label && !out.includes(label)) out.push(label);
    };
    if (flags.returned404) push('Homepage availability (404)');
    if (flags.noSsl) push('HTTPS / SSL');
    if (!meta) push('Meta description');
    if (flags.slowLoad) push('Homepage load speed');
    if (!a.mobileResponsive) push('Mobile viewport / responsiveness');
    if (Number.isFinite(copyYear) && copyYear < nowYear - 1) push('Copyright / freshness signal');
    if (!signals.length) push('Above-the-fold call to action');
    if (!title || title.length < 2) push('Page title strength');
    if ((!emails || !emails.length) && (!phones || !phones.length)) push('Visible contact info');
    if (!out.length) push('No major crawl gaps flagged');
    return out.slice(0, cap);
  }

  function getTopGapLabelsForReport(analysis, maxPick) {
    const cap = Math.min(5, Math.max(1, Number(maxPick) || 3));
    if (analysis && Array.isArray(analysis.topGapLabels) && analysis.topGapLabels.length) {
      return analysis.topGapLabels.slice(0, cap);
    }
    return computeTopGapLabelsClient(analysis, cap);
  }

  function auditTierLabel(health) {
    if (health >= 85) return 'Strong';
    if (health >= 70) return 'Good';
    if (health >= 50) return 'Needs Work';
    return 'Critical';
  }

  /** City label for quoted search examples (e.g. "Portland" from "Portland, OR"). */
  function auditCityLabel(row) {
    const raw = String((row && row.dataset && row.dataset.city) || '').trim();
    if (!raw || raw === 'N/A') return '';
    return raw.split(',')[0].trim();
  }

  /**
   * Plausible quoted query for the audit narrative (not a SERP claim).
   * Example: painters + Portland → "painters Portland".
   */
  function buildAuditSearchQueryExample(row) {
    const city = auditCityLabel(row);
    const cat = String((row && row.dataset && row.dataset.category) || '')
      .trim()
      .toLowerCase();
    const c = city ? city.replace(/\b\w/g, (ch) => ch.toUpperCase()) : '';
    if (c) {
      if (/(^|[\s,])paint/.test(cat)) return `painters ${c}`;
      if (/plumb/.test(cat)) return `plumbers ${c}`;
      if (/(hvac|heating|cooling|air conditioning)/.test(cat)) return `hvac ${c}`;
      if (/roof/.test(cat)) return `roofers ${c}`;
      if (/electric/.test(cat)) return `electricians ${c}`;
      if (/landscap|lawn|yard/.test(cat)) return `landscaping ${c}`;
      if (/clean/.test(cat)) return `cleaning services ${c}`;
      if (/contract|remodel|construction|general contractor/.test(cat)) return `contractors ${c}`;
    }
    if (c && cat) {
      const slug = cat
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2 && !['the', 'and', 'for', 'inc', 'llc'].includes(w))
        .slice(0, 3)
        .join(' ');
      if (slug) return `${slug} ${c}`;
    }
    return city ? `services ${c}` : 'your services';
  }

  function buildAuditHeadlineIssue(row, analysis, ownerSignal) {
    const metaMissing = !String((analysis && analysis.metaDescription) || '').trim();
    if (metaMissing) {
      const q = buildAuditSearchQueryExample(row);
      return (
        'The headline issue: You are losing click-throughs to competitors because Google is guessing what your business does — your homepage has no meta description. ' +
        `That means when someone Googles "${q}" (or your brand), Google auto-generates a random snippet from your page — ` +
        "and it's almost never the sentence that converts. Competitors with a written description get more clicks from the same ranking."
      );
    }
    const s = String(ownerSignal || '').trim();
    return s ? `The headline issue: ${s}` : 'The headline issue: A few focused fixes would tighten trust and conversion on your homepage.';
  }

  function buildTopAuditFixes(analysis, copyrightYearRaw) {
    const fixes = [];
    const nowY = new Date().getFullYear();
    const cyNum = parseInt(String(copyrightYearRaw || '').trim(), 10);
    const metaOk = String((analysis && analysis.metaDescription) || '').trim().length > 0;
    const ctas = normalizeList(analysis && (analysis.signals || analysis.bookingSignals));

    if (!metaOk) {
      fixes.push(
        'Write a 150–160 character meta description targeting your top service + city (what you do, where you do it, one proof or offer).',
      );
    }
    if (Number.isFinite(cyNum) && cyNum < nowY - 1) {
      fixes.push(`Update the copyright year to ${nowY} — small trust signal, often a 30-second fix if it's in the footer.`);
    }
    if (!ctas.length) {
      fixes.push('Add a visible "Get a Free Quote" button above the fold with a tap-to-call link on mobile.');
    }
    if (fixes.length < 3 && analysis && analysis.flags && analysis.flags.slowLoad) {
      fixes.push(
        'Improve homepage load speed (compress hero images, trim blocking scripts) so mobile visitors do not bounce before they read your pitch.',
      );
    }
    if (fixes.length < 3 && analysis && analysis.flags && analysis.flags.noSsl) {
      fixes.push('Enable HTTPS across the site so browsers never show a "Not secure" warning before the first scroll.');
    }
    if (!fixes.length) {
      fixes.push('Book a short homepage review: we will prioritize the three changes that lift trust and clicks first.');
    }
    return fixes.slice(0, 3);
  }

  function buildClientReportEmail(row, analysis, ownerSignal) {
    const company = toDisplayValue(row && row.dataset ? row.dataset.title : '', 'Business');
    const website = toDisplayValue(row && row.dataset ? row.dataset.website : '', '');
    const domain = reportDomainFromWebsite(website);
    const summarySignal = String(ownerSignal || (row && row.dataset ? row.dataset.ownerSignal : '') || '').trim();

    const health100 = resolveSiteHealth100(analysis);
    const tier = auditTierLabel(health100);
    const headline = buildAuditHeadlineIssue(row, analysis, summarySignal);
    const rubric = String((analysis && analysis.rubricVersion) || 'rubric_v1.2').trim();
    const auditedIso = analysis && analysis.auditedAt ? String(analysis.auditedAt) : '';
    const scoreMetaLine = auditedIso
      ? `Scored with ${rubric} on ${formatAuditDateShort(auditedIso)}.`
      : `Scored with ${rubric}.`;
    const prior = analysis && analysis.priorAuditSnapshot;
    let progressLine = '';
    if (prior && prior.auditedAt && Number.isFinite(Number(prior.siteHealth100))) {
      const prevRv = prior.rubricVersion ? String(prior.rubricVersion) : '';
      progressLine = `Progress vs last crawl (${formatAuditDateShort(prior.auditedAt)}${prevRv ? `, ${prevRv}` : ''}): ${Math.round(
        Number(prior.siteHealth100),
      )}/100 → ${health100}/100.`;
    }
    const gapTop3 = getTopGapLabelsForReport(analysis, 3);
    const gapLines =
      gapTop3.length > 0
        ? ['Top homepage gaps (highest impact first):', '', ...gapTop3.map((g, i) => `${i + 1}. ${g}`), '']
        : [];
    const rubricTease = 'Full category breakdown available in the deeper audit.';
    const estimatedLift =
      'Estimated lift: Fixing the top three gaps typically moves this score about 15–20 points and, in many markets, organic clicks roughly 10–25% — actual lift varies by niche, geography, and how traffic is measured.';

    const primaryEmail = pickPrimaryEmailForReport(analysis && (analysis.emails || analysis.emailAddresses));
    const phones = normalizeList(analysis && (analysis.phones || analysis.phoneNumbers));
    const primaryPhone = phones[0] || '';
    const primaryContactParts = [];
    if (primaryEmail) primaryContactParts.push(primaryEmail);
    if (primaryPhone) primaryContactParts.push(primaryPhone);
    const primaryContact =
      primaryContactParts.length > 0 ? primaryContactParts.join(' · ') : 'None identified on the homepage crawl';

    const hasHttps = !!(analysis && (analysis.hasHttps === true || analysis.https === true));
    const mobileOk = !!(analysis && (analysis.hasViewportMeta === true || analysis.mobileResponsive === true));
    const is404 = !!(
      analysis &&
      (analysis.has404 === true ||
        analysis.returned404 === true ||
        (analysis.flags && analysis.flags.returned404))
    );
    const title = toDisplayValue(analysis && analysis.pageTitle, '');
    const metaPresent = String((analysis && analysis.metaDescription) || '').trim().length > 0;
    const copyrightRaw = analysis && analysis.copyrightYear != null ? String(analysis.copyrightYear).trim() : '';
    const cyNum = parseInt(copyrightRaw, 10);
    const nowY = new Date().getFullYear();
    let copyrightLine;
    if (Number.isFinite(cyNum)) {
      copyrightLine =
        cyNum < nowY - 1
          ? `Copyright year: ⚠️ ${cyNum} (signals the site may not be actively maintained)`
          : `Copyright year: ✅ ${cyNum}`;
    } else {
      copyrightLine = 'Copyright year: — (not detected in crawl)';
    }
    const ctaSignals = normalizeList(analysis && (analysis.signals || analysis.bookingSignals));

    const compName = row && row.dataset ? String(row.dataset.competitorName || '').trim() : '';
    const compGap = row && row.dataset ? String(row.dataset.competitorGap || '').trim() : '';
    const customBench = row && row.dataset ? String(row.dataset.competitorMetaBenchmark || '').trim() : '';
    let competitorBlurb;
    if (compName && compGap) {
      competitorBlurb = `Competitive angle: ${compGap} (vs ${compName}).`;
    } else if (customBench) {
      competitorBlurb = `Competitive angle: ${customBench}`;
    } else if (!metaPresent) {
      competitorBlurb =
        'Competitive angle: In many local packs, the listings that earn the click already show a hand-written meta description — without one, you are often losing the same-ranking click to whoever controls that line.';
    } else {
      competitorBlurb =
        'Competitive angle: Stronger nearby listings often read sharper in search and on-page — small gaps in trust signals compound into lost calls.';
    }

    const fixes = buildTopAuditFixes(analysis, copyrightRaw);
    const fixLines = fixes.map((t, i) => `${i + 1}. ${t}`);

    const titleLine =
      title && title.length > 1
        ? `Page title: ✅ "${title.replace(/"/g, "'")}"`
        : 'Page title: ❌ Missing or weak';

    const lines = [
      `AI Website Audit — ${company}`,
      domain || '(no domain)',
      '',
      `Overall Score: ${health100}/100 — ${tier}`,
      scoreMetaLine,
      ...(progressLine ? [progressLine] : []),
      '',
      ...gapLines,
      rubricTease,
      '',
      estimatedLift,
      '',
      headline,
      '',
      'Quick scan results',
      '',
      `HTTPS: ${hasHttps ? '✅ Secure' : '❌ Not secure'}`,
      `Mobile responsive: ${mobileOk ? '✅ Yes' : '❌ No'}`,
      `Broken links (404s): ${is404 ? '❌ Detected on homepage' : '✅ None detected on homepage'}`,
      titleLine,
      `Meta description: ${metaPresent ? '✅ Present' : '❌ Missing'}`,
      copyrightLine,
      `Booking / Call-to-Action: ${ctaSignals.length ? `✅ Detected: ${ctaSignals.join(', ')}` : '❌ No clear CTA detected above the fold'}`,
      '',
      `Contact info found: ${primaryContact}`,
      '',
      competitorBlurb,
      '',
      'Top 3 fixes (in priority order)',
      '',
      ...fixLines,
      '',
      'Want the full 12-point report?',
      "Reply or call back and I'll send a deeper audit with the full category breakdown (page speed, local SEO, Google Business Profile alignment, and competitor benchmark) — no charge, no obligation.",
    ];

    const subject = `AI Website Audit — ${company}`;
    const body = appendCouponLineToReportBody(lines.join('\n'));
    const toEmail = toDisplayValue(row && row.dataset ? row.dataset.email : '', '');
    return { subject, body, toEmail };
  }

  function openMailReport(report) {
    if (!report || !report.subject || !report.body) return false;
    const encodedSubject = encodeURIComponent(report.subject);
    const encodedBody = encodeURIComponent(report.body);
    const encodedTo = encodeURIComponent(report.toEmail || '');
    const mailto = `mailto:${encodedTo}?subject=${encodedSubject}&body=${encodedBody}`;
    window.location.href = mailto;
    return true;
  }

  async function sendReportEmailViaGhl(report) {
    if (!report || !report.subject || !report.body) {
      throw new Error('Could not build report email.');
    }
    const toEmail = String(report.toEmail || '').trim();
    if (!toEmail || toEmail === 'N/A') {
      throw new Error('Lead has no email address.');
    }
    await runLeadTelephonyAction(
      '/email',
      { subject: report.subject, body: report.body },
      'Report email sent via Go High Level',
    );
    return true;
  }

  function getAiAnalysisFromRow(row) {
    if (!row || !row.dataset) return null;
    let raw = String(row.dataset.aiAnalysis || '').trim();
    if (!raw || raw === 'null' || raw === 'undefined') {
      const attr = row.getAttribute('data-ai-analysis');
      if (attr && attr.trim() && attr.trim() !== 'null') raw = attr.trim();
    }
    if (!raw || raw === 'null' || raw === 'undefined') return null;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      if (Array.isArray(parsed)) return null;
      return Object.keys(parsed).length ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function syncSidebarOutreachButtons(row) {
    const couponWarning = document.getElementById('sidebarCouponWarning');
    const includeCoupon = document.getElementById('sidebarIncludeCoupon');
    if (couponWarning && includeCoupon) {
      const show = includeCoupon.checked && !getWorkspaceCouponLink();
      couponWarning.classList.toggle('hidden', !show);
    }
    if (!row) return;
    const hasAnalysis = !!getAiAnalysisFromRow(row);
    const hasWebsite = row.dataset && row.dataset.website && row.dataset.website !== 'N/A';
    const ready = hasAnalysis || hasWebsite;
    const ids = [
      'sidebarReportEmailBtn',
      'sidebarHostedAuditBtn',
      'sidebarCopyAuditLinkBtn',
      'sidebarCopySmsAuditBtn',
    ];
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.disabled = false;
      el.classList.toggle('opacity-50', !ready);
      el.classList.toggle('cursor-not-allowed', !ready);
      el.title = hasAnalysis
        ? el.getAttribute('data-title-ready') || el.title
        : hasWebsite
          ? 'Runs AI analysis first if needed, then completes this action'
          : 'Add a website URL to this lead first';
    });
    const reportBtn = document.getElementById('sidebarReportEmailBtn');
    if (reportBtn) {
      reportBtn.title = hasAnalysis
        ? 'Open client report email from saved AI analysis'
        : hasWebsite
          ? 'Generate report email (runs AI analysis if needed)'
          : 'Add a website URL first';
    }
  }

  document.addEventListener('click', async (e) => {
    if (e.target.closest('#leadPanelComposerToggle')) {
      e.preventDefault();
      toggleLeadPanelComposer();
      return;
    }

    if (e.target.closest('#leadPanelQuickLogToggle')) {
      e.preventDefault();
      toggleLeadPanelQuickLog();
      return;
    }

    if (e.target.closest('#leadPanelOutreachToggle')) {
      e.preventDefault();
      toggleLeadPanelOutreach();
      return;
    }

    if (e.target.closest('#leadPanelNotepadToggle')) {
      e.preventDefault();
      toggleLeadPanelNotepad();
      return;
    }

    if (e.target.closest('#leadPanelCadencePlaybookToggle')) {
      e.preventDefault();
      toggleLeadPanelCadencePlaybook();
      return;
    }

    if (e.target.closest('#leadPanelAiToolsToggle')) {
      e.preventDefault();
      toggleLeadPanelAiTools();
      return;
    }

    const callAiBtn = e.target.closest('#leadCallAiAnalyzeBtn');
    if (callAiBtn) {
      e.preventDefault();
      const row = currentRow;
      if (!row) return;
      const hasWebsite = row.dataset.website && row.dataset.website !== 'N/A';
      if (!hasWebsite) {
        if (typeof window.showAppToast === 'function') {
          window.showAppToast('This lead has no website URL.', { variant: 'error' });
        }
        return;
      }
      const original = callAiBtn.textContent;
      callAiBtn.disabled = true;
      callAiBtn.textContent = 'Analyzing…';
      try {
        await runAiAnalysisForRow(row);
        syncLeadCallAiAnalyzeCta(row);
        if (typeof window.showAppToast === 'function') {
          window.showAppToast('AI analysis complete.', { variant: 'success' });
        }
      } catch (err) {
        const msg = err && err.message ? err.message : 'AI analysis failed';
        if (typeof window.showAppToast === 'function') window.showAppToast(msg, { variant: 'error' });
      } finally {
        callAiBtn.disabled = false;
        callAiBtn.textContent = original;
      }
      return;
    }

    const btn = e.target.closest('.ai-analysis-btn');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const row = btn.closest('.result-row');
    if (!row) return;
    currentRow = row;
    await runContactHuntForRow(row, { triggerBtn: btn, fromRowAction: true });
  });

  if (mobilePanel && rows.length > 0) {

    if (closeMobileBtn) {
        closeMobileBtn.addEventListener('click', () => {
            if (window.agencyOsContactHunt && window.agencyOsContactHunt.isRunning()) {
              if (typeof window.showAppToast === 'function') {
                window.showAppToast(
                  'Contact hunt still running in the background — check the bell when it finishes.',
                  { variant: 'info', duration: 5500 },
                );
              }
            }
            mobilePanel.classList.remove('open');
            mobilePanel.classList.replace('opacity-100', 'opacity-0');
            clearLeadDetailPanelForceStyles(mobilePanel);
            mobilePanel.style.pointerEvents = 'none';
            setTimeout(() => mobilePanel.classList.add('hidden'), 300);
            document.body.style.overflow = '';
            if (typeof window.__adhelloRefreshSoftphonePosition === 'function') {
              window.__adhelloRefreshSoftphonePosition();
            }
            rows.forEach((r) => r.classList.remove('selected'));
            currentRow = null;
            currentIndex = -1;
        });
    }

    // Navigation Arrows
    if (prevLeadBtn) {
        prevLeadBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const nav = navigableRows();
            const idx = currentRow ? nav.indexOf(currentRow) : -1;
            if (idx > 0) selectRow(nav[idx - 1]);
        });
    }

    if (nextLeadBtn) {
        nextLeadBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const nav = navigableRows();
            const idx = currentRow ? nav.indexOf(currentRow) : -1;
            if (idx >= 0 && idx < nav.length - 1) {
                const nextRow = nav[idx + 1];
                selectRow(nextRow);
                // Auto-call the next lead if a continuous calling session is active
                autoCallIfSessionActive(nextRow);
            }
        });
    }

    // Check if a continuous agent calling session is active, and auto-call the lead
    async function autoCallIfSessionActive(row) {
        if (!row || !row.dataset || !row.dataset.leadKey) return;
        try {
            const statusRes = await fetch('/leads/telephony/session/status', {
                credentials: 'same-origin',
            });
            const statusData = await statusRes.json().catch(() => ({}));
            if (!statusData || !statusData.active) return;

            const key = row.dataset.leadKey;
            const phone = splitPhoneNumbers(row.dataset.phone)[0];
            if (!phone) return;

            // Call via session — the backend will queue it instead of placing a new call
            await requestLeadCallByKey(key, phone);
        } catch (_) {
            // Silently ignore — session check or call may fail if session just ended
        }
    }

    // Poll session status periodically to update UI indicators
    let sessionPollTimer = null;
    async function pollSessionStatus() {
        try {
            const res = await fetch('/leads/telephony/session/status', {
                credentials: 'same-origin',
            });
            const data = await res.json().catch(() => ({}));
            updateSessionBadge(data && data.active, data && data.queuedCount);
        } catch (_) {
            updateSessionBadge(false, 0);
        }
    }

    function updateSessionBadge(active, queuedCount) {
        const badge = document.getElementById('sessionCallBadge');
        if (!badge) return;
        if (active) {
            badge.classList.remove('hidden');
            badge.textContent = queuedCount > 0 ? `📞 ${queuedCount} queued` : '📞 Active';
            badge.className = badge.className.replace(/bg-\\S+/g, 'bg-emerald-600');
        } else {
            badge.classList.add('hidden');
        }
    }

    // Start polling if next/prev buttons exist (indicating we're on a page with lead panels)
    if (nextLeadBtn || prevLeadBtn) {
        pollSessionStatus();
        sessionPollTimer = setInterval(pollSessionStatus, 10000); // every 10s
    }

    // Close mobile panel on backdrop click
    mobilePanel.addEventListener('click', (e) => {
        if (e.target === mobilePanel) {
            mobilePanel.classList.remove('open');
            mobilePanel.classList.replace('opacity-100', 'opacity-0');
            clearLeadDetailPanelForceStyles(mobilePanel);
            mobilePanel.style.pointerEvents = 'none';
            setTimeout(() => mobilePanel.classList.add('hidden'), 300);
            document.body.style.overflow = '';
            rows.forEach((r) => r.classList.remove('selected'));
            currentRow = null;
            currentIndex = -1;
        }
    });

    // Sticky title: show compact name in the nav row after scrolling the tab body past the hero
    const panelScroll = document.getElementById('leadPanelTabScroll');
    const stickyTitle = document.getElementById('stickyPanelTitle');
    if (panelScroll && stickyTitle) {
      const STICKY_THRESHOLD = 200;
      panelScroll.addEventListener(
        'scroll',
        () => {
          const show = panelScroll.scrollTop > STICKY_THRESHOLD;
          if (show) {
            stickyTitle.classList.remove('opacity-0', 'pointer-events-none');
            stickyTitle.classList.add('opacity-100');
          } else {
            stickyTitle.classList.add('opacity-0', 'pointer-events-none');
            stickyTitle.classList.remove('opacity-100');
          }
        },
        { passive: true }
      );
    }
  }

  if (document.getElementById('leadPanelTabScroll')) {
    bindLeadPanelBottomActions();
    bindLeadPanelSectionNav();
    bindLeadPanelContactDetailsToggle();
  }

  let kieInsightRequestId = 0;

  function scheduleKieServiceInsight(row) {
    const key = row.dataset.leadKey;
    const auditStatus = document.getElementById('mobilePanelAuditStatus');
    const auditSummary = document.getElementById('mobilePanelAuditSummary');
    const aiScorePill = document.getElementById('mobilePanelAiScore');
    const aiAnalysisBtn = document.getElementById('mobilePanelAiAnalysisBtn');
    const ownerSignalEl = document.getElementById('mobilePanelOwnerSignal');
    const auditLoading = document.getElementById('mobilePanelAuditLoading');
    const auditProvider = document.getElementById('mobilePanelAuditProvider');
    const auditSell = document.getElementById('mobilePanelAuditSell');
    const openerWrap = document.getElementById('mobilePanelAuditOpenerWrap');
    const openerEl = document.getElementById('mobilePanelAuditOpener');
    const serviceSel = document.getElementById('leadPanelPrimaryServiceSelect');
    const manualKey = String((serviceSel && serviceSel.value) || '').trim();
    const offers = Array.isArray(window.ADHELLO_SERVICE_OFFERS) ? window.ADHELLO_SERVICE_OFFERS : [];
    const picked = manualKey ? offers.find((o) => o && String(o.key) === manualKey) : null;
    if (picked) {
      applyLeadPanelSellingScriptNow(row);
    }
    if (!auditStatus) {
      if (!picked) syncLeadPanelSellingScript(row, { skipLoading: true }).catch(() => {});
      return;
    }

    const heuristic = auditSummary
      ? auditSummary.textContent
      : 'Analyzing this business for outreach angles.';

    if (picked && auditSell) {
      if (auditLoading) auditLoading.classList.add('hidden');
      if (auditProvider) auditProvider.classList.add('hidden');
      auditSell.textContent = picked.label || manualKey;
      auditStatus.textContent = picked.label || manualKey;
      auditStatus.className = 'text-[10px] font-black uppercase tracking-widest text-brand-yellow';
      if (auditSummary) {
        auditSummary.textContent =
          'Using your selected offer. Clear the dropdown to let AI suggest again, or run Enhance / AI Analysis for deeper gaps.';
      }
      if (openerWrap) openerWrap.classList.add('hidden');
      if (openerEl) openerEl.textContent = '';
      applyLeadPanelSellingScriptNow(row);
      return;
    }

    if (!key) {
      if (auditLoading) auditLoading.classList.add('hidden');
      if (auditProvider) auditProvider.classList.add('hidden');
      if (auditSell) auditSell.textContent = '—';
      if (openerWrap) openerWrap.classList.add('hidden');
      if (openerEl) openerEl.textContent = '';
      return;
    }

    const reqId = ++kieInsightRequestId;
    if (auditLoading) auditLoading.classList.remove('hidden');
    if (auditProvider) {
      auditProvider.classList.add('hidden');
      auditProvider.textContent = '';
    }

    fetch(`/leads/${key}/insights`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({}),
    })
      .then((r) => r.json())
      .then((data) => {
        if (reqId !== kieInsightRequestId) return;
        if (auditLoading) auditLoading.classList.add('hidden');
        if (!data.success) {
          if (auditSummary) auditSummary.textContent = heuristic;
          if (auditSell) auditSell.textContent = auditStatus.textContent || '—';
          if (openerWrap) openerWrap.classList.add('hidden');
          if (openerEl) openerEl.textContent = '';
          syncLeadPanelSellingScript(row).catch(() => {});
          return;
        }
        const sellLabel = data.primaryServiceLabel || 'Recommended offer';
        auditStatus.textContent = sellLabel;
        auditStatus.className = 'text-[10px] font-black uppercase tracking-widest text-brand-yellow';
        if (auditSell) auditSell.textContent = sellLabel;
        if (auditSummary) auditSummary.textContent = data.rationale || heuristic;
        if (data.primaryServiceKey && row.dataset) {
          row.dataset.primaryServiceKey = String(data.primaryServiceKey);
          if (serviceSel && !String(serviceSel.value || '').trim()) {
            /* Keep dropdown on “Let AI recommend” — key lives on row for script resolution */
          } else {
            syncLeadPrimaryServiceSelect(row);
          }
        }
        syncLeadPanelSellingScript(row).catch(() => {});
        if (openerWrap && openerEl) {
          const tt = typeof data.talkTrack === 'string' ? data.talkTrack.trim() : '';
          if (tt) {
            openerEl.textContent = `“${tt}”`;
            openerWrap.classList.remove('hidden');
          } else {
            openerEl.textContent = '';
            openerWrap.classList.add('hidden');
          }
        }
        if (auditProvider) {
          auditProvider.textContent = data.cached ? 'AI insight (cached)' : `AI insight · ${data.provider || 'openrouter'}`;
          auditProvider.classList.remove('hidden');
        }
      })
      .catch(() => {
        if (reqId !== kieInsightRequestId) return;
        if (auditLoading) auditLoading.classList.add('hidden');
        if (auditSummary) auditSummary.textContent = heuristic;
        if (auditSell) auditSell.textContent = auditStatus.textContent || '—';
        if (openerWrap) openerWrap.classList.add('hidden');
        if (openerEl) openerEl.textContent = '';
        syncLeadPanelSellingScript(row).catch(() => {});
      });
  }

  let reviewIntelRequestId = 0;

  function reviewHeuristicsFromRowDataset(ds) {
    const rating = parseFloat(ds.rating) || 0;
    const n = parseInt(ds.reviews, 10) || 0;
    if (rating > 0 || n > 0) {
      const stars = rating > 0 ? `${rating.toFixed(1)}★` : 'no rating on file';
      const count = n > 0 ? `${n} Google review${n === 1 ? '' : 's'}` : 'few or no reviews on file';
      return {
        summary: `This business shows ${stars} with ${count}. Run hunt with Outscraper configured for quoted reviews and an AI-written summary.`,
        sourceNote: 'Quick read from stars and review count only.',
      };
    }
    return {
      summary:
        'No Google review data on file yet. Run hunt to pull the Google Business listing, reviews, and an AI summary.',
      sourceNote: 'Save the lead and run hunt with Outscraper configured.',
    };
  }

  function readReviewSummaryFromIntel(intel) {
    if (!intel || typeof intel !== 'object') return '';
    if (typeof intel.summary === 'string' && intel.summary.trim()) return intel.summary.trim();
    const strengths = Array.isArray(intel.strengths) ? intel.strengths : [];
    const weaknesses = Array.isArray(intel.weaknesses) ? intel.weaknesses : [];
    const parts = [...strengths, ...weaknesses].filter(Boolean);
    return parts.length ? parts.join(' ') : '';
  }

  function reviewSnippetsFromLeadObj(lead) {
    if (!lead || typeof lead !== 'object') return [];
    const fromArr = Array.isArray(lead.reviewSnippets)
      ? lead.reviewSnippets.map((s) => String(s || '').trim()).filter(Boolean)
      : [];
    if (fromArr.length) return fromArr;
    const imp = lead.importFields && typeof lead.importFields === 'object' ? lead.importFields : null;
    if (!imp) return [];
    const raw = imp.review_snippet ?? imp.reviewsnippet ?? imp.review_quote;
    if (raw == null || raw === '') return [];
    const cleaned = String(raw).replace(/^["']+|["']+$/g, '').trim();
    return cleaned ? [cleaned] : [];
  }

  function readReviewSnippetsFromRow(row) {
    if (!row || !row.dataset) return [];
    try {
      const raw = row.dataset.reviewSnippets;
      if (raw && raw !== '[]' && raw !== '') {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const list = parsed.map((s) => String(s || '').trim()).filter(Boolean);
          if (list.length) return list;
        }
      }
    } catch (_) {
      /* ignore */
    }
    if (typeof findInitialSavedLeadRecord === 'function') {
      const embedded = findInitialSavedLeadRecord(row);
      const fromLead = reviewSnippetsFromLeadObj(embedded);
      if (fromLead.length) {
        try {
          row.dataset.reviewSnippets = JSON.stringify(fromLead);
        } catch (_) {
          /* ignore */
        }
        return fromLead;
      }
    }
    if (typeof row.querySelector === 'function') {
      const cell = row.querySelector('[data-plc="reviewSnippet"] span[title]');
      const fromCell = cell ? String(cell.getAttribute('title') || '').trim() : '';
      if (fromCell && fromCell !== '—') {
        const cleaned = fromCell.replace(/^["']+|["']+$/g, '').trim();
        if (cleaned) {
          try {
            row.dataset.reviewSnippets = JSON.stringify([cleaned]);
          } catch (_) {
            /* ignore */
          }
          return [cleaned];
        }
      }
    }
    return [];
  }

  function formatReviewSnippetSummary(snippets) {
    const list = (Array.isArray(snippets) ? snippets : [])
      .map((s) => String(s || '').trim())
      .filter(Boolean);
    if (!list.length) return '';
    return list.length === 1 ? `"${list[0]}"` : list.map((s) => `"${s}"`).join('\n\n');
  }

  function scheduleReviewIntelligence(row, opts) {
    const refresh = !!(opts && opts.refresh);
    const shouldFetch = refresh;
    const section = document.getElementById('reviewReputationSection');
    if (!section || !row) return;

    const loading = document.getElementById('reviewIntelLoading');
    const grid = document.getElementById('reviewIntelGrid');
    const errEl = document.getElementById('reviewIntelError');
    const foot = document.getElementById('reviewIntelFootnote');
    const summaryEl = document.getElementById('reviewSummaryText');
    const snippetsWrap = document.getElementById('reviewSnippetsWrap');
    const snippetsUl = document.getElementById('reviewSnippetsList');
    const refreshBtn = document.getElementById('reviewIntelRefreshBtn');
    const snippets = readReviewSnippetsFromRow(row);

    function syncReviewIntelActionBtn(hasAiSummary) {
      if (!refreshBtn) return;
      const hasKey = !!String(row.dataset.leadKey || '').trim();
      refreshBtn.classList.toggle('hidden', !hasKey);
      refreshBtn.textContent = hasAiSummary ? 'Refresh analysis' : 'Run analysis';
      refreshBtn.classList.remove('opacity-50', 'pointer-events-none');
    }

    function applyIntel(data, heuristicFallback) {
      if (loading) {
        loading.classList.add('hidden');
        loading.setAttribute('aria-busy', 'false');
      }
      if (grid) {
        grid.classList.remove('hidden', 'review-intel-loading');
      }
      if (refreshBtn) refreshBtn.classList.remove('opacity-50', 'pointer-events-none');
      if (errEl) errEl.classList.add('hidden');
      const aiSummary = (data && data.summary && String(data.summary).trim()) || '';
      const snippetSummary = aiSummary ? '' : formatReviewSnippetSummary(snippets);
      const heuristicSummary =
        aiSummary || snippetSummary ? '' : (heuristicFallback && heuristicFallback.summary) || '';
      const summary = aiSummary || snippetSummary || heuristicSummary;
      const src =
        (data && data.sourceNote) ||
        (snippetSummary && !aiSummary ? 'Review quote from Google Maps listing.' : '') ||
        (heuristicSummary && heuristicFallback && heuristicFallback.sourceNote) ||
        '';
      if (foot) {
        if (src) {
          foot.textContent = data && data.cached ? `${src} (cached)` : src;
          foot.classList.remove('hidden');
        } else {
          foot.textContent = '';
          foot.classList.add('hidden');
        }
      }
      if (summaryEl) {
        summaryEl.textContent =
          summary || 'Run hunt to pull Google reviews and generate an AI summary.';
        summaryEl.classList.toggle('italic', !!snippetSummary && !aiSummary);
        summaryEl.classList.toggle('font-semibold', !snippetSummary || !!aiSummary);
      }
      if (snippetsUl && snippetsWrap) {
        snippetsUl.innerHTML = '';
        const extraSnippets = aiSummary ? snippets : snippets.slice(1);
        if (extraSnippets.length) {
          snippetsWrap.classList.remove('hidden');
          for (const s of extraSnippets.slice(0, 8)) {
            const li = document.createElement('li');
            li.className =
              'text-[11px] text-brand-muted dark:text-slate-400 leading-relaxed italic border-l-2 border-brand-border/40 dark:border-white/10 pl-3';
            li.textContent = `"${String(s)}"`;
            snippetsUl.appendChild(li);
          }
        } else {
          snippetsWrap.classList.add('hidden');
        }
      }
    }

    const key = row.dataset.leadKey;
    const heuristic = reviewHeuristicsFromRowDataset(row.dataset);

    if (!key) {
      applyIntel(null, heuristic);
      syncReviewIntelActionBtn(false);
      return;
    }

    let persistedIntel = null;
    try {
      const rawIntel = row.dataset.reviewIntel;
      if (rawIntel && rawIntel !== 'null' && rawIntel !== '') {
        persistedIntel = JSON.parse(rawIntel);
      }
    } catch (_) {
      persistedIntel = null;
    }

    let cachedSummary = '';
    if (persistedIntel && typeof persistedIntel === 'object') {
      cachedSummary = readReviewSummaryFromIntel(persistedIntel);
      applyIntel(
        {
          summary: cachedSummary,
          sourceNote: persistedIntel.sourceNote,
          cached: true,
        },
        null
      );
    } else if (snippets.length) {
      applyIntel(null, null);
    } else {
      applyIntel(null, heuristic);
    }

    if (!shouldFetch) {
      if (errEl) {
        errEl.classList.add('hidden');
        errEl.textContent = '';
      }
      if (loading) {
        loading.classList.add('hidden');
        loading.setAttribute('aria-busy', 'false');
      }
      if (grid) grid.classList.remove('hidden', 'review-intel-loading');
      syncReviewIntelActionBtn(!!cachedSummary);
      return;
    }

    syncReviewIntelActionBtn(!!cachedSummary);

    try {
      section.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (_) {}

    if (errEl) {
      errEl.classList.add('hidden');
      errEl.textContent = '';
    }
    if (loading) {
      loading.classList.remove('hidden');
      loading.setAttribute('aria-busy', 'true');
      const loadLabel = document.getElementById('reviewIntelLoadingLabel');
      if (loadLabel) {
        loadLabel.textContent = refresh
          ? 'Refreshing AI reputation analysis…'
          : 'Analyzing Google reviews & reputation…';
      }
    }
    if (grid) {
      if (persistedIntel) grid.classList.add('review-intel-loading');
      else if (!snippets.length) grid.classList.add('hidden');
      else grid.classList.remove('hidden', 'review-intel-loading');
    }
    if (refreshBtn) refreshBtn.classList.add('opacity-50', 'pointer-events-none');
    if (foot && !persistedIntel) {
      foot.textContent = '';
      foot.classList.add('hidden');
    }

    const reqId = ++reviewIntelRequestId;
    fetch(`/leads/${encodeURIComponent(key)}/review-intelligence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ refresh }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (reqId !== reviewIntelRequestId) return;
        if (data.success) {
          applyIntel(data, null);
          syncReviewIntelActionBtn(true);
          try {
            row.dataset.reviewIntel = JSON.stringify({
              summary: data.summary || '',
              sourceNote: data.sourceNote || '',
            });
          } catch (_) {
            /* ignore */
          }
        } else {
          if (loading) {
            loading.classList.add('hidden');
            loading.setAttribute('aria-busy', 'false');
          }
          if (grid) grid.classList.remove('hidden', 'review-intel-loading');
          if (refreshBtn) refreshBtn.classList.remove('opacity-50', 'pointer-events-none');
          applyIntel(null, heuristic);
          if (errEl) {
            const hint = data.error ? String(data.error) : '';
            errEl.textContent = hint
              ? `${hint} Showing quick summary below.`
              : 'AI unavailable. Showing quick summary below.';
            errEl.classList.remove('hidden');
          }
        }
      })
      .catch(() => {
        if (reqId !== reviewIntelRequestId) return;
        if (loading) {
          loading.classList.add('hidden');
          loading.setAttribute('aria-busy', 'false');
        }
        if (grid) grid.classList.remove('hidden', 'review-intel-loading');
        if (refreshBtn) refreshBtn.classList.remove('opacity-50', 'pointer-events-none');
        applyIntel(null, heuristic);
        if (errEl) {
          errEl.textContent = 'Could not reach review analysis. Showing quick summary below.';
          errEl.classList.remove('hidden');
        }
      });
  }

  function assignRowDatasetFieldIfBetter(ds, key, incoming) {
    if (!ds || !key) return;
    const next = incoming == null ? '' : String(incoming).trim();
    if (isEmptyLeadField(next)) return;
    const cur = ds[key] == null ? '' : String(ds[key]).trim();
    if (!isEmptyLeadField(cur)) return;
    ds[key] = next;
  }

  function assignRowDatasetScoreIfBetter(ds, score, reviews) {
    if (!ds) return;
    const incR = parseFloat(score);
    const incRev = parseInt(reviews, 10);
    const curR = parseFloat(ds.rating);
    const curRev = parseInt(ds.reviews, 10);
    if (Number.isFinite(incR) && incR > 0) {
      ds.rating = String(incR);
    } else if (
      Number.isFinite(incR) &&
      incR === 0 &&
      (!Number.isFinite(curR) || curR <= 0)
    ) {
      ds.rating = '0';
    }
    if (Number.isFinite(incRev) && incRev > 0) {
      ds.reviews = String(Math.max(incRev, Number.isFinite(curRev) ? curRev : 0));
    } else if (
      Number.isFinite(incRev) &&
      incRev === 0 &&
      (!Number.isFinite(curRev) || curRev <= 0)
    ) {
      ds.reviews = '0';
    }
  }

  function snapshotRowLeadFields(row) {
    if (!row || !row.dataset) return null;
    const ds = row.dataset;
    return {
      title: String(ds.title || '').trim(),
      phone: String(ds.phone || '').trim(),
      email: String(ds.email || '').trim(),
      website: String(ds.website || '').trim(),
      address: String(ds.address || '').trim(),
      category: String(ds.category || '').trim(),
      url: String(ds.url || '').trim(),
      rating: String(ds.rating || '').trim(),
      reviews: String(ds.reviews || '').trim(),
    };
  }

  function restoreRowLeadFieldsIfErased(row, snap) {
    if (!row || !snap || !row.dataset) return;
    const ds = row.dataset;
    if (isEmptyLeadField(ds.title) && !isEmptyLeadField(snap.title)) ds.title = snap.title;
    assignRowDatasetFieldIfBetter(ds, 'phone', snap.phone);
    assignRowDatasetFieldIfBetter(ds, 'email', snap.email);
    assignRowDatasetFieldIfBetter(ds, 'website', snap.website);
    assignRowDatasetFieldIfBetter(ds, 'address', snap.address);
    assignRowDatasetFieldIfBetter(ds, 'category', snap.category);
    assignRowDatasetFieldIfBetter(ds, 'url', snap.url);
    assignRowDatasetScoreIfBetter(ds, snap.rating, snap.reviews);
  }

  function syncPersistedLeadToRowDataset(row, L) {
    if (!row || !L || typeof L !== 'object') return;
    const ds = row.dataset;
    if (L.title != null && !isEmptyLeadField(L.title)) {
      ds.title = String(L.title).trim();
    }
    assignRowDatasetFieldIfBetter(ds, 'phone', L.phone);
    if (L.phoneLineType != null) ds.phoneLineType = String(L.phoneLineType || '').trim().toLowerCase();
    if (L.phoneCarrier != null) ds.phoneCarrier = String(L.phoneCarrier || '').trim();
    if (L.phoneLineTypeCheckedAt != null) {
      ds.phoneLineTypeCheckedAt = String(L.phoneLineTypeCheckedAt || '').trim();
    }
    assignRowDatasetFieldIfBetter(ds, 'website', L.website);
    assignRowDatasetFieldIfBetter(ds, 'email', L.email);
    assignRowDatasetFieldIfBetter(ds, 'address', L.address);
    if (L.city != null && !isEmptyLeadField(L.city)) ds.city = String(L.city).trim();
    if (L.state != null && !isEmptyLeadField(L.state)) ds.state = String(L.state).trim();
    if (L.categoryName != null && !isEmptyLeadField(L.categoryName)) {
      ds.category = String(L.categoryName).trim();
    }
    assignRowDatasetFieldIfBetter(ds, 'url', L.url);
    assignRowDatasetFieldIfBetter(ds, 'facebook', L.facebook);
    assignRowDatasetFieldIfBetter(ds, 'instagram', L.instagram);
    assignRowDatasetFieldIfBetter(ds, 'twitter', L.twitter);
    assignRowDatasetFieldIfBetter(ds, 'linkedin', L.linkedin);
    assignRowDatasetFieldIfBetter(ds, 'tiktok', L.tiktok);
    assignRowDatasetScoreIfBetter(ds, L.totalScore, L.reviewsCount);
    if (L.reviewSnippets != null) {
      ds.reviewSnippets = Array.isArray(L.reviewSnippets)
        ? JSON.stringify(L.reviewSnippets)
        : String(L.reviewSnippets || '[]');
    }
    if (L.reviewIntel != null) {
      try {
        ds.reviewIntel =
          typeof L.reviewIntel === 'string' ? L.reviewIntel : JSON.stringify(L.reviewIntel);
      } catch {
        ds.reviewIntel = '';
      }
    }
    if (L.totalScore != null || L.reviewsCount != null) {
      syncRowReviewsDisplay(row);
    }
    if (L.status != null) ds.status = L.status;
    if (L.lastDisposition != null) ds.lastDisposition = String(L.lastDisposition || '').trim().toLowerCase();
    if (L.lastDispositionNotes != null) ds.lastDispositionNotes = String(L.lastDispositionNotes || '');
    if (L.lastDisposition != null || L.status != null) syncLeadTouchPill(row);
    if (L.hasSchemaMarkup !== undefined && L.hasSchemaMarkup !== null) ds.hasSchemaMarkup = L.hasSchemaMarkup;
    if (L.hasChatbot !== undefined && L.hasChatbot !== null) ds.hasChatbot = L.hasChatbot;
    if (L.hasClickToCall !== undefined && L.hasClickToCall !== null) ds.hasClickToCall = L.hasClickToCall;
    if (L.isMobileFriendly !== undefined && L.isMobileFriendly !== null) ds.isMobileFriendly = L.isMobileFriendly;
    if (L.isOutdated !== undefined && L.isOutdated !== null) ds.isOutdated = L.isOutdated;
    if (L.visualModernityScore != null) ds.visualModernityScore = L.visualModernityScore;
    if (L.aeoScore != null) ds.aeoScore = L.aeoScore;
    if (L.geoGaps != null) ds.geoGaps = L.geoGaps;
    if (L.auditSummary != null) ds.auditSummary = L.auditSummary;
    if (L.cmsPlatform != null) ds.cmsPlatform = L.cmsPlatform;
    if (L.techStackTags != null) {
      try {
        ds.techStackTags = JSON.stringify(Array.isArray(L.techStackTags) ? L.techStackTags : []);
      } catch {
        ds.techStackTags = '[]';
      }
    }
    if (L.builtWithUrl != null) ds.builtWithUrl = String(L.builtWithUrl || '');
    if (L.competitorName != null) ds.competitorName = L.competitorName;
    if (L.competitorGap != null) ds.competitorGap = L.competitorGap;
    if (L.competitorMetaBenchmark != null) ds.competitorMetaBenchmark = L.competitorMetaBenchmark;
    if (Array.isArray(L.updates)) {
      applyServerUpdatesToRow(row, L.updates);
      const embedded = findInitialSavedLeadRecord(row);
      if (embedded) embedded.updates = readRowUpdatesArray(row).slice();
    }
    if (L.cqi !== undefined) ds.cqi = L.cqi == null ? 'null' : JSON.stringify(L.cqi);
    if (L.ownerFirstName != null) ds.ownerFirstName = String(L.ownerFirstName || '');
    if (L.permitContractor != null && String(L.permitContractor || '').trim()) {
      ds.permitContractor = String(L.permitContractor).trim();
    } else if (L.company != null && String(L.company || '').trim()) {
      ds.permitContractor = String(L.company).trim();
    }
    if (L.contactName != null) ds.permitOwner = String(L.contactName || '').trim();
    if (L.doNotCall !== undefined) ds.doNotCall = L.doNotCall ? '1' : '';
    if (L.primaryServiceKey !== undefined) {
      ds.primaryServiceKey = L.primaryServiceKey ? String(L.primaryServiceKey).trim() : '';
    }
    if (L.contacts != null) {
      try {
        ds.contacts = JSON.stringify(Array.isArray(L.contacts) ? L.contacts : []);
      } catch {
        ds.contacts = '[]';
      }
      coalesceRowDatasetFromContacts(row);
    }
    if (L.logs != null) {
      try {
        const snippet = (L.logs || []).slice(-14);
        ds.logsSnippet = JSON.stringify(snippet);
        const embedded = findInitialSavedLeadRecord(row);
        if (embedded) embedded.logs = snippet.slice();
      } catch {
        ds.logsSnippet = '[]';
      }
    }
    if (L.leadLocations != null) {
      try {
        const locs = Array.isArray(L.leadLocations) ? L.leadLocations : [];
        ds.leadLocations = JSON.stringify(locs);
        const embedded = findInitialSavedLeadRecord(row);
        if (embedded) embedded.leadLocations = locs.slice();
      } catch {
        ds.leadLocations = '[]';
      }
    }
    if (L.alternateTitles != null) {
      try {
        const alts = Array.isArray(L.alternateTitles) ? L.alternateTitles : [];
        ds.alternateTitles = JSON.stringify(alts);
        const embedded = findInitialSavedLeadRecord(row);
        if (embedded) embedded.alternateTitles = alts.slice();
      } catch {
        ds.alternateTitles = '[]';
      }
    }
    if (L.sequenceState !== undefined) {
      try {
        ds.sequenceState =
          L.sequenceState == null ? 'null' : JSON.stringify(L.sequenceState);
      } catch {
        ds.sequenceState = 'null';
      }
    }
    if (L.lastTouchChannel != null) {
      ds.lastTouchChannel = String(L.lastTouchChannel || '').trim();
    }
    if (L.engagementSignalType != null) {
      ds.engagementSignal = String(L.engagementSignalType || '').trim();
    }
    if (L.engagementSignalAt != null) {
      ds.engagementSignalAt = String(L.engagementSignalAt || '').trim();
    }
    if (L.engagementSignals && typeof L.engagementSignals === 'object') {
      if (L.engagementSignals.lastSignalType) {
        ds.engagementSignal = String(L.engagementSignals.lastSignalType || '').trim();
      }
      if (L.engagementSignals.lastSignalAt) {
        ds.engagementSignalAt = String(L.engagementSignals.lastSignalAt || '').trim();
        const ms = Date.parse(ds.engagementSignalAt);
        ds.engagementSignalMs = Number.isFinite(ms) ? String(ms) : '0';
      }
    }
    if (L.engagementSignalAt != null && !ds.engagementSignalMs) {
      const ms = Date.parse(String(L.engagementSignalAt || '').trim());
      ds.engagementSignalMs = Number.isFinite(ms) ? String(ms) : '0';
    }
    if (L.lastContactHuntAt != null) {
      ds.lastContactHuntAt = String(L.lastContactHuntAt || '').trim();
    }
    if (L.outreachPrompt != null) ds.outreachPrompt = String(L.outreachPrompt || '');
    if (L.latitude != null && L.latitude !== '') ds.latitude = String(L.latitude);
    if (L.longitude != null && L.longitude !== '') ds.longitude = String(L.longitude);
    if (L.pageSpeedAudit != null) {
      try {
        ds.pageSpeedAudit =
          typeof L.pageSpeedAudit === 'object'
            ? JSON.stringify(L.pageSpeedAudit)
            : String(L.pageSpeedAudit || '');
      } catch {
        ds.pageSpeedAudit = '';
      }
    }
    if (L.pageSpeedAuditAt != null) ds.pageSpeedAuditAt = String(L.pageSpeedAuditAt || '');
    if (L.ownerSignal != null) ds.ownerSignal = String(L.ownerSignal || '');
    if (L.geoSeoGhlAudit != null) {
      try {
        ds.geoSeoGhlAudit =
          typeof L.geoSeoGhlAudit === 'object'
            ? JSON.stringify(L.geoSeoGhlAudit)
            : String(L.geoSeoGhlAudit || '');
      } catch {
        ds.geoSeoGhlAudit = '';
      }
    }
    if (L.geoSeoGhlAuditAt != null) ds.geoSeoGhlAuditAt = String(L.geoSeoGhlAuditAt || '');
    if (L.primaryServiceKey != null) {
      ds.primaryServiceKey = L.primaryServiceKey ? String(L.primaryServiceKey).trim() : '';
    }
    if (L.onPipelineBoard !== undefined) {
      ds.onPipelineBoard = L.onPipelineBoard ? '1' : '';
    }
    if (L.stageId || L.pipelineStage != null) {
      if (typeof window.__applyLeadPipelineStageFromApi === 'function') {
        window.__applyLeadPipelineStageFromApi(L, { row: row });
      } else {
        if (L.stageId) ds.stageId = String(L.stageId);
        if (L.pipelineStage != null) ds.pipelineStage = String(L.pipelineStage);
        if (L.pipelineLabel) ds.pipelineLabel = String(L.pipelineLabel);
      }
    }
    if (L.bookmarked !== undefined) {
      const bookmarkBtn = row.querySelector && row.querySelector('.bookmark-btn');
      const clientOwnsBookmark =
        ds.bookmarkClient === '1' ||
        (bookmarkBtn && bookmarkBtn.dataset.bookmarkBusy === '1');
      if (!clientOwnsBookmark) {
        ds.bookmarked = L.bookmarked ? '1' : '0';
        if (bookmarkBtn) {
          if (L.bookmarked) markBookmarkSaved(bookmarkBtn);
          else markBookmarkUnsaved(bookmarkBtn);
        }
        const embedded = findInitialSavedLeadRecord(row);
        if (embedded) embedded.bookmarked = !!L.bookmarked;
      }
    }
    coalesceRowDatasetFromContacts(row);
    hydrateRowDatasetFromTableDom(row);
    syncPhoneLineTypePill(row);
  }
  window.syncPersistedLeadToRowDataset = syncPersistedLeadToRowDataset;

  function parsePageSpeedAuditFromRow(row) {
    if (!row || !row.dataset) return null;
    try {
      const raw = row.dataset.pageSpeedAudit;
      if (!raw || raw === 'null' || raw === '') return null;
      const o = JSON.parse(raw);
      return o && typeof o === 'object' ? o : null;
    } catch {
      return null;
    }
  }

  function parseGeoSeoGhlAuditFromRow(row) {
    if (!row || !row.dataset) return null;
    try {
      const raw = row.dataset.geoSeoGhlAudit;
      if (!raw || raw === 'null' || raw === '') return null;
      const o = JSON.parse(raw);
      return o && typeof o === 'object' ? o : null;
    } catch {
      return null;
    }
  }

  function renderGeoSeoGhlAuditInto(container, r) {
    if (!container || !r) return;
    const score = parseInt(r.overallScore, 10) || 0;
    let scoreColor = 'text-rose-500';
    if (score >= 85) scoreColor = 'text-emerald-500';
    else if (score >= 70) scoreColor = 'text-sky-500';
    else if (score >= 55) scoreColor = 'text-amber-500';

    const gapsHtml = (Array.isArray(r.gaps) ? r.gaps : [])
      .slice(0, 6)
      .map((g) => {
        const sev = String(g.severity || 'medium').toLowerCase();
        const sevClass =
          sev === 'high'
            ? 'text-rose-600 dark:text-rose-400'
            : sev === 'low'
              ? 'text-brand-muted'
              : 'text-amber-600 dark:text-amber-400';
        return `<li class="mb-2 last:mb-0"><span class="text-[9px] font-black uppercase tracking-widest ${sevClass}">${escapeHtmlText(g.area || 'Gap')} · ${escapeHtmlText(sev)}</span><p class="text-[11px] font-semibold text-brand-dark dark:text-slate-200 mt-0.5">${escapeHtmlText(g.finding || '')}</p><p class="text-[10px] text-brand-muted dark:text-slate-400">${escapeHtmlText(g.impact || '')}</p></li>`;
      })
      .join('');

    const ghlHtml = (Array.isArray(r.ghlRecommendations) ? r.ghlRecommendations : [])
      .slice(0, 6)
      .sort((a, b) => (parseInt(a.priority, 10) || 99) - (parseInt(b.priority, 10) || 99))
      .map(
        (t) =>
          `<li class="rounded-xl border border-brand-border/20 dark:border-white/10 bg-white/80 dark:bg-slate-900/40 p-3 mb-2 last:mb-0"><div class="flex items-start justify-between gap-2"><p class="text-[11px] font-black text-brand-dark dark:text-white">${escapeHtmlText(t.toolName || 'GHL tool')}</p><span class="text-[9px] font-black uppercase tracking-widest text-brand-yellow shrink-0">P${escapeHtmlText(String(t.priority || ''))}</span></div><p class="text-[10px] text-brand-muted dark:text-slate-400 mt-1">${escapeHtmlText(t.why || '')}</p><p class="text-[11px] font-semibold text-brand-dark dark:text-slate-200 mt-1.5 leading-relaxed">${escapeHtmlText(t.whatToSell || '')}</p></li>`,
      )
      .join('');

    const winsHtml = (Array.isArray(r.quickWins) ? r.quickWins : [])
      .slice(0, 5)
      .map((w) => `<li class="text-[11px] text-brand-muted dark:text-slate-400 leading-relaxed">${escapeHtmlText(w)}</li>`)
      .join('');

    const planHtml = (Array.isArray(r.thirtyDayPlan) ? r.thirtyDayPlan : [])
      .slice(0, 4)
      .map(
        (p) =>
          `<li class="text-[11px] text-brand-muted dark:text-slate-400"><span class="font-black text-brand-dark dark:text-white">Wk ${escapeHtmlText(String(p.week || ''))}:</span> ${escapeHtmlText(p.action || '')} <span class="text-brand-yellow">→ ${escapeHtmlText(p.ghlTool || '')}</span></li>`,
      )
      .join('');

    const offer = r.agencyOffer && typeof r.agencyOffer === 'object' ? r.agencyOffer : {};
    const modelNote = r.model
      ? `Model: ${escapeHtmlText(r.model)}${r.aiUnavailable ? ' (heuristic fallback)' : ''}`
      : r.source === 'heuristic'
        ? 'Heuristic report (AI unavailable)'
        : '';

    container.innerHTML = `<div class="rounded-[1.75rem] border border-brand-border/25 dark:border-white/10 bg-brand-cream/20 dark:bg-slate-800/30 p-4 sm:p-5 space-y-4"><div class="flex items-start justify-between gap-3"><div><p class="text-[9px] font-black uppercase tracking-widest text-brand-muted mb-1">GEO / SEO audit</p><p class="text-[28px] font-black leading-none ${scoreColor}">${score}<span class="text-sm font-bold text-brand-muted dark:text-slate-500">/100</span></p><p class="text-[10px] font-bold text-brand-muted mt-1">GEO ${parseInt(r.geoSeoScore, 10) || '—'} · Conversion ${parseInt(r.conversionScore, 10) || '—'}</p></div><span class="inline-block px-3 py-1 rounded-full text-[13px] font-black ${score >= 70 ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : score >= 55 ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'}">${escapeHtmlText(r.grade || '—')}</span></div><p class="text-[12px] font-semibold text-brand-dark dark:text-slate-200 leading-relaxed">${escapeHtmlText(r.headline || '')}</p><div><p class="text-[9px] font-black uppercase tracking-widest text-brand-muted mb-2">Gaps to fix</p><ul class="list-none m-0 p-0">${gapsHtml}</ul></div><div class="rounded-xl border border-brand-yellow/30 bg-brand-yellow/5 dark:bg-brand-yellow/10 px-3 py-3"><p class="text-[9px] font-black uppercase tracking-widest text-brand-yellow mb-1">Sell first (agency)</p><p class="text-[12px] font-black text-brand-dark dark:text-white">${escapeHtmlText(offer.primaryServiceLabel || '')}</p><p class="text-[11px] text-brand-muted dark:text-slate-400 mt-1 leading-relaxed">${escapeHtmlText(offer.rationale || '')}</p><p class="text-[11px] font-semibold text-brand-dark dark:text-slate-200 mt-2 italic">"${escapeHtmlText(offer.talkTrack || '')}"</p></div><div><p class="text-[9px] font-black uppercase tracking-widest text-brand-muted mb-2">GoHighLevel tools to implement</p><ul class="list-none m-0 p-0">${ghlHtml}</ul></div><div><p class="text-[9px] font-black uppercase tracking-widest text-brand-muted mb-1">Quick wins</p><ul class="space-y-0.5 ml-0.5">${winsHtml}</ul></div><div><p class="text-[9px] font-black uppercase tracking-widest text-brand-muted mb-1">30-day rollout</p><ul class="space-y-1">${planHtml}</ul></div>${modelNote ? `<p class="text-[9px] text-brand-muted/80 dark:text-slate-500">${modelNote}</p>` : ''}</div>`;
  }

  function syncGeoSeoGhlAuditPanel(row) {
    const el = document.getElementById('geoSeoGhlAuditResult');
    if (!el) return;
    const report = row ? parseGeoSeoGhlAuditFromRow(row) : null;
    if (!report) {
      el.classList.add('hidden');
      el.innerHTML = '';
      return;
    }
    renderGeoSeoGhlAuditInto(el, report);
    el.classList.remove('hidden');
    const body = document.getElementById('pageSpeedAuditPanelBody');
    if (body) body.classList.remove('hidden');
  }

  async function runGeoSeoGhlAuditForRow(row, opts) {
    if (!row) throw new Error('No lead selected.');
    setGeoSeoGhlAuditLoading(true, 'Generating GEO/SEO + GHL sell report…');
    await ensureRowHasLeadKey(row);
    const key = String(row.dataset.leadKey || '').trim();
    const website = resolveRowWebsiteForAudit(row);
    if (!website) throw new Error('Add a website URL to this lead first.');
    try {
      const { res, data } = await fetchJsonWithTimeout(
        `/leads/${encodeURIComponent(key)}/geo-seo-ghl-audit`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ website, refresh: !!(opts && opts.refresh) }),
        },
        90000,
      );
      if (!res.ok || !data.success) {
        throw new Error((data && data.error) || 'GEO/SEO audit failed');
      }
      if (data.lead) syncPersistedLeadToRowDataset(row, data.lead);
      else if (data.report) {
        row.dataset.geoSeoGhlAudit = JSON.stringify(data.report);
        row.dataset.geoSeoGhlAuditAt = data.report.generatedAt || new Date().toISOString();
      }
      if (data.report) {
        setGeoSeoGhlAuditLoading(false);
        const errEl = document.getElementById('geoSeoGhlAuditError');
        if (errEl) errEl.classList.add('hidden');
        renderGeoSeoGhlAuditInto(document.getElementById('geoSeoGhlAuditResult'), data.report);
        const resultEl = document.getElementById('geoSeoGhlAuditResult');
        if (resultEl) resultEl.classList.remove('hidden');
        const body = document.getElementById('pageSpeedAuditPanelBody');
        if (body) body.classList.remove('hidden');
      }
      if (data.report && data.report.agencyOffer && data.report.agencyOffer.primaryServiceKey) {
        row.dataset.primaryServiceKey = String(data.report.agencyOffer.primaryServiceKey);
        if (typeof window.__renderLeadTagsPanel === 'function') {
          window.__renderLeadTagsPanel(row);
        }
      }
      return data;
    } catch (err) {
      setGeoSeoGhlAuditLoading(false);
      throw err;
    }
  }

  function resolveRowWebsiteForAudit(row) {
    if (!row) return '';
    const href = resolveLeadPanelWebsiteHref(row);
    if (href) return href.replace(/\/$/, '');
    if (row === currentRow) {
      const panelLink = document.getElementById('mobilePanelWebsiteLink');
      const fromPanel = panelLink && panelLink.getAttribute('href');
      const p = String(fromPanel || '').trim();
      if (p && p !== 'N/A' && p !== 'Website' && !/^#$/i.test(p)) {
        return normalizeWebsiteHref(p).replace(/\/$/, '');
      }
    }
    return '';
  }

  function scoreColorClass(score) {
    if (score == null || !Number.isFinite(Number(score))) return 'text-brand-dark dark:text-white';
    const n = Number(score);
    if (n >= 90) return 'text-emerald-600 dark:text-emerald-400';
    if (n >= 50) return 'text-amber-600 dark:text-amber-400';
    return 'text-rose-600 dark:text-rose-400';
  }

  let pageSpeedAuditInFlight = false;
  window.__pageSpeedAuditLeadKey = window.__pageSpeedAuditLeadKey || '';
  window.__pageSpeedAuditLeadTitle = window.__pageSpeedAuditLeadTitle || '';
  /** Single scoped panel job — hunt or audit runs for one lead key only. */
  window.__leadPanelJob = window.__leadPanelJob || null;

  /** Stable identity for panel hunt/audit scoping (lead key or title fallback). */
  function leadPanelRowKey(row) {
    if (!row || !row.dataset) return '';
    let k = String(row.dataset.leadKey || '').trim();
    if (k) return k.replace(/^lead:/i, '');
    const tk = normalizeLeadTitleKey(row.dataset.title || '');
    return tk ? `title:${tk}` : '';
  }
  window.__leadPanelRowKey = leadPanelRowKey;

  function beginLeadPanelJob(kind, row) {
    if (!row) return;
    const key = leadPanelRowKey(row);
    if (!key) return;
    const title = String(row.dataset.title || 'Lead').trim() || 'Lead';
    window.__leadPanelJob = { kind: kind === 'audit' ? 'audit' : 'hunt', key, title };
    if (kind === 'audit') {
      window.__pageSpeedAuditLeadKey = key;
      window.__pageSpeedAuditLeadTitle = title;
    } else {
      window.__panelHuntLeadKey = key;
      window.__panelHuntLeadTitle = title;
    }
  }

  function clearLeadPanelJob(kind, row) {
    const job = window.__leadPanelJob;
    const rowKey = row ? leadPanelRowKey(row) : '';
    if (job && job.kind === (kind === 'audit' ? 'audit' : 'hunt')) {
      if (!rowKey || job.key === rowKey) window.__leadPanelJob = null;
    }
    if (kind === 'audit') clearPanelAuditLead(rowKey);
    else clearPanelHuntLeadKey(rowKey);
  }

  function leadPanelJobOnOtherRow(row) {
    const job = window.__leadPanelJob;
    if (!job || !row) return null;
    const viewKey = leadPanelRowKey(row);
    if (!viewKey || job.key === viewKey) return null;
    return job;
  }

  function coerceLeadPanelButtonsForView(row) {
    if (!row) return;
    const viewKey = leadPanelRowKey(row);
    const job = window.__leadPanelJob;
    const huntBtn = document.getElementById('deepEnhanceBtn');
    const auditBtn = document.getElementById('pageSpeedAuditRunBtn');

    const huntActiveForView =
      job &&
      job.kind === 'hunt' &&
      job.key === viewKey &&
      window.__contactHuntInFlight &&
      window.__contactHuntInFlight.has(viewKey);
    const auditActiveForView = job && job.kind === 'audit' && job.key === viewKey && pageSpeedAuditInFlight;

    if (huntBtn && !huntActiveForView && huntBtn.dataset.huntState === 'active') {
      stopHuntProgressTickerGlobal();
      setDeepEnhanceHuntUi('idle');
    }
    if (auditBtn && !auditActiveForView && auditBtn.dataset.auditState === 'active') {
      stopPageSpeedAuditProgressTicker();
      setPageSpeedAuditUi('idle');
    }
  }
  window.__coerceLeadPanelButtonsForView = coerceLeadPanelButtonsForView;

  function rowLeadKeyForPanel(row) {
    return leadPanelRowKey(row);
  }

  function isPanelAuditActiveForRow(row) {
    if (!pageSpeedAuditInFlight) return false;
    const job = window.__leadPanelJob;
    if (!job || job.kind !== 'audit') return false;
    return job.key === leadPanelRowKey(row);
  }

  function isAuditRunningOnAnotherPanelLead(row) {
    if (!pageSpeedAuditInFlight) return false;
    const other = leadPanelJobOnOtherRow(row);
    return !!(other && other.kind === 'audit');
  }

  function setPanelAuditLead(row) {
    window.__pageSpeedAuditLeadKey = rowLeadKeyForPanel(row);
    window.__pageSpeedAuditLeadTitle = String((row && row.dataset && row.dataset.title) || 'Lead').trim() || 'Lead';
  }

  function clearPanelAuditLead(key) {
    const k = String(key || '').trim();
    const auditKey = String(window.__pageSpeedAuditLeadKey || '').trim();
    if (!auditKey || !k || auditKey === k) {
      window.__pageSpeedAuditLeadKey = '';
      window.__pageSpeedAuditLeadTitle = '';
    }
  }

  function pageSpeedAuditButtonLabel(hasAudit, running) {
    if (running) return 'Running audit…';
    if (hasAudit) return 'Re-run website audit';
    return 'Run website audit';
  }

  function highlightLeadPanelSectionNav(activeBtn) {
    document.querySelectorAll('.lead-panel-section-link[data-scroll-target]').forEach((b) => {
      b.classList.remove(
        'border-brand-yellow',
        'bg-brand-yellow/15',
        'text-brand-dark',
        'dark:text-brand-yellow',
      );
    });
    if (activeBtn) {
      activeBtn.classList.add(
        'border-brand-yellow',
        'bg-brand-yellow/15',
        'text-brand-dark',
        'dark:text-brand-yellow',
      );
    }
  }

  function scrollLeadPanelToSection(sectionId) {
    const scrollEl = document.getElementById('leadPanelTabScroll');
    if (!scrollEl || !sectionId) return;

    let target = document.getElementById(sectionId);
    if (!target || !scrollEl.contains(target)) return;

    if (sectionId === 'leadCadencePlaybookHeading') {
      openLeadPanelCadencePlaybook();
    }

    if (sectionId === 'leadPanelAiToolsSection') {
      openLeadPanelAiTools();
    }

    if (sectionId === 'leadPanelEmailReportSection' && target.classList.contains('hidden')) {
      if (typeof window.showAppToast === 'function') {
        window.showAppToast('Run website audit first to unlock share links.', { variant: 'info' });
      }
      const auditSection = document.getElementById('pageSpeedAuditSection');
      if (auditSection && scrollEl.contains(auditSection)) {
        target = auditSection;
      }
    }

    const runScroll = () => {
      const scrollRect = scrollEl.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const nav = document.getElementById('leadPanelSectionNav');
      let navOffset = 0;
      if (nav) {
        if (scrollEl.contains(nav)) {
          const navRect = nav.getBoundingClientRect();
          if (navRect.top >= scrollRect.top - 4 && navRect.top < scrollRect.bottom) {
            navOffset = navRect.height + 8;
          }
        } else {
          navOffset = 6;
        }
      }
      const delta = targetRect.top - scrollRect.top - navOffset;
      scrollEl.scrollTo({
        top: Math.max(0, scrollEl.scrollTop + delta),
        behavior: 'smooth',
      });
    };

    requestAnimationFrame(() => requestAnimationFrame(runScroll));
    if (sectionId === 'leadPanelCallerGlance') {
      setTimeout(() => {
        const row = resolveActiveLeadRow();
        if (row) syncLeadPanelWideMapAndGoogleChip(row);
      }, 250);
    }
  }

  function bindLeadPanelContactDetailsToggle() {
    if (window.__adhelloLeadPanelContactToggleBound) return;
    window.__adhelloLeadPanelContactToggleBound = true;

    const toggle = () => {
      const body = document.getElementById('leadPanelContactDetailsBody');
      const btn = document.getElementById('leadPanelContactDetailsToggle');
      if (!body || !btn) return false;
      const open = body.classList.contains('hidden');
      body.classList.toggle('hidden', !open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      return open;
    };

    window.__openLeadPanelContactDetails = () => {
      const body = document.getElementById('leadPanelContactDetailsBody');
      const btn = document.getElementById('leadPanelContactDetailsToggle');
      if (!body || !btn || !body.classList.contains('hidden')) return;
      body.classList.remove('hidden');
      btn.setAttribute('aria-expanded', 'true');
    };

    document.addEventListener('click', (ev) => {
      const btn = ev.target.closest('#leadPanelContactDetailsToggle');
      if (!btn) return;
      ev.preventDefault();
      ev.stopPropagation();
      toggle();
    });
  }

  function bindLeadPanelSectionNav() {
    if (window.__adhelloLeadPanelSectionNavBound) return;
    window.__adhelloLeadPanelSectionNavBound = true;
    document.addEventListener(
      'click',
      (ev) => {
        const panel = getLeadDetailPanel();
        if (!panel || !panel.classList.contains('open')) return;
        const btn = ev.target.closest('.lead-panel-section-link[data-scroll-target]');
        if (!btn || !panel.contains(btn)) return;
        ev.preventDefault();
        ev.stopPropagation();
        const targetId = btn.getAttribute('data-scroll-target');
        if (!targetId) return;
        scrollLeadPanelToSection(targetId);
        highlightLeadPanelSectionNav(btn);
      },
      true,
    );
  }

  function resolveActiveLeadRow() {
    if (currentRow) return currentRow;
    const selected = document.querySelector('.result-row.selected');
    if (selected) {
      currentRow = selected;
      return selected;
    }
    return null;
  }
  window.__resolveActiveLeadRow = resolveActiveLeadRow;
  window.__adhelloSetCurrentLeadRow = function (row) {
    currentRow = row;
  };

  /** Row for hunt/audit/save — table TR when visible, else panel host or current selection. */
  function resolveRowForLeadPanelActions(row) {
    const active = row || resolveActiveLeadRow();
    if (!active) return null;
    return resolvePipelineTableRowForPanel(active) || active;
  }
  window.__resolveRowForLeadPanelActions = resolveRowForLeadPanelActions;

  /** Active pipeline row for panel outreach (hunt, SMS, GHL push). Sets currentRow. */
  function resolvePanelActionRow() {
    let row = resolveRowForLeadPanelActions(currentRow);
    if (!row) row = resolveActiveLeadRow();
    if (row) currentRow = row;
    return row;
  }
  window.__resolvePanelActionRow = resolvePanelActionRow;

  function rowDatasetHasUsablePhone(row) {
    const p = row && row.dataset ? String(row.dataset.phone || '').trim() : '';
    return p.length > 0 && p !== 'N/A' && /\d/.test(p);
  }

  function rowDatasetHasUsableEmail(row) {
    const e = row && row.dataset ? String(row.dataset.email || '').trim() : '';
    return e.length > 0 && e !== 'N/A' && e.includes('@');
  }

  function rowDatasetMissingWebsite(row) {
    const w = row && row.dataset ? String(row.dataset.website || '').trim() : '';
    return !(w && w !== 'N/A' && w !== '—');
  }

  function getGhlContactsUrl() {
    const fromWindow =
      typeof window !== 'undefined' && window.GHL_DASHBOARD_URL
        ? String(window.GHL_DASHBOARD_URL).trim()
        : '';
    return fromWindow || 'https://my.adhello.ai/';
  }

  function websiteBuildSlugFromTitle(title) {
    const s = String(title || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48);
    return s || 'site';
  }

  function websiteBuildPublicUrlForRow(row) {
    const stored = row && row.dataset ? String(row.dataset.websiteBuildUrl || '').trim() : '';
    if (/^https?:\/\//i.test(stored)) return stored;
    const title = row && row.dataset ? String(row.dataset.title || '').trim() : '';
    return 'https://' + websiteBuildSlugFromTitle(title) + '.my.adhello.ai';
  }

  function syncHeaderWebsiteBuildRow(row) {
    const link = document.getElementById('leadPanelWebsiteBuildLink');
    if (!link) return;
    const url = websiteBuildPublicUrlForRow(row);
    link.href = url;
    try {
      link.textContent = new URL(url).hostname.replace(/^www\./i, '');
    } catch (_) {
      link.textContent = url.replace(/^https?:\/\//i, '');
    }
    if (row && row.dataset) row.dataset.websiteBuildUrl = url;
  }

  document.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest && e.target.closest('#leadPanelWebsiteBuildCopyBtn');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const link = document.getElementById('leadPanelWebsiteBuildLink');
    const url = (link && link.href) || websiteBuildPublicUrlForRow(resolvePanelActionRow());
    if (!url || url === '#' || url.endsWith('/#')) return;
    if (typeof copyTextToClipboard === 'function') {
      copyTextToClipboard(url).then(() => {
        if (typeof window.showProspectToast === 'function') {
          window.showProspectToast('Website build link copied');
        }
      });
    }
  });

  function syncLeadPanelOutreachIntelButtons(row) {
    const phone = rowDatasetHasUsablePhone(row);
    const callBtn = document.getElementById('clickToCallBtn');
    const smsBtn = document.getElementById('leadPanelSmsBtn');
    const ghlBtn = document.getElementById('leadPanelPushGhlBtn');
    const setBtn = (btn, enabled, titleOn, titleOff) => {
      if (!btn) return;
      btn.removeAttribute('disabled');
      btn.setAttribute('aria-disabled', enabled ? 'false' : 'true');
      btn.classList.toggle('opacity-40', !enabled);
      btn.classList.toggle('cursor-not-allowed', !enabled);
      btn.setAttribute('title', enabled ? titleOn : titleOff);
    };
    setBtn(callBtn, phone, 'Call this lead', 'Add a phone number first');
    setBtn(
      smsBtn,
      phone,
      'Open SMS composer — type your message, improve with AI, then send',
      'Add a phone number first',
    );
    setBtn(ghlBtn, !!row, 'Sync to Go High Level for SMS, email, and voicemail', 'Select a lead first');
  }
  window.__syncLeadPanelOutreachIntelButtons = syncLeadPanelOutreachIntelButtons;

  function withTimeout(promise, ms, message) {
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(message || 'Request timed out. Try again.'));
      }, ms);
    });
    return Promise.race([promise, timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  async function fetchJsonWithTimeout(url, options, ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(url, { ...(options || {}), signal: ctrl.signal });
      const data = await res.json().catch(() => ({}));
      return { res, data };
    } catch (err) {
      if (err && err.name === 'AbortError') {
        throw new Error('Request timed out. Try again.');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async function ensureRowHasLeadKey(row) {
    if (!row) throw new Error('Select a lead first.');
    let key = syncRowLeadKeyFromSavedMap(row);
    if (!key && typeof findInitialSavedLeadRecord === 'function') {
      const embedded = findInitialSavedLeadRecord(row);
      const embeddedKey = embedded && embedded.key ? String(embedded.key).trim() : '';
      if (embeddedKey) {
        row.dataset.leadKey = embeddedKey;
        key = embeddedKey;
      }
    }
    if (key) return normalizeLeadKeyForApi(key);

    if (typeof window.showAppToast === 'function') {
      window.showAppToast('Saving lead first…', { variant: 'info' });
    } else if (typeof window.showProspectToast === 'function') {
      window.showProspectToast('Saving lead first…');
    }

    const saver =
      typeof window.__saveSearchResultLead === 'function'
        ? window.__saveSearchResultLead
        : typeof saveLead === 'function'
          ? saveLead
          : null;
    if (!saver) {
      throw new Error('Save is not ready yet. Refresh the page and try again.');
    }

    const ok = await withTimeout(
      saver(row, { silent: true }),
      25000,
      'Saving this lead timed out. Check your connection and try again.',
    );
    if (!ok) {
      throw new Error(
        'Could not save this lead. On search results, pick a folder in the bar at the bottom first, then try again.',
      );
    }
    key = syncRowLeadKeyFromSavedMap(row);
    if (!key) throw new Error('Could not save this lead.');
    return normalizeLeadKeyForApi(key);
  }
  window.__ensureRowHasLeadKey = ensureRowHasLeadKey;

  function showLeadPanelAuditReportLinks(bundle) {
    const wrap = document.getElementById('leadPanelAuditReportLinks');
    const hosted = document.getElementById('leadPanelHostedAuditUrl');
    if (!wrap) return;
    wrap.classList.remove('hidden');
    const reportUrl = bundle && bundle.reportUrl ? String(bundle.reportUrl).trim() : '';
    if (!reportUrl) return;
    if (hosted) {
      hosted.href = reportUrl;
      hosted.classList.remove('hidden', 'pointer-events-none', 'opacity-40');
    }
  }

  function showLeadPanelAiToolsClientLink(bundle) {
    const wrap = document.getElementById('leadPanelAuditReportLinks');
    const link = document.getElementById('leadPanelAiToolsClientUrl');
    if (!link) return;
    const reportUrl = bundle && bundle.reportUrl ? String(bundle.reportUrl).trim() : '';
    if (!reportUrl) return;
    if (wrap) wrap.classList.remove('hidden');
    link.href = reportUrl;
    link.classList.remove('hidden', 'pointer-events-none', 'opacity-40');
  }

  function setPageSpeedAuditButtonLabel(runBtn, label) {
    if (!runBtn) return;
    const labelEl = document.getElementById('pageSpeedAuditBtnLabel');
    if (labelEl) labelEl.textContent = label;
    else runBtn.textContent = label;
  }

  function setGeoSeoGhlAuditLoading(running, label) {
    const el = document.getElementById('geoSeoGhlAuditLoading');
    const labelEl = document.getElementById('geoSeoGhlAuditLoadingLabel');
    const resultEl = document.getElementById('geoSeoGhlAuditResult');
    const body = document.getElementById('pageSpeedAuditPanelBody');
    if (el) {
      el.classList.toggle('hidden', !running);
      el.setAttribute('aria-busy', running ? 'true' : 'false');
    }
    if (labelEl && label) labelEl.textContent = String(label);
    if (running) {
      if (resultEl) resultEl.classList.add('hidden');
      if (body) body.classList.remove('hidden');
      try {
        el && el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } catch (_) {}
    }
    syncPageSpeedAuditPanelBodyVisibility();
  }

  function updatePageSpeedAuditProgress(pct, statusLabel, detail, stepTitle) {
    const bar = document.getElementById('pageSpeedAuditProgressBar');
    const status = document.getElementById('pageSpeedAuditStatusLabel');
    const detailEl = document.getElementById('pageSpeedAuditLoadingLabel');
    const stepEl = document.getElementById('pageSpeedAuditStepTitle');
    if (bar && pct != null) {
      const clamped = Math.max(6, Math.min(100, Number(pct) || 0));
      bar.style.width = `${clamped}%`;
    }
    if (status && statusLabel) status.textContent = String(statusLabel);
    if (detailEl && detail) detailEl.textContent = String(detail);
    if (stepEl && stepTitle) stepEl.textContent = String(stepTitle);
  }

  const AUDIT_PROGRESS_PHASES = [
    { afterMs: 0, pct: 8, label: 'Scanning website…', detail: 'Fetching HTML, meta tags, and conversion signals.', step: 'Step 1 · Site scan' },
    { afterMs: 4000, pct: 28, label: 'Building context…', detail: 'Merging reviews, ratings, and enrichment data.', step: 'Step 2 · Context' },
    { afterMs: 12000, pct: 52, label: 'Generating GEO/SEO report…', detail: 'OpenRouter is analyzing gaps and local visibility.', step: 'Step 3 · AI report' },
    { afterMs: 28000, pct: 72, label: 'Mapping GHL tools…', detail: 'Matching GoHighLevel features to what you can sell.', step: 'Step 4 · GHL stack' },
    { afterMs: 45000, pct: 88, label: 'Almost done…', detail: 'Finishing recommendations and 30-day rollout.', step: 'Step 5 · Finalizing' },
  ];

  function auditProgressForElapsed(elapsedMs) {
    let phase = AUDIT_PROGRESS_PHASES[0];
    for (let i = 0; i < AUDIT_PROGRESS_PHASES.length; i += 1) {
      if (elapsedMs >= AUDIT_PROGRESS_PHASES[i].afterMs) phase = AUDIT_PROGRESS_PHASES[i];
    }
    return phase;
  }

  let pageSpeedAuditProgressTimer = null;

  function stopPageSpeedAuditProgressTicker() {
    if (pageSpeedAuditProgressTimer) {
      clearInterval(pageSpeedAuditProgressTimer);
      pageSpeedAuditProgressTimer = null;
    }
  }

  function startPageSpeedAuditProgressTicker() {
    stopPageSpeedAuditProgressTicker();
    const t0 = Date.now();
    const tick = () => {
      const auditKey = String(window.__pageSpeedAuditLeadKey || '').trim();
      const rowKey = currentRow ? leadPanelRowKey(currentRow) : '';
      if (auditKey && rowKey && rowKey !== auditKey) return;
      const btn = document.getElementById('pageSpeedAuditRunBtn');
      if (!btn || btn.dataset.auditState !== 'active') {
        stopPageSpeedAuditProgressTicker();
        return;
      }
      const phase = auditProgressForElapsed(Date.now() - t0);
      updatePageSpeedAuditProgress(phase.pct, phase.label, phase.detail, phase.step);
      setGeoSeoGhlAuditLoading(true, phase.label);
    };
    tick();
    pageSpeedAuditProgressTimer = setInterval(tick, 900);
  }

  function setPageSpeedAuditUi(state, opts) {
    const btn = document.getElementById('pageSpeedAuditRunBtn');
    const progressWrap = document.getElementById('pageSpeedAuditProgressWrap');
    const main = btn && btn.querySelector('.page-speed-audit-main');
    const progressRow = btn && btn.querySelector('.page-speed-audit-progress-row');
    if (!btn) return;

    const next = state || 'idle';
    btn.dataset.auditState = next;

    if (next === 'active') {
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
      btn.classList.add('audit-active', 'cursor-wait');
      if (main) {
        main.classList.remove('hidden');
        main.removeAttribute('aria-hidden');
      }
      if (progressRow) {
        progressRow.classList.remove('hidden');
        progressRow.removeAttribute('aria-hidden');
      }
      if (progressWrap) {
        progressWrap.classList.add('hidden');
        progressWrap.setAttribute('aria-busy', 'true');
      }
      const phase = (opts && opts.phase) || AUDIT_PROGRESS_PHASES[0];
      updatePageSpeedAuditProgress(phase.pct, phase.label, phase.detail, phase.step);
      setGeoSeoGhlAuditLoading(true, phase.label);
      const body = document.getElementById('pageSpeedAuditPanelBody');
      if (body) body.classList.remove('hidden');
      const results = document.getElementById('pageSpeedAuditResults');
      const errEl = document.getElementById('pageSpeedAuditError');
      if (results) results.classList.add('hidden');
      if (errEl) {
        errEl.classList.add('hidden');
        errEl.textContent = '';
      }
      if (!(opts && opts.deferProgressTicker)) startPageSpeedAuditProgressTicker();
      return;
    }

    stopPageSpeedAuditProgressTicker();
    setGeoSeoGhlAuditLoading(false);
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    btn.classList.remove('audit-active', 'cursor-wait');
    if (main) {
      main.classList.remove('hidden');
      main.removeAttribute('aria-hidden');
    }
    if (progressRow) {
      progressRow.classList.add('hidden');
      progressRow.setAttribute('aria-hidden', 'true');
    }
    if (progressWrap) {
      progressWrap.classList.add('hidden');
      progressWrap.setAttribute('aria-busy', 'false');
    }
  }

  function syncPageSpeedAuditPanelBodyVisibility() {
    const body = document.getElementById('pageSpeedAuditPanelBody');
    const results = document.getElementById('pageSpeedAuditResults');
    const errEl = document.getElementById('pageSpeedAuditError');
    const geoLoading = document.getElementById('geoSeoGhlAuditLoading');
    const geoResult = document.getElementById('geoSeoGhlAuditResult');
    if (!body) return;
    const showResults = !!(results && !results.classList.contains('hidden'));
    const showError = !!(errEl && !errEl.classList.contains('hidden') && String(errEl.textContent || '').trim());
    const showGeoLoading = !!(geoLoading && !geoLoading.classList.contains('hidden'));
    const showGeoResult = !!(geoResult && !geoResult.classList.contains('hidden'));
    body.classList.toggle(
      'hidden',
      !(showResults || showError || showGeoLoading || showGeoResult || pageSpeedAuditInFlight),
    );
  }

  function showPageSpeedAuditError(message) {
    pageSpeedAuditInFlight = false;
    clearLeadPanelJob('audit', null);
    const errEl = document.getElementById('pageSpeedAuditError');
    setPageSpeedAuditUi('idle');
    if (errEl) {
      errEl.textContent = String(message || '').trim();
      if (errEl.textContent) errEl.classList.remove('hidden');
      else errEl.classList.add('hidden');
      try {
        errEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } catch (_) {}
    }
    syncPageSpeedAuditPanelBodyVisibility();
  }

  function setPageSpeedAuditRunning(running) {
    if (running) {
      setPageSpeedAuditUi('active');
    } else {
      setPageSpeedAuditUi('idle');
    }
  }

  function syncLeadPanelEmailReportSection(row) {
    const section = document.getElementById('leadPanelEmailReportSection');
    if (!section) return;
    const audit = row ? parsePageSpeedAuditFromRow(row) : null;
    const geo = row ? parseGeoSeoGhlAuditFromRow(row) : null;
    const hasAnalysis = row ? !!getAiAnalysisFromRow(row) : false;
    const hasAssessment = row ? !!getAiToolsAssessmentFromRow(row) : false;
    const hasWebsite = !!(row && row.dataset && row.dataset.website && row.dataset.website !== 'N/A');
    section.classList.toggle('hidden', !(audit || geo || hasAnalysis || hasAssessment || hasWebsite));
  }

  function syncPageSpeedAuditPanel(row) {
    const errEl = document.getElementById('pageSpeedAuditError');
    const results = document.getElementById('pageSpeedAuditResults');
    const runBtn = document.getElementById('pageSpeedAuditRunBtn');
    const progressWrap = document.getElementById('pageSpeedAuditProgressWrap');
    const runMeta = document.getElementById('pageSpeedAuditRunMeta');
    if (!runBtn) return;
    if (!row) return;
    coerceLeadPanelButtonsForView(row);

    syncGeoSeoGhlAuditPanel(row);

    const websiteUrl = resolveRowWebsiteForAudit(row);
    const hasWebsite = !!websiteUrl;
    const audit = row ? parsePageSpeedAuditFromRow(row) : null;
    const geoReport = row ? parseGeoSeoGhlAuditFromRow(row) : null;

    const uiActive = runBtn.dataset.auditState === 'active';
    const forThisRow = isPanelAuditActiveForRow(row);
    const forOtherLead = isAuditRunningOnAnotherPanelLead(row);

    if (forThisRow) {
      if (runBtn.dataset.auditState !== 'active') {
        setPageSpeedAuditUi('active', { deferProgressTicker: true });
      }
      if (!pageSpeedAuditProgressTimer) startPageSpeedAuditProgressTicker();
      if (runMeta) {
        const name = (row.dataset.title || window.__pageSpeedAuditLeadTitle || 'this lead').trim();
        runMeta.textContent = `Website audit in progress for ${name} (15–45 seconds).`;
        runMeta.classList.remove('hidden');
      }
      return;
    }

    if (forOtherLead) {
      if (uiActive) {
        stopPageSpeedAuditProgressTicker();
        setPageSpeedAuditUi('idle');
      }
      if (progressWrap) progressWrap.classList.add('hidden');
      if (runMeta) {
        const other = String(window.__pageSpeedAuditLeadTitle || 'another lead').trim() || 'another lead';
        runMeta.textContent = `Website audit still running on ${other}. Use ← → to return to that lead, or wait for the toast when it finishes.`;
        runMeta.classList.remove('hidden');
      }
      const blocked = !hasWebsite;
      runBtn.disabled = blocked;
      runBtn.setAttribute('aria-disabled', blocked ? 'true' : 'false');
      runBtn.classList.toggle('opacity-50', blocked);
      runBtn.classList.toggle('cursor-not-allowed', blocked);
      setPageSpeedAuditButtonLabel(runBtn, pageSpeedAuditButtonLabel(!!(audit || geoReport), false));
      return;
    }

    if (runMeta) {
      runMeta.textContent = '';
      runMeta.classList.add('hidden');
    }

    if (!pageSpeedAuditInFlight && uiActive) {
      stopPageSpeedAuditProgressTicker();
      setPageSpeedAuditUi('idle');
    }

    if (!pageSpeedAuditInFlight) {
      const blocked = !hasWebsite;
      const stillActive = runBtn.dataset.auditState === 'active';
      if (!stillActive) {
        runBtn.disabled = false;
        runBtn.setAttribute('aria-disabled', blocked ? 'true' : 'false');
        runBtn.classList.toggle('opacity-50', blocked);
        runBtn.classList.toggle('cursor-not-allowed', blocked);
      }
      runBtn.title = !hasWebsite
        ? 'Add a website URL first'
        : geoReport || audit
          ? 'Re-run GEO/SEO + GHL audit (and Lighthouse if configured)'
          : 'Run GEO/SEO audit + GoHighLevel sell report';
      setPageSpeedAuditButtonLabel(runBtn, pageSpeedAuditButtonLabel(!!(audit || geoReport), false));
    }

    if (pageSpeedAuditInFlight) return;

    if (progressWrap && !pageSpeedAuditInFlight) progressWrap.classList.add('hidden');

    if (!audit && !geoReport) {
      if (results) results.classList.add('hidden');
      syncPageSpeedAuditPanelBodyVisibility();
      return;
    }

    if (geoReport) {
      const body = document.getElementById('pageSpeedAuditPanelBody');
      if (body) body.classList.remove('hidden');
    }

    if (!audit) {
      syncPageSpeedAuditPanelBodyVisibility();
      return;
    }

    if (errEl) {
      errEl.classList.add('hidden');
      errEl.textContent = '';
    }

    if (results) {
      results.classList.remove('hidden');
      try {
        results.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } catch (_) {}
    }

    const scores = audit.scores || {};
    const setScore = (id, val) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (val == null || !Number.isFinite(Number(val))) {
        el.textContent = '—';
        el.className = 'text-xl font-black text-brand-dark dark:text-white tabular-nums';
        return;
      }
      const n = Math.round(Number(val));
      el.textContent = String(n);
      el.className = `text-xl font-black tabular-nums ${scoreColorClass(n)}`;
    };
    setScore('pageSpeedScorePerformance', scores.performance);
    setScore('pageSpeedScoreSeo', scores.seo);
    setScore('pageSpeedScoreAccessibility', scores.accessibility);
    setScore('pageSpeedScoreBestPractices', scores.bestPractices);

    const meta = document.getElementById('pageSpeedAuditMeta');
    if (meta) {
      let when = '';
      try {
        when = audit.fetchedAt
          ? new Date(audit.fetchedAt).toLocaleString(undefined, {
              dateStyle: 'medium',
              timeStyle: 'short',
            })
          : '';
      } catch {
        when = audit.fetchedAt || '';
      }
      const strat = audit.strategy === 'desktop' ? 'Desktop' : 'Mobile';
      meta.textContent = when
        ? `Last run ${when} · ${strat} · ${audit.url || ''}`
        : `${strat} · ${audit.url || ''}`;
    }

    const summary = document.getElementById('pageSpeedAuditSummary');
    if (summary) {
      const avg =
        audit.averageScore != null && Number.isFinite(Number(audit.averageScore))
          ? Math.round(Number(audit.averageScore))
          : null;
      const ownerSignal = String((row && row.dataset.ownerSignal) || '').trim();
      summary.textContent =
        ownerSignal ||
        (avg != null
          ? `Average Lighthouse score ${avg}/100 across core categories.`
          : 'Lighthouse audit saved on this lead.');
    }

    const issuesUl = document.getElementById('pageSpeedAuditIssues');
    const issues = Array.isArray(audit.topIssues) ? audit.topIssues : [];
    if (issuesUl) {
      issuesUl.innerHTML = '';
      if (issues.length) {
        issuesUl.classList.remove('hidden');
        for (const t of issues.slice(0, 6)) {
          const li = document.createElement('li');
          li.className = 'pl-3 border-l-2 border-brand-yellow/40';
          li.textContent = String(t);
          issuesUl.appendChild(li);
        }
      } else {
        issuesUl.classList.add('hidden');
      }
    }

    const link = document.getElementById('pageSpeedAuditReportLink');
    if (link && audit.reportUrl) {
      link.href = audit.reportUrl;
      link.classList.remove('hidden', 'pointer-events-none', 'opacity-40');
    } else if (link) {
      link.href = '#';
      link.classList.add('pointer-events-none', 'opacity-40');
    }

    const linksWrap = document.getElementById('leadPanelAuditReportLinks');
    const storedReportUrl = String((row && row.dataset.auditReportUrl) || '').trim();
    if (linksWrap) {
      linksWrap.classList.toggle('hidden', !audit);
      if (audit && storedReportUrl) {
        showLeadPanelAuditReportLinks({ reportUrl: storedReportUrl });
      }
    }

    syncPageSpeedAuditPanelBodyVisibility();
  }

  async function runPageSpeedAuditForRow(row) {
    if (!row) throw new Error('No lead selected.');
    await ensureRowHasLeadKey(row);
    const key = String(row.dataset.leadKey || '').trim();
    const website = resolveRowWebsiteForAudit(row);
    const res = await fetch(`/leads/${encodeURIComponent(key)}/pagespeed-audit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ strategy: 'mobile', website }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      throw new Error((data && data.error) || 'PageSpeed audit failed');
    }
    if (data.lead) syncPersistedLeadToRowDataset(row, data.lead);
    else if (data.audit) {
      row.dataset.pageSpeedAudit = JSON.stringify(data.audit);
      if (data.audit.fetchedAt) row.dataset.pageSpeedAuditAt = data.audit.fetchedAt;
    }
    if (data.ownerSignal) {
      row.dataset.ownerSignal = data.ownerSignal;
      const rowSignal = row.querySelector('.lead-owner-signal');
      if (rowSignal) rowSignal.textContent = data.ownerSignal;
    }
    if (currentRow === row && !pageSpeedAuditInFlight) {
      syncLeadPanelEmailReportSection(row);
      syncPageSpeedAuditPanel(row);
    }
    return data;
  }

  /** Show pitch video URL when status is Video Recorded, or when a URL is already saved (any status). */
  function syncQuickPitchSectionVisibility(row) {
    const section = document.getElementById('quickPitchSection');
    const panelSel = document.getElementById('leadStatusSelect');
    if (!section || !row) return;
    let st = String(row.dataset.status || '').trim();
    if (st === 'Needs Video') st = 'Not Contacted';
    if (row === currentRow && panelSel) {
      const pv = String(panelSel.value || '').trim();
      if (pv) {
        st = pv;
        if (st === 'Needs Video') st = 'Not Contacted';
      }
    }
    const loom = String(row.dataset.loomUrl || '').trim();
    const show = st === 'Video Recorded' || loom.length > 0;
    section.classList.toggle('hidden', !show);
  }

  function syncLoomOpenLink(urlRaw) {
    const loomOpen = document.getElementById('loomUrlOpenBtn');
    if (!loomOpen) return;
    const raw = String(urlRaw || '').trim();
    if (!raw) {
      loomOpen.classList.add('hidden');
      loomOpen.removeAttribute('href');
      return;
    }
    const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, '')}`;
    loomOpen.href = href;
    loomOpen.classList.remove('hidden');
  }

  function parseRowCqi(row) {
    try {
      const raw = row.dataset.cqi;
      if (!raw || raw === '' || raw === 'null' || raw === 'undefined') return null;
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object') return null;
      return obj;
    } catch {
      return null;
    }
  }

  function cqiHasContent(cqi) {
    if (!cqi) return false;
    const keys = [
      'monthlyRevenue',
      'marketingSpend',
      'notes',
      'decisionMakerName',
      'yearsInBusiness',
      'biggestPain',
      'currentlyUsing',
      'budgetRange',
      'timeline',
    ];
    return keys.some((k) => String(cqi[k] || '').trim());
  }

  function readCqiFormFromDom() {
    const g = (id) => {
      const el = document.getElementById(id);
      return el && 'value' in el ? String(el.value || '').trim() : '';
    };
    return {
      decisionMakerName: g('cqiFieldDecisionMaker'),
      yearsInBusiness: g('cqiFieldYearsInBusiness'),
      monthlyRevenue: g('cqiFieldMonthlyRevenue'),
      marketingSpend: g('cqiFieldMarketingSpend'),
      biggestPain: g('cqiFieldBiggestPain'),
      currentlyUsing: g('cqiFieldCurrentlyUsing'),
      budgetRange: g('cqiFieldBudgetRange'),
      timeline: g('cqiFieldTimeline'),
      notes: g('cqiFieldNotes'),
    };
  }

  function fillCqiFormFromObject(cqi) {
    const c = cqi && typeof cqi === 'object' ? cqi : {};
    const setv = (id, v) => {
      const el = document.getElementById(id);
      if (el && 'value' in el) el.value = v != null ? String(v) : '';
    };
    setv('cqiFieldDecisionMaker', c.decisionMakerName || '');
    setv('cqiFieldYearsInBusiness', c.yearsInBusiness || '');
    setv('cqiFieldMonthlyRevenue', c.monthlyRevenue || '');
    setv('cqiFieldMarketingSpend', c.marketingSpend || '');
    setv('cqiFieldBiggestPain', c.biggestPain || '');
    setv('cqiFieldCurrentlyUsing', c.currentlyUsing || '');
    setv('cqiFieldBudgetRange', c.budgetRange || '');
    setv('cqiFieldTimeline', c.timeline || '');
    setv('cqiFieldNotes', c.notes || '');
    const revEl = document.getElementById('mobilePanelCqiRevenue');
    const spendEl = document.getElementById('mobilePanelCqiSpend');
    const notesEl = document.getElementById('mobilePanelCqiNotes');
    if (revEl) revEl.textContent = (c.monthlyRevenue && String(c.monthlyRevenue).trim()) || '—';
    if (spendEl) spendEl.textContent = (c.marketingSpend && String(c.marketingSpend).trim()) || '—';
    if (notesEl) notesEl.textContent = (c.notes && String(c.notes).trim()) || '—';
  }

  function syncMobilePanelCqi(row) {
    const pill = document.getElementById('mobilePanelCqiPill');
    const emptyEl = document.getElementById('mobilePanelCqiEmpty');
    const detailsEl = document.getElementById('mobilePanelCqiDetails');
    const recEl = document.getElementById('mobilePanelCqiRecorded');
    if (!pill || !emptyEl || !detailsEl) return;

    const cqi = parseRowCqi(row);
    fillCqiFormFromObject(cqi);
    const filled = cqiHasContent(cqi);
    const ps = parseInt(row.dataset.pipelineStage, 10);
    const stage = !Number.isNaN(ps) && ps >= 1 && ps <= 10 ? ps : 1;

    if (filled) {
      pill.textContent = 'CQI logged';
      pill.className =
        'shrink-0 whitespace-nowrap px-3 py-1 rounded-full border text-[10px] font-black uppercase tracking-widest bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-500/30';
    } else if (stage >= 4) {
      pill.textContent = 'Log CQI';
      pill.className =
        'shrink-0 whitespace-nowrap px-3 py-1 rounded-full border text-[10px] font-black uppercase tracking-widest bg-amber-500/15 text-amber-800 dark:text-amber-200 border-amber-500/35';
    } else {
      pill.textContent = 'Pre-CQI';
      pill.className =
        'shrink-0 whitespace-nowrap px-3 py-1 rounded-full border text-[10px] font-black uppercase tracking-widest bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border-brand-border/30 dark:border-white/10';
    }

    emptyEl.classList.toggle('hidden', filled);
    detailsEl.classList.remove('hidden');
    if (recEl) {
      if (cqi && cqi.recordedAt) {
        try {
          recEl.textContent = `Last saved ${new Date(cqi.recordedAt).toLocaleString()}`;
        } catch {
          recEl.textContent = '';
        }
      } else {
        recEl.textContent = '';
      }
    }
  }

  const US_STATE_TZ = {
    AL: 'America/Chicago',
    AK: 'America/Anchorage',
    AZ: 'America/Phoenix',
    AR: 'America/Chicago',
    CA: 'America/Los_Angeles',
    CO: 'America/Denver',
    CT: 'America/New_York',
    DE: 'America/New_York',
    FL: 'America/New_York',
    GA: 'America/New_York',
    HI: 'Pacific/Honolulu',
    ID: 'America/Boise',
    IL: 'America/Chicago',
    IN: 'America/Indiana/Indianapolis',
    IA: 'America/Chicago',
    KS: 'America/Chicago',
    KY: 'America/New_York',
    LA: 'America/Chicago',
    ME: 'America/New_York',
    MD: 'America/New_York',
    MA: 'America/New_York',
    MI: 'America/Detroit',
    MN: 'America/Chicago',
    MS: 'America/Chicago',
    MO: 'America/Chicago',
    MT: 'America/Denver',
    NE: 'America/Chicago',
    NV: 'America/Los_Angeles',
    NH: 'America/New_York',
    NJ: 'America/New_York',
    NM: 'America/Denver',
    NY: 'America/New_York',
    NC: 'America/New_York',
    ND: 'America/Chicago',
    OH: 'America/New_York',
    OK: 'America/Chicago',
    OR: 'America/Los_Angeles',
    PA: 'America/New_York',
    RI: 'America/New_York',
    SC: 'America/New_York',
    SD: 'America/Chicago',
    TN: 'America/Chicago',
    TX: 'America/Chicago',
    UT: 'America/Denver',
    VT: 'America/New_York',
    VA: 'America/New_York',
    WA: 'America/Los_Angeles',
    WV: 'America/New_York',
    WI: 'America/Chicago',
    WY: 'America/Denver',
    DC: 'America/New_York',
  };

  function isEmptyLeadField(v) {
    const s = v == null ? '' : String(v).trim();
    return !s || s === 'N/A' || s === '—' || s === '-' || s === 'undefined' || s === 'null';
  }

  /** Prefer the visible pipeline table row (kanban / panel host pass a clone or sparse node). */
  function resolvePipelineTableRowForPanel(row) {
    if (!row) return null;
    if (row.tagName === 'TR' && row.closest && row.closest('#prospectLeadsTable')) {
      return row.classList.contains('result-row') ? row : row.closest('tr.result-row') || row;
    }
    const rawKey = String(row.dataset.leadKey || '').trim();
    const keyNorm = rawKey.replace(/^lead:/i, '');
    if (keyNorm) {
      const byKey = document.querySelector(
        `#prospectLeadsTable tbody tr.result-row[data-lead-key="${CSS.escape(keyNorm)}"], #prospectLeadsTable tbody tr.result-row[data-lead-key="lead:${CSS.escape(keyNorm)}"]`,
      );
      if (byKey) return byKey;
    }
    const titleKey = normalizeLeadTitleKey(row.dataset.title || '');
    if (titleKey) {
      const match = Array.from(document.querySelectorAll('#prospectLeadsTable tbody tr.result-row')).find(
        (tr) => normalizeLeadTitleKey(tr.dataset.title || '') === titleKey,
      );
      if (match) return match;
    }
    if (row.dataset && (row.dataset.leadKey || row.dataset.title)) return row;
    return row.tagName === 'TR' ? row : null;
  }
  window.__resolvePipelineTableRowForPanel = resolvePipelineTableRowForPanel;

  function panelSnapFromLeadRecord(lead) {
    if (!lead || typeof lead !== 'object') return {};
    const catRaw = lead.categoryName != null ? lead.categoryName : lead.category;
    const snap = {
      title: String(lead.title || '').trim(),
      phone: isEmptyLeadField(lead.phone) ? '' : String(lead.phone).trim(),
      email: isEmptyLeadField(lead.email) ? '' : String(lead.email).trim(),
      website: isEmptyLeadField(lead.website) ? '' : String(lead.website).trim(),
      address: isEmptyLeadField(lead.address) ? '' : String(lead.address).trim(),
      city: isEmptyLeadField(lead.city) ? '' : String(lead.city).trim(),
      state: isEmptyLeadField(lead.state) ? '' : String(lead.state).trim(),
      category: isEmptyLeadField(catRaw) ? '' : String(catRaw).trim(),
      url: isEmptyLeadField(lead.url) ? '' : String(lead.url).trim(),
      facebook: isEmptyLeadField(lead.facebook) ? '' : String(lead.facebook).trim(),
      instagram: isEmptyLeadField(lead.instagram) ? '' : String(lead.instagram).trim(),
      twitter: isEmptyLeadField(lead.twitter) ? '' : String(lead.twitter).trim(),
      rating:
        parseFloat(lead.totalScore ?? lead.rating ?? lead.total_score) ||
        parseFloat(lead.averageRating) ||
        0,
      reviews:
        parseInt(lead.reviewsCount ?? lead.reviews ?? lead.reviews_count, 10) ||
        parseInt(lead.reviewCount, 10) ||
        0,
      reviewSnippets: reviewSnippetsFromLeadObj(lead),
    };
    const contacts = Array.isArray(lead.contacts) ? lead.contacts : [];
    const priPhone =
      contacts.find((c) => c && c.primary && !isEmptyLeadField(c.phone)) ||
      contacts.find((c) => c && !isEmptyLeadField(c.phone));
    if (priPhone) {
      mergePanelSnapField(snap, 'phone', priPhone.phone);
      if (isEmptyLeadField(snap.email) && !isEmptyLeadField(priPhone.email)) {
        mergePanelSnapField(snap, 'email', priPhone.email);
      }
    }
    return snap;
  }

  function scrapePipelineRowPanelFields(row) {
    const out = {};
    if (!row || typeof row.querySelector !== 'function') return out;

    const addrEl =
      row.querySelector('.lead-row-address--detail') || row.querySelector('.lead-row-address');
    if (addrEl) {
      const fromTitle = String(addrEl.getAttribute('title') || '').trim();
      const t = String(addrEl.textContent || '')
        .replace(/\s+/g, ' ')
        .trim();
      const pick = fromTitle && fromTitle !== '—' ? fromTitle : t;
      if (pick && pick !== '—' && pick !== '-') out.address = pick;
    }

    const phoneSlots = row.querySelectorAll(
      '.lead-contact-phone-slot.js-click-to-call-number[data-phone], .js-click-to-call-number[data-phone]',
    );
    for (const phoneSlot of phoneSlots) {
      const label = phoneSlot.querySelector('.lead-contact-phone-label');
      const p = String(
        phoneSlot.getAttribute('data-phone') ||
          phoneSlot.dataset.phone ||
          (label && label.textContent) ||
          phoneSlot.textContent ||
          '',
      ).trim();
      if (p && p !== '—' && p !== 'N/A') {
        out.phone = p;
        break;
      }
    }

    const mailLink = row.querySelector('a[href^="mailto:"]');
    if (mailLink) {
      const href = String(mailLink.getAttribute('href') || '').replace(/^mailto:/i, '').split('?')[0].trim();
      const em = href || String(mailLink.textContent || '').trim();
      if (em && em !== '—' && em !== 'N/A') out.email = em;
    }

    const webLink = row.querySelector('.website-link[data-url], a.website-link[href]');
    if (webLink) {
      const w = String(webLink.getAttribute('data-url') || webLink.getAttribute('href') || '').trim();
      if (w && w !== 'N/A' && !/^#$/i.test(w)) out.website = w.replace(/\/$/, '');
    }

    const revLine = row.querySelector('.lead-reviews-line');
    if (revLine) {
      const txt = String(revLine.textContent || '');
      const m = txt.match(/([\d]+(?:\.[\d]+)?)\s*\(\s*(\d+)\s*\)/);
      if (m) {
        out.rating = parseFloat(m[1]) || 0;
        out.reviews = parseInt(m[2], 10) || 0;
      } else {
        const m2 = txt.match(/\(\s*(\d+)\s*\)/);
        if (m2) out.reviews = parseInt(m2[1], 10) || 0;
      }
    }

    const catInp = row.querySelector('.lead-category-input');
    if (catInp && String(catInp.value || '').trim()) {
      out.category = String(catInp.value).trim();
    }

    return out;
  }

  function mergePanelSnapField(snap, key, value) {
    if (!snap) return;
    if (key === 'reviewSnippets') {
      const list = Array.isArray(value)
        ? value.map((s) => String(s || '').trim()).filter(Boolean)
        : [];
      if (list.length) snap.reviewSnippets = list;
      return;
    }
    if (isEmptyLeadField(value)) return;
    if (key === 'rating') {
      const n = parseFloat(value);
      if (Number.isFinite(n) && n > 0) snap.rating = n;
      return;
    }
    if (key === 'reviews') {
      const n = parseInt(value, 10);
      if (Number.isFinite(n) && n > 0) snap.reviews = n;
      return;
    }
    snap[key] = String(value).trim();
  }

  function buildLeadPanelDisplaySnapshot(row) {
    const tableRow = resolvePipelineTableRowForPanel(row) || row;
    const snap = {
      title: '',
      phone: '',
      email: '',
      website: '',
      address: '',
      city: '',
      state: '',
      category: '',
      url: '',
      facebook: '',
      instagram: '',
      twitter: '',
      rating: 0,
      reviews: 0,
      reviewSnippets: [],
    };
    if (!tableRow) return { tableRow: row, snap };

    const embedded = findInitialSavedLeadRecord(tableRow);
    if (embedded) {
      Object.entries(panelSnapFromLeadRecord(embedded)).forEach(([k, v]) => mergePanelSnapField(snap, k, v));
    }

    const ds = tableRow.dataset;
    mergePanelSnapField(snap, 'title', ds.title);
    mergePanelSnapField(snap, 'phone', ds.phone);
    mergePanelSnapField(snap, 'email', ds.email);
    mergePanelSnapField(snap, 'website', ds.website);
    mergePanelSnapField(snap, 'address', ds.address);
    mergePanelSnapField(snap, 'city', ds.city);
    mergePanelSnapField(snap, 'state', ds.state);
    mergePanelSnapField(snap, 'category', ds.category);
    mergePanelSnapField(snap, 'url', ds.url);
    mergePanelSnapField(snap, 'facebook', ds.facebook);
    mergePanelSnapField(snap, 'instagram', ds.instagram);
    mergePanelSnapField(snap, 'twitter', ds.twitter);
    mergePanelSnapField(snap, 'rating', ds.rating);
    mergePanelSnapField(snap, 'reviews', ds.reviews);
    if (ds.reviewSnippets && ds.reviewSnippets !== '[]') {
      try {
        mergePanelSnapField(snap, 'reviewSnippets', JSON.parse(ds.reviewSnippets));
      } catch (_) {
        /* ignore */
      }
    }

    Object.entries(scrapePipelineRowPanelFields(tableRow)).forEach(([k, v]) => mergePanelSnapField(snap, k, v));

    const contacts = parseRowContacts(tableRow);
    const priContact =
      contacts.find((c) => c && c.primary && !isEmptyLeadField(c.phone)) ||
      contacts.find((c) => c && !isEmptyLeadField(c.phone));
    if (priContact) {
      mergePanelSnapField(snap, 'phone', priContact.phone);
      if (isEmptyLeadField(snap.email) && !isEmptyLeadField(priContact.email)) {
        mergePanelSnapField(snap, 'email', priContact.email);
      }
    }

    if (!snap.title) snap.title = String(ds.title || '').trim();

    try {
      window.__lastPanelSnap = { key: ds.leadKey || '', title: snap.title, snap };
    } catch (_) {
      /* ignore */
    }

    return { tableRow, snap };
  }

  /** Paint header phone/address/reviews from hydrated row (not stale snapshot). */
  function paintPanelHeaderContactStrip(tableRow) {
    if (!tableRow || !tableRow.dataset) return;
    let phone = readPipelineRowDisplayPhone(tableRow);
    let address = readPipelineRowDisplayAddress(tableRow);
    try {
      const lp = window.__lastPanelPaint;
      const rowKey = String(tableRow.dataset.leadKey || '').trim();
      if (lp && rowKey && String(lp.key || '').trim() === rowKey) {
        if (!phone && lp.phone) phone = String(lp.phone).trim();
        if (!address && lp.address) address = String(lp.address).trim();
      }
    } catch (_) {
      /* ignore */
    }
    const rev = readPipelineRowReviewsSnapshot(tableRow);
    const rating = rev.rating > 0 ? rev.rating : parseFloat(tableRow.dataset.rating) || 0;
    const reviews = rev.reviews > 0 ? rev.reviews : parseInt(tableRow.dataset.reviews, 10) || 0;

    renderStars(rating, reviews);
    syncGoogleReviewsLink(tableRow);
    syncHeaderPhoneRow(tableRow, phone);
    syncHeaderWebsiteRow(tableRow);
    syncHeaderWebsiteBuildRow(tableRow);
    syncHeaderEmailRow(tableRow);
    syncLeadPanelContactLinks(tableRow);
    if (typeof window.__syncLeadPanelSocialsSummary === 'function') {
      window.__syncLeadPanelSocialsSummary(tableRow);
    }

    const locationLine = address
      ? formatLeadPanelAddress(address)
      : readPipelineRowLocationLine(tableRow);
    const headerAddr = getLeadPanelEl('mobilePanelHeaderAddress');
    if (headerAddr) {
      headerAddr.textContent = locationLine || '—';
    }
    const addrRow = document.getElementById('headerAddressRow');
    if (addrRow) addrRow.classList.toggle('hidden', !locationLine);

  }

  function applyPanelSnapToRowDataset(row, snap) {
    if (!row || !row.dataset || !snap) return;
    const ds = row.dataset;
    if (snap.title) ds.title = snap.title;
    if (snap.phone) ds.phone = snap.phone;
    if (snap.email) ds.email = snap.email;
    if (snap.website) ds.website = snap.website;
    if (snap.address) ds.address = snap.address;
    if (snap.city) ds.city = snap.city;
    if (snap.state) ds.state = snap.state;
    if (snap.category) ds.category = snap.category;
    if (snap.url) ds.url = snap.url;
    if (snap.facebook) ds.facebook = snap.facebook;
    if (snap.instagram) ds.instagram = snap.instagram;
    if (snap.twitter) ds.twitter = snap.twitter;
    if (snap.linkedin) ds.linkedin = snap.linkedin;
    if (snap.tiktok) ds.tiktok = snap.tiktok;
    if (snap.rating > 0) ds.rating = String(snap.rating);
    if (snap.reviews > 0) ds.reviews = String(snap.reviews);
    if (Array.isArray(snap.reviewSnippets) && snap.reviewSnippets.length) {
      try {
        ds.reviewSnippets = JSON.stringify(snap.reviewSnippets);
      } catch (_) {
        /* ignore */
      }
    }
  }

  function readPipelineRowDisplayAddress(row) {
    if (!row || !row.dataset) return '';
    const fromParts = formatPipelineFullAddressLine(row.dataset);
    if (fromParts) return fromParts;
    let a = String(row.dataset.address || '').trim();
    if ((!a || a === 'N/A') && typeof row.querySelector === 'function') {
      const el =
        row.querySelector('.lead-row-address--detail') || row.querySelector('.lead-row-address');
      const fromTitle = el ? String(el.getAttribute('title') || '').trim() : '';
      const t = el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '';
      const pick = fromTitle && fromTitle !== '—' ? fromTitle : t;
      if (pick && pick !== '—' && pick !== '-') a = pick;
    }
    return a && a !== 'N/A' ? a : '';
  }

  function stripTitleFromAddress(address, title) {
    let a = String(address || '').trim();
    const t = String(title || '').trim();
    if (!a || a === 'N/A' || !t) return a;
    if (a.toLowerCase() === t.toLowerCase()) return '';
    const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const stripped = a.replace(new RegExp(`^${escaped}\\s*[,–—-]?\\s*`, 'i'), '').trim();
    return stripped || a;
  }

  function formatPipelineFullAddressLine(src) {
    if (!src) return '';
    let street = stripTitleFromAddress(
      String(src.address != null ? src.address : src.street || '').trim(),
      src.title || src.leadTitle || '',
    );
    if (!street || street === 'N/A') street = '';
    const city = String(src.city || '').trim();
    const state = String(src.state || '').trim();
    const zip = String(src.zip || src.postalCode || '').trim();

    const locParts = [];
    if (city) locParts.push(city);
    if (state) locParts.push(state);
    let loc = locParts.join(', ');
    if (zip) loc = loc ? `${loc} ${zip}` : zip;

    if (!street) return loc;
    if (!loc) return street;

    const streetLower = street.toLowerCase();
    const locLower = loc.toLowerCase();
    if (streetLower.endsWith(locLower) || streetLower.includes(`, ${locLower}`)) {
      return street;
    }

    if (city && state) {
      const cityState = `${city}, ${state}`.toLowerCase();
      if (streetLower.includes(cityState)) {
        if (zip && !streetLower.includes(String(zip).toLowerCase())) {
          return `${street} ${zip}`;
        }
        return street;
      }
    }

    return `${street}, ${loc}`;
  }

  function syncPipelineRowAddressDisplay(row) {
    if (!row || typeof row.querySelector !== 'function') return;
    const wrap = row.querySelector('.lead-row-address-wrap');
    if (!wrap) return;
    const compactEl = wrap.querySelector('.lead-row-address--compact');
    const detailEl = wrap.querySelector('.lead-row-address--detail');
    const streetRaw = row.dataset.address;
    let street = streetRaw != null ? stripTitleFromAddress(String(streetRaw).trim(), row.dataset.title || '') : '';
    if (!street || street === 'N/A') street = '';
    const full = formatPipelineFullAddressLine(row.dataset);
    const title = full || street || '';
    const dash = '—';
    if (compactEl) {
      compactEl.textContent = street || dash;
      if (title) compactEl.setAttribute('title', title);
      else compactEl.removeAttribute('title');
    }
    if (detailEl) {
      detailEl.textContent = full || dash;
      if (title) detailEl.setAttribute('title', title);
      else detailEl.removeAttribute('title');
    }
  }
  window.syncPipelineRowAddressDisplay = syncPipelineRowAddressDisplay;

  function readPipelineRowDisplayWebsite(row) {
    if (!row || !row.dataset) return '';
    let w = String(row.dataset.website || '').trim();
    if (w && w !== 'N/A') return w.replace(/\/$/, '');
    if (typeof row.querySelector === 'function') {
      const link = row.querySelector('.website-link[data-url], a.website-link');
      if (link) {
        w = String(link.getAttribute('data-url') || link.getAttribute('href') || '').trim();
        if (w && w !== 'N/A' && !/^#$/i.test(w)) return w.replace(/\/$/, '');
      }
    }
    return '';
  }

  function normalizeWebsiteHref(raw) {
    const w = String(raw || '').trim();
    if (!w || w === 'N/A' || w === '—' || w.length < 3) return '';
    if (/^https?:\/\//i.test(w)) return w;
    return `https://${w.replace(/^\/+/, '')}`;
  }

  function resolveLeadPanelMapsHref(row, addressOverride) {
    if (!row || !row.dataset) return '';
    const address =
      addressOverride != null && String(addressOverride).trim()
        ? String(addressOverride).trim()
        : readPipelineRowDisplayAddress(row);
    let href = resolveGoogleMapsSocialHref(
      row.dataset.url,
      row.dataset.title,
      address || row.dataset.address,
      row.dataset.city,
    );
    if (href) return href;
    try {
      const { snap } = buildLeadPanelDisplaySnapshot(row);
      if (snap) {
        href = resolveGoogleMapsSocialHref(
          snap.url,
          snap.title || row.dataset.title,
          snap.address || address || row.dataset.address,
          snap.city || row.dataset.city,
        );
        if (href) return href;
      }
    } catch (_) {
      /* ignore */
    }
    const embedded = findInitialSavedLeadRecord(row);
    if (embedded) {
      href = resolveGoogleMapsSocialHref(
        embedded.url,
        embedded.title || row.dataset.title,
        embedded.address || address || row.dataset.address,
        embedded.city || row.dataset.city,
      );
      if (href) return href;
    }
    return '';
  }

  function resolveLeadPanelWebsiteHref(row) {
    if (!row) return '';
    prepareLeadRowForPanel(row);
    let w = readPipelineRowDisplayWebsite(row);
    if (w) return normalizeWebsiteHref(w);
    try {
      const { snap } = buildLeadPanelDisplaySnapshot(row);
      if (snap && snap.website) return normalizeWebsiteHref(snap.website);
    } catch (_) {
      /* ignore */
    }
    const embedded = findInitialSavedLeadRecord(row);
    if (embedded && embedded.website) return normalizeWebsiteHref(embedded.website);
    return '';
  }

  /** Promote phone/email from contacts[] into row dataset when top-level fields are empty. */
  function coalesceRowDatasetFromContacts(row) {
    if (!row || !row.dataset) return;
    const list = parseRowContacts(row);
    if (!list.length) return;
    const withPhone = list.filter((c) => c && !isEmptyLeadField(c.phone));
    const pri = withPhone.find((c) => c.primary) || withPhone[0];
    if (pri) {
      if (isEmptyLeadField(row.dataset.phone)) row.dataset.phone = String(pri.phone).trim();
      if (isEmptyLeadField(row.dataset.email) && !isEmptyLeadField(pri.email)) {
        row.dataset.email = String(pri.email).trim();
      }
    }
    if (isEmptyLeadField(row.dataset.email)) {
      const withEmail = list.find((c) => c && !isEmptyLeadField(c.email));
      if (withEmail) row.dataset.email = String(withEmail.email).trim();
    }
  }

  /** Mirror visible pipeline table cells into data-* when attributes are stale or N/A. */
  function hydrateRowDatasetFromTableDom(row) {
    if (!row || !row.dataset || typeof row.querySelector !== 'function') return;

    const phone = readPipelineRowDisplayPhone(row);
    if (phone && isEmptyLeadField(row.dataset.phone)) row.dataset.phone = phone;

    const email = readPipelineRowDisplayEmail(row);
    if (email && isEmptyLeadField(row.dataset.email)) row.dataset.email = email;

    const addr = readPipelineRowDisplayAddress(row);
    if (addr && isEmptyLeadField(row.dataset.address)) row.dataset.address = addr;

    const website = readPipelineRowDisplayWebsite(row);
    if (website && isEmptyLeadField(row.dataset.website)) row.dataset.website = website;

    const rev = readPipelineRowReviewsSnapshot(row);
    if (rev.rating > 0 && (!parseFloat(row.dataset.rating) || parseFloat(row.dataset.rating) === 0)) {
      row.dataset.rating = String(rev.rating);
    }
    if (rev.reviews > 0 && (!parseInt(row.dataset.reviews, 10) || parseInt(row.dataset.reviews, 10) === 0)) {
      row.dataset.reviews = String(rev.reviews);
    }

    const socialSlot = row.querySelector('.lead-cell-socials-content');
    if (socialSlot) {
      socialSlot.querySelectorAll('a[href]').forEach((a) => {
        const href = String(a.getAttribute('href') || '').trim();
        if (!href || href === '#') return;
        const h = href.toLowerCase();
        if (
          (h.includes('facebook.com') || h.includes('fb.com') || h.includes('fb.me')) &&
          isEmptyLeadField(row.dataset.facebook)
        ) {
          row.dataset.facebook = href;
        } else if (h.includes('instagram.com') && isEmptyLeadField(row.dataset.instagram)) {
          row.dataset.instagram = href;
        } else if (
          (h.includes('twitter.com') || h.includes('x.com')) &&
          isEmptyLeadField(row.dataset.twitter)
        ) {
          row.dataset.twitter = href;
        } else if (
          (h.includes('google.com/maps') || h.includes('maps.google') || h.includes('goo.gl/maps')) &&
          isEmptyLeadField(row.dataset.url)
        ) {
          row.dataset.url = href;
        }
      });
    }
  }

  function prepareLeadRowForPanel(row) {
    if (!row || !row.dataset) return;
    hydrateRowDatasetFromTableDom(row);
    syncRowFromInitialSavedLeads(row);
    coalesceRowDatasetFromContacts(row);
    hydrateRowDatasetFromTableDom(row);
  }

  /** Geocoding / map query variants for addresses with business names or mall-style locations. */
  function geocodeQueryVariants(raw) {
    const q = String(raw || '').trim();
    if (!q) return [];
    const out = [q];
    const parts = q.split(',').map((s) => s.trim()).filter(Boolean);
    const streetSuffix =
      /\b(st|street|ste|suite|ave|avenue|av|rd|road|blvd|boulevard|dr|drive|way|ln|lane|ct|court|pl|place|hwy|highway|pkwy|parkway|cir|circle)\b/i;

    const stripSuiteFragment = (s) =>
      String(s || '')
        .replace(/\s+(?:#\s*[\w-]+|(?:ste|suite|unit|apt|bldg|fl|floor|rm|room)\.?\s*#?\s*[\w-]+)/gi, '')
        .replace(/\s+/g, ' ')
        .trim();

    const withoutSuite = stripSuiteFragment(q);
    if (withoutSuite && withoutSuite !== q) out.push(withoutSuite);

    const withoutCountry = q.replace(/,?\s*(USA|United States|U\.S\.A\.?)\s*$/i, '').trim();
    if (withoutCountry && withoutCountry !== q) out.push(withoutCountry);

    const withoutSuiteCountry = stripSuiteFragment(withoutCountry);
    if (withoutSuiteCountry && withoutSuiteCountry !== q && !out.includes(withoutSuiteCountry)) {
      out.push(withoutSuiteCountry);
    }

    if (parts.length >= 2 && !/\d/.test(parts[0])) {
      out.push(parts.slice(1).join(', '));
    }

    const first = parts[0] || '';
    if (parts.length >= 2 && /\d/.test(first) && !streetSuffix.test(first)) {
      const landmark = first.replace(/^\d+\s+/, '').trim();
      if (landmark && landmark !== first) {
        out.push([landmark, ...parts.slice(1)].join(', '));
      }
      out.push(parts.slice(1).join(', '));
    }

    const zip = q.match(/\b(\d{5})(?:-\d{4})?\b/);
    if (zip) {
      let statePart = parts.find((p) => /^[A-Z]{2}$/i.test(p)) || '';
      if (!statePart) {
        const combo = parts.find((p) => /\b[A-Z]{2}\s+\d{5}\b/i.test(p));
        if (combo) {
          const m = combo.match(/\b([A-Z]{2})\b/i);
          if (m) statePart = m[1].toUpperCase();
        }
      }
      const cityPart = parts.find(
        (p, i) =>
          i > 0 &&
          p !== 'USA' &&
          p !== 'US' &&
          p !== 'United States' &&
          !/^[A-Z]{2}$/i.test(p) &&
          !/^[A-Z]{2}\s+\d{5}/i.test(p) &&
          !/^\d{5}/.test(p),
      );
      if (cityPart && statePart) out.push(`${cityPart}, ${statePart} ${zip[1]}`);
      else if (cityPart) out.push(`${cityPart}, ${statePart ? statePart + ' ' : ''}${zip[1]}`.replace(/,\s+,/, ', '));
    }

    return [...new Set(out.map((s) => s.trim()).filter(Boolean))];
  }

  function readPipelineRowGeocodeQuery(row) {
    const center = readPipelineRowMapCenter(row);
    const variants = geocodeQueryVariants(center);
    const withoutSuite = variants.find((v) => !/#\s*[\w-]/.test(v));
    if (withoutSuite) return withoutSuite;
    if (variants.length > 1) {
      const firstPart = String(center).split(',')[0] || '';
      if (/\d/.test(firstPart) && !/\b(st|street|ave|avenue|rd|road|blvd|dr|drive|way|ln|lane|ct|court)\b/i.test(firstPart)) {
        return variants[1] || variants[0];
      }
    }
    return variants[0] || center;
  }

  function readPipelineRowMapCenter(row) {
    if (!row || !row.dataset) return '';
    const lat = parseFloat(row.dataset.latitude);
    const lng = parseFloat(row.dataset.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return `${lat},${lng}`;
    }
    const addr = readPipelineRowDisplayAddress(row);
    if (addr) return addr;
    const city = String(row.dataset.city || '').trim();
    const state = String(row.dataset.state || '').trim();
    if (city && city !== 'N/A') {
      return state && state !== 'N/A' ? `${city}, ${state}` : city;
    }
    const title = String(row.dataset.title || '').trim();
    if (title && city) return `${title}, ${city}`;
    if (title && state) return `${title}, ${state}`;
    return title || '';
  }

  function readPipelineRowLocationLine(row) {
    const addr = readPipelineRowDisplayAddress(row);
    if (addr) return formatLeadPanelAddress(addr);
    const city = String((row && row.dataset && row.dataset.city) || '').trim();
    const state = String((row && row.dataset && row.dataset.state) || '').trim();
    if (city && city !== 'N/A') {
      return state && state !== 'N/A' ? `${city}, ${state}` : city;
    }
    return '';
  }

  function sanitizeSocialUrl(raw, platform) {
    if (window.AdhelloSocialUrlNormalize && typeof window.AdhelloSocialUrlNormalize.normalizeSocialUrl === 'function') {
      return window.AdhelloSocialUrlNormalize.normalizeSocialUrl(raw, platform);
    }
    const s = String(raw || '').trim();
    return s && s !== 'N/A' && s !== 'undefined' ? s : '';
  }

  /** Normalize scraped addresses that use hyphens between segments (e.g. "Ave- City- ST"). */
  function formatLeadPanelAddress(raw) {
    let s = String(raw || '').trim();
    if (!s || s === '—' || s === 'N/A') return s;
    s = s.replace(/\s*-\s*/g, ', ').replace(/,\s*,+/g, ', ').replace(/^,\s*|,\s*$/g, '').trim();
    return s;
  }

  /** Pretty-print NANP-style numbers for the panel; keep `dataset.phone` as raw digits for click-to-call. */
  function formatLeadPanelPhoneDisplay(raw) {
    const d = String(raw || '').replace(/\D/g, '');
    if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
    if (d.length === 11 && d[0] === '1') return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
    const s = String(raw || '').trim();
    return s || '';
  }

  function leadPhoneDigits(raw) {
    return String(raw || '').replace(/\D/g, '');
  }

  function leadPhonesMatch(a, b) {
    const da = leadPhoneDigits(a);
    const db = leadPhoneDigits(b);
    return !!(da && db && da === db);
  }

  function getLeadContactsList(row) {
    let list = parseRowContacts(row);
    const phone = String(row.dataset.phone || '').trim();
    if (!list.length && phone && phone !== 'N/A') {
      return [
        {
          role: 'Primary',
          name: '',
          phone,
          email: String(row.dataset.email || '').trim(),
          primary: true,
        },
      ];
    }
    return list;
  }

  function getPrimaryPhoneFromRow(row) {
    const list = getLeadContactsList(row);
    const pri = list.find((c) => c.primary && String(c.phone || '').trim());
    return pri ? String(pri.phone).trim() : '';
  }

  function isHeaderPhonePrimary(row, displayPhone) {
    const pri = getLeadContactsList(row).find((c) => c.primary && String(c.phone || '').trim());
    if (!pri) return false;
    return leadPhonesMatch(pri.phone, displayPhone);
  }

  function readPipelineRowDisplayPhone(row) {
    if (!row || !row.dataset) return '';
    const primary = getPrimaryPhoneFromRow(row);
    if (primary && primary !== 'N/A') return primary.replace(/\s+/g, ' ').trim();
    let p = String(row.dataset.phone || '').trim();
    if (p && p !== 'N/A') return p.replace(/\s+/g, ' ').trim();

    if (typeof row.querySelector === 'function') {
      const slot =
        row.querySelector('.lead-contact-phone-slot.js-click-to-call-number') ||
        row.querySelector('a.lead-contact-phone-slot.js-click-to-call-number') ||
        row.querySelector('.js-click-to-call-number[data-phone][data-lead-key]') ||
        row.querySelector('.js-click-to-call-number[data-phone]');
      if (slot) {
        const label = slot.querySelector && slot.querySelector('.lead-contact-phone-label');
        p = String(
          slot.dataset.phone || (label && label.textContent) || slot.textContent || ''
        ).trim();
      }
    }
    if (!p || p === 'N/A' || p === '—') return '';
    return p.replace(/\s+/g, ' ').trim();
  }

  function readPipelineRowDisplayEmail(row) {
    if (!row || !row.dataset) return '';
    let e = String(row.dataset.email || '').trim();
    if (e && e !== 'N/A') return e;
    if (typeof row.querySelector === 'function') {
      const link = row.querySelector('a[href^="mailto:"]');
      if (link) {
        const href = String(link.getAttribute('href') || '').trim();
        e = href.replace(/^mailto:/i, '').split('?')[0].trim();
        if (e && e !== 'N/A') return e;
        const txt = String(link.textContent || '').trim();
        if (txt && txt !== '—' && txt !== 'N/A') return txt;
      }
    }
    return '';
  }

  function readPipelineRowReviewsSnapshot(row) {
    let rating = parseFloat(row.dataset.rating) || 0;
    let reviews = parseInt(row.dataset.reviews, 10) || 0;
    if (row && typeof row.querySelector === 'function' && (rating === 0 || reviews === 0)) {
      const line = row.querySelector('.lead-reviews-line');
      const txt = line ? line.textContent : '';
      const m = txt.match(/([\d]+(?:\.[\d]+)?)\s*\(\s*(\d+)\s*\)/);
      if (m) {
        const domRating = parseFloat(m[1]) || 0;
        const domReviews = parseInt(m[2], 10) || 0;
        if (domRating > 0 && rating === 0) rating = domRating;
        if (domReviews > 0 && reviews === 0) reviews = domReviews;
      } else if (reviews === 0) {
        const m2 = txt.match(/\(\s*(\d+)\s*\)/);
        if (m2) reviews = parseInt(m2[1], 10) || 0;
        const m3 = txt.match(/([\d]+(?:\.[\d]+)?)\s*reviews/i);
        if (m3 && rating === 0) rating = parseFloat(m3[1]) || rating;
      }
    }
    return { rating, reviews };
  }

  /** Hoisted so syncRowReviewsDisplay and GHL sync paths never hit TDZ on panel star helpers. */
  function syncRowReviewsDisplay(row) {
    if (!row || !row.dataset) return;
    const rating = parseFloat(row.dataset.rating) || 0;
    const reviews = parseInt(row.dataset.reviews, 10) || 0;
    const reviewsInner = row.querySelector('.lead-reviews-inner');
    if (reviewsInner && typeof renderLeadsReviewsInnerHtml === 'function') {
      reviewsInner.innerHTML = renderLeadsReviewsInnerHtml(rating, reviews);
      const starEl = reviewsInner.querySelector('.row-stars');
      if (starEl && typeof window.__renderStarsInElement === 'function') {
        window.__renderStarsInElement(starEl, rating);
      }
      return;
    }
    const starContainer = row.querySelector('td .row-stars');
    if (starContainer && typeof renderReviewsCellInner === 'function') {
      const cell = starContainer.closest('td');
      if (cell) {
        cell.innerHTML = renderReviewsCellInner(rating, reviews);
        const starEl = cell.querySelector('.row-stars');
        if (starEl && typeof window.__renderStarsInElement === 'function') {
          window.__renderStarsInElement(starEl, rating);
        }
      }
    }
  }

  function guessLeadPanelTimeZone(row) {
    const addr = readPipelineRowDisplayAddress(row) || String((row && row.dataset && row.dataset.address) || '');
    const m = addr.match(/\b([A-Z]{2})\s+\d{5}\b/);
    if (m && US_STATE_TZ[m[1]]) return US_STATE_TZ[m[1]];
    return 'America/Los_Angeles';
  }

  async function postLeadJsonUpdate(row, patch) {
    const key = row && row.dataset && row.dataset.leadKey;
    if (!key) throw new Error('Save this lead before updating.');
    const res = await fetch(`/leads/${encodeURIComponent(key)}/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(patch || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error((data && data.error) || 'Update failed');
    if (data.lead) syncPersistedLeadToRowDataset(row, data.lead);
    return data;
  }

  function syncLeadPanelLocalTime(row) {
    const el = document.getElementById('leadPanelStickyLocalTime');
    if (!el) return;
    try {
      const tz = guessLeadPanelTimeZone(row);
      const now = new Date();
      const s = now.toLocaleTimeString(undefined, { timeZone: tz, hour: 'numeric', minute: '2-digit' });
      el.textContent = `There now: ${s} (${tz.replace(/^America\//, '').replace(/_/g, ' ')})`;
      el.classList.remove('hidden');
    } catch {
      el.classList.add('hidden');
    }
  }

  function syncHeaderPhoneRow(row, snapPhone) {
    const phone =
      (snapPhone && !isEmptyLeadField(snapPhone) ? String(snapPhone).trim() : '') ||
      readPipelineRowDisplayPhone(row);
    const headerPhone = getLeadPanelEl('mobilePanelHeaderPhone');
    const starBtn = document.getElementById('headerPhonePrimaryStar');
    const lk = row.dataset.leadKey || '';
    if (headerPhone) {
      if (phone) {
        headerPhone.textContent = formatLeadPanelPhoneDisplay(phone);
        headerPhone.href = '#';
        headerPhone.classList.add('js-click-to-call-number');
        headerPhone.dataset.phone = phone.trim();
        if (lk) headerPhone.dataset.leadKey = lk;
        headerPhone.classList.remove('opacity-40', 'pointer-events-none');
      } else {
        headerPhone.textContent = '—';
        headerPhone.href = '#';
        headerPhone.classList.remove('js-click-to-call-number');
        delete headerPhone.dataset.phone;
        delete headerPhone.dataset.leadKey;
        headerPhone.classList.add('opacity-40');
      }
    }
    if (starBtn) {
      const isPri = !!(phone && isHeaderPhonePrimary(row, phone));
      const icon = starBtn.querySelector('.header-phone-star-icon');
      starBtn.disabled = !phone;
      starBtn.classList.toggle('opacity-40', !phone);
      starBtn.classList.toggle('pointer-events-none', !phone);
      starBtn.classList.toggle('text-brand-yellow', isPri);
      starBtn.classList.toggle('border-brand-yellow/50', isPri);
      starBtn.classList.toggle('bg-brand-yellow/10', isPri);
      starBtn.classList.toggle('text-brand-muted', !isPri);
      if (icon) {
        if (isPri) {
          icon.setAttribute('fill', 'currentColor');
          icon.removeAttribute('stroke');
        } else {
          icon.setAttribute('fill', 'none');
          icon.setAttribute('stroke', 'currentColor');
          icon.setAttribute('stroke-width', '2');
        }
      }
      starBtn.setAttribute('aria-pressed', isPri ? 'true' : 'false');
      starBtn.title = isPri ? 'Primary dial number' : 'Set as primary dial number';
    }
    syncHeaderPhoneLinePill(row);
  }

  function syncHeaderPhoneLinePill(row) {
    const pill = document.getElementById('mobilePanelHeaderPhoneLinePill');
    if (!pill) return;
    const pillInfo = resolvePhoneLineTypePill(row);
    if (!pillInfo) {
      pill.classList.add('hidden');
      pill.textContent = '';
      pill.removeAttribute('title');
      return;
    }
    pill.textContent = pillInfo.label;
    pill.title = pillInfo.title;
    pill.className =
      'mt-1 inline-flex px-1.5 py-0.5 rounded-full border text-[8px] font-black uppercase tracking-widest ' +
      pillInfo.pillClass;
    pill.classList.remove('hidden');
  }

  function cleanLeadPanelWebsiteLabel(raw) {
    const s = String(raw || '').trim();
    if (!s || s === 'N/A' || s === '—') return '';
    try {
      const href = normalizeWebsiteHref(s);
      return new URL(href).hostname.replace(/^www\./i, '');
    } catch (_) {
      return s.replace(/^https?:\/\//i, '').replace(/\/$/, '');
    }
  }

  function syncHeaderWebsiteRow(row) {
    const view = getLeadPanelEl('mobilePanelHeaderWebsite');
    if (!view) return;
    const website = readPipelineRowDisplayWebsite(row);
    if (website) {
      const href = normalizeWebsiteHref(website);
      view.href = href;
      view.textContent = cleanLeadPanelWebsiteLabel(href) || 'Website';
      view.classList.remove('opacity-40', 'pointer-events-none');
      view.removeAttribute('aria-disabled');
    } else {
      view.href = '#';
      view.textContent = '—';
      view.classList.add('opacity-40');
      view.classList.remove('pointer-events-none');
    }
  }

  function syncHeaderEmailRow(row) {
    const view = getLeadPanelEl('mobilePanelHeaderEmail');
    if (!view) return;
    const email = readPipelineRowDisplayEmail(row);
    if (email) {
      view.href = `mailto:${encodeURIComponent(email)}`;
      view.textContent = email;
      view.classList.remove('opacity-40', 'pointer-events-none');
      view.removeAttribute('aria-disabled');
    } else {
      view.href = '#';
      view.textContent = '—';
      view.classList.add('opacity-40');
      view.classList.remove('pointer-events-none');
    }
  }

  const LEAD_PANEL_CONTACT_ICON_CLASS =
    'inline-flex items-center justify-center w-9 h-9 rounded-xl border border-brand-border/60 dark:border-white/10 bg-brand-cream/40 dark:bg-slate-800/80 text-brand-dark dark:text-white hover:border-brand-yellow/50 transition-colors shrink-0';

  function renderLeadPanelContactIconSvg(pathD) {
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
      '<path stroke-linecap="round" stroke-linejoin="round" d="' +
      pathD +
      '"/></svg>'
    );
  }

  function renderRowSocialBrandLinksHtml(row, gradSuffix, opts) {
    if (!row || !row.dataset) return '';
    opts = opts || {};
    const suffix =
      gradSuffix != null
        ? String(gradSuffix)
        : String(row.dataset.leadKey || row.id || 'row').replace(/[^a-z0-9]+/gi, '-');
    const mapCenter = readPipelineRowMapCenter(row);
    const mapsHref = resolveGoogleMapsSocialHref(
      row.dataset.url,
      row.dataset.title,
      mapCenter || readPipelineRowDisplayAddress(row) || row.dataset.address,
      row.dataset.city
    );
    const links = {
      gm: mapsHref || '',
      fb: sanitizeSocialUrl(row.dataset.facebook, 'facebook'),
      ig: sanitizeSocialUrl(row.dataset.instagram, 'instagram'),
      tt: sanitizeSocialUrl(row.dataset.tiktok, 'tiktok'),
      tw: sanitizeSocialUrl(row.dataset.twitter, 'twitter'),
      li: sanitizeSocialUrl(row.dataset.linkedin, 'linkedin'),
      gradSuffix: suffix,
      size: opts.size,
      emptyDash: opts.emptyDash,
    };
    if (__socialBrand) {
      const html = __socialBrand.renderLinks(links);
      return html && html.includes('<a ') ? html : '';
    }
    const slot = renderLeadSocialsSlotInner(
      mapsHref,
      row.dataset.facebook,
      row.dataset.instagram,
      row.dataset.twitter,
      row.dataset.title,
      row.dataset.address,
      row.dataset.city,
      suffix
    );
    const m = slot.match(/<div[^>]*>([\s\S]*)<\/div>/);
    if (m) return m[1].includes('<a ') ? m[1] : '';
    return slot.includes('<a ') ? slot : '';
  }

  function renderLeadPanelContactLinksHtml(row) {
    if (!row || !row.dataset) return '';
    const parts = [];
    const website = readPipelineRowDisplayWebsite(row);
    const phone = readPipelineRowDisplayPhone(row);
    const email = readPipelineRowDisplayEmail(row);
    const lk = String(row.dataset.leadKey || '').trim();
    const cls = LEAD_PANEL_CONTACT_ICON_CLASS;

    if (website) {
      const href = normalizeWebsiteHref(website);
      parts.push(
        '<a href="' +
          escapeHtmlAttr(href) +
          '" target="_blank" rel="noopener noreferrer" class="' +
          cls +
          '" title="Website" aria-label="Website">' +
          renderLeadPanelContactIconSvg(
            'M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9'
          ) +
          '</a>'
      );
    }
    if (phone) {
      parts.push(
        '<a href="#" class="' +
          cls +
          ' js-click-to-call-number" data-phone="' +
          escapeHtmlAttr(phone.trim()) +
          '"' +
          (lk ? ' data-lead-key="' + escapeHtmlAttr(lk) + '"' : '') +
          ' title="Call" aria-label="Call">' +
          renderLeadPanelContactIconSvg(
            'M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z'
          ) +
          '</a>'
      );
    }
    if (email) {
      parts.push(
        '<a href="mailto:' +
          encodeURIComponent(email) +
          '" class="' +
          cls +
          '" title="Email" aria-label="Email">' +
          renderLeadPanelContactIconSvg(
            'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z'
          ) +
          '</a>'
      );
    }

    const socialHtml = renderRowSocialBrandLinksHtml(
      row,
      `panel-${String(row.dataset.leadKey || row.id || 'x').replace(/[^a-z0-9]+/gi, '-')}`,
      { size: 'panel', emptyDash: false }
    );
    return parts.join('') + (socialHtml || '');
  }

  function syncLeadPanelContactLinks(row) {
    const el = document.getElementById('leadPanelContactLinks');
    if (!el) return;
    const html = renderLeadPanelContactLinksHtml(row);
    el.innerHTML = html;
    const hasLinks = html && html.includes('<a ');
    el.classList.toggle('hidden', !hasLinks);
  }

  function syncRowSocialsUnderPhone(row) {
    if (!row || typeof row.querySelector !== 'function') return;
    const html = renderRowSocialBrandLinksHtml(row);
    const slot = row.querySelector('.lead-cell-socials-content');
    if (slot) slot.innerHTML = html;
  }

  function syncLeadCallAiAnalyzeCta(row) {
    const wrap = document.getElementById('leadCallAiAnalyzeWrap');
    const btn = document.getElementById('leadCallAiAnalyzeBtn');
    if (!wrap || !btn) return;
    const hasAnalysis = !!getAiAnalysisFromRow(row);
    const hasWebsite = row.dataset.website && row.dataset.website !== 'N/A';
    if (hasWebsite) {
      wrap.classList.remove('hidden');
      btn.textContent = hasAnalysis ? 'Re-run AI analyze' : 'AI analyze';
    } else {
      wrap.classList.add('hidden');
    }
  }

  function syncLeadPanelStickyDock(row) {
    const meta = document.getElementById('leadPanelStickyMeta');
    if (meta) {
      const pipe = String(row.dataset.pipelineLabel || row.dataset.pipelineStage || '').trim();
      const st = String(row.dataset.status || '').trim();
      const ms = parseInt(row.dataset.lastTouchMs || '', 10);
      const bits = [];
      if (pipe) bits.push(pipe);
      if (st) bits.push(st);
      if (ms && Number.isFinite(ms)) {
        try {
          bits.push(
            `Last activity ${new Date(ms).toLocaleString(undefined, {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}`
          );
        } catch (_) {
          /* skip last activity if date invalid */
        }
      }
      if (!bits.length) {
        meta.textContent = '';
        meta.classList.add('hidden');
        meta.setAttribute('aria-hidden', 'true');
      } else {
        meta.textContent = bits.join(' · ');
        meta.classList.remove('hidden');
        meta.removeAttribute('aria-hidden');
      }
    }
    syncLeadPanelLocalTime(row);
    if (typeof window.__adhelloSyncRecordingControls === 'function') {
      window.__adhelloSyncRecordingControls();
    }
  }

  function syncLeadCallTalkingPoints(row) {
    const ul = document.getElementById('leadCallTalkingPoints');
    if (!ul) return;
    ul.innerHTML = '';
    const revDom = readPipelineRowReviewsSnapshot(row);
    const reviews = revDom.reviews || parseInt(row.dataset.reviews, 10) || 0;
    const rating = revDom.rating || parseFloat(row.dataset.rating) || 0;
    const web = String(row.dataset.website || '').trim();
    const hasWeb = web && web !== 'N/A' && web.length > 2;
    const add = (text) => {
      const li = document.createElement('li');
      li.className = 'pl-3 border-l-2 border-brand-yellow/50 text-brand-dark dark:text-slate-200';
      li.textContent = text;
      ul.appendChild(li);
    };
    if (reviews > 0) {
      add(`${reviews} Google reviews${rating > 0 ? ` at ${rating.toFixed(1)}★` : ''} — social proof angle.`);
    }
    add(hasWeb ? 'Website on file — reference something specific from their site.' : 'No website on file — lead with missed calls / credibility gap.');
    const flags = [];
    if (row.dataset.hasChatbot === 'false') flags.push('no chatbot');
    if (row.dataset.isMobileFriendly === 'false') flags.push('mobile issues');
    if (row.dataset.hasClickToCall === 'false') flags.push('click-to-call broken');
    if (row.dataset.hasSchemaMarkup === 'false') flags.push('GEO schema weak');
    if (flags.length) add(`Technical hooks: ${flags.join(', ')}.`);
  }

  function syncGoogleReviewsLink(row) {
    const a = getLeadPanelEl('mobilePanelReviewsLink');
    if (!a) return;
    const addr = readPipelineRowDisplayAddress(row);
    const href = resolveLeadPanelMapsHref(row, addr);
    if (href) {
      a.href = href;
      a.classList.remove('opacity-40', 'pointer-events-none', 'cursor-not-allowed');
    } else {
      a.href = '#';
      a.classList.add('opacity-40', 'pointer-events-none', 'cursor-not-allowed');
    }
  }

  let leadPrimaryServiceSelectPopulated = false;
  function ensureLeadPanelPrimaryServiceSelectOptions(force) {
    const sel = document.getElementById('leadPanelPrimaryServiceSelect');
    if (!sel) return;
    const offers = Array.isArray(window.ADHELLO_SERVICE_OFFERS) ? window.ADHELLO_SERVICE_OFFERS : [];
    if (!offers.length) return;
    const needRebuild = force || sel.options.length <= 1;
    if (!needRebuild && leadPrimaryServiceSelectPopulated) return;
    const prev = sel.value;
    sel.innerHTML = '<option value="">Let AI recommend…</option>';
    offers.forEach((o) => {
      if (!o || !o.key) return;
      const opt = document.createElement('option');
      opt.value = String(o.key);
      opt.textContent = o.label || o.key;
      sel.appendChild(opt);
    });
    leadPrimaryServiceSelectPopulated = true;
    if (prev && Array.from(sel.options).some((o) => o.value === prev)) sel.value = prev;
  }

  function syncLeadPrimaryServiceSelect(row) {
    ensureLeadPanelPrimaryServiceSelectOptions();
    const sel = document.getElementById('leadPanelPrimaryServiceSelect');
    if (!sel || !row) return;
    const v = String(row.dataset.primaryServiceKey || '').trim();
    const has = Array.from(sel.options).some((o) => o.value === v);
    sel.value = has ? v : '';
  }

  function syncOwnerFirstNameAndDnc(row) {
    const inp = document.getElementById('leadPanelOwnerFirstName');
    const dnc = document.getElementById('leadPanelDoNotCall');
    const raw = String(row.dataset.ownerFirstName || '').trim();
    const cqi = parseRowCqi(row);
    const fromCqi = cqi && String(cqi.decisionMakerName || '').trim();
    const firstFromFull = (full) => {
      const t = String(full || '').trim();
      if (!t) return '';
      return t.split(/\s+/)[0];
    };
    const fallback = firstFromFull(fromCqi);
    if (inp) inp.value = raw || fallback;
    if (dnc) dnc.checked = row.dataset.doNotCall === '1' || row.dataset.doNotCall === 'true';
  }

  function parseRowContacts(row) {
    try {
      const raw = row.dataset.contacts;
      if (!raw || raw === 'undefined') return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function formatActivityTypeLabel(typ, raw) {
    const t = String(typ || '').toLowerCase();
    const map = {
      quick_log: 'Quick log',
      note: 'Note',
      call_disposition: 'Call',
      status_change: 'Pipeline',
      call_browser_handoff: 'Call',
      sms_outbound: 'SMS',
      sms_inbound: 'SMS',
      email_outbound: 'Email',
      email_inbound: 'Email',
      direct_mail_outbound: 'Direct mail',
      engagement_signal: 'Engagement',
    };
    if (map[t]) return map[t];
    if (t === 'quick_log' && raw && raw.disposition) return 'Quick log · call';
    if (t === 'direct_mail_outbound' || t === 'info_pack_direct_mail' || t === 'direct_mail_sent') {
      return 'Direct mail';
    }
    return String(typ || 'update').replace(/_/g, ' ');
  }

  function formatActivityEntryText(entry) {
    const u = entry && entry.raw ? entry.raw : {};
    const typ = String(entry.typ || '').toLowerCase();
    if (typ === 'quick_log') {
      const label = String(u.value || entry.text || '').trim();
      const bits = [label];
      if (u.disposition) bits.push(`Disposition: ${String(u.disposition).replace(/_/g, ' ')}`);
      if (u.statusChange) bits.push(`Status → ${u.statusChange}`);
      return bits.filter(Boolean).join(' · ');
    }
    if (
      typ === 'direct_mail_outbound' ||
      typ === 'info_pack_direct_mail' ||
      typ === 'direct_mail_sent'
    ) {
      const rawText = String(entry.text || '').trim();
      if (/^psc_[a-f0-9]+$/i.test(rawText)) {
        const qr = u.qrRedirectUrl ? ' · QR' : '';
        return `Lob postcard queued (${rawText})${qr}`;
      }
    }
    return String(entry.text || '').trim();
  }

  function activityEntryTextFromRaw(u) {
    if (!u || typeof u !== 'object') return '';
    if (u.value != null && String(u.value).trim()) return String(u.value);
    if (u.content != null && String(u.content).trim()) return String(u.content);
    if (u.message != null && String(u.message).trim()) return String(u.message);
    if (u.note != null && String(u.note).trim()) return String(u.note);
    return '';
  }

  const DIRECT_MAIL_TYPES = new Set([
    'direct_mail_outbound',
    'direct_mail_queued',
    'direct_mail_sent',
    'info_pack_direct_mail',
  ]);

  function extractPostcardId(entry) {
    const raw = entry && entry.raw ? entry.raw : {};
    const fromRaw = String(raw.postcardId || '').trim();
    if (/^psc_[a-f0-9]+$/i.test(fromRaw)) return fromRaw.toLowerCase();
    const text = String(entry && entry.text ? entry.text : '').trim();
    const m = text.match(/(psc_[a-f0-9]+)/i);
    return m ? m[1].toLowerCase() : '';
  }

  function directMailRichnessScore(entry) {
    const text = String(entry.text || '').trim();
    if (/lob postcard|postcard (queued|sent)|info pack postcard/i.test(text)) return 3;
    if (text.length > 24) return 2;
    if (/^psc_[a-f0-9]+$/i.test(text)) return 1;
    return 1;
  }

  function directMailMergeKey(entry) {
    const typ = String(entry.typ || '').toLowerCase();
    if (!DIRECT_MAIL_TYPES.has(typ)) return '';
    const id = extractPostcardId(entry);
    if (id) return `dm:${id}`;
    const tsMs = Date.parse(entry.ts) || 0;
    if (typ === 'direct_mail_queued' && tsMs) return `dm:queued:${Math.floor(tsMs / 1000)}`;
    return '';
  }

  function pickRicherDirectMailEntry(a, b) {
    return directMailRichnessScore(b) > directMailRichnessScore(a) ? b : a;
  }

  function mergeActivityEntries(row) {
    const out = [];
    const seen = new Set();
    const directMailIndex = new Map();
    const pushUnique = (entry) => {
      const text = String(entry.text || '').trim();
      if (!text) return;
      const dmKey = directMailMergeKey(entry);
      if (dmKey) {
        const idx = directMailIndex.get(dmKey);
        if (idx != null) {
          out[idx] = pickRicherDirectMailEntry(out[idx], entry);
          return;
        }
      }
      const tsMs = Date.parse(entry.ts) || 0;
      const bucket = tsMs ? Math.floor(tsMs / 1000) : String(entry.ts || '');
      const key = `${bucket}|${text.toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (dmKey) directMailIndex.set(dmKey, out.length);
      out.push(entry);
    };
    const updates = readMergedRowUpdates(row);
    (Array.isArray(updates) ? updates : []).forEach((u) => {
      const ts = u.timestamp || u.ts || u.createdAt || '';
      const val = activityEntryTextFromRaw(u);
      const typ = String(u.type || 'update');
      pushUnique({ ts, typ, text: val, raw: u });
    });
    let logs = [];
    if (row && row.dataset) {
      try {
        logs = JSON.parse(row.dataset.logsSnippet || '[]');
      } catch {
        logs = [];
      }
    }
    (Array.isArray(logs) ? logs : []).forEach((e) => {
      const ts = e.timestamp || '';
      const msg = typeof e.message === 'string' ? e.message : JSON.stringify(e).slice(0, 220);
      const typ = String(e.type || 'log');
      pushUnique({ ts, typ, text: msg, raw: e });
    });
    out.sort((a, b) => {
      const ta = Date.parse(a.ts) || 0;
      const tb = Date.parse(b.ts) || 0;
      return tb - ta;
    });
    return out;
  }

  function getLeadActivityLogHost() {
    const panel = getLeadDetailPanel();
    if (panel) {
      const scoped = panel.querySelector('#activityLog');
      if (scoped) return scoped;
    }
    return document.getElementById('activityLog');
  }

  const QUICK_LOG_PILL_LABELS =
    (window.__QUICK_LOG && window.__QUICK_LOG.pillLabelsPattern) ||
    'Gatekeeper|No pickup|Left VM|Not interested|Callback requested|DM connected|Send info|Site audit';

  function isQuickLogMirroredNote(entry) {
    const typ = String(entry.typ || '').toLowerCase();
    if (typ === 'quick_log') return true;
    const raw = entry.raw || {};
    if (raw.disposition || raw.statusChange) return true;
    const text = String(entry.text || '').trim();
    if (
      new RegExp(`^\\[[^\\]]+\\]\\s+(${QUICK_LOG_PILL_LABELS})\\s*$`, 'i').test(text)
    ) {
      return true;
    }
    return false;
  }

  function isManualPanelNote(entry) {
    const typ = String(entry.typ || '').toLowerCase();
    const raw = entry.raw || {};
    if (typ === 'quick_log') return false;
    if (isQuickLogMirroredNote(entry)) return false;
    if (typ === 'call_disposition' || typ === 'status_change') return false;
    if (/^sequence|^cadence/i.test(typ)) return false;
    if (raw.source === 'panel_post' || raw.manual === true) return true;
    if (typ === 'note' && raw.source !== 'quick_log_pill') return true;
    return ['user_note', 'post', 'comment', 'manual_note'].includes(typ);
  }

  function activityEntryMatchesFilter(entry, filter) {
    const f = String(filter || 'all');
    if (f === 'all') return true;
    const typ = String(entry.typ || '').toLowerCase();
    const text = String(entry.text || '').toLowerCase();
    const blob = `${typ} ${text}`;
    if (f === 'calls') {
      if (typ === 'quick_log' && entry.raw && entry.raw.disposition) return true;
      return (
        /(^|_)(call|dial|phone|voicemail|sms|text_message|telephony)(_|$|\b)/i.test(typ) ||
        /\b(called|calling|dialed|dial|voicemail|softphone|telephony|phone touch)\b/i.test(blob)
      );
    }
    if (f === 'notes') {
      return isManualPanelNote(entry);
    }
    if (f === 'engagement') {
      if (typ === 'engagement_signal') return true;
      if (typ === 'sms_inbound' || typ === 'email_inbound') return true;
      return /\b(email open|link click|sms reply|email reply|audit open|qr scan|postcard|mail scan|engagement)\b/i.test(blob);
    }
    if (f === 'merges') {
      return false;
    }
    return true;
  }

  function syncLeadActivityFilterButtons(filter) {
    const f = String(filter || 'all');
    document.querySelectorAll('#mobilePanel .lead-activity-filter').forEach((b) => {
      const on = (b.getAttribute('data-activity-filter') || 'all') === f;
      b.classList.toggle('bg-white', on);
      b.classList.toggle('dark:bg-slate-900', on);
      b.classList.toggle('text-brand-dark', on);
      b.classList.toggle('dark:text-white', on);
      b.classList.toggle('shadow-sm', on);
      b.classList.toggle('text-brand-muted', !on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function renderLeadActivityTimeline(row, filter) {
    const f = String(filter || window.__leadActivityFilter || 'all');
    if (f === 'merges') {
      syncLeadActivityFilterButtons(f);
      const activityRow = row || resolveLeadPanelNoteRow();
      if (typeof window.__adhelloPaintLeadPanelMerges === 'function') {
        const host = getLeadActivityLogHost();
        window.__adhelloPaintLeadPanelMerges(activityRow, host);
      }
      return;
    }
    if (typeof window.__adhelloPaintLeadPanelNotes === 'function') {
      if (row && window.__adhelloLeadPanelNotes && typeof window.__adhelloLeadPanelNotes.syncFromRow === 'function') {
        window.__adhelloLeadPanelNotes.syncFromRow(row, filter);
        return;
      }
      window.__adhelloPaintLeadPanelNotes(filter);
      return;
    }
    const host = getLeadActivityLogHost();
    if (!host) return;

    const activityRow = row || resolveLeadPanelNoteRow();
    const entries = mergeActivityEntries(activityRow);
    const filtered = entries.filter((e) => activityEntryMatchesFilter(e, f));
    if (!filtered.length) {
      const emptyMsg =
        f === 'notes'
          ? 'No notes yet. Post one in Note · Post below, or switch to All to see calls and pipeline activity.'
          : f === 'calls'
            ? 'No call activity logged yet. Use Call, Quick log tags, or switch to All.'
            : f === 'engagement'
              ? 'No engagement signals yet — email opens, clicks, replies, and audit views appear here.'
              : 'No activity yet. Post a note, log a call, or update pipeline status.';
      host.innerHTML = `<div class="pl-10 text-xs text-brand-muted italic leading-relaxed">${emptyMsg}</div>`;
      const countElEmpty = document.getElementById('activityLogCount');
      if (countElEmpty) {
        countElEmpty.textContent = '';
        countElEmpty.classList.add('hidden');
      }
      return;
    }

    const scrollHost = document.getElementById('activityLogScroll');
    if (scrollHost) scrollHost.scrollTop = 0;

    host.innerHTML = filtered
      .map((e) => {
        const when = e.ts
          ? new Date(e.ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
          : '—';
        const typeLabel = formatActivityTypeLabel(e.typ, e.raw);
        const body = formatActivityEntryText(e)
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        const canDelete = isManualPanelNote(e);
        const deleteBtn = canDelete
          ? `<button type="button" class="lead-activity-note-delete shrink-0 opacity-70 hover:opacity-100 text-[9px] font-black uppercase tracking-widest text-rose-500 hover:text-rose-600 dark:text-rose-400 dark:hover:text-rose-300 transition-opacity px-1.5 py-0.5 rounded-md hover:bg-rose-500/10" data-note-ts="${escapeHtmlAttr(String(e.ts || ''))}" data-note-value="${escapeHtmlAttr(encodeURIComponent(String(e.text || '')))}" aria-label="Delete this note">Delete</button>`
          : '';
        return `<div class="relative pl-10 pb-1 group/activity">
          <div class="absolute left-1 top-1 w-2.5 h-2.5 rounded-full bg-brand-yellow shadow-sm ring-2 ring-white dark:ring-slate-900"></div>
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0 flex-1">
              <p class="text-[9px] font-black uppercase tracking-widest text-brand-muted">${when} · ${typeLabel}</p>
              <p class="text-xs font-semibold text-brand-dark dark:text-slate-200 mt-1 leading-relaxed">${body}</p>
            </div>
            ${deleteBtn}
          </div>
        </div>`;
      })
      .join('');

    const countEl = document.getElementById('activityLogCount');
    if (countEl) {
      if (filtered.length > 4) {
        countEl.textContent = `${filtered.length} entries — scroll for more`;
        countEl.classList.remove('hidden');
      } else {
        countEl.textContent = '';
        countEl.classList.add('hidden');
      }
    }
  }
  window.renderLeadActivityTimeline = renderLeadActivityTimeline;

  function syncLeadPanelTouchSummary(row) {
    const el = document.getElementById('leadPanelTouchSummary');
    if (!el) return;
    let logs = [];
    try {
      logs = JSON.parse(row.dataset.logsSnippet || '[]');
    } catch {
      logs = [];
    }
    const total = Array.isArray(logs) ? logs.length : 0;
    let calls = 0;
    let connects = 0;
    (Array.isArray(logs) ? logs : []).forEach((e) => {
      const blob = `${e.type || ''} ${e.message || ''}`.toLowerCase();
      if (/\bcall|dial|voicemail|phone\b/.test(blob)) calls += 1;
      if (/connect|picked up|answered|meeting booked/.test(blob)) connects += 1;
    });
    const ms = parseInt(row.dataset.lastTouchMs || '', 10);
    const hasTouchMs = !!(ms && Number.isFinite(ms));
    let ago = '';
    if (hasTouchMs) {
      const days = Math.max(0, Math.round((Date.now() - ms) / 86400000));
      ago = days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`;
    }
    const hasActivityNoise = total > 0 || calls > 0 || connects > 0;
    if (!hasActivityNoise && !hasTouchMs) {
      el.textContent = '';
      el.classList.add('hidden');
      el.setAttribute('aria-hidden', 'true');
    } else {
      const segments = [];
      if (hasActivityNoise) {
        segments.push(`${calls} phone touches · ${connects} connect signals · ${total} log lines`);
      }
      if (hasTouchMs && ago) segments.push(`Last touch ${ago}`);
      el.textContent = segments.join(' · ');
      el.classList.remove('hidden');
      el.removeAttribute('aria-hidden');
    }
    const badge = document.getElementById('leadPanelCallCountsBadge');
    if (badge) {
      if (!hasActivityNoise) {
        badge.textContent = '';
        badge.classList.add('hidden');
      } else {
        badge.textContent = `${calls} dials · ${total} events`;
        badge.classList.remove('hidden');
      }
    }
  }

  let leadDetailChromeDidInit = false;

  function initLeadDetailPanelChrome() {
    if (leadDetailChromeDidInit) return;
    leadDetailChromeDidInit = true;

    bindLeadPanelBottomActions();
    ensureCadencePlaybookDataReady().then(() => {
      if (currentRow) syncCadencePlaybookPanel(currentRow);
    });

    document.querySelectorAll('#leadPanelWhatToSellCard .lead-outreach-channel').forEach((btn) => {
      if (btn.dataset.adhelloChannelBound) return;
      btn.dataset.adhelloChannelBound = '1';
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        setLeadOutreachChannel(btn.getAttribute('data-outreach-channel') || 'call');
        onLeadPanelOutreachScriptInputsChanged(currentRow);
      });
    });

    void fetchWorkspaceOutreachLibrary()
      .catch(() => null)
      .then(() => {
        if (currentRow) applyLeadPanelSellingScriptNow(currentRow);
      });

    document.querySelectorAll('[data-lead-tab-panel]').forEach((panel) => {
      panel.classList.remove('hidden');
    });

    bindLeadPanelSectionNav();
    bindLeadPanelContactDetailsToggle();

    const cqiIds = [
      'cqiFieldDecisionMaker',
      'cqiFieldYearsInBusiness',
      'cqiFieldMonthlyRevenue',
      'cqiFieldMarketingSpend',
      'cqiFieldBiggestPain',
      'cqiFieldCurrentlyUsing',
      'cqiFieldBudgetRange',
      'cqiFieldTimeline',
      'cqiFieldNotes',
    ];
    let cqiTimer = null;
    const scheduleCqiSave = () => {
      if (cqiTimer) clearTimeout(cqiTimer);
      cqiTimer = setTimeout(async () => {
        if (!currentRow || !currentRow.dataset.leadKey) return;
        const prev = parseRowCqi(currentRow) || {};
        const next = { ...prev, ...readCqiFormFromDom(), recordedAt: new Date().toISOString() };
        try {
          await postLeadJsonUpdate(currentRow, { cqi: next });
          currentRow.dataset.cqi = JSON.stringify(next);
          syncMobilePanelCqi(currentRow);
        } catch (e) {
          if (typeof window.showAppToast === 'function') window.showAppToast(e.message || 'CQI save failed', { variant: 'error' });
        }
      }, 500);
    };
    cqiIds.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', scheduleCqiSave);
      el.addEventListener('blur', scheduleCqiSave);
    });

    const ownerInp = document.getElementById('leadPanelOwnerFirstName');
    if (ownerInp) {
      const saveOwner = async () => {
        if (!currentRow || !currentRow.dataset.leadKey) return;
        const v = String(ownerInp.value || '').trim();
        try {
          await postLeadJsonUpdate(currentRow, { ownerFirstName: v });
          currentRow.dataset.ownerFirstName = v;
        } catch (e) {
          if (typeof window.showAppToast === 'function') window.showAppToast(e.message || 'Save failed', { variant: 'error' });
        }
      };
      ownerInp.addEventListener('blur', saveOwner);
      ownerInp.addEventListener('input', () => {
        if (currentRow) refreshLeadPanelSellingScript(currentRow, { cacheOnly: true });
      });
    }
    const dnc = document.getElementById('leadPanelDoNotCall');
    if (dnc) {
      dnc.addEventListener('change', async () => {
        if (!currentRow || !currentRow.dataset.leadKey) return;
        try {
          await postLeadJsonUpdate(currentRow, { doNotCall: !!dnc.checked });
          currentRow.dataset.doNotCall = dnc.checked ? '1' : '';
        } catch (e) {
          if (typeof window.showAppToast === 'function') window.showAppToast(e.message || 'Save failed', { variant: 'error' });
        }
      });
    }

    const leadRec = document.getElementById('leadPanelRecordToggle');
    if (leadRec) {
      leadRec.addEventListener('click', () => {
        if (typeof window.__adhelloToggleCloudRecording === 'function') {
          window.__adhelloToggleCloudRecording();
        }
      });
    }

    const primaryServSel = document.getElementById('leadPanelPrimaryServiceSelect');
    if (primaryServSel && !primaryServSel.dataset.adhelloBound) {
      primaryServSel.dataset.adhelloBound = '1';
      primaryServSel.addEventListener('change', async () => {
        if (!currentRow) return;
        const val = String(primaryServSel.value || '').trim();
        if (currentRow.dataset) currentRow.dataset.primaryServiceKey = val || '';
        onLeadPanelOutreachScriptInputsChanged(currentRow, { skipLoading: true });
        if (!currentRow.dataset.leadKey) return;
        try {
          await postLeadJsonUpdate(currentRow, { primaryServiceKey: val || null });
          scheduleKieServiceInsight(currentRow);
          if (typeof window.showProspectToast === 'function') {
            window.showProspectToast(val ? 'Offer focus saved' : 'AI recommendation enabled');
          }
        } catch (e) {
          if (typeof window.showAppToast === 'function') {
            window.showAppToast(e && e.message ? e.message : 'Failed', { variant: 'error' });
          }
          syncLeadPrimaryServiceSelect(currentRow);
        }
      });
    }

    const headerPhoneStar = document.getElementById('headerPhonePrimaryStar');
    if (headerPhoneStar && !headerPhoneStar.dataset.bound) {
      headerPhoneStar.dataset.bound = '1';
      headerPhoneStar.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!currentRow || !currentRow.dataset.leadKey) return;
        const displayPhone = readPipelineRowDisplayPhone(currentRow);
        if (!displayPhone) return;
        if (isHeaderPhonePrimary(currentRow, displayPhone)) {
          if (typeof window.showAppToast === 'function') {
            window.showAppToast('This number is already your primary dial number.', { variant: 'info' });
          }
          return;
        }
        let list = getLeadContactsList(currentRow).map((c) => ({ ...c }));
        let idx = list.findIndex((c) => leadPhonesMatch(c.phone, displayPhone));
        if (idx < 0) {
          list.push({
            role: 'Primary',
            name: '',
            phone: displayPhone,
            email: String(currentRow.dataset.email || '').trim(),
            primary: true,
          });
          idx = list.length - 1;
        }
        const next = list.map((c, j) => ({ ...c, primary: j === idx }));
        try {
          await postLeadJsonUpdate(currentRow, { contacts: next });
          currentRow.dataset.contacts = JSON.stringify(next);
          syncHeaderPhoneRow(currentRow);
          if (typeof window.showAppToast === 'function') {
            window.showAppToast('Primary dial number saved.', { variant: 'success' });
          }
        } catch (err) {
          if (typeof window.showAppToast === 'function') {
            window.showAppToast(err && err.message ? err.message : 'Could not save primary number', { variant: 'error' });
          }
        }
      });
    }

    const sellingCopyBtn = document.getElementById('leadPanelSellingScriptCopy');
    if (sellingCopyBtn && !sellingCopyBtn.dataset.adhelloBound) {
      sellingCopyBtn.dataset.adhelloBound = '1';
      sellingCopyBtn.addEventListener('click', async () => {
        const scriptEl = document.getElementById('leadPanelSellingScript');
        const helper = typeof window !== 'undefined' ? window.AdHelloScripts : null;
        const html = scriptEl ? String(scriptEl.innerHTML || '').trim() : '';
        const text = scriptEl ? String(scriptEl.textContent || '').trim() : '';
        if (!text) return;
        try {
          if (helper && helper.copyScriptFormatted && html) {
            await helper.copyScriptFormatted(html);
          } else {
            await navigator.clipboard.writeText(text);
          }
          if (typeof window.showAppToast === 'function') {
            window.showAppToast('Script copied.', { variant: 'success' });
          }
        } catch (_) {
          if (typeof window.showAppToast === 'function') {
            window.showAppToast('Could not copy script.', { variant: 'error' });
          }
        }
      });
    }
  }

  if (document.getElementById('leadPanelTabScroll')) {
    initLeadDetailPanelChrome();
  }

  /** Maps listing URL if stored; otherwise a Google Maps search URL from address/title (matches detail panel socials). */
  function resolveGoogleMapsSocialHref(urlRaw, titleRaw, addressRaw, cityRaw) {
    const isGoogleMapsListingUrl = (absUrl) => {
      try {
        const u = new URL(absUrl);
        const h = u.hostname.replace(/^www\./, '').toLowerCase();
        if (h === 'maps.app.goo.gl') return true;
        if (h === 'goo.gl' && u.pathname.includes('maps')) return true;
        if (h.endsWith('google.com') || h.endsWith('google.co.uk')) {
          if (u.pathname.includes('/maps/')) return true;
          if (u.search.includes('cid=') || u.search.includes('q=place_id:')) return true;
        }
        return false;
      } catch {
        return false;
      }
    };
    const raw = String(urlRaw || '').trim();
    if (raw && /^https?:\/\//i.test(raw) && isGoogleMapsListingUrl(raw)) {
      return raw;
    }
    const title = String(titleRaw || '').trim();
    const address = String(addressRaw || '').trim();
    const city = String(cityRaw || '').trim();
    if (address && address !== 'N/A') {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${address} ${title}`.trim())}`;
    }
    if (title && city) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${title} ${city}`.trim())}`;
    }
    if (title) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(title)}`;
    }
    return null;
  }

  const GOOGLE_BUSINESS_ICON_SVG =
    (__socialBrand && __socialBrand.GOOGLE_BUSINESS_ICON_SVG) ||
    '<svg class="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>';

  const GOOGLE_SOCIALS_TABLE_BTN_CLASS =
    (__socialBrand && __socialBrand.GOOGLE_SOCIALS_TABLE_BTN_CLASS) ||
    'inline-flex w-8 h-8 shrink-0 rounded-lg bg-brand-cream dark:bg-slate-800 items-center justify-center shadow-sm border border-brand-border/10 hover:bg-[#4285F4]/15 dark:hover:bg-[#4285F4]/25 transition-all hover:scale-105';

  function loadAdhelloGoogleMapsJs(cb) {
    const key = String(
      (typeof window !== 'undefined' && window.__ADHELLO_GOOGLE_MAPS_STATIC_KEY__) || ''
    ).trim();
    if (!key) {
      cb(new Error('no_maps_key'));
      return;
    }
    if (typeof window !== 'undefined' && window.AdhelloMaps && typeof window.AdhelloMaps.load === 'function') {
      window.AdhelloMaps.load(key, cb);
      return;
    }
    if (typeof window !== 'undefined' && window.google && window.google.maps) {
      cb(null);
      return;
    }
    cb(new Error('maps_loader_missing'));
  }

  let __leadPanelJsMap = null;
  let __leadPanelJsMarker = null;
  let __leadPanelJsGeocoder = null;
  let __leadPanelJsControlsBound = false;
  let __leadPanelJsMapResizeObserver = null;
  let __leadPanelStripMapLoadGen = 0;
  let __leadPanelStripMapLoadKey = '';
  let __leadPanelWideMapSyncTimer = null;

  function disposeLeadPanelJsMap() {
    if (__leadPanelJsMapResizeObserver) {
      try {
        __leadPanelJsMapResizeObserver.disconnect();
      } catch (_) {}
      __leadPanelJsMapResizeObserver = null;
    }
    if (__leadPanelJsMarker) {
      try {
        __leadPanelJsMarker.setMap(null);
      } catch (_) {}
      __leadPanelJsMarker = null;
    }
    __leadPanelJsMap = null;
    __leadPanelJsGeocoder = null;
  }

  function observeLeadPanelJsMapResize() {
    const wrap = document.getElementById('leadPanelJsMapWrap');
    if (!wrap || typeof ResizeObserver === 'undefined') return;
    if (__leadPanelJsMapResizeObserver) {
      try {
        __leadPanelJsMapResizeObserver.disconnect();
      } catch (_) {}
    }
    __leadPanelJsMapResizeObserver = new ResizeObserver(() => resizeLeadPanelJsMapSoon());
    __leadPanelJsMapResizeObserver.observe(wrap);
  }

  function whenLeadPanelMapHostReady(fn, attempt) {
    const n = typeof attempt === 'number' ? attempt : 0;
    const panel = getLeadDetailPanel();
    const el = document.getElementById('leadPanelJsMap');
    const wrap = document.getElementById('leadPanelJsMapWrap');
    const panelOpen =
      panel &&
      panel.classList.contains('open') &&
      !panel.classList.contains('hidden');
    const wrapVisible = wrap && !wrap.classList.contains('hidden');
    const sized = el && el.offsetWidth >= 48 && el.offsetHeight >= 48;
    if (panelOpen && wrapVisible && sized) {
      fn();
      return;
    }
    if (n >= 28) {
      fn();
      return;
    }
    setTimeout(() => whenLeadPanelMapHostReady(fn, n + 1), 40 + n * 30);
  }

  function bindLeadPanelJsMapControlsOnce() {
    if (__leadPanelJsControlsBound) return;
    __leadPanelJsControlsBound = true;
    const zIn = document.getElementById('leadPanelMapZoomIn');
    const zOut = document.getElementById('leadPanelMapZoomOut');
    if (zIn) {
      zIn.addEventListener('click', () => {
        if (!__leadPanelJsMap) return;
        __leadPanelJsMap.setZoom((__leadPanelJsMap.getZoom() || 12) + 1);
      });
    }
    if (zOut) {
      zOut.addEventListener('click', () => {
        if (!__leadPanelJsMap) return;
        __leadPanelJsMap.setZoom(Math.max(4, (__leadPanelJsMap.getZoom() || 12) - 1));
      });
    }
  }

  function resizeLeadPanelJsMapSoon() {
    if (!__leadPanelJsMap || typeof google === 'undefined' || !google.maps) return;
    const trigger = () => {
      try {
        const center = __leadPanelJsMap.getCenter();
        google.maps.event.trigger(__leadPanelJsMap, 'resize');
        if (center) __leadPanelJsMap.setCenter(center);
      } catch (_) {}
    };
    requestAnimationFrame(() => {
      requestAnimationFrame(trigger);
    });
    [80, 200, 400, 700].forEach((ms) => setTimeout(trigger, ms));
    try {
      google.maps.event.addListenerOnce(__leadPanelJsMap, 'idle', trigger);
    } catch (_) {}
  }

  function parseLeadPanelMapLatLng(opts, centerQ) {
    const lat = opts && Number.isFinite(opts.lat) ? opts.lat : NaN;
    const lng = opts && Number.isFinite(opts.lng) ? opts.lng : NaN;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }
    const m = String(centerQ || '').match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (!m) return null;
    const pLat = parseFloat(m[1]);
    const pLng = parseFloat(m[2]);
    if (!Number.isFinite(pLat) || !Number.isFinite(pLng)) return null;
    return { lat: pLat, lng: pLng };
  }

  function applyLeadPanelMapViewport(loc, geometry, opts) {
    if (!__leadPanelJsMap || !loc) return;
    if (geometry && geometry.viewport) {
      __leadPanelJsMap.fitBounds(geometry.viewport);
    } else {
      __leadPanelJsMap.setCenter(loc);
      __leadPanelJsMap.setZoom(15);
    }
    if (__leadPanelJsMarker) {
      try {
        __leadPanelJsMarker.setMap(null);
      } catch (_) {}
    }
    __leadPanelJsMarker = new google.maps.Marker({
      map: __leadPanelJsMap,
      position: loc,
      title: (opts && (opts.title || opts.address)) || '',
    });
    resizeLeadPanelJsMapSoon();
  }

  function initLeadPanelInteractiveGoogleMap(opts, onFail) {
    const el = document.getElementById('leadPanelJsMap');
    const openLink = document.getElementById('leadPanelJsMapOpenLink');
    const centerQ = opts && String(opts.center || '').trim();
    if (!el || !centerQ) {
      if (typeof onFail === 'function') onFail();
      return;
    }
    if (openLink && opts.mapsHref) openLink.href = opts.mapsHref;
    bindLeadPanelJsMapControlsOnce();

    loadAdhelloGoogleMapsJs((err) => {
      if (err || typeof google === 'undefined' || !google.maps) {
        if (typeof onFail === 'function') onFail();
        return;
      }
      try {
        disposeLeadPanelJsMap();
        __leadPanelJsMap = new google.maps.Map(el, {
          zoom: 15,
          center: { lat: 45.5152, lng: -122.6784 },
          gestureHandling: 'greedy',
          mapTypeControl: true,
          mapTypeControlOptions: {
            position: google.maps.ControlPosition.TOP_RIGHT,
          },
          zoomControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          fullscreenControlOptions: {
            position: google.maps.ControlPosition.TOP_RIGHT,
          },
        });
        __leadPanelJsGeocoder = new google.maps.Geocoder();
        el.style.width = '100%';
        el.style.height = '100%';
        observeLeadPanelJsMapResize();
        resizeLeadPanelJsMapSoon();

        const direct = parseLeadPanelMapLatLng(opts, centerQ);
        if (direct) {
          applyLeadPanelMapViewport(direct, null, opts);
          return;
        }

        __leadPanelJsGeocoder.geocode({ address: centerQ }, (results, status) => {
          if (status !== 'OK' || !results || !results[0]) {
            if (typeof onFail === 'function') onFail();
            return;
          }
          const geo = results[0].geometry;
          const loc = geo.location;
          applyLeadPanelMapViewport(
            { lat: loc.lat(), lng: loc.lng() },
            geo,
            opts
          );
        });
      } catch (e) {
        console.warn('[Lead panel interactive map]', e);
        if (typeof onFail === 'function') onFail();
      }
    });
  }

  function leadPanelEmbedSrcForQuery(centerQuery, mapKey, useKeyless) {
    const q = String(centerQuery || '').trim();
    if (!q) return '';
    const k = useKeyless ? '' : String(mapKey || '').trim();
    if (typeof window !== 'undefined' && window.AdhelloMaps && window.AdhelloMaps.embedSrc) {
      return window.AdhelloMaps.embedSrc(q, k);
    }
    if (k) {
      return `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(k)}&q=${encodeURIComponent(q)}&zoom=15&maptype=roadmap`;
    }
    return `https://www.google.com/maps?q=${encodeURIComponent(q)}&hl=en&z=15&output=embed`;
  }

  function syncLeadPanelStripEmbedMap(opts) {
    const img = document.getElementById('leadPanelMapStaticImg');
    const fallback = document.getElementById('leadPanelMapEmbedFallback');
    const openLink = document.getElementById('leadPanelJsMapOpenLink');
    const centerQ = String((opts && opts.center) || '').trim();
    const geocodeQ = String((opts && opts.geocodeCenter) || centerQ || '').trim();
    const lat = opts && Number.isFinite(opts.lat) ? opts.lat : NaN;
    const lng = opts && Number.isFinite(opts.lng) ? opts.lng : NaN;
    const mapKey =
      (typeof window !== 'undefined' && window.__ADHELLO_GOOGLE_MAPS_STATIC_KEY__) || '';
    if (!img || (!geocodeQ && !centerQ && !(Number.isFinite(lat) && Number.isFinite(lng)))) return false;

    const loadKey = [centerQ, geocodeQ, lat, lng].join('|');
    if (loadKey === __leadPanelStripMapLoadKey && img.src && !img.classList.contains('hidden')) {
      if (openLink && opts && opts.mapsHref) openLink.href = opts.mapsHref;
      return true;
    }
    __leadPanelStripMapLoadKey = loadKey;
    const loadGen = ++__leadPanelStripMapLoadGen;
    const isCurrentLoad = () => loadGen === __leadPanelStripMapLoadGen;

    disposeLeadPanelJsMap();

    if (openLink && opts && opts.mapsHref) openLink.href = opts.mapsHref;

    const iframe = document.getElementById('leadPanelMapEmbed');

    const showFallback = () => {
      if (!isCurrentLoad()) return;
      img.onload = null;
      img.onerror = null;
      img.removeAttribute('src');
      img.classList.add('hidden');
      if (iframe) {
        iframe.removeAttribute('src');
        iframe.classList.add('hidden');
      }
      if (fallback) {
        fallback.classList.remove('hidden');
        fallback.classList.add('flex');
      }
    };

    const revealMapSurface = () => {
      if (!isCurrentLoad()) return;
      if (fallback) {
        fallback.classList.add('hidden');
        fallback.classList.remove('flex');
      }
    };

    const loadPreviewImage = (previewUrl, onFail) => {
      img.alt = opts && opts.address
        ? `Map near ${String(opts.address).slice(0, 120)}`
        : opts && opts.title
          ? `Location of ${opts.title}`
          : 'Location map';
      img.onload = () => {
        if (!isCurrentLoad()) return;
        if (iframe) {
          iframe.removeAttribute('src');
          iframe.classList.add('hidden');
        }
        img.classList.remove('hidden');
        revealMapSurface();
      };
      img.onerror = () => {
        if (!isCurrentLoad()) return;
        if (typeof onFail === 'function') onFail();
      };
      img.classList.add('hidden');
      img.src = previewUrl;
    };

    const loadStaticFallbacks = (onExhausted) => {
      const params = new URLSearchParams();
      if (geocodeQ) params.set('center', geocodeQ);
      if (centerQ && centerQ !== geocodeQ) params.set('q', centerQ);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        params.set('lat', String(lat));
        params.set('lng', String(lng));
      }
      params.set('w', '640');
      params.set('h', '300');

      loadPreviewImage(`/leads/map-preview?${params.toString()}`, () => {
        if (!isCurrentLoad()) return;
        if (typeof onExhausted === 'function') onExhausted();
        else showFallback();
      });
    };

    if (iframe) {
      iframe.onload = null;
      iframe.onerror = null;
      iframe.removeAttribute('src');
      iframe.classList.add('hidden');
    }
    if (fallback) {
      fallback.classList.add('hidden');
      fallback.classList.remove('flex');
    }

    loadStaticFallbacks(showFallback);
    return true;
  }

  function syncLeadPanelInteractiveGoogleMap(opts, onFail) {
    whenLeadPanelMapHostReady(() => initLeadPanelInteractiveGoogleMap(opts, onFail));
  }

  function scheduleSyncLeadPanelWideMap(row) {
    if (!row) return;
    if (__leadPanelWideMapSyncTimer) clearTimeout(__leadPanelWideMapSyncTimer);
    try {
      syncLeadPanelWideMapAndGoogleChip(row);
    } catch (mapErr) {
      console.warn('[Lead panel] map strip failed:', mapErr);
    }
    __leadPanelWideMapSyncTimer = setTimeout(() => {
      __leadPanelWideMapSyncTimer = null;
      try {
        syncLeadPanelWideMapAndGoogleChip(row);
      } catch (_) {}
    }, 420);
  }

  function syncLeadPanelWideMapAndGoogleChip(row) {
    const mapKey =
      (typeof window !== 'undefined' && window.__ADHELLO_GOOGLE_MAPS_STATIC_KEY__) || '';
    const title = String(row.dataset.title || '').trim();
    const address = readPipelineRowDisplayAddress(row);
    const city = String(row.dataset.city || '').trim();
    const center = readPipelineRowMapCenter(row);
    const geocodeCenter = readPipelineRowGeocodeQuery(row);
    const rowLat = parseFloat(row.dataset.latitude);
    const rowLng = parseFloat(row.dataset.longitude);
    const mapsUrl = center
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(center)}`
      : '';
    const gmListing = resolveGoogleMapsSocialHref(
      row.dataset.url,
      row.dataset.title,
      center || address || row.dataset.address,
      row.dataset.city
    );
    const chipHref = gmListing || mapsUrl || '';

    const hrefOpen = chipHref || mapsUrl || '';
    const mapStripWrap = document.getElementById('leadPanelMapStripWrap');
    const setLeadPanelMapEmbedMode = (on) => {
      if (!mapStripWrap) return;
      mapStripWrap.classList.toggle('lead-panel-map-embed-mode', !!on);
    };
    const jsMapWrap = document.getElementById('leadPanelJsMapWrap');
    const heroBackdropEl = document.getElementById('leadPanelHeroBackdrop');
    const preferStripEmbedMap = !!(hrefOpen && String(center || '').trim());

    if (mapStripWrap) {
      mapStripWrap.classList.toggle('lead-panel-hero-map', !!hrefOpen);
      mapStripWrap.classList.toggle('hidden', !hrefOpen);
      mapStripWrap.classList.toggle('lead-panel-strip-map-mode', !!(hrefOpen && preferStripEmbedMap));
      mapStripWrap.classList.remove('lead-panel-js-map-mode');
    }

    const heroLink = document.getElementById('leadPanelHeroBackdropLink');
    const heroImg = document.getElementById('leadPanelHeroBackdropImg');
    const heroEmbed = document.getElementById('leadPanelHeroBackdropEmbed');
    const heroFallback = document.getElementById('leadPanelHeroBackdropFallback');
    let headerMapBannerActive = false;

    /** Matches Focus page embed behavior; Embed API when key is configured (enable Maps Embed API on the key). */
    const heroEmbedSrcForQuery = (centerQuery, useKeyless) =>
      leadPanelEmbedSrcForQuery(centerQuery, mapKey, useKeyless);

    if (heroLink && heroImg && heroFallback && heroEmbed) {
      const paintHeroBackdrop = () => {
        setLeadPanelMapEmbedMode(false);
        heroImg.onload = null;
        heroImg.onerror = null;
        heroImg.removeAttribute('src');
        heroImg.classList.add('hidden');
        heroEmbed.removeAttribute('src');
        heroEmbed.classList.add('hidden');
        heroFallback.classList.add('hidden');
        heroFallback.classList.remove('flex', 'flex-col');

        if (!hrefOpen) {
          heroLink.href = '#';
          heroLink.classList.add('pointer-events-none');
          headerMapBannerActive = false;
        } else {
          headerMapBannerActive = true;
          heroLink.href = hrefOpen;
          heroLink.classList.remove('pointer-events-none');

          const showHeroPinFallback = () => {
            setLeadPanelMapEmbedMode(false);
            heroImg.classList.add('hidden');
            heroImg.removeAttribute('src');
            heroEmbed.removeAttribute('src');
            heroEmbed.classList.add('hidden');
            heroFallback.classList.add('hidden');
            heroFallback.classList.remove('flex', 'flex-col');
          };

          const openHeroEmbed = (useKeyless) => {
            if (!center) return false;
            heroImg.classList.add('hidden');
            heroImg.removeAttribute('src');
            heroEmbed.onload = null;
            heroEmbed.onerror = null;
            const src = heroEmbedSrcForQuery(geocodeCenter || center, useKeyless);
            if (!src) return false;
            heroEmbed.onerror = function onHeroEmbedErr() {
              heroEmbed.onerror = null;
              heroEmbed.removeAttribute('src');
              heroEmbed.classList.add('hidden');
              if (!useKeyless && mapKey) openHeroEmbed(true);
              else showHeroPinFallback();
            };
            heroEmbed.src = src;
            heroEmbed.title = address
              ? `Map · ${address.slice(0, 100)}`
              : title
                ? `Location · ${title}`
                : 'Business location';
            heroEmbed.classList.remove('hidden');
            setLeadPanelMapEmbedMode(true);
            heroFallback.classList.add('hidden');
            heroFallback.classList.remove('flex', 'flex-col');
            return true;
          };

          const previewUrl = buildLeadPanelMapPreviewUrl({
            center,
            geocodeCenter,
            lat: Number.isFinite(rowLat) ? rowLat : undefined,
            lng: Number.isFinite(rowLng) ? rowLng : undefined,
            w: 640,
            h: 320,
          });
          if (previewUrl) {
            heroImg.onload = () => {
              setLeadPanelMapEmbedMode(false);
              heroImg.classList.remove('hidden');
              heroEmbed.removeAttribute('src');
              heroEmbed.classList.add('hidden');
              heroFallback.classList.add('hidden');
              heroFallback.classList.remove('flex', 'flex-col');
            };
            heroImg.onerror = () => {
              heroImg.classList.add('hidden');
              heroImg.removeAttribute('src');
              if (!openHeroEmbed(false)) showHeroPinFallback();
            };
            heroImg.alt = address
              ? `Map near ${address.slice(0, 120)}`
              : title
                ? `Location of ${title}`
                : 'Location map';
            requestAnimationFrame(() => {
              heroImg.src = previewUrl;
            });
          } else if (openHeroEmbed(false)) {
            /* embedded map fallback */
          } else {
            showHeroPinFallback();
          }
        }
      };

      if (!hrefOpen) {
        if (jsMapWrap) jsMapWrap.classList.add('hidden');
        if (heroBackdropEl) heroBackdropEl.classList.add('hidden');
        paintHeroBackdrop();
      } else if (preferStripEmbedMap) {
        if (jsMapWrap) jsMapWrap.classList.remove('hidden');
        if (heroBackdropEl) heroBackdropEl.classList.add('hidden');
        setLeadPanelMapEmbedMode(true);
        heroImg.onload = null;
        heroImg.onerror = null;
        heroImg.removeAttribute('src');
        heroImg.classList.add('hidden');
        heroEmbed.removeAttribute('src');
        heroEmbed.classList.add('hidden');
        heroFallback.classList.add('hidden');
        heroFallback.classList.remove('flex', 'flex-col');
        heroLink.href = hrefOpen;
        heroLink.classList.remove('pointer-events-none');
        headerMapBannerActive = true;

        syncLeadPanelStripEmbedMap({
          center,
          geocodeCenter,
          mapsHref: hrefOpen,
          title,
          address,
          lat: Number.isFinite(rowLat) ? rowLat : undefined,
          lng: Number.isFinite(rowLng) ? rowLng : undefined,
        });
      } else {
        if (jsMapWrap) jsMapWrap.classList.add('hidden');
        if (heroBackdropEl) heroBackdropEl.classList.remove('hidden');
        paintHeroBackdrop();
      }
    }

    const chipRow = document.getElementById('mobilePanelGoogleMapsChipRow');
    const chip = document.getElementById('mobilePanelGoogleMapsChip');
    const hideDuplicateMapsChip = !!(chipHref && hrefOpen && center.trim());
    if (chip && chipRow) {
      if (chipHref) {
        chip.href = chipHref;
        chip.innerHTML = `${GOOGLE_BUSINESS_ICON_SVG}<span class="text-[11px] font-bold normal-case tracking-normal text-brand-dark dark:text-slate-200">Google Maps</span>`;
        chipRow.classList.toggle('hidden', hideDuplicateMapsChip);
      } else {
        chip.innerHTML = '';
        chip.href = '#';
        chipRow.classList.add('hidden');
      }
    }

    const wrap = document.getElementById('mobilePanelMapWideWrap');
    const wideLink = document.getElementById('mobilePanelMapWideLink');
    const wideImg = document.getElementById('mobilePanelMapWideImg');
    const fallback = document.getElementById('mobilePanelMapWideFallback');
    if (!wrap || !wideLink || !wideImg || !fallback) return;

    wideImg.onload = null;
    wideImg.onerror = null;
    wideImg.removeAttribute('src');
    wideImg.classList.add('hidden');
    fallback.style.display = 'none';

    if (!chipHref && !center) {
      wrap.classList.add('hidden');
      return;
    }

    if (headerMapBannerActive) {
      wrap.classList.add('hidden');
      return;
    }

    wideLink.href = chipHref || mapsUrl || '#';
    wrap.classList.remove('hidden');

    const showStaticFallback = () => {
      wideImg.classList.add('hidden');
      wideImg.removeAttribute('src');
      fallback.style.display = 'none';
    };

    const previewUrl = buildLeadPanelMapPreviewUrl({
      center,
      geocodeCenter,
      lat: Number.isFinite(rowLat) ? rowLat : undefined,
      lng: Number.isFinite(rowLng) ? rowLng : undefined,
      w: 640,
      h: 280,
    });
    if (previewUrl) {
      wideImg.onload = () => {
        wideImg.classList.remove('hidden');
        fallback.style.display = 'none';
      };
      wideImg.onerror = () => {
        showStaticFallback();
      };
      wideImg.alt = address
        ? `Map near ${address.slice(0, 120)}`
        : title
          ? `Location of ${title}`
          : 'Location map';
      requestAnimationFrame(() => {
        wideImg.src = previewUrl;
      });
    } else {
      showStaticFallback();
    }
  }

  const CADENCE_CHANNEL_LABELS = {
    call: 'Phone call',
    email: 'Email',
    sms: 'SMS',
    social_dm: 'Social DM',
    linkedin: 'LinkedIn',
    hosted_audit: 'Emailed Audit',
    voicemail: 'Voicemail',
    meeting: 'Meeting',
    other: 'Other',
  };

  function getSequenceTemplates() {
    return Array.isArray(window.ADHELLO_SEQUENCE_TEMPLATES)
      ? window.ADHELLO_SEQUENCE_TEMPLATES
      : [];
  }

  function findSequenceTemplate(templateId) {
    const id = String(templateId || '').trim();
    if (!id) return null;
    return getSequenceTemplates().find((t) => t && t.id === id) || null;
  }

  function resolveTemplateSteps(tpl) {
    if (!tpl) return [];
    if (Array.isArray(tpl.steps) && tpl.steps.length) return tpl.steps;
    const id = String(tpl.id || '').trim();
    if (!id) return [];
    const full = getSequenceTemplates().find(
      (t) => t && t.id === id && Array.isArray(t.steps) && t.steps.length
    );
    if (full) return full.steps;
    const n = tpl.stepCount != null ? Number(tpl.stepCount) : 0;
    if (Number.isFinite(n) && n > 0) {
      return Array.from({ length: n }, (_, i) => ({
        dayOffset: i,
        channel: '',
        title: `Step ${i + 1}`,
        hint: '',
      }));
    }
    return [];
  }

  function parseRowSequenceState(row) {
    if (!row || !row.dataset) return null;
    try {
      const raw = row.dataset.sequenceState;
      if (!raw || raw === 'null' || raw === 'undefined') return null;
      const o = JSON.parse(raw);
      return o && typeof o === 'object' ? o : null;
    } catch {
      return null;
    }
  }

  let cadencePlaybookSelectPopulated = false;
  let cadencePlaybookFetchPromise = null;

  function cadencePlaybookSelectNeedsOptions(sel) {
    if (!sel || !sel.options || !sel.options.length) return true;
    if (sel.options.length > 1) return false;
    const only = sel.options[0];
    const label = only ? String(only.textContent || '').trim() : '';
    const val = only ? String(only.value || '').trim() : '';
    if (!val || /loading playbooks/i.test(label) || /no playbooks loaded/i.test(label)) return true;
    return false;
  }

  function applyCadencePlaybookTemplatesToSelect(templates, sel) {
    if (!sel) return;
    const list = Array.isArray(templates) ? templates.filter((t) => t && t.id) : [];
    if (!list.length) {
      sel.innerHTML = '<option value="">No playbooks loaded</option>';
      cadencePlaybookSelectPopulated = false;
      return;
    }
    const prev = sel.value;
    sel.innerHTML = '';
    list.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = String(t.id);
      const steps = t.stepCount != null ? t.stepCount : (t.steps && t.steps.length) || 0;
      opt.textContent = `${t.persona || 'Cadence'} · ${t.name || t.id} (${steps} steps)`;
      sel.appendChild(opt);
    });
    cadencePlaybookSelectPopulated = true;
    if (prev && Array.from(sel.options).some((o) => o.value === prev)) sel.value = prev;
    else if (sel.options.length) sel.value = sel.options[0].value;
  }

  function cadenceTemplatesIncludeSteps() {
    const templates = getSequenceTemplates();
    return templates.some((t) => t && Array.isArray(t.steps) && t.steps.length > 0);
  }

  async function fetchCadencePlaybookTemplates() {
    if (cadenceTemplatesIncludeSteps()) return getSequenceTemplates();
    if (cadencePlaybookFetchPromise) return cadencePlaybookFetchPromise;
    cadencePlaybookFetchPromise = fetch('/sequences/templates.json', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (data && data.success && Array.isArray(data.templates) && data.templates.length) {
          window.ADHELLO_SEQUENCE_TEMPLATES = data.templates;
          return data.templates;
        }
        return [];
      })
      .catch(() => [])
      .finally(() => {
        cadencePlaybookFetchPromise = null;
      });
    return cadencePlaybookFetchPromise;
  }

  function ensureCadencePlaybookSelectOptions(opts) {
    const options = opts || {};
    const sel = document.getElementById('leadCadencePlaybookSelect');
    if (!sel) return Promise.resolve();

    const prerendered = sel.dataset.playbooksPrerendered === '1';
    if (prerendered && !cadencePlaybookSelectNeedsOptions(sel)) {
      cadencePlaybookSelectPopulated = true;
      return Promise.resolve();
    }

    let templates = getSequenceTemplates();
    if (!templates.length && !options.skipFetch) {
      return fetchCadencePlaybookTemplates().then((fetched) => {
        templates = fetched.length ? fetched : getSequenceTemplates();
        applyCadencePlaybookTemplatesToSelect(templates, sel);
      });
    }

    if (!cadencePlaybookSelectNeedsOptions(sel) && cadencePlaybookSelectPopulated) {
      return Promise.resolve();
    }

    applyCadencePlaybookTemplatesToSelect(templates, sel);
    return Promise.resolve();
  }

  function cadenceSequenceStepIndex(seq) {
    if (!seq || seq.stepIndex == null || seq.stepIndex === '') return 0;
    const n = Number(seq.stepIndex);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  }

  function formatCadencePlaybookStatusMessage(seq, templateId) {
    if (!seq || !seq.templateId) return '';
    const tid = String(templateId || seq.templateId || '').trim();
    const tpl = findSequenceTemplate(tid);
    const name = tpl ? tpl.name : tid.replace(/_/g, ' ');
    const steps = tpl ? resolveTemplateSteps(tpl) : [];
    const total = steps.length || (tpl && tpl.stepCount ? Number(tpl.stepCount) : 0);
    const ix = cadenceSequenceStepIndex(seq);
    const step = steps[ix];
    const stepNum = ix + 1;
    const status = String(seq.status || '').trim();

    if (status === 'paused') {
      let msg = `Playbook paused: ${name}`;
      if (total) msg += ` — paused on step ${stepNum} of ${total}`;
      if (step && step.title) msg += `: ${step.title}`;
      return msg;
    }
    if (status === 'completed') {
      return total
        ? `Playbook complete: ${name} (${total} steps finished)`
        : `Playbook complete: ${name}`;
    }

    let msg = `Playbook started: ${name}`;
    if (total) {
      const stepTitle = step && step.title ? step.title : `Touch ${stepNum}`;
      msg += ` — Step ${stepNum} of ${total}: ${stepTitle}`;
      if (step && step.channel) {
        const ch =
          CADENCE_CHANNEL_LABELS[String(step.channel).trim()] ||
          String(step.channel).replace(/_/g, ' ');
        msg += ` (${ch})`;
      }
    }
    if (seq.nextDueAt && status === 'active') {
      try {
        msg += ` · Next due ${new Date(seq.nextDueAt).toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })}`;
      } catch {
        msg += ` · Next due ${seq.nextDueAt}`;
      }
    }
    return msg;
  }

  function showCadencePlaybookStatus(row, templateId, seqOverride) {
    const status = document.getElementById('leadCadenceActiveStatus');
    if (!status) return '';
    const seq = seqOverride || (row ? parseRowSequenceState(row) : null);
    const tid = String(templateId || (seq && seq.templateId) || '').trim();
    const msg = formatCadencePlaybookStatusMessage(seq, tid);
    if (!msg) {
      status.textContent = '';
      status.classList.add('hidden');
      return '';
    }
    status.textContent = msg;
    status.classList.remove('hidden');
    try {
      status.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (_) {}
    return msg;
  }

  function syncCadencePlaybookPanel(row) {
    const sel = document.getElementById('leadCadencePlaybookSelect');
    const desc = document.getElementById('leadCadencePlaybookDesc');
    const startBtn = document.getElementById('sidebarCadenceStartBtn');
    if (!sel) return;

    const seq = row ? parseRowSequenceState(row) : null;
    const active = !!(seq && seq.status === 'active');
    const paused = !!(seq && seq.status === 'paused');
    const completed = !!(seq && seq.status === 'completed');

    let selectedId = String(sel.value || '').trim();
    if (seq && seq.templateId) {
      selectedId = String(seq.templateId);
      if (Array.from(sel.options).some((o) => o.value === selectedId)) sel.value = selectedId;
    } else if (!selectedId && sel.options.length) {
      selectedId = sel.options[0].value;
      sel.value = selectedId;
    }

    const tpl = findSequenceTemplate(selectedId);
    if (desc) {
      desc.textContent = tpl
        ? tpl.description || tpl.name || selectedId
        : selectedId
          ? `Playbook ${selectedId}`
          : 'Choose a playbook, then start it for this lead.';
    }

    if (seq && (active || paused || completed) && seq.templateId) {
      showCadencePlaybookStatus(row, selectedId, seq);
    } else {
      showCadencePlaybookStatus(row, '', null);
    }

    if (startBtn) {
      startBtn.disabled = !selectedId;
      startBtn.setAttribute('aria-disabled', !selectedId ? 'true' : 'false');
      startBtn.textContent = active ? 'Restart playbook' : 'Start playbook';
      startBtn.title = !selectedId
        ? 'Choose a playbook first'
        : active
          ? 'Replaces the current active sequence from step 1'
          : 'Attach this playbook and schedule step 1 (saves lead if needed)';
    }

    renderCadencePlaybookSteps(row, { requireActive: false });
  }

  function cadenceNextStepFromSequence(row, seq) {
    if (!seq || seq.status !== 'active') return '';
    const tpl = findSequenceTemplate(seq.templateId);
    const steps = resolveTemplateSteps(tpl);
    if (!steps.length) return '';
    const ix = cadenceSequenceStepIndex(seq);
    const step = steps[ix];
    if (!step) return '';
    const ch = step.channel ? String(step.channel).replace(/_/g, ' ') : 'touch';
    let line = `Step ${ix + 1}/${steps.length}: ${step.title || ch} (${ch})`;
    if (seq.nextDueAt) {
      try {
        const due = new Date(seq.nextDueAt);
        if (!Number.isNaN(due.getTime())) {
          line += ` · due ${due.toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })}`;
        }
      } catch {
        /* skip */
      }
    }
    if (step.hint) line += `. ${String(step.hint).slice(0, 160)}${step.hint.length > 160 ? '…' : ''}`;
    return line;
  }

  function cadenceHintFromChannel(channel) {
    const ch = String(channel || '').trim();
    if (ch === 'email') {
      return 'If no reply within 48 hours, follow with a quick call or DM referencing the same hook.';
    }
    if (ch === 'call' || ch === 'voicemail') {
      return 'Send a short email with one concrete observation and a soft calendar ask.';
    }
    if (ch === 'sms') {
      return 'Pair SMS with email so stakeholders have something forwardable.';
    }
    if (ch === 'linkedin') {
      return 'Bridge to email or phone while you have attention — send the audit link or book 15 minutes.';
    }
    if (ch === 'social_dm') {
      return 'Move the thread toward email or a call for clear next steps.';
    }
    if (ch === 'meeting') {
      return 'Send a recap with owners and dates before the deal goes idle.';
    }
    return 'Alternate channels every few days until you connect or get a clear outcome — log each touch.';
  }

  function cadenceChannelBadgeClass(channel) {
    const ch = String(channel || '').trim();
    const map = {
      call: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-200 border-emerald-500/25',
      voicemail: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20',
      email: 'bg-sky-500/15 text-sky-800 dark:text-sky-200 border-sky-500/25',
      sms: 'bg-amber-500/15 text-amber-900 dark:text-amber-200 border-amber-500/25',
      linkedin: 'bg-blue-500/15 text-blue-800 dark:text-blue-200 border-blue-500/25',
      social_dm: 'bg-fuchsia-500/15 text-fuchsia-800 dark:text-fuchsia-200 border-fuchsia-500/25',
      meeting: 'bg-violet-500/15 text-violet-800 dark:text-violet-200 border-violet-500/25',
      hosted_audit: 'bg-brand-yellow/20 text-brand-dark dark:text-brand-yellow border-brand-yellow/30',
      task: 'bg-slate-500/15 text-slate-700 dark:text-slate-200 border-slate-500/25',
    };
    return map[ch] || 'bg-brand-cream/80 text-brand-muted dark:text-slate-300 border-brand-border/40';
  }

  function resolveCadenceStepState(stepIndex, seq, seqMatches) {
    if (!seqMatches || !seq) {
      return stepIndex === 0 ? 'preview' : 'upcoming';
    }
    if (seq.status === 'completed') return 'done';
    const ix = cadenceSequenceStepIndex(seq);
    if (seq.status === 'paused') {
      if (stepIndex < ix) return 'done';
      if (stepIndex === ix) return 'paused';
      return 'upcoming';
    }
    if (seq.status === 'active') {
      if (stepIndex < ix) return 'done';
      if (stepIndex === ix) return 'current';
      return 'upcoming';
    }
    return stepIndex === 0 ? 'preview' : 'upcoming';
  }

  function renderCadencePlaybookSteps(row, opts) {
    const options = opts || {};
    const wrap = document.getElementById('cadencePlaybookStepsWrap');
    const list = document.getElementById('cadencePlaybookStepsList');
    const stepsHeading = document.getElementById('cadencePlaybookStepsHeading');
    const stepsHint = document.getElementById('cadencePlaybookStepsHint');
    const nextLineEl = document.getElementById('cadenceNextStepLine');
    const nextWrap = nextLineEl ? nextLineEl.closest('.rounded-2xl') : null;
    if (!wrap || !list) return;

    const sel = document.getElementById('leadCadencePlaybookSelect');
    const selectedId = sel ? String(sel.value || '').trim() : '';
    const tpl = findSequenceTemplate(selectedId);
    const steps = resolveTemplateSteps(tpl);
    const seq = row ? parseRowSequenceState(row) : null;
    const seqMatches = !!(seq && seq.templateId && String(seq.templateId) === selectedId);
    const seqActive =
      seqMatches && seq && (seq.status === 'active' || seq.status === 'paused' || seq.status === 'completed');

    if (!tpl || !steps.length) {
      wrap.classList.add('hidden');
      list.innerHTML = '';
      if (stepsHint) stepsHint.classList.add('hidden');
      if (nextWrap) nextWrap.classList.remove('hidden');
      return;
    }

    if (options.requireActive && !seqActive) {
      wrap.classList.add('hidden');
      list.innerHTML = '';
      if (stepsHint) stepsHint.classList.add('hidden');
      if (nextWrap) nextWrap.classList.remove('hidden');
      return;
    }
    const activeOther =
      seq &&
      seq.templateId &&
      String(seq.templateId) !== selectedId &&
      (seq.status === 'active' || seq.status === 'paused');

    wrap.classList.remove('hidden');
    list.innerHTML = '';

    if (stepsHeading) {
      stepsHeading.textContent = seqActive
        ? 'Touches to complete'
        : 'Touches in this playbook';
    }
    if (stepsHint) {
      if (seqActive && seq.status === 'active') {
        stepsHint.textContent =
          'Complete each step and log activity on the lead. Your current step is highlighted.';
        stepsHint.classList.remove('hidden');
      } else if (seqActive && seq.status === 'paused') {
        stepsHint.textContent = 'Cadence is paused — resume when you are ready to continue the steps below.';
        stepsHint.classList.remove('hidden');
      } else if (seqActive && seq.status === 'completed') {
        stepsHint.textContent = 'This playbook is complete. You can restart from the cadence controls above.';
        stepsHint.classList.remove('hidden');
      } else {
        stepsHint.textContent =
          'Press Start playbook above to schedule these touches. Step 1 is where you begin.';
        stepsHint.classList.remove('hidden');
      }
    }
    if (nextWrap) {
      if (seqActive && seq.status === 'active') nextWrap.classList.add('hidden');
      else nextWrap.classList.remove('hidden');
    }

    if (activeOther) {
      const otherTpl = findSequenceTemplate(seq.templateId);
      const otherName = otherTpl ? otherTpl.name : String(seq.templateId).replace(/_/g, ' ');
      const note = document.createElement('li');
      note.className =
        'text-[10px] font-semibold text-amber-800 dark:text-amber-200 rounded-lg border border-amber-400/35 bg-amber-50/80 dark:bg-amber-950/30 px-3 py-2 mb-1 list-none';
      note.textContent = `Another playbook is active (${otherName}). Steps below are for the selected playbook — start it to switch.`;
      list.appendChild(note);
    }

    steps.forEach((step, i) => {
      const state = resolveCadenceStepState(i, seq, seqMatches);
      const ch = String(step.channel || '').trim();
      const chLabel = CADENCE_CHANNEL_LABELS[ch] || ch.replace(/_/g, ' ') || 'Touch';
      const title = step.title || `Step ${i + 1}`;
      const day =
        step.dayOffset != null && step.dayOffset !== ''
          ? `Day ${Number(step.dayOffset) + 1}`
          : `Step ${i + 1}`;

      const li = document.createElement('li');
      li.className = 'cadence-playbook-step flex gap-3 rounded-xl border px-3 py-2.5 transition-colors';
      li.setAttribute('role', 'listitem');
      li.dataset.stepIndex = String(i);
      li.dataset.stepState = state;

      const stateStyles = {
        done: 'border-emerald-500/30 bg-emerald-500/[0.06] dark:bg-emerald-950/25 opacity-90',
        current:
          'border-violet-500 ring-2 ring-violet-500/35 bg-violet-500/[0.12] dark:bg-violet-950/40 shadow-sm',
        paused:
          'border-amber-500/40 ring-2 ring-amber-500/25 bg-amber-500/[0.08] dark:bg-amber-950/30',
        preview: 'border-violet-300/40 bg-violet-500/[0.05] dark:bg-violet-950/20 border-dashed',
        upcoming: 'border-brand-border/25 dark:border-white/10 bg-white/40 dark:bg-slate-900/30',
      };
      li.className += ` ${stateStyles[state] || stateStyles.upcoming}`;

      const marker = document.createElement('div');
      marker.className =
        'shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black tabular-nums';
      if (state === 'done') {
        marker.className += ' bg-emerald-600 text-white';
        marker.innerHTML =
          '<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>';
        marker.setAttribute('aria-label', `Step ${i + 1} complete`);
      } else if (state === 'current') {
        marker.className += ' bg-violet-600 text-white animate-pulse';
        marker.textContent = String(i + 1);
        marker.setAttribute('aria-label', `Step ${i + 1}, current`);
      } else if (state === 'paused') {
        marker.className += ' bg-amber-500 text-white';
        marker.textContent = String(i + 1);
        marker.setAttribute('aria-label', `Step ${i + 1}, paused`);
      } else {
        marker.className += ' bg-brand-cream dark:bg-slate-800 text-brand-muted dark:text-slate-400 border border-brand-border/40';
        marker.textContent = String(i + 1);
        marker.setAttribute('aria-label', `Step ${i + 1}`);
      }

      const body = document.createElement('div');
      body.className = 'min-w-0 flex-1';
      const head = document.createElement('div');
      head.className = 'flex flex-wrap items-center gap-2 mb-0.5';
      const titleEl = document.createElement('p');
      titleEl.className =
        state === 'current' || state === 'paused'
          ? 'text-xs font-black text-brand-dark dark:text-white leading-snug'
          : 'text-xs font-bold text-brand-dark dark:text-slate-200 leading-snug';
      titleEl.textContent = title;
      const badge = document.createElement('span');
      badge.className = `inline-flex px-1.5 py-0.5 rounded-md border text-[9px] font-black uppercase tracking-wider ${cadenceChannelBadgeClass(
        ch
      )}`;
      badge.textContent = chLabel;
      const dayEl = document.createElement('span');
      dayEl.className = 'text-[9px] font-bold text-brand-muted dark:text-slate-400 tabular-nums';
      dayEl.textContent = day;
      head.appendChild(titleEl);
      head.appendChild(badge);
      head.appendChild(dayEl);

      if (state === 'current') {
        const now = document.createElement('span');
        now.className =
          'inline-flex px-1.5 py-0.5 rounded-md bg-violet-600 text-white text-[8px] font-black uppercase tracking-widest';
        now.textContent = 'Current';
        head.appendChild(now);
      } else if (state === 'paused') {
        const paused = document.createElement('span');
        paused.className =
          'inline-flex px-1.5 py-0.5 rounded-md bg-amber-500 text-white text-[8px] font-black uppercase tracking-widest';
        paused.textContent = 'Paused here';
        head.appendChild(paused);
      } else if (state === 'preview' && i === 0) {
        const start = document.createElement('span');
        start.className =
          'inline-flex px-1.5 py-0.5 rounded-md border border-violet-400/50 text-violet-800 dark:text-violet-200 text-[8px] font-black uppercase tracking-widest';
        start.textContent = 'Starts here';
        head.appendChild(start);
      }

      body.appendChild(head);
      if (step.hint) {
        const hint = document.createElement('p');
        hint.className =
          state === 'current' || state === 'paused'
            ? 'text-[10px] text-brand-dark/80 dark:text-slate-300 leading-relaxed mt-1'
            : 'text-[10px] text-brand-muted dark:text-slate-400 leading-relaxed mt-1 line-clamp-2';
        hint.textContent = String(step.hint);
        body.appendChild(hint);
      }

      li.appendChild(marker);
      li.appendChild(body);
      list.appendChild(li);
    });

    if (options.scrollIntoView) {
      try {
        wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch {
        wrap.scrollIntoView();
      }
    }
  }

  function ensureCadencePlaybookDataReady() {
    return ensureCadencePlaybookSelectOptions().then(() => fetchCadencePlaybookTemplates());
  }

  function renderLeadPanelTouchPoints(row) {
    const summaryEl = document.getElementById('leadPanelLastTouchSummary');
    const detailEl = document.getElementById('leadPanelLastTouchDetail');
    const badgeEl = document.getElementById('leadPanelEngagementBadge');
    const listEl = document.getElementById('leadPanelTouchPointsList');
    if (!row || !summaryEl || !listEl) return;

    const channel = String(row.dataset.lastTouchChannel || '').trim();
    const channelLabel =
      CADENCE_CHANNEL_LABELS[channel] || (channel ? channel.replace(/_/g, ' ') : '');
    const ms = parseInt(row.dataset.lastTouchMs || '', 10);
    let lastWhen = '—';
    if (ms && Number.isFinite(ms)) {
      try {
        lastWhen = new Date(ms).toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        });
      } catch (_) {
        lastWhen = '—';
      }
    }

    const noiseTypes = new Set([
      'sms_status',
      'call_status',
      'voicemail_amd',
      'voicemail_status',
      'sequence_step',
    ]);
    const entries = mergeActivityEntries(row)
      .filter((e) => {
        const typ = String(e.typ || '').toLowerCase();
        if (noiseTypes.has(typ)) return false;
        return String(e.text || '').trim().length > 0;
      })
      .slice(0, 8);

    const latest = entries[0] || null;
    const summaryParts = [];
    if (channelLabel) summaryParts.push(channelLabel);
    if (latest) {
      const typeLabel = formatActivityTypeLabel(latest.typ, latest.raw);
      if (typeLabel && typeLabel !== channelLabel) summaryParts.push(typeLabel);
      const when = latest.ts
        ? new Date(latest.ts).toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })
        : lastWhen;
      if (when && when !== '—') summaryParts.push(when);
    } else if (lastWhen !== '—') {
      summaryParts.push(lastWhen);
    }
    summaryEl.textContent = summaryParts.length ? summaryParts.join(' · ') : 'No touches logged yet';

    if (detailEl) {
      const detail = latest ? formatActivityEntryText(latest) : '';
      if (detail) {
        detailEl.textContent = detail;
        detailEl.classList.remove('hidden');
      } else {
        detailEl.textContent = '';
        detailEl.classList.add('hidden');
      }
    }

    const engType = String(row.dataset.engagementSignal || '').trim();
    const engAt = String(row.dataset.engagementSignalAt || '').trim();
    let engLabel = '';
    if (engType && engAt) {
      const engMs = Date.parse(engAt);
      if (Number.isFinite(engMs) && engMs >= Date.now() - 7 * 86400000) {
        const engMap = {
          sms_reply: 'SMS reply',
          email_reply: 'Email reply',
          link_click: 'Link click',
          mail_scan: 'Postcard scan',
          audit_open: 'Audit open',
          email_open: 'Email open',
        };
        engLabel = engMap[engType] || engType.replace(/_/g, ' ');
      }
    }
    if (badgeEl) {
      if (engLabel) {
        badgeEl.textContent = engLabel;
        badgeEl.classList.remove('hidden');
      } else {
        badgeEl.textContent = '';
        badgeEl.classList.add('hidden');
      }
    }

    if (!entries.length) {
      listEl.innerHTML =
        '<li class="text-brand-muted dark:text-slate-400 italic">No touch history yet.</li>';
      return;
    }

    listEl.innerHTML = entries
      .map((item) => {
        const typ = String(item.typ || '').toLowerCase();
        const warm =
          typ === 'engagement_signal' || typ === 'sms_inbound' || typ === 'email_inbound';
        const when = item.ts
          ? new Date(item.ts).toLocaleString(undefined, {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })
          : '—';
        const typeLabel = formatActivityTypeLabel(item.typ, item.raw);
        const body = formatActivityEntryText(item);
        const warmClass = warm
          ? ' border-emerald-500/30 bg-emerald-500/5 dark:bg-emerald-950/20'
          : ' border-brand-border/30 dark:border-white/10';
        return `<li class="rounded-lg border px-2.5 py-1.5${warmClass}">
          <p class="text-[9px] font-black uppercase tracking-widest text-brand-muted">${escapeHtml(when)} · ${escapeHtml(typeLabel)}</p>
          ${body ? `<p class="text-[11px] font-semibold text-brand-dark dark:text-slate-200 mt-0.5 leading-snug">${escapeHtml(body)}</p>` : ''}
        </li>`;
      })
      .join('');
  }

  function populateCadenceSection(row) {
    ensureCadencePlaybookDataReady().then(() => syncCadencePlaybookPanel(row));
    renderLeadPanelTouchPoints(row);
    const ltEl = document.getElementById('cadenceLastTouchLine');
    const chEl = document.getElementById('cadenceChannelLine');
    const seqWrap = document.getElementById('cadenceSequenceWrap');
    const seqLine = document.getElementById('cadenceSequenceLine');
    const nextEl = document.getElementById('cadenceNextStepLine');
    const logsWrap = document.getElementById('cadenceLogsWrap');
    const logList = document.getElementById('cadenceLogList');
    if (!ltEl || !chEl || !nextEl) return;

    const ms = parseInt(row.dataset.lastTouchMs || '', 10);
    let lastTouchText = '—';
    if (ms && Number.isFinite(ms)) {
      try {
        lastTouchText = new Date(ms).toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        });
      } catch (_) {
        lastTouchText = '—';
      }
    }
    ltEl.textContent = lastTouchText;

    const rawCh = String(row.dataset.lastTouchChannel || '').trim();
    chEl.textContent =
      CADENCE_CHANNEL_LABELS[rawCh] || (rawCh ? rawCh.replace(/_/g, ' ') : 'Not set');

    const seq = parseRowSequenceState(row);
    if (seqWrap && seqLine) {
      const tid = seq && seq.templateId ? String(seq.templateId) : '';
      const st = seq && seq.status ? String(seq.status) : '';
      const ix = seq ? cadenceSequenceStepIndex(seq) : 0;
      if (tid || st) {
        const tpl = findSequenceTemplate(tid);
        const name = tpl ? tpl.name : tid.replace(/_/g, ' ');
        const total = tpl ? resolveTemplateSteps(tpl).length : '';
        seqLine.textContent = total
          ? `${name} · step ${ix + 1} of ${total}${st ? ` · ${st}` : ''}`
          : `${name}${st ? ` · ${st}` : ''}`;
        seqWrap.classList.remove('hidden');
      } else {
        seqLine.textContent = '—';
        seqWrap.classList.add('hidden');
      }
    }

    const seqNext = cadenceNextStepFromSequence(row, seq);
    nextEl.textContent = seqNext || cadenceHintFromChannel(rawCh);

    renderCadencePlaybookSteps(row);

    let logs = [];
    try {
      logs = JSON.parse(row.dataset.logsSnippet || '[]');
    } catch (_) {
      logs = [];
    }
    if (logsWrap && logList) {
      logList.innerHTML = '';
      if (Array.isArray(logs) && logs.length) {
        logsWrap.classList.remove('hidden');
        logs.slice(-8).forEach((entry) => {
          const li = document.createElement('li');
          li.className =
            'border-l-2 border-brand-yellow/40 pl-3 py-1 text-brand-muted dark:text-slate-400';
          const ts = entry.timestamp ? new Date(entry.timestamp).toLocaleString() : '';
          const msg =
            typeof entry.message === 'string'
              ? entry.message
              : JSON.stringify(entry).slice(0, 180);
          li.textContent = ts ? `${ts} — ${msg}` : msg;
          logList.appendChild(li);
        });
      } else {
        logsWrap.classList.add('hidden');
      }
    }
  }

  function buildGoogleStaticMapUrl(center, key, width, height) {
    const c = String(center || '').trim();
    const k = String(key || '').trim();
    const w = Math.min(640, Math.max(100, parseInt(width, 10) || 256));
    const h = Math.min(640, Math.max(100, parseInt(height, 10) || 256));
    if (!c || !k) return '';
    const encCenter = encodeURIComponent(c);
    const encKey = encodeURIComponent(k);
    const encMarkers = encodeURIComponent(`color:0xEAB308|${c}`);
    return `https://maps.googleapis.com/maps/api/staticmap?center=${encCenter}&zoom=15&size=${w}x${h}&scale=2&maptype=roadmap&markers=${encMarkers}&key=${encKey}`;
  }

  function buildLeadPanelMapPreviewUrl(opts) {
    opts = opts || {};
    const params = new URLSearchParams();
    const geocodeQ = String(opts.geocodeCenter || opts.center || '').trim();
    const centerQ = String(opts.center || '').trim();
    if (geocodeQ) params.set('center', geocodeQ);
    else if (centerQ) params.set('center', centerQ);
    if (centerQ && centerQ !== geocodeQ) params.set('q', centerQ);
    if (Number.isFinite(opts.lat) && Number.isFinite(opts.lng)) {
      params.set('lat', String(opts.lat));
      params.set('lng', String(opts.lng));
    }
    params.set('w', String(opts.w || 640));
    params.set('h', String(opts.h || 300));
    if (!params.get('center') && !params.get('lat')) return '';
    return `/leads/map-preview?${params.toString()}`;
  }

  function syncMobilePanelHeroMap(row) {
    const mapImg = document.getElementById('mobilePanelStaticMapImg');
    const mapLink = document.getElementById('mobilePanelMapLink');
    const mobileAvatar = document.getElementById('mobilePanelAvatar');
    if (!mobileAvatar) return;

    const title = String(row.dataset.title || '').trim();
    const center = readPipelineRowMapCenter(row);
    const mapsUrl = center
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(center)}`
      : '';

    if (mapLink) {
      if (mapsUrl) {
        mapLink.href = mapsUrl;
        mapLink.target = '_blank';
        mapLink.rel = 'noopener noreferrer';
        mapLink.setAttribute('aria-label', 'Open location in Google Maps');
        mapLink.classList.remove('pointer-events-none');
        mapLink.classList.add('cursor-pointer');
      } else {
        mapLink.href = '#';
        mapLink.removeAttribute('target');
        mapLink.removeAttribute('rel');
        mapLink.setAttribute('aria-label', 'Location not available');
        mapLink.classList.add('pointer-events-none');
        mapLink.classList.remove('cursor-pointer');
      }
    }

    if (mapImg) {
      mapImg.onload = null;
      mapImg.onerror = null;
      mapImg.removeAttribute('src');
      mapImg.classList.add('hidden');
    }
    mobileAvatar.classList.remove('hidden');
  }

  function renderStars(
    rating,
    reviews,
    containerId = 'mobilePanelStars',
    textId = 'mobilePanelRatingText',
    starSizeClass = 'w-3 h-3'
  ) {
    const starsContainer = getLeadPanelEl(containerId);
    if (starsContainer) {
      renderStarsInElement(starsContainer, rating, starSizeClass);
    }
    const ratingText = getLeadPanelEl(textId);
    if (ratingText) {
      const rc = reviews !== undefined && reviews !== null ? parseInt(reviews, 10) || 0 : null;
      if (rc !== null) {
        if (rating > 0) {
          ratingText.textContent = `${Number(rating).toFixed(1)} (${rc} reviews)`;
        } else if (rc > 0) {
          ratingText.textContent = `— (${rc} reviews)`;
        } else {
          ratingText.textContent = 'No rating';
        }
      } else {
        ratingText.textContent = rating > 0 ? Number(rating).toFixed(1) : 'No rating';
      }
    }
  }

  /** Header contact strip + stars/reviews + quick-outreach tiles from row / table DOM. */
  function paintLeadPanelFromRow(row) {
    if (!row) return;
    const tableRow = resolvePipelineTableRowForPanel(row) || row;
    if (!tableRow || !tableRow.dataset) return;

    syncRowFromInitialSavedLeads(tableRow);
    prepareLeadRowForPanel(tableRow);

    const embedded = findInitialSavedLeadRecord(tableRow);
    if (typeof window.__paintPanelFromLeadRecord === 'function') {
      try {
        window.__paintPanelFromLeadRecord(embedded, tableRow);
      } catch (recErr) {
        console.warn('[Lead panel] record paint failed:', recErr);
      }
    }

    try {
      paintLeadPanelQuickOutreach(tableRow);
    } catch (earlyOutreachErr) {
      console.warn('[Lead panel] early quick outreach paint failed:', earlyOutreachErr);
    }

    try {
      const { snap } = buildLeadPanelDisplaySnapshot(tableRow);
      applyPanelSnapToRowDataset(tableRow, snap);
      prepareLeadRowForPanel(tableRow);
      coalesceRowDatasetFromContacts(tableRow);
      paintLeadPanelQuickOutreach(tableRow);
      paintPanelHeaderContactStrip(tableRow);
      scheduleReviewIntelligence(tableRow);
    } catch (paintErr) {
      console.warn('[Lead panel] row paint failed:', paintErr);
      try {
        paintLeadPanelQuickOutreach(tableRow);
      } catch (retryOutreachErr) {
        console.warn('[Lead panel] retry quick outreach paint failed:', retryOutreachErr);
      }
    }
    try {
      if (typeof window.__renderLeadTagsPanel === 'function') {
        window.__renderLeadTagsPanel(tableRow);
      }
    } catch (tagsErr) {
      console.warn('[Lead panel] tags paint failed:', tagsErr);
    }
    try {
      paintLeadPanelBuiltWith(tableRow);
    } catch (bwErr) {
      console.warn('[Lead panel] BuiltWith paint failed:', bwErr);
    }
    if (typeof window.__ensureLeadPanelContactEdit === 'function') {
      window.__ensureLeadPanelContactEdit();
    }
  }
  window.paintLeadPanelFromRow = paintLeadPanelFromRow;

  function parseLeadTechStackTags(raw) {
    if (Array.isArray(raw)) return raw.map((t) => String(t).trim()).filter(Boolean);
    const s = String(raw || '').trim();
    if (!s) return [];
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.map((t) => String(t).trim()).filter(Boolean);
    } catch (_) {
      /* plain string */
    }
    return s
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  }

  function domainFromWebsite(raw) {
    const s = String(raw || '').trim();
    if (!s || s === 'N/A' || s === '—') return '';
    try {
      const u = s.startsWith('http') ? s : `https://${s}`;
      return new URL(u).hostname.replace(/^www\./i, '');
    } catch {
      return '';
    }
  }

  function setBuiltWithActionBtnUi(btn, state) {
    if (!btn) return;
    const s = state || 'idle';
    btn.dataset.builtwithState = s;
    btn.setAttribute('aria-busy', s === 'active' ? 'true' : 'false');
    const idle = btn.querySelector('.builtwith-action-idle');
    const active = btn.querySelector('.builtwith-action-active');
    const done = btn.querySelector('.builtwith-action-done');
    if (idle) idle.classList.toggle('hidden', s !== 'idle');
    if (active) active.classList.toggle('hidden', s !== 'active');
    if (done) done.classList.toggle('hidden', s !== 'done');
  }

  function paintLeadPanelBuiltWithActionBtn(row) {
    const btn = document.getElementById('leadPanelBuiltWithActionBtn');
    const statusEl = document.getElementById('leadPanelBuiltWithActionStatus');
    if (!btn) return;

    const website = readPipelineRowDisplayWebsite(row);
    const domain = domainFromWebsite(website);
    const cms = String(row.dataset.cmsPlatform || '').trim();
    const tags = parseLeadTechStackTags(row.dataset.techStackTags);
    const hasWebsite = !!domain;
    const hasStack = (!!cms && cms !== 'N/A') || tags.length > 0;
    const panelLeadKey = String((row && row.dataset.leadKey) || '').trim();

    btn.dataset.leadKey = panelLeadKey;
    const blocked = !panelLeadKey || !hasWebsite;
    btn.dataset.builtwithBlocked = blocked ? '1' : '0';
    btn.dataset.builtwithBlockedReason = !panelLeadKey
      ? 'Save this lead before loading tech stack.'
      : !hasWebsite
        ? 'Add a website URL to load BuiltWith tech stack.'
        : '';
    btn.classList.toggle('opacity-55', blocked);
    btn.title = blocked
      ? btn.dataset.builtwithBlockedReason
      : hasStack
        ? 'View detected CMS and marketing tools for this site'
        : 'Fetch CMS and marketing tools via BuiltWith (Outscraper)';

    const labelEl = btn.querySelector('.builtwith-action-label');
    const doneLabelEl = btn.querySelector('.builtwith-action-done-label');
    if (labelEl) {
      labelEl.textContent = hasStack ? 'View tech stack (BuiltWith)' : 'Load tech stack (BuiltWith)';
    }
    if (doneLabelEl) {
      const hint = cms && cms !== 'N/A' ? cms : tags.length ? String(tags[0]) : 'Tech stack loaded';
      doneLabelEl.textContent = hint.length > 28 ? `${hint.slice(0, 28)}…` : hint;
    }

    if (row && row.dataset.builtWithLoading === '1') {
      setBuiltWithActionBtnUi(btn, 'active');
    } else if (hasStack) {
      setBuiltWithActionBtnUi(btn, 'done');
    } else {
      setBuiltWithActionBtnUi(btn, 'idle');
    }

    if (statusEl) {
      const err = String((row && row.dataset.builtWithError) || '').trim();
      if (err) {
        statusEl.textContent = err;
        statusEl.className = 'mb-3 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400';
        statusEl.classList.remove('hidden');
      } else {
        statusEl.textContent = '';
        statusEl.classList.add('hidden');
      }
    }

    if (!window.__leadPanelBuiltWithActionBtnBound) {
      window.__leadPanelBuiltWithActionBtnBound = true;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const activeBtn = document.getElementById('leadPanelBuiltWithActionBtn');
        if (!activeBtn || activeBtn.dataset.builtwithBlocked === '1') return;
        const activeRow =
          (typeof currentRow !== 'undefined' && currentRow) ||
          (typeof resolvePanelActionRow === 'function' ? resolvePanelActionRow() : null);
        if (!activeRow || !activeRow.dataset) return;
        const activeWebsite = readPipelineRowDisplayWebsite(activeRow);
        if (!domainFromWebsite(activeWebsite)) return;

        const stackTags = parseLeadTechStackTags(activeRow.dataset.techStackTags);
        const stackCms = String(activeRow.dataset.cmsPlatform || '').trim();
        const hasStackNow = (!!stackCms && stackCms !== 'N/A') || stackTags.length > 0;

        if (!hasStackNow) {
          if (activeRow.dataset.builtWithLoading === '1') return;
          fetchLeadBuiltWithTechStack(activeRow);
          return;
        }

        const wrap = document.getElementById('leadPanelBuiltWithWrap');
        const glance = document.getElementById('leadPanelCallerGlance');
        if (glance && typeof glance.scrollIntoView === 'function') {
          glance.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        if (wrap) {
          wrap.classList.remove('hidden');
          setTimeout(() => {
            if (typeof wrap.scrollIntoView === 'function') {
              wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
          }, 200);
        }
        const bwUrl =
          String(activeRow.dataset.builtWithUrl || '').trim() ||
          (domainFromWebsite(activeWebsite)
            ? `https://builtwith.com/${domainFromWebsite(activeWebsite)}`
            : '');
        if (bwUrl) window.open(bwUrl, '_blank', 'noopener,noreferrer');
      });
    }
  }
  window.setBuiltWithActionBtnUi = setBuiltWithActionBtnUi;
  window.paintLeadPanelBuiltWithActionBtn = paintLeadPanelBuiltWithActionBtn;

  function paintLeadPanelBuiltWith(row) {
    const wrap = document.getElementById('leadPanelBuiltWithWrap');
    const cmsEl = document.getElementById('leadPanelBuiltWithCms');
    const tagsEl = document.getElementById('leadPanelBuiltWithTags');
    const linkEl = document.getElementById('leadPanelBuiltWithLink');
    const metaEl = document.getElementById('leadPanelBuiltWithMeta');
    if (!wrap || !tagsEl) return;

    const website = readPipelineRowDisplayWebsite(row);
    const domain = domainFromWebsite(website);
    const cms = String(row.dataset.cmsPlatform || '').trim();
    const tags = parseLeadTechStackTags(row.dataset.techStackTags);
    const builtWithUrl =
      String(row.dataset.builtWithUrl || '').trim() ||
      (domain ? `https://builtwith.com/${domain}` : '');

    const hasWebsite = !!domain;
    const hasStack = !!cms || tags.length > 0;

    if (!hasWebsite && !hasStack) {
      wrap.classList.add('hidden');
      return;
    }

    wrap.classList.remove('hidden');

    if (linkEl) {
      if (builtWithUrl) {
        linkEl.href = builtWithUrl;
        linkEl.classList.remove('hidden');
      } else {
        linkEl.href = '#';
        linkEl.classList.add('hidden');
      }
    }

    if (cmsEl) {
      if (cms && cms !== 'N/A') {
        cmsEl.textContent = `CMS / platform: ${cms}`;
        cmsEl.classList.remove('hidden');
      } else {
        cmsEl.textContent = '';
        cmsEl.classList.add('hidden');
      }
    }

    tagsEl.innerHTML = '';
    const showTags = tags.slice(0, 12);
    for (const tag of showTags) {
      const pill = document.createElement('span');
      pill.className =
        'inline-flex items-center px-2 py-0.5 rounded-full border border-brand-border/40 dark:border-white/15 bg-white/80 dark:bg-slate-900/70 text-[10px] font-semibold text-brand-dark dark:text-slate-200';
      pill.textContent = tag;
      tagsEl.appendChild(pill);
    }
    if (tags.length > showTags.length) {
      const more = document.createElement('span');
      more.className = 'text-[10px] font-semibold text-brand-muted';
      more.textContent = `+${tags.length - showTags.length} more`;
      tagsEl.appendChild(more);
    }

    if (metaEl) {
      const loading = hasWebsite && !hasStack && row.dataset.builtWithLoading === '1';
      const err = String(row.dataset.builtWithError || '').trim();
      if (loading) {
        metaEl.textContent = 'Fetching tech stack from BuiltWith…';
        metaEl.classList.remove('hidden');
      } else if (err) {
        metaEl.textContent = err;
        metaEl.classList.remove('hidden');
      } else if (!hasStack && hasWebsite) {
        metaEl.textContent = 'Use Load tech stack (BuiltWith) in Quick outreach to fetch CMS and marketing tools.';
        metaEl.classList.remove('hidden');
      } else {
        metaEl.textContent = '';
        metaEl.classList.add('hidden');
      }
    }

    if (linkEl && !window.__leadPanelBuiltWithLinkBound) {
      window.__leadPanelBuiltWithLinkBound = true;
      linkEl.addEventListener('click', (e) => {
        const activeRow =
          (typeof currentRow !== 'undefined' && currentRow) ||
          (typeof resolvePanelActionRow === 'function' ? resolvePanelActionRow() : null);
        if (!activeRow || !activeRow.dataset) return;
        const stackTags = parseLeadTechStackTags(activeRow.dataset.techStackTags);
        const stackCms = String(activeRow.dataset.cmsPlatform || '').trim();
        const hasStackNow = (!!stackCms && stackCms !== 'N/A') || stackTags.length > 0;
        if (!hasStackNow) {
          e.preventDefault();
          if (activeRow.dataset.builtWithLoading === '1') return;
          fetchLeadBuiltWithTechStack(activeRow);
        }
      });
    }
    paintLeadPanelBuiltWithActionBtn(row);
  }

  async function fetchLeadBuiltWithTechStack(row) {
    if (!row || !row.dataset) return;
    const key = String(row.dataset.leadKey || '')
      .trim()
      .replace(/^lead:/i, '');
    if (!key) return;
    delete row.dataset.builtWithError;
    row.dataset.builtWithLoading = '1';
    paintLeadPanelBuiltWith(row);
    const actionBtn = document.getElementById('leadPanelBuiltWithActionBtn');
    if (actionBtn) setBuiltWithActionBtnUi(actionBtn, 'active');
    try {
      const res = await fetch(`/leads/${encodeURIComponent(key)}/builtwith-enrich`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error((data && data.error) || 'Could not load tech stack');
      }
      if (data.lead) {
        syncPersistedLeadToRowDataset(row, data.lead);
        prepareLeadRowForPanel(row);
        if (typeof window.__paintPanelFromLeadRecord === 'function') {
          window.__paintPanelFromLeadRecord(data.lead, row);
        }
      }
      delete row.dataset.builtWithLoading;
      const tagsAfter = parseLeadTechStackTags(row.dataset.techStackTags);
      const cmsAfter = String(row.dataset.cmsPlatform || '').trim();
      const gotStack = (!!cmsAfter && cmsAfter !== 'N/A') || tagsAfter.length > 0;
      if (!gotStack && data.message) {
        row.dataset.builtWithError = String(data.message);
      }
      paintLeadPanelBuiltWith(row);
      if (typeof paintLeadPanelFromRow === 'function') paintLeadPanelFromRow(row);
    } catch (err) {
      delete row.dataset.builtWithLoading;
      row.dataset.builtWithError = err && err.message ? err.message : 'Tech stack fetch failed.';
      paintLeadPanelBuiltWith(row);
    }
  }
  window.fetchLeadBuiltWithTechStack = fetchLeadBuiltWithTechStack;
  window.paintLeadPanelBuiltWith = paintLeadPanelBuiltWith;

  window.__buildLeadPanelDisplaySnapshot = buildLeadPanelDisplaySnapshot;
  window.syncLeadPanelMapAfterContactPaint = function syncLeadPanelMapAfterContactPaint(row) {
    if (!row) return;
    try {
      syncLeadPanelWideMapAndGoogleChip(row);
    } catch (mapErr) {
      console.warn('[Lead panel] map sync after contact paint failed:', mapErr);
    }
  };

  function paintLeadPanelQuickOutreach(row) {
    if (!row || !row.dataset) return;
    prepareLeadRowForPanel(row);
    const phone = readPipelineRowDisplayPhone(row);
    const websiteRaw = readPipelineRowDisplayWebsite(row);
    const websiteHref = resolveLeadPanelWebsiteHref(row);
    const website = websiteRaw || (websiteHref ? websiteHref.replace(/^https?:\/\//i, '') : '');
    const email = readPipelineRowDisplayEmail(row);
    const address = readPipelineRowDisplayAddress(row);

    const phoneEl = getLeadPanelEl('mobilePanelPhone');
    const phoneLink = getLeadPanelEl('mobilePanelPhoneLink');
    const phoneRow = getLeadPanelEl('mobilePanelPhoneRow');
    if (phoneEl) phoneEl.textContent = phone ? phone : '—';
    if (phoneLink) {
      if (phone) {
        phoneLink.href = '#';
        phoneLink.classList.add('js-click-to-call-number');
        phoneLink.dataset.phone = phone;
        if (row.dataset.leadKey) phoneLink.dataset.leadKey = row.dataset.leadKey;
        phoneLink.classList.remove('opacity-20', 'pointer-events-none');
        phoneLink.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
        };
        if (phoneRow) phoneRow.onclick = () => {
          phoneLink.click();
        };
      } else {
        phoneLink.href = '#';
        phoneLink.classList.remove('js-click-to-call-number');
        delete phoneLink.dataset.phone;
        delete phoneLink.dataset.leadKey;
        phoneLink.classList.add('opacity-20', 'pointer-events-none');
        if (phoneRow) phoneRow.onclick = null;
      }
    }

    const emailEl = getLeadPanelEl('mobilePanelEmail');
    const emailBtn = getLeadPanelEl('mobilePanelEmailBtn');
    if (emailEl) {
      const em = email && email !== 'N/A' ? email : '';
      emailEl.textContent = em || 'Outreach copy';
    }
    if (emailBtn) {
      emailBtn.onclick = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (currentRow && typeof openEmailIntelModal === 'function') openEmailIntelModal(currentRow);
      };
      emailBtn.classList.remove('opacity-20', 'pointer-events-none');
    }

    const websiteShort = getLeadPanelEl('mobilePanelWebsiteShort');
    const websiteLink = getLeadPanelEl('mobilePanelWebsiteLink');
    if (websiteShort) {
      try {
        if (!websiteHref) {
          websiteShort.textContent = 'No website';
        } else {
          const domain = new URL(websiteHref).hostname.replace(/^www\./i, '');
          websiteShort.textContent = domain && domain.length > 1 ? domain : 'Website';
        }
      } catch (e) {
        websiteShort.textContent = websiteHref ? String(website).slice(0, 32) : 'No website';
      }
    }
    if (websiteLink) {
      websiteLink.target = '_blank';
      websiteLink.rel = 'noopener noreferrer';
      if (websiteHref) {
        websiteLink.href = websiteHref;
        websiteLink.classList.remove('opacity-20', 'pointer-events-none', 'cursor-not-allowed');
        websiteLink.removeAttribute('aria-disabled');
        websiteLink.onclick = null;
      } else {
        websiteLink.href = '#';
        websiteLink.classList.add('opacity-20', 'pointer-events-none', 'cursor-not-allowed');
        websiteLink.setAttribute('aria-disabled', 'true');
        websiteLink.onclick = (ev) => {
          ev.preventDefault();
        };
      }
    }

    const mapsLink = getLeadPanelEl('mobilePanelMapsLink');
    const mapsHref = resolveLeadPanelMapsHref(row, address);
    const locationLine = address
      ? formatLeadPanelAddress(address)
      : readPipelineRowLocationLine(row);
    const addressEl = getLeadPanelEl('mobilePanelAddress');
    if (addressEl) {
      addressEl.textContent = locationLine || 'Open in Maps';
    }
    if (mapsLink) {
      mapsLink.target = '_blank';
      mapsLink.rel = 'noopener noreferrer';
      if (mapsHref) {
        mapsLink.href = mapsHref;
        mapsLink.classList.remove('opacity-20', 'pointer-events-none', 'cursor-not-allowed');
        mapsLink.removeAttribute('aria-disabled');
        mapsLink.onclick = null;
      } else {
        mapsLink.href = '#';
        mapsLink.classList.add('opacity-20', 'pointer-events-none', 'cursor-not-allowed');
        mapsLink.setAttribute('aria-disabled', 'true');
        mapsLink.onclick = (ev) => {
          ev.preventDefault();
        };
      }
    }

    paintLeadPanelBuiltWithActionBtn(row);
  }
  window.__paintLeadPanelQuickOutreach = paintLeadPanelQuickOutreach;

  function bindLeadPanelExternalLinkFallbacks() {
    if (window.__leadPanelExternalLinkFallbacksBound) return;
    window.__leadPanelExternalLinkFallbacksBound = true;

    document.addEventListener('click', (e) => {
      const panel = getLeadDetailPanel();
      if (!panel || !panel.classList.contains('open') || panel.classList.contains('hidden')) return;
      const row = currentRow;
      if (!row) return;

      const openExternal = (href) => {
        if (!href || href === '#') return false;
        e.preventDefault();
        e.stopPropagation();
        window.open(href, '_blank', 'noopener,noreferrer');
        return true;
      };

      const webTile = e.target.closest('#mobilePanelWebsiteLink');
      if (webTile && panel.contains(webTile)) {
        const cur = String(webTile.getAttribute('href') || '').trim();
        if (!cur || cur === '#') openExternal(resolveLeadPanelWebsiteHref(row));
        return;
      }

      const mapsTile = e.target.closest('#mobilePanelMapsLink');
      if (mapsTile && panel.contains(mapsTile)) {
        const cur = String(mapsTile.getAttribute('href') || '').trim();
        if (!cur || cur === '#') openExternal(resolveLeadPanelMapsHref(row));
        return;
      }

      const reviewsLink = e.target.closest('#mobilePanelReviewsLink');
      if (reviewsLink && panel.contains(reviewsLink)) {
        const cur = String(reviewsLink.getAttribute('href') || '').trim();
        if (!cur || cur === '#') openExternal(resolveLeadPanelMapsHref(row));
        return;
      }

      const hostedAuditLink = e.target.closest('#leadPanelHostedAuditUrl');
      if (hostedAuditLink && panel.contains(hostedAuditLink)) {
        const cur = String(hostedAuditLink.getAttribute('href') || '').trim();
        if (!cur || cur === '#') {
          e.preventDefault();
          e.stopPropagation();
          const preOpened = primeExternalLoadingTab('Hosted audit', 'Preparing your shareable audit report…');
          void handleSidebarHostedAuditClick(preOpened);
        }
        return;
      }

      const aiToolsLink = e.target.closest('#leadPanelAiToolsClientUrl');
      if (aiToolsLink && panel.contains(aiToolsLink)) {
        const cur = String(aiToolsLink.getAttribute('href') || '').trim();
        if (!cur || cur === '#') {
          e.preventDefault();
          e.stopPropagation();
          const preOpened = primeAiToolsLoadingTab();
          void runAiToolsAction('open', null, preOpened);
        }
      }
    });
  }
  bindLeadPanelExternalLinkFallbacks();

  // --- Populate panel from row data ---
  function populatePanel(row) {
    if (!row) return;
    openLeadPanelQuickLog();
    setLeadPanelOutreachFeedback('');
    if (typeof window.__adhelloResetLeadCallbackScheduler === 'function') {
      window.__adhelloResetLeadCallbackScheduler();
    }
    prepareLeadRowForPanel(row);
    window.__leadActivityFilter = window.__leadActivityFilter || 'all';
    const paintActivityTimeline = () => {
      try {
        renderLeadActivityTimeline(row, window.__leadActivityFilter);
        syncLeadActivityFilterButtons(window.__leadActivityFilter);
      } catch (timelineErr) {
        console.warn('[Lead panel] activity timeline failed:', timelineErr);
      }
    };
    paintActivityTimeline();

    try {
      paintLeadPanelFromRow(row);
    } catch (paintErr) {
      console.warn('[Lead panel] row paint failed:', paintErr);
    }

    const title = row.dataset.title;
    const phone = readPipelineRowDisplayPhone(row);
    const website = readPipelineRowDisplayWebsite(row);
    const revSnap = readPipelineRowReviewsSnapshot(row);
    const rating = revSnap.rating;
    const reviews = revSnap.reviews;
    const url = row.dataset.url;
    const email = readPipelineRowDisplayEmail(row);
    const facebook = row.dataset.facebook;
    const instagram = row.dataset.instagram;
    const twitter = row.dataset.twitter;
    const address = readPipelineRowDisplayAddress(row);
    const category = row.dataset.category;
    const loomUrl = row.dataset.loomUrl;

    // Avatar & Sticky Title Logic
    const mobileAvatar = document.getElementById('mobilePanelAvatar');
    const stickyPanelTitle = document.getElementById('stickyPanelTitle');
    if (mobileAvatar) {
        mobileAvatar.textContent = (title || 'A').charAt(0).toUpperCase();
    }
    syncMobilePanelHeroMap(row);
    if (stickyPanelTitle) {
        stickyPanelTitle.textContent = title || 'Company Details';
    }

    const panelTitle = document.getElementById('mobilePanelTitle');
    if (panelTitle) panelTitle.textContent = title;

    const tasksDeep = document.getElementById('leadTasksDeepLink');
    if (tasksDeep) {
      const lk = row.dataset.leadKey || '';
      if (lk) {
        tasksDeep.href = '/tasks?leadKey=' + encodeURIComponent(lk);
        tasksDeep.classList.remove('hidden');
      } else {
        tasksDeep.classList.add('hidden');
      }
    }

    const panelCategory = document.getElementById('mobilePanelCategory');
    if (panelCategory) panelCategory.textContent = category;

    syncLeadTouchPill(row);

    syncLeadCallAiAnalyzeCta(row);

    scheduleSyncLeadPanelWideMap(row);

    try {
      populateCadenceSection(row);
    } catch (cadenceErr) {
      console.error('[Lead detail panel] populateCadenceSection failed:', cadenceErr);
    }

    const rapidapiEnrichBtn = document.getElementById('rapidapiWebsiteEnrichBtn');
    if (rapidapiEnrichBtn) {
      const panelLeadKey = String(row.dataset.leadKey || '').trim();
      rapidapiEnrichBtn.dataset.leadKey = panelLeadKey;
      const hasWebsite = !!(website && website !== 'N/A' && website !== '—');
      const blocked = !panelLeadKey || !hasWebsite;
      rapidapiEnrichBtn.dataset.enrichBlocked = blocked ? '1' : '0';
      rapidapiEnrichBtn.dataset.enrichBlockedReason = !panelLeadKey
        ? 'Save this lead before enriching.'
        : !hasWebsite
          ? 'Add a website URL to this lead before enriching.'
          : '';
      rapidapiEnrichBtn.disabled = false;
      rapidapiEnrichBtn.classList.toggle('opacity-55', blocked);
      rapidapiEnrichBtn.title = hasWebsite
        ? 'Scrape website for email, phone, and social links via RapidAPI'
        : 'Add a website URL to enrich from RapidAPI';
      if (typeof window.setRapidapiWebsiteEnrichUi === 'function') {
        window.setRapidapiWebsiteEnrichUi(rapidapiEnrichBtn, 'idle');
      }
    }

    syncMobilePanelCqi(row);

    syncLeadPrimaryServiceSelect(row);

    // Audit Report Insights Section (Dynamic)
    const auditDataRaw = row.dataset.auditData;
    const source = row.dataset.source;
    const auditContainer = document.getElementById('auditInsightsContainer');
    
    if (auditContainer) {
        if (source === 'adhello_audit' && auditDataRaw && auditDataRaw !== 'null') {
            try {
                const audit = JSON.parse(auditDataRaw);
                auditContainer.innerHTML = `
                    <div class="p-6 bg-brand-yellow/5 dark:bg-brand-yellow/10 rounded-[2.5rem] border border-brand-yellow/20 relative overflow-hidden group/audit">
                        <div class="absolute -right-4 -top-4 w-20 h-20 bg-brand-yellow/10 rounded-full blur-2xl group-hover/audit:bg-brand-yellow/20 transition-all"></div>
                        <div class="relative z-10">
                            <div class="flex items-center justify-between gap-3 mb-5">
                                <div class="flex items-center gap-3">
                                    <div class="w-8 h-8 rounded-xl bg-brand-yellow flex items-center justify-center text-brand-dark shadow-lg shadow-brand-yellow/20">
                                        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.091 3.091L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
                                    </div>
                                    <div>
                                        <h4 class="text-[10px] font-black uppercase tracking-[0.2em] text-brand-yellow mb-0.5">AdHello Audit Intelligence</h4>
                                        <p class="text-xs font-black text-brand-dark dark:text-white">External Report Data</p>
                                    </div>
                                </div>
                                ${row.dataset.auditUrl ? `
                                    <a href="${row.dataset.auditUrl}" target="_blank" class="px-4 py-2 bg-brand-yellow text-brand-dark rounded-xl text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all shadow-lg shadow-brand-yellow/20 flex items-center gap-2">
                                        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                                        Full Report
                                    </a>
                                ` : ''}
                            </div>
                            
                            <div class="grid grid-cols-3 gap-3 mb-5">
                                <div class="p-3 bg-white dark:bg-slate-900/50 rounded-2xl border border-brand-border/10 text-center shadow-sm">
                                    <div class="text-[8px] font-black text-brand-muted uppercase tracking-tighter mb-1">Mobile</div>
                                    <div class="text-sm font-black text-brand-dark dark:text-white">${audit.mobileScore || '0'}%</div>
                                    <div class="w-full bg-brand-border/10 h-1 mt-2 rounded-full overflow-hidden">
                                        <div class="bg-brand-yellow h-full" style="width: ${audit.mobileScore || '0'}%"></div>
                                    </div>
                                </div>
                                <div class="p-3 bg-white dark:bg-slate-900/50 rounded-2xl border border-brand-border/10 text-center shadow-sm">
                                    <div class="text-[8px] font-black text-brand-muted uppercase tracking-tighter mb-1">Leads</div>
                                    <div class="text-sm font-black text-brand-dark dark:text-white">${audit.leadsScore || '0'}%</div>
                                    <div class="w-full bg-brand-border/10 h-1 mt-2 rounded-full overflow-hidden">
                                        <div class="bg-brand-yellow h-full" style="width: ${audit.leadsScore || '0'}%"></div>
                                    </div>
                                </div>
                                <div class="p-3 bg-white dark:bg-slate-900/50 rounded-2xl border border-brand-border/10 text-center shadow-sm">
                                    <div class="text-[8px] font-black text-brand-muted uppercase tracking-tighter mb-1">AI Ready</div>
                                    <div class="text-sm font-black text-brand-dark dark:text-white">${audit.aiReadyScore || '0'}%</div>
                                    <div class="w-full bg-brand-border/10 h-1 mt-2 rounded-full overflow-hidden">
                                        <div class="bg-brand-yellow h-full" style="width: ${audit.aiReadyScore || '0'}%"></div>
                                    </div>
                                </div>
                            </div>
                            
                            ${audit.summary ? `
                                <div class="p-4 bg-brand-yellow/5 dark:bg-white/5 rounded-2xl text-[11px] leading-relaxed text-brand-muted dark:text-slate-300 font-medium italic border-l-4 border-brand-yellow/50">
                                    "${audit.summary}"
                                </div>
                            ` : ''}
                        </div>
                    </div>
                `;
                auditContainer.classList.remove('hidden');
            } catch (e) {
                console.error('Audit Parse Error:', e);
                auditContainer.classList.add('hidden');
            }
        } else {
            auditContainer.classList.add('hidden');
            auditContainer.innerHTML = '';
        }
    }

    // Strategy Details Section (New)
    const strategyContainer = document.getElementById('strategyDetails');
    const stratIndustry = document.getElementById('strategyIndustry');
    const stratGoal = document.getElementById('strategyGoal');
    const stratVibe = document.getElementById('strategyVibe');
    const industry = row.dataset.industry;
    const goal = row.dataset.goal;
    const vibe = row.dataset.vibe;

    if (strategyContainer) {
        if (industry || goal || vibe) {
            if (stratIndustry) stratIndustry.textContent = industry || 'Not specified';
            if (stratGoal) stratGoal.textContent = goal || 'Not specified';
            if (stratVibe) stratVibe.textContent = vibe || 'Not specified';
            strategyContainer.classList.remove('hidden');
        } else {
            strategyContainer.classList.add('hidden');
        }
    }

    // Chat History Section (Dynamic)
    const chatHistoryRaw = row.dataset.chatHistory;
    const chatContainer = document.getElementById('chatLogContainer');
    const chatMessageList = document.getElementById('chatMessageList');
    
    if (chatContainer && chatMessageList) {
        if (chatHistoryRaw && chatHistoryRaw !== 'null' && chatHistoryRaw !== 'undefined') {
            try {
                let history = [];
                // Handle both JSON array and raw string formats
                if (chatHistoryRaw.startsWith('[')) {
                    history = JSON.parse(chatHistoryRaw);
                } else {
                    // Legacy string format: "User: msg\nBot: msg"
                    history = chatHistoryRaw.split('\n').filter(l => l.trim()).map(line => {
                        const isBot = line.toLowerCase().startsWith('bot:') || line.toLowerCase().startsWith('coach:');
                        const role = isBot ? 'assistant' : 'user';
                        const text = line.includes(':') ? line.split(':').slice(1).join(':').trim() : line;
                        return { role, text };
                    });
                }

                if (history && history.length > 0) {
                    chatMessageList.innerHTML = history.map(msg => {
                        const isAssistant = msg.role === 'assistant' || msg.role === 'bot' || msg.role === 'coach';
                        if (isAssistant) {
                            return `
                                <div class="flex flex-col items-start mb-4">
                                    <div class="bg-brand-yellow/10 text-brand-dark dark:text-white text-[11px] font-bold p-3.5 rounded-2xl rounded-tl-none border border-brand-yellow/20 max-w-[90%] shadow-sm leading-relaxed">
                                        ${msg.text || msg.content}
                                    </div>
                                    <div class="flex items-center gap-1.5 mt-1.5 ml-1">
                                        <div class="w-1 h-1 rounded-full bg-brand-yellow"></div>
                                        <span class="text-[8px] font-black uppercase tracking-[0.15em] text-brand-yellow/80">Growth Coach</span>
                                    </div>
                                </div>
                            `;
                        } else {
                            return `
                                <div class="flex flex-col items-end mb-4">
                                    <div class="bg-white dark:bg-white/5 text-brand-dark dark:text-slate-300 text-[11px] font-semibold p-3.5 rounded-2xl rounded-tr-none border border-brand-border/10 max-w-[90%] shadow-sm leading-relaxed">
                                        ${msg.text || msg.content}
                                    </div>
                                    <div class="flex items-center gap-1.5 mt-1.5 mr-1 text-right">
                                        <span class="text-[8px] font-black uppercase tracking-[0.15em] text-brand-muted/60">Prospect</span>
                                        <div class="w-1 h-1 rounded-full bg-brand-muted/30"></div>
                                    </div>
                                </div>
                            `;
                        }
                    }).join('');
                    chatContainer.classList.remove('hidden');
                    // Scroll to bottom
                    setTimeout(() => chatMessageList.scrollTop = chatMessageList.scrollHeight, 100);
                } else {
                    chatContainer.classList.add('hidden');
                }
            } catch (e) {
                console.error('Chat Parse Error:', e);
                chatContainer.classList.add('hidden');
            }
        } else {
            chatContainer.classList.add('hidden');
            chatMessageList.innerHTML = '';
        }
    }

    const panelStatusSelect = document.getElementById('leadStatusSelect');
    if (panelStatusSelect) {
      let st = (row.dataset.status || '').trim() || 'Not Contacted';
      if (st === 'Needs Video') st = 'Not Contacted';
      const hasOption = Array.from(panelStatusSelect.options).some((o) => o.value === st);
      panelStatusSelect.value = hasOption ? st : 'Not Contacted';
    }
    syncLeadPanelQuickLogPills(row);

    // Loom / pitch video URL (after status select so visibility matches "Video Recorded")
    const loomInput = document.getElementById('loomUrlInput');
    if (loomInput) loomInput.value = loomUrl || '';
    syncLoomOpenLink(loomUrl);
    syncQuickPitchSectionVisibility(row);

    const evInput = document.getElementById('estimatedValueInput');
    if (evInput) {
      const raw =
        row.dataset.estimatedValue != null ? String(row.dataset.estimatedValue).trim() : '';
      evInput.value = raw || '';
    }

    syncSidebarOutreachButtons(row);
    syncLeadPanelOutreachIntelButtons(row);
    coerceLeadPanelButtonsForView(row);
    syncPageSpeedAuditPanel(row);
    syncContactHuntPanel(row);
    syncLeadPanelEmailReportSection(row);
    syncLeadPanelAiToolsSection(row);

    syncLeadPanelStickyDock(row);
    syncLeadCallTalkingPoints(row);
    syncOwnerFirstNameAndDnc(row);
    syncLeadPanelTouchSummary(row);

    leadOutreachScriptsCache = {
      workspaceId: getActiveWorkspaceIdForScripts(),
      leadKey: '',
      data: null,
      loading: null,
      loadingKey: '',
      workspaceData: leadOutreachScriptsCache.workspaceData,
      workspaceLoading: null,
    };
    invalidateLeadOutreachScriptsCacheIfWorkspaceChanged();
    seedLeadOutreachScriptsCacheFromEmbedded(row);
    if (!applyLeadPanelSellingScriptNow(row)) {
      const scriptEl = document.getElementById('leadPanelSellingScript');
      if (scriptEl) scriptEl.textContent = '';
    }
    syncLeadPanelSellingScript(row, { skipLoading: true }).catch((err) => {
      console.warn('[Lead panel] syncLeadPanelSellingScript failed:', err);
      if (currentRow === row) {
        const el = document.getElementById('leadPanelSellingScript');
        if (el && !String(el.textContent || '').trim()) {
          el.textContent = 'Add scripts in Sales → Script library to use this panel.';
        }
      }
    });

    paintActivityTimeline();
    prepareLeadRowForPanel(row);
    try {
      paintLeadPanelFromRow(row);
    } catch (finalPaintErr) {
      console.warn('[Lead panel] final row paint failed:', finalPaintErr);
    }
    syncLeadSmsThreadSectionVisibility();
    if (typeof window.__leadSendInfoPopulate === 'function') {
      document.querySelectorAll('[data-send-info-root]').forEach((root) => window.__leadSendInfoPopulate(root));
    }
  }

  const applyTableStars = () => {
    if (typeof window.__applyReviewStars === 'function') {
      window.__applyReviewStars();
    }
  };

  document.addEventListener('change', async (e) => {
    const sel = e.target.closest('.pipeline-inline-select');
    if (!sel) return;
    const row = sel.closest('.result-row');
    if (!row) return;
    const key = row.dataset.leadKey;
    if (!key) return;
    const newStageId = String(sel.value || '').trim();
    if (!newStageId) return;
    const prevId = String(row.dataset.stageId || '').trim();
    if (newStageId === prevId) return;
    sel.disabled = true;
    try {
      const res = await fetch(`/leads/${encodeURIComponent(key)}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          stageId: newStageId,
          pipelineStageUpdatedAt: new Date().toISOString(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        const lead = data.lead || {};
        row.dataset.stageId = newStageId;
        if (lead.pipelineStage != null) {
          row.dataset.pipelineStage = String(lead.pipelineStage);
        }
        const labels = window.PIPELINE_STAGE_LABELS || {};
        const fullName = labels[newStageId] || '';
        const short =
          (fullName.split('(')[0].trim().slice(0, 22)) + (fullName.length > 22 ? '…' : '');
        row.dataset.pipelineLabel = short;
        const wrap = row.querySelector('.pipeline-stage-pill-wrap');
        if (wrap) {
          const dot =
            (window.PIPELINE_STAGE_COLORS && window.PIPELINE_STAGE_COLORS[newStageId]) || '#94a3b8';
          wrap.style.boxShadow = `inset 3px 0 0 ${dot}`;
        }
        if (typeof window.showProspectToast === 'function') window.showProspectToast('Stage updated');
        if (document.querySelector('.result-row.selected') === row) syncMobilePanelCqi(row);
      } else {
        sel.value = prevId;
      }
    } catch {
      sel.value = prevId;
    } finally {
      sel.disabled = false;
    }
  });

  document.addEventListener('change', async (e) => {
    const inp = e.target.closest('.lead-category-input');
    if (!inp) return;
    const row = inp.closest('.result-row');
    const key = String(inp.dataset.leadKey || (row && row.dataset.leadKey) || '').trim();
    if (!key) return;
    const val = String(inp.value || '').trim();
    try {
      const res = await fetch(`/leads/${encodeURIComponent(key)}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ categoryName: val || 'N/A' }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success && row) {
        row.dataset.category = val || 'N/A';
        const catInp = row.querySelector('.lead-category-input');
        if (catInp) catInp.classList.remove('lead-category-input--suspect');
        if (currentRow === row) populatePanel(row);
        if (typeof window.showProspectToast === 'function') {
          window.showProspectToast(val ? `Category set to ${val}` : 'Category cleared');
        }
      }
    } catch (_) {
      /* ignore */
    }
  });

  document.addEventListener('change', async (e) => {
    const sel = e.target.closest('.lead-touch-channel-select');
    if (!sel) return;
    const row = sel.closest('.result-row');
    const key = String(sel.dataset.leadKey || (row && row.dataset.leadKey) || '').trim();
    if (!key || !row) return;
    const val = String(sel.value || '').trim();
    const prevCh = String(row.dataset.lastTouchChannel || '').trim();
    if (val === prevCh) return;
    sel.disabled = true;
    try {
      const res = await fetch(`/leads/${encodeURIComponent(key)}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          lastTouchChannel: val || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        row.dataset.lastTouchChannel = val;
        row.dataset.cadenceSort = val || '';
        if (currentRow === row) populatePanel(row);
        if (typeof window.showProspectToast === 'function') window.showProspectToast('Cadence updated');
      } else {
        sel.value = prevCh || '';
      }
    } catch (_) {
      sel.value = prevCh || '';
    } finally {
      sel.disabled = false;
    }
  });

  // --- Lead Management Actions ---
  const statusSelect = document.getElementById('leadStatusSelect');
  if (statusSelect) {
    statusSelect.addEventListener('change', async () => {
      if (!currentRow) return;
      const key = currentRow.dataset.leadKey;
      const newStatus = statusSelect.value;
      const prevStatus = String(currentRow.dataset.status || '').trim() || 'Not Contacted';

      syncQuickPitchSectionVisibility(currentRow);

      if (!key) {
        currentRow.dataset.status = newStatus;
        return;
      }

      try {
        const res = await fetch(`/leads/${encodeURIComponent(key)}/update`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        });
        const data = await res.json();
        if (data.success) {
          currentRow.dataset.status = newStatus;
          if (data.lead && data.lead.updates) {
            currentRow.dataset.updates = JSON.stringify(data.lead.updates);
          }

          const statusBadge = currentRow.querySelector('td:nth-last-child(2) span') || currentRow.querySelector('span[class*="rounded-full"]');
          if (statusBadge) {
            statusBadge.textContent = newStatus;
            statusBadge.className =
              'px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-brand-yellow/10 text-brand-yellow border border-brand-yellow/20';
          }

          populatePanel(currentRow);
        } else {
          statusSelect.value = prevStatus;
          currentRow.dataset.status = prevStatus;
          syncQuickPitchSectionVisibility(currentRow);
        }
      } catch (err) {
        console.error('Status update failed:', err);
        statusSelect.value = prevStatus;
        currentRow.dataset.status = prevStatus;
        syncQuickPitchSectionVisibility(currentRow);
      }
    });
  }

  // --- Loom URL Auto-save ---
  const loomInput = document.getElementById('loomUrlInput');
  if (loomInput) {
    loomInput.addEventListener('input', () => {
      syncLoomOpenLink(loomInput.value.trim());
    });
    // Save on blur (when user clicks out of the input box)
    loomInput.addEventListener('blur', async () => {
      if (!currentRow) return;
      const key = currentRow.dataset.leadKey;
      const newLoomUrl = loomInput.value.trim();
      syncLoomOpenLink(newLoomUrl);

      if (!key) return;

      // Only save if it actually changed
      if (currentRow.dataset.loomUrl === newLoomUrl) return;

      try {
        const res = await fetch(`/leads/${key}/update`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ loomUrl: newLoomUrl }),
        });
        const data = await res.json();
        if (data.success) {
          currentRow.dataset.loomUrl = newLoomUrl;
          syncQuickPitchSectionVisibility(currentRow);
        }
      } catch (err) {
        console.error('Loom URL update failed:', err);
      }
    });
  }

  const estimatedValueInput = document.getElementById('estimatedValueInput');
  if (estimatedValueInput) {
    estimatedValueInput.addEventListener('blur', async () => {
      if (!currentRow) return;
      const key = currentRow.dataset.leadKey;
      if (!key) return;
      const raw = estimatedValueInput.value.trim();
      const prev = String(currentRow.dataset.estimatedValue || '').trim();
      if (raw === prev) return;
      let estimatedValue = null;
      if (raw !== '') {
        const n = parseFloat(raw.replace(/,/g, ''), 10);
        if (Number.isFinite(n) && n >= 0) estimatedValue = n;
      }
      try {
        const res = await fetch(`/leads/${encodeURIComponent(key)}/update`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ estimatedValue: estimatedValue == null ? '' : estimatedValue }),
        });
        const data = await res.json();
        if (data.success) {
          currentRow.dataset.estimatedValue =
            estimatedValue != null && estimatedValue !== '' ? String(estimatedValue) : '';
          if (typeof window.showProspectToast === 'function') window.showProspectToast('Value saved');
        }
      } catch (err) {
        console.error('Estimated value update failed:', err);
      }
    });
  }

  function sanitizeContactInput(value) {
    return String(value || '')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function phoneDigitsOnly(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function clearManualContactErrors() {
    const phoneErr = document.getElementById('manualPhoneError');
    const emailErr = document.getElementById('manualEmailError');
    const phoneInput = document.getElementById('manualPhoneInput');
    const emailInput = document.getElementById('manualEmailInput');
    if (phoneErr) {
      phoneErr.textContent = '';
      phoneErr.classList.add('hidden');
    }
    if (emailErr) {
      emailErr.textContent = '';
      emailErr.classList.add('hidden');
    }
    if (phoneInput) phoneInput.classList.remove('ring-2', 'ring-rose-400');
    if (emailInput) emailInput.classList.remove('ring-2', 'ring-rose-400');
  }

  function setManualContactError(kind, message) {
    const isPhone = kind === 'phone';
    const errEl = document.getElementById(isPhone ? 'manualPhoneError' : 'manualEmailError');
    const inputEl = document.getElementById(isPhone ? 'manualPhoneInput' : 'manualEmailInput');
    if (errEl) {
      errEl.textContent = message;
      errEl.classList.remove('hidden');
    }
    if (inputEl) inputEl.classList.add('ring-2', 'ring-rose-400');
  }

  function normalizeManualPhone(raw) {
    const s = sanitizeContactInput(raw);
    if (!s) return '';
    const digits = s.replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('1')) {
      const d = digits.slice(1);
      return `+1 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
    }
    if (digits.length === 10) {
      return `+1 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    if (digits.length >= 7 && digits.length <= 15) return s;
    return null;
  }

  function normalizeManualEmail(raw) {
    const s = sanitizeContactInput(raw).toLowerCase();
    if (!s) return '';
    const basic = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!basic.test(s)) return null;
    return s;
  }

  function updateRowContactCells(row) {
    if (!row) return;
    const phone = sanitizeContactInput(row.dataset.phone);
    const email = sanitizeContactInput(row.dataset.email);
    const website = sanitizeContactInput(row.dataset.website);

    replacePipelinePhoneSlot(row, phone);
    syncPhoneLineTypePill(row);

    const emailSlot = row.querySelector('.lead-contact-email-slot');
    if (emailSlot) {
      if (email && email !== 'N/A') {
        emailSlot.innerHTML = `<a href="mailto:${escapeHtmlAttr(email)}" class="text-brand-yellow hover:underline font-bold text-xs truncate block" title="${escapeHtmlAttr(email)}" onclick="event.stopPropagation()">${escapeHtmlText(email)}</a>`;
      } else {
        emailSlot.innerHTML = '<span class="text-xs font-semibold text-brand-muted/60 dark:text-slate-500">—</span>';
      }
    }

    const webSlot = row.querySelector('.lead-contact-web-slot');
    if (webSlot && website && website !== 'N/A') {
      const href = website.startsWith('http') ? website : `https://${website}`;
      const label = website.replace(/^https?:\/\//i, '').split('?')[0].replace(/\/$/, '');
      const short = label.length > 36 ? `${label.slice(0, 36)}…` : label;
      webSlot.innerHTML = `<a href="${escapeHtmlAttr(href)}" target="_blank" class="website-link text-xs font-semibold text-brand-dark dark:text-slate-300 hover:text-brand-yellow truncate block border-b border-transparent hover:border-brand-yellow/50" title="${escapeHtmlAttr(website)}" data-url="${escapeHtmlAttr(website)}">${escapeHtmlText(short)}</a>`;
    }
  }

  async function runLeadTelephonyAction(path, body, loadingLabel) {
    const row = resolvePanelActionRow();
    if (!row) {
      notifyLeadPanelDial('Select a lead first.', 'error');
      return null;
    }
    let key = String(row.dataset.leadKey || '').trim();
    if (!key) {
      try {
        key = await ensureRowHasLeadKey(row);
      } catch (err) {
        notifyLeadPanelDial(err.message || 'Save this lead first before running this action.', 'error');
        return null;
      }
    }
    const res = await fetch(`/leads/${encodeURIComponent(key)}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      const msg = (data && data.error) || `${loadingLabel || 'Action'} failed`;
      throw new Error(msg);
    }
    if (data.lead && Array.isArray(data.lead.updates)) {
      row.dataset.updates = JSON.stringify(data.lead.updates);
      if (data.lead.status) row.dataset.status = String(data.lead.status);
    }
    if (data && data.dialMode === 'browser_device' && data.phone) {
      openSoftphoneOrTel(data.phone);
    }
    notifyLeadPanelDial(
      (data && data.providerLabel) ? smsSentSuccessMessage(data) : (loadingLabel || 'Action completed.'),
      'success',
    );
    populatePanel(row);
    return data;
  }

  function resolveCurrentLeadDialPhone() {
    if (!currentRow) return '';
    const fromRow = String(currentRow.dataset.phone || '').trim();
    if (fromRow && fromRow !== 'N/A') return fromRow;
    const header = document.getElementById('mobilePanelHeaderPhone');
    if (header) {
      const fromData = (header.dataset && header.dataset.phone) || '';
      if (fromData && fromData !== 'N/A') return String(fromData).trim();
    }
    return '';
  }

  function applyTelephonyLeadUpdate(lead) {
    if (!lead || !currentRow) return;
    if (Array.isArray(lead.updates)) {
      currentRow.dataset.updates = JSON.stringify(lead.updates);
    }
    if (lead.status) currentRow.dataset.status = String(lead.status);
    populatePanel(currentRow);
  }

  document.addEventListener('adhello-telephony-lead-updated', (e) => {
    if (e && e.detail && e.detail.lead) {
      applyTelephonyLeadUpdate(e.detail.lead);
      if (typeof window.showProspectToast === 'function') {
        window.showProspectToast('Call started');
      }
    }
  });

  function openSoftphoneOrTel(rawPhone, opts) {
    const raw = String(rawPhone || '').trim();
    if (!raw) return false;
    if (
      typeof window.__adhelloOpenSoftphoneWithDial === 'function' &&
      window.__adhelloOpenSoftphoneWithDial(raw, opts || undefined)
    ) {
      return true;
    }
    const desktop =
      !(window.matchMedia && window.matchMedia('(max-width: 767px)').matches);
    if (!desktop) {
      const digits = raw.replace(/[^\d+]/g, '');
      if (!digits) return false;
      window.location.href = `tel:${digits}`;
      return true;
    }
    return false;
  }

  async function requestLeadCallByKey(leadKey, fallbackPhone, options) {
    const key = String(leadKey || '').trim();
    if (!key) throw new Error('Missing lead key.');
    const body = { ...(options || {}) };
    const res = await fetch('/leads/' + encodeURIComponent(key) + '/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      throw new Error((data && data.error) || 'Call failed');
    }
    if (data.lead && typeof window.__applyLeadPipelineStageFromApi === 'function') {
      window.__applyLeadPipelineStageFromApi(data.lead);
    }
    if (data && data.dialMode === 'browser_device') {
      const raw = String((data && data.phone) || fallbackPhone || '').trim();
      openSoftphoneOrTel(raw);
    }
    return data;
  }

  async function requestLeadVoicemailByKey(leadKey, options) {
    const key = String(leadKey || '').trim();
    if (!key) throw new Error('Missing lead key.');
    const body = { ...(options || {}) };
    const res = await fetch('/leads/' + encodeURIComponent(key) + '/voicemail-drop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      throw new Error((data && data.error) || 'Voicemail drop failed');
    }
    if (data.lead && typeof window.__applyLeadPipelineStageFromApi === 'function') {
      window.__applyLeadPipelineStageFromApi(data.lead);
    }
    return data;
  }

  document.addEventListener('click', (e) => {
    const trigger =
      e.target && e.target.closest
        ? e.target.closest('.js-click-to-call-number, .js-click-to-call-btn')
        : null;
    if (!trigger) return;
    e.preventDefault();
    e.stopPropagation();

    if (typeof window.__adhelloPipelinePhoneClick === 'function') {
      const row = trigger.closest('.result-row');
      if (row && row.dataset && row.dataset.leadKey) currentRow = row;
      if (window.__adhelloPipelinePhoneClick(trigger, e)) return;
    }

    const explicitPhone = (trigger.dataset && trigger.dataset.phone) || '';
    const leadKey = (trigger.dataset && trigger.dataset.leadKey) || '';
    let row = trigger.closest('.result-row');
    if (!row && leadKey) row = findResultRowByLeadKey(leadKey);
    const labelEl = trigger.querySelector && trigger.querySelector('.lead-contact-phone-label');
    const fromLabel = labelEl ? String(labelEl.textContent || '').trim() : '';
    const fromRow =
      row && row.dataset && row.dataset.phone != null ? String(row.dataset.phone).trim() : '';
    const phoneToFill = String(explicitPhone || fromLabel || fromRow || '').trim();
    if (!phoneToFill || phoneToFill === 'N/A') return;

    if (row && row.dataset && row.dataset.leadKey) {
      currentRow = row;
    }

    const dialOpts = {};
    const lk = (row && row.dataset && row.dataset.leadKey) || leadKey || '';
    if (lk) dialOpts.leadKey = lk;
    if (trigger.closest('#prospectLeadsTable')) dialOpts.autoDial = false;
    if (openLeadPanelSoftphone(phoneToFill, lk, dialOpts)) return;
    if (typeof window.__adhelloOpenSoftphoneWithDial === 'function') {
      window.__adhelloOpenSoftphoneWithDial(phoneToFill, dialOpts);
      return;
    }
    if (openSoftphoneOrTel(phoneToFill, dialOpts)) return;
    if (lk) {
      requestLeadCallByKey(lk, phoneToFill).catch((err) => {
        alert(err.message || 'Could not open dialer.');
      });
    }
  });

  const voicemailDropBtn = document.getElementById('voicemailDropBtn');

  const sendSmsBtn = document.getElementById('sendSmsBtn');
  function getSmsScriptModalEl() {
    return document.getElementById('smsScriptModal');
  }
  function mountSmsModalToBody() {
    const modal = getSmsScriptModalEl();
    if (modal && modal.parentElement !== document.body) {
      document.body.appendChild(modal);
    }
  }
  mountSmsModalToBody();
  window.__mountSmsModalToBody = mountSmsModalToBody;
  function getSmsScriptSelectEl() {
    return document.getElementById('smsScriptSelect');
  }
  function getSmsBodyInputEl() {
    return document.getElementById('smsBodyInput');
  }
  function getSmsBodyCountEl() {
    return document.getElementById('smsBodyCount');
  }
  function getSmsScriptWorkspaceLabelEl() {
    return document.getElementById('smsScriptWorkspaceLabel');
  }
  function getSmsPersonalizeBtnEl() {
    return document.getElementById('smsPersonalizeBtn');
  }
  function getSmsScriptSendBtnEl() {
    return document.getElementById('smsScriptSendBtn');
  }
  function getSmsScriptModalTitleEl() {
    return document.getElementById('smsScriptModalTitle');
  }
  function getSmsScriptBulkLabelEl() {
    return document.getElementById('smsScriptBulkLabel');
  }
  function getSmsScriptHelpTextEl() {
    return document.getElementById('smsScriptHelpText');
  }
  const smsScriptModalClose = document.getElementById('smsScriptModalClose');
  const smsScriptCancelBtn = document.getElementById('smsScriptCancelBtn');
  let smsScriptOptions = [];
  let bulkSmsLeadKeys = [];
  let smsModalMode = 'single';

  function resetSmsModalMode() {
    smsModalMode = 'single';
    bulkSmsLeadKeys = [];
    const smsScriptModalTitle = getSmsScriptModalTitleEl();
    const smsScriptBulkLabel = getSmsScriptBulkLabelEl();
    const smsScriptHelpText = getSmsScriptHelpTextEl();
    const smsPersonalizeBtn = getSmsPersonalizeBtnEl();
    const smsScriptSendBtn = getSmsScriptSendBtnEl();
    if (smsScriptModalTitle) {
      smsScriptModalTitle.textContent = 'Script + AI Personalization';
    }
    if (smsScriptBulkLabel) {
      smsScriptBulkLabel.textContent = '';
      smsScriptBulkLabel.classList.add('hidden');
    }
    if (smsScriptHelpText) {
      smsScriptHelpText.textContent = 'Pick a script, personalize with AI, edit, then send.';
    }
    if (smsPersonalizeBtn) {
      smsPersonalizeBtn.classList.remove('hidden');
      smsPersonalizeBtn.disabled = false;
    }
    if (smsScriptSendBtn) {
      smsScriptSendBtn.textContent = 'AI write & send';
    }
  }

  function updateSmsModalBulkUi() {
    const n = bulkSmsLeadKeys.length;
    const smsScriptModalTitle = getSmsScriptModalTitleEl();
    const smsScriptBulkLabel = getSmsScriptBulkLabelEl();
    const smsScriptHelpText = getSmsScriptHelpTextEl();
    const smsPersonalizeBtn = getSmsPersonalizeBtnEl();
    const smsScriptSendBtn = getSmsScriptSendBtnEl();
    if (smsScriptModalTitle) {
      smsScriptModalTitle.textContent = n > 1 ? `Bulk SMS — ${n} leads` : 'Bulk SMS';
    }
    if (smsScriptBulkLabel) {
      smsScriptBulkLabel.textContent =
        n > 0
          ? `Each lead gets an AI-personalized message (company, city, category, reviews).`
          : '';
      smsScriptBulkLabel.classList.toggle('hidden', n === 0);
    }
    if (smsScriptHelpText) {
      smsScriptHelpText.textContent =
        'Choose a base script below. On send, AdHello personalizes it for each business, then sends through your configured SMS provider.';
    }
    if (smsPersonalizeBtn) {
      smsPersonalizeBtn.classList.add('hidden');
    }
    if (smsScriptSendBtn) {
      smsScriptSendBtn.textContent = n > 1 ? `Send personalized to ${n} leads` : 'Send personalized SMS';
    }
  }

  function closeSmsModal() {
    const smsScriptModal = getSmsScriptModalEl();
    if (!smsScriptModal) return;
    smsScriptModal.classList.add('hidden');
    smsScriptModal.setAttribute('aria-hidden', 'true');
    resetSmsModalMode();
  }

  function openSmsModal() {
    resetSmsModalMode();
    mountSmsModalToBody();
    const smsScriptModal = getSmsScriptModalEl();
    if (!smsScriptModal) return false;
    smsScriptModal.classList.remove('hidden');
    smsScriptModal.setAttribute('aria-hidden', 'false');
    const smsScriptWorkspaceLabel = getSmsScriptWorkspaceLabelEl();
    if (smsScriptWorkspaceLabel) {
      const wsNameEl = document.querySelector('#wsSwitcherBtn .font-display');
      const wsName = wsNameEl ? String(wsNameEl.textContent || '').trim() : '';
      smsScriptWorkspaceLabel.textContent = `Workspace: ${wsName || 'Current workspace'}`;
    }
    return true;
  }

  async function openBulkSmsModal(phoneKeys) {
    mountSmsModalToBody();
    const keys = (Array.isArray(phoneKeys) ? phoneKeys : [])
      .map((k) => String(k || '').trim())
      .filter(Boolean);
    if (!keys.length) {
      return { ok: false, error: 'no_phone', message: 'Selected leads have no phone numbers for SMS.' };
    }
    const smsScriptModal = getSmsScriptModalEl();
    if (!smsScriptModal) {
      return { ok: false, error: 'no_modal', message: 'SMS composer failed to load. Refresh the page.' };
    }
    smsModalMode = 'bulk';
    bulkSmsLeadKeys = keys;
    smsScriptModal.classList.remove('hidden');
    smsScriptModal.setAttribute('aria-hidden', 'false');
    updateSmsModalBulkUi();
    const smsScriptWorkspaceLabel = getSmsScriptWorkspaceLabelEl();
    if (smsScriptWorkspaceLabel) {
      const wsNameEl = document.querySelector('#wsSwitcherBtn .font-display');
      const wsName = wsNameEl ? String(wsNameEl.textContent || '').trim() : '';
      smsScriptWorkspaceLabel.textContent = `Workspace: ${wsName || 'Current workspace'}`;
    }
    try {
      await loadSmsScriptOptions(keys[0]);
      const smsBodyInput = getSmsBodyInputEl();
      if (smsBodyInput) smsBodyInput.focus();
      return { ok: true, count: keys.length };
    } catch (err) {
      return {
        ok: false,
        error: 'load_failed',
        message: (err && err.message) || 'Could not load SMS scripts.',
      };
    }
  }

  function setSmsCharCount() {
    const smsBodyInput = getSmsBodyInputEl();
    const smsBodyCount = getSmsBodyCountEl();
    if (!smsBodyInput || !smsBodyCount) return;
    smsBodyCount.textContent = String((smsBodyInput.value || '').length);
  }

  function getSelectedSmsScriptText() {
    const smsBodyInput = getSmsBodyInputEl();
    const smsScriptSelect = getSmsScriptSelectEl();
    const fromTextarea = String((smsBodyInput && smsBodyInput.value) || '').trim();
    if (smsModalMode === 'bulk') return fromTextarea;
    if (!smsScriptSelect) return fromTextarea;
    const idx = parseInt(smsScriptSelect.value, 10);
    const selected = Number.isFinite(idx) ? smsScriptOptions[idx] : null;
    if (selected && selected.text) return String(selected.text).trim();
    return fromTextarea;
  }

  async function personalizeSmsForLead(leadKey, scriptText, context) {
    const res = await fetch(`/leads/${encodeURIComponent(leadKey)}/sms-personalize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        scriptText,
        context: context || 'outreach',
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      throw new Error((data && data.error) || 'Could not personalize SMS.');
    }
    return String(data.personalized || scriptText).trim();
  }

  async function aiWriteAndSendSmsToLead(leadKey, scriptText, opts) {
    const options = opts || {};
    const base = String(scriptText || '').trim();
    if (!base) throw new Error('No script to personalize.');
    const res = await fetch(`/leads/${encodeURIComponent(leadKey)}/sms-ai-send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        scriptText: base,
        context: options.context || 'outreach',
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      throw new Error((data && data.error) || 'Could not send AI SMS.');
    }
    if (data.lead && typeof window.__applyLeadPipelineStageFromApi === 'function') {
      window.__applyLeadPipelineStageFromApi(data.lead);
    }
    if (typeof options.onPreview === 'function' && data.personalized) {
      options.onPreview(data.personalized);
    }
    return data;
  }

  async function resolveProspectSmsScript(leadKey, row) {
    const scriptEl = document.getElementById('leadPanelSellingScript');
    const fromPanel = scriptEl ? String(scriptEl.textContent || '').trim() : '';
    if (fromPanel && fromPanel !== '—' && fromPanel.length > 12) return fromPanel;
    const res = await fetch(`/leads/${encodeURIComponent(leadKey)}/sms-script-options`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success && Array.isArray(data.options) && data.options[0]) {
      return String(data.options[0].text || '').trim();
    }
    const title = String((row && row.dataset && row.dataset.title) || 'your business').trim();
    const fallback = `Hi ${title} team — this is [your name] from [your company]. We had a quick idea to help you capture more local leads. Open to a short call this week?`;
    const helper = typeof window !== 'undefined' ? window.AdHelloScripts : null;
    return helper && helper.replaceSenderPlaceholders
      ? helper.replaceSenderPlaceholders(fallback, helper.getScriptProfile())
      : fallback;
  }

  async function openLeadPanelSmsComposer() {
    const row = resolvePanelActionRow ? resolvePanelActionRow() : currentRow;
    if (!row) {
      notifyLeadPanelDial('Select a lead first.', 'error');
      return;
    }
    if (!rowDatasetHasUsablePhone(row)) {
      notifyLeadPanelDial('Add a phone number first.', 'error');
      return;
    }
    try {
      await ensureRowHasLeadKey(row);
    } catch (err) {
      notifyLeadPanelDial(err.message || 'Save this lead first.', 'error');
      return;
    }
    setLeadOutreachChannel('text');
    const section = document.getElementById('leadSmsThreadSection');
    const input = document.getElementById('leadSmsComposeInput');
    const scriptEl = document.getElementById('leadPanelSellingScript');
    const scriptText = scriptEl ? String(scriptEl.textContent || '').trim() : '';
    if (input && !String(input.value || '').trim() && scriptText && scriptText !== '—' && scriptText.length > 12) {
      input.value = scriptText;
      const countEl = document.getElementById('leadSmsComposeCount');
      if (countEl) countEl.textContent = String(scriptText.length);
    }
    if (section) section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    if (input) {
      window.setTimeout(() => {
        input.focus();
        const len = input.value.length;
        if (typeof input.setSelectionRange === 'function') input.setSelectionRange(len, len);
      }, 120);
    }
    notifyLeadPanelDial('Type your SMS, use Improve text if needed, then Send SMS.', 'success');
  }

  async function improveLeadSmsComposeText() {
    const row = resolvePanelActionRow ? resolvePanelActionRow() : currentRow;
    const key = normalizeLeadKeyForApi(row && row.dataset ? row.dataset.leadKey : '');
    const input = document.getElementById('leadSmsComposeInput');
    const btn = document.getElementById('leadSmsImproveTextBtn');
    const draft = String((input && input.value) || '').trim();
    if (!key) {
      setLeadSmsThreadStatus('Select a lead first.', true);
      return;
    }
    if (!draft) {
      setLeadSmsThreadStatus('Add a message to improve first.', true);
      return;
    }
    if (btn) btn.disabled = true;
    setLeadSmsThreadStatus('Improving text…');
    try {
      const improved = await personalizeSmsForLead(key, draft, 'outreach');
      if (input) {
        input.value = improved;
        const countEl = document.getElementById('leadSmsComposeCount');
        if (countEl) countEl.textContent = String(improved.length);
      }
      setLeadSmsThreadStatus('Text improved — review and tap Send SMS when ready.');
    } catch (err) {
      setLeadSmsThreadStatus((err && err.message) || 'Could not improve text.', true);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function sendSmsToLeadKey(leadKey, body) {
    const res = await fetch(`/leads/${encodeURIComponent(leadKey)}/sms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      throw new Error((data && data.error) || `HTTP ${res.status}`);
    }
    if (data.lead && typeof window.__applyLeadPipelineStageFromApi === 'function') {
      window.__applyLeadPipelineStageFromApi(data.lead);
    }
    return data;
  }

  function smsProviderLabelFromResponse(data) {
    if (data && data.providerLabel) return String(data.providerLabel);
    if (data && data.provider === 'comms') return 'Comms';
    if (data && data.provider === 'ghl') return 'Go High Level';
    if (data && data.provider === 'signalwire') return 'SignalWire';
    return 'SMS';
  }

  function smsSentSuccessMessage(data) {
    const label = smsProviderLabelFromResponse(data);
    const kind = data && data.channel === 'imessage' ? 'iMessage' : 'SMS';
    return `${kind} sent via ${label}`;
  }

  document.addEventListener('click', async (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('.js-cadence-send-text') : null;
    if (!btn) return;
    e.preventDefault();
    const leadKey = String(btn.getAttribute('data-lead-key') || '').trim();
    const body = decodeURIComponent(String(btn.getAttribute('data-body') || '')).trim();
    if (!leadKey || !body) return;
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Writing…';
    try {
      btn.textContent = 'Sending…';
      const data = await aiWriteAndSendSmsToLead(leadKey, body, { context: 'cadence' });
      btn.textContent = '✓ Sent';
      if (typeof window.showAppToast === 'function') {
        window.showAppToast(smsSentSuccessMessage(data), { variant: 'success' });
      }
    } catch (err) {
      btn.textContent = 'Failed';
      if (typeof window.showAppToast === 'function') {
        window.showAppToast((err && err.message) || 'Could not send text.', { variant: 'error' });
      }
    } finally {
      window.setTimeout(() => {
        btn.disabled = false;
        btn.textContent = original || 'AI write & send';
      }, 2500);
    }
  });

  async function sendBulkPersonalizedSms(phoneKeys, scriptText, onProgress) {
    let ok = 0;
    let failed = 0;
    for (let i = 0; i < phoneKeys.length; i += 1) {
      const leadKey = phoneKeys[i];
      if (typeof onProgress === 'function') {
        onProgress(i + 1, phoneKeys.length, leadKey);
      }
      try {
        const personalized = await personalizeSmsForLead(leadKey, scriptText);
        if (!personalized) throw new Error('Empty personalized message');
        // eslint-disable-next-line no-await-in-loop
        await sendSmsToLeadKey(leadKey, personalized);
        ok += 1;
      } catch (err) {
        failed += 1;
        console.warn('Bulk personalized SMS failed for', leadKey, err && err.message ? err.message : err);
      }
    }
    return { ok, failed };
  }

  function getCurrentLeadKey() {
    const row = resolvePanelActionRow();
    if (!row || !row.dataset) return '';
    return String(row.dataset.leadKey || '').trim();
  }

  async function loadSmsScriptOptions(forLeadKey) {
    const leadKey = String(forLeadKey || getCurrentLeadKey() || '').trim();
    const smsScriptSelect = getSmsScriptSelectEl();
    const smsBodyInput = getSmsBodyInputEl();
    if (!leadKey || !smsScriptSelect || !smsBodyInput) return;
    smsScriptSelect.disabled = true;
    smsScriptSelect.innerHTML = '<option value="">Loading scripts...</option>';
    try {
      const res = await fetch(`/leads/${encodeURIComponent(leadKey)}/sms-script-options`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error((data && data.error) || 'Could not load SMS scripts.');
      smsScriptOptions = Array.isArray(data.options) ? data.options : [];
      if (!smsScriptOptions.length) {
        const title = String((currentRow && currentRow.dataset && currentRow.dataset.title) || '').trim();
        const helper = typeof window !== 'undefined' ? window.AdHelloScripts : null;
        const fallbackText =
          smsModalMode === 'bulk'
            ? 'Hi, this is [your name] from AdHello. We had a quick idea to help improve your local lead flow. Open to a short call this week?'
            : `Hi ${title || 'there'} team, this is [your name] from AdHello. We had a quick idea to help improve your local lead flow. Open to a short call this week?`;
        smsScriptOptions = [
          {
            id: 'fallback',
            label: 'Default outreach',
            text:
              helper && helper.replaceSenderPlaceholders
                ? helper.replaceSenderPlaceholders(fallbackText, helper.getScriptProfile())
                : fallbackText,
          },
        ];
      }
      smsScriptSelect.innerHTML = '';
      smsScriptOptions.forEach((opt, idx) => {
        const o = document.createElement('option');
        o.value = String(idx);
        o.textContent = opt.label || `Script ${idx + 1}`;
        smsScriptSelect.appendChild(o);
      });
      smsScriptSelect.value = '0';
      smsBodyInput.value = smsScriptOptions[0].text || '';
      setSmsCharCount();
    } catch (err) {
      smsScriptSelect.innerHTML = '<option value="">No scripts available</option>';
      smsBodyInput.value = '';
      setSmsCharCount();
      alert(err.message || 'Failed to load scripts.');
    } finally {
      smsScriptSelect.disabled = false;
    }
  }
  window.__openBulkSmsModalImpl = openBulkSmsModal;
  window.__openBulkSmsModal = openBulkSmsModal;
  window.__openBulkSmsFromBar = async function openBulkSmsFromBar() {
    const keys = [];
    const seen = new Set();
    document
      .querySelectorAll(
        'tbody input.lead-checkbox:checked, tbody input.row-checkbox:checked, input.lead-checkbox:checked, input.row-checkbox:checked',
      )
      .forEach(function (cb) {
        const row = cb.closest('tr.result-row, tr[data-lead-key]');
        if (!row) return;
        const phone = String(row.getAttribute('data-phone') || row.dataset.phone || '').trim();
        if (!phone || phone === 'N/A' || !/\d/.test(phone)) return;
        let key = String(row.getAttribute('data-lead-key') || row.dataset.leadKey || '').trim();
        if (!key) key = String(cb.getAttribute('data-key') || cb.dataset.key || '').trim();
        if (!key || seen.has(key)) return;
        seen.add(key);
        keys.push(key);
      });
    return openBulkSmsModal(keys);
  };

  if (sendSmsBtn) {
    /* Click handled via bindLeadPanelBottomActions delegation */
  }

  {
    const smsScriptSelect = getSmsScriptSelectEl();
    const smsBodyInput = getSmsBodyInputEl();
    if (smsScriptSelect && smsBodyInput) {
      smsScriptSelect.addEventListener('change', () => {
        const idx = parseInt(smsScriptSelect.value, 10);
        const selected = Number.isFinite(idx) ? smsScriptOptions[idx] : null;
        smsBodyInput.value = selected && selected.text ? selected.text : '';
        setSmsCharCount();
      });
      smsBodyInput.addEventListener('input', setSmsCharCount);
    }
  }
  {
    const smsPersonalizeBtn = getSmsPersonalizeBtnEl();
    const smsBodyInput = getSmsBodyInputEl();
    if (smsPersonalizeBtn) {
      smsPersonalizeBtn.addEventListener('click', async () => {
        const leadKey = getCurrentLeadKey();
        if (!leadKey || !smsBodyInput) return;
        const scriptText = String(smsBodyInput.value || '').trim();
        if (!scriptText) return;
        const original = smsPersonalizeBtn.textContent;
        smsPersonalizeBtn.disabled = true;
        smsPersonalizeBtn.textContent = 'Personalizing...';
        try {
          const res = await fetch(`/leads/${encodeURIComponent(leadKey)}/sms-personalize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ scriptText }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data.success) throw new Error((data && data.error) || 'Could not personalize SMS.');
          smsBodyInput.value = data.personalized || scriptText;
          setSmsCharCount();
        } catch (err) {
          alert(err.message || 'Failed to personalize SMS.');
        } finally {
          smsPersonalizeBtn.disabled = false;
          smsPersonalizeBtn.textContent = original;
        }
      });
    }
  }
  {
    const smsScriptSendBtn = getSmsScriptSendBtnEl();
    const smsBodyInput = getSmsBodyInputEl();
    const smsPersonalizeBtn = getSmsPersonalizeBtnEl();
    if (smsScriptSendBtn) {
      smsScriptSendBtn.addEventListener('click', async () => {
        if (!smsBodyInput) return;
        const scriptText = getSelectedSmsScriptText();
        if (!scriptText) return;

        if (smsModalMode === 'bulk' && bulkSmsLeadKeys.length) {
          const n = bulkSmsLeadKeys.length;
          if (
            !window.confirm(
              `Personalize and send this script to ${n} lead${n === 1 ? '' : 's'}? Each message will be unique.`,
            )
          ) {
            return;
          }
          const original = smsScriptSendBtn.textContent;
          smsScriptSendBtn.disabled = true;
          if (smsPersonalizeBtn) smsPersonalizeBtn.disabled = true;
          try {
            const result = await sendBulkPersonalizedSms(bulkSmsLeadKeys, scriptText, (done, total) => {
              smsScriptSendBtn.textContent = `Sending ${done}/${total}…`;
              showBulkSaveFeedback(`Personalizing & sending SMS ${done}/${total}…`, 'loading');
            });
          const msg = `SMS: ${result.ok} sent${result.failed ? ` · ${result.failed} failed` : ''}`;
          showBulkSaveFeedback(msg, result.failed === 0 ? 'success' : 'error');
          if (typeof window.__flashBulkBarBtn === 'function') {
            window.__flashBulkBarBtn(document.getElementById('bulkSmsBtn'), result.failed === 0 ? '✓ Sent' : 'Failed');
          }
          closeSmsModal();
          if (typeof window.__updateBulkActionBar === 'function') window.__updateBulkActionBar();
        } catch (err) {
          showBulkSaveFeedback(err.message || 'Bulk SMS failed.', 'error');
        } finally {
          smsScriptSendBtn.disabled = false;
          smsScriptSendBtn.textContent = original;
          if (smsPersonalizeBtn) smsPersonalizeBtn.disabled = false;
          updateSmsModalBulkUi();
        }
        return;
      }

      const leadKey = getCurrentLeadKey();
      if (!leadKey) {
        notifyLeadPanelDial('Select a lead first.', 'error');
        return;
      }
      const original = smsScriptSendBtn.textContent;
      smsScriptSendBtn.disabled = true;
      smsPersonalizeBtn && (smsPersonalizeBtn.disabled = true);
      smsScriptSendBtn.textContent = 'Writing…';
      try {
        smsScriptSendBtn.textContent = 'Sending…';
        const data = await aiWriteAndSendSmsToLead(leadKey, scriptText, {
          context: 'outreach',
          onPreview: (msg) => {
            if (smsBodyInput) {
              smsBodyInput.value = msg;
              setSmsCharCount();
            }
          },
        });
        confirmOutreachBtnSuccess(document.getElementById('sendSmsBtn'), '✓ Sent');
        closeSmsModal();
        notifyLeadPanelDial(smsSentSuccessMessage(data), 'success');
      } catch (err) {
        notifyLeadPanelDial(err.message || 'Failed to send SMS.', 'error');
      } finally {
        smsScriptSendBtn.disabled = false;
        smsScriptSendBtn.textContent = original;
        if (smsPersonalizeBtn) smsPersonalizeBtn.disabled = false;
      }
    });
    }
  }
  [document.getElementById('smsScriptModalClose'), document.getElementById('smsScriptCancelBtn')].forEach((btnEl) => {
    if (!btnEl) return;
    btnEl.addEventListener('click', closeSmsModal);
  });
  {
    const smsScriptModal = getSmsScriptModalEl();
    if (smsScriptModal) {
      smsScriptModal.addEventListener('click', (e) => {
        if (e.target && e.target.hasAttribute('data-sms-modal-close')) closeSmsModal();
      });
    }
  }

  const vmAudioStatus = document.getElementById('vmAudioStatus');
  const vmWeeklyDay = document.getElementById('vmWeeklyDay');
  const vmWeeklyTime = document.getElementById('vmWeeklyTime');
  const vmWeeklyEnabled = document.getElementById('vmWeeklyEnabled');
  const vmSaveWeeklyBtn = document.getElementById('vmSaveWeeklyBtn');
  const vmUploadInput = document.getElementById('vmUploadInput');
  const vmRecordStartBtn = document.getElementById('vmRecordStartBtn');
  const vmRecordStopBtn = document.getElementById('vmRecordStopBtn');
  let vmRecorder = null;
  let vmChunks = [];
  let vmSettingsLoaded = false;

  async function uploadVoicemailBlob(blob, filename) {
    const fd = new FormData();
    fd.append('audio', blob, filename || 'voicemail.webm');
    const res = await fetch('/leads/telephony/voicemail/upload', {
      method: 'POST',
      body: fd,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error((data && data.error) || 'Voicemail upload failed');
    return data;
  }

  async function loadVoicemailSettings() {
    if (!vmAudioStatus || vmSettingsLoaded) return;
    try {
      const res = await fetch('/leads/telephony/voicemail/settings', {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error((data && data.error) || 'Could not load settings');
      const s = data.settings || {};
      if (vmWeeklyDay) vmWeeklyDay.value = String(s.dayOfWeek != null ? s.dayOfWeek : 1);
      if (vmWeeklyTime) vmWeeklyTime.value = String(s.time || '09:00');
      if (vmWeeklyEnabled) vmWeeklyEnabled.checked = !!s.enabled;
      if (s.audioUrl) {
        vmAudioStatus.innerHTML = `Active voicemail audio: <a class="underline text-brand-yellow" href="${s.audioUrl}" target="_blank" rel="noopener">preview</a>`;
      } else {
        vmAudioStatus.textContent = 'No voicemail audio uploaded yet.';
      }
      vmSettingsLoaded = true;
    } catch (err) {
      vmAudioStatus.textContent = err.message || 'Failed to load voicemail settings.';
    }
  }

  if (vmSaveWeeklyBtn) {
    vmSaveWeeklyBtn.addEventListener('click', async () => {
      const original = vmSaveWeeklyBtn.textContent;
      vmSaveWeeklyBtn.disabled = true;
      vmSaveWeeklyBtn.textContent = 'Saving...';
      try {
        const body = {
          enabled: !!(vmWeeklyEnabled && vmWeeklyEnabled.checked),
          dayOfWeek: vmWeeklyDay ? vmWeeklyDay.value : '1',
          time: vmWeeklyTime ? vmWeeklyTime.value : '09:00',
          maxLeadsPerRun: 25,
        };
        const res = await fetch('/leads/telephony/voicemail/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error((data && data.error) || 'Could not save weekly settings');
        if (typeof window.showProspectToast === 'function') window.showProspectToast('Weekly voicemail settings saved');
      } catch (err) {
        alert(err.message || 'Could not save weekly settings.');
      } finally {
        vmSaveWeeklyBtn.disabled = false;
        vmSaveWeeklyBtn.textContent = original;
      }
    });
  }

  if (vmUploadInput) {
    vmUploadInput.addEventListener('change', async () => {
      const file = vmUploadInput.files && vmUploadInput.files[0];
      if (!file) return;
      try {
        vmAudioStatus.textContent = 'Uploading voicemail audio...';
        const up = await uploadVoicemailBlob(file, file.name || 'voicemail.webm');
        vmAudioStatus.innerHTML = `Voicemail audio saved: <a class="underline text-brand-yellow" href="${up.audioUrl}" target="_blank" rel="noopener">preview</a>`;
      } catch (err) {
        vmAudioStatus.textContent = err.message || 'Upload failed.';
      } finally {
        vmUploadInput.value = '';
      }
    });
  }

  if (vmRecordStartBtn && vmRecordStopBtn) {
    vmRecordStartBtn.addEventListener('click', async () => {
      try {
        if (!navigator.mediaDevices || !window.MediaRecorder) {
          throw new Error('Browser recording is not supported here.');
        }
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        vmChunks = [];
        vmRecorder = new MediaRecorder(stream);
        vmRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) vmChunks.push(e.data);
        };
        vmRecorder.onstop = async () => {
          try {
            const blob = new Blob(vmChunks, { type: 'audio/webm' });
            vmAudioStatus.textContent = 'Uploading recorded voicemail...';
            const up = await uploadVoicemailBlob(blob, 'voicemail-recording.webm');
            vmAudioStatus.innerHTML = `Voicemail recording saved: <a class="underline text-brand-yellow" href="${up.audioUrl}" target="_blank" rel="noopener">preview</a>`;
          } catch (err) {
            vmAudioStatus.textContent = err.message || 'Recording upload failed.';
          }
        };
        vmRecorder.start();
        vmRecordStartBtn.disabled = true;
        vmRecordStopBtn.disabled = false;
        vmAudioStatus.textContent = 'Recording... click Stop + save when done.';
      } catch (err) {
        vmAudioStatus.textContent = err.message || 'Could not start recording.';
      }
    });

    vmRecordStopBtn.addEventListener('click', () => {
      if (!vmRecorder) return;
      try {
        vmRecorder.stop();
      } catch (_) {
        /* ignore */
      }
      vmRecordStopBtn.disabled = true;
      vmRecordStartBtn.disabled = false;
    });
  }
  loadVoicemailSettings();

  // --- Generate Mailto Email Draft ---
  const leadPanelOutreachEmailBtn = document.getElementById('leadPanelOutreachEmailBtn');
  const sidebarReportEmailBtn = document.getElementById('sidebarReportEmailBtn');
  const sidebarIncludeCoupon = document.getElementById('sidebarIncludeCoupon');
  const sidebarCouponWarning = document.getElementById('sidebarCouponWarning');
  const syncSidebarCouponWarning = () => {
    if (currentRow) syncSidebarOutreachButtons(currentRow);
    else if (sidebarCouponWarning && sidebarIncludeCoupon) {
      const show = sidebarIncludeCoupon.checked && !getWorkspaceCouponLink();
      sidebarCouponWarning.classList.toggle('hidden', !show);
    }
  };
  if (sidebarIncludeCoupon) sidebarIncludeCoupon.addEventListener('change', syncSidebarCouponWarning);
  syncSidebarCouponWarning();
  /* Outreach buttons: bindLeadPanelBottomActions delegation */
  const leadPanelPushGhlBtn = document.getElementById('leadPanelPushGhlBtn');
  const emailIntelSendGhlBtn = document.getElementById('emailIntelSendGhlBtn');
  if (emailIntelSendGhlBtn) {
    emailIntelSendGhlBtn.addEventListener('click', async () => {
      const row = emailIntelActiveRow || resolvePanelActionRow();
      const draftEl = document.getElementById('emailIntelDraft');
      const body = draftEl ? String(draftEl.value || '').trim() : '';
      if (!row || !body) {
        notifyLeadPanelDial('Add email body first.', 'error');
        return;
      }
      if (!rowDatasetHasUsableEmail(row)) {
        notifyLeadPanelDial('No email on file for this lead.', 'error');
        return;
      }
      const company = row.dataset.title || 'your business';
      const subject = `Quick idea for ${company}`;
      const original = emailIntelSendGhlBtn.textContent;
      emailIntelSendGhlBtn.disabled = true;
      emailIntelSendGhlBtn.textContent = 'Sending…';
      try {
        await runLeadTelephonyAction('/email', { subject, body }, 'Email sent via Go High Level');
        confirmOutreachBtnSuccess(document.getElementById('leadPanelOutreachEmailBtn'), '✓ Sent');
        closeEmailIntelModal();
      } catch (err) {
        notifyLeadPanelDial(err.message || 'Email send failed.', 'error');
      } finally {
        emailIntelSendGhlBtn.disabled = false;
        emailIntelSendGhlBtn.textContent = original;
      }
    });
  }
  /* Outreach buttons: bindLeadPanelBottomActions delegation */

  async function handleSidebarReportEmailClick() {
    if (!currentRow) {
      if (typeof window.showAppToast === 'function') {
        window.showAppToast('Select a lead first.', { variant: 'error' });
      }
      return;
    }
    const btn = document.getElementById('sidebarReportEmailBtn');
    const original = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Preparing…';
    }
    try {
      const analysis = await ensureLeadAiAnalysis(currentRow);
      syncSidebarOutreachButtons(currentRow);
      const report = buildClientReportEmail(
        currentRow,
        analysis,
        String(currentRow.dataset.ownerSignal || '').trim()
      );
      await sendReportEmailViaGhl(report);
      if (typeof window.showAppToast === 'function') {
        window.showAppToast('Report email sent via Go High Level.', { variant: 'success' });
      }
    } catch (err) {
      const msg = err && err.message ? err.message : 'Could not open report email';
      if (typeof window.showAppToast === 'function') window.showAppToast(msg, { variant: 'error' });
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = original;
      }
    }
  }

  const sidebarHostedAuditBtn = document.getElementById('sidebarHostedAuditBtn');
  const sidebarCopyAuditLinkBtn = document.getElementById('sidebarCopyAuditLinkBtn');
  const sidebarCopySmsAuditBtn = document.getElementById('sidebarCopySmsAuditBtn');

  async function copyTextToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } finally {
      document.body.removeChild(ta);
    }
  }

  async function handleSidebarHostedAuditClick(preOpenedTab) {
    if (!currentRow) {
      closeAiToolsTab(preOpenedTab);
      if (typeof window.showAppToast === 'function') {
        window.showAppToast('Select a lead first.', { variant: 'error' });
      }
      return;
    }
    const btn = document.getElementById('sidebarHostedAuditBtn');
    const original = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Preparing…';
    }
    try {
      await ensureLeadAiAnalysis(currentRow);
      syncSidebarOutreachButtons(currentRow);
      const bundle = await fetchAuditReportLinkBundle(currentRow);
      showLeadPanelAuditReportLinks(bundle);
      if (!openUrlInNewTab(bundle.reportUrl, preOpenedTab)) {
        closeAiToolsTab(preOpenedTab);
      }
      if (typeof window.showAppToast === 'function') {
        window.showAppToast('Hosted audit opened — text them the link while you are talking.', {
          variant: 'success',
        });
      }
    } catch (err) {
      closeAiToolsTab(preOpenedTab);
      const msg = err && err.message ? err.message : 'Could not open hosted audit';
      if (typeof window.showAppToast === 'function') window.showAppToast(msg, { variant: 'error' });
      else window.alert(msg);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = original;
      }
    }
  }

  async function handleSidebarCopyAuditLinkClick() {
    if (!currentRow) {
      if (typeof window.showAppToast === 'function') {
        window.showAppToast('Select a lead first.', { variant: 'error' });
      }
      return;
    }
    const btn = document.getElementById('sidebarCopyAuditLinkBtn');
    if (btn) btn.disabled = true;
    try {
      await ensureLeadAiAnalysis(currentRow);
      syncSidebarOutreachButtons(currentRow);
      const bundle = await fetchAuditReportLinkBundle(currentRow);
      await copyTextToClipboard(bundle.reportUrl);
      if (typeof window.showAppToast === 'function') {
        window.showAppToast('Report link copied.', { variant: 'success' });
      }
    } catch (err) {
      const msg = err && err.message ? err.message : 'Copy failed';
      if (typeof window.showAppToast === 'function') window.showAppToast(msg, { variant: 'error' });
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function aiToolsToast(message, variant) {
    if (typeof window.showAppToast === 'function') {
      window.showAppToast(message, { variant: variant || 'info' });
    } else if (variant === 'error' || variant === 'success') {
      window.alert(message);
    }
  }

  function closeAiToolsTab(tab) {
    if (tab && !tab.closed) {
      try {
        tab.close();
      } catch (_) {}
    }
  }

  /** Navigate a tab opened synchronously on click (must not use noopener on window.open or the reference is null). */
  function navigatePreopenedTab(tab, url) {
    const target = String(url || '').trim();
    if (!target || !tab || tab.closed) return false;
    try {
      tab.opener = null;
    } catch (_) {}
    try {
      tab.location.replace(target);
      return true;
    } catch (_) {
      try {
        tab.location.href = target;
        return true;
      } catch (_) {}
    }
    return false;
  }

  function openUrlInNewTab(url, preOpenedTab) {
    const target = String(url || '').trim();
    if (!target) return false;
    if (navigatePreopenedTab(preOpenedTab, target)) return true;
    try {
      const a = document.createElement('a');
      a.href = target;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return true;
    } catch (_) {}
    const opened = window.open(target, '_blank');
    if (!opened) {
      aiToolsToast(
        'Pop-up blocked. Allow pop-ups for this site, or use Copy client link.',
        'error',
      );
      return false;
    }
    try {
      opened.opener = null;
    } catch (_) {}
    return true;
  }

  function openAiToolsTab(url, preOpenedTab) {
    return openUrlInNewTab(url, preOpenedTab);
  }

  function primeExternalLoadingTab(title, message) {
    // Do not pass noopener — browsers return null and async navigation cannot run.
    const tab = window.open('about:blank', '_blank');
    if (!tab) return null;
    try {
      tab.opener = null;
      tab.document.title = title || 'Loading…';
      tab.document.body.innerHTML =
        '<div style="font-family:system-ui,sans-serif;padding:2.5rem;color:#334155"><p style="font-weight:700;margin:0 0 .5rem">' +
        (title || 'Loading…') +
        '</p><p style="margin:0;font-size:14px;color:#64748b">' +
        (message || 'Please wait…') +
        '</p></div>';
    } catch (_) {}
    return tab;
  }

  function primeAiToolsLoadingTab() {
    return primeExternalLoadingTab(
      'AI Tools Assessment',
      'Building your editable deck from business data.',
    );
  }

  async function ensureAiToolsAssessmentForRow(row) {
    await ensureRowHasLeadKey(row);
    if (!getAiToolsAssessmentFromRow(row)) {
      await generateAiToolsAssessmentForRow(row);
      syncLeadPanelAiToolsSection(row);
      syncLeadPanelEmailReportSection(row);
    }
  }

  async function runAiToolsAction(action, triggerBtn, preOpenedTab) {
    const row = resolveActiveLeadRow();
    if (!row) {
      closeAiToolsTab(preOpenedTab);
      aiToolsToast('Select a lead first.', 'error');
      return;
    }
    const originalLabel = triggerBtn ? triggerBtn.textContent : '';
    const setBusy = (label) => {
      if (triggerBtn) triggerBtn.textContent = label;
    };
    try {
      if (action === 'copy') {
        setBusy('Copying…');
        await ensureAiToolsAssessmentForRow(row);
        const bundle = await fetchAiToolsReportLinkBundle(row);
        showLeadPanelAiToolsClientLink(bundle);
        await copyTextToClipboard(bundle.reportUrl);
        aiToolsToast('Client link copied — send via text or email.', 'success');
        return;
      }

      if (action === 'generate') {
        setBusy('Generating…');
        aiToolsToast('Building AI Tools Assessment from business data…', 'info');
        await ensureAiToolsAssessmentForRow(row);
        const url = aiToolsPreviewUrlForRow(row);
        if (!openAiToolsTab(url, preOpenedTab)) {
          closeAiToolsTab(preOpenedTab);
          return;
        }
        aiToolsToast('Assessment opened — edit slides, then copy the client link.', 'success');
        return;
      }

      if (action === 'preview') {
        setBusy('Opening…');
        await ensureAiToolsAssessmentForRow(row);
        const url = aiToolsPreviewUrlForRow(row);
        if (!openAiToolsTab(url, preOpenedTab)) {
          closeAiToolsTab(preOpenedTab);
        }
        return;
      }

      if (action === 'open') {
        setBusy('Opening…');
        await ensureAiToolsAssessmentForRow(row);
        const bundle = await fetchAiToolsReportLinkBundle(row);
        showLeadPanelAiToolsClientLink(bundle);
        if (!openAiToolsTab(bundle.reportUrl, preOpenedTab)) {
          closeAiToolsTab(preOpenedTab);
          return;
        }
        aiToolsToast('Presentation opened — this is what your client will see.', 'success');
      }
    } catch (err) {
      closeAiToolsTab(preOpenedTab);
      const msg = err && err.message ? err.message : 'AI Tools action failed';
      aiToolsToast(msg, 'error');
    } finally {
      if (triggerBtn) triggerBtn.textContent = originalLabel;
    }
  }
  window.__adhelloRunAiToolsAction = runAiToolsAction;

  if (!window.__adhelloAiToolsCaptureBound) {
    window.__adhelloAiToolsCaptureBound = true;
    document.addEventListener(
      'click',
      (e) => {
        const btn =
          e.target && e.target.closest
            ? e.target.closest('.js-ai-tools-trigger[data-ai-tools-action]')
            : null;
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        if (btn.getAttribute('aria-disabled') === 'true') {
          aiToolsToast('Generate the assessment first.', 'error');
          return;
        }
        const action = btn.getAttribute('data-ai-tools-action');
        if (
          action === 'generate' &&
          (btn.id === 'sidebarAiToolsGenerateBtn' || btn.id === 'appNavAiToolsGenerateBtn')
        ) {
          scrollLeadPanelToSection('leadPanelAiToolsSection');
        }
        const preOpenedTab =
          action === 'generate' || action === 'preview' || action === 'open'
            ? primeAiToolsLoadingTab()
            : null;
        const runner = window.__adhelloRunAiToolsAction;
        if (typeof runner !== 'function') {
          closeAiToolsTab(preOpenedTab);
          aiToolsToast('App still loading — try again in a moment.', 'error');
          return;
        }
        void runner(action, btn, preOpenedTab);
      },
      true,
    );
  }

  const sidebarCadenceSnooze90Btn = document.getElementById('sidebarCadenceSnooze90Btn');
  const sidebarCadencePauseBtn = document.getElementById('sidebarCadencePauseBtn');
  const sidebarCadenceStartBtn = document.getElementById('sidebarCadenceStartBtn');
  const leadCadencePlaybookSelect = document.getElementById('leadCadencePlaybookSelect');

  if (leadCadencePlaybookSelect && !leadCadencePlaybookSelect.dataset.adhelloBound) {
    leadCadencePlaybookSelect.dataset.adhelloBound = '1';
    leadCadencePlaybookSelect.addEventListener('change', () => {
      ensureCadencePlaybookDataReady().then(() => syncCadencePlaybookPanel(currentRow));
    });
  }

  async function startCadencePlaybookForCurrentRow() {
    scrollLeadPanelToSection('leadCadencePlaybookHeading');
    if (!currentRow) {
      const msg = 'Select a lead from the table first.';
      if (typeof window.showAppToast === 'function') {
        window.showAppToast(msg, { variant: 'error' });
      } else window.alert(msg);
      return;
    }
    const sel = document.getElementById('leadCadencePlaybookSelect');
    const templateId = sel ? String(sel.value || '').trim() : '';
    if (!templateId) {
      if (typeof window.showAppToast === 'function') {
        window.showAppToast('Choose a playbook first.', { variant: 'error' });
      }
      return;
    }
    const seq = parseRowSequenceState(currentRow);
    if (seq && seq.status === 'active') {
      const tpl = findSequenceTemplate(seq.templateId);
      const currentName = tpl ? tpl.name : seq.templateId;
      const nextTpl = findSequenceTemplate(templateId);
      const nextName = nextTpl ? nextTpl.name : templateId;
      const ok = window.confirm(
        `${currentName} is active. Replace it with ${nextName} and restart from step 1?`
      );
      if (!ok) return;
    }
    const btn = document.getElementById('sidebarCadenceStartBtn');
    const btnLabel = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Starting…';
    }
    try {
      await ensureRowHasLeadKey(currentRow);
      const key = String(currentRow.dataset.leadKey || '').trim();
      const res = await fetch(`/leads/${encodeURIComponent(key)}/sequence/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ templateId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error((data && data.error) || 'Could not start playbook');
      const nextSeq =
        (data.lead && data.lead.sequenceState) || data.sequenceState || null;
      if (data.lead) syncPersistedLeadToRowDataset(currentRow, data.lead);
      else if (nextSeq) {
        currentRow.dataset.sequenceState = JSON.stringify(nextSeq);
      }
      const statusMsg = showCadencePlaybookStatus(currentRow, templateId, nextSeq);
      const nextEl = document.getElementById('cadenceNextStepLine');
      if (nextEl && nextSeq) {
        const nextLine = cadenceNextStepFromSequence(currentRow, nextSeq);
        if (nextLine) nextEl.textContent = nextLine;
      }
      if (typeof window.showAppToast === 'function') {
        window.showAppToast(statusMsg || 'Playbook started.', { variant: 'success' });
      }
      await ensureCadencePlaybookDataReady();
      if (typeof populatePanel === 'function') populatePanel(currentRow);
      else {
        syncCadencePlaybookPanel(currentRow);
        renderCadencePlaybookSteps(currentRow, { scrollIntoView: true });
      }
    } catch (err) {
      const msg = err && err.message ? err.message : 'Start failed';
      const status = document.getElementById('leadCadenceActiveStatus');
      if (status) {
        status.textContent = msg;
        status.classList.remove('hidden');
        status.classList.remove('text-emerald-800', 'dark:text-emerald-200', 'border-emerald-500/35');
        status.classList.add('text-rose-800', 'dark:text-rose-200', 'border-rose-500/35', 'bg-rose-50/90');
        try {
          status.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } catch (_) {}
      }
      if (typeof window.showAppToast === 'function') window.showAppToast(msg, { variant: 'error' });
      else if (typeof window.showProspectToast === 'function') window.showProspectToast(msg);
      else window.alert(msg);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = btnLabel || 'Start playbook';
      }
      syncCadencePlaybookPanel(currentRow);
      renderCadencePlaybookSteps(currentRow, { scrollIntoView: true });
    }
  }

  window.__startCadencePlaybookForCurrentRow = startCadencePlaybookForCurrentRow;

  if (!window.__adhelloCadenceStartCaptureBound) {
    window.__adhelloCadenceStartCaptureBound = true;
    document.addEventListener(
      'click',
      (e) => {
        const startBtn = e.target.closest('#sidebarCadenceStartBtn');
        if (!startBtn) return;
        e.preventDefault();
        e.stopPropagation();
        startCadencePlaybookForCurrentRow();
      },
      true,
    );
  }

  if (sidebarCadenceSnooze90Btn) {
    sidebarCadenceSnooze90Btn.addEventListener('click', async () => {
      if (!currentRow || !currentRow.dataset.leadKey) {
        if (typeof window.showAppToast === 'function') {
          window.showAppToast('Select a lead first.', { variant: 'error' });
        }
        return;
      }
      if (!window.confirm('Pause cadence and snooze this lead for 90 days? (Re-run audit before the next wave.)')) return;
      const key = currentRow.dataset.leadKey;
      try {
        sidebarCadenceSnooze90Btn.disabled = true;
        const res = await fetch(`/leads/${encodeURIComponent(key)}/cadence/snooze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ days: 90 }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.error || 'Snooze failed');
        if (data.lead && currentRow) syncPersistedLeadToRowDataset(currentRow, data.lead);
        if (typeof window.showAppToast === 'function') {
          window.showAppToast('Cadence snoozed 90 days.', { variant: 'success' });
        }
        if (currentRow && typeof populatePanel === 'function') populatePanel(currentRow);
      } catch (err) {
        const msg = err && err.message ? err.message : 'Snooze failed';
        if (typeof window.showAppToast === 'function') window.showAppToast(msg, { variant: 'error' });
      } finally {
        sidebarCadenceSnooze90Btn.disabled = false;
      }
    });
  }
  if (sidebarCadencePauseBtn) {
    sidebarCadencePauseBtn.addEventListener('click', async () => {
      if (!currentRow || !currentRow.dataset.leadKey) {
        if (typeof window.showAppToast === 'function') {
          window.showAppToast('Select a lead first.', { variant: 'error' });
        }
        return;
      }
      const key = currentRow.dataset.leadKey;
      try {
        sidebarCadencePauseBtn.disabled = true;
        const res = await fetch(`/leads/${encodeURIComponent(key)}/sequence/pause`, { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.error || 'Pause failed');
        if (data.lead && currentRow) syncPersistedLeadToRowDataset(currentRow, data.lead);
        if (typeof window.showAppToast === 'function') {
          window.showAppToast('Cadence paused.', { variant: 'success' });
        }
        if (currentRow && typeof populatePanel === 'function') populatePanel(currentRow);
      } catch (err) {
        const msg = err && err.message ? err.message : 'Pause failed';
        if (typeof window.showAppToast === 'function') window.showAppToast(msg, { variant: 'error' });
      } finally {
        sidebarCadencePauseBtn.disabled = false;
      }
    });
  }

  if (document.getElementById('leadPanelTabScroll')) {
    void ensureCadencePlaybookSelectOptions();
  }

  window.__adhelloEnsureCadencePlaybookSelectOptions = ensureCadencePlaybookSelectOptions;

  async function handleSidebarCopySmsAuditClick() {
    if (!currentRow) {
      if (typeof window.showAppToast === 'function') {
        window.showAppToast('Select a lead first.', { variant: 'error' });
      }
      return;
    }
    const btn = document.getElementById('sidebarCopySmsAuditBtn');
    if (btn) btn.disabled = true;
    try {
      await ensureLeadAiAnalysis(currentRow);
      syncSidebarOutreachButtons(currentRow);
      const bundle = await fetchAuditReportLinkBundle(currentRow);
      const snippet = String(bundle.smsSnippet || bundle.reportUrl || '').trim();
      await copyTextToClipboard(snippet);
      if (typeof window.showAppToast === 'function') {
        window.showAppToast('SMS snippet copied.', { variant: 'success' });
      }
    } catch (err) {
      const msg = err && err.message ? err.message : 'Copy failed';
      if (typeof window.showAppToast === 'function') window.showAppToast(msg, { variant: 'error' });
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('#sidebarReportEmailBtn')) {
      e.preventDefault();
      handleSidebarReportEmailClick();
      return;
    }
    if (e.target.closest('#sidebarHostedAuditBtn')) {
      e.preventDefault();
      const preOpened = primeExternalLoadingTab('Hosted audit', 'Preparing your shareable audit report…');
      void handleSidebarHostedAuditClick(preOpened);
      return;
    }
    if (e.target.closest('#sidebarCopyAuditLinkBtn')) {
      e.preventDefault();
      handleSidebarCopyAuditLinkClick();
      return;
    }
    if (e.target.closest('#sidebarCopySmsAuditBtn')) {
      e.preventDefault();
      handleSidebarCopySmsAuditClick();
      return;
    }
    if (e.target.closest('#sidebarIncludeCoupon') || e.target.closest('label[for="sidebarIncludeCoupon"]')) {
      syncSidebarOutreachButtons(currentRow || null);
    }

  });

  async function runAiReadinessForRow(row) {
    if (!row) throw new Error('No lead selected.');
    const key = await ensureRowHasLeadKey(row);
    const enrichment = {
      hasSchemaMarkup: row.dataset.hasSchemaMarkup === 'true',
      hasChatbot: row.dataset.hasChatbot === 'true',
      hasClickToCall: row.dataset.hasClickToCall === 'true',
      isOutdated: row.dataset.isOutdated === 'true',
    };
    const res = await fetch(`/leads/${encodeURIComponent(key)}/ai-readiness`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(enrichment),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.success) {
      throw new Error((body && body.error) || 'AI readiness assessment failed');
    }
    const a = body.assessment;
    if (!a) throw new Error('Empty assessment response');
    const resultEl = document.getElementById('aiReadinessResult');
    const errorEl = document.getElementById('aiReadinessError');
    const resultsWrap = document.getElementById('pageSpeedAuditResults');
    if (errorEl) errorEl.classList.add('hidden');
    renderAiReadinessResult(a, resultEl, null, null);
    if (resultsWrap) resultsWrap.classList.remove('hidden');
    syncPageSpeedAuditPanelBodyVisibility();
    return a;
  }

  function renderAiReadinessResult(a, resultEl, statusText, statusDetail) {
    if (!resultEl) return;
    const score = a.overallScore || 0;
    let scoreColor = 'text-rose-500';
    if (score >= 85) scoreColor = 'text-emerald-500';
    else if (score >= 70) scoreColor = 'text-sky-500';
    else if (score >= 55) scoreColor = 'text-amber-500';

    const catBars = (a.categories || []).map(function(cat) {
      let barColor = 'bg-rose-500';
      if (cat.score >= 85) barColor = 'bg-emerald-500';
      else if (cat.score >= 70) barColor = 'bg-sky-500';
      else if (cat.score >= 55) barColor = 'bg-amber-500';
      const findingsHtml = (cat.findings || []).map(function(f) { return '<li class="text-[11px] text-brand-muted dark:text-slate-400 leading-relaxed">' + f + '</li>'; }).join('');
      return '<div class="mb-3"><div class="flex items-center justify-between mb-1"><span class="text-[10px] font-bold uppercase tracking-widest text-brand-dark dark:text-white">' + cat.name + '</span><span class="text-[11px] font-black">' + cat.score + '/100</span></div><div class="h-1.5 rounded-full bg-brand-border/40 dark:bg-white/10 overflow-hidden"><div class="h-full rounded-full ' + barColor + '" style="width:' + cat.score + '%"></div></div><ul class="mt-1.5 space-y-0.5 ml-0.5">' + findingsHtml + '</ul></div>';
    }).join('');

    const quickWinsHtml = (a.quickWins || []).map(function(w) { return '<li class="text-[11px] text-brand-muted dark:text-slate-400 leading-relaxed">' + w + '</li>'; }).join('');
    const bizTitle = (currentRow && currentRow.dataset) ? (currentRow.dataset.title || '') : '';
    const mailtoSubject = encodeURIComponent('AI Readiness Blueprint — ' + bizTitle);
    const mailtoBody = encodeURIComponent('Hi AdHello team, I would like to order the Full AI Readiness Blueprint for ' + bizTitle + '. The AI Readiness score was ' + a.overallScore + '/100 (Grade ' + a.grade + '). Please send me the details.');

    resultEl.innerHTML = '<div class="mt-4 rounded-2xl border border-brand-border/40 dark:border-white/10 bg-white dark:bg-slate-900/60 p-4 space-y-3"><div class="flex items-center justify-between"><div><p class="text-[9px] font-black uppercase tracking-widest text-brand-muted mb-0.5">AI Readiness Score</p><p class="text-[28px] font-black leading-none ' + scoreColor + '">' + a.overallScore + '<span class="text-sm font-bold text-brand-muted dark:text-slate-500">/100</span></p></div><div class="text-right"><span class="inline-block px-3 py-1 rounded-full text-[14px] font-black ' + (score >= 70 ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : score >= 55 ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'bg-rose-500/10 text-rose-600 dark:text-rose-400') + '">' + a.grade + '</span></div></div><p class="text-[12px] font-semibold text-brand-dark dark:text-slate-200 leading-relaxed">' + a.headline + '</p><div class="space-y-1">' + catBars + '</div><div class="rounded-xl bg-rose-500/5 dark:bg-rose-500/10 border border-rose-500/20 px-3 py-2"><p class="text-[9px] font-black uppercase tracking-widest text-rose-600 dark:text-rose-400 mb-0.5">Top Risk</p><p class="text-[11px] font-semibold text-rose-700 dark:text-rose-300 leading-relaxed">' + a.topRisk + '</p></div><div><p class="text-[9px] font-black uppercase tracking-widest text-brand-muted mb-1">Quick Wins</p><ul class="space-y-0.5">' + quickWinsHtml + '</ul></div><div class="rounded-xl bg-brand-yellow/10 dark:bg-brand-yellow/15 border border-brand-yellow/30 px-3 py-3 text-center"><p class="text-[12px] font-bold text-brand-dark dark:text-white mb-1">Get the Full AI Readiness Blueprint</p><p class="text-[10px] text-brand-muted dark:text-slate-400 mb-2 leading-relaxed">' + (a.fullAssessmentCTA || 'Comprehensive AI citation audit, structured data roadmap, content gap analysis, competitive benchmark, and a private strategy call.') + '</p><a href="mailto:hello@adhello.ai?subject=' + mailtoSubject + '&body=' + mailtoBody + '" class="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-yellow text-brand-dark rounded-full text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all shadow-lg shadow-brand-yellow/20"><svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" /></svg>Order Full Assessment — $1,000</a></div></div>';

    resultEl.classList.remove('hidden');
    if (statusText) statusText.textContent = 'Assessment complete';
    if (statusDetail) statusDetail.textContent = 'Grade: ' + a.grade + ' · Generated just now';
  }

  async function handlePageSpeedAuditClick(rowOrEv, maybeEv) {
    let row = null;
    let ev = null;
    if (
      rowOrEv &&
      rowOrEv.dataset &&
      rowOrEv.classList &&
      rowOrEv.classList.contains('result-row')
    ) {
      row = resolveRowForLeadPanelActions(rowOrEv);
      ev = maybeEv;
    } else {
      ev = rowOrEv;
      row = resolveRowForLeadPanelActions();
    }
    if (ev) {
      ev.preventDefault();
      ev.stopPropagation();
    }
    if (row) currentRow = row;

    scrollLeadPanelToSection('pageSpeedAuditSection');

    if (!row) {
      const msg = 'Select a lead from the table first.';
      showPageSpeedAuditError(msg);
      if (typeof window.showAppToast === 'function') {
        window.showAppToast(msg, { variant: 'error' });
      } else window.alert(msg);
      return;
    }
    const websiteUrl = resolveRowWebsiteForAudit(row);
    if (!websiteUrl) {
      const msg = 'Add a website URL to this lead first (Visit Site tile or website field).';
      showPageSpeedAuditError(msg);
      if (typeof window.showAppToast === 'function') {
        window.showAppToast(msg, { variant: 'error' });
      } else window.alert(msg);
      return;
    }
    if (pageSpeedAuditInFlight) {
      if (isPanelAuditActiveForRow(row)) return;
      if (isAuditRunningOnAnotherPanelLead(row)) {
        const other = String(window.__pageSpeedAuditLeadTitle || 'another lead').trim() || 'another lead';
        const msg = `Website audit already running on ${other}. Wait for it to finish or use ← → to return to that lead.`;
        if (typeof window.showAppToast === 'function') {
          window.showAppToast(msg, { variant: 'info' });
        }
        return;
      }
      pageSpeedAuditInFlight = false;
      clearLeadPanelJob('audit', null);
      setPageSpeedAuditUi('idle');
    }

    if (websiteUrl && (!row.dataset.website || row.dataset.website === 'N/A')) {
      row.dataset.website = websiteUrl;
    }

    setPageSpeedAuditUi('active', {
      deferProgressTicker: true,
      phase: {
        pct: 8,
        label: 'Running audit…',
        detail: '',
        step: 'Step 1 · Prep',
        afterMs: 0,
      },
    });
    updatePageSpeedAuditProgress(8, 'Running audit…', '', 'Step 1 · Prep');
    pageSpeedAuditInFlight = true;
    beginLeadPanelJob('audit', row);

    try {
      await ensureRowHasLeadKey(row);
    } catch (ensureErr) {
      pageSpeedAuditInFlight = false;
      clearLeadPanelJob('audit', row);
      setPageSpeedAuditUi('idle');
      const msg = (ensureErr && ensureErr.message) || 'Save this lead before running website audit.';
      showPageSpeedAuditError(msg);
      if (typeof window.showAppToast === 'function') {
        window.showAppToast(msg, { variant: 'error' });
      } else window.alert(msg);
      return;
    }

    beginLeadPanelJob('audit', row);
    startPageSpeedAuditProgressTicker();
    updatePageSpeedAuditProgress(
      12,
      'Starting audit…',
      'Crawling the site for GEO/SEO + GoHighLevel recommendations…',
      'Step 2 · Crawl',
    );
    const loadingLabel = document.getElementById('pageSpeedAuditLoadingLabel');
    try {
      if (loadingLabel) {
        loadingLabel.textContent =
          'Scanning website and generating GEO/SEO + GoHighLevel sell report…';
      }
      const geoData = await runGeoSeoGhlAuditForRow(row, { refresh: true });
      if (typeof window.showAppToast === 'function') {
        const r = geoData.report || {};
        window.showAppToast(
          `GEO/SEO audit ready — ${r.overallScore || '—'}/100 (${r.grade || '—'}). See GHL tools below.`,
          { variant: 'success' },
        );
      }

      if (loadingLabel) {
        loadingLabel.textContent = 'Running Lighthouse (optional, if PageSpeed key is set)…';
      }
      updatePageSpeedAuditProgress(92, 'Running Lighthouse…', 'Optional PageSpeed scan for performance scores.', 'Bonus · Lighthouse');
      try {
        await runPageSpeedAuditForRow(row);
      } catch (psErr) {
        console.warn('[pagespeed] optional after GEO audit:', psErr);
      }

      if (loadingLabel) {
        loadingLabel.textContent = 'Preparing shareable audit report link…';
      }
      updatePageSpeedAuditProgress(96, 'Building share link…', 'Creating hosted audit report URL.', 'Final · Share link');
      try {
        await ensureLeadAiAnalysis(row);
        const bundle = await fetchAuditReportLinkBundle(row);
        row.dataset.auditReportUrl = bundle.reportUrl;
        showLeadPanelAuditReportLinks(bundle);
      } catch (reportErr) {
        console.warn('[audit-report-link] after audit:', reportErr);
      }

      // Run GBP audit (non-fatal — don't block on failure)
      try {
        const leadKey = String(row.dataset.leadKey || '').trim();
        const city = String(row.dataset.city || '').trim();
        const state = String(row.dataset.state || '').trim();
        const title = String(row.dataset.title || row.dataset.businessName || '').trim();
        if (title && city && state && leadKey) {
          const gbpRes = await fetch(`/leads/${encodeURIComponent(leadKey)}/gbp-audit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ businessName: title, city, state }),
          });
          const gbpData = await gbpRes.json().catch(() => ({}));
          if (gbpData.success && gbpData.audit) {
            row.dataset.gbpAudit = JSON.stringify(gbpData.audit);
            row.dataset.gbpScore = String(gbpData.audit.totalScore || '');
            row.dataset.gbpGrade = String(gbpData.audit.grade || '');
          }
        }
      } catch (gbpErr) {
        console.warn('[gbp-audit] after audit:', gbpErr);
      }
      updatePageSpeedAuditProgress(100, 'Audit complete', 'GEO/SEO report and GHL recommendations are ready below.', 'Done');
    } catch (err) {
      const msg = err && err.message ? err.message : 'Website audit failed';
      showPageSpeedAuditError(msg);
      const geoErr = document.getElementById('geoSeoGhlAuditError');
      if (geoErr) {
        geoErr.textContent = msg;
        geoErr.classList.remove('hidden');
      }
      if (typeof window.showAppToast === 'function') window.showAppToast(msg, { variant: 'error' });
      else if (typeof window.showProspectToast === 'function') window.showProspectToast(msg);
      else window.alert(msg);
    } finally {
      pageSpeedAuditInFlight = false;
      clearLeadPanelJob('audit', row);
      setPageSpeedAuditUi('idle');
      syncPageSpeedAuditPanel(row);
      syncLeadPanelEmailReportSection(row);
      const results = document.getElementById('pageSpeedAuditResults');
      const body = document.getElementById('pageSpeedAuditPanelBody');
      if (parseGeoSeoGhlAuditFromRow(row) || parsePageSpeedAuditFromRow(row)) {
        if (body) body.classList.remove('hidden');
      }
      if (results && parsePageSpeedAuditFromRow(row)) {
        results.classList.remove('hidden');
        syncPageSpeedAuditPanelBodyVisibility();
      }
    }
  }

  window.__adhelloRunPageSpeedAudit = handlePageSpeedAuditClick;
  window.__setPageSpeedAuditUi = setPageSpeedAuditUi;
  window.__stopPageSpeedAuditProgressTicker = stopPageSpeedAuditProgressTicker;

  if (!window.__adhelloPageSpeedAuditCaptureBound && !window.__adhelloWebsiteAuditEarlyBound) {
    window.__adhelloPageSpeedAuditCaptureBound = true;
    document.addEventListener(
      'click',
      (e) => {
        const btn = e.target.closest('#pageSpeedAuditRunBtn');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        void handlePageSpeedAuditClick(e).catch((err) => {
          console.error('[Website audit] unhandled:', err);
          setPageSpeedAuditUi('idle');
          const msg = (err && err.message) || 'Website audit failed.';
          showPageSpeedAuditError(msg);
          if (typeof window.showAppToast === 'function') {
            window.showAppToast(msg, { variant: 'error' });
          }
        });
      },
      true,
    );
  }

  // --- Contact hunt (sidebar + pipeline row sparkle) ---
  window.__contactHuntInFlight = window.__contactHuntInFlight || new Set();
  /** Lead key/title for the panel scrape / hunt button — avoids showing progress on every lead you browse. */
  window.__panelHuntLeadKey = window.__panelHuntLeadKey || '';
  window.__panelHuntLeadTitle = window.__panelHuntLeadTitle || '';
  window.__huntProgressInterval = window.__huntProgressInterval || null;
  window.__huntProgressStartedAt = 0;

  function stopHuntProgressTickerGlobal() {
    if (window.__huntProgressInterval) {
      clearInterval(window.__huntProgressInterval);
      window.__huntProgressInterval = null;
    }
  }
  window.__stopHuntProgressTickerGlobal = stopHuntProgressTickerGlobal;

  function startHuntProgressTickerGlobal() {
    stopHuntProgressTickerGlobal();
    window.__huntProgressStartedAt = Date.now();
    const tick = () => {
      const panelKey = String(window.__panelHuntLeadKey || '').trim();
      const rowKey = currentRow ? leadPanelRowKey(currentRow) : '';
      if (panelKey && rowKey && rowKey !== panelKey) return;
      const btn = document.getElementById('deepEnhanceBtn');
      if (!btn || btn.dataset.huntState !== 'active') {
        stopHuntProgressTickerGlobal();
        return;
      }
      const elapsed = Date.now() - window.__huntProgressStartedAt;
      const phase = huntProgressForElapsed(elapsed);
      updateDeepEnhanceHuntProgress(phase.pct, phase.label, phase.detail);
    };
    tick();
    window.__huntProgressInterval = setInterval(tick, 900);
  }

  const HUNT_PROGRESS_PHASES = [
    { afterMs: 0, pct: 10, label: 'Starting hunt…', detail: 'Outscraper Google Business lookup, then contacts and website enrich.' },
    { afterMs: 3500, pct: 32, label: 'Fetching GMB & reviews…', detail: 'Outscraper pulls listing, domain, star rating, and review quotes.' },
    { afterMs: 14000, pct: 55, label: 'Enriching contacts…', detail: 'BetterContact + website scrape for email, phone, and socials.' },
    { afterMs: 32000, pct: 78, label: 'AI review summary…', detail: 'OpenRouter writes a short reputation summary from Google reviews.' },
    { afterMs: 55000, pct: 92, label: 'Still hunting…', detail: 'Large review sets can take up to 90 seconds — hang tight.' },
  ];
  const HUNT_CLIENT_MAX_MS = 130000;

  function expireStaleContactHunt(row) {
    const btn = document.getElementById('deepEnhanceBtn');
    if (!btn || btn.dataset.huntState !== 'active') return false;
    const started = parseInt(btn.dataset.huntStartedAt || '0', 10) || 0;
    if (!started || Date.now() - started < HUNT_CLIENT_MAX_MS) return false;
    const key = contactHuntTrackingKey(row);
    if (key && window.__contactHuntInFlight) window.__contactHuntInFlight.delete(key);
    stopHuntProgressTickerGlobal();
    delete btn.dataset.huntStartedAt;
    setDeepEnhanceHuntUi('idle');
    return true;
  }

  function huntProgressForElapsed(elapsedMs) {
    let phase = HUNT_PROGRESS_PHASES[0];
    for (let i = 0; i < HUNT_PROGRESS_PHASES.length; i += 1) {
      if (elapsedMs >= HUNT_PROGRESS_PHASES[i].afterMs) phase = HUNT_PROGRESS_PHASES[i];
    }
    return phase;
  }

  function updateDeepEnhanceHuntProgress(pct, label, detail) {
    const bar = document.getElementById('deepEnhanceProgressBar');
    const status = document.getElementById('deepEnhanceStatusLabel');
    const stepDetail = document.getElementById('deepEnhanceStepDetail');
    if (bar && pct != null) {
      const clamped = Math.max(6, Math.min(100, Number(pct) || 0));
      bar.style.width = `${clamped}%`;
    }
    if (status && label) status.textContent = String(label);
    if (stepDetail && detail) stepDetail.textContent = String(detail);
  }

  function setDeepEnhanceHuntUi(state, opts) {
    const btn = document.getElementById('deepEnhanceBtn');
    const huntProgressWrap = document.getElementById('huntProgressWrap');
    const main = btn && btn.querySelector('.deep-enhance-main');
    const progressRow = btn && btn.querySelector('.deep-enhance-progress-row');
    const done = btn && btn.querySelector('.deep-enhance-done');
    if (!btn) return;

    const next = state || 'idle';
    btn.dataset.huntState = next;

    if (next === 'active') {
      btn.dataset.huntStartedAt = String(Date.now());
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
      btn.classList.add('loading', 'cursor-wait', 'hunt-active');
      if (main) {
        main.classList.remove('hidden');
        main.removeAttribute('aria-hidden');
      }
      if (progressRow) {
        progressRow.classList.remove('hidden');
        progressRow.removeAttribute('aria-hidden');
      }
      if (done) {
        done.classList.add('hidden');
        done.setAttribute('aria-hidden', 'true');
      }
      if (huntProgressWrap) huntProgressWrap.classList.add('hidden');
      const phase = (opts && opts.phase) || HUNT_PROGRESS_PHASES[0];
      updateDeepEnhanceHuntProgress(phase.pct, phase.label, phase.detail);
      return;
    }

    if (next === 'done') {
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'false');
      btn.classList.remove('loading', 'cursor-wait', 'hunt-active');
      if (main) {
        main.classList.add('hidden');
        main.setAttribute('aria-hidden', 'true');
      }
      if (progressRow) {
        progressRow.classList.add('hidden');
        progressRow.setAttribute('aria-hidden', 'true');
      }
      if (done) {
        done.classList.remove('hidden');
        done.removeAttribute('aria-hidden');
      }
      if (huntProgressWrap) huntProgressWrap.classList.add('hidden');
      updateDeepEnhanceHuntProgress(100, 'Hunt complete', 'Contacts, reviews, and AI summary updated.');
      return;
    }

    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    delete btn.dataset.huntStartedAt;
    btn.classList.remove('loading', 'cursor-wait', 'hunt-active');
    if (main) {
      main.classList.remove('hidden');
      main.removeAttribute('aria-hidden');
    }
    if (progressRow) {
      progressRow.classList.add('hidden');
      progressRow.setAttribute('aria-hidden', 'true');
    }
    if (done) {
      done.classList.add('hidden');
      done.setAttribute('aria-hidden', 'true');
    }
    if (huntProgressWrap) huntProgressWrap.classList.add('hidden');
    updateDeepEnhanceHuntProgress(8, 'Hunting…', 'BetterContact, website search, Google reviews, and AI reputation summary (may take 30–90s).');
  }
  window.__setDeepEnhanceHuntUi = setDeepEnhanceHuntUi;

  function readLastContactHuntAtFromRow(row) {
    if (!row) return '';
    const raw = (row.dataset.lastContactHuntAt || '').trim();
    if (raw) return raw;
    try {
      const updates = JSON.parse(row.dataset.updates || '[]');
      if (!Array.isArray(updates)) return '';
      for (let i = updates.length - 1; i >= 0; i--) {
        const u = updates[i];
        if (u && u.type === 'enrichment' && u.timestamp) return String(u.timestamp);
      }
    } catch (_) {
      /* ignore */
    }
    return '';
  }

  function contactHuntTrackingKey(row) {
    return leadPanelRowKey(row);
  }

  function isContactHuntInFlightForRow(row) {
    expireStaleContactHunt(row);
    const key = contactHuntTrackingKey(row);
    return !!(key && window.__contactHuntInFlight && window.__contactHuntInFlight.has(key));
  }

  function isPanelHuntUiActiveForRow(row) {
    const job = window.__leadPanelJob;
    if (!job || job.kind !== 'hunt') return false;
    if (job.key !== leadPanelRowKey(row)) return false;
    return isContactHuntInFlightForRow(row);
  }

  function setPanelHuntLeadKey(key, title) {
    window.__panelHuntLeadKey = String(key || '').trim();
    window.__panelHuntLeadTitle = String(title || '').trim();
  }

  function clearPanelHuntLeadKey(key) {
    const k = String(key || '').trim();
    const panelKey = String(window.__panelHuntLeadKey || '').trim();
    if (!panelKey || !k || panelKey === k) {
      window.__panelHuntLeadKey = '';
      window.__panelHuntLeadTitle = '';
    }
  }

  function isHuntRunningOnAnotherPanelLead(row) {
    const other = leadPanelJobOnOtherRow(row);
    if (!other || other.kind !== 'hunt') return false;
    return !!(window.__contactHuntInFlight && window.__contactHuntInFlight.has(other.key));
  }

  function setSidebarContactHuntBusy(busy, row) {
    if (busy && row && !isPanelHuntUiActiveForRow(row)) return;
    if (busy) setDeepEnhanceHuntUi('active');
    else setDeepEnhanceHuntUi('idle');
  }

  function syncContactHuntPanel(row) {
    const meta = document.getElementById('huntLastRunMeta');
    if (!row) return;
    coerceLeadPanelButtonsForView(row);

    expireStaleContactHunt(row);

    const btn = document.getElementById('deepEnhanceBtn');
    const hasWebsite = leadRowHasScrapableWebsite(row);
    if (btn) {
      const label = btn.querySelector('.deep-enhance-label');
      if (label) {
        label.textContent = hasWebsite ? 'Scrape contacts & socials' : 'Hunt contacts & reviews';
      }
      btn.title = hasWebsite
        ? 'Queue this lead for Chrome extension website enrich (contacts & socials)'
        : 'Hunt contacts & reviews (no website on file)';
    }

    const uiActive = !!(btn && btn.dataset.huntState === 'active');
    const inFlight = isPanelHuntUiActiveForRow(row);
    if (inFlight) {
      if (btn && btn.dataset.huntState !== 'active') setDeepEnhanceHuntUi('active');
      startHuntProgressTickerGlobal();
      if (meta) {
        const name = (row.dataset.title || window.__panelHuntLeadTitle || 'this lead').trim();
        meta.textContent = `Hunt in progress for ${name} — contacts, Google reviews, and AI summary (30–90s).`;
        meta.classList.remove('hidden');
      }
      return;
    }

    if (isHuntRunningOnAnotherPanelLead(row)) {
      if (uiActive && btn && btn.dataset.huntState !== 'done') {
        stopHuntProgressTickerGlobal();
        setDeepEnhanceHuntUi('idle');
      }
      stopHuntProgressTickerGlobal();
      if (meta) {
        const other = String(window.__panelHuntLeadTitle || 'another lead').trim() || 'another lead';
        meta.textContent = `Contact hunt still running on ${other}. Use ← → to return to that lead, or wait for the bell notification.`;
        meta.classList.remove('hidden');
      }
      return;
    }

    if (uiActive && btn && btn.dataset.huntState !== 'done') {
      stopHuntProgressTickerGlobal();
      setDeepEnhanceHuntUi('idle');
    }

    stopHuntProgressTickerGlobal();

    if (btn && btn.dataset.huntState === 'done') return;

    setDeepEnhanceHuntUi('idle');
    const at = readLastContactHuntAtFromRow(row);
    if (meta) {
      if (at) {
        meta.textContent = `Last contact hunt: ${formatAuditDateShort(at)}`;
        meta.classList.remove('hidden');
      } else {
        meta.textContent = '';
        meta.classList.add('hidden');
      }
    }
  }

  function findRowByLeadKey(leadKey) {
    const k = String(leadKey || '').trim().replace(/^lead:/i, '');
    if (!k) return null;
    for (const row of document.querySelectorAll('.result-row')) {
      if (leadPanelRowKey(row) === k) return row;
    }
    return null;
  }

  function applyContactHuntResultToRow(row, data, opts) {
    const options = opts || {};
    const preHuntSnap = options.preHuntSnap;
    const isSidebarTrigger = !!options.isSidebarTrigger;
    const deepEnhanceBtn = options.deepEnhanceBtn || document.getElementById('deepEnhanceBtn');
    const fromRowAction = !!options.fromRowAction;
    const notifyHunt = options.notifyHunt;
    const huntKey = String(row.dataset.leadKey || '').trim();
    const d = data.lead || data.data;

    if (data.lead && typeof data.lead === 'object') {
      syncPersistedLeadToRowDataset(row, data.lead);
      if (preHuntSnap) restoreRowLeadFieldsIfErased(row, preHuntSnap);
    } else if (d) {
      if (d.website && d.website !== 'N/A') row.dataset.website = d.website;
      if (data.foundUrl) row.dataset.website = data.foundUrl;
      if (d.email && d.email !== 'N/A') row.dataset.email = d.email;
      if (d.facebook && d.facebook !== 'N/A') row.dataset.facebook = d.facebook;
      if (d.instagram && d.instagram !== 'N/A') row.dataset.instagram = d.instagram;
      if (d.twitter && d.twitter !== 'N/A') row.dataset.twitter = d.twitter;
      if (d.lastContactHuntAt) row.dataset.lastContactHuntAt = d.lastContactHuntAt;
      if (d.updates) row.dataset.updates = JSON.stringify(d.updates);
    }

    if (!row.dataset.lastContactHuntAt) {
      row.dataset.lastContactHuntAt = new Date().toISOString();
    }

    updateRowContactCells(row);
    syncRowSocialsUnderPhone(row);
    syncRowReviewsDisplay(row);

    if (huntKey) {
      const huntNorm = huntKey.replace(/^lead:/i, '');
      window.__contactHuntInFlight.delete(huntNorm);
    }
    clearLeadPanelJob('hunt', row);
    stopHuntProgressTickerGlobal();
    updateProcessingStatus(false);

    const reviewGridDone = document.getElementById('reviewIntelGrid');
    if (reviewGridDone) reviewGridDone.classList.remove('review-intel-loading');

    if (
      currentRow === row ||
      (currentRow && row && leadPanelRowKey(currentRow) === leadPanelRowKey(row))
    ) {
      populatePanel(row);
      if (data.lead && typeof data.lead === 'object' && typeof window.__paintPanelFromLeadRecord === 'function') {
        try {
          window.__paintPanelFromLeadRecord(data.lead, row);
        } catch (paintRecErr) {
          console.warn('[Contact hunt] panel record paint failed:', paintRecErr);
        }
      }
      paintPanelHeaderContactStrip(row);
      scheduleReviewIntelligence(row);

      const rh = data.reviewHunt;
      const meta = document.getElementById('huntLastRunMeta');
      if (rh && rh.reviewError && meta) {
        meta.textContent = `Contacts updated. Google reviews: ${rh.reviewError}`;
        meta.classList.remove('hidden');
      } else if (rh && rh.reviewsCount != null && meta) {
        const n = parseInt(rh.reviewsCount, 10) || 0;
        const sn = rh.snippetCount != null ? parseInt(rh.snippetCount, 10) || 0 : 0;
        meta.textContent = n > 0
          ? `Google: ${Number(row.dataset.rating || 0).toFixed(1)}★ · ${n} reviews${sn ? ` · ${sn} quote(s)` : ''}`
          : 'Google reviews refreshed (count pending).';
        meta.classList.remove('hidden');
      }

      if (deepEnhanceBtn && isSidebarTrigger) {
        setDeepEnhanceHuntUi('done');
        setTimeout(() => {
          setDeepEnhanceHuntUi('idle');
          syncContactHuntPanel(row);
        }, 2600);
      } else if (fromRowAction && notifyHunt) {
        notifyHunt('Hunt complete — check contacts, rating, and review summary.', 'success');
      } else {
        syncContactHuntPanel(row);
      }
    } else if (deepEnhanceBtn && isSidebarTrigger) {
      setDeepEnhanceHuntUi('idle');
    }
  }

  document.addEventListener('agency-os-contact-hunt-finished', (ev) => {
    const detail = (ev && ev.detail) || {};
    const row = findRowByLeadKey(detail.leadKey);
    if (!row || !detail.success) return;
    applyContactHuntResultToRow(row, detail, { isSidebarTrigger: true });
  });

  async function pollContactHuntStatus(leadKey, opts) {
    const maxMs = opts && opts.maxMs != null ? opts.maxMs : 180000;
    const interval = opts && opts.interval != null ? opts.interval : 2500;
    const onTick = opts && opts.onTick;
    const deadline = Date.now() + maxMs;
    const started = Date.now();
    let idleStreak = 0;
    if (onTick) onTick(0);
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, interval));
      if (onTick) onTick(Date.now() - started);
      const { res, data: d } = await fetchJsonWithTimeout(
        `/leads/${encodeURIComponent(leadKey)}/enhance-status`,
        { credentials: 'same-origin', headers: { Accept: 'application/json' } },
        15000,
      );
      if (d.status === 'processing') {
        idleStreak = 0;
        continue;
      }
      if (d.status === 'done') {
        return {
          success: !!d.success,
          lead: d.lead,
          data: d.data,
          error: d.error,
        };
      }
      if (d.status === 'error') {
        return { success: false, error: d.error || 'Contact hunt failed.' };
      }
      if (d.status === 'idle') {
        idleStreak += 1;
        if (Date.now() - started < 20000 && idleStreak < 8) continue;
        return {
          success: false,
          error: 'Contact hunt ended before results were ready. Refresh and try again.',
        };
      }
      if (!res.ok) {
        return { success: false, error: d.error || `Status check failed (${res.status}).` };
      }
    }
    throw new Error(
      'Contact hunt is taking longer than expected. Refresh this lead in a minute to see new data.'
    );
  }

  function leadRowHasScrapableWebsite(row) {
    const website = String((row && row.dataset && row.dataset.website) || '').trim();
    return !!(website && website !== 'N/A' && website !== '—');
  }

  async function queueChromeWebsiteEnrichForLeadRow(row, options) {
    const opts = options || {};
    const triggerBtn = opts.triggerBtn || null;
    const isSidebarTrigger = !!(triggerBtn && triggerBtn.id === 'deepEnhanceBtn');
    const leadKey = String((row && row.dataset && row.dataset.leadKey) || '').trim();
    if (!leadKey) {
      return { success: false, error: 'no_key', message: 'Save this lead first, then queue website enrich.' };
    }
    if (typeof window.__queueWebsiteEnrichForKeys !== 'function') {
      return {
        success: false,
        error: 'no_queue',
        message: 'Website enrich is not available. Refresh the page and try again.',
      };
    }
    try {
      if (triggerBtn && !isSidebarTrigger) {
        triggerBtn.disabled = true;
        triggerBtn.setAttribute('aria-busy', 'true');
      }
      const result = await window.__queueWebsiteEnrichForKeys([leadKey], {
        toast: opts.toast !== false,
      });
      return { success: true, chromeQueued: true, ...result };
    } catch (err) {
      return {
        success: false,
        error: 'queue_failed',
        message: (err && err.message) || 'Could not queue website enrich.',
      };
    } finally {
      if (triggerBtn && !isSidebarTrigger) {
        triggerBtn.disabled = false;
        triggerBtn.removeAttribute('aria-busy');
      }
    }
  }

  async function runContactHuntForRow(row, options) {
    const opts = options || {};
    const silent = !!opts.silent;
    const auto = !!opts.auto;
    const deepEnhanceBtn = document.getElementById('deepEnhanceBtn');
    const triggerBtn = opts.triggerBtn || (silent ? null : deepEnhanceBtn);
    const fromRowAction = !!opts.fromRowAction;
    const isSidebarTrigger = !!(triggerBtn && triggerBtn.id === 'deepEnhanceBtn');

    row = resolveRowForLeadPanelActions(row);

    let huntTrackKey = '';
    const syncSidebarForRow = (busy) => {
      if (currentRow === row) {
        if (busy) setSidebarContactHuntBusy(true, row);
        else syncContactHuntPanel(row);
      }
    };

    const notifyHunt = (msg, variant) => {
      if (silent) return;
      if (typeof window.showAppToast === 'function') {
        window.showAppToast(msg, { variant: variant || 'warning' });
      } else {
        alert(msg);
      }
    };

    if (!row) {
      if (!silent && typeof window.showAppToast === 'function') {
        window.showAppToast('Select a lead from the table first.', { variant: 'warning' });
      }
      if (isSidebarTrigger) setDeepEnhanceHuntUi('idle');
      return { success: false };
    }

    currentRow = row;
    if (!silent) scrollLeadPanelToSection('leadPanelContactHuntSection');

    // Leads with a website: queue Chrome extension scrape (same as bulk "Scrape websites").
    // Silent/auto hunts keep the server contact-hunt path.
    if (!silent && !auto && leadRowHasScrapableWebsite(row)) {
      const queued = await queueChromeWebsiteEnrichForLeadRow(row, { triggerBtn, toast: true });
      if (!queued.success) {
        notifyHunt(queued.message || 'Could not queue website enrich.', 'error');
      }
      return queued;
    }

    if (triggerBtn && triggerBtn.getAttribute('aria-busy') === 'true') {
      const trackKey = contactHuntTrackingKey(row);
      const actuallyBusy = trackKey && window.__contactHuntInFlight.has(trackKey);
      if (actuallyBusy) {
        return { success: false, error: 'busy' };
      }
      if (!isSidebarTrigger) {
        triggerBtn.disabled = false;
        triggerBtn.removeAttribute('aria-busy');
      }
    }

    expireStaleContactHunt(row);

    const existingKey = String(row.dataset.leadKey || '').trim();
    const pendingTrackKey = existingKey || contactHuntTrackingKey(row);
    if (pendingTrackKey && window.__contactHuntInFlight.has(pendingTrackKey)) {
      if (!silent && typeof window.showAppToast === 'function') {
        window.showAppToast('Contact hunt already running for this lead.', { variant: 'info' });
      }
      syncSidebarForRow(true);
      return { success: false, error: 'busy' };
    }

    huntTrackKey = pendingTrackKey || contactHuntTrackingKey(row);
    if (huntTrackKey) window.__contactHuntInFlight.add(huntTrackKey);
    if (isSidebarTrigger && huntTrackKey && !silent) {
      beginLeadPanelJob('hunt', row);
    }

    if (isSidebarTrigger && !silent) {
      setDeepEnhanceHuntUi('active', {
        phase: { pct: 8, label: 'Hunting…', detail: '' },
      });
      startHuntProgressTickerGlobal();
    }

    const releaseHuntUi = () => {
      if (huntTrackKey) window.__contactHuntInFlight.delete(huntTrackKey);
      const savedKey = String(row.dataset.leadKey || '').trim();
      const savedNorm = savedKey ? savedKey.replace(/^lead:/i, '') : '';
      if (savedNorm && savedNorm !== huntTrackKey) window.__contactHuntInFlight.delete(savedNorm);
      clearLeadPanelJob('hunt', row);
      stopHuntProgressTickerGlobal();
      const reviewGridBusy = document.getElementById('reviewIntelGrid');
      if (reviewGridBusy) reviewGridBusy.classList.remove('review-intel-loading');
      updateProcessingStatus(false);
      if (isSidebarTrigger) setDeepEnhanceHuntUi('idle');
      else if (triggerBtn) {
        triggerBtn.disabled = false;
        triggerBtn.removeAttribute('aria-busy');
      }
    };

    try {
      await ensureRowHasLeadKey(row);
    } catch (ensureErr) {
      const msg =
        (ensureErr && ensureErr.message) ||
        'Save this lead before running contact hunt.';
      notifyHunt(msg, 'error');
      releaseHuntUi();
      return { success: false, error: msg };
    }

    const savedKey = String(row.dataset.leadKey || '').trim();
    if (savedKey && huntTrackKey && huntTrackKey !== leadPanelRowKey(row)) {
      window.__contactHuntInFlight.delete(huntTrackKey);
      huntTrackKey = leadPanelRowKey(row);
      window.__contactHuntInFlight.add(huntTrackKey);
    } else if (savedKey) {
      huntTrackKey = leadPanelRowKey(row);
      window.__contactHuntInFlight.add(huntTrackKey);
    }
    if (isSidebarTrigger && huntTrackKey) {
      beginLeadPanelJob('hunt', row);
    }

    const key = row.dataset.leadKey;

    const preHuntSnap = snapshotRowLeadFields(row);

    const title = row.dataset.title;
    const city = row.dataset.city;
    const state = row.dataset.state;

    const originalHTML = triggerBtn ? triggerBtn.innerHTML : '';

    const stopHuntProgressTicker = () => {
      stopHuntProgressTickerGlobal();
    };

    const tickHuntProgress = (elapsedMs) => {
      if (!isSidebarTrigger || currentRow !== row) return;
      const phase = huntProgressForElapsed(elapsedMs);
      updateDeepEnhanceHuntProgress(phase.pct, phase.label, phase.detail);
    };

    const startHuntProgressTicker = () => {
      startHuntProgressTickerGlobal();
    };

    const clearHuntBusy = () => {
      stopHuntProgressTicker();
      const reviewGridBusy = document.getElementById('reviewIntelGrid');
      if (reviewGridBusy) reviewGridBusy.classList.remove('review-intel-loading');
      const lk = String(row.dataset.leadKey || key || huntTrackKey || '').trim();
      const lkNorm = lk ? lk.replace(/^lead:/i, '') : '';
      if (lkNorm) window.__contactHuntInFlight.delete(lkNorm);
      if (huntTrackKey && huntTrackKey !== lkNorm) window.__contactHuntInFlight.delete(huntTrackKey);
      clearLeadPanelJob('hunt', row);
      if (triggerBtn && !isSidebarTrigger) {
        triggerBtn.disabled = false;
        triggerBtn.removeAttribute('aria-busy');
        triggerBtn.innerHTML = originalHTML;
      }
      if (isSidebarTrigger) {
        stopHuntProgressTickerGlobal();
        setDeepEnhanceHuntUi('idle');
      } else if (currentRow === row) {
        syncContactHuntPanel(row);
      }
    };

    const setHuntBusy = () => {
      const lk = String(row.dataset.leadKey || key || '').trim();
      if (lk) window.__contactHuntInFlight.add(lk);
      if (isSidebarTrigger) {
        if (deepEnhanceBtn && deepEnhanceBtn.dataset.huntState !== 'active') setDeepEnhanceHuntUi('active');
        updateDeepEnhanceHuntProgress(10, 'Starting hunt…', HUNT_PROGRESS_PHASES[0].detail);
        if (!window.__huntProgressInterval) startHuntProgressTicker();
      } else if (triggerBtn) {
        triggerBtn.disabled = true;
        triggerBtn.setAttribute('aria-busy', 'true');
        triggerBtn.innerHTML =
          '<svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>';
      }
      const meta = document.getElementById('huntLastRunMeta');
      if (meta && currentRow === row) {
        meta.textContent = silent
          ? 'Enriching lead (Outscraper, reviews, AI summary)…'
          : 'Hunt in progress — contacts, reviews, and AI summary…';
        meta.classList.remove('hidden');
      }
    };

    updateProcessingStatus(true);
    setHuntBusy();

    const reviewGrid = document.getElementById('reviewIntelGrid');
    if (reviewGrid) reviewGrid.classList.add('review-intel-loading');

    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    try {
      const huntKey = String(row.dataset.leadKey || '').trim();
      if (!huntKey) {
        throw new Error('Could not resolve a saved lead key for contact hunt.');
      }

      let res = await fetchJsonWithTimeout(
        `/leads/${encodeURIComponent(huntKey)}/enhance`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
        },
        30000,
      );
      let data = res.data;

      if (!res.res.ok && !data.success && !data.processing) {
        const httpErr = data.error || `Request failed (${res.res.status})`;
        notifyHunt(httpErr, res.res.status === 404 ? 'error' : 'warning');
        updateProcessingStatus(false);
        clearHuntBusy();
        return { success: false, error: httpErr };
      }

      if (data.processing) {
        if (window.agencyOsContactHunt) {
          window.agencyOsContactHunt.track({
            leadKey: huntKey,
            title: row.dataset.title || 'Lead',
          });
          data = await window.agencyOsContactHunt.waitFor(huntKey);
        } else {
          data = await pollContactHuntStatus(huntKey, { onTick: tickHuntProgress, maxMs: 180000 });
        }
      }

      if (data.success) {
        applyContactHuntResultToRow(row, data, { preHuntSnap, isSidebarTrigger, deepEnhanceBtn, fromRowAction, notifyHunt });
        return { success: true, data };
      }

      const errMsg = data.error || 'No additional contact data discovered yet.';
      if (data.lead && typeof data.lead === 'object') {
        syncPersistedLeadToRowDataset(row, data.lead);
        if (currentRow && leadPanelRowKey(currentRow) === leadPanelRowKey(row)) {
          populatePanel(row);
        }
      } else {
        row.dataset.lastContactHuntAt = new Date().toISOString();
        syncContactHuntPanel(row);
      }
      notifyHunt(errMsg, 'warning');
      updateProcessingStatus(false);
      clearHuntBusy();
      return { success: false, error: errMsg };
    } catch (err) {
      console.error('Enhancement failed:', err);
      const failMsg =
        err && err.message ? String(err.message) : 'Enhancement failed. Please try again later.';
      notifyHunt(failMsg, 'error');
      updateProcessingStatus(false);
      clearHuntBusy();
      return { success: false, error: failMsg };
    }
  }
  window.__runContactHuntImpl = runContactHuntForRow;

  function maybeAutoBackgroundEnhance(row, leadRecord) {
    if (!row || !leadRecord) return;
    const key = String(row.dataset.leadKey || leadRecord.key || '')
      .trim()
      .replace(/^lead:/i, '');
    if (!key) return;
    if (!window.__autoContactHuntKeys) window.__autoContactHuntKeys = new Set();
    if (window.__autoContactHuntKeys.has(key)) return;
    if (window.__contactHuntInFlight && window.__contactHuntInFlight.has(key)) return;
    window.__autoContactHuntKeys.add(key);
    void runContactHuntForRow(row, { silent: true, auto: true }).catch((err) => {
      console.warn('[Lead panel] auto enrich failed:', err);
    });
  }

  if (!window.__adhelloContactHuntCaptureBound && !window.__adhelloContactHuntEarlyBound) {
    window.__adhelloContactHuntCaptureBound = true;
    document.addEventListener(
      'click',
      (e) => {
        const btn = e.target.closest('#deepEnhanceBtn');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        const row = resolveRowForLeadPanelActions();
        if (!row) {
          const msg = 'Select a lead from the table first.';
          if (typeof window.showAppToast === 'function') {
            window.showAppToast(msg, { variant: 'warning' });
          } else window.alert(msg);
          return;
        }
        currentRow = row;
        setDeepEnhanceHuntUi('active', {
          phase: { pct: 8, label: 'Hunting…', detail: '' },
        });
        void runContactHuntForRow(row, { triggerBtn: btn }).catch((err) => {
          console.error('[Contact hunt] unhandled:', err);
          stopHuntProgressTickerGlobal();
          setDeepEnhanceHuntUi('idle');
          const msg = (err && err.message) || 'Contact hunt failed.';
          if (typeof window.showAppToast === 'function') {
            window.showAppToast(msg, { variant: 'error' });
          }
        });
      },
      true,
    );
  }

  const reviewIntelRefreshBtn = document.getElementById('reviewIntelRefreshBtn');
  if (reviewIntelRefreshBtn) {
    reviewIntelRefreshBtn.addEventListener('click', () => {
      if (currentRow) scheduleReviewIntelligence(currentRow, { refresh: true });
    });
  }

  // --- Panel Save Lead button (results page) ---
  const panelSaveButtons = ['panelSaveBtn', 'mobilePanelSaveBtn'];
  panelSaveButtons.forEach(id => {
      const btn = document.getElementById(id);
      if (btn) {
          btn.addEventListener('click', async () => {
              if (!currentRow) return;

              const isSaved = isLeadTitleSaved(currentRow.dataset.title);

              if (isSaved) {
                  await unsaveLead(currentRow);
                  panelSaveButtons.forEach(id => {
                      const b = document.getElementById(id);
                      if (b) markPanelBtnUnsaved(b);
                  });
              } else {
                  await saveLead(currentRow);
                  panelSaveButtons.forEach(id => {
                      const b = document.getElementById(id);
                      if (b) markPanelBtnSaved(b);
                  });
              }
          });
      }
  });

  // --- Remove from Leads button (leads page) ---
  const removeButtons = ['panelRemoveBtn', 'mobilePanelRemoveBtn'];
  removeButtons.forEach(id => {
      const btn = document.getElementById(id);
      if (btn) {
          btn.addEventListener('click', async () => {
              if (!currentRow) return;
              const leadKey = currentRow.dataset.leadKey;
              if (!leadKey) return;

              try {
                  const res = await fetch(`/leads/${leadKey}/delete`, {
                      method: 'POST',
                      headers: { 'Accept': 'application/json' },
                  });
                  const data = await res.json();

                  if (data.success) {
                      // Remove row from table
                      currentRow.remove();
                      // Close panels
                      const panel = document.getElementById('sidePanel');
                      if (panel) panel.classList.remove('open');
                      if (mobilePanel) {
                          mobilePanel.classList.remove('open');
                          mobilePanel.classList.replace('opacity-100', 'opacity-0');
                          clearLeadDetailPanelForceStyles(mobilePanel);
                          setTimeout(() => mobilePanel.classList.add('hidden'), 300);
                          document.body.style.overflow = '';
                      }
                      currentRow = null;

                      // Update lead count text
                      const remainingRows = document.querySelectorAll('.result-row');
                      const countEl = document.querySelector('.text-brand-muted.font-medium');
                      if (countEl) {
                          const count = remainingRows.length;
                          countEl.textContent = `You have ${count} bookmarked lead${count !== 1 ? 's' : ''} in your collection.`;
                      }

                      // If no more leads, reload to show empty state
                      if (remainingRows.length === 0) {
                          window.location.reload();
                      }
                  }
              } catch (err) {
                  console.error('Failed to remove lead:', err);
              }
          });
      }
  });

  // --- Save a lead ---
  async function saveLead(row, opts) {
    const options = opts && typeof opts === 'object' ? opts : {};
    const folderEl = document.getElementById('bulkFolderSelect');
    const folderFromBar = folderEl && folderEl.value ? String(folderEl.value).trim() : '';
    const targetFolderKey =
      folderFromBar ||
      (typeof window.SEARCH_TARGET_FOLDER_KEY === 'string'
        ? window.SEARCH_TARGET_FOLDER_KEY.trim()
        : '');
    const jobType =
      (row.dataset.jobType && String(row.dataset.jobType).trim()) ||
      (typeof window.SEARCH_JOB_TYPE === 'string' ? window.SEARCH_JOB_TYPE.trim() : '');
    const sourceType = row.dataset.sourceType ? String(row.dataset.sourceType).trim() : '';
    const titleKey = normalizeLeadTitleKey(row.dataset.title);
    const leadData = {
      title: row.dataset.title,
      phone: row.dataset.phone,
      website: row.dataset.website,
      email: row.dataset.email,
      categoryName: row.dataset.category,
      address: row.dataset.address,
      city: row.dataset.city,
      state: row.dataset.state || '',
      totalScore: parseFloat(row.dataset.rating),
      reviewsCount: parseInt(row.dataset.reviews, 10),
      url: row.dataset.url,
      facebook: row.dataset.facebook,
      instagram: row.dataset.instagram,
      twitter: row.dataset.twitter,
      folderKey: targetFolderKey,
      jobType,
      sourceType,
    };

    try {
      const res = await fetch('/leads/save', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(leadData),
      });
      const data = await res.json();

      if (data.success && data.key) {
        savedLeads.set(titleKey, data.key);
        row.dataset.leadKey = data.key;
        const bookmarkBtn = row.querySelector('.bookmark-btn');
        if (bookmarkBtn) markBookmarkSaved(bookmarkBtn);
        if (!options.silent && typeof window.showProspectToast === 'function') {
          window.showProspectToast('Lead saved');
        }
        return true;
      }
      if (!options.silent && typeof window.showAppToast === 'function') {
        window.showAppToast((data && data.error) || 'Could not save lead', { variant: 'error' });
      }
    } catch (err) {
      console.error('Failed to save lead:', err);
      if (!options.silent && typeof window.showAppToast === 'function') {
        window.showAppToast(err.message || 'Could not save lead', { variant: 'error' });
      }
    }
    return false;
  }
  window.__saveSearchResultLead = saveLead;
  window.__ensureRowHasLeadKey = ensureRowHasLeadKey;

  // --- Unsave a lead ---
  async function unsaveLead(row) {
    const titleKey = normalizeLeadTitleKey(row.dataset.title);
    const leadKey = savedLeads.get(titleKey) || row.dataset.leadKey;
    if (!leadKey) return;

    try {
      const res = await fetch(`/leads/${leadKey}/delete`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      const data = await res.json();

      if (data.success) {
        savedLeads.delete(titleKey);
        delete row.dataset.leadKey;
        const bookmarkBtn = row.querySelector('.bookmark-btn');
        if (bookmarkBtn) markBookmarkUnsaved(bookmarkBtn);
        if (typeof window.showProspectToast === 'function') {
          window.showProspectToast('Removed from saved leads');
        }
      }
    } catch (err) {
      console.error('Failed to unsave lead:', err);
    }
    return false;
  }
  window.__unsaveSearchResultLead = unsaveLead;

  async function togglePipelineLeadBookmark(row, bookmarkBtn) {
    if (!row || !bookmarkBtn) return false;
    if (bookmarkBtn.dataset.bookmarkBusy === '1') return false;

    let leadKey = String((row.dataset && row.dataset.leadKey) || '').trim();
    if (!leadKey) {
      const cb = row.querySelector && row.querySelector('input.lead-checkbox[data-key]');
      leadKey = String((cb && cb.getAttribute('data-key')) || '').trim();
      if (leadKey && row.dataset) row.dataset.leadKey = leadKey;
    }
    if (!leadKey) {
      if (typeof window.showAppToast === 'function') {
        window.showAppToast('Could not bookmark — missing lead key.', { variant: 'error' });
      }
      return false;
    }

    const savedAttr = bookmarkBtn.getAttribute('data-saved');
    const currentlySaved =
      savedAttr === '1' ||
      bookmarkBtn.dataset.saved === '1' ||
      bookmarkBtn.classList.contains('bookmark-btn--saved')
        ? true
        : savedAttr === '0' || bookmarkBtn.dataset.saved === '0'
          ? false
          : row.dataset.bookmarked === '1';
    const next = !currentlySaved;

    bookmarkBtn.dataset.bookmarkBusy = '1';
    bookmarkBtn.setAttribute('aria-busy', 'true');
    if (next) markBookmarkSaved(bookmarkBtn);
    else markBookmarkUnsaved(bookmarkBtn);
    if (row.dataset) {
      row.dataset.bookmarked = next ? '1' : '0';
      row.dataset.bookmarkClient = '1';
    }

    try {
      const res = await fetch('/leads/' + encodeURIComponent(leadKey) + '/update', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ bookmarked: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error((data && data.error) || 'Could not update bookmark');
      }
      if (row.dataset) {
        row.dataset.bookmarked = next ? '1' : '0';
        row.dataset.bookmarkClient = '1';
      }
      const rec = findInitialSavedLeadRecord(row);
      if (rec) rec.bookmarked = next;
      // Keep optimistic UI after a successful POST even if lead.bookmarked is missing/false.
      if (next) markBookmarkSaved(bookmarkBtn);
      else markBookmarkUnsaved(bookmarkBtn);
      if (typeof window.showProspectToast === 'function') {
        window.showProspectToast(next ? 'Lead bookmarked' : 'Bookmark removed');
      }
      return true;
    } catch (err) {
      console.error('Failed to toggle pipeline bookmark:', err);
      if (next) markBookmarkUnsaved(bookmarkBtn);
      else markBookmarkSaved(bookmarkBtn);
      if (row.dataset) {
        row.dataset.bookmarked = next ? '0' : '1';
        delete row.dataset.bookmarkClient;
      }
      if (typeof window.showAppToast === 'function') {
        window.showAppToast(err.message || 'Could not update bookmark', { variant: 'error' });
      }
      return false;
    } finally {
      delete bookmarkBtn.dataset.bookmarkBusy;
      bookmarkBtn.removeAttribute('aria-busy');
    }
  }
  if (window.__PIPELINE_BOOKMARK_BOUND !== '1') {
    window.__togglePipelineLeadBookmark = togglePipelineLeadBookmark;
  }

  function isPipelineBookmarkControl(btn) {
    if (!btn || !btn.classList) return false;
    return !!(
      btn.classList.contains('pipeline-bookmark-btn') ||
      (isPipelineBookmarkTable() && btn.closest && btn.closest('#prospectLeadsTable'))
    );
  }

  // --- UI helpers ---
  function markBookmarkSaved(btn) {
    if (!btn) return;
    if (isPipelineBookmarkControl(btn) && typeof window.__markPipelineBookmarkSaved === 'function') {
      window.__markPipelineBookmarkSaved(btn);
      return;
    }
    btn.dataset.saved = '1';
    btn.setAttribute('data-saved', '1');
    btn.setAttribute('aria-pressed', 'true');
    btn.classList.add('bg-brand-yellow', 'text-brand-dark', 'border-brand-yellow', 'bookmark-btn--saved');
    btn.classList.remove('text-brand-muted', 'border-brand-border', 'dark:text-slate-400');
    const titles = bookmarkBtnTitles(true);
    btn.setAttribute('title', titles.title);
    btn.setAttribute('aria-label', titles.label);
    const svg = btn.querySelector('svg');
    if (svg) svg.setAttribute('fill', 'currentColor');
  }

  function markBookmarkUnsaved(btn) {
    if (!btn) return;
    if (isPipelineBookmarkControl(btn) && typeof window.__markPipelineBookmarkUnsaved === 'function') {
      window.__markPipelineBookmarkUnsaved(btn);
      return;
    }
    btn.dataset.saved = '0';
    btn.setAttribute('data-saved', '0');
    btn.setAttribute('aria-pressed', 'false');
    btn.classList.remove('bg-brand-yellow', 'text-brand-dark', 'border-brand-yellow', 'bookmark-btn--saved');
    btn.classList.add('text-brand-muted', 'border-brand-border');
    const titles = bookmarkBtnTitles(false);
    btn.setAttribute('title', titles.title);
    btn.setAttribute('aria-label', titles.label);
    const svg = btn.querySelector('svg');
    if (svg) svg.setAttribute('fill', 'none');
  }

  function markPanelBtnSaved(btn) {
    btn.classList.remove('btn-primary');
    btn.classList.add('bg-brand-dark', 'text-white');
    btn.textContent = 'Saved';
  }

  function markPanelBtnUnsaved(btn) {
    btn.classList.remove('bg-brand-dark', 'text-white');
    btn.classList.add('btn-primary');
    btn.textContent = 'Save Lead';
  }

  window.showProspectToast = function showProspectToast(message) {
    let el = document.getElementById('prospectToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'prospectToast';
      el.setAttribute('role', 'status');
      el.className =
        'fixed left-1/2 z-[520] -translate-x-1/2 translate-y-3 opacity-0 pointer-events-none transition-all duration-200 ease-out px-5 py-3 rounded-2xl bg-brand-dark text-white text-sm font-semibold shadow-[0_10px_24px_rgba(0,0,0,0.34)] border border-brand-yellow/50 max-w-[min(90vw,20rem)] text-center';
      document.body.appendChild(el);
    }
    const bulkBarVisible = document.getElementById('bulkActionBar')?.dataset.visible === 'true';
    el.className =
      'fixed left-1/2 z-[520] -translate-x-1/2 opacity-0 pointer-events-none transition-all duration-200 ease-out px-5 py-3 rounded-2xl bg-brand-dark text-white text-sm font-semibold shadow-[0_10px_24px_rgba(0,0,0,0.34)] border border-brand-yellow/50 max-w-[min(90vw,20rem)] text-center ' +
      (bulkBarVisible ? 'bottom-24 translate-y-0' : 'bottom-28 translate-y-3');
    el.textContent = message || 'Done';
    requestAnimationFrame(() => {
      el.classList.remove('opacity-0', 'pointer-events-none');
      if (!bulkBarVisible) el.classList.remove('translate-y-3');
    });
    clearTimeout(window.__prospectToastTimer);
    window.__prospectToastTimer = setTimeout(() => {
      el.classList.add('opacity-0', 'pointer-events-none');
      if (!bulkBarVisible) el.classList.add('translate-y-3');
    }, 3200);
  };

  // --- Bulk Selection & Actions ---
  function mountBulkActionBarToBody() {
    const bar = document.getElementById('bulkActionBar');
    if (bar && bar.parentElement !== document.body) {
      document.body.appendChild(bar);
    }
    return bar;
  }
  const bulkActionBar = mountBulkActionBarToBody();
  const selectedCountCircle = document.getElementById('selectedCountCircle');
  const cancelSelectionBtn = document.getElementById('cancelSelectionBtn');
  const bulkFolderSelect = document.getElementById('bulkFolderSelect');
  const bulkMoveFolderBtn = document.getElementById('bulkMoveFolderBtn');
  const bulkPipelineStageSelect = document.getElementById('bulkPipelineStageSelect');
  const bulkAddToBoardBtn = document.getElementById('bulkAddToBoardBtn');
  const bulkFolderNewToggle = document.getElementById('bulkFolderNewToggle');
  const bulkFolderNewRow = document.getElementById('bulkFolderNewRow');
  const bulkFolderNewName = document.getElementById('bulkFolderNewName');
  const bulkFolderNewSave = document.getElementById('bulkFolderNewSave');
  const bulkFolderNewCancel = document.getElementById('bulkFolderNewCancel');
  const bulkSaveBtn = document.getElementById('bulkSaveBtn');
  const bulkFocusModeBtn = document.getElementById('bulkFocusModeBtn');
  const bulkDirectMailBtn = document.getElementById('bulkDirectMailBtn');
  const bulkPushGhlBtn = document.getElementById('bulkPushGhlBtn');
  const bulkCreateSubaccountBtn = document.getElementById('bulkCreateSubaccountBtn');

  let selectedKeys = new Set();
  let bulkSelectSyncing = false;

  /** True when a leads table is the one the user is interacting with (not kanban-hidden pipeline). */
  function leadsTableIsActive(table) {
    if (!table || !table.isConnected) return false;
    if (table.id === 'prospectLeadsTable') {
      const tableView = document.getElementById('tableView');
      if (tableView && tableView.classList.contains('hidden')) return false;
    }
    const rect = table.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  }

  /** Table that owns the visible select-all header (search results, pipeline, inbound). */
  function getActiveLeadsTable() {
    const candidates = [
      document.getElementById('prospectLeadsTable'),
      document.getElementById('searchResultsLeadsTable'),
    ].filter(Boolean);
    for (const table of candidates) {
      if (leadsTableIsActive(table)) return table;
    }
    const header = document.querySelector('table thead input[data-select-all-leads]');
    if (header) {
      const table = header.closest('table');
      if (table && leadsTableIsActive(table)) return table;
    }
    return candidates[0] || null;
  }

  function getSelectAllHeader() {
    const table = getActiveLeadsTable();
    if (table) {
      const inTable = table.querySelector('thead input[data-select-all-leads]');
      if (inTable) return inTable;
    }
    return document.querySelector('input[data-select-all-leads]');
  }

  function getVisibleResultRowsInTable(table) {
    if (!table) return [];
    const isPipeline = table.id === 'prospectLeadsTable';
    const rowSel = isPipeline
      ? 'tbody tr.result-row:not(.pipeline-row-page-hidden)'
      : 'tbody tr.result-row';
    return Array.from(table.querySelectorAll(rowSel));
  }

  /** Row checkboxes for the current table page (pipeline, inbound, or search results). */
  function getPageLeadCheckboxes() {
    return getVisibleResultRowsInTable(getActiveLeadsTable())
      .map((row) => row.querySelector('.lead-checkbox, .row-checkbox'))
      .filter(Boolean);
  }

  function syncBulkRowHighlights() {
    const table = getActiveLeadsTable();
    const rows = getVisibleResultRowsInTable(table);
    let checkedCount = 0;

    rows.forEach((row) => {
      const cb = row.querySelector('.lead-checkbox, .row-checkbox');
      const on = !!(cb && cb.checked);
      if (on) checkedCount += 1;
      row.classList.toggle('bulk-selected', on);
      row.setAttribute('aria-selected', on ? 'true' : 'false');
    });

    const allChecked = rows.length > 0 && checkedCount === rows.length;
    const tbody =
      rows[0] && rows[0].closest ? rows[0].closest('tbody') : table ? table.querySelector('tbody') : null;
    if (tbody) {
      tbody.classList.toggle('bulk-select-all-active', allChecked);
    }
    if (table) {
      table.classList.toggle('bulk-select-all-active', allChecked);
    }
  }

  function applySelectAllFromHeader(headerEl, forceChecked) {
    const header = headerEl || getSelectAllHeader();
    if (!header) return;
    const table = header.closest('table') || getActiveLeadsTable();
    if (!table) return;
    const checked = forceChecked != null ? !!forceChecked : !!header.checked;

    if (typeof window.__pipelineBulkSelectApply === 'function') {
      window.__pipelineBulkSelectApply(header, checked);
      syncSelectedKeysFromDom();
      syncSelectAllLeadCheckbox(table);
      if (typeof window.__updateBulkActionBar === 'function') {
        window.__updateBulkActionBar();
      }
      return;
    }

    const boxes = getLeadCheckboxesForTable(table);
    if (!boxes.length) {
      header.checked = false;
      header.indeterminate = false;
      return;
    }
    setPageLeadSelection(checked, table);
  }

  function installApplySelectAllLeads() {
    window.__applySelectAllLeads = applySelectAllFromHeader;
  }
  if (window.__PIPELINE_BULK_SELECT_V2 === '2' && typeof window.__pipelineBulkSelectApply === 'function') {
    const coreApply = window.__pipelineBulkSelectApply;
    window.__applySelectAllLeads = function (headerEl, forceChecked) {
      const header = headerEl || getSelectAllHeader();
      if (!header) return;
      const table = header.closest('table') || getActiveLeadsTable();
      const checked = forceChecked != null ? !!forceChecked : !!header.checked;
      coreApply(header, checked);
      syncSelectedKeysFromDom();
      syncSelectAllLeadCheckbox(table);
      if (typeof window.__updateBulkActionBar === 'function') {
        window.__updateBulkActionBar();
      }
    };
  } else {
    installApplySelectAllLeads();
  }

  function syncSelectAllLeadCheckbox(tableEl) {
    const table = tableEl || getActiveLeadsTable();
    const header = table
      ? table.querySelector('thead input[data-select-all-leads]')
      : getSelectAllHeader();
    const boxes = getLeadCheckboxesForTable(table);
    if (!header) return;
    if (!boxes.length) {
      header.checked = false;
      header.indeterminate = false;
      return;
    }
    const checkedCount = boxes.filter((cb) => cb.checked).length;
    header.checked = checkedCount > 0 && checkedCount === boxes.length;
    header.indeterminate = checkedCount > 0 && checkedCount < boxes.length;
  }
  window.__syncSelectAllLeadCheckbox = syncSelectAllLeadCheckbox;

  function leadKeyFromBulkCheckbox(cb) {
    if (!cb) return '';
    const row = cb.closest('tr.result-row, tr[data-lead-key]');
    const rowKey = row
      ? String(row.getAttribute('data-lead-key') ?? row.dataset.leadKey ?? '').trim()
      : '';
    if (rowKey) return rowKey;
    let key = String(cb.getAttribute('data-key') ?? cb.dataset.key ?? '').trim();
    // Search results use row index as data-key until the lead is saved — not a CRM key.
    if (document.getElementById('searchResultsLeadsTable') && /^\d+$/.test(key)) return '';
    if (key) return key;
    return '';
  }

  function countCheckedLeadBoxes(table) {
    const root = table || document;
    return Array.from(
      root.querySelectorAll('tbody input.lead-checkbox, tbody input.row-checkbox'),
    ).filter((cb) => cb.checked).length;
  }

  /** All checked row boxes in the pipeline/results table (includes rows hidden by paging). */
  function syncSelectedKeysFromDom() {
    selectedKeys.clear();
    const tables = [
      getActiveLeadsTable(),
      document.getElementById('prospectLeadsTable'),
      document.getElementById('searchResultsLeadsTable'),
    ].filter(Boolean);
    const seen = new Set();
    tables.forEach((table) => {
      if (!table || seen.has(table)) return;
      seen.add(table);
      table.querySelectorAll('tbody input.lead-checkbox, tbody input.row-checkbox').forEach((cb) => {
        if (!cb.checked) return;
        const key = leadKeyFromBulkCheckbox(cb);
        if (key !== '') selectedKeys.add(key);
      });
    });
  }

  /** Same selection source as bulk SMS/voicemail — includes paged/hidden checked rows and selectedKeys fallback. */
  function getSelectedLeadCheckboxesForBulkActions() {
    syncSelectedKeysFromDom();
    const seen = new Set();
    const boxes = [];
    const selectors = [
      '#prospectLeadsTable tbody input.lead-checkbox:checked',
      '#prospectLeadsTable tbody input.row-checkbox:checked',
      '#searchResultsLeadsTable tbody input.lead-checkbox:checked',
      '#searchResultsLeadsTable tbody input.row-checkbox:checked',
      'tbody input.lead-checkbox:checked',
      'tbody input.row-checkbox:checked',
    ];
    selectors.forEach((sel) => {
      document.querySelectorAll(sel).forEach((cb) => {
        if (!cb || seen.has(cb)) return;
        seen.add(cb);
        boxes.push(cb);
      });
    });
    if (boxes.length) return boxes;
    selectedKeys.forEach((key) => {
      const k = String(key || '').trim();
      if (!k) return;
      const cb = document.querySelector(
        `input.lead-checkbox[data-key="${CSS.escape(k)}"], input.row-checkbox[data-key="${CSS.escape(k)}"]`,
      );
      if (cb && !seen.has(cb)) {
        seen.add(cb);
        boxes.push(cb);
      }
    });
    return boxes;
  }
  window.__getSelectedLeadCheckboxesForBulkActions = getSelectedLeadCheckboxesForBulkActions;

  /** Canonical selected lead keys for bulk bar actions (tags, folders, SMS, etc.). */
  function getSelectedLeadKeysForBulk() {
    syncSelectedKeysFromDom();
    if (selectedKeys.size > 0) return [...selectedKeys];
    const keys = [];
    const seen = new Set();
    getSelectedLeadCheckboxesForBulkActions().forEach((cb) => {
      const key = leadKeyFromBulkCheckbox(cb);
      if (!key || seen.has(key)) return;
      seen.add(key);
      keys.push(key);
      selectedKeys.add(key);
    });
    return keys;
  }
  window.__getSelectedLeadKeysForBulk = getSelectedLeadKeysForBulk;

  function findLeadRowForBulkKey(key) {
    const k = String(key || '').trim();
    if (!k) return null;
    const variants = [k];
    if (/^lead:/i.test(k)) variants.push(k.replace(/^lead:/i, ''));
    else variants.push(`lead:${k}`);
    for (let i = 0; i < variants.length; i += 1) {
      const v = variants[i];
      const row = document.querySelector(
        `#prospectLeadsTable tr.result-row[data-lead-key="${CSS.escape(v)}"], tr.result-row[data-lead-key="${CSS.escape(v)}"]`,
      );
      if (row) return row;
    }
    return null;
  }

  function setBulkCategoryRowVisible(show) {
    const row = document.getElementById('bulkCategoryRow');
    if (!row) return;
    if (show) {
      row.classList.remove('hidden');
      row.classList.add('flex');
      if (typeof window.__setBulkTagsRowVisible === 'function') window.__setBulkTagsRowVisible(false);
      if (typeof window.__setBulkFolderNewRowVisible === 'function') window.__setBulkFolderNewRowVisible(false);
      const input = document.getElementById('bulkCategoryInput');
      if (input) input.focus();
    } else {
      row.classList.add('hidden');
      row.classList.remove('flex');
    }
  }
  window.__setBulkCategoryRowVisible = setBulkCategoryRowVisible;
  window.__toggleBulkCategoryRow = function toggleBulkCategoryRow() {
    const row = document.getElementById('bulkCategoryRow');
    setBulkCategoryRowVisible(!!(row && row.classList.contains('hidden')));
  };

  async function bulkSetCategoryFromBar() {
    const keys = getSelectedLeadKeysForBulk();
    const input = document.getElementById('bulkCategoryInput');
    const applyBtn = document.getElementById('bulkCategoryApplyBtn');
    const val = input ? String(input.value || '').trim() : '';
    if (!keys.length) {
      showBulkSaveFeedback('Select at least one lead.', 'error');
      return;
    }
    if (!val) {
      showBulkSaveFeedback('Enter a category first.', 'error');
      return;
    }
    if (applyBtn) applyBtn.disabled = true;
    showBulkSaveFeedback(`Updating category on ${keys.length} lead${keys.length === 1 ? '' : 's'}…`, 'loading');
    try {
      const res = await fetch('/leads/bulk-category', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          leadKeys: keys.map(normalizeLeadKeyForApi).filter(Boolean),
          categoryName: val,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error((data && data.error) || `HTTP ${res.status}`);
      }
      const updated = Array.isArray(data.leads) ? data.leads : [];
      updated.forEach((item) => {
        if (!item || !item.key) return;
        const row = findLeadRowForBulkKey(item.key);
        if (!row) return;
        const cat = String(item.categoryName || val || 'N/A').trim() || 'N/A';
        row.dataset.category = cat;
        const catInp = row.querySelector('.lead-category-input');
        if (catInp) catInp.value = cat === 'N/A' ? '' : cat;
      });
      const n = (Array.isArray(data.updatedKeys) ? data.updatedKeys : updated.map((l) => l.key)).length;
      const msg = `Updated category on ${n} lead${n === 1 ? '' : 's'}`;
      showBulkSaveFeedback(msg, 'success');
      if (typeof window.showProspectToast === 'function') window.showProspectToast(msg);
      setBulkCategoryRowVisible(false);
    } catch (err) {
      showBulkSaveFeedback(err.message || 'Bulk category update failed.', 'error');
    } finally {
      if (applyBtn) applyBtn.disabled = false;
    }
  }
  window.__bulkSetCategoryFromBar = bulkSetCategoryFromBar;

  function getSelectedLeadRowsForBulk() {
    const rows = [];
    const seen = new Set();
    const addRow = (row) => {
      if (!row || seen.has(row)) return;
      seen.add(row);
      rows.push(row);
    };
    getSelectedLeadKeysForBulk().forEach((key) => {
      const row = findLeadRowForBulkKey(key);
      if (row) addRow(row);
    });
    if (!rows.length) {
      getSelectedLeadCheckboxesForBulkActions().forEach((cb) => {
        addRow(cb.closest('.result-row') || cb.closest('tr'));
      });
    }
    return rows;
  }
  window.__getSelectedLeadRowsForBulk = getSelectedLeadRowsForBulk;

  function rowHasUsableEmail(row) {
    const e = String((row && row.dataset && row.dataset.email) || '').trim();
    return e.length > 0 && e !== 'N/A' && e.includes('@');
  }
  function rowHasUsablePhone(row) {
    const p = String((row && row.dataset && row.dataset.phone) || '').trim();
    return p.length > 0 && p !== 'N/A' && /\d/.test(p);
  }
  function rowHasMailableAddress(row) {
    const address = String((row && row.dataset && row.dataset.address) || '').trim();
    const city = String((row && row.dataset && row.dataset.city) || '').trim();
    const state = String((row && row.dataset && row.dataset.state) || '').trim();
    if (!address || address === 'N/A' || address.length < 5) return false;
    return !!(city && state);
  }
  function rowMissingWebsite(row) {
    const w = String((row && row.dataset && row.dataset.website) || '').trim();
    return !(w && w !== 'N/A' && w !== '—');
  }
  function collectPhoneLeadKeysFromRows(rows) {
    const keys = [];
    const seen = new Set();
    const addFromRow = (row) => {
      if (!row || !rowHasUsablePhone(row)) return;
      const raw = String((row.dataset && row.dataset.leadKey) || '').trim();
      if (!raw || seen.has(raw)) return;
      seen.add(raw);
      keys.push(raw);
    };
    (Array.isArray(rows) ? rows : []).forEach(addFromRow);
    if (keys.length) return keys;
    getSelectedLeadKeysForBulk().forEach((key) => {
      const row = findLeadRowForBulkKey(key);
      if (row) addFromRow(row);
    });
    return keys;
  }
  function showBulkOpenGhlLink(show) {
    const link = document.getElementById('bulkOpenGhlContactsLink');
    if (!link) return;
    if (show) {
      link.href = getGhlContactsUrl();
      link.classList.remove('hidden');
    } else {
      link.classList.add('hidden');
    }
  }

  const __bulkBarBtnLabels = new WeakMap();
  function flashBulkBarBtn(btn, tempLabel, ms) {
    if (!btn) return;
    const duration = typeof ms === 'number' ? ms : 1600;
    if (!__bulkBarBtnLabels.has(btn)) {
      __bulkBarBtnLabels.set(btn, btn.innerHTML);
    }
    btn.textContent = tempLabel;
    if (btn.__flashTimer) clearTimeout(btn.__flashTimer);
    btn.__flashTimer = setTimeout(() => {
      const orig = __bulkBarBtnLabels.get(btn);
      if (orig != null) btn.innerHTML = orig;
      btn.__flashTimer = null;
    }, duration);
  }
  window.__flashBulkBarBtn = flashBulkBarBtn;
  window.__readPipelineRowDisplayPhone = readPipelineRowDisplayPhone;
  window.__getActiveLeadPanelRow = function () {
    return currentRow && currentRow.dataset ? currentRow : null;
  };

  /** Sync selectedKeys from DOM checkboxes; returns key list for bulk handlers. */
  function ensureBulkSelectionKeys() {
    return getSelectedLeadKeysForBulk();
  }
  window.__ensureBulkSelectionKeys = ensureBulkSelectionKeys;

  function getLeadCheckboxesForTable(table) {
    if (!table) return getPageLeadCheckboxes();
    let boxes = getVisibleResultRowsInTable(table)
      .map((row) =>
        row.querySelector(
          'input[type="checkbox"].lead-checkbox, input[type="checkbox"].row-checkbox, input.lead-checkbox, input.row-checkbox',
        ),
      )
      .filter(Boolean);
    if (boxes.length) return boxes;
    boxes = Array.from(
      table.querySelectorAll(
        'tbody tr.result-row input[type="checkbox"].lead-checkbox, tbody tr.result-row input[type="checkbox"].row-checkbox',
      ),
    );
    if (boxes.length) {
      return boxes.filter((cb) => {
        const tr = cb.closest('tr');
        return tr && !tr.classList.contains('pipeline-row-page-hidden');
      });
    }
    return Array.from(
      table.querySelectorAll('tbody input[type="checkbox"].lead-checkbox, tbody input[type="checkbox"].row-checkbox'),
    ).filter((cb) => {
      const tr = cb.closest('tr');
      return !tr || !tr.classList.contains('pipeline-row-page-hidden');
    });
  }

  /** Direct table listener — same pattern as search-results-table.js (avoids lost document bubbling). */
  function bindLeadsTableBulkSelection(table) {
    if (!table || table.dataset.bulkSelectBound === '1') return;
    if (table.id === 'searchResultsLeadsTable') return;
    const header = table.querySelector('thead input[data-select-all-leads]');
    if (!header || !table.querySelector('tbody')) return;
    table.dataset.bulkSelectBound = '1';

    const headerBoundByPipelineScript =
      window.__PIPELINE_BULK_SELECT_V2 === '2' || header.dataset.plcBulkBound === '1';

    function syncFromHeader() {
      applySelectAllFromHeader(header);
    }

    if (!headerBoundByPipelineScript) {
      header.addEventListener('change', (e) => {
        e.stopPropagation();
        syncFromHeader();
      });

      header.addEventListener('input', (e) => {
        e.stopPropagation();
        syncFromHeader();
      });
    }

    table.addEventListener('change', (e) => {
      const t = e.target;
      if (!t || t.tagName !== 'INPUT') return;
      if (t === header || (t.matches && t.matches('input[data-select-all-leads]'))) {
        return;
      }
      if (
        t.classList &&
        (t.classList.contains('lead-checkbox') || t.classList.contains('row-checkbox'))
      ) {
        e.stopPropagation();
        if (bulkSelectSyncing || window.__bulkSelectRangeSync) return;
        syncSelectAllLeadCheckbox(table);
        const n = countCheckedLeadBoxes(table);
        if (typeof window.__showBulkActionBar === 'function') {
          window.__showBulkActionBar(n);
        }
        if (typeof window.__updateBulkActionBar === 'function') {
          window.__updateBulkActionBar();
        }
      }
    });
  }
  window.__bindLeadsTableBulkSelection = bindLeadsTableBulkSelection;

  function getBulkSelectionCount() {
    const tables = [
      getActiveLeadsTable(),
      document.getElementById('prospectLeadsTable'),
      document.getElementById('searchResultsLeadsTable'),
    ].filter(Boolean);
    const seen = new Set();
    for (const table of tables) {
      if (!table || seen.has(table)) continue;
      seen.add(table);
      const n = countCheckedLeadBoxes(table);
      if (n > 0) return n;
    }
    const global = countCheckedLeadBoxes(document);
    if (global > 0) return global;
    return selectedKeys.size;
  }

  function setPageLeadSelection(checked, tableEl) {
    bulkSelectSyncing = true;
    const table = tableEl || getActiveLeadsTable();
    try {
      const boxes = getLeadCheckboxesForTable(table);
      boxes.forEach((cb) => {
        cb.checked = checked;
        if (checked) cb.setAttribute('checked', 'checked');
        else cb.removeAttribute('checked');
        const key = cb.dataset.key;
        if (checked) {
          if (key) selectedKeys.add(key);
        } else if (key) {
          selectedKeys.delete(key);
        }
      });
    } finally {
      bulkSelectSyncing = false;
    }
    syncSelectAllLeadCheckbox(table);
    updateBulkActionBar();
  }

  let _bulkFoldersFetchPromise = null;
  let _bulkBarWasVisibleForFolderRefresh = false;

  function mergeWorkspaceFoldersFromDom() {
    if (!Array.isArray(window.WORKSPACE_FOLDERS)) window.WORKSPACE_FOLDERS = [];
    const byKey = new Map(
      window.WORKSPACE_FOLDERS.filter((f) => f && f.key).map((f) => [
        String(f.key),
        { key: String(f.key), name: String(f.name || '').trim() || 'Folder' },
      ]),
    );
    document
      .querySelectorAll('select[name="folderKey"] option, #bulkFolderSelect option')
      .forEach((opt) => {
      const key = String(opt.value || '').trim();
      if (!key) return;
      if (!byKey.has(key)) {
        byKey.set(key, { key, name: String(opt.textContent || '').trim() || 'Folder' });
      }
    });
    window.WORKSPACE_FOLDERS = Array.from(byKey.values());
  }

  function fetchWorkspaceFoldersFromServer() {
    if (_bulkFoldersFetchPromise) return _bulkFoldersFetchPromise;
    _bulkFoldersFetchPromise = fetch('/folders', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
      .then((res) => res.json().catch(() => ({})))
      .then((data) => {
        if (data && data.success && Array.isArray(data.folders)) {
          window.WORKSPACE_FOLDERS = data.folders
            .filter((f) => f && f.key)
            .map((f) => ({
              key: String(f.key),
              name: String(f.name || '').trim() || 'Folder',
              jobType: f.jobType || '',
              parentFolderKey: f.parentFolderKey || '',
            }));
        } else if (!Array.isArray(window.WORKSPACE_FOLDERS)) {
          window.WORKSPACE_FOLDERS = [];
        }
        return window.WORKSPACE_FOLDERS;
      })
      .catch(() => {
        if (!Array.isArray(window.WORKSPACE_FOLDERS)) window.WORKSPACE_FOLDERS = [];
        return window.WORKSPACE_FOLDERS;
      })
      .finally(() => {
        _bulkFoldersFetchPromise = null;
      });
    return _bulkFoldersFetchPromise;
  }

  function rebuildBulkFolderSelect(preferredValue) {
    const selectEl = document.getElementById('bulkFolderSelect') || bulkFolderSelect;
    if (!selectEl) return;
    if (!Array.isArray(window.WORKSPACE_FOLDERS)) window.WORKSPACE_FOLDERS = [];
    const folders = [...window.WORKSPACE_FOLDERS].sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }),
    );
    const prev =
      preferredValue !== undefined && preferredValue !== null
        ? String(preferredValue)
        : selectEl.value;
    selectEl.innerHTML = '';
    const emptyOpt = document.createElement('option');
    emptyOpt.value = '';
    emptyOpt.textContent = 'No folder';
    selectEl.appendChild(emptyOpt);
    folders.forEach((f) => {
      if (!f || !f.key) return;
      const opt = document.createElement('option');
      opt.value = f.key;
      opt.textContent = f.name || 'Folder';
      selectEl.appendChild(opt);
    });
    const valid = prev && Array.from(selectEl.options).some((o) => o.value === prev);
    selectEl.value = valid ? prev : '';
  }

  async function refreshBulkFolderSelectOptions(preferredValue) {
    mergeWorkspaceFoldersFromDom();
    await fetchWorkspaceFoldersFromServer();
    rebuildBulkFolderSelect(preferredValue);
  }
  window.__rebuildBulkFolderSelect = rebuildBulkFolderSelect;
  window.__refreshBulkFolderSelectOptions = refreshBulkFolderSelectOptions;

  const updateBulkActionBar = () => {
    syncSelectedKeysFromDom();
    syncBulkRowHighlights();
    const count = getBulkSelectionCount();
    if (count === 0) showBulkOpenGhlLink(false);
    const hasSelection = count > 0;

    const bar = mountBulkActionBarToBody();

    const countEl = selectedCountCircle || document.getElementById('selectedCountCircle');
    if (countEl) countEl.textContent = count;

    if (typeof window.__showBulkActionBar === 'function') {
      window.__showBulkActionBar(count);
    } else if (bar) {
      const visible = count > 0;
      bar.dataset.visible = visible ? 'true' : 'false';
      bar.classList.toggle('bulk-action-bar--visible', visible);
      bar.setAttribute('aria-hidden', visible ? 'false' : 'true');
      if (visible) {
        bar.classList.remove('opacity-0', 'translate-y-16', 'pointer-events-none');
        bar.classList.add('opacity-100', 'translate-y-0');
        bar.style.pointerEvents = 'auto';
      } else {
        bar.classList.add('opacity-0', 'translate-y-16', 'pointer-events-none');
        bar.classList.remove('opacity-100', 'translate-y-0');
        bar.style.pointerEvents = 'none';
      }
    }

    if (bulkMoveFolderBtn) {
      bulkMoveFolderBtn.disabled = count === 0;
    }
    if (bulkAddToBoardBtn) {
      bulkAddToBoardBtn.disabled = count === 0;
    }
    const saveBtn = bulkSaveBtn || document.getElementById('bulkSaveBtn');
    if (saveBtn && saveBtn.getAttribute('aria-busy') !== 'true') {
      saveBtn.disabled = count === 0;
    }
    if (count > 0 && bar) {
      bar.querySelectorAll('button').forEach((btn) => {
        if (btn.id === 'cancelSelectionBtn') return;
        if (btn.getAttribute('aria-busy') === 'true') return;
        btn.disabled = false;
        btn.classList.remove('opacity-40', 'pointer-events-none', 'cursor-not-allowed');
      });
    }
    const focusBtn = bulkFocusModeBtn || document.getElementById('bulkFocusModeBtn');
    const directMailBtn = bulkDirectMailBtn || document.getElementById('bulkDirectMailBtn');
    const pushGhlBtn = bulkPushGhlBtn || document.getElementById('bulkPushGhlBtn');
    const createSubaccountBtn =
      bulkCreateSubaccountBtn || document.getElementById('bulkCreateSubaccountBtn');
    if (focusBtn || directMailBtn || pushGhlBtn || createSubaccountBtn) {
      const keys =
        hasSelection && typeof window.__collectFocusSelectionKeys === 'function'
          ? window.__collectFocusSelectionKeys()
          : hasSelection
            ? getSelectedLeadKeysForBulk()
                .map((k) => String(k || '').trim().replace(/^lead:/i, ''))
                .filter(Boolean)
            : [];
      const selectedRows = hasSelection ? getSelectedLeadRowsForBulk() : [];
      const anyPhone = selectedRows.some(rowHasUsablePhone);
      if (typeof window.__persistFocusSelectionKeys === 'function') {
        window.__persistFocusSelectionKeys(keys);
      }
      const syncPrimaryBtn = (btn, href, enabled, titleEnabled, titleDisabled) => {
        if (!btn) return;
        btn.classList.toggle('hidden', !enabled);
        if (btn.tagName === 'A') {
          btn.classList.toggle('opacity-40', !enabled);
          btn.classList.toggle('pointer-events-none', !enabled);
          btn.setAttribute('aria-disabled', !enabled ? 'true' : 'false');
          if (href) btn.setAttribute('href', href);
        } else {
          btn.disabled = !enabled;
          btn.setAttribute('aria-disabled', !enabled ? 'true' : 'false');
          btn.classList.toggle('opacity-40', !enabled);
          btn.classList.toggle('cursor-not-allowed', !enabled);
          btn.classList.toggle('pointer-events-none', !enabled);
          if (enabled) btn.style.removeProperty('pointer-events');
        }
        btn.setAttribute('title', enabled ? titleEnabled : titleDisabled);
      };
      syncPrimaryBtn(
        focusBtn,
        typeof window.__buildFocusSelectionUrl === 'function'
          ? window.__buildFocusSelectionUrl(keys, 'call')
          : keys.length
            ? `/focus?lead=${encodeURIComponent(keys[0])}&keys=${encodeURIComponent(keys.join(','))}&channel=call`
            : '/focus?channel=call',
        hasSelection && anyPhone,
        keys.length
          ? `Call and log ${keys.length} selected lead${keys.length === 1 ? '' : 's'}`
          : 'Select leads with phone numbers to call',
        'Selected leads have no phone number',
      );
      const outreachCount = keys.length > 0 ? keys.length : count;
      syncPrimaryBtn(
        directMailBtn,
        null,
        hasSelection,
        outreachCount
          ? `Add ${outreachCount} selected lead${outreachCount === 1 ? '' : 's'} to the Direct Mail folder (address can be enriched later)`
          : 'Select leads to add to the Direct Mail folder',
        'Select at least one lead',
      );
      syncPrimaryBtn(
        pushGhlBtn,
        null,
        hasSelection,
        outreachCount
          ? `Sync ${outreachCount} selected lead${outreachCount === 1 ? '' : 's'} to Go High Level`
          : 'Select leads to sync to GHL',
        'Select at least one lead',
      );
      if (createSubaccountBtn) {
        createSubaccountBtn.classList.remove('hidden', 'opacity-40', 'pointer-events-none', 'cursor-not-allowed');
        createSubaccountBtn.disabled = !hasSelection;
        createSubaccountBtn.setAttribute('aria-disabled', hasSelection ? 'false' : 'true');
        if (hasSelection) createSubaccountBtn.style.removeProperty('pointer-events');
        createSubaccountBtn.setAttribute(
          'title',
          outreachCount
            ? `Create a GHL sub-account for ${outreachCount} selected business${outreachCount === 1 ? '' : 'es'}`
            : 'Select businesses to create GHL sub-accounts',
        );
      }
    }

    document.querySelectorAll('.js-bulk-enhance').forEach((btn) => {
      btn.classList.toggle('ring-2', hasSelection);
      btn.classList.toggle('ring-brand-yellow/60', hasSelection);
      btn.classList.toggle('shadow-md', hasSelection);
      btn.classList.toggle('bg-brand-yellow/20', hasSelection);
      btn.classList.toggle('border-brand-yellow/60', hasSelection);
      btn.setAttribute(
        'title',
        hasSelection ? `Enrich ${count} selected lead${count === 1 ? '' : 's'} (Firecrawl)` : 'Enrich selected leads (Firecrawl)',
      );
    });
    const mergeBtn = document.getElementById('bulkMergeBtn');
    if (mergeBtn) {
      const canMerge = count >= 2;
      mergeBtn.disabled = !canMerge;
      mergeBtn.classList.toggle('ring-2', canMerge);
      mergeBtn.classList.toggle('ring-violet-400/60', canMerge);
      mergeBtn.classList.toggle('bg-violet-500/15', canMerge);
      mergeBtn.setAttribute(
        'title',
        canMerge
          ? `Merge ${count} selected leads into one record (first selected = primary)`
          : 'Select at least two leads to merge',
      );
    }
    if (typeof window.__syncBulkBookmarkBtnState === 'function') {
      window.__syncBulkBookmarkBtnState();
    } else {
      const bulkBookmarkBtn = document.getElementById('bulkBookmarkBtn');
      if (bulkBookmarkBtn) bulkBookmarkBtn.disabled = !hasSelection;
    }
    document.querySelectorAll('.js-bulk-ai-analysis').forEach((btn) => {
      btn.classList.toggle('ring-2', hasSelection);
      btn.classList.toggle('ring-sky-400/60', hasSelection);
      btn.classList.toggle('shadow-md', hasSelection);
      btn.classList.toggle('bg-sky-500/20', hasSelection);
      btn.classList.toggle('border-sky-400/65', hasSelection);
      btn.setAttribute(
        'title',
        hasSelection
          ? `Run AI analysis for ${count} selected lead${count === 1 ? '' : 's'}`
          : 'Run AI website analysis for selected leads',
      );
    });
    document.querySelectorAll('.js-bulk-push-ghl').forEach((btn) => {
      btn.disabled = !hasSelection;
      btn.classList.toggle('ring-2', hasSelection);
      btn.classList.toggle('ring-orange-400/60', hasSelection);
      btn.setAttribute(
        'title',
        hasSelection
          ? `Sync ${count} selected lead${count === 1 ? '' : 's'} to Go High Level`
          : 'Select leads to sync to Go High Level',
      );
    });

    // Update header bar (specific to results.ejs)
    const headerBulkActions = document.getElementById('headerBulkActions');
    const headerSelectedCount = document.getElementById('headerSelectedCount');
    if (headerBulkActions) {
      if (count > 0) {
        headerBulkActions.classList.remove('hidden');
        headerBulkActions.classList.add('flex');
        if (headerSelectedCount) headerSelectedCount.textContent = count;
      } else {
        headerBulkActions.classList.add('hidden');
        headerBulkActions.classList.remove('flex');
      }
    }

    if (hasSelection && !_bulkBarWasVisibleForFolderRefresh) {
      refreshBulkFolderSelectOptions(bulkFolderSelect ? bulkFolderSelect.value : undefined).catch(
        () => {},
      );
    }
    _bulkBarWasVisibleForFolderRefresh = hasSelection;
  };
  window.__updateBulkActionBar = updateBulkActionBar;
  window.__syncBulkSelectionFromDom = function syncBulkSelectionFromDom() {
    syncSelectedKeysFromDom();
    syncBulkRowHighlights();
    syncSelectAllLeadCheckbox();
    updateBulkActionBar();
  };

  const initialBulkFolderPref =
    typeof window.PROSPECTING_ACTIVE_FOLDER_KEY === 'string' && window.PROSPECTING_ACTIVE_FOLDER_KEY.trim()
      ? window.PROSPECTING_ACTIVE_FOLDER_KEY.trim()
      : typeof window.SEARCH_TARGET_FOLDER_KEY === 'string' && window.SEARCH_TARGET_FOLDER_KEY.trim()
        ? window.SEARCH_TARGET_FOLDER_KEY.trim()
        : undefined;
  refreshBulkFolderSelectOptions(initialBulkFolderPref).catch(() => {
    rebuildBulkFolderSelect(initialBulkFolderPref);
  });
  if (bulkFolderSelect) {
    bulkFolderSelect.addEventListener('focus', () => {
      refreshBulkFolderSelectOptions(bulkFolderSelect.value).catch(() => {});
    });
  }
  updateBulkActionBar();

  document.querySelectorAll('table').forEach((table) => {
    if (table.querySelector('thead input[data-select-all-leads]')) {
      bindLeadsTableBulkSelection(table);
    }
  });

  function setBulkFolderNewRowVisible(show) {
    const row = document.getElementById('bulkFolderNewRow');
    const nameInput = document.getElementById('bulkFolderNewName');
    const toggle = document.getElementById('bulkFolderNewToggle');
    if (!row) return;
    if (show) {
      row.classList.remove('hidden');
      row.classList.add('flex');
      if (toggle) toggle.setAttribute('aria-expanded', 'true');
      const tagsRow = document.getElementById('bulkTagsRow');
      if (tagsRow) {
        tagsRow.classList.add('hidden');
        tagsRow.classList.remove('flex');
      }
      if (nameInput) requestAnimationFrame(() => nameInput.focus());
    } else {
      row.classList.add('hidden');
      row.classList.remove('flex');
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
      if (nameInput) nameInput.value = '';
    }
  }
  window.__setBulkFolderNewRowVisible = setBulkFolderNewRowVisible;

  const isSearchResultsBulkPage = !!document.getElementById('searchResultsLeadsTable');

  function buildBulkFolderCreatePayload(name) {
    const payload = { name: String(name || '').trim() };
    const activeKey = String(
      window.PROSPECTING_ACTIVE_FOLDER_KEY || window.SEARCH_TARGET_FOLDER_KEY || '',
    ).trim();
    if (!activeKey) return payload;
    payload.parentFolderKey = activeKey;
    const folders = Array.isArray(window.WORKSPACE_FOLDERS) ? window.WORKSPACE_FOLDERS : [];
    const activeFolder = folders.find((f) => f && String(f.key) === activeKey);
    if (activeFolder && activeFolder.jobType) {
      payload.jobType = String(activeFolder.jobType);
    } else if (typeof window.SEARCH_JOB_TYPE === 'string' && window.SEARCH_JOB_TYPE.trim()) {
      payload.jobType = window.SEARCH_JOB_TYPE.trim();
    } else if (window.PROSPECTING_BUSINESSES_VIEW) {
      payload.jobType = 'maps_business';
    }
    return payload;
  }

  async function bulkFolderSaveFromBar() {
    const nameInput = document.getElementById('bulkFolderNewName');
    const saveBtn = document.getElementById('bulkFolderNewSave');
    const name = nameInput ? String(nameInput.value || '').trim() : '';
    if (!name) {
      window.alert('Enter a folder name.');
      return;
    }
    if (saveBtn) saveBtn.disabled = true;
    try {
      const res = await fetch('/folders', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(buildBulkFolderCreatePayload(name)),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success || !data.folder || !data.folder.key) {
        throw new Error((data && data.error) || `HTTP ${res.status}`);
      }
      const { key, name: folderName, jobType, parentFolderKey, isPipelineDefault, isTradeFolder } = data.folder;
      if (!Array.isArray(window.WORKSPACE_FOLDERS)) window.WORKSPACE_FOLDERS = [];
      const existing = window.WORKSPACE_FOLDERS.find((f) => f && f.key === key);
      const nextFolder = {
        key,
        name: folderName || name,
        jobType: jobType || '',
        parentFolderKey: parentFolderKey || '',
        isPipelineDefault: !!isPipelineDefault,
        isTradeFolder: !!isTradeFolder,
      };
      if (existing) Object.assign(existing, nextFolder);
      else window.WORKSPACE_FOLDERS.push(nextFolder);
      rebuildBulkFolderSelect(key);
      setBulkFolderNewRowVisible(false);
      if (typeof window.showProspectToast === 'function') {
        window.showProspectToast('Folder created');
      }
    } catch (err) {
      console.error('Create folder from bulk bar failed:', err);
      window.alert(err.message || 'Could not create folder.');
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  }
  window.__bulkFolderSaveFromBar = bulkFolderSaveFromBar;

  function initBulkBarFolderActions() {
    const bar = mountBulkActionBarToBody();
    if (!bar || isSearchResultsBulkPage || bar.dataset.pipelineFolderActionsBound === '1') return;
    bar.dataset.pipelineFolderActionsBound = '1';

    bar.addEventListener('click', async (e) => {
      if (e.target.closest('#bulkFolderNewToggle')) {
        e.preventDefault();
        e.stopPropagation();
        const row = document.getElementById('bulkFolderNewRow');
        const show = !!(row && row.classList.contains('hidden'));
        setBulkFolderNewRowVisible(show);
        return;
      }
      if (e.target.closest('#bulkFolderNewCancel')) {
        e.preventDefault();
        e.stopPropagation();
        setBulkFolderNewRowVisible(false);
        return;
      }
      if (e.target.closest('#bulkFolderNewSave')) {
        e.preventDefault();
        e.stopPropagation();
        await bulkFolderSaveFromBar();
      }
    });

    bar.addEventListener('keydown', (e) => {
      if (e.target.id !== 'bulkFolderNewName') return;
      if (e.key === 'Escape') {
        e.preventDefault();
        setBulkFolderNewRowVisible(false);
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const save = document.getElementById('bulkFolderNewSave');
        if (save && !save.disabled) save.click();
      }
    });
  }
  initBulkBarFolderActions();

  document.addEventListener(
    'pointerdown',
    (e) => {
      const bar = document.getElementById('bulkActionBar');
      if (!bar || bar.dataset.visible !== 'true') return;
      if (!e.target || !e.target.closest || !e.target.closest('#bulkActionBar')) return;
      if (
        e.target.closest('#bulkFolderNewRow') ||
        e.target.closest('#bulkTagsRow') ||
        e.target.closest('button, a, select, input, textarea, label')
      ) {
        return;
      }
      ensureBulkSelectionKeys();
      updateBulkActionBar();
    },
    true,
  );

  document.addEventListener(
    'click',
    (e) => {
      const t = e.target;
      if (!t || !t.matches) return;
      if (t.matches('input[data-select-all-leads]')) return;
      if (t.matches('.lead-checkbox') || t.matches('.row-checkbox')) {
        e.stopPropagation();
      }
    },
    true,
  );

  document.addEventListener('change', (e) => {
    const target = e.target;
    if (target && target.matches && target.matches('input[data-select-all-leads]')) {
      applySelectAllFromHeader(target);
      return;
    }
    if (!target.classList || (!target.classList.contains('lead-checkbox') && !target.classList.contains('row-checkbox'))) return;
    if (bulkSelectSyncing || window.__bulkSelectRangeSync) return;
    syncSelectAllLeadCheckbox();
    updateBulkActionBar();
  });

  document.addEventListener('input', (e) => {
    const target = e.target;
    if (!target || !target.classList || (!target.classList.contains('lead-checkbox') && !target.classList.contains('row-checkbox'))) return;
    if (bulkSelectSyncing || window.__bulkSelectRangeSync) return;
    syncSelectAllLeadCheckbox();
    updateBulkActionBar();
  });

  document.addEventListener(
    'click',
    (e) => {
      const cb = e.target && e.target.closest ? e.target.closest('.lead-checkbox') : null;
      if (!cb || bulkSelectSyncing || window.__bulkSelectRangeSync) return;
      requestAnimationFrame(() => {
        syncSelectAllLeadCheckbox();
        updateBulkActionBar();
      });
    },
    true,
  );

  if (cancelSelectionBtn) {
    cancelSelectionBtn.addEventListener('click', () => {
      selectedKeys.clear();
      if (typeof window.__resetBulkSelectAnchor === 'function') {
        window.__resetBulkSelectAnchor();
      }
      setPageLeadSelection(false);
    });
  }

  const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
  if (bulkDeleteBtn) {
    bulkDeleteBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      if (typeof window.__bulkDeleteSelectedLeads === 'function') {
        await window.__bulkDeleteSelectedLeads();
        return;
      }
      const keys = ensureBulkSelectionKeys();
      if (keys.length === 0) return;
      const n = keys.length;
      const msg = `Delete ${n} selected lead${n === 1 ? '' : 's'}? This cannot be undone.`;
      if (!window.confirm(msg)) return;

      const closePanel = document.getElementById('closeMobilePanel');
      for (const leadKey of keys) {
        try {
          const res = await fetch(`/leads/${encodeURIComponent(leadKey)}/delete`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data.success) continue;

          const row = findLeadRowForBulkKey(leadKey);
          if (row) {
            const title = row.dataset.title ? row.dataset.title.trim() : '';
            if (row.classList.contains('selected') && closePanel) closePanel.click();
            row.remove();
            if (title) savedLeads.delete(normalizeLeadTitleKey(title));
          }
          selectedKeys.delete(leadKey);
        } catch (err) {
          console.error('Bulk delete failed for', leadKey, err);
        }
      }

      const selectAllHeader = getSelectAllHeader();
      if (selectAllHeader) selectAllHeader.checked = false;
      updateBulkActionBar();
      if (typeof window.__pipelineTablePagingApply === 'function') {
        window.__pipelineTablePagingApply();
      }

      const remaining = document.querySelectorAll('.result-row').length;
      if (remaining === 0) {
        window.location.reload();
      }
    });
  }

  const pushLeadKeysToGhlWithProgress =
    typeof window.__pushLeadKeysToGhlWithProgress === 'function'
      ? window.__pushLeadKeysToGhlWithProgress
      : async function pushLeadKeysToGhlWithProgressFallback(opts) {
          throw new Error('GHL sync handler failed to load. Hard-refresh and try again.');
        };
  window.__pushLeadKeysToGhlWithProgress = pushLeadKeysToGhlWithProgress;

  async function openBulkPushGhlFromBar() {
    if (window.__bulkPushGhlInFlight) return { ok: false, error: 'in_flight' };
    const btn = bulkPushGhlBtn || document.getElementById('bulkPushGhlBtn');
    const keys = ensureBulkSelectionKeys();
    if (keys.length === 0) {
      showBulkSaveFeedback('Select at least one lead.', 'error');
      return { ok: false, error: 'no_selection' };
    }
    const selectedRows = getSelectedLeadRowsForBulk();
    const noWebsiteCount = selectedRows.filter((row) => rowMissingWebsite(row)).length;
    const labelDefault = 'Sync GHL';
    const prev = btn ? String(btn.textContent || '').trim() || labelDefault : labelDefault;
    window.__bulkPushGhlInFlight = true;
    if (btn) {
      __bulkBarBtnLabels.set(btn, prev);
      btn.disabled = true;
      btn.textContent = `${keys.length} left`;
      btn.setAttribute('aria-busy', 'true');
      btn.classList.add('is-busy');
    }

    const setProgressMessage = (progress) => {
      const el = document.getElementById('bulkSaveFeedback');
      const done = progress && progress.current != null ? progress.current : 0;
      const total = progress && progress.total != null ? progress.total : 0;
      const remaining =
        progress && progress.remaining != null ? progress.remaining : Math.max(0, total - done);
      const msg = `Syncing ${done} of ${total} · ${remaining} left`;
      if (el) {
        el.textContent = msg;
        el.classList.remove('hidden', 'text-emerald-300', 'text-rose-300', 'text-sky-200');
        el.classList.add('text-white/80');
      }
    };

    setProgressMessage({ current: 0, total: keys.length, remaining: keys.length });

    try {
      const result = await pushLeadKeysToGhlWithProgress({
        leadKeys: keys,
        tagNoWebsite: true,
        btn,
        onProgress: setProgressMessage,
      });
      const taggedNote = noWebsiteCount > 0 ? ` · ${noWebsiteCount} tagged no website` : '';
      const msg = `GHL sync complete · ${result.pushed} contact${result.pushed === 1 ? '' : 's'}${taggedNote}${result.failed ? ` · ${result.failed} failed` : ''}`;
      showBulkSaveFeedback(msg, result.failed === 0 ? 'success' : 'error');
      showBulkOpenGhlLink(result.pushed > 0);
      flashBulkBarBtn(btn, result.failed === 0 ? '✓ Synced' : 'Failed');
      return { ok: result.failed === 0, pushed: result.pushed, failed: result.failed };
    } catch (err) {
      const msg = err && err.message ? err.message : 'GHL sync failed';
      showBulkSaveFeedback(msg, 'error');
      flashBulkBarBtn(btn, 'Failed', 1200);
      return { ok: false, error: msg };
    } finally {
      window.__bulkPushGhlInFlight = false;
      if (btn) {
        btn.disabled = false;
        btn.removeAttribute('aria-busy');
        btn.classList.remove('is-busy');
      }
      updateBulkActionBar();
    }
  }
  window.__openBulkPushGhlFromBar = openBulkPushGhlFromBar;

  if (bulkPushGhlBtn) {
    bulkPushGhlBtn.addEventListener('click', async (e) => {
      if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      if (typeof window.__runBulkPushGhlFromBarEarly === 'function') {
        await window.__runBulkPushGhlFromBarEarly();
        return;
      }
      await openBulkPushGhlFromBar();
    });
  }

  if (bulkCreateSubaccountBtn) {
    bulkCreateSubaccountBtn.addEventListener('click', async (e) => {
      if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      if (typeof window.__runBulkCreateSubaccountFromBarEarly === 'function') {
        await window.__runBulkCreateSubaccountFromBarEarly();
      }
    });
  }

  if (bulkMoveFolderBtn && bulkFolderSelect && !isSearchResultsPage) {
    bulkMoveFolderBtn.addEventListener('click', () => bulkMoveFolderFromBar());
  }

  function applyPipelineStageToRow(row, stageId, pipelineStage) {
    if (!row || !stageId) return;
    const sid = String(stageId).trim();
    row.dataset.stageId = sid;
    if (pipelineStage != null) row.dataset.pipelineStage = String(pipelineStage);
    const labels = window.PIPELINE_STAGE_LABELS || {};
    const fullName = labels[sid] || '';
    const short =
      (fullName.split('(')[0].trim().slice(0, 22)) + (fullName.length > 22 ? '…' : '');
    row.dataset.pipelineLabel = short;
    const pipeSel = row.querySelector('.pipeline-inline-select');
    if (pipeSel) pipeSel.value = sid;
    const cell = row.querySelector('.pipeline-stage-label');
    if (cell) cell.textContent = short || 'Stage';
    const wrap = row.querySelector('.pipeline-stage-pill-wrap');
    if (wrap) {
      const dot =
        (window.PIPELINE_STAGE_COLORS && window.PIPELINE_STAGE_COLORS[sid]) || '#94a3b8';
      wrap.style.boxShadow = `inset 3px 0 0 ${dot}`;
    }
  }

  async function bulkAddToBoardFromBar() {
    const keys = getSelectedLeadKeysForBulk();
    if (!keys.length) {
      showBulkSaveFeedback('Select at least one lead.', 'error');
      return;
    }
    const stageEl = document.getElementById('bulkPipelineStageSelect') || bulkPipelineStageSelect;
    const stageId = stageEl && stageEl.value ? String(stageEl.value).trim() : '';
    if (!stageId) {
      showBulkSaveFeedback('Choose a pipeline stage first.', 'error');
      return;
    }
    const stageName =
      (window.PIPELINE_STAGE_LABELS && window.PIPELINE_STAGE_LABELS[stageId]) || 'pipeline board';
    const folderEl = document.getElementById('bulkFolderSelect') || bulkFolderSelect;
    const folderKey = folderEl && folderEl.value ? String(folderEl.value).trim() : '';
    const viewingFolder =
      typeof window.PROSPECTING_ACTIVE_FOLDER_KEY === 'string'
        ? window.PROSPECTING_ACTIVE_FOLDER_KEY.trim()
        : '';
    const btn = document.getElementById('bulkAddToBoardBtn') || bulkAddToBoardBtn;
    const n = keys.length;
    if (btn) {
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
    }
    if (typeof window.__flashBulkBarBtn === 'function' && btn) {
      window.__flashBulkBarBtn(btn, 'Saving…', 12000);
    }
    showBulkSaveFeedback(
      `Adding ${n} lead${n === 1 ? '' : 's'} to ${stageName}…`,
      'loading',
    );
    try {
      const res = await fetch('/leads/bulk-stage-assign', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          leadKeys: keys.map(normalizeLeadKeyForApi).filter(Boolean),
          stageId,
          ...(folderKey ? { folderKey } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error((data && data.error) || `HTTP ${res.status}`);
      }
      const updated = Array.isArray(data.leads) ? data.leads : [];
      const updatedKeys = Array.isArray(data.updatedKeys) ? data.updatedKeys : [];
      if (!updatedKeys.length) {
        throw new Error('No leads were updated. Refresh the page and try again.');
      }

      updated.forEach((item) => {
        if (!item || !item.key) return;
        const row = findLeadRowForBulkKey(item.key);
        if (!row) return;
        applyPipelineStageToRow(row, item.stageId || stageId, item.pipelineStage);
        if (typeof window.__markRowOnPipelineBoard === 'function') {
          window.__markRowOnPipelineBoard(row);
        } else {
          row.dataset.onPipelineBoard = '1';
        }
        if (folderKey && viewingFolder && folderKey !== viewingFolder) {
          row.remove();
        }
      });

      window.__pipelineKanbanFocusKeys = null;

      const msg = `Saved ${updatedKeys.length} lead${updatedKeys.length === 1 ? '' : 's'} to ${stageName}`;
      showBulkSaveFeedback(msg, 'success');
      if (typeof window.showProspectToast === 'function') window.showProspectToast(msg);
      if (typeof window.__flashBulkBarBtn === 'function' && btn) {
        window.__flashBulkBarBtn(btn, 'Saved ✓', 2200);
      }

      if (folderKey && folderKey !== viewingFolder) {
        try {
          sessionStorage.setItem('adhello_kanban_focus_keys', JSON.stringify(updatedKeys));
        } catch (_) {
          /* ignore */
        }
        window.location.href = `/prospecting?tab=pipeline&folderKey=${encodeURIComponent(folderKey)}&view=kanban&boardFocus=1`;
        return;
      }

      if (typeof window.__adhelloSetPipelineView === 'function') {
        window.__adhelloSetPipelineView('kanban');
      }
      if (typeof window.__adhelloInitKanban === 'function') {
        window.__adhelloInitKanban();
      }
      if (typeof window.refreshPipelineKanbanIfNeeded === 'function') {
        window.refreshPipelineKanbanIfNeeded();
      }
      requestAnimationFrame(() => {
        if (typeof window.__adhelloInitKanban === 'function') window.__adhelloInitKanban();
      });
      const kanbanEl = document.getElementById('kanbanView');
      if (kanbanEl && typeof kanbanEl.scrollIntoView === 'function') {
        kanbanEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }

      selectedKeys.clear();
      document.querySelectorAll('.lead-checkbox, .row-checkbox').forEach((cb) => {
        cb.checked = false;
      });
      const selectAllHeader = getSelectAllHeader();
      if (selectAllHeader) selectAllHeader.checked = false;
      updateBulkActionBar();
    } catch (e) {
      console.error('Bulk add to pipeline board failed:', e);
      const errMsg =
        e && e.message ? e.message : 'Could not add selected leads to the pipeline board.';
      showBulkSaveFeedback(errMsg, 'error');
      if (typeof window.__flashBulkBarBtn === 'function' && btn) {
        window.__flashBulkBarBtn(btn, 'Failed', 1600);
      }
    } finally {
      if (btn) {
        btn.removeAttribute('aria-busy');
        btn.disabled = getBulkSelectionCount() === 0;
      }
    }
  }
  window.__bulkAddToBoardFromBar = bulkAddToBoardFromBar;

  if (bulkAddToBoardBtn) {
    bulkAddToBoardBtn.addEventListener('click', () => bulkAddToBoardFromBar());
  }

  async function bulkMoveFolderFromBar() {
    if (
      document.getElementById('searchResultsLeadsTable') &&
      typeof window.__bulkMoveSearchResultsToFolder === 'function'
    ) {
      return window.__bulkMoveSearchResultsToFolder();
    }

    const keys = getSelectedLeadKeysForBulk();
    if (!keys.length) {
      window.alert('Select at least one lead.');
      return;
    }
    const folderEl = document.getElementById('bulkFolderSelect') || bulkFolderSelect;
    const folderKey = folderEl && folderEl.value ? String(folderEl.value).trim() : '';
    if (!folderKey) {
      window.alert('Select a folder from the dropdown first.');
      return;
    }
    const folderName =
      Array.isArray(window.WORKSPACE_FOLDERS)
        ? (window.WORKSPACE_FOLDERS.find((f) => f && f.key === folderKey) || {}).name
        : '';
    const btn = document.getElementById('bulkMoveFolderBtn') || bulkMoveFolderBtn;
    if (btn) btn.disabled = true;
    try {
      const res = await fetch('/folders/assign-bulk', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          leadKeys: keys.map(normalizeLeadKeyForApi).filter(Boolean),
          folderKey,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error((data && data.error) || `HTTP ${res.status}`);
      }
      const updatedKeys = Array.isArray(data.updatedKeys) ? data.updatedKeys : [];
      if (!updatedKeys.length) {
        throw new Error('No leads were moved. Refresh the page and try again.');
      }

      const viewingFolder =
        typeof window.PROSPECTING_ACTIVE_FOLDER_KEY === 'string'
          ? window.PROSPECTING_ACTIVE_FOLDER_KEY.trim()
          : '';
      const targetFolder = folderKey || '';
      updatedKeys.forEach((leadKey) => {
        const row = findLeadRowForBulkKey(leadKey);
        if (!row) return;
        let remove = false;
        if (!viewingFolder) {
          if (targetFolder) remove = true;
        } else if (targetFolder !== viewingFolder) {
          remove = true;
        }
        if (remove) row.remove();
      });
      selectedKeys.clear();
      document.querySelectorAll('.lead-checkbox, .row-checkbox').forEach((cb) => {
        cb.checked = false;
      });
      const selectAllHeader = getSelectAllHeader();
      if (selectAllHeader) selectAllHeader.checked = false;
      const msg = `Moved ${updatedKeys.length} lead${updatedKeys.length === 1 ? '' : 's'}${folderName ? ` to ${folderName}` : ''}`;
      showBulkSaveFeedback(msg, 'ok');
      if (typeof window.showProspectToast === 'function') window.showProspectToast(msg);
      updateBulkActionBar();
    } catch (e) {
      console.error('Bulk move to folder failed:', e);
      window.alert(e && e.message ? e.message : 'Could not move selected leads to that folder. Please try again.');
    } finally {
      if (btn) btn.disabled = getBulkSelectionCount() === 0;
    }
  }
  window.__bulkMoveFolderFromBar = bulkMoveFolderFromBar;

  const BULK_SAVE_LOADING_HTML =
    '<span class="inline-flex items-center justify-center gap-2">' +
    '<svg class="w-4 h-4 animate-spin shrink-0" fill="none" viewBox="0 0 24 24" aria-hidden="true">' +
    '<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>' +
    '<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>' +
    '</svg><span>Saving…</span></span>';
  const BULK_SAVE_DONE_HTML =
    '<span class="inline-flex items-center justify-center gap-2">' +
    '<svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" aria-hidden="true">' +
    '<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path>' +
    '</svg><span>Saved!</span></span>';

  function getBulkSaveDefaultLabel(btn) {
    if (!btn) return 'Save to folder';
    return btn.getAttribute('data-default-label') || btn.textContent.trim() || 'Save to folder';
  }

  function showBulkSaveFeedback(message, variant) {
    const el = document.getElementById('bulkSaveFeedback');
    if (el) {
      el.textContent = message || '';
      el.classList.remove('hidden', 'text-emerald-300', 'text-rose-300', 'text-white/80', 'text-sky-200');
      if (variant === 'error') {
        el.classList.add('text-rose-300');
      } else if (variant === 'loading') {
        el.classList.add('text-white/80');
      } else if (variant === 'info') {
        el.classList.add('text-sky-200');
      } else {
        el.classList.add('text-emerald-300');
      }
      if (!message) el.classList.add('hidden');
    }
    if (!message) return;
    if (typeof window.showAppToast === 'function') {
      const toastVariant =
        variant === 'error' ? 'error' : variant === 'success' || variant === 'ok' ? 'success' : 'info';
      window.showAppToast(message, {
        variant: toastVariant,
        duration: variant === 'error' ? 9000 : variant === 'loading' ? 3200 : 5200,
      });
    } else if (typeof window.showProspectToast === 'function') {
      window.showProspectToast(message);
    }
  }
  window.showBulkActionConfirmation = showBulkSaveFeedback;

  function setBulkSaveButtonsState(buttons, html, disabled, success) {
    buttons.forEach((b) => {
      b.disabled = disabled;
      b.innerHTML = html;
      b.setAttribute('aria-busy', disabled ? 'true' : 'false');
      b.classList.toggle('bulk-save-btn--success', !!success);
      b.classList.toggle('ring-2', !!success);
      b.classList.toggle('ring-emerald-300', !!success);
    });
  }

  function resetBulkSaveButtons(buttons, originalHtml, isSearchBulk) {
    buttons.forEach((b, i) => {
      b.innerHTML = originalHtml[i] || getBulkSaveDefaultLabel(b);
      b.disabled = selectedKeys.size === 0;
      b.removeAttribute('aria-busy');
      b.classList.remove('bulk-save-btn--success', 'ring-2', 'ring-emerald-300');
    });
    showBulkSaveFeedback('', 'ok');
  }

  function getBulkSaveFolderKey() {
    const folderEl = document.getElementById('bulkFolderSelect');
    const fromBar = folderEl && folderEl.value ? String(folderEl.value).trim() : '';
    if (fromBar) return fromBar;
    if (typeof window.SEARCH_TARGET_FOLDER_KEY === 'string') {
      return window.SEARCH_TARGET_FOLDER_KEY.trim();
    }
    return '';
  }

  function normalizeLeadKeyForApi(key) {
    const k = String(key || '').trim();
    if (!k) return '';
    return k.startsWith('lead:') ? k : `lead:${k}`;
  }

  function syncRowLeadKeyFromSavedMap(row) {
    if (!row) return '';
    const existing = row.dataset.leadKey ? String(row.dataset.leadKey).trim() : '';
    if (existing) return existing;
    const titleKey = normalizeLeadTitleKey(row.dataset.title);
    if (!titleKey || !savedLeads.has(titleKey)) return '';
    const key = String(savedLeads.get(titleKey) || '').trim();
    if (key) row.dataset.leadKey = key;
    return key;
  }

  function getRowLeadKey(row) {
    return syncRowLeadKeyFromSavedMap(row);
  }

  async function ensureRowLeadKeyForBulkSave(row, folderKey) {
    if (!row) return '';
    let key = syncRowLeadKeyFromSavedMap(row);
    if (key) return key;
    const folderEl = document.getElementById('bulkFolderSelect');
    const folderFromBar = folderEl && folderEl.value ? String(folderEl.value).trim() : '';
    const targetFolder =
      folderKey ||
      folderFromBar ||
      (typeof window.SEARCH_TARGET_FOLDER_KEY === 'string'
        ? window.SEARCH_TARGET_FOLDER_KEY.trim()
        : '');
    if (targetFolder && folderEl && !folderFromBar) {
      folderEl.value = targetFolder;
    }
    const ok = await saveLead(row, { silent: true });
    if (!ok) return '';
    key = syncRowLeadKeyFromSavedMap(row);
    return key;
  }

  async function bulkSaveSelectedLeads(triggerBtn) {
    const isSearchBulkEarly = !!document.getElementById('searchResultsLeadsTable');
    if (isSearchBulkEarly && typeof window.__bulkSaveSearchResultsToFolder === 'function') {
      return window.__bulkSaveSearchResultsToFolder(triggerBtn);
    }

    const table = getActiveLeadsTable();
    const scope = table || document;
    const checkedBoxes = scope.querySelectorAll(
      'tbody .row-checkbox:checked, tbody .lead-checkbox:checked',
    );
    if (checkedBoxes.length === 0) return;

    const selectedRows = Array.from(checkedBoxes)
      .map((cb) => cb.closest('.result-row'))
      .filter(Boolean);

    const isSearchBulk = !!document.getElementById('searchResultsLeadsTable');
    const isProspectPipeline = !!document.getElementById('prospectLeadsTable') && !isSearchBulk;
    const folderKey = getBulkSaveFolderKey();

    if ((isSearchBulk || isProspectPipeline) && !folderKey && !window.SEARCH_TARGET_FOLDER_KEY) {
      window.alert('Select a folder from the dropdown first.');
      return;
    }

    if (isProspectPipeline && folderKey) {
      const leadKeys = getSelectedLeadKeysForBulk().map(normalizeLeadKeyForApi).filter(Boolean);
      if (!leadKeys.length) return;
      const buttons = [triggerBtn, bulkSaveBtn, document.getElementById('headerBulkSaveBtn')].filter(Boolean);
      const originalHtml = buttons.map((b) => b.innerHTML);
      const folderName =
        Array.isArray(window.WORKSPACE_FOLDERS)
          ? (window.WORKSPACE_FOLDERS.find((f) => f && f.key === folderKey) || {}).name
          : '';
      showBulkSaveFeedback(
        `Saving ${leadKeys.length} lead${leadKeys.length === 1 ? '' : 's'}${folderName ? ` to ${folderName}` : ''}…`,
        'loading',
      );
      setBulkSaveButtonsState(buttons, BULK_SAVE_LOADING_HTML, true, false);
      try {
        const res = await fetch('/folders/assign-bulk', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ leadKeys, folderKey }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
          throw new Error((data && data.error) || `Could not assign folder (HTTP ${res.status})`);
        }
        const assignCount = Array.isArray(data.updatedKeys) ? data.updatedKeys.length : 0;
        if (!assignCount) {
          throw new Error('No leads were saved to that folder. Refresh the page and try again.');
        }
        const viewingFolder =
          typeof window.PROSPECTING_ACTIVE_FOLDER_KEY === 'string'
            ? window.PROSPECTING_ACTIVE_FOLDER_KEY.trim()
            : '';
        (data.updatedKeys || []).forEach((leadKey) => {
          const row = findLeadRowForBulkKey(leadKey);
          if (!row) return;
          if (viewingFolder && folderKey !== viewingFolder) row.remove();
          else if (!viewingFolder && folderKey) row.remove();
        });
        selectedKeys.clear();
        document.querySelectorAll('.lead-checkbox, .row-checkbox').forEach((cb) => {
          cb.checked = false;
        });
        const successMsg = folderName
          ? `Saved ${assignCount} lead${assignCount === 1 ? '' : 's'} to ${folderName}`
          : `Saved ${assignCount} lead${assignCount === 1 ? '' : 's'}`;
        setBulkSaveButtonsState(buttons, BULK_SAVE_DONE_HTML, true, true);
        showBulkSaveFeedback(successMsg, 'ok');
        updateBulkActionBar();
        setTimeout(() => resetBulkSaveButtons(buttons, originalHtml, false), 3500);
      } catch (err) {
        console.error('Bulk save to folder failed:', err);
        showBulkSaveFeedback(err && err.message ? err.message : 'Could not save leads to folder.', 'error');
        resetBulkSaveButtons(buttons, originalHtml, false);
      }
      return;
    }

    if (isSearchBulk && !folderKey && !window.SEARCH_TARGET_FOLDER_KEY) {
      window.alert('Select a folder (or create one) before saving leads.');
      return;
    }

    const buttons = [triggerBtn, bulkSaveBtn, document.getElementById('headerBulkSaveBtn')].filter(Boolean);
    const originalHtml = buttons.map((b) => b.innerHTML);
    const folderName =
      folderKey && Array.isArray(window.WORKSPACE_FOLDERS)
        ? (window.WORKSPACE_FOLDERS.find((f) => f && f.key === folderKey) || {}).name
        : '';
    showBulkSaveFeedback(
      `Saving ${selectedRows.length} lead${selectedRows.length === 1 ? '' : 's'}${folderName ? ` to ${folderName}` : ''}…`,
      'loading',
    );
    setBulkSaveButtonsState(buttons, BULK_SAVE_LOADING_HTML, true, false);

    let savedCount = 0;
    let assignCount = 0;
    let hadError = false;

    try {
      const leadKeys = [];
      for (const row of selectedRows) {
        const key = await ensureRowLeadKeyForBulkSave(row, folderKey);
        if (key) {
          leadKeys.push(normalizeLeadKeyForApi(key));
          savedCount += 1;
          const bookmarkBtn = row.querySelector('.bookmark-btn');
          if (bookmarkBtn) markBookmarkSaved(bookmarkBtn);
        }
      }

      const uniqueLeadKeys = [...new Set(leadKeys.filter(Boolean))];

      if (folderKey && uniqueLeadKeys.length) {
        const res = await fetch('/folders/assign-bulk', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ leadKeys: uniqueLeadKeys, folderKey }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
          throw new Error((data && data.error) || `Could not assign folder (HTTP ${res.status})`);
        }
        assignCount = Array.isArray(data.updatedKeys) ? data.updatedKeys.length : 0;
        if (assignCount === 0 && uniqueLeadKeys.length && savedCount === 0) {
          throw new Error(
            'Leads were saved but could not be added to that folder. Refresh the page and try again, or check workspace permissions.',
          );
        }
      }

      const totalAffected = folderKey ? Math.max(assignCount, savedCount) : savedCount;
      if (totalAffected > 0) {
        const successMsg = folderName
          ? `Saved ${totalAffected} lead${totalAffected === 1 ? '' : 's'} to ${folderName}`
          : `Saved ${totalAffected} lead${totalAffected === 1 ? '' : 's'}`;
        setBulkSaveButtonsState(buttons, BULK_SAVE_DONE_HTML, true, true);
        showBulkSaveFeedback(successMsg, 'ok');
      } else {
        throw new Error(
          isSearchBulk
            ? 'No leads were saved. Check your folder selection and try again.'
            : 'No leads were saved.',
        );
      }
      updateBulkActionBar();
    } catch (err) {
      hadError = true;
      console.error('Bulk save to folder failed:', err);
      const errMsg = err && err.message ? err.message : 'Could not save leads to folder.';
      showBulkSaveFeedback(errMsg, 'error');
      resetBulkSaveButtons(buttons, originalHtml, isSearchBulk);
    }

    if (!hadError) {
      setTimeout(() => {
        resetBulkSaveButtons(buttons, originalHtml, isSearchBulk);
      }, 3500);
    }
  }
  window.__bulkSaveSelectedLeads = bulkSaveSelectedLeads;

  const isSearchResultsPage = !!document.getElementById('searchResultsLeadsTable');
  if (bulkSaveBtn && !isSearchResultsPage) {
    bulkSaveBtn.addEventListener('click', () => bulkSaveSelectedLeads(bulkSaveBtn));
  }
  const headerBulkSaveBtn = document.getElementById('headerBulkSaveBtn');
  if (headerBulkSaveBtn && !isSearchResultsPage) {
    headerBulkSaveBtn.addEventListener('click', () => bulkSaveSelectedLeads(headerBulkSaveBtn));
  }

  if (isSearchResultsPage) {
    syncSelectAllLeadCheckbox();
    updateBulkActionBar();
  }

  function getBulkEnhanceLayout(row) {
    const cells = row.querySelectorAll('td');
    if (row.querySelector('.pipeline-stage-cell')) {
      const reviewsInner = row.querySelector('.lead-reviews-inner');
      if (!reviewsInner) return null;
      return {
        kind: 'leads',
        addressEl: row.querySelector('.lead-row-address-wrap'),
        phone: row.querySelector('.lead-contact-phone-slot'),
        email: row.querySelector('.lead-contact-email-slot'),
        website: row.querySelector('.lead-contact-web-slot'),
        socials: row.querySelector('.lead-cell-socials-content'),
        reviews: reviewsInner,
      };
    }
    const phoneSlot = row.querySelector('.lead-contact-phone-slot');
    const emailSlot = row.querySelector('.lead-contact-email-slot');
    const websiteSlot = row.querySelector('.lead-contact-web-slot');
    const opportunityCell = row.querySelector('.opportunity-cell');
    if (phoneSlot && emailSlot && websiteSlot && opportunityCell) {
      return {
        kind: 'results',
        phone: phoneSlot,
        reviews: cells[4],
        opportunity: opportunityCell,
        website: websiteSlot,
        email: emailSlot,
        social: cells[6],
      };
    }
    if (cells.length < 14) return null;
    return {
      kind: 'results',
      phone: cells[2],
      reviews: cells[4],
      opportunity: cells[5],
      website: cells[6],
      email: cells[7],
      social: cells[8],
    };
  }

  function applyEnrichDataToRowDataset(row, d, result) {
    if (!d || typeof d !== 'object') return;
    if (d.facebook) row.dataset.facebook = d.facebook;
    if (d.instagram) row.dataset.instagram = d.instagram;
    if (d.tiktok) row.dataset.tiktok = d.tiktok;
    if (d.twitter) row.dataset.twitter = d.twitter;
    if (d.linkedin) row.dataset.linkedin = d.linkedin;
    if (result && result.foundUrl) row.dataset.website = result.foundUrl;
    if (d.website && d.website !== 'N/A') row.dataset.website = d.website;
    const sch = d.has_schema_markup ?? d.hasSchemaMarkup;
    const chat = d.has_chatbot ?? d.hasChatbot;
    const ctc = d.has_click_to_call ?? d.hasClickToCall;
    const mob = d.is_mobile_friendly ?? d.isMobileFriendly;
    const old = d.is_outdated ?? d.isOutdated;
    const vm = d.visual_modernity_score ?? d.visualModernityScore;
    const aeo = d.aeo_score ?? d.aeoScore;
    const gg = d.geo_gaps ?? d.geoGaps;
    const cn = d.competitor_name ?? d.competitorName;
    const cg = d.competitor_gap ?? d.competitorGap;
    const cmb = d.competitor_meta_benchmark ?? d.competitorMetaBenchmark;
    const au = d.audit_summary ?? d.auditSummary;
    if (sch !== undefined) row.dataset.hasSchemaMarkup = sch;
    if (chat !== undefined) row.dataset.hasChatbot = chat;
    if (ctc !== undefined) row.dataset.hasClickToCall = ctc;
    if (mob !== undefined) row.dataset.isMobileFriendly = mob;
    if (old !== undefined) row.dataset.isOutdated = old;
    if (vm !== undefined) row.dataset.visualModernityScore = vm;
    if (aeo !== undefined) row.dataset.aeoScore = aeo;
    if (gg !== undefined) row.dataset.geoGaps = gg;
    if (cn !== undefined) row.dataset.competitorName = cn;
    if (cg !== undefined) row.dataset.competitorGap = cg;
    if (cmb !== undefined) row.dataset.competitorMetaBenchmark = cmb;
    if (au !== undefined) row.dataset.auditSummary = au;
    const cmsPl = d.cms_platform ?? d.cmsPlatform;
    if (cmsPl !== undefined && cmsPl !== null) row.dataset.cmsPlatform = cmsPl;
    if (d.email) row.dataset.email = d.email;
    if (d.phone !== undefined && d.phone !== null) row.dataset.phone = d.phone || 'N/A';
    const ratingVal = d.totalScore ?? d.total_score ?? d.rating;
    const revVal = d.reviewsCount ?? d.reviews_count ?? d.reviews;
    if (ratingVal !== undefined && ratingVal !== null && !Number.isNaN(parseFloat(ratingVal))) {
      row.dataset.rating = String(ratingVal);
    }
    if (revVal !== undefined && revVal !== null && !Number.isNaN(parseInt(revVal, 10))) {
      row.dataset.reviews = String(parseInt(revVal, 10));
    }
    if (d.updates) row.dataset.updates = JSON.stringify(d.updates);
    revealOpportunityForRow(row);
    if (d.address !== undefined && d.address !== null && String(d.address).trim()) {
      row.dataset.address = d.address || 'N/A';
    }
    if (d.city !== undefined && d.city !== null && String(d.city).trim()) {
      row.dataset.city = String(d.city).trim();
    }
    if (d.state !== undefined && d.state !== null && String(d.state).trim()) {
      row.dataset.state = String(d.state).trim();
    }
    const zipVal = d.zip ?? d.postalCode ?? d.postal_code;
    if (zipVal !== undefined && zipVal !== null && String(zipVal).trim()) {
      row.dataset.zip = String(zipVal).trim();
    }
  }

  function renderLeadsTableAddressCell(addr) {
    const a = addr && addr !== 'N/A' ? String(addr).trim() : '';
    if (!a) {
      return '<span class="text-brand-muted/50 dark:text-slate-500 text-sm font-bold">—</span>';
    }
    const safe = escapeHtmlAttr(a);
    return `<span class="block text-xs font-medium text-brand-muted dark:text-slate-300 max-w-[200px] truncate" title="${safe}">${escapeHtmlText(a)}</span>`;
  }

  function renderLeadsTableWebsiteCell(w) {
    if (!w || w === 'N/A') {
      return '<span class="text-brand-muted/50 dark:text-slate-500 font-bold text-sm">-</span>';
    }
    const href = w.startsWith('http') ? w : `https://${w}`;
    const label = w.replace(/^https?:\/\//, '').split('?')[0].replace(/\/$/, '');
    return `<a href="${href}" target="_blank" class="website-link text-brand-muted dark:text-slate-300 hover:text-brand-dark dark:hover:text-white transition-colors border-b border-transparent hover:border-brand-dark dark:hover:border-white pb-0.5 inline-block max-w-[150px] truncate" title="${w}" data-url="${w}">${label}</a>`;
  }

  function renderLeadsTablePhoneCell(phone, leadKey) {
    return renderPipelinePhoneControlHtml(phone, leadKey || '');
  }

  function setLeadPhoneSlot(el, phone) {
    if (!el) return;
    const row = el.closest('.result-row');
    if (row) {
      replacePipelinePhoneSlot(row, phone);
      return;
    }
    const p = phone && phone !== 'N/A' ? String(phone).trim() : '';
    if (!p) {
      el.outerHTML = renderPipelinePhoneControlHtml('', '');
      return;
    }
    if (el.classList && el.classList.contains('lead-contact-phone-slot')) {
      const key = '';
      el.outerHTML = renderPipelinePhoneControlHtml(p, key);
    }
  }

  function syncPipelineRowCallButton(row, phone) {
    if (!row || typeof row.querySelector !== 'function') return;
    const callBtn = row.querySelector('.lead-contact-phone-slot.js-click-to-call-btn');
    if (!callBtn) return;
    const p = phone && phone !== 'N/A' ? String(phone).trim() : '';
    const key = row.dataset.leadKey || '';
    if (p) {
      callBtn.classList.remove('hidden');
      callBtn.disabled = false;
      callBtn.dataset.phone = p;
      if (key) callBtn.dataset.leadKey = key;
      else callBtn.removeAttribute('data-lead-key');
      const label = callBtn.querySelector('.lead-contact-phone-label');
      if (label) label.textContent = p;
      callBtn.setAttribute('title', p);
      callBtn.setAttribute('aria-label', `Call ${p}`);
    } else {
      callBtn.classList.add('hidden');
      callBtn.disabled = true;
      delete callBtn.dataset.phone;
      delete callBtn.dataset.leadKey;
    }
  }

  function syncPipelineRowWebsiteCell(row) {
    if (!row || typeof row.querySelector !== 'function') return;
    const cell = row.querySelector('[data-plc="website"]');
    if (!cell) return;
    const ws = row.dataset.website && row.dataset.website !== 'N/A' ? String(row.dataset.website).trim() : '';
    if (ws) {
      cell.innerHTML = `<span class="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 dark:text-emerald-400" title="${escapeHtmlAttr(ws)}"><svg class="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>Yes</span>`;
    } else {
      cell.innerHTML =
        '<span class="inline-flex items-center gap-1 text-xs font-bold text-rose-600 dark:text-rose-400"><svg class="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>No</span>';
    }
  }
  window.syncPipelineRowCallButton = syncPipelineRowCallButton;
  window.syncPipelineRowWebsiteCell = syncPipelineRowWebsiteCell;

  function renderLeadEmailSlotInner(email) {
    const e = email && email !== 'N/A' ? String(email).trim() : '';
    if (!e) {
      return '<span class="text-xs font-semibold text-brand-muted/60 dark:text-slate-500">—</span>';
    }
    return `<a href="mailto:${encodeURIComponent(e)}" class="text-brand-yellow hover:underline font-bold text-xs truncate block max-w-[200px]" title="${escapeHtmlAttr(e)}" onclick="event.stopPropagation()">${escapeHtmlText(e)}</a>`;
  }

  function renderLeadWebSlotInner(website) {
    if (!website || website === 'N/A') {
      return '<span class="text-xs font-semibold text-brand-muted/60 dark:text-slate-500">—</span>';
    }
    const w = String(website).trim();
    const href = w.startsWith('http') ? w : `https://${w}`;
    const label = w.replace(/^https?:\/\//i, '').split('?')[0].replace(/\/$/, '');
    const disp = label.length > 36 ? `${label.slice(0, 36)}…` : label;
    return `<a href="${escapeHtmlAttr(href)}" target="_blank" rel="noopener noreferrer" class="website-link text-xs font-semibold text-brand-dark dark:text-slate-300 hover:text-brand-yellow truncate block border-b border-transparent hover:border-brand-yellow/50 max-w-[200px]" title="${escapeHtmlAttr(w)}" data-url="${escapeHtmlAttr(w)}">${escapeHtmlText(disp)}</a>`;
  }

  function renderLeadSocialsSlotInner(mapsUrl, facebook, instagram, twitter, title, address, city, gradSuffix) {
    const gmResolved = resolveGoogleMapsSocialHref(mapsUrl, title, address, city);
    const gm = gmResolved ? String(gmResolved).trim() : '';
    const fb = facebook && facebook !== 'N/A' ? String(facebook).trim() : '';
    const ig = instagram && instagram !== 'N/A' ? String(instagram).trim() : '';
    const tw = twitter && twitter !== 'N/A' ? String(twitter).trim() : '';
    const suffix = gradSuffix != null ? String(gradSuffix) : 'slot';
    if (__socialBrand) {
      return (
        '<div class="flex items-center gap-2.5 pt-1.5">' +
        __socialBrand.renderLinks({ gm, fb, ig, tw, gradSuffix: suffix }) +
        '</div>'
      );
    }
    let html = '<div class="flex items-center gap-2.5 pt-1.5">';
    if (gm) {
      html += `<a href="${escapeHtmlAttr(gm)}" target="_blank" rel="noopener noreferrer" class="${GOOGLE_SOCIALS_TABLE_BTN_CLASS}" title="Google Maps / Business Profile" aria-label="Google Business Profile (opens in Maps)" onclick="event.stopPropagation()">${GOOGLE_BUSINESS_ICON_SVG}</a>`;
    }
    if (!gm && !fb && !ig && !tw) {
      html += '<span class="text-xs font-semibold text-brand-muted/60 dark:text-slate-500">—</span>';
    }
    html += '</div>';
    return html;
  }

  function renderLeadsReviewsInnerHtml(rating, reviews) {
    const r = parseFloat(rating) || 0;
    const c = parseInt(reviews, 10) || 0;
    if (r > 0) {
      return `<div class="flex items-center gap-1.5"><div class="row-stars flex items-center gap-0.5 shrink-0" aria-hidden="true"></div><span class="lead-reviews-line text-sm font-bold tabular-nums text-brand-dark dark:text-slate-100" title="${r.toFixed(1)} stars, ${c} reviews">${r.toFixed(1)} <span class="text-brand-muted dark:text-slate-400 font-semibold">(${c})</span></span></div>`;
    }
    if (c > 0) {
      return `<span class="text-xs font-semibold text-brand-muted dark:text-slate-400 tabular-nums" title="${c} reviews">— <span class="text-brand-dark dark:text-slate-200">(${c})</span></span>`;
    }
    return '<span class="text-sm font-semibold text-brand-muted/60 dark:text-slate-500">—</span>';
  }

  function renderLeadsTableEmailCell(email) {
    const e = email && email !== 'N/A' ? String(email).trim() : '';
    if (!e) {
      return '<span class="text-brand-muted/50 dark:text-slate-500 font-bold">—</span>';
    }
    return `<a href="mailto:${encodeURIComponent(e)}" class="text-brand-yellow hover:underline font-bold truncate block max-w-[180px]" title="${escapeHtmlAttr(e)}" onclick="event.stopPropagation()">${escapeHtmlText(e)}</a>`;
  }

  function renderReviewsCellInner(rating, reviews) {
    const r = parseFloat(rating) || 0;
    const c = parseInt(reviews, 10) || 0;
    if (r > 0) {
      return `<div class="flex flex-col items-start gap-1 min-w-[4.5rem]">
        <div class="flex items-center gap-1.5">
          <div class="row-stars flex items-center gap-0.5 shrink-0" aria-hidden="true"></div>
          <span class="text-xs font-black tabular-nums text-brand-dark dark:text-slate-100 leading-none">${r.toFixed(1)}</span>
        </div>
        <span class="text-[10px] font-bold text-brand-muted dark:text-slate-400 leading-snug">${c} reviews</span>
      </div>`;
    }
    return `<div class="flex flex-col items-start gap-1 min-w-[4.5rem]">
      <span class="text-sm font-bold text-brand-muted/50 dark:text-slate-500 leading-none">—</span>
      ${
        c > 0
          ? `<span class="text-[10px] font-bold text-brand-muted/60 dark:text-slate-500 leading-snug">${c} reviews</span>`
          : ''
      }
    </div>`;
  }

  const enhanceLoadingHtml =
    '<span class="flex items-center gap-2 justify-center"><svg class="animate-spin h-3.5 w-3.5 text-brand-yellow" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg><span class="text-[10px] font-black uppercase tracking-widest">Enhancing…</span></span>';

  const bulkEnhanceDomSnapshots = new WeakMap();
  let bulkEnhanceBtnSnapshotHtml = null;

  function findResultRowByLeadKey(key) {
    const esc = String(key).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return document.querySelector(`tr.result-row[data-lead-key="${esc}"]`);
  }

  function applyBulkEnhanceDomAfterFetch(row, layout, cellOriginals, success, result) {
    const d = result && (result.lead || result.data);
    if (success && d) {
      applyEnrichDataToRowDataset(row, d, result);
      if (layout.kind === 'leads') {
        if (layout.addressEl) {
          syncPipelineRowAddressDisplay(row);
        }
        if (layout.phone) setLeadPhoneSlot(layout.phone, row.dataset.phone);
        if (layout.email) layout.email.innerHTML = renderLeadEmailSlotInner(row.dataset.email);
        if (layout.website) layout.website.innerHTML = renderLeadWebSlotInner(row.dataset.website);
        syncRowSocialsUnderPhone(row);
        if (layout.reviews) {
          layout.reviews.innerHTML = renderLeadsReviewsInnerHtml(row.dataset.rating, row.dataset.reviews);
          const starElLead = layout.reviews.querySelector('.row-stars');
          if (starElLead) renderStarsInElement(starElLead, parseFloat(row.dataset.rating) || 0);
        }
        syncPipelineRowCallButton(row, row.dataset.phone);
        syncPipelineRowWebsiteCell(row);
      } else {
        if (row.dataset.email && row.dataset.email !== 'N/A') {
          layout.email.innerHTML = `<a href="mailto:${row.dataset.email}" class="font-bold text-brand-dark hover:text-brand-yellow transition-colors truncate max-w-[120px] inline-block" title="${row.dataset.email}">${row.dataset.email}</a>`;
        } else {
          layout.email.innerHTML = cellOriginals.email;
        }
        const gmBulk = resolveGoogleMapsSocialHref(
          row.dataset.url,
          row.dataset.title,
          row.dataset.address,
          row.dataset.city
        );
        let socialsHtml = '<div class="flex items-center justify-center gap-2.5">';
        if (__socialBrand) {
          socialsHtml += __socialBrand.renderLinks({
            gm: gmBulk,
            fb: row.dataset.facebook,
            ig: row.dataset.instagram,
            tw: row.dataset.twitter,
            gradSuffix: row.dataset.leadKey || 'bulk',
          });
        }
        socialsHtml += '</div>';
        layout.social.innerHTML = socialsHtml;
        if (layout.website) {
          const w = row.dataset.website;
          layout.website.innerHTML =
            w && w !== 'N/A'
              ? `<a href="${w.startsWith('http') ? w : 'https://' + w}" target="_blank" class="website-link hover:text-brand-dark transition-colors border-b border-transparent hover:border-brand-dark pb-0.5 inline-block max-w-[150px] truncate" title="${w}">${w.replace(/^https?:\/\//, '').split('?')[0].replace(/\/$/, '')}</a>`
              : '-';
        }
        if (layout.phone && row.dataset.phone) {
          layout.phone.textContent = row.dataset.phone && row.dataset.phone !== 'N/A' ? row.dataset.phone : '-';
        }
        if (layout.reviews) {
          layout.reviews.innerHTML = renderReviewsCellInner(row.dataset.rating, row.dataset.reviews);
          const starEl2 = layout.reviews.querySelector('.row-stars');
          if (starEl2) renderStarsInElement(starEl2, parseFloat(row.dataset.rating) || 0);
        }
      }
      const selectedPanelRow = document.querySelector('.result-row.selected');
      if (selectedPanelRow === row && typeof populatePanel === 'function') populatePanel(row);
    } else {
      if (layout.kind === 'leads') {
        if (layout.addressEl && cellOriginals.address !== undefined) {
          layout.addressEl.innerHTML = cellOriginals.address;
        }
        if (layout.phone && cellOriginals.phone !== undefined) layout.phone.innerHTML = cellOriginals.phone;
        if (layout.email && cellOriginals.email !== undefined) layout.email.innerHTML = cellOriginals.email;
        if (layout.website && cellOriginals.website !== undefined) layout.website.innerHTML = cellOriginals.website;
        if (layout.socials && cellOriginals.socials !== undefined) layout.socials.innerHTML = cellOriginals.socials;
        if (layout.reviews && cellOriginals.reviews !== undefined) layout.reviews.innerHTML = cellOriginals.reviews;
      } else {
        layout.email.innerHTML = cellOriginals.email;
        layout.social.innerHTML = cellOriginals.social;
      }
    }
  }

  function captureBulkEnhanceRowSnapshot(row, layout, spinner) {
    if (!layout) return;
    const cellOriginals = {};
    if (layout.kind === 'leads') {
      if (layout.addressEl) cellOriginals.address = layout.addressEl.innerHTML;
      if (layout.phone) cellOriginals.phone = layout.phone.innerHTML;
      if (layout.email) cellOriginals.email = layout.email.innerHTML;
      if (layout.website) cellOriginals.website = layout.website.innerHTML;
      if (layout.socials) cellOriginals.socials = layout.socials.innerHTML;
      if (layout.reviews) cellOriginals.reviews = layout.reviews.innerHTML;
      if (layout.addressEl) layout.addressEl.innerHTML = spinner;
      if (layout.phone) layout.phone.innerHTML = spinner;
      if (layout.email) layout.email.innerHTML = spinner;
      if (layout.website) layout.website.innerHTML = spinner;
      if (layout.socials) layout.socials.innerHTML = spinner;
    } else {
      if (layout.email) cellOriginals.email = layout.email.innerHTML;
      if (layout.social) cellOriginals.social = layout.social.innerHTML;
      if (layout.social) {
        layout.social.innerHTML = `<div class="flex items-center gap-2 text-brand-muted">${spinner}</div>`;
      }
      if (layout.email && (!row.dataset.email || row.dataset.email === 'N/A')) layout.email.innerHTML = spinner;
    }
    bulkEnhanceDomSnapshots.set(row, cellOriginals);
  }

  function notifyBulkEnhanceIdle(msg, variant) {
    if (typeof window.showAppToast === 'function') {
      window.showAppToast(msg, { variant: variant || 'info', duration: 10000 });
    } else if (typeof window.showProspectToast === 'function') {
      window.showProspectToast(msg);
    } else {
      window.alert(msg);
    }
  }

  async function runBulkEnhanceSelectedLeads() {
    const checkedBoxes = document.querySelectorAll('.row-checkbox:checked, .lead-checkbox:checked');
    if (checkedBoxes.length === 0) {
      notifyBulkEnhanceIdle('Select one or more leads (checkboxes) to enhance.');
      return;
    }

    const selectedRows = Array.from(checkedBoxes).map((cb) => cb.closest('.result-row')).filter(Boolean);
    const leadsToProcess = selectedRows.slice(0, 20);
    if (selectedRows.length > 20) console.warn('Bulk audit limited to first 20 selected leads.');

    const keyedRows = leadsToProcess.filter((r) => r.dataset.leadKey);
    const canUseEnhanceQueue =
      keyedRows.length > 0 &&
      keyedRows.length === leadsToProcess.length &&
      window.agencyOsBulkEnhance &&
      typeof window.agencyOsBulkEnhance.start === 'function';

    const enhanceBtns = document.querySelectorAll('.js-bulk-enhance');
    const enhanceBtnOriginalHtml = Array.from(enhanceBtns).map((b) => b.innerHTML);
    bulkEnhanceBtnSnapshotHtml = enhanceBtnOriginalHtml;
    enhanceBtns.forEach((b) => {
      b.disabled = true;
      b.classList.add('loading', 'animate-magic');
      b.innerHTML = enhanceLoadingHtml;
    });

    const spinner =
      '<span class="text-[9px] font-bold text-brand-yellow uppercase tracking-widest animate-pulse">Scanning…</span>';

    if (canUseEnhanceQueue) {
      for (const row of leadsToProcess) {
        captureBulkEnhanceRowSnapshot(row, getBulkEnhanceLayout(row), spinner);
      }
      window.agencyOsBulkEnhance.start(leadsToProcess.map((r) => r.dataset.leadKey));
      return;
    }

    let successCount = 0;
    let attemptedCount = 0;
    let lastError = '';
    try {
      try {
        sessionStorage.setItem('agency_os_sync_enhance', '1');
      } catch (_) {}
      updateProcessingStatus(true);
      const bellBadge = document.getElementById('bulkEnhanceBellBadge');
      const pingDot = document.getElementById('notificationPing');
      if (bellBadge) {
        bellBadge.textContent = 'ENR';
        bellBadge.classList.remove('hidden');
        bellBadge.setAttribute('title', 'Enriching selected leads');
      }
      if (pingDot) {
        pingDot.classList.remove('hidden');
        pingDot.classList.add('animate-ping');
      }

      for (const row of leadsToProcess) {
        const layout = getBulkEnhanceLayout(row);
        const key = row.dataset.leadKey;
        let url = row.dataset.website;
        const title = row.dataset.title;
        const city = row.dataset.city;
        const state = row.dataset.state;

        if (!key && (!url || url === 'N/A') && (!title || !city)) continue;

        attemptedCount += 1;
        const cellOriginals = {};
        if (layout) captureBulkEnhanceRowSnapshot(row, layout, spinner);

        try {
          let result = {};
          if (key) {
            const res = await fetch(`/leads/${encodeURIComponent(key)}/enhance`, { method: 'POST' });
            result = await res.json().catch(() => ({}));
            if (res.ok && result.processing) {
              result = await pollContactHuntStatus(key);
            } else if (!res.ok) {
              result = { success: false, error: result.error || `Enhance failed (${res.status}).` };
            }
          } else {
            const res = await fetch('/enrich', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url, title, city, state }),
            });
            result = await res.json().catch(() => ({}));
            if (!res.ok) {
              result = { success: false, error: result.error || `Enhance failed (${res.status}).` };
            }
          }

          if (result.error) lastError = String(result.error);
          const d = result.lead || result.data;
          const ok = !!result.success && !!d;
          if (ok) successCount += 1;
          if (layout) applyBulkEnhanceDomAfterFetch(row, layout, bulkEnhanceDomSnapshots.get(row) || cellOriginals, ok, result);
          else if (ok) applyEnrichDataToRowDataset(row, d, result);
        } catch (err) {
          console.error('Enrichment error:', err);
          if (layout) applyBulkEnhanceDomAfterFetch(row, layout, bulkEnhanceDomSnapshots.get(row) || {}, false, {});
        }
      }
    } finally {
      try {
        sessionStorage.removeItem('agency_os_sync_enhance');
      } catch (_) {}
      updateProcessingStatus(false);
      const pingAfterSync = document.getElementById('notificationPing');
      if (pingAfterSync) {
        pingAfterSync.classList.remove('animate-ping');
        pingAfterSync.classList.add('hidden');
      }
    }

    const summaryLabel =
      successCount > 0
        ? `✨ Updated ${successCount} lead${successCount !== 1 ? 's' : ''}`
        : attemptedCount > 0
          ? 'No new data (check API / console)'
          : '✨ Done';
    enhanceBtns.forEach((b) => {
      b.innerHTML = `<span class="text-[10px] font-black uppercase tracking-widest">${summaryLabel}</span>`;
    });
    if (attemptedCount === 0) {
      notifyBulkEnhanceIdle(
        'Could not enhance the selected leads. Save them to your pipeline first, then try again.',
        'warning',
      );
    } else if (successCount === 0) {
      const enhanceFailMsg = lastError
        ? `Enhance finished but no rows were updated.\n\n${lastError}`
        : 'Enhance found no new contact or review data for the selected lead(s).';
      notifyBulkEnhanceIdle(enhanceFailMsg, 'error');
    }
    updateOpportunityBadges();
    if (!isSearchResultsTablePage()) sortLeadsByOpportunity(false);
    applyTableStars();

    setTimeout(() => {
      const snap = bulkEnhanceBtnSnapshotHtml;
      bulkEnhanceBtnSnapshotHtml = null;
      enhanceBtns.forEach((b, i) => {
        b.classList.remove('loading', 'animate-magic');
        b.disabled = false;
        b.innerHTML = (snap && snap[i]) || b.innerHTML;
      });
    }, 2800);
  }
  window.__runBulkEnhanceSelectedLeadsImpl = runBulkEnhanceSelectedLeads;
  window.__runBulkEnhanceSelectedLeads = runBulkEnhanceSelectedLeads;

  async function runBulkSocialEnrichmentSelectedLeads() {
    const checkedBoxes = document.querySelectorAll('.row-checkbox:checked, .lead-checkbox:checked');
    if (checkedBoxes.length === 0) {
      notifyBulkEnhanceIdle('Select one or more saved leads to find social profiles.');
      return;
    }

    const selectedRows = Array.from(checkedBoxes).map((cb) => cb.closest('.result-row')).filter(Boolean);
    const leadsToProcess = selectedRows.filter((r) => r.dataset.leadKey).slice(0, 25);
    if (!leadsToProcess.length) {
      notifyBulkEnhanceIdle('Save leads to your pipeline first — social search needs saved lead keys.', 'warning');
      return;
    }
    if (selectedRows.length > 25) {
      notifyBulkEnhanceIdle('Social search limited to 25 leads per batch.', 'info');
    }

    const socialBtns = document.querySelectorAll('.js-bulk-socials');
    const btnSnap = Array.from(socialBtns).map((b) => b.innerHTML);
    const loadingHtml =
      '<span class="text-[10px] font-black uppercase tracking-widest animate-pulse">Finding…</span>';
    socialBtns.forEach((b) => {
      b.disabled = true;
      b.classList.add('loading');
      b.innerHTML = loadingHtml;
    });

    let successCount = 0;
    let attemptedCount = 0;
    let lastError = '';

    try {
      updateProcessingStatus(true);
      for (const row of leadsToProcess) {
        const key = row.dataset.leadKey;
        if (!key) continue;
        attemptedCount += 1;
        syncRowSocialsUnderPhone(row);
        const slot = row.querySelector('.lead-cell-socials-content');
        if (slot) {
          slot.innerHTML =
            '<span class="text-[9px] font-bold text-pink-400 uppercase tracking-widest animate-pulse">Searching…</span>';
        }
        try {
          const res = await fetch(`/leads/${encodeURIComponent(key)}/enrich-socials`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
          });
          const result = await res.json().catch(() => ({}));
          if (result.error) lastError = String(result.error);
          const d = result.lead;
          const ok = res.ok && result.success && d && !result.skipped;
          if (ok) successCount += 1;
          if (d) {
            applyEnrichDataToRowDataset(row, d, result);
            syncRowSocialsUnderPhone(row);
          } else if (slot) {
            syncRowSocialsUnderPhone(row);
          }
        } catch (err) {
          console.error('Social enrichment error:', err);
          lastError = err.message || lastError;
          syncRowSocialsUnderPhone(row);
        }
      }
    } finally {
      updateProcessingStatus(false);
    }

    const summaryLabel =
      successCount > 0
        ? `Found socials on ${successCount} lead${successCount !== 1 ? 's' : ''}`
        : attemptedCount > 0
          ? 'No new socials found'
          : 'Done';
    socialBtns.forEach((b) => {
      b.innerHTML = `<span class="text-[10px] font-black uppercase tracking-widest">${summaryLabel}</span>`;
    });

    if (successCount === 0 && attemptedCount > 0) {
      notifyBulkEnhanceIdle(
        lastError ||
          'No matching Instagram, TikTok, or X profiles found. Add TikHub API key under Workspace → Integrations.',
        'warning',
      );
    } else if (successCount > 0) {
      notifyBulkEnhanceIdle(
        `Added social profile links on ${successCount} lead${successCount !== 1 ? 's' : ''}. Click icons in the Socials column to DM.`,
        'ok',
      );
    }

    setTimeout(() => {
      socialBtns.forEach((b, i) => {
        b.classList.remove('loading');
        b.disabled = false;
        b.innerHTML = btnSnap[i] || b.innerHTML;
      });
    }, 2800);
  }
  window.__runBulkSocialEnrichmentSelectedLeadsImpl = runBulkSocialEnrichmentSelectedLeads;
  window.__runBulkSocialEnrichmentSelectedLeads = runBulkSocialEnrichmentSelectedLeads;

  document.addEventListener('agency-os-bulk-enhance-item-complete', (ev) => {
    const { key, success, result } = ev.detail || {};
    if (!key) return;
    const row = findResultRowByLeadKey(key);
    if (!row) return;
    const layout = getBulkEnhanceLayout(row);
    const snap = bulkEnhanceDomSnapshots.get(row) || {};
    if (layout) {
      applyBulkEnhanceDomAfterFetch(row, layout, snap, success, result);
    } else if (success && (result.lead || result.data)) {
      applyEnrichDataToRowDataset(row, result.lead || result.data, result);
      syncPipelineRowWebsiteCell(row);
    }
  });

  document.addEventListener('agency-os-bulk-enhance-finished', (ev) => {
    const d = ev.detail || {};
    const enhanceBtns = document.querySelectorAll('.js-bulk-enhance');
    const summaryLabel =
      d.successCount > 0
        ? `✨ Updated ${d.successCount} lead${d.successCount !== 1 ? 's' : ''}`
        : d.attempted > 0
          ? 'No new data (check API / console)'
          : '✨ Done';
    enhanceBtns.forEach((b) => {
      b.innerHTML = `<span class="text-[10px] font-black uppercase tracking-widest">${summaryLabel}</span>`;
    });
    if (d.attempted === 0) {
      notifyBulkEnhanceIdle(
        'Could not enhance the selected leads. Save them to your pipeline first, then try again.',
        'warning',
      );
    } else if (d.attempted > 0 && d.successCount === 0) {
      const enhanceFailMsg = d.lastError
        ? `Enhance finished but no rows were updated.\n\n${d.lastError}`
        : 'Enhance found no new contact or review data for the selected lead(s).';
      notifyBulkEnhanceIdle(enhanceFailMsg, 'error');
    }
    updateOpportunityBadges();
    if (!isSearchResultsTablePage()) sortLeadsByOpportunity(false);
    applyTableStars();
    setTimeout(() => {
      const snap = bulkEnhanceBtnSnapshotHtml;
      bulkEnhanceBtnSnapshotHtml = null;
      enhanceBtns.forEach((b, i) => {
        b.classList.remove('loading', 'animate-magic');
        b.disabled = false;
        b.innerHTML = (snap && snap[i]) || b.innerHTML;
      });
    }, 2200);
  });

  document.addEventListener(
    'click',
    (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('.js-bulk-enhance') : null;
      if (!btn || btn.disabled || btn.classList.contains('loading')) return;
      e.preventDefault();
      e.stopPropagation();
      void runBulkEnhanceSelectedLeads();
    },
    true,
  );

  document.addEventListener(
    'click',
    (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('.js-bulk-socials') : null;
      if (!btn || btn.disabled || btn.classList.contains('loading')) return;
      e.preventDefault();
      e.stopPropagation();
      void runBulkSocialEnrichmentSelectedLeads();
    },
    true,
  );

  // Backfill missing phone/email (and website hints) for all leads in workspace.
  document.querySelectorAll('.js-bulk-ai-analysis').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const checked = Array.from(document.querySelectorAll('.row-checkbox:checked, .lead-checkbox:checked'));
      const rows = checked.length
        ? checked.map((cb) => cb.closest('.result-row')).filter(Boolean)
        : Array.from(document.querySelectorAll('.result-row'));
      const rowsWithSite = rows.filter((r) => r.dataset.website && r.dataset.website !== 'N/A');
      if (!rowsWithSite.length) return window.alert('No selected leads have a website URL.');
      const leadKeys = rowsWithSite.map((r) => r.dataset.leadKey).filter(Boolean).slice(0, 100);
      if (!leadKeys.length) return;
      const original = btn.innerHTML;
      btn.disabled = true;
      btn.classList.add('opacity-70');
      btn.innerHTML = '<span>Analyzing…</span>';
      try {
        let okCount = 0;
        let failCount = 0;
        for (const r of rowsWithSite.slice(0, 100)) {
          try {
            await runAiAnalysisForRow(r);
            okCount += 1;
          } catch {
            failCount += 1;
          }
        }
        if (typeof window.showAppToast === 'function') {
          window.showAppToast(
            `AI analysis complete: ${okCount} updated${failCount ? `, ${failCount} failed` : ''}.`,
            { variant: failCount ? 'warning' : 'success' }
          );
        }
      } catch (err) {
        const msg = err && err.message ? err.message : 'AI analysis failed';
        if (typeof window.showAppToast === 'function') window.showAppToast(msg, { variant: 'error' });
        else window.alert(msg);
      } finally {
        btn.disabled = false;
        btn.classList.remove('opacity-70');
        btn.innerHTML = original;
      }
    });
  });

  // Enrich leads (top + floating) → Enhance API then Socials API
  // (.js-enhance-missing-contacts / .js-bulk-enrich-leads in pipeline-bulk-select.js).

  // --- Website Preview Hover Logic Removed ---


  // --- Kanban View & Batch Outreach Logic ---

  function getPipelineKanbanStageIds() {
    if (Array.isArray(window.PIPELINE_STAGES) && window.PIPELINE_STAGES.length) {
      return window.PIPELINE_STAGES.map((s) => String(s && s.id ? s.id : '').trim()).filter(Boolean);
    }
    const ids = [];
    document
      .querySelectorAll('#kanbanView[data-kanban-mode="pipeline"] .kanban-column[data-pipeline-stage]')
      .forEach((colEl) => {
        const id = String(colEl.dataset.pipelineStage || '').trim();
        if (id) ids.push(id);
      });
    return ids;
  }

  function resolveRowKanbanColumnIndex(row, stageIds) {
    if (!stageIds.length) return -1;
    const sid = String(
      row.dataset.stageId || row.getAttribute('data-stage-id') || '',
    ).trim();
    if (sid) {
      const exact = stageIds.indexOf(sid);
      if (exact >= 0) return exact;
    }
    let ps = parseInt(row.dataset.pipelineStage || row.getAttribute('data-pipeline-stage'), 10);
    if (Number.isNaN(ps) || ps < 1) ps = 1;
    if (ps > stageIds.length) ps = stageIds.length;
    return ps - 1;
  }

  function isPipelineKanbanVisible() {
    const kanbanViewEl = document.getElementById('kanbanView');
    if (!kanbanViewEl) return false;
    if (document.documentElement.classList.contains('adhello-pipeline-view-kanban')) return true;
    return !kanbanViewEl.classList.contains('hidden');
  }

  function bindKanbanSortable(col, columnWrap, pipelineMode) {
    if (typeof Sortable === 'undefined') return;
    Sortable.create(col, {
      group: 'leads',
      animation: 150,
      ghostClass: 'opacity-50',
      onEnd: async (evt) => {
        const item = evt.item;
        const toCol =
          (evt.to && evt.to.closest && evt.to.closest('.kanban-column')) ||
          (evt.to && evt.to.parentElement) ||
          null;
        const leadKey = item.dataset.leadKey;
        if (!leadKey || !toCol) return;

        if (pipelineMode) {
          const newStageId = String(toCol.dataset.pipelineStage || '').trim();
          if (!newStageId) return;
          try {
            const res = await fetch(`/leads/${leadKey}/update`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
              body: JSON.stringify({
                stageId: newStageId,
                pipelineStageUpdatedAt: new Date().toISOString(),
                onPipelineBoard: true,
              }),
            });
            const data = await res.json();
            if (data.success) {
              const originalRow = document.querySelector(`.result-row[data-lead-key="${leadKey}"]`);
              if (originalRow) {
                const lead = data.lead || {};
                originalRow.dataset.stageId = newStageId;
                if (lead.pipelineStage != null) {
                  originalRow.dataset.pipelineStage = String(lead.pipelineStage);
                }
                if (typeof window.__markRowOnPipelineBoard === 'function') {
                  window.__markRowOnPipelineBoard(originalRow);
                } else {
                  originalRow.dataset.onPipelineBoard = '1';
                }
                const labels = window.PIPELINE_STAGE_LABELS || {};
                const fullName = labels[newStageId] || '';
                const short =
                  fullName.split('(')[0].trim().slice(0, 22) + (fullName.length > 22 ? '…' : '');
                originalRow.dataset.pipelineLabel = short;
                const pipeSel = originalRow.querySelector('.pipeline-inline-select');
                if (pipeSel) pipeSel.value = newStageId;
                const cell = originalRow.querySelector('.pipeline-stage-label');
                if (cell) cell.textContent = short || 'Stage';
                const wrap = originalRow.querySelector('.pipeline-stage-pill-wrap');
                if (wrap) {
                  const dot =
                    (window.PIPELINE_STAGE_COLORS && window.PIPELINE_STAGE_COLORS[newStageId]) ||
                    '#94a3b8';
                  wrap.style.boxShadow = `inset 3px 0 0 ${dot}`;
                }
              }
              updateColumnCounts();
              if (typeof window.showProspectToast === 'function') {
                window.showProspectToast('Stage updated');
              }
            }
          } catch (err) {
            console.error('Failed to update pipeline:', err);
          }
          return;
        }

        const targetColStatus = toCol.dataset.status;
        let newStatus = targetColStatus;
        if (targetColStatus === 'Action Ongoing') newStatus = 'Follow-up';
        if (targetColStatus === 'Finished') newStatus = 'Closed - Won';

        try {
          const res = await fetch(`/leads/${leadKey}/update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus }),
          });
          const data = await res.json();
          if (data.success) {
            const originalRow = document.querySelector(`.result-row[data-lead-key="${leadKey}"]`);
            if (originalRow) {
              originalRow.dataset.status = newStatus;
              const statusBadge = originalRow.querySelector('td:nth-last-child(2) span');
              if (statusBadge) statusBadge.textContent = newStatus;
            }
            updateColumnCounts();
          }
        } catch (err) {
          console.error('Failed to update status:', err);
        }
      },
    });
  }

  function readKanbanColumnStageId(columnEl, index) {
    if (!columnEl) return '';
    const fromAttr = String(columnEl.getAttribute('data-pipeline-stage') || '').trim();
    if (fromAttr) return fromAttr;
    const fromDataset = String(columnEl.dataset.pipelineStage || '').trim();
    if (fromDataset) return fromDataset;
    const fromWindow =
      Array.isArray(window.PIPELINE_STAGES) && window.PIPELINE_STAGES[index]
        ? window.PIPELINE_STAGES[index]
        : null;
    return fromWindow && fromWindow.id ? String(fromWindow.id).trim() : '';
  }

  function readKanbanFocusKeysFromSession() {
    try {
      const params = new URLSearchParams(window.location.search || '');
      if (params.get('boardFocus') !== '1') return null;
      const raw = sessionStorage.getItem('adhello_kanban_focus_keys');
      sessionStorage.removeItem('adhello_kanban_focus_keys');
      const parsed = JSON.parse(raw || '[]');
      return Array.isArray(parsed) ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function rowMatchesKanbanFocusKey(rowKey, focusKey) {
    const key = String(rowKey || '').trim();
    const norm = String(focusKey || '').trim();
    if (!key || !norm) return false;
    return key === norm || key === `lead:${norm}` || norm === key.replace(/^lead:/i, '');
  }

  function filterRowsForKanbanFocus(allRows, focusKeys) {
    if (!Array.isArray(focusKeys) || !focusKeys.length || !Array.isArray(allRows) || !allRows.length) {
      return allRows;
    }
    const filtered = allRows.filter((row) => {
      const key = String(row.dataset.leadKey || '').trim();
      return focusKeys.some((fk) => rowMatchesKanbanFocusKey(key, fk));
    });
    return filtered.length ? filtered : allRows;
  }

  function isRowOnPipelineBoard(row) {
    if (!row) return false;
    const ds = row.dataset || {};
    if (ds.onPipelineBoard === '1' || ds.onPipelineBoard === 'true') return true;
    const key = String(ds.leadKey || '').trim();
    if (key && window.__pipelineBoardKeys && window.__pipelineBoardKeys.has(key)) return true;
    return false;
  }

  function getKanbanRowSources() {
    if (typeof window.__markLeadsOnPipelineBoard !== 'function' && !window.__pipelineBoardKeys) {
      window.__pipelineBoardKeys = new Set();
      document.querySelectorAll('.result-row[data-on-pipeline-board="1"]').forEach((row) => {
        const key = String(row.dataset.leadKey || '').trim();
        if (key) window.__pipelineBoardKeys.add(key);
      });
    }
    const table = document.getElementById('prospectLeadsTable');
    const rows = table
      ? Array.from(
          table.querySelectorAll('tbody tr.result-row:not(.result-row--panel-source)'),
        ).filter(isRowOnPipelineBoard)
      : Array.from(
          document.querySelectorAll(
            '#prospectLeadsTable tbody tr.result-row:not(.result-row--panel-source), .result-row:not(.result-row--panel-source)',
          ),
        ).filter(isRowOnPipelineBoard);
    if (rows.length) return rows;

    const sessionFocus = readKanbanFocusKeysFromSession();
    const focusKeys =
      (Array.isArray(window.__pipelineKanbanFocusKeys) && window.__pipelineKanbanFocusKeys.length
        ? window.__pipelineKanbanFocusKeys
        : null) || sessionFocus;

    if (Array.isArray(focusKeys) && focusKeys.length && Array.isArray(window.INITIAL_SAVED_LEADS)) {
      const keySet = new Set(focusKeys.map((k) => String(k || '').trim()).filter(Boolean));
      const fromBootstrap = window.INITIAL_SAVED_LEADS.filter(
        (lead) => lead && (lead.onPipelineBoard || keySet.has(String(lead.key || '').trim())),
      )
        .map((lead) => leadRecordToKanbanRowShape(lead))
        .filter(Boolean);
      if (fromBootstrap.length) return fromBootstrap;
    }

    if (Array.isArray(window.INITIAL_SAVED_LEADS) && window.INITIAL_SAVED_LEADS.length) {
      return window.INITIAL_SAVED_LEADS.filter((lead) => lead && lead.onPipelineBoard)
        .map((lead) => leadRecordToKanbanRowShape(lead))
        .filter(Boolean);
    }
    return [];
  }

  function leadRecordToKanbanRowShape(lead) {
    if (!lead || !lead.key) return null;
    const key = String(lead.key).trim();
    const existing = document.querySelector(
      `#prospectLeadsTable tbody tr.result-row[data-lead-key="${CSS.escape(key)}"], tr.result-row[data-lead-key="${CSS.escape(key)}"]`,
    );
    if (existing) return existing;

    const row = document.createElement('tr');
    row.className = 'result-row result-row--kanban-bootstrap';
    row.dataset.leadKey = key;
    row.dataset.stageId = lead.stageId ? String(lead.stageId) : '';
    row.dataset.pipelineStage = String(lead.pipelineStage || 1);
    row.dataset.title = lead.title || '';
    row.dataset.rating = String(lead.totalScore || 0);
    row.dataset.website = lead.website || 'N/A';
    row.dataset.category = lead.categoryName || 'N/A';
    row.dataset.status = lead.status || 'Not Contacted';
    if (lead.onPipelineBoard) row.dataset.onPipelineBoard = '1';
    return row;
  }

  function bindPipelineKanbanSortables() {
    document
      .querySelectorAll('#kanbanView[data-kanban-mode="pipeline"] .kanban-column')
      .forEach((columnWrap) => {
        const col = columnWrap.querySelector('.kanban-list');
        if (!col) return;
        bindKanbanSortable(col, columnWrap, true);
      });
  }

  function populateKanbanColumn(col, columnWrap, rows, pipelineMode, bindSortableNow) {
    if (typeof Sortable !== 'undefined' && typeof Sortable.get === 'function') {
      const existing = Sortable.get(col);
      if (existing && typeof existing.destroy === 'function') existing.destroy();
    }
    col.innerHTML = '';
    rows.forEach((row) => {
      col.appendChild(createKanbanCard(row));
    });
    const countBadge = columnWrap.querySelector('.column-count');
    if (countBadge) countBadge.textContent = rows.length;
    if (bindSortableNow !== false && typeof Sortable !== 'undefined') {
      bindKanbanSortable(col, columnWrap, pipelineMode);
    }
  }

  function buildPipelineKanbanBoard() {
    const kanbanRoot = document.querySelector('#kanbanView[data-kanban-mode="pipeline"]');
    if (!kanbanRoot) return false;

    const columnEls = Array.from(kanbanRoot.querySelectorAll('.kanban-column'));
    if (!columnEls.length) return false;

    const stageIds = columnEls.map((el, idx) => readKanbanColumnStageId(el, idx));
    const rowsForBoard = getKanbanRowSources();
    try {
      delete window.__pipelineKanbanFocusKeys;
    } catch (_) {
      window.__pipelineKanbanFocusKeys = null;
    }

    const buckets = columnEls.map(() => []);
    rowsForBoard.forEach((row) => {
      let idx = resolveRowKanbanColumnIndex(row, stageIds);
      if (idx < 0) idx = 0;
      if (idx >= buckets.length) idx = buckets.length - 1;
      buckets[idx].push(row);
    });

    columnEls.forEach((columnWrap, idx) => {
      const col = columnWrap.querySelector('.kanban-list');
      if (!col) return;
      populateKanbanColumn(col, columnWrap, buckets[idx] || [], true, false);
    });
    bindPipelineKanbanSortables();
    return true;
  }

  // View toggle + kanban init hook (pipeline-view-toggle.js handles Table/Pipeline clicks)
  function enhanceKanbanCardsFromApp() {
    document
      .querySelectorAll('#kanbanView[data-kanban-mode="pipeline"] .kanban-card[data-lead-key]')
      .forEach((card) => {
        const leadKey = String(card.dataset.leadKey || '').trim();
        if (!leadKey) return;
        const row = document.querySelector(
          `#prospectLeadsTable tbody tr.result-row[data-lead-key="${CSS.escape(leadKey)}"], tr.result-row[data-lead-key="${CSS.escape(leadKey)}"]`,
        );
        if (!row) return;
        const starHost = card.querySelector('[class*="kanban-stars-"]');
        const oppHost = card.querySelector('[class*="row-opportunity-label-"]');
        if (starHost && typeof renderStarsInElement === 'function') {
          renderStarsInElement(starHost, parseFloat(row.dataset.rating) || 0);
        }
        if (oppHost && typeof renderOpportunityBadges === 'function') {
          oppHost.innerHTML = renderOpportunityBadges(row);
        }
      });
  }
  window.__adhelloEnhanceKanbanCards = enhanceKanbanCardsFromApp;

  function initKanban() {
    const run = () => {
      const pipelineRoot = document.querySelector('#kanbanView[data-kanban-mode="pipeline"]');
      if (pipelineRoot) {
        if (typeof window.__adhelloBuildPipelineKanbanBoard === 'function') {
          window.__adhelloBuildPipelineKanbanBoard();
        } else {
          buildPipelineKanbanBoard();
        }
        enhanceKanbanCardsFromApp();
        return;
      }

      const kanbanViewEl = document.getElementById('kanbanView');
      const pipelineMode =
        kanbanViewEl && kanbanViewEl.dataset && kanbanViewEl.dataset.kanbanMode === 'pipeline';

      if (pipelineMode) {
        buildPipelineKanbanBoard();
        enhanceKanbanCardsFromApp();
        return;
      }

      const allRows = getKanbanRowSources();
      document.querySelectorAll('.kanban-list').forEach((col) => {
        const columnWrap = col.closest('.kanban-column') || col.parentElement;
        if (!columnWrap) return;

        if (typeof Sortable !== 'undefined' && typeof Sortable.get === 'function') {
          const existing = Sortable.get(col);
          if (existing && typeof existing.destroy === 'function') existing.destroy();
        }
        col.innerHTML = '';
        const targetStatus = columnWrap.dataset.status;
        let count = 0;

        allRows.forEach((row) => {
          let shouldInclude = false;
          const leadStatus = row.dataset.status || 'Not Contacted';
          if (targetStatus === 'Not Contacted' && (leadStatus === 'Not Contacted' || leadStatus === 'Needs Video')) {
            shouldInclude = true;
          }
          if (targetStatus === 'Enriched' && leadStatus === 'Enriched') shouldInclude = true;
          if (targetStatus === 'Lead Captured' && leadStatus === 'Lead Captured') shouldInclude = true;
          if (targetStatus === 'Blueprint Purchased' && leadStatus === 'Blueprint Purchased') {
            shouldInclude = true;
          }
          if (
            targetStatus === 'Action Ongoing' &&
            ['Video Recorded', 'Called Lead', 'Email Sent', 'Follow-up'].includes(leadStatus)
          ) {
            shouldInclude = true;
          }
          if (targetStatus === 'Finished' && ['Closed - Won', 'Closed - Lost'].includes(leadStatus)) {
            shouldInclude = true;
          }

          if (shouldInclude) {
            col.appendChild(createKanbanCard(row));
            count += 1;
          }
        });

        const countBadge = columnWrap.querySelector('.column-count');
        if (countBadge) countBadge.textContent = count;
        bindKanbanSortable(col, columnWrap, false);
      });
    };
    run();
    if (typeof Sortable !== 'undefined') {
      bindPipelineKanbanSortables();
      document.querySelectorAll('.kanban-list').forEach((col) => {
        const columnWrap = col.closest('.kanban-column') || col.parentElement;
        if (!columnWrap || columnWrap.closest('#kanbanView[data-kanban-mode="pipeline"]')) return;
        bindKanbanSortable(col, columnWrap, false);
      });
    } else if (typeof window.__ensureSortableJs === 'function') {
      window.__ensureSortableJs()
        .then(() => {
          bindPipelineKanbanSortables();
          document.querySelectorAll('.kanban-list').forEach((col) => {
            const columnWrap = col.closest('.kanban-column') || col.parentElement;
            if (!columnWrap || columnWrap.closest('#kanbanView[data-kanban-mode="pipeline"]')) return;
            bindKanbanSortable(col, columnWrap, false);
          });
        })
        .catch(() => {});
    }
  }

  window.__adhelloInitKanban = initKanban;

  function pipelineKanbanPreferredOnLoad() {
    try {
      const params = new URLSearchParams(window.location.search || '');
      if (params.get('folderKey') && params.get('view') !== 'kanban') return false;
    } catch (_) {
      /* ignore */
    }
    if (document.documentElement.classList.contains('adhello-pipeline-view-kanban')) return true;
    try {
      return sessionStorage.getItem('adhello_pipeline_view') === 'kanban';
    } catch (_) {
      return false;
    }
  }

  function kanbanBoardCardTotal() {
    let total = 0;
    document
      .querySelectorAll('#kanbanView[data-kanban-mode="pipeline"] .kanban-column .column-count')
      .forEach((el) => {
        total += parseInt(String(el.textContent || '0'), 10) || 0;
      });
    return total;
  }

  function refreshPipelineKanbanIfNeeded() {
    if (!isPipelineKanbanVisible()) return;
    if (typeof window.__adhelloInitKanban !== 'function') return;
    window.__adhelloInitKanban();
    const table = document.getElementById('prospectLeadsTable');
    const rowCount = table ? table.querySelectorAll('tbody tr.result-row').length : 0;
    if (rowCount > 0 && kanbanBoardCardTotal() === 0) {
      requestAnimationFrame(() => {
        if (typeof window.__adhelloInitKanban === 'function') window.__adhelloInitKanban();
      });
    }
  }

  function bootPipelineKanbanOnLoad() {
    const kanbanViewEl = document.getElementById('kanbanView');
    if (!kanbanViewEl) return;
    const wantKanban =
      pipelineKanbanPreferredOnLoad() || !kanbanViewEl.classList.contains('hidden');
    if (!wantKanban) return;
    const boot = () => {
      if (typeof window.__adhelloSetPipelineView === 'function') {
        window.__adhelloSetPipelineView('kanban');
      } else {
        kanbanViewEl.classList.remove('hidden');
        const tableViewEl = document.getElementById('tableView');
        if (tableViewEl) tableViewEl.classList.add('hidden');
        initKanban();
      }
      refreshPipelineKanbanIfNeeded();
    };
    requestAnimationFrame(() => requestAnimationFrame(boot));
  }

  function ensurePipelineKanbanPopulatedIfVisible() {
    if (!isPipelineKanbanVisible()) return;
    const table = document.getElementById('prospectLeadsTable');
    const rowCount = table ? table.querySelectorAll('tbody tr.result-row:not(.result-row--panel-source)').length : 0;
    const bootstrapCount = Array.isArray(window.INITIAL_SAVED_LEADS) ? window.INITIAL_SAVED_LEADS.length : 0;
    if (rowCount === 0 && bootstrapCount === 0) return;
    if (kanbanBoardCardTotal() > 0) return;
    initKanban();
  }

  bootPipelineKanbanOnLoad();
  ensurePipelineKanbanPopulatedIfVisible();
  window.refreshPipelineKanbanIfNeeded = refreshPipelineKanbanIfNeeded;
  document.addEventListener('adhello-pipeline-prefs-ready', refreshPipelineKanbanIfNeeded);
  document.addEventListener('adhello-pipeline-view-change', (e) => {
    if (e && e.detail && e.detail.mode === 'kanban') {
      ensurePipelineKanbanPopulatedIfVisible();
    }
  });

  function createKanbanCard(row) {
    if (typeof window.__adhelloBuildKanbanContactHtml === 'function') {
      const card = document.createElement('div');
      card.className =
        'kanban-card kanban-card--lift p-4 bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-brand-border/10 cursor-grab active:cursor-grabbing hover:border-brand-yellow/50 transition-all duration-150 group';
      card.dataset.leadKey = row.dataset.leadKey;

      const title = escapeHtmlText(row.dataset.title || 'Untitled');
      const websiteRaw = String(row.dataset.website || '').trim();
      const category = escapeHtmlText(row.dataset.category || '');

      let websiteHtml = '';
      if (websiteRaw && websiteRaw !== 'N/A' && websiteRaw !== '—') {
        const href = /^https?:\/\//i.test(websiteRaw)
          ? websiteRaw
          : `https://${websiteRaw.replace(/^\/+/, '')}`;
        const label = escapeHtmlText(
          websiteRaw.replace(/^https?:\/\//i, '').split('?')[0].replace(/\/$/, ''),
        );
        websiteHtml = `<a href="${escapeHtmlAttr(href)}" target="_blank" rel="noopener noreferrer" class="text-[10px] text-brand-muted font-bold truncate block mb-2 hover:text-brand-yellow">${label}</a>`;
      }

      card.innerHTML = `
        <div class="flex items-center justify-between mb-3">
            <span class="text-[9px] font-black uppercase tracking-widest text-brand-muted">${category}</span>
            <div class="flex items-center gap-1 kanban-stars-${row.dataset.leadKey}"></div>
        </div>
        <h4 class="text-sm font-black text-brand-dark dark:text-white mb-1 truncate">${title}</h4>
        ${websiteHtml}
        ${window.__adhelloBuildKanbanContactHtml(row, row.dataset.leadKey)}
        <div class="row-opportunity-label-${row.dataset.leadKey}"></div>
    `;

      card.querySelectorAll('.kanban-card-phone').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (typeof window.__adhelloPipelinePhoneClick === 'function') {
            window.__adhelloPipelinePhoneClick(btn, e);
          }
        });
      });
      card.querySelectorAll('a, button').forEach((el) => {
        if (el.classList.contains('kanban-card-phone')) return;
        el.addEventListener('click', (e) => e.stopPropagation());
      });
      card.addEventListener('click', (e) => {
        if (e.target.closest('a, button')) return;
        selectRow(row);
      });

      setTimeout(() => {
        const starContainer = card.querySelector(`.kanban-stars-${row.dataset.leadKey}`);
        const oppContainer = card.querySelector(`.row-opportunity-label-${row.dataset.leadKey}`);
        if (starContainer) renderStarsInElement(starContainer, parseFloat(row.dataset.rating) || 0);
        if (oppContainer) oppContainer.innerHTML = renderOpportunityBadges(row);
      }, 0);

      return card;
    }

    const card = document.createElement('div');
    card.className =
      'kanban-card kanban-card--lift p-4 bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-brand-border/10 cursor-grab active:cursor-grabbing hover:border-brand-yellow/50 transition-all duration-150 group';
    card.dataset.leadKey = row.dataset.leadKey;
    
    const title = row.dataset.title;
    const rating = row.dataset.rating;
    const website = row.dataset.website;
    
    card.innerHTML = `
        <div class="flex items-center justify-between mb-3">
            <span class="text-[9px] font-black uppercase tracking-widest text-brand-muted">${row.dataset.category}</span>
            <div class="flex items-center gap-1 kanban-stars-${row.dataset.leadKey}">
                <!-- Stars rendered via JS -->
            </div>
        </div>
        <h4 class="text-sm font-black text-brand-dark dark:text-white mb-1 truncate">${title}</h4>
        <div class="text-[10px] text-brand-muted font-bold truncate mb-3">${website}</div>
        <div class="row-opportunity-label-${row.dataset.leadKey}">
            <!-- Opportunity Label Rendered via JS -->
        </div>
    `;
    
    // Render stars and labels into the card
    setTimeout(() => {
        const starContainer = card.querySelector(`.kanban-stars-${row.dataset.leadKey}`);
        const oppContainer = card.querySelector(`.row-opportunity-label-${row.dataset.leadKey}`);
        if (starContainer) renderStarsInElement(starContainer, parseFloat(rating) || 0);
        if (oppContainer) oppContainer.innerHTML = renderOpportunityBadges(row);
    }, 0);
    
    card.onclick = () => selectRow(row);
    return card;
  }

  function updateColumnCounts() {
    document.querySelectorAll('.kanban-column').forEach(col => {
        const count = col.querySelectorAll('.kanban-card').length;
        const badge = col.querySelector('.column-count');
        if (badge) badge.textContent = count;
    });
  }

  // --- Cold call war room (cold leads only: business info, script, dial) ---
  const batchOutreachBtn = document.getElementById('batchOutreachBtn');
  const batchOutreachBtnBulk = document.getElementById('batchOutreachBtnBulk');
  const warRoomModal = document.getElementById('warRoomModal');
  const closeWarRoom = document.getElementById('closeWarRoom');
  const warRoomGrid = document.getElementById('warRoomGrid');
  const warRoomTotal = document.getElementById('warRoomTotal');
  const warRoomPrev = document.getElementById('warRoomPrev');
  const warRoomNext = document.getElementById('warRoomNext');
  const warRoomPosition = document.getElementById('warRoomPosition');
  const warRoomTimerDisplay = document.getElementById('warRoomTimerDisplay');
  const warRoomTimerToggle = document.getElementById('warRoomTimerToggle');
  const warRoomTimerReset = document.getElementById('warRoomTimerReset');
  const warRoomAutoDialStart = document.getElementById('warRoomAutoDialStart');
  const warRoomAutoDialPause = document.getElementById('warRoomAutoDialPause');
  const warRoomAutoDialStop = document.getElementById('warRoomAutoDialStop');
  const warRoomAutoDialStatus = document.getElementById('warRoomAutoDialStatus');
  const warRoomDialInterval = document.getElementById('warRoomDialInterval');
  const warRoomSumDialed = document.getElementById('warRoomSumDialed');
  const warRoomSumConnected = document.getElementById('warRoomSumConnected');
  const warRoomSumVm = document.getElementById('warRoomSumVm');
  const warRoomSumNoAnswer = document.getElementById('warRoomSumNoAnswer');
  const warRoomSumGatekeeper = document.getElementById('warRoomSumGatekeeper');
  const warRoomSumWrong = document.getElementById('warRoomSumWrong');
  const warRoomSumCallback = document.getElementById('warRoomSumCallback');
  const warRoomSumFailures = document.getElementById('warRoomSumFailures');
  const warRoomSummaryHint = document.getElementById('warRoomSummaryHint');

  let warRoomRowEls = [];
  let warRoomIndex = 0;

  function isColdLeadRow(row) {
    if (!row) return false;
    const src = String(row.dataset.source || '');
    return !src.startsWith('adhello_');
  }

  function warRoomFormatClock(sec) {
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  }

  let warRoomTimerId = null;
  let warRoomElapsedSec = 0;
  let warRoomTimerRunning = false;
  let warRoomAutoDialTimer = null;
  let warRoomAutoDialRunning = false;
  let warRoomAutoDialPaused = false;
  let warRoomAutoDialCalled = new Set();
  let warRoomCallOptionsCache = null;
  let warRoomSessionStats = {
    dialed: 0,
    connected: 0,
    vmDrops: 0,
    noAnswer: 0,
    gatekeeper: 0,
    wrongNumber: 0,
    callbacks: 0,
    failures: 0,
  };

  function warRoomResetSessionStats() {
    warRoomSessionStats = {
      dialed: 0,
      connected: 0,
      vmDrops: 0,
      noAnswer: 0,
      gatekeeper: 0,
      wrongNumber: 0,
      callbacks: 0,
      failures: 0,
    };
    warRoomRenderSessionStats();
    if (warRoomSummaryHint) warRoomSummaryHint.textContent = 'Running totals for this war room session.';
  }

  function warRoomRenderSessionStats() {
    if (warRoomSumDialed) warRoomSumDialed.textContent = String(warRoomSessionStats.dialed || 0);
    if (warRoomSumConnected) warRoomSumConnected.textContent = String(warRoomSessionStats.connected || 0);
    if (warRoomSumVm) warRoomSumVm.textContent = String(warRoomSessionStats.vmDrops || 0);
    if (warRoomSumNoAnswer) warRoomSumNoAnswer.textContent = String(warRoomSessionStats.noAnswer || 0);
    if (warRoomSumGatekeeper) warRoomSumGatekeeper.textContent = String(warRoomSessionStats.gatekeeper || 0);
    if (warRoomSumWrong) warRoomSumWrong.textContent = String(warRoomSessionStats.wrongNumber || 0);
    if (warRoomSumCallback) warRoomSumCallback.textContent = String(warRoomSessionStats.callbacks || 0);
    if (warRoomSumFailures) warRoomSumFailures.textContent = String(warRoomSessionStats.failures || 0);
  }

  function warRoomFinalizeSummary(label) {
    if (!warRoomSummaryHint) return;
    const handled =
      (warRoomSessionStats.connected || 0) +
      (warRoomSessionStats.vmDrops || 0) +
      (warRoomSessionStats.noAnswer || 0) +
      (warRoomSessionStats.gatekeeper || 0) +
      (warRoomSessionStats.wrongNumber || 0) +
      (warRoomSessionStats.callbacks || 0);
    warRoomSummaryHint.textContent = `${label || 'Session'}: ${handled} outcomes logged, ${warRoomSessionStats.failures || 0} failures, ${warRoomSessionStats.dialed || 0} dial attempts.`;
  }

  function warRoomSetAutoDialStatus(msg, tone) {
    if (!warRoomAutoDialStatus) return;
    warRoomAutoDialStatus.textContent = msg;
    warRoomAutoDialStatus.className =
      'text-[10px] leading-tight ' +
      (tone === 'ok'
        ? 'text-emerald-300'
        : tone === 'warn'
          ? 'text-amber-300'
          : tone === 'err'
            ? 'text-rose-300'
            : 'text-slate-400');
  }

  async function warRoomEnsureCallOptions() {
    if (warRoomCallOptionsCache) return warRoomCallOptionsCache;
    try {
      const res = await fetch('/leads/telephony/call-options', {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error('call options unavailable');
      warRoomCallOptionsCache = {
        options: Array.isArray(data.options) ? data.options : [],
        activeFromNumber: String(data.activeFromNumber || '').trim(),
      };
      return warRoomCallOptionsCache;
    } catch (_) {
      warRoomCallOptionsCache = { options: [], activeFromNumber: '' };
      return warRoomCallOptionsCache;
    }
  }

  function warRoomAreaCode(raw) {
    const digits = String(raw || '').replace(/\D/g, '');
    if (digits.length < 10) return '';
    return digits.slice(-10, -7);
  }

  function warRoomBestRetryIso(row, mode) {
    const now = new Date();
    const dt = new Date(now.getTime());
    if (mode === 'callback') {
      dt.setHours(dt.getHours() + 2);
      dt.setMinutes(0, 0, 0);
      return dt.toISOString();
    }
    dt.setDate(dt.getDate() + 1);
    const category = String((row && row.dataset && row.dataset.category) || '').toLowerCase();
    const hour = category.includes('restaurant') ? 14 : category.includes('medical') ? 11 : 10;
    dt.setHours(hour, 0, 0, 0);
    return dt.toISOString();
  }

  async function warRoomSuggestedFromNumber(row) {
    const opt = await warRoomEnsureCallOptions();
    const list = Array.isArray(opt.options) ? opt.options : [];
    if (!list.length) return '';
    const leadArea = warRoomAreaCode(row && row.dataset ? row.dataset.phone : '');
    if (leadArea) {
      const matched = list.find((n) => warRoomAreaCode(n) === leadArea);
      if (matched) return matched;
    }
    return String(opt.activeFromNumber || list[0] || '').trim();
  }

  async function warRoomAppendLeadNote(leadKey, content) {
    const text = String(content || '').trim();
    if (!text) return;
    await fetch('/leads/' + encodeURIComponent(leadKey) + '/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ content: text }),
    }).catch(() => {});
  }

  async function warRoomPatchLead(leadKey, patch) {
    const res = await fetch('/leads/' + encodeURIComponent(leadKey) + '/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(patch || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error((data && data.error) || 'Update failed');
    return data;
  }

  async function warRoomApplyDisposition(row, code) {
    if (!row || !row.dataset || !row.dataset.leadKey) return;
    const key = String(row.dataset.leadKey || '').trim();
    const company = row.dataset.title || 'Lead';
    const res = await fetch('/leads/' + encodeURIComponent(key) + '/disposition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ code }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error((data && data.error) || 'Disposition failed');
    const status = String(data.status || (data.lead && data.lead.status) || 'Updated');
    if (data && data.lead && data.lead.status) row.dataset.status = String(data.lead.status);
    if (data && data.lead && data.lead.updates) row.dataset.updates = JSON.stringify(data.lead.updates);
    if (code === 'connected') warRoomSessionStats.connected += 1;
    if (code === 'no_answer') warRoomSessionStats.noAnswer += 1;
    if (code === 'gatekeeper') warRoomSessionStats.gatekeeper += 1;
    if (code === 'wrong_number') warRoomSessionStats.wrongNumber += 1;
    if (code === 'callback') warRoomSessionStats.callbacks += 1;
    warRoomRenderSessionStats();
    warRoomAutoDialCalled.add(key);
    const suffix = data.automation ? ` ${data.automation}` : '';
    warRoomSetAutoDialStatus(`${status} logged for ${company}.${suffix}`, code === 'wrong_number' ? 'warn' : 'ok');
    if (warRoomAutoDialCalled.size >= warRoomRowEls.length) {
      warRoomStopAutoDial('Auto dial completed all selected leads.');
    } else {
      warRoomGoNext();
    }
  }

  function warRoomStopAutoDial(reason) {
    if (warRoomAutoDialTimer) {
      clearInterval(warRoomAutoDialTimer);
      warRoomAutoDialTimer = null;
    }
    warRoomAutoDialRunning = false;
    warRoomAutoDialPaused = false;
    if (reason) warRoomSetAutoDialStatus(reason, 'warn');
    if (reason) warRoomFinalizeSummary('Auto dial stopped');
    if (warRoomAutoDialStart) warRoomAutoDialStart.disabled = false;
    if (warRoomAutoDialPause) warRoomAutoDialPause.textContent = 'Pause';
  }

  async function warRoomDialCurrentLead() {
    const row = warRoomRowEls[warRoomIndex];
    if (!row) return;
    const key = row.dataset.leadKey;
    if (!key) {
      warRoomGoNext();
      return;
    }
    const phones = splitPhoneNumbers(row.dataset.phone);
    if (!phones.length) {
      warRoomAutoDialCalled.add(key);
      warRoomSessionStats.failures += 1;
      warRoomRenderSessionStats();
      warRoomSetAutoDialStatus(`Skipped ${row.dataset.title || 'lead'} (no phone).`, 'warn');
      warRoomGoNext();
      return;
    }
    try {
      const fromNumber = await warRoomSuggestedFromNumber(row);
      const data = await requestLeadCallByKey(key, phones[0], fromNumber ? { fromNumber } : {});
      warRoomAutoDialCalled.add(key);
      warRoomSessionStats.dialed += 1;
      warRoomRenderSessionStats();
      warRoomSetAutoDialStatus(
        `Dialed ${row.dataset.title || 'lead'}${fromNumber ? ` from ${fromNumber}` : ''} (${warRoomAutoDialCalled.size}/${warRoomRowEls.length}).`,
        'ok'
      );
      if (data.lead && data.lead.updates) {
        row.dataset.updates = JSON.stringify(data.lead.updates);
      }
      if (data.lead && data.lead.status) {
        row.dataset.status = String(data.lead.status);
      }
      warRoomGoNext();
      if (warRoomAutoDialCalled.size >= warRoomRowEls.length) {
        warRoomStopAutoDial('Auto dial completed all selected leads.');
      }
    } catch (err) {
      warRoomSessionStats.failures += 1;
      warRoomRenderSessionStats();
      warRoomSetAutoDialStatus(`Dial failed: ${err.message || 'unknown error'}`, 'err');
      warRoomGoNext();
    }
  }

  function warRoomStartAutoDial() {
    if (!warRoomRowEls.length) {
      warRoomSetAutoDialStatus('No leads selected for auto dial.', 'warn');
      return;
    }
    const sec = Math.max(5, Math.min(120, parseInt((warRoomDialInterval && warRoomDialInterval.value) || '12', 10) || 12));
    if (warRoomDialInterval) warRoomDialInterval.value = String(sec);
    warRoomStopAutoDial();
    warRoomAutoDialCalled = new Set();
    warRoomAutoDialRunning = true;
    warRoomAutoDialPaused = false;
    if (warRoomAutoDialStart) warRoomAutoDialStart.disabled = true;
    if (warRoomAutoDialPause) warRoomAutoDialPause.textContent = 'Pause';
    warRoomSetAutoDialStatus(`Auto dial running every ${sec}s...`, 'ok');
    warRoomDialCurrentLead();
    warRoomAutoDialTimer = setInterval(() => {
      if (!warRoomAutoDialRunning || warRoomAutoDialPaused) return;
      if (warRoomAutoDialCalled.size >= warRoomRowEls.length) {
        warRoomStopAutoDial('Auto dial completed all selected leads.');
        return;
      }
      warRoomDialCurrentLead();
    }, sec * 1000);
  }

  function warRoomToggleAutoDialPause() {
    if (!warRoomAutoDialRunning) {
      warRoomSetAutoDialStatus('Start auto dial first.', 'warn');
      return;
    }
    warRoomAutoDialPaused = !warRoomAutoDialPaused;
    if (warRoomAutoDialPause) warRoomAutoDialPause.textContent = warRoomAutoDialPaused ? 'Resume' : 'Pause';
    warRoomSetAutoDialStatus(
      warRoomAutoDialPaused
        ? `Auto dial paused (${warRoomAutoDialCalled.size}/${warRoomRowEls.length}).`
        : `Auto dial resumed (${warRoomAutoDialCalled.size}/${warRoomRowEls.length}).`,
      'warn'
    );
  }

  function warRoomUpdateTimerDisplay() {
    if (warRoomTimerDisplay) warRoomTimerDisplay.textContent = warRoomFormatClock(warRoomElapsedSec);
    if (warRoomTimerToggle) {
      warRoomTimerToggle.textContent = warRoomTimerRunning ? 'Pause' : 'Resume';
      warRoomTimerToggle.setAttribute('aria-pressed', warRoomTimerRunning ? 'true' : 'false');
    }
  }

  function warRoomStopTimerInterval() {
    if (warRoomTimerId) {
      clearInterval(warRoomTimerId);
      warRoomTimerId = null;
    }
  }

  function warRoomStartSessionTimer() {
    warRoomStopTimerInterval();
    warRoomElapsedSec = 0;
    warRoomTimerRunning = true;
    warRoomUpdateTimerDisplay();
    warRoomTimerId = setInterval(() => {
      if (!warRoomTimerRunning) return;
      warRoomElapsedSec += 1;
      warRoomUpdateTimerDisplay();
    }, 1000);
  }

  function warRoomPauseResumeTimer() {
    warRoomTimerRunning = !warRoomTimerRunning;
    warRoomUpdateTimerDisplay();
  }

  function warRoomResetTimer() {
    warRoomElapsedSec = 0;
    warRoomTimerRunning = true;
    warRoomStopTimerInterval();
    warRoomUpdateTimerDisplay();
    warRoomTimerId = setInterval(() => {
      if (!warRoomTimerRunning) return;
      warRoomElapsedSec += 1;
      warRoomUpdateTimerDisplay();
    }, 1000);
  }

  function closeWarRoomModal() {
    const modal = document.getElementById('warRoomModal');
    const grid = document.getElementById('warRoomGrid');
    if (!modal) return;
    warRoomFlushCurrentScriptDraft();
    warRoomStopTimerInterval();
    warRoomTimerRunning = false;
    warRoomElapsedSec = 0;
    if (warRoomTimerDisplay) warRoomTimerDisplay.textContent = '00:00';
    if (warRoomTimerToggle) warRoomTimerToggle.textContent = 'Pause';
    warRoomRowEls = [];
    warRoomIndex = 0;
    warRoomFinalizeSummary('Session closed');
    warRoomStopAutoDial();
    if (grid) grid.innerHTML = '';
    if (warRoomPosition) warRoomPosition.textContent = '—';
    warRoomUpdateFooterDial({ dataset: { phone: '' } });
    modal.classList.add('hidden');
    modal.style.removeProperty('z-index');
    modal.style.removeProperty('pointer-events');
    modal.style.removeProperty('visibility');
    document.body.style.overflow = '';
  }

  function warRoomKeyboardConsumesNav(ev) {
    const t = ev && ev.target;
    if (!t) return false;
    if (t.isContentEditable) return true;
    const tag = (t.tagName || '').toUpperCase();
    if (tag === 'TEXTAREA') return true;
    if (tag === 'INPUT') {
      const ty = (t.type || '').toLowerCase();
      if (ty === 'checkbox' || ty === 'radio' || ty === 'button' || ty === 'submit' || ty === 'reset') return false;
      return true;
    }
    return false;
  }

  function warRoomClampIndex(i) {
    const n = warRoomRowEls.length;
    if (n === 0) return 0;
    return ((i % n) + n) % n;
  }

  function warRoomGoDelta(delta) {
    if (!warRoomRowEls.length) return;
    if (warRoomRowEls.length <= 1) return;
    warRoomIndex = warRoomClampIndex(warRoomIndex + delta);
    warRoomRenderCurrent();
  }

  function warRoomGoNext() {
    warRoomGoDelta(1);
  }

  function warRoomGoPrev() {
    warRoomGoDelta(-1);
  }

  const warRoomScriptDrafts = Object.create(null);

  function warRoomDraftKey(leadKey, tab) {
    return String(leadKey || '') + '|' + String(tab || 'opener');
  }

  function warRoomFlushCurrentScriptDraft() {
    if (!warRoomGrid) return;
    const card = warRoomGrid.querySelector('[data-war-room-card]');
    if (!card) return;
    const ta = card.querySelector('.war-room-script-input');
    const lk = card.dataset.leadKey;
    const tab = card.dataset.scriptTab || 'opener';
    if (ta && lk) warRoomScriptDrafts[warRoomDraftKey(lk, tab)] = ta.value;
  }

  function warRoomFillSender(text) {
    const helper = typeof window !== 'undefined' ? window.AdHelloScripts : null;
    if (helper && helper.replaceSenderPlaceholders) {
      return helper.replaceSenderPlaceholders(text, helper.getScriptProfile ? helper.getScriptProfile() : window.__ADHELLO_SCRIPT_PROFILE__);
    }
    return text;
  }

  function warRoomBuildScripts(title, city, category, gapPhrase, compPhrase, gaps) {
    const cat = category && category !== 'N/A' ? category : 'businesses';
    const place = city || 'the area';
    const opener = warRoomFillSender(`Hi, this is [your name]—I'm reaching out to local ${cat} in ${place}. I came across ${title} and had you on my list to call.\n\n${gapPhrase}${compPhrase}\n\nI'm not looking to waste your time—do you have sixty seconds for one concrete idea? If now's bad, what time works for a two-minute call later today?`);
    const gapHint = gaps.length ? gaps[0] : 'a couple of ways to sharpen your online presence';
    const short = warRoomFillSender(`Hi, this is [your name]—quick call for ${title} in ${place}. I noticed ${gapHint} and have one specific suggestion—got thirty seconds?\n\nIf this is a bad time, when should I try you back?`);
    const voicemail = warRoomFillSender(`Hi, this is [your name] from [company]. I'm calling ${title} with a brief idea on how you're showing up online versus other ${cat} in ${place}. Worth two minutes when you have a moment—my number is [your number]. Thanks, and I'll try you again if I don't hear back.`);
    return { opener, short, voicemail };
  }

  function warRoomParseNoteHistory(row) {
    try {
      const raw = row.dataset.updates;
      if (!raw) return [];
      const u = JSON.parse(raw);
      if (!Array.isArray(u)) return [];
      return u.filter((x) => x && x.type === 'note' && x.value);
    } catch (_) {
      return [];
    }
  }

  function warRoomUpdateFooterDial(row) {
    const a = document.getElementById('warRoomPrimaryDial');
    const label = document.getElementById('warRoomPrimaryDialLabel');
    const alt = document.getElementById('warRoomAltPhones');
    if (!a || !label) return;
    const phones = splitPhoneNumbers(row.dataset.phone);
    if (!phones.length) {
      a.removeAttribute('href');
      a.href = '#';
      a.classList.add('pointer-events-none', 'opacity-60', 'grayscale');
      a.classList.remove('hover:bg-emerald-400');
      label.textContent = 'No phone on file — add in pipeline';
      if (alt) {
        alt.classList.add('hidden');
        alt.textContent = '';
      }
      return;
    }
    a.classList.remove('pointer-events-none', 'opacity-60', 'grayscale');
    a.href = '#';
    a.dataset.leadKey = String(row.dataset.leadKey || '').trim();
    a.dataset.phone = String(phones[0] || '').trim();
    label.textContent = phones[0];
    if (alt) {
      if (phones.length > 1) {
        alt.classList.remove('hidden');
        alt.textContent = 'Also: ' + phones.slice(1).join(' · ');
      } else {
        alt.classList.add('hidden');
        alt.textContent = '';
      }
    }
  }

  function warRoomFetchAiOpener(leadKey, card, scriptDefaults) {
    const ta = card.querySelector('.war-room-script-input');
    const statusEl = card.querySelector('.war-room-ai-opener-status');
    if (!ta || !leadKey) return;
    const placeholderBackup = ta.placeholder;
    ta.placeholder = 'Generating AI opener from audit insights…';
    if (statusEl) statusEl.textContent = 'Drafting opener with AI…';

    fetch('/leads/' + encodeURIComponent(leadKey) + '/insights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({}),
    })
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (!card.isConnected || card.dataset.leadKey !== leadKey) return;
        if (!data || !data.success) return;
        const raw = typeof data.warRoomOpener === 'string' ? data.warRoomOpener.trim() : '';
        if (!raw) return;
        if (card.dataset.openerUserEdited === '1') return;
        scriptDefaults.opener = raw;
        warRoomScriptDrafts[warRoomDraftKey(leadKey, 'opener')] = raw;
        if ((card.dataset.scriptTab || 'opener') === 'opener') ta.value = raw;
      })
      .catch(() => {})
      .finally(() => {
        if (!ta.isConnected) return;
        ta.placeholder = placeholderBackup;
        if (statusEl && card.isConnected) statusEl.textContent = '';
      });
  }

  function warRoomBindCard(card, row, scriptDefaults) {
    const leadKey = row.dataset.leadKey;
    if (!leadKey) return;

    const ta = card.querySelector('.war-room-script-input');
    const tabBtns = card.querySelectorAll('[data-war-script-tab]');
    card.dataset.openerUserEdited = '';

    function flushDraft() {
      if (!ta) return;
      const cur = card.dataset.scriptTab || 'opener';
      warRoomScriptDrafts[warRoomDraftKey(leadKey, cur)] = ta.value;
    }

    function applyTab(tab) {
      flushDraft();
      card.dataset.scriptTab = tab;
      tabBtns.forEach((b) => {
        const on = b.getAttribute('data-war-script-tab') === tab;
        b.classList.toggle('bg-amber-400', on);
        b.classList.toggle('text-slate-900', on);
        b.classList.toggle('border-amber-500', on);
        b.classList.toggle('shadow-md', on);
        b.classList.toggle('bg-slate-100', !on);
        b.classList.toggle('dark:bg-slate-700', !on);
        b.classList.toggle('text-slate-700', !on);
        b.classList.toggle('dark:text-slate-200', !on);
        b.classList.toggle('border-slate-200', !on);
        b.classList.toggle('dark:border-slate-600', !on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      const draft = warRoomScriptDrafts[warRoomDraftKey(leadKey, tab)];
      ta.value = draft != null ? draft : scriptDefaults[tab] || '';
    }

    tabBtns.forEach((btn) => {
      btn.addEventListener('click', () => applyTab(btn.getAttribute('data-war-script-tab')));
    });
    card.dataset.scriptTab = 'opener';
    applyTab('opener');

    if (ta) {
      ta.addEventListener('input', () => {
        if ((card.dataset.scriptTab || 'opener') === 'opener') card.dataset.openerUserEdited = '1';
      });
    }
    warRoomFetchAiOpener(leadKey, card, scriptDefaults);

    const saveBtn = card.querySelector('.war-room-save-note');
    const vmNextBtn = card.querySelector('.war-room-vm-next');
    const dispBtns = card.querySelectorAll('.war-room-disp-btn');
    const noteTa = card.querySelector('.war-room-notes-input');
    const statusEl = card.querySelector('.war-room-note-status');
    if (vmNextBtn) {
      vmNextBtn.addEventListener('click', async () => {
        vmNextBtn.disabled = true;
        const original = vmNextBtn.textContent;
        vmNextBtn.textContent = 'Dropping...';
        try {
          const fromNumber = await warRoomSuggestedFromNumber(row);
          const data = await requestLeadVoicemailByKey(leadKey, fromNumber ? { fromNumber } : {});
          if (data.lead && data.lead.updates) row.dataset.updates = JSON.stringify(data.lead.updates);
          if (data.lead && data.lead.status) row.dataset.status = String(data.lead.status);
          warRoomAutoDialCalled.add(leadKey);
          warRoomSessionStats.vmDrops += 1;
          warRoomRenderSessionStats();
          warRoomSetAutoDialStatus(
            `Voicemail dropped for ${row.dataset.title || 'lead'}${fromNumber ? ` from ${fromNumber}` : ''}; moving next.`,
            'ok'
          );
          if (warRoomAutoDialCalled.size >= warRoomRowEls.length) {
            warRoomStopAutoDial('Auto dial completed all selected leads.');
          } else {
            warRoomGoNext();
          }
        } catch (err) {
          warRoomSessionStats.failures += 1;
          warRoomRenderSessionStats();
          warRoomSetAutoDialStatus(`Voicemail drop failed: ${err.message || 'unknown error'}`, 'err');
        } finally {
          vmNextBtn.disabled = false;
          vmNextBtn.textContent = original;
        }
      });
    }
    if (saveBtn && noteTa && statusEl) {
      saveBtn.addEventListener('click', async () => {
        const content = (noteTa.value || '').trim();
        if (!content) {
          statusEl.textContent = 'Write a note first';
          statusEl.classList.remove('text-emerald-600', 'dark:text-emerald-400');
          statusEl.classList.add('text-amber-700', 'dark:text-amber-300');
          return;
        }
        saveBtn.disabled = true;
        statusEl.textContent = 'Saving…';
        try {
          const res = await fetch('/leads/' + encodeURIComponent(leadKey) + '/notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ content }),
          });
          let data = {};
          try {
            data = await res.json();
          } catch (_) {
            data = {};
          }
          if (res.ok && data.success) {
            statusEl.textContent = 'Saved to lead timeline';
            statusEl.classList.add('text-emerald-600', 'dark:text-emerald-400');
            statusEl.classList.remove('text-amber-700', 'dark:text-amber-300');
            noteTa.value = '';
            try {
              const updates = Array.isArray(data.updates) ? data.updates : [];
              row.dataset.updates = JSON.stringify(updates);
              const hist = card.querySelector('.war-room-notes-history');
              if (hist) {
                const notes = updates.filter((x) => x && x.type === 'note' && x.value);
                const last = notes.slice(-2);
                hist.classList.remove('hidden');
                hist.innerHTML = last.length
                  ? '<span class="text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider text-[9px]">Recent notes</span><ul class="mt-1 space-y-1 list-disc pl-4">' +
                    last.map((n) => '<li class="text-xs text-slate-600 dark:text-slate-300">' + escapeHtmlText(String(n.value).slice(0, 220)) + (String(n.value).length > 220 ? '…' : '') + '</li>').join('') +
                    '</ul>'
                  : '';
              }
            } catch (_) {
              /* ignore */
            }
          } else {
            statusEl.textContent = (data && data.error) || 'Could not save note';
            statusEl.classList.remove('text-emerald-600', 'dark:text-emerald-400');
            statusEl.classList.add('text-rose-600', 'dark:text-rose-400');
          }
        } catch (_) {
          statusEl.textContent = 'Network error';
          statusEl.classList.add('text-rose-600');
        }
        saveBtn.disabled = false;
      });
    }
    if (dispBtns && dispBtns.length) {
      dispBtns.forEach((btn) => {
        btn.addEventListener('click', async () => {
          const code = String(btn.getAttribute('data-disp') || '').trim();
          if (!code) return;
          btn.disabled = true;
          const original = btn.textContent;
          btn.textContent = 'Saving...';
          try {
            await warRoomApplyDisposition(row, code);
          } catch (err) {
            warRoomSetAutoDialStatus(`Disposition failed: ${err.message || 'unknown error'}`, 'err');
          } finally {
            btn.disabled = false;
            btn.textContent = original;
          }
        });
      });
    }
  }

  function warRoomRenderCurrent() {
    if (!warRoomGrid) return;
    warRoomFlushCurrentScriptDraft();
    warRoomGrid.innerHTML = '';
    const row = warRoomRowEls[warRoomIndex];
    if (!row) return;
    const { card, scriptDefaults } = createWarRoomCard(row);
    warRoomGrid.appendChild(card);
    warRoomBindCard(card, row, scriptDefaults);
    warRoomUpdateFooterDial(row);
    const n = warRoomRowEls.length;
    if (warRoomPosition) warRoomPosition.textContent = n ? `${warRoomIndex + 1} / ${n}` : '—';
    const multi = n > 1;
    if (warRoomPrev) {
      warRoomPrev.disabled = !multi;
      warRoomPrev.setAttribute('aria-disabled', multi ? 'false' : 'true');
    }
    if (warRoomNext) {
      warRoomNext.disabled = !multi;
      warRoomNext.setAttribute('aria-disabled', multi ? 'false' : 'true');
    }
  }

  function warRoomOnGlobalKeydown(e) {
    if (!warRoomModal || warRoomModal.classList.contains('hidden')) return;
    if (!warRoomRowEls.length) return;
    if (warRoomKeyboardConsumesNav(e)) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      warRoomGoPrev();
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      warRoomGoNext();
      return;
    }
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      if (warRoomRowEls.length > 1) warRoomGoNext();
    }
    const row = warRoomRowEls[warRoomIndex];
    if (!row) return;
    if (e.key === '1') {
      e.preventDefault();
      warRoomApplyDisposition(row, 'connected').catch(() => {});
      return;
    }
    if (e.key === '2') {
      e.preventDefault();
      const key = String(row.dataset.leadKey || '').trim();
      if (!key) return;
      const fromPromise = warRoomSuggestedFromNumber(row);
      fromPromise
        .then((fromNumber) => requestLeadVoicemailByKey(key, fromNumber ? { fromNumber } : {}))
        .then((data) => {
          if (data.lead && data.lead.updates) row.dataset.updates = JSON.stringify(data.lead.updates);
          if (data.lead && data.lead.status) row.dataset.status = String(data.lead.status);
          warRoomAutoDialCalled.add(key);
          warRoomSessionStats.vmDrops += 1;
          warRoomRenderSessionStats();
          warRoomSetAutoDialStatus(`Voicemail dropped for ${row.dataset.title || 'lead'}; moving next.`, 'ok');
          if (warRoomAutoDialCalled.size >= warRoomRowEls.length) warRoomStopAutoDial('Auto dial completed all selected leads.');
          else warRoomGoNext();
        })
        .catch((err) => {
          warRoomSessionStats.failures += 1;
          warRoomRenderSessionStats();
          warRoomSetAutoDialStatus(`Voicemail drop failed: ${err.message || 'unknown error'}`, 'err');
        });
      return;
    }
    if (e.key === '3') {
      e.preventDefault();
      warRoomApplyDisposition(row, 'no_answer').catch(() => {});
      return;
    }
    if (e.key === '4') {
      e.preventDefault();
      warRoomApplyDisposition(row, 'gatekeeper').catch(() => {});
      return;
    }
    if (e.key === '5') {
      e.preventDefault();
      warRoomApplyDisposition(row, 'wrong_number').catch(() => {});
      return;
    }
    if (e.key === '6') {
      e.preventDefault();
      warRoomApplyDisposition(row, 'callback').catch(() => {});
    }
  }

  function splitPhoneNumbers(raw) {
    if (raw == null || raw === '' || raw === 'N/A') return [];
    return String(raw)
      .split(/[,;/|]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s !== 'N/A');
  }

  function telHref(num) {
    const digits = String(num).replace(/[^\d+]/g, '');
    return digits ? `tel:${digits}` : '#';
  }

  function openWarRoomFromSelection() {
    const modal = document.getElementById('warRoomModal');
    const grid = document.getElementById('warRoomGrid');
    if (!modal || !grid) {
      const msg = 'Call room is not available on this page.';
      if (typeof window.showProspectToast === 'function') window.showProspectToast(msg);
      else window.alert(msg);
      return;
    }

    const selectedRows = getSelectedLeadRowsForBulk();

    if (selectedRows.length === 0) {
      const msg = 'Select at least one lead to open the cold call war room.';
      if (typeof window.showProspectToast === 'function') window.showProspectToast(msg);
      else window.alert(msg);
      return;
    }

    const coldOnly = selectedRows.filter((row) => isColdLeadRow(row));
    if (coldOnly.length === 0) {
      const msg =
        'Call room only includes cold leads. Warm inbound (AdHello) leads are excluded—deselect them or filter to Cold, then try again.';
      if (typeof window.showProspectToast === 'function') window.showProspectToast(msg);
      else window.alert(msg);
      return;
    }
    if (coldOnly.length < selectedRows.length) {
      const skipped = selectedRows.length - coldOnly.length;
      const msg = `Skipped ${skipped} warm lead${skipped === 1 ? '' : 's'}. Opening call room with ${coldOnly.length} cold lead${coldOnly.length === 1 ? '' : 's'}.`;
      if (typeof window.showProspectToast === 'function') window.showProspectToast(msg);
      else window.alert(msg);
    }

    if (typeof dismissLeadDetailPanel === 'function') dismissLeadDetailPanel();

    renderWarRoomFromRows(coldOnly);
    modal.classList.remove('hidden');
    modal.style.setProperty('z-index', '500', 'important');
    modal.style.setProperty('pointer-events', 'auto', 'important');
    modal.style.setProperty('visibility', 'visible', 'important');
    document.body.style.overflow = 'hidden';
    warRoomStartSessionTimer();
    requestAnimationFrame(() => {
      grid.focus();
    });
  }

  if (warRoomModal) {
    if (closeWarRoom) closeWarRoom.addEventListener('click', closeWarRoomModal);
    if (warRoomTimerToggle) warRoomTimerToggle.addEventListener('click', warRoomPauseResumeTimer);
    if (warRoomTimerReset) warRoomTimerReset.addEventListener('click', warRoomResetTimer);
    if (warRoomPrev) warRoomPrev.addEventListener('click', () => warRoomGoPrev());
    if (warRoomNext) warRoomNext.addEventListener('click', () => warRoomGoNext());
    if (warRoomAutoDialStart) warRoomAutoDialStart.addEventListener('click', warRoomStartAutoDial);
    if (warRoomAutoDialPause) warRoomAutoDialPause.addEventListener('click', warRoomToggleAutoDialPause);
    if (warRoomAutoDialStop) warRoomAutoDialStop.addEventListener('click', () => warRoomStopAutoDial('Auto dial stopped.'));
    const warRoomPrimaryDial = document.getElementById('warRoomPrimaryDial');
    if (warRoomPrimaryDial) {
      warRoomPrimaryDial.addEventListener('click', async (e) => {
        e.preventDefault();
        if (warRoomPrimaryDial.classList.contains('pointer-events-none')) return;
        const row = warRoomRowEls[warRoomIndex];
        if (!row) return;
        const key = String(row.dataset.leadKey || '').trim();
        const phone = splitPhoneNumbers(row.dataset.phone)[0] || '';
        if (!key) return;
        warRoomPrimaryDial.classList.add('pointer-events-none', 'opacity-70');
        try {
          const fromNumber = await warRoomSuggestedFromNumber(row);
          const data = await requestLeadCallByKey(key, phone, fromNumber ? { fromNumber } : {});
          if (data.lead && data.lead.updates) row.dataset.updates = JSON.stringify(data.lead.updates);
          if (data.lead && data.lead.status) row.dataset.status = String(data.lead.status);
          warRoomSessionStats.dialed += 1;
          warRoomRenderSessionStats();
          warRoomSetAutoDialStatus(`Call started for current lead${fromNumber ? ` from ${fromNumber}` : ''}.`, 'ok');
        } catch (err) {
          warRoomSessionStats.failures += 1;
          warRoomRenderSessionStats();
          warRoomSetAutoDialStatus(`Dial failed: ${err.message || 'unknown error'}`, 'err');
        } finally {
          warRoomPrimaryDial.classList.remove('pointer-events-none', 'opacity-70');
        }
      });
    }
    document.addEventListener('keydown', warRoomOnGlobalKeydown, true);
  }

  function renderWarRoomFromRows(rows) {
    warRoomRowEls = (rows || []).filter((row) => row && isColdLeadRow(row));
    if (warRoomTotal) warRoomTotal.textContent = String(warRoomRowEls.length);
    warRoomIndex = 0;
    warRoomAutoDialCalled = new Set();
    warRoomResetSessionStats();
    warRoomSetAutoDialStatus('Auto dialer idle.', null);
    if (warRoomAutoDialStart) warRoomAutoDialStart.disabled = false;
    if (warRoomAutoDialPause) warRoomAutoDialPause.textContent = 'Pause';
    warRoomRenderCurrent();
  }

  function renderWarRoom(selectedCheckboxes) {
    const rows = (selectedCheckboxes || [])
      .map((cb) => cb.closest('.result-row') || cb.closest('tr'))
      .filter(Boolean);
    renderWarRoomFromRows(rows);
  }

  function createWarRoomCard(row) {
    const card = document.createElement('div');
    card.className =
      'max-w-4xl mx-auto w-full rounded-2xl border-2 border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xl p-5 md:p-6 flex flex-col gap-4';
    card.setAttribute('data-war-room-card', '1');
    card.dataset.leadKey = row.dataset.leadKey || '';

    const title = row.dataset.title || 'Company';
    const city = row.dataset.city || '';
    const category = row.dataset.category || '';
    const address = row.dataset.address || '';
    const website = row.dataset.website || '';
    const pipelineLabel = row.dataset.pipelineLabel || '';
    const email = row.dataset.email || '';
    const competitor = row.dataset.competitorName;
    const compGap = row.dataset.competitorGap;
    const rating = row.dataset.rating || 0;
    const reviews = row.dataset.reviews || '0';

    const gaps = [];
    if (!website || website === 'N/A') gaps.push('no website on file');
    if (row.dataset.isMobileFriendly === 'false') gaps.push("site isn't mobile-friendly");
    if (row.dataset.hasChatbot === 'false') gaps.push('no obvious lead-capture chat');
    if (row.dataset.hasSchemaMarkup === 'false') gaps.push('thin local SEO schema');
    if (row.dataset.hasClickToCall === 'false') gaps.push('click-to-call could be stronger');
    if (row.dataset.isOutdated === 'true') gaps.push('site looks dated vs competitors');

    const gapPhrase =
      gaps.length > 0
        ? `On your site I noticed ${gaps.join(' and ')}.`
        : 'I spent a few minutes on your site and have a couple of ideas that might help conversions.';
    const compPhrase =
      competitor && competitor !== 'N/A'
        ? ` I also saw ${competitor} nearby—they seem stronger on ${compGap || 'digital presence'}.`
        : '';

    const scriptDefaults = warRoomBuildScripts(title, city, category, gapPhrase, compPhrase, gaps);
    const suggestedAction =
      gaps.length > 2
        ? 'Lead with website + conversion gap, then offer a quick fix call.'
        : (parseFloat(rating) || 0) >= 4.5
          ? 'Lead with growth angle and social proof expansion.'
          : 'Lead with visibility + reputation improvement opener.';

    const ws =
      website && website !== 'N/A'
        ? website.startsWith('http')
          ? website
          : `https://${website}`
        : '';
    const wsLabel =
      website && website !== 'N/A' ? String(website).replace(/^https?:\/\//i, '').split('?')[0].replace(/\/$/, '') : '';

    const mailRow =
      email && email !== 'N/A'
        ? `<a href="mailto:${encodeURIComponent(email)}" class="text-sm font-bold text-amber-700 dark:text-amber-300 hover:underline truncate">${escapeHtmlText(email)}</a>`
        : `<span class="text-sm text-slate-400">—</span>`;

    const noteHistory = warRoomParseNoteHistory(row);
    const lastNotes = noteHistory.slice(-2);
    const notesHistoryHtml =
      lastNotes.length > 0
        ? `<div class="war-room-notes-history mt-2 pt-2 border-t border-slate-200 dark:border-slate-600"><span class="text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider text-[9px]">Recent notes</span><ul class="mt-1 space-y-1 list-disc pl-4">${lastNotes
            .map(
              (n) =>
                `<li class="text-xs text-slate-600 dark:text-slate-300">${escapeHtmlText(String(n.value).slice(0, 220))}${String(n.value).length > 220 ? '…' : ''}</li>`
            )
            .join('')}</ul></div>`
        : '<div class="war-room-notes-history mt-2 hidden"></div>';

    card.innerHTML = `
        <div class="flex items-start justify-between gap-3">
            <div class="flex flex-col gap-1 min-w-0">
                <h4 class="font-black text-xl md:text-2xl leading-tight text-slate-900 dark:text-white truncate">${escapeHtmlText(title)}</h4>
                <div class="flex flex-wrap items-center gap-2">
                    <div class="row-stars flex items-center gap-0.5 shrink-0" data-rating="${rating}" aria-hidden="true"></div>
                    <span class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">${Number(rating).toFixed(1)} · ${reviews} reviews</span>
                </div>
            </div>
            <span class="shrink-0 px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-500 bg-slate-100 dark:bg-slate-700 text-[9px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300">Cold</span>
        </div>
        <div class="rounded-xl border-2 border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/50 p-4 space-y-2">
            <p class="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Business</p>
            <p class="text-sm text-slate-800 dark:text-slate-100 leading-relaxed">${category && category !== 'N/A' ? `<span class="font-bold text-slate-900 dark:text-white">${escapeHtmlText(category)}</span> · ` : ''}${escapeHtmlText([address, city].filter(Boolean).join(', ') || '—')}</p>
            ${pipelineLabel ? `<p class="text-sm text-slate-600 dark:text-slate-300">Pipeline: <span class="font-semibold text-slate-900 dark:text-white">${escapeHtmlText(pipelineLabel)}</span></p>` : ''}
            ${
              ws
                ? `<a href="${escapeHtmlAttr(ws)}" target="_blank" rel="noopener noreferrer" class="text-sm font-bold text-amber-700 dark:text-amber-300 hover:underline break-all">${escapeHtmlText(wsLabel)}</a>`
                : `<p class="text-sm text-slate-400">No website on file</p>`
            }
            <p class="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 pt-2">Email</p>
            <div class="min-w-0">${mailRow}</div>
            <p class="text-[11px] text-slate-500 dark:text-slate-400 pt-1">Use the <strong class="text-slate-700 dark:text-slate-200">green call button</strong> in the bar below for the primary number.</p>
            <p class="text-[11px] text-amber-700 dark:text-amber-300 pt-1"><strong>Next best action:</strong> ${escapeHtmlText(suggestedAction)}</p>
            <p class="text-[10px] text-slate-500 dark:text-slate-400">Hotkeys: <strong>1</strong> connected, <strong>2</strong> voicemail drop + next, <strong>3</strong> no answer, <strong>4</strong> gatekeeper, <strong>5</strong> wrong number, <strong>6</strong> callback.</p>
        </div>
        <div>
            <p class="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-2">Call script</p>
            <div class="flex flex-wrap gap-2 mb-2" role="tablist" aria-label="Script type">
              <button type="button" role="tab" data-war-script-tab="opener" aria-selected="true" class="rounded-lg border-2 px-3 py-2 text-[10px] font-black uppercase tracking-widest transition-colors">Opener</button>
              <button type="button" role="tab" data-war-script-tab="short" aria-selected="false" class="rounded-lg border-2 px-3 py-2 text-[10px] font-black uppercase tracking-widest transition-colors">Short pitch</button>
              <button type="button" role="tab" data-war-script-tab="voicemail" aria-selected="false" class="rounded-lg border-2 px-3 py-2 text-[10px] font-black uppercase tracking-widest transition-colors">Voicemail</button>
            </div>
            <textarea class="war-room-script-input w-full rounded-xl border-2 border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 p-4 text-sm text-slate-800 dark:text-slate-100 leading-relaxed min-h-[12rem] focus:border-amber-500 focus:ring-2 focus:ring-amber-400/30 outline-none transition-all resize-y" placeholder="Pick a tab above, then edit…"></textarea>
            <p class="war-room-ai-opener-status text-[10px] font-semibold text-amber-700 dark:text-amber-300 min-h-[1.25rem]" aria-live="polite"></p>
        </div>
        <div class="rounded-xl border-2 border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/40 p-4">
            <p class="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-2">Notes (saved to this lead)</p>
            <textarea class="war-room-notes-input w-full rounded-xl border-2 border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 p-3 text-sm text-slate-800 dark:text-slate-100 min-h-[5rem] focus:border-amber-500 outline-none resize-y" placeholder="Gatekeeper name, objection, follow-up time…"></textarea>
            <div class="mt-2 flex flex-wrap items-center gap-3">
              <button type="button" class="war-room-save-note rounded-xl bg-slate-900 dark:bg-amber-400 text-white dark:text-slate-900 px-4 py-2 text-[10px] font-black uppercase tracking-widest hover:opacity-90 transition-opacity">Save note to lead</button>
              <span class="war-room-note-status text-xs font-semibold text-slate-500" aria-live="polite"></span>
            </div>
            ${notesHistoryHtml}
        </div>
        <div class="flex flex-wrap gap-2">
            <button type="button" class="war-room-vm-next px-3 py-1.5 rounded-lg bg-violet-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-violet-700 transition-colors">Drop VM + Next</button>
            <button type="button" class="war-room-disp-btn px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-emerald-500 transition-colors" data-disp="connected">Connected</button>
            <button type="button" class="war-room-disp-btn px-3 py-1.5 rounded-lg bg-slate-700 text-white text-[10px] font-black uppercase tracking-widest hover:bg-slate-600 transition-colors" data-disp="no_answer">No answer</button>
            <button type="button" class="war-room-disp-btn px-3 py-1.5 rounded-lg bg-amber-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-amber-500 transition-colors" data-disp="gatekeeper">Gatekeeper</button>
            <button type="button" class="war-room-disp-btn px-3 py-1.5 rounded-lg bg-rose-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-rose-500 transition-colors" data-disp="wrong_number">Wrong number</button>
            <button type="button" class="war-room-disp-btn px-3 py-1.5 rounded-lg bg-blue-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-blue-500 transition-colors" data-disp="callback">Callback</button>
            ${gaps.map((g) => `<span class="px-2 py-1 bg-rose-100 dark:bg-rose-950/50 text-rose-800 dark:text-rose-200 text-[9px] font-black uppercase tracking-widest rounded-md border border-rose-200 dark:border-rose-800">${escapeHtmlText(g)}</span>`).join('')}
            ${competitor && competitor !== 'N/A' ? `<span class="px-2 py-1 bg-blue-100 dark:bg-blue-950/40 text-blue-800 dark:text-blue-200 text-[9px] font-black uppercase tracking-widest rounded-md border border-blue-200 dark:border-blue-800">vs ${escapeHtmlText(competitor)}</span>` : ''}
        </div>
    `;

    setTimeout(() => {
      const starContainer = card.querySelector('.row-stars');
      if (starContainer) renderStarsInElement(starContainer, parseFloat(rating) || 0, 'w-3.5 h-3.5');
    }, 0);
    return { card, scriptDefaults };
  }


  // Initial render of stars in the table — after pipeline prefs reveal to avoid visible repaint.
  (function scheduleInitialTableStars() {
    const run = () => applyTableStars();
    if (document.getElementById('prospectLeadsTable')) {
      if (document.documentElement.getAttribute('data-pipeline-prefs-ready') === '1') {
        run();
        return;
      }
      const reveal = () => {
        if (document.documentElement.getAttribute('data-pipeline-prefs-ready') === '1') {
          document.removeEventListener('adhello-pipeline-prefs-ready', reveal);
          run();
        }
      };
      document.addEventListener('adhello-pipeline-prefs-ready', reveal);
      setTimeout(run, 2500);
      return;
    }
    run();
  })();

  const schedulePipelineFrame =
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (fn) => setTimeout(fn, 16);
  schedulePipelineFrame(() => {
    schedulePipelineFrame(() => {
      if (typeof syncPipelineStickyColumnOffsets === 'function') {
        syncPipelineStickyColumnOffsets();
      }
    });
  });

  /** Map API lead JSON onto the hidden panel host (Cadences / pages without a table row). */
  function applyLeadObjectToPanelHost(el, lead) {
    if (!el || !lead) return;
    const ds = el.dataset;
    const str = (v, fb = '') =>
      v != null && v !== undefined && String(v) !== 'undefined' ? String(v) : fb;
    ds.leadKey = str(lead.key);
    ds.title = str(lead.title);
    ds.phone = str(lead.phone, 'N/A');
    ds.email = str(lead.email, 'N/A');
    ds.website = str(lead.website, 'N/A');
    const cat = lead.categoryName;
    ds.category = cat && cat !== 'N/A' ? str(cat) : str(lead.category, 'N/A');
    ds.address = str(lead.address, 'N/A');
    ds.city = str(lead.city);
    ds.state = str(lead.state);
    ds.url = str(lead.url);
    ds.facebook = str(lead.facebook, 'N/A');
    ds.instagram = str(lead.instagram, 'N/A');
    ds.twitter = str(lead.twitter, 'N/A');
    ds.rating = lead.totalScore != null ? String(lead.totalScore) : '0';
    ds.reviews = lead.reviewsCount != null ? String(lead.reviewsCount) : '0';
    ds.gbpClaimStatus = str(lead.gbpClaimStatus);
    ds.loyaltyProgram = str(
      lead.loyaltyProgram || (lead.hasLoyaltyProgram === true ? 'yes' : lead.hasLoyaltyProgram === false ? 'no' : ''),
    );
    ds.loyaltyProgramUrl = str(lead.loyaltyProgramUrl);
    ds.loyaltyProgramEvidence = str(lead.loyaltyProgramEvidence);
    ds.gbpOptimizationScore = str(lead.gbpOptimizationScore);
    ds.status = str(lead.status, 'Not Contacted');
    ds.source = str(lead.source);
    ds.loomUrl = str(lead.loomUrl);
    ds.ownerSignal = str(lead.ownerSignal);
    ds.outreachPrompt = str(lead.outreachPrompt);
    ds.industry = str(lead.industry);
    ds.goal = str(lead.goal);
    ds.vibe = str(lead.vibe);
    ds.pipelineStage = lead.pipelineStage != null ? String(lead.pipelineStage) : '';
    ds.stageId = str(lead.stageId);
    ds.pipelineLabel = str(lead.pipelineLabel);
    ds.onPipelineBoard = lead.onPipelineBoard ? '1' : '';
    try {
      ds.tags = JSON.stringify(Array.isArray(lead.tags) ? lead.tags : []);
    } catch (_) {
      ds.tags = '[]';
    }
    ds.auditUrl = str(lead.auditUrl);
    ds.estimatedValue = lead.estimatedValue != null ? String(lead.estimatedValue) : '';
    ds.stitchDesignUrl = str(lead.stitchDesignUrl);
    ds.stitchScreenshotUrl = str(lead.stitchScreenshotUrl);
    ds.stitchScreenId = str(lead.stitchScreenId);
    ds.competitorName = str(lead.competitorName);
    ds.competitorGap = str(lead.competitorGap);
    ds.competitorMetaBenchmark = str(lead.competitorMetaBenchmark);
    ds.cmsPlatform = str(lead.cmsPlatform);
    try {
      ds.techStackTags = JSON.stringify(Array.isArray(lead.techStackTags) ? lead.techStackTags : []);
    } catch (_) {
      ds.techStackTags = '[]';
    }
    ds.builtWithUrl = str(lead.builtWithUrl);
    ds.geoGaps = str(lead.geoGaps);
    ds.auditSummary = str(lead.auditSummary);
    ds.hasSchemaMarkup = lead.hasSchemaMarkup != null ? String(lead.hasSchemaMarkup) : '';
    ds.hasChatbot = lead.hasChatbot != null ? String(lead.hasChatbot) : '';
    ds.hasClickToCall = lead.hasClickToCall != null ? String(lead.hasClickToCall) : '';
    ds.isMobileFriendly = lead.isMobileFriendly != null ? String(lead.isMobileFriendly) : '';
    ds.isOutdated = lead.isOutdated != null ? String(lead.isOutdated) : '';
    ds.visualModernityScore = lead.visualModernityScore != null ? String(lead.visualModernityScore) : '';
    ds.aeoScore = lead.aeoScore != null ? String(lead.aeoScore) : '';
    try {
      ds.reviewSnippets = JSON.stringify(lead.reviewSnippets || []);
    } catch (_) {
      ds.reviewSnippets = '[]';
    }
    if (lead.sponsored === true) ds.sponsored = 'yes';
    else if (lead.sponsored === false) ds.sponsored = 'no';
    else ds.sponsored = '';
    try {
      ds.reviewIntel = lead.reviewIntel ? JSON.stringify(lead.reviewIntel) : '';
    } catch (_) {
      ds.reviewIntel = '';
    }
    try {
      ds.sequenceState = JSON.stringify(lead.sequenceState || null);
    } catch (_) {
      ds.sequenceState = 'null';
    }
    try {
      ds.logsSnippet = JSON.stringify((lead.logs || []).slice(-14));
    } catch (_) {
      ds.logsSnippet = '[]';
    }
    try {
      ds.leadLocations = JSON.stringify(Array.isArray(lead.leadLocations) ? lead.leadLocations : []);
    } catch (_) {
      ds.leadLocations = '[]';
    }
    try {
      ds.alternateTitles = JSON.stringify(Array.isArray(lead.alternateTitles) ? lead.alternateTitles : []);
    } catch (_) {
      ds.alternateTitles = '[]';
    }
    try {
      ds.updates = JSON.stringify(lead.updates || []);
    } catch (_) {
      ds.updates = '[]';
    }
    try {
      ds.auditData = JSON.stringify(lead.auditData || null);
    } catch (_) {
      ds.auditData = 'null';
    }
    try {
      ds.chatHistory = JSON.stringify(lead.chatHistory || null);
    } catch (_) {
      ds.chatHistory = 'null';
    }
    try {
      ds.cqi = JSON.stringify(lead.cqi || null);
    } catch (_) {
      ds.cqi = 'null';
    }
    ds.ownerFirstName = str(lead.ownerFirstName);
    ds.doNotCall = lead.doNotCall ? '1' : '';
    try {
      ds.contacts = JSON.stringify(lead.contacts || []);
    } catch (_) {
      ds.contacts = '[]';
    }
    try {
      ds.aiAnalysis = JSON.stringify(lead.aiWebsiteAnalysis || null);
    } catch (_) {
      ds.aiAnalysis = 'null';
    }
    try {
      ds.buyingSignals = JSON.stringify(lead.buyingSignals || []);
    } catch (_) {
      ds.buyingSignals = '[]';
    }
    ds.aiScore = lead.aiWebsiteAnalysisScore != null ? String(lead.aiWebsiteAnalysisScore) : '';
    const ltc = String(lead.lastTouchChannel || '').trim();
    ds.lastTouchChannel = ltc;
    ds.cadenceSort =
      ltc || (lead.sequenceState && lead.sequenceState.templateId ? String(lead.sequenceState.templateId) : '');
    const rawTouch = lead.updatedAt || lead.lastTouchAt || lead.lastContactAt || lead.createdAt || lead.savedAt;
    let ms = 0;
    if (rawTouch) {
      const d = new Date(rawTouch);
      if (!Number.isNaN(d.getTime())) ms = d.getTime();
    }
    ds.lastTouchMs = String(ms);
    const cr = lead.createdAt || lead.savedAt;
    let csm = 0;
    if (cr) {
      const d = new Date(cr);
      if (!Number.isNaN(d.getTime())) csm = d.getTime();
    }
    ds.createdSort = String(csm);
    ds.createdAt = str(cr);
  }

  window.openLeadDetailFromKey = async (rawKey) => {
    const k = String(rawKey || '').replace(/^lead:/, '').trim();
    if (!k) return;
    const host = document.getElementById('leadPanelDatasetHost');
    if (!host) return;
    try {
      const res = await fetch(`/leads/${encodeURIComponent(k)}/panel-data`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (!data.success || !data.lead) return;
      applyLeadObjectToPanelHost(host, data.lead);
      selectRow(host);
    } catch (err) {
      console.error(err);
    }
  };

  (function openFocusLeadFromQuery() {
    if (!getLeadDetailPanel()) return;
    const params = new URLSearchParams(window.location.search);
    const raw = (params.get('focusLead') || '').trim();
    if (!raw) return;
    const short = raw.replace(/^lead:/i, '');
    let target = null;
    document.querySelectorAll('.result-row').forEach((row) => {
      const k = row.getAttribute('data-lead-key') || '';
      const norm = k.startsWith('lead:') ? k.slice(5) : k;
      if (k === raw || k === `lead:${short}` || norm === short) target = row;
    });
    if (target) {
      try {
        selectRow(target);
      } catch (err) {
        console.error('[focusLead] Could not open lead panel:', err);
      }
      params.delete('focusLead');
      const clean = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}${window.location.hash}`;
      window.history.replaceState({}, '', clean);
    }
  })();

  ensureLeadDetailPanelNotBlockingPage();
  window.__ADHELLO_BUILD = '1.0.55-lead-callback-task-module';
  window.__postLeadJsonUpdate = postLeadJsonUpdate;
  window.__syncPersistedLeadToRowDataset = syncPersistedLeadToRowDataset;
  window.__populateLeadPanel = populatePanel;
  window.__getLeadPanelCurrentRow = function getLeadPanelCurrentRow() {
    return currentRow;
  };
});
