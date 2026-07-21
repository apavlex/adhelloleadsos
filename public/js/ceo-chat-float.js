/**
 * Global Pavlex chat (Automate /ceo bubble) — POST /api/pavlex/chat, history from /ceo/chat/history.
 */
(function () {
  var PAVLEX_AVATAR =
    '<span class="shrink-0 w-6 h-6 rounded-full overflow-hidden border border-slate-200/60 bg-white shadow-sm ring-1 ring-slate-200/60 flex items-center justify-center" aria-hidden="true">' +
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" class="w-full h-full" role="img" aria-label="Pavlex">' +
    '<circle cx="24" cy="24" r="22" fill="#FFD644"/><circle cx="24" cy="24" r="20" fill="#FFC107"/>' +
    '<ellipse cx="17" cy="20" rx="2.5" ry="3" fill="#5C4033"/><ellipse cx="31" cy="20" rx="2.5" ry="3" fill="#5C4033"/>' +
    '<circle cx="17.8" cy="19" r="1" fill="#fff" opacity="0.9"/><circle cx="31.8" cy="19" r="1" fill="#fff" opacity="0.9"/>' +
    '<path d="M15 28 Q24 38 33 28" stroke="#5C4033" stroke-width="2.2" stroke-linecap="round" fill="none"/>' +
    '<ellipse cx="12" cy="26" rx="3" ry="2" fill="#FF9800" opacity="0.35"/>' +
    '<ellipse cx="36" cy="26" rx="3" ry="2" fill="#FF9800" opacity="0.35"/></svg></span>';

  function renderMd(text) {
    if (!text) return '';
    var s = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    s = s.replace(/```([\s\S]*?)```/g, '<pre class="bg-black/10 rounded-lg p-3 my-2 text-xs font-mono overflow-x-auto whitespace-pre-wrap"><code>$1</code></pre>');
    s = s.replace(/`([^`]+)`/g, '<code class="bg-black/10 rounded px-1 py-0.5 text-xs font-mono">$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-bold">$1</strong>');
    s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    s = s.replace(/^### (.+)$/gm, '<h4 class="font-black text-sm mt-3 mb-1">$1</h4>');
    s = s.replace(/^## (.+)$/gm, '<h3 class="font-black text-base mt-3 mb-1">$1</h3>');
    s = s.replace(/^[\-\*] (.+)$/gm, '<li class="ml-4 list-disc text-sm leading-relaxed">$1</li>');
    s = s.replace(/((?:<li[^>]*>.*<\/li>\n?)+)/g, '<ul class="space-y-1 my-2">$1</ul>');
    s = s.replace(/\n\n/g, '</p><p class="mt-2">');
    s = s.replace(/\n/g, '<br>');
    return '<p>' + s + '</p>';
  }

  function initCeoChatFloat() {
    var chatFormFloat = document.getElementById('ceoChatFormFloat');
    var chatInputFloat = document.getElementById('ceoChatInputFloat');
    var chatMessagesFloat = document.getElementById('ceoChatMessagesFloat');
    var chatBubble = document.getElementById('chatBubble');
    var chatWindow = document.getElementById('chatWindow');
    var chatWindowClose = document.getElementById('chatWindowClose');
    var chatBubbleIcon = document.getElementById('chatBubbleIcon');
    var chatBubbleClose = document.getElementById('chatBubbleClose');
    var chatBubbleDot = document.getElementById('chatBubbleDot');
    var typingFloat = document.getElementById('ceoTypingFloat');

    if (!chatBubble || !chatWindow) return;

    var chatHistory = [];
    var chatBusy = false;
    var chatOpen = false;

    function renderMsgTo(container, role, text) {
      var div = document.createElement('div');
      div.className = 'flex gap-2' + (role === 'user' ? ' flex-row-reverse' : '');
      if (role === 'assistant') {
        div.innerHTML =
          PAVLEX_AVATAR +
          '<div class="bg-brand-cream/60 dark:bg-slate-800/80 rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-brand-dark dark:text-slate-100 max-w-[85%]">' +
          renderMd(text) +
          '</div>';
      } else {
        div.innerHTML =
          '<div class="bg-brand-dark rounded-2xl rounded-tr-sm px-4 py-3 text-sm text-white max-w-[85%]">' +
          renderMd(text) +
          '</div>';
      }
      container.appendChild(div);
      container.scrollTop = container.scrollHeight;
    }

    function loadChatHistory() {
      fetch('/ceo/chat/history?limit=50', { credentials: 'same-origin' })
        .then(function (r) {
          return r.json();
        })
        .then(function (d) {
          if (d.success && d.messages && d.messages.length > 0 && chatMessagesFloat) {
            chatMessagesFloat.innerHTML = '';
            chatHistory = [];
            d.messages.forEach(function (m) {
              if (m.role === 'user' || m.role === 'assistant') {
                renderMsgTo(chatMessagesFloat, m.role, m.content);
                chatHistory.push({ role: m.role, content: m.content });
              }
            });
          }
        })
        .catch(function (e) {
          console.error('Failed to load chat history:', e);
        });
    }

    function sendChatMessage(msg) {
      if (chatBusy) return;
      msg = (msg || '').trim();
      if (!msg) return;
      chatBusy = true;
      if (chatInputFloat) {
        chatInputFloat.disabled = true;
        chatInputFloat.value = '';
      }
      if (chatMessagesFloat) renderMsgTo(chatMessagesFloat, 'user', msg);
      chatHistory.push({ role: 'user', content: msg });
      if (typingFloat) typingFloat.classList.remove('hidden');

      var timedOut = false;
      var timeoutId = setTimeout(function () {
        timedOut = true;
        if (typingFloat) typingFloat.classList.add('hidden');
        if (chatMessagesFloat) {
          renderMsgTo(chatMessagesFloat, 'assistant', 'Request timed out. Try again in a moment.');
        }
        chatBusy = false;
        if (chatInputFloat) {
          chatInputFloat.disabled = false;
          chatInputFloat.focus();
        }
      }, 30000);

      fetch('/api/pavlex/chat', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ message: msg, history: chatHistory.slice(-10), platform: 'automate' }),
      })
        .then(function (r) {
          return r.json();
        })
        .then(function (d) {
          if (timedOut) return;
          clearTimeout(timeoutId);
          if (typingFloat) typingFloat.classList.add('hidden');
          if (d.success && d.reply) {
            if (chatMessagesFloat) renderMsgTo(chatMessagesFloat, 'assistant', d.reply);
            chatHistory.push({ role: 'assistant', content: d.reply });
            if (!chatOpen && chatBubbleDot) chatBubbleDot.classList.remove('hidden');
          } else if (chatMessagesFloat) {
            renderMsgTo(chatMessagesFloat, 'assistant', d.error || d.reply || 'Something went wrong. Try again.');
          }
          chatBusy = false;
          if (chatInputFloat) {
            chatInputFloat.disabled = false;
            chatInputFloat.focus();
          }
        })
        .catch(function () {
          if (timedOut) return;
          clearTimeout(timeoutId);
          if (typingFloat) typingFloat.classList.add('hidden');
          if (chatMessagesFloat) {
            renderMsgTo(chatMessagesFloat, 'assistant', 'Connection error. Check your internet and try again.');
          }
          chatBusy = false;
          if (chatInputFloat) {
            chatInputFloat.disabled = false;
            chatInputFloat.focus();
          }
        });
    }

    function setChatOpen(open) {
      chatOpen = open;
      if (chatBubble) chatBubble.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) {
        chatWindow.classList.remove('hidden');
        if (chatBubbleIcon) chatBubbleIcon.classList.add('hidden');
        if (chatBubbleClose) chatBubbleClose.classList.remove('hidden');
        if (chatBubbleDot) chatBubbleDot.classList.add('hidden');
        setTimeout(function () {
          if (chatMessagesFloat) chatMessagesFloat.scrollTop = chatMessagesFloat.scrollHeight;
          if (chatInputFloat) chatInputFloat.focus();
        }, 100);
      } else {
        chatWindow.classList.add('hidden');
        if (chatBubbleIcon) chatBubbleIcon.classList.remove('hidden');
        if (chatBubbleClose) chatBubbleClose.classList.add('hidden');
      }
    }

    if (chatFormFloat) {
      chatFormFloat.addEventListener('submit', function (e) {
        e.preventDefault();
        sendChatMessage(chatInputFloat && chatInputFloat.value);
      });
    }

    if (chatBubble) {
      chatBubble.addEventListener('click', function () {
        setChatOpen(!chatOpen);
      });
    }

    if (chatWindowClose) {
      chatWindowClose.addEventListener('click', function () {
        setChatOpen(false);
      });
    }

    loadChatHistory();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCeoChatFloat);
  } else {
    initCeoChatFloat();
  }
})();
