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

  /** Coach portrait: dark bob, face detail. Unique gradient ids per bubble instance. */
  function assistantAvatarNode() {
    var n = ++_assistantAvatarId;
    var gh = 'asstCoachHair' + n;
    var gs = 'asstCoachSkin' + n;
    const span = document.createElement('span');
    span.className =
      'shrink-0 w-9 h-9 sm:w-10 sm:h-10 rounded-full overflow-hidden border border-slate-700/35 dark:border-white/20 bg-[#2a2220] shadow-sm ring-2 ring-white/20 dark:ring-white/10';
    span.setAttribute('aria-hidden', 'true');
    span.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none" class="w-full h-full" role="img" aria-label="Coach">' +
      '<defs>' +
      '<linearGradient id="' +
      gh +
      '" x1="6" y1="4" x2="42" y2="22" gradientUnits="userSpaceOnUse">' +
      '<stop stop-color="#3d2a22"/><stop offset="0.55" stop-color="#1c1210"/><stop offset="1" stop-color="#0a0605"/>' +
      '</linearGradient>' +
      '<linearGradient id="' +
      gs +
      '" x1="16" y1="16" x2="32" y2="42" gradientUnits="userSpaceOnUse">' +
      '<stop stop-color="#f0c4b8"/><stop offset="1" stop-color="#c99588"/>' +
      '</linearGradient>' +
      '</defs>' +
      '<path fill="url(#' +
      gh +
      ')" d="M24 3C12 3 5 12 5 24c0 5 1.2 9.5 3.5 13 0.5-7 4.5-12 11.5-13.5 1.2 0.8 2.5 1.2 4 1.2s2.8-0.4 4-1.2c7 1.5 11 6.5 11.5 13.5 2.3-3.5 3.5-8 3.5-13C43 12 36 3 24 3z"/>' +
      '<path fill="#1a1210" d="M14 19c2.5-7 8.5-11 10-11s7.5 4 10 11c-2-4.5-6-7.5-10-7.5s-8 3-10 7.5z"/>' +
      '<ellipse cx="24" cy="25" rx="9.5" ry="11" fill="url(#' +
      gs +
      ')"/>' +
      '<path fill="url(#' +
      gh +
      ')" d="M11 24c0-8 5.5-14 13-14s13 6 13 14c0 2-0.5 4-1.5 5.5-1-6-5.5-10-11.5-10s-10.5 4-11.5 10c-1-1.5-1.5-3.5-1.5-5.5z"/>' +
      '<ellipse cx="19.5" cy="23.5" rx="1.7" ry="2.1" fill="#2a1a14"/>' +
      '<ellipse cx="28.5" cy="23.5" rx="1.7" ry="2.1" fill="#2a1a14"/>' +
      '<circle cx="20.3" cy="22.6" r="0.6" fill="#fff" opacity="0.9"/>' +
      '<circle cx="29.3" cy="22.6" r="0.6" fill="#fff" opacity="0.9"/>' +
      '<path stroke="#3d2a22" stroke-width="0.85" stroke-linecap="round" fill="none" d="M16.8 20.2q2.8-1.2 5.6 0M25.6 20.2q2.8-1.2 5.6 0" opacity="0.45"/>' +
      '<path stroke="#a65d52" stroke-width="0.9" stroke-linecap="round" fill="none" d="M24 26.2v2.8" opacity="0.55"/>' +
      '<path stroke="#9a4d42" stroke-width="1.05" stroke-linecap="round" fill="none" d="M19.5 31.2q4.5 3 9 0"/>' +
      '<ellipse cx="17.2" cy="27.5" rx="2.2" ry="1.3" fill="#d9a090" opacity="0.4"/>' +
      '<ellipse cx="30.8" cy="27.5" rx="2.2" ry="1.3" fill="#d9a090" opacity="0.4"/>' +
      '<path fill="url(#' +
      gs +
      ')" d="M17.5 35.5h13v4.5c0 1.8-2.2 3.5-6.5 3.5s-6.5-1.7-6.5-3.5v-4.5z"/>' +
      '</svg>';
    return span;
  }

  /** Prefer plain text from model; lightly style legacy **pairs** and strip stray asterisks. */
  function formatAssistantMarkdown(raw) {
    let t = escapeHtml(raw);
    t = t.replace(/`([^`]+)`/g, function (_, code) {
      return '<code class="text-xs font-mono bg-brand-dark/5 dark:bg-white/10 px-1.5 py-0.5 rounded-md">' + code + '</code>';
    });
    t = t.replace(/\*\*([\s\S]+?)\*\*/g, function (_, inner) {
      return (
        '<span class="font-semibold text-brand-dark dark:text-amber-100 border-b border-brand-yellow/40">' +
        inner +
        '</span>'
      );
    });
    t = t.replace(/\*\*/g, '');
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
      : 'max-w-[min(95%,calc(100%-3rem))] rounded-2xl rounded-bl-md px-3 py-2 bg-brand-cream/80 dark:bg-slate-800 text-brand-dark dark:text-slate-100 text-sm leading-relaxed border border-brand-border/40 dark:border-white/10';
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
      '<p class="text-xs font-black uppercase tracking-wide text-brand-dark dark:text-white">Coach is thinking</p>' +
      '<p class="text-[11px] text-brand-muted dark:text-slate-400 mt-1 leading-snug">Skimming your workspace and drafting a thoughtful reply…</p>';

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
