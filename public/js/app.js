document.addEventListener('DOMContentLoaded', () => {
  // --- Lead Gen Productivity Features (CSV, Scoring, Outreach) ---

  const calculateOpportunityScore = (lead) => {
    let score = 0;
    const website = lead.website && lead.website !== 'N/A';
    const email = lead.email && lead.email !== 'N/A';
    const reviews = parseInt(lead.reviews) || 0;
    const rating = parseFloat(lead.rating) || 0;
    const hasFB = lead.facebook && lead.facebook !== 'N/A';
    const hasIG = lead.instagram && lead.instagram !== 'N/A';
    
    // New Audit Signals
    const isOutdated = lead.isOutdated === 'true' || lead.is_outdated === true;
    const noMobile = lead.isMobileFriendly === 'false' || lead.is_mobile_friendly === false;
    const noSchema = lead.hasSchemaMarkup === 'false' || lead.has_schema_markup === false;
    const noChatbot = lead.hasChatbot === 'false' || lead.has_chatbot === false;
    const noClickToCall = lead.hasClickToCall === 'false' || lead.has_click_to_call === false;
    const aeoScore = parseInt(lead.aeoScore || lead.aeo_score) || 3;

    // Logic: Agencies want leads with GAPS
    if (!website) score += 3; // Critical: Needs a site
    if (isOutdated) score += 2; // High: Redesign opportunity
    if (noMobile) score += 2; // High: Technical fix
    if (noSchema) score += 1.5; // High: GEO/AEO optimization
    if (aeoScore < 3) score += 1; // Med: AEO content gap
    if (reviews < 20) score += 1; // Med: Reputation gap
    if (rating < 4.2 && reviews > 0) score += 1; // Med: Quality gap
    if (website && (!hasFB || !hasIG)) score += 1; // Med: Social gap
    if (noChatbot || noClickToCall) score += 0.5; // Low: Conversion gap
    
    return Math.min(Math.round(score), 10);
  };

  const renderOpportunityBadges = (row) => {
    const l = row.dataset;
    const badges = [];
    
    const score = calculateOpportunityScore(l);
    
    // Core Score Badge
    let scoreColor = 'bg-slate-100 text-slate-600 border-slate-200';
    if (score >= 8) scoreColor = 'bg-rose-100 text-rose-700 border-rose-200';
    else if (score >= 5) scoreColor = 'bg-amber-100 text-amber-700 border-amber-200';
    
    badges.push(`<span class="px-2 py-0.5 rounded-md ${scoreColor} text-[9px] font-black border uppercase tracking-tighter">Score: ${score}</span>`);

    // Specific Gap Badges (Show top 2-3 to avoid clutter)
    if (l.website === 'N/A' || !l.website) badges.push(`<span class="px-2 py-0.5 rounded-md bg-red-50 text-red-600 border-red-100 text-[9px] font-bold border uppercase">No Site</span>`);
    if (l.isOutdated === 'true' || l.is_outdated === true) badges.push(`<span class="px-2 py-0.5 rounded-md bg-orange-50 text-orange-600 border-orange-100 text-[9px] font-bold border uppercase">Outdated</span>`);
    if (l.isMobileFriendly === 'false' || l.is_mobile_friendly === false) badges.push(`<span class="px-2 py-0.5 rounded-md bg-purple-50 text-purple-600 border-purple-100 text-[9px] font-bold border uppercase">Mobile Gap</span>`);
    if (l.hasSchemaMarkup === 'false' || l.has_schema_markup === false) badges.push(`<span class="px-2 py-0.5 rounded-md bg-blue-50 text-blue-600 border-blue-100 text-[9px] font-bold border uppercase">Needs GEO</span>`);
    if (parseInt(l.reviews) < 20) badges.push(`<span class="px-2 py-0.5 rounded-md bg-yellow-50 text-yellow-700 border-yellow-100 text-[9px] font-bold border uppercase tracking-tighter">Reputation</span>`);
    
    return `<div class="flex flex-wrap gap-1 items-center justify-center">${badges.slice(0, 3).join('')}</div>`;
  };

  const updateOpportunityBadges = () => {
    document.querySelectorAll('.result-row').forEach(row => {
      const badgeContainer = row.querySelector('.opportunity-badge');
      if (badgeContainer) {
        badgeContainer.innerHTML = renderOpportunityBadges(row);
        badgeContainer.dataset.score = calculateOpportunityScore(row.dataset);
      }
    });
  };

  // Initial calculation
  updateOpportunityBadges();

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
          name: 'Social Media Audit',
          subject: `Helping ${company} with social media growth`,
          body: `Hi team at ${company},\n\nI was looking at your Google Maps profile and noticed you're doing great work! I also saw that you might not be fully utilizing Instagram/Facebook yet.\n\nI'd love to show you how adding a few posts a week can drive 20% more calls. Are you open to a 5-minute chat?\n\nBest regards.`
        },
        {
          name: 'Website Refresh',
          subject: `Quick question about ${company}'s website`,
          body: `Hi there,\n\nI just found ${company} on Google Maps. I noticed your website could use a modern refresh to help convert more visitors into customers.\n\nI've put together a few ideas specifically for your business. Would you like to see them?\n\nCheers.`
        }
      ];

      // Simple prompt for now - could be a modal
      const choice = confirm(`Choose a template for ${company}:\n\nOK: Social Media Audit\nCancel: Website Refresh`);
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
      modeRunNow.className = 'flex-1 h-full rounded-lg text-[9px] font-black uppercase transition-all bg-white dark:bg-slate-700 text-brand-dark dark:text-slate-100 shadow-sm border border-brand-border/10';
      modeSchedule.className = 'flex-1 h-full rounded-lg text-[9px] font-black uppercase transition-all text-brand-muted dark:text-slate-400 hover:text-brand-dark dark:hover:text-slate-100';
      
      if (autopilotSettings) {
        autopilotSettings.classList.add('max-h-0', 'opacity-0', 'pointer-events-none');
        autopilotSettings.classList.remove('max-h-[200px]', 'opacity-100', 'pointer-events-auto');
      }
      if (searchBtnLabel) {
        searchBtnLabel.innerHTML = 'Find Leads<svg class="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>';
      }
    });

    modeSchedule.addEventListener('click', () => {
      searchModeInput.value = 'schedule';
      modeSchedule.className = 'flex-1 h-full rounded-lg text-[9px] font-black uppercase transition-all bg-white dark:bg-slate-700 text-brand-dark dark:text-slate-100 shadow-sm border border-brand-border/10';
      modeRunNow.className = 'flex-1 h-full rounded-lg text-[9px] font-black uppercase transition-all text-brand-muted dark:text-slate-400 hover:text-brand-dark dark:hover:text-slate-100';
      
      if (autopilotSettings) {
        autopilotSettings.classList.remove('max-h-0', 'opacity-0', 'pointer-events-none');
        autopilotSettings.classList.add('max-h-[200px]', 'opacity-100', 'pointer-events-auto');
      }
      if (searchBtnLabel) {
        searchBtnLabel.innerHTML = 'Start Autopilot<svg class="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>';
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

    // Avatar Logic (using Initial)
    const mobileAvatar = document.getElementById('mobilePanelAvatar');
    if (mobileAvatar) {
        mobileAvatar.textContent = title.charAt(0).toUpperCase();
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
    if (phoneEl) phoneEl.textContent = (phone && phone !== 'N/A') ? phone : 'No Phone';
    if (phoneLink) {
        if (phone && phone !== 'N/A') {
            phoneLink.href = `tel:${phone.replace(/\D/g, '')}`;
            phoneLink.classList.remove('opacity-20', 'pointer-events-none');
        } else {
            phoneLink.href = '#';
            phoneLink.classList.add('opacity-20', 'pointer-events-none');
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
        const score = calculateOpportunityScore(row.dataset);
        let statusText = 'Low Opportunity';
        let statusColor = 'text-green-500';
        if (score >= 8) { statusText = 'Critical Opportunity'; statusColor = 'text-red-500'; }
        else if (score >= 5) { statusText = 'High Opportunity'; statusColor = 'text-amber-500'; }
        
        auditStatus.textContent = statusText;
        auditStatus.className = `text-[10px] font-black uppercase tracking-widest ${statusColor}`;
        auditSummary.textContent = row.dataset.auditSummary || (website === 'N/A' || !website ? 'This business lacks a digital footprint and is invisible to AI search engines.' : 'Analyzing website structure and GEO/AEO readiness...');
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
    const ratingText = document.getElementById(textId);
    
    if (!starsContainer) return;

    starsContainer.innerHTML = '';
    const fullStars = Math.floor(rating);
    const hasHalf = rating % 1 >= 0.5;

    for (let i = 0; i < 5; i++) {
        const star = document.createElement('svg');
        star.setAttribute('class', `w-3.5 h-3.5 ${i < fullStars ? 'text-brand-yellow' : (i === fullStars && hasHalf ? 'text-brand-yellow' : 'text-brand-muted/20')}`);
        star.setAttribute('fill', 'currentColor');
        star.setAttribute('viewBox', '0 0 20 20');
        star.innerHTML = '<path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />';
        starsContainer.appendChild(star);
    }

    if (ratingText) {
        if (reviews !== undefined) {
            ratingText.textContent = rating > 0 ? `${rating.toFixed(1)} (${reviews} reviews)` : 'No Rating';
        } else {
            ratingText.textContent = rating > 0 ? rating.toFixed(1) : '-';
        }
    }
  }

  // --- Initialize Table Row Stars ---
  const applyTableStars = () => {
    document.querySelectorAll('.result-row').forEach(row => {
      const rating = parseFloat(row.dataset.rating);
      const reviews = parseInt(row.dataset.reviews);
      const starContainer = row.querySelector('.row-stars');
      if (starContainer && !isNaN(rating)) {
        // Clear previous and render
        starContainer.innerHTML = '';
        const fullStars = Math.floor(rating);
        const hasHalf = rating % 1 >= 0.5;
        for (let i = 0; i < 5; i++) {
          const star = document.createElement('svg');
          star.setAttribute('class', `w-2.5 h-2.5 ${i < fullStars ? 'text-brand-yellow' : (i === fullStars && hasHalf ? 'text-brand-yellow' : 'text-brand-muted/10')}`);
          star.setAttribute('fill', 'currentColor');
          star.setAttribute('viewBox', '0 0 20 20');
          star.innerHTML = '<path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />';
          starContainer.appendChild(star);
        }
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
      const title = currentRow.dataset.title;
      const city = currentRow.dataset.city;
      const state = currentRow.dataset.state;
      const url = currentRow.dataset.website;

      const originalHTML = deepEnhanceBtn.innerHTML;
      
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
          
          // Flash success state
          deepEnhanceBtn.innerHTML = '✨ Success! Data Found';
          setTimeout(() => {
             deepEnhanceBtn.classList.remove('loading', 'animate-magic');
             deepEnhanceBtn.innerHTML = originalHTML;
          }, 3000);
        } else {
          alert(data.error || "No additional contact data discovered yet.");
          deepEnhanceBtn.classList.remove('loading', 'animate-magic');
          deepEnhanceBtn.innerHTML = originalHTML;
        }
      } catch (err) {
        console.error('Enhancement failed:', err);
        alert("Enhancement failed. Please try again later.");
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
      bulkEnhanceBtn.classList.add('loading', 'animate-magic');
      bulkEnhanceBtn.innerHTML = '<span class="flex items-center gap-2"><svg class="animate-spin h-3.5 w-3.5 text-brand-yellow" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>Enchanting Leads...</span>';

      for (const row of selectedRows) {
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

      bulkEnhanceBtn.innerHTML = '✨ Leads Enchanted';
      setTimeout(() => {
        bulkEnhanceBtn.classList.remove('loading', 'animate-magic');
        bulkEnhanceBtn.innerHTML = originalText;
      }, 3000);
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
