/**
 * Collect what the user is looking at for Alex chat (path, open folder, selection).
 */
(function (global) {
  function clip(value, max) {
    return String(value == null ? '' : value)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max || 160);
  }

  function folderNameForKey(key) {
    var k = clip(key, 160);
    if (!k) return '';
    var list = global.WORKSPACE_FOLDERS;
    if (!Array.isArray(list)) return '';
    for (var i = 0; i < list.length; i += 1) {
      var f = list[i];
      if (f && String(f.key) === k) return clip(f.name, 120);
    }
    return '';
  }

  function selectedLeadKeys() {
    try {
      if (typeof global.__getSelectedLeadKeysForBulk === 'function') {
        var keys = global.__getSelectedLeadKeysForBulk() || [];
        return keys
          .map(function (k) {
            return clip(k, 120);
          })
          .filter(Boolean)
          .slice(0, 25);
      }
    } catch (_) {}
    return [];
  }

  function focusedLead() {
    var params = new URLSearchParams(global.location.search || '');
    var fromUrl = clip(params.get('lead'), 120);
    var panel =
      global.document &&
      (global.document.querySelector('[data-lead-key].is-open') ||
        global.document.querySelector('.lead-panel[data-lead-key]') ||
        global.document.querySelector('[data-open-lead-key]'));
    var fromDom = '';
    var title = '';
    if (panel) {
      fromDom = clip(
        panel.getAttribute('data-lead-key') || panel.getAttribute('data-open-lead-key'),
        120,
      );
      title = clip(
        panel.getAttribute('data-lead-title') ||
          panel.getAttribute('data-business-name') ||
          '',
        160,
      );
    }
    return { key: fromDom || fromUrl, title: title };
  }

  function collectPavlexUiContext() {
    var params = new URLSearchParams(global.location.search || '');
    var path = clip((global.location.pathname || '') + (global.location.search || ''), 400);
    var folderKey = clip(
      params.get('folderKey') ||
        params.get('folder') ||
        global.PROSPECTING_ACTIVE_FOLDER_KEY ||
        global.SEARCH_TARGET_FOLDER_KEY ||
        '',
      160,
    );
    var lead = focusedLead();
    var selected = selectedLeadKeys();
    return {
      path: path,
      title: clip(global.document && global.document.title, 160),
      tab: clip(params.get('tab'), 40),
      view: clip(params.get('view'), 40),
      folderKey: folderKey,
      folderName: folderNameForKey(folderKey),
      leadKey: lead.key,
      leadTitle: lead.title,
      activePage: clip(global.__ADHELLO_ACTIVE_PAGE__, 60),
      selectedCount: selected.length,
      selectedLeadKeys: selected,
    };
  }

  global.collectPavlexUiContext = collectPavlexUiContext;
})(typeof window !== 'undefined' ? window : globalThis);
