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

    function positionWsMenu() {
      var rect = wsb.getBoundingClientRect();
      wsm.style.position = 'fixed';
      wsm.style.top = Math.round(rect.bottom + 4) + 'px';
      wsm.style.left = Math.round(rect.left) + 'px';
      wsm.style.width = Math.max(Math.round(rect.width), 220) + 'px';
      wsm.style.right = 'auto';
      wsm.style.zIndex = '200';
    }

    function closeWsMenu() {
      wsm.classList.add('hidden');
      wsb.setAttribute('aria-expanded', 'false');
      var chev = wsb.querySelector('.ws-switcher-chevron');
      if (chev) chev.classList.remove('rotate-180');
    }

    wsb.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var open = wsm.classList.contains('hidden');
      if (open) positionWsMenu();
      wsm.classList.toggle('hidden');
      wsb.setAttribute('aria-expanded', open ? 'true' : 'false');
      var chev = wsb.querySelector('.ws-switcher-chevron');
      if (chev) chev.classList.toggle('rotate-180', open);
    });

    window.addEventListener('resize', function () {
      if (!wsm.classList.contains('hidden')) positionWsMenu();
    });

    document.addEventListener('click', function (e) {
      if (wsw.contains(e.target)) return;
      closeWsMenu();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeWsMenu();
    });
  }

  bindWsSwitcher('wsSwitcherBtnSidebar', 'wsSwitcherMenuSidebar', 'wsSwitcherWrapSidebar');
  bindWsSwitcher('wsSwitcherBtn', 'wsSwitcherMenu', 'wsSwitcherWrap');
})();
