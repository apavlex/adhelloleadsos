/**
 * Lead panel "What to sell" script: show, edit and remove the script saved on this lead only.
 * app.js calls window.__adhelloLeadPanelCustomScript.render(scriptEl, { row, data, channel, fill })
 * before drawing the library script; render returns true when it drew the lead's own script.
 */
(function () {
  'use strict';

  if (window.__adhelloLeadPanelCustomScript) return;

  var CHANNEL_MAP = { call: 'call', text: 'sms', voicemail: 'voicemail', email: 'email' };
  var PLACEHOLDER_TEXT = /^(No script for this channel yet|Pick a service above|Add scripts in Sales)/;
  var byLead = {};
  var loading = {};
  var ctx = null;
  var editing = false;
  var saving = false;
  var beforeEditHtml = '';

  function byId(id) {
    return document.getElementById(id);
  }

  function leadKey(row) {
    return row && row.dataset ? String(row.dataset.leadKey || '').trim().replace(/^lead:/, '') : '';
  }

  function channelKey(c) {
    return c ? CHANNEL_MAP[c.channel] || '' : '';
  }

  function scriptsFor(c) {
    var key = leadKey(c && c.row);
    if (!key) return null;
    if (c.data && c.data.customScripts && typeof c.data.customScripts === 'object') byLead[key] = c.data.customScripts;
    return byLead[key] || null;
  }

  function savedRow(c) {
    var map = scriptsFor(c);
    var row = map && map[channelKey(c)];
    return row && (row.html || row.text) ? row : null;
  }

  function looksLikeHtml(raw) {
    return /<(?:b|strong|i|em|u|br|p|div|span)\b/i.test(String(raw || ''));
  }

  function setScriptContent(el, raw) {
    var helper = window.AdHelloScripts;
    if (looksLikeHtml(raw) && helper && helper.sanitizeScriptHtml) {
      el.innerHTML = helper.sanitizeScriptHtml(raw);
    } else {
      el.textContent = String(raw || '');
    }
  }

  function setStatus(text, isError) {
    var el = byId('leadPanelLeadScriptStatus');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('text-red-600', !!isError);
    el.classList.toggle('text-brand-muted', !isError);
  }

  function toggle(el, show) {
    if (el) el.classList.toggle('hidden', !show);
  }

  function syncBar() {
    var bar = byId('leadPanelLeadScriptBar');
    if (!bar) return;
    var supported = !!(ctx && leadKey(ctx.row) && channelKey(ctx));
    toggle(bar, supported);
    if (!supported) return;
    var saved = savedRow(ctx);
    var edit = byId('leadPanelLeadScriptEdit');
    toggle(byId('leadPanelLeadScriptBadge'), !!saved && !editing);
    toggle(edit, !editing);
    if (edit) edit.textContent = saved ? 'Edit' : 'Edit for this lead';
    toggle(byId('leadPanelLeadScriptSave'), editing);
    toggle(byId('leadPanelLeadScriptCancel'), editing);
    toggle(byId('leadPanelLeadScriptRemove'), !!saved && !editing);
    ['leadPanelLeadScriptSave', 'leadPanelLeadScriptCancel', 'leadPanelLeadScriptRemove', 'leadPanelLeadScriptEdit'].forEach(function (id) {
      var btn = byId(id);
      if (btn) btn.disabled = saving;
    });
  }

  function setEditable(el, on) {
    if (!el) return;
    if (on) {
      el.setAttribute('contenteditable', 'true');
      el.setAttribute('role', 'textbox');
      el.setAttribute('aria-multiline', 'true');
      el.style.outline = '2px solid rgba(250, 204, 21, 0.75)';
      el.style.outlineOffset = '4px';
      el.style.borderRadius = '0.5rem';
    } else {
      el.removeAttribute('contenteditable');
      el.removeAttribute('role');
      el.removeAttribute('aria-multiline');
      el.style.outline = '';
      el.style.outlineOffset = '';
      el.style.borderRadius = '';
    }
  }

  function stopEditing(restore) {
    var el = byId('leadPanelSellingScript');
    if (editing && restore && el) el.innerHTML = beforeEditHtml;
    editing = false;
    setEditable(el, false);
  }

  function refreshPanel() {
    if (ctx && typeof window.refreshLeadPanelSellingScript === 'function') {
      window.refreshLeadPanelSellingScript(ctx.row, { cacheOnly: true });
    }
  }

  function loadScripts(c) {
    var key = leadKey(c.row);
    if (!key || byLead[key] || loading[key]) return;
    loading[key] = fetch('/leads/' + encodeURIComponent(key) + '/custom-scripts', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        byLead[key] = (j && j.success && j.customScripts) || {};
        if (ctx && leadKey(ctx.row) === key && savedRow(ctx)) refreshPanel();
      })
      .catch(function () {})
      .finally(function () { delete loading[key]; });
  }

  function render(scriptEl, c) {
    stopEditing(false);
    ctx = c;
    setStatus('');
    if (!scriptsFor(c)) loadScripts(c);
    var saved = savedRow(c);
    if (saved) {
      var raw = saved.html || saved.text;
      setScriptContent(scriptEl, typeof c.fill === 'function' ? c.fill(raw) : raw);
    }
    syncBar();
    return !!saved;
  }

  function startEditing() {
    var el = byId('leadPanelSellingScript');
    if (!el || !ctx || editing) return;
    beforeEditHtml = el.innerHTML;
    if (PLACEHOLDER_TEXT.test(String(el.textContent || '').trim())) el.textContent = '';
    editing = true;
    setEditable(el, true);
    setStatus('');
    syncBar();
    el.focus();
  }

  function putScript(body) {
    var c = ctx;
    var key = leadKey(c && c.row);
    return fetch('/leads/' + encodeURIComponent(key) + '/custom-script', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ channel: channelKey(c), body: body }),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok || !j || !j.success) throw new Error((j && j.error) || 'Could not save the script for this lead.');
        var map = j.customScripts || {};
        byLead[key] = map;
        if (c.data && c.data.customScripts && typeof c.data.customScripts === 'object') c.data.customScripts = map;
        return j;
      });
    });
  }

  function saveEdit() {
    var el = byId('leadPanelSellingScript');
    if (!el || !ctx || saving) return;
    var html = el.innerHTML;
    var body = looksLikeHtml(html) ? html : String(el.textContent || '');
    if (!body.trim()) {
      setStatus('Write the script first, or press Cancel.', true);
      return;
    }
    saving = true;
    setStatus('Saving…');
    syncBar();
    putScript(body)
      .then(function () {
        stopEditing(false);
        saving = false;
        refreshPanel();
        setStatus('Saved for this lead');
      })
      .catch(function (err) {
        setStatus((err && err.message) || 'Save failed', true);
      })
      .finally(function () {
        saving = false;
        syncBar();
      });
  }

  function removeSaved() {
    if (!ctx || saving || !savedRow(ctx)) return;
    if (!window.confirm('Delete the script saved for this lead? Your product script shows instead.')) return;
    saving = true;
    setStatus('Removing…');
    syncBar();
    putScript('')
      .then(function () {
        saving = false;
        refreshPanel();
        setStatus('Lead script removed');
      })
      .catch(function (err) {
        saving = false;
        setStatus((err && err.message) || 'Could not remove it', true);
        syncBar();
      });
  }

  document.addEventListener('click', function (ev) {
    var t = ev.target;
    if (!t || !t.closest) return;
    if (t.closest('#leadPanelLeadScriptEdit')) return startEditing();
    if (t.closest('#leadPanelLeadScriptSave')) return saveEdit();
    if (t.closest('#leadPanelLeadScriptCancel')) {
      stopEditing(true);
      setStatus('');
      syncBar();
      return;
    }
    if (t.closest('#leadPanelLeadScriptRemove')) removeSaved();
  });

  window.__adhelloLeadPanelCustomScript = { render: render };
})();
