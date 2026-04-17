(function () {
  const card = document.getElementById('flowCoachCard');
  if (!card) return;

  const hiddenKey = 'flowCoachHiddenSession';
  try {
    if (sessionStorage.getItem(hiddenKey) === '1') {
      card.classList.add('hidden');
      return;
    }
  } catch (e) {
    /* ignore */
  }

  document.getElementById('flowCoachDismiss')?.addEventListener('click', function () {
    card.classList.add('hidden');
    try {
      sessionStorage.setItem(hiddenKey, '1');
    } catch (e) {
      /* ignore */
    }
  });

  function renderCoach(fc) {
    if (!fc) return;
    const h = document.getElementById('flowCoachHeadline');
    const g = document.getElementById('flowCoachGreeting');
    if (h) h.textContent = fc.headline || '';
    if (g) g.textContent = fc.greeting || '';
    card.dataset.coachSource = fc.source || '';

    const badge = card.querySelector('[data-coach-source]');
    if (badge) badge.setAttribute('data-coach-source', fc.source || '');

    const actions = document.getElementById('flowCoachActions');
    if (actions && Array.isArray(fc.nextActions)) {
      actions.innerHTML = fc.nextActions
        .map(function (a) {
          const dot =
            a.priority === 'high'
              ? 'bg-brand-yellow animate-pulse'
              : 'bg-brand-border dark:bg-white/20';
          return (
            '<li><a href="' +
            escapeAttr(a.href) +
            '" class="flex items-center gap-3 p-3 rounded-2xl border border-brand-border/60 dark:border-white/10 bg-white/80 dark:bg-slate-800/50 hover:border-brand-yellow/50 hover:bg-brand-yellow/5 transition-all group">' +
            '<span class="w-2 h-2 rounded-full shrink-0 ' +
            dot +
            '"></span>' +
            '<span class="text-sm font-bold text-brand-dark dark:text-white group-hover:text-brand-yellow transition-colors">' +
            escapeHtml(a.label) +
            '</span>' +
            '<svg class="w-4 h-4 ml-auto text-brand-muted group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>' +
            '</a></li>'
          );
        })
        .join('');
    }

    const ai = document.getElementById('flowCoachAi');
    if (ai && Array.isArray(fc.aiTimeSavers)) {
      ai.innerHTML = fc.aiTimeSavers
        .map(function (x) {
          return (
            '<li class="flex gap-3 p-3 rounded-2xl bg-violet-500/5 dark:bg-violet-500/10 border border-violet-500/10">' +
            '<span class="text-[10px] font-black text-violet-600 dark:text-violet-300 shrink-0 mt-0.5">✦</span>' +
            '<div><span class="text-sm font-bold text-brand-dark dark:text-white">' +
            escapeHtml(x.label) +
            '</span>' +
            '<p class="text-xs text-brand-muted mt-0.5 leading-snug">' +
            escapeHtml(x.hint) +
            '</p></div></li>'
          );
        })
        .join('');
    }

    const srcLabel = card.querySelector('.flow-coach-source-pill');
    if (srcLabel) {
      srcLabel.textContent = fc.source === 'openai' ? 'Live coach' : 'Smart flow';
    }
  }

  function escapeHtml(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function escapeAttr(s) {
    if (!s) return '';
    return String(s).replace(/"/g, '&quot;');
  }

  document.getElementById('flowCoachRefresh')?.addEventListener('click', async function () {
    const btn = document.getElementById('flowCoachRefresh');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '…';
    }
    try {
      const res = await fetch('/coach', { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('Coach fetch failed');
      const data = await res.json();
      renderCoach(data);
      card.classList.remove('hidden');
    } catch (e) {
      console.warn(e);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Refresh';
      }
    }
  });
})();
