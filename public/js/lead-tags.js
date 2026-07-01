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
    return (t && t.color) || '#94a3b8';
  }

  function tagIsActive(tag) {
    return !!(tag && tag.isActive !== false);
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

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

  async function createWorkspaceTag(name) {
    const data = await apiJson('/tags', {
      method: 'POST',
      body: JSON.stringify({ name: String(name || '').trim() }),
    });
    if (data.tag && !getWorkspaceTags().some((t) => t && t.key === data.tag.key)) {
      window.WORKSPACE_TAGS = [...getWorkspaceTags(), data.tag];
    }
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
    if (!row || !row.dataset) {
      host.innerHTML =
        '<p class="text-[11px] text-brand-muted dark:text-slate-400 italic">Select a lead to manage tags.</p>';
      return;
    }

    const leadKey = row.dataset.leadKey || '';
    const active = new Set(parseRowTags(row));
    const tags = getWorkspaceTags();
    const inputId = `leadPanelNewTagName-${hostId}`;
    const createBtnId = `leadPanelCreateTagBtn-${hostId}`;

    let html = '';
    if (!compact) {
      html += `<div class="flex flex-wrap gap-2 items-center mb-3 pb-3 border-b border-brand-border/20 dark:border-white/10">
      <input type="text" id="${escapeHtml(inputId)}" placeholder="New tag name…" class="min-w-[6rem] flex-1 rounded-lg border border-brand-border/50 dark:border-white/15 bg-white/80 dark:bg-slate-800/80 px-2.5 py-1.5 text-[11px] font-semibold text-brand-dark dark:text-white" />
      <button type="button" id="${escapeHtml(createBtnId)}" class="btn-pill bg-brand-yellow text-brand-dark px-3 py-1.5 text-[9px] font-black uppercase tracking-widest shrink-0">Create</button>
      <a href="/tags/manage" class="text-[10px] font-bold uppercase tracking-wide text-brand-yellow hover:underline shrink-0 ml-auto">Manage all tags →</a>
    </div>`;
    }

    const applied = tags.filter((t) => t && t.key && active.has(t.key));
    const available = tags.filter((t) => t && t.key && !active.has(t.key));
    const availableActive = available.filter(tagIsActive);
    const availableInactive = available.filter((t) => !tagIsActive(t));

    html += `<div class="flex flex-wrap gap-1.5 ${compact ? '' : 'mb-2'}" data-tag-pills-host="${escapeHtml(hostId)}">`;
    if (!tags.length) {
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

    if (!compact && (availableActive.length || availableInactive.length)) {
      html += `<p class="text-[9px] font-black uppercase tracking-widest text-brand-muted dark:text-slate-500 mb-1.5 mt-1">Add tag</p>`;
      if (availableActive.length) {
        html += `<div class="flex flex-wrap gap-1.5" data-tag-add-host="${escapeHtml(hostId)}">`;
        availableActive.forEach((t) => {
          const color = t.color || '#94a3b8';
          html += `<button type="button" class="lead-panel-tag-toggle px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wide border transition-all opacity-75 hover:opacity-100" data-tag-key="${escapeHtml(t.key)}" data-tags-host="${escapeHtml(hostId)}" style="background:${color}18;border-color:${color}66;color:${color}" aria-pressed="false">+ ${escapeHtml(t.name)}</button>`;
        });
        html += '</div>';
      }
      if (availableInactive.length) {
        const inactiveSelectId = `leadPanelInactiveTagSelect-${hostId}`;
        const inactiveAddId = `leadPanelInactiveTagAdd-${hostId}`;
        html += `<div class="flex flex-wrap items-center gap-2 ${availableActive.length ? 'mt-2' : ''}" data-tag-inactive-host="${escapeHtml(hostId)}">`;
        html += `<select id="${escapeHtml(inactiveSelectId)}" class="lead-panel-tag-inactive-select min-w-[8rem] flex-1 rounded-lg border border-brand-border/50 dark:border-white/15 bg-white/80 dark:bg-slate-800/80 px-2.5 py-1.5 text-[11px] font-semibold text-brand-dark dark:text-white" aria-label="More tags">`;
        html += '<option value="">More tags…</option>';
        availableInactive
          .slice()
          .sort((a, b) =>
            String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }),
          )
          .forEach((t) => {
            html += `<option value="${escapeHtml(t.key)}">${escapeHtml(t.name)}</option>`;
          });
        html += '</select>';
        html += `<button type="button" id="${escapeHtml(inactiveAddId)}" class="lead-panel-tag-inactive-add btn-pill border border-brand-border/50 dark:border-white/15 bg-white/80 dark:bg-slate-800/80 px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-brand-dark dark:text-white shrink-0">Add</button>`;
        html += '</div>';
      }
    } else if (compact) {
      html += `<div class="flex flex-wrap gap-1.5 mt-1" data-tag-add-host="${escapeHtml(hostId)}">`;
      availableActive.forEach((t) => {
        const color = t.color || '#94a3b8';
        html += `<button type="button" class="lead-panel-tag-toggle px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wide border transition-all opacity-75 hover:opacity-100" data-tag-key="${escapeHtml(t.key)}" data-tags-host="${escapeHtml(hostId)}" style="background:${color}18;border-color:${color}66;color:${color}" aria-pressed="false">+ ${escapeHtml(t.name)}</button>`;
      });
      html += '</div>';
    }

    host.innerHTML = html;

    async function mutateTags(mutator) {
      const set = new Set(parseRowTags(row));
      mutator(set);
      const lead = await saveLeadTags(leadKey, [...set]);
      if (lead && Array.isArray(lead.tags)) setRowTags(row, lead.tags);
      renderLeadTagsPanel(row);
      try {
        const ghl = await pushLeadTagsToGhl(leadKey);
        tagSyncToast(
          ghl.ok ? 'Tags updated · synced to GHL' : 'Tags updated · tap Sync GHL to push tags',
          ghl.ok ? 'success' : 'info',
        );
      } catch (err) {
        tagSyncToast(err.message || 'Tags saved but GHL sync failed', 'error');
      }
    }

    host.querySelectorAll('.lead-panel-tag-toggle').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const tk = btn.getAttribute('data-tag-key');
        if (!tk || !leadKey) return;
        btn.disabled = true;
        try {
          await mutateTags((set) => set.add(tk));
        } catch (err) {
          window.alert(err.message || 'Could not update tags.');
          btn.disabled = false;
        }
      });
    });

    const inactiveSelect = host.querySelector('.lead-panel-tag-inactive-select');
    const inactiveAddBtn = host.querySelector('.lead-panel-tag-inactive-add');
    async function addInactiveSelectedTag() {
      if (!inactiveSelect || !leadKey) return;
      const tk = String(inactiveSelect.value || '').trim();
      if (!tk) return;
      if (inactiveAddBtn) inactiveAddBtn.disabled = true;
      if (inactiveSelect) inactiveSelect.disabled = true;
      try {
        await mutateTags((set) => set.add(tk));
      } catch (err) {
        window.alert(err.message || 'Could not update tags.');
        if (inactiveAddBtn) inactiveAddBtn.disabled = false;
        if (inactiveSelect) inactiveSelect.disabled = false;
      }
    }
    if (inactiveAddBtn) {
      inactiveAddBtn.addEventListener('click', addInactiveSelectedTag);
    }
    if (inactiveSelect) {
      inactiveSelect.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          addInactiveSelectedTag();
        }
      });
    }

    host.querySelectorAll('.lead-panel-tag-remove').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const tk = btn.getAttribute('data-tag-key');
        if (!tk || !leadKey) return;
        btn.disabled = true;
        try {
          await mutateTags((set) => set.delete(tk));
        } catch (err) {
          window.alert(err.message || 'Could not remove tag.');
          btn.disabled = false;
        }
      });
    });

    if (!compact) {
      const createBtn = document.getElementById(createBtnId);
      const nameInput = document.getElementById(inputId);
      if (createBtn && nameInput) {
        const doCreate = async () => {
          const name = String(nameInput.value || '').trim();
          if (!name) return;
          createBtn.disabled = true;
          try {
            const tag = await createWorkspaceTag(name);
            if (tag && tag.key && leadKey) {
              await mutateTags((set) => set.add(tag.key));
            } else {
              renderLeadTagsPanel(row);
            }
            nameInput.value = '';
          } catch (err) {
            window.alert(err.message || 'Could not create tag.');
          } finally {
            createBtn.disabled = false;
          }
        };
        createBtn.addEventListener('click', doCreate);
        nameInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            doCreate();
          }
        });
      }
    }
  }

  function renderLeadTagsPanel(row) {
    renderLeadTagsEditor(document.getElementById('leadPanelCompanyTagsHost'), row, { primary: true });
  }

  function bindBulkTags() {
    const bar = document.getElementById('bulkActionBar');
    const toggle = document.getElementById('bulkTagsToggle');
    const select = document.getElementById('bulkTagSelect');
    const newName = document.getElementById('bulkTagNewName');
    const addBtn = document.getElementById('bulkTagAddBtn');
    const removeBtn = document.getElementById('bulkTagRemoveBtn');
    const createBtn = document.getElementById('bulkTagNewSave');

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

    async function runBulkTag(mode) {
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
        applyTagsToRowsFromBulkResult(data.leads);
        const msg =
          mode === 'remove'
            ? `Removed tag from ${(data.updatedKeys || []).length} lead(s) · tap Sync GHL to push`
            : `Tagged ${(data.updatedKeys || []).length} lead(s) · tap Sync GHL to push tags`;
        if (typeof window.showProspectToast === 'function') window.showProspectToast(msg);
        else window.alert(msg);
      } catch (err) {
        window.alert(err.message || 'Bulk tag update failed.');
      } finally {
        if (addBtn) addBtn.disabled = false;
        if (removeBtn) removeBtn.disabled = false;
      }
    }

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
        await runBulkTag('add');
        return;
      }
      if (e.target.closest('#bulkTagRemoveBtn')) {
        e.preventDefault();
        e.stopPropagation();
        await runBulkTag('remove');
        return;
      }
      if (e.target.closest('#bulkTagNewSave')) {
        e.preventDefault();
        e.stopPropagation();
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
          const tag = await createWorkspaceTag(name);
          if (!tag || !tag.key) throw new Error('Could not create tag.');
          const data = await bulkAssignTags(keys, [tag.key], 'add');
          applyTagsToRowsFromBulkResult(data.leads);
          if (newName) newName.value = '';
          if (select) select.value = tag.key;
          const msg = `Created “${tag.name}” and tagged ${(data.updatedKeys || []).length} lead(s) · tap Sync GHL to push`;
          if (typeof window.showProspectToast === 'function') window.showProspectToast(msg);
          else window.alert(msg);
        } catch (err) {
          window.alert(err.message || 'Could not create and apply tag.');
        } finally {
          if (createBtn) createBtn.disabled = false;
        }
      }
    });

    bar.addEventListener('keydown', (e) => {
      if (e.target.id !== 'bulkTagNewName') return;
      if (e.key === 'Enter') {
        e.preventDefault();
        const save = document.getElementById('bulkTagNewSave');
        if (save && !save.disabled) save.click();
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
                .map((t) => ({
                  key: String(t.key),
                  name: String(t.name || '').trim() || 'Tag',
                  color: t.color || '#94a3b8',
                  isActive: t.isActive !== false,
                }));
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
    initRowTags();
    bindBulkTags();
    initPipelineTagFilter();
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
