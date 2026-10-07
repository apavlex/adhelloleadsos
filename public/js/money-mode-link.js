/**
 * Opening a lead anywhere goes to Money Mode. Builds the /focus URL with an
 * optional queue (the list the lead was opened from) and a way back.
 */
(function (global) {
  /* Long queues are capped so the /focus URL stays under proxy header limits. */
  var QUEUE_CAP = 80;

  function fromForPath(path) {
    if (/^\/(prospecting|leads)(\/|$)/.test(path)) return 'pipeline';
    var first = String(path || '').split('/')[1] || '';
    return first.replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'today';
  }

  function moneyModeLeadUrl(key, keys) {
    var k = String(key || '').trim();
    var params = new URLSearchParams();
    params.set('lead', k.replace(/^lead:/i, ''));
    var list = Array.isArray(keys) ? keys.filter(Boolean).slice(0, QUEUE_CAP) : [];
    if (list.length > 1) params.set('keys', list.join(','));
    var loc = global.location;
    var backParams = new URLSearchParams(loc.search);
    /* focusLead re-opens the lead on load, which would bounce Back straight into Money Mode. */
    backParams.delete('focusLead');
    var backQs = backParams.toString();
    params.set('from', fromForPath(loc.pathname));
    params.set('back', (loc.pathname + (backQs ? '?' + backQs : '')).slice(0, 1500));
    return '/focus?' + params.toString();
  }

  global.__adhelloMoneyModeLeadUrl = moneyModeLeadUrl;
})(window);
