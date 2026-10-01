/**
 * Alex chat widget — POST /api/pavlex/chat from any authenticated app page.
 */
(function () {
  var PAVLEX_AVATAR =
    '<span class="acw-avatar shrink-0 w-7 h-7 rounded-full overflow-hidden bg-white" aria-hidden="true">' +
    '<img src="/img/alex-avatar-96.jpg" alt="" class="w-full h-full rounded-full object-cover" width="28" height="28" loading="lazy" decoding="async" /></span>';

  /** http(s) URLs and same-origin paths only; returns null for anything else (javascript:, //host, data:, …). */
  function safeLinkHref(raw) {
    var url = String(raw || '')
      .replace(/&amp;/g, '&')
      .trim();
    if (!url) return null;
    if (url.charAt(0) === '/' && url.charAt(1) !== '/' && url.charAt(1) !== '\\') return { href: url, external: false };
    if (/^https?:\/\//i.test(url)) {
      try {
        var parsed = new URL(url);
        return { href: parsed.href, external: parsed.origin !== window.location.origin };
      } catch (_) {
        return null;
      }
    }
    return null;
  }

  function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderMd(text) {
    if (!text) return '';
    var s = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    var stash = [];
    function hold(html) {
      stash.push(html);
      return '\u0001' + (stash.length - 1) + '\u0001';
    }
    s = s.replace(/```([\s\S]*?)```/g, function (_, code) {
      return hold('<pre class="bg-black/10 rounded-lg p-3 my-2 text-xs font-mono overflow-x-auto whitespace-pre-wrap"><code>' + code + '</code></pre>');
    });
    s = s.replace(/`([^`]+)`/g, function (_, code) {
      return hold('<code class="bg-black/10 rounded px-1 py-0.5 text-xs font-mono">' + code + '</code>');
    });
    s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, function (m, label, url) {
      var link = safeLinkHref(url);
      if (!link) return m;
      var attrs = link.external ? ' target="_blank" rel="noopener noreferrer"' : '';
      return hold(
        '<a href="' + escapeAttr(link.href) + '"' + attrs + ' class="underline underline-offset-2 font-semibold break-words">' + label + '</a>',
      );
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-bold">$1</strong>');
    s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    s = s.replace(/^### (.+)$/gm, '<h4 class="font-black text-sm mt-3 mb-1">$1</h4>');
    s = s.replace(/^## (.+)$/gm, '<h3 class="font-black text-base mt-3 mb-1">$1</h3>');
    s = s.replace(/^[\-\*] (.+)$/gm, '<li class="ml-4 list-disc text-sm leading-relaxed">$1</li>');
    s = s.replace(/((?:<li[^>]*>.*<\/li>\n?)+)/g, '<ul class="space-y-1 my-2">$1</ul>');
    s = s.replace(/\n\n/g, '</p><p class="mt-2">');
    s = s.replace(/\n/g, '<br>');
    s = s.replace(/\u0001(\d+)\u0001/g, function (_, i) {
      return stash[Number(i)];
    });
    return '<p>' + s + '</p>';
  }

  function detectPavlexPlatform() {
    var path = window.location.pathname || '';
    if (path === '/ceo' || path.indexOf('/ceo/') === 0) return 'automate';
    return 'global';
  }

  function currentPageContext() {
    return (window.location.pathname || '') + (window.location.search || '');
  }

  function pageWorkspaceId() {
    var root = document.getElementById('ceoChatFloat');
    var fromDom = root && root.getAttribute('data-workspace-id');
    return String(fromDom || window.__ADHELLO_WORKSPACE_ID__ || '').trim();
  }

  function initCeoChatFloat() {
    var root = document.getElementById('ceoChatFloat');
    var chatFormFloat = document.getElementById('ceoChatFormFloat');
    var chatInputFloat = document.getElementById('ceoChatInputFloat');
    var chatMessagesFloat = document.getElementById('ceoChatMessagesFloat');
    var chatList = document.getElementById('ceoChatListFloat');
    var chatEmpty = document.getElementById('ceoChatEmptyFloat');
    var chatSend = document.getElementById('ceoChatSendFloat');
    var chatBubble = document.getElementById('chatBubble');
    var chatWindow = document.getElementById('chatWindow');
    var chatWindowClose = document.getElementById('chatWindowClose');
    var chatWindowClear = document.getElementById('chatWindowClear');
    var chatBackdrop = document.getElementById('chatWindowBackdrop');
    var chatBubbleDot = document.getElementById('chatBubbleDot');
    var typingFloat = document.getElementById('ceoTypingFloat');

    if (!chatBubble || !chatWindow) return;

    var chatHistory = [];
    var chatBusy = false;
    var chatOpen = false;
    var closeTimer = null;
    var voice = null;
    var micBtn = document.getElementById('ceoChatMicFloat');
    var phoneMq = window.matchMedia ? window.matchMedia('(max-width: 640px)') : null;

    function isPhone() {
      return !!(phoneMq && phoneMq.matches);
    }

    function attachVoice() {
      if (micBtn && chatInputFloat && window.AlexVoice) {
        voice = window.AlexVoice.attach({ button: micBtn, input: chatInputFloat });
      }
    }
    if (window.AlexVoice) attachVoice();
    else document.addEventListener('alexvoice:ready', attachVoice, { once: true });

    function scrollToBottom() {
      if (chatMessagesFloat) chatMessagesFloat.scrollTop = chatMessagesFloat.scrollHeight;
    }

    function showEmpty(show) {
      if (chatEmpty) chatEmpty.hidden = !show;
      if (chatList) chatList.hidden = show;
      if (chatWindowClear) chatWindowClear.hidden = show;
    }

    function renderMsg(role, text, opts) {
      if (!chatList) return;
      var div = document.createElement('div');
      if (role === 'user') {
        div.className = 'acw-msg acw-msg-user';
        div.innerHTML = '<div class="acw-bubble-user"></div>';
        div.firstChild.textContent = text;
      } else {
        div.className = 'acw-msg acw-msg-assistant';
        div.innerHTML =
          PAVLEX_AVATAR +
          (opts && opts.error
            ? '<div class="acw-error"></div>'
            : '<div class="acw-md">' + renderMd(text) + '</div>');
        if (opts && opts.error) div.querySelector('.acw-error').textContent = text;
      }
      chatList.appendChild(div);
      showEmpty(false);
      scrollToBottom();
    }

    function autosize() {
      if (!chatInputFloat) return;
      chatInputFloat.style.height = 'auto';
      chatInputFloat.style.height = Math.min(chatInputFloat.scrollHeight, 128) + 'px';
      if (chatSend) chatSend.disabled = chatBusy || !chatInputFloat.value.trim();
    }

    function setBusy(busy) {
      chatBusy = busy;
      if (typingFloat) typingFloat.classList.toggle('hidden', !busy);
      if (chatWindowClear) chatWindowClear.disabled = busy;
      chatWindow.querySelectorAll('.acw-chip').forEach(function (b) {
        b.disabled = busy;
      });
      autosize();
      if (busy) scrollToBottom();
    }

    function loadChatHistory() {
      var wid = pageWorkspaceId();
      fetch('/ceo/chat/history?limit=50' + (wid ? '&workspaceId=' + encodeURIComponent(wid) : ''), {
        credentials: 'same-origin',
      })
        .then(function (r) {
          return r.json();
        })
        .then(function (d) {
          if (chatBusy || chatHistory.length) return;
          if (d.success && d.messages && d.messages.length > 0 && chatList) {
            chatList.innerHTML = '';
            chatHistory = [];
            d.messages.forEach(function (m) {
              if (m.role === 'user' || m.role === 'assistant') {
                renderMsg(m.role, m.content);
                chatHistory.push({ role: m.role, content: m.content });
              }
            });
          }
        })
        .catch(function (e) {
          console.error('Failed to load chat history:', e);
        });
    }

    function clearChat() {
      if (chatBusy) return;
      if (!window.confirm('Start a new chat? This clears your current conversation with Alex in this workspace.')) return;
      if (voice) voice.cancel();
      var wid = pageWorkspaceId();
      fetch('/ceo/chat/history' + (wid ? '?workspaceId=' + encodeURIComponent(wid) : ''), {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      })
        .then(function (r) {
          return r.json();
        })
        .then(function (d) {
          if (!d.success) throw new Error(d.error || 'clear failed');
          chatHistory = [];
          if (chatList) chatList.innerHTML = '';
          showEmpty(true);
          if (chatInputFloat && !isPhone()) chatInputFloat.focus();
        })
        .catch(function () {
          renderMsg('assistant', 'Could not clear the chat. Try again.', { error: true });
        });
    }

    function sendChatMessage(msg) {
      if (chatBusy) return;
      msg = (msg || '').trim();
      if (!msg) return;
      if (voice) voice.cancel();
      if (chatInputFloat) {
        chatInputFloat.value = '';
      }
      renderMsg('user', msg);
      chatHistory.push({ role: 'user', content: msg });
      setBusy(true);

      var timedOut = false;
      var timeoutId = setTimeout(function () {
        timedOut = true;
        renderMsg('assistant', 'Request timed out. Try again in a moment.', { error: true });
        setBusy(false);
        if (chatInputFloat && !isPhone()) chatInputFloat.focus();
      }, 60000);

      fetch('/api/pavlex/chat', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          message: msg,
          history: chatHistory.slice(-10),
          workspaceId: pageWorkspaceId() || undefined,
          platform: detectPavlexPlatform(),
          page: currentPageContext(),
          pageTitle: document.title || '',
        }),
      })
        .then(function (r) {
          return r.json();
        })
        .then(function (d) {
          if (timedOut) return;
          clearTimeout(timeoutId);
          setBusy(false);
          if (d.success && d.reply) {
            renderMsg('assistant', d.reply);
            chatHistory.push({ role: 'assistant', content: d.reply });
            if (!chatOpen && chatBubbleDot) chatBubbleDot.classList.remove('hidden');
          } else {
            var errMsg =
              d.error ||
              (d.detail && String(d.detail).indexOf('crm') >= 0
                ? 'CRM connection unavailable. MCP connection failed.'
                : null) ||
              d.reply ||
              'Something went wrong. Try again.';
            renderMsg('assistant', errMsg, { error: true });
          }
          if (chatInputFloat && chatOpen && !isPhone()) chatInputFloat.focus();
        })
        .catch(function () {
          if (timedOut) return;
          clearTimeout(timeoutId);
          setBusy(false);
          renderMsg('assistant', 'Connection error. Check your internet and try again.', { error: true });
          if (chatInputFloat && chatOpen && !isPhone()) chatInputFloat.focus();
        });
    }

    function submitComposer() {
      if (!chatInputFloat || chatBusy || !chatInputFloat.value.trim()) return;
      var text = chatInputFloat.value;
      sendChatMessage(text);
      autosize();
    }

    // iOS keyboard: keep the phone-size panel inside the visible viewport.
    var vv = window.visualViewport || null;
    function syncViewport() {
      if (!root || !vv || !chatOpen) return;
      root.style.setProperty('--acw-vvh', Math.round(vv.height) + 'px');
      root.style.setProperty('--acw-vv-top', Math.round(vv.offsetTop) + 'px');
      if (document.activeElement === chatInputFloat) scrollToBottom();
    }
    if (vv) {
      vv.addEventListener('resize', syncViewport);
      vv.addEventListener('scroll', syncViewport);
    }

    function setChatOpen(open) {
      if (open === chatOpen) return;
      chatOpen = open;
      chatBubble.setAttribute('aria-expanded', open ? 'true' : 'false');
      chatBubble.setAttribute('aria-label', open ? 'Minimize chat with Alex' : 'Open chat with Alex');
      if (closeTimer) clearTimeout(closeTimer);
      closeTimer = null;
      if (open) {
        chatWindow.classList.remove('hidden');
        void chatWindow.offsetWidth;
        chatWindow.classList.add('acw-panel--open');
        if (root) root.classList.add('acw--open');
        document.documentElement.classList.add('acw-open');
        if (chatBackdrop) chatBackdrop.hidden = false;
        if (chatBubbleDot) chatBubbleDot.classList.add('hidden');
        syncViewport();
        setTimeout(function () {
          scrollToBottom();
          if (chatInputFloat && !isPhone()) chatInputFloat.focus();
        }, 100);
      } else {
        if (voice) voice.cancel();
        var hadFocus = chatWindow.contains(document.activeElement);
        chatWindow.classList.remove('acw-panel--open');
        if (root) root.classList.remove('acw--open');
        document.documentElement.classList.remove('acw-open');
        if (chatBackdrop) chatBackdrop.hidden = true;
        closeTimer = setTimeout(function () {
          if (!chatOpen) chatWindow.classList.add('hidden');
        }, 220);
        if (hadFocus) chatBubble.focus();
      }
    }

    if (chatFormFloat) {
      chatFormFloat.addEventListener('submit', function (e) {
        e.preventDefault();
        submitComposer();
      });
    }

    if (chatInputFloat) {
      chatInputFloat.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          submitComposer();
        }
      });
      chatInputFloat.addEventListener('input', autosize);
    }

    chatWindow.querySelectorAll('.acw-chip').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var prompt = btn.getAttribute('data-acw-prompt');
        var prefill = btn.getAttribute('data-acw-prefill');
        if (prompt) {
          sendChatMessage(prompt);
          return;
        }
        if (prefill && chatInputFloat) {
          chatInputFloat.value = prefill;
          autosize();
          chatInputFloat.focus();
          var caret = parseInt(btn.getAttribute('data-acw-caret'), 10);
          if (Number.isFinite(caret)) {
            try {
              chatInputFloat.setSelectionRange(caret, caret);
            } catch (_) {
              /* ignore */
            }
          }
        }
      });
    });

    chatBubble.addEventListener('click', function () {
      setChatOpen(!chatOpen);
    });

    if (chatWindowClose) {
      chatWindowClose.addEventListener('click', function () {
        setChatOpen(false);
      });
    }

    if (chatBackdrop) {
      chatBackdrop.addEventListener('click', function () {
        setChatOpen(false);
      });
    }

    if (chatWindowClear) chatWindowClear.addEventListener('click', clearChat);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && chatOpen && chatWindow.contains(document.activeElement)) {
        setChatOpen(false);
      }
    });

    loadChatHistory();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCeoChatFloat);
  } else {
    initCeoChatFloat();
  }
})();
