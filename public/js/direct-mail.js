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
  var brandKit = {
    businessName: '',
    address: '',
    phone: '',
    hours: '',
    website: '',
    email: '',
    logoUrl: '',
    useLogoInDesign: true,
  };
  var brandKitSaveTimer = null;

  var DM_PLATFORMS = {
    postcard: { label: '4×6 Postcard', aspectRatio: '2:3', dualSided: true },
    instagram_feed: { label: 'Instagram Feed', aspectRatio: '1:1', dualSided: false },
    instagram_story: { label: 'Instagram Story / Reels', aspectRatio: '9:16', dualSided: false },
    instagram_portrait: { label: 'Instagram Portrait', aspectRatio: '4:5', dualSided: false },
    facebook_feed: { label: 'Facebook Feed', aspectRatio: '1:1', dualSided: false },
    facebook_cover: { label: 'Facebook Cover', aspectRatio: '16:9', dualSided: false },
    facebook_story: { label: 'Facebook Story', aspectRatio: '9:16', dualSided: false },
    linkedin_post: { label: 'LinkedIn Post', aspectRatio: '1:1', dualSided: false },
    linkedin_banner: { label: 'LinkedIn Banner', aspectRatio: '16:9', dualSided: false },
    google_display: { label: 'Google Display', aspectRatio: '16:9', dualSided: false },
    youtube_thumb: { label: 'YouTube Thumbnail', aspectRatio: '16:9', dualSided: false },
    custom: { label: 'Custom ratio', aspectRatio: null, dualSided: false },
  };

  try {
    var brandKitEl = document.getElementById('dm-brand-kit-json');
    if (brandKitEl) {
      var parsedKit = JSON.parse(brandKitEl.textContent || '{}');
      brandKit = Object.assign(brandKit, parsedKit || {});
    }
  } catch (_) {}

  function aspectRatioToCss(ratio) {
    var r = String(ratio || '2:3').trim();
    if (r === '1:1') return '1 / 1';
    if (r === '16:9') return '16 / 9';
    if (r === '9:16') return '9 / 16';
    if (r === '4:5') return '4 / 5';
    if (r === '3:2') return '3 / 2';
    if (r === 'auto') return '2 / 3';
    return '2 / 3';
  }

  function currentPlatformKey() {
    var el = document.getElementById('dmPlatform');
    var key = el && el.value ? String(el.value).trim() : 'postcard';
    return DM_PLATFORMS[key] ? key : 'custom';
  }

  function currentAspectRatio() {
    var ratioEl = document.getElementById('dmAspectRatio');
    return (ratioEl && ratioEl.value) || '2:3';
  }

  function applyPlatformPreset(platformKey) {
    var preset = DM_PLATFORMS[platformKey] || DM_PLATFORMS.custom;
    var ratioEl = document.getElementById('dmAspectRatio');
    var sideWrap = document.getElementById('dmSideWrap');
    var backCol = document.getElementById('dmPreviewBackCol');
    var previewGrid = document.getElementById('dmPreviewGrid');
    var previewHint = document.getElementById('dmPreviewHint');
    var ratio = preset.aspectRatio;

    if (ratio && ratioEl) {
      ratioEl.value = ratio;
      var hasOpt = Array.prototype.some.call(ratioEl.options, function (o) {
        return o.value === ratio;
      });
      if (!hasOpt) ratioEl.value = 'auto';
    }

    if (sideWrap) sideWrap.classList.toggle('hidden', !preset.dualSided);
    if (backCol) backCol.hidden = !preset.dualSided;
    if (previewGrid) {
      previewGrid.classList.toggle('grid-cols-1', !preset.dualSided);
      previewGrid.classList.toggle('grid-cols-2', !!preset.dualSided);
    }
    if (previewHint) {
      previewHint.textContent = preset.dualSided
        ? 'Switch Front / Back tabs above the canvas. Check sides to include when sending.'
        : 'Generated ' + preset.label + ' creative — zoom, save, or send when ready.';
    }

    syncStudioFormatPill(platformKey);
    syncStudioPageView();
    updatePreviewAspectRatio();
  }

  function updatePreviewAspectRatio() {
    var css = aspectRatioToCss(currentAspectRatio());
    document.querySelectorAll('.dm-artboard, .dm-preview-btn').forEach(function (btn) {
      if (btn) btn.style.aspectRatio = css;
    });
  }

  var studioZoom = 1;
  var studioZoomFocusBtn = null;

  function setStudioZoom(value, focusBtn) {
    studioZoom = Math.min(2.5, Math.max(0.5, value));
    var scaler = document.getElementById('dmCanvasScaler');
    var viewport = document.getElementById('dmCanvasViewport');
    var label = document.getElementById('dmZoomLabel');
    if (scaler) {
      scaler.style.zoom = studioZoom === 1 ? '' : String(studioZoom);
      scaler.style.setProperty('--dm-zoom', String(studioZoom));
    }
    if (viewport) {
      viewport.classList.toggle('is-canvas-zoomed', studioZoom > 1.02);
    }
    if (label) label.textContent = Math.round(studioZoom * 100) + '%';
    if (focusBtn) studioZoomFocusBtn = focusBtn;
    if (studioZoom > 1.02 && (focusBtn || studioZoomFocusBtn)) {
      centerCanvasOnArtboard(focusBtn || studioZoomFocusBtn);
    }
    syncPreviewZoomBadges();
  }

  function centerCanvasOnArtboard(btn) {
    var viewport = document.getElementById('dmCanvasViewport');
    if (!viewport || !btn) return;
    window.requestAnimationFrame(function () {
      var vRect = viewport.getBoundingClientRect();
      var bRect = btn.getBoundingClientRect();
      var nextLeft =
        viewport.scrollLeft + (bRect.left + bRect.width / 2) - (vRect.left + vRect.width / 2);
      var nextTop =
        viewport.scrollTop + (bRect.top + bRect.height / 2) - (vRect.top + vRect.height / 2);
      viewport.scrollTo({
        left: Math.max(0, nextLeft),
        top: Math.max(0, nextTop),
        behavior: 'smooth',
      });
    });
  }

  function syncPreviewZoomBadges() {
    document.querySelectorAll('.dm-preview-zoom-badge').forEach(function (badge) {
      badge.textContent = studioZoom > 1.02 ? 'Click to reset zoom' : 'Click to zoom in';
    });
  }

  function syncStudioFormatPill(platformKey) {
    var pill = document.getElementById('dmStudioFormatPill');
    var preset = DM_PLATFORMS[platformKey] || DM_PLATFORMS.custom;
    if (pill) pill.textContent = preset.label || 'Custom';
    document.querySelectorAll('.dm-format-card').forEach(function (card) {
      var key = card.getAttribute('data-dm-platform') || '';
      card.classList.toggle('is-selected', key === platformKey);
    });
  }

  function syncStudioPageView() {
    var slot = currentDesignSlot();
    var preset = DM_PLATFORMS[currentPlatformKey()] || DM_PLATFORMS.custom;
    var pageTabs = document.getElementById('dmPageTabs');
    var frontBtn = document.getElementById('dmPreviewFrontBtn');
    var backBtn = document.getElementById('dmPreviewBackBtn');
    var frontActions = document.getElementById('dmPreviewFrontCol');
    var backActions = document.getElementById('dmPreviewBackCol');

    if (pageTabs) pageTabs.classList.toggle('hidden', !preset.dualSided);
    if (frontActions) frontActions.hidden = !preset.dualSided && slot !== 'front';
    if (backActions) backActions.hidden = !preset.dualSided;

    if (!preset.dualSided) {
      if (frontBtn) {
        frontBtn.hidden = false;
        frontBtn.classList.add('is-active-page');
      }
      if (backBtn) backBtn.hidden = true;
      return;
    }

    if (frontBtn) {
      frontBtn.hidden = slot !== 'front';
      frontBtn.classList.toggle('is-active-page', slot === 'front');
    }
    if (backBtn) {
      backBtn.hidden = slot !== 'back';
      backBtn.classList.toggle('is-active-page', slot === 'back');
    }
    document.querySelectorAll('.dm-page-tab').forEach(function (tab) {
      var page = tab.getAttribute('data-dm-page') || 'front';
      var active = page === slot;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    if (frontActions) frontActions.hidden = slot !== 'front';
    if (backActions) backActions.hidden = slot !== 'back';
  }

  function bindStudioUi() {
    document.querySelectorAll('.dm-rail-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tab = btn.getAttribute('data-dm-tab');
        if (!tab) return;
        document.querySelectorAll('.dm-rail-btn').forEach(function (b) {
          b.classList.toggle('is-active', b === btn);
        });
        document.querySelectorAll('.dm-drawer-panel').forEach(function (panel) {
          var match = panel.getAttribute('data-dm-panel') === tab;
          panel.classList.toggle('is-active', match);
          panel.hidden = !match;
        });
      });
    });

    document.querySelectorAll('.dm-format-card').forEach(function (card) {
      card.addEventListener('click', function () {
        var key = card.getAttribute('data-dm-platform') || 'postcard';
        var platformEl = document.getElementById('dmPlatform');
        if (platformEl) {
          platformEl.value = key;
          platformEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    });

    document.querySelectorAll('.dm-page-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        var page = tab.getAttribute('data-dm-page') || 'front';
        var slotEl = document.getElementById('dmDesignSlot');
        if (slotEl) {
          slotEl.value = page;
          slotEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
        syncStudioPageView();
      });
    });

    var zoomIn = document.getElementById('dmZoomIn');
    var zoomOut = document.getElementById('dmZoomOut');
    var zoomFit = document.getElementById('dmZoomFit');
    if (zoomIn) zoomIn.addEventListener('click', function () { setStudioZoom(studioZoom + 0.1); });
    if (zoomOut) zoomOut.addEventListener('click', function () { setStudioZoom(studioZoom - 0.1); });
    if (zoomFit) {
      zoomFit.addEventListener('click', function () {
        studioZoomFocusBtn = null;
        setStudioZoom(1);
      });
    }
    setStudioZoom(1);

    bindStudioFullscreen();
    bindPromptPanelResizer();
    bindPreviewZoomHandlers();
    refreshStudioAiStatus();
  }

  function bindPreviewZoomHandlers() {
    var viewport = document.getElementById('dmCanvasViewport');
    if (!viewport || viewport.dataset.dmZoomBound === '1') return;
    viewport.dataset.dmZoomBound = '1';
    viewport.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('.dm-preview-btn') : null;
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      handlePreviewZoomClick(btn);
    });
  }

  function bindPromptPanelResizer() {
    var resizer = document.getElementById('dmPromptResizer');
    var dock = document.getElementById('dmPromptDock');
    if (!resizer || !dock) return;

    var stored = 0;
    try {
      stored = parseInt(localStorage.getItem('adhello_dm_prompt_h') || '0', 10);
    } catch (_) {}
    if (stored >= 120 && stored <= 520) {
      dock.style.setProperty('--dm-prompt-h', stored + 'px');
    }

    var dragging = false;
    var startY = 0;
    var startH = 0;

    function onMove(e) {
      if (!dragging) return;
      var clientY = e.touches ? e.touches[0].clientY : e.clientY;
      var delta = startY - clientY;
      var next = Math.min(520, Math.max(120, startH + delta));
      dock.style.setProperty('--dm-prompt-h', next + 'px');
    }

    function onUp() {
      if (!dragging) return;
      dragging = false;
      resizer.classList.remove('is-dragging');
      document.body.classList.remove('dm-prompt-resize-active');
      var h = parseInt(getComputedStyle(dock).height, 10);
      if (h >= 120) {
        try {
          localStorage.setItem('adhello_dm_prompt_h', String(h));
        } catch (_) {}
      }
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    }

    function onDown(e) {
      dragging = true;
      startY = e.touches ? e.touches[0].clientY : e.clientY;
      startH = dock.getBoundingClientRect().height;
      resizer.classList.add('is-dragging');
      document.body.classList.add('dm-prompt-resize-active');
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      window.addEventListener('touchmove', onMove, { passive: false });
      window.addEventListener('touchend', onUp);
      e.preventDefault();
    }

    resizer.addEventListener('mousedown', onDown);
    resizer.addEventListener('touchstart', onDown, { passive: false });
  }

  async function refreshStudioAiStatus() {
    try {
      var res = await fetch('/direct-mail/api/status', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!data || !data.success) return;
      if (!data.kieImageReady) {
        setDesignStatus(
          'KIE image key missing on server — set KIE_AI_API_KEY in Render env for Generate to work.',
          false,
        );
      } else if (!data.chatReady) {
        setDesignStatus(
          'Chat AI not configured — set OPENROUTER_API_KEY (or KIE/Gemini/OpenAI) on the server.',
          false,
        );
      }
    } catch (_) {}
  }

  function syncFullscreenUi(isOn) {
    document.querySelectorAll('.dm-fullscreen-btn, .dm-fullscreen-btn-canvas').forEach(function (btn) {
      btn.setAttribute('aria-pressed', isOn ? 'true' : 'false');
      btn.title = isOn ? 'Exit full screen' : 'Full screen studio';
      var expand = btn.querySelector('.dm-fs-icon-expand');
      var compress = btn.querySelector('.dm-fs-icon-compress');
      if (expand) expand.classList.toggle('hidden', isOn);
      if (compress) compress.classList.toggle('hidden', !isOn);
    });
    var label = document.querySelector('.dm-fullscreen-label');
    if (label) label.textContent = isOn ? 'Exit' : 'Full screen';
  }

  function setStudioFullscreen(on) {
    var shell = document.getElementById('dmStudioShell');
    if (!shell) return;
    var enable = !!on;
    shell.classList.toggle('dm-studio-shell--fullscreen', enable);
    document.body.classList.toggle('dm-studio-fullscreen-active', enable);
    syncFullscreenUi(enable);
  }

  function toggleStudioFullscreen() {
    var shell = document.getElementById('dmStudioShell');
    if (!shell) return;
    setStudioFullscreen(!document.body.classList.contains('dm-studio-fullscreen-active'));
  }

  function bindStudioFullscreen() {
    var topBtn = document.getElementById('dmFullscreenBtn');
    var canvasBtn = document.getElementById('dmFullscreenBtnCanvas');
    if (topBtn) topBtn.addEventListener('click', toggleStudioFullscreen);
    if (canvasBtn) canvasBtn.addEventListener('click', toggleStudioFullscreen);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && document.body.classList.contains('dm-studio-fullscreen-active')) {
        setStudioFullscreen(false);
      }
    });
  }

  function readBrandKitFromForm() {
    return {
      businessName: String((document.getElementById('dmBrandName') || {}).value || '').trim(),
      phone: String((document.getElementById('dmBrandPhone') || {}).value || '').trim(),
      email: String((document.getElementById('dmBrandEmail') || {}).value || '').trim(),
      website: String((document.getElementById('dmBrandWebsite') || {}).value || '').trim(),
      address: String((document.getElementById('dmBrandAddress') || {}).value || '').trim(),
      hours: String((document.getElementById('dmBrandHours') || {}).value || '').trim(),
      logoUrl: String(brandKit.logoUrl || '').trim(),
      useLogoInDesign: !((document.getElementById('dmBrandUseLogo') || {}).checked === false),
    };
  }

  function setBrandSaveStatus(text, ok) {
    var el = document.getElementById('dmBrandSaveStatus');
    if (!el) return;
    el.textContent = String(text || '');
    el.classList.toggle('text-emerald-700', !!ok);
    el.classList.toggle('dark:text-emerald-300', !!ok);
    el.classList.toggle('text-rose-700', ok === false);
    el.classList.toggle('dark:text-rose-300', ok === false);
  }

  function renderBrandLogoPreview(url) {
    var box = document.getElementById('dmBrandLogoPreview');
    if (!box) return;
    box.innerHTML = '';
    if (!url) {
      var span = document.createElement('span');
      span.className = 'text-[9px] text-brand-muted px-1 text-center';
      span.textContent = 'No logo';
      box.appendChild(span);
      return;
    }
    var img = document.createElement('img');
    img.src = url;
    img.alt = 'Business logo';
    img.className = 'max-w-full max-h-full object-contain';
    box.appendChild(img);
  }

  function scheduleBrandKitSave() {
    clearTimeout(brandKitSaveTimer);
    brandKitSaveTimer = setTimeout(saveBrandKitFields, 1200);
  }

  async function saveBrandKitFields() {
    var payload = readBrandKitFromForm();
    setBrandSaveStatus('Saving…', true);
    try {
      var res = await fetch('/direct-mail/api/brand-kit', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data.success) throw new Error((data && data.error) || 'Could not save business info.');
      brandKit = Object.assign(brandKit, data.brandKit || payload);
      setBrandSaveStatus('Saved', true);
    } catch (e) {
      setBrandSaveStatus((e && e.message) || 'Save failed', false);
    }
  }

  async function uploadBrandLogo(file) {
    if (!file) return;
    setBrandSaveStatus('Uploading logo…', true);
    var fd = new FormData();
    fd.append('logo', file);
    try {
      var res = await fetch('/direct-mail/api/brand-kit/logo', {
        method: 'POST',
        credentials: 'same-origin',
        body: fd,
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data.success) throw new Error((data && data.error) || 'Logo upload failed.');
      brandKit = Object.assign(brandKit, data.brandKit || {});
      renderBrandLogoPreview(brandKit.logoUrl);
      setBrandSaveStatus('Logo uploaded', true);
      if (typeof window.showAppToast === 'function') {
        window.showAppToast('Logo uploaded', { variant: 'success' });
      }
    } catch (e) {
      setBrandSaveStatus((e && e.message) || 'Logo upload failed', false);
    }
  }

  function bindBrandKitUi() {
    document.querySelectorAll('.dm-brand-field').forEach(function (field) {
      field.addEventListener('input', scheduleBrandKitSave);
    });
    var saveBtn = document.getElementById('dmBrandSaveBtn');
    if (saveBtn) saveBtn.addEventListener('click', saveBrandKitFields);
    var logoInput = document.getElementById('dmBrandLogoInput');
    if (logoInput) {
      logoInput.addEventListener('change', function () {
        if (logoInput.files && logoInput.files[0]) uploadBrandLogo(logoInput.files[0]);
        logoInput.value = '';
      });
    }
    var useLogo = document.getElementById('dmBrandUseLogo');
    if (useLogo) useLogo.addEventListener('change', scheduleBrandKitSave);
    renderBrandLogoPreview(brandKit.logoUrl);
  }

  function designRequestContext() {
    var ctx = copyContext();
    return Object.assign(ctx, {
      platform: currentPlatformKey(),
      aspectRatio: currentAspectRatio(),
      brandKit: readBrandKitFromForm(),
    });
  }

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

  function formatApiError(data, fallback, res) {
    var err = data && data.error;
    if (typeof err === 'string' && err.trim()) return err.trim();
    if (err && typeof err === 'object' && err.message) return String(err.message);
    if (data && typeof data.msg === 'string' && data.msg.trim()) return data.msg.trim();
    if (data && typeof data.message === 'string' && data.message.trim()) return data.message.trim();
    if (res && !res.ok) {
      if (res.status === 502) {
        return 'Image service unavailable. Verify KIE_AI_API_KEY is set on the server and try again.';
      }
      if (res.status === 401 || res.status === 403) {
        return 'Not authorized — refresh the page and sign in again.';
      }
      return 'Request failed (HTTP ' + res.status + ').';
    }
    return fallback || 'Request failed';
  }

  function setDesignStatus(text, ok) {
    var el = document.getElementById('dmDesignStatus');
    if (!el) return;
    var msg = text == null ? '' : String(text);
    if (!msg || msg === 'true' || msg === 'false') {
      el.classList.add('hidden');
      el.textContent = '';
      el.classList.remove('text-rose-700', 'dark:text-rose-300', 'text-emerald-700', 'dark:text-emerald-300');
      el.classList.add('text-brand-muted');
      return;
    }
    el.textContent = msg;
    el.classList.remove('hidden', 'text-emerald-700', 'text-rose-700', 'dark:text-emerald-300', 'dark:text-rose-300', 'text-brand-muted');
    el.classList.add(ok ? 'text-emerald-700' : 'text-rose-700', ok ? 'dark:text-emerald-300' : 'dark:text-rose-300');
  }

  function userWantsAdGeneration(text) {
    return /make\s+(an?\s+)?(ad|add)|create\s+(an?\s+)?(ad|add)|design\s+(an?\s+)?(ad|add)|generate|go ahead|make it|build it|design it/i.test(
      String(text || ''),
    );
  }

  function buildQuickImagePrompt(userText, ctx) {
    ctx = ctx || designRequestContext();
    var kit = ctx.brandKit || {};
    var plat = DM_PLATFORMS[ctx.platform] || DM_PLATFORMS.custom;
    var parts = [
      'Professional ' + plat.label + ' ad creative, ' + ctx.aspectRatio + ' aspect ratio.',
      'Polished local-business marketing design with strong headline area and clear contact block.',
    ];
    if (kit.businessName) parts.push('Business name: ' + kit.businessName + '.');
    if (userText) parts.push('Creative brief: ' + userText + '.');
    if (kit.phone) parts.push('Display phone ' + kit.phone + ' prominently.');
    if (kit.website) parts.push('Include website ' + kit.website + '.');
    if (kit.email) parts.push('Include email ' + kit.email + '.');
    if (kit.address) parts.push('Include address ' + kit.address + '.');
    if (kit.hours) parts.push('Include business hours: ' + kit.hours + '.');
    if (kit.logoUrl && kit.useLogoInDesign) parts.push('Incorporate the brand logo tastefully.');
    parts.push('High contrast, readable at mobile size, modern trustworthy aesthetic, no watermarks.');
    return parts.join(' ');
  }

  function latestUserChatText() {
    for (var i = chatHistory.length - 1; i >= 0; i -= 1) {
      if (chatHistory[i] && chatHistory[i].role === 'user' && chatHistory[i].content) {
        return String(chatHistory[i].content).trim();
      }
    }
    return '';
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

  function readOptionalCtaUrl() {
    var el = document.getElementById('dmCtaUrl');
    return el ? String(el.value || '').trim() : '';
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
    var ctaUrl = readOptionalCtaUrl();
    var cta = ctaUrl ? applyMergeFieldsClient(ctaUrl, ctx) : '';
    var parts = [];
    if (headline) parts.push('Headline: “' + headline + '”');
    if (body) parts.push('Body: “' + body.slice(0, 80) + (body.length > 80 ? '…' : '') + '”');
    if (cta) parts.push('URL: “' + cta.slice(0, 60) + (cta.length > 60 ? '…' : '') + '”');
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
      ctaUrl: readOptionalCtaUrl(),
      slot: (document.getElementById('dmDesignSlot') || {}).value || 'front',
    };
  }

  function appendChatBubble(role, text) {
    var log = document.getElementById('dmChatLog');
    if (!log || !text) return;
    var intro = log.querySelector('.dm-chat-welcome') || log.querySelector('.text-brand-muted.leading-relaxed');
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
      if (wrap.classList.contains('dm-prompt-editor-wrap')) {
        editor.value = '';
        return;
      }
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
      aspectRatio: String(opts.aspectRatio || designMeta[slot].aspectRatio || currentAspectRatio()),
      resolution: String(opts.resolution || designMeta[slot].resolution || '2K'),
      platform: String(opts.platform || currentPlatformKey()),
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
    if (item.platform) {
      var platformEl = document.getElementById('dmPlatform');
      if (platformEl && DM_PLATFORMS[item.platform]) {
        platformEl.value = item.platform;
        applyPlatformPreset(item.platform);
      }
    }
    if (item.aspectRatio) {
      var ratioEl = document.getElementById('dmAspectRatio');
      if (ratioEl) ratioEl.value = item.aspectRatio;
      updatePreviewAspectRatio();
    }
    designMeta[slot] = {
      prompt: String(item.prompt || '').trim(),
      aspectRatio: String(item.aspectRatio || currentAspectRatio()),
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
      zoomBtn.textContent = 'Zoom in';
      zoomBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        loadSavedDesign(item);
        window.requestAnimationFrame(function () {
          var slot = item.slot === 'back' ? 'back' : 'front';
          var btn = document.getElementById(slot === 'back' ? 'dmPreviewBackBtn' : 'dmPreviewFrontBtn');
          if (btn) setStudioZoom(1.85, btn);
        });
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
    if (title) {
      var plat = DM_PLATFORMS[currentPlatformKey()] || DM_PLATFORMS.custom;
      title.textContent =
        (lightboxSlot === 'back' ? 'Back' : plat.dualSided ? 'Front' : plat.label) + ' preview';
    }
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
      span.className = 'dm-artboard-empty';
      span.textContent =
        slot === 'back' ? 'No back yet — generate or switch to Front' : 'No front yet — describe your design and generate';
      el.appendChild(span);
      if (useCb) {
        useCb.checked = false;
        useCb.disabled = true;
      }
      if (saveBtn) saveBtn.classList.add('hidden');
      var emptyBoard = document.getElementById(slot === 'back' ? 'dmPreviewBackBtn' : 'dmPreviewFrontBtn');
      if (emptyBoard) emptyBoard.classList.remove('has-image');
      return;
    }
    var img = document.createElement('img');
    img.src = imageUrl;
    img.alt = slot + ' postcard design';
    img.className = 'w-full h-full object-cover';
    el.appendChild(img);
    var artboardBtn = document.getElementById(slot === 'back' ? 'dmPreviewBackBtn' : 'dmPreviewFrontBtn');
    if (artboardBtn) artboardBtn.classList.add('has-image');
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
      throw new Error(formatApiError(data, 'Request failed', res));
    }
    return data;
  }

  function previewUrlForSlot(slot, btn) {
    var key = slot === 'back' ? 'back' : 'front';
    if (designs[key]) return designs[key];
    var host = btn || document.getElementById(key === 'back' ? 'dmPreviewBackBtn' : 'dmPreviewFrontBtn');
    if (!host) return '';
    var img = host.querySelector('img');
    return img && img.src ? img.src : '';
  }

  function handlePreviewZoomClick(btn) {
    if (!btn) return;
    var slot = btn.getAttribute('data-slot') || 'front';
    var url = previewUrlForSlot(slot, btn);
    if (!url || /^data:/.test(url)) {
      setDesignStatus('Generate a design first, then click the preview to zoom in on the canvas.', false);
      return;
    }
    if (studioZoom > 1.02) {
      studioZoomFocusBtn = null;
      setStudioZoom(1);
      setDesignStatus('Canvas zoom reset to 100%.', true);
      return;
    }
    setStudioZoom(1.85, btn);
    setDesignStatus('Zoomed in on canvas — use Fit or click the preview again to reset.', true);
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
      var ctx = designRequestContext();
      var data = await postJson('/direct-mail/api/design-chat', {
        message: text,
        history: chatHistory.slice(0, -1),
        headline: ctx.headline,
        bodyText: ctx.bodyText,
        ctaUrl: ctx.ctaUrl,
        slot: ctx.slot,
        platform: ctx.platform,
        aspectRatio: ctx.aspectRatio,
        brandKit: ctx.brandKit,
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
      } else if (userWantsAdGeneration(text)) {
        setDesignStatus(
          'Chat could not build a prompt — click Generate and we will compose one from your brief and business info.',
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
      (designMeta[currentDesignSlot()] && designMeta[currentDesignSlot()].prompt) ||
      String((document.getElementById('dmChatInput') || {}).value || '').trim() ||
      latestUserChatText();
    var ctx = designRequestContext();
    if (!prompt) {
      setDesignStatus('Describe the design in Chat first, or paste a detailed image prompt here.', false);
      return;
    }
    if (!lastImagePrompt && prompt.length < 48) {
      if (userWantsAdGeneration(prompt) || userWantsAdGeneration(latestUserChatText())) {
        prompt = buildQuickImagePrompt(prompt || latestUserChatText(), ctx);
        lastImagePrompt = prompt;
        showPromptEditor(currentDesignSlot(), prompt);
      } else {
        setDesignStatus(
          'Use Chat to build a full image prompt first, or ask to “make an ad” — then click Generate.',
          false,
        );
        return;
      }
    }

    var slot = slotEl && slotEl.value === 'back' ? 'back' : 'front';
    var aspectRatio = currentAspectRatio();
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
        platform: ctx.platform,
        brandKit: ctx.brandKit,
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
        setDesignStatus('Generated ' + slot + ' side — click the preview to zoom in on the canvas.', true);
        if (typeof window.showAppToast === 'function') {
          var plat = DM_PLATFORMS[currentPlatformKey()] || DM_PLATFORMS.custom;
          window.showAppToast((plat.dualSided ? 'Postcard ' + slot : plat.label) + ' generated', {
            variant: 'success',
          });
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
      syncStudioPageView();
      if (designMeta[slot].prompt) showPromptEditor(slot, designMeta[slot].prompt);
      else {
        var editor = document.getElementById('dmPromptEditor');
        if (editor) editor.value = '';
      }
    });
  }

  var platformEl = document.getElementById('dmPlatform');
  if (platformEl) {
    platformEl.addEventListener('change', function () {
      applyPlatformPreset(currentPlatformKey());
    });
    applyPlatformPreset(currentPlatformKey());
  }

  var ratioEl = document.getElementById('dmAspectRatio');
  if (ratioEl) ratioEl.addEventListener('change', updatePreviewAspectRatio);

  bindBrandKitUi();
  bindStudioUi();

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
            ctaUrl: readOptionalCtaUrl(),
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
