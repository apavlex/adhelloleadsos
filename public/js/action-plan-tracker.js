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
})();
