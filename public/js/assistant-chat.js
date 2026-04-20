/**
 * Floating workspace assistant: POST /api/assistant/chat (session + workspace scoped).
 */
(function () {
  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function bubble(role, text) {
    const isUser = role === 'user';
    const wrap = document.createElement('div');
    wrap.className = isUser ? 'flex justify-end' : 'flex justify-start';
    const inner = document.createElement('div');
    inner.className = isUser
      ? 'max-w-[90%] rounded-2xl rounded-br-md px-3 py-2 bg-brand-dark dark:bg-brand-yellow text-white dark:text-brand-dark text-sm font-medium'
      : 'max-w-[95%] rounded-2xl rounded-bl-md px-3 py-2 bg-brand-cream/80 dark:bg-slate-800 text-brand-dark dark:text-slate-100 text-sm leading-relaxed border border-brand-border/40 dark:border-white/10';
    inner.innerHTML = escapeHtml(text).replace(/\n/g, '<br>');
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

      try {
        const res = await fetch('/api/assistant/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ message: text, history: prior }),
        });
        const data = await res.json().catch(function () { return {}; });
        if (!res.ok) {
          messagesEl.appendChild(
            bubble('assistant', (data && data.error) || 'Something went wrong. Try again.')
          );
        } else {
          history.push({ role: 'user', content: text });
          history.push({ role: 'assistant', content: data.reply || '' });
          while (history.length > 16) {
            history.shift();
          }
          messagesEl.appendChild(bubble('assistant', data.reply || ''));
          renderCitations(citeEl, data.citations);
        }
      } catch (_) {
        messagesEl.appendChild(bubble('assistant', 'Network error. Check your connection.'));
      } finally {
        sendBtn.disabled = false;
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
    });
  });
})();
