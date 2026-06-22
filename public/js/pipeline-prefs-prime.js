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
    { id: 'listingPrice', defaultHidden: true },
    { id: 'listingBeds', defaultHidden: true },
    { id: 'listingBaths', defaultHidden: true },
    { id: 'city', defaultHidden: true },
    { id: 'state', defaultHidden: true },
    { id: 'listingSource', defaultHidden: true },
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

  var REAL_ESTATE_IMPORT_COLUMNS = [
    'company',
    'listingPrice',
    'listingBeds',
    'listingBaths',
    'city',
    'state',
    'listingSource',
    'reviews',
    'website',
    'contact',
  ];

  function applyRealEstateImportColumnVis(vis) {
    REAL_ESTATE_IMPORT_COLUMNS.forEach(function (id) {
      vis[id] = true;
    });
    return vis;
  }

  function wantsRealEstateColumnPreset() {
    try {
      var params = new URLSearchParams(window.location.search || '');
      return params.get('realEstate') === '1' || params.get('preset') === 'real_estate';
    } catch (_) {
      return false;
    }
  }

  var PLC_MIN_WIDTH = { socials: 120, contact: 168, website: 72, methods: 88, listingPrice: 72, listingSource: 96 };

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
    if (wantsRealEstateColumnPreset()) {
      vis = applyRealEstateImportColumnVis(vis);
      try {
        localStorage.setItem(VIS_KEY, JSON.stringify(vis));
      } catch (_) {
        /* ignore */
      }
    }
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

      css.push(
        '#prospectLeadsTable:not([data-pipeline-paging-primed="1"]) tbody tr.result-row:nth-child(n+' +
          (PAGE_SIZE + 1) +
          '){display:none!important}',
      );

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
      table.setAttribute('data-pipeline-paging-primed', '1');
      document.documentElement.classList.remove('pipeline-prefs-pending');
      document.documentElement.setAttribute('data-pipeline-prefs-ready', '1');
      try {
        document.dispatchEvent(new CustomEvent('adhello-pipeline-prefs-ready'));
      } catch (_) {
        /* ignore */
      }
    } catch (_) {
      /* ignore */
    }
  }

  window.__primePipelinePrefsHead = primeHead;
  window.__primePipelinePrefsDom = primeDom;
  window.__PIPELINE_COL_META = PLC_META;

  primeHead();

  function releasePipelinePrefsPending() {
    if (document.documentElement.getAttribute('data-pipeline-prefs-ready') === '1') return;
    document.documentElement.classList.remove('pipeline-prefs-pending');
    document.documentElement.setAttribute('data-pipeline-prefs-ready', '1');
    try {
      document.dispatchEvent(new CustomEvent('adhello-pipeline-prefs-ready'));
    } catch (_) {
      /* ignore */
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(releasePipelinePrefsPending, 4000);
  });
})();
