document.addEventListener('DOMContentLoaded', () => {
  // --- Track saved leads (title -> key mapping) ---
  const savedLeads = new Map();

  // --- Search form loading state ---
  const form = document.getElementById('searchForm');
  const btn = document.getElementById('searchBtn');
  const loader = document.getElementById('loadingIndicator');

  if (form) {
    form.addEventListener('submit', () => {
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = `
          <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
          Searching...
        `;
        btn.classList.add('opacity-50', 'cursor-not-allowed');
      }
      if (loader) {
        loader.classList.remove('hidden');
      }
    });
  }

  // --- Detail panel & rows ---
  const panel = document.getElementById('detailPanel');
  const closeBtn = document.getElementById('closePanel');
  const rows = document.querySelectorAll('.result-row');
  let currentRow = null;

  // Determine page type
  const isLeadsPage = !!document.getElementById('panelRemoveBtn');
  const isResultsPage = !!document.getElementById('panelSaveBtn');

  // --- Fetch saved leads on results page to pre-fill bookmark states ---
  if (isResultsPage && rows.length > 0) {
    fetch('/leads/saved')
      .then((res) => res.json())
      .then((savedList) => {
        savedList.forEach(({ key, title }) => {
          savedLeads.set(title, key);
        });
        // Pre-fill bookmark icons for already-saved leads
        rows.forEach((row) => {
          const title = row.dataset.title;
          if (savedLeads.has(title)) {
            row.dataset.leadKey = savedLeads.get(title);
            const bookmarkBtn = row.querySelector('.bookmark-btn');
            if (bookmarkBtn) markBookmarkSaved(bookmarkBtn);
          }
        });
      })
      .catch((err) => console.error('Failed to fetch saved leads:', err));
  }

  // --- Row click -> open detail panel ---
  if (panel && rows.length > 0) {
    rows.forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.type === 'checkbox') return;
        if (e.target.closest('.bookmark-btn')) return;

        rows.forEach((r) => r.classList.remove('selected'));
        row.classList.add('selected');
        currentRow = row;

        populatePanel(row);

        // Update panel save button state (results page)
        if (isResultsPage) {
          const saveBtn = document.getElementById('panelSaveBtn');
          if (saveBtn) {
            if (savedLeads.has(row.dataset.title)) {
              markPanelBtnSaved(saveBtn);
            } else {
              markPanelBtnUnsaved(saveBtn);
            }
          }
        }

        panel.classList.add('open');
      });
    });

    // Close panel
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        panel.classList.remove('open');
        rows.forEach((r) => r.classList.remove('selected'));
        currentRow = null;
      });
    }
  }

  // --- Populate panel from row data ---
  function populatePanel(row) {
    const title = row.dataset.title;
    const phone = row.dataset.phone;
    const email = row.dataset.email;
    const website = row.dataset.website;
    const category = row.dataset.category;
    const address = row.dataset.address;
    const rating = parseFloat(row.dataset.rating);
    const reviews = parseInt(row.dataset.reviews, 10);
    const url = row.dataset.url;

    // Avatar
    const avatar = document.getElementById('panelAvatar');
    if (avatar) avatar.textContent = title.charAt(0).toUpperCase();

    // Title & category
    const panelTitle = document.getElementById('panelTitle');
    if (panelTitle) panelTitle.textContent = title;
    const panelCategory = document.getElementById('panelCategory');
    if (panelCategory) panelCategory.textContent = category !== 'N/A' ? category : '';

    // Rating
    const ratingRow = document.getElementById('panelRatingRow');
    const panelRating = document.getElementById('panelRating');
    if (panelRating && ratingRow) {
      if (rating > 0) {
        panelRating.textContent = `${rating.toFixed(1)} rating (${reviews} reviews)`;
        ratingRow.style.display = 'flex';
      } else {
        ratingRow.style.display = 'none';
      }
    }

    // Phone
    const phoneRow = document.getElementById('panelPhoneRow');
    const panelPhone = document.getElementById('panelPhone');
    if (panelPhone && phoneRow) {
      if (phone && phone !== 'N/A') {
        panelPhone.textContent = phone;
        panelPhone.href = `tel:${phone}`;
        phoneRow.style.display = 'flex';
      } else {
        phoneRow.style.display = 'none';
      }
    }

    // Email
    const emailRow = document.getElementById('panelEmailRow');
    const panelEmail = document.getElementById('panelEmail');
    if (panelEmail && emailRow) {
      if (email && email !== 'N/A') {
        panelEmail.textContent = email;
        emailRow.style.display = 'flex';
      } else {
        emailRow.style.display = 'none';
      }
    }

    // Address
    const addressRow = document.getElementById('panelAddressRow');
    const panelAddress = document.getElementById('panelAddress');
    if (panelAddress && addressRow) {
      if (address && address !== 'N/A') {
        panelAddress.textContent = address;
        addressRow.style.display = 'flex';
      } else {
        addressRow.style.display = 'none';
      }
    }

    // Website button
    const websiteBtn = document.getElementById('panelWebsiteBtn');
    if (websiteBtn) {
      if (website && website !== 'N/A') {
        websiteBtn.href = website;
        websiteBtn.style.display = 'block';
      } else {
        websiteBtn.style.display = 'none';
      }
    }

    // Google Maps button
    const mapsBtn = document.getElementById('panelMapsBtn');
    if (mapsBtn) {
      if (url) {
        mapsBtn.href = url;
      } else {
        mapsBtn.href = `https://www.google.com/maps/search/${encodeURIComponent(title)}`;
      }
    }
  }

  // --- Panel Save Lead button (results page) ---
  const panelSaveBtn = document.getElementById('panelSaveBtn');
  if (panelSaveBtn) {
    panelSaveBtn.addEventListener('click', async () => {
      if (!currentRow) return;

      const title = currentRow.dataset.title;
      const isSaved = savedLeads.has(title);

      if (isSaved) {
        await unsaveLead(currentRow);
        markPanelBtnUnsaved(panelSaveBtn);
      } else {
        await saveLead(currentRow);
        markPanelBtnSaved(panelSaveBtn);
      }
    });
  }

  // --- Bookmark icons in table rows (results page) ---
  const bookmarkBtns = document.querySelectorAll('.bookmark-btn');
  bookmarkBtns.forEach((bookmarkBtn) => {
    bookmarkBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const row = bookmarkBtn.closest('.result-row');
      if (!row) return;

      const title = row.dataset.title;
      const isSaved = savedLeads.has(title);

      if (isSaved) {
        await unsaveLead(row);
        // Sync panel button if this row is currently selected
        if (currentRow === row) {
          const saveBtn = document.getElementById('panelSaveBtn');
          if (saveBtn) markPanelBtnUnsaved(saveBtn);
        }
      } else {
        await saveLead(row);
        // Sync panel button if this row is currently selected
        if (currentRow === row) {
          const saveBtn = document.getElementById('panelSaveBtn');
          if (saveBtn) markPanelBtnSaved(saveBtn);
        }
      }
    });
  });

  // --- Remove from Leads button (leads page) ---
  const panelRemoveBtn = document.getElementById('panelRemoveBtn');
  if (panelRemoveBtn) {
    panelRemoveBtn.addEventListener('click', async () => {
      if (!currentRow) return;
      const leadKey = currentRow.dataset.leadKey;
      if (!leadKey) return;

      try {
        const res = await fetch(`/leads/${leadKey}/delete`, {
          method: 'POST',
          headers: { 'Accept': 'application/json' },
        });
        const data = await res.json();

        if (data.success) {
          // Remove row from table
          currentRow.remove();
          // Close panel
          panel.classList.remove('open');
          currentRow = null;

          // Update lead count text
          const remainingRows = document.querySelectorAll('.result-row');
          const countEl = document.querySelector('.text-sm.text-gray-500');
          if (countEl) {
            const count = remainingRows.length;
            countEl.textContent = `${count} bookmarked lead${count !== 1 ? 's' : ''}`;
          }

          // If no more leads, reload to show empty state
          if (remainingRows.length === 0) {
            window.location.reload();
          }
        }
      } catch (err) {
        console.error('Failed to remove lead:', err);
      }
    });
  }

  // --- Save a lead ---
  async function saveLead(row) {
    const leadData = {
      title: row.dataset.title,
      phone: row.dataset.phone,
      website: row.dataset.website,
      email: row.dataset.email,
      categoryName: row.dataset.category,
      address: row.dataset.address,
      city: row.dataset.city,
      totalScore: parseFloat(row.dataset.rating),
      reviewsCount: parseInt(row.dataset.reviews, 10),
      url: row.dataset.url,
    };

    try {
      const res = await fetch('/leads/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(leadData),
      });
      const data = await res.json();

      if (data.success) {
        savedLeads.set(leadData.title, data.key);
        row.dataset.leadKey = data.key;
        const bookmarkBtn = row.querySelector('.bookmark-btn');
        if (bookmarkBtn) markBookmarkSaved(bookmarkBtn);
      }
    } catch (err) {
      console.error('Failed to save lead:', err);
    }
  }

  // --- Unsave a lead ---
  async function unsaveLead(row) {
    const title = row.dataset.title;
    const leadKey = savedLeads.get(title);
    if (!leadKey) return;

    try {
      const res = await fetch(`/leads/${leadKey}/delete`, {
        method: 'POST',
        headers: { 'Accept': 'application/json' },
      });
      const data = await res.json();

      if (data.success) {
        savedLeads.delete(title);
        delete row.dataset.leadKey;
        const bookmarkBtn = row.querySelector('.bookmark-btn');
        if (bookmarkBtn) markBookmarkUnsaved(bookmarkBtn);
      }
    } catch (err) {
      console.error('Failed to unsave lead:', err);
    }
  }

  // --- UI helpers ---
  function markBookmarkSaved(btn) {
    btn.classList.remove('text-gray-300');
    btn.classList.add('text-accent');
    btn.querySelector('svg').setAttribute('fill', 'currentColor');
  }

  function markBookmarkUnsaved(btn) {
    btn.classList.remove('text-accent');
    btn.classList.add('text-gray-300');
    btn.querySelector('svg').setAttribute('fill', 'none');
  }

  function markPanelBtnSaved(btn) {
    btn.classList.remove('bg-accent', 'text-white', 'hover:bg-accent-dark');
    btn.classList.add('bg-green-50', 'text-green-600', 'hover:bg-red-50', 'hover:text-red-600');
    btn.querySelector('span').textContent = 'Saved — Click to Remove';
  }

  function markPanelBtnUnsaved(btn) {
    btn.classList.remove('bg-green-50', 'text-green-600', 'hover:bg-red-50', 'hover:text-red-600', 'bg-gray-200', 'text-gray-500');
    btn.classList.add('bg-accent', 'text-white', 'hover:bg-accent-dark');
    btn.querySelector('span').textContent = 'Save Lead';
  }

  // --- Select all checkbox ---
  const selectAll = document.getElementById('selectAll');
  const checkboxes = document.querySelectorAll('.row-checkbox');

  if (selectAll && checkboxes.length > 0) {
    selectAll.addEventListener('change', () => {
      checkboxes.forEach((cb) => {
        cb.checked = selectAll.checked;
      });
    });
  }
});
