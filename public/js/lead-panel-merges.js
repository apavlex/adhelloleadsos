/**
 * Lead panel — Merges tab: show each merged business with phone, website, and star reviews.
 */
(function (global) {
  function isBlank(v) {
    if (v == null) return true;
    const s = String(v).trim();
    return !s || s === 'N/A' || s === '—' || s === '-';
  }

  function parseJson(raw, fallback) {
    if (raw == null || raw === '') return fallback;
    try {
      const v = JSON.parse(raw);
      return v == null ? fallback : v;
    } catch {
      return fallback;
    }
  }

  function normalizePhoneKey(phone) {
    return String(phone || '').replace(/\D/g, '');
  }

  function normalizeWebsiteKey(website) {
    return String(website || '')
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/$/, '');
  }

  function findEmbeddedLead(row) {
    if (typeof global.__isLeadTitleSaved !== 'function') return null;
    const list = global.INITIAL_SAVED_LEADS;
    if (!Array.isArray(list) || !row || !row.dataset) return null;
    const rawKey = String(row.dataset.leadKey || '').trim();
    const keyNorm = rawKey.replace(/^lead:/i, '');
    const title = String(row.dataset.title || '')
      .trim()
      .toLowerCase();
    return (
      list.find((l) => {
        if (!l) return false;
        const lk = String(l.key || '').trim();
        const lkNorm = lk.replace(/^lead:/i, '');
        if (rawKey && (lk === rawKey || lkNorm === keyNorm)) return true;
        if (title && String(l.title || '').trim().toLowerCase() === title) return true;
        return false;
      }) || null
    );
  }

  function profileIdentity(p) {
    return [
      String(p.title || '').trim().toLowerCase(),
      normalizePhoneKey(p.phone),
      normalizeWebsiteKey(p.website),
      String(p.sourceLeadKey || '').trim().toLowerCase(),
    ].join('|');
  }

  function normalizeProfile(raw, isPrimary) {
    if (!raw || typeof raw !== 'object') return null;
    const rating = parseFloat(raw.totalScore ?? raw.rating);
    const reviews = parseInt(raw.reviewsCount ?? raw.reviews, 10);
    const profile = {
      title: String(raw.title || '').trim(),
      phone: isBlank(raw.phone) ? '' : String(raw.phone).trim(),
      email: isBlank(raw.email) ? '' : String(raw.email).trim(),
      website: isBlank(raw.website) ? '' : String(raw.website).trim(),
      url: isBlank(raw.url) ? '' : String(raw.url).trim(),
      address: isBlank(raw.address) ? '' : String(raw.address).trim(),
      city: isBlank(raw.city) ? '' : String(raw.city).trim(),
      state: isBlank(raw.state) ? '' : String(raw.state).trim(),
      categoryName: isBlank(raw.categoryName || raw.category)
        ? ''
        : String(raw.categoryName || raw.category).trim(),
      totalScore: Number.isFinite(rating) && rating > 0 ? rating : 0,
      reviewsCount: Number.isFinite(reviews) && reviews > 0 ? reviews : 0,
      sourceLeadKey: String(raw.sourceLeadKey || '').trim(),
      mergedAt: String(raw.mergedAt || '').trim(),
      isPrimary: !!isPrimary,
    };
    if (
      !profile.title &&
      !profile.phone &&
      !profile.website &&
      !profile.url &&
      !profile.totalScore &&
      !profile.reviewsCount
    ) {
      return null;
    }
    return profile;
  }

  function collectMergedBusinessProfiles(row) {
    const ds = row && row.dataset ? row.dataset : {};
    const embedded = findEmbeddedLead(row);
    const profiles = [];
    const seen = new Set();

    function add(raw, isPrimary) {
      const p = normalizeProfile(raw, isPrimary);
      if (!p) return;
      const id = profileIdentity(p);
      if (seen.has(id)) return;
      seen.add(id);
      profiles.push(p);
    }

    add(
      {
        title: ds.title || embedded?.title,
        phone: ds.phone || embedded?.phone,
        email: ds.email || embedded?.email,
        website: ds.website || embedded?.website,
        url: ds.url || embedded?.url,
        address: ds.address || embedded?.address,
        city: ds.city || embedded?.city,
        state: ds.state || embedded?.state,
        categoryName: ds.category || embedded?.categoryName,
        totalScore: ds.rating || embedded?.totalScore,
        reviewsCount: ds.reviews || embedded?.reviewsCount,
      },
      true,
    );

    const locs = parseJson(ds.leadLocations, embedded?.leadLocations || []);
    (Array.isArray(locs) ? locs : []).forEach((loc) => add(loc, false));

    const altTitles = parseJson(ds.alternateTitles, embedded?.alternateTitles || []);
    (Array.isArray(altTitles) ? altTitles : []).forEach((title) => {
      if (isBlank(title)) return;
      add({ title: String(title).trim() }, false);
    });

    const logs = parseJson(ds.logsSnippet, embedded?.logs || []);
    (Array.isArray(logs) ? logs : []).forEach((log) => {
      if (!log || String(log.type || '').toLowerCase() !== 'merge') return;
      const msg = String(log.message || '');
      const m = msg.match(/Merged\s+"([^"]+)"/i);
      if (!m) return;
      add({ title: m[1].trim(), mergedAt: log.timestamp || '' }, false);
    });

    profiles.sort((a, b) => {
      if (a.isPrimary && !b.isPrimary) return -1;
      if (!a.isPrimary && b.isPrimary) return 1;
      return (Date.parse(b.mergedAt) || 0) - (Date.parse(a.mergedAt) || 0);
    });

    return profiles;
  }

  function hasMergeHistory(row) {
    const profiles = collectMergedBusinessProfiles(row);
    if (profiles.length > 1) return true;
    const ds = row && row.dataset ? row.dataset : {};
    const locs = parseJson(ds.leadLocations, []);
    if (Array.isArray(locs) && locs.length) return true;
    const logs = parseJson(ds.logsSnippet, []);
    return (Array.isArray(logs) ? logs : []).some((l) => String(l?.type || '').toLowerCase() === 'merge');
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function websiteHref(website) {
    const w = String(website || '').trim();
    if (!w) return '';
    return /^https?:\/\//i.test(w) ? w : `https://${w}`;
  }

  function renderReviewsBlock(rating, reviews) {
    const r = parseFloat(rating) || 0;
    const c = parseInt(reviews, 10) || 0;
    if (r <= 0 && c <= 0) {
      return '<span class="text-xs font-semibold text-brand-muted dark:text-slate-500">No reviews on file</span>';
    }
    const ratingAttr = r > 0 ? ` data-rating="${r.toFixed(1)}"` : '';
    const scoreLine =
      r > 0
        ? `<span class="text-xs font-bold tabular-nums text-brand-dark dark:text-slate-100">${r.toFixed(1)}${c > 0 ? ` <span class="text-brand-muted dark:text-slate-400 font-semibold">(${c})</span>` : ''}</span>`
        : c > 0
          ? `<span class="text-xs font-semibold text-brand-muted dark:text-slate-400 tabular-nums">— <span class="text-brand-dark dark:text-slate-200">(${c})</span></span>`
          : '';
    return `<div class="flex items-center gap-2 flex-wrap">${r > 0 ? `<div class="row-stars flex items-center gap-0.5 shrink-0" data-review-stars${ratingAttr} aria-hidden="true"></div>` : ''}${scoreLine}</div>`;
  }

  function renderProfileCard(profile) {
    const title = profile.title || (profile.isPrimary ? 'Primary business' : 'Merged business');
    const badge = profile.isPrimary
      ? '<span class="inline-flex items-center rounded-full bg-brand-yellow/25 dark:bg-brand-yellow/15 border border-brand-yellow/40 px-2 py-0.5 text-[8px] font-black uppercase tracking-widest text-brand-dark dark:text-brand-yellow">Primary</span>'
      : '<span class="inline-flex items-center rounded-full bg-violet-500/10 dark:bg-violet-500/15 border border-violet-400/30 px-2 py-0.5 text-[8px] font-black uppercase tracking-widest text-violet-800 dark:text-violet-200">Merged in</span>';

    const locBits = [profile.address, profile.city, profile.state].filter(Boolean);
    const locLine = locBits.length
      ? `<p class="text-[10px] text-brand-muted dark:text-slate-400 mt-0.5">${escapeHtml(locBits.join(', '))}</p>`
      : '';

    const categoryLine = profile.categoryName
      ? `<p class="text-[10px] font-semibold text-brand-muted dark:text-slate-400 mt-1">${escapeHtml(profile.categoryName)}</p>`
      : '';

    const phoneLine = profile.phone
      ? `<div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"><span class="text-[9px] font-black uppercase tracking-widest text-brand-muted">Phone</span><a href="tel:${escapeHtml(profile.phone.replace(/[^\d+]/g, ''))}" class="text-xs font-semibold text-brand-dark dark:text-slate-200 hover:text-brand-yellow">${escapeHtml(profile.phone)}</a></div>`
      : '';

    let websiteLine = '';
    if (profile.website) {
      const href = websiteHref(profile.website);
      websiteLine = `<div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"><span class="text-[9px] font-black uppercase tracking-widest text-brand-muted">Website</span><a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" class="text-xs font-semibold text-brand-yellow hover:underline break-all">${escapeHtml(profile.website)}</a></div>`;
    } else if (profile.url) {
      websiteLine = `<div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"><span class="text-[9px] font-black uppercase tracking-widest text-brand-muted">Maps</span><a href="${escapeHtml(profile.url)}" target="_blank" rel="noopener noreferrer" class="text-xs font-semibold text-brand-yellow hover:underline break-all">${escapeHtml(profile.url)}</a></div>`;
    }

    const emailLine = profile.email
      ? `<div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"><span class="text-[9px] font-black uppercase tracking-widest text-brand-muted">Email</span><a href="mailto:${escapeHtml(profile.email)}" class="text-xs font-semibold text-brand-dark dark:text-slate-200 hover:text-brand-yellow break-all">${escapeHtml(profile.email)}</a></div>`
      : '';

    const mergedWhen =
      !profile.isPrimary && profile.mergedAt
        ? `<p class="text-[9px] font-semibold uppercase tracking-widest text-brand-muted/80 mt-2">Merged ${escapeHtml(new Date(profile.mergedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }))}</p>`
        : '';

    return `<article class="lead-merge-card rounded-2xl border border-brand-border/35 dark:border-white/10 bg-white/70 dark:bg-slate-900/50 p-3.5 space-y-2">
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div class="min-w-0">
          <h4 class="text-sm font-bold text-brand-dark dark:text-white leading-snug">${escapeHtml(title)}</h4>
          ${locLine}
          ${categoryLine}
        </div>
        ${badge}
      </div>
      <div class="space-y-1.5 pt-1 border-t border-brand-border/20 dark:border-white/10">
        ${phoneLine}
        ${websiteLine}
        ${emailLine}
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1 pt-0.5">
          <span class="text-[9px] font-black uppercase tracking-widest text-brand-muted shrink-0">Reviews</span>
          ${renderReviewsBlock(profile.totalScore, profile.reviewsCount)}
        </div>
      </div>
      ${mergedWhen}
    </article>`;
  }

  function paintLeadPanelMerges(row, hostEl) {
    const host =
      hostEl ||
      document.querySelector('#mobilePanel #activityLog') ||
      document.getElementById('activityLog');
    if (!host) return false;

    const profiles = collectMergedBusinessProfiles(row);
    const mergeCount = profiles.filter((p) => !p.isPrimary).length;

    if (!profiles.length) {
      host.innerHTML =
        '<div class="pl-2 text-xs text-brand-muted italic leading-relaxed">Select a lead to view merged businesses.</div>';
      return true;
    }

    if (mergeCount === 0) {
      host.innerHTML = `<div class="pl-2 text-xs text-brand-muted italic leading-relaxed">No merged businesses yet. Use bulk <strong class="text-brand-dark dark:text-white">Merge</strong> on the pipeline to combine name variants and locations.</div>`;
      return true;
    }

    host.innerHTML = `<div class="space-y-3 pl-0.5">${profiles.map(renderProfileCard).join('')}</div>`;

    if (typeof global.__applyReviewStars === 'function') {
      global.__applyReviewStars(host);
    } else if (typeof global.__renderStarsInElement === 'function') {
      host.querySelectorAll('[data-review-stars]').forEach((el) => {
        const rating = parseFloat(el.dataset.rating) || 0;
        global.__renderStarsInElement(el, rating, 'w-3.5 h-3.5');
      });
    }

    const countEl = document.getElementById('activityLogCount');
    if (countEl) {
      countEl.textContent = `${profiles.length} business${profiles.length === 1 ? '' : 'es'} · ${mergeCount} merged in`;
      countEl.classList.remove('hidden');
    }

    return true;
  }

  global.__adhelloCollectMergedBusinessProfiles = collectMergedBusinessProfiles;
  global.__adhelloLeadPanelHasMerges = hasMergeHistory;
  global.__adhelloPaintLeadPanelMerges = paintLeadPanelMerges;
})(typeof window !== 'undefined' ? window : global);
