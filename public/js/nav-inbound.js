/**
 * Bell → Inbound: form/ad leads, missed calls, voicemails, texts and emails waiting on a reply.
 */
(function () {
  if (window.__navInboundBound) return;
  var POLL_MS = 60000;
  var ICONS = {
    form: '<path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6M9 16h4M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/>',
    missed_call: '<path stroke-linecap="round" stroke-linejoin="round" d="M16 3l5 5m0-5l-5 5M5 4h3l2 5-2.5 1.5a11 11 0 0 0 5 5L14 13l5 2v3a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
    voicemail: '<circle cx="6.5" cy="12" r="3.5"/><circle cx="17.5" cy="12" r="3.5"/><path stroke-linecap="round" d="M6.5 15.5h11"/>',
    sms: '<path stroke-linecap="round" stroke-linejoin="round" d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
    email: '<path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16v12H4zM4 7l8 6 8-6"/>',
  };
  var TONES = {
    form: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    missed_call: 'bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300',
    voicemail: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    sms: 'bg-sky-100 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300',
    email: 'bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  };

  var section, list, count, badge, dropdown;
  var seen = null;
  var loading = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function ago(iso) {
    var ms = Date.now() - Date.parse(iso || '');
    if (!isFinite(ms)) return '';
    var m = Math.max(0, Math.round(ms / 60000));
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    var h = Math.round(m / 60);
    if (h < 24) return h + 'h ago';
    return Math.round(h / 24) + 'd ago';
  }

  function rowHtml(it) {
    var reply = it.type === 'sms' || it.type === 'email';
    var meta = esc(it.typeLabel) +
      (it.label ? ' · ' + esc(it.label) : '') +
      (it.count > 1 ? ' · ' + it.count + ' events' : '');
    return (
      '<li class="px-4 py-3 flex items-start gap-3 border-t border-brand-border dark:border-white/5 first:border-0" data-nav-inbound-row="' + esc(it.leadKey) + '">' +
      '<span class="shrink-0 mt-0.5 grid place-items-center w-8 h-8 rounded-xl ' + (TONES[it.type] || TONES.sms) + '" aria-hidden="true">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">' + (ICONS[it.type] || ICONS.sms) + '</svg></span>' +
      '<div class="min-w-0 flex-1">' +
      '<div class="flex items-baseline gap-2">' +
      '<a href="' + esc(it.openHref) + '" class="text-[12px] font-bold text-brand-dark dark:text-white hover:text-brand-yellow truncate min-w-0">' + esc(it.title) + '</a>' +
      '<span class="ml-auto text-[10px] font-bold text-brand-muted whitespace-nowrap tabular-nums">' + esc(ago(it.at)) + '</span></div>' +
      '<p class="text-[10px] font-bold text-brand-muted truncate">' + meta + '</p>' +
      (it.preview ? '<p class="text-[11px] text-brand-dark dark:text-slate-300 mt-0.5 line-clamp-2">' + esc(it.preview) + '</p>' : '') +
      '<div class="mt-1.5 flex items-center gap-1">' +
      '<a href="' + esc(it.callHref) + '" class="btn-pill btn-primary px-3 py-1 text-[9px] font-black uppercase tracking-widest">' +
      (reply ? 'Reply' : it.type === 'form' ? 'Call now' : 'Call back') + '</a>' +
      '<a href="' + esc(it.openHref) + '" class="text-[9px] font-black uppercase tracking-widest text-brand-muted hover:text-brand-yellow px-2 py-1">Open</a>' +
      '<button type="button" class="text-[9px] font-black uppercase tracking-widest text-brand-muted hover:text-brand-yellow px-2 py-1" data-nav-inbound-done="' + esc(it.leadKey) + '">Done</button>' +
      '</div></div></li>'
    );
  }

  function setCount(n) {
    if (count) count.textContent = String(n);
    if (badge) {
      badge.textContent = n > 99 ? '99+' : String(n);
      badge.classList.toggle('hidden', !n);
    }
    if (section) section.classList.toggle('hidden', !n);
    if (dropdown) dropdown.classList.toggle('has-inbound', !!n);
  }

  function announceNew(items) {
    var ids = items.map(function (it) { return it.leadKey + '|' + it.at; });
    if (seen && typeof window.showAppToast === 'function') {
      var fresh = items.filter(function (it, i) { return !seen[ids[i]]; });
      if (fresh.length === 1) {
        window.showAppToast(fresh[0].typeLabel + ': ' + fresh[0].title, { variant: 'info', duration: 7000 });
      } else if (fresh.length > 1) {
        window.showAppToast(fresh.length + ' new inbound items — open the bell to reply.', { variant: 'info', duration: 7000 });
      }
    }
    seen = {};
    ids.forEach(function (id) { seen[id] = true; });
  }

  function render(items) {
    if (list) list.innerHTML = items.map(rowHtml).join('');
    setCount(items.length);
  }

  function refresh() {
    if (loading || document.visibilityState === 'hidden') return;
    loading = true;
    fetch('/notifications/inbound', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !Array.isArray(data.items)) return;
        announceNew(data.items);
        render(data.items);
      })
      .catch(function () {})
      .then(function () { loading = false; });
  }

  function markDone(btn) {
    var key = btn.getAttribute('data-nav-inbound-done');
    btn.disabled = true;
    fetch('/today/inbound/done', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ leadKey: key }),
    })
      .then(function (r) {
        if (!r.ok) throw new Error('failed');
        var row = btn.closest('[data-nav-inbound-row]');
        if (row) row.remove();
        setCount(list ? list.querySelectorAll('[data-nav-inbound-row]').length : 0);
      })
      .catch(function () {
        btn.disabled = false;
        btn.textContent = 'Retry';
      });
  }

  function init() {
    section = document.getElementById('navInboundSection');
    list = document.getElementById('navInboundList');
    if (!section || !list) return;
    window.__navInboundBound = true;
    count = document.getElementById('navInboundCount');
    badge = document.getElementById('navInboundBadge');
    dropdown = document.getElementById('notificationDropdown');

    section.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-nav-inbound-done]');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      markDone(btn);
    });
    document.addEventListener('adhello:nav-popover', function (e) {
      if (e.detail && e.detail.id === 'notifications') refresh();
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') refresh();
    });
    setInterval(refresh, POLL_MS);
    setTimeout(refresh, 800);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
