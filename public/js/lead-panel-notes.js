/**
 * Lead panel notes — self-contained Post / My Notes paint + localStorage cache.
 * Loads before app.js so notes work even if the main bundle fails mid-init.
 */
(function () {
  'use strict';

  const LS_KEY = 'adhello_panel_notes_v1';
  let submitInflight = false;
  let lastPostBody = '';
  let lastPostAt = 0;

  function normalizeTitle(title) {
    return String(title || '')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function panelEl() {
    return document.getElementById('mobilePanel');
  }

  function activityHost() {
    const panel = panelEl();
    if (panel) {
      const scoped = panel.querySelector('#activityLog');
      if (scoped) return scoped;
    }
    return document.getElementById('activityLog');
  }

  function panelTitle() {
    const el = document.getElementById('mobilePanelTitle');
    const t = el ? String(el.textContent || '').trim() : '';
    if (t && t !== 'Company Name') return t;
    return '';
  }

  function readCacheMap() {
    window.__leadPanelNotesByKey = window.__leadPanelNotesByKey || {};
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          window.__leadPanelNotesByKey = { ...parsed, ...window.__leadPanelNotesByKey };
        }
      }
    } catch (_) {
      /* ignore */
    }
    return window.__leadPanelNotesByKey;
  }

  function persistCache() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(window.__leadPanelNotesByKey || {}));
    } catch (_) {
      /* ignore */
    }
  }

  function collectKeys(extraRow) {
    const keys = [];
    const add = (k) => {
      const v = String(k || '').trim();
      if (v && !keys.includes(v)) keys.push(v);
    };
    const panel = panelEl();
    if (panel && panel.dataset) {
      add(String(panel.dataset.adhelloLeadKey || '').replace(/^lead:/i, ''));
      add(String(panel.dataset.adhelloLeadTitleKey || ''));
    }
    add(String(window.__leadPanelActiveRowKey || '').replace(/^lead:/i, ''));
    const title = panelTitle();
    if (title) add(`title:${normalizeTitle(title).toLowerCase()}`);
    if (extraRow && extraRow.dataset) {
      add(String(extraRow.dataset.leadKey || '').replace(/^lead:/i, ''));
      const tk = normalizeTitle(extraRow.dataset.title || '');
      if (tk) add(`title:${tk.toLowerCase()}`);
    }
    const selected = document.querySelector(
      '#prospectLeadsTable tbody tr.result-row.selected, tr.result-row.selected:not(.result-row--panel-source)',
    );
    if (selected && selected.dataset) {
      add(String(selected.dataset.leadKey || '').replace(/^lead:/i, ''));
      const tk2 = normalizeTitle(selected.dataset.title || '');
      if (tk2) add(`title:${tk2.toLowerCase()}`);
    }
    return keys;
  }

  function readCachedNotes(extraRow) {
    const map = readCacheMap();
    const out = [];
    const seen = new Set();
    collectKeys(extraRow).forEach((key) => {
      const list = Array.isArray(map[key]) ? map[key] : [];
      list.forEach((note) => {
        if (!note) return;
        const id = `${String(note.timestamp || '')}|${String(note.value || '')}`;
        if (seen.has(id)) return;
        seen.add(id);
        out.push(note);
      });
    });
    out.sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0));
    return out;
  }

  function cacheNote(entry, extraRow) {
    if (!entry) return;
    readCacheMap();
    let changed = false;
    collectKeys(extraRow).forEach((key) => {
      const list = window.__leadPanelNotesByKey[key] || [];
      const exists = list.some(
        (n) =>
          n &&
          String(n.timestamp || '') === String(entry.timestamp || '') &&
          String(n.value || '') === String(entry.value || ''),
      );
      if (!exists) {
        window.__leadPanelNotesByKey[key] = [...list, entry];
        changed = true;
      }
    });
    if (changed) persistCache();
  }

  function readRowUpdates(row) {
    if (!row || !row.dataset) return [];
    try {
      const raw = row.dataset.updates || '[]';
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function isManualNote(raw) {
    if (!raw || typeof raw !== 'object') return false;
    if (raw.source === 'quick_log_pill') return false;
    if (raw.disposition || raw.statusChange) return false;
    if (raw.source === 'panel_post' || raw.manual === true) return true;
    if (String(raw.type || '') === 'note') return true;
    return false;
  }

  function mergeEntries(extraRow) {
    const out = [];
    const seen = new Set();
    const push = (ts, typ, text, raw) => {
      const body = String(text || '').trim();
      if (!body) return;
      const bucket = Date.parse(ts) ? Math.floor(Date.parse(ts) / 1000) : String(ts || '');
      const id = `${bucket}|${body.toLowerCase()}`;
      if (seen.has(id)) return;
      seen.add(id);
      out.push({ ts, typ, text: body, raw: raw || {} });
    };
    const row =
      extraRow ||
      document.querySelector(
        '#prospectLeadsTable tbody tr.result-row.selected, tr.result-row.selected:not(.result-row--panel-source)',
      );
    readRowUpdates(row).forEach((u) => {
      const val = u.value != null ? String(u.value) : u.content != null ? String(u.content) : '';
      push(u.timestamp || u.ts || '', String(u.type || 'update'), val, u);
    });
    readCachedNotes(row).forEach((n) => {
      push(n.timestamp || '', 'note', n.value || '', n);
    });
    out.sort((a, b) => (Date.parse(b.ts) || 0) - (Date.parse(a.ts) || 0));
    return out;
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeHtmlAttr(s) {
    return escapeHtml(s).replace(/'/g, '&#39;');
  }

  function noteTimestampsMatch(stored, requested) {
    const a = String(stored || '').trim();
    const b = String(requested || '').trim();
    if (!a || !b) return false;
    if (a === b) return true;
    const ta = Date.parse(a);
    const tb = Date.parse(b);
    if (Number.isFinite(ta) && Number.isFinite(tb)) {
      return Math.floor(ta / 1000) === Math.floor(tb / 1000);
    }
    return false;
  }

  function noteMatches(entry, timestamp, value) {
    if (!entry) return false;
    const val = String(value || '').trim();
    const body = String(entry.value || entry.content || entry.message || '').trim();
    if (val && body !== val) return false;
    if (!noteTimestampsMatch(entry.timestamp || entry.ts || '', timestamp)) return false;
    return true;
  }

  function purgeAllMatchingNotesFromCache(timestamp, value) {
    readCacheMap();
    let changed = false;
    Object.keys(window.__leadPanelNotesByKey || {}).forEach((key) => {
      const list = window.__leadPanelNotesByKey[key];
      if (!Array.isArray(list) || !list.length) return;
      const next = list.filter((n) => !noteMatches(n, timestamp, value));
      if (next.length !== list.length) {
        if (next.length) window.__leadPanelNotesByKey[key] = next;
        else delete window.__leadPanelNotesByKey[key];
        changed = true;
      }
    });
    if (changed) persistCache();
  }

  function removeNoteFromCache(timestamp, value, extraRow) {
    purgeAllMatchingNotesFromCache(timestamp, value);
    readCacheMap();
    let changed = false;
    collectKeys(extraRow).forEach((key) => {
      const list = window.__leadPanelNotesByKey[key];
      if (!Array.isArray(list) || !list.length) return;
      const next = list.filter((n) => !noteMatches(n, timestamp, value));
      if (next.length !== list.length) {
        if (next.length) window.__leadPanelNotesByKey[key] = next;
        else delete window.__leadPanelNotesByKey[key];
        changed = true;
      }
    });
    if (changed) persistCache();
  }

  function removeNoteFromRow(row, timestamp, value) {
    if (!row || !row.dataset) return;
    const updates = readRowUpdates(row).filter((u) => !noteMatches(u, timestamp, value));
    try {
      row.dataset.updates = JSON.stringify(updates);
    } catch (_) {
      /* ignore */
    }
    const val = String(value || '').trim();
    if (row.dataset.logsSnippet) {
      try {
        const logs = JSON.parse(row.dataset.logsSnippet || '[]');
        if (Array.isArray(logs)) {
          const nextLogs = logs.filter((log) => {
            if (String(log.type || '') !== 'note') return true;
            const msg = String(log.message || '').trim();
            if (val && msg !== val) return true;
            return !noteTimestampsMatch(log.timestamp || '', timestamp);
          });
          row.dataset.logsSnippet = JSON.stringify(nextLogs);
        }
      } catch (_) {
        /* ignore */
      }
    }
  }

  function resolveActivityRow() {
    return (
      document.querySelector(
        '#prospectLeadsTable tbody tr.result-row.selected, tr.result-row.selected:not(.result-row--panel-source)',
      ) || null
    );
  }

  async function deleteNote(timestamp, value) {
    if (typeof window.__deleteLeadPanelNote === 'function') {
      const row = resolveActivityRow();
      if (row) return window.__deleteLeadPanelNote(row, timestamp, value);
    }
    const ts = String(timestamp || '').trim();
    const text = String(value || '').trim();
    if (!ts) return false;
    if (!window.confirm('Delete this note?')) return false;
    const row = resolveActivityRow();
    removeNoteFromRow(row, ts, text);
    purgeAllMatchingNotesFromCache(ts, text);
    paint(window.__leadActivityFilter || 'notes');
    const leadKey = resolveLeadKey(row);
    if (leadKey) {
      try {
        const res = await fetch(`/leads/${encodeURIComponent(leadKey)}/notes/delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ timestamp: ts, value: text }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
          throw new Error((data && data.error) || 'Could not delete note');
        }
        if (row && Array.isArray(data.updates)) {
          try {
            row.dataset.updates = JSON.stringify(data.updates);
          } catch (_) {
            /* ignore */
          }
        }
        if (typeof window.showAppToast === 'function') {
          window.showAppToast('Note deleted.', { variant: 'success' });
        }
      } catch (err) {
        if (typeof window.showAppToast === 'function') {
          window.showAppToast(err.message || 'Failed to delete note.', { variant: 'error' });
        }
      }
    }
    return true;
  }

  function paint(filter) {
    const host = activityHost();
    if (!host) return false;
    const f = String(filter || window.__leadActivityFilter || 'all');
    window.__leadActivityFilter = f;
    const row =
      document.querySelector(
        '#prospectLeadsTable tbody tr.result-row.selected, tr.result-row.selected:not(.result-row--panel-source)',
      ) || null;
    if (f === 'merges') {
      document.querySelectorAll('#mobilePanel .lead-activity-filter').forEach((btn) => {
        const on = (btn.getAttribute('data-activity-filter') || 'all') === f;
        btn.classList.toggle('bg-white', on);
        btn.classList.toggle('dark:bg-slate-900', on);
        btn.classList.toggle('text-brand-dark', on);
        btn.classList.toggle('dark:text-white', on);
        btn.classList.toggle('shadow-sm', on);
        btn.classList.toggle('text-brand-muted', !on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      if (typeof window.__adhelloPaintLeadPanelMerges === 'function') {
        window.__adhelloPaintLeadPanelMerges(row, host);
      } else {
        host.innerHTML =
          '<div class="pl-2 text-xs text-brand-muted italic leading-relaxed">Merges view is loading…</div>';
      }
      return true;
    }
    const entries = mergeEntries();
    const filtered =
      f === 'notes'
        ? entries.filter((e) => isManualNote(e.raw))
        : f === 'calls'
          ? entries.filter((e) => {
              const typ = String(e.typ || '').toLowerCase();
              const blob = `${typ} ${e.text}`.toLowerCase();
              return (
                typ === 'call_disposition' ||
                typ === 'quick_log' ||
                /call|dial|phone|voicemail/.test(blob)
              );
            })
          : entries;
    document.querySelectorAll('#mobilePanel .lead-activity-filter').forEach((btn) => {
      const on = (btn.getAttribute('data-activity-filter') || 'all') === f;
      btn.classList.toggle('bg-white', on);
      btn.classList.toggle('dark:bg-slate-900', on);
      btn.classList.toggle('text-brand-dark', on);
      btn.classList.toggle('dark:text-white', on);
      btn.classList.toggle('shadow-sm', on);
      btn.classList.toggle('text-brand-muted', !on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    if (!filtered.length) {
      const keys = collectKeys();
      const noLead = !keys.length;
      const emptyMsg =
        f === 'notes'
          ? noLead
            ? 'Select a lead from the pipeline, then post a note below.'
            : 'No notes yet. Post one in Note · Post below, or switch to All to see calls and pipeline activity.'
          : f === 'calls'
            ? 'No call activity logged yet. Use Call, Quick log tags, or switch to All.'
            : noLead
              ? 'Select a lead from the pipeline to load activity.'
              : 'No activity yet. Post a note, log a call, or update pipeline status.';
      host.innerHTML = `<div class="pl-10 text-xs text-brand-muted italic leading-relaxed">${emptyMsg}</div>`;
      return true;
    }
    host.innerHTML = filtered
      .map((e) => {
        const when = e.ts
          ? new Date(e.ts).toLocaleString(undefined, {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })
          : '—';
        const label = String(e.typ || 'note').replace(/_/g, ' ');
        const canDelete = isManualNote(e.raw);
        const deleteBtn = canDelete
          ? `<button type="button" class="lead-activity-note-delete shrink-0 opacity-70 hover:opacity-100 text-[9px] font-black uppercase tracking-widest text-rose-500 hover:text-rose-600 dark:text-rose-400 dark:hover:text-rose-300 transition-opacity px-1.5 py-0.5 rounded-md hover:bg-rose-500/10" data-note-ts="${escapeHtmlAttr(String(e.ts || ''))}" data-note-value="${escapeHtmlAttr(encodeURIComponent(String(e.text || '')))}" aria-label="Delete this note">Delete</button>`
          : '';
        return `<div class="relative pl-10 pb-1 group/activity">
          <div class="absolute left-1 top-1 w-2.5 h-2.5 rounded-full bg-brand-yellow shadow-sm ring-2 ring-white dark:ring-slate-900"></div>
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0 flex-1">
              <p class="text-[9px] font-black uppercase tracking-widest text-brand-muted">${escapeHtml(when)} · ${escapeHtml(label)}</p>
              <p class="text-xs font-semibold text-brand-dark dark:text-slate-200 mt-1 leading-relaxed">${escapeHtml(e.text)}</p>
            </div>
            ${deleteBtn}
          </div>
        </div>`;
      })
      .join('');
    return true;
  }

  function resolveLeadKey(extraRow) {
    const keys = collectKeys(extraRow);
    return keys.find((k) => k && !k.startsWith('title:')) || '';
  }

  async function persistToServer(key, content) {
    const keyParam = String(key || '')
      .trim()
      .replace(/^lead:/i, '');
    if (!keyParam) throw new Error('Save this lead to the pipeline first, then post your note.');
    const res = await fetch(`/leads/${encodeURIComponent(keyParam)}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ content, type: 'note', deferGhlSync: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      throw new Error((data && data.error) || 'Could not save note to server.');
    }
    return data;
  }

  function appendToRowUpdates(row, entry) {
    if (!row || !row.dataset) return;
    const updates = readRowUpdates(row);
    updates.push(entry);
    try {
      row.dataset.updates = JSON.stringify(updates);
    } catch (_) {
      /* ignore */
    }
  }

  async function submit() {
    if (submitInflight) return false;
    if (typeof window.__adhelloSubmitLeadPanelNoteImpl === 'function') {
      return window.__adhelloSubmitLeadPanelNoteImpl();
    }
    const input =
      (panelEl() && panelEl().querySelector('#noteInput')) || document.getElementById('noteInput');
    const content = input ? String(input.value || '').trim() : '';
    if (!content) {
      if (typeof window.showAppToast === 'function') {
        window.showAppToast('Type a note first.', { variant: 'error' });
      }
      return false;
    }
    const now = Date.now();
    if (content === lastPostBody && now - lastPostAt < 800) return false;
    const row = document.querySelector(
      '#prospectLeadsTable tbody tr.result-row.selected, tr.result-row.selected:not(.result-row--panel-source)',
    );
    const leadKey = resolveLeadKey(row);
    if (!leadKey && !panelTitle()) {
      if (typeof window.showAppToast === 'function') {
        window.showAppToast('Open a lead from the pipeline first, then post your note.', {
          variant: 'error',
        });
      }
      return false;
    }
    submitInflight = true;
    lastPostBody = content;
    lastPostAt = now;
    try {
      const entry = {
        type: 'note',
        value: content,
        timestamp: new Date().toISOString(),
        source: 'panel_post',
        manual: true,
      };
      appendToRowUpdates(row, entry);
      cacheNote(entry, row);
      if (input) input.value = '';
      window.__leadActivityFilter = 'notes';
      paint('notes');
      const btn =
        (panelEl() && panelEl().querySelector('#addNoteBtn')) || document.getElementById('addNoteBtn');
      if (btn) {
        btn.textContent = 'Posted ✓';
        setTimeout(() => {
          btn.textContent = btn.getAttribute('data-default-label') || 'Post';
        }, 2000);
      }
      if (leadKey) {
        persistToServer(leadKey, content)
          .then(() => {
            if (typeof window.showAppToast === 'function') {
              window.showAppToast('Note saved.', { variant: 'success' });
            }
          })
          .catch((err) => {
            if (typeof window.showAppToast === 'function') {
              window.showAppToast(err.message || 'Note shown here but could not save.', {
                variant: 'error',
              });
            }
          });
      }
      return true;
    } finally {
      submitInflight = false;
    }
  }

  function syncFromRow(row, filter) {
    if (!row || !row.dataset) return;
    const panel = panelEl();
    const lk = String(row.dataset.leadKey || '').trim().replace(/^lead:/i, '');
    const title = normalizeTitle(row.dataset.title || '');
    if (panel && panel.dataset) {
      if (lk) panel.dataset.adhelloLeadKey = lk;
      if (title) panel.dataset.adhelloLeadTitleKey = `title:${title.toLowerCase()}`;
    }
    if (lk) window.__leadPanelActiveRowKey = lk;
    paint(filter || window.__leadActivityFilter || 'all');
  }

  readCacheMap();

  document.addEventListener(
    'click',
    (e) => {
      if (e.target.closest('#addNoteBtn')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        void submit();
        return;
      }
      const filterBtn = e.target.closest('.lead-activity-filter');
      if (filterBtn && filterBtn.closest('#mobilePanel')) {
        e.preventDefault();
        e.stopPropagation();
        const f = filterBtn.getAttribute('data-activity-filter') || 'all';
        window.__leadActivityFilter = f;
        paint(f);
        return;
      }
      const deleteBtn = e.target.closest('.lead-activity-note-delete');
      if (deleteBtn && deleteBtn.closest('#mobilePanel')) {
        e.preventDefault();
        e.stopPropagation();
        const ts = deleteBtn.getAttribute('data-note-ts') || '';
        let val = deleteBtn.getAttribute('data-note-value') || '';
        try {
          val = decodeURIComponent(val);
        } catch {
          /* keep raw */
        }
        void deleteNote(ts, val);
      }
    },
    true,
  );

  document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('noteInput');
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        void submit();
      });
    }
    if (panelEl()) paint(window.__leadActivityFilter || 'all');
  });

  window.__adhelloLeadPanelNotes = {
    paint,
    submit,
    syncFromRow,
    cacheNote,
    readCachedNotes,
    removeNote: purgeAllMatchingNotesFromCache,
    deleteNote,
  };
  window.__adhelloPaintLeadPanelNotes = paint;
})();
