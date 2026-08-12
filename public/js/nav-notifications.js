/**
 * Global navbar: notification bell, processing ring, /api/status polling.
 * Bulk lead enhance queue (sessionStorage) so enhancement continues after navigation; bell shows x/y progress.
 * Loaded from partials/navbar.ejs on every app page so the bell works everywhere.
 */
(function () {
  let activeProcessingCount = 0;
  let processingIndicator = null;

  /**
   * In-app toast (glass-style). Use for enhance/Firecrawl errors instead of window.alert.
   * @param {string} message
   * @param {{ variant?: 'info'|'error', duration?: number }} [opts]
   */
  window.showAppToast = function showAppToast(message, opts) {
    if (!message) return;
    opts = opts || {};
    const variant =
      opts.variant === 'error' ? 'error' : opts.variant === 'success' ? 'success' : 'info';
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
    el.setAttribute('role', variant === 'error' ? 'alert' : 'status');

    var errSkin =
      'top-[4.5rem] bg-rose-900 text-white border-rose-300/65 shadow-[0_10px_28px_rgba(0,0,0,0.38)]';
    var successSkin =
      'top-[4.5rem] bg-emerald-900 text-white border-emerald-300/55 shadow-[0_10px_28px_rgba(0,0,0,0.34)]';
    var infoSkin =
      'top-[4.5rem] bg-brand-dark text-white border-brand-yellow/55 shadow-[0_10px_28px_rgba(0,0,0,0.34)]';
    el.className = [
      'fixed left-1/2 z-[520] max-w-[min(92vw,26rem)] -translate-x-1/2',
      'translate-y-2 opacity-0 transition-all duration-200 ease-out',
      'px-5 py-3.5 rounded-2xl text-sm font-semibold leading-snug',
      'border',
      variant === 'error' ? errSkin : variant === 'success' ? successSkin : infoSkin,
    ].join(' ');
    el.style.whiteSpace = 'pre-line';
    el.textContent = message;

    if (variant === 'error') {
      el.classList.add('cursor-pointer', 'pointer-events-auto');
      el.title = 'Click to dismiss';
    } else {
      el.removeAttribute('title');
      el.classList.remove('cursor-pointer', 'pointer-events-auto');
      el.classList.add('pointer-events-none');
    }

    requestAnimationFrame(function () {
      el.classList.remove('opacity-0', 'translate-y-2');
    });

    clearTimeout(window.__appToastTimer);
    window.__appToastTimer = setTimeout(function () {
      el.classList.add('opacity-0', 'translate-y-2');
      el.onclick = null;
    }, duration);

    if (variant === 'error') {
      el.onclick = function () {
        clearTimeout(window.__appToastTimer);
        el.classList.add('opacity-0', 'translate-y-2');
        el.onclick = null;
      };
    } else {
      el.onclick = null;
    }
  };

  const BULK_ENHANCE_STORAGE_KEY = 'agencyOsBulkEnhanceJob';
  let bulkEnhanceProcessorLock = false;

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
      isArtworkGenJobRunning()
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
  let leadRunDisplayPct = 0;
  let leadRunTickerId = null;
  let leadRunWasProcessing = false;

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

  /** Time-based target 1–99% (eased so it slows near the end). */
  function computeLeadRunTargetPct(startedAt) {
    if (!startedAt) return 1;
    var elapsed = Date.now() - Date.parse(startedAt);
    if (!Number.isFinite(elapsed) || elapsed < 0) return 1;
    var estMs = 3.5 * 60 * 1000;
    var linear = Math.min(1, elapsed / estMs);
    var eased = 1 - Math.pow(1 - linear, 1.4);
    return Math.min(99, Math.max(1, Math.round(eased * 99)));
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
      if (!searching) {
        stopLeadRunTicker();
        return;
      }
      var session = readLeadRunSession();
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

  function updateLeadRunProgressBanner(data, opts) {
    opts = opts || {};
    var banner = document.getElementById('leadRunProgressBanner');
    if (!banner) return;
    var show =
      opts.forceShow === true ||
      (data && data.isProcessing) ||
      localStorage.getItem('is_searching') === 'true';
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
      el.textContent = '';
      el.classList.add('hidden');
      el.removeAttribute('title');
    }
  }

  function applyProcessingRing() {
    if (!processingIndicator) return;
    const bulk = isBulkEnhanceJobRunning();
    const ghl = isGhlSyncJobRunning();
    if (
      activeProcessingCount > 0 ||
      localStorage.getItem('is_searching') === 'true' ||
      bulk ||
      ghl ||
      isArtworkGenJobRunning()
    ) {
      processingIndicator.classList.add('processing-active');
      if (bulk) {
        const j = readBulkEnhanceJob();
        if (j) updateBulkEnhanceBellBadge(j.index, j.keys.length, 'Enhancing leads');
      } else if (ghl) {
        const j = readGhlSyncJob();
        if (j) updateBulkEnhanceBellBadge(j.index, j.keys.length, 'GHL sync');
      } else if (isArtworkGenJobRunning()) {
        updateArtworkGenBellBadge(readArtworkGenJob());
      }
    } else {
      processingIndicator.classList.remove('processing-active');
      updateBulkEnhanceBellBadge(0, 0);
    }
  }

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
        if (processingIndicator) processingIndicator.classList.add('processing-active');

        let success = false;
        let result = {};
        try {
          const res = await fetch('/leads/' + encodeURIComponent(key) + '/enhance', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
          });
          result = await res.json().catch(() => ({}));
          if (res.ok && result.processing) {
            // eslint-disable-next-line no-await-in-loop
            result = await pollLeadEnhanceUntilDone(key);
            success = !!(result.success && (result.lead || result.data));
          } else {
            success = !!(res.ok && result.success && (result.lead || result.data));
          }
        } catch (err) {
          result = { error: err.message };
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
      window.dispatchEvent(new CustomEvent('agency-os-bulk-enhance-finished', { detail: summary }));
    }
  }

  const GHL_SYNC_JOB_KEY = 'agencyOsGhlSyncJob';
  let ghlSyncProcessorLock = false;
  const ghlSyncWaiters = [];

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
    return (
      '<div class="p-4 border-b border-brand-border/10 bg-orange-500/5 dark:bg-orange-500/10">' +
      '<div class="flex items-start gap-3">' +
      '<div class="w-8 h-8 rounded-full bg-orange-500/15 flex items-center justify-center text-orange-600 dark:text-orange-300 shrink-0">' +
      '<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>' +
      '</div><div class="min-w-0">' +
      '<div class="text-[11px] font-black text-brand-dark dark:text-white uppercase tracking-tight mb-0.5">GHL sync in progress</div>' +
      '<div class="text-[10px] font-bold text-brand-muted dark:text-slate-400 leading-tight">' +
      escapeBellHtml(String(current) + ' of ' + String(total) + ' contacts') +
      (pushed || failed ? ' · ' + pushed + ' synced' + (failed ? ', ' + failed + ' failed' : '') : '') +
      '</div>' +
      '<div class="mt-1 text-[9px] font-semibold text-brand-muted dark:text-slate-500">Safe to browse other pages — we will ping the bell when done.</div>' +
      '</div></div></div>'
    );
  }

  async function pushSingleLeadKeyToGhl(leadKey, tagNoWebsite) {
    const res = await fetch('/ghl/push', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ leadKeys: [String(leadKey || '').trim()], tagNoWebsite: tagNoWebsite !== false }),
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
    var summary = { ok: true, pushed: 0, failed: 0, total: 0, results: [] };
    try {
      while (true) {
        var job = readGhlSyncJob();
        if (!job || !job.running || job.index >= job.keys.length) break;

        var key = job.keys[job.index];
        var total = job.keys.length;

        try {
          // eslint-disable-next-line no-await-in-loop
          var data = await pushSingleLeadKeyToGhl(key, job.tagNoWebsite);
          var leadPushed = data.pushed != null ? data.pushed : 0;
          var leadFailed = data.failed != null ? data.failed : 0;
          if (leadPushed > 0) job.pushedCount = (job.pushedCount || 0) + leadPushed;
          else job.failedCount = (job.failedCount || 0) + Math.max(1, leadFailed);
          if (Array.isArray(data.results)) summary.results = summary.results.concat(data.results);
        } catch (err) {
          job.failedCount = (job.failedCount || 0) + 1;
          job.lastError = err && err.message ? err.message : String(err);
          summary.results.push({ key: key, ok: false, error: job.lastError });
        }

        job.index += 1;
        writeGhlSyncJob(job);
        emitGhlSyncProgress({
          current: job.index,
          total: total,
          remaining: Math.max(0, total - job.index),
          pushed: job.pushedCount || 0,
          failed: job.failedCount || 0,
        });
        updateBulkEnhanceBellBadge(job.index, total, 'GHL sync');
      }

      var finalJob = readGhlSyncJob();
      if (finalJob) {
        summary.pushed = finalJob.pushedCount || 0;
        summary.failed = finalJob.failedCount || 0;
        summary.total = finalJob.keys.length;
        summary.ok = summary.failed === 0;
      }
    } finally {
      ghlSyncProcessorLock = false;
      writeGhlSyncJob(null);
      updateBulkEnhanceBellBadge(0, 0);
      if (typeof window.updateProcessingStatus === 'function') {
        window.updateProcessingStatus(false);
      }
      applyProcessingRing();

      if (summary.total > 0) {
        var doneMsg =
          'GHL sync complete · ' +
          summary.pushed +
          ' contact' +
          (summary.pushed === 1 ? '' : 's') +
          (summary.failed ? ' · ' + summary.failed + ' failed' : '');
        pushClientBellNotification({
          headline: summary.failed ? 'GHL sync finished with errors' : 'GHL sync complete',
          body: doneMsg,
          href: '/prospecting?tab=pipeline',
        });
        if (typeof window.showAppToast === 'function') {
          window.showAppToast(doneMsg, {
            variant: summary.failed ? 'error' : 'success',
            duration: summary.failed ? 9000 : 5000,
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
    readJob() {
      return readGhlSyncJob();
    },
    buildProgressHtml(job) {
      return buildGhlSyncProgressBellHtml(job || readGhlSyncJob());
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

        var job = {
          keys: leadKeys,
          index: 0,
          running: true,
          tagNoWebsite: opts.tagNoWebsite !== false,
          pushedCount: 0,
          failedCount: 0,
          startedAt: Date.now(),
        };
        writeGhlSyncJob(job);
        activateNavbarWorkBell('GHL sync');
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
  }

  function markClientBellNotificationsRead() {
    try {
      const list = readClientBellNotifications().map((n) => ({ ...n, isRead: true }));
      sessionStorage.setItem(CLIENT_BELL_NOTIFS_KEY, JSON.stringify(list));
    } catch (_) {}
  }

  function escapeBellHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
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
    const res = await fetch('/leads/' + encodeURIComponent(job.leadKey) + '/enhance-status', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    const d = await res.json().catch(() => ({}));
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
    const maxMs = opts && opts.maxMs != null ? opts.maxMs : 180000;
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
      '<div class="mt-1 text-[9px] font-semibold text-brand-muted dark:text-slate-500">Safe to browse other pages — we will ping the bell when GPT Image 2 finishes.</div>' +
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
      '/direct-mail/api/generate-image/status?taskId=' + encodeURIComponent(job.taskId),
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
          pushClientBellNotification({
            headline: 'Artwork ready',
            body: label + ' finished generating — open Marketing Studio to review.',
            href: '/direct-mail?artworkReady=1',
            linkLabel: 'Open Marketing Studio →',
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

  document.addEventListener('DOMContentLoaded', function () {
    processingIndicator = document.getElementById('processingIndicator');
    const notificationPing = document.getElementById('notificationPing');
    const notificationDropdown = document.getElementById('notificationDropdown');
    const notificationList = document.getElementById('notificationList');

    if (!processingIndicator) return;

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
        updateBulkEnhanceBellBadge(ghlJob.index, ghlJob.keys.length, 'GHL sync');
        if (typeof window.showAppToast === 'function') {
          window.showAppToast(
            'Resuming GHL sync for ' +
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
      }
      processGhlSyncQueue().catch((e) => console.warn('[ghl-sync-resume]', e));
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
          processingIndicator.classList.add('processing-active');
          localStorage.setItem('is_searching', 'true');
          updateLeadRunProgressBanner(data);
        } else {
          if (!clientNavbarWorkActive()) {
            processingIndicator.classList.remove('processing-active');
            localStorage.removeItem('is_searching');
            updateLeadRunProgressBanner(data);
          } else {
            applyProcessingRing();
            if (localStorage.getItem('is_searching') === 'true') {
              updateLeadRunProgressBanner({ isProcessing: true, activeJob: data.activeJob || null });
            } else {
              updateLeadRunProgressBanner(data);
            }
          }
        }

        leadRunWasProcessing = !!data.isProcessing;
        if (wasProcessing && !data.isProcessing) {
          maybeRefreshPipelineFolderForCompletedSearch(data);
        }

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
          /* client-side hunt / enhance / artwork notifications */
        } else if (isArtworkGenJobRunning() && notificationList) {
          notificationList.innerHTML = buildArtworkGenProgressBellHtml(readArtworkGenJob());
          if (notificationPing) {
            notificationPing.classList.remove('hidden');
            notificationPing.classList.add('animate-ping');
          }
        } else if (isGhlSyncJobRunning() && notificationList) {
          notificationList.innerHTML = buildGhlSyncProgressBellHtml(readGhlSyncJob());
          if (notificationPing) {
            notificationPing.classList.remove('hidden');
            notificationPing.classList.add('animate-ping');
          }
        } else {
          const keepPingForClientWork =
            localStorage.getItem('is_searching') === 'true' ||
            isBulkEnhanceJobRunning() ||
            syncEnhanceSessionActive() ||
            isContactHuntJobRunning() ||
            isGhlSyncJobRunning() ||
            isArtworkGenJobRunning() ||
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
        } else if (isArtworkGenJobRunning() && notificationList) {
          notificationList.innerHTML = buildArtworkGenProgressBellHtml(readArtworkGenJob());
        }
        try {
          await fetch('/api/notifications/read', { method: 'POST' });
        } catch (_) {}
        markClientBellNotificationsRead();
        if (notificationPing && !isGhlSyncJobRunning() && !isArtworkGenJobRunning()) {
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
  });
})();
