/**
 * Global navbar: notification bell, processing ring, /api/status polling.
 * Bulk lead enhance queue (sessionStorage) so enhancement continues after navigation; bell shows x/y progress.
 * Loaded from partials/navbar.ejs on every app page so the bell works everywhere.
 */
(function () {
  let activeProcessingCount = 0;
  let processingIndicator = null;
  let lastAutoOutreachSummary = null;

  /**
   * In-app toast (glass-style). Use for enhance/Firecrawl errors instead of window.alert.
   * @param {string} message
   * @param {{ variant?: 'info'|'error', duration?: number }} [opts]
   */
  window.showAppToast = function showAppToast(message, opts) {
    if (!message) return;
    opts = opts || {};
    const variant =
      opts.variant === 'error'
        ? 'error'
        : opts.variant === 'success'
          ? 'success'
          : opts.variant === 'warning'
            ? 'warning'
            : 'info';
    const duration =
      typeof opts.duration === 'number'
        ? opts.duration
        : variant === 'error'
          ? 11000
          : variant === 'success'
            ? 4200
            : 2800;

    var el = document.getElementById('appToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'appToast';
      document.body.appendChild(el);
    }
    el.setAttribute('role', variant === 'error' || variant === 'warning' ? 'alert' : 'status');

    // Colors/position live in custom.css (#appToast) — Tailwind utilities set from JS
    // often miss the CDN scan, which left white text on cream with only a red border.
    el.className = [
      'app-toast',
      'app-toast--' + variant,
      'app-toast--enter',
      variant === 'error' || variant === 'warning' ? 'app-toast--dismissible' : '',
    ]
      .filter(Boolean)
      .join(' ');
    el.textContent = message;

    if (variant === 'error' || variant === 'warning') {
      el.title = 'Click to dismiss';
    } else {
      el.removeAttribute('title');
    }

    requestAnimationFrame(function () {
      el.classList.remove('app-toast--enter');
      el.classList.add('app-toast--visible');
    });

    clearTimeout(window.__appToastTimer);
    window.__appToastTimer = setTimeout(function () {
      el.classList.remove('app-toast--visible');
      el.classList.add('app-toast--enter');
      el.onclick = null;
    }, duration);

    if (variant === 'error' || variant === 'warning') {
      el.onclick = function () {
        clearTimeout(window.__appToastTimer);
        el.classList.remove('app-toast--visible');
        el.classList.add('app-toast--enter');
        el.onclick = null;
      };
    } else {
      el.onclick = null;
    }
  };

  const BULK_ENHANCE_STORAGE_KEY = 'agencyOsBulkEnhanceJob';
  const BULK_ENHANCE_LEAD_TIMEOUT_MS = 120000;
  const BULK_ENHANCE_FETCH_TIMEOUT_MS = 45000;
  let bulkEnhanceProcessorLock = false;

  /** @returns {Promise<{ res: Response, data: object }>} */
  async function fetchJsonWithTimeout(url, opts, timeoutMs) {
    const ms = timeoutMs != null ? timeoutMs : BULK_ENHANCE_FETCH_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(function () {
      controller.abort();
    }, ms);
    try {
      const res = await fetch(url, { ...(opts || {}), signal: controller.signal });
      const data = await res.json().catch(function () {
        return {};
      });
      return { res, data };
    } catch (err) {
      if (err && err.name === 'AbortError') {
        throw new Error('Request timed out after ' + Math.round(ms / 1000) + 's.');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  window.__fetchJsonWithTimeout = fetchJsonWithTimeout;

  function withBulkEnhanceLeadTimeout(promise, timeoutMs) {
    const ms = timeoutMs != null ? timeoutMs : BULK_ENHANCE_LEAD_TIMEOUT_MS;
    return Promise.race([
      promise,
      new Promise(function (_, reject) {
        setTimeout(function () {
          reject(new Error('Enhance timed out after ' + Math.round(ms / 1000) + 's for this lead.'));
        }, ms);
      }),
    ]);
  }

  window.__withBulkEnhanceLeadTimeout = withBulkEnhanceLeadTimeout;

  function readBulkEnhanceJob() {
    try {
      const raw = sessionStorage.getItem(BULK_ENHANCE_STORAGE_KEY);
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (!o || !Array.isArray(o.keys)) return null;
      return o;
    } catch (_) {
      return null;
    }
  }

  function writeBulkEnhanceJob(job) {
    try {
      if (!job) sessionStorage.removeItem(BULK_ENHANCE_STORAGE_KEY);
      else sessionStorage.setItem(BULK_ENHANCE_STORAGE_KEY, JSON.stringify(job));
    } catch (_) {}
  }

  function isBulkEnhanceJobRunning() {
    const j = readBulkEnhanceJob();
    return !!(j && j.running === true && j.index < j.keys.length);
  }

  /** Set from app.js during sequential (non-queue) bulk enrich on results so /api/status polling does not clear the bell. */
  const SYNC_ENHANCE_SESSION_KEY = 'agency_os_sync_enhance';
  function syncEnhanceSessionActive() {
    try {
      return sessionStorage.getItem(SYNC_ENHANCE_SESSION_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  function clientNavbarWorkActive() {
    return (
      isBulkEnhanceJobRunning() ||
      syncEnhanceSessionActive() ||
      isContactHuntJobRunning() ||
      isGhlSyncJobRunning() ||
      isArtworkGenJobRunning() ||
      isBulkOutreachJobRunning()
    );
  }

  function escapeLeadRunText(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function formatSearchKeywordDisplay(keyword) {
    return String(keyword || '')
      .trim()
      .replace(/_/g, ' ')
      .replace(/-/g, ' ')
      .replace(/\s+/g, ' ');
  }

  const LEAD_RUN_SESSION_KEY = 'agencyOsLeadRunProgress';
  const LEAD_RUN_FOLDER_RELOAD_KEY = 'agencyOsLeadRunFolderReloadAt';
  /** Must match services/leadRunProgress.js STALE_MS (10 minutes). */
  const LEAD_RUN_STALE_MS = 10 * 60 * 1000;
  let leadRunDisplayPct = 0;
  let leadRunTickerId = null;
  let leadRunWasProcessing = false;
  let leadRunStaleDismissedAt = '';

  function readLeadRunSession() {
    try {
      var raw = sessionStorage.getItem(LEAD_RUN_SESSION_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      return o && o.startedAt ? o : null;
    } catch (_) {
      return null;
    }
  }

  function writeLeadRunSession(job) {
    if (!job || !job.startedAt) return;
    try {
      sessionStorage.setItem(
        LEAD_RUN_SESSION_KEY,
        JSON.stringify({
          keyword: job.keyword || '',
          city: job.city || '',
          state: job.state || '',
          targetFolderKey: job.targetFolderKey || '',
          targetFolderName: job.targetFolderName || '',
          startedAt: job.startedAt,
        })
      );
    } catch (_) {}
  }

  function clearLeadRunSession() {
    try {
      sessionStorage.removeItem(LEAD_RUN_SESSION_KEY);
    } catch (_) {}
  }

  function mergeLeadRunJob(data, opts) {
    opts = opts || {};
    if (opts.fresh) {
      var freshJob = {
        keyword: opts.keyword || '',
        city: opts.city || '',
        state: opts.state || '',
        targetFolderKey: opts.targetFolderKey || '',
        targetFolderName: opts.targetFolderName || '',
        startedAt: new Date().toISOString(),
      };
      writeLeadRunSession(freshJob);
      return freshJob;
    }

    var session = readLeadRunSession();
    var serverJob = data && data.activeJob ? data.activeJob : null;
    var job = serverJob || session || null;

    if (opts && (opts.keyword || opts.city || opts.state || opts.targetFolderKey)) {
      if (!job) {
        job = {
          keyword: opts.keyword || '',
          city: opts.city || '',
          state: opts.state || '',
          targetFolderKey: opts.targetFolderKey || '',
          targetFolderName: opts.targetFolderName || '',
          startedAt: new Date().toISOString(),
        };
      } else {
        job = {
          keyword: opts.keyword || job.keyword || '',
          city: opts.city || job.city || '',
          state: opts.state || job.state || '',
          targetFolderKey: opts.targetFolderKey || job.targetFolderKey || '',
          targetFolderName: opts.targetFolderName || job.targetFolderName || '',
          startedAt: job.startedAt || (serverJob && serverJob.startedAt) || new Date().toISOString(),
        };
      }
    }

    if (serverJob && serverJob.startedAt) {
      job = Object.assign({}, job || {}, serverJob);
    }

    if (job && job.startedAt) writeLeadRunSession(job);
    return job;
  }

  /** Time-based target 1–99% (eased so it slows near the end). Never 100 while running. */
  function computeLeadRunTargetPct(startedAt) {
    if (!startedAt) return 1;
    var elapsed = Date.now() - Date.parse(startedAt);
    if (!Number.isFinite(elapsed) || elapsed < 0) return 1;
    var estMs = 3.5 * 60 * 1000;
    var linear = Math.min(1, elapsed / estMs);
    var eased = 1 - Math.pow(1 - linear, 1.4);
    return Math.min(99, Math.max(1, Math.round(eased * 99)));
  }

  function isLeadRunJobStale(startedAt) {
    if (!startedAt) return false;
    var elapsed = Date.now() - Date.parse(startedAt);
    return Number.isFinite(elapsed) && elapsed >= LEAD_RUN_STALE_MS;
  }

  function leadRunStartedAtKey(startedAt) {
    return startedAt ? String(startedAt) : '';
  }

  function renderLeadRunProgressPct(pct) {
    var rounded = Math.round(pct);
    var pctEl = document.getElementById('leadRunProgressPct');
    var fill = document.getElementById('leadRunProgressFill');
    var bar = document.getElementById('leadRunProgressBar');
    if (pctEl) pctEl.textContent = rounded + '%';
    if (fill) fill.style.width = pct + '%';
    if (bar) bar.setAttribute('aria-valuenow', String(rounded));
  }

  function stopLeadRunTicker() {
    if (leadRunTickerId) {
      cancelAnimationFrame(leadRunTickerId);
      leadRunTickerId = null;
    }
  }

  function startLeadRunTicker() {
    if (leadRunTickerId) return;
    function tick() {
      var searching = localStorage.getItem('is_searching') === 'true';
      var session = readLeadRunSession();
      if (session && isLeadRunJobStale(session.startedAt)) {
        recoverStaleLeadRun('ticker');
        return;
      }
      if (!searching) {
        stopLeadRunTicker();
        return;
      }
      var target = computeLeadRunTargetPct(session && session.startedAt);
      if (leadRunDisplayPct < target) {
        var step = Math.max(0.15, (target - leadRunDisplayPct) * 0.08);
        leadRunDisplayPct = Math.min(target, leadRunDisplayPct + step);
      }
      renderLeadRunProgressPct(leadRunDisplayPct);
      leadRunTickerId = requestAnimationFrame(tick);
    }
    leadRunTickerId = requestAnimationFrame(tick);
  }

  function finishLeadRunProgress(callback) {
    stopLeadRunTicker();
    var start = leadRunDisplayPct;
    var startTime = Date.now();
    var duration = 450;
    function animateComplete() {
      var t = Math.min(1, (Date.now() - startTime) / duration);
      var pct = start + (100 - start) * t;
      leadRunDisplayPct = pct;
      renderLeadRunProgressPct(pct);
      if (t < 1) {
        requestAnimationFrame(animateComplete);
      } else if (typeof callback === 'function') {
        callback();
      }
    }
    requestAnimationFrame(animateComplete);
  }

  function recoverStaleLeadRun(reason) {
    var session = readLeadRunSession();
    var startedKey = leadRunStartedAtKey(session && session.startedAt);
    if (startedKey && leadRunStaleDismissedAt === startedKey) {
      stopLeadRunTicker();
      return;
    }
    if (startedKey) leadRunStaleDismissedAt = startedKey;
    try {
      localStorage.removeItem('is_searching');
    } catch (_) {}
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[lead-run] Stale search progress recovered (' + (reason || 'watchdog') + ').');
    }
    if (typeof window.showAppToast === 'function') {
      window.showAppToast(
        'Lead search took too long — check the bell or History. Results may already be saved.',
        { variant: 'info', duration: 7000 }
      );
    }
    finishLeadRunProgress(function () {
      var banner = document.getElementById('leadRunProgressBanner');
      if (banner) {
        banner.classList.add('hidden');
        banner.setAttribute('aria-busy', 'false');
      }
      leadRunDisplayPct = 0;
      clearLeadRunSession();
    });
  }

  function updateLeadRunProgressBanner(data, opts) {
    opts = opts || {};
    var banner = document.getElementById('leadRunProgressBanner');
    if (!banner) return;
    var jobForStale = (data && data.activeJob) || readLeadRunSession();
    var wouldShow =
      opts.forceShow === true ||
      (data && data.isProcessing) ||
      localStorage.getItem('is_searching') === 'true';
    if (
      wouldShow &&
      !opts.forceShow &&
      !opts.fresh &&
      jobForStale &&
      isLeadRunJobStale(jobForStale.startedAt)
    ) {
      recoverStaleLeadRun('banner');
      return;
    }
    var show = wouldShow;
    if (!show) {
      if (leadRunDisplayPct > 0 && localStorage.getItem('is_searching') !== 'true') {
        finishLeadRunProgress(function () {
          banner.classList.add('hidden');
          banner.setAttribute('aria-busy', 'false');
          leadRunDisplayPct = 0;
          clearLeadRunSession();
        });
      } else {
        banner.classList.add('hidden');
        banner.setAttribute('aria-busy', 'false');
        leadRunDisplayPct = 0;
        clearLeadRunSession();
        stopLeadRunTicker();
      }
      return;
    }
    banner.classList.remove('hidden');
    banner.setAttribute('aria-busy', 'true');

    var sub = document.getElementById('leadRunProgressSub');
    var job = mergeLeadRunJob(data, opts);

    if (sub) {
      if (job && (job.keyword || job.city || job.state)) {
        var kw = escapeLeadRunText(formatSearchKeywordDisplay(job.keyword || ''));
        var loc = escapeLeadRunText([job.city, job.state].filter(Boolean).join(', '));
        var lead = kw ? '<strong>' + kw + '</strong>' : '';
        if (loc) lead += (kw ? ' · ' : '') + loc;
        sub.innerHTML =
          lead +
          ' — keep working here; we’ll notify you in the bell when results are ready.';
      } else {
        sub.textContent =
          'You can keep working here — we’ll notify you in the bell when results are ready.';
      }
    }

    if (job && job.startedAt) {
      var target = computeLeadRunTargetPct(job.startedAt);
      if (leadRunDisplayPct < 1) leadRunDisplayPct = 1;
      if (leadRunDisplayPct > target + 5) {
        leadRunDisplayPct = target;
      }
    }

    startLeadRunTicker();
  }

  window.showLeadRunProgressBanner = function showLeadRunProgressBanner(opts) {
    stopLeadRunTicker();
    leadRunDisplayPct = 1;
    leadRunStaleDismissedAt = '';
    updateLeadRunProgressBanner(null, {
      forceShow: true,
      fresh: true,
      keyword: opts && opts.keyword,
      city: opts && opts.city,
      state: opts && opts.state,
      targetFolderKey: opts && opts.targetFolderKey,
      targetFolderName: opts && opts.targetFolderName,
    });
  };

  function isPipelineFolderLeadsPage() {
    var path = String(window.location.pathname || '').replace(/\/$/, '');
    if (path === '/leads') return true;
    if (path !== '/prospecting') return false;
    var params = new URLSearchParams(window.location.search);
    var tab = String(params.get('tab') || 'pipeline').toLowerCase();
    return tab === 'pipeline' || tab === 'folders';
  }

  function getViewingFolderKey() {
    var params = new URLSearchParams(window.location.search);
    var fromUrl = params.get('folderKey');
    if (fromUrl && String(fromUrl).trim()) return String(fromUrl).trim();
    if (typeof window.PROSPECTING_ACTIVE_FOLDER_KEY === 'string' && window.PROSPECTING_ACTIVE_FOLDER_KEY.trim()) {
      return window.PROSPECTING_ACTIVE_FOLDER_KEY.trim();
    }
    return '';
  }

  function resolveCompletedSearchTargetFolder(data) {
    var n = data && data.notification ? data.notification : null;
    var fromNotif = n && n.targetFolderKey ? String(n.targetFolderKey).trim() : '';
    if (fromNotif) return fromNotif;
    var active = data && data.activeJob && data.activeJob.targetFolderKey
      ? String(data.activeJob.targetFolderKey).trim()
      : '';
    if (active) return active;
    var session = readLeadRunSession();
    return session && session.targetFolderKey ? String(session.targetFolderKey).trim() : '';
  }

  function maybeRefreshPipelineFolderForCompletedSearch(data) {
    if (!data || data.isProcessing) return;
    if (clientNavbarWorkActive()) return;

    var n = data.notification;
    if (!n || n.isRead || n.status === 'failed') return;
    if (typeof n.resultCount === 'number' && n.resultCount <= 0) return;
    if (!n.finishedAt) return;

    try {
      if (sessionStorage.getItem(LEAD_RUN_FOLDER_RELOAD_KEY) === String(n.finishedAt)) return;
    } catch (_) {}

    if (!isPipelineFolderLeadsPage()) return;

    var targetFolder = resolveCompletedSearchTargetFolder(data);
    if (!targetFolder) return;

    var viewingFolder = getViewingFolderKey();
    if (!viewingFolder || viewingFolder !== targetFolder) return;

    try {
      sessionStorage.setItem(LEAD_RUN_FOLDER_RELOAD_KEY, String(n.finishedAt));
    } catch (_) {}

    if (typeof window.showAppToast === 'function') {
      window.showAppToast('Lead search complete — refreshing your folder.', {
        variant: 'success',
        duration: 2600,
      });
    }

    setTimeout(function () {
      window.location.reload();
    }, 450);
  }

  window.hideLeadRunProgressBanner = function hideLeadRunProgressBanner() {
    updateLeadRunProgressBanner({ isProcessing: false });
  };

  function escapeBellHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }

  function buildAutoOutreachBellHtml(summary) {
    if (!summary || !summary.active) return '';
    const title = escapeBellHtml(summary.headline || 'Auto outreach running');
    const sub = escapeBellHtml(
      summary.body ||
        'Campaigns continue on the server. Safe to close this tab.',
    );
    const href = String(summary.href || '/prospecting?tab=folders').replace(/'/g, '');
    return (
      '<div class="p-4 hover:bg-emerald-50/80 dark:hover:bg-emerald-950/30 transition-colors cursor-pointer group/notif border-b border-brand-border/10 last:border-0 bg-emerald-50/40 dark:bg-emerald-950/20" onclick="window.location.href=\'' +
      href +
      '\'">' +
      '<div class="flex items-start gap-3">' +
      '<div class="w-8 h-8 rounded-full bg-emerald-500/15 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">' +
      '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>' +
      '</div><div class="min-w-0">' +
      '<div class="text-[11px] font-black text-brand-dark dark:text-white uppercase tracking-tight mb-0.5">' +
      title +
      '</div>' +
      '<div class="text-[10px] font-bold text-brand-muted dark:text-slate-400 leading-tight">' +
      sub +
      '</div>' +
      '<div class="mt-2 text-[9px] font-black uppercase text-emerald-700 dark:text-emerald-400 group-hover/notif:translate-x-1 transition-transform">' +
      'View folders →' +
      '</div>' +
      '</div></div></div>'
    );
  }

  function applyAutoOutreachBellBadge(summary) {
    const el = document.getElementById('bulkEnhanceBellBadge');
    if (!el) return;
    if (isBulkEnhanceJobRunning() || isGhlSyncJobRunning() || syncEnhanceSessionActive()) return;
    if (localStorage.getItem('is_searching') === 'true') return;
    if (summary && summary.active) {
      el.textContent = 'LIVE';
      el.classList.remove('hidden');
      el.setAttribute(
        'title',
        (summary.headline || 'Auto outreach') +
          ' — running on the server. Safe to close this tab.',
      );
    } else if (el.textContent === 'LIVE') {
      el.textContent = '';
      el.classList.add('hidden');
      el.removeAttribute('title');
    }
  }

  function updateBulkEnhanceBellBadge(currentZeroBasedIndex, total, label) {
    const el = document.getElementById('bulkEnhanceBellBadge');
    if (!el) return;
    if (total > 0 && currentZeroBasedIndex < total) {
      el.textContent = currentZeroBasedIndex + 1 + '/' + total;
      el.classList.remove('hidden');
      el.setAttribute(
        'title',
        (label || 'Enhancing leads') +
          ': ' +
          (currentZeroBasedIndex + 1) +
          ' of ' +
          total +
          ' (safe to change pages)',
      );
    } else if (!isGhlSyncJobRunning()) {
      if (lastAutoOutreachSummary && lastAutoOutreachSummary.active) {
        applyAutoOutreachBellBadge(lastAutoOutreachSummary);
      } else {
        el.textContent = '';
        el.classList.add('hidden');
        el.removeAttribute('title');
      }
    }
  }

  function applyProcessingRing() {
    if (!processingIndicator) return;
    const bulk = isBulkEnhanceJobRunning();
    const ghl = isGhlSyncJobRunning();
    const outreach = typeof isBulkOutreachJobRunning === 'function' && isBulkOutreachJobRunning();
    if (
      activeProcessingCount > 0 ||
      localStorage.getItem('is_searching') === 'true' ||
      bulk ||
      ghl ||
      isArtworkGenJobRunning() ||
      outreach
    ) {
      processingIndicator.classList.add('processing-active');
      if (bulk) {
        const j = readBulkEnhanceJob();
        if (j) updateBulkEnhanceBellBadge(j.index, j.keys.length, 'Enhancing leads');
      } else if (ghl) {
        const j = readGhlSyncJob();
        if (j) updateBulkEnhanceBellBadge(j.index, j.keys.length, 'GHL sync');
      } else if (outreach) {
        updateBulkOutreachBellBadge(readBulkOutreachJob());
      } else if (isArtworkGenJobRunning()) {
        updateArtworkGenBellBadge(readArtworkGenJob());
      }
    } else {
      processingIndicator.classList.remove('processing-active');
      updateBulkEnhanceBellBadge(0, 0);
    }
  }

  function emitBulkEnhanceProgress(index, total, label) {
    window.dispatchEvent(
      new CustomEvent('agency-os-bulk-enhance-progress', {
        detail: { index, total, label: label || 'Enhancing via API' },
      }),
    );
  }

  async function runEnhanceApiForLeadKey(leadKey) {
    const key = String(leadKey || '').trim();
    if (!key) {
      return { success: false, error: 'Missing lead key.' };
    }
    return withBulkEnhanceLeadTimeout(
      (async function () {
        const post = await fetchJsonWithTimeout(
          '/leads/' + encodeURIComponent(key) + '/enhance',
          {
            method: 'POST',
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
          },
          BULK_ENHANCE_FETCH_TIMEOUT_MS,
        );
        let result = post.data || {};
        if (post.res.ok && result.processing) {
          result = await pollLeadEnhanceUntilDone(key, { maxMs: BULK_ENHANCE_LEAD_TIMEOUT_MS });
        } else if (!post.res.ok) {
          result = {
            success: false,
            error: result.error || 'Enhance failed (' + post.res.status + ').',
          };
        }
        return result;
      })(),
      BULK_ENHANCE_LEAD_TIMEOUT_MS,
    );
  }

  window.__runEnhanceApiForLeadKey = runEnhanceApiForLeadKey;

  async function processBulkEnhanceQueue() {
    if (bulkEnhanceProcessorLock) return;
    if (!isBulkEnhanceJobRunning()) return;
    bulkEnhanceProcessorLock = true; // one queue per tab
    const summary = { successCount: 0, attempted: 0, lastError: '' };
    try {
      while (true) {
        let job = readBulkEnhanceJob();
        if (!job || !job.running || job.index >= job.keys.length) break;

        const key = job.keys[job.index];
        updateBulkEnhanceBellBadge(job.index, job.keys.length);
        emitBulkEnhanceProgress(job.index, job.keys.length);
        if (processingIndicator) processingIndicator.classList.add('processing-active');

        let success = false;
        let result = {};
        try {
          // eslint-disable-next-line no-await-in-loop
          result = await runEnhanceApiForLeadKey(key);
          success = !!(result.success && (result.lead || result.data));
        } catch (err) {
          result = { error: (err && err.message) || 'Enhance failed.' };
        }

        job = readBulkEnhanceJob();
        if (!job || !job.running) break;

        if (success) job.successCount = (job.successCount || 0) + 1;
        job.attempted = (job.attempted || 0) + 1;
        if (result.error) job.lastError = String(result.error);
        job.index += 1;
        writeBulkEnhanceJob(job);

        window.dispatchEvent(
          new CustomEvent('agency-os-bulk-enhance-item-complete', {
            detail: {
              key,
              success,
              result,
              index: job.index - 1,
              total: job.keys.length,
            },
          })
        );

        updateBulkEnhanceBellBadge(job.index, job.keys.length);
      }

      const final = readBulkEnhanceJob();
      if (final) {
        summary.successCount = final.successCount || 0;
        summary.attempted = final.attempted || 0;
        summary.lastError = final.lastError || '';
      }
    } finally {
      bulkEnhanceProcessorLock = false;
      writeBulkEnhanceJob(null);
      updateBulkEnhanceBellBadge(0, 0);
      if (typeof window.updateProcessingStatus === 'function') {
        window.updateProcessingStatus(false);
      }
      applyProcessingRing();
      const enhancePingDone = document.getElementById('notificationPing');
      if (enhancePingDone && !syncEnhanceSessionActive()) {
        enhancePingDone.classList.remove('animate-ping');
        enhancePingDone.classList.add('hidden');
      }
      if (summary.attempted > 0) {
        const body =
          summary.successCount > 0
            ? 'Updated ' +
              summary.successCount +
              ' of ' +
              summary.attempted +
              ' lead' +
              (summary.attempted === 1 ? '' : 's') +
              ' via API (no new tabs).'
            : summary.lastError ||
              'No new contact or review data found for the selected lead(s).';
        pushClientBellNotification({
          headline: summary.successCount > 0 ? 'Bulk enhance finished' : 'Bulk enhance complete',
          body,
          href: '/prospecting',
          linkLabel: 'Open pipeline →',
        });
        if (typeof window.showAppToast === 'function') {
          window.showAppToast(body, {
            variant: summary.successCount > 0 ? 'success' : summary.lastError ? 'warning' : 'info',
            duration: 9000,
          });
        }
      }
      window.dispatchEvent(new CustomEvent('agency-os-bulk-enhance-finished', { detail: summary }));
    }
  }

  const GHL_SYNC_JOB_KEY = 'agencyOsGhlSyncJob';
  const GHL_PAUSED_TOAST_KEY = 'agencyOsGhlSyncPausedToast';
  let ghlSyncProcessorLock = false;
  let ghlSyncCancelRequested = false;
  /** True while the document is unloading — remaining contacts must pause, not fail. */
  let ghlSyncNavPaused = false;
  const ghlSyncWaiters = [];

  function isTransientGhlSyncError(err) {
    if (!err) return false;
    if (err.name === 'AbortError' || err.name === 'TimeoutError') return true;
    const msg = String(err.message || err || '').toLowerCase();
    // Only navigation / network aborts pause the queue. Rate limits are retried server-side;
    // remaining leads keep processing with client pacing.
    return /failed to fetch|networkerror|load failed|network request failed|aborted|the operation was aborted/.test(
      msg,
    );
  }

  /** Errors that will fail every remaining lead — pause so the user can fix and resume. */
  function isSystemicGhlSyncError(errOrMsg) {
    const msg = String(
      (errOrMsg && errOrMsg.message) || errOrMsg || '',
    ).toLowerCase();
    if (!msg) return false;
    return /rate limit|too many requests|does not have access to this location|ghl is not configured|api key is not configured|location id is not configured|token does not have access|unauthorized|401|403/.test(
      msg,
    );
  }

  function ghlSyncPaceMs() {
    // Stay under GHL's ~100 req / 10s burst — each fast-list lead still uses several API calls.
    return 750;
  }

  try {
    window.addEventListener('pagehide', function () {
      if (isGhlSyncJobRunning()) ghlSyncNavPaused = true;
    });
    window.addEventListener('pageshow', function () {
      ghlSyncNavPaused = false;
    });
  } catch (_) {}

  function readGhlSyncJob() {
    try {
      const raw = sessionStorage.getItem(GHL_SYNC_JOB_KEY);
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (!o || !Array.isArray(o.keys)) return null;
      return o;
    } catch (_) {
      return null;
    }
  }

  function writeGhlSyncJob(job) {
    try {
      if (!job) sessionStorage.removeItem(GHL_SYNC_JOB_KEY);
      else sessionStorage.setItem(GHL_SYNC_JOB_KEY, JSON.stringify(job));
    } catch (_) {}
  }

  function isGhlSyncJobRunning() {
    const j = readGhlSyncJob();
    return !!(j && j.running === true && j.index < j.keys.length);
  }

  function isGhlSyncCancelPending() {
    const j = readGhlSyncJob();
    return !!(ghlSyncCancelRequested || (j && j.cancelRequested === true));
  }

  /**
   * Drop a paused or finished queue from session storage and reset the bell.
   * Contacts already pushed to GHL are not rolled back.
   */
  function clearGhlSyncJobState(opts) {
    opts = opts || {};
    var job = readGhlSyncJob();
    var summary = {
      ok: false,
      cancelled: true,
      dismissed: opts.dismissed !== false,
      pushed: (job && job.pushedCount) || 0,
      failed: (job && job.failedCount) || 0,
      total: job && Array.isArray(job.keys) ? job.keys.length : 0,
      processed: (job && job.index) || 0,
      label: (job && job.label) || 'GHL sync',
      href: (job && job.href) || '/prospecting?tab=pipeline',
      results: [],
    };
    ghlSyncCancelRequested = false;
    ghlSyncProcessorLock = false;
    writeGhlSyncJob(null);
    try {
      sessionStorage.removeItem(GHL_PAUSED_TOAST_KEY);
    } catch (_) {}
    updateBulkEnhanceBellBadge(0, 0);
    if (typeof window.updateProcessingStatus === 'function') {
      window.updateProcessingStatus(false);
    }
    if (typeof applyProcessingRing === 'function') applyProcessingRing();
    var ping = document.getElementById('notificationPing');
    if (ping) ping.classList.add('hidden');
    window.dispatchEvent(new CustomEvent('agency-os-ghl-sync-finished', { detail: summary }));
    finishGhlSyncWaiters(summary);
    if (typeof window.showAppToast === 'function' && opts.toast !== false) {
      window.showAppToast('GHL sync cleared. Contacts already pushed stay in GHL.', {
        variant: 'info',
        duration: 6500,
      });
    }
    return summary;
  }

  /**
   * Ask the queue to stop after the lead currently being written to GHL.
   * The in-flight request is never aborted — a half-written contact is worse than one extra push.
   * When paused on a config error there is nothing in flight — clear the job immediately.
   * @returns {boolean} true when a running job was asked to stop.
   */
  function requestGhlSyncCancel() {
    const job = readGhlSyncJob();
    if (!job) return false;
    if (job.pausedForError) {
      clearGhlSyncJobState({ dismissed: true });
      return true;
    }
    if (job.running !== true || job.index >= job.keys.length) return false;
    ghlSyncCancelRequested = true;
    job.cancelRequested = true;
    writeGhlSyncJob(job);
    updateBulkEnhanceBellBadge(job.index, job.keys.length, (job.label || 'GHL sync') + ' (stopping)');
    if (typeof window.showAppToast === 'function') {
      window.showAppToast('Stopping sync after the current contact…', {
        variant: 'info',
        duration: 5000,
      });
    }
    window.dispatchEvent(
      new CustomEvent('agency-os-ghl-sync-cancelling', {
        detail: { current: job.index, total: job.keys.length },
      }),
    );
    return true;
  }

  function emitGhlSyncProgress(detail) {
    window.dispatchEvent(new CustomEvent('agency-os-ghl-sync-progress', { detail: detail || {} }));
    ghlSyncWaiters.forEach(function (w) {
      if (w && typeof w.onProgress === 'function') w.onProgress(detail || {});
    });
  }

  function finishGhlSyncWaiters(summary) {
    const waiters = ghlSyncWaiters.splice(0, ghlSyncWaiters.length);
    waiters.forEach(function (w) {
      if (w && typeof w.resolve === 'function') w.resolve(summary);
    });
  }

  function failGhlSyncWaiters(err) {
    const waiters = ghlSyncWaiters.splice(0, ghlSyncWaiters.length);
    waiters.forEach(function (w) {
      if (w && typeof w.reject === 'function') w.reject(err);
    });
  }

  function activateNavbarWorkBell(label) {
    if (typeof window.updateProcessingStatus === 'function') {
      window.updateProcessingStatus(true);
    }
    if (processingIndicator) processingIndicator.classList.add('processing-active');
    const ping = document.getElementById('notificationPing');
    if (ping) {
      ping.classList.remove('hidden');
      ping.classList.add('animate-ping');
    }
    const job = readGhlSyncJob();
    if (job) updateBulkEnhanceBellBadge(job.index, job.keys.length, label || 'GHL sync');
  }

  function buildGhlSyncProgressBellHtml(job) {
    if (!job) return '';
    const current = Math.min(job.index + 1, job.keys.length);
    const total = job.keys.length;
    const pushed = job.pushedCount || 0;
    const failed = job.failedCount || 0;
    const stopping = job.cancelRequested === true || ghlSyncCancelRequested;
    const paused = job.pausedForError === true;
    const spinClass = paused || stopping ? '' : ' animate-spin';
    return (
      '<div class="p-4 border-b border-brand-border/10 bg-orange-500/5 dark:bg-orange-500/10">' +
      '<div class="flex items-start gap-3">' +
      '<div class="w-8 h-8 rounded-full bg-orange-500/15 flex items-center justify-center text-orange-600 dark:text-orange-300 shrink-0">' +
      '<svg class="w-4 h-4' +
      spinClass +
      '" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>' +
      '</div><div class="min-w-0">' +
      '<div class="text-[11px] font-black text-brand-dark dark:text-white uppercase tracking-tight mb-0.5">' +
      escapeBellHtml(job.label || 'GHL sync') +
      (paused ? ' paused' : stopping ? ' stopping' : ' in progress') +
      '</div>' +
      '<div class="text-[10px] font-bold text-brand-muted dark:text-slate-400 leading-tight">' +
      escapeBellHtml(String(current) + ' of ' + String(total) + ' contacts') +
      (pushed || failed ? ' · ' + pushed + ' synced' + (failed ? ', ' + failed + ' failed' : '') : '') +
      '</div>' +
      (job.lastError
        ? '<div class="mt-1 text-[9px] font-semibold text-red-700/90 dark:text-red-300/90 leading-snug break-words">' +
          escapeBellHtml(String(job.lastError).slice(0, 220)) +
          '</div>'
        : '') +
      '<div class="mt-1 text-[9px] font-semibold text-brand-muted dark:text-slate-500">' +
      (stopping
        ? 'Finishing the current contact, then stopping. Contacts already pushed stay in GHL.'
        : job.pausedForError
          ? 'Paused — fix the error above, then resume. Contacts already pushed stay in GHL.'
          : 'OK to open other AdHello pages — sync resumes there. Keep this browser tab open.') +
      '</div>' +
      (stopping
        ? '<div class="mt-2 text-[9px] font-black uppercase tracking-widest text-brand-muted dark:text-slate-400">Stopping…</div>'
        : job.pausedForError
          ? '<div class="mt-2 flex flex-wrap gap-2">' +
            '<button type="button" class="btn-pill rounded-full bg-orange-500 text-white px-3 py-1 text-[9px] font-black uppercase tracking-widest" ' +
            'onclick="event.stopPropagation();if(window.agencyOsGhlSync&amp;&amp;window.agencyOsGhlSync.resume)window.agencyOsGhlSync.resume();" ' +
            'title="Resume syncing remaining contacts">Resume sync</button>' +
            '<button type="button" class="btn-solid btn-solid--stop rounded-full px-3 py-1 text-[9px] font-black uppercase tracking-widest" ' +
            'onclick="event.stopPropagation();if(window.agencyOsGhlSync&amp;&amp;window.agencyOsGhlSync.dismiss)window.agencyOsGhlSync.dismiss();" ' +
            'title="Clear this paused sync from the bell — contacts already pushed stay in GHL">Clear sync</button>' +
            '</div>'
          : '<button type="button" class="btn-solid btn-solid--stop mt-2 rounded-full px-3 py-1 text-[9px] font-black uppercase tracking-widest" ' +
            'onclick="event.stopPropagation();if(window.agencyOsGhlSync&amp;&amp;window.agencyOsGhlSync.cancel)window.agencyOsGhlSync.cancel();" ' +
            'title="Stop after the contact currently syncing — anything already pushed stays in GHL">Stop sync</button>') +
      '</div></div></div>'
    );
  }

  async function pushSingleLeadKeyToGhl(leadKey, job) {
    const j = job && typeof job === 'object' ? job : {};
    const payload = {
      leadKeys: [String(leadKey || '').trim()],
      tagNoWebsite: j.tagNoWebsite === true,
    };
    if (j.focusMode) {
      payload.focusMode = true;
      payload.source = 'focus';
    }
    // Opt-in contact + tags only mode — keeps bulk list requests under the proxy timeout.
    if (j.listSyncFast === true) payload.listSyncFast = true;
    if (Array.isArray(j.extraTagNames) && j.extraTagNames.length) {
      payload.extraTagNames = j.extraTagNames;
    }
    const res = await fetch('/ghl/push', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok || !data.success) {
      throw new Error((data && data.error) || 'HTTP ' + res.status);
    }
    return data;
  }

  async function processGhlSyncQueue() {
    if (ghlSyncProcessorLock) return;
    ghlSyncProcessorLock = true;
    ghlSyncNavPaused = false;
    var summary = { ok: true, pushed: 0, failed: 0, total: 0, results: [], paused: false };
    try {
      while (true) {
        var job = readGhlSyncJob();
        if (!job || !job.running || job.index >= job.keys.length) break;

        var key = job.keys[job.index];
        var total = job.keys.length;
        summary.label = job.label || 'GHL sync';
        summary.href = job.href || '/prospecting?tab=pipeline';
        summary.tagNames = Array.isArray(job.extraTagNames) ? job.extraTagNames : [];

        // Stop between leads so nothing is left half-written in GHL.
        if (ghlSyncCancelRequested || job.cancelRequested === true) {
          summary.cancelled = true;
          break;
        }

        if (ghlSyncNavPaused) {
          summary.paused = true;
          writeGhlSyncJob(job);
          break;
        }

        try {
          // eslint-disable-next-line no-await-in-loop
          var data = await pushSingleLeadKeyToGhl(key, job);
          if (ghlSyncNavPaused) {
            // Request may have completed server-side; advance so we do not double-push.
            job.index += 1;
            if (data && data.pushed > 0) job.pushedCount = (job.pushedCount || 0) + data.pushed;
            writeGhlSyncJob(job);
            summary.paused = true;
            break;
          }
          var leadPushed = data.pushed != null ? data.pushed : 0;
          var leadFailed = data.failed != null ? data.failed : 0;
          if (leadPushed > 0) {
            job.pushedCount = (job.pushedCount || 0) + leadPushed;
            job.lastError = '';
          } else if (leadFailed > 0) {
            var failRow = Array.isArray(data.results)
              ? data.results.find(function (r) {
                  return r && r.ok === false;
                })
              : null;
            job.lastError = (failRow && failRow.error) || data.error || 'GHL sync failed';
            if (isSystemicGhlSyncError(job.lastError)) {
              writeGhlSyncJob(job);
              summary.paused = true;
              summary.pauseReason = job.lastError;
              if (typeof window.showAppToast === 'function') {
                window.showAppToast(
                  'GHL sync paused — ' + String(job.lastError).slice(0, 280),
                  { variant: 'error', duration: 14000 },
                );
              }
              break;
            }
            job.failedCount = (job.failedCount || 0) + leadFailed;
          } else {
            job.failedCount = (job.failedCount || 0) + 1;
            job.lastError = (data && data.error) || 'GHL sync returned no contact';
          }
          if (Array.isArray(data.results)) summary.results = summary.results.concat(data.results);
        } catch (err) {
          // Leaving the page aborts in-flight fetches. Pause — do not fail the rest of the queue.
          if (ghlSyncNavPaused || isTransientGhlSyncError(err)) {
            job.lastError = err && err.message ? err.message : String(err);
            writeGhlSyncJob(job);
            summary.paused = true;
            break;
          }
          job.lastError = err && err.message ? err.message : String(err);
          if (isSystemicGhlSyncError(err) || isSystemicGhlSyncError(job.lastError)) {
            writeGhlSyncJob(job);
            summary.paused = true;
            summary.pauseReason = job.lastError;
            if (typeof window.showAppToast === 'function') {
              window.showAppToast(
                'GHL sync paused — ' + String(job.lastError).slice(0, 280),
                { variant: 'error', duration: 14000 },
              );
            }
            break;
          }
          job.failedCount = (job.failedCount || 0) + 1;
          summary.results.push({ key: key, ok: false, error: job.lastError });
        }

        job.index += 1;
        // Pace between leads so we stay under GHL's burst rate limit.
        // eslint-disable-next-line no-await-in-loop
        await new Promise(function (r) {
          setTimeout(r, ghlSyncPaceMs());
        });
        // A Stop click during the request above wrote the flag to storage; keep it.
        var pendingCancel = readGhlSyncJob();
        if (ghlSyncCancelRequested || (pendingCancel && pendingCancel.cancelRequested === true)) {
          job.cancelRequested = true;
        }
        writeGhlSyncJob(job);
        emitGhlSyncProgress({
          current: job.index,
          total: total,
          remaining: Math.max(0, total - job.index),
          pushed: job.pushedCount || 0,
          failed: job.failedCount || 0,
          lastError: job.lastError || '',
        });
        updateBulkEnhanceBellBadge(job.index, total, job.label || 'GHL sync');
      }

      var finalJob = readGhlSyncJob();
      if (finalJob) {
        summary.pushed = finalJob.pushedCount || 0;
        summary.failed = finalJob.failedCount || 0;
        summary.total = finalJob.keys.length;
        summary.processed = finalJob.index || 0;
        summary.ok = summary.failed === 0;
        if (finalJob.cancelRequested === true) summary.cancelled = true;
      }
    } finally {
      ghlSyncProcessorLock = false;

      // Navigating away or systemic API errors: keep the job so the next AdHello page can resume.
      if (summary.paused) {
        ghlSyncCancelRequested = false;
        var pausedJob = readGhlSyncJob();
        if (pausedJob) {
          if (summary.pauseReason) {
            pausedJob.pausedForError = true;
            pausedJob.lastError = summary.pauseReason;
            writeGhlSyncJob(pausedJob);
          }
          activateNavbarWorkBell(pausedJob.label || 'GHL sync');
          updateBulkEnhanceBellBadge(
            pausedJob.index,
            pausedJob.keys.length,
            pausedJob.label || 'GHL sync',
          );
          emitGhlSyncProgress({
            current: pausedJob.index,
            total: pausedJob.keys.length,
            remaining: Math.max(0, pausedJob.keys.length - pausedJob.index),
            pushed: pausedJob.pushedCount || 0,
            failed: pausedJob.failedCount || 0,
            lastError: pausedJob.lastError || summary.pauseReason || '',
            paused: true,
          });
        }
        return;
      }

      ghlSyncCancelRequested = false;
      writeGhlSyncJob(null);
      updateBulkEnhanceBellBadge(0, 0);
      if (typeof window.updateProcessingStatus === 'function') {
        window.updateProcessingStatus(false);
      }
      applyProcessingRing();

      if (summary.total > 0) {
        var syncLabel = summary.label || 'GHL sync';
        var doneMsg = summary.cancelled
          ? syncLabel +
            ' stopped · ' +
            summary.pushed +
            ' of ' +
            summary.total +
            ' synced' +
            (summary.failed ? ' · ' + summary.failed + ' failed' : '') +
            ' · contacts already pushed stay in GHL'
          : syncLabel +
            ' complete · ' +
            summary.pushed +
            ' contact' +
            (summary.pushed === 1 ? '' : 's') +
            (summary.failed ? ' · ' + summary.failed + ' failed' : '') +
            (summary.tagNames && summary.tagNames.length ? ' · ' + summary.tagNames.join(', ') : '');
        pushClientBellNotification({
          headline: summary.cancelled
            ? syncLabel + ' stopped'
            : summary.failed
              ? syncLabel + ' finished with errors'
              : syncLabel + ' complete',
          body: doneMsg,
          href: summary.href || '/prospecting?tab=pipeline',
          // No browser alert for a stop the user just clicked — and never one that reads like success.
          desktop: !summary.cancelled,
          desktopTag: 'agency-os-ghl-sync',
        });
        if (typeof window.showAppToast === 'function') {
          window.showAppToast(doneMsg, {
            variant: summary.cancelled ? 'warning' : summary.failed ? 'error' : 'success',
            duration: summary.failed || summary.cancelled ? 9000 : 5000,
          });
        }
        var pingDone = document.getElementById('notificationPing');
        if (pingDone) {
          pingDone.classList.remove('hidden');
          pingDone.classList.add('animate-ping');
        }
      }

      window.dispatchEvent(new CustomEvent('agency-os-ghl-sync-finished', { detail: summary }));
      finishGhlSyncWaiters(summary);
    }
  }

  window.agencyOsGhlSync = {
    isRunning() {
      return isGhlSyncJobRunning();
    },
    isCancelPending() {
      return isGhlSyncCancelPending();
    },
    cancel() {
      return requestGhlSyncCancel();
    },
    dismiss() {
      if (!readGhlSyncJob()) return false;
      clearGhlSyncJobState({ dismissed: true });
      return true;
    },
    readJob() {
      return readGhlSyncJob();
    },
    buildProgressHtml(job) {
      return buildGhlSyncProgressBellHtml(job || readGhlSyncJob());
    },
    /** Resume a queue paused by rate-limit / auth errors (or after a tab reload). */
    resume() {
      var job = readGhlSyncJob();
      if (!job || !Array.isArray(job.keys) || job.index >= job.keys.length) return false;
      job.pausedForError = false;
      job.running = true;
      job.cancelRequested = false;
      writeGhlSyncJob(job);
      ghlSyncCancelRequested = false;
      activateNavbarWorkBell(job.label || 'GHL sync');
      emitGhlSyncProgress({
        current: job.index,
        total: job.keys.length,
        remaining: Math.max(0, job.keys.length - job.index),
        pushed: job.pushedCount || 0,
        failed: job.failedCount || 0,
        lastError: '',
        paused: false,
      });
      processGhlSyncQueue().catch(function (err) {
        console.warn('[ghl-sync-resume]', err);
        failGhlSyncWaiters(err);
      });
      return true;
    },
    run(opts) {
      opts = opts || {};
      var leadKeys = Array.isArray(opts.leadKeys)
        ? opts.leadKeys.map(function (k) {
            return String(k || '').trim();
          }).filter(Boolean)
        : [];
      var total = leadKeys.length;
      if (!total) {
        return Promise.resolve({ ok: true, pushed: 0, failed: 0, total: 0, results: [] });
      }

      return new Promise(function (resolve, reject) {
        ghlSyncWaiters.push({
          resolve: resolve,
          reject: reject,
          onProgress: typeof opts.onProgress === 'function' ? opts.onProgress : null,
        });

        if (isGhlSyncJobRunning()) return;

        ghlSyncCancelRequested = false;
        var job = {
          keys: leadKeys,
          index: 0,
          running: true,
          cancelRequested: false,
          tagNoWebsite: opts.tagNoWebsite !== false,
          focusMode: opts.focusMode === true,
          listSyncFast: opts.listSyncFast === true,
          extraTagNames: Array.isArray(opts.extraTagNames)
            ? opts.extraTagNames
                .map(function (t) {
                  return String(t || '').trim();
                })
                .filter(Boolean)
            : [],
          label: String(opts.label || 'GHL sync').slice(0, 40),
          href: String(opts.href || '/prospecting?tab=pipeline'),
          pushedCount: 0,
          failedCount: 0,
          startedAt: Date.now(),
        };
        writeGhlSyncJob(job);
        activateNavbarWorkBell(job.label);
        emitGhlSyncProgress({ current: 0, total: total, remaining: total, pushed: 0, failed: 0 });
        processGhlSyncQueue().catch(function (err) {
          console.warn('[ghl-sync]', err);
          failGhlSyncWaiters(err);
        });
      });
    },
  };

  window.agencyOsBulkEnhance = {
    isRunning() {
      return isBulkEnhanceJobRunning();
    },
    start(keys) {
      if (!keys || !keys.length) return;
      if (isBulkEnhanceJobRunning() || bulkEnhanceProcessorLock) {
        if (typeof window.showAppToast === 'function') {
          window.showAppToast('Bulk enhance already running — check the bell for progress.', {
            variant: 'info',
            duration: 7000,
          });
        }
        return;
      }
      const list = keys.slice(0, 20).filter(Boolean);
      if (!list.length) return;
      const job = {
        keys: list,
        index: 0,
        running: true,
        successCount: 0,
        attempted: 0,
        startedAt: Date.now(),
      };
      writeBulkEnhanceJob(job);
      if (typeof window.updateProcessingStatus === 'function') {
        window.updateProcessingStatus(true);
      }
      updateBulkEnhanceBellBadge(0, list.length);
      if (processingIndicator) processingIndicator.classList.add('processing-active');
      const enhancePing = document.getElementById('notificationPing');
      if (enhancePing) {
        enhancePing.classList.remove('hidden');
        enhancePing.classList.add('animate-ping');
      }
      processBulkEnhanceQueue().catch((e) => console.warn('[bulk-enhance]', e));
    },
  };

  const CONTACT_HUNT_JOB_KEY = 'agencyOsContactHuntJob';
  const CLIENT_BELL_NOTIFS_KEY = 'agencyOsClientBellNotifs';
  let contactHuntPollLock = false;
  const contactHuntWaiters = new Map();

  function readContactHuntJob() {
    try {
      const raw = sessionStorage.getItem(CONTACT_HUNT_JOB_KEY);
      if (!raw) return null;
      const o = JSON.parse(raw);
      return o && o.leadKey ? o : null;
    } catch (_) {
      return null;
    }
  }

  function writeContactHuntJob(job) {
    try {
      if (!job) sessionStorage.removeItem(CONTACT_HUNT_JOB_KEY);
      else sessionStorage.setItem(CONTACT_HUNT_JOB_KEY, JSON.stringify(job));
    } catch (_) {}
  }

  function readClientBellNotifications() {
    try {
      const raw = sessionStorage.getItem(CLIENT_BELL_NOTIFS_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (_) {
      return [];
    }
  }

  /**
   * Browser-level notification so finished background work is visible from another tab.
   * No-ops unless the user already granted permission and reminders are not paused.
   */
  function notifyDesktopJobComplete(title, body, tag) {
    try {
      if (!('Notification' in window)) return false;
      if (Notification.permission !== 'granted') return false;
      if (
        window.AgencyTaskReminders &&
        typeof window.AgencyTaskReminders.isPaused === 'function' &&
        window.AgencyTaskReminders.isPaused()
      ) {
        return false;
      }
      const note = new Notification(String(title || 'Agency OS').slice(0, 90), {
        body: String(body || '').slice(0, 180),
        tag: tag || 'agency-os-job',
      });
      note.onclick = function () {
        try {
          window.focus();
        } catch (_) {}
        note.close();
      };
      return true;
    } catch (_) {
      return false;
    }
  }

  window.agencyOsNotifyDesktop = notifyDesktopJobComplete;

  /** Prompt for notification permission — must be called from a user gesture (e.g. Sync click). */
  window.agencyOsRequestDesktopNotify = function requestDesktopNotify() {
    try {
      if (!('Notification' in window)) return Promise.resolve('unsupported');
      if (Notification.permission !== 'default') return Promise.resolve(Notification.permission);
      return Promise.resolve(Notification.requestPermission()).catch(function () {
        return 'denied';
      });
    } catch (_) {
      return Promise.resolve('denied');
    }
  };

  function pushClientBellNotification(item) {
    try {
      const list = readClientBellNotifications();
      list.unshift({
        id: 'bell-' + Date.now(),
        isRead: false,
        at: Date.now(),
        ...item,
      });
      sessionStorage.setItem(CLIENT_BELL_NOTIFS_KEY, JSON.stringify(list.slice(0, 12)));
    } catch (_) {}
    if (item && item.desktop) {
      notifyDesktopJobComplete(
        item.headline || 'Agency OS',
        item.body || '',
        item.desktopTag || 'agency-os-job',
      );
    }
  }

  function markClientBellNotificationsRead() {
    try {
      const list = readClientBellNotifications().map((n) => ({ ...n, isRead: true }));
      sessionStorage.setItem(CLIENT_BELL_NOTIFS_KEY, JSON.stringify(list));
    } catch (_) {}
  }

  function renderClientBellNotifications(notificationList, notificationPing) {
    const items = readClientBellNotifications().filter((n) => !n.isRead);
    if (!items.length) return false;
    if (notificationPing) {
      notificationPing.classList.remove('hidden');
      notificationPing.classList.add('animate-ping');
    }
    if (!notificationList) return true;
    const blocks = items
      .slice(0, 5)
      .map((n) => {
        const title = escapeBellHtml(n.headline || 'Contact hunt ready');
        const sub = escapeBellHtml(n.body || '');
        const href = n.href || '/leads';
        const linkLabel = escapeBellHtml(n.linkLabel || 'Open →');
        return (
          '<div class="p-4 hover:bg-brand-cream/30 dark:hover:bg-white/5 transition-colors cursor-pointer group/notif border-b border-brand-border/10 last:border-0" onclick="window.location.href=\'' +
          href +
          '\'">' +
          '<div class="flex items-start gap-3">' +
          '<div class="w-8 h-8 rounded-full bg-brand-yellow/10 flex items-center justify-center text-brand-yellow shrink-0">' +
          '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>' +
          '</div><div>' +
          '<div class="text-[11px] font-black text-brand-dark dark:text-white uppercase tracking-tight mb-0.5">' +
          title +
          '</div>' +
          '<div class="text-[10px] font-bold text-brand-muted dark:text-slate-400 leading-tight">' +
          sub +
          '</div>' +
          '<div class="mt-2 text-[9px] font-black uppercase text-brand-yellow group-hover/notif:translate-x-1 transition-transform">' +
          linkLabel +
          '</div>' +
          '</div></div></div>'
        );
      })
      .join('');
    notificationList.innerHTML = blocks;
    return true;
  }

  function isContactHuntJobRunning() {
    const j = readContactHuntJob();
    return !!(j && j.running);
  }

  function resolveContactHuntWaiters(leadKey, payload) {
    const w = contactHuntWaiters.get(leadKey);
    if (w) {
      contactHuntWaiters.delete(leadKey);
      w.resolve(payload);
    }
    window.dispatchEvent(
      new CustomEvent('agency-os-contact-hunt-finished', {
        detail: { leadKey, ...payload },
      })
    );
  }

  async function pollContactHuntJobOnce(job) {
    const polled = await fetchJsonWithTimeout(
      '/leads/' + encodeURIComponent(job.leadKey) + '/enhance-status',
      {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      },
      30000,
    );
    const d = polled.data || {};
    if (d.status === 'processing') return null;
    if (d.status === 'done') {
      return {
        success: !!d.success,
        lead: d.lead,
        data: d.data,
        error: d.error,
        reviewHunt: d.reviewHunt,
      };
    }
    if (d.status === 'error') {
      return { success: false, error: d.error || 'Contact hunt failed.' };
    }
    if (d.status === 'idle') return { success: false, error: 'idle', _idle: true };
    return { success: false, error: d.error || 'Status check failed.' };
  }

  async function pollLeadEnhanceUntilDone(leadKey, opts) {
    const maxMs = opts && opts.maxMs != null ? opts.maxMs : BULK_ENHANCE_LEAD_TIMEOUT_MS;
    const interval = opts && opts.interval != null ? opts.interval : 2500;
    const deadline = Date.now() + maxMs;
    const started = Date.now();
    let idleStreak = 0;
    while (Date.now() < deadline) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, interval));
      // eslint-disable-next-line no-await-in-loop
      const tick = await pollContactHuntJobOnce({ leadKey: leadKey });
      if (!tick) {
        idleStreak = 0;
        continue;
      }
      if (tick._idle) {
        idleStreak += 1;
        if (Date.now() - started < 20000 && idleStreak < 8) continue;
        return {
          success: false,
          error: 'Enhance ended before results were ready. Refresh and try again.',
        };
      }
      return tick;
    }
    return {
      success: false,
      error: 'Enhance is taking longer than expected. Check back in a minute.',
    };
  }

  window.__pollLeadEnhanceUntilDone = pollLeadEnhanceUntilDone;

  async function runContactHuntPollLoop() {
    if (contactHuntPollLock) return;
    contactHuntPollLock = true;
    try {
      while (true) {
        const job = readContactHuntJob();
        if (!job || !job.running) break;
        if (Date.now() - (job.startedAt || 0) > 180000) {
          writeContactHuntJob(null);
          resolveContactHuntWaiters(job.leadKey, {
            success: false,
            error: 'Contact hunt timed out. Reopen the lead to see any saved data.',
          });
          pushClientBellNotification({
            headline: 'Contact hunt timed out',
            body: (job.title || 'Lead') + ' — partial data may have been saved.',
            href: '/leads',
          });
          if (typeof window.showAppToast === 'function') {
            window.showAppToast('Contact hunt timed out for ' + (job.title || 'lead') + '.', {
              variant: 'warning',
              duration: 9000,
            });
          }
          break;
        }
        let result = null;
        try {
          result = await pollContactHuntJobOnce(job);
        } catch (err) {
          result = { success: false, error: err && err.message ? err.message : 'Poll failed' };
        }
        if (!result) {
          await new Promise((r) => setTimeout(r, 2500));
          continue;
        }
        if (result._idle) {
          job._idleStreak = (job._idleStreak || 0) + 1;
          writeContactHuntJob(job);
          if (job._idleStreak < 10) {
            await new Promise((r) => setTimeout(r, 2500));
            continue;
          }
          result = { success: false, error: 'Contact hunt ended before results were ready.' };
        }
        writeContactHuntJob(null);
        const title = job.title || 'Lead';
        if (result.success) {
          pushClientBellNotification({
            headline: 'Contact hunt complete',
            body: title + ' — website, contacts, and review summary saved.',
            href: '/leads',
          });
          if (typeof window.showAppToast === 'function') {
            window.showAppToast('Contact hunt complete for ' + title + '.', {
              variant: 'success',
              duration: 6000,
            });
          }
        } else {
          pushClientBellNotification({
            headline: 'Contact hunt finished',
            body: title + ' — ' + String(result.error || 'No new data found.'),
            href: '/leads',
          });
          if (typeof window.showAppToast === 'function') {
            window.showAppToast(String(result.error || 'Contact hunt finished with no new data.'), {
              variant: 'warning',
              duration: 9000,
            });
          }
        }
        if (typeof window.updateProcessingStatus === 'function') {
          window.updateProcessingStatus(false);
        }
        resolveContactHuntWaiters(job.leadKey, result);
        break;
      }
    } finally {
      contactHuntPollLock = false;
      if (isContactHuntJobRunning()) {
        runContactHuntPollLoop().catch((e) => console.warn('[contact-hunt-poll]', e));
      }
    }
  }

  window.agencyOsContactHunt = {
    isRunning() {
      return isContactHuntJobRunning();
    },
    track({ leadKey, title }) {
      if (!leadKey) return;
      writeContactHuntJob({
        leadKey: String(leadKey).trim(),
        title: String(title || '').trim() || 'Lead',
        running: true,
        startedAt: Date.now(),
        _idleStreak: 0,
      });
      if (typeof window.updateProcessingStatus === 'function') {
        window.updateProcessingStatus(true);
      }
      const ping = document.getElementById('notificationPing');
      if (ping) {
        ping.classList.remove('hidden');
        ping.classList.add('animate-ping');
      }
      runContactHuntPollLoop().catch((e) => console.warn('[contact-hunt-poll]', e));
    },
    waitFor(leadKey) {
      const key = String(leadKey || '').trim();
      if (!key) return Promise.resolve({ success: false, error: 'Missing lead key' });
      return new Promise((resolve) => {
        contactHuntWaiters.set(key, { resolve });
      });
    },
  };

  const ARTWORK_GEN_JOB_KEY = 'agencyOsArtworkGenJob';
  const ARTWORK_READY_KEY = 'agencyOsArtworkReady';
  let artworkGenPollLock = false;
  const artworkGenWaiters = new Map();

  function readArtworkGenJob() {
    try {
      const raw = sessionStorage.getItem(ARTWORK_GEN_JOB_KEY);
      if (!raw) return null;
      const o = JSON.parse(raw);
      return o && o.taskId ? o : null;
    } catch (_) {
      return null;
    }
  }

  function writeArtworkGenJob(job) {
    try {
      if (!job) sessionStorage.removeItem(ARTWORK_GEN_JOB_KEY);
      else sessionStorage.setItem(ARTWORK_GEN_JOB_KEY, JSON.stringify(job));
    } catch (_) {}
  }

  function isArtworkGenJobRunning() {
    const j = readArtworkGenJob();
    return !!(j && j.running);
  }

  function updateArtworkGenBellBadge(job) {
    const el = document.getElementById('bulkEnhanceBellBadge');
    if (!el || !job) return;
    el.textContent = 'ART';
    el.classList.remove('hidden');
    el.setAttribute(
      'title',
      'Generating ' + (job.label || 'artwork') + ' in Marketing Studio — safe to change pages',
    );
  }

  function pushGeneratedDesignRecord(storageKey, item, max) {
    try {
      const raw = localStorage.getItem(storageKey) || '[]';
      let list = JSON.parse(raw);
      if (!Array.isArray(list)) list = [];
      list = list.filter((x) => {
        if (!x) return false;
        if (x.imageUrl === item.imageUrl) return false;
        if (item.taskId && x.taskId && x.taskId === item.taskId) return false;
        return true;
      });
      list.unshift(item);
      localStorage.setItem(storageKey, JSON.stringify(list.slice(0, max)));
    } catch (_) {}
  }

  function rememberGeneratedArtwork(job, result) {
    const imageUrl = String((result && result.imageUrl) || '').trim();
    if (!imageUrl) return;
    const base = {
      taskId: String((job && job.taskId) || ''),
      slot: result.slot === 'back' || (job && job.slot === 'back') ? 'back' : 'front',
      imageUrl,
      prompt: String((job && job.prompt) || '').trim(),
      aspectRatio: String((job && job.aspectRatio) || '').trim(),
      resolution: String((job && job.resolution) || '').trim(),
      platform: String((job && job.platform) || '').trim(),
      label: String((job && job.label) || 'Artwork').trim() || 'Artwork',
      savedAt: new Date().toISOString(),
    };
    pushGeneratedDesignRecord(
      'adhello_dm_design_history',
      Object.assign({ id: 'dmh_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) }, base),
      48,
    );
    pushGeneratedDesignRecord(
      'adhello_dm_saved_designs',
      Object.assign({ id: 'dm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) }, base),
      24,
    );
  }

  function storeArtworkReadyResult(job, result) {
    try {
      sessionStorage.setItem(
        ARTWORK_READY_KEY,
        JSON.stringify({
          success: true,
          taskId: job.taskId,
          slot: result.slot || job.slot || 'front',
          platform: job.platform || '',
          imageUrl: result.imageUrl,
          prompt: job.prompt || '',
          aspectRatio: job.aspectRatio || '',
          resolution: job.resolution || '',
          logoOverlayApplied: result.logoOverlayApplied,
          logoSkipReason: result.logoSkipReason || null,
          label: job.label || 'Artwork',
          at: Date.now(),
        }),
      );
    } catch (_) {}
  }

  function readArtworkReadyResult() {
    try {
      const raw = sessionStorage.getItem(ARTWORK_READY_KEY);
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (!o || !o.imageUrl) return null;
      if (o.at && Date.now() - o.at > 86400000) {
        sessionStorage.removeItem(ARTWORK_READY_KEY);
        return null;
      }
      return o;
    } catch (_) {
      return null;
    }
  }

  function clearArtworkReadyResult() {
    try {
      sessionStorage.removeItem(ARTWORK_READY_KEY);
    } catch (_) {}
  }

  function buildArtworkGenProgressBellHtml(job) {
    if (!job) return '';
    const label = escapeBellHtml(job.label || 'Marketing Studio artwork');
    return (
      '<div class="p-4 border-b border-brand-border/10 bg-violet-500/5 dark:bg-violet-500/10">' +
      '<div class="flex items-start gap-3">' +
      '<div class="w-8 h-8 rounded-full bg-violet-500/15 flex items-center justify-center text-violet-600 dark:text-violet-300 shrink-0">' +
      '<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>' +
      '</div><div class="min-w-0">' +
      '<div class="text-[11px] font-black text-brand-dark dark:text-white uppercase tracking-tight mb-0.5">Generating artwork</div>' +
      '<div class="text-[10px] font-bold text-brand-muted dark:text-slate-400 leading-tight">' +
      label +
      '</div>' +
      '<div class="mt-1 text-[9px] font-semibold text-brand-muted dark:text-slate-500">Safe to browse other pages — we will ping the bell when artwork finishes.</div>' +
      '</div></div></div>'
    );
  }

  function resolveArtworkGenWaiters(taskId, payload) {
    const w = artworkGenWaiters.get(taskId);
    if (w) {
      artworkGenWaiters.delete(taskId);
      w.resolve(payload);
      return;
    }
    window.dispatchEvent(
      new CustomEvent('agency-os-artwork-gen-finished', {
        detail: { taskId, ...(payload || {}) },
      }),
    );
  }

  async function pollArtworkGenJobOnce(job) {
    const res = await fetch(
      '/direct-mail/api/generate-image/status?taskId=' +
        encodeURIComponent(job.taskId) +
        (job.slot ? '&slot=' + encodeURIComponent(job.slot) : ''),
      { credentials: 'same-origin', headers: { Accept: 'application/json' } },
    );
    const d = await res.json().catch(() => ({}));
    if (d.status === 'success' && d.imageUrl) {
      return { success: true, ...d };
    }
    if (!res.ok || d.status === 'failed' || d.success === false) {
      return { success: false, error: (d && d.error) || 'Image generation failed' };
    }
    return null;
  }

  async function runArtworkGenPollLoop() {
    if (artworkGenPollLock) return;
    artworkGenPollLock = true;
    try {
      while (true) {
        const job = readArtworkGenJob();
        if (!job || !job.running) break;

        if (Date.now() - (job.startedAt || 0) > 180000) {
          writeArtworkGenJob(null);
          const timeoutMsg = (job.label || 'Artwork') + ' timed out — try Generate again.';
          pushClientBellNotification({
            headline: 'Artwork generation timed out',
            body: timeoutMsg,
            href: '/direct-mail?artworkReady=1',
            linkLabel: 'Open Marketing Studio →',
          });
          if (typeof window.showAppToast === 'function') {
            window.showAppToast(timeoutMsg, { variant: 'error', duration: 9000 });
          }
          resolveArtworkGenWaiters(job.taskId, { success: false, error: timeoutMsg });
          break;
        }

        let result = null;
        try {
          result = await pollArtworkGenJobOnce(job);
        } catch (err) {
          result = { success: false, error: err && err.message ? err.message : 'Poll failed' };
        }

        if (!result) {
          await new Promise((r) => setTimeout(r, 4000));
          continue;
        }

        writeArtworkGenJob(null);
        const label = job.label || 'Artwork';
        if (result.success) {
          storeArtworkReadyResult(job, result);
          rememberGeneratedArtwork(job, result);
          pushClientBellNotification({
            headline: 'Artwork ready',
            body: label + ' finished generating — open History in Marketing Studio to review.',
            href: '/direct-mail?artworkReady=1',
            linkLabel: 'Open History →',
          });
          if (typeof window.showAppToast === 'function') {
            window.showAppToast(label + ' is ready — open Marketing Studio from the bell.', {
              variant: 'success',
              duration: 6500,
            });
          }
        } else {
          pushClientBellNotification({
            headline: 'Artwork generation failed',
            body: label + ' — ' + String(result.error || 'Generation failed.'),
            href: '/direct-mail',
            linkLabel: 'Open Marketing Studio →',
          });
          if (typeof window.showAppToast === 'function') {
            window.showAppToast(String(result.error || 'Artwork generation failed.'), {
              variant: 'error',
              duration: 9000,
            });
          }
        }

        if (typeof window.updateProcessingStatus === 'function') {
          window.updateProcessingStatus(false);
        }
        updateBulkEnhanceBellBadge(0, 0);
        applyProcessingRing();
        const pingDone = document.getElementById('notificationPing');
        if (pingDone) {
          pingDone.classList.remove('hidden');
          pingDone.classList.add('animate-ping');
        }
        resolveArtworkGenWaiters(job.taskId, result);
        break;
      }
    } finally {
      artworkGenPollLock = false;
      if (isArtworkGenJobRunning()) {
        runArtworkGenPollLoop().catch((e) => console.warn('[artwork-gen-poll]', e));
      }
    }
  }

  window.agencyOsArtworkGen = {
    isRunning() {
      return isArtworkGenJobRunning();
    },
    readReadyResult() {
      return readArtworkReadyResult();
    },
    consumeReadyResult() {
      const item = readArtworkReadyResult();
      if (item) clearArtworkReadyResult();
      return item;
    },
    buildProgressHtml(job) {
      return buildArtworkGenProgressBellHtml(job || readArtworkGenJob());
    },
    track(opts) {
      opts = opts || {};
      const taskId = String(opts.taskId || '').trim();
      if (!taskId) return;
      const job = {
        taskId,
        slot: opts.slot === 'back' ? 'back' : 'front',
        platform: String(opts.platform || '').trim(),
        label: String(opts.label || 'Artwork').trim() || 'Artwork',
        prompt: String(opts.prompt || '').trim(),
        aspectRatio: String(opts.aspectRatio || '').trim(),
        resolution: String(opts.resolution || '').trim(),
        running: true,
        startedAt: Date.now(),
      };
      writeArtworkGenJob(job);
      if (typeof window.updateProcessingStatus === 'function') {
        window.updateProcessingStatus(true);
      }
      updateArtworkGenBellBadge(job);
      if (processingIndicator) processingIndicator.classList.add('processing-active');
      const ping = document.getElementById('notificationPing');
      if (ping) {
        ping.classList.remove('hidden');
        ping.classList.add('animate-ping');
      }
      runArtworkGenPollLoop().catch((e) => console.warn('[artwork-gen-poll]', e));
    },
    waitFor(taskId) {
      const id = String(taskId || '').trim();
      if (!id) return Promise.resolve({ success: false, error: 'Missing task id' });
      const ready = readArtworkReadyResult();
      if (ready && ready.taskId === id && ready.imageUrl) {
        clearArtworkReadyResult();
        return Promise.resolve({ success: true, ...ready });
      }
      return new Promise((resolve) => {
        artworkGenWaiters.set(id, { resolve });
      });
    },
  };

  const BULK_OUTREACH_JOB_KEY = 'agencyOsBulkOutreachJob';

  function readBulkOutreachJob() {
    try {
      const raw = sessionStorage.getItem(BULK_OUTREACH_JOB_KEY);
      if (!raw) return null;
      const o = JSON.parse(raw);
      return o && o.running ? o : null;
    } catch (_) {
      return null;
    }
  }

  function writeBulkOutreachJob(job) {
    try {
      if (!job) sessionStorage.removeItem(BULK_OUTREACH_JOB_KEY);
      else sessionStorage.setItem(BULK_OUTREACH_JOB_KEY, JSON.stringify(job));
    } catch (_) {}
  }

  function isBulkOutreachJobRunning() {
    return !!readBulkOutreachJob();
  }

  function updateBulkOutreachBellBadge(job) {
    const el = document.getElementById('bulkEnhanceBellBadge');
    if (!el || !job) return;
    const done = Math.max(0, Number(job.done) || 0);
    const total = Math.max(0, Number(job.total) || 0);
    if (total > 0) {
      el.textContent = Math.min(done, total) + '/' + total;
      el.classList.remove('hidden');
      el.setAttribute(
        'title',
        (job.channel === 'sms' ? 'Sending SMS' : 'Sending email') +
          ': ' +
          Math.min(done, total) +
          ' of ' +
          total,
      );
    }
  }

  function buildBulkOutreachProgressBellHtml(job) {
    if (!job) return '';
    const channel = job.channel === 'sms' ? 'SMS' : 'Email';
    const done = Math.max(0, Number(job.done) || 0);
    const total = Math.max(1, Number(job.total) || 1);
    return (
      '<div class="p-4 border-b border-brand-border/10 bg-sky-500/5 dark:bg-sky-500/10">' +
      '<div class="flex items-start gap-3">' +
      '<div class="w-8 h-8 rounded-full bg-sky-500/15 flex items-center justify-center text-sky-700 dark:text-sky-300 shrink-0">' +
      '<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>' +
      '</div><div class="min-w-0">' +
      '<div class="text-[11px] font-black text-brand-dark dark:text-white uppercase tracking-tight mb-0.5">Sending ' +
      escapeBellHtml(channel) +
      '</div>' +
      '<div class="text-[10px] font-bold text-brand-muted dark:text-slate-400 leading-tight">' +
      Math.min(done, total) +
      ' of ' +
      total +
      ' · keep this tab open</div>' +
      '<div class="mt-1 text-[9px] font-semibold text-brand-muted dark:text-slate-500">Progress stays in the bell — no popup alerts while sending.</div>' +
      '</div></div></div>'
    );
  }

  window.agencyOsPushBellNotification = function agencyOsPushBellNotification(item) {
    pushClientBellNotification(item || {});
    const ping = document.getElementById('notificationPing');
    if (ping) {
      ping.classList.remove('hidden');
      ping.classList.add('animate-ping');
    }
  };

  window.agencyOsBulkOutreach = {
    isRunning() {
      return isBulkOutreachJobRunning();
    },
    getJob() {
      return readBulkOutreachJob();
    },
    start(opts) {
      opts = opts || {};
      const total = Math.max(1, Number(opts.total) || 1);
      const job = {
        channel: opts.channel === 'sms' ? 'sms' : 'email',
        total,
        done: 0,
        ok: 0,
        failed: 0,
        skipped: 0,
        running: true,
        startedAt: Date.now(),
      };
      writeBulkOutreachJob(job);
      if (typeof window.updateProcessingStatus === 'function') {
        window.updateProcessingStatus(true);
      }
      updateBulkOutreachBellBadge(job);
      if (processingIndicator) processingIndicator.classList.add('processing-active');
      const ping = document.getElementById('notificationPing');
      if (ping) {
        ping.classList.remove('hidden');
        ping.classList.add('animate-ping');
      }
      return job;
    },
    progress(opts) {
      opts = opts || {};
      const job = readBulkOutreachJob();
      if (!job) return null;
      if (opts.done != null) job.done = Math.max(0, Number(opts.done) || 0);
      if (opts.ok != null) job.ok = Math.max(0, Number(opts.ok) || 0);
      if (opts.failed != null) job.failed = Math.max(0, Number(opts.failed) || 0);
      if (opts.skipped != null) job.skipped = Math.max(0, Number(opts.skipped) || 0);
      writeBulkOutreachJob(job);
      updateBulkOutreachBellBadge(job);
      return job;
    },
    finish(opts) {
      opts = opts || {};
      const job = readBulkOutreachJob() || {};
      const channel = (opts.channel || job.channel) === 'sms' ? 'SMS' : 'Email';
      const ok = opts.ok != null ? Number(opts.ok) : Number(job.ok) || 0;
      const failed = opts.failed != null ? Number(opts.failed) : Number(job.failed) || 0;
      const skipped = opts.skipped != null ? Number(opts.skipped) : Number(job.skipped) || 0;
      const parts = [channel + ': ' + ok + ' sent'];
      if (skipped) parts.push(skipped + ' skipped');
      if (failed) parts.push(failed + ' failed');
      const summary = parts.join(' · ');
      const detail = String(opts.lastError || '').trim();
      writeBulkOutreachJob(null);
      if (typeof window.updateProcessingStatus === 'function') {
        window.updateProcessingStatus(false);
      }
      const badge = document.getElementById('bulkEnhanceBellBadge');
      if (badge && !isBulkEnhanceJobRunning() && !isArtworkGenJobRunning() && !isGhlSyncJobRunning()) {
        badge.textContent = '';
        badge.classList.add('hidden');
        badge.removeAttribute('title');
      }
      pushClientBellNotification({
        headline: failed ? channel + ' send finished with errors' : channel + ' send complete',
        body: detail ? summary + ' — ' + detail.slice(0, 180) : summary,
        href: opts.href || '/prospecting?tab=pipeline',
        linkLabel: 'Open pipeline →',
        desktop: true,
        desktopTag: 'agency-os-bulk-' + String(job.channel || 'email'),
      });
      const ping = document.getElementById('notificationPing');
      if (ping) {
        ping.classList.remove('hidden');
        ping.classList.add('animate-ping');
      }
      return { summary, ok, failed, skipped };
    },
  };

  /** Called from app.js when starting/finishing client-side search flows. */
  window.updateProcessingStatus = function (isActive) {
    if (!processingIndicator) return;
    if (isActive) {
      activeProcessingCount++;
      localStorage.setItem('is_searching', 'true');
      updateLeadRunProgressBanner({ isProcessing: true, activeJob: readLeadRunSession() });
    } else {
      activeProcessingCount = Math.max(0, activeProcessingCount - 1);
      if (activeProcessingCount === 0) {
        localStorage.removeItem('is_searching');
        updateLeadRunProgressBanner({ isProcessing: false });
      }
    }
    applyProcessingRing();
  };

  function initNavNotificationsBell() {
    if (window.__navNotificationsBellBound) return;
    processingIndicator = document.getElementById('processingIndicator');
    const notificationPing = document.getElementById('notificationPing');
    const notificationDropdown = document.getElementById('notificationDropdown');
    const notificationList = document.getElementById('notificationList');

    if (!processingIndicator) return;
    window.__navNotificationsBellBound = true;

    applyProcessingRing();
    if (readLeadRunSession() && localStorage.getItem('is_searching') === 'true') {
      leadRunDisplayPct = Math.max(leadRunDisplayPct, computeLeadRunTargetPct(readLeadRunSession().startedAt));
      updateLeadRunProgressBanner({ isProcessing: true, activeJob: readLeadRunSession() });
    } else {
      updateLeadRunProgressBanner({ isProcessing: false });
    }

    var leadRunBellBtn = document.getElementById('leadRunProgressBellBtn');
    if (leadRunBellBtn && processingIndicator) {
      leadRunBellBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        processingIndicator.click();
      });
    }

    if (isBulkEnhanceJobRunning()) {
      const jr = readBulkEnhanceJob();
      if (jr) {
        updateBulkEnhanceBellBadge(jr.index, jr.keys.length);
        if (typeof window.showAppToast === 'function') {
          window.showAppToast(
            'Resuming bulk enrich for ' +
              jr.keys.length +
              ' selected lead' +
              (jr.keys.length !== 1 ? 's' : '') +
              ' from your last session (not the single-lead panel hunt).',
            { variant: 'info', duration: 8000 },
          );
        }
      }
      processBulkEnhanceQueue().catch((e) => console.warn('[bulk-enhance-resume]', e));
    }

    if (isContactHuntJobRunning()) {
      runContactHuntPollLoop().catch((e) => console.warn('[contact-hunt-resume]', e));
    }

    if (isArtworkGenJobRunning()) {
      const artJob = readArtworkGenJob();
      if (artJob) {
        updateArtworkGenBellBadge(artJob);
        if (typeof window.showAppToast === 'function') {
          window.showAppToast(
            'Resuming artwork generation for ' + (artJob.label || 'Marketing Studio') + '.',
            { variant: 'info', duration: 6500 },
          );
        }
      }
      runArtworkGenPollLoop().catch((e) => console.warn('[artwork-gen-resume]', e));
    }

    if (isGhlSyncJobRunning()) {
      const ghlJob = readGhlSyncJob();
      if (ghlJob) {
        activateNavbarWorkBell(ghlJob.label || 'GHL sync');
        updateBulkEnhanceBellBadge(ghlJob.index, ghlJob.keys.length, ghlJob.label || 'GHL sync');
        if (ghlJob.pausedForError) {
          emitGhlSyncProgress({
            current: ghlJob.index,
            total: ghlJob.keys.length,
            remaining: Math.max(0, ghlJob.keys.length - ghlJob.index),
            pushed: ghlJob.pushedCount || 0,
            failed: ghlJob.failedCount || 0,
            lastError: ghlJob.lastError || '',
            paused: true,
          });
          if (typeof window.showAppToast === 'function') {
            var pausedSig =
              String(ghlJob.startedAt || '') +
              '|' +
              String(ghlJob.lastError || '').slice(0, 120);
            var showPausedToast = true;
            try {
              if (sessionStorage.getItem(GHL_PAUSED_TOAST_KEY) === pausedSig) showPausedToast = false;
              else sessionStorage.setItem(GHL_PAUSED_TOAST_KEY, pausedSig);
            } catch (_) {}
            if (showPausedToast) {
              window.showAppToast(
                'GHL sync paused' +
                  (ghlJob.lastError ? ' — ' + String(ghlJob.lastError).slice(0, 140) : '') +
                  '. Fix Integrations, resume from the bell, or tap Clear sync to dismiss.',
                { variant: 'error', duration: 10000 },
              );
            }
          }
        } else {
          try {
            sessionStorage.removeItem(GHL_PAUSED_TOAST_KEY);
          } catch (_) {}
          if (typeof window.showAppToast === 'function') {
            window.showAppToast(
              'Resuming ' +
                (ghlJob.label || 'GHL sync') +
                ' for ' +
                ghlJob.keys.length +
                ' contact' +
                (ghlJob.keys.length !== 1 ? 's' : '') +
                ' (' +
                (ghlJob.index + 1) +
                ' of ' +
                ghlJob.keys.length +
                ').',
              { variant: 'info', duration: 7000 },
            );
          }
          processGhlSyncQueue().catch((e) => console.warn('[ghl-sync-resume]', e));
        }
      }
    }

    function maybeDesktopNotify(data) {
      if (!data.notification || data.notification.isRead || !data.notification.finishedAt) return;
      if (!('Notification' in window)) return;
      var LS = 'agencyOsBellDesktopNotifyAt';
      var fid = String(data.notification.finishedAt);
      try {
        if (localStorage.getItem(LS) === fid) return;
        if (Notification.permission !== 'granted') return;
        var src =
          data.notification.source === 'scheduled'
            ? 'Scheduled scrape'
            : data.notification.source === 'run'
              ? 'Lead search'
              : 'Lead search';
        var kw = formatSearchKeywordDisplay(data.notification.keyword || '').slice(0, 120);
        var rc = data.notification.resultCount;
        var wsn = String(data.notification.workspaceName || '').trim();
        var failed = data.notification.status === 'failed';
        var body = failed
          ? (wsn ? '[' + wsn.slice(0, 40) + '] ' : '') +
            (kw ? '"' + kw + '"' : 'Your search') +
            ' failed. ' +
            String(data.notification.error || 'Check Workspace → API integrations.').slice(0, 120)
          : (wsn ? '[' + wsn.slice(0, 40) + '] ' : '') +
            (kw ? '"' + kw + '"' : 'Your search') +
            (typeof rc === 'number' ? ' — ' + rc + ' leads.' : ' is ready to review.');
        new Notification(failed ? src + ' failed' : src + ' complete', {
          body: body.slice(0, 180),
          tag: 'agency-os-' + fid,
        });
        localStorage.setItem(LS, fid);
      } catch (e) {
        /* ignore */
      }
    }

    const pollStatus = async function () {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();
        var wasProcessing =
          leadRunWasProcessing || localStorage.getItem('is_searching') === 'true';

        if (data.isProcessing) {
          var staleJob = data.activeJob || readLeadRunSession();
          if (staleJob && isLeadRunJobStale(staleJob.startedAt)) {
            recoverStaleLeadRun('status-poll');
            if (!clientNavbarWorkActive()) {
              processingIndicator.classList.remove('processing-active');
            } else {
              applyProcessingRing();
            }
          } else {
            processingIndicator.classList.add('processing-active');
            localStorage.setItem('is_searching', 'true');
            updateLeadRunProgressBanner(data);
          }
        } else {
          // Search job finished — complete the banner even if bulk enhance / hunt is still running.
          localStorage.removeItem('is_searching');
          updateLeadRunProgressBanner(data);
          if (!clientNavbarWorkActive()) {
            processingIndicator.classList.remove('processing-active');
          } else {
            applyProcessingRing();
          }
        }

        leadRunWasProcessing = !!data.isProcessing;
        if (wasProcessing && !data.isProcessing) {
          maybeRefreshPipelineFolderForCompletedSearch(data);
        }

        lastAutoOutreachSummary =
          data.autoOutreach && data.autoOutreach.active ? data.autoOutreach : null;
        applyAutoOutreachBellBadge(lastAutoOutreachSummary);
        const autoOutreachHtml = buildAutoOutreachBellHtml(lastAutoOutreachSummary);

        if (data.notification && !data.notification.isRead) {
          maybeDesktopNotify(data);
          if (notificationPing) {
            notificationPing.classList.remove('hidden');
            notificationPing.classList.add('animate-ping');
          }
          if (notificationList) {
            const n = data.notification;
            const kw = formatSearchKeywordDisplay(n.keyword || '')
              .replace(/</g, '&lt;')
              .replace(/"/g, '&quot;');
            const failed = n.status === 'failed';
            const zeroResults =
              !failed && typeof n.resultCount === 'number' && n.resultCount === 0;
            const isPermitSearch = String(n.type || '').trim() === 'permits_search';
            const treatAsFailed = failed || zeroResults;
            const headline = treatAsFailed
              ? zeroResults
                ? 'No leads found'
                : 'Search failed'
              : n.source === 'scheduled'
                ? 'Scheduled scrape ready'
                : 'Ready for Review';
            const err = String(n.error || '')
              .replace(/</g, '&lt;')
              .replace(/"/g, '&quot;');
            const sub = treatAsFailed
              ? zeroResults
                ? isPermitSearch
                  ? 'Permit search for <span class="text-brand-dark dark:text-slate-200">"' +
                    kw +
                    '"</span> returned 0 permits. Try clearing Keyword, Contractor, and Filed after, or use <strong>Test connection</strong> under Workspace → Integrations → Permit Stack.'
                  : 'Search for <span class="text-brand-dark dark:text-slate-200">"' +
                    kw +
                    '"</span> finished with 0 leads. Check RapidAPI endpoint (/search not review), host, and query param — use <strong>Test connection</strong> on the RapidAPI card.'
                : 'Search for <span class="text-brand-dark dark:text-slate-200">"' +
                  kw +
                  '"</span> did not finish. ' +
                  (err ? '<span class="text-red-700 dark:text-red-300">' + err + '</span> ' : '') +
                  'Open Workspace → API integrations and use <strong>Test connection</strong>.'
              : n.source === 'scheduled'
                ? 'Scheduled run for <span class="text-brand-dark dark:text-slate-200">"' +
                  kw +
                  '"</span> finished. Open history to review.'
                : 'Search for <span class="text-brand-dark dark:text-slate-200">"' +
                  kw +
                  '"</span> is complete. Link to results is ready.';
            const notifHref = treatAsFailed
              ? '/workspace/integrations'
              : n.targetFolderKey && String(n.targetFolderKey).trim()
                ? '/prospecting?tab=pipeline&folderKey=' +
                  encodeURIComponent(String(n.targetFolderKey).trim())
                : '/history';
            notificationList.innerHTML =
              autoOutreachHtml +
              '<div class="p-4 hover:bg-brand-cream/30 dark:hover:bg-white/5 transition-colors cursor-pointer group/notif" onclick="window.location.href=\'' +
              notifHref +
              '\'">' +
              '<div class="flex items-start gap-3">' +
              '<div class="w-8 h-8 rounded-full bg-brand-yellow/10 flex items-center justify-center text-brand-yellow shrink-0">' +
              '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>' +
              '</div>' +
              '<div>' +
              '<div class="text-[11px] font-black text-brand-dark dark:text-white uppercase tracking-tight mb-0.5">' +
              headline +
              '</div>' +
              '<div class="text-[10px] font-bold text-brand-muted dark:text-slate-400 leading-tight">' +
              sub +
              '</div>' +
              '<div class="mt-2 flex items-center gap-2">' +
              '<span class="text-[9px] font-black uppercase text-brand-yellow group-hover/notif:translate-x-1 transition-transform">View Results →</span>' +
              '</div></div></div></div>';
          }
        } else if (renderClientBellNotifications(notificationList, notificationPing)) {
          if (autoOutreachHtml && notificationList) {
            notificationList.innerHTML = autoOutreachHtml + notificationList.innerHTML;
          }
        } else if (isBulkOutreachJobRunning() && notificationList) {
          notificationList.innerHTML =
            autoOutreachHtml + buildBulkOutreachProgressBellHtml(readBulkOutreachJob());
          if (notificationPing) {
            notificationPing.classList.remove('hidden');
            notificationPing.classList.add('animate-ping');
          }
        } else if (isArtworkGenJobRunning() && notificationList) {
          notificationList.innerHTML =
            autoOutreachHtml + buildArtworkGenProgressBellHtml(readArtworkGenJob());
          if (notificationPing) {
            notificationPing.classList.remove('hidden');
            notificationPing.classList.add('animate-ping');
          }
        } else if (isGhlSyncJobRunning() && notificationList) {
          notificationList.innerHTML =
            autoOutreachHtml + buildGhlSyncProgressBellHtml(readGhlSyncJob());
          if (notificationPing) {
            notificationPing.classList.remove('hidden');
            notificationPing.classList.add('animate-ping');
          }
        } else if (autoOutreachHtml && notificationList) {
          notificationList.innerHTML = autoOutreachHtml;
          // Status card only — no urgent red ping for always-on campaigns
        } else {
          const keepPingForClientWork =
            localStorage.getItem('is_searching') === 'true' ||
            isBulkEnhanceJobRunning() ||
            syncEnhanceSessionActive() ||
            isContactHuntJobRunning() ||
            isGhlSyncJobRunning() ||
            isArtworkGenJobRunning() ||
            isBulkOutreachJobRunning() ||
            readClientBellNotifications().some((n) => !n.isRead);
          if (notificationPing && !keepPingForClientWork) {
            notificationPing.classList.remove('animate-ping');
            notificationPing.classList.add('hidden');
          }
          if (notificationList) {
            notificationList.innerHTML =
              '<div class="p-8 text-center text-brand-muted dark:text-slate-500 italic text-[11px]">No new notifications</div>';
          }
        }
      } catch (err) {
        console.warn('[STATUS-POLL] Failed to fetch status:', err);
      }
    };

    setInterval(pollStatus, 5000);
    pollStatus();

    const desktopRow = document.getElementById('notificationDesktopRow');
    const navNotifyEnable = document.getElementById('navNotifyEnable');
    const navNotifyStatus = document.getElementById('navNotifyStatus');

    function syncDesktopAlertsUi() {
      if (!desktopRow || !navNotifyEnable) return;
      if (!('Notification' in window)) {
        desktopRow.classList.add('hidden');
        return;
      }
      desktopRow.classList.remove('hidden');
      navNotifyEnable.disabled = false;
      navNotifyEnable.classList.remove(
        'opacity-60',
        'cursor-not-allowed',
        'border-emerald-500/45',
        'dark:border-emerald-400/40',
        'border-amber-500/45',
        'dark:border-amber-400/40',
      );
      navNotifyEnable.classList.add('border-sky-500/45', 'dark:border-sky-400/40');

      const perm = Notification.permission;
      if (perm === 'granted') {
        const paused =
          window.AgencyTaskReminders &&
          typeof window.AgencyTaskReminders.isPaused === 'function' &&
          window.AgencyTaskReminders.isPaused();
        navNotifyEnable.classList.remove('border-sky-500/45', 'dark:border-sky-400/40');
        navNotifyEnable.classList.add(
          paused ? 'border-amber-500/45' : 'border-emerald-500/45',
          paused ? 'dark:border-amber-400/40' : 'dark:border-emerald-400/40',
        );
        navNotifyEnable.textContent = paused
          ? 'Resume desktop alerts'
          : 'Desktop alerts on';
        if (navNotifyStatus) {
          navNotifyStatus.textContent = paused
            ? 'Task reminders are paused on this device.'
            : 'You will get browser alerts for lead runs and task reminders.';
          navNotifyStatus.classList.remove('hidden');
        }
        return;
      }

      if (perm === 'denied') {
        navNotifyEnable.textContent = 'Notifications blocked in browser';
        navNotifyEnable.classList.remove('border-sky-500/45', 'dark:border-sky-400/40');
        navNotifyEnable.classList.add('border-rose-500/40', 'dark:border-rose-400/35');
        if (navNotifyStatus) {
          navNotifyStatus.textContent =
            'Allow notifications in your browser site settings to get runs and reminders.';
          navNotifyStatus.classList.remove('hidden');
        }
        return;
      }

      navNotifyEnable.textContent = 'Enable desktop alerts (runs & reminders)';
      if (navNotifyStatus) {
        navNotifyStatus.textContent = 'Get notified when hunts finish and callbacks are due.';
        navNotifyStatus.classList.remove('hidden');
      }
    }

    syncDesktopAlertsUi();

    if (navNotifyEnable) {
      navNotifyEnable.addEventListener('click', async function (e) {
        e.stopPropagation();
        if (!('Notification' in window)) return;

        if (Notification.permission === 'denied') {
          if (typeof window.showAppToast === 'function') {
            window.showAppToast(
              'Notifications are blocked. Open browser site settings for this page and allow notifications.',
              { variant: 'error' },
            );
          }
          return;
        }

        if (Notification.permission === 'granted') {
          if (
            window.AgencyTaskReminders &&
            typeof window.AgencyTaskReminders.isPaused === 'function' &&
            window.AgencyTaskReminders.isPaused() &&
            typeof window.AgencyTaskReminders.setPaused === 'function'
          ) {
            window.AgencyTaskReminders.setPaused(false);
            if (typeof window.AgencyTaskReminders.refresh === 'function') {
              await window.AgencyTaskReminders.refresh();
            }
            if (typeof window.AgencyTaskReminders.tick === 'function') {
              window.AgencyTaskReminders.tick();
            }
            if (typeof window.showAppToast === 'function') {
              window.showAppToast('Desktop alerts resumed.', { variant: 'success' });
            }
          }
          syncDesktopAlertsUi();
          return;
        }

        const perm = await Notification.requestPermission();
        if (perm === 'granted') {
          if (window.AgencyTaskReminders) {
            if (typeof window.AgencyTaskReminders.setPaused === 'function') {
              window.AgencyTaskReminders.setPaused(false);
            }
            if (typeof window.AgencyTaskReminders.refresh === 'function') {
              await window.AgencyTaskReminders.refresh();
            }
            if (typeof window.AgencyTaskReminders.tick === 'function') {
              window.AgencyTaskReminders.tick();
            }
          }
          if (typeof window.showAppToast === 'function') {
            window.showAppToast('Desktop alerts enabled for runs and reminders.', {
              variant: 'success',
            });
          }
        } else if (typeof window.showAppToast === 'function') {
          window.showAppToast('Desktop alerts were not enabled.', { variant: 'error' });
        }
        syncDesktopAlertsUi();
      });
    }

    processingIndicator.addEventListener('click', async function (e) {
      if (!notificationDropdown) return;
      e.stopPropagation();
      const isHidden = notificationDropdown.classList.contains('hidden');
      if (isHidden) {
        notificationDropdown.classList.remove('hidden');
        syncDesktopAlertsUi();
        if (isGhlSyncJobRunning() && notificationList) {
          notificationList.innerHTML = buildGhlSyncProgressBellHtml(readGhlSyncJob());
          if (processingIndicator) processingIndicator.classList.add('processing-active');
          activateNavbarWorkBell(readGhlSyncJob().label || 'GHL sync');
        } else if (isBulkOutreachJobRunning() && notificationList) {
          notificationList.innerHTML = buildBulkOutreachProgressBellHtml(readBulkOutreachJob());
        } else if (isArtworkGenJobRunning() && notificationList) {
          notificationList.innerHTML = buildArtworkGenProgressBellHtml(readArtworkGenJob());
        }
        try {
          await fetch('/api/notifications/read', { method: 'POST' });
        } catch (_) {}
        markClientBellNotificationsRead();
        if (
          notificationPing &&
          !isGhlSyncJobRunning() &&
          !isArtworkGenJobRunning() &&
          !isBulkOutreachJobRunning()
        ) {
          notificationPing.classList.add('hidden');
        }
      } else {
        notificationDropdown.classList.add('hidden');
      }
    });

    document.addEventListener('click', function (e) {
      if (
        notificationDropdown &&
        !notificationDropdown.contains(e.target) &&
        !processingIndicator.contains(e.target)
      ) {
        notificationDropdown.classList.add('hidden');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNavNotificationsBell);
  } else {
    initNavNotificationsBell();
  }
})();
