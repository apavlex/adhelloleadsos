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
    return isBulkEnhanceJobRunning() || syncEnhanceSessionActive() || isContactHuntJobRunning();
  }

  function escapeLeadRunText(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  const LEAD_RUN_SESSION_KEY = 'agencyOsLeadRunProgress';
  let leadRunDisplayPct = 0;
  let leadRunTickerId = null;

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
        startedAt: new Date().toISOString(),
      };
      writeLeadRunSession(freshJob);
      return freshJob;
    }

    var session = readLeadRunSession();
    var serverJob = data && data.activeJob ? data.activeJob : null;
    var job = serverJob || session || null;

    if (opts && (opts.keyword || opts.city || opts.state)) {
      if (!job) {
        job = {
          keyword: opts.keyword || '',
          city: opts.city || '',
          state: opts.state || '',
          startedAt: new Date().toISOString(),
        };
      } else {
        job = {
          keyword: opts.keyword || job.keyword || '',
          city: opts.city || job.city || '',
          state: opts.state || job.state || '',
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
        var kw = escapeLeadRunText(job.keyword || '');
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
    });
  };

  window.hideLeadRunProgressBanner = function hideLeadRunProgressBanner() {
    updateLeadRunProgressBanner({ isProcessing: false });
  };

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
        id: 'hunt-' + Date.now(),
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
          '<div class="mt-2 text-[9px] font-black uppercase text-brand-yellow group-hover/notif:translate-x-1 transition-transform">Open lead →</div>' +
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
            const zeroResults =
              !failed && typeof n.resultCount === 'number' && n.resultCount === 0;
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
                ? 'Search for <span class="text-brand-dark dark:text-slate-200">"' +
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
            const notifHref = treatAsFailed ? '/workspace/integrations' : '/history';
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
          /* client-side hunt / enhance notifications */
        } else {
          const keepPingForClientWork =
            localStorage.getItem('is_searching') === 'true' ||
            isBulkEnhanceJobRunning() ||
            syncEnhanceSessionActive() ||
            isContactHuntJobRunning() ||
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
        markClientBellNotificationsRead();
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
