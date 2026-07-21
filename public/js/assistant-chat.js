/**
 * Floating workspace assistant: POST /api/pavlex/chat (session + workspace scoped).
 * Optional: Web Speech API dictation (mic) + speechSynthesis “Listen” on coach replies.
 */
(function () {
  var _assistantAvatarId = 0;
  var _speechRec = null;
  var _listening = false;

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Coach portrait: warm, light-canvas female-presenting; matches dock SVG. Unique gradient ids per bubble. */
  function assistantAvatarNode() {
    var n = ++_assistantAvatarId;
    var gh = 'asstCoachHair' + n;
    var gs = 'asstCoachSkin' + n;
    const span = document.createElement('span');
    span.className =
      'shrink-0 w-9 h-9 sm:w-10 sm:h-10 rounded-full overflow-hidden border border-slate-200/90 dark:border-white/20 bg-white dark:bg-slate-800 shadow-sm ring-2 ring-slate-200/80 dark:ring-white/10';
    span.setAttribute('aria-hidden', 'true');
    span.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" class="w-full h-full" role="img" aria-label="Pavlex">' +
      '<circle cx="24" cy="24" r="22" fill="#FFD644"/>' +
      '<circle cx="24" cy="24" r="20" fill="#FFC107"/>' +
      '<ellipse cx="17" cy="20" rx="2.5" ry="3" fill="#5C4033"/>' +
      '<ellipse cx="31" cy="20" rx="2.5" ry="3" fill="#5C4033"/>' +
      '<circle cx="17.8" cy="19" r="1" fill="#fff" opacity="0.9"/>' +
      '<circle cx="31.8" cy="19" r="1" fill="#fff" opacity="0.9"/>' +
      '<path d="M15 28 Q24 38 33 28" stroke="#5C4033" stroke-width="2.2" stroke-linecap="round" fill="none"/>' +
      '<ellipse cx="12" cy="26" rx="3" ry="2" fill="#FF9800" opacity="0.35"/>' +
      '<ellipse cx="36" cy="26" rx="3" ry="2" fill="#FF9800" opacity="0.35"/>' +
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

  function getSpeechRecognitionCtor() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  /** Raw coach text for text-to-speech; strip light markdown. */
  function plainTextForTts(raw) {
    var t = String(raw || '');
    t = t.replace(/\r/g, '\n');
    t = t.replace(/```[\s\S]*?```/g, ' ');
    t = t.replace(/`([^`]+)`/g, '$1');
    t = t.replace(/\*\*([^*]+)\*\*/g, '$1');
    t = t.replace(/[*_#>]/g, ' ');
    t = t.replace(/\n+/g, ' ');
    t = t.replace(/\s+/g, ' ').trim();
    return t;
  }

  function speakCoachText(raw) {
    if (!window.speechSynthesis) return;
    var plain = plainTextForTts(raw);
    if (!plain) return;
    try {
      window.speechSynthesis.cancel();
    } catch (e) {}
    var u = new SpeechSynthesisUtterance(plain);
    u.lang = /^en/i.test(String(navigator.language || '')) ? (navigator.language || 'en-US') : 'en-US';
    u.rate = 1;
    window.speechSynthesis.speak(u);
  }

  function makeListenButton(plain) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className =
      'text-[10px] font-bold uppercase tracking-widest text-brand-yellow hover:underline mt-2 w-full text-left sm:w-auto sm:text-right';
    b.setAttribute('aria-label', 'Read this reply aloud');
    b.textContent = 'Listen';
    b.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      speakCoachText(plain);
    });
    return b;
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
      inner.appendChild(
        (function () {
          var d = document.createElement('div');
          d.className = 'min-w-0';
          d.innerHTML = formatAssistantMarkdown(text);
          return d;
        })()
      );
      if (window.speechSynthesis) {
        inner.appendChild(makeListenButton(text));
      }
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
      '<p class="text-xs font-black uppercase tracking-wide text-brand-dark dark:text-white">Pavlex is thinking</p>' +
      '<p class="text-[11px] text-brand-muted dark:text-slate-400 mt-1 leading-snug">Checking your workspace and crafting a reply…</p>';

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
    const mic = document.getElementById('assistantMic');
    const voiceHint = document.getElementById('assistantVoiceHint');
    if (!fab || !panel || !form || !input || !messagesEl) return;

    const SR = getSpeechRecognitionCtor();
    if (mic) {
      if (SR) {
        mic.removeAttribute('disabled');
      } else if (voiceHint) {
        voiceHint.classList.remove('hidden');
        voiceHint.textContent =
          'Voice dictation is not available in this browser. Try Chrome or Edge, or use Safari 18+ on iOS.';
      }
    }

    var dictationBase = '';
    var dictationFinal = '';

    function setListening(on) {
      _listening = !!on;
      if (mic) {
        mic.setAttribute('aria-pressed', _listening ? 'true' : 'false');
        if (_listening) {
          mic.classList.add('ring-2', 'ring-rose-500/80', 'dark:ring-rose-400/70');
        } else {
          mic.classList.remove('ring-2', 'ring-rose-500/80', 'dark:ring-rose-400/70');
        }
      }
      if (voiceHint && SR) {
        if (_listening) {
          voiceHint.classList.remove('hidden');
          voiceHint.textContent = 'Listening — tap the mic again to stop.';
        } else if (voiceHint.textContent.indexOf('Listening') === 0) {
          voiceHint.classList.add('hidden');
          voiceHint.textContent = '';
        }
      }
    }

    function stopDictation() {
      if (_speechRec) {
        try {
          _speechRec.stop();
        } catch (e) {
          _speechRec = null;
        }
      }
    }

    function startDictation() {
      if (!SR || !mic) return;
      if (_speechRec) {
        try {
          _speechRec.abort();
        } catch (e) {}
      }
      _speechRec = new SR();
      _speechRec.continuous = true;
      _speechRec.interimResults = true;
      _speechRec.lang = (navigator.language || 'en-US').indexOf('en') === 0 ? navigator.language || 'en-US' : 'en-US';
      dictationBase = String(input.value || '');
      dictationFinal = '';
      setListening(true);
      _speechRec.onresult = function (event) {
        var inter = '';
        for (var i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            dictationFinal += event.results[i][0].transcript;
          } else {
            inter += event.results[i][0].transcript;
          }
        }
        input.value = (dictationBase + dictationFinal + inter).replace(/\s{2,}/g, ' ');
      };
      _speechRec.onerror = function (ev) {
        var name = (ev && ev.error) || '';
        if (name === 'not-allowed' && voiceHint) {
          voiceHint.classList.remove('hidden');
          voiceHint.textContent = 'Microphone access denied — check browser permissions to dictate.';
        } else if (name && name !== 'aborted' && name !== 'no-speech' && name !== 'audio-capture' && voiceHint) {
          voiceHint.classList.remove('hidden');
          voiceHint.textContent = 'Dictation stopped: ' + name;
        }
      };
      _speechRec.onend = function () {
        setListening(false);
        _speechRec = null;
      };
      try {
        _speechRec.start();
      } catch (e) {
        setListening(false);
        if (voiceHint) {
          voiceHint.classList.remove('hidden');
          voiceHint.textContent = 'Could not start dictation. Try again.';
        }
      }
    }

    if (mic && SR) {
      mic.addEventListener('click', function (e) {
        e.preventDefault();
        if (sendBtn && sendBtn.disabled) return;
        if (_listening) {
          stopDictation();
        } else {
          startDictation();
        }
      });
    }

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
        stopDictation();
        setListening(false);
        _speechRec = null;
        try {
          if (window.speechSynthesis) window.speechSynthesis.cancel();
        } catch (e2) {}
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
        const res = await fetch('/api/pavlex/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ message: text, history: prior, platform: 'assistant' }),
        });
        let data = {};
        let bodyWasJson = false;
        try {
          const raw = await res.text();
          if (raw) {
            data = JSON.parse(raw);
            bodyWasJson = true;
          } else {
            data = {};
          }
        } catch (parseErr) {
          data = {};
          bodyWasJson = false;
        }
        removeLoading();
        if (!res.ok) {
          messagesEl.appendChild(
            bubble('assistant', (data && data.error) || 'Something went wrong. Try again.')
          );
        } else if (!bodyWasJson) {
          messagesEl.appendChild(
            bubble(
              'assistant',
              'The coach could not read a response from the server. If you are using a static preview, sign in to the app or open the app URL the API is deployed on. If this persists, the server may not be able to run /api/pavlex/chat.'
            )
          );
        } else {
          var safe = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
          var hasKey = Object.prototype.hasOwnProperty.call(safe, 'reply');
          var rawReply = hasKey ? safe.reply : '';
          var replyText = rawReply == null || rawReply === '' ? '' : String(rawReply);
          if (!replyText.trim()) {
            replyText =
              'No reply from the coach. Check server logs and that a legacy AI key is set (KIE_AI, KIE_API, GEMINI, or OPENAI) on the server, then try again.';
          }
          history.push({ role: 'user', content: text });
          history.push({ role: 'assistant', content: replyText });
          while (history.length > 16) {
            history.shift();
          }
          messagesEl.appendChild(bubble('assistant', replyText));
          renderCitations(citeEl, safe.citations);
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
