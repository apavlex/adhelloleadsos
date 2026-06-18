(function () {
  const root = document.getElementById('action-plan-tracker');
  if (!root) return;

  function findCell(date, activityId) {
    return root.querySelector(
      '.action-plan-cell[data-date="' + date + '"][data-activity="' + activityId + '"]',
    );
  }

  function renderCell(btn, checked) {
    if (!btn) return;
    btn.setAttribute('aria-pressed', checked ? 'true' : 'false');
    if (checked) {
      btn.innerHTML =
        '<span class="inline-flex w-5 h-5 items-center justify-center rounded bg-emerald-500 text-white text-xs font-black" aria-hidden="true">✓</span>';
    } else {
      btn.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-white/15" aria-hidden="true"></span>';
    }
  }

  function updateDayTotal(date, total) {
    const el = root.querySelector('.action-plan-day-total[data-date="' + date + '"]');
    if (!el) return;
    const n = parseInt(total, 10) || 0;
    if (n > 0) {
      el.className =
        'inline-flex min-w-[1.25rem] h-5 px-1 items-center justify-center rounded bg-amber-500/90 text-slate-900 text-[10px] font-black tabular-nums action-plan-day-total';
      el.setAttribute('data-date', date);
      el.textContent = String(n);
    } else {
      el.className = 'action-plan-day-total text-slate-600 text-[10px] font-bold tabular-nums';
      el.setAttribute('data-date', date);
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
})();
