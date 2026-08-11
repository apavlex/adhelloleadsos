/**
 * Workspace info pack settings — folder + default save, playbook images.
 */
(function () {
  'use strict';

  var playbookPromptsByForm = {};

  function $(id) {
    return document.getElementById(id);
  }

  function readPackFromForm(prefix) {
    return {
      sms: {
        enabled: !!($(prefix + 'SmsEnabled') && $(prefix + 'SmsEnabled').checked),
        body: String(($(prefix + 'SmsBody') || {}).value || '').trim(),
      },
      email: {
        enabled: !!($(prefix + 'EmailEnabled') && $(prefix + 'EmailEnabled').checked),
        subject: String(($(prefix + 'EmailSubject') || {}).value || '').trim(),
        body: String(($(prefix + 'EmailBody') || {}).value || '').trim(),
      },
      directMail: {
        enabled: !!($(prefix + 'DmEnabled') && $(prefix + 'DmEnabled').checked),
        playbookId: String(($(prefix + 'PlaybookId') || {}).value || '').trim(),
        headline: String(($(prefix + 'DmHeadline') || {}).value || '').trim(),
        bodyText: String(($(prefix + 'DmBodyText') || {}).value || '').trim(),
        ctaUrl: String(($(prefix + 'DmCtaUrl') || {}).value || '').trim(),
        frontImageUrl: String(($(prefix + 'DmFrontImageUrl') || {}).value || '').trim(),
        backImageUrl: String(($(prefix + 'DmBackImageUrl') || {}).value || '').trim(),
        personalizeOverlay: !($(prefix + 'DmPersonalizeOverlay') && !$(prefix + 'DmPersonalizeOverlay').checked),
        includeLobQr: !($(prefix + 'DmIncludeLobQr') && !$(prefix + 'DmIncludeLobQr').checked),
      },
    };
  }

  function writePackToForm(prefix, pack) {
    const p = pack && typeof pack === 'object' ? pack : {};
    const sms = p.sms || {};
    const email = p.email || {};
    const dm = p.directMail || {};
    if ($(prefix + 'SmsEnabled')) $(prefix + 'SmsEnabled').checked = !!sms.enabled;
    if ($(prefix + 'SmsBody')) $(prefix + 'SmsBody').value = sms.body || '';
    if ($(prefix + 'EmailEnabled')) $(prefix + 'EmailEnabled').checked = !!email.enabled;
    if ($(prefix + 'EmailSubject')) $(prefix + 'EmailSubject').value = email.subject || '';
    if ($(prefix + 'EmailBody')) $(prefix + 'EmailBody').value = email.body || '';
    if ($(prefix + 'DmEnabled')) $(prefix + 'DmEnabled').checked = !!dm.enabled;
    if ($(prefix + 'PlaybookId')) $(prefix + 'PlaybookId').value = dm.playbookId || '';
    if ($(prefix + 'DmHeadline')) $(prefix + 'DmHeadline').value = dm.headline || '';
    if ($(prefix + 'DmBodyText')) $(prefix + 'DmBodyText').value = dm.bodyText || '';
    if ($(prefix + 'DmCtaUrl')) $(prefix + 'DmCtaUrl').value = dm.ctaUrl || '';
    if ($(prefix + 'DmFrontImageUrl')) $(prefix + 'DmFrontImageUrl').value = dm.frontImageUrl || '';
    if ($(prefix + 'DmBackImageUrl')) $(prefix + 'DmBackImageUrl').value = dm.backImageUrl || '';
    if ($(prefix + 'DmPersonalizeOverlay')) $(prefix + 'DmPersonalizeOverlay').checked = dm.personalizeOverlay !== false;
    if ($(prefix + 'DmIncludeLobQr')) $(prefix + 'DmIncludeLobQr').checked = dm.includeLobQr !== false;
    syncDmPreview(prefix, 'front');
    syncDmPreview(prefix, 'back');
  }

  function syncDmPreview(prefix, side) {
    var input = $(prefix + (side === 'back' ? 'DmBackImageUrl' : 'DmFrontImageUrl'));
    var img = $(prefix + (side === 'back' ? 'DmBackPreview' : 'DmFrontPreview'));
    if (!input || !img) return;
    var url = String(input.value || '').trim();
    if (/^https?:\/\//i.test(url)) {
      img.src = url;
      img.classList.remove('hidden');
    } else {
      img.removeAttribute('src');
      img.classList.add('hidden');
    }
  }

  function setGenerateStatus(prefix, text, ok) {
    var el = $(prefix + 'DmGenerateStatus');
    if (!el) return;
    el.classList.remove('hidden');
    el.textContent = text || '';
    el.className = 'text-[11px] ' + (ok ? 'text-brand-muted' : 'text-rose-600 dark:text-rose-400');
  }

  function buildBackCompanionPrompt(frontPrompt) {
    var front = String(frontPrompt || '').trim();
    return (
      'Postcard back design matching the front creative reference. Same color palette, typography, photography style, and brand mood. ' +
      'Layout for 4×6 postcard back: short bullet benefits, trust cues, and clear QR scan CTA zone (bottom-right). ' +
      'Keep Lob address/postage area at bottom clear of text. ' +
      (front ? 'Front concept: ' + front.slice(0, 220) : '')
    );
  }

  async function pollImageGeneration(taskId) {
    var deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      await new Promise(function (resolve) {
        setTimeout(resolve, 4000);
      });
      var res = await fetch(
        '/direct-mail/api/generate-image/status?taskId=' + encodeURIComponent(taskId),
        { credentials: 'same-origin', headers: { Accept: 'application/json' } },
      );
      var data = await res.json().catch(function () {
        return {};
      });
      if (data.status === 'success' && data.imageUrl) return data;
      if (!res.ok || data.status === 'failed' || data.success === false) {
        throw new Error((data && data.error) || 'Image generation failed');
      }
    }
    throw new Error('Image generation timed out');
  }

  async function generateImageSlot(prompt, slot, brandKit, styleReferenceUrl) {
    var body = {
      prompt: prompt,
      slot: slot,
      platform: 'postcard',
      aspectRatio: '3:2',
      resolution: '2K',
      brandKit: brandKit || {},
      matchFrontStyle: slot === 'back' && !!styleReferenceUrl,
    };
    if (styleReferenceUrl) body.styleReferenceUrl = styleReferenceUrl;
    var res = await fetch('/direct-mail/api/generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });
    var data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok || !data.success) {
      throw new Error((data && data.error) || 'Could not start image generation');
    }
    if (data.status === 'processing' && data.taskId) {
      if (window.agencyOsArtworkGen && typeof window.agencyOsArtworkGen.track === 'function') {
        var genLabel = slot === 'back' ? 'Postcard back' : 'Postcard front';
        window.agencyOsArtworkGen.track({
          taskId: data.taskId,
          slot: slot,
          platform: 'postcard',
          label: genLabel,
          prompt: prompt,
          aspectRatio: '3:2',
          resolution: '2K',
        });
        if (typeof window.showAppToast === 'function') {
          window.showAppToast(
            'Generating ' + genLabel + ' — bell will notify when ready. Safe to browse other pages.',
            { variant: 'info', duration: 7500 },
          );
        }
        data = await window.agencyOsArtworkGen.waitFor(data.taskId);
        if (!data || data.success === false) {
          throw new Error((data && data.error) || 'Image generation failed');
        }
      } else {
        data = await pollImageGeneration(data.taskId);
      }
    }
    if (!data.imageUrl) throw new Error('No image URL returned');
    return data.imageUrl;
  }

  async function applyPlaybookToForm(prefix, playbookId) {
    if (!playbookId) return;
    try {
      var res = await fetch('/direct-mail/api/playbooks/' + encodeURIComponent(playbookId), {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      var data = await res.json();
      if (!data.success || !data.playbook) return;
      var pb = data.playbook;
      if ($(prefix + 'DmHeadline') && pb.headline) $(prefix + 'DmHeadline').value = pb.headline;
      if ($(prefix + 'DmBodyText') && (pb.body || pb.bodyText)) {
        $(prefix + 'DmBodyText').value = pb.body || pb.bodyText;
      }
      if ($(prefix + 'DmCtaUrl') && pb.ctaUrl) $(prefix + 'DmCtaUrl').value = pb.ctaUrl;
      if ($(prefix + 'DmPersonalizeOverlay') && pb.personalizeOverlay != null) {
        $(prefix + 'DmPersonalizeOverlay').checked = !!pb.personalizeOverlay;
      }
      playbookPromptsByForm[prefix] = {
        front: pb.imagePromptFront || '',
        back: pb.imagePromptBack || '',
      };
    } catch (_) {
      /* optional */
    }
  }

  async function generatePostcardImages(prefix) {
    var boot = window.INFO_PACK_BOOT || {};
    if (!boot.kieImageReady) {
      setGenerateStatus(prefix, 'KIE image API not configured on server.', false);
      return;
    }
    var playbookId = String(($(prefix + 'PlaybookId') || {}).value || '').trim();
    if (playbookId && !playbookPromptsByForm[prefix]) {
      await applyPlaybookToForm(prefix, playbookId);
    }
    var prompts = playbookPromptsByForm[prefix] || {};
    var frontPrompt = String(prompts.front || '').trim();
    var backPrompt = String(prompts.back || '').trim();
    if (!frontPrompt) {
      setGenerateStatus(prefix, 'Select a playbook with image prompts first.', false);
      return;
    }
    if (!backPrompt) backPrompt = buildBackCompanionPrompt(frontPrompt);

    var btn = $(prefix + 'DmGenerateImages');
    if (btn) btn.disabled = true;
    setGenerateStatus(prefix, 'Generating front… (up to 2 min)', true);

    try {
      var brandRes = await fetch('/direct-mail/api/brand-kit', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      var brandData = await brandRes.json().catch(function () {
        return {};
      });
      var brandKit = (brandData && brandData.brandKit) || {};

      var frontUrl = await generateImageSlot(frontPrompt, 'front', brandKit, '');
      if ($(prefix + 'DmFrontImageUrl')) $(prefix + 'DmFrontImageUrl').value = frontUrl;
      syncDmPreview(prefix, 'front');

      setGenerateStatus(prefix, 'Front done — generating back…', true);
      var backUrl = await generateImageSlot(backPrompt, 'back', brandKit, frontUrl);
      if ($(prefix + 'DmBackImageUrl')) $(prefix + 'DmBackImageUrl').value = backUrl;
      syncDmPreview(prefix, 'back');

      setGenerateStatus(prefix, 'Front and back images generated.', true);
      if (typeof window.showAppToast === 'function') {
        window.showAppToast('Postcard images generated', { variant: 'success' });
      }
    } catch (err) {
      setGenerateStatus(prefix, (err && err.message) || 'Generation failed.', false);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function bindPlaybookAndImages(prefix) {
    var playbookEl = $(prefix + 'PlaybookId');
    if (playbookEl) {
      playbookEl.addEventListener('change', function () {
        applyPlaybookToForm(prefix, String(playbookEl.value || '').trim());
      });
      if (playbookEl.value) applyPlaybookToForm(prefix, playbookEl.value);
    }
    ['DmFrontImageUrl', 'DmBackImageUrl'].forEach(function (suffix) {
      var input = $(prefix + suffix);
      if (input) {
        input.addEventListener('input', function () {
          syncDmPreview(prefix, suffix.indexOf('Back') >= 0 ? 'back' : 'front');
        });
      }
    });
    var genBtn = $(prefix + 'DmGenerateImages');
    if (genBtn) {
      var boot = window.INFO_PACK_BOOT || {};
      if (!boot.kieImageReady) {
        genBtn.disabled = true;
        genBtn.title = 'Configure KIE_AI_API_KEY on the server to generate images';
      }
      genBtn.addEventListener('click', function () {
        generatePostcardImages(prefix);
      });
    }
  }

  function flashMsg(el, text, ok) {
    if (!el) return;
    el.classList.remove('hidden');
    el.textContent = text || '';
    el.className =
      'text-sm ' + (ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-400');
  }

  function bindTabs(root) {
    if (!root || root.dataset.tabsBound === '1') return;
    root.dataset.tabsBound = '1';
    const tabs = root.querySelectorAll('.info-pack-tab');
    const panels = root.querySelectorAll('.info-pack-panel');
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        const name = tab.getAttribute('data-tab');
        tabs.forEach(function (t) {
          const on = t === tab;
          t.classList.toggle('border-brand-yellow/50', on);
          t.classList.toggle('bg-brand-yellow/15', on);
          t.classList.toggle('border-brand-border/40', !on);
          t.classList.toggle('text-brand-muted', !on);
        });
        panels.forEach(function (p) {
          p.classList.toggle('hidden', p.getAttribute('data-panel') !== name);
        });
      });
    });
  }

  function loadFolderPack(folderKey) {
    const form = $('infoPackFolderForm');
    const msg = $('infoPackFolderMsg');
    if (!folderKey) {
      if (form) form.classList.add('hidden');
      return;
    }
    if (form) form.classList.remove('hidden');
    flashMsg(msg, 'Loading…', true);
    fetch('/folders/' + encodeURIComponent(folderKey) + '/info-pack', {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data.success) throw new Error((data && data.error) || 'Load failed');
        const boot = window.INFO_PACK_BOOT || {};
        const fallback = boot.defaultPack || null;
        writePackToForm('ipFolder', data.infoPack || fallback || {});
        flashMsg(msg, data.infoPack ? 'Loaded folder pack.' : 'Using workspace default as starting point.', true);
      })
      .catch(function (err) {
        flashMsg(msg, (err && err.message) || 'Could not load folder pack.', false);
      });
  }

  function init() {
    document.querySelectorAll('.info-pack-form').forEach(bindTabs);
    bindPlaybookAndImages('ipDefault');
    bindPlaybookAndImages('ipFolder');

    var boot = window.INFO_PACK_BOOT || {};
    if (!boot.kieImageReady) {
      document.querySelectorAll('.info-pack-generate-images').forEach(function (btn) {
        btn.disabled = true;
        btn.title = 'Configure KIE_AI_API_KEY on the server to generate images';
      });
    }

    const defaultSave = $('infoPackDefaultSave');
    if (defaultSave) {
      defaultSave.addEventListener('click', function () {
        const msg = $('infoPackDefaultMsg');
        const pack = readPackFromForm('ipDefault');
        defaultSave.disabled = true;
        fetch('/workspace/info-pack-default', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ infoPack: pack }),
        })
          .then(function (r) {
            return r.json();
          })
          .then(function (data) {
            flashMsg(msg, data.success ? 'Workspace default saved.' : (data && data.error) || 'Save failed', !!data.success);
          })
          .catch(function () {
            flashMsg(msg, 'Save failed.', false);
          })
          .finally(function () {
            defaultSave.disabled = false;
          });
      });
    }

    const folderSelect = $('infoPackFolderSelect');
    if (folderSelect) {
      folderSelect.addEventListener('change', function () {
        loadFolderPack(String(folderSelect.value || '').trim());
      });
      const boot = window.INFO_PACK_BOOT || {};
      if (boot.preselectFolderKey) {
        folderSelect.value = boot.preselectFolderKey;
        loadFolderPack(boot.preselectFolderKey);
      }
    }

    const folderSave = $('infoPackFolderSave');
    if (folderSave) {
      folderSave.addEventListener('click', function () {
        const fk = String((folderSelect && folderSelect.value) || '').trim();
        const msg = $('infoPackFolderMsg');
        if (!fk) {
          flashMsg(msg, 'Select a folder first.', false);
          return;
        }
        const pack = readPackFromForm('ipFolder');
        folderSave.disabled = true;
        fetch('/folders/save-info-pack', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ folderKey: fk, infoPack: pack }),
        })
          .then(function (r) {
            return r.json();
          })
          .then(function (data) {
            flashMsg(msg, data.success ? 'Folder pack saved.' : (data && data.error) || 'Save failed', !!data.success);
          })
          .catch(function () {
            flashMsg(msg, 'Save failed.', false);
          })
          .finally(function () {
            folderSave.disabled = false;
          });
      });
    }

    const folderClear = $('infoPackFolderClear');
    if (folderClear) {
      folderClear.addEventListener('click', function () {
        const fk = String((folderSelect && folderSelect.value) || '').trim();
        const msg = $('infoPackFolderMsg');
        if (!fk) {
          flashMsg(msg, 'Select a folder first.', false);
          return;
        }
        const boot = window.INFO_PACK_BOOT || {};
        writePackToForm('ipFolder', boot.defaultPack || {});
        folderClear.disabled = true;
        fetch('/folders/save-info-pack', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ folderKey: fk, clearInfoPack: true }),
        })
          .then(function (r) {
            return r.json();
          })
          .then(function (data) {
            flashMsg(msg, data.success ? 'Folder override cleared.' : (data && data.error) || 'Clear failed', !!data.success);
            if (data.success) loadFolderPack(fk);
          })
          .catch(function () {
            flashMsg(msg, 'Clear failed.', false);
          })
          .finally(function () {
            folderClear.disabled = false;
          });
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
