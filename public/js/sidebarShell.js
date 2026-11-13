(function () {
  var STORAGE_KEY = 'adhello-sidebar';
  var SETTINGS_KEY = 'adhello-sidebar-settings';
  var body = document.body;
  if (!body || !document.getElementById('appSidebar')) return;

  function getState() {
    try {
      var s = localStorage.getItem(STORAGE_KEY);
      if (s === 'collapsed' || s === 'hidden') return s;
    } catch (e) {}
    return 'expanded';
  }

  function applyState(state) {
    body.classList.remove('sidebar-collapsed', 'sidebar-hidden');
    if (state === 'collapsed') body.classList.add('sidebar-collapsed');
    if (state === 'hidden') body.classList.add('sidebar-hidden');
    try {
      localStorage.setItem(STORAGE_KEY, state);
    } catch (e) {}
    syncToggleButtons(state);
  }

  function syncToggleButtons(state) {
    var collapseBtn = document.getElementById('sidebarCollapseBtn');
    var openBtn = document.getElementById('sidebarOpenBtn');
    var expanded = state === 'expanded';
    var collapsed = state === 'collapsed';
    var hidden = state === 'hidden';

    if (collapseBtn) {
      collapseBtn.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
      collapseBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      collapseBtn.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
      var collapseIcon = collapseBtn.querySelector('.sidebar-icon-collapse');
      var expandIcon = collapseBtn.querySelector('.sidebar-icon-expand');
      if (collapseIcon) collapseIcon.classList.toggle('hidden', collapsed);
      if (expandIcon) expandIcon.classList.toggle('hidden', !collapsed);
    }
    if (openBtn) {
      openBtn.classList.toggle('hidden', !hidden);
      openBtn.setAttribute('aria-hidden', hidden ? 'false' : 'true');
    }
  }

  applyState(getState());

  var settingsToggle = document.getElementById('sidebarSettingsToggle');
  var settingsMenu = document.getElementById('sidebarSettingsMenu');
  var settingsBlock = document.querySelector('.sidebar-settings-block');

  function isSettingsOpen() {
    return !!(settingsMenu && !settingsMenu.classList.contains('hidden'));
  }

  function setSettingsOpen(open, persist) {
    if (!settingsMenu || !settingsToggle) return;
    settingsMenu.classList.toggle('hidden', !open);
    settingsToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    body.classList.toggle('sidebar-settings-open', open);
    if (persist !== false) {
      try {
        localStorage.setItem(SETTINGS_KEY, open ? 'open' : 'closed');
      } catch (e) {}
    }
  }

  if (settingsToggle && settingsMenu) {
    var startOpen = settingsBlock && settingsBlock.getAttribute('data-start-open') === '1';
    if (!startOpen) {
      try {
        startOpen = localStorage.getItem(SETTINGS_KEY) === 'open';
      } catch (e) {}
    }
    setSettingsOpen(!!startOpen, false);

    settingsToggle.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      setSettingsOpen(!isSettingsOpen());
    });

    document.addEventListener('click', function (e) {
      if (!isSettingsOpen()) return;
      if (e.target.closest('.sidebar-settings-block')) return;
      setSettingsOpen(false);
    });
  }

  var collapseBtn = document.getElementById('sidebarCollapseBtn');
  if (collapseBtn) {
    collapseBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var state = getState();
      if (state === 'hidden') {
        applyState('expanded');
        return;
      }
      applyState(state === 'collapsed' ? 'expanded' : 'collapsed');
    });
  }

  var openBtn = document.getElementById('sidebarOpenBtn');
  if (openBtn) {
    openBtn.addEventListener('click', function (e) {
      e.preventDefault();
      applyState('expanded');
    });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (isSettingsOpen()) {
      setSettingsOpen(false);
      return;
    }
    var state = getState();
    if (state === 'hidden') {
      applyState('expanded');
      return;
    }
    if (state === 'expanded') applyState('collapsed');
    else if (state === 'collapsed') applyState('hidden');
  });

  var leadsSummary = document.querySelector('.sidebar-leads-summary');
  if (leadsSummary) {
    leadsSummary.addEventListener('click', function (e) {
      if (!body.classList.contains('sidebar-collapsed')) return;
      e.preventDefault();
      var active = document.querySelector('.sidebar-leads-sub .sidebar-nav-link.active');
      window.location.href = (active && active.getAttribute('href')) || '/pipeline';
    });
  }

  function bindWsSwitcher(btnId, menuId, wrapId) {
    var wsb = document.getElementById(btnId);
    var wsm = document.getElementById(menuId);
    var wsw = document.getElementById(wrapId);
    if (!wsb || !wsm || !wsw || wsb.getAttribute('data-ws-bound') === '1') return;
    wsb.setAttribute('data-ws-bound', '1');

    function ensureWsMenuPortaled() {
      /* Fixed menus inside #appSidebar (overflow scroller, z-40) painted under the
         frosted topbar and looked “transparent” with search/UI bleeding through.
         Portal to body via .app-body-portal so crush rules + stacking stay correct. */
      if (wsm.parentElement && wsm.parentElement.getAttribute('data-ws-portal') === '1') return;
      var portal = document.createElement('div');
      portal.className = 'app-body-portal';
      portal.setAttribute('data-ws-portal', '1');
      document.body.appendChild(portal);
      portal.appendChild(wsm);
    }

    function paintWsMenuOpaque() {
      var dark = document.documentElement.classList.contains('dark');
      wsm.style.backgroundColor = dark ? '#0f172a' : '#ffffff';
      wsm.style.opacity = '1';
      wsm.style.backdropFilter = 'none';
      wsm.style.webkitBackdropFilter = 'none';
    }

    function positionWsMenu() {
      ensureWsMenuPortaled();
      paintWsMenuOpaque();
      var rect = wsb.getBoundingClientRect();
      wsm.style.position = 'fixed';
      wsm.style.top = Math.round(rect.bottom + 4) + 'px';
      wsm.style.left = Math.round(rect.left) + 'px';
      wsm.style.width = Math.max(Math.round(rect.width), 220) + 'px';
      wsm.style.right = 'auto';
      wsm.style.zIndex = '220';
      wsm.style.pointerEvents = 'auto';
      wsm.style.height = 'auto';
      wsm.style.maxHeight = 'min(24rem, 70vh)';
      wsm.style.overflowY = 'auto';
    }

    function closeWsMenu() {
      wsm.classList.add('hidden');
      wsb.setAttribute('aria-expanded', 'false');
      var chev = wsb.querySelector('.ws-switcher-chevron');
      if (chev) chev.classList.remove('rotate-180');
    }

    // Warm only the workspace the user is about to open — never every row on
    // menu open (that jammed SQLite with N cold getAllLeads and froze Switching…).
    var warmedIds = Object.create(null);
    function warmOneWorkspace(id) {
      id = String(id || '').trim();
      if (!id || warmedIds[id]) return;
      warmedIds[id] = 1;
      try {
        fetch('/workspaces/warm', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ workspaceId: id }),
          keepalive: true,
        }).catch(function () {});
      } catch (_) {}
    }

    function esc(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function returnToValue() {
      var input = wsm.querySelector('form[action="/workspaces/switch"] input[name="returnTo"]');
      return input ? String(input.value || '') : '';
    }

    function badgeHtml(w) {
      if (w.isDemo) {
        return '<span class="shrink-0 rounded-full bg-sky-100 dark:bg-sky-900/40 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-sky-700 dark:text-sky-300">Demo</span>';
      }
      if (w.trialState === 'trial') {
        return '<span class="shrink-0 rounded-full bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-amber-800 dark:text-amber-200">' + esc(w.trialLabel || ('Trial · ' + w.trialDaysLeft + 'd')) + '</span>';
      }
      if (w.trialState === 'expired') {
        return '<span class="shrink-0 rounded-full bg-rose-100 dark:bg-rose-900/40 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-rose-700 dark:text-rose-300">Expired</span>';
      }
      if (w.trialState === 'active') {
        return '<span class="shrink-0 rounded-full bg-emerald-100 dark:bg-emerald-900/40 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-emerald-800 dark:text-emerald-200">Active</span>';
      }
      return '';
    }

    function renderWorkspaceRows(workspaces, activeId) {
      var ret = returnToValue();
      return (workspaces || []).map(function (w) {
        if (!w || !w.id) return '';
        var isActive = activeId && String(w.id) === String(activeId);
        return (
          '<form method="post" action="/workspaces/switch" class="block">' +
          '<input type="hidden" name="workspaceId" value="' + esc(w.id) + '" />' +
          (ret ? '<input type="hidden" name="returnTo" value="' + esc(ret) + '" />' : '') +
          '<button type="submit" class="w-full text-left px-4 py-2.5 text-sm flex items-center gap-2.5 transition-colors ' +
          (isActive
            ? 'bg-brand-yellow/15 text-brand-dark dark:text-white font-bold'
            : 'text-brand-dark dark:text-white hover:bg-brand-cream/60 dark:hover:bg-white/10') +
          '" role="menuitem"' + (isActive ? ' aria-current="true"' : '') + '>' +
          '<span class="w-2.5 h-2.5 rounded-full shrink-0 ring-2 ring-white dark:ring-slate-900" style="background-color: ' + esc(w.accentColor || '#CA8A04') + '" aria-hidden="true"></span>' +
          '<span class="truncate flex-1 min-w-0">' + esc(w.name || 'Workspace') + '</span>' +
          badgeHtml(w) +
          (isActive
            ? '<svg class="w-4 h-4 shrink-0 text-brand-yellow" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>'
            : '') +
          '</button></form>'
        );
      }).join('');
    }

    var switcherHydrating = false;
    var switcherHydrated = false;
    function hydrateSwitcherList() {
      if (switcherHydrating) return;
      var existing = wsm.querySelectorAll('form[action="/workspaces/switch"]').length;
      // Always refresh once per page so a cold HTML paint (active-only) gets the full list.
      if (switcherHydrated && existing > 1) return;
      switcherHydrating = true;
      fetch('/workspaces/switcher.json', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      })
        .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
        .then(function (parsed) {
          switcherHydrating = false;
          if (!parsed.ok || !parsed.data || !parsed.data.success) return;
          var list = Array.isArray(parsed.data.workspaces) ? parsed.data.workspaces : [];
          if (!list.length) return;
          var label = wsm.querySelector('p');
          var footer = wsm.querySelector('.border-t');
          var help = null;
          var kids = wsm.children;
          for (var i = kids.length - 1; i >= 0; i--) {
            var el = kids[i];
            if (el.tagName === 'P' && el !== label) { help = el; break; }
          }
          var rows = renderWorkspaceRows(list, parsed.data.activeWorkspaceId || '');
          var html = '';
          if (label) html += label.outerHTML;
          else html += '<p class="px-4 py-2 text-[9px] font-black uppercase tracking-widest text-brand-muted">Your workspaces</p>';
          html += rows;
          if (footer) html += footer.outerHTML;
          if (help) html += help.outerHTML;
          wsm.innerHTML = html;
          switcherHydrated = true;
        })
        .catch(function () { switcherHydrating = false; });
    }

    wsm.addEventListener(
      'pointerdown',
      function (e) {
        var form = e.target && e.target.closest ? e.target.closest('form[action="/workspaces/switch"]') : null;
        if (!form || form.getAttribute('data-ws-switching') === '1') return;
        var input = form.querySelector('input[name="workspaceId"]');
        if (input) warmOneWorkspace(input.value);
      },
      true,
    );

    wsb.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var open = wsm.classList.contains('hidden');
      if (open) {
        positionWsMenu();
        hydrateSwitcherList();
      }
      wsm.classList.toggle('hidden');
      wsb.setAttribute('aria-expanded', open ? 'true' : 'false');
      var chev = wsb.querySelector('.ws-switcher-chevron');
      if (chev) chev.classList.toggle('rotate-180', open);
    });

    // Prefetch after first paint so opening the menu is instant.
    if ('requestIdleCallback' in window) {
      requestIdleCallback(function () { hydrateSwitcherList(); }, { timeout: 2500 });
    } else {
      setTimeout(hydrateSwitcherList, 1200);
    }

    window.addEventListener('resize', function () {
      if (!wsm.classList.contains('hidden')) positionWsMenu();
    });

    document.addEventListener('click', function (e) {
      if (wsw.contains(e.target) || wsm.contains(e.target)) return;
      closeWsMenu();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeWsMenu();
    });
  }

  bindWsSwitcher('wsSwitcherBtnSidebar', 'wsSwitcherMenuSidebar', 'wsSwitcherWrapSidebar');
  bindWsSwitcher('wsSwitcherBtn', 'wsSwitcherMenu', 'wsSwitcherWrap');

  var switchBusyTimer = null;

  function clearWorkspaceSwitchBusy() {
    if (switchBusyTimer) {
      clearTimeout(switchBusyTimer);
      switchBusyTimer = null;
    }
    var menus = document.querySelectorAll('#wsSwitcherMenu, #wsSwitcherMenuSidebar');
    for (var i = 0; i < menus.length; i++) {
      menus[i].removeAttribute('aria-busy');
      menus[i].classList.remove('opacity-70', 'pointer-events-none');
    }
    var forms = document.querySelectorAll('form[action="/workspaces/switch"]');
    for (var j = 0; j < forms.length; j++) {
      forms[j].removeAttribute('data-ws-switching');
      var buttons = forms[j].querySelectorAll('button[type="submit"]');
      for (var k = 0; k < buttons.length; k++) {
        buttons[k].disabled = false;
        buttons[k].removeAttribute('aria-disabled');
        var label = buttons[k].querySelector('.truncate') || buttons[k];
        var prev = label && label.getAttribute('data-ws-switch-label');
        if (prev != null) {
          label.textContent = prev;
          label.removeAttribute('data-ws-switch-label');
        }
      }
    }
  }

  function markWorkspaceSwitchBusy(form) {
    if (!form || form.getAttribute('data-ws-switching') === '1') return;
    form.setAttribute('data-ws-switching', '1');
    var menus = document.querySelectorAll('#wsSwitcherMenu, #wsSwitcherMenuSidebar');
    for (var i = 0; i < menus.length; i++) {
      menus[i].setAttribute('aria-busy', 'true');
      menus[i].classList.add('opacity-70', 'pointer-events-none');
    }
    var forms = document.querySelectorAll('form[action="/workspaces/switch"]');
    for (var j = 0; j < forms.length; j++) {
      var buttons = forms[j].querySelectorAll('button[type="submit"]');
      for (var k = 0; k < buttons.length; k++) {
        buttons[k].disabled = true;
        buttons[k].setAttribute('aria-disabled', 'true');
      }
    }
    var submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) {
      var label = submitBtn.querySelector('.truncate') || submitBtn;
      if (label && !label.getAttribute('data-ws-switch-label')) {
        label.setAttribute('data-ws-switch-label', label.textContent || '');
        label.textContent = 'Switching…';
      }
    }
    // If the POST hangs (server busy on lead scans), unlock so the user can retry.
    if (switchBusyTimer) clearTimeout(switchBusyTimer);
    switchBusyTimer = setTimeout(function () {
      switchBusyTimer = null;
      clearWorkspaceSwitchBusy();
      if (typeof window.showAppToast === 'function') {
        window.showAppToast('Workspace switch is taking too long — try again.', {
          variant: 'error',
          duration: 5000,
        });
      }
    }, 12000);
  }

  document.addEventListener(
    'submit',
    function (e) {
      var form = e.target;
      if (!form || form.tagName !== 'FORM') return;
      if (form.getAttribute('action') !== '/workspaces/switch') return;
      markWorkspaceSwitchBusy(form);
    },
    true,
  );

  window.addEventListener('pagehide', clearWorkspaceSwitchBusy);

  window.__adhelloGetSidebarState = getState;
  window.__adhelloSetSidebarState = applyState;
})();
