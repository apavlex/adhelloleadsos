/**
 * Pipeline table row actions — Call (softphone) and SMS (GoHighLevel composer).
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

  document.addEventListener(
    'click',
    function (e) {
      var btn = e.target && e.target.closest && e.target.closest('.pipeline-row-call-btn, .pipeline-row-sms-btn');
      if (!btn) return;
      var row = btn.closest('tr.result-row');
      if (!row) return;
      e.preventDefault();
      e.stopPropagation();
      if (btn.classList.contains('pipeline-row-call-btn')) callRow(row);
      else smsRow(row);
    },
    true,
  );
})();
