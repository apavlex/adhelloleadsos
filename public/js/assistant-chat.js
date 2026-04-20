/**
 * Floating workspace assistant: POST /api/assistant/chat (session + workspace scoped).
 */
(function () {
  var _assistantAvatarId = 0;

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Minimal markdown for assistant only: **bold**, `code`, newlines.
   * Runs after HTML escape — no raw HTML from the model.
   */
  /** Stylized assistant avatar: bob cut, platinum wavy hair (inline SVG). */
  function assistantAvatarNode() {
    var n = ++_assistantAvatarId;
    var gh = 'asstAv' + n + 'h';
    var gs = 'asstAv' + n + 's';
    const span = document.createElement('span');
    span.className =
      'shrink-0 w-9 h-9 sm:w-10 sm:h-10 rounded-full overflow-hidden border border-brand-border/40 dark:border-white/15 bg-gradient-to-b from-[#f5f0e8] to-[#e8e2d8] shadow-sm ring-2 ring-white/60 dark:ring-slate-700/80';
    span.setAttribute('aria-hidden', 'true');
    span.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none" class="w-full h-full" role="img" aria-label="Assistant">' +
      '<defs>' +
      '<linearGradient id="' +
      gh +
      '" x1="8" y1="4" x2="40" y2="28" gradientUnits="userSpaceOnUse">' +
      '<stop stop-color="#FAF8F4"/><stop offset="0.45" stop-color="#E8E2D8"/><stop offset="1" stop-color="#C9C2B8"/>' +
      '</linearGradient>' +
      '<linearGradient id="' +
      gs +
      '" x1="24" y1="8" x2="24" y2="32" gradientUnits="userSpaceOnUse">' +
      '<stop stop-color="#DDD6CC" stop-opacity="0"/><stop offset="1" stop-color="#B8B0A6" stop-opacity="0.45"/>' +
      '</linearGradient>' +
      '</defs>' +
      '<path fill="url(#' +
      gh +
      ')" d="M8 22c0-10 6.5-18 16-18s16 8 16 18c0 3-.5 6-1.5 8.5 2 1.2 3.5 3.2 4.5 5.8-1.2.4-2.5.6-3.8.7-.8 2-2.2 3.8-4 5.2-.6-1.4-1.6-2.6-2.8-3.6-.4 2.6-1.4 5-2.8 7.2-1.4-.8-2.8-1.4-4.4-1.8-.6 1.8-1.6 3.4-2.8 4.8C26.4 44 22.8 45 19 45c-4.6 0-8.8-1.8-11.8-4.8 1.4-1.6 2.4-3.5 3-5.6-1.4-.2-2.8-.6-4-1.2 1-2 2.2-3.8 3.6-5.4-1.8-1-3.4-2.4-4.6-4.2C4.8 30.6 4 28.4 4 26c0-1.4.2-2.8.6-4 1.8.8 3.6 1.2 5.4 1.4-.4-1.4-.6-2.8-.6-4.4z"/>' +
      '<path fill="url(#' +
      gs +
      ')" d="M8 22c0-10 6.5-18 16-18s16 8 16 18v2c-2 8-8 14-16 14S10 32 8 24v-2z" opacity="0.9"/>' +
      '<path fill="none" stroke="#C4BCB2" stroke-width="0.75" stroke-linecap="round" d="M12 34q2.5 2 5 0t5 0 5 0 5 0" opacity="0.7"/>' +
      '<ellipse cx="24" cy="26" rx="9" ry="10" fill="#F0C8B8"/>' +
      '<ellipse cx="24" cy="27" rx="7.5" ry="8" fill="#F5D4C8" opacity="0.85"/>' +
      '<ellipse cx="20" cy="25" rx="1.1" ry="1.35" fill="#3d3d3d"/>' +
      '<ellipse cx="28" cy="25" rx="1.1" ry="1.35" fill="#3d3d3d"/>' +
      '<path stroke="#3d3d3d" stroke-width="0.9" stroke-linecap="round" d="M19 23.5q1-.6 2 0M27 23.5q1-.6 2 0" opacity="0.5"/>' +
      '<path stroke="#C97B7B" stroke-width="0.85" stroke-linecap="round" d="M21 30q3 2.5 6 0" fill="none"/>' +
      '</svg>';
    return span;
  }

  function formatAssistantMarkdown(raw) {
    let t = escapeHtml(raw);
    t = t.replace(/`([^`]+)`/g, function (_, code) {
      return '<code class="text-xs font-mono bg-brand-dark/5 dark:bg-white/10 px-1.5 py-0.5 rounded-md">' + code + '</code>';
    });
    t = t.replace(/\*\*([\s\S]+?)\*\*/g, function (_, inner) {
      return '<strong class="font-semibold text-brand-dark dark:text-white">' + inner + '</strong>';
    });
    t = t.replace(/\n/g, '<br>');
    return t;
  }

  function bubble(role, text) {
    const isUser = role === 'user';
    const wrap = document.createElement('div');
    wrap.className = isUser
      ? 'flex justify-end items-end gap-2'
      : 'flex justify-start items-end gap-2';
    const inner = document.createElement('div');
    inner.className = isUser
      ? 'max-w-[90%] rounded-2xl rounded-br-md px-3 py-2 bg-brand-dark dark:bg-brand-yellow text-white dark:text-brand-dark text-sm font-medium'
      : 'max-w-[min(95%,calc(100%-3rem))] rounded-2xl rounded-bl-md px-3 py-2 bg-brand-cream/80 dark:bg-slate-800 text-brand-dark dark:text-slate-100 text-sm leading-relaxed border border-brand-border/40 dark:border-white/10 [&_strong]:font-semibold';
    if (isUser) {
      inner.innerHTML = escapeHtml(text).replace(/\n/g, '<br>');
    } else {
      inner.innerHTML = formatAssistantMarkdown(text);
      wrap.appendChild(assistantAvatarNode());
    }
    wrap.appendChild(inner);
    return wrap;
  }

  /** Visible loading state: spinner + subtitle so it never feels “stuck empty”. */
  function thinkingBubble() {
    const wrap = document.createElement('div');
    wrap.className = 'flex justify-start items-end gap-2';
    wrap.setAttribute('data-assistant-loading', '1');
    wrap.setAttribute('aria-live', 'polite');
    wrap.setAttribute('aria-busy', 'true');

    wrap.appendChild(assistantAvatarNode());

    const inner = document.createElement('div');
    inner.className =
      'max-w-[95%] rounded-2xl rounded-bl-md px-4 py-3 bg-brand-cream/90 dark:bg-slate-800/95 text-brand-dark dark:text-slate-100 border border-brand-yellow/30 dark:border-brand-yellow/20 shadow-sm flex items-start gap-3 animate-pulse';

    const spinWrap = document.createElement('span');
    spinWrap.className = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-yellow/20 dark:bg-brand-yellow/15';
    spinWrap.innerHTML =
      '<svg class="h-5 w-5 text-brand-yellow animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">' +
      '<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>' +
      '<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>' +
      '</svg>';

    const textCol = document.createElement('div');
    textCol.className = 'min-w-0 pt-0.5';
    textCol.innerHTML =
      '<p class="text-xs font-black uppercase tracking-wide text-brand-dark dark:text-white">Working on it</p>' +
      '<p class="text-[11px] text-brand-muted dark:text-slate-400 mt-1 leading-snug">Searching leads &amp; resources, then drafting a reply…</p>';

    inner.appendChild(spinWrap);
    inner.appendChild(textCol);
    wrap.appendChild(inner);
    return wrap;
  }

  function renderCitations(container, citations) {
    if (!container) return;
    if (!citations || !citations.length) {
      container.classList.add('hidden');
      container.innerHTML = '';
      return;
    }
    const uniq = [];
    const seen = new Set();
    for (const c of citations) {
      const href = String(c.href || '');
      const key = c.type + '|' + href;
      if (seen.has(key)) continue;
      seen.add(key);
      uniq.push(c);
      if (uniq.length >= 10) break;
    }
    const parts = uniq.map(function (c) {
      const label = escapeHtml(c.title || (c.type === 'lead' ? 'Lead' : 'Resource'));
      const href = escapeHtml(c.href || '#');
      const ext = c.type === 'resource';
      return (
        '<a href="' +
        href +
        '" class="inline-flex items-center gap-1 mr-2 mb-1 px-2 py-1 rounded-lg bg-brand-yellow/15 text-brand-dark dark:text-brand-yellow border border-brand-yellow/25 text-[10px] font-bold hover:brightness-95 dark:hover:brightness-110"' +
        (ext ? ' target="_blank" rel="noopener noreferrer"' : '') +
        '>' +
        (c.type === 'lead' ? 'Lead: ' : 'Link: ') +
        label +
        (ext ? ' ↗' : '') +
        '</a>'
      );
    });
    container.innerHTML =
      '<p class="text-[9px] font-black uppercase tracking-widest text-brand-muted mb-1">Matched in workspace</p>' + parts.join('');
    container.classList.remove('hidden');
  }

  document.addEventListener('DOMContentLoaded', function () {
    const fab = document.getElementById('assistantFab');
    const panel = document.getElementById('assistantPanel');
    const closeBtn = document.getElementById('assistantClose');
    const form = document.getElementById('assistantForm');
    const input = document.getElementById('assistantInput');
    const sendBtn = document.getElementById('assistantSend');
    const messagesEl = document.getElementById('assistantMessages');
    const citeEl = document.getElementById('assistantCitations');
    if (!fab || !panel || !form || !input || !messagesEl) return;

    let open = false;
    const history = [];

    function setOpen(next) {
      open = next;
      fab.setAttribute('aria-expanded', open ? 'true' : 'false');
      panel.setAttribute('aria-hidden', open ? 'false' : 'true');
      if (open) {
        panel.classList.remove('hidden');
        input.focus();
      } else {
        panel.classList.add('hidden');
      }
    }

    fab.addEventListener('click', function () {
      setOpen(!open);
    });
    if (closeBtn) closeBtn.addEventListener('click', function () { setOpen(false); });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && open) setOpen(false);
    });

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      const text = input.value.trim();
      if (!text || sendBtn.disabled) return;

      messagesEl.appendChild(bubble('user', text));
      messagesEl.scrollTop = messagesEl.scrollHeight;
      input.value = '';
      sendBtn.disabled = true;

      const prior = history.slice();
      const loadingWrap = thinkingBubble();
      messagesEl.appendChild(loadingWrap);
      messagesEl.scrollTop = messagesEl.scrollHeight;

      function removeLoading() {
        var el = messagesEl.querySelector('[data-assistant-loading="1"]');
        if (el && el.parentNode) el.parentNode.removeChild(el);
      }

      try {
        const res = await fetch('/api/assistant/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ message: text, history: prior }),
        });
        let data = {};
        try {
          const raw = await res.text();
          data = raw ? JSON.parse(raw) : {};
        } catch (parseErr) {
          data = {};
        }
        removeLoading();
        if (!res.ok) {
          messagesEl.appendChild(
            bubble('assistant', (data && data.error) || 'Something went wrong. Try again.')
          );
        } else {
          var replyText = (data && data.reply) ? String(data.reply) : '';
          if (!replyText.trim()) {
            replyText = 'No reply text returned. Check server logs and API keys (KIE → Gemini → OpenAI).';
          }
          history.push({ role: 'user', content: text });
          history.push({ role: 'assistant', content: replyText });
          while (history.length > 16) {
            history.shift();
          }
          messagesEl.appendChild(bubble('assistant', replyText));
          renderCitations(citeEl, data.citations);
        }
      } catch (_) {
        removeLoading();
        messagesEl.appendChild(bubble('assistant', 'Network error. Check your connection.'));
      } finally {
        sendBtn.disabled = false;
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
    });
  });
})();
