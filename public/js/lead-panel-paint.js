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

  function pickWebsite(lead) {
    if (!lead) return '';
    if (!isEmpty(lead.website)) return String(lead.website).trim();
    return '';
  }

  function normalizeWebsiteHref(raw) {
    const w = String(raw || '').trim();
    if (!w || w === 'N/A' || w === '—' || w.length < 3) return '';
    if (/^https?:\/\//i.test(w)) return w;
    return `https://${w.replace(/^\/+/, '')}`;
  }

  function resolveMapsHrefFromLead(L, row) {
    const isGoogleMapsListingUrl = (absUrl) => {
      try {
        const u = new URL(absUrl);
        const h = u.hostname.replace(/^www\./, '').toLowerCase();
        if (h === 'maps.app.goo.gl') return true;
        if (h === 'goo.gl' && u.pathname.includes('maps')) return true;
        if (h.endsWith('google.com') || h.endsWith('google.co.uk')) {
          if (u.pathname.includes('/maps/')) return true;
          if (u.search.includes('cid=') || u.search.includes('q=place_id:')) return true;
        }
        return false;
      } catch (_) {
        return false;
      }
    };

    const urlRaw = String((L && L.url) || (row && row.dataset && row.dataset.url) || '').trim();
    if (urlRaw && /^https?:\/\//i.test(urlRaw) && isGoogleMapsListingUrl(urlRaw)) return urlRaw;

    const title = String((L && L.title) || (row && row.dataset && row.dataset.title) || '').trim();
    const address = pickAddress(L) || String((row && row.dataset && row.dataset.address) || '').trim();
    const city = String((L && L.city) || (row && row.dataset && row.dataset.city) || '').trim();
    if (address && address !== 'N/A') {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${address} ${title}`.trim())}`;
    }
    if (title && city) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${title} ${city}`.trim())}`;
    }
    if (title) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(title)}`;
    }
    return '';
  }

  function paintQuickOutreachLinks(L, row) {
    let website = pickWebsite(L);
    if (isEmpty(website) && row && typeof row.querySelector === 'function') {
      const webLink = row.querySelector('.website-link[data-url], a.website-link[href]');
      if (webLink) {
        const w = String(webLink.getAttribute('data-url') || webLink.getAttribute('href') || '').trim();
        if (!isEmpty(w) && !/^#$/i.test(w)) website = w.replace(/\/$/, '');
      }
    }
    if (isEmpty(website) && row && row.dataset && !isEmpty(row.dataset.website)) {
      website = String(row.dataset.website).trim();
    }

    const websiteHref = normalizeWebsiteHref(website);
    const websiteLink = panelEl('mobilePanelWebsiteLink');
    const websiteShort = panelEl('mobilePanelWebsiteShort');
    if (websiteShort) {
      try {
        if (!websiteHref) {
          websiteShort.textContent = 'No website';
        } else {
          const domain = new URL(websiteHref).hostname.replace(/^www\./i, '');
          websiteShort.textContent = domain && domain.length > 1 ? domain : 'Website';
        }
      } catch (_) {
        websiteShort.textContent = websiteHref ? String(website).slice(0, 32) : 'No website';
      }
    }
    if (websiteLink) {
      websiteLink.target = '_blank';
      websiteLink.rel = 'noopener noreferrer';
      if (websiteHref) {
        websiteLink.href = websiteHref;
        websiteLink.classList.remove('opacity-20', 'pointer-events-none', 'cursor-not-allowed');
        websiteLink.removeAttribute('aria-disabled');
        websiteLink.onclick = null;
      } else {
        websiteLink.href = '#';
        websiteLink.classList.add('opacity-20', 'pointer-events-none', 'cursor-not-allowed');
        websiteLink.setAttribute('aria-disabled', 'true');
        websiteLink.onclick = (ev) => ev.preventDefault();
      }
    }

    const address = pickAddress(L);
    const locationLine = address ? formatAddress(address) : '';
    const mapsHref = resolveMapsHrefFromLead(L, row);
    const mapsLink = panelEl('mobilePanelMapsLink');
    const addressEl = panelEl('mobilePanelAddress');
    if (addressEl) {
      addressEl.textContent = locationLine || 'Open in Maps';
    }
    if (mapsLink) {
      mapsLink.target = '_blank';
      mapsLink.rel = 'noopener noreferrer';
      if (mapsHref) {
        mapsLink.href = mapsHref;
        mapsLink.classList.remove('opacity-20', 'pointer-events-none', 'cursor-not-allowed');
        mapsLink.removeAttribute('aria-disabled');
        mapsLink.onclick = null;
      } else {
        mapsLink.href = '#';
        mapsLink.classList.add('opacity-20', 'pointer-events-none', 'cursor-not-allowed');
        mapsLink.setAttribute('aria-disabled', 'true');
        mapsLink.onclick = (ev) => ev.preventDefault();
      }
    }

    if (row && row.dataset) {
      if (website && isEmpty(row.dataset.website)) row.dataset.website = website;
      if (address && isEmpty(row.dataset.address)) row.dataset.address = address;
      if (L && !isEmpty(L.url) && isEmpty(row.dataset.url)) row.dataset.url = String(L.url).trim();
    }
  }

  function scrapeRowIntoLead(row, base) {
    const lead = base && typeof base === 'object' ? { ...base } : {};
    if (!row || typeof row.querySelector !== 'function') return lead;

    const addrEl =
      row.querySelector('.lead-row-address--detail') || row.querySelector('.lead-row-address');
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

    const webLink = row.querySelector('.website-link[data-url], a.website-link[href]');
    if (webLink && isEmpty(lead.website)) {
      const w = String(webLink.getAttribute('data-url') || webLink.getAttribute('href') || '').trim();
      if (!isEmpty(w) && !/^#$/i.test(w)) lead.website = w.replace(/\/$/, '');
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
    if (!isEmpty(ds.url) && isEmpty(lead.url)) lead.url = ds.url;
    if (parseFloat(ds.rating) > 0 && !parseFloat(lead.totalScore)) {
      lead.totalScore = parseFloat(ds.rating);
    }
    if (parseInt(ds.reviews, 10) > 0 && !parseInt(lead.reviewsCount, 10)) {
      lead.reviewsCount = parseInt(ds.reviews, 10);
    }

    return lead;
  }

  function writeRowDatasetFromPaint(row, phone, address, rating, reviews, website, url) {
    if (!row || !row.dataset) return;
    const ds = row.dataset;
    if (phone && isEmpty(ds.phone)) ds.phone = phone;
    if (address && isEmpty(ds.address)) ds.address = address;
    if (website && isEmpty(ds.website)) ds.website = website;
    if (url && isEmpty(ds.url)) ds.url = url;
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
    const website = pickWebsite(L);
    const url = L && !isEmpty(L.url) ? String(L.url).trim() : '';
    const rating = parseFloat(L.totalScore ?? L.rating ?? 0) || 0;
    const reviews = parseInt(L.reviewsCount ?? L.reviews ?? 0, 10) || 0;
    const locationLine = address ? formatAddress(address) : '';
    const title =
      !isEmpty(L.title) ? String(L.title).trim()
      : row && row.dataset && !isEmpty(row.dataset.title) ? String(row.dataset.title).trim()
      : '';
    const categoryRaw = L.categoryName != null ? L.categoryName : L.category;
    const category =
      !isEmpty(categoryRaw) ? String(categoryRaw).trim()
      : row && row.dataset && !isEmpty(row.dataset.category) ? String(row.dataset.category).trim()
      : '';

    if (row) writeRowDatasetFromPaint(row, phone, address, rating, reviews, website, url);

    const panelTitle = panelEl('mobilePanelTitle');
    if (panelTitle && title) panelTitle.textContent = title;
    const stickyTitle = document.getElementById('stickyPanelTitle');
    if (stickyTitle && title) stickyTitle.textContent = title;
    const avatar = panelEl('mobilePanelAvatar');
    if (avatar && title) avatar.textContent = title.charAt(0).toUpperCase();
    const panelCategory = panelEl('mobilePanelCategory');
    if (panelCategory && category) panelCategory.textContent = category;

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

    paintQuickOutreachLinks(L, row);

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
          if (typeof window.__paintLeadPanelQuickOutreach === 'function') {
            window.__paintLeadPanelQuickOutreach(row);
          }
          if (typeof window.syncLeadPanelMapAfterContactPaint === 'function') {
            window.syncLeadPanelMapAfterContactPaint(row);
          }
          if (typeof window.__renderLeadTagsPanel === 'function') {
            window.__renderLeadTagsPanel(row);
          }
        } catch (_) {
          /* map sync optional until app.js loads */
        }
      });
    }

    return { phone, address: locationLine, rating, reviews };
  }

  window.__PIPELINE_PANEL_PAINT_V1 = '3';
  window.__paintPanelFromLeadRecord = paintPanelFromLeadRecord;
  window.__findLeadRecordForPanel = findLeadRecord;
})();
