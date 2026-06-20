/**
 * Apply saved pipeline table prefs before paint (columns, density, view mode, paging).
 * Head: inject CSS + html attributes. After table: density class + row paging.
 */
(function () {
  'use strict';

  var VIS_KEY = 'pipelineTableColVisibility';
  var WIDTH_KEY = 'pipelineTableColWidths';
  var DENSITY_KEY = 'prospectLeadTableDensity';
  var VIEW_KEY = 'adhello_pipeline_view';
  var PAGE_SIZE = 54;

  var PLC_META = [
    { id: 'company' },
    { id: 'lastTouch' },
    { id: 'cadence' },
    { id: 'category' },
    { id: 'reviews' },
    { id: 'website', defaultHidden: true },
    { id: 'claimStatus', defaultHidden: true },
    { id: 'optimizationScore', defaultHidden: true },
    { id: 'contact' },
    { id: 'socials' },
    { id: 'added' },
    { id: 'pipeline' },
    { id: 'opportunity' },
    { id: 'methods' },
    { id: 'actions' },
  ];

  var PLC_MIN_WIDTH = { socials: 120, contact: 168, website: 72, methods: 88 };

  function colVisible(map, id) {
    var meta = null;
    for (var i = 0; i < PLC_META.length; i += 1) {
      if (PLC_META[i].id === id) {
        meta = PLC_META[i];
        break;
      }
    }
    var defaultOn = !(meta && meta.defaultHidden);
    if (!Object.prototype.hasOwnProperty.call(map, id)) return defaultOn;
    return map[id] !== false;
  }

  function readVis() {
    var vis = {};
    try {
      vis = JSON.parse(localStorage.getItem(VIS_KEY) || '{}');
    } catch (_) {
      vis = {};
    }
    if (vis && vis.check === false) delete vis.check;
    return vis;
  }

  function primeHead() {
    if (window.__pipelinePrefsHeadPrimed) return;
    window.__pipelinePrefsHeadPrimed = true;

    try {
      var vis = readVis();
      var css = [];

      PLC_META.forEach(function (m) {
        if (!colVisible(vis, m.id)) {
          css.push('#prospectLeadsTable [data-plc="' + m.id + '"]{display:none!important}');
        }
      });

      var widths = {};
      try {
        widths = JSON.parse(localStorage.getItem(WIDTH_KEY) || '{}');
      } catch (_) {
        widths = {};
      }
      Object.keys(widths).forEach(function (id) {
        var px = Number(widths[id]);
        var floor = PLC_MIN_WIDTH[id] || 48;
        if (!Number.isFinite(px)) return;
        px = Math.max(floor, px);
        css.push(
          '#prospectLeadsTable [data-plc="' +
            id +
            '"]{width:' +
            px +
            'px;min-width:' +
            px +
            'px;max-width:' +
            px +
            'px}',
        );
      });

      var density = localStorage.getItem(DENSITY_KEY) === 'comfortable' ? 'comfortable' : 'compact';
      document.documentElement.setAttribute('data-prospect-density', density);

      var view = sessionStorage.getItem(VIEW_KEY);
      if (view === 'kanban') {
        document.documentElement.classList.add('adhello-pipeline-view-kanban');
        css.push('html.adhello-pipeline-view-kanban #tableView{display:none!important}');
        css.push('html.adhello-pipeline-view-kanban #kanbanView{display:block!important}');
      }

      if (css.length) {
        var el = document.createElement('style');
        el.id = 'pipeline-prefs-prime';
        el.textContent = css.join('\n');
        document.head.appendChild(el);
      }

      window.__pipelinePrefsPrimed = true;
      window.__pipelinePrefsPrimedVis = vis;
      window.__pipelinePrefsPrimedDensity = density;
    } catch (_) {
      /* ignore */
    }
  }

  function syncDensityButtons(mode) {
    var d = mode === 'comfortable' ? 'comfortable' : 'compact';
    document.querySelectorAll('#tableView .lead-density-btn').forEach(function (btn) {
      var on = (btn.getAttribute('data-density') || 'compact') === d;
      btn.classList.toggle('lead-density-btn--active', on);
    });
  }

  function primeDom() {
    if (window.__pipelinePrefsDomPrimed) return;
    var table = document.getElementById('prospectLeadsTable');
    if (!table) return;
    window.__pipelinePrefsDomPrimed = true;

    try {
      var density =
        document.documentElement.getAttribute('data-prospect-density') ||
        (localStorage.getItem(DENSITY_KEY) === 'comfortable' ? 'comfortable' : 'compact');
      table.classList.remove('prospect-leads-table--comfortable', 'prospect-leads-table--compact');
      table.classList.add(
        density === 'comfortable' ? 'prospect-leads-table--comfortable' : 'prospect-leads-table--compact',
      );
      syncDensityButtons(density);

      var tbody = table.querySelector('tbody');
      if (tbody) {
        var rows = tbody.querySelectorAll('tr.result-row');
        rows.forEach(function (row, index) {
          if (index >= PAGE_SIZE) row.classList.add('pipeline-row-page-hidden');
        });
      }
      table.dataset.pipelinePrefsPrimed = '1';
    } catch (_) {
      /* ignore */
    }
  }

  window.__primePipelinePrefsHead = primeHead;
  window.__primePipelinePrefsDom = primeDom;
  window.__PIPELINE_COL_META = PLC_META;

  primeHead();
})();
