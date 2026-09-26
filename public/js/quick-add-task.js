/**
 * Create manual tasks from Focus, lead panel, activity, etc. (always /tasks/api → source: manual).
 * Also powers the top-nav Add task modal (#navQuickTaskOpen).
 */
(function () {
  'use strict';

  async function createManualTask(opts) {
    var title = String((opts && opts.title) || '').trim();
    if (!title) throw new Error('Task title is required.');

    var body = {
      title: title.slice(0, 200),
      column: (opts && opts.column) || 'todo',
      leadKey: opts && opts.leadKey ? String(opts.leadKey).trim() : null,
    };
    if (opts && opts.scheduledAt) body.scheduledAt = opts.scheduledAt;
    if (opts && opts.remindMinutesBefore != null && opts.remindMinutesBefore !== '') {
      body.remindMinutesBefore = opts.remindMinutesBefore;
    }

    var res = await fetch('/tasks/api', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    var data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok || !data.success) {
      throw new Error((data && data.error) || 'Could not save task.');
    }
    if (window.AgencyTaskReminders && window.AgencyTaskReminders.refresh) {
      try {
        await window.AgencyTaskReminders.refresh();
      } catch (_) {}
    }
    return data.task;
  }

  function toast(msg, variant) {
    if (typeof window.showAppToast === 'function') {
      window.showAppToast(msg, { variant: variant || 'success' });
    }
  }

  function normalizeLeadKey(raw) {
    var s = String(raw || '').trim();
    if (!s) return '';
    if (s.indexOf('lead:') === 0) return s;
    return 'lead:' + s.replace(/^lead:/i, '');
  }

  function resolvePanelLeadKey() {
    var panel = document.getElementById('mobilePanel');
    if (panel && panel.dataset && panel.dataset.adhelloLeadKey) {
      return normalizeLeadKey(panel.dataset.adhelloLeadKey);
    }
    if (window.__leadPanelActiveRowKey) {
      return normalizeLeadKey(window.__leadPanelActiveRowKey);
    }
    var row = document.querySelector(
      '#prospectLeadsTable tbody tr.result-row.selected, tr.result-row.selected:not(.result-row--panel-source)',
    );
    if (row && row.dataset && row.dataset.leadKey) {
      return normalizeLeadKey(row.dataset.leadKey);
    }
    return '';
  }

  function resolvePanelLeadLabel(leadKey) {
    var panel = document.getElementById('mobilePanel');
    if (panel && panel.dataset && panel.dataset.adhelloLeadName) {
      return String(panel.dataset.adhelloLeadName).trim();
    }
    var titleEl = document.querySelector('#mobilePanel [data-lead-name], #panelLeadName, .lead-panel-title');
    if (titleEl) {
      var t = String(titleEl.textContent || '').trim();
      if (t) return t;
    }
    var row = document.querySelector(
      '#prospectLeadsTable tbody tr.result-row.selected, tr.result-row.selected:not(.result-row--panel-source)',
    );
    if (row) {
      var cell = row.querySelector('[data-lead-name], .lead-name, td:first-child');
      if (cell) {
        var name = String(cell.textContent || '').trim();
        if (name) return name;
      }
    }
    if (leadKey) return leadKey.replace(/^lead:/i, '');
    return '';
  }

  async function submitLeadQuickTask() {
    var input = document.getElementById('leadQuickTaskTitle');
    var hint = document.getElementById('leadQuickTaskHint');
    var btn = document.getElementById('leadQuickTaskSaveBtn');
    if (!input || !btn) return;
    var title = String(input.value || '').trim();
    if (!title) {
      if (hint) {
        hint.textContent = 'Enter a task description.';
        hint.classList.remove('hidden');
      }
      return;
    }
    btn.disabled = true;
    if (hint) {
      hint.textContent = 'Saving…';
      hint.classList.remove('hidden');
    }
    try {
      await createManualTask({ title: title, leadKey: resolvePanelLeadKey() || null });
      input.value = '';
      if (hint) hint.textContent = 'Saved to Tasks.';
      toast('Task saved to Tasks.', 'success');
    } catch (err) {
      var msg = err && err.message ? err.message : 'Could not save task.';
      if (hint) hint.textContent = msg;
      toast(msg, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  function setModalOpen(open) {
    var modal = document.getElementById('navQuickTaskModal');
    if (!modal) return;
    if (open) {
      modal.classList.remove('hidden');
      modal.classList.add('flex');
      modal.setAttribute('aria-hidden', 'false');
      document.documentElement.classList.add('overflow-hidden');
    } else {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
      modal.setAttribute('aria-hidden', 'true');
      document.documentElement.classList.remove('overflow-hidden');
    }
  }

  var navQuickTaskPicker = null;

  function ensureNavQuickTaskPicker() {
    var scheduled = document.getElementById('navQuickTaskScheduled');
    if (!scheduled || typeof window.initGcalDatetimePicker !== 'function') return null;
    if (!navQuickTaskPicker) {
      navQuickTaskPicker = window.initGcalDatetimePicker(scheduled, {
        label: 'Reminder date and time',
        emptyLabel: 'No reminder',
        triggerId: 'navQuickTaskScheduled-trigger',
        fixedPopover: true,
        portalHost: document.body,
      });
    }
    return navQuickTaskPicker;
  }

  function openNavQuickTaskModal() {
    var modal = document.getElementById('navQuickTaskModal');
    var input = document.getElementById('navQuickTaskInput');
    var scheduled = document.getElementById('navQuickTaskScheduled');
    var err = document.getElementById('navQuickTaskError');
    var leadRow = document.getElementById('navQuickTaskLeadRow');
    var leadLabel = document.getElementById('navQuickTaskLeadLabel');
    var linkLead = document.getElementById('navQuickTaskLinkLead');
    if (!modal) return;

    if (err) {
      err.textContent = '';
      err.classList.add('hidden');
    }
    if (input) input.value = '';
    var picker = ensureNavQuickTaskPicker();
    if (picker && typeof picker.setValue === 'function') {
      picker.setValue(null);
    } else if (scheduled) {
      scheduled.value = '';
    }

    var leadKey = resolvePanelLeadKey();
    var label = resolvePanelLeadLabel(leadKey);
    if (leadRow) {
      if (leadKey) {
        leadRow.classList.remove('hidden');
        leadRow.classList.add('flex');
        if (leadLabel) leadLabel.textContent = label || leadKey.replace(/^lead:/i, '');
        if (linkLead) {
          linkLead.checked = true;
          linkLead.dataset.leadKey = leadKey;
        }
      } else {
        leadRow.classList.add('hidden');
        leadRow.classList.remove('flex');
        if (linkLead) {
          linkLead.checked = false;
          delete linkLead.dataset.leadKey;
        }
      }
    }

    setModalOpen(true);
    requestAnimationFrame(function () {
      if (input) input.focus();
    });
  }

  function closeNavQuickTaskModal() {
    setModalOpen(false);
  }

  async function submitNavQuickTask(e) {
    if (e) e.preventDefault();
    var input = document.getElementById('navQuickTaskInput');
    var scheduled = document.getElementById('navQuickTaskScheduled');
    var err = document.getElementById('navQuickTaskError');
    var btn = document.getElementById('navQuickTaskSubmit');
    var linkLead = document.getElementById('navQuickTaskLinkLead');
    if (!input) return;

    var title = String(input.value || '').trim();
    if (!title) {
      if (err) {
        err.textContent = 'Enter a task description.';
        err.classList.remove('hidden');
      }
      input.focus();
      return;
    }

    var leadKey = null;
    if (linkLead && linkLead.checked && linkLead.dataset.leadKey) {
      leadKey = linkLead.dataset.leadKey;
    }

    var opts = { title: title, leadKey: leadKey };
    var when = scheduled && scheduled.value ? String(scheduled.value).trim() : '';
    if (when) opts.scheduledAt = when;

    if (btn) btn.disabled = true;
    if (err) err.classList.add('hidden');

    try {
      await createManualTask(opts);
      closeNavQuickTaskModal();
      toast('Task saved to Tasks.', 'success');
    } catch (ex) {
      var msg = ex && ex.message ? ex.message : 'Could not save task.';
      if (err) {
        err.textContent = msg;
        err.classList.remove('hidden');
      }
      toast(msg, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  window.adhelloCreateManualTask = createManualTask;
  window.adhelloOpenQuickTaskModal = openNavQuickTaskModal;

  document.addEventListener('click', function (e) {
    if (e.target.closest('#leadQuickTaskSaveBtn')) {
      e.preventDefault();
      void submitLeadQuickTask();
      return;
    }
    if (e.target.closest('#navQuickTaskOpen') || e.target.closest('#navQuickTaskOpenMobile')) {
      e.preventDefault();
      openNavQuickTaskModal();
      return;
    }
    if (e.target.closest('#navQuickTaskClose') || e.target.closest('#navQuickTaskBackdrop')) {
      e.preventDefault();
      closeNavQuickTaskModal();
      return;
    }
  });

  document.addEventListener('submit', function (e) {
    if (e.target && e.target.id === 'navQuickTaskForm') {
      e.preventDefault();
      void submitNavQuickTask(e);
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      var modal = document.getElementById('navQuickTaskModal');
      if (modal && !modal.classList.contains('hidden')) {
        e.preventDefault();
        closeNavQuickTaskModal();
        return;
      }
    }
    if (e.key !== 'Enter' || e.metaKey || e.ctrlKey || e.altKey) return;
    var input = document.getElementById('leadQuickTaskTitle');
    if (!input || document.activeElement !== input) return;
    e.preventDefault();
    void submitLeadQuickTask();
  });
})();
