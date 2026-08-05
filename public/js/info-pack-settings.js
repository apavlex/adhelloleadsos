/**
 * Workspace info pack settings — folder + default save.
 */
(function () {
  'use strict';

  function $(id) {
    return document.getElementById(id);
  }

  function readPackFromForm(prefix) {
    return {
      sms: {
        enabled: !!($(prefix + 'SmsEnabled') && $(prefix + 'SmsEnabled').checked),
        body: String(($(prefix + 'SmsBody') || {}).value || '').trim(),
      },
      email: {
        enabled: !!($(prefix + 'EmailEnabled') && $(prefix + 'EmailEnabled').checked),
        subject: String(($(prefix + 'EmailSubject') || {}).value || '').trim(),
        body: String(($(prefix + 'EmailBody') || {}).value || '').trim(),
      },
      directMail: {
        enabled: !!($(prefix + 'DmEnabled') && $(prefix + 'DmEnabled').checked),
        playbookId: String(($(prefix + 'PlaybookId') || {}).value || '').trim(),
        headline: String(($(prefix + 'DmHeadline') || {}).value || '').trim(),
        bodyText: String(($(prefix + 'DmBodyText') || {}).value || '').trim(),
        ctaUrl: String(($(prefix + 'DmCtaUrl') || {}).value || '').trim(),
        frontImageUrl: String(($(prefix + 'DmFrontImageUrl') || {}).value || '').trim(),
        backImageUrl: String(($(prefix + 'DmBackImageUrl') || {}).value || '').trim(),
        personalizeOverlay: !($(prefix + 'DmPersonalizeOverlay') && !$(prefix + 'DmPersonalizeOverlay').checked),
        includeLobQr: !($(prefix + 'DmIncludeLobQr') && !$(prefix + 'DmIncludeLobQr').checked),
      },
    };
  }

  function writePackToForm(prefix, pack) {
    const p = pack && typeof pack === 'object' ? pack : {};
    const sms = p.sms || {};
    const email = p.email || {};
    const dm = p.directMail || {};
    if ($(prefix + 'SmsEnabled')) $(prefix + 'SmsEnabled').checked = !!sms.enabled;
    if ($(prefix + 'SmsBody')) $(prefix + 'SmsBody').value = sms.body || '';
    if ($(prefix + 'EmailEnabled')) $(prefix + 'EmailEnabled').checked = !!email.enabled;
    if ($(prefix + 'EmailSubject')) $(prefix + 'EmailSubject').value = email.subject || '';
    if ($(prefix + 'EmailBody')) $(prefix + 'EmailBody').value = email.body || '';
    if ($(prefix + 'DmEnabled')) $(prefix + 'DmEnabled').checked = !!dm.enabled;
    if ($(prefix + 'PlaybookId')) $(prefix + 'PlaybookId').value = dm.playbookId || '';
    if ($(prefix + 'DmHeadline')) $(prefix + 'DmHeadline').value = dm.headline || '';
    if ($(prefix + 'DmBodyText')) $(prefix + 'DmBodyText').value = dm.bodyText || '';
    if ($(prefix + 'DmCtaUrl')) $(prefix + 'DmCtaUrl').value = dm.ctaUrl || '';
    if ($(prefix + 'DmFrontImageUrl')) $(prefix + 'DmFrontImageUrl').value = dm.frontImageUrl || '';
    if ($(prefix + 'DmBackImageUrl')) $(prefix + 'DmBackImageUrl').value = dm.backImageUrl || '';
    if ($(prefix + 'DmPersonalizeOverlay')) $(prefix + 'DmPersonalizeOverlay').checked = dm.personalizeOverlay !== false;
    if ($(prefix + 'DmIncludeLobQr')) $(prefix + 'DmIncludeLobQr').checked = dm.includeLobQr !== false;
  }

  function flashMsg(el, text, ok) {
    if (!el) return;
    el.classList.remove('hidden');
    el.textContent = text || '';
    el.className =
      'text-sm ' + (ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-400');
  }

  function bindTabs(root) {
    if (!root || root.dataset.tabsBound === '1') return;
    root.dataset.tabsBound = '1';
    const tabs = root.querySelectorAll('.info-pack-tab');
    const panels = root.querySelectorAll('.info-pack-panel');
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        const name = tab.getAttribute('data-tab');
        tabs.forEach(function (t) {
          const on = t === tab;
          t.classList.toggle('border-brand-yellow/50', on);
          t.classList.toggle('bg-brand-yellow/15', on);
          t.classList.toggle('border-brand-border/40', !on);
          t.classList.toggle('text-brand-muted', !on);
        });
        panels.forEach(function (p) {
          p.classList.toggle('hidden', p.getAttribute('data-panel') !== name);
        });
      });
    });
  }

  function loadFolderPack(folderKey) {
    const form = $('infoPackFolderForm');
    const msg = $('infoPackFolderMsg');
    if (!folderKey) {
      if (form) form.classList.add('hidden');
      return;
    }
    if (form) form.classList.remove('hidden');
    flashMsg(msg, 'Loading…', true);
    fetch('/folders/' + encodeURIComponent(folderKey) + '/info-pack', {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data.success) throw new Error((data && data.error) || 'Load failed');
        const boot = window.INFO_PACK_BOOT || {};
        const fallback = boot.defaultPack || null;
        writePackToForm('ipFolder', data.infoPack || fallback || {});
        flashMsg(msg, data.infoPack ? 'Loaded folder pack.' : 'Using workspace default as starting point.', true);
      })
      .catch(function (err) {
        flashMsg(msg, (err && err.message) || 'Could not load folder pack.', false);
      });
  }

  function init() {
    document.querySelectorAll('.info-pack-form').forEach(bindTabs);

    const defaultSave = $('infoPackDefaultSave');
    if (defaultSave) {
      defaultSave.addEventListener('click', function () {
        const msg = $('infoPackDefaultMsg');
        const pack = readPackFromForm('ipDefault');
        defaultSave.disabled = true;
        fetch('/workspace/info-pack-default', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ infoPack: pack }),
        })
          .then(function (r) {
            return r.json();
          })
          .then(function (data) {
            flashMsg(msg, data.success ? 'Workspace default saved.' : (data && data.error) || 'Save failed', !!data.success);
          })
          .catch(function () {
            flashMsg(msg, 'Save failed.', false);
          })
          .finally(function () {
            defaultSave.disabled = false;
          });
      });
    }

    const folderSelect = $('infoPackFolderSelect');
    if (folderSelect) {
      folderSelect.addEventListener('change', function () {
        loadFolderPack(String(folderSelect.value || '').trim());
      });
      const boot = window.INFO_PACK_BOOT || {};
      if (boot.preselectFolderKey) {
        folderSelect.value = boot.preselectFolderKey;
        loadFolderPack(boot.preselectFolderKey);
      }
    }

    const folderSave = $('infoPackFolderSave');
    if (folderSave) {
      folderSave.addEventListener('click', function () {
        const fk = String((folderSelect && folderSelect.value) || '').trim();
        const msg = $('infoPackFolderMsg');
        if (!fk) {
          flashMsg(msg, 'Select a folder first.', false);
          return;
        }
        const pack = readPackFromForm('ipFolder');
        folderSave.disabled = true;
        fetch('/folders/save-info-pack', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ folderKey: fk, infoPack: pack }),
        })
          .then(function (r) {
            return r.json();
          })
          .then(function (data) {
            flashMsg(msg, data.success ? 'Folder pack saved.' : (data && data.error) || 'Save failed', !!data.success);
          })
          .catch(function () {
            flashMsg(msg, 'Save failed.', false);
          })
          .finally(function () {
            folderSave.disabled = false;
          });
      });
    }

    const folderClear = $('infoPackFolderClear');
    if (folderClear) {
      folderClear.addEventListener('click', function () {
        const fk = String((folderSelect && folderSelect.value) || '').trim();
        const msg = $('infoPackFolderMsg');
        if (!fk) {
          flashMsg(msg, 'Select a folder first.', false);
          return;
        }
        const boot = window.INFO_PACK_BOOT || {};
        writePackToForm('ipFolder', boot.defaultPack || {});
        folderClear.disabled = true;
        fetch('/folders/save-info-pack', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ folderKey: fk, clearInfoPack: true }),
        })
          .then(function (r) {
            return r.json();
          })
          .then(function (data) {
            flashMsg(msg, data.success ? 'Folder override cleared.' : (data && data.error) || 'Clear failed', !!data.success);
            if (data.success) loadFolderPack(fk);
          })
          .catch(function () {
            flashMsg(msg, 'Clear failed.', false);
          })
          .finally(function () {
            folderClear.disabled = false;
          });
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
