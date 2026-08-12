(function () {
  'use strict';

  var MIN_Q = 2;
  var DEBOUNCE_MS = 220;
  var FETCH_LIMIT = 10;

  var instances = [];

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normalizeLeadKey(key) {
    return String(key || '').trim().replace(/^lead:/i, '');
  }

  function buildResultsUrl(q) {
    var params = new URLSearchParams();
    params.set('tab', 'pipeline');
    params.set('includeFoldered', '1');
    params.set('q', q);
    return '/prospecting?' + params.toString();
  }

  function buildFocusUrl(leadKey) {
    var short = normalizeLeadKey(leadKey);
    if (!short) return '/focus?channel=call';
    var params = new URLSearchParams();
    params.set('lead', short);
    params.set('channel', 'call');
    return '/focus?' + params.toString();
  }

  function readInitialQuery() {
    var path = window.location.pathname || '';
    if (path !== '/prospecting' && path !== '/pipeline') return '';
    return (new URLSearchParams(window.location.search).get('q') || '').trim();
  }

  function leadMetaLine(lead) {
    var bits = [];
    if (lead.city || lead.state) {
      bits.push([lead.city, lead.state].filter(Boolean).join(', '));
    }
    if (lead.phone) bits.push(lead.phone);
    else if (lead.email) bits.push(lead.email);
    if (lead.folderName) bits.push(lead.folderName);
    return bits.join(' · ');
  }

  function bindSearchInstance(cfg) {
    var input = document.getElementById(cfg.inputId);
    var dropdown = document.getElementById(cfg.dropdownId);
    var clearBtn = document.getElementById(cfg.clearId);
    var form = document.getElementById(cfg.formId);
    if (!input || !dropdown || !form) return null;

    var timer = null;
    var reqId = 0;
    var activeIdx = -1;
    var lastResults = [];

    function setExpanded(open) {
      input.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    function syncClearBtn() {
      if (!clearBtn) return;
      clearBtn.classList.toggle('hidden', !String(input.value || '').trim());
    }

    function closeDropdown() {
      dropdown.classList.add('hidden');
      dropdown.innerHTML = '';
      activeIdx = -1;
      lastResults = [];
      setExpanded(false);
    }

    function setActiveIndex(idx) {
      var items = dropdown.querySelectorAll('[data-nav-search-item]');
      activeIdx = idx;
      items.forEach(function (el, i) {
        el.classList.toggle('nav-lead-search-item--active', i === idx);
        if (i === idx) el.scrollIntoView({ block: 'nearest' });
      });
    }

    function renderDropdown(data, q) {
      var leads = (data && data.leads) || [];
      var total = (data && data.total) || 0;
      lastResults = leads;
      activeIdx = -1;

      if (!q || q.length < MIN_Q) {
        closeDropdown();
        return;
      }

      if (!leads.length) {
        dropdown.innerHTML =
          '<div class="nav-lead-search-empty">No leads match “' +
          escapeHtml(q) +
          '”</div>';
        dropdown.classList.remove('hidden');
        setExpanded(true);
        return;
      }

      var html = leads
        .map(function (lead, i) {
          var meta = leadMetaLine(lead);
          return (
            '<button type="button" class="nav-lead-search-item" data-nav-search-item data-lead-key="' +
            escapeHtml(lead.key) +
            '" data-index="' +
            i +
            '" role="option">' +
            '<span class="nav-lead-search-item-title">' +
            escapeHtml(lead.title || 'Lead') +
            '</span>' +
            (meta
              ? '<span class="nav-lead-search-item-meta">' + escapeHtml(meta) + '</span>'
              : '') +
            '</button>'
          );
        })
        .join('');

      if (total > leads.length) {
        html +=
          '<button type="button" class="nav-lead-search-footer" data-nav-search-all data-q="' +
          escapeHtml(q) +
          '">View all ' +
          total +
          ' results</button>';
      } else {
        html +=
          '<button type="button" class="nav-lead-search-footer" data-nav-search-all data-q="' +
          escapeHtml(q) +
          '">Open in pipeline</button>';
      }

      dropdown.innerHTML = html;
      dropdown.classList.remove('hidden');
      setExpanded(true);
    }

    function fetchResults(q) {
      var myReq = ++reqId;
      dropdown.innerHTML = '<div class="nav-lead-search-loading">Searching…</div>';
      dropdown.classList.remove('hidden');
      setExpanded(true);

      var url =
        '/leads/search.json?q=' +
        encodeURIComponent(q) +
        '&limit=' +
        FETCH_LIMIT;

      fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (res) {
          if (!res.ok) throw new Error('Search failed');
          return res.json();
        })
        .then(function (data) {
          if (myReq !== reqId) return;
          renderDropdown(data, q);
        })
        .catch(function () {
          if (myReq !== reqId) return;
          var qSafe = escapeHtml(q);
          dropdown.innerHTML =
            '<div class="nav-lead-search-empty">Could not search. Try again.</div>' +
            '<button type="button" class="nav-lead-search-footer" data-nav-search-all data-q="' +
            qSafe +
            '">Search “' +
            qSafe +
            '” in pipeline</button>';
        });
    }

    function scheduleFetch() {
      if (timer) clearTimeout(timer);
      var q = String(input.value || '').trim();
      syncClearBtn();
      instances.forEach(function (inst) {
        if (inst.input !== input && inst.input.value !== q) {
          inst.input.value = q;
          inst.syncClearBtn();
        }
      });
      if (q.length < MIN_Q) {
        closeDropdown();
        return;
      }
      timer = setTimeout(function () {
        fetchResults(q);
      }, DEBOUNCE_MS);
    }

    function navigateToResults(q) {
      window.location.href = buildResultsUrl(q);
    }

    function navigateToFocus(leadKey) {
      window.location.href = buildFocusUrl(leadKey);
    }

    function onSubmit(e) {
      e.preventDefault();
      var q = String(input.value || '').trim();
      if (!q) return;
      if (activeIdx >= 0 && lastResults[activeIdx] && lastResults[activeIdx].key) {
        navigateToFocus(lastResults[activeIdx].key);
        return;
      }
      navigateToResults(q);
    }

    input.addEventListener('input', scheduleFetch);
    input.addEventListener('focus', function () {
      var q = String(input.value || '').trim();
      if (q.length >= MIN_Q && !dropdown.innerHTML) scheduleFetch();
      else if (q.length >= MIN_Q && dropdown.classList.contains('hidden')) scheduleFetch();
    });

    input.addEventListener('keydown', function (e) {
      var items = dropdown.querySelectorAll('[data-nav-search-item]');
      if (e.key === 'Escape') {
        closeDropdown();
        input.blur();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!items.length) return;
        setActiveIndex(Math.min(activeIdx + 1, items.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!items.length) return;
        setActiveIndex(Math.max(activeIdx - 1, 0));
        return;
      }
      if (e.key === 'Enter') {
        if (activeIdx >= 0 && lastResults[activeIdx]) {
          e.preventDefault();
          navigateToFocus(lastResults[activeIdx].key);
        }
      }
    });

    dropdown.addEventListener('mousedown', function (e) {
      e.preventDefault();
    });

    dropdown.addEventListener('click', function (e) {
      var allBtn = e.target.closest('[data-nav-search-all]');
      if (allBtn) {
        navigateToResults(allBtn.getAttribute('data-q') || String(input.value || '').trim());
        return;
      }
      var item = e.target.closest('[data-nav-search-item]');
      if (!item) return;
      var key = item.getAttribute('data-lead-key') || '';
      if (key) navigateToFocus(key);
    });

    form.addEventListener('submit', onSubmit);

    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        input.value = '';
        syncClearBtn();
        closeDropdown();
        input.focus();
        instances.forEach(function (inst) {
          if (inst.input !== input) {
            inst.input.value = '';
            inst.syncClearBtn();
            inst.closeDropdown();
          }
        });
      });
    }

    document.addEventListener('click', function (e) {
      if (!form.contains(e.target)) closeDropdown();
    });

    return {
      input: input,
      syncClearBtn: syncClearBtn,
      closeDropdown: closeDropdown,
      setValue: function (v) {
        input.value = v;
        syncClearBtn();
      },
    };
  }

  var desktop = bindSearchInstance({
    inputId: 'navLeadSearchInput',
    dropdownId: 'navLeadSearchDropdown',
    clearId: 'navLeadSearchClear',
    formId: 'navLeadSearchForm',
  });
  var sidebar = bindSearchInstance({
    inputId: 'navLeadSearchInputSidebar',
    dropdownId: 'navLeadSearchDropdownSidebar',
    clearId: 'navLeadSearchClearSidebar',
    formId: 'navLeadSearchFormSidebar',
  });
  var mobile = bindSearchInstance({
    inputId: 'navLeadSearchInputMobile',
    dropdownId: 'navLeadSearchDropdownMobile',
    clearId: 'navLeadSearchClearMobile',
    formId: 'navLeadSearchFormMobile',
  });

  if (desktop) instances.push(desktop);
  if (sidebar) instances.push(sidebar);
  if (mobile) instances.push(mobile);
  if (!instances.length) return;

  var initialQ = readInitialQuery();
  if (initialQ) {
    instances.forEach(function (inst) {
      inst.setValue(initialQ);
    });
  }

  var mobileBtn = document.getElementById('navLeadSearchMobileBtn');
  var mobileRow = document.getElementById('navLeadSearchMobileRow');
  if (mobileBtn && mobileRow) {
    mobileBtn.addEventListener('click', function () {
      var open = mobileRow.classList.toggle('hidden');
      mobileBtn.setAttribute('aria-expanded', open ? 'false' : 'true');
      if (!open && mobile) {
        mobile.input.focus();
        if (String(mobile.input.value || '').trim().length >= MIN_Q) {
          mobile.input.dispatchEvent(new Event('input'));
        }
      } else if (mobile) {
        mobile.closeDropdown();
      }
    });
  }

  function focusPrimarySearch() {
    var target =
      sidebar ||
      desktop ||
      mobile ||
      null;
    if (!target || !target.input) return;
    target.input.focus();
    if (String(target.input.value || '').trim()) {
      target.input.select();
    }
  }

  document.addEventListener('keydown', function (e) {
    if (!(e.metaKey || e.ctrlKey) || String(e.key || '').toLowerCase() !== 'k') return;
    var tag = (document.activeElement && document.activeElement.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    e.preventDefault();
    focusPrimarySearch();
  });
})();
