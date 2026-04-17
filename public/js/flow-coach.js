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

  function renderHotLeads(fc) {
    const wrap = document.getElementById('flowCoachHotWrap');
    const list = document.getElementById('flowCoachHotList');
    if (!wrap || !list) return;

    if (fc.variant !== 'leads' || !Array.isArray(fc.hotLeads) || fc.hotLeads.length === 0) {
      wrap.classList.add('hidden');
      list.innerHTML = '';
      return;
    }

    wrap.classList.remove('hidden');
    list.innerHTML = fc.hotLeads
      .map(function (h) {
        const tier = h.tier || 'low';
        const tierClass =
          tier === 'high'
            ? 'border-rose-500/30 bg-rose-500/5'
            : tier === 'medium'
              ? 'border-amber-500/30 bg-amber-500/5'
              : 'border-brand-border/50 bg-white/50 dark:bg-slate-800/30';
        const scoreClass =
          tier === 'high'
            ? 'bg-rose-500/20 text-rose-700 dark:text-rose-300'
            : tier === 'medium'
              ? 'bg-amber-500/20 text-amber-800 dark:text-amber-200'
              : 'bg-slate-200/80 dark:bg-slate-700 text-brand-muted';
        const reasons = (h.reasons || []).slice(0, 3);
        const reasonHtml = reasons
          .map(function (r) {
            return (
              '<li class="flex gap-1.5"><span class="text-brand-yellow shrink-0">•</span><span>' +
              escapeHtml(r) +
              '</span></li>'
            );
          })
          .join('');
        return (
          '<li><a href="#lead-row-' +
          escapeAttr(h.anchor) +
          '" class="block p-4 rounded-2xl border ' +
          tierClass +
          ' hover:border-brand-yellow/50 transition-all group">' +
          '<div class="flex items-start justify-between gap-2 mb-2">' +
          '<span class="text-sm font-black text-brand-dark dark:text-white group-hover:text-brand-yellow transition-colors line-clamp-2">' +
          escapeHtml(h.title) +
          '</span>' +
          '<span class="shrink-0 text-xs font-black px-2 py-0.5 rounded-lg ' +
          scoreClass +
          '">' +
          escapeHtml(String(h.score)) +
          '/10</span></div>' +
          '<ul class="text-[11px] text-brand-muted space-y-1 leading-snug">' +
          reasonHtml +
          '</ul></a></li>'
        );
      })
      .join('');
  }

  function renderCoach(fc) {
    if (!fc) return;
    const h = document.getElementById('flowCoachHeadline');
    const g = document.getElementById('flowCoachGreeting');
    if (h) h.textContent = fc.headline || '';
    if (g) g.textContent = fc.greeting || '';
    card.dataset.coachSource = fc.source || '';
    card.dataset.variant = fc.variant === 'leads' ? 'leads' : 'default';
    const endpoint = fc.variant === 'leads' ? '/coach/leads' : '/coach';
    card.dataset.coachEndpoint = endpoint;

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
      if (fc.variant === 'leads') {
        srcLabel.textContent = 'Gap-based rank';
      } else {
        srcLabel.textContent =
          fc.source === 'kie'
            ? 'Live coach · KIE'
            : fc.source === 'openai'
              ? 'Live coach'
              : 'Smart flow';
      }
    }

    renderHotLeads(fc);
  }

  document.getElementById('flowCoachRefresh')?.addEventListener('click', async function () {
    const btn = document.getElementById('flowCoachRefresh');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '…';
    }
    const url = card.dataset.coachEndpoint || '/coach';
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
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
