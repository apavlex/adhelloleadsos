/**
 * Direct Mail call-session queue — tag + folder leads for post-session mailing.
 * Used by softphone Direct Mail tab and bulk pipeline actions.
 */
(function () {
  'use strict';

  var SESSION_KEY = 'adhello_dm_call_queue';
  var FOLDER_KEY_KEY = 'adhello_dm_folder_key';

  function normalizeKey(raw) {
    var k = String(raw || '').trim();
    if (!k) return '';
    return k.startsWith('lead:') ? k : 'lead:' + k.replace(/^lead:/i, '');
  }

  function readSession() {
    try {
      var raw = sessionStorage.getItem(SESSION_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function writeSession(items) {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(items || []));
    } catch (_) {
      /* ignore */
    }
    updateDirectMailNavBadge();
    if (typeof window.__renderSoftphoneDirectMailQueue === 'function') {
      window.__renderSoftphoneDirectMailQueue();
    }
  }

  function rememberFolderKey(folderKey) {
    if (!folderKey) return;
    try {
      sessionStorage.setItem(FOLDER_KEY_KEY, String(folderKey));
    } catch (_) {
      /* ignore */
    }
  }

  function readFolderKey() {
    try {
      return String(sessionStorage.getItem(FOLDER_KEY_KEY) || '').trim();
    } catch (_) {
      return '';
    }
  }

  function upsertSessionItems(leads) {
    var session = readSession();
    var byKey = Object.create(null);
    session.forEach(function (item) {
      var k = normalizeKey(item && item.key);
      if (k) byKey[k] = item;
    });
    (leads || []).forEach(function (lead) {
      var k = normalizeKey(lead && lead.key);
      if (!k) return;
      var prev = byKey[k];
      byKey[k] = {
        key: k,
        title: String((lead && lead.title) || (prev && prev.title) || 'Lead').trim(),
        address: String((lead && lead.address) || (prev && prev.address) || '').trim(),
        city: String((lead && lead.city) || (prev && prev.city) || '').trim(),
        state: String((lead && lead.state) || (prev && prev.state) || '').trim(),
        mailable: lead && lead.mailable != null ? !!lead.mailable : !!(prev && prev.mailable),
        addedAt: String((lead && lead.addedAt) || (prev && prev.addedAt) || new Date().toISOString()),
      };
    });
    writeSession(Object.keys(byKey).map(function (k) {
      return byKey[k];
    }));
  }

  function removeFromSession(leadKey) {
    var k = normalizeKey(leadKey);
    if (!k) return;
    writeSession(readSession().filter(function (item) {
      return normalizeKey(item && item.key) !== k;
    }));
  }

  function sessionKeys() {
    return readSession()
      .map(function (item) {
        return normalizeKey(item && item.key);
      })
      .filter(Boolean);
  }

  function updateDirectMailNavBadge() {
    var count = readSession().length;
    var badge = document.getElementById('softphoneNavDirectMailCount');
    var btn = document.getElementById('softphoneNavDirectMail');
    if (badge) {
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.classList.toggle('hidden', count <= 0);
    }
    if (btn) {
      btn.setAttribute('data-queue-count', count > 0 ? String(count) : '0');
    }
  }

  function toast(msg, variant) {
    if (typeof window.showAppToast === 'function') {
      window.showAppToast(msg, { variant: variant || 'success' });
      return;
    }
    if (typeof window.showProspectToast === 'function') {
      window.showProspectToast(msg);
      return;
    }
    if (msg) window.alert(msg);
  }

  function rowLeadPayload(row) {
    if (!row || !row.dataset) return null;
    var key = String(row.dataset.leadKey || '').trim();
    if (!key) return null;
    return {
      key: key,
      title: String(row.dataset.title || row.querySelector('.lead-title')?.textContent || 'Lead').trim(),
      address: String(row.dataset.address || '').trim(),
      city: String(row.dataset.city || '').trim(),
      state: String(row.dataset.state || '').trim(),
    };
  }

  function rowLooksMailable(row) {
    if (!row || !row.dataset) return false;
    var address = String(row.dataset.address || '').trim();
    if (!address || address === 'N/A' || address === '—') return false;
    var city = String(row.dataset.city || '').trim();
    var state = String(row.dataset.state || '').trim();
    if (!city || !state) {
      return /\b\d{5}(?:-\d{4})?\b/.test(address);
    }
    return true;
  }

  function focusLeadLooksMailable(lead) {
    if (!lead) return false;
    var address = String(lead.address || '').trim();
    if (!address || address === 'N/A' || address === '—') return false;
    var city = String(lead.city || '').trim();
    var state = String(lead.state || '').trim();
    if (!city || !state) return /\b\d{5}(?:-\d{4})?\b/.test(address);
    return true;
  }

  function collectDirectMailCandidates() {
    var out = [];
    var seen = Object.create(null);

    function add(item) {
      var k = normalizeKey(item && item.key);
      if (!k || seen[k]) return;
      seen[k] = true;
      out.push({
        key: k,
        title: String((item && item.title) || 'Lead').trim(),
        address: String((item && item.address) || '').trim(),
        city: String((item && item.city) || '').trim(),
        state: String((item && item.state) || '').trim(),
        mailable: item.mailable != null ? !!item.mailable : focusLeadLooksMailable(item),
      });
    }

    if (typeof window.__getFocusCurrentLead === 'function') {
      var focusLead = window.__getFocusCurrentLead();
      if (focusLead && focusLead.key) add(focusLead);
    }

    if (typeof window.__getSoftphoneActiveLead === 'function') {
      var active = window.__getSoftphoneActiveLead();
      if (active && active.key) add(active);
    }

    if (typeof window.__getActiveLeadPanelRow === 'function') {
      var panelRow = window.__getActiveLeadPanelRow();
      if (panelRow) {
        var payload = rowLeadPayload(panelRow);
        if (payload) {
          payload.mailable = rowLooksMailable(panelRow);
          add(payload);
        }
      }
    }

    if (typeof window.__getSelectedLeadRowsForBulk === 'function') {
      (window.__getSelectedLeadRowsForBulk() || []).forEach(function (row) {
        var p = rowLeadPayload(row);
        if (p) {
          p.mailable = rowLooksMailable(row);
          add(p);
        }
      });
    }

    return out;
  }

  async function refreshDirectMailQueueFromServer() {
    var res = await fetch('/direct-mail/api/queue', {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    var data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok || !data.success) {
      throw new Error((data && data.error) || 'Could not load Direct Mail queue.');
    }
    if (data.folderKey) rememberFolderKey(data.folderKey);
    if (Array.isArray(data.leads)) {
      upsertSessionItems(data.leads);
    }
    return data;
  }

  async function queueLeadKeys(leadKeys) {
    var keys = (leadKeys || []).map(normalizeKey).filter(Boolean);
    if (!keys.length) {
      throw new Error('Select or open a lead first.');
    }
    var res = await fetch('/direct-mail/api/queue', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ leadKeys: keys }),
    });
    var data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok || !data.success) {
      throw new Error((data && data.error) || 'Could not queue for direct mail.');
    }
    if (data.folderKey) rememberFolderKey(data.folderKey);
    if (Array.isArray(data.leads) && data.leads.length) {
      upsertSessionItems(data.leads);
    } else {
      await refreshDirectMailQueueFromServer();
    }
    if (data.folderKey && Array.isArray(window.WORKSPACE_FOLDERS)) {
      var hasFolder = window.WORKSPACE_FOLDERS.some(function (f) {
        return f && f.key === data.folderKey;
      });
      if (!hasFolder) {
        window.WORKSPACE_FOLDERS.push({
          key: data.folderKey,
          name: data.folderName || 'Direct Mail',
        });
      }
    }
    return data;
  }

  async function addCandidatesToDirectMailQueue(candidates) {
    var keys = (candidates || []).map(function (c) {
      return normalizeKey(c && c.key);
    }).filter(Boolean);
    return queueLeadKeys(keys);
  }

  async function addCurrentLeadToDirectMailQueue() {
    var candidates = collectDirectMailCandidates();
    if (!candidates.length) {
      throw new Error('Open a lead or select pipeline rows first.');
    }
    return addCandidatesToDirectMailQueue(candidates);
  }

  function buildDirectMailFolderUrl(folderKey) {
    var key = String(folderKey || readFolderKey() || '').trim();
    if (!key) return '/prospecting?tab=pipeline';
    return '/prospecting?tab=pipeline&folderKey=' + encodeURIComponent(key);
  }

  function buildDirectMailSendUrl(keys) {
    if (typeof window.__buildDirectMailSelectionUrl === 'function') {
      return window.__buildDirectMailSelectionUrl(keys);
    }
    var norm = (keys || []).map(normalizeKey).filter(Boolean);
    if (!norm.length) return '/direct-mail';
    return '/direct-mail?keys=' + encodeURIComponent(norm.join(','));
  }

  window.__readDirectMailSession = readSession;
  window.__directMailSessionKeys = sessionKeys;
  window.__addLeadsToDirectMailQueue = queueLeadKeys;
  window.__addCurrentLeadToDirectMailQueue = addCurrentLeadToDirectMailQueue;
  window.__collectDirectMailCandidates = collectDirectMailCandidates;
  window.__refreshDirectMailQueueFromServer = refreshDirectMailQueueFromServer;
  window.__buildDirectMailFolderUrl = buildDirectMailFolderUrl;
  window.__updateDirectMailNavBadge = updateDirectMailNavBadge;

  document.addEventListener('DOMContentLoaded', updateDirectMailNavBadge);
})();
