/**
 * Pipeline Import / Export dropdown menus — portaled so toolbar overflow does not clip them.
 */
(function () {
  /** @type {{ trigger: HTMLElement, panel: HTMLElement }[]} */
  var menuPairs = [];
  var initDone = false;
  var docClickBound = false;

  function resolveMenuPanel(menu, trigger) {
    if (!menu && !trigger) return null;
    var menuId =
      (menu && menu.getAttribute('data-pipeline-menu-id')) ||
      (trigger && trigger.getAttribute('data-pipeline-menu-id')) ||
      '';
    if (menuId) {
      var byId = document.querySelector(
        '[data-pipeline-menu-panel][data-pipeline-menu-id="' + menuId + '"]',
      );
      if (byId) return byId;
    }
    if (menu) {
      var nested = menu.querySelector('[data-pipeline-menu-panel]');
      if (nested) return nested;
    }
    return null;
  }

  function menuPanelSolidBg() {
    return document.documentElement.classList.contains('dark') ? '#0f172a' : '#ffffff';
  }

  function applyMenuPanelSurface(panel) {
    if (!panel) return;
    var bg = menuPanelSolidBg();
    var shadow =
      '0 16px 40px -10px rgba(15, 23, 42, 0.18), 0 6px 16px -6px rgba(15, 23, 42, 0.12)';
    panel.style.setProperty('background-color', bg, 'important');
    panel.style.setProperty('background-image', 'none', 'important');
    panel.style.setProperty('background', bg, 'important');
    panel.style.setProperty('backdrop-filter', 'none', 'important');
    panel.style.setProperty('-webkit-backdrop-filter', 'none', 'important');
    panel.style.setProperty('opacity', '1', 'important');
    panel.style.setProperty('isolation', 'isolate', 'important');
    panel.style.setProperty('box-shadow', shadow, 'important');
    if (typeof window.applyPortaledPopoverSurface === 'function') {
      window.applyPortaledPopoverSurface(panel);
    }
    panel.querySelectorAll('.pipeline-import-export-menu-panel__surface').forEach(function (inner) {
      inner.style.setProperty('background-color', bg, 'important');
      inner.style.setProperty('background-image', 'none', 'important');
      inner.style.setProperty('background', bg, 'important');
    });
  }

  function hideMenuPanel(panel) {
    if (!panel) return;
    panel.classList.add('hidden');
    panel.setAttribute('hidden', 'hidden');
    panel.style.setProperty('display', 'none', 'important');
  }

  function showMenuPanel(panel) {
    if (!panel) return;
    panel.classList.remove('hidden');
    panel.removeAttribute('hidden');
    panel.style.setProperty('display', 'block', 'important');
  }

  function closePipelineMenus() {
    document.querySelectorAll('[data-pipeline-menu-panel]').forEach(hideMenuPanel);
    document.querySelectorAll('[data-pipeline-menu-trigger]').forEach(function (trigger) {
      trigger.setAttribute('aria-expanded', 'false');
    });
  }

  function positionPipelineMenuPanel(trigger, panel) {
    if (!trigger || !panel) return;
    if (panel.parentElement !== document.body) {
      document.body.appendChild(panel);
    }
    applyMenuPanelSurface(panel);
    var rect = trigger.getBoundingClientRect();
    panel.style.position = 'fixed';
    panel.style.top = Math.round(rect.bottom + 8) + 'px';
    panel.style.right = Math.max(12, Math.round(window.innerWidth - rect.right)) + 'px';
    panel.style.left = 'auto';
    panel.style.bottom = 'auto';
    panel.style.minWidth = '13.5rem';
    panel.style.zIndex = '10000';
  }

  function openPipelineMenuPanel(trigger, panel) {
    positionPipelineMenuPanel(trigger, panel);
    applyMenuPanelSurface(panel);
    showMenuPanel(panel);
    applyMenuPanelSurface(panel);
    requestAnimationFrame(function () {
      applyMenuPanelSurface(panel);
    });
  }

  function repositionOpenMenus() {
    menuPairs.forEach(function (pair) {
      if (pair.panel && !pair.panel.classList.contains('hidden')) {
        positionPipelineMenuPanel(pair.trigger, pair.panel);
        applyMenuPanelSurface(pair.panel);
      }
    });
  }

  function primeMenuPanelsEarly() {
    document.querySelectorAll('[data-pipeline-menu-panel]').forEach(function (panel) {
      hideMenuPanel(panel);
      applyMenuPanelSurface(panel);
    });
  }

  function initPipelineImportExportMenus() {
    if (initDone) return;
    initDone = true;

    var input = document.getElementById('leadsCsvFile');
    var hint = document.getElementById('csvFileAttachHint');
    var nameEl = document.getElementById('csvFileNameDisplay');
    var form = document.getElementById('leadsCsvImportForm');
    var uploadButton = document.getElementById('leadsCsvUploadButton');
    var uploadSpinner = document.getElementById('leadsCsvUploadSpinner');

    menuPairs = [];

    document.querySelectorAll('[data-pipeline-menu]').forEach(function (menu) {
      var trigger = menu.querySelector('[data-pipeline-menu-trigger]');
      var panel = resolveMenuPanel(menu, trigger);
      if (!trigger || !panel) return;

      menuPairs.push({ trigger: trigger, panel: panel });
      document.body.appendChild(panel);
      hideMenuPanel(panel);
      applyMenuPanelSurface(panel);

      trigger.addEventListener('click', function (e) {
        e.stopPropagation();
        var open = !panel.classList.contains('hidden');
        closePipelineMenus();
        if (!open) {
          openPipelineMenuPanel(trigger, panel);
          trigger.setAttribute('aria-expanded', 'true');
        }
      });

      panel.addEventListener('click', function (e) {
        e.stopPropagation();
      });

      panel.querySelectorAll('button, a').forEach(function (item) {
        item.addEventListener('click', function () {
          closePipelineMenus();
        });
      });
    });

    if (!docClickBound) {
      docClickBound = true;
      document.addEventListener('click', closePipelineMenus);
      window.addEventListener('resize', repositionOpenMenus, { passive: true });
      window.addEventListener('scroll', repositionOpenMenus, { passive: true, capture: true });
    }

    if (input) {
      document.querySelectorAll('.js-import-computer').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
          input.click();
        });
      });

      function beginImportUi(filename) {
        if (nameEl && filename) nameEl.textContent = filename;
        if (hint) {
          hint.classList.remove('hidden');
          hint.classList.add('flex');
        }
        if (uploadButton) uploadButton.disabled = true;
        if (uploadSpinner) uploadSpinner.classList.remove('hidden');
      }

      input.addEventListener('change', function () {
        var f = input.files && input.files[0];
        if (!f || !form) return;
        beginImportUi(f.name);
        if (typeof form.requestSubmit === 'function') form.requestSubmit();
        else form.submit();
      });

      if (form && uploadButton) {
        form.addEventListener('submit', function () {
          uploadButton.disabled = true;
          uploadButton.setAttribute('aria-busy', 'true');
          if (uploadSpinner) uploadSpinner.classList.remove('hidden');
        });
      }

      var params = new URLSearchParams(window.location.search);
      if (params.get('action') === 'import') {
        setTimeout(function () {
          input.click();
        }, 400);
        params.delete('action');
        var clean =
          window.location.pathname +
          (params.toString() ? '?' + params.toString() : '') +
          window.location.hash;
        window.history.replaceState({}, '', clean);
      }
    }
  }

  window.__primePipelineImportExportMenus = primeMenuPanelsEarly;
  window.__initPipelineImportExportMenus = initPipelineImportExportMenus;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPipelineImportExportMenus);
  } else {
    initPipelineImportExportMenus();
  }
})();
