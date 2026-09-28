/**
 * "Added by" / "Last worked by" chips for a lead (lead panel + Money mode).
 * Usage: window.AdhelloTeamBadges.render(containerEl, leadKey)
 */
(function () {
  if (window.AdhelloTeamBadges) return;

  var CACHE_MS = 30000;
  var cache = {};
  var inflight = {};

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function ago(ts) {
    var n = Number(ts);
    if (!n) return '';
    var min = Math.max(0, Math.round((Date.now() - n) / 60000));
    if (min < 1) return 'just now';
    if (min < 60) return min + 'm ago';
    var hrs = Math.round(min / 60);
    if (hrs < 24) return hrs + 'h ago';
    var days = Math.round(hrs / 24);
    if (days < 30) return days + 'd ago';
    return new Date(n).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function fetchInfo(key) {
    var hit = cache[key];
    if (hit && Date.now() - hit.at < CACHE_MS) return Promise.resolve(hit.data);
    if (inflight[key]) return inflight[key];
    inflight[key] = fetch('/team-history/api/lead/' + encodeURIComponent(key), {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .catch(function () {
        return null;
      })
      .then(function (data) {
        delete inflight[key];
        cache[key] = { at: Date.now(), data: data };
        return data;
      });
    return inflight[key];
  }

  function chip(label, person, recentTitle) {
    var href = '/team-history?member=' + encodeURIComponent(person.email) + '&view=all';
    var when = ago(person.at);
    return (
      '<a href="' + esc(href) + '" class="lead-team-badge inline-flex items-center gap-1 rounded-full border border-brand-border/40 dark:border-white/10 bg-white/80 dark:bg-slate-900/70 px-2 py-0.5 text-[10px] font-bold text-brand-dark dark:text-slate-200 hover:border-brand-yellow/60 transition-colors"' +
      ' title="' + esc(recentTitle || label + ' ' + person.name) + '">' +
      '<span class="text-brand-muted font-black uppercase tracking-widest text-[8px]">' + esc(label) + '</span>' +
      '<span>' + esc(person.name) + '</span>' +
      (when ? '<span class="text-brand-muted font-semibold">· ' + esc(when) + '</span>' : '') +
      '</a>'
    );
  }

  function render(el, rawKey) {
    if (!el) return;
    var key = String(rawKey || '').trim();
    el.setAttribute('data-team-badges-key', key);
    if (!key) {
      el.classList.add('hidden');
      el.innerHTML = '';
      return;
    }
    fetchInfo(key).then(function (data) {
      if (el.getAttribute('data-team-badges-key') !== key) return;
      if (!data || !data.success || (data.teamSize || 0) < 2 || (!data.addedBy && !data.lastWorkedBy)) {
        el.classList.add('hidden');
        el.innerHTML = '';
        return;
      }
      var recentTitle = (data.recent || [])
        .slice(0, 5)
        .map(function (r) {
          return (r.actor ? r.actor.name : '') + ': ' + r.summary + ' (' + ago(r.createdAt) + ')';
        })
        .join('\n');
      var html = '';
      if (data.addedBy) html += chip('Added by', data.addedBy, recentTitle);
      var sameAsAdded =
        data.addedBy && data.lastWorkedBy && data.addedBy.email === data.lastWorkedBy.email && data.addedBy.at === data.lastWorkedBy.at;
      if (data.lastWorkedBy && !sameAsAdded) html += chip('Last worked', data.lastWorkedBy, recentTitle);
      el.innerHTML = html;
      el.classList.remove('hidden');
    });
  }

  function invalidate(key) {
    if (key) delete cache[String(key)];
    else cache = {};
  }

  window.AdhelloTeamBadges = { render: render, invalidate: invalidate };

  document.querySelectorAll('[data-team-badges-key]').forEach(function (el) {
    var key = el.getAttribute('data-team-badges-key');
    if (key) render(el, key);
  });
})();
