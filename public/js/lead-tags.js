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

  function renderLeadTagsPanel(row) {
    const host = document.getElementById('leadPanelTagsHost');
    if (!host) return;
    if (!row || !row.dataset) {
      host.innerHTML =
        '<p class="text-[11px] text-brand-muted dark:text-slate-400 italic">Select a lead to manage tags.</p>';
      return;
    }

    const leadKey = row.dataset.leadKey || '';
    const active = new Set(parseRowTags(row));
    const tags = getWorkspaceTags();

    let html = '<div class="flex flex-wrap gap-1.5 mb-3" id="leadPanelTagPills">';
    if (!tags.length) {
      html +=
        '<p class="text-[10px] text-brand-muted dark:text-slate-400 w-full">No workspace tags yet — create one below.</p>';
    } else {
      tags.forEach((t) => {
        if (!t || !t.key) return;
        const on = active.has(t.key);
        const color = t.color || '#94a3b8';
        html += `<button type="button" class="lead-panel-tag-toggle px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wide border transition-all ${
          on ? 'ring-2 ring-offset-1 ring-brand-yellow/50' : 'opacity-75 hover:opacity-100'
        }" data-tag-key="${escapeHtml(t.key)}" style="background:${color}${on ? '33' : '18'};border-color:${color}66;color:${color}" aria-pressed="${on ? 'true' : 'false'}">${escapeHtml(t.name)}</button>`;
      });
    }
    html += '</div>';
    html += `<div class="flex flex-wrap gap-2 items-center border-t border-brand-border/20 dark:border-white/10 pt-3">
      <input type="text" id="leadPanelNewTagName" placeholder="New tag name…" class="min-w-[6rem] flex-1 rounded-lg border border-brand-border/50 dark:border-white/15 bg-white/80 dark:bg-slate-800/80 px-2.5 py-1.5 text-[11px] font-semibold text-brand-dark dark:text-white" />
      <button type="button" id="leadPanelCreateTagBtn" class="btn-pill bg-brand-yellow text-brand-dark px-3 py-1.5 text-[9px] font-black uppercase tracking-widest">Create</button>
    </div>`;
    host.innerHTML = html;

    host.querySelectorAll('.lead-panel-tag-toggle').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const tk = btn.getAttribute('data-tag-key');
        if (!tk || !leadKey) return;
        const set = new Set(parseRowTags(row));
        if (set.has(tk)) set.delete(tk);
        else set.add(tk);
        btn.disabled = true;
        try {
          const lead = await saveLeadTags(leadKey, [...set]);
          if (lead && Array.isArray(lead.tags)) setRowTags(row, lead.tags);
          renderLeadTagsPanel(row);
          if (typeof window.showProspectToast === 'function') {
            window.showProspectToast('Tags updated');
          }
        } catch (err) {
          window.alert(err.message || 'Could not update tags.');
          btn.disabled = false;
        }
      });
    });

    const createBtn = document.getElementById('leadPanelCreateTagBtn');
    const nameInput = document.getElementById('leadPanelNewTagName');
    if (createBtn && nameInput) {
      const doCreate = async () => {
        const name = String(nameInput.value || '').trim();
        if (!name) return;
        createBtn.disabled = true;
        try {
          const tag = await createWorkspaceTag(name);
          const set = new Set(parseRowTags(row));
          if (tag && tag.key) set.add(tag.key);
          if (leadKey) {
            const lead = await saveLeadTags(leadKey, [...set]);
            if (lead && Array.isArray(lead.tags)) setRowTags(row, lead.tags);
          }
          renderLeadTagsPanel(row);
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
            ? `Removed tag from ${(data.updatedKeys || []).length} lead(s)`
            : `Tagged ${(data.updatedKeys || []).length} lead(s)`;
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
          const msg = `Created “${tag.name}” and tagged ${(data.updatedKeys || []).length} lead(s)`;
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
    document.querySelectorAll('#prospectLeadsTable tbody tr.result-row').forEach(renderRowTagChips);
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
      const bg = tagFilterMenuSolidBg();
      menu.style.backgroundColor = bg;
      menu.style.background = bg;
      menu.style.backdropFilter = 'none';
      menu.style.webkitBackdropFilter = 'none';
      menu.style.opacity = '1';
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
          match = 'any tag'.includes(q);
        } else {
          match = text.includes(q);
        }
        li.classList.toggle('hidden', !match);
        if (match) visible += 1;
      });
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
