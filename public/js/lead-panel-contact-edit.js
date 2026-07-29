/**
 * Inline edit for lead panel address, phone, rating/reviews.
 */
(function () {
  'use strict';

  const FIELDS = {
    address: {
      editBtnId: 'mobilePanelEditAddressBtn',
      viewId: 'mobilePanelHeaderAddress',
      inputId: 'mobilePanelHeaderAddressInput',
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
      readViewValue(viewEl) {
        const t = viewEl && viewEl.textContent ? viewEl.textContent.trim() : '';
        return t === '—' ? '' : t;
      },
    },
    phone: {
      editBtnId: 'mobilePanelEditPhoneBtn',
      viewId: 'mobilePanelHeaderPhone',
      inputId: 'mobilePanelHeaderPhoneInput',
      buildPatch: (value) => ({ phone: value || 'N/A' }),
      onSaved: (row, patch) => {
        if (patch.phone) row.dataset.phone = patch.phone;
      },
      readViewValue(viewEl) {
        if (!viewEl) return '';
        const raw =
          viewEl.dataset && viewEl.dataset.phone ? String(viewEl.dataset.phone).trim() : '';
        if (raw && raw !== 'N/A') return raw;
        const t = viewEl.textContent ? viewEl.textContent.trim() : '';
        return t === '—' ? '' : t;
      },
    },
  };

  const editState = {
    address: { editing: false },
    phone: { editing: false },
  };

  let suppressBlurCommit = false;

  function getCurrentRow() {
    if (typeof window.__getLeadPanelCurrentRow === 'function') {
      const fromApp = window.__getLeadPanelCurrentRow();
      if (fromApp && fromApp.dataset) return fromApp;
    }
    const selected = document.querySelector('.result-row.selected');
    if (selected && selected.dataset) return selected;
    const phoneEl = document.getElementById('mobilePanelHeaderPhone');
    const lk = phoneEl && phoneEl.dataset ? String(phoneEl.dataset.leadKey || '').trim() : '';
    if (lk) {
      const match = document.querySelector(`.result-row[data-lead-key="${CSS.escape(lk)}"]`);
      if (match) return match;
    }
    return null;
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

  function fieldEls(fieldKey) {
    const cfg = FIELDS[fieldKey];
    if (!cfg) return null;
    return {
      cfg,
      editBtn: document.getElementById(cfg.editBtnId),
      viewEl: document.getElementById(cfg.viewId),
      inputEl: document.getElementById(cfg.inputId),
    };
  }

  function showView(fieldKey) {
    const els = fieldEls(fieldKey);
    if (!els || !els.viewEl || !els.inputEl) return;
    editState[fieldKey].editing = false;
    els.viewEl.classList.remove('hidden');
    els.inputEl.classList.add('hidden');
  }

  function showEdit(fieldKey) {
    const els = fieldEls(fieldKey);
    if (!els || !els.viewEl || !els.inputEl) return false;
    const row = getCurrentRow();
    if (!row || !row.dataset.leadKey) {
      toast('Save this lead before editing.', 'error');
      return false;
    }
    editState[fieldKey].editing = true;
    els.inputEl.value = els.cfg.readViewValue(els.viewEl);
    els.viewEl.classList.add('hidden');
    els.inputEl.classList.remove('hidden');
    requestAnimationFrame(() => {
      els.inputEl.focus();
      els.inputEl.select();
    });
    return true;
  }

  async function commitField(fieldKey) {
    const els = fieldEls(fieldKey);
    if (!els || !editState[fieldKey].editing) return;
    const row = getCurrentRow();
    if (!row) {
      showView(fieldKey);
      return;
    }
    const patch = els.cfg.buildPatch(String(els.inputEl.value || '').trim());
    try {
      if (els.editBtn) els.editBtn.disabled = true;
      await savePatch(patch);
      if (typeof els.cfg.onSaved === 'function') els.cfg.onSaved(row, patch);
      refreshPanel(row);
      toast('Saved');
    } catch (e) {
      toast(e.message || 'Save failed', 'error');
    } finally {
      if (els.editBtn) els.editBtn.disabled = false;
      showView(fieldKey);
    }
  }

  function bindTextFieldEdit(fieldKey) {
    const els = fieldEls(fieldKey);
    if (!els || !els.editBtn || !els.viewEl || !els.inputEl) return;
    if (els.editBtn.dataset.contactEditBound === '1') return;
    els.editBtn.dataset.contactEditBound = '1';
    els.editBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (editState[fieldKey].editing) commitField(fieldKey);
      else showEdit(fieldKey);
    });

    els.viewEl.addEventListener('click', (e) => {
      if (fieldKey === 'phone') return;
      e.preventDefault();
      e.stopPropagation();
      showEdit(fieldKey);
    });
    if (fieldKey === 'address') {
      els.viewEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          showEdit(fieldKey);
        }
      });
    }

    els.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitField(fieldKey);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        showView(fieldKey);
      }
    });
    els.inputEl.addEventListener('mousedown', (e) => e.stopPropagation());
    els.inputEl.addEventListener('click', (e) => e.stopPropagation());
    els.inputEl.addEventListener('blur', () => {
      setTimeout(() => {
        if (!editState[fieldKey].editing || suppressBlurCommit) return;
        const active = document.activeElement;
        if (active === els.editBtn || active === els.inputEl) return;
        commitField(fieldKey);
      }, 160);
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
    if (editBtn.dataset.contactEditBound === '1') return;
    editBtn.dataset.contactEditBound = '1';
    const hide = () => editRow.classList.add('hidden');
    const show = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
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
    if (saveBtn) saveBtn.addEventListener('click', (e) => { e.stopPropagation(); commit(); });
    if (cancelBtn) cancelBtn.addEventListener('click', (e) => { e.stopPropagation(); hide(); });
    if (reviewsLink) {
      reviewsLink.addEventListener('click', (e) => {
        if (!editRow.classList.contains('hidden')) e.preventDefault();
      });
    }
  }

  function bindCategoryEdit() {
    const pill = document.getElementById('mobilePanelCategory');
    const input = document.getElementById('mobilePanelCategoryInput');
    const editBtn = document.getElementById('mobilePanelEditCategoryBtn');
    if (!pill || !input || !editBtn) return;
    if (editBtn.dataset.contactEditBound === '1') return;
    editBtn.dataset.contactEditBound = '1';

    const hide = () => {
      input.classList.add('hidden');
      pill.classList.remove('hidden');
    };
    const show = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      const row = getCurrentRow();
      if (!row || !row.dataset.leadKey) {
        toast('Save this lead before editing.', 'error');
        return;
      }
      const cat = String(row.dataset.category || '').trim();
      input.value = cat && cat !== 'N/A' ? cat : '';
      pill.classList.add('hidden');
      input.classList.remove('hidden');
      input.focus();
      input.select();
    };

    const commit = async () => {
      const row = getCurrentRow();
      if (!row) return;
      const val = String(input.value || '').trim();
      const patch = { categoryName: val || 'N/A' };
      try {
        editBtn.disabled = true;
        await savePatch(patch);
        row.dataset.category = val || 'N/A';
        const tableInput = row.querySelector('.lead-category-input');
        if (tableInput) tableInput.value = val;
        refreshPanel(row);
        toast('Category saved');
        hide();
      } catch (e) {
        toast(e.message || 'Save failed', 'error');
      } finally {
        editBtn.disabled = false;
      }
    };

    editBtn.addEventListener('click', show);
    pill.addEventListener('click', show);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        hide();
      }
    });
    input.addEventListener('blur', () => {
      setTimeout(() => {
        if (input.classList.contains('hidden')) return;
        if (document.activeElement === input || document.activeElement === editBtn) return;
        commit();
      }, 160);
    });
  }

  function bindCompanyTagsJump() {
    const btn = document.getElementById('leadPanelCompanyTagsMoreBtn');
    if (!btn || btn.dataset.contactEditBound === '1') return;
    btn.dataset.contactEditBound = '1';    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const target = document.getElementById('leadPanelTagsHost');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const historyBtn = document.querySelector('[data-scroll-target="leadPanelHistorySection"]');
      if (historyBtn) historyBtn.click();
    });
  }

  function bindPointerGuards() {
    const root = document.getElementById('leadPanelGlanceContent') || document.getElementById('leadPanelCallerGlance');
    if (!root || root.dataset.contactEditGuards === '1') return;
    root.dataset.contactEditGuards = '1';
    root.addEventListener('mousedown', (e) => {
      suppressBlurCommit = !!e.target.closest(
        '#headerAddressRow, #headerPhoneRow, #mobilePanelReviewsEditRow, #mobilePanelCategoryWrap, #mobilePanelEditAddressBtn, #mobilePanelEditPhoneBtn, #mobilePanelEditReviewsBtn, #mobilePanelEditCategoryBtn'
      );
    });
  }

  function init() {
    bindPointerGuards();
    bindTextFieldEdit('address');
    bindTextFieldEdit('phone');
    bindReviewsEdit();
    bindCategoryEdit();
    bindCompanyTagsJump();
  }

  window.__ensureLeadPanelContactEdit = init;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
