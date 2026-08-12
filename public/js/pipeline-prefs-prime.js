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
  var PAGE_SIZE_KEY = 'pipelineTablePageSize';
  var PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

  function resolveInitialPipelineView() {
    try {
      var params = new URLSearchParams(window.location.search || '');
      var explicit = params.get('view');
      if (explicit === 'kanban') return 'kanban';
      if (explicit === 'table') return 'table';
      if (params.get('folderKey')) return 'table';
      return sessionStorage.getItem(VIEW_KEY);
    } catch (_) {
      try {
        return sessionStorage.getItem(VIEW_KEY);
      } catch (err) {
        return null;
      }
    }
  }

  function readPageSize() {
    try {
      var n = parseInt(localStorage.getItem(PAGE_SIZE_KEY) || '25', 10);
      return PAGE_SIZE_OPTIONS.indexOf(n) >= 0 ? n : 25;
    } catch (_) {
      return 25;
    }
  }

  var PLC_META = [
    { id: 'company' },
    { id: 'permitNumber', defaultHidden: true },
    { id: 'permitCategoryCol', defaultHidden: true },
    { id: 'permitStatus', defaultHidden: true },
    { id: 'permitValue', defaultHidden: true },
    { id: 'permitStatusDate', defaultHidden: true },
    { id: 'permitContractor', defaultHidden: true },
    { id: 'permitOwner', defaultHidden: true },
    { id: 'listingPrice', defaultHidden: true },
    { id: 'listingBeds', defaultHidden: true },
    { id: 'listingBaths', defaultHidden: true },
    { id: 'city', defaultHidden: true },
    { id: 'state', defaultHidden: true },
    { id: 'listingSource', defaultHidden: true },
    { id: 'lastTouch' },
    { id: 'engagementSignal' },
    { id: 'cadence' },
    { id: 'category' },
    { id: 'reviews' },
    { id: 'reviewSnippet' },
    { id: 'sponsored' },
    { id: 'website', defaultHidden: true },
    { id: 'claimStatus', defaultHidden: true },
    { id: 'optimizationScore', defaultHidden: true },
    { id: 'phone' },
    { id: 'email' },
    { id: 'domain' },
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
    'phone',
    'email',
    'domain',
  ];

  var PERMITS_IMPORT_COLUMNS = [
    'company',
    'permitNumber',
    'permitCategoryCol',
    'permitStatus',
    'permitValue',
    'permitStatusDate',
    'permitContractor',
    'permitOwner',
    'city',
    'state',
  ];

  var COMPACT_PIPELINE_COLUMNS = ['check', 'company', 'reviews', 'contactGroup', 'socials'];

  function applyRealEstateImportColumnVis(vis) {
    REAL_ESTATE_IMPORT_COLUMNS.forEach(function (id) {
      vis[id] = true;
    });
    return vis;
  }

  function applyPermitsImportColumnVis(vis) {
    PERMITS_IMPORT_COLUMNS.forEach(function (id) {
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

  function wantsPermitsColumnPreset() {
    try {
      var params = new URLSearchParams(window.location.search || '');
      if (params.get('permits') === '1' || params.get('preset') === 'permits') return true;
      return window.PROSPECTING_PERMITS_VIEW === true;
    } catch (_) {
      return false;
    }
  }

  function wantsBusinessesColumnPreset() {
    return window.PROSPECTING_BUSINESSES_VIEW === true;
  }

  function applyBusinessesColumnPreset(vis) {
    vis.website = true;
    return vis;
  }

  var PLC_MIN_WIDTH = {
    socials: 120,
    contactGroup: 168,
    phone: 88,
    email: 96,
    domain: 120,
    website: 72,
    methods: 88,
    listingPrice: 72,
    listingSource: 96,
    permitNumber: 88,
    permitCategoryCol: 96,
    permitStatus: 72,
    permitValue: 80,
    permitStatusDate: 88,
    permitContractor: 112,
    permitOwner: 112,
  };

  function migrateContactColumnVis(vis) {
    if (!vis || typeof vis !== 'object') return vis;
    if (!Object.prototype.hasOwnProperty.call(vis, 'contact')) return vis;
    var on = vis.contact !== false;
    if (!Object.prototype.hasOwnProperty.call(vis, 'phone')) vis.phone = on;
    if (!Object.prototype.hasOwnProperty.call(vis, 'email')) vis.email = on;
    if (!Object.prototype.hasOwnProperty.call(vis, 'domain')) vis.domain = on;
    delete vis.contact;
    return vis;
  }

  function contactGroupVisible(map) {
    return colVisible(map, 'phone') || colVisible(map, 'email') || colVisible(map, 'domain');
  }

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
    var hadLegacyContact = Object.prototype.hasOwnProperty.call(vis, 'contact');
    vis = migrateContactColumnVis(vis);
    if (hadLegacyContact) {
      try {
        localStorage.setItem(VIS_KEY, JSON.stringify(vis));
      } catch (_) {
        /* ignore */
      }
    }
    if (wantsRealEstateColumnPreset()) {
      vis = applyRealEstateImportColumnVis(vis);
      try {
        localStorage.setItem(VIS_KEY, JSON.stringify(vis));
      } catch (_) {
        /* ignore */
      }
    }
    if (wantsPermitsColumnPreset()) {
      vis = applyPermitsImportColumnVis(vis);
      try {
        localStorage.setItem(VIS_KEY, JSON.stringify(vis));
      } catch (_) {
        /* ignore */
      }
    }
    if (wantsBusinessesColumnPreset()) {
      vis = applyBusinessesColumnPreset(vis);
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
      var density = localStorage.getItem(DENSITY_KEY) === 'comfortable' ? 'comfortable' : 'compact';
      var comfortable = density === 'comfortable';

      if (!comfortable) {
        PLC_META.forEach(function (m) {
          css.push('#prospectLeadsTable [data-plc="' + m.id + '"]{display:none!important}');
        });
        COMPACT_PIPELINE_COLUMNS.forEach(function (id) {
          css.push('#prospectLeadsTable [data-plc="' + id + '"]{display:table-cell!important}');
        });
        css.push('#prospectLeadsTable [data-plc="phone"],#prospectLeadsTable [data-plc="email"],#prospectLeadsTable [data-plc="domain"]{display:none!important}');
      } else {
        PLC_META.forEach(function (m) {
          var isSplitContact = m.id === 'phone' || m.id === 'email' || m.id === 'domain';
          if (!colVisible(vis, m.id) || isSplitContact) {
            css.push('#prospectLeadsTable [data-plc="' + m.id + '"]{display:none!important}');
          }
        });
        if (!contactGroupVisible(vis)) {
          css.push('#prospectLeadsTable [data-plc="contactGroup"]{display:none!important}');
        } else {
          css.push('#prospectLeadsTable [data-plc="contactGroup"]{display:table-cell!important}');
          if (!colVisible(vis, 'phone')) {
            css.push('#prospectLeadsTable .lead-contact-row-phone{display:none!important}');
          }
          if (!colVisible(vis, 'email')) {
            css.push('#prospectLeadsTable .lead-contact-row-email{display:none!important}');
          }
          if (!colVisible(vis, 'domain')) {
            css.push('#prospectLeadsTable .lead-contact-row-domain{display:none!important}');
          }
        }
      }

      var widths = {};
      try {
        widths = JSON.parse(localStorage.getItem(WIDTH_KEY) || '{}');
      } catch (_) {
        widths = {};
      }
      if (widths.contact && !widths.contactGroup) {
        widths.contactGroup = widths.contact;
        delete widths.contact;
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

      document.documentElement.setAttribute('data-prospect-density', density);

      var view = resolveInitialPipelineView();
      if (view === 'kanban') {
        document.documentElement.classList.add('adhello-pipeline-view-kanban');
        css.push('html.adhello-pipeline-view-kanban #tableView{display:none!important}');
        css.push('html.adhello-pipeline-view-kanban #kanbanView{display:block!important}');
      }

      css.push(
        '#prospectLeadsTable:not([data-pipeline-paging-primed="1"]) tbody tr.result-row:nth-child(n+' +
          (readPageSize() + 1) +
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
    document.documentElement.setAttribute('data-prospect-density', d);
    document.querySelectorAll('#tableView .lead-density-btn').forEach(function (btn) {
      var on = (btn.getAttribute('data-density') || 'compact') === d;
      btn.classList.toggle('lead-density-btn--active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
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
          if (index >= readPageSize()) row.classList.add('pipeline-row-page-hidden');
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
  window.__PIPELINE_TABLE_PAGE_SIZE_OPTIONS = PAGE_SIZE_OPTIONS;
  window.__readPipelineTablePageSize = readPageSize;

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
