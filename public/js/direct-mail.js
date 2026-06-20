(function () {
  'use strict';

  var chatHistory = [];
  var lastImagePrompt = '';
  var designs = { front: null, back: null };
  var designMeta = {
    front: { prompt: '', aspectRatio: '2:3', resolution: '2K' },
    back: { prompt: '', aspectRatio: '2:3', resolution: '2K' },
  };
  var lightboxSlot = 'front';
  var DM_SAVED_KEY = 'adhello_dm_saved_designs';
  var DM_SAVED_MAX = 24;

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
      el.classList.remove('text-rose-700', 'dark:text-rose-300', 'text-emerald-700', 'dark:text-emerald-300');
      el.classList.add('text-brand-muted');
      return;
    }
    el.textContent = text;
    el.classList.remove('hidden', 'text-emerald-700', 'text-rose-700', 'dark:text-emerald-300', 'dark:text-rose-300', 'text-brand-muted');
    el.classList.add(ok ? 'text-emerald-700' : 'text-rose-700', ok ? 'dark:text-emerald-300' : 'dark:text-rose-300');
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function applyMergeFieldsClient(template, ctx) {
    return String(template || '').replace(/\{(business|city|state|audit_url)\}/gi, function (_, key) {
      return ctx[String(key).toLowerCase()] || '';
    });
  }

  function mergePreviewLead() {
    var keys = selectedKeys();
    var row = null;
    if (keys.length) {
      var firstKey = keys[0];
      getDmCheckboxes().some(function (cb) {
        if (String(cb.value || '') === firstKey) {
          row = cb.closest('tr');
          return true;
        }
        return false;
      });
    }
    if (!row) {
      row = document.querySelector('#dmLeadsTable tr[data-mailable="1"]');
    }
    if (!row) return null;
    return {
      business: row.getAttribute('data-business') || 'Sample Business',
      city: row.getAttribute('data-city') || '',
      state: row.getAttribute('data-state') || '',
      audit_url: row.getAttribute('data-audit-url') || '',
    };
  }

  function updateMergePreview() {
    var el = document.getElementById('dmMergePreview');
    if (!el) return;
    var ctx = mergePreviewLead();
    if (!ctx) {
      el.textContent = '';
      return;
    }
    var headline = applyMergeFieldsClient((document.getElementById('dmHeadline') || {}).value, ctx);
    var body = applyMergeFieldsClient((document.getElementById('dmBody') || {}).value, ctx);
    var parts = [];
    if (headline) parts.push('Headline: “' + headline + '”');
    if (body) parts.push('Body: “' + body.slice(0, 80) + (body.length > 80 ? '…' : '') + '”');
    el.textContent = parts.length
      ? 'Preview for ' + ctx.business + ' — ' + parts.join(' · ')
      : 'Preview for ' + ctx.business + ' — add copy above to see merged text.';
  }

  document.querySelectorAll('.dm-merge-field').forEach(function (field) {
    field.addEventListener('input', updateMergePreview);
  });
  document.addEventListener('change', function (e) {
    if (e.target && e.target.classList && e.target.classList.contains('dm-lead-check')) {
      updateMergePreview();
    }
  });

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

  function currentDesignSlot() {
    var slotEl = document.getElementById('dmDesignSlot');
    return slotEl && slotEl.value === 'back' ? 'back' : 'front';
  }

  function showPromptEditor(slot, prompt) {
    var wrap = document.getElementById('dmPromptEditorWrap');
    var editor = document.getElementById('dmPromptEditor');
    var slotLabel = document.getElementById('dmPromptEditorSlot');
    if (!wrap || !editor) return;
    var text = String(prompt || '').trim();
    if (!text) {
      wrap.classList.add('hidden');
      return;
    }
    wrap.classList.remove('hidden');
    editor.value = text;
    if (slotLabel) slotLabel.textContent = slot === 'back' ? 'Back' : 'Front';
    lastImagePrompt = text;
    if (designMeta[slot]) designMeta[slot].prompt = text;
  }

  function readPromptEditor() {
    var editor = document.getElementById('dmPromptEditor');
    return editor ? String(editor.value || '').trim() : '';
  }

  function applyPromptFromEditor() {
    var slot = currentDesignSlot();
    var text = readPromptEditor();
    if (!text) {
      setDesignStatus('Enter a prompt before applying.', false);
      return;
    }
    lastImagePrompt = text;
    designMeta[slot].prompt = text;
    var input = document.getElementById('dmChatInput');
    if (input) input.value = text;
    showPromptEditor(slot, text);
    setDesignStatus('Prompt updated — click Regenerate or Generate.', true);
  }

  function getSavedDesigns() {
    try {
      var raw = localStorage.getItem(DM_SAVED_KEY) || '[]';
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function persistSavedDesigns(list) {
    try {
      localStorage.setItem(DM_SAVED_KEY, JSON.stringify((list || []).slice(0, DM_SAVED_MAX)));
    } catch (_) {}
  }

  function saveDesignToLibrary(slot, opts) {
    opts = opts || {};
    var imageUrl = opts.imageUrl || designs[slot];
    if (!imageUrl) return false;
    var item = {
      id: 'dm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      slot: slot === 'back' ? 'back' : 'front',
      imageUrl: imageUrl,
      prompt: String(opts.prompt || designMeta[slot].prompt || lastImagePrompt || '').trim(),
      aspectRatio: String(opts.aspectRatio || designMeta[slot].aspectRatio || '2:3'),
      resolution: String(opts.resolution || designMeta[slot].resolution || '2K'),
      savedAt: new Date().toISOString(),
    };
    var list = getSavedDesigns().filter(function (x) {
      return x && x.imageUrl !== item.imageUrl;
    });
    list.unshift(item);
    persistSavedDesigns(list);
    renderSavedLibrary();
    if (typeof window.showAppToast === 'function') {
      window.showAppToast('Design saved to library', { variant: 'success' });
    }
    return true;
  }

  function removeSavedDesign(id) {
    var list = getSavedDesigns().filter(function (x) {
      return x && x.id !== id;
    });
    persistSavedDesigns(list);
    renderSavedLibrary();
  }

  function loadSavedDesign(item) {
    if (!item || !item.imageUrl) return;
    var slot = item.slot === 'back' ? 'back' : 'front';
    var slotEl = document.getElementById('dmDesignSlot');
    if (slotEl) slotEl.value = slot;
    designMeta[slot] = {
      prompt: String(item.prompt || '').trim(),
      aspectRatio: String(item.aspectRatio || '2:3'),
      resolution: String(item.resolution || '2K'),
    };
    lastImagePrompt = designMeta[slot].prompt;
    setPreview(slot, item.imageUrl);
    showPromptEditor(slot, designMeta[slot].prompt);
    setDesignStatus('Loaded saved ' + slot + ' design.', true);
  }

  function renderSavedLibrary() {
    var root = document.getElementById('dmSavedLibrary');
    var countEl = document.getElementById('dmSavedCount');
    if (!root) return;
    var list = getSavedDesigns();
    if (countEl) countEl.textContent = list.length + ' saved';
    root.innerHTML = '';
    if (!list.length) {
      root.innerHTML =
        '<p class="col-span-3 text-[11px] text-brand-muted">Save a generated front or back to reuse later.</p>';
      return;
    }
    list.forEach(function (item) {
      var card = document.createElement('div');
      card.className = 'dm-saved-card';
      var img = document.createElement('img');
      img.src = item.imageUrl;
      img.alt = (item.slot || 'front') + ' saved design';
      card.appendChild(img);
      var actions = document.createElement('div');
      actions.className = 'dm-saved-card-actions';
      var loadBtn = document.createElement('button');
      loadBtn.type = 'button';
      loadBtn.className =
        'w-full rounded-md bg-brand-yellow text-brand-dark text-[9px] font-black uppercase tracking-widest py-1';
      loadBtn.textContent = 'Load';
      loadBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        loadSavedDesign(item);
      });
      var zoomBtn = document.createElement('button');
      zoomBtn.type = 'button';
      zoomBtn.className =
        'w-full rounded-md bg-white/90 text-brand-dark text-[9px] font-black uppercase tracking-widest py-1';
      zoomBtn.textContent = 'Zoom';
      zoomBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        openLightbox(item.slot || 'front', item.imageUrl, item.prompt);
      });
      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className =
        'w-full rounded-md bg-rose-600/90 text-white text-[9px] font-black uppercase tracking-widest py-1';
      delBtn.textContent = 'Remove';
      delBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        removeSavedDesign(item.id);
      });
      actions.appendChild(loadBtn);
      actions.appendChild(zoomBtn);
      actions.appendChild(delBtn);
      card.appendChild(actions);
      card.addEventListener('click', function () {
        loadSavedDesign(item);
      });
      root.appendChild(card);
    });
  }

  function openLightbox(slot, imageUrl, prompt) {
    var modal = document.getElementById('dmImageLightbox');
    var img = document.getElementById('dmLightboxImg');
    var title = document.getElementById('dmLightboxTitle');
    var meta = document.getElementById('dmLightboxMeta');
    var download = document.getElementById('dmLightboxDownload');
    if (!modal || !img) return;
    var url = imageUrl || designs[slot];
    if (!url) return;
    lightboxSlot = slot === 'back' ? 'back' : 'front';
    img.src = url;
    if (title) title.textContent = (lightboxSlot === 'back' ? 'Back' : 'Front') + ' postcard preview';
    var p = String(prompt || designMeta[lightboxSlot].prompt || lastImagePrompt || '').trim();
    if (meta) {
      meta.textContent = p ? p.slice(0, 140) + (p.length > 140 ? '…' : '') : 'Generated postcard art';
    }
    if (download) {
      download.href = url;
      download.setAttribute('download', 'postcard-' + lightboxSlot + '.jpg');
    }
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('overflow-hidden');
  }

  function closeLightbox() {
    var modal = document.getElementById('dmImageLightbox');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('overflow-hidden');
  }

  function setPreview(slot, imageUrl, meta) {
    var el = document.getElementById(slot === 'back' ? 'dmPreviewBack' : 'dmPreviewFront');
    var useCb = document.getElementById(slot === 'back' ? 'dmUseBack' : 'dmUseFront');
    var saveBtn = document.getElementById(slot === 'back' ? 'dmSaveBack' : 'dmSaveFront');
    if (!el) return;
    if (meta && typeof meta === 'object') {
      designMeta[slot] = Object.assign({}, designMeta[slot], meta);
    }
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
      if (saveBtn) saveBtn.classList.add('hidden');
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
    if (saveBtn) saveBtn.classList.remove('hidden');
    if (designMeta[slot].prompt) showPromptEditor(slot, designMeta[slot].prompt);
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
        var slot = currentDesignSlot();
        designMeta[slot].prompt = lastImagePrompt;
        showPromptEditor(slot, lastImagePrompt);
        setDesignStatus('Prompt ready — edit below or click Generate.', true);
      } else if (/make it|generate|go ahead|create it|design it|build it/i.test(text)) {
        setDesignStatus(
          'Ask in Chat for a “final image prompt,” or say “write the full GPT Image 2 prompt” — then click Generate when you see Prompt ready.',
          false,
        );
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

    var prompt =
      readPromptEditor() ||
      lastImagePrompt ||
      String((document.getElementById('dmChatInput') || {}).value || '').trim();
    if (!prompt) {
      setDesignStatus('Describe the design in Chat first, or paste a detailed image prompt here.', false);
      return;
    }
    if (!lastImagePrompt && prompt.length < 48) {
      setDesignStatus(
        'Use Chat to build a full image prompt first (e.g. describe the postcard, then ask for a “final image prompt”). Click Generate only after “Prompt ready.”',
        false,
      );
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
        designMeta[slot].prompt = prompt;
        designMeta[slot].aspectRatio = aspectRatio;
        designMeta[slot].resolution = resolution;
        setPreview(slot, data.imageUrl);
        lastImagePrompt = prompt;
        showPromptEditor(slot, prompt);
        setDesignStatus('Generated ' + slot + ' side — click preview to zoom.', true);
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
    var all = document.getElementById('dmCheckAll');
    if (!all) return;
    var boxes = getMailableDmCheckboxes();
    if (!boxes.length) {
      all.indeterminate = false;
      all.checked = false;
      return;
    }
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

  function getMailableDmCheckboxes() {
    return getDmCheckboxes().filter(function (cb) {
      return !cb.disabled;
    });
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
        if (!e.shiftKey) return;
        var cb =
          e.target && e.target.closest ? e.target.closest('#dmLeadsTable input.dm-lead-check') : null;
        if (cb) {
          e.preventDefault();
          e.stopPropagation();
          syncDmRowHighlights();
          return;
        }
        var row =
          e.target && e.target.closest
            ? e.target.closest('#dmLeadsTable tbody tr.result-row')
            : null;
        if (!row || !isDmRowClickTarget(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
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
      getMailableDmCheckboxes().forEach(function (cb) {
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
      getMailableDmCheckboxes().forEach(function (cb) {
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

  document.querySelectorAll('.dm-preview-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var slot = btn.getAttribute('data-slot') || 'front';
      if (!designs[slot]) return;
      openLightbox(slot);
    });
  });

  ['dmSaveFront', 'dmSaveBack'].forEach(function (id) {
    var btn = document.getElementById(id);
    if (!btn) return;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var slot = btn.getAttribute('data-slot') || 'front';
      saveDesignToLibrary(slot);
    });
  });

  var promptApply = document.getElementById('dmPromptApply');
  if (promptApply) promptApply.addEventListener('click', applyPromptFromEditor);

  var promptRegen = document.getElementById('dmPromptRegenerate');
  if (promptRegen) {
    promptRegen.addEventListener('click', function () {
      applyPromptFromEditor();
      generateImage();
    });
  }

  var slotEl = document.getElementById('dmDesignSlot');
  if (slotEl) {
    slotEl.addEventListener('change', function () {
      var slot = currentDesignSlot();
      if (designMeta[slot].prompt) showPromptEditor(slot, designMeta[slot].prompt);
      else {
        var wrap = document.getElementById('dmPromptEditorWrap');
        if (wrap) wrap.classList.add('hidden');
      }
    });
  }

  var lbClose = document.getElementById('dmLightboxClose');
  var lbBackdrop = document.getElementById('dmLightboxBackdrop');
  if (lbClose) lbClose.addEventListener('click', closeLightbox);
  if (lbBackdrop) lbBackdrop.addEventListener('click', closeLightbox);

  var lbSave = document.getElementById('dmLightboxSave');
  if (lbSave) {
    lbSave.addEventListener('click', function () {
      if (saveDesignToLibrary(lightboxSlot)) closeLightbox();
    });
  }

  var lbEdit = document.getElementById('dmLightboxEditPrompt');
  if (lbEdit) {
    lbEdit.addEventListener('click', function () {
      var slot = lightboxSlot;
      var slotSelect = document.getElementById('dmDesignSlot');
      if (slotSelect) slotSelect.value = slot;
      showPromptEditor(slot, designMeta[slot].prompt || lastImagePrompt);
      closeLightbox();
      var editor = document.getElementById('dmPromptEditor');
      if (editor) {
        editor.focus();
        editor.setSelectionRange(editor.value.length, editor.value.length);
      }
    });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      var modal = document.getElementById('dmImageLightbox');
      if (modal && !modal.classList.contains('hidden')) {
        e.preventDefault();
        closeLightbox();
      }
    }
  });

  renderSavedLibrary();

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
            personalizeOverlay: !((document.getElementById('dmPersonalizeOverlay') || {}).checked === false),
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

  syncDmRowHighlights();
  syncCheckAll();
  updateMergePreview();
})();
