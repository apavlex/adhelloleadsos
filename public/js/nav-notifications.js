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
          if (notificationPing) {
            notificationPing.classList.remove('hidden');
            notificationPing.classList.add('animate-ping');
          }
          if (notificationList) {
            const n = data.notification;
            const kw = String(n.keyword || '').replace(/</g, '&lt;').replace(/"/g, '&quot;');
            notificationList.innerHTML =
              '<div class="p-4 hover:bg-brand-cream/30 dark:hover:bg-white/5 transition-colors cursor-pointer group/notif" onclick="window.location.href=\'/history\'">' +
              '<div class="flex items-start gap-3">' +
              '<div class="w-8 h-8 rounded-full bg-brand-yellow/10 flex items-center justify-center text-brand-yellow shrink-0">' +
              '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>' +
              '</div>' +
              '<div>' +
              '<div class="text-[11px] font-black text-brand-dark dark:text-white uppercase tracking-tight mb-0.5">Ready for Review</div>' +
              '<div class="text-[10px] font-bold text-brand-muted dark:text-slate-400 leading-tight">' +
              'Search for <span class="text-brand-dark dark:text-slate-200">"' +
              kw +
              '"</span> is complete. Link to results is ready.' +
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
