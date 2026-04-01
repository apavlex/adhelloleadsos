document.addEventListener('DOMContentLoaded', () => {
  // --- Theme Toggle Logic (Centralized) ---
  const themeToggleBars = document.querySelectorAll('#themeToggleBtn');
  
  const setTheme = (theme) => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      localStorage.setItem('color-theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('color-theme', 'light');
    }
    // Update logo and other theme-dependent elements if necessary
    // (Tailwind's dark: mode handles most of this)
  };

  themeToggleBars.forEach(btn => {
    btn.addEventListener('click', () => {
      const isDark = document.documentElement.classList.contains('dark');
      setTheme(isDark ? 'light' : 'dark');
    });
  });
  // --- Track saved leads (title -> key mapping) ---
  const savedLeads = new Map();

  // --- Search form loading state ---
  const form = document.getElementById('searchForm');
  const btn = document.getElementById('searchBtn');
  const loader = document.getElementById('loadingIndicator');

  // Search mode toggle logic
  const modeRunNow = document.getElementById('modeRunNow');
  const modeSchedule = document.getElementById('modeSchedule');
  const searchModeInput = document.getElementById('searchModeInput');
  const autopilotSettings = document.getElementById('autopilotSettings');
  const userTimezoneInput = document.getElementById('userTimezone');
  const searchBtnLabel = btn ? btn.querySelector('span') : null;

  // Set user timezone on load
  if (userTimezoneInput) {
    userTimezoneInput.value = Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  if (modeRunNow && modeSchedule && searchModeInput) {
    modeRunNow.addEventListener('click', () => {
      searchModeInput.value = 'run';
      modeRunNow.className = 'flex-1 px-3 py-2 rounded-xl text-[10px] font-bold uppercase transition-all bg-white dark:bg-slate-700 text-brand-dark dark:text-slate-100 shadow-sm border border-brand-border/10';
      modeSchedule.className = 'flex-1 px-3 py-2 rounded-xl text-[10px] font-bold uppercase transition-all text-brand-muted dark:text-slate-400 hover:text-brand-dark dark:hover:text-slate-100';
      if (autopilotSettings) autopilotSettings.classList.add('hidden');
      if (searchBtnLabel) {
        searchBtnLabel.innerHTML = 'Find Leads<svg class="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>';
      }
    });

    modeSchedule.addEventListener('click', () => {
      searchModeInput.value = 'schedule';
      modeSchedule.className = 'flex-1 px-3 py-2 rounded-xl text-[10px] font-bold uppercase transition-all bg-white dark:bg-slate-700 text-brand-dark dark:text-slate-100 shadow-sm border border-brand-border/10';
      modeRunNow.className = 'flex-1 px-3 py-2 rounded-xl text-[10px] font-bold uppercase transition-all text-brand-muted dark:text-slate-400 hover:text-brand-dark dark:hover:text-slate-100';
      if (autopilotSettings) autopilotSettings.classList.remove('hidden');
      if (searchBtnLabel) {
        searchBtnLabel.innerHTML = 'Start Autopilot<svg class="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>';
      }
    });
  }

  if (form) {
    form.addEventListener('submit', (e) => {
      const isSchedule = searchModeInput && searchModeInput.value === 'schedule';
      
      if (!isSchedule) {
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
      } else {
        // If scheduling, we let the form submit normally or via fetch for better UX
        // We will stick to normal submit for now as its easier to handle redirect
      }
    });
  }

  // --- Navigation & Menu ---
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const mobileMenu = document.getElementById('mobileMenu');
  const closeMobileMenu = document.getElementById('closeMobileMenu');

  if (mobileMenuBtn && mobileMenu) {
    mobileMenuBtn.addEventListener('click', () => {
      mobileMenu.classList.remove('hidden');
      setTimeout(() => {
        mobileMenu.classList.add('open');
        mobileMenu.querySelector('div').classList.remove('translate-x-full');
      }, 10);
    });

    const closeNav = () => {
      mobileMenu.querySelector('div').classList.add('translate-x-full');
      mobileMenu.classList.remove('open');
      setTimeout(() => mobileMenu.classList.add('hidden'), 300);
    };

    if (closeMobileMenu) closeMobileMenu.addEventListener('click', closeNav);
    mobileMenu.addEventListener('click', (e) => {
      if (e.target === mobileMenu) closeNav();
    });
  }

  // --- Detail panel & rows ---
  const mobilePanel = document.getElementById('mobilePanel');
  const closeMobileBtn = document.getElementById('closeMobilePanel');
  const rows = document.querySelectorAll('.result-row');
  let currentRow = null;

  // Determine page type
  const isLeadsPage = !!document.getElementById('mobilePanelRemoveBtn');
  const isResultsPage = !!document.getElementById('mobilePanelSaveBtn');

  // --- Fetch saved leads on results page to pre-fill bookmark states ---
  if (isResultsPage && rows.length > 0) {
    fetch('/leads/saved')
      .then((res) => res.json())
      .then((savedList) => {
        savedList.forEach(({ key, title }) => {
          savedLeads.set(title.trim(), key);
        });
        // Pre-fill bookmark icons for already-saved leads
        rows.forEach((row) => {
          const title = row.dataset.title.trim();
          if (savedLeads.has(title)) {
            row.dataset.leadKey = savedLeads.get(title);
            const bookmarkBtn = row.querySelector('.bookmark-btn');
            if (bookmarkBtn) markBookmarkSaved(bookmarkBtn);
          }
        });
      })
      .catch((err) => console.error('Failed to fetch saved leads:', err));
  }

  // --- Row click -> open slide-up detail panel (Universal) ---
  if (mobilePanel && rows.length > 0) {
    rows.forEach((row) => {
      row.style.cursor = 'pointer'; // Ensure it looks clickable
      
      row.addEventListener('click', (e) => {
        // Stop if clicking specific interactive elements
        if (e.target.type === 'checkbox' || 
            e.target.closest('.bookmark-btn') || 
            e.target.closest('form') ||
            e.target.closest('a')) {
          return;
        }

        console.log('Row clicked:', row.dataset.title);
        
        // Remove existing selection
        rows.forEach((r) => r.classList.remove('selected'));
        row.classList.add('selected');
        
        currentRow = row;
        populatePanel(row);

        // Update panel save button state (results page)
        if (isResultsPage) {
          const mobileSaveBtn = document.getElementById('mobilePanelSaveBtn');
          if (mobileSaveBtn) {
            if (savedLeads.has(row.dataset.title)) {
              markPanelBtnSaved(mobileSaveBtn);
            } else {
              markPanelBtnUnsaved(mobileSaveBtn);
            }
          }
        }

        // OPEN SIDEBAR / PANEL
        console.log('Opening sidebar for:', row.dataset.title);
        
        // 1. Prepare container
        mobilePanel.style.display = 'flex';
        mobilePanel.classList.remove('hidden');
        
        // 2. Lock scroll
        document.body.style.overflow = 'hidden'; 
        
        // 3. Trigger entrance with slight delay for browser paint
        setTimeout(() => {
            mobilePanel.classList.add('open');
            mobilePanel.classList.replace('opacity-0', 'opacity-100');
            mobilePanel.style.pointerEvents = 'auto';
            
            const childDiv = mobilePanel.querySelector('div');
            if (childDiv) {
                childDiv.classList.remove('translate-y-full', 'translate-x-full');
                childDiv.style.display = 'block';
            }
        }, 10);
      });
    });

    if (closeMobileBtn) {
        closeMobileBtn.addEventListener('click', () => {
            mobilePanel.classList.remove('open');
            mobilePanel.classList.replace('opacity-100', 'opacity-0');
            mobilePanel.style.pointerEvents = 'none';
            setTimeout(() => mobilePanel.classList.add('hidden'), 300);
            document.body.style.overflow = '';
            rows.forEach((r) => r.classList.remove('selected'));
            currentRow = null;
        });
    }

    // Close mobile panel on backdrop click
    mobilePanel.addEventListener('click', (e) => {
        if (e.target === mobilePanel) {
            mobilePanel.classList.remove('open');
            mobilePanel.classList.replace('opacity-100', 'opacity-0');
            mobilePanel.style.pointerEvents = 'none';
            setTimeout(() => mobilePanel.classList.add('hidden'), 300);
            document.body.style.overflow = '';
            rows.forEach((r) => r.classList.remove('selected'));
            currentRow = null;
        }
    });
  }

  // --- Populate panel from row data ---
  function populatePanel(row) {
    const title = row.dataset.title;
    const phone = row.dataset.phone;
    const website = row.dataset.website;
    const rating = parseFloat(row.dataset.rating);
    const reviews = parseInt(row.dataset.reviews, 10);
    const url = row.dataset.url;
    const email = row.dataset.email;
    const facebook = row.dataset.facebook;
    const instagram = row.dataset.instagram;
    const twitter = row.dataset.twitter;
    const address = row.dataset.address;
    const category = row.dataset.category;
    const loomUrl = row.dataset.loomUrl;

    // Avatar Logic (using DiceBear for variety)
    const avatarImg = document.querySelector('#mobilePanelAvatarImg img');
    if (avatarImg) {
      const seed = title.replace(/\s+/g, '-').toLowerCase();
      avatarImg.src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${seed}`;
    }

    const panelTitle = document.getElementById('mobilePanelTitle');
    if (panelTitle) panelTitle.textContent = title;

    const panelCategory = document.getElementById('mobilePanelCategory');
    if (panelCategory) panelCategory.textContent = category;

    // Loom URL Input
    const loomInput = document.getElementById('loomUrlInput');
    if (loomInput) loomInput.value = loomUrl || '';

    // Details logic
    const ratingEl = document.getElementById('mobilePanelRating');
    if (ratingEl) ratingEl.textContent = rating > 0 ? `${rating.toFixed(1)} Rating` : 'No Rating';
    
    const reviewsEl = document.getElementById('mobilePanelReviews');
    if (reviewsEl) reviewsEl.textContent = reviews > 0 ? `${reviews}+ Reviews` : 'No Reviews';

    const emailEl = document.getElementById('mobilePanelEmail');
    if (emailEl) emailEl.textContent = (email && email !== 'N/A') ? email : 'No Email Available';

    const addressEl = document.getElementById('mobilePanelAddress');
    if (addressEl) addressEl.textContent = (address && address !== 'N/A') ? address : 'Address Not Listed';

    // Links
    const websiteBtn = document.getElementById('mobilePanelWebsiteBtn');
    if (websiteBtn) websiteBtn.href = (website && website !== 'N/A') ? website : '#';
    
    const xBtn = document.getElementById('mobilePanelXBtn');
    if (xBtn) xBtn.href = (twitter && twitter !== 'N/A') ? twitter : '#';

    const mapsBtn = document.getElementById('mobilePanelMapsBtn');
    if (mapsBtn) mapsBtn.href = url || '#';

    // Badges / Tags based on category
    const badgeContainer = document.getElementById('badgeContainer');
    if (badgeContainer) {
      badgeContainer.innerHTML = '';
      const tags = [category, 'USA', 'Verified Lead'];
      if (rating >= 4.5) tags.push('Top Rated');
      if (reviews > 50) tags.push('Popular');
      
      tags.forEach(tag => {
        const span = document.createElement('span');
        span.className = 'px-4 py-2 rounded-xl border border-brand-border/60 text-[11px] font-bold text-brand-dark bg-white';
        span.textContent = tag;
        badgeContainer.appendChild(span);
      });
    }
  }

  // --- Lead Management Actions ---
  const statusSelect = document.getElementById('leadStatusSelect');
  if (statusSelect) {
    statusSelect.addEventListener('change', async () => {
      if (!currentRow) return;
      const key = currentRow.dataset.leadKey;
      const newStatus = statusSelect.value;
      
      try {
        const res = await fetch(`/leads/${key}/update`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus })
        });
        const data = await res.json();
        if (data.success) {
          currentRow.dataset.status = newStatus;
          currentRow.dataset.updates = JSON.stringify(data.lead.updates);
          populatePanel(currentRow);
          // Update table badge (simplified)
          window.location.reload(); // Quickest way to sync table badges for now
        }
      } catch (err) { console.error('Status update failed:', err); }
    });
  }

  const addNoteBtn = document.getElementById('addNoteBtn');
  if (addNoteBtn) {
    addNoteBtn.addEventListener('click', async () => {
      if (!currentRow) return;
      const key = currentRow.dataset.leadKey;
      const content = document.getElementById('noteInput').value;
      if (!content) return;

      try {
        const res = await fetch(`/leads/${key}/notes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content })
        });
        const data = await res.json();
        if (data.success) {
          currentRow.dataset.updates = JSON.stringify(data.updates);
          document.getElementById('noteInput').value = '';
          populatePanel(currentRow);
        }
      } catch (err) { console.error('Note addition failed:', err); }
    });
  }

  // --- Loom URL Auto-save ---
  const loomInput = document.getElementById('loomUrlInput');
  if (loomInput) {
    // Save on blur (when user clicks out of the input box)
    loomInput.addEventListener('blur', async () => {
      if (!currentRow) return;
      const key = currentRow.dataset.leadKey;
      const newLoomUrl = loomInput.value.trim();

      // Only save if it actually changed
      if (currentRow.dataset.loomUrl === newLoomUrl) return;

      try {
        const res = await fetch(`/leads/${key}/update`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ loomUrl: newLoomUrl })
        });
        const data = await res.json();
        if (data.success) {
          currentRow.dataset.loomUrl = newLoomUrl;
          // Optionally add a tiny 'saved' toast here if needed
        }
      } catch (err) { console.error('Loom URL update failed:', err); }
    });
  }

  // --- Generate Mailto Email Draft ---
  const draftEmailBtn = document.getElementById('draftEmailBtn');
  if (draftEmailBtn) {
    draftEmailBtn.addEventListener('click', () => {
      if (!currentRow) return;
      
      const title = currentRow.dataset.title || 'there';
      const city = currentRow.dataset.city || 'your area';
      const email = currentRow.dataset.email;
      const loomLink = document.getElementById('loomUrlInput').value.trim();

      if (!loomLink) {
        alert("Please paste a Loom Video Link first before drafting the email.");
        return;
      }

      const subject = encodeURIComponent(`Saw ${title}'s website - made you a quick video`);
      const bodyText = `Hey ${title} team,\n\nI was looking for businesses in ${city} and found your site. I recorded a quick 2-minute video sharing a few layout ideas that could help increase your conversions:\n\n${loomLink}\n\nLet me know what you think!\n\nBest,\n[Your Name]`;
      
      const body = encodeURIComponent(bodyText);
      
      let mailtoStr = `mailto:`;
      if (email && email !== 'N/A') {
        mailtoStr += encodeURIComponent(email);
      }
      mailtoStr += `?subject=${subject}&body=${body}`;

      // Open default mail client
      window.location.href = mailtoStr;

      // Automatically update status to 'Email Sent'
      if (typeof statusSelect !== 'undefined' && statusSelect) {
        statusSelect.value = 'Email Sent';
        statusSelect.dispatchEvent(new Event('change'));
      }
    });
  }

  // --- Manual Deep Enhance with Firecrawl ---
  const deepEnhanceBtn = document.getElementById('deepEnhanceBtn');
  if (deepEnhanceBtn) {
    deepEnhanceBtn.addEventListener('click', async () => {
      if (!currentRow) return;
      const key = currentRow.dataset.leadKey;
      const website = currentRow.dataset.website;

      if (!website || website === 'N/A') {
        alert("This lead has no website to scan.");
        return;
      }

      const originalHTML = deepEnhanceBtn.innerHTML;
      deepEnhanceBtn.disabled = true;
      deepEnhanceBtn.innerHTML = `
        <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
        </svg>
        <span>Hunting Emails...</span>
      `;

      try {
        const res = await fetch(`/leads/${key}/enhance`, {
          method: 'POST'
        });
        const data = await res.json();
        
        if (data.success) {
          // Update local dataset
          if (data.lead.email && data.lead.email !== 'N/A') currentRow.dataset.email = data.lead.email;
          if (data.lead.facebook && data.lead.facebook !== 'N/A') currentRow.dataset.facebook = data.lead.facebook;
          if (data.lead.instagram && data.lead.instagram !== 'N/A') currentRow.dataset.instagram = data.lead.instagram;
          if (data.lead.twitter && data.lead.twitter !== 'N/A') currentRow.dataset.twitter = data.lead.twitter;
          
          currentRow.dataset.updates = JSON.stringify(data.lead.updates);
          
          // Refresh Panel UI
          populatePanel(currentRow);
          alert(`Deep enhancement complete! We found new contact details for ${data.lead.title}.`);
        } else {
          alert("We couldn't find any additional contact data for this website yet.");
        }
      } catch (err) {
        console.error('Enhancement failed:', err);
        alert("Enhancement failed. Please check your Firecrawl API key in Cloud Run.");
      } finally {
        deepEnhanceBtn.disabled = false;
        deepEnhanceBtn.innerHTML = originalHTML;
      }
    });
  }

  // --- Panel Save Lead button (results page) ---
  const panelSaveButtons = ['panelSaveBtn', 'mobilePanelSaveBtn'];
  panelSaveButtons.forEach(id => {
      const btn = document.getElementById(id);
      if (btn) {
          btn.addEventListener('click', async () => {
              if (!currentRow) return;

              const title = currentRow.dataset.title;
              const isSaved = savedLeads.has(title);

              if (isSaved) {
                  await unsaveLead(currentRow);
                  panelSaveButtons.forEach(id => {
                      const b = document.getElementById(id);
                      if (b) markPanelBtnUnsaved(b);
                  });
              } else {
                  await saveLead(currentRow);
                  panelSaveButtons.forEach(id => {
                      const b = document.getElementById(id);
                      if (b) markPanelBtnSaved(b);
                  });
              }
          });
      }
  });

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
          panelSaveButtons.forEach(id => {
              const b = document.getElementById(id);
              if (b) markPanelBtnUnsaved(b);
          });
        }
      } else {
        await saveLead(row);
        // Sync panel button if this row is currently selected
        if (currentRow === row) {
          panelSaveButtons.forEach(id => {
              const b = document.getElementById(id);
              if (b) markPanelBtnSaved(b);
          });
        }
      }
    });
  });

  // --- Remove from Leads button (leads page) ---
  const removeButtons = ['panelRemoveBtn', 'mobilePanelRemoveBtn'];
  removeButtons.forEach(id => {
      const btn = document.getElementById(id);
      if (btn) {
          btn.addEventListener('click', async () => {
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
                      // Close panels
                      const panel = document.getElementById('sidePanel');
                      if (panel) panel.classList.remove('open');
                      if (mobilePanel) {
                          mobilePanel.classList.remove('open');
                          mobilePanel.classList.replace('opacity-100', 'opacity-0');
                          setTimeout(() => mobilePanel.classList.add('hidden'), 300);
                          document.body.style.overflow = '';
                      }
                      currentRow = null;

                      // Update lead count text
                      const remainingRows = document.querySelectorAll('.result-row');
                      const countEl = document.querySelector('.text-brand-muted.font-medium');
                      if (countEl) {
                          const count = remainingRows.length;
                          countEl.textContent = `You have ${count} bookmarked lead${count !== 1 ? 's' : ''} in your collection.`;
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
  });

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
      facebook: row.dataset.facebook,
      instagram: row.dataset.instagram,
      twitter: row.dataset.twitter,
    };

    try {
      const res = await fetch('/leads/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(leadData),
      });
      const data = await res.json();

      if (data.success) {
        savedLeads.set(leadData.title.trim(), data.key);
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
    const title = row.dataset.title.trim();
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
    btn.classList.add('bg-brand-yellow', 'text-brand-dark', 'border-brand-yellow');
    btn.classList.remove('text-brand-muted', 'border-brand-border');
    const svg = btn.querySelector('svg');
    if (svg) svg.setAttribute('fill', 'currentColor');
  }

  function markBookmarkUnsaved(btn) {
    btn.classList.remove('bg-brand-yellow', 'text-brand-dark', 'border-brand-yellow');
    btn.classList.add('text-brand-muted', 'border-brand-border');
    const svg = btn.querySelector('svg');
    if (svg) svg.setAttribute('fill', 'none');
  }

  function markPanelBtnSaved(btn) {
    btn.classList.remove('btn-primary');
    btn.classList.add('bg-brand-dark', 'text-white');
    btn.textContent = 'Saved';
  }

  function markPanelBtnUnsaved(btn) {
    btn.classList.remove('bg-brand-dark', 'text-white');
    btn.classList.add('btn-primary');
    btn.textContent = 'Save Lead';
  }

  // --- Bulk Selection & Actions ---
  const selectAllLeads = document.getElementById('selectAllLeads');
  const leadCheckboxes = document.querySelectorAll('.lead-checkbox');
  const bulkActionBar = document.getElementById('bulkActionBar');
  const selectedCountCircle = document.getElementById('selectedCountCircle');
  const cancelSelectionBtn = document.getElementById('cancelSelectionBtn');
  const bulkExportBtn = document.getElementById('bulkExportBtn');
  const bulkEnhanceBtn = document.getElementById('bulkEnhanceBtn');

  let selectedKeys = new Set();

  const updateBulkActionBar = () => {
    const count = selectedKeys.size;
    if (selectedCountCircle) selectedCountCircle.textContent = count;
    
    if (count > 0) {
      bulkActionBar.style.pointerEvents = 'auto';
      bulkActionBar.classList.remove('opacity-0', 'translate-y-20');
      bulkActionBar.classList.add('opacity-100', 'translate-y-0');
    } else {
      bulkActionBar.style.pointerEvents = 'none';
      bulkActionBar.classList.remove('opacity-100', 'translate-y-0');
      bulkActionBar.classList.add('opacity-0', 'translate-y-20');
    }
  };

  if (selectAllLeads) {
    selectAllLeads.addEventListener('change', (e) => {
      const isChecked = e.target.checked;
      leadCheckboxes.forEach(cb => {
        cb.checked = isChecked;
        const key = cb.dataset.key;
        if (isChecked) selectedKeys.add(key);
        else selectedKeys.delete(key);
      });
      updateBulkActionBar();
    });
  }

  leadCheckboxes.forEach(cb => {
    cb.addEventListener('change', (e) => {
      const key = cb.dataset.key;
      if (e.target.checked) selectedKeys.add(key);
      else {
        selectedKeys.delete(key);
        if (selectAllLeads) selectAllLeads.checked = false;
      }
      updateBulkActionBar();
    });
  });

  if (cancelSelectionBtn) {
    cancelSelectionBtn.addEventListener('click', () => {
      selectedKeys.clear();
      leadCheckboxes.forEach(cb => cb.checked = false);
      if (selectAllLeads) selectAllLeads.checked = false;
      updateBulkActionBar();
    });
  }

  // Bulk Export (CSV)
  if (bulkExportBtn) {
    bulkExportBtn.addEventListener('click', () => {
      if (selectedKeys.size === 0) return;
      
      const selectedRows = Array.from(leadCheckboxes)
        .filter(cb => selectedKeys.has(cb.dataset.key))
        .map(cb => cb.closest('.result-row'));

      let csv = 'Company,Category,Address,Phone,Website,Status,Rating,Reviews\n';
      selectedRows.forEach(row => {
        const d = row.dataset;
        const rowData = [
          `"${d.title}"`,
          `"${d.category}"`,
          `"${d.address}"`,
          `"${d.phone}"`,
          `"${d.website}"`,
          `"${d.status}"`,
          d.rating,
          d.reviews
        ];
        csv += rowData.join(',') + '\n';
      });

      const blob = new Blob([csv], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.setAttribute('hidden', '');
      a.setAttribute('href', url);
      a.setAttribute('download', `leads_export_${new Date().getTime()}.csv`);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
  }

  // Bulk Enhance (Firecrawl)
  if (bulkEnhanceBtn) {
    bulkEnhanceBtn.addEventListener('click', async () => {
      if (selectedKeys.size === 0) return;
      
      const keys = Array.from(selectedKeys);
      const originalHTML = bulkEnhanceBtn.innerHTML;
      bulkEnhanceBtn.disabled = true;
      
      let processed = 0;
      const total = keys.length;

      for (const key of keys) {
        processed++;
        bulkEnhanceBtn.innerHTML = `
          <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
          <span class="text-[10px] font-black uppercase tracking-widest">${processed}/${total}</span>
        `;

        try {
          await fetch(`/leads/${key}/enhance`, { method: 'POST' });
        } catch (err) {
          console.error(`Failed to enhance lead ${key}:`, err);
        }
      }

      bulkEnhanceBtn.innerHTML = originalHTML;
      bulkEnhanceBtn.disabled = false;
      alert(`Bulk enhancement complete for ${total} leads! Updating view...`);
      window.location.reload();
    });
  }

  // --- Website Preview Hover Logic (Global) ---
  const websitePreview = document.getElementById('websitePreview');
  const previewIframe = document.getElementById('previewIframe');
  const previewUrlText = document.getElementById('previewUrlText');
  const previewLoading = document.getElementById('previewLoading');
  const previewNewTabBtn = document.getElementById('previewNewTabBtn');

  let previewTimeout;

  document.addEventListener('mouseover', (e) => {
    const link = e.target.closest('.website-link');
    if (!link) return;

    const url = link.getAttribute('data-url');
    if (!url || !websitePreview) return;
    
    if (previewNewTabBtn) previewNewTabBtn.href = url;
    if (previewTimeout) clearTimeout(previewTimeout);

    previewTimeout = setTimeout(() => {
      const rect = link.getBoundingClientRect();
      let top = rect.top + window.scrollY;
      let left = rect.left + (rect.width / 2);
      let translateY = '-100%';
      let marginTop = '-15px';

      if (rect.top < 350) {
        top = rect.bottom + window.scrollY;
        translateY = '0';
        marginTop = '15px';
      }

      if (left < 200) left = 200;
      if (window.innerWidth - left < 200) left = window.innerWidth - 200;

      websitePreview.style.top = `${top}px`;
      websitePreview.style.left = `${left}px`;
      websitePreview.style.transform = `translate(-50%, ${translateY})`;
      websitePreview.style.marginTop = marginTop;
      
      if (previewUrlText) previewUrlText.textContent = url;
      if (previewIframe) {
        previewIframe.src = 'about:blank';
        if (previewLoading) previewLoading.style.display = 'flex';
        websitePreview.classList.remove('hidden');
        setTimeout(() => {
          websitePreview.classList.remove('opacity-0');
          websitePreview.classList.add('opacity-100');
        }, 10);

        setTimeout(() => {
            previewIframe.src = url;
            previewIframe.onload = () => {
                if (previewLoading) previewLoading.style.display = 'none';
            };
        }, 50);
      }
    }, 400);
  });

  document.addEventListener('mouseout', (e) => {
    const link = e.target.closest('.website-link');
    if (!link || !websitePreview) return;
    clearTimeout(previewTimeout);
    websitePreview.classList.remove('opacity-100');
    websitePreview.classList.add('opacity-0');
    setTimeout(() => {
      if (websitePreview.classList.contains('opacity-0')) {
        websitePreview.classList.add('hidden');
        if (previewIframe) previewIframe.src = 'about:blank';
      }
    }, 200);
  });
});
