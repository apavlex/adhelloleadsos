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
    const variant = opts.variant === 'error' ? 'error' : 'info';
    const duration = typeof opts.duration === 'number' ? opts.duration : variant === 'error' ? 11000 : 2800;

    var el = document.getElementById('appToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'appToast';
      document.body.appendChild(el);
    }
    el.setAttribute('role', variant === 'error' ? 'alert' : 'status');

    var errSkin =
      'top-[4.5rem] bg-rose-900 text-white border-rose-300/65 shadow-[0_10px_28px_rgba(0,0,0,0.38)]';
    var infoSkin =
      'top-[4.5rem] bg-brand-dark text-white border-brand-yellow/55 shadow-[0_10px_28px_rgba(0,0,0,0.34)]';
    el.className = [
      'fixed left-1/2 z-[220] max-w-[min(92vw,26rem)] -translate-x-1/2',
      'translate-y-2 opacity-0 transition-all duration-200 ease-out',
      'px-5 py-3.5 rounded-2xl text-sm font-semibold leading-snug',
      'border',
      variant === 'error' ? errSkin : infoSkin,
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
    return isBulkEnhanceJobRunning() || syncEnhanceSessionActive();
  }

  function updateBulkEnhanceBellBadge(currentZeroBasedIndex, total) {
    const el = document.getElementById('bulkEnhanceBellBadge');
    if (!el) return;
    if (total > 0 && currentZeroBasedIndex < total) {
      el.textContent = currentZeroBasedIndex + 1 + '/' + total;
      el.classList.remove('hidden');
      el.setAttribute(
        'title',
        'Enhancing leads: ' + (currentZeroBasedIndex + 1) + ' of ' + total + ' (safe to change pages)'
      );
    } else {
      el.textContent = '';
      el.classList.add('hidden');
      el.removeAttribute('title');
    }
  }

  function applyProcessingRing() {
    if (!processingIndicator) return;
    const bulk = isBulkEnhanceJobRunning();
    if (activeProcessingCount > 0 || localStorage.getItem('is_searching') === 'true' || bulk) {
      processingIndicator.classList.add('processing-active');
      if (bulk) {
        const j = readBulkEnhanceJob();
        if (j) updateBulkEnhanceBellBadge(j.index, j.keys.length);
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
          success = !!(res.ok && result.success);
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

  window.agencyOsBulkEnhance = {
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

  /** Called from app.js when starting/finishing client-side search flows. */
  window.updateProcessingStatus = function (isActive) {
    if (!processingIndicator) return;
    if (isActive) {
      activeProcessingCount++;
      localStorage.setItem('is_searching', 'true');
    } else {
      activeProcessingCount = Math.max(0, activeProcessingCount - 1);
      if (activeProcessingCount === 0) {
        localStorage.removeItem('is_searching');
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

    if (isBulkEnhanceJobRunning()) {
      const jr = readBulkEnhanceJob();
      if (jr) updateBulkEnhanceBellBadge(jr.index, jr.keys.length);
      processBulkEnhanceQueue().catch((e) => console.warn('[bulk-enhance-resume]', e));
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
        var kw = String(data.notification.keyword || '').slice(0, 120);
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

        if (data.isProcessing) {
          processingIndicator.classList.add('processing-active');
          localStorage.setItem('is_searching', 'true');
        } else {
          if (!clientNavbarWorkActive()) {
            processingIndicator.classList.remove('processing-active');
            localStorage.removeItem('is_searching');
          } else {
            applyProcessingRing();
          }
        }

        if (data.notification && !data.notification.isRead) {
          maybeDesktopNotify(data);
          if (notificationPing) {
            notificationPing.classList.remove('hidden');
            notificationPing.classList.add('animate-ping');
          }
          if (notificationList) {
            const n = data.notification;
            const kw = String(n.keyword || '').replace(/</g, '&lt;').replace(/"/g, '&quot;');
            const failed = n.status === 'failed';
            const headline = failed
              ? 'Search failed'
              : n.source === 'scheduled'
                ? 'Scheduled scrape ready'
                : 'Ready for Review';
            const err = String(n.error || '')
              .replace(/</g, '&lt;')
              .replace(/"/g, '&quot;');
            const sub = failed
              ? 'Search for <span class="text-brand-dark dark:text-slate-200">"' +
                kw +
                '"</span> did not finish. ' +
                (err ? '<span class="text-red-700 dark:text-red-300">' + err + '</span> ' : '') +
                'Open Workspace → API integrations and use <strong>Test APIs</strong>.'
              : n.source === 'scheduled'
                ? 'Scheduled run for <span class="text-brand-dark dark:text-slate-200">"' +
                  kw +
                  '"</span> finished. Open history to review.'
                : 'Search for <span class="text-brand-dark dark:text-slate-200">"' +
                  kw +
                  '"</span> is complete. Link to results is ready.';
            const notifHref = failed ? '/workspace/integrations' : '/history';
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
        } else {
          const keepPingForClientWork =
            localStorage.getItem('is_searching') === 'true' ||
            isBulkEnhanceJobRunning() ||
            syncEnhanceSessionActive();
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
    function updateDesktopHint() {
      if (!desktopRow) return;
      if ('Notification' in window && Notification.permission === 'default') {
        desktopRow.classList.remove('hidden');
      } else {
        desktopRow.classList.add('hidden');
      }
    }
    updateDesktopHint();
    if (navNotifyEnable) {
      navNotifyEnable.addEventListener('click', async function (e) {
        e.stopPropagation();
        if (!('Notification' in window)) return;
        await Notification.requestPermission();
        updateDesktopHint();
      });
    }

    processingIndicator.addEventListener('click', async function (e) {
      if (!notificationDropdown) return;
      e.stopPropagation();
      const isHidden = notificationDropdown.classList.contains('hidden');
      if (isHidden) {
        notificationDropdown.classList.remove('hidden');
        try {
          await fetch('/api/notifications/read', { method: 'POST' });
        } catch (_) {}
        if (notificationPing) notificationPing.classList.add('hidden');
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
