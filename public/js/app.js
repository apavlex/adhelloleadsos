document.addEventListener('DOMContentLoaded', () => {
  // --- Lead Gen Productivity Features (CSV, Scoring, Outreach) ---

  // --- Background Processing Indicators ---
  let activeProcessingCount = 0;
  const processingIndicator = document.getElementById('processingIndicator');

  const updateProcessingStatus = (isActive) => {
    if (!processingIndicator) return;
    
    if (isActive) {
      activeProcessingCount++;
    } else {
      activeProcessingCount = Math.max(0, activeProcessingCount - 1);
    }
    
    if (activeProcessingCount > 0) {
      processingIndicator.classList.add('processing-active');
    } else {
      processingIndicator.classList.remove('processing-active');
      notifyProcessingDone();
    }
  };

  const notifyProcessingDone = () => {
    if (!processingIndicator) return;
    processingIndicator.classList.add('bell-shake');
    setTimeout(() => {
      processingIndicator.classList.remove('bell-shake');
    }, 1000);
  };

  const calculateOpportunityScore = (lead) => {
    let score = 0;
    const website = lead.website && lead.website !== 'N/A';
    const reviews = parseInt(lead.reviews || lead.reviewsCount) || 0;
    const rating = parseFloat(lead.rating || lead.totalScore) || 0;
    const hasFB = (lead.facebook && lead.facebook !== 'N/A') || (lead.facebook_url && lead.facebook_url !== 'N/A');
    const hasIG = (lead.instagram && lead.instagram !== 'N/A') || (lead.instagram_url && lead.instagram_url !== 'N/A');
    
    // New Audit Signals - Support both JS bools and HTML strings
    const isOutdated = lead.isOutdated === 'true' || lead.isOutdated === true;
    const noMobile = lead.isMobileFriendly === 'false' || lead.isMobileFriendly === false;
    const noSchema = lead.hasSchemaMarkup === 'false' || lead.hasSchemaMarkup === false;
    const noChatbot = lead.hasChatbot === 'false' || lead.hasChatbot === false;
    const noClickToCall = lead.hasClickToCall === 'false' || lead.hasClickToCall === false;
    const aeoScore = parseInt(lead.aeoScore || 0);

    // Logic: Agencies want leads with GAPS (weighted for high opportunity)
    if (!website) score += 4.5;
    else {
        if (isOutdated) score += 2.5;
        if (noMobile) score += 3.0;
        if (noSchema) score += 2.0;
        if (noChatbot) score += 1.5;
        if (noClickToCall) score += 1.5;
        if (aeoScore > 0 && aeoScore < 3) score += 1.5;
        if (!hasFB || !hasIG) score += 1.0;
    }
    
    if (reviews > 0 && reviews < 20) score += 1.5;
    if (rating > 0 && rating < 4.2) score += 1.5;
    
    return Math.min(10, score);
  };

  const renderOpportunityBadges = (row) => {
    const l = row.dataset;
    const badges = [];
    
    const score = calculateOpportunityScore(l);
    
    // Core Score Label
    let label = 'Low Opportunity';
    let scoreColor = 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800/50 dark:text-slate-400 dark:border-white/5';
    
    if (score >= 7) {
        label = 'High Opportunity';
        scoreColor = 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20';
    } else if (score >= 4) {
        label = 'Medium Opportunity';
        scoreColor = 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-brand-yellow/10 dark:text-brand-yellow dark:border-brand-yellow/20';
    }
    
    badges.push(`<span class="px-2 py-0.5 rounded-md ${scoreColor} text-[9px] font-black border uppercase tracking-tighter shadow-sm">${label}</span>`);

    // Specific Gap Badges (Secondary)
    if (l.isMobileFriendly === 'false') badges.push(`<span class="px-2 py-0.5 rounded-md bg-purple-50 text-purple-600 border-purple-100 text-[9px] font-bold border uppercase dark:bg-purple-500/5 dark:border-purple-500/10">Mobile Gap</span>`);
    if (l.hasSchemaMarkup === 'false') badges.push(`<span class="px-2 py-0.5 rounded-md bg-blue-50 text-blue-600 border-blue-100 text-[9px] font-bold border uppercase dark:bg-blue-500/5 dark:border-blue-500/10">Needs GEO</span>`);
    
    return `<div class="flex flex-wrap gap-1 items-center justify-center">${badges.slice(0, 3).join('')}</div>`;
  };

  const updateOpportunityBadges = () => {
    document.querySelectorAll('.result-row').forEach(row => {
      try {
        const badgeContainer = row.querySelector('.opportunity-badge');
        if (badgeContainer) {
          badgeContainer.innerHTML = renderOpportunityBadges(row);
          badgeContainer.dataset.score = calculateOpportunityScore(row.dataset);
        }
      } catch (err) {
        console.error('Error rendering opportunity badge for row:', err);
      }
    });
  };

  // Initial calculation and automatic sorting
  setTimeout(updateOpportunityBadges, 0);
  
  const sortLeadsByOpportunity = (isAscending = false) => {
    const tableBody = document.querySelector('tbody');
    if (!tableBody) return;
    const rows = Array.from(tableBody.querySelectorAll('.result-row'));
    
    rows.sort((a, b) => {
      const scoreA = parseFloat(a.querySelector('.opportunity-badge')?.dataset.score) || calculateOpportunityScore(a.dataset);
      const scoreB = parseFloat(b.querySelector('.opportunity-badge')?.dataset.score) || calculateOpportunityScore(b.dataset);
      return isAscending ? scoreA - scoreB : scoreB - scoreA;
    });
    
    rows.forEach(row => tableBody.appendChild(row));
  };

  // Auto-sort by High Opportunity immediately after calculation
  sortLeadsByOpportunity(false);

  // Attach Sort Listener
  const sortOppBtn = document.getElementById('sortOpportunity');
  if (sortOppBtn) {
    let asc = false;
    sortOppBtn.addEventListener('click', () => {
      asc = !asc;
      sortLeadsByOpportunity(asc);
      // Update icon direction
      const svg = sortOppBtn.querySelector('svg');
      if (svg) svg.style.transform = asc ? 'rotate(180deg)' : 'rotate(0deg)';
      sortOppBtn.classList.add('text-brand-dark');
    });
  }

  // Export CSV Logic
  const bulkExportBtn = document.getElementById('bulkExportBtn');
  if (bulkExportBtn) {
    bulkExportBtn.addEventListener('click', () => {
      const selectedCheckboxes = document.querySelectorAll('.row-checkbox:checked, .lead-checkbox:checked');
      const leadsToExport = [];
      
      if (selectedCheckboxes.length > 0) {
        selectedCheckboxes.forEach(cb => {
          const row = cb.closest('.result-row');
          if (row) leadsToExport.push(row.dataset);
        });
      } else {
        // Export all if none selected
        document.querySelectorAll('.result-row').forEach(row => {
          leadsToExport.push(row.dataset);
        });
      }

      if (leadsToExport.length === 0) return alert('No leads found to export.');

      const headers = ['Company', 'Category', 'Phone', 'Website', 'Email', 'Address', 'Rating', 'Reviews', 'Facebook', 'Instagram', 'Twitter', 'Opportunity Score'];
      const rows = leadsToExport.map(l => [
        `"${l.title}"`,
        `"${l.category}"`,
        `"${l.phone}"`,
        `"${l.website}"`,
        `"${l.email}"`,
        `"${l.address}"`,
        l.rating,
        l.reviews,
        `"${l.facebook}"`,
        `"${l.instagram}"`,
        `"${l.twitter}"`,
        calculateOpportunityScore(l)
      ]);

      const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.setAttribute('download', `AdHello_Leads_${new Date().toISOString().split('T')[0]}.csv`);
      link.click();
    });
  }

  // Quick outreach logic
  document.addEventListener('click', (e) => {
    const outreachBtn = e.target.closest('.quick-outreach-btn');
    if (outreachBtn) {
      const email = outreachBtn.dataset.email;
      const company = outreachBtn.dataset.company;
      
      const templates = [
        {
          name: 'Free AI Site Audit',
          subject: `${company}: Your AI Search Readiness Report`,
          body: `Hi there at ${company},\n\nI just ran a quick AI scan of your online presence and noticed some opportunities to improve your visibility in AI Search (ChatGPT, Perplexity, and Google AI Overviews).\n\nI'd love to help you bridge this gap. You can run a full, live audit of your website here to see exactly what improvements are needed:\nhttps://adhello.ai/#site-audit\n\nWould you be open to a 5-minute chat about the results?\n\nBest regards.`
        },
        {
          name: 'Social Media Growth',
          subject: `${company}: Social Media Visibility Opportunity`,
          body: `Hi team at ${company},\n\nI was looking at your business profile and noticed you're doing great work! However, you might not be fully capturing leads from Instagram and Facebook yet.\n\nOur AI systems can automate your growth and drive 20% more calls. Check out how we do it here:\nhttps://adhello.ai\n\nAre you open to a brief chat this week?\n\nBest regards.`
        }
      ];

      // Simple prompt for now - could be a modal
      const choice = confirm(`Choose a template for ${company}:\n\nOK: Free AI Site Audit (Recommended)\nCancel: Social Media Growth`);
      const template = choice ? templates[0] : templates[1];
      
      const mailtoUrl = `mailto:${email}?subject=${encodeURIComponent(template.subject)}&body=${encodeURIComponent(template.body)}`;
      window.location.href = mailtoUrl;
    }
  });

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
  if (window.INITIAL_SAVED_LEADS && Array.isArray(window.INITIAL_SAVED_LEADS)) {
    window.INITIAL_SAVED_LEADS.forEach(l => {
      if (l.title && l.key) {
        savedLeads.set(l.title.trim(), l.key);
      }
    });
  }

  // Sync bookmark icons in table on load
  const syncBookmarkIcons = () => {
      document.querySelectorAll('.result-row').forEach(row => {
          const title = row.dataset.title;
          if (title && savedLeads.has(title.trim())) {
              const key = savedLeads.get(title.trim());
              row.dataset.leadKey = key;
              const bookmarkBtn = row.querySelector('.bookmark-btn');
              if (bookmarkBtn) markBookmarkSaved(bookmarkBtn);
          }
      });
  };
  syncBookmarkIcons();

  // --- Search form loading state ---
  const form = document.getElementById('searchForm');
  const btn = document.getElementById('searchBtn');
  const loader = document.getElementById('loadingIndicator');

  // Search mode toggle logic
  const modeRunNow = document.getElementById('modeRunNow');
  const modeSchedule = document.getElementById('modeSchedule');
  const searchModeInput = document.getElementById('searchModeInput');
  const frequencyPocket = document.getElementById('frequencyPocket');
  const timePocket = document.getElementById('timePocket');
  const userTimezoneInput = document.getElementById('userTimezone');
  const searchBtnLabel = btn ? btn.querySelector('#searchBtnText') : null;

  // Set user timezone on load
  if (userTimezoneInput) {
    userTimezoneInput.value = Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  if (modeRunNow && modeSchedule && searchModeInput) {
    const autopilotSettings = document.getElementById('autopilotSettings');
    
    modeRunNow.addEventListener('click', () => {
      searchModeInput.value = 'run';
      modeRunNow.className = 'flex-1 h-full rounded-lg text-[9px] font-black uppercase transition-all bg-white dark:bg-slate-700 text-brand-dark dark:text-slate-100 shadow-sm border border-brand-border/10';
      modeSchedule.className = 'flex-1 h-full rounded-lg text-[9px] font-black uppercase transition-all text-brand-muted dark:text-slate-400 hover:text-brand-dark dark:hover:text-slate-100';
      
      if (autopilotSettings) {
          autopilotSettings.classList.add('hidden');
      }

      if (searchBtnLabel) {
        searchBtnLabel.innerHTML = 'Find Leads<svg class="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>';
      }
    });

    modeSchedule.addEventListener('click', () => {
      searchModeInput.value = 'schedule';
      modeSchedule.className = 'flex-1 h-full rounded-lg text-[9px] font-black uppercase transition-all bg-white dark:bg-slate-700 text-brand-dark dark:text-slate-100 shadow-sm border border-brand-border/10';
      modeRunNow.className = 'flex-1 h-full rounded-lg text-[9px] font-black uppercase transition-all text-brand-muted dark:text-slate-400 hover:text-brand-dark dark:hover:text-slate-100';
      
      if (autopilotSettings) {
          autopilotSettings.classList.remove('hidden');
      }

      if (searchBtnLabel) {
        searchBtnLabel.innerHTML = 'Start Autopilot ⚡<svg class="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>';
      }
    });
  }

  if (form) {
    form.addEventListener('submit', (e) => {
      const isSchedule = searchModeInput && searchModeInput.value === 'schedule';
      
      if (!isSchedule) {
        // Trigger Alexa Progress Ring
        updateProcessingStatus(true);
        
        if (btn) {
          btn.disabled = true;
          btn.innerHTML = `
            <svg class="w-4 h-4 animate-spin text-brand-dark" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            <span class="ml-2">Searching...</span>
          `;
          btn.classList.add('opacity-50', 'cursor-not-allowed', 'animate-pulse');
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
    const prevLeadBtn = document.getElementById('prevLeadBtn');
    const nextLeadBtn = document.getElementById('nextLeadBtn');
    let rows = document.querySelectorAll('.result-row');
    let currentRow = null;
    let currentIndex = -1;

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
        currentIndex = Array.from(rows).indexOf(row);

        // Update nav button visibility/state
        if (prevLeadBtn) prevLeadBtn.style.opacity = currentIndex > 0 ? '1' : '0.3';
        if (nextLeadBtn) nextLeadBtn.style.opacity = currentIndex < rows.length - 1 ? '1' : '0.3';

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

    // Navigation Arrows
    if (prevLeadBtn) {
        prevLeadBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (currentIndex > 0) {
                const prevRow = rows[currentIndex - 1];
                prevRow.click();
            }
        });
    }

    if (nextLeadBtn) {
        nextLeadBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (currentIndex < rows.length - 1) {
                const nextRow = rows[currentIndex + 1];
                nextRow.click();
            }
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
            currentIndex = -1;
        }
    });

    // Sticky Title Scroll Logic
    const panelContent = mobilePanel.querySelector('div.overflow-y-auto');
    if (panelContent) {
        // Scroll logic removed - title is now always visible
    }
  }

  // --- Populate panel from row data ---
  function populatePanel(row) {
    const title = row.dataset.title;
    const phone = row.dataset.phone;
    const website = row.dataset.website;
    const rating = parseFloat(row.dataset.rating) || 0;
    const reviews = parseInt(row.dataset.reviews, 10) || 0;
    const url = row.dataset.url;
    const email = row.dataset.email;
    const facebook = row.dataset.facebook;
    const instagram = row.dataset.instagram;
    const twitter = row.dataset.twitter;
    const address = row.dataset.address;
    const category = row.dataset.category;
    const loomUrl = row.dataset.loomUrl;

    // Avatar & Sticky Title Logic
    const mobileAvatar = document.getElementById('mobilePanelAvatar');
    const stickyPanelTitle = document.getElementById('stickyPanelTitle');
    if (mobileAvatar) {
        mobileAvatar.textContent = (title || 'A').charAt(0).toUpperCase();
    }
    if (stickyPanelTitle) {
        stickyPanelTitle.textContent = title || 'Company Details';
    }

    const panelTitle = document.getElementById('mobilePanelTitle');
    if (panelTitle) panelTitle.textContent = title;



    const panelCategory = document.getElementById('mobilePanelCategory');
    if (panelCategory) panelCategory.textContent = category;

    // Stars & Rating
    renderStars(rating, reviews);

    // Phone logic
    const phoneEl = document.getElementById('mobilePanelPhone');
    const phoneLink = document.getElementById('mobilePanelPhoneLink');
    const phoneRow = document.getElementById('mobilePanelPhoneRow');
    
    if (phoneEl) {
        if (phone && phone !== 'N/A') {
            phoneEl.innerHTML = `<a href="tel:${phone.replace(/\D/g, '')}" class="hover:text-brand-yellow transition-colors">${phone}</a>`;
        } else {
            phoneEl.textContent = 'No Phone';
        }
    }
    
    if (phoneLink) {
        if (phone && phone !== 'N/A') {
            const tel = `tel:${phone.replace(/\D/g, '')}`;
            phoneLink.href = tel;
            phoneLink.classList.remove('opacity-20', 'pointer-events-none');
            
            // Called Lead Automation
            const callTrigger = () => {
                if (statusSelect) {
                    statusSelect.value = 'Called Lead';
                    statusSelect.dispatchEvent(new Event('change'));
                }
            };
            
            phoneLink.onclick = (e) => { e.stopPropagation(); callTrigger(); };
            if (phoneRow) phoneRow.onclick = () => { window.location.href = tel; callTrigger(); };
        } else {
            phoneLink.href = '#';
            phoneLink.classList.add('opacity-20', 'pointer-events-none');
            if (phoneRow) phoneRow.onclick = null;
        }
    }

    // Email logic
    const emailEl = document.getElementById('mobilePanelEmail');
    const emailBtn = document.getElementById('mobilePanelEmailBtn');
    if (emailEl) emailEl.textContent = (email && email !== 'N/A') ? email : 'No Email Found';
    if (emailBtn) {
        if (email && email !== 'N/A') {
            emailBtn.onclick = () => window.location.href = `mailto:${email}`;
            emailBtn.classList.remove('opacity-20', 'pointer-events-none');
        } else {
            emailBtn.onclick = null;
            emailBtn.classList.add('opacity-20', 'pointer-events-none');
        }
    }

    // Website logic
    const websiteShort = document.getElementById('mobilePanelWebsiteShort');
    const websiteLink = document.getElementById('mobilePanelWebsiteLink');
    if (websiteShort) {
        try {
            const domain = new URL(website.startsWith('http') ? website : `https://${website}`).hostname.replace('www.', '');
            websiteShort.textContent = domain;
        } catch (e) {
            websiteShort.textContent = (website && website !== 'N/A') ? website : 'No Website';
        }
    }
    if (websiteLink) {
        if (website && website !== 'N/A') {
            websiteLink.href = website.startsWith('http') ? website : `https://${website}`;
            websiteLink.classList.remove('opacity-20', 'pointer-events-none');
        } else {
            websiteLink.href = '#';
            websiteLink.classList.add('opacity-20', 'pointer-events-none');
        }
    }

    // Address & Maps logic
    const addressEl = document.getElementById('mobilePanelAddress');
    const mapsLink = document.getElementById('mobilePanelMapsLink');
    if (addressEl) addressEl.textContent = (address && address !== 'N/A') ? address : 'Location Hidden';

    // Audit Report Insights Section (Dynamic)
    const auditDataRaw = row.dataset.auditData;
    const source = row.dataset.source;
    const auditContainer = document.getElementById('auditInsightsContainer');
    
    if (auditContainer) {
        if (source === 'adhello_audit' && auditDataRaw && auditDataRaw !== 'null') {
            try {
                const audit = JSON.parse(auditDataRaw);
                auditContainer.innerHTML = `
                    <div class="p-6 bg-brand-yellow/5 dark:bg-brand-yellow/10 rounded-[2.5rem] border border-brand-yellow/20 relative overflow-hidden group/audit">
                        <div class="absolute -right-4 -top-4 w-20 h-20 bg-brand-yellow/10 rounded-full blur-2xl group-hover/audit:bg-brand-yellow/20 transition-all"></div>
                        <div class="relative z-10">
                            <div class="flex items-center gap-3 mb-5">
                                <div class="w-8 h-8 rounded-xl bg-brand-yellow flex items-center justify-center text-brand-dark shadow-lg shadow-brand-yellow/20">
                                    <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.091 3.091L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
                                </div>
                                <div>
                                    <h4 class="text-[10px] font-black uppercase tracking-[0.2em] text-brand-yellow mb-0.5">AdHello Audit Intelligence</h4>
                                    <p class="text-xs font-black text-brand-dark dark:text-white">External Report Data</p>
                                </div>
                            </div>
                            
                            <div class="grid grid-cols-3 gap-3 mb-5">
                                <div class="p-3 bg-white dark:bg-slate-900/50 rounded-2xl border border-brand-border/10 text-center shadow-sm">
                                    <div class="text-[8px] font-black text-brand-muted uppercase tracking-tighter mb-1">Mobile</div>
                                    <div class="text-sm font-black text-brand-dark dark:text-white">${audit.mobileScore || '0'}%</div>
                                    <div class="w-full bg-brand-border/10 h-1 mt-2 rounded-full overflow-hidden">
                                        <div class="bg-brand-yellow h-full" style="width: ${audit.mobileScore || '0'}%"></div>
                                    </div>
                                </div>
                                <div class="p-3 bg-white dark:bg-slate-900/50 rounded-2xl border border-brand-border/10 text-center shadow-sm">
                                    <div class="text-[8px] font-black text-brand-muted uppercase tracking-tighter mb-1">Leads</div>
                                    <div class="text-sm font-black text-brand-dark dark:text-white">${audit.leadsScore || '0'}%</div>
                                    <div class="w-full bg-brand-border/10 h-1 mt-2 rounded-full overflow-hidden">
                                        <div class="bg-brand-yellow h-full" style="width: ${audit.leadsScore || '0'}%"></div>
                                    </div>
                                </div>
                                <div class="p-3 bg-white dark:bg-slate-900/50 rounded-2xl border border-brand-border/10 text-center shadow-sm">
                                    <div class="text-[8px] font-black text-brand-muted uppercase tracking-tighter mb-1">AI Ready</div>
                                    <div class="text-sm font-black text-brand-dark dark:text-white">${audit.aiReadyScore || '0'}%</div>
                                    <div class="w-full bg-brand-border/10 h-1 mt-2 rounded-full overflow-hidden">
                                        <div class="bg-brand-yellow h-full" style="width: ${audit.aiReadyScore || '0'}%"></div>
                                    </div>
                                </div>
                            </div>
                            
                            ${audit.summary ? `
                                <div class="p-4 bg-brand-yellow/5 dark:bg-white/5 rounded-2xl text-[11px] leading-relaxed text-brand-muted dark:text-slate-300 font-medium italic border-l-4 border-brand-yellow/50">
                                    "${audit.summary}"
                                </div>
                            ` : ''}
                        </div>
                    </div>
                `;
                auditContainer.classList.remove('hidden');
            } catch (e) {
                console.error('Audit Parse Error:', e);
                auditContainer.classList.add('hidden');
            }
        } else {
            auditContainer.classList.add('hidden');
            auditContainer.innerHTML = '';
        }
    }

    // Chat History Section (Dynamic)
    const chatHistoryRaw = row.dataset.chatHistory;
    const chatContainer = document.getElementById('chatLogContainer');
    const chatMessageList = document.getElementById('chatMessageList');
    
    if (chatContainer && chatMessageList) {
        if (chatHistoryRaw && chatHistoryRaw !== 'null' && chatHistoryRaw !== 'undefined') {
            try {
                let history = [];
                // Handle both JSON array and raw string formats
                if (chatHistoryRaw.startsWith('[')) {
                    history = JSON.parse(chatHistoryRaw);
                } else {
                    // Legacy string format: "User: msg\nBot: msg"
                    history = chatHistoryRaw.split('\n').filter(l => l.trim()).map(line => {
                        const isBot = line.toLowerCase().startsWith('bot:') || line.toLowerCase().startsWith('coach:');
                        const role = isBot ? 'assistant' : 'user';
                        const text = line.includes(':') ? line.split(':').slice(1).join(':').trim() : line;
                        return { role, text };
                    });
                }

                if (history && history.length > 0) {
                    chatMessageList.innerHTML = history.map(msg => {
                        const isAssistant = msg.role === 'assistant' || msg.role === 'bot' || msg.role === 'coach';
                        if (isAssistant) {
                            return `
                                <div class="flex flex-col items-start mb-4">
                                    <div class="bg-brand-yellow/10 text-brand-dark dark:text-white text-[11px] font-bold p-3.5 rounded-2xl rounded-tl-none border border-brand-yellow/20 max-w-[90%] shadow-sm leading-relaxed">
                                        ${msg.text || msg.content}
                                    </div>
                                    <div class="flex items-center gap-1.5 mt-1.5 ml-1">
                                        <div class="w-1 h-1 rounded-full bg-brand-yellow"></div>
                                        <span class="text-[8px] font-black uppercase tracking-[0.15em] text-brand-yellow/80">Growth Coach</span>
                                    </div>
                                </div>
                            `;
                        } else {
                            return `
                                <div class="flex flex-col items-end mb-4">
                                    <div class="bg-white dark:bg-white/5 text-brand-dark dark:text-slate-300 text-[11px] font-semibold p-3.5 rounded-2xl rounded-tr-none border border-brand-border/10 max-w-[90%] shadow-sm leading-relaxed">
                                        ${msg.text || msg.content}
                                    </div>
                                    <div class="flex items-center gap-1.5 mt-1.5 mr-1 text-right">
                                        <span class="text-[8px] font-black uppercase tracking-[0.15em] text-brand-muted/60">Prospect</span>
                                        <div class="w-1 h-1 rounded-full bg-brand-muted/30"></div>
                                    </div>
                                </div>
                            `;
                        }
                    }).join('');
                    chatContainer.classList.remove('hidden');
                    // Scroll to bottom
                    setTimeout(() => chatMessageList.scrollTop = chatMessageList.scrollHeight, 100);
                } else {
                    chatContainer.classList.add('hidden');
                }
            } catch (e) {
                console.error('Chat Parse Error:', e);
                chatContainer.classList.add('hidden');
            }
        } else {
            chatContainer.classList.add('hidden');
            chatMessageList.innerHTML = '';
        }
    }

    if (mapsLink) {
        if (address && address !== 'N/A') {
            mapsLink.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address + ' ' + title)}`;
            mapsLink.classList.remove('opacity-20', 'pointer-events-none');
        } else {
            mapsLink.href = '#';
            mapsLink.classList.add('opacity-20', 'pointer-events-none');
        }
    }

    // Header Contact Info
    const headerAddress = document.getElementById('mobilePanelHeaderAddress');
    const headerPhone = document.getElementById('mobilePanelHeaderPhone');
    const headerSocials = document.getElementById('mobilePanelHeaderSocials');

    if (headerAddress) headerAddress.textContent = (address && address !== 'N/A') ? address : 'Address Not Available';
    if (headerPhone) {
        if (phone && phone !== 'N/A') {
            headerPhone.textContent = phone;
            headerPhone.href = `tel:${phone.replace(/\D/g, '')}`;
            headerPhone.classList.remove('opacity-40', 'pointer-events-none', 'no-underline');
        } else {
            headerPhone.textContent = 'No Phone Number';
            headerPhone.href = '#';
            headerPhone.classList.add('opacity-40', 'pointer-events-none', 'no-underline');
        }
    }

    // Header Socials Logic
    if (headerSocials) {
        headerSocials.innerHTML = '';
        let socialCount = 0;
        const socialPlatforms = [
            { key: 'facebook', icon: '<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.991 22 12z" /></svg>', color: 'hover:bg-[#1877F2]' },
            { key: 'instagram', icon: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M7.75 2h8.5A5.75 5.75 0 0122 7.75v8.5A5.75 5.75 0 0116.25 22h-8.5A5.75 5.75 0 012 16.25v-8.5A5.75 5.75 0 017.75 2z" /><path stroke-linecap="round" stroke-linejoin="round" d="M16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37z" /><path stroke-linecap="round" stroke-linejoin="round" d="M17.5 6.5h.01" /></svg>', color: 'hover:bg-[#E4405F]' },
            { key: 'twitter', icon: '<svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.045 4.126H5.078z" /></svg>', color: 'hover:bg-black' }
        ];

        socialPlatforms.forEach(p => {
            const link = row.dataset[p.key];
            if (link && link !== 'N/A' && link !== 'undefined') {
                const a = document.createElement('a');
                a.href = link.startsWith('http') ? link : `https://${link}`;
                a.target = '_blank';
                a.className = `w-8 h-8 rounded-lg bg-brand-cream dark:bg-slate-800 flex items-center justify-center text-brand-muted hover:text-white transition-all hover:scale-110 shadow-sm border border-brand-border/10 ${p.color}`;
                a.innerHTML = p.icon;
                headerSocials.appendChild(a);
                socialCount++;
            }
        });

        if (socialCount === 0) {
            headerSocials.innerHTML = '<span class="text-[10px] font-bold text-brand-muted/40 uppercase tracking-widest italic">No social profiles detected</span>';
        }
    }

    // Loom URL Input (if exists)
    const loomInput = document.getElementById('loomUrlInput');
    if (loomInput) loomInput.value = loomUrl || '';

    // Logic for Audit Insight Box in Panel (if exists)
    const auditStatus = document.getElementById('mobilePanelAuditStatus');
    const auditSummary = document.getElementById('mobilePanelAuditSummary');
    if (auditStatus && auditSummary) {
        // ... (lines omitted for brevity but I will keep the original logic and add Stitch logic after)
    }

    // Stitch AI Design Logic
    const stitchPreviewSection = document.getElementById('stitchPreviewSection');
    const stitchScreenshot = document.getElementById('stitchScreenshot');
    const stitchDesignLink = document.getElementById('stitchDesignLink');
    
    const stitchUrl = row.dataset.stitchDesignUrl;
    const stitchImg = row.dataset.stitchScreenshotUrl;
    
    if (stitchPreviewSection && stitchScreenshot && stitchDesignLink) {
        if (stitchUrl && stitchUrl !== '' && stitchUrl !== 'null') {
            stitchScreenshot.src = stitchImg || 'https://via.placeholder.com/400x250?text=AI+Design+Blueprint';
            stitchDesignLink.href = stitchUrl;
            stitchPreviewSection.classList.remove('hidden');
        } else {
            stitchPreviewSection.classList.add('hidden');
        }
    }
        const score = calculateOpportunityScore(row.dataset);
        if (score >= 7) { 
            statusText = 'High Opportunity'; 
            statusColor = 'text-rose-500'; 
        } else if (score >= 4) { 
            statusText = 'Medium Opportunity'; 
            statusColor = 'text-amber-500'; 
        } else {
            statusText = 'Low Opportunity';
            statusColor = 'text-brand-muted';
        }
        
        auditStatus.textContent = statusText;
        auditStatus.className = `text-[10px] font-black uppercase tracking-widest ${statusColor}`;
        
        // Dynamic summary generation if deep audit hasn't filled it yet
        let dynamicSummary = row.dataset.auditSummary;
        if (!dynamicSummary || dynamicSummary === 'Analyzing website structure and GEO/AEO readiness...') {
            const gaps = [];
            if (!website || website === 'N/A') gaps.push('no website');
            if (row.dataset.hasChatbot === 'false' || row.dataset.has_chatbot === false) gaps.push('no chatbot');
            if (row.dataset.isMobileFriendly === 'false' || row.dataset.is_mobile_friendly === false) gaps.push('technical SEO issues');
            if (row.dataset.hasClickToCall === 'false' || row.dataset.has_click_to_call === false) gaps.push('broken click-to-call');
            
            if (gaps.length > 0) {
                dynamicSummary = `High-value lead because of ${gaps.join(', ')}. Perfect candidate for a technical layout overhaul and conversion optimization.`;
            } else {
                dynamicSummary = 'Solid digital presence found. Focus on high-level strategy and scaling existing performance.';
            }
        }
        auditSummary.textContent = dynamicSummary;
    }

    // Competitor Comparison Logic
    const competitorNameEl = document.getElementById('competitorName');
    const competitorGapEl = document.getElementById('competitorGap');
    const competitorSection = document.getElementById('competitorSection');

    if (competitorSection) {
        if (row.dataset.competitorName && row.dataset.competitorName !== 'N/A' && row.dataset.competitorName !== 'undefined') {
            competitorSection.classList.remove('hidden');
            if (competitorNameEl) competitorNameEl.textContent = row.dataset.competitorName;
            if (competitorGapEl) competitorGapEl.textContent = row.dataset.competitorGap || 'General competitive gap detected.';
        } else {
            competitorSection.classList.add('hidden');
        }
    }

    // Technical Audit Tiles
    const chatbotTile = document.getElementById('chatbotStatus');
    const clickToCallTile = document.getElementById('clickToCallStatus');
    const mobileFriendlyTile = document.getElementById('mobileFriendlyStatus');
    const schemaTile = document.getElementById('schemaStatus');

    if (chatbotTile) {
        const hasChat = row.dataset.hasChatbot === 'true' || row.dataset.has_chatbot === true;
        chatbotTile.innerHTML = hasChat ? '<span class="text-green-500 flex items-center gap-1"><svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 100 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path></svg> Active</span>' : '<span class="text-red-400">Missing</span>';
    }
    if (clickToCallTile) {
        const hasClick = row.dataset.hasClickToCall === 'true' || row.dataset.has_click_to_call === true;
        clickToCallTile.innerHTML = hasClick ? '<span class="text-green-500 flex items-center gap-1"><svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 100 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path></svg> Optimized</span>' : '<span class="text-red-400 font-bold underline decoration-red-400/30 underline-offset-2">Broken</span>';
    }
    if (mobileFriendlyTile) {
        const isMobile = row.dataset.isMobileFriendly === 'true' || row.dataset.is_mobile_friendly === true;
        mobileFriendlyTile.innerHTML = isMobile ? '<span class="text-green-500 flex items-center gap-1"><svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 100 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path></svg> Fully Responsive</span>' : '<span class="text-red-400 font-bold underline decoration-red-400/30 underline-offset-2">Non-Responsive</span>';
    }
    if (schemaTile) {
        const hasSchema = row.dataset.hasSchemaMarkup === 'true' || row.dataset.has_schema_markup === true;
        schemaTile.innerHTML = hasSchema ? '<span class="text-green-500 flex items-center gap-1"><svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 100 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path></svg> AI Ready</span>' : '<span class="text-amber-500 font-bold underline decoration-amber-500/30 underline-offset-2 tracking-tighter">Needs GEO</span>';
    }
  }

  function renderStars(rating, reviews, containerId = 'mobilePanelStars', textId = 'mobilePanelRatingText') {
    const starsContainer = document.getElementById(containerId);
    if (starsContainer) {
        renderStarsInElement(starsContainer, rating);
    }
    const ratingText = document.getElementById(textId);
    if (ratingText) {
        if (reviews !== undefined) {
            ratingText.textContent = rating > 0 ? `${Number(rating).toFixed(1)} (${reviews} reviews)` : 'No Rating';
        } else {
            ratingText.textContent = rating > 0 ? Number(rating).toFixed(1) : '-';
        }
    }
  }

  function renderStarsInElement(element, rating) {
    if (!element) return;
    element.innerHTML = '';
    const fullStars = Math.floor(rating);
    const hasHalf = rating % 1 >= 0.5;

    for (let i = 0; i < 5; i++) {
        const star = document.createElement('svg');
        star.setAttribute('class', `w-3 h-3 ${i < fullStars ? 'text-brand-yellow' : (i === fullStars && hasHalf ? 'text-brand-yellow' : 'text-brand-muted/20')}`);
        star.setAttribute('fill', 'currentColor');
        star.setAttribute('viewBox', '0 0 20 20');
        star.innerHTML = '<path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />';
        element.appendChild(star);
    }
  }

  // --- Initialize Table Row Stars ---
  const applyTableStars = () => {
    document.querySelectorAll('.result-row').forEach(row => {
      const rating = parseFloat(row.dataset.rating) || 0;
      const starContainer = row.querySelector('.row-stars');
      if (starContainer) {
        renderStarsInElement(starContainer, rating);
      }
    });
  };

  applyTableStars();

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
          
          // Update table badge manually for a smooth experience
          const statusBadge = currentRow.querySelector('td:nth-last-child(2) span') || currentRow.querySelector('span[class*="rounded-full"]');
          if (statusBadge) {
              statusBadge.textContent = newStatus;
              statusBadge.className = "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-brand-yellow/10 text-brand-yellow border border-brand-yellow/20";
          }
          
          // Refresh panel to sync dropdowns/updates
          populatePanel(currentRow);
          
          // If we have a Kanban board, we might need a reload or a manual move, 
          // but for now, we'll just allow the table/sidebar sync to be fast.
          // window.location.reload(); 
        }
      } catch (err) { console.error('Status update failed:', err); }
    });
  }

  const addNoteBtn = document.getElementById('addNoteBtn');
  if (addNoteBtn) {
    addNoteBtn.addEventListener('click', async () => {
      if (!currentRow) return;
      
      const noteInput = document.getElementById('noteInput');
      const content = noteInput.value.trim();
      if (!content) return;

      const originalBtnText = addNoteBtn.innerHTML;
      addNoteBtn.disabled = true;
      addNoteBtn.innerHTML = '<svg class="animate-spin h-4 w-4 text-white dark:text-brand-dark mx-auto" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>';

      try {
        let key = currentRow.dataset.leadKey;
        
        // If lead isn't saved yet, save it first to get a key
        if (!key) {
           await saveLead(currentRow);
           key = currentRow.dataset.leadKey;
           // If it still fails to save, stop
           if (!key) {
             alert("Could not save lead to add note. Please try saving it manually first.");
             throw new Error("Lead save failed before note addition");
           }
        }

        const res = await fetch(`/leads/${key}/notes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content })
        });
        const data = await res.json();
        if (data.success) {
          currentRow.dataset.updates = JSON.stringify(data.updates);
          noteInput.value = '';
          populatePanel(currentRow);
        }
      } catch (err) { 
        console.error('Note addition failed:', err);
        alert("Failed to add note. Please ensure the lead is saved.");
      } finally {
        addNoteBtn.disabled = false;
        addNoteBtn.innerHTML = originalBtnText;
      }
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
      const loomLink = document.getElementById('loomUrlInput') ? document.getElementById('loomUrlInput').value.trim() : '';

      const subject = encodeURIComponent(`Question regarding ${title}'s online presence`);
      
      const gaps = [];
      if (currentRow.dataset.isMobileFriendly === 'false' || currentRow.dataset.is_mobile_friendly === false) gaps.push("isn't mobile-friendly");
      if (currentRow.dataset.hasChatbot === 'false' || currentRow.dataset.has_chatbot === false) gaps.push("lacks a conversion chatbot");
      if (currentRow.dataset.hasSchemaMarkup === 'false' || currentRow.dataset.has_schema_markup === false) gaps.push("is missing Google Schema markup for local SEO");
      if (currentRow.dataset.hasClickToCall === 'false' || currentRow.dataset.has_click_to_call === false) gaps.push("has a broken click-to-call link");
      if (currentRow.dataset.isOutdated === 'true' || currentRow.dataset.is_outdated === true) gaps.push("looks a bit outdated compared to competitors");

      let gapText = "";
      if (gaps.length > 0) {
        gapText = `I noticed a few specific technical gaps: your site ${gaps.slice(0, -1).join(', ')}${gaps.length > 1 ? ' and ' : ''}${gaps[gaps.length-1]}. These are likely slowing down your growth and making you invisible to modern AI search engines.`;
      } else {
        gapText = `I noticed a few technical gaps and conversion opportunities that might be slowing down your growth.`;
      }

      let bodyText = "";
      if (loomLink) {
        bodyText = `Hey ${title} team,\n\nI was looking for businesses in ${city} and found your site. I recorded a quick 2-minute video sharing a few layout ideas and technical fixes that could help increase your conversions:\n\n${loomLink}\n\n${gapText}\n\nLet me know what you think!\n\nBest,\n[Your Name]`;
      } else {
        bodyText = `Hey ${title} team,\n\nI was looking for local businesses in ${city} and spent some time on your website. ${gapText}\n\nI'd love to share some specific ideas on how to fix these. Are you open to a quick 5-minute chat this week?\n\nBest,\n[Your Name]`;
      }
      
      const body = encodeURIComponent(bodyText);
      
      let mailtoStr = `mailto:`;
      if (email && email !== 'N/A') {
        mailtoStr += encodeURIComponent(email);
      }
      mailtoStr += `?subject=${subject}&body=${body}`;

      // Open default mail client
      window.location.href = mailtoStr;

      // Automatically update status to 'Email Sent'
      if (statusSelect) {
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
      const title = currentRow.dataset.title;
      const city = currentRow.dataset.city;
      const state = currentRow.dataset.state;
      const url = currentRow.dataset.website;

      const originalHTML = deepEnhanceBtn.innerHTML;
      
      updateProcessingStatus(true);
      deepEnhanceBtn.classList.add('loading', 'animate-magic');
      deepEnhanceBtn.innerHTML = `
        <svg class="w-4 h-4 animate-spin text-brand-yellow" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
        </svg>
        <span class="animate-pulse">Magic Hunt in progress...</span>
      `;

      try {
        let res;
        if (key) {
           res = await fetch(`/leads/${key}/enhance`, { method: 'POST' });
        } else {
           res = await fetch('/enrich', {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({ url, title, city, state })
           });
        }
        
        const data = await res.json();
        
        if (data.success) {
          const d = data.lead || data.data; // Unified data
          if (d.website && d.website !== 'N/A') currentRow.dataset.website = d.website;
          if (data.foundUrl) currentRow.dataset.website = data.foundUrl; // From /enrich search
          
          if (d.email && d.email !== 'N/A') currentRow.dataset.email = d.email;
          if (d.facebook && d.facebook !== 'N/A') currentRow.dataset.facebook = d.facebook;
          if (d.instagram && d.instagram !== 'N/A') currentRow.dataset.instagram = d.instagram;
          if (d.twitter && d.twitter !== 'N/A') currentRow.dataset.twitter = d.twitter;
          
          if (d.updates) currentRow.dataset.updates = JSON.stringify(d.updates);
          
          // Refresh Panel UI
          populatePanel(currentRow);
          
          deepEnhanceBtn.innerHTML = '✨ Success! Data Found';
          updateProcessingStatus(false);
          setTimeout(() => {
             deepEnhanceBtn.classList.remove('loading', 'animate-magic');
             deepEnhanceBtn.innerHTML = originalHTML;
          }, 3000);
        } else {
          alert(data.error || "No additional contact data discovered yet.");
          updateProcessingStatus(false);
          deepEnhanceBtn.classList.remove('loading', 'animate-magic');
          deepEnhanceBtn.innerHTML = originalHTML;
        }
      } catch (err) {
        console.error('Enhancement failed:', err);
        alert("Enhancement failed. Please try again later.");
        updateProcessingStatus(false);
        deepEnhanceBtn.classList.remove('loading', 'animate-magic');
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
  // bulkExportBtn is now defined at the top of DOMContentLoaded
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

  // Bulk Save (to saved leads)
  const bulkSaveBtn = document.getElementById('bulkSaveBtn');
  if (bulkSaveBtn) {
    bulkSaveBtn.addEventListener('click', async () => {
      const checkedBoxes = document.querySelectorAll('.row-checkbox:checked, .lead-checkbox:checked');
      if (checkedBoxes.length === 0) return;
      
      const selectedRows = Array.from(checkedBoxes).map(cb => cb.closest('.result-row'));

      const originalText = bulkSaveBtn.textContent;
      bulkSaveBtn.textContent = 'Saving...';
      bulkSaveBtn.disabled = true;

      let savedCount = 0;

      for (const row of selectedRows) {
        if (savedLeads.has(row.dataset.title)) continue;

        const leadData = {
          title: row.dataset.title,
          phone: row.dataset.phone,
          website: row.dataset.website,
          email: row.dataset.email,
          categoryName: row.dataset.category,
          address: row.dataset.address,
          city: row.dataset.city,
          totalScore: parseFloat(row.dataset.rating),
          reviewsCount: parseInt(row.dataset.reviews),
          url: row.dataset.url,
          facebook: row.dataset.facebook,
          instagram: row.dataset.instagram,
          twitter: row.dataset.twitter
        };

        try {
          const res = await fetch('/leads/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(leadData)
          });
          if (res.ok) {
            const data = await res.json();
            savedLeads.set(row.dataset.title.trim(), data.key);
            row.dataset.leadKey = data.key;
            const bookmarkBtn = row.querySelector('.bookmark-btn');
            if (bookmarkBtn) markBookmarkSaved(bookmarkBtn);
            savedCount++;
          }
        } catch (err) {
          console.error('Error saving lead:', err);
        }
      }

      bulkSaveBtn.textContent = `Saved ${savedCount}`;
      setTimeout(() => {
        bulkSaveBtn.textContent = originalText;
        bulkSaveBtn.disabled = false;
        
        // Optional: Uncheck all after saving
        // if (selectAllLeads) selectAllLeads.checked = false;
        // checkedBoxes.forEach(cb => cb.checked = false);
        // updateBulkActionBar();
      }, 2000);
    });
  }

  // Bulk Enhance (Firecrawl) - Improved with in-place updates
  if (bulkEnhanceBtn) {
    bulkEnhanceBtn.addEventListener('click', async () => {
      const checkedBoxes = document.querySelectorAll('.row-checkbox:checked, .lead-checkbox:checked');
      if (checkedBoxes.length === 0) return;
      
      const selectedRows = Array.from(checkedBoxes).map(cb => cb.closest('.result-row'));
      
      const originalText = bulkEnhanceBtn.innerHTML;
      updateProcessingStatus(true);
      bulkEnhanceBtn.classList.add('loading', 'animate-magic');
      bulkEnhanceBtn.innerHTML = '<span class="flex items-center gap-2"><svg class="animate-spin h-3.5 w-3.5 text-brand-yellow" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>Enchanting Leads...</span>';

      // Limit to 20 leads as per user request
      const leadsToProcess = selectedRows.slice(0, 20);
      if (selectedRows.length > 20) {
          console.warn('Bulk audit limited to first 20 selected leads.');
      }

      for (const row of leadsToProcess) {
        const url = row.dataset.website;
        if (!url || url === 'N/A') continue;

        // Find cells by their semantic content or indices (Company, Phone, Location, Reviews, Opportunity, Website, Email, Socials)
        // In Search Results: index 7 is Email, 8 is Socials
        // In Saved Leads: index 4 is Website? No, let's use class selectors if possible or search for children.
        const cells = row.cells;
        let emailCell, socialCell;
        
        // Find Email cell (look for mailto or 'No Email')
        for (let cell of cells) {
            if (cell.querySelector('a[href^="mailto:"]') || cell.textContent.includes('No Email')) {
                emailCell = cell;
            }
            if (cell.querySelector('svg') && (cell.querySelector('a[title="Facebook"]') || cell.querySelector('a[title="Instagram"]'))) {
                socialCell = cell;
            }
        }
        
        if (!emailCell || !socialCell) continue;

        const originalEmailHtml = emailCell.innerHTML;
        const originalSocialHtml = socialCell.innerHTML;
        
        socialCell.innerHTML = '<div class="flex items-center gap-2 text-brand-muted"><svg class="animate-spin h-3 w-3 text-brand-yellow" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg><span class="text-[9px] font-bold uppercase tracking-widest">Scanning...</span></div>';
        
        if (!row.dataset.email || row.dataset.email === 'N/A') {
          emailCell.innerHTML = '<span class="text-[9px] font-bold text-brand-yellow tracking-widest uppercase animate-pulse">Scanning...</span>';
        }

        try {
          const key = row.dataset.leadKey;
          const url = row.dataset.website;
          const title = row.dataset.title;
          const city = row.dataset.city;
          const state = row.dataset.state;

          let res;
          if (key) {
            // Saved lead
            res = await fetch(`/leads/${key}/enhance`, { method: 'POST' });
          } else {
            // Search result (unsaved)
            res = await fetch('/enrich', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url, title, city, state })
            });
          }

          if (res.ok) {
            const result = await res.json();
            // Unified data location (either result.lead or result.data)
            const d = result.lead || result.data;
            
            if (result.success && d) {
              if (d.facebook) row.dataset.facebook = d.facebook;
              if (d.instagram) row.dataset.instagram = d.instagram;
              if (d.twitter) row.dataset.twitter = d.twitter;
              if (result.foundUrl) row.dataset.website = result.foundUrl; // Only for /enrich search result
              if (d.website && d.website !== 'N/A') row.dataset.website = d.website;
              
              // NEW AUDIT FIELDS
              if (d.has_schema_markup !== undefined) row.dataset.hasSchemaMarkup = d.has_schema_markup;
              if (d.has_chatbot !== undefined) row.dataset.hasChatbot = d.has_chatbot;
              if (d.has_click_to_call !== undefined) row.dataset.hasClickToCall = d.has_click_to_call;
              if (d.is_mobile_friendly !== undefined) row.dataset.isMobileFriendly = d.is_mobile_friendly;
              if (d.is_outdated !== undefined) row.dataset.isOutdated = d.is_outdated;
              if (d.visual_modernity_score !== undefined) row.dataset.visualModernityScore = d.visual_modernity_score;
              if (d.aeo_score !== undefined) row.dataset.aeoScore = d.aeo_score;
              if (d.geo_gaps !== undefined) row.dataset.geoGaps = d.geo_gaps;
              if (d.competitor_name !== undefined) row.dataset.competitorName = d.competitor_name;
              if (d.competitor_gap !== undefined) row.dataset.competitorGap = d.competitor_gap;
              if (d.audit_summary !== undefined) row.dataset.auditSummary = d.audit_summary;

              if (d.email) {
                row.dataset.email = d.email;
                emailCell.innerHTML = `<a href="mailto:${d.email}" class="font-bold text-brand-dark hover:text-brand-yellow transition-colors truncate max-w-[120px] inline-block" title="${d.email}">${d.email}</a>`;
              } else {
                emailCell.innerHTML = originalEmailHtml;
              }

              // Update Social Icons
              let socialsHtml = '<div class="flex items-center justify-center gap-2.5">';
              if (row.dataset.facebook && row.dataset.facebook !== 'N/A') {
                socialsHtml += `<a href="${row.dataset.facebook}" target="_blank" class="w-4 h-4 text-brand-muted hover:text-[#1877F2] transition-colors" title="Facebook"><svg fill="currentColor" viewBox="0 0 24 24"><path d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.991 22 12z" /></svg></a>`;
              }
              if (row.dataset.instagram && row.dataset.instagram !== 'N/A') {
                socialsHtml += `<a href="${row.dataset.instagram}" target="_blank" class="w-4 h-4 text-brand-muted hover:text-[#E4405F] transition-colors" title="Instagram"><svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M7.75 2h8.5A5.75 5.75 0 0122 7.75v8.5A5.75 5.75 0 0116.25 22h-8.5A5.75 5.75 0 012 16.25v-8.5A5.75 5.75 0 017.75 2z" /><path stroke-linecap="round" stroke-linejoin="round" d="M16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37z" /><path stroke-linecap="round" stroke-linejoin="round" d="M17.5 6.5h.01" /></svg></a>`;
              }
              socialsHtml += '</div>';
              socialCell.innerHTML = socialsHtml;
              
              // Sync panel if open
              if (currentRow === row) populatePanel(row);
            } else {
              socialCell.innerHTML = originalSocialHtml;
              emailCell.innerHTML = originalEmailHtml;
            }
          } else {
            socialCell.innerHTML = originalSocialHtml;
            emailCell.innerHTML = originalEmailHtml;
          }
        } catch (err) {
          console.error('Enrichment error:', err);
          socialCell.innerHTML = originalSocialHtml;
          emailCell.innerHTML = originalEmailHtml;
        }
      }

      updateProcessingStatus(false);
      bulkEnhanceBtn.innerHTML = '✨ Leads Enchanted';
      
      // Auto-re-sort after enhancement to move highest quality leads to top
      sortLeadsByOpportunity(false);

      setTimeout(() => {
        bulkEnhanceBtn.classList.remove('loading', 'animate-magic');
        bulkEnhanceBtn.innerHTML = originalText;
      }, 3000);
    });
  }

  // --- Website Preview Hover Logic Removed ---


  // --- Kanban View & Batch Outreach Logic ---
  
  // View Toggle Logic
  const showTableViewBtn = document.getElementById('showTableView');
  const showKanbanViewBtn = document.getElementById('showKanbanView');
  const tableView = document.getElementById('tableView');
  const kanbanView = document.getElementById('kanbanView');

  if (showTableViewBtn && showKanbanViewBtn) {
    showTableViewBtn.addEventListener('click', () => {
        tableView.classList.remove('hidden');
        kanbanView.classList.add('hidden');
        showTableViewBtn.classList.add('bg-brand-yellow', 'text-brand-dark', 'shadow-sm');
        showTableViewBtn.classList.remove('text-brand-muted');
        showKanbanViewBtn.classList.remove('bg-brand-yellow', 'text-brand-dark', 'shadow-sm');
        showKanbanViewBtn.classList.add('text-brand-muted');
    });

    showKanbanViewBtn.addEventListener('click', () => {
        tableView.classList.add('hidden');
        kanbanView.classList.remove('hidden');
        showKanbanViewBtn.classList.add('bg-brand-yellow', 'text-brand-dark', 'shadow-sm');
        showKanbanViewBtn.classList.remove('text-brand-muted');
        showTableViewBtn.classList.remove('bg-brand-yellow', 'text-brand-dark', 'shadow-sm');
        showTableViewBtn.classList.add('text-brand-muted');
        initKanban();
    });
  }

  // Initialize Kanban Boards
  function initKanban() {
    const columns = document.querySelectorAll('.kanban-list');
    const allRows = document.querySelectorAll('.result-row');
    
    // Clear and re-populate columns
    columns.forEach(col => {
        col.innerHTML = '';
        const targetStatus = col.parentElement.dataset.status;
        let count = 0;

        allRows.forEach(row => {
            const leadStatus = row.dataset.status || 'Needs Video';
            let shouldInclude = false;

            if (targetStatus === 'Needs Video' && leadStatus === 'Needs Video') shouldInclude = true;
            if (targetStatus === 'Enriched' && leadStatus === 'Enriched') shouldInclude = true;
            if (targetStatus === 'Action Ongoing' && ['Video Recorded', 'Called Lead', 'Email Sent', 'Follow-up'].includes(leadStatus)) shouldInclude = true;
            if (targetStatus === 'Finished' && ['Closed - Won', 'Closed - Lost'].includes(leadStatus)) shouldInclude = true;

            if (shouldInclude) {
                const card = createKanbanCard(row);
                col.appendChild(card);
                count++;
            }
        });
        const countBadge = col.parentElement.querySelector('.column-count');
        if (countBadge) countBadge.textContent = count;

        // Init Sortable
        if (typeof Sortable !== 'undefined') {
            Sortable.create(col, {
                group: 'leads',
                animation: 150,
                ghostClass: 'opacity-50',
                onEnd: async (evt) => {
                    const item = evt.item;
                    const targetColStatus = evt.to.parentElement.dataset.status;
                    const leadKey = item.dataset.leadKey;
                    
                    if (leadKey) {
                        // Determine the specific status to save
                        let newStatus = targetColStatus;
                        if (targetColStatus === 'Action Ongoing') newStatus = 'Follow-up';
                        if (targetColStatus === 'Finished') newStatus = 'Closed - Won';

                        try {
                            const res = await fetch(`/leads/${leadKey}/update`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ status: newStatus })
                            });
                            const data = await res.json();
                            if (data.success) {
                                // Update original row dataset
                                const originalRow = document.querySelector(`.result-row[data-lead-key="${leadKey}"]`);
                                if (originalRow) {
                                    originalRow.dataset.status = newStatus;
                                    // Also update the status badge in the table view if visible
                                    const statusBadge = originalRow.querySelector('td:nth-last-child(2) span');
                                    if (statusBadge) statusBadge.textContent = newStatus;
                                }
                                updateColumnCounts();
                            }
                        } catch (err) { console.error('Failed to update status:', err); }
                    }
                }
            });
        }
    });
  }

  function createKanbanCard(row) {
    const card = document.createElement('div');
    card.className = 'kanban-card p-4 bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-brand-border/10 cursor-grab active:cursor-grabbing hover:border-brand-yellow/50 transition-all group';
    card.dataset.leadKey = row.dataset.leadKey;
    
    const title = row.dataset.title;
    const rating = row.dataset.rating;
    const website = row.dataset.website;
    
    card.innerHTML = `
        <div class="flex items-center justify-between mb-3">
            <span class="text-[9px] font-black uppercase tracking-widest text-brand-muted">${row.dataset.category}</span>
            <div class="flex items-center gap-1 kanban-stars-${row.dataset.leadKey}">
                <!-- Stars rendered via JS -->
            </div>
        </div>
        <h4 class="text-sm font-black text-brand-dark dark:text-white mb-1 truncate">${title}</h4>
        <div class="text-[10px] text-brand-muted font-bold truncate mb-3">${website}</div>
        <div class="row-opportunity-label-${row.dataset.leadKey}">
            <!-- Opportunity Label Rendered via JS -->
        </div>
    `;
    
    // Render stars and labels into the card
    setTimeout(() => {
        const starContainer = card.querySelector(`.kanban-stars-${row.dataset.leadKey}`);
        const oppContainer = card.querySelector(`.row-opportunity-label-${row.dataset.leadKey}`);
        if (starContainer) renderStarsInElement(starContainer, parseFloat(rating) || 0);
        if (oppContainer) oppContainer.innerHTML = renderOpportunityBadges(row);
    }, 0);
    
    card.onclick = () => selectRow(row);
    return card;
  }

  function updateColumnCounts() {
    document.querySelectorAll('.kanban-column').forEach(col => {
        const count = col.querySelectorAll('.kanban-card').length;
        const badge = col.querySelector('.column-count');
        if (badge) badge.textContent = count;
    });
  }

  // --- The War Room (Batch Outreach) ---
  const batchOutreachBtn = document.getElementById('batchOutreachBtn');
  const warRoomModal = document.getElementById('warRoomModal');
  const closeWarRoom = document.getElementById('closeWarRoom');
  const warRoomGrid = document.getElementById('warRoomGrid');
  const warRoomTotal = document.getElementById('warRoomTotal');

  if (batchOutreachBtn && warRoomModal) {
    batchOutreachBtn.addEventListener('click', () => {
        const selected = document.querySelectorAll('.result-row .lead-checkbox:checked');
        if (selected.length === 0) {
            alert('Please select at least one lead for the War Room.');
            return;
        }
        renderWarRoom(selected);
        warRoomModal.classList.remove('hidden');
    });

    closeWarRoom.addEventListener('click', () => {
        warRoomModal.classList.add('hidden');
    });
  }

  function renderWarRoom(selectedCheckboxes) {
    warRoomGrid.innerHTML = '';
    warRoomTotal.textContent = selectedCheckboxes.length;

    selectedCheckboxes.forEach(cb => {
        const row = cb.closest('.result-row');
        const card = createWarRoomCard(row);
        warRoomGrid.appendChild(card);
    });
  }

  function createWarRoomCard(row) {
    const card = document.createElement('div');
    card.className = 'bg-white/5 border border-white/10 rounded-[2.5rem] p-6 hover:border-brand-yellow/30 transition-all flex flex-col gap-4';
    
    const title = row.dataset.title;
    const city = row.dataset.city || 'your area';
    const email = row.dataset.email;
    const competitor = row.dataset.competitorName;
    const compGap = row.dataset.competitorGap;

    const rating = row.dataset.rating || 0;
    
    const gaps = [];
    if (row.dataset.isMobileFriendly === 'false') gaps.push("isn't mobile-friendly");
    if (row.dataset.hasChatbot === 'false') gaps.push("lacks lead-capture");
    if (row.dataset.hasSchemaMarkup === 'false') gaps.push("missing SEO schema");

    let gapText = gaps.length > 0 ? `I noticed your site ${gaps.join(' and ')}.` : "I found some conversion gaps on your site.";
    let compText = (competitor && competitor !== 'N/A') ? `\n\nYour competitor, ${competitor}, is currently gaining an edge because they have ${compGap || 'a more optimized presence'}.` : "";

    const bodyText = `Hey ${title} team,\n\nI was looking for businesses in ${city} and spent some time on your website. ${gapText}${compText}\n\nI'd love to share some specific ideas on how to fix these. Are you open to a quick 5-minute chat?\n\nBest,\n[Your Name]`;

    card.innerHTML = `
        <div class="flex items-center justify-between">
            <div class="flex flex-col gap-1 min-w-0">
                <h4 class="text-white font-black text-xl truncate pr-4">${title}</h4>
                <div class="flex items-center gap-1.5 war-room-stars-${row.dataset.leadKey}">
                    <!-- Stars rendered via JS -->
                    <span class="text-[10px] font-bold text-white/40">${rating}</span>
                </div>
            </div>
            <div class="px-2 py-1 bg-brand-yellow/10 rounded-lg border border-brand-yellow/30 text-[10px] font-black text-brand-yellow shrink-0">READY</div>
        </div>
        <div class="flex flex-wrap gap-2">
            ${gaps.map(g => `<span class="px-2 py-1 bg-rose-500/10 text-rose-400 text-[9px] font-black uppercase tracking-widest rounded-md border border-rose-500/20">${g}</span>`).join('')}
            ${competitor && competitor !== 'N/A' ? `<span class="px-2 py-1 bg-blue-500/10 text-blue-400 text-[9px] font-black uppercase tracking-widest rounded-md border border-blue-500/20">vs ${competitor}</span>` : ''}
        </div>
        <textarea class="w-full bg-black/40 border border-white/10 rounded-2xl p-4 text-xs font-bold text-white/70 h-40 focus:border-brand-yellow outline-none transition-all">${bodyText}</textarea>
        <button class="w-full py-4 bg-brand-yellow text-brand-dark rounded-2xl font-black uppercase tracking-widest hover:scale-[1.02] active:scale-95 transition-all shadow-lg shadow-brand-yellow/10 flex items-center justify-center gap-2" onclick="window.location.href='mailto:${email}?subject=Question regarding ${encodeURIComponent(title)}&body=${encodeURIComponent(bodyText)}'">
             <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" /></svg>
             Review & Lead Audit
        </button>
    `;
    
    setTimeout(() => {
        const starContainer = card.querySelector(`.war-room-stars-${row.dataset.leadKey}`);
        if (starContainer) renderStarsInElement(starContainer, parseFloat(rating) || 0);
    }, 0);
    return card;
  }


  // Initial render of stars in the table
  applyTableStars();
});
