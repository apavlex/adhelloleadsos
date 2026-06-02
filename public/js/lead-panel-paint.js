/**
 * Paint lead panel header (phone, address, reviews) directly from lead JSON.
 * Loaded before app.js so panel contact fields populate even if table scrape fails.
 */
(function () {
  'use strict';

  function isEmpty(v) {
    const s = v == null ? '' : String(v).trim();
    return !s || s === 'N/A' || s === '—' || s === '-' || s === 'undefined' || s === 'null';
  }

  function pickPhone(lead) {
    if (!lead) return '';
    if (!isEmpty(lead.phone)) return String(lead.phone).trim();
    const contacts = Array.isArray(lead.contacts) ? lead.contacts : [];
    const pri =
      contacts.find((c) => c && c.primary && !isEmpty(c.phone)) ||
      contacts.find((c) => c && !isEmpty(c.phone));
    return pri ? String(pri.phone).trim() : '';
  }

  function pickAddress(lead) {
    if (!lead) return '';
    if (!isEmpty(lead.address)) return String(lead.address).trim();
    const imp = lead.importFields && typeof lead.importFields === 'object' ? lead.importFields : null;
    if (!imp) return '';
    const keys = ['address', 'full_address', 'company_location', 'street_address', 'location'];
    for (const k of keys) {
      for (const [ik, iv] of Object.entries(imp)) {
        if (String(ik).toLowerCase() === k && !isEmpty(iv)) return String(iv).trim();
      }
    }
    return '';
  }

  function formatPhone(raw) {
    const d = String(raw || '').replace(/\D/g, '');
    if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
    if (d.length === 11 && d[0] === '1') return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
    return String(raw || '').trim();
  }

  function formatAddress(raw) {
    let s = String(raw || '').trim();
    if (!s || s === '—') return s;
    return s.replace(/\s*-\s*/g, ', ').replace(/,\s*,+/g, ', ').replace(/^,\s*|,\s*$/g, '').trim();
  }

  function panelEl(id) {
    const panel = document.getElementById('mobilePanel');
    if (panel) {
      const scoped = panel.querySelector('#' + id);
      if (scoped) return scoped;
    }
    return document.getElementById(id);
  }

  function findLeadRecord(row) {
    const list = window.INITIAL_SAVED_LEADS;
    if (!Array.isArray(list) || !row || !row.dataset) return null;
    const rawKey = String(row.dataset.leadKey || '').trim();
    const keyNorm = rawKey.replace(/^lead:/i, '');
    const titleKey = String(row.dataset.title || '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
    return (
      list.find((l) => {
        if (!l) return false;
        const lk = String(l.key || '').trim();
        const lkNorm = lk.replace(/^lead:/i, '');
        if (rawKey && (lk === rawKey || lkNorm === keyNorm)) return true;
        if (titleKey && String(l.title || '').trim().toLowerCase() === titleKey) return true;
        return false;
      }) || null
    );
  }

  function contactsFromRow(row) {
    if (!row || !row.dataset) return [];
    try {
      const raw = row.dataset.contacts || row.getAttribute('data-contacts') || '[]';
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function scrapeRowIntoLead(row, base) {
    const lead = base && typeof base === 'object' ? { ...base } : {};
    if (!row || typeof row.querySelector !== 'function') return lead;

    const addrEl = row.querySelector('.lead-row-address');
    if (addrEl) {
      const fromTitle = String(addrEl.getAttribute('title') || '').trim();
      const t = String(addrEl.textContent || '')
        .replace(/\s+/g, ' ')
        .trim();
      const pick = !isEmpty(fromTitle) ? fromTitle : t;
      if (!isEmpty(pick)) lead.address = pick;
    }

    const phoneSlot =
      row.querySelector('.lead-contact-phone-slot.js-click-to-call-number') ||
      row.querySelector('.lead-contact-phone-slot[data-phone]') ||
      row.querySelector('.js-click-to-call-number[data-phone]');
    if (phoneSlot && isEmpty(lead.phone)) {
      const label = phoneSlot.querySelector('.lead-contact-phone-label');
      const p = String(
        phoneSlot.getAttribute('data-phone') ||
          phoneSlot.dataset.phone ||
          (label && label.textContent) ||
          phoneSlot.textContent ||
          '',
      ).trim();
      if (!isEmpty(p)) lead.phone = p;
    }

    if (isEmpty(lead.phone)) {
      row.querySelectorAll('.js-click-to-call-number').forEach((slot) => {
        if (!isEmpty(lead.phone)) return;
        const label = slot.querySelector('.lead-contact-phone-label');
        const p = String(
          slot.getAttribute('data-phone') || slot.dataset.phone || (label && label.textContent) || '',
        ).trim();
        if (!isEmpty(p)) lead.phone = p;
      });
    }

    const contacts = contactsFromRow(row);
    if (isEmpty(lead.phone)) {
      const pri =
        contacts.find((c) => c && c.primary && !isEmpty(c.phone)) ||
        contacts.find((c) => c && !isEmpty(c.phone));
      if (pri) lead.phone = String(pri.phone).trim();
    }
    if (isEmpty(lead.email)) {
      const withEmail = contacts.find((c) => c && !isEmpty(c.email));
      if (withEmail) lead.email = String(withEmail.email).trim();
    }

    const revLine = row.querySelector('.lead-reviews-line');
    if (revLine) {
      const txt = String(revLine.textContent || '');
      const m = txt.match(/([\d]+(?:\.[\d]+)?)\s*\(\s*(\d+)\s*\)/);
      if (m) {
        lead.totalScore = parseFloat(m[1]) || 0;
        lead.reviewsCount = parseInt(m[2], 10) || 0;
      }
    }

    const ds = row.dataset;
    if (!isEmpty(ds.phone) && isEmpty(lead.phone)) lead.phone = ds.phone;
    if (!isEmpty(ds.address) && isEmpty(lead.address)) lead.address = ds.address;
    if (!isEmpty(ds.email) && isEmpty(lead.email)) lead.email = ds.email;
    if (!isEmpty(ds.website) && isEmpty(lead.website)) lead.website = ds.website;
    if (parseFloat(ds.rating) > 0 && !parseFloat(lead.totalScore)) {
      lead.totalScore = parseFloat(ds.rating);
    }
    if (parseInt(ds.reviews, 10) > 0 && !parseInt(lead.reviewsCount, 10)) {
      lead.reviewsCount = parseInt(ds.reviews, 10);
    }

    return lead;
  }

  function writeRowDatasetFromPaint(row, phone, address, rating, reviews) {
    if (!row || !row.dataset) return;
    const ds = row.dataset;
    if (phone && isEmpty(ds.phone)) ds.phone = phone;
    if (address && isEmpty(ds.address)) ds.address = address;
    if (rating > 0 && (!parseFloat(ds.rating) || parseFloat(ds.rating) <= 0)) {
      ds.rating = String(rating);
    }
    if (reviews > 0 && (!parseInt(ds.reviews, 10) || parseInt(ds.reviews, 10) <= 0)) {
      ds.reviews = String(reviews);
    }
  }

  function paintPanelFromLeadRecord(lead, tableRow) {
    const row = tableRow || null;
    let L = lead || (row ? findLeadRecord(row) : null);
    if (!L && row) L = {};
    if (row) L = scrapeRowIntoLead(row, L);

    const phone = pickPhone(L);
    const address = pickAddress(L);
    const rating = parseFloat(L.totalScore ?? L.rating ?? 0) || 0;
    const reviews = parseInt(L.reviewsCount ?? L.reviews ?? 0, 10) || 0;
    const locationLine = address ? formatAddress(address) : '';

    if (row) writeRowDatasetFromPaint(row, phone, address, rating, reviews);

    const headerAddr = panelEl('mobilePanelHeaderAddress');
    if (headerAddr) headerAddr.textContent = locationLine || '—';

    const addrRow = document.getElementById('headerAddressRow');
    if (addrRow) addrRow.classList.toggle('hidden', !locationLine);

    const headerPhone = panelEl('mobilePanelHeaderPhone');
    const lk = row && row.dataset ? row.dataset.leadKey || '' : L.key || '';
    if (headerPhone) {
      if (phone) {
        headerPhone.textContent = formatPhone(phone);
        headerPhone.href = '#';
        headerPhone.classList.add('js-click-to-call-number');
        headerPhone.dataset.phone = phone;
        if (lk) headerPhone.dataset.leadKey = lk;
        headerPhone.classList.remove('opacity-40', 'pointer-events-none');
      } else {
        headerPhone.textContent = '—';
        headerPhone.href = '#';
        headerPhone.classList.remove('js-click-to-call-number');
        delete headerPhone.dataset.phone;
        delete headerPhone.dataset.leadKey;
        headerPhone.classList.add('opacity-40');
      }
    }

    const starsEl = panelEl('mobilePanelStars');
    const ratingText = panelEl('mobilePanelRatingText');
    if (typeof window.__renderStarsInElement === 'function' && starsEl) {
      window.__renderStarsInElement(starsEl, rating);
    } else if (starsEl) {
      starsEl.textContent = rating > 0 ? `${rating.toFixed(1)} ★` : '—';
    }
    if (ratingText) {
      if (rating > 0) {
        ratingText.textContent = `${rating.toFixed(1)} (${reviews} reviews)`;
      } else if (reviews > 0) {
        ratingText.textContent = `— (${reviews} reviews)`;
      } else {
        ratingText.textContent = 'No rating';
      }
    }

    try {
      window.__lastPanelPaint = {
        key: lk,
        title: L.title || (row && row.dataset.title) || '',
        phone,
        address: locationLine,
        rating,
        reviews,
      };
    } catch (_) {
      /* ignore */
    }

    if (row) {
      requestAnimationFrame(() => {
        try {
          if (typeof window.syncLeadPanelMapAfterContactPaint === 'function') {
            window.syncLeadPanelMapAfterContactPaint(row);
          }
        } catch (_) {
          /* map sync optional until app.js loads */
        }
      });
    }

    return { phone, address: locationLine, rating, reviews };
  }

  window.__PIPELINE_PANEL_PAINT_V1 = '2';
  window.__paintPanelFromLeadRecord = paintPanelFromLeadRecord;
  window.__findLeadRecordForPanel = findLeadRecord;
})();
