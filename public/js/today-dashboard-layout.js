/**
 * Today dashboard customize — hide sections and rearrange order (localStorage).
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'adhello-today-dash-layout';
  var DEFAULT_ORDER = [
    'hero',
    'sources',
    'resume',
    'actions',
    'pipeline',
    'dueTasks',
    'weekReview',
    'touches',
  ];

  function sectionNodes() {
    return Array.prototype.slice.call(document.querySelectorAll('[data-today-section]'));
  }

  function loadPrefs() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { order: DEFAULT_ORDER.slice(), hidden: {} };
      var parsed = JSON.parse(raw);
      var order = Array.isArray(parsed.order)
        ? parsed.order.map(String).filter(Boolean)
        : DEFAULT_ORDER.slice();
      var hidden =
        parsed.hidden && typeof parsed.hidden === 'object' && !Array.isArray(parsed.hidden)
          ? parsed.hidden
          : {};
      return { order: order, hidden: hidden };
    } catch (_) {
      return { order: DEFAULT_ORDER.slice(), hidden: {} };
    }
  }

  function savePrefs(prefs) {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          order: prefs.order || DEFAULT_ORDER.slice(),
          hidden: prefs.hidden || {},
          updatedAt: Date.now(),
        }),
      );
    } catch (_) {
      /* ignore quota */
    }
  }

  function mergeOrder(prefsOrder, presentIds) {
    var seen = {};
    var out = [];
    (prefsOrder || []).forEach(function (id) {
      if (!presentIds[id] || seen[id]) return;
      seen[id] = true;
      out.push(id);
    });
    DEFAULT_ORDER.forEach(function (id) {
      if (!presentIds[id] || seen[id]) return;
      seen[id] = true;
      out.push(id);
    });
    Object.keys(presentIds).forEach(function (id) {
      if (seen[id]) return;
      out.push(id);
    });
    return out;
  }

  function applyLayout(prefs) {
    var nodes = sectionNodes();
    if (!nodes.length) return;
    var parent = nodes[0].parentElement;
    if (!parent) return;
    var siblings = nodes.filter(function (n) {
      return n.parentElement === parent;
    });
    if (siblings.length < 2 && siblings.length === 0) return;

    var byId = {};
    siblings.forEach(function (n) {
      byId[n.getAttribute('data-today-section')] = n;
    });
    var order = mergeOrder(prefs.order, byId);
    var anchor = document.createComment('today-dash-end');
    parent.insertBefore(anchor, siblings[0]);
    order.forEach(function (id) {
      var el = byId[id];
      if (!el) return;
      var hide = !!(prefs.hidden && prefs.hidden[id]);
      el.classList.toggle('today-dash-section--hidden', hide);
      if (hide) el.setAttribute('hidden', '');
      else el.removeAttribute('hidden');
      parent.insertBefore(el, anchor);
    });
    parent.removeChild(anchor);
  }

  function ensurePanel() {
    var existing = document.getElementById('todayDashCustomize');
    if (existing) return existing;
    var wrap = document.createElement('div');
    wrap.id = 'todayDashCustomize';
    wrap.className = 'today-dash-customize';
    wrap.hidden = true;
    wrap.setAttribute('aria-hidden', 'true');
    wrap.innerHTML =
      '<div class="today-dash-customize__backdrop" data-today-dash-close="1"></div>' +
      '<div class="today-dash-customize__panel" role="dialog" aria-modal="true" aria-labelledby="todayDashCustomizeTitle">' +
      '<p class="today-dash-customize__eyebrow">Today</p>' +
      '<h2 id="todayDashCustomizeTitle" class="today-dash-customize__title">Customize dashboard</h2>' +
      '<p class="today-dash-customize__hint">Hide sections or move them up and down. Saved on this browser.</p>' +
      '<ul id="todayDashCustomizeList" class="today-dash-customize__list"></ul>' +
      '<div class="today-dash-customize__actions">' +
      '<button type="button" class="today-dash-customize__btn today-dash-customize__btn--ghost" data-today-dash-reset="1">Reset</button>' +
      '<div class="today-dash-customize__actions-right">' +
      '<button type="button" class="today-dash-customize__btn today-dash-customize__btn--ghost" data-today-dash-close="1">Cancel</button>' +
      '<button type="button" class="today-dash-customize__btn today-dash-customize__btn--primary" data-today-dash-save="1">Save</button>' +
      '</div></div></div>';
    document.body.appendChild(wrap);
    return wrap;
  }

  function closePanel() {
    var wrap = document.getElementById('todayDashCustomize');
    if (!wrap) return;
    wrap.hidden = true;
    wrap.setAttribute('aria-hidden', 'true');
  }

  function openPanel() {
    var prefs = loadPrefs();
    var wrap = ensurePanel();
    var list = document.getElementById('todayDashCustomizeList');
    if (!list) return;
    var nodes = sectionNodes();
    var byId = {};
    nodes.forEach(function (n) {
      byId[n.getAttribute('data-today-section')] = n;
    });
    var order = mergeOrder(prefs.order, byId);
    list.innerHTML = '';
    order.forEach(function (id, index) {
      var el = byId[id];
      if (!el) return;
      var label =
        el.getAttribute('data-today-section-label') ||
        el.getAttribute('aria-label') ||
        id;
      var li = document.createElement('li');
      li.className = 'today-dash-customize__row';
      li.setAttribute('data-id', id);
      li.innerHTML =
        '<label class="today-dash-customize__check">' +
        '<input type="checkbox" ' +
        (!(prefs.hidden && prefs.hidden[id]) ? 'checked' : '') +
        ' />' +
        '<span>' +
        String(label).replace(/</g, '&lt;') +
        '</span></label>' +
        '<div class="today-dash-customize__move">' +
        '<button type="button" data-move="-1" aria-label="Move up" ' +
        (index === 0 ? 'disabled' : '') +
        '>↑</button>' +
        '<button type="button" data-move="1" aria-label="Move down" ' +
        (index === order.length - 1 ? 'disabled' : '') +
        '>↓</button></div>';
      list.appendChild(li);
    });
    wrap.hidden = false;
    wrap.setAttribute('aria-hidden', 'false');
  }

  function readPanelPrefs() {
    var list = document.getElementById('todayDashCustomizeList');
    var order = [];
    var hidden = {};
    if (!list) return { order: DEFAULT_ORDER.slice(), hidden: {} };
    Array.prototype.forEach.call(list.children, function (li) {
      var id = li.getAttribute('data-id');
      if (!id) return;
      order.push(id);
      var cb = li.querySelector('input[type="checkbox"]');
      if (cb && !cb.checked) hidden[id] = true;
    });
    return { order: order, hidden: hidden };
  }

  function moveRow(li, dir) {
    var list = li && li.parentElement;
    if (!list) return;
    if (dir < 0 && li.previousElementSibling) {
      list.insertBefore(li, li.previousElementSibling);
    } else if (dir > 0 && li.nextElementSibling) {
      list.insertBefore(li.nextElementSibling, li);
    }
    Array.prototype.forEach.call(list.children, function (row, i) {
      var ups = row.querySelectorAll('[data-move]');
      if (ups[0]) ups[0].disabled = i === 0;
      if (ups[1]) ups[1].disabled = i === list.children.length - 1;
    });
  }

  function bind() {
    var btn = document.getElementById('todayDashCustomizeBtn');
    if (btn && !btn.dataset.bound) {
      btn.dataset.bound = '1';
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        openPanel();
      });
    }
    document.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-today-dash-close]') : null;
      if (t) {
        closePanel();
        return;
      }
      var save = e.target && e.target.closest ? e.target.closest('[data-today-dash-save]') : null;
      if (save) {
        var prefs = readPanelPrefs();
        savePrefs(prefs);
        applyLayout(prefs);
        closePanel();
        return;
      }
      var reset = e.target && e.target.closest ? e.target.closest('[data-today-dash-reset]') : null;
      if (reset) {
        var cleared = { order: DEFAULT_ORDER.slice(), hidden: {} };
        savePrefs(cleared);
        applyLayout(cleared);
        openPanel();
        return;
      }
      var move = e.target && e.target.closest ? e.target.closest('[data-move]') : null;
      if (move) {
        var li = move.closest('.today-dash-customize__row');
        moveRow(li, parseInt(move.getAttribute('data-move'), 10) || 0);
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closePanel();
    });
  }

  function init() {
    applyLayout(loadPrefs());
    bind();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.__adhelloApplyTodayDashLayout = function () {
    applyLayout(loadPrefs());
  };
})();
