/**
 * Workspace lead tags — panel editor, table chips, bulk bar assign.
 */
(function () {
  'use strict';

  function getWorkspaceTags() {
    return Array.isArray(window.WORKSPACE_TAGS) ? window.WORKSPACE_TAGS : [];
  }

  function tagByKey(key) {
    const k = String(key || '').trim();
    return getWorkspaceTags().find((t) => t && t.key === k) || null;
  }

  function tagNameForKey(key) {
    const t = tagByKey(key);
    return t && t.name ? t.name : String(key || '').replace(/^tag:[^:]+:/, '');
  }

  function tagColorForKey(key) {
    const t = tagByKey(key);
    return normalizeHexColor((t && t.color) || '#94a3b8');
  }

  function normalizeHexColor(raw) {
    const s = String(raw || '').trim();
    if (/^#[0-9A-Fa-f]{6}$/.test(s)) return s.toUpperCase();
    return '#94A3B8';
  }

  function upsertWorkspaceTag(tag) {
    const normalized = normalizeWorkspaceTag(tag);
    if (!normalized) return;
    const list = Array.isArray(window.WORKSPACE_TAGS) ? window.WORKSPACE_TAGS.slice() : [];
    const idx = list.findIndex((t) => t && t.key === normalized.key);
    if (idx >= 0) list[idx] = { ...list[idx], ...normalized };
    else list.push(normalized);
    list.sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }),
    );
    window.WORKSPACE_TAGS = list;
  }

  async function saveTagColor(tagKey, color) {
    const data = await apiJson('/tags/set-color', {
      method: 'POST',
      body: JSON.stringify({ tagKey: String(tagKey || '').trim(), color: normalizeHexColor(color) }),
    });
    if (data.tag) upsertWorkspaceTag(data.tag);
    return data.tag;
  }

  function repaintAllRowTagChips() {
    document.querySelectorAll('#prospectLeadsTable tbody tr.result-row, #searchResultsLeadsTable tbody tr.result-row').forEach((row) => {
      if (row.querySelector('.lead-row-tags')) renderRowTagChips(row);
    });
  }

  function syncBulkTagColorInput() {
    const select = document.getElementById('bulkTagSelect');
    const colorInput = document.getElementById('bulkTagColor');
    if (!colorInput) return;
    const tagKey = select && select.value ? String(select.value).trim() : '';
    if (!tagKey) {
      colorInput.disabled = true;
      colorInput.value = '#94A3B8';
      colorInput.dataset.tagKey = '';
      return;
    }
    colorInput.disabled = false;
    colorInput.dataset.tagKey = tagKey;
    colorInput.value = tagColorForKey(tagKey);
    colorInput.dataset.originalColor = colorInput.value;
  }

  function tagIsActive(tag) {
    return !!(tag && tag.isActive === true);
  }

  function normalizeWorkspaceTag(tag) {
    if (!tag || !tag.key) return null;
    return {
      key: String(tag.key),
      name: String(tag.name || '').trim() || 'Tag',
      color: normalizeHexColor(tag.color || '#94a3b8'),
      isActive: tag.isActive === true,
    };
  }

  let workspaceTagsRefreshPromise = null;

  async function refreshWorkspaceTagsFromServer() {
    if (!workspaceTagsRefreshPromise) {
      workspaceTagsRefreshPromise = fetch('/tags', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      })
        .then((res) => res.json().catch(() => ({})))
        .then((data) => {
          if (data && data.success && Array.isArray(data.tags)) {
            window.WORKSPACE_TAGS = data.tags.map(normalizeWorkspaceTag).filter(Boolean);
          } else if (!Array.isArray(window.WORKSPACE_TAGS)) {
            window.WORKSPACE_TAGS = [];
          }
        })
        .catch(() => {
          if (!Array.isArray(window.WORKSPACE_TAGS)) window.WORKSPACE_TAGS = [];
        })
        .finally(() => {
          workspaceTagsRefreshPromise = null;
        });
    }
    await workspaceTagsRefreshPromise;
  }

  let tagsPanelMutating = false;
  let tagsPanelRenderSkip = false;

  function resolveActiveTagsPanelRow() {
    const key = String(window.__leadPanelActiveRowKey || '').trim();
    if (key) {
      const norm = key.replace(/^lead:/i, '');
      const byKey = document.querySelector(
        `#prospectLeadsTable tbody tr.result-row[data-lead-key="${CSS.escape(norm)}"], #prospectLeadsTable tbody tr.result-row[data-lead-key="lead:${CSS.escape(norm)}"]`,
      );
      if (byKey) return resolveTagsPanelRow(byKey);
    }
    if (typeof window.__resolvePipelineTableRowForPanel === 'function') {
      const fromPanel = window.__resolvePipelineTableRowForPanel(null);
      if (fromPanel) return resolveTagsPanelRow(fromPanel);
    }
    return null;
  }

  function syncEmbeddedLeadTags(leadKey, tagKeys) {
    const list = window.INITIAL_SAVED_LEADS;
    if (!Array.isArray(list)) return;
    const norm = String(leadKey || '').trim().replace(/^lead:/i, '');
    if (!norm) return;
    const rec = list.find((l) => l && (String(l.key) === norm || String(l.key) === `lead:${norm}`));
    if (rec) rec.tags = [...tagKeys];
  }

  function resolveTagsPanelRow(row) {
    if (typeof window.__resolvePipelineTableRowForPanel === 'function') {
      return window.__resolvePipelineTableRowForPanel(row) || row;
    }
    if (!row || !row.dataset) return row;
    const key = String(row.dataset.leadKey || row.getAttribute('data-lead-key') || '').trim();
    if (key) {
      const norm = key.replace(/^lead:/i, '');
      const byKey = document.querySelector(
        `#prospectLeadsTable tbody tr.result-row[data-lead-key="${CSS.escape(norm)}"], #prospectLeadsTable tbody tr.result-row[data-lead-key="lead:${CSS.escape(norm)}"]`,
      );
      if (byKey) return byKey;
    }
    return row;
  }

  function resolveLeadKeyForTags(row) {
    const r = resolveTagsPanelRow(row);
    if (!r) return '';
    let key = String(r.dataset.leadKey || r.getAttribute('data-lead-key') || '').trim();
    if (key) return key;
    const panel = document.getElementById('mobilePanel');
    if (panel && panel.dataset && panel.dataset.adhelloLeadKey) {
      return String(panel.dataset.adhelloLeadKey).trim();
    }
    return '';
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const addTagButtonClass =
    'lead-panel-tag-toggle px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wide border border-brand-border/50 dark:border-white/15 bg-white/80 dark:bg-slate-800/80 text-brand-dark dark:text-white transition-all opacity-90 hover:opacity-100 hover:border-brand-yellow/50';

  function parseRowTags(row) {
    if (!row || !row.dataset) return [];
    const raw = row.dataset.tags || '[]';
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
    } catch (_) {
      return [];
    }
  }

  function setRowTags(row, tagKeys) {
    if (!row || !row.dataset) return;
    const keys = [...new Set((tagKeys || []).map((k) => String(k).trim()).filter(Boolean))];
    row.dataset.tags = JSON.stringify(keys);
    syncEmbeddedLeadTags(resolveLeadKeyForTags(row), keys);
    renderRowTagChips(row);
  }

  function renderRowTagChips(row) {
    const slot = row && row.querySelector('.lead-row-tags');
    if (!slot) return;
    const keys = parseRowTags(row);
    if (!keys.length) {
      slot.innerHTML = '';
      slot.classList.add('hidden');
      return;
    }
    slot.classList.remove('hidden');
    let html = keys
      .slice(0, 4)
      .map((key) => {
        const name = tagNameForKey(key);
        const color = tagColorForKey(key);
        return `<span class="lead-tag-chip inline-flex items-center px-1.5 py-0.5 rounded-md text-[8px] font-black uppercase tracking-wide border border-black/5 dark:border-white/10" style="background:${color}22;color:${color}" title="${escapeHtml(name)}">${escapeHtml(name)}</span>`;
      })
      .join('');
    if (keys.length > 4) {
      html += `<span class="text-[8px] font-bold text-brand-muted dark:text-slate-400">+${keys.length - 4}</span>`;
    }
    slot.innerHTML = html;
  }

  async function apiJson(url, opts) {
    const res = await fetch(url, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      ...opts,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      throw new Error((data && data.error) || `HTTP ${res.status}`);
    }
    return data;
  }

  async function saveLeadTags(leadKey, tagKeys) {
    const data = await apiJson('/tags/assign', {
      method: 'POST',
      body: JSON.stringify({
        leadKey: String(leadKey || '').trim(),
        tagKeys,
        mode: 'set',
      }),
    });
    return data.lead;
  }

  async function pushLeadTagsToGhl(leadKey) {
    const key = String(leadKey || '').trim();
    if (!key) return { ok: false, skipped: true };
    try {
      await apiJson('/ghl/push', {
        method: 'POST',
        body: JSON.stringify({ leadKeys: [key] }),
      });
      return { ok: true };
    } catch (err) {
      const msg = String(err.message || '');
      if (/not configured|ghl not|422/i.test(msg)) return { ok: false, skipped: true };
      throw err;
    }
  }

  function tagSyncToast(message, variant) {
    if (typeof window.showProspectToast === 'function') {
      window.showProspectToast(message);
    } else if (typeof window.showAppToast === 'function') {
      window.showAppToast(message, { variant: variant || 'success' });
    }
  }

  async function bulkAssignTags(leadKeys, tagKeys, mode) {
    return apiJson('/tags/assign-bulk', {
      method: 'POST',
      body: JSON.stringify({ leadKeys, tagKeys, mode: mode || 'add' }),
    });
  }

  async function createWorkspaceTag(name, color) {
    const payload = { name: String(name || '').trim() };
    if (color) payload.color = normalizeHexColor(color);
    const data = await apiJson('/tags', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (data.tag) upsertWorkspaceTag(data.tag);
    rebuildBulkTagSelect();
    return data.tag;
  }

  function rebuildBulkTagSelect() {
    const select = document.getElementById('bulkTagSelect');
    if (!select) return;
    const prev = select.value;
    select.innerHTML = '<option value="">Select tag…</option>';
    getWorkspaceTags()
      .slice()
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }))
      .forEach((t) => {
        if (!t || !t.key) return;
        const opt = document.createElement('option');
        opt.value = t.key;
        opt.textContent = t.name || 'Tag';
        select.appendChild(opt);
      });
    if (prev && Array.from(select.options).some((o) => o.value === prev)) {
      select.value = prev;
    }
    syncBulkTagColorInput();
  }

  function leadKeyFromCheckbox(cb) {
    if (!cb) return '';
    let key = String(cb.getAttribute('data-key') ?? cb.dataset.key ?? '').trim();
    if (key) return key;
    const row = cb.closest('tr.result-row, tr[data-lead-key]');
    if (!row) return '';
    return String(row.getAttribute('data-lead-key') ?? row.dataset.leadKey ?? '').trim();
  }

  function getSelectedLeadKeysForBulk() {
    if (typeof window.__getSelectedLeadKeysForBulk === 'function') {
      const keys = window.__getSelectedLeadKeysForBulk();
      if (keys.length) return keys;
    }
    if (typeof window.__ensureBulkSelectionKeys === 'function') {
      const keys = window.__ensureBulkSelectionKeys();
      if (keys.length) return keys;
    }
    if (typeof window.__syncBulkSelectionFromDom === 'function') {
      window.__syncBulkSelectionFromDom();
      if (typeof window.__ensureBulkSelectionKeys === 'function') {
        const keys = window.__ensureBulkSelectionKeys();
        if (keys.length) return keys;
      }
    } else if (typeof window.__syncBulkBarFromDom === 'function') {
      window.__syncBulkBarFromDom();
    }
    const keys = [];
    const seen = new Set();
    const selectors = [
      '#prospectLeadsTable tbody input.lead-checkbox:checked',
      '#prospectLeadsTable tbody input.row-checkbox:checked',
      '#searchResultsLeadsTable tbody input.lead-checkbox:checked',
      '#searchResultsLeadsTable tbody input.row-checkbox:checked',
      'tbody input.lead-checkbox:checked',
      'tbody input.row-checkbox:checked',
    ];
    selectors.forEach((sel) => {
      document.querySelectorAll(sel).forEach((cb) => {
        const key = leadKeyFromCheckbox(cb);
        if (!key || seen.has(key)) return;
        seen.add(key);
        keys.push(key);
      });
    });
    return keys;
  }

  function applyTagsToRowsFromBulkResult(leads) {
    if (!Array.isArray(leads)) return;
    leads.forEach((lead) => {
      if (!lead || !lead.key) return;
      const key = String(lead.key);
      const tags = Array.isArray(lead.tags) ? lead.tags : [];
      const cb = document.querySelector(
        `input.lead-checkbox[data-key="${CSS.escape(key)}"], input.row-checkbox[data-key="${CSS.escape(key)}"]`,
      );
      const row = (cb && cb.closest('.result-row')) || document.querySelector(`tr.result-row[data-lead-key="${CSS.escape(key)}"]`);
      if (row) setRowTags(row, tags);
    });
  }

  function setBulkTagsRowVisible(show) {
    const row = document.getElementById('bulkTagsRow');
    if (!row) return;
    if (show) {
      row.classList.remove('hidden');
      row.classList.add('flex');
      if (typeof window.__setBulkFolderNewRowVisible === 'function') {
        window.__setBulkFolderNewRowVisible(false);
      } else {
        const folderRow = document.getElementById('bulkFolderNewRow');
        if (folderRow) {
          folderRow.classList.add('hidden');
          folderRow.classList.remove('flex');
        }
      }
      rebuildBulkTagSelect();
      syncBulkTagColorInput();
    } else {
      row.classList.add('hidden');
      row.classList.remove('flex');
      const nameInput = document.getElementById('bulkTagNewName');
      if (nameInput) nameInput.value = '';
    }
  }
  window.__setBulkTagsRowVisible = setBulkTagsRowVisible;
  window.__toggleBulkTagsRow = function toggleBulkTagsRow() {
    const row = document.getElementById('bulkTagsRow');
    const show = !!(row && row.classList.contains('hidden'));
    setBulkTagsRowVisible(show);
  };

  function renderLeadTagsEditor(host, row, opts) {
    if (!host) return;
    const primary = !!(opts && opts.primary);
    const compact = !!(opts && opts.compact) && !primary;
    const hostId = host.id || 'leadPanelCompanyTagsHost';
    row = resolveTagsPanelRow(row);
    if (!row || !row.dataset) {
      host.innerHTML =
        '<p class="text-[11px] text-brand-muted dark:text-slate-400 italic">Select a lead to manage tags.</p>';
      return;
    }

    const leadKey = resolveLeadKeyForTags(row);
    const active = new Set(parseRowTags(row));
    const allTags = getWorkspaceTags().map(normalizeWorkspaceTag).filter(Boolean);
    const tags = allTags.filter(tagIsActive);
    const inputId = `leadPanelNewTagName-${hostId}`;
    const createBtnId = `leadPanelCreateTagBtn-${hostId}`;

    let html = '';
    if (!compact) {
      html += `<div class="flex flex-wrap gap-2 items-center mb-3 pb-3 border-b border-brand-border/20 dark:border-white/10">
      <input type="text" id="${escapeHtml(inputId)}" placeholder="New tag name…" class="min-w-[6rem] flex-1 rounded-lg border border-brand-border/50 dark:border-white/15 bg-white/80 dark:bg-slate-800/80 px-2.5 py-1.5 text-[11px] font-semibold text-brand-dark dark:text-white" />
      <button type="button" id="${escapeHtml(createBtnId)}" class="lead-panel-tag-create btn-pill bg-brand-yellow text-brand-dark px-3 py-1.5 text-[9px] font-black uppercase tracking-widest shrink-0">Create</button>
      <a href="/tags/manage" class="text-[10px] font-bold uppercase tracking-wide text-brand-yellow hover:underline shrink-0 ml-auto">Manage all tags →</a>
    </div>`;
    }

    const applied = allTags.filter((t) => t && t.key && active.has(t.key));
    const availableActive = tags.filter((t) => t && t.key && !active.has(t.key));

    html += `<div class="flex flex-wrap gap-1.5 ${compact ? '' : 'mb-2'}" data-tag-pills-host="${escapeHtml(hostId)}">`;
    if (!allTags.length) {
      html += compact
        ? '<p class="text-[10px] text-brand-muted dark:text-slate-400 w-full">No tags yet — create one below.</p>'
        : '<p class="text-[10px] text-brand-muted dark:text-slate-400 w-full">No workspace tags yet — create one above.</p>';
    } else if (!applied.length) {
      html += '<p class="text-[10px] text-brand-muted dark:text-slate-400 w-full">No tags on this lead yet.</p>';
    } else {
      applied.forEach((t) => {
        const color = t.color || '#94a3b8';
        html += `<span class="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-lg text-[9px] font-black uppercase tracking-wide border ring-2 ring-offset-1 ring-brand-yellow/50" style="background:${color}33;border-color:${color}66;color:${color}">
          <span>${escapeHtml(t.name)}</span>
          <button type="button" class="lead-panel-tag-remove w-5 h-5 rounded-md flex items-center justify-center text-[13px] leading-none font-bold opacity-70 hover:opacity-100 hover:bg-black/10 dark:hover:bg-white/10 transition-opacity" data-tag-key="${escapeHtml(t.key)}" data-tags-host="${escapeHtml(hostId)}" aria-label="Remove ${escapeHtml(t.name)} tag">×</button>
        </span>`;
      });
    }
    html += '</div>';

    if (!compact && availableActive.length) {
      html += `<p class="text-[9px] font-black uppercase tracking-widest text-brand-muted dark:text-slate-500 mb-1.5 mt-1">Add tag</p>`;
      html += `<div class="flex flex-wrap gap-1.5" data-tag-add-host="${escapeHtml(hostId)}">`;
      availableActive.forEach((t) => {
        html += `<button type="button" class="${addTagButtonClass}" data-tag-key="${escapeHtml(t.key)}" data-tags-host="${escapeHtml(hostId)}" aria-pressed="false">+ ${escapeHtml(t.name)}</button>`;
      });
      html += '</div>';
    } else if (!compact && allTags.length && !availableActive.length && !applied.length) {
      html +=
        '<p class="text-[10px] text-brand-muted dark:text-slate-400 mt-1">No active tags to add — turn tags on under <a href="/tags/manage" class="text-brand-yellow hover:underline">Manage all tags</a>.</p>';
    } else if (compact) {
      html += `<div class="flex flex-wrap gap-1.5 mt-1" data-tag-add-host="${escapeHtml(hostId)}">`;
      availableActive.forEach((t) => {
        html += `<button type="button" class="${addTagButtonClass}" data-tag-key="${escapeHtml(t.key)}" data-tags-host="${escapeHtml(hostId)}" aria-pressed="false">+ ${escapeHtml(t.name)}</button>`;
      });
      html += '</div>';
    }

    host.innerHTML = html;
  }

  async function mutateLeadTags(mutator) {
    if (tagsPanelMutating) return;
    const row = resolveActiveTagsPanelRow();
    if (!row) {
      tagSyncToast('Select a lead to manage tags.', 'error');
      throw new Error('Lead row missing');
    }
    const key = resolveLeadKeyForTags(row);
    if (!key) {
      tagSyncToast('Save this lead before adding tags.', 'error');
      throw new Error('Lead key missing');
    }
    tagsPanelMutating = true;
    tagsPanelRenderSkip = true;
    try {
      const set = new Set(parseRowTags(row));
      mutator(set);
      const lead = await saveLeadTags(key, [...set]);
      if (lead && Array.isArray(lead.tags)) setRowTags(row, lead.tags);
      tagsPanelRenderSkip = false;
      renderLeadTagsPanel(row);
      try {
        const ghl = await pushLeadTagsToGhl(key);
        tagSyncToast(
          ghl.ok ? 'Tags updated · synced to GHL' : 'Tags updated · tap Sync GHL to push tags',
          ghl.ok ? 'success' : 'info',
        );
      } catch (err) {
        tagSyncToast(err.message || 'Tags saved but GHL sync failed', 'error');
      }
    } finally {
      tagsPanelMutating = false;
      tagsPanelRenderSkip = false;
    }
  }

  function bindLeadPanelTagsInteraction() {
    const section = document.getElementById('leadPanelCompanyTagsSection');
    if (!section || section.dataset.tagPanelBound === '1') return;
    section.dataset.tagPanelBound = '1';

    section.addEventListener('click', async (e) => {
      const toggle = e.target.closest('.lead-panel-tag-toggle');
      const remove = e.target.closest('.lead-panel-tag-remove');
      const createBtn = e.target.closest('.lead-panel-tag-create');
      if (!toggle && !remove && !createBtn) return;
      e.preventDefault();
      e.stopPropagation();

      if (toggle) {
        const tk = toggle.getAttribute('data-tag-key');
        if (!tk || toggle.disabled) return;
        toggle.disabled = true;
        try {
          await mutateLeadTags((set) => set.add(tk));
        } catch (err) {
          if (err && err.message !== 'Lead key missing' && err.message !== 'Lead row missing') {
            window.alert(err.message || 'Could not update tags.');
          }
          toggle.disabled = false;
        }
        return;
      }

      if (remove) {
        const tk = remove.getAttribute('data-tag-key');
        if (!tk || remove.disabled) return;
        remove.disabled = true;
        try {
          await mutateLeadTags((set) => set.delete(tk));
        } catch (err) {
          if (err && err.message !== 'Lead key missing' && err.message !== 'Lead row missing') {
            window.alert(err.message || 'Could not remove tag.');
          }
          remove.disabled = false;
        }
        return;
      }

      if (createBtn) {
        const host = document.getElementById('leadPanelCompanyTagsHost');
        const nameInput = host && host.querySelector('input[type="text"]');
        const name = nameInput ? String(nameInput.value || '').trim() : '';
        if (!name) return;
        createBtn.disabled = true;
        try {
          const tag = await createWorkspaceTag(name);
          if (tag && tag.key) {
            await mutateLeadTags((set) => set.add(tag.key));
          } else {
            renderLeadTagsPanel(resolveActiveTagsPanelRow());
          }
          if (nameInput) nameInput.value = '';
        } catch (err) {
          window.alert(err.message || 'Could not create tag.');
        } finally {
          createBtn.disabled = false;
        }
      }
    });

    section.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const nameInput = e.target.closest('#leadPanelCompanyTagsHost input[type="text"]');
      if (!nameInput) return;
      e.preventDefault();
      const createBtn = document.getElementById('leadPanelCompanyTagsHost')?.querySelector('.lead-panel-tag-create');
      if (createBtn && !createBtn.disabled) createBtn.click();
    });
  }

  function renderLeadTagsPanel(row) {
    if (tagsPanelRenderSkip) return;
    const target =
      resolveTagsPanelRow(row) ||
      resolveActiveTagsPanelRow() ||
      (typeof window.__leadPanelActiveRowKey === 'string' && window.__leadPanelActiveRowKey
        ? document.querySelector(
            `#prospectLeadsTable tbody tr.result-row[data-lead-key="${CSS.escape(window.__leadPanelActiveRowKey)}"]`,
          )
        : null);
    renderLeadTagsEditor(document.getElementById('leadPanelCompanyTagsHost'), target, { primary: true });
    refreshWorkspaceTagsFromServer()
      .then(() => {
        if (tagsPanelRenderSkip) return;
        const freshTarget =
          resolveTagsPanelRow(row) ||
          resolveActiveTagsPanelRow() ||
          target;
        renderLeadTagsEditor(document.getElementById('leadPanelCompanyTagsHost'), freshTarget, {
          primary: true,
        });
      })
      .catch(() => {});
  }

  async function runBulkTagFromBar(mode) {
    const select = document.getElementById('bulkTagSelect');
    const addBtn = document.getElementById('bulkTagAddBtn');
    const removeBtn = document.getElementById('bulkTagRemoveBtn');
    const keys = getSelectedLeadKeysForBulk();
    const tagKey = select && select.value ? String(select.value).trim() : '';
    if (!keys.length) {
      window.alert('Select at least one lead.');
      return;
    }
    if (!tagKey) {
      window.alert('Choose a tag first.');
      return;
    }
    if (addBtn) addBtn.disabled = true;
    if (removeBtn) removeBtn.disabled = true;
    try {
      const data = await bulkAssignTags(keys, [tagKey], mode);
      const updatedCount = Array.isArray(data.leads) ? data.leads.length : (data.updatedKeys || []).length;
      if (!updatedCount) {
        throw new Error('No leads were updated. Refresh the page and try again.');
      }
      applyTagsToRowsFromBulkResult(data.leads);
      await refreshWorkspaceTagsFromServer();
      initRowTags();
      const msg =
        mode === 'remove'
          ? `Removed tag from ${updatedCount} lead${updatedCount === 1 ? '' : 's'}`
          : `Tagged ${updatedCount} lead${updatedCount === 1 ? '' : 's'}`;
      if (typeof window.showProspectToast === 'function') window.showProspectToast(msg);
      else window.alert(msg);
    } catch (err) {
      window.alert(err.message || 'Bulk tag update failed.');
    } finally {
      if (addBtn) addBtn.disabled = false;
      if (removeBtn) removeBtn.disabled = false;
    }
  }

  async function bulkTagCreateAndAddFromBar() {
    const select = document.getElementById('bulkTagSelect');
    const newName = document.getElementById('bulkTagNewName');
    const newColor = document.getElementById('bulkTagNewColor');
    const createBtn = document.getElementById('bulkTagNewSave');
    const name = newName ? String(newName.value || '').trim() : '';
    const keys = getSelectedLeadKeysForBulk();
    if (!name) {
      window.alert('Enter a tag name.');
      return;
    }
    if (!keys.length) {
      window.alert('Select at least one lead.');
      return;
    }
    if (createBtn) createBtn.disabled = true;
    try {
      const newTagColor = newColor ? normalizeHexColor(newColor.value || '') : '';
      const tag = await createWorkspaceTag(name, newTagColor);
      if (!tag || !tag.key) throw new Error('Could not create tag.');
      const data = await bulkAssignTags(keys, [tag.key], 'add');
      const updatedCount = Array.isArray(data.leads) ? data.leads.length : (data.updatedKeys || []).length;
      if (!updatedCount) {
        throw new Error('Tag was created but no leads were tagged. Refresh and try Add again.');
      }
      applyTagsToRowsFromBulkResult(data.leads);
      await refreshWorkspaceTagsFromServer();
      rebuildBulkTagSelect();
      initRowTags();
      if (newName) newName.value = '';
      if (select) select.value = tag.key;
      syncBulkTagColorInput();
      const msg = `Created “${tag.name}” and tagged ${updatedCount} lead${updatedCount === 1 ? '' : 's'}`;
      if (typeof window.showProspectToast === 'function') window.showProspectToast(msg);
      else window.alert(msg);
    } catch (err) {
      window.alert(err.message || 'Could not create and apply tag.');
    } finally {
      if (createBtn) createBtn.disabled = false;
    }
  }

  window.__runBulkTagFromBar = runBulkTagFromBar;
  window.__bulkTagCreateAndAddFromBar = bulkTagCreateAndAddFromBar;

  function bindBulkTags() {
    const bar = document.getElementById('bulkActionBar');
    const toggle = document.getElementById('bulkTagsToggle');
    const select = document.getElementById('bulkTagSelect');
    const colorInput = document.getElementById('bulkTagColor');
    const newName = document.getElementById('bulkTagNewName');
    const newColor = document.getElementById('bulkTagNewColor');
    const addBtn = document.getElementById('bulkTagAddBtn');
    const removeBtn = document.getElementById('bulkTagRemoveBtn');
    const createBtn = document.getElementById('bulkTagNewSave');

    if (select && select.dataset.colorSyncBound !== '1') {
      select.dataset.colorSyncBound = '1';
      select.addEventListener('change', () => syncBulkTagColorInput());
    }

    if (colorInput && colorInput.dataset.bound !== '1') {
      colorInput.dataset.bound = '1';
      colorInput.addEventListener('change', async () => {
        const tagKey = String(colorInput.dataset.tagKey || (select && select.value) || '').trim();
        const color = normalizeHexColor(colorInput.value || '');
        const orig = normalizeHexColor(colorInput.dataset.originalColor || '');
        if (!tagKey || !color || color === orig) return;
        colorInput.disabled = true;
        try {
          await saveTagColor(tagKey, color);
          colorInput.dataset.originalColor = color;
          repaintAllRowTagChips();
          if (typeof window.showProspectToast === 'function') {
            window.showProspectToast('Tag color updated');
          }
        } catch (err) {
          colorInput.value = orig;
          window.alert(err.message || 'Could not update tag color.');
        } finally {
          colorInput.disabled = !tagKey;
        }
      });
    }

    if (toggle && toggle.dataset.bound !== '1') {
      toggle.dataset.bound = '1';
      toggle.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const row = document.getElementById('bulkTagsRow');
        const hidden = !row || row.classList.contains('hidden');
        setBulkTagsRowVisible(hidden);
      });
    }

    if (!bar || bar.dataset.bulkTagsActionsBound === '1') return;
    bar.dataset.bulkTagsActionsBound = '1';

    bar.addEventListener('click', async (e) => {
      if (e.target.closest('#bulkTagsCancel')) {
        e.preventDefault();
        e.stopPropagation();
        setBulkTagsRowVisible(false);
        return;
      }
      if (e.target.closest('#bulkTagAddBtn')) {
        e.preventDefault();
        e.stopPropagation();
        await runBulkTagFromBar('add');
        return;
      }
      if (e.target.closest('#bulkTagRemoveBtn')) {
        e.preventDefault();
        e.stopPropagation();
        await runBulkTagFromBar('remove');
        return;
      }
      if (e.target.closest('#bulkTagNewSave')) {
        e.preventDefault();
        e.stopPropagation();
        await bulkTagCreateAndAddFromBar();
      }
    });

    bar.addEventListener('keydown', (e) => {
      if (e.target.id !== 'bulkTagNewName') return;
      if (e.key === 'Enter') {
        e.preventDefault();
        bulkTagCreateAndAddFromBar();
      }
    });
  }

  function initRowTags() {
    const table = document.getElementById('prospectLeadsTable');
    if (!table) return;
    const rows = Array.from(table.querySelectorAll('tbody tr.result-row'));
    const visible = [];
    const hidden = [];
    rows.forEach((row) => {
      if (row.classList.contains('pipeline-row-page-hidden')) hidden.push(row);
      else visible.push(row);
    });
    visible.forEach(renderRowTagChips);
    if (!hidden.length) return;
    const paintRest = () => hidden.forEach(renderRowTagChips);
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(paintRest, { timeout: 2000 });
    } else {
      setTimeout(paintRest, 150);
    }
  }

  function initPipelineTagFilter() {
    const root = document.getElementById('pipelineTagFilter');
    if (!root) return;

    const trigger = root.querySelector('[data-tag-filter-trigger]');
    const menu = root.querySelector('[data-tag-filter-menu]');
    const search = root.querySelector('[data-tag-filter-search]');
    const hidden = root.querySelector('[data-tag-filter-value]');
    const label = root.querySelector('[data-tag-filter-label]');
    const list = root.querySelector('[data-tag-filter-list]');
    const empty = root.querySelector('[data-tag-filter-empty]');
    let tagFilterFetchPromise = null;

    function getFilterOptions() {
      const host = list || menu;
      return host ? host.querySelectorAll('.tag-filter-combobox-option') : [];
    }

    function tagFilterMenuSolidBg() {
      return document.documentElement.classList.contains('dark') ? '#0f172a' : '#ffffff';
    }

    function applyTagFilterMenuSurface() {
      if (!menu) return;
      if (typeof window.applyPortaledPopoverSurface === 'function') {
        window.applyPortaledPopoverSurface(menu);
        return;
      }
      const bg = tagFilterMenuSolidBg();
      menu.style.setProperty('background-color', bg, 'important');
      menu.style.setProperty('background', bg, 'important');
      menu.style.setProperty('backdrop-filter', 'none', 'important');
      menu.style.setProperty('-webkit-backdrop-filter', 'none', 'important');
      menu.style.setProperty('opacity', '1', 'important');
    }

    function positionTagFilterMenu() {
      if (!menu || !trigger) return;
      if (menu.parentElement !== document.body) {
        document.body.appendChild(menu);
      }
      applyTagFilterMenuSurface();
      const rect = trigger.getBoundingClientRect();
      menu.style.position = 'fixed';
      menu.style.left = `${Math.round(rect.left)}px`;
      menu.style.top = `${Math.round(rect.bottom + 4)}px`;
      menu.style.width = `${Math.max(Math.round(rect.width), 192)}px`;
      menu.style.right = 'auto';
      menu.style.bottom = 'auto';
    }

    function getQuickLogFilterItems() {
      const items = (window.__QUICK_LOG && window.__QUICK_LOG.items) || [];
      return items.filter((item) => item && item.disposition);
    }

    function quickLogFilterTagKey(disposition) {
      const code = String(disposition || '').trim().toLowerCase();
      return code ? `ql:${code}` : '';
    }

    function renderTagFilterList() {
      if (!list) return;
      const selected = hidden ? String(hidden.value || '') : '';
      const tags = [...getWorkspaceTags()].sort((a, b) =>
        String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }),
      );
      list.innerHTML = '';
      const anyLi = document.createElement('li');
      anyLi.innerHTML = `<button type="button" class="tag-filter-combobox-option w-full text-left px-3 py-2 text-sm font-semibold text-brand-dark dark:text-white hover:bg-brand-yellow/10 dark:hover:bg-brand-yellow/15${selected ? '' : ' is-selected'}" data-value="">Any tag</button>`;
      list.appendChild(anyLi);
      tags.forEach((tg) => {
        if (!tg || !tg.key) return;
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className =
          'tag-filter-combobox-option w-full text-left px-3 py-2 text-sm font-semibold text-brand-dark dark:text-white hover:bg-brand-yellow/10 dark:hover:bg-brand-yellow/15' +
          (selected === String(tg.key) ? ' is-selected' : '');
        btn.setAttribute('data-value', tg.key);
        btn.textContent = tg.name || 'Tag';
        li.appendChild(btn);
        list.appendChild(li);
      });
      const qlItems = getQuickLogFilterItems();
      if (qlItems.length) {
        const headerLi = document.createElement('li');
        headerLi.className = 'px-3 pt-2 pb-1 pointer-events-none';
        headerLi.setAttribute('data-tag-filter-group-header', 'quick-log');
        headerLi.innerHTML =
          '<span class="text-[9px] font-black uppercase tracking-widest text-brand-muted">Quick log</span>';
        list.appendChild(headerLi);
        qlItems.forEach((item) => {
          const key = quickLogFilterTagKey(item.disposition);
          if (!key) return;
          const li = document.createElement('li');
          li.setAttribute('data-tag-filter-group', 'quick-log');
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className =
            'tag-filter-combobox-option w-full text-left px-3 py-2 text-sm font-semibold text-brand-dark dark:text-white hover:bg-brand-yellow/10 dark:hover:bg-brand-yellow/15' +
            (selected === key ? ' is-selected' : '');
          btn.setAttribute('data-value', key);
          btn.textContent = item.label || item.disposition;
          li.appendChild(btn);
          list.appendChild(li);
        });
      }
    }

    async function refreshTagFilterOptions() {
      if (!tagFilterFetchPromise) {
        tagFilterFetchPromise = fetch('/tags', {
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
        })
          .then((res) => res.json().catch(() => ({})))
          .then((data) => {
            if (data && data.success && Array.isArray(data.tags)) {
              window.WORKSPACE_TAGS = data.tags
                .filter((t) => t && t.key)
                .map((t) => normalizeWorkspaceTag(t))
                .filter(Boolean);
            } else if (!Array.isArray(window.WORKSPACE_TAGS)) {
              window.WORKSPACE_TAGS = [];
            }
          })
          .catch(() => {
            if (!Array.isArray(window.WORKSPACE_TAGS)) window.WORKSPACE_TAGS = [];
          })
          .finally(() => {
            tagFilterFetchPromise = null;
          });
      }
      await tagFilterFetchPromise;
      renderTagFilterList();
    }

    function setOpen(open) {
      if (!menu || !trigger) return;
      menu.classList.toggle('hidden', !open);
      trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) {
        refreshTagFilterOptions()
          .catch(() => {
            renderTagFilterList();
          })
          .finally(() => {
            positionTagFilterMenu();
            if (search) {
              search.value = '';
              filterOptions('');
              search.focus();
            }
          });
      }
    }

    function filterOptions(query) {
      const q = String(query || '').trim().toLowerCase();
      let visible = 0;
      getFilterOptions().forEach((opt) => {
        const li = opt.closest('li');
        if (!li) return;
        const isAny = opt.getAttribute('data-value') === '';
        const text = String(opt.textContent || '').trim().toLowerCase();
        let match;
        if (!q) {
          match = true;
        } else if (isAny) {
          match = 'any tag'.includes(q) || 'quick log'.includes(q);
        } else {
          match = text.includes(q);
        }
        li.classList.toggle('hidden', !match);
        if (match) visible += 1;
      });
      const qlHeader = list ? list.querySelector('[data-tag-filter-group-header="quick-log"]') : null;
      if (qlHeader) {
        const qlVisible = list
          ? [...list.querySelectorAll('[data-tag-filter-group="quick-log"]')].some(
              (li) => !li.classList.contains('hidden'),
            )
          : false;
        qlHeader.classList.toggle('hidden', !qlVisible);
      }
      if (empty) empty.classList.toggle('hidden', visible > 0);
    }

    function selectOption(opt) {
      if (!opt || !hidden || !label) return;
      const val = opt.getAttribute('data-value') || '';
      const lbl = String(opt.textContent || '').trim() || 'Any tag';
      hidden.value = val;
      label.textContent = lbl;
      getFilterOptions().forEach((o) => o.classList.toggle('is-selected', o === opt));
      setOpen(false);
    }

    if (trigger) {
      trigger.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        setOpen(menu && menu.classList.contains('hidden'));
      });
    }

    if (list) {
      list.addEventListener('click', (e) => {
        const opt = e.target.closest('.tag-filter-combobox-option');
        if (!opt) return;
        e.preventDefault();
        selectOption(opt);
      });
    }

    if (search) {
      search.addEventListener('input', () => filterOptions(search.value));
      search.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          setOpen(false);
          if (trigger) trigger.focus();
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          const first = [...getFilterOptions()].find((o) => {
            const li = o.closest('li');
            return li && !li.classList.contains('hidden');
          });
          if (first) selectOption(first);
        }
      });
    }

    window.addEventListener(
      'resize',
      () => {
        if (menu && !menu.classList.contains('hidden')) positionTagFilterMenu();
      },
      { passive: true },
    );

    document.addEventListener(
      'scroll',
      () => {
        if (menu && !menu.classList.contains('hidden')) positionTagFilterMenu();
      },
      true,
    );

    document.addEventListener('click', (e) => {
      if (root.contains(e.target) || (menu && menu.contains(e.target))) return;
      setOpen(false);
    });

    renderTagFilterList();
  }

  function init() {
    rebuildBulkTagSelect();
    syncBulkTagColorInput();
    initRowTags();
    bindBulkTags();
    bindLeadPanelTagsInteraction();
    initPipelineTagFilter();
    refreshWorkspaceTagsFromServer().then(() => {
      rebuildBulkTagSelect();
      syncBulkTagColorInput();
      initRowTags();
      const row = resolveActiveTagsPanelRow();
      if (row) renderLeadTagsPanel(row);
    });
  }

  window.__renderLeadTagsPanel = renderLeadTagsPanel;
  window.__renderLeadRowTags = renderRowTagChips;
  window.__initLeadRowTags = initRowTags;
  window.__rebuildBulkTagSelect = rebuildBulkTagSelect;
  window.__setRowLeadTags = setRowTags;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
