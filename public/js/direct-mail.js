(function () {
  'use strict';

  var chatHistory = [];
  var lastImagePrompt = '';
  var designs = { front: null, back: null };

  function selectedKeys() {
    return getDmCheckboxes()
      .filter(function (cb) {
        return cb.checked;
      })
      .map(function (cb) {
        return String(cb.value || '').trim();
      })
      .filter(Boolean);
  }

  function setStatus(text, ok) {
    var el = document.getElementById('dmStatus');
    if (!el) return;
    if (!text) {
      el.classList.add('hidden');
      el.textContent = '';
      return;
    }
    el.textContent = text;
    el.classList.remove('hidden', 'text-emerald-700', 'text-rose-700', 'dark:text-emerald-300', 'dark:text-rose-300');
    el.classList.add(ok ? 'text-emerald-700' : 'text-rose-700', ok ? 'dark:text-emerald-300' : 'dark:text-rose-300');
  }

  function setDesignStatus(text, ok) {
    var el = document.getElementById('dmDesignStatus');
    if (!el) return;
    if (!text) {
      el.classList.add('hidden');
      el.textContent = '';
      return;
    }
    el.textContent = text;
    el.classList.remove('hidden', 'text-emerald-700', 'text-rose-700', 'dark:text-emerald-300', 'dark:text-rose-300');
    el.classList.add(ok ? 'text-emerald-700' : 'text-rose-700', ok ? 'dark:text-emerald-300' : 'dark:text-rose-300');
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function copyContext() {
    return {
      headline: (document.getElementById('dmHeadline') || {}).value || '',
      bodyText: (document.getElementById('dmBody') || {}).value || '',
      ctaUrl: (document.getElementById('dmCtaUrl') || {}).value || '',
      slot: (document.getElementById('dmDesignSlot') || {}).value || 'front',
    };
  }

  function appendChatBubble(role, text) {
    var log = document.getElementById('dmChatLog');
    if (!log || !text) return;
    var intro = log.querySelector('.text-brand-muted.leading-relaxed');
    if (intro && !intro.dataset.dmIntro) {
      intro.dataset.dmIntro = '1';
      intro.remove();
    }
    var wrap = document.createElement('div');
    wrap.className = role === 'user' ? 'flex justify-end' : 'flex justify-start';
    var inner = document.createElement('div');
    inner.className =
      role === 'user'
        ? 'max-w-[92%] rounded-2xl rounded-br-md px-3 py-2 bg-brand-dark dark:bg-brand-yellow text-white dark:text-brand-dark text-sm font-medium'
        : 'max-w-[92%] rounded-2xl rounded-bl-md px-3 py-2 bg-white dark:bg-slate-800 text-brand-dark dark:text-slate-100 text-sm leading-relaxed border border-brand-border/40 dark:border-white/10';
    inner.innerHTML = escapeHtml(text).replace(/\n/g, '<br>');
    wrap.appendChild(inner);
    log.appendChild(wrap);
    log.scrollTop = log.scrollHeight;
  }

  function setPreview(slot, imageUrl) {
    var el = document.getElementById(slot === 'back' ? 'dmPreviewBack' : 'dmPreviewFront');
    var useCb = document.getElementById(slot === 'back' ? 'dmUseBack' : 'dmUseFront');
    if (!el) return;
    designs[slot] = imageUrl || null;
    el.innerHTML = '';
    if (!imageUrl) {
      var span = document.createElement('span');
      span.className = 'text-[10px] text-brand-muted px-2 text-center';
      span.textContent = 'No ' + slot + ' yet';
      el.appendChild(span);
      if (useCb) {
        useCb.checked = false;
        useCb.disabled = true;
      }
      return;
    }
    var img = document.createElement('img');
    img.src = imageUrl;
    img.alt = slot + ' postcard design';
    img.className = 'w-full h-full object-cover';
    el.appendChild(img);
    if (useCb) {
      useCb.disabled = false;
      useCb.checked = true;
    }
  }

  function activeDesignUrls() {
    var out = { frontImageUrl: '', backImageUrl: '' };
    var useFront = document.getElementById('dmUseFront');
    var useBack = document.getElementById('dmUseBack');
    if (useFront && useFront.checked && designs.front) out.frontImageUrl = designs.front;
    if (useBack && useBack.checked && designs.back) out.backImageUrl = designs.back;
    return out;
  }

  async function postJson(url, body) {
    var res = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body || {}),
    });
    var data = {};
    try {
      data = await res.json();
    } catch (_) {
      data = {};
    }
    if (!res.ok || data.success === false) {
      throw new Error((data && data.error) || 'Request failed');
    }
    return data;
  }

  async function sendChatMessage() {
    var input = document.getElementById('dmChatInput');
    var btn = document.getElementById('dmChatSend');
    if (!input || !btn) return;
    var text = String(input.value || '').trim();
    if (!text) return;

    appendChatBubble('user', text);
    chatHistory.push({ role: 'user', content: text });
    input.value = '';
    btn.disabled = true;
    setDesignStatus('Thinking…', true);

    try {
      var ctx = copyContext();
      var data = await postJson('/direct-mail/api/design-chat', {
        message: text,
        history: chatHistory.slice(0, -1),
        headline: ctx.headline,
        bodyText: ctx.bodyText,
        ctaUrl: ctx.ctaUrl,
        slot: ctx.slot,
      });
      var reply = String(data.reply || '').trim();
      if (reply) {
        appendChatBubble('assistant', reply);
        chatHistory.push({ role: 'assistant', content: reply });
      }
      if (data.imagePrompt) {
        lastImagePrompt = String(data.imagePrompt).trim();
        var hint = document.getElementById('dmPromptHint');
        if (hint) {
          hint.textContent = 'Ready to generate: ' + lastImagePrompt;
          hint.classList.remove('hidden');
        }
        setDesignStatus('Prompt ready — click Generate.', true);
      } else {
        setDesignStatus('', true);
      }
    } catch (e) {
      setDesignStatus(e && e.message ? e.message : 'Chat failed', false);
    } finally {
      btn.disabled = false;
      input.focus();
    }
  }

  async function generateImage() {
    var btn = document.getElementById('dmGenerateBtn');
    var slotEl = document.getElementById('dmDesignSlot');
    if (!btn) return;

    var prompt = lastImagePrompt || String((document.getElementById('dmChatInput') || {}).value || '').trim();
    if (!prompt) {
      setDesignStatus('Describe the design in chat first, or paste a prompt.', false);
      return;
    }

    var slot = slotEl && slotEl.value === 'back' ? 'back' : 'front';
    var aspectRatio = (document.getElementById('dmAspectRatio') || {}).value || '2:3';
    var resolution = (document.getElementById('dmResolution') || {}).value || '2K';
    var referenceUrl = designs[slot === 'back' ? 'front' : 'back'] || '';

    btn.disabled = true;
    setDesignStatus('Generating with GPT Image 2… this can take up to 2 minutes.', true);

    try {
      var body = {
        prompt: prompt,
        slot: slot,
        aspectRatio: aspectRatio,
        resolution: resolution,
      };
      if (referenceUrl) body.referenceUrl = referenceUrl;

      var data = await postJson('/direct-mail/api/generate-image', body);
      if (data.imageUrl) {
        setPreview(slot, data.imageUrl);
        lastImagePrompt = prompt;
        setDesignStatus('Generated ' + slot + ' side — preview updated.', true);
        if (typeof window.showAppToast === 'function') {
          window.showAppToast('Postcard ' + slot + ' generated', { variant: 'success' });
        }
      } else {
        throw new Error('No image URL returned.');
      }
    } catch (e) {
      setDesignStatus(e && e.message ? e.message : 'Generation failed', false);
    } finally {
      btn.disabled = false;
    }
  }

  function syncCheckAll() {
    var boxes = getDmCheckboxes();
    var all = document.getElementById('dmCheckAll');
    if (!all || !boxes.length) return;
    var checked = boxes.filter(function (b) {
      return b.checked;
    }).length;
    all.indeterminate = checked > 0 && checked < boxes.length;
    all.checked = checked === boxes.length;
  }

  var dmSelectAnchor = null;

  function getDmCheckboxes() {
    return Array.from(document.querySelectorAll('#dmLeadsTable .dm-lead-check'));
  }

  function getDmCheckboxIndex(cb) {
    if (!cb) return -1;
    return getDmCheckboxes().indexOf(cb);
  }

  function setDmCheckboxChecked(cb, checked) {
    if (!cb) return;
    cb.checked = checked;
    if (checked) cb.setAttribute('checked', 'checked');
    else cb.removeAttribute('checked');
    var tr = cb.closest('tr');
    if (tr) {
      tr.classList.toggle('bulk-selected', checked);
      tr.setAttribute('aria-selected', checked ? 'true' : 'false');
    }
  }

  function syncDmRowHighlights() {
    getDmCheckboxes().forEach(function (cb) {
      var tr = cb.closest('tr');
      if (!tr) return;
      tr.classList.toggle('bulk-selected', cb.checked);
      tr.setAttribute('aria-selected', cb.checked ? 'true' : 'false');
    });
  }

  function applyDmRangeSelection(fromIndex, toIndex, checked) {
    var boxes = getDmCheckboxes();
    var start = Math.min(fromIndex, toIndex);
    var end = Math.max(fromIndex, toIndex);
    for (var i = start; i <= end; i += 1) {
      if (boxes[i]) setDmCheckboxChecked(boxes[i], checked);
    }
    syncCheckAll();
  }

  function handleDmShiftSelect(targetIndex) {
    if (targetIndex < 0) return;
    if (dmSelectAnchor != null && dmSelectAnchor >= 0) {
      applyDmRangeSelection(dmSelectAnchor, targetIndex, true);
    } else if (getDmCheckboxes()[targetIndex]) {
      setDmCheckboxChecked(getDmCheckboxes()[targetIndex], true);
      syncCheckAll();
    }
    dmSelectAnchor = targetIndex;
  }

  function isDmRowClickTarget(target) {
    if (!target || !target.closest) return false;
    if (target.closest('input, button, a, select, textarea, label, form')) return false;
    return true;
  }

  function bindDmShiftRangeSelect() {
    var table = document.getElementById('dmLeadsTable');
    if (!table || table.dataset.dmShiftBound === '1') return;
    table.dataset.dmShiftBound = '1';

    document.addEventListener(
      'mousedown',
      function (e) {
        if (!e.shiftKey) return;
        var cb =
          e.target && e.target.closest ? e.target.closest('#dmLeadsTable input.dm-lead-check') : null;
        if (cb) {
          e.preventDefault();
          e.stopPropagation();
          handleDmShiftSelect(getDmCheckboxIndex(cb));
          return;
        }
        var row =
          e.target && e.target.closest
            ? e.target.closest('#dmLeadsTable tbody tr.result-row')
            : null;
        if (!row || !isDmRowClickTarget(e.target)) return;
        var rowCb = row.querySelector('input.dm-lead-check');
        if (!rowCb) return;
        e.preventDefault();
        e.stopPropagation();
        handleDmShiftSelect(getDmCheckboxIndex(rowCb));
      },
      true,
    );

    document.addEventListener(
      'click',
      function (e) {
        if (e.shiftKey) return;
        var cb =
          e.target && e.target.closest ? e.target.closest('#dmLeadsTable input.dm-lead-check') : null;
        if (cb) {
          var idx = getDmCheckboxIndex(cb);
          if (idx >= 0) dmSelectAnchor = idx;
          syncDmRowHighlights();
          syncCheckAll();
          return;
        }
        var row =
          e.target && e.target.closest
            ? e.target.closest('#dmLeadsTable tbody tr.result-row')
            : null;
        if (!row || !isDmRowClickTarget(e.target)) return;
        var rowCb = row.querySelector('input.dm-lead-check');
        if (!rowCb) return;
        rowCb.checked = !rowCb.checked;
        setDmCheckboxChecked(rowCb, rowCb.checked);
        dmSelectAnchor = getDmCheckboxIndex(rowCb);
        syncCheckAll();
      },
      true,
    );
  }

  document.getElementById('dmCheckAll') &&
    document.getElementById('dmCheckAll').addEventListener('change', function () {
      var on = this.checked;
      getDmCheckboxes().forEach(function (cb) {
        setDmCheckboxChecked(cb, on);
      });
      if (!on) dmSelectAnchor = null;
      syncCheckAll();
    });

  getDmCheckboxes().forEach(function (cb) {
    cb.addEventListener('change', function () {
      if (window.__dmRangeSelectSync) return;
      syncDmRowHighlights();
      syncCheckAll();
    });
  });

  bindDmShiftRangeSelect();

  var selectAllBtn = document.getElementById('dmSelectAll');
  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', function () {
      getDmCheckboxes().forEach(function (cb) {
        setDmCheckboxChecked(cb, true);
      });
      syncCheckAll();
    });
  }

  var chatSend = document.getElementById('dmChatSend');
  if (chatSend) chatSend.addEventListener('click', sendChatMessage);

  var chatInput = document.getElementById('dmChatInput');
  if (chatInput) {
    chatInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
      }
    });
  }

  var genBtn = document.getElementById('dmGenerateBtn');
  if (genBtn) genBtn.addEventListener('click', generateImage);

  var sendBtn = document.getElementById('dmSendBtn');
  if (sendBtn) {
    sendBtn.addEventListener('click', async function () {
      var keys = selectedKeys();
      if (!keys.length) {
        setStatus('Select at least one lead.', false);
        return;
      }
      if (!window.confirm('Send ' + keys.length + ' postcard(s) via Lob?')) return;

      var designUrls = activeDesignUrls();
      sendBtn.disabled = true;
      setStatus('Sending…', true);
      try {
        var res = await fetch('/direct-mail/api/send', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            keys: keys,
            headline: (document.getElementById('dmHeadline') || {}).value || '',
            bodyText: (document.getElementById('dmBody') || {}).value || '',
            ctaUrl: (document.getElementById('dmCtaUrl') || {}).value || '',
            frontImageUrl: designUrls.frontImageUrl,
            backImageUrl: designUrls.backImageUrl,
          }),
        });
        var data = await res.json().catch(function () {
          return {};
        });
        if (!res.ok || !data.success) {
          throw new Error((data && data.error) || 'Send failed');
        }
        var msg = 'Sent ' + data.sent + ' postcard(s)';
        if (data.failed) msg += ' · ' + data.failed + ' failed';
        setStatus(msg, true);
        if (typeof window.showAppToast === 'function') {
          window.showAppToast(msg, { variant: 'success' });
        }
        setTimeout(function () {
          window.location.reload();
        }, 1200);
      } catch (e) {
        setStatus(e && e.message ? e.message : 'Send failed', false);
        if (typeof window.showAppToast === 'function') {
          window.showAppToast(e && e.message ? e.message : 'Send failed', { variant: 'error' });
        }
      } finally {
        sendBtn.disabled = false;
      }
    });
  }
})();
