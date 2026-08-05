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
    const row = getPanelRow();
    return row ? String(row.dataset.leadKey || '').trim() : '';
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
    const row = getPanelRow();
    const ch = getChannel(root);
    const val = ch === 'email' ? readEmail(row) : readPhone(row);
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

  function populateFromRow(root) {
    const row = getPanelRow();
    const subjectInput = qs(root, '.lead-send-info-subject');
    const toInput = qs(root, '.lead-send-info-to');
    if (toInput) toInput.dataset.userEdited = '';
    if (subjectInput && row) {
      const company = String(row.dataset.title || 'your business').trim();
      subjectInput.value = `Quick idea for ${company}`;
    }
    syncSendToDefault(root);
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

    setChannel(root, 'sms');
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
})();
