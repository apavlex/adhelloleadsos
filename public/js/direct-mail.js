(function () {
  'use strict';

  function selectedKeys() {
    return Array.from(document.querySelectorAll('.dm-lead-check:checked'))
      .map(function (cb) {
        return String(cb.value || '').trim();
      })
      .filter(Boolean);
  }

  function setStatus(text, ok) {
    var el = document.getElementById('dmStatus');
    if (!el) return;
    if (!text) {
      el.classList.add('hidden');
      el.textContent = '';
      return;
    }
    el.textContent = text;
    el.classList.remove('hidden', 'text-emerald-700', 'text-rose-700', 'dark:text-emerald-300', 'dark:text-rose-300');
    el.classList.add(ok ? 'text-emerald-700' : 'text-rose-700', ok ? 'dark:text-emerald-300' : 'dark:text-rose-300');
  }

  function syncCheckAll() {
    var boxes = Array.from(document.querySelectorAll('.dm-lead-check'));
    var all = document.getElementById('dmCheckAll');
    if (!all || !boxes.length) return;
    var checked = boxes.filter(function (b) {
      return b.checked;
    }).length;
    all.indeterminate = checked > 0 && checked < boxes.length;
    all.checked = checked === boxes.length;
  }

  document.getElementById('dmCheckAll') &&
    document.getElementById('dmCheckAll').addEventListener('change', function () {
      var on = this.checked;
      document.querySelectorAll('.dm-lead-check').forEach(function (cb) {
        cb.checked = on;
      });
    });

  document.querySelectorAll('.dm-lead-check').forEach(function (cb) {
    cb.addEventListener('change', syncCheckAll);
  });

  var selectAllBtn = document.getElementById('dmSelectAll');
  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', function () {
      document.querySelectorAll('.dm-lead-check').forEach(function (cb) {
        cb.checked = true;
      });
      syncCheckAll();
    });
  }

  var sendBtn = document.getElementById('dmSendBtn');
  if (sendBtn) {
    sendBtn.addEventListener('click', async function () {
      var keys = selectedKeys();
      if (!keys.length) {
        setStatus('Select at least one lead.', false);
        return;
      }
      if (!window.confirm('Send ' + keys.length + ' postcard(s) via Lob?')) return;

      sendBtn.disabled = true;
      setStatus('Sending…', true);
      try {
        var res = await fetch('/direct-mail/api/send', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            keys: keys,
            headline: (document.getElementById('dmHeadline') || {}).value || '',
            bodyText: (document.getElementById('dmBody') || {}).value || '',
            ctaUrl: (document.getElementById('dmCtaUrl') || {}).value || '',
          }),
        });
        var data = await res.json().catch(function () {
          return {};
        });
        if (!res.ok || !data.success) {
          throw new Error((data && data.error) || 'Send failed');
        }
        var msg = 'Sent ' + data.sent + ' postcard(s)';
        if (data.failed) msg += ' · ' + data.failed + ' failed';
        setStatus(msg, true);
        if (typeof window.showAppToast === 'function') {
          window.showAppToast(msg, { variant: 'success' });
        }
        setTimeout(function () {
          window.location.reload();
        }, 1200);
      } catch (e) {
        setStatus(e && e.message ? e.message : 'Send failed', false);
        if (typeof window.showAppToast === 'function') {
          window.showAppToast(e && e.message ? e.message : 'Send failed', { variant: 'error' });
        }
      } finally {
        sendBtn.disabled = false;
      }
    });
  }
})();
