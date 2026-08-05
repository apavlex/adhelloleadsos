/**
 * In-call "Send info" — custom recipient + message via SMS or GHL email.
 */
(function () {
  'use strict';

  let softphoneLeadKey = '';
  let softphoneActive = false;

  function qs(root, sel) {
    return root ? root.querySelector(sel) : null;
  }

  function toast(msg, variant) {
    if (typeof window.showAppToast === 'function') {
      window.showAppToast(msg, { variant: variant || 'success' });
    }
  }

  function getPanelRow() {
    if (typeof window.__getLeadPanelCurrentRow === 'function') {
      const row = window.__getLeadPanelCurrentRow();
      if (row && row.dataset) return row;
    }
    const selected = document.querySelector('.result-row.selected');
    return selected && selected.dataset ? selected : null;
  }

  function resolveLeadKey(root) {
    const isSoftphone = root && root.id === 'softphoneSendInfo';
    if (isSoftphone && softphoneLeadKey) return softphoneLeadKey;
    if (root && root.id === 'focusSendInfo' && window.__focusSendInfoLeadKey) {
      return String(window.__focusSendInfoLeadKey || '').trim();
    }
    const row = getPanelRow();
    return row ? String(row.dataset.leadKey || '').trim() : '';
  }

  function readLeadContactFromObject(lead) {
    const l = lead && typeof lead === 'object' ? lead : {};
    const phone = String(l.phone || '').trim();
    const email = String(l.email || '').trim();
    return {
      phone: phone && phone !== 'N/A' ? phone : '',
      email: email && email !== 'N/A' ? email : '',
      title: String(l.title || '').trim(),
    };
  }

  function populateSendInfoRoot(root, leadLike) {
    if (!root) return;
    const contact = leadLike
      ? readLeadContactFromObject(leadLike)
      : { phone: readPhone(getPanelRow()), email: readEmail(getPanelRow()), title: '' };
    const toInput = qs(root, '.lead-send-info-to');
    const subjectInput = qs(root, '.lead-send-info-subject');
    if (toInput) {
      toInput.dataset.userEdited = '';
      toInput.value = contact.phone || contact.email || '';
    }
    if (subjectInput) {
      const company = contact.title || 'your business';
      subjectInput.value = `Quick idea for ${company}`;
    }
    prefetchInfoPack(root);
  }

  async function prefillAuditSnippet(root, leadKey) {
    if (!leadKey) return;
    try {
      const res = await fetch(`/leads/${encodeURIComponent(leadKey)}/audit-report-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) return;
      const snippet = data.smsSnippet || data.auditPageUrl || data.reportUrl || '';
      if (!snippet) return;
      const smsBody = qs(root, '.lead-send-info-pack-sms-body');
      const bodyEl = qs(root, '.lead-send-info-body');
      if (smsBody) smsBody.value = snippet;
      if (bodyEl && getChannel(root) === 'sms') bodyEl.value = snippet;
      const details = root.querySelector('.lead-send-info-pack-details');
      if (details) details.open = true;
    } catch (_) {
      /* optional */
    }
  }

  function openSendInfoWithAudit(opts) {
    opts = opts || {};
    const rootId = opts.rootId || 'leadPanelSendInfo';
    let root = document.getElementById(rootId);
    if (!root && opts.fallbackRoots) {
      for (const id of opts.fallbackRoots) {
        root = document.getElementById(id);
        if (root) break;
      }
    }
    if (!root) {
      root = document.querySelector('[data-send-info-root]');
    }
    if (!root) return;

    if (opts.lead && opts.lead.key) {
      if (root.id === 'focusSendInfo') {
        window.__focusSendInfoLeadKey = String(opts.lead.key).trim();
      }
      populateSendInfoRoot(root, opts.lead);
    } else {
      populateFromRow(root);
    }

    const leadKey = resolveLeadKey(root);
    prefillAuditSnippet(root, leadKey);

    if (root.id === 'leadPanelSendInfo' || root.closest('#leadPanelOutreachDrawer')) {
      const drawer = document.getElementById('leadPanelOutreachDrawer');
      const btn = document.getElementById('leadPanelOutreachToggle');
      const ch = document.getElementById('leadPanelOutreachChevron');
      if (drawer) drawer.classList.add('lead-panel-outreach-drawer--open');
      if (btn) btn.setAttribute('aria-expanded', 'true');
      if (ch) {
        ch.classList.remove('rotate-180');
        ch.style.transform = '';
      }
      if (typeof openLeadPanelNotepad === 'function') openLeadPanelNotepad();
      if (typeof window.__syncLeadPanelSendInfoExpanded === 'function') {
        window.__syncLeadPanelSendInfoExpanded();
      }
    }

    if (root.id === 'focusSendInfo' || root.closest('#focusSendInfoDrawer')) {
      if (typeof window.__setFocusSendInfoOpen === 'function') {
        window.__setFocusSendInfoOpen(true);
      } else {
        const drawer = document.getElementById('focusSendInfoDrawer');
        const btn = document.getElementById('focusSendInfoToggle');
        const ch = document.getElementById('focusSendInfoChevron');
        if (drawer) drawer.classList.add('focus-send-info-drawer--open');
        if (btn) btn.setAttribute('aria-expanded', 'true');
        if (ch) {
          ch.classList.remove('rotate-180');
          ch.style.transform = '';
        }
      }
    }

    if (opts.scroll !== false) {
      root.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function readPhone(row) {
    if (!row || !row.dataset) return '';
    const p = String(row.dataset.phone || '').trim();
    return p && p !== 'N/A' ? p : '';
  }

  function readEmail(row) {
    if (!row || !row.dataset) return '';
    const e = String(row.dataset.email || '').trim();
    return e && e !== 'N/A' ? e : '';
  }

  function getChannel(root) {
    const active = root.querySelector('.lead-send-info-channel[aria-pressed="true"]');
    return active && active.getAttribute('data-channel') === 'email' ? 'email' : 'sms';
  }

  function setChannel(root, channel) {
    const ch = channel === 'email' ? 'email' : 'sms';
    root.querySelectorAll('.lead-send-info-channel').forEach((btn) => {
      const on = btn.getAttribute('data-channel') === ch;
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.classList.toggle('border-brand-yellow/50', on);
      btn.classList.toggle('bg-brand-yellow/15', on);
      btn.classList.toggle('text-brand-dark', on);
      btn.classList.toggle('dark:text-brand-yellow', on);
      btn.classList.toggle('border-brand-border/40', !on);
      btn.classList.toggle('text-brand-muted', !on);
    });
    const toInput = qs(root, '.lead-send-info-to');
    const subjectWrap = qs(root, '.lead-send-info-subject-wrap');
    const sendBtn = qs(root, '.lead-send-info-send');
    if (subjectWrap) subjectWrap.classList.toggle('hidden', ch !== 'email');
    if (toInput) {
      toInput.inputMode = ch === 'email' ? 'email' : 'tel';
      toInput.type = ch === 'email' ? 'email' : 'text';
      toInput.placeholder = ch === 'email' ? 'name@company.com' : '(555) 555-5555';
    }
    if (sendBtn) sendBtn.textContent = ch === 'email' ? 'Send email' : 'Send SMS';
    syncSendToDefault(root);
  }

  function syncSendToDefault(root) {
    const toInput = qs(root, '.lead-send-info-to');
    if (!toInput || toInput.dataset.userEdited === '1') return;
    const contact = readContactForRoot(root);
    const ch = getChannel(root);
    const val = ch === 'email' ? contact.email : contact.phone;
    toInput.value = val || '';
  }

  function setFeedback(root, msg, isError) {
    const el = qs(root, '.lead-send-info-feedback');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('text-rose-600', !!isError);
    el.classList.toggle('dark:text-rose-400', !!isError);
    el.classList.toggle('text-emerald-700', !isError && !!msg);
    el.classList.toggle('dark:text-emerald-300', !isError && !!msg);
  }

  function syncMainBodyToPack(root) {
    const ch = getChannel(root);
    const bodyEl = qs(root, '.lead-send-info-body');
    const subjectEl = qs(root, '.lead-send-info-subject');
    if (ch === 'email') {
      const emailBody = qs(root, '.lead-send-info-pack-email-body');
      const emailSub = qs(root, '.lead-send-info-pack-email-subject');
      if (emailBody && bodyEl) emailBody.value = bodyEl.value;
      if (emailSub && subjectEl) emailSub.value = subjectEl.value;
    } else {
      const smsBody = qs(root, '.lead-send-info-pack-sms-body');
      if (smsBody && bodyEl) smsBody.value = bodyEl.value;
    }
  }

  function syncPackToMainBody(root) {
    const ch = getChannel(root);
    const bodyEl = qs(root, '.lead-send-info-body');
    const subjectEl = qs(root, '.lead-send-info-subject');
    if (ch === 'email') {
      const emailBody = qs(root, '.lead-send-info-pack-email-body');
      const emailSub = qs(root, '.lead-send-info-pack-email-subject');
      if (bodyEl && emailBody) bodyEl.value = emailBody.value || '';
      if (subjectEl && emailSub) subjectEl.value = emailSub.value || '';
    } else {
      const smsBody = qs(root, '.lead-send-info-pack-sms-body');
      if (bodyEl && smsBody) bodyEl.value = smsBody.value || '';
    }
  }

  function fillPackOverrideFields(root, materialized, resolved) {
    const m = materialized || {};
    const r = resolved || {};
    const sms = m.sms || r.sms || {};
    const email = m.email || r.email || {};
    const dm = m.directMail || r.directMail || {};
    const smsOn = qs(root, '.lead-send-info-pack-sms-enabled');
    const emailOn = qs(root, '.lead-send-info-pack-email-enabled');
    const dmOn = qs(root, '.lead-send-info-pack-dm-enabled');
    if (smsOn) smsOn.checked = !!(r.sms && r.sms.enabled);
    if (emailOn) emailOn.checked = !!(r.email && r.email.enabled);
    if (dmOn) dmOn.checked = !!(r.directMail && r.directMail.enabled);
    const smsBody = qs(root, '.lead-send-info-pack-sms-body');
    const emailSub = qs(root, '.lead-send-info-pack-email-subject');
    const emailBody = qs(root, '.lead-send-info-pack-email-body');
    const dmHead = qs(root, '.lead-send-info-pack-dm-headline');
    const dmBody = qs(root, '.lead-send-info-pack-dm-body');
    const dmCta = qs(root, '.lead-send-info-pack-dm-cta');
    if (smsBody) smsBody.value = sms.body || '';
    if (emailSub) emailSub.value = email.subject || '';
    if (emailBody) emailBody.value = email.body || '';
    if (dmHead) dmHead.value = dm.headline || '';
    if (dmBody) dmBody.value = dm.bodyText || '';
    if (dmCta) dmCta.value = dm.ctaUrl || '';
    syncPackToMainBody(root);
  }

  function buildPackOverrideFromForm(root) {
    return {
      sms: {
        enabled: !!(qs(root, '.lead-send-info-pack-sms-enabled') || {}).checked,
        body: String((qs(root, '.lead-send-info-pack-sms-body') || {}).value || '').trim(),
      },
      email: {
        enabled: !!(qs(root, '.lead-send-info-pack-email-enabled') || {}).checked,
        subject: String((qs(root, '.lead-send-info-pack-email-subject') || {}).value || '').trim(),
        body: String((qs(root, '.lead-send-info-pack-email-body') || {}).value || '').trim(),
      },
      directMail: {
        enabled: !!(qs(root, '.lead-send-info-pack-dm-enabled') || {}).checked,
        headline: String((qs(root, '.lead-send-info-pack-dm-headline') || {}).value || '').trim(),
        bodyText: String((qs(root, '.lead-send-info-pack-dm-body') || {}).value || '').trim(),
        ctaUrl: String((qs(root, '.lead-send-info-pack-dm-cta') || {}).value || '').trim(),
      },
    };
  }

  function getFocusLead() {
    if (typeof window.__getFocusCurrentLead === 'function') {
      return window.__getFocusCurrentLead();
    }
    return null;
  }

  function readContactForRoot(root) {
    if (root && root.id === 'focusSendInfo') {
      const focusLead = getFocusLead();
      if (focusLead) return readLeadContactFromObject(focusLead);
    }
    const row = getPanelRow();
    return {
      phone: readPhone(row),
      email: readEmail(row),
      title: row ? String(row.dataset.title || '').trim() : '',
    };
  }

  function populateFromRow(root) {
    const row = getPanelRow();
    const subjectInput = qs(root, '.lead-send-info-subject');
    const bodyInput = qs(root, '.lead-send-info-body');
    const toInput = qs(root, '.lead-send-info-to');
    if (toInput) toInput.dataset.userEdited = '';
    if (subjectInput && row) {
      const company = String(row.dataset.title || 'your business').trim();
      subjectInput.value = `Quick idea for ${company}`;
    }
    syncSendToDefault(root);
    prefetchInfoPack(root);
  }

  async function prefetchInfoPack(root) {
    const leadKey = resolveLeadKey(root);
    if (!leadKey) return;
    try {
      const res = await fetch(`/leads/${encodeURIComponent(leadKey)}/info-pack-preview`, {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) return;
      fillPackOverrideFields(root, data.materialized, data.pack);
      root.dataset.infoPackLoaded = '1';
    } catch (_) {
      /* optional prefill */
    }
  }

  async function fetchAuditSnippet(leadKey) {
    const res = await fetch(`/leads/${encodeURIComponent(leadKey)}/audit-report-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      throw new Error((data && data.error) || 'Could not create audit link');
    }
    return data.smsSnippet || data.reportUrl || '';
  }

  function formatInfoPackResults(data) {
    const parts = [];
    if (data.sms && data.sms.ok) parts.push('SMS sent');
    else if (data.sms && !data.sms.skipped && data.sms.error) parts.push('SMS: ' + data.sms.error);
    else if (data.sms && data.sms.skipped && data.sms.reason === 'landline_sms_skip') parts.push('SMS skipped (landline)');
    if (data.email && data.email.ok) parts.push('Email sent');
    else if (data.email && !data.email.skipped && data.email.error) parts.push('Email: ' + data.email.error);
    if (data.directMail && data.directMail.ok) parts.push('Postcard queued');
    else if (data.directMail && !data.directMail.skipped && data.directMail.error) parts.push('Mail: ' + data.directMail.error);
    if (!parts.length && data.error) return data.error;
    return parts.join(' · ') || 'Nothing sent.';
  }

  async function handleSendInfoPack(root) {
    const leadKey = resolveLeadKey(root);
    if (!leadKey) {
      setFeedback(root, 'Select a lead first.', true);
      return;
    }
    const contact = readContactForRoot(root);
    const toInput = qs(root, '.lead-send-info-to');
    const saveToLead = !!(qs(root, '.lead-send-info-save') || {}).checked;
    const packBtn = qs(root, '.lead-send-info-pack');

    syncMainBodyToPack(root);
    const payload = { saveToLead, pack: buildPackOverrideFromForm(root) };

    const ph = contact.phone;
    const em = contact.email;
    const userEdited = !!(toInput && toInput.dataset.userEdited === '1');
    const ch = getChannel(root);
    if (userEdited && toInput) {
      const val = String(toInput.value || '').trim();
      if (ch === 'email') payload.email = val;
      else payload.phone = val;
    }
    if (ph) payload.phone = payload.phone || ph;
    if (em) payload.email = payload.email || em;

    const original = packBtn ? packBtn.textContent : '';
    if (packBtn) {
      packBtn.disabled = true;
      packBtn.textContent = 'Sending…';
    }
    setFeedback(root, 'Sending info pack…');

    try {
      const res = await fetch(`/leads/${encodeURIComponent(leadKey)}/send-info-pack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      const msg = formatInfoPackResults(data);
      const isError = !data.anySent && !!(data.error || (data.sms && data.sms.error));
      setFeedback(root, msg, isError);
      if (data.anySent) toast(msg, 'success');
      else if (isError) toast(msg, 'error');
      if (data.lead && typeof window.__syncPersistedLeadToRowDataset === 'function') {
        const row = getPanelRow();
        if (row) window.__syncPersistedLeadToRowDataset(row, data.lead);
      }
      if (typeof window.populatePanel === 'function') {
        const row = getPanelRow();
        if (row) window.populatePanel(row);
      }
    } catch (err) {
      const msg = (err && err.message) || 'Could not send info pack.';
      setFeedback(root, msg, true);
      toast(msg, 'error');
    } finally {
      if (packBtn) {
        packBtn.disabled = false;
        packBtn.textContent = original || 'Send info pack';
      }
    }
  }

  async function handleSend(root) {
    const leadKey = resolveLeadKey(root);
    if (!leadKey) {
      setFeedback(root, 'Select a lead first.', true);
      return;
    }
    const ch = getChannel(root);
    const to = String((qs(root, '.lead-send-info-to') || {}).value || '').trim();
    const body = String((qs(root, '.lead-send-info-body') || {}).value || '').trim();
    const saveToLead = !!(qs(root, '.lead-send-info-save') || {}).checked;
    const sendBtn = qs(root, '.lead-send-info-send');

    if (!to) {
      setFeedback(root, ch === 'email' ? 'Enter an email address.' : 'Enter a phone number.', true);
      return;
    }
    if (!body) {
      setFeedback(root, 'Enter a message to send.', true);
      return;
    }

    const path = ch === 'email' ? '/email' : '/sms';
    const payload = { body, to, saveToLead };
    if (ch === 'email') {
      payload.subject =
        String((qs(root, '.lead-send-info-subject') || {}).value || '').trim() ||
        'Message from Agency OS';
    }

    const original = sendBtn ? sendBtn.textContent : '';
    if (sendBtn) {
      sendBtn.disabled = true;
      sendBtn.textContent = 'Sending…';
    }
    setFeedback(root, '');

    try {
      const res = await fetch(`/leads/${encodeURIComponent(leadKey)}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error((data && data.error) || 'Send failed');
      }
      if (data.lead && typeof window.__syncPersistedLeadToRowDataset === 'function') {
        const row = getPanelRow();
        if (row) window.__syncPersistedLeadToRowDataset(row, data.lead);
      }
      const label =
        ch === 'email'
          ? 'Email sent via Go High Level.'
          : data.channel === 'imessage'
            ? 'iMessage sent.'
            : 'SMS sent.';
      setFeedback(root, label, false);
      toast(label, 'success');
      if (typeof window.populatePanel === 'function') {
        const row = getPanelRow();
        if (row) window.populatePanel(row);
      }
    } catch (err) {
      const msg = (err && err.message) || 'Could not send.';
      setFeedback(root, msg, true);
      toast(msg, 'error');
    } finally {
      if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.textContent = original || (ch === 'email' ? 'Send email' : 'Send SMS');
      }
    }
  }

  function bindRoot(root) {
    if (!root || root.dataset.sendInfoBound === '1') return;
    root.dataset.sendInfoBound = '1';

    root.querySelectorAll('.lead-send-info-channel').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        setChannel(root, btn.getAttribute('data-channel'));
      });
    });

    const toInput = qs(root, '.lead-send-info-to');
    if (toInput) {
      toInput.addEventListener('input', () => {
        toInput.dataset.userEdited = '1';
      });
    }

    const bodyInput = qs(root, '.lead-send-info-body');
    if (bodyInput) {
      bodyInput.addEventListener('input', () => syncMainBodyToPack(root));
    }
    const subjectInput = qs(root, '.lead-send-info-subject');
    if (subjectInput) {
      subjectInput.addEventListener('input', () => syncMainBodyToPack(root));
    }

    root.querySelectorAll('.lead-send-info-pack-sms-body, .lead-send-info-pack-email-body, .lead-send-info-pack-email-subject').forEach((el) => {
      el.addEventListener('input', () => syncPackToMainBody(root));
    });

    const auditBtn = qs(root, '.lead-send-info-audit');
    if (auditBtn) {
      auditBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        const leadKey = resolveLeadKey(root);
        if (!leadKey) {
          setFeedback(root, 'Select a lead first.', true);
          return;
        }
        const bodyEl = qs(root, '.lead-send-info-body');
        auditBtn.disabled = true;
        setFeedback(root, 'Adding audit link…');
        try {
          const snippet = await fetchAuditSnippet(leadKey);
          if (bodyEl) {
            const cur = String(bodyEl.value || '').trim();
            bodyEl.value = cur ? `${cur}\n\n${snippet}` : snippet;
          }
          setFeedback(root, 'Audit link added.', false);
        } catch (err) {
          setFeedback(root, (err && err.message) || 'Audit link failed.', true);
        } finally {
          auditBtn.disabled = false;
        }
      });
    }

    const sendBtn = qs(root, '.lead-send-info-send');
    if (sendBtn) {
      sendBtn.addEventListener('click', (e) => {
        e.preventDefault();
        handleSend(root);
      });
    }

    const packBtn = qs(root, '.lead-send-info-pack');
    if (packBtn) {
      packBtn.addEventListener('click', (e) => {
        e.preventDefault();
        handleSendInfoPack(root);
      });
    }

    const packDetails = root.querySelector('.lead-send-info-pack-details');
    if (packDetails) {
      packDetails.addEventListener('toggle', () => {
        const open = packDetails.open;
        root.classList.toggle('lead-send-info--customize-open', open);
        if (root.id === 'focusSendInfo') {
          const panel = document.getElementById('focus-outcome-panel');
          if (panel) panel.classList.toggle('focus-outcome-panel--send-customize', open);
          if (open && typeof window.__setFocusSendInfoOpen === 'function') {
            window.__setFocusSendInfoOpen(true);
          }
        }
        if (root.id === 'leadPanelSendInfo' && typeof window.__syncLeadPanelSendInfoExpanded === 'function') {
          window.__syncLeadPanelSendInfoExpanded();
        }
        if (open && root.scrollIntoView) {
          window.setTimeout(() => {
            root.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }, 60);
        }
      });
    }

    setChannel(root, 'sms');
  }

  function resetSendInfoCustomize(root) {
    if (!root) return;
    const packDetails = root.querySelector('.lead-send-info-pack-details');
    if (packDetails && packDetails.open) packDetails.open = false;
    root.classList.remove('lead-send-info--customize-open');
    if (root.id === 'focusSendInfo') {
      const panel = document.getElementById('focus-outcome-panel');
      if (panel) panel.classList.remove('focus-outcome-panel--send-customize');
    }
    if (root.id === 'leadPanelSendInfo' && typeof window.__syncLeadPanelSendInfoExpanded === 'function') {
      window.__syncLeadPanelSendInfoExpanded();
    }
  }

  function syncSoftphoneVisibility() {
    const sp = document.getElementById('softphoneSendInfo');
    if (!sp) return;
    const show = softphoneActive;
    sp.classList.toggle('hidden', !show);
  }

  function init() {
    document.querySelectorAll('[data-send-info-root]').forEach(bindRoot);

    document.addEventListener('adhello-softphone-state', (e) => {
      const d = (e && e.detail) || {};
      const state = String(d.state || 'idle').toLowerCase();
      softphoneActive = state === 'dialing' || state === 'in_call';
      softphoneLeadKey = String(d.leadKey || '').trim();
      syncSoftphoneVisibility();
      const sp = document.getElementById('softphoneSendInfo');
      if (sp && softphoneActive) populateFromRow(sp);
    });

    document.addEventListener('adhello-lead-panel-opened', () => {
      document.querySelectorAll('[data-send-info-root]').forEach((root) => {
        populateFromRow(root);
      });
    });

    if (typeof window.__populateLeadPanel === 'function') {
      /* populated via populatePanel hook in app.js */
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.__leadSendInfoPopulate = populateFromRow;
  window.__leadSendInfoPopulateForLead = function (lead) {
    document.querySelectorAll('[data-send-info-root]').forEach((root) => {
      if (root.id === 'focusSendInfo' || (lead && lead.key)) {
        populateSendInfoRoot(root, lead);
      }
    });
  };
  window.__leadSendInfoOpenWithAudit = openSendInfoWithAudit;
  window.__resetSendInfoCustomize = resetSendInfoCustomize;
})();
