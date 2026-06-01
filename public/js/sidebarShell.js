(function () {
  var STORAGE_KEY = 'adhello-sidebar';
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
    var closeBtn = document.getElementById('sidebarCloseBtn');
    var openBtn = document.getElementById('sidebarOpenBtn');
    var expanded = state === 'expanded';
    var collapsed = state === 'collapsed';
    var hidden = state === 'hidden';

    if (collapseBtn) {
      collapseBtn.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
      collapseBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      collapseBtn.title = collapsed ? 'Expand menu' : 'Collapse menu';
      var collapseIcon = collapseBtn.querySelector('.sidebar-icon-collapse');
      var expandIcon = collapseBtn.querySelector('.sidebar-icon-expand');
      if (collapseIcon) collapseIcon.classList.toggle('hidden', collapsed);
      if (expandIcon) expandIcon.classList.toggle('hidden', !collapsed);
    }
    if (closeBtn) {
      closeBtn.setAttribute('aria-label', hidden ? 'Show sidebar' : 'Hide sidebar');
      closeBtn.title = hidden ? 'Show menu' : 'Hide menu';
    }
    if (openBtn) {
      openBtn.classList.toggle('hidden', !hidden);
      openBtn.setAttribute('aria-hidden', hidden ? 'false' : 'true');
    }
  }

  applyState(getState());

  var collapseBtn = document.getElementById('sidebarCollapseBtn');
  if (collapseBtn) {
    collapseBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var state = getState();
      applyState(state === 'collapsed' ? 'expanded' : 'collapsed');
    });
  }

  var closeBtn = document.getElementById('sidebarCloseBtn');
  if (closeBtn) {
    closeBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      applyState(getState() === 'hidden' ? 'expanded' : 'hidden');
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
    if (e.key === 'Escape' && getState() !== 'hidden') {
      applyState('hidden');
    }
  });
})();
