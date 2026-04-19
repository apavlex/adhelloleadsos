/**
 * Global navbar: notification bell, processing ring, /api/status polling.
 * Loaded from partials/navbar.ejs on every app page so the bell works everywhere.
 */
(function () {
  let activeProcessingCount = 0;
  let processingIndicator = null;

  function applyProcessingRing() {
    if (!processingIndicator) return;
    if (activeProcessingCount > 0 || localStorage.getItem('is_searching') === 'true') {
      processingIndicator.classList.add('processing-active');
    } else {
      processingIndicator.classList.remove('processing-active');
    }
  }

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
        var body =
          (kw ? '"' + kw + '"' : 'Your search') +
          (typeof rc === 'number' ? ' — ' + rc + ' leads.' : ' is ready to review.');
        new Notification(src + ' complete', {
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
          processingIndicator.classList.remove('processing-active');
          localStorage.removeItem('is_searching');
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
            const headline =
              n.source === 'scheduled' ? 'Scheduled scrape ready' : 'Ready for Review';
            const sub =
              n.source === 'scheduled'
                ? 'Scheduled run for <span class="text-brand-dark dark:text-slate-200">"' +
                  kw +
                  '"</span> finished. Open history to review.'
                : 'Search for <span class="text-brand-dark dark:text-slate-200">"' +
                  kw +
                  '"</span> is complete. Link to results is ready.';
            notificationList.innerHTML =
              '<div class="p-4 hover:bg-brand-cream/30 dark:hover:bg-white/5 transition-colors cursor-pointer group/notif" onclick="window.location.href=\'/history\'">' +
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
          if (notificationPing) notificationPing.classList.add('hidden');
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
