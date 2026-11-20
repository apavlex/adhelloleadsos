(function () {
  var STORAGE_KEY = 'adhello-sidebar';
  var SETTINGS_KEY = 'adhello-sidebar-settings';
  var body = document.body;
  if (!body || !document.getElementById('appSidebar')) return;

  function hasContextSidebar() {
    return !!document.getElementById('appContextSidebar') && (
      body.classList.contains('has-context-sidebar') ||
      body.classList.contains('nav-submenu-open')
    );
  }

  function hasPageContextSidebar() {
    var el = document.getElementById('appContextSidebar');
    return !!(el && el.getAttribute('data-has-page-context') === '1');
  }

  function getState() {
    try {
      var s = localStorage.getItem(STORAGE_KEY);
      if (s === 'collapsed' || s === 'hidden') return s;
      // With the 2nd menu open, prefer the icon rail by default (Instantly-style).
      // Still honor an explicit expand for this session via applyState('expanded').
      if (hasContextSidebar() && s !== 'expanded') return 'collapsed';
      if (s === 'expanded') return 'expanded';
    } catch (e) {}
    return hasContextSidebar() ? 'collapsed' : 'expanded';
  }

  function ensureSidebarHoverLabels() {
    var root = document.getElementById('appSidebar');
    if (!root) return;
    var nodes = root.querySelectorAll('.sidebar-nav-link, .sidebar-ws-btn, .sidebar-settings-toggle');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.getAttribute('data-label')) continue;
      var span = el.querySelector(':scope > span, .sidebar-settings-label, .sidebar-ws-text > span:first-child');
      var label = span ? String(span.textContent || '').trim() : '';
      if (!label) label = String(el.getAttribute('aria-label') || el.getAttribute('title') || '').trim();
      // Prefer the short menu name (before an em dash / en dash description).
      label = label.replace(/\s+[—–-]\s+.*$/, '').trim();
      if (label) el.setAttribute('data-label', label);
    }
  }

  function getInstantHoverTip() {
    var tip = document.getElementById('sidebarInstantHoverTip');
    if (tip) return tip;
    tip = document.createElement('div');
    tip.id = 'sidebarInstantHoverTip';
    /* Must be .app-body-portal — desktop sidebar grid crushes other body children to height:0. */
    tip.className = 'app-body-portal';
    tip.setAttribute('role', 'tooltip');
    tip.setAttribute('aria-hidden', 'true');
    document.body.appendChild(tip);
    return tip;
  }

  function hideInstantHoverTip() {
    var tip = document.getElementById('sidebarInstantHoverTip');
    if (!tip) return;
    tip.classList.remove('is-visible');
    tip.setAttribute('aria-hidden', 'true');
    tip.textContent = '';
  }

  function hoverLabelTarget(root, from) {
    if (!from || !from.closest) return null;
    var t = from.closest(
      '.sidebar-nav-link[data-label], .sidebar-ws-btn[data-label], .sidebar-settings-toggle[data-label]',
    );
    return t && root.contains(t) ? t : null;
  }

  function showInstantHoverTip(el) {
    if (!body.classList.contains('sidebar-collapsed') || !el) {
      hideInstantHoverTip();
      return;
    }
    var label = String(el.getAttribute('data-label') || '').trim();
    if (!label) {
      hideInstantHoverTip();
      return;
    }
    var tip = getInstantHoverTip();
    tip.textContent = label;
    var rect = el.getBoundingClientRect();
    tip.style.left = Math.round(rect.right + 10) + 'px';
    tip.style.top = Math.round(rect.top + rect.height / 2) + 'px';
    tip.classList.add('is-visible');
    tip.setAttribute('aria-hidden', 'false');
  }

  function bindInstantHoverLabels() {
    var root = document.getElementById('appSidebar');
    if (!root || root.dataset.instantHoverBound === '1') return;
    root.dataset.instantHoverBound = '1';
    root.addEventListener('pointerover', function (e) {
      var t = hoverLabelTarget(root, e.target);
      if (!t) return;
      showInstantHoverTip(t);
    });
    root.addEventListener('pointerout', function (e) {
      var next = e.relatedTarget;
      if (next && root.contains(next)) {
        var t = hoverLabelTarget(root, next);
        if (t) {
          showInstantHoverTip(t);
          return;
        }
      }
      hideInstantHoverTip();
    });
    root.addEventListener('focusin', function (e) {
      var t = hoverLabelTarget(root, e.target);
      if (!t) return;
      showInstantHoverTip(t);
    });
    root.addEventListener('focusout', function (e) {
      var next = e.relatedTarget;
      if (next && root.contains(next) && hoverLabelTarget(root, next)) return;
      hideInstantHoverTip();
    });
  }

  function syncNativeTitlesForCollapsed(collapsed) {
    var root = document.getElementById('appSidebar');
    if (!root) return;
    var nodes = root.querySelectorAll('[data-label]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (collapsed) {
        if (el.hasAttribute('title') && !el.hasAttribute('data-title-native')) {
          el.setAttribute('data-title-native', el.getAttribute('title') || '');
        }
        el.removeAttribute('title');
      } else if (el.hasAttribute('data-title-native')) {
        el.setAttribute('title', el.getAttribute('data-title-native') || '');
        el.removeAttribute('data-title-native');
      }
    }
    if (!collapsed) hideInstantHoverTip();
  }

  function applyState(state) {
    body.classList.remove('sidebar-collapsed', 'sidebar-hidden');
    if (state === 'collapsed') body.classList.add('sidebar-collapsed');
    if (state === 'hidden') body.classList.add('sidebar-hidden');
    try {
      localStorage.setItem(STORAGE_KEY, state);
    } catch (e) {}
    ensureSidebarHoverLabels();
    bindInstantHoverLabels();
    syncNativeTitlesForCollapsed(state === 'collapsed');
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

  // When a page context menu is present, force icon-rail on load even if the
  // user last left the primary nav expanded on a single-sidebar page.
  if (hasPageContextSidebar()) {
    var initial = getState();
    applyState(initial === 'hidden' ? 'hidden' : 'collapsed');
  } else {
    applyState(getState());
  }

  var settingsToggle = document.getElementById('sidebarSettingsToggle');
  var settingsMenu = document.getElementById('sidebarSettingsMenu');
  var settingsBlock = document.querySelector('.sidebar-settings-block');
  var contextSidebar = document.getElementById('appContextSidebar');
  var contextPagePanel = document.getElementById('contextSidebarPagePanel');
  var contextNavPanel = document.getElementById('contextSidebarNavPanel');
  var contextNavLinks = document.getElementById('contextSidebarNavLinks');
  var contextTitle = document.getElementById('contextSidebarTitle');
  var contextEyebrow = document.getElementById('contextSidebarEyebrow');
  var contextSubtitle = document.getElementById('contextSidebarSubtitle');
  var pageContextMeta = null;
  var activeNavSubmenu = null;

  function capturePageContextMeta() {
    if (pageContextMeta) return pageContextMeta;
    pageContextMeta = {
      title: contextTitle ? String(contextTitle.textContent || '').trim() : 'Page',
      eyebrow: contextEyebrow ? String(contextEyebrow.textContent || '').trim() : 'Menu',
      subtitle: contextSubtitle ? String(contextSubtitle.textContent || '').trim() : '',
      subtitleHidden: !!(contextSubtitle && contextSubtitle.classList.contains('hidden')),
      hasPage: !!(contextSidebar && contextSidebar.getAttribute('data-has-page-context') === '1'),
    };
    return pageContextMeta;
  }

  function restorePageContextHeader() {
    var meta = capturePageContextMeta();
    if (contextTitle) contextTitle.textContent = meta.title || 'Page';
    if (contextEyebrow) contextEyebrow.textContent = meta.eyebrow || 'Menu';
    if (contextSubtitle) {
      contextSubtitle.textContent = meta.subtitle || '';
      contextSubtitle.classList.toggle('hidden', meta.subtitleHidden || !meta.subtitle);
    }
  }

  function setContextHeader(opts) {
    opts = opts || {};
    if (contextEyebrow) contextEyebrow.textContent = opts.eyebrow || 'Menu';
    if (contextTitle) contextTitle.textContent = opts.title || 'Menu';
    if (contextSubtitle) {
      var sub = String(opts.subtitle || '').trim();
      contextSubtitle.textContent = sub;
      contextSubtitle.classList.toggle('hidden', !sub);
    }
  }

  function ensureIconRailForSubmenu() {
    if (getState() === 'expanded') applyState('collapsed');
  }

  function clearNavSubmenuLinks() {
    if (contextNavLinks) contextNavLinks.innerHTML = '';
  }

  function appendContextNavLink(item) {
    if (!contextNavLinks || !item) return;
    var label = String(item.label || '').trim();
    if (!label) return;
    var href = String(item.href || '').trim();
    var el;
    if (item.buttonId || item.action === 'button') {
      el = document.createElement('button');
      el.type = 'button';
      if (item.buttonId) el.id = item.buttonId;
      if (item.attrs) {
        Object.keys(item.attrs).forEach(function (k) {
          el.setAttribute(k, item.attrs[k]);
        });
      }
    } else {
      el = document.createElement('a');
      el.href = href || '#';
      if (item.external) {
        el.target = '_blank';
        el.rel = 'noopener noreferrer';
      }
    }
    el.className = 'app-context-link' + (item.active ? ' is-active' : '');
    if (item.active) el.setAttribute('aria-current', 'page');
    if (item.title) el.title = item.title;
    var span = document.createElement('span');
    span.className = 'truncate';
    span.textContent = label;
    el.appendChild(span);
    contextNavLinks.appendChild(el);
  }

  function collectLinksFromNav(navEl) {
    if (!navEl) return [];
    var out = [];
    var nodes = navEl.querySelectorAll('a.sidebar-nav-link, a.sidebar-nav-sub, button.sidebar-nav-link, button.sidebar-new-item');
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var labelEl = node.querySelector('span') || node;
      var label = String(labelEl.textContent || '').trim();
      if (!label) continue;
      var item = {
        label: label,
        title: node.getAttribute('title') || label,
        active: node.classList.contains('active') || node.getAttribute('aria-current') === 'page',
      };
      if (node.tagName === 'A') {
        item.href = node.getAttribute('href') || '#';
      } else {
        item.action = 'button';
        if (node.id) item.buttonId = node.id + '__ctx';
        item.attrs = {};
        Array.prototype.forEach.call(node.attributes, function (attr) {
          if (!attr || !attr.name) return;
          if (attr.name === 'id' || attr.name === 'class' || attr.name === 'type') return;
          item.attrs[attr.name] = attr.value;
        });
        item._source = node;
      }
      out.push(item);
    }
    return out;
  }

  function wireClonedButtons(items) {
    (items || []).forEach(function (item) {
      if (!item || !item._source || !item.buttonId) return;
      var clone = document.getElementById(item.buttonId);
      if (!clone) return;
      clone.addEventListener('click', function (e) {
        e.preventDefault();
        closeNavSubmenu();
        try {
          item._source.click();
        } catch (_) {}
      });
    });
  }

  function openNavSubmenu(kind, opts) {
    opts = opts || {};
    if (!contextSidebar || !contextNavPanel) return false;
    capturePageContextMeta();
    ensureIconRailForSubmenu();
    clearNavSubmenuLinks();
    var items = Array.isArray(opts.items) ? opts.items : [];
    items.forEach(appendContextNavLink);
    wireClonedButtons(items);
    setContextHeader({
      eyebrow: opts.eyebrow || 'Menu',
      title: opts.title || 'Menu',
      subtitle: opts.subtitle || '',
    });
    activeNavSubmenu = kind || 'menu';
    body.classList.add('nav-submenu-open');
    body.classList.toggle('sidebar-settings-open', kind === 'settings');
    if (settingsToggle) {
      settingsToggle.setAttribute('aria-expanded', kind === 'settings' ? 'true' : 'false');
      settingsToggle.classList.toggle('active', kind === 'settings');
    }
    if (settingsMenu) settingsMenu.classList.add('hidden');
    setContextSidebarOpen(true);
    return true;
  }

  function closeNavSubmenu() {
    if (!body.classList.contains('nav-submenu-open') && !activeNavSubmenu) {
      body.classList.remove('sidebar-settings-open');
      if (settingsToggle) {
        settingsToggle.setAttribute('aria-expanded', 'false');
        settingsToggle.classList.remove('active');
      }
      return;
    }
    activeNavSubmenu = null;
    body.classList.remove('nav-submenu-open', 'sidebar-settings-open');
    clearNavSubmenuLinks();
    restorePageContextHeader();
    if (settingsToggle) {
      settingsToggle.setAttribute('aria-expanded', 'false');
      settingsToggle.classList.remove('active');
    }
    if (settingsMenu) settingsMenu.classList.add('hidden');
    var meta = capturePageContextMeta();
    if (!meta.hasPage) setContextSidebarOpen(false);
  }

  function isSettingsOpen() {
    return activeNavSubmenu === 'settings' || body.classList.contains('sidebar-settings-open');
  }

  function setSettingsOpen(open, persist) {
    if (!settingsToggle) return;
    if (open) {
      var items = collectLinksFromNav(settingsMenu);
      openNavSubmenu('settings', {
        eyebrow: 'Settings',
        title: 'Settings',
        subtitle: 'Workspace tools and setup',
        items: items,
      });
    } else if (activeNavSubmenu === 'settings') {
      closeNavSubmenu();
    }
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
    // Only auto-open Settings into the second bar when the page is already a settings route.
    if (startOpen && settingsBlock && settingsBlock.getAttribute('data-start-open') === '1') {
      setSettingsOpen(true, false);
    } else {
      setSettingsOpen(false, false);
    }

    settingsToggle.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      setSettingsOpen(!isSettingsOpen());
    });

    document.addEventListener('click', function (e) {
      if (!isSettingsOpen()) return;
      if (e.target.closest('.sidebar-settings-block')) return;
      if (e.target.closest('#appContextSidebar')) return;
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

  function setContextSidebarOpen(open) {
    body.classList.toggle('context-sidebar-open', !!open);
  }

  var contextCloseBtn = document.getElementById('contextSidebarCloseBtn');
  if (contextCloseBtn) {
    contextCloseBtn.addEventListener('click', function (e) {
      e.preventDefault();
      if (activeNavSubmenu) closeNavSubmenu();
      else setContextSidebarOpen(false);
    });
  }

  document.addEventListener('click', function (e) {
    var openBtn = e.target && e.target.closest && e.target.closest('.js-open-context-sidebar');
    if (openBtn) {
      e.preventDefault();
      e.stopPropagation();
      setContextSidebarOpen(true);
      return;
    }
    if (!body.classList.contains('context-sidebar-open') && !activeNavSubmenu) return;
    if (e.target.closest('#appContextSidebar')) return;
    if (e.target.closest('#appSidebar')) return;
    if (window.matchMedia && window.matchMedia('(max-width: 767px)').matches) {
      if (activeNavSubmenu) closeNavSubmenu();
      else setContextSidebarOpen(false);
    }
  }, true);

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (activeNavSubmenu) {
      closeNavSubmenu();
      return;
    }
    if (body.classList.contains('context-sidebar-open')) {
      setContextSidebarOpen(false);
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

  function openLeadsSubmenu() {
    var leadsNav = document.querySelector('#appSidebar .sidebar-leads-sub');
    var items = collectLinksFromNav(leadsNav);
    if (!items.length) return false;
    return openNavSubmenu('leads', {
      eyebrow: 'Sales',
      title: 'Leads',
      subtitle: 'Find, queue, pipeline, folders',
      items: items,
    });
  }

  function openAddNewSubmenu(wrap) {
    var menu = wrap && wrap.querySelector ? wrap.querySelector('.sidebar-new-menu') : null;
    var items = collectLinksFromNav(menu);
    if (!items.length) return false;
    return openNavSubmenu('add-new', {
      eyebrow: 'Quick actions',
      title: 'Add New',
      subtitle: 'Opportunity, send lead, referral',
      items: items,
    });
  }

  var leadsSummary = document.querySelector('#appSidebar .sidebar-leads-summary');
  if (leadsSummary) {
    leadsSummary.addEventListener('click', function (e) {
      if (!body.classList.contains('sidebar-collapsed')) return;
      e.preventDefault();
      e.stopPropagation();
      if (activeNavSubmenu === 'leads') closeNavSubmenu();
      else openLeadsSubmenu();
    });
  }

  document.addEventListener(
    'click',
    function (e) {
      var toggle = e.target && e.target.closest && e.target.closest('#appSidebar [data-sidebar-new-toggle]');
      if (!toggle) return;
      if (!body.classList.contains('sidebar-collapsed')) return;
      e.preventDefault();
      e.stopPropagation();
      var wrap = toggle.closest('[data-sidebar-new]');
      if (activeNavSubmenu === 'add-new') closeNavSubmenu();
      else openAddNewSubmenu(wrap);
    },
    true
  );

  window.__adhelloOpenNavSubmenu = openNavSubmenu;
  window.__adhelloCloseNavSubmenu = closeNavSubmenu;

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
    var switcherAttempts = 0;
    function hydrateSwitcherList() {
      if (switcherHydrating) return;
      var existing = wsm.querySelectorAll('form[action="/workspaces/switch"]').length;
      // Always refresh once per page so a cold HTML paint (active-only) gets the full list.
      if (switcherHydrated && existing > 1) return;
      switcherHydrating = true;
      switcherAttempts += 1;
      fetch('/workspaces/switcher.json', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      })
        .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, status: res.status, data: data }; }); })
        .then(function (parsed) {
          switcherHydrating = false;
          var busy =
            !!(parsed.data && parsed.data.pending) ||
            parsed.status === 503 ||
            (!parsed.ok && !(parsed.data && parsed.data.success));
          if (busy && switcherAttempts < 4) {
            setTimeout(hydrateSwitcherList, 500 * switcherAttempts);
            return;
          }
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
        // Only fetch the full list when the menu opens — never idle-prefetch on
        // Reviews/Q&A (that contended with inbox hydrate).
        hydrateSwitcherList();
      }
      wsm.classList.toggle('hidden');
      wsb.setAttribute('aria-expanded', open ? 'true' : 'false');
      var chev = wsb.querySelector('.ws-switcher-chevron');
      if (chev) chev.classList.toggle('rotate-180', open);
    });

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
