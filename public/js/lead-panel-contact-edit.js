/**
 * Inline edit for lead panel address, phone, rating/reviews.
 */
(function () {
  'use strict';

  function getCurrentRow() {
    return typeof window.__getLeadPanelCurrentRow === 'function' ? window.__getLeadPanelCurrentRow() : null;
  }

  function toast(msg, variant) {
    if (typeof window.showAppToast === 'function') {
      window.showAppToast(msg, { variant: variant || 'success' });
    }
  }

  async function savePatch(patch) {
    const row = getCurrentRow();
    if (!row || !row.dataset.leadKey) {
      throw new Error('Save this lead before editing.');
    }
    if (typeof window.__postLeadJsonUpdate === 'function') {
      return window.__postLeadJsonUpdate(row, patch);
    }
    const key = row.dataset.leadKey;
    const res = await fetch(`/leads/${encodeURIComponent(key)}/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(patch || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error((data && data.error) || 'Update failed');
    if (data.lead && typeof window.__syncPersistedLeadToRowDataset === 'function') {
      window.__syncPersistedLeadToRowDataset(row, data.lead);
    }
    return data;
  }

  function parseCityStateFromAddress(address) {
    const raw = String(address || '').trim();
    if (!raw) return { city: '', state: '' };
    const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 3) {
      const stateZip = parts[parts.length - 1];
      const state = stateZip.replace(/\d{5}(-\d{4})?.*$/, '').trim();
      return { city: parts[parts.length - 2], state };
    }
    if (parts.length === 2) {
      return { city: parts[0], state: parts[1].replace(/\d{5}(-\d{4})?.*$/, '').trim() };
    }
    return { city: raw, state: '' };
  }

  function refreshPanel(row) {
    if (typeof window.__populateLeadPanel === 'function') window.__populateLeadPanel(row);
    else if (typeof window.populatePanel === 'function') window.populatePanel(row);
  }

  function bindTextFieldEdit(opts) {
    const {
      editBtn,
      viewEl,
      inputEl,
      buildPatch,
      onSaved,
    } = opts;
    if (!editBtn || !viewEl || !inputEl) return;

    let editing = false;

    const showView = () => {
      editing = false;
      viewEl.classList.remove('hidden');
      inputEl.classList.add('hidden');
    };

    const showEdit = () => {
      const row = getCurrentRow();
      if (!row || !row.dataset.leadKey) {
        toast('Save this lead before editing.', 'error');
        return;
      }
      editing = true;
      inputEl.value = viewEl.textContent && viewEl.textContent.trim() !== '—' ? viewEl.textContent.trim() : '';
      viewEl.classList.add('hidden');
      inputEl.classList.remove('hidden');
      inputEl.focus();
      inputEl.select();
    };

    const commit = async () => {
      if (!editing) return;
      const row = getCurrentRow();
      if (!row) return;
      const patch = buildPatch(String(inputEl.value || '').trim());
      try {
        editBtn.disabled = true;
        await savePatch(patch);
        if (typeof onSaved === 'function') onSaved(row, patch);
        refreshPanel(row);
        toast('Saved');
      } catch (e) {
        toast(e.message || 'Save failed', 'error');
      } finally {
        editBtn.disabled = false;
        showView();
      }
    };

    editBtn.addEventListener('click', () => {
      if (editing) commit();
      else showEdit();
    });
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        showView();
      }
    });
    inputEl.addEventListener('blur', () => {
      setTimeout(() => {
        if (editing && document.activeElement !== editBtn) commit();
      }, 120);
    });
  }

  function bindReviewsEdit() {
    const editBtn = document.getElementById('mobilePanelEditReviewsBtn');
    const editRow = document.getElementById('mobilePanelReviewsEditRow');
    const ratingInp = document.getElementById('mobilePanelReviewsRatingInput');
    const countInp = document.getElementById('mobilePanelReviewsCountInput');
    const saveBtn = document.getElementById('mobilePanelReviewsSaveBtn');
    const cancelBtn = document.getElementById('mobilePanelReviewsCancelBtn');
    const reviewsLink = document.getElementById('mobilePanelReviewsLink');
    if (!editBtn || !editRow || !ratingInp || !countInp) return;

    const hide = () => editRow.classList.add('hidden');
    const show = () => {
      const row = getCurrentRow();
      if (!row || !row.dataset.leadKey) {
        toast('Save this lead before editing.', 'error');
        return;
      }
      const rating = parseFloat(row.dataset.rating) || 0;
      const reviews = parseInt(row.dataset.reviews, 10) || 0;
      ratingInp.value = rating > 0 ? String(rating) : '';
      countInp.value = reviews > 0 ? String(reviews) : '';
      editRow.classList.remove('hidden');
      ratingInp.focus();
    };

    const commit = async () => {
      const row = getCurrentRow();
      if (!row) return;
      const totalScore = parseFloat(ratingInp.value);
      const reviewsCount = parseInt(countInp.value, 10);
      const patch = {
        totalScore: Number.isFinite(totalScore) && totalScore >= 0 ? totalScore : 0,
        reviewsCount: Number.isFinite(reviewsCount) && reviewsCount >= 0 ? reviewsCount : 0,
        reviewsCountManual: true,
      };
      try {
        saveBtn.disabled = true;
        await savePatch(patch);
        row.dataset.rating = String(patch.totalScore);
        row.dataset.reviews = String(patch.reviewsCount);
        refreshPanel(row);
        toast('Rating & reviews saved');
        hide();
      } catch (e) {
        toast(e.message || 'Save failed', 'error');
      } finally {
        saveBtn.disabled = false;
      }
    };

    editBtn.addEventListener('click', show);
    if (saveBtn) saveBtn.addEventListener('click', commit);
    if (cancelBtn) cancelBtn.addEventListener('click', hide);
    if (reviewsLink) {
      reviewsLink.addEventListener('click', (e) => {
        if (!editRow.classList.contains('hidden')) e.preventDefault();
      });
    }
  }

  function bindCompanyTagsJump() {
    const btn = document.getElementById('leadPanelCompanyTagsMoreBtn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const target = document.getElementById('leadPanelTagsHost');
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      const historyBtn = document.querySelector('[data-scroll-target="leadPanelHistorySection"]');
      if (historyBtn) historyBtn.click();
    });
  }

  function init() {
    bindTextFieldEdit({
      editBtn: document.getElementById('mobilePanelEditAddressBtn'),
      viewEl: document.getElementById('mobilePanelHeaderAddress'),
      inputEl: document.getElementById('mobilePanelHeaderAddressInput'),
      buildPatch: (value) => {
        const geo = parseCityStateFromAddress(value);
        return {
          address: value || 'N/A',
          city: geo.city || '',
          state: geo.state || '',
        };
      },
      onSaved: (row, patch) => {
        if (patch.address) row.dataset.address = patch.address;
        if (patch.city) row.dataset.city = patch.city;
        if (patch.state) row.dataset.state = patch.state;
      },
    });

    bindTextFieldEdit({
      editBtn: document.getElementById('mobilePanelEditPhoneBtn'),
      viewEl: document.getElementById('mobilePanelHeaderPhone'),
      inputEl: document.getElementById('mobilePanelHeaderPhoneInput'),
      buildPatch: (value) => ({ phone: value || 'N/A' }),
      onSaved: (row, patch) => {
        if (patch.phone) row.dataset.phone = patch.phone;
      },
    });

    bindReviewsEdit();
    bindCompanyTagsJump();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
