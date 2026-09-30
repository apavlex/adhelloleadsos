/**
 * Pipeline table row actions — row click opens Money mode, Call (softphone), SMS (GoHighLevel composer).
 * The » button still opens the company profile.
 * Delegated from document so rows re-rendered by filters / paging keep working.
 */
(function () {
  if (window.__pipelineRowActionsBound) return;
  window.__pipelineRowActionsBound = true;

  function toast(message, variant) {
    if (typeof window.showAppToast === 'function') {
      window.showAppToast(message, { variant: variant || 'info', duration: 5000 });
    } else {
      window.alert(message);
    }
  }

  function rowPhone(row) {
    var p = '';
    if (typeof window.__readPipelineRowDisplayPhone === 'function') {
      p = String(window.__readPipelineRowDisplayPhone(row) || '').trim();
    }
    if (!p && row.dataset) p = String(row.dataset.phone || '').trim();
    return p && p !== 'N/A' && p !== '—' ? p : '';
  }

  function rowKey(row) {
    return String((row.dataset && row.dataset.leadKey) || '').trim();
  }

  function rowTitle(row) {
    return String((row.dataset && (row.dataset.title || row.dataset.company)) || '').trim() || 'Lead';
  }

  /** Visible rows (current filter + page) so › in the softphone walks down the table. */
  function visibleCallItems(table) {
    var rows = table ? table.querySelectorAll('tbody tr.result-row') : [];
    var items = [];
    Array.prototype.forEach.call(rows, function (row) {
      if (!row.getClientRects().length) return;
      var phone = rowPhone(row);
      if (!phone) return;
      items.push({ key: rowKey(row), title: rowTitle(row), phone: phone });
    });
    return items;
  }

  function callRow(row) {
    if (!rowPhone(row)) {
      toast('No phone number on this lead.', 'error');
      return;
    }
    if (typeof window.__adhelloCallQueueInSoftphone !== 'function') {
      toast('The softphone is still loading. Try again in a moment.', 'error');
      return;
    }
    var items = visibleCallItems(row.closest('table'));
    var n = window.__adhelloCallQueueInSoftphone(items, rowKey(row));
    if (!n) {
      toast('Could not load this lead in the softphone.', 'error');
      return;
    }
    toast(
      rowTitle(row) + ' is on the keypad — press the green button to dial' +
        (n > 1 ? ', then › for the next lead.' : '.'),
      'success',
    );
  }

  function smsRow(row) {
    var key = rowKey(row);
    if (!key) return;
    if (!rowPhone(row)) {
      toast('No phone number on this lead.', 'error');
      return;
    }
    var opener = window.__openBulkSmsModalImpl || window.__openBulkSmsModal || window.__openBulkSmsModalImplFull;
    if (typeof opener !== 'function') {
      toast('SMS templates are still loading. Try again in a moment.', 'error');
      return;
    }
    Promise.resolve(opener([key]))
      .then(function (result) {
        if (result && result.ok === false) toast(result.message || 'Could not open the SMS composer.', 'error');
      })
      .catch(function () {
        toast('Could not open the SMS composer.', 'error');
      });
  }

  var MONEY_MODE_KEY_CAP = 80;
  var ROW_CLICK_IGNORE =
    'input, button, a, select, textarea, label, form, [contenteditable="true"], .bookmark-btn, .view-detail-btn, ' +
    '.lead-category-input, .plc-col-resize, .js-pipeline-columns-wrap';

  /** Money mode queue = visible rows, starting at the clicked lead, so Next walks down the table. */
  function moneyModeUrlForRow(row) {
    var key = rowKey(row);
    var table = row.closest('table');
    var keys = [];
    var rows = table ? table.querySelectorAll('tbody tr.result-row') : [];
    Array.prototype.forEach.call(rows, function (r) {
      if (r.classList.contains('pipeline-row-page-hidden') || !r.getClientRects().length) return;
      var k = rowKey(r);
      if (k && keys.indexOf(k) === -1) keys.push(k);
    });
    var start = keys.indexOf(key);
    if (start > 0) keys = keys.slice(start).concat(keys.slice(0, start));
    if (start === -1) keys.unshift(key);
    keys = keys.slice(0, MONEY_MODE_KEY_CAP);
    var params = new URLSearchParams();
    params.set('lead', key);
    if (keys.length > 1) params.set('keys', keys.join(','));
    params.set('from', 'pipeline');
    params.set('back', window.location.pathname + window.location.search);
    return '/focus?' + params.toString();
  }

  function isMoneyModeRowClick(e, row) {
    if (!row || !row.closest('#prospectLeadsTable')) return false;
    if (row.classList.contains('result-row--panel-source')) return false;
    if (e.shiftKey || e.altKey || e.button > 0) return false;
    if (e.target.closest(ROW_CLICK_IGNORE)) return false;
    var sel = window.getSelection && window.getSelection();
    if (sel && String(sel.toString() || '').trim()) return false;
    return !!rowKey(row);
  }

  document.addEventListener(
    'click',
    function (e) {
      if (!e.target || !e.target.closest) return;
      var btn = e.target.closest('.pipeline-row-call-btn, .pipeline-row-sms-btn');
      if (btn) {
        var btnRow = btn.closest('tr.result-row');
        if (!btnRow) return;
        e.preventDefault();
        e.stopPropagation();
        if (btn.classList.contains('pipeline-row-call-btn')) callRow(btnRow);
        else smsRow(btnRow);
        return;
      }
      var row = e.target.closest('tr.result-row');
      if (!isMoneyModeRowClick(e, row)) return;
      e.preventDefault();
      e.stopPropagation();
      var url = moneyModeUrlForRow(row);
      if (e.metaKey || e.ctrlKey) {
        window.open(url, '_blank', 'noopener');
        return;
      }
      window.location.href = url;
    },
    true,
  );
})();
