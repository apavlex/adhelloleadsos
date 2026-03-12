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

  const generatePromptBtn = document.getElementById('generatePromptBtn');
  if (generatePromptBtn) {
    generatePromptBtn.addEventListener('click', async () => {
      if (!currentRow) return;
      const key = currentRow.dataset.leadKey;
      generatePromptBtn.disabled = true;
      generatePromptBtn.textContent = 'Generating...';

      try {
        const res = await fetch(`/leads/${key}/generate-prompt`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          currentRow.dataset.outreachPrompt = data.prompt;
          document.getElementById('outreachPromptArea').value = data.prompt;
        }
      } catch (err) { console.error('Prompt generation failed:', err); }
      finally {
        generatePromptBtn.disabled = false;
        generatePromptBtn.textContent = 'Generate AI Prompt';
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

  // --- Select all checkbox ---
  const selectAll = document.getElementById('selectAll');
  if (selectAll) {
    selectAll.addEventListener('change', (e) => {
      const isChecked = e.target.checked;
      const checkboxes = document.querySelectorAll('.row-checkbox');
      checkboxes.forEach((cb) => {
        cb.checked = isChecked;
      });
    });
  }
});
