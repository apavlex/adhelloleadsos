/**
 * Create manual tasks from Focus, lead panel, activity, etc. (always /tasks/api → source: manual).
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

  window.adhelloCreateManualTask = createManualTask;

  document.addEventListener('click', function (e) {
    if (e.target.closest('#leadQuickTaskSaveBtn')) {
      e.preventDefault();
      void submitLeadQuickTask();
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || e.metaKey || e.ctrlKey || e.altKey) return;
    var input = document.getElementById('leadQuickTaskTitle');
    if (!input || document.activeElement !== input) return;
    e.preventDefault();
    void submitLeadQuickTask();
  });
})();
