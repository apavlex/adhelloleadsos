/**
 * Pipeline Import / Export dropdown menus — portaled so toolbar overflow does not clip them.
 * Also owns the transfer progress chip (percent + ETA) for CSV / Drive import and export.
 */
(function () {
  /** @type {{ trigger: HTMLElement, panel: HTMLElement }[]} */
  var menuPairs = [];
  var initDone = false;
  var docClickBound = false;
  var pollTimer = null;
  var transferStartedAt = 0;
  var transferProcessedAtStart = 0;

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

  function els() {
    return {
      hint: document.getElementById('csvFileAttachHint'),
      nameEl: document.getElementById('csvFileNameDisplay'),
      actionEl: document.getElementById('csvTransferActionLabel'),
      percentEl: document.getElementById('csvTransferPercent'),
      detailEl: document.getElementById('csvTransferDetail'),
      barEl: document.getElementById('csvTransferBar'),
      uploadButton: document.getElementById('leadsCsvUploadButton'),
      uploadSpinner: document.getElementById('leadsCsvUploadSpinner'),
    };
  }

  function formatEta(ms) {
    if (!Number.isFinite(ms) || ms < 1500) return '';
    var sec = Math.ceil(ms / 1000);
    if (sec < 60) return '~' + sec + 's left';
    var min = Math.ceil(sec / 60);
    if (min < 60) return '~' + min + 'm left';
    return '~' + Math.ceil(min / 60) + 'h left';
  }

  function formatCounts(processed, total) {
    var p = Number(processed) || 0;
    var t = Number(total) || 0;
    if (!t) return '';
    return p.toLocaleString() + ' / ' + t.toLocaleString();
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function showTransferProgress(opts) {
    var e = els();
    var action = (opts && opts.action) || 'Importing';
    var fileName = (opts && opts.fileName) || '';
    var percent = Math.max(0, Math.min(100, Math.round(Number(opts && opts.percent) || 0)));
    transferStartedAt = Date.now();
    transferProcessedAtStart = Number(opts && opts.processed) || 0;
    if (e.actionEl) e.actionEl.textContent = action;
    if (e.nameEl) e.nameEl.textContent = fileName;
    if (e.percentEl) e.percentEl.textContent = percent + '%';
    if (e.barEl) e.barEl.style.width = percent + '%';
    if (e.detailEl) e.detailEl.textContent = (opts && opts.detail) || 'Starting…';
    if (e.hint) {
      e.hint.classList.remove('hidden');
      e.hint.classList.add('flex');
      e.hint.setAttribute('aria-busy', 'true');
    }
    if (e.uploadButton) e.uploadButton.disabled = true;
    if (e.uploadSpinner) e.uploadSpinner.classList.remove('hidden');
  }

  function updateTransferProgress(opts) {
    var e = els();
    var percent = Math.max(0, Math.min(100, Math.round(Number(opts && opts.percent) || 0)));
    var processed = Number(opts && opts.processed) || 0;
    var total = Number(opts && opts.total) || 0;
    if (e.percentEl) e.percentEl.textContent = percent + '%';
    if (e.barEl) e.barEl.style.width = percent + '%';
    if (opts && opts.action && e.actionEl) e.actionEl.textContent = opts.action;
    if (opts && opts.fileName && e.nameEl) e.nameEl.textContent = opts.fileName;

    var parts = [];
    var counts = formatCounts(processed, total);
    if (counts) parts.push(counts);
    if (opts && opts.detail) parts.push(String(opts.detail));

    var etaMs = Number(opts && opts.etaMs);
    if (!Number.isFinite(etaMs) && total > 0 && processed > transferProcessedAtStart) {
      var elapsed = Date.now() - transferStartedAt;
      var doneDelta = processed - transferProcessedAtStart;
      if (elapsed > 800 && doneDelta > 0) {
        var rate = doneDelta / elapsed;
        etaMs = (total - processed) / rate;
      }
    }
    var eta = formatEta(etaMs);
    if (eta) parts.push(eta);
    if (e.detailEl) e.detailEl.textContent = parts.join(' · ') || 'Working…';
  }

  function hideTransferProgress() {
    stopPolling();
    var e = els();
    if (e.hint) {
      e.hint.classList.add('hidden');
      e.hint.classList.remove('flex');
      e.hint.removeAttribute('aria-busy');
    }
    if (e.percentEl) e.percentEl.textContent = '0%';
    if (e.barEl) e.barEl.style.width = '0%';
    if (e.detailEl) e.detailEl.textContent = '';
    if (e.uploadButton) e.uploadButton.disabled = false;
    if (e.uploadSpinner) e.uploadSpinner.classList.add('hidden');
  }

  function redirectAfterImport(job) {
    var q =
      'tab=pipeline&origin=csv&includeFoldered=1&source=all&rows=' +
      encodeURIComponent(job.total || 0) +
      '&rawRows=' +
      encodeURIComponent(job.rawRowCount != null ? job.rawRowCount : job.total || 0) +
      '&rejected=' +
      encodeURIComponent(job.rejected || 0) +
      '&created=' +
      encodeURIComponent(job.created || 0) +
      '&updated=' +
      encodeURIComponent(job.updated || 0) +
      '&imported=' +
      encodeURIComponent(job.imported || (job.created || 0) + (job.updated || 0)) +
      '&skipped=' +
      encodeURIComponent(job.skipped || 0) +
      '&failed=' +
      encodeURIComponent(job.failed || 0);
    if (job.realEstateImport) q += '&realEstate=1';
    window.location.href = '/prospecting?' + q;
  }

  function pollImportJob(jobId) {
    stopPolling();
    var tick = function () {
      fetch('/leads/import/status/' + encodeURIComponent(jobId), {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      })
        .then(function (r) {
          return r.json().then(function (j) {
            return { ok: r.ok, j: j };
          });
        })
        .then(function (pack) {
          if (!pack.ok || !pack.j || !pack.j.success || !pack.j.job) {
            throw new Error((pack.j && pack.j.error) || 'Could not read import progress.');
          }
          var job = pack.j.job;
          updateTransferProgress({
            action: 'Importing',
            fileName: job.fileName,
            percent: job.percent,
            processed: job.processed,
            total: job.total,
            detail:
              job.status === 'queued'
                ? 'Queued…'
                : job.created || job.updated
                  ? job.created + ' new · ' + job.updated + ' updated'
                  : '',
          });
          if (job.status === 'done') {
            stopPolling();
            updateTransferProgress({
              percent: 100,
              processed: job.total,
              total: job.total,
              detail: 'Finishing…',
              etaMs: 0,
            });
            redirectAfterImport(job);
            return;
          }
          if (job.status === 'error') {
            stopPolling();
            hideTransferProgress();
            alert(job.error || 'Import failed');
          }
        })
        .catch(function (err) {
          stopPolling();
          hideTransferProgress();
          alert((err && err.message) || 'Import failed');
        });
    };
    tick();
    pollTimer = setInterval(tick, 700);
  }

  function startAsyncCsvImport(file) {
    showTransferProgress({
      action: 'Importing',
      fileName: file.name,
      percent: 1,
      detail: 'Uploading file…',
    });
    var body = new FormData();
    body.append('csvfile', file);
    fetch('/leads/import?async=1', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      body: body,
    })
      .then(function (r) {
        return r.json().then(function (j) {
          return { ok: r.ok, j: j };
        });
      })
      .then(function (pack) {
        if (!pack.ok || !pack.j || !pack.j.success) {
          throw new Error((pack.j && pack.j.error) || 'Import failed');
        }
        if (pack.j.async && pack.j.jobId) {
          updateTransferProgress({
            percent: (pack.j.job && pack.j.job.percent) || 2,
            detail: 'Processing rows…',
          });
          pollImportJob(pack.j.jobId);
          return;
        }
        // Sync JSON fallback
        redirectAfterImport({
          total: pack.j.totalRows || 0,
          rawRowCount: pack.j.totalRows || 0,
          created: pack.j.created || 0,
          updated: pack.j.updated || 0,
          imported: pack.j.imported || 0,
          skipped: pack.j.skipped || 0,
          failed: pack.j.failed || 0,
          rejected: 0,
          realEstateImport: !!pack.j.realEstateImport,
        });
      })
      .catch(function (err) {
        hideTransferProgress();
        alert((err && err.message) || 'Import failed');
      });
  }

  function watchDriveImportJob(jobId, fileName) {
    showTransferProgress({
      action: 'Importing',
      fileName: fileName || 'Google Drive',
      percent: 2,
      detail: 'Processing rows…',
    });
    pollImportJob(jobId);
  }

  function initPipelineImportExportMenus() {
    if (initDone) return;
    initDone = true;

    var input = document.getElementById('leadsCsvFile');
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

      input.addEventListener('change', function () {
        var f = input.files && input.files[0];
        if (!f) return;
        startAsyncCsvImport(f);
        try {
          input.value = '';
        } catch (_) {
          /* ignore */
        }
      });

      if (form && uploadButton) {
        form.addEventListener('submit', function (ev) {
          // Prefer async XHR path; block classic full-page submit when JS is alive.
          if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
          var f = input.files && input.files[0];
          if (f) startAsyncCsvImport(f);
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

    // Silence unused lint for uploadSpinner when form path unused
    if (uploadSpinner && uploadButton) {
      /* reserved for begin-import busy state */
    }
  }

  window.__primePipelineImportExportMenus = primeMenuPanelsEarly;
  window.__initPipelineImportExportMenus = initPipelineImportExportMenus;
  window.__pipelineTransferProgress = {
    show: showTransferProgress,
    update: updateTransferProgress,
    hide: hideTransferProgress,
    watchImportJob: watchDriveImportJob,
    formatEta: formatEta,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPipelineImportExportMenus);
  } else {
    initPipelineImportExportMenus();
  }
})();
