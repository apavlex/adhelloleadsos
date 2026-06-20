(function () {
  const root = document.getElementById('action-plan-tracker');
  if (!root) return;

  const CHECK_HTML =
    '<span class="action-plan-check inline-flex w-5 h-5 items-center justify-center rounded bg-emerald-500 text-white text-xs font-black" aria-hidden="true">✓</span>';
  const DOT_HTML =
    '<span class="action-plan-dot w-1.5 h-1.5 rounded-full bg-brand-border/80 dark:bg-white/15" aria-hidden="true"></span>';
  const TOTAL_FILLED =
    'action-plan-day-total action-plan-day-total--filled inline-flex min-w-[1.25rem] h-5 px-1 items-center justify-center rounded bg-brand-yellow dark:bg-amber-500/90 text-brand-dark text-[10px] font-black tabular-nums';
  const TOTAL_EMPTY =
    'action-plan-day-total text-brand-muted/50 dark:text-slate-600 text-[10px] font-bold tabular-nums';

  function renderCell(btn, checked) {
    if (!btn) return;
    btn.setAttribute('aria-pressed', checked ? 'true' : 'false');
    btn.innerHTML = checked ? CHECK_HTML : DOT_HTML;
  }

  function updateDayTotal(date, total) {
    const el = root.querySelector('.action-plan-day-total[data-date="' + date + '"]');
    if (!el) return;
    const n = parseInt(total, 10) || 0;
    el.setAttribute('data-date', date);
    if (n > 0) {
      el.className = TOTAL_FILLED;
      el.textContent = String(n);
    } else {
      el.className = TOTAL_EMPTY;
      el.textContent = '';
    }
  }

  function updateMonthlyTotal(total) {
    const el = document.getElementById('actionPlanMonthlyTotal');
    if (el) el.textContent = String(parseInt(total, 10) || 0);
  }

  root.addEventListener('click', function (e) {
    const btn = e.target && e.target.closest ? e.target.closest('.action-plan-cell') : null;
    if (!btn || !root.contains(btn)) return;
    e.preventDefault();

    const date = btn.getAttribute('data-date');
    const activityId = btn.getAttribute('data-activity');
    if (!date || !activityId) return;

    btn.disabled = true;
    fetch('/today/action-plan/toggle', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ date: date, activityId: activityId }),
    })
      .then(function (r) {
        return r.json().then(function (j) {
          return { ok: r.ok, j: j };
        });
      })
      .then(function (pack) {
        if (!pack.ok || !pack.j || !pack.j.success) {
          throw new Error((pack.j && pack.j.error) || 'Could not save');
        }
        const data = pack.j;
        renderCell(btn, !!data.checked);
        updateDayTotal(data.date, data.dayTotal);
        updateMonthlyTotal(data.monthlyTotal);
      })
      .catch(function () {
        /* keep UI unchanged on error */
      })
      .finally(function () {
        btn.disabled = false;
      });
  });

  /* --- Catalog editor --- */
  const modal = document.getElementById('actionPlanEditorModal');
  const openBtn = document.getElementById('actionPlanCustomizeBtn');
  const closeBtn = document.getElementById('actionPlanEditorClose');
  const cancelBtn = document.getElementById('actionPlanEditorCancel');
  const saveBtn = document.getElementById('actionPlanEditorSave');
  const resetBtn = document.getElementById('actionPlanEditorReset');
  const addCatBtn = document.getElementById('actionPlanEditorAddCategory');
  const catContainer = document.getElementById('actionPlanEditorCategories');
  const clientGoalInput = document.getElementById('actionPlanEditorClientGoal');
  const catalogJsonEl = document.getElementById('action-plan-catalog-json');

  if (!modal || !openBtn || !catContainer) return;

  let editorState = { categories: [], clientGoal: 5 };

  function parseInitialCatalog() {
    try {
      if (catalogJsonEl && catalogJsonEl.textContent) {
        return JSON.parse(catalogJsonEl.textContent);
      }
    } catch (_) {
      /* fall through */
    }
    return { categories: [], clientGoal: 5 };
  }

  function cloneCatalog(data) {
    const src = data || {};
    return {
      clientGoal: parseInt(src.clientGoal, 10) || 5,
      categories: (src.categories || []).map(function (cat) {
        return {
          id: cat.id || '',
          label: cat.label || '',
          activities: (cat.activities || []).map(function (act) {
            return {
              id: act.id || '',
              label: act.label || '',
              gen: act.gen !== false,
            };
          }),
        };
      }),
    };
  }

  function slugify(label) {
    return String(label || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48);
  }

  function newCategoryId(label) {
    const base = slugify(label) || 'category';
    const used = new Set(editorState.categories.map(function (c) { return c.id; }));
    let id = base;
    let n = 2;
    while (used.has(id)) {
      id = base + '_' + n;
      n += 1;
    }
    return id;
  }

  function newActivityId(label, category) {
    const base = slugify(label) || 'activity';
    const used = new Set();
    editorState.categories.forEach(function (c) {
      (c.activities || []).forEach(function (a) { used.add(a.id); });
    });
    let id = base;
    let n = 2;
    while (used.has(id)) {
      id = base + '_' + n;
      n += 1;
    }
    return id;
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderEditor() {
    if (!catContainer) return;
    catContainer.innerHTML = '';

    editorState.categories.forEach(function (cat, catIdx) {
      const block = document.createElement('div');
      block.className = 'rounded-xl border border-brand-border/60 dark:border-white/10 bg-brand-cream/20 dark:bg-slate-800/40 overflow-hidden';
      block.setAttribute('data-cat-idx', String(catIdx));

      let actsHtml = '';
      (cat.activities || []).forEach(function (act, actIdx) {
        actsHtml +=
          '<div class="flex items-center gap-2 py-2 border-t border-brand-border/30 dark:border-white/5" data-act-idx="' + actIdx + '">' +
          '<input type="text" data-field="act-label" value="' + escapeHtml(act.label) + '" placeholder="Activity name" class="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg border border-brand-border/60 dark:border-white/10 bg-white dark:bg-slate-900 text-xs font-semibold text-brand-dark dark:text-white" />' +
          '<label class="inline-flex items-center gap-1 shrink-0 text-[10px] font-black uppercase tracking-widest text-brand-muted cursor-pointer" title="Show Gen badge">' +
          '<input type="checkbox" data-field="act-gen" class="rounded border-brand-border" ' + (act.gen !== false ? 'checked' : '') + ' /> Gen' +
          '</label>' +
          '<button type="button" data-action="remove-act" class="p-1.5 rounded-lg text-brand-muted hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10" aria-label="Remove activity">' +
          '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>' +
          '</button>' +
          '</div>';
      });

      block.innerHTML =
        '<div class="px-3 py-2.5 flex items-center gap-2 bg-brand-yellow/10 dark:bg-brand-yellow/5">' +
        '<input type="text" data-field="cat-label" value="' + escapeHtml(cat.label) + '" placeholder="Category name" class="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg border border-brand-border/60 dark:border-white/10 bg-white dark:bg-slate-900 text-xs font-black uppercase tracking-widest text-brand-dark dark:text-white" />' +
        '<button type="button" data-action="remove-cat" class="p-1.5 rounded-lg text-brand-muted hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10" aria-label="Remove category">' +
        '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>' +
        '</button>' +
        '</div>' +
        '<div class="px-3 pb-2">' + actsHtml + '</div>' +
        '<div class="px-3 pb-3">' +
        '<button type="button" data-action="add-act" class="text-[10px] font-black uppercase tracking-widest text-brand-muted hover:text-brand-dark dark:hover:text-white transition-colors">+ Add activity</button>' +
        '</div>';

      catContainer.appendChild(block);
    });
  }

  function syncEditorFromDom() {
    const blocks = catContainer.querySelectorAll('[data-cat-idx]');
    blocks.forEach(function (block) {
      const catIdx = parseInt(block.getAttribute('data-cat-idx'), 10);
      const cat = editorState.categories[catIdx];
      if (!cat) return;
      const catLabelEl = block.querySelector('[data-field="cat-label"]');
      if (catLabelEl) cat.label = catLabelEl.value.trim();

      const actRows = block.querySelectorAll('[data-act-idx]');
      actRows.forEach(function (row) {
        const actIdx = parseInt(row.getAttribute('data-act-idx'), 10);
        const act = cat.activities[actIdx];
        if (!act) return;
        const labelEl = row.querySelector('[data-field="act-label"]');
        const genEl = row.querySelector('[data-field="act-gen"]');
        if (labelEl) act.label = labelEl.value.trim();
        if (genEl) act.gen = genEl.checked;
      });
    });
  }

  function openModal() {
    editorState = cloneCatalog(parseInitialCatalog());
    if (clientGoalInput) clientGoalInput.value = String(editorState.clientGoal);
    renderEditor();
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
  }

  function closeModal() {
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
  }

  function reloadPage() {
    const year = root.getAttribute('data-year') || '';
    const month = root.getAttribute('data-month') || '';
    const qs = year && month ? '?actionPlanYear=' + encodeURIComponent(year) + '&actionPlanMonth=' + encodeURIComponent(month) : '';
    window.location.href = '/today' + qs + '#action-plan-tracker';
  }

  function collectPayload() {
    syncEditorFromDom();
    const clientGoal = parseInt(clientGoalInput && clientGoalInput.value, 10) || 5;
    return {
      clientGoal: clientGoal,
      categories: editorState.categories
        .map(function (cat) {
          return {
            id: cat.id,
            label: cat.label,
            activities: (cat.activities || [])
              .filter(function (a) { return a.label; })
              .map(function (a) {
                return { id: a.id, label: a.label, gen: a.gen !== false };
              }),
          };
        })
        .filter(function (cat) { return cat.label; }),
    };
  }

  openBtn.addEventListener('click', openModal);
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', function (e) {
    if (e.target === modal) closeModal();
  });

  if (addCatBtn) {
    addCatBtn.addEventListener('click', function () {
      syncEditorFromDom();
      const label = 'New Category';
      editorState.categories.push({
        id: newCategoryId(label),
        label: label,
        activities: [],
      });
      renderEditor();
    });
  }

  catContainer.addEventListener('click', function (e) {
    const btn = e.target && e.target.closest ? e.target.closest('[data-action]') : null;
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    const block = btn.closest('[data-cat-idx]');
    if (!block) return;
    const catIdx = parseInt(block.getAttribute('data-cat-idx'), 10);
    const cat = editorState.categories[catIdx];
    if (!cat) return;

    syncEditorFromDom();

    if (action === 'remove-cat') {
      if (editorState.categories.length <= 1) {
        window.alert('Keep at least one category.');
        return;
      }
      if (!window.confirm('Remove this category and all its activities?')) return;
      editorState.categories.splice(catIdx, 1);
      renderEditor();
      return;
    }

    if (action === 'add-act') {
      const label = 'New Activity';
      cat.activities.push({
        id: newActivityId(label, cat),
        label: label,
        gen: true,
      });
      renderEditor();
      return;
    }

    if (action === 'remove-act') {
      const row = btn.closest('[data-act-idx]');
      if (!row) return;
      const actIdx = parseInt(row.getAttribute('data-act-idx'), 10);
      cat.activities.splice(actIdx, 1);
      renderEditor();
    }
  });

  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      if (!window.confirm('Reset all categories and activities to the default plan? Your completion history is kept.')) return;
      resetBtn.disabled = true;
      fetch('/today/action-plan/catalog', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ reset: true }),
      })
        .then(function (r) {
          return r.json().then(function (j) { return { ok: r.ok, j: j }; });
        })
        .then(function (pack) {
          if (!pack.ok || !pack.j || !pack.j.success) {
            throw new Error((pack.j && pack.j.error) || 'Could not reset');
          }
          reloadPage();
        })
        .catch(function (err) {
          window.alert(err && err.message ? err.message : 'Could not reset plan.');
        })
        .finally(function () {
          resetBtn.disabled = false;
        });
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', function () {
      const payload = collectPayload();
      if (!payload.categories.length) {
        window.alert('Add at least one category with a name.');
        return;
      }
      const hasActivity = payload.categories.some(function (c) { return c.activities.length > 0; });
      if (!hasActivity) {
        window.alert('Add at least one activity.');
        return;
      }

      saveBtn.disabled = true;
      fetch('/today/action-plan/catalog', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      })
        .then(function (r) {
          return r.json().then(function (j) { return { ok: r.ok, j: j }; });
        })
        .then(function (pack) {
          if (!pack.ok || !pack.j || !pack.j.success) {
            throw new Error((pack.j && pack.j.error) || 'Could not save');
          }
          reloadPage();
        })
        .catch(function (err) {
          window.alert(err && err.message ? err.message : 'Could not save plan.');
        })
        .finally(function () {
          saveBtn.disabled = false;
        });
    });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
      closeModal();
    }
  });
})();
