/**
 * Pipeline Import / Export dropdown menus — portaled so toolbar overflow does not clip them.
 */
(function () {
  /** @type {{ trigger: HTMLElement, panel: HTMLElement }[]} */
  var menuPairs = [];

  function closePipelineMenus() {
    document.querySelectorAll('[data-pipeline-menu-panel]').forEach(function (panel) {
      panel.classList.add('hidden');
    });
    document.querySelectorAll('[data-pipeline-menu-trigger]').forEach(function (trigger) {
      trigger.setAttribute('aria-expanded', 'false');
    });
  }

  function pipelineMenuSolidBg() {
    return document.documentElement.classList.contains('dark') ? '#0f172a' : '#ffffff';
  }

  function applyPipelineMenuSurface(panel) {
    if (!panel) return;
    var bg = pipelineMenuSolidBg();
    panel.style.backgroundColor = bg;
    panel.style.background = bg;
    panel.style.backdropFilter = 'none';
    panel.style.webkitBackdropFilter = 'none';
    panel.style.opacity = '1';
  }

  function positionPipelineMenuPanel(trigger, panel) {
    if (!trigger || !panel) return;
    if (panel.parentElement !== document.body) {
      document.body.appendChild(panel);
    }
    applyPipelineMenuSurface(panel);
    var rect = trigger.getBoundingClientRect();
    panel.style.position = 'fixed';
    panel.style.top = Math.round(rect.bottom + 8) + 'px';
    panel.style.right = Math.round(window.innerWidth - rect.right) + 'px';
    panel.style.left = 'auto';
    panel.style.bottom = 'auto';
    panel.style.minWidth = '13.5rem';
    panel.style.zIndex = '10000';
  }

  function repositionOpenMenus() {
    menuPairs.forEach(function (pair) {
      if (pair.panel && !pair.panel.classList.contains('hidden')) {
        positionPipelineMenuPanel(pair.trigger, pair.panel);
      }
    });
  }

  function initPipelineImportExportMenus() {
    var input = document.getElementById('leadsCsvFile');
    var hint = document.getElementById('csvFileAttachHint');
    var nameEl = document.getElementById('csvFileNameDisplay');
    var form = document.getElementById('leadsCsvImportForm');
    var uploadButton = document.getElementById('leadsCsvUploadButton');
    var uploadSpinner = document.getElementById('leadsCsvUploadSpinner');

    menuPairs = [];

    document.querySelectorAll('[data-pipeline-menu]').forEach(function (menu) {
      var trigger = menu.querySelector('[data-pipeline-menu-trigger]');
      var panel = menu.querySelector('[data-pipeline-menu-panel]');
      if (!trigger || !panel) return;

      menuPairs.push({ trigger: trigger, panel: panel });
      document.body.appendChild(panel);
      panel.classList.add('hidden');
      applyPipelineMenuSurface(panel);

      trigger.addEventListener('click', function (e) {
        e.stopPropagation();
        var open = !panel.classList.contains('hidden');
        closePipelineMenus();
        if (!open) {
          positionPipelineMenuPanel(trigger, panel);
          panel.classList.remove('hidden');
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

    document.addEventListener('click', closePipelineMenus);
    window.addEventListener('resize', repositionOpenMenus, { passive: true });
    window.addEventListener('scroll', repositionOpenMenus, { passive: true, capture: true });

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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPipelineImportExportMenus);
  } else {
    initPipelineImportExportMenus();
  }
})();
