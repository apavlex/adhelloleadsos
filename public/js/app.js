document.addEventListener('DOMContentLoaded', () => {
  // --- Lead Gen Productivity Features (CSV, Scoring, Outreach) ---

  // Bell + processing ring + /api/status: public/js/nav-notifications.js (navbar)
  const updateProcessingStatus =
    typeof window.updateProcessingStatus === 'function' ? window.updateProcessingStatus : () => {};

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
    const cms = String(lead.cmsPlatform || '').toLowerCase();

    let buyingSignals = [];
    try {
      if (lead.buyingSignals && lead.buyingSignals !== 'undefined') {
        const parsed = JSON.parse(lead.buyingSignals);
        if (Array.isArray(parsed)) buyingSignals = parsed;
      }
    } catch (_) {}

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
        if ((cms === 'wix' || cms === 'squarespace') && noChatbot) score += 1.5;
        else if ((cms === 'shopify' || cms === 'webflow') && noChatbot) score += 1.0;
    }

    if (buyingSignals.length > 0) score += Math.min(2, buyingSignals.length * 0.5);
    
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
  setTimeout(() => {
    console.log('[DEBUG] Running initial opportunity analysis...');
    updateOpportunityBadges();
    sortLeadsByOpportunity(false);
  }, 300); 

  // Secondary backup for slower renders
  setTimeout(updateOpportunityBadges, 1500);
  
  const sortLeadsByOpportunity = (isAscending) => {
    const tableBody = document.querySelector('tbody');
    if (!tableBody) return;
    const rows = Array.from(tableBody.querySelectorAll('.result-row'));
    
    rows.sort((a, b) => {
      const scoreA = calculateOpportunityScore(a.dataset);
      const scoreB = calculateOpportunityScore(b.dataset);
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

  // Export CSV — all `.js-bulk-export-csv` buttons (avoids duplicate id on /leads floating bar vs header bar)
  document.querySelectorAll('.js-bulk-export-csv').forEach((exportBtn) => {
    exportBtn.addEventListener('click', () => {
      const selectedCheckboxes = document.querySelectorAll('.row-checkbox:checked, .lead-checkbox:checked');
      const leadsToExport = [];

      if (selectedCheckboxes.length > 0) {
        selectedCheckboxes.forEach((cb) => {
          const row = cb.closest('.result-row');
          if (row) leadsToExport.push(row.dataset);
        });
      } else {
        document.querySelectorAll('.result-row').forEach((row) => {
          leadsToExport.push(row.dataset);
        });
      }

      if (leadsToExport.length === 0) return alert('No leads found to export.');

      const headers = [
        'Company',
        'Category',
        'Phone',
        'Website',
        'Email',
        'Address',
        'Rating',
        'Reviews',
        'Facebook',
        'Instagram',
        'Twitter',
        'Opportunity Score',
      ];
      const rows = leadsToExport.map((l) => [
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
        calculateOpportunityScore(l),
      ]);

      const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.setAttribute('download', `AdHello_Leads_${new Date().toISOString().split('T')[0]}.csv`);
      link.click();
    });
  });

  function escapeHtmlAttr(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escapeHtmlText(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function closeEmailIntelModal() {
    const modal = document.getElementById('emailIntelModal');
    if (modal) {
      modal.classList.add('hidden');
      modal.setAttribute('aria-hidden', 'true');
    }
    document.body.style.overflow = '';
  }

  /** Plain-text bodies for “What we offer” mailto links (idx 0–5). */
  function buildEmailIntelOfferMailto(email, company, idx) {
    const c = company || 'there';
    const offers = [
      {
        subject: `Website & conversions — ${c}`,
        body: `Hi,\n\nI’ve been looking at ${c} online and wanted to reach out about speed, clarity, and conversion (CRO). We help teams turn more of the traffic they already get into booked calls and form fills.\n\nWould you be open to a short call this week?\n\nBest,`,
      },
      {
        subject: `Reviews & reputation — ${c}`,
        body: `Hi,\n\nGiven how visible ${c} is locally, protecting and growing reviews usually has a fast ROI. We help with review rhythm, listings/GEO, and AI-assisted responses so nothing slips.\n\nOpen to a quick conversation?\n\nBest,`,
      },
      {
        subject: `Social & content — ${c}`,
        body: `Hi,\n\nI’m reaching out about ${c}’s social presence — consistent posting, community replies, and content that actually supports leads (not just vanity metrics).\n\nWorth a 10-minute chat?\n\nBest,`,
      },
      {
        subject: `Paid ads — ${c}`,
        body: `Hi,\n\nIf ${c} is running (or considering) Meta/Google ads, we help with tracking, creative testing, and weekly optimization so spend maps to real bookings.\n\nWould you like a second opinion on the account?\n\nBest,`,
      },
      {
        subject: `AI automation — ${c}`,
        body: `Hi,\n\nQuick note on ${c}: many teams claw back hours with light AI workflows — follow-ups, scheduling, CRM hygiene, after-hours capture — without adding headcount.\n\nHappy to share one concrete idea if you’re open to it.\n\nBest,`,
      },
      {
        subject: `Strategy & consulting — ${c}`,
        body: `Hi,\n\nI’d love to explore a focused engagement with ${c} — growth priorities, channel mix, and a simple plan you can execute with or without us long-term.\n\nAre you open to a discovery call?\n\nBest,`,
      },
    ];
    const o = offers[Math.min(Math.max(0, idx), offers.length - 1)];
    return `mailto:${email}?subject=${encodeURIComponent(o.subject)}&body=${encodeURIComponent(o.body)}`;
  }

  function wireEmailIntelOfferLinks(email, company) {
    document.querySelectorAll('.email-intel-offer-link').forEach((a, i) => {
      if (!email) {
        a.href = '#';
        a.classList.add('opacity-45', 'pointer-events-none', 'cursor-not-allowed');
        a.setAttribute('aria-disabled', 'true');
        return;
      }
      a.classList.remove('opacity-45', 'pointer-events-none', 'cursor-not-allowed');
      a.removeAttribute('aria-disabled');
      a.href = buildEmailIntelOfferMailto(email, company, i);
    });
  }

  async function openEmailIntelModal(row) {
    const modal = document.getElementById('emailIntelModal');
    const titleEl = document.getElementById('emailIntelTitle');
    const aiBody = document.getElementById('emailIntelAiBody');
    const mailtoBtn = document.getElementById('emailIntelMailto');
    if (!modal || !row) return;

    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    const company = row.dataset.title || 'Lead';
    if (titleEl) titleEl.textContent = company;

    const emailRaw = (row.dataset.email || '').trim();
    const email = emailRaw && emailRaw !== 'N/A' ? emailRaw : '';

    wireEmailIntelOfferLinks(email, company);

    const intelRef = { label: '', rationale: '', talkTrack: '' };

    if (mailtoBtn) {
      mailtoBtn.disabled = !email;
      mailtoBtn.onclick = () => {
        if (!email) return;
        const subj = intelRef.label ? `${intelRef.label} — ${company}` : `Quick idea for ${company}`;
        const parts = [];
        if (intelRef.rationale) parts.push(intelRef.rationale);
        if (intelRef.talkTrack) parts.push(`Suggested opener:\n${intelRef.talkTrack}`);
        parts.push('Best,');
        const body = parts.join('\n\n');
        window.location.href = `mailto:${email}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(body)}`;
      };
    }

    if (aiBody) {
      aiBody.innerHTML =
        '<p class="text-sm text-brand-muted dark:text-slate-500 animate-pulse">Loading AI recommendation…</p>';
    }

    const key = row.dataset.leadKey;
    if (key && aiBody) {
      try {
        const res = await fetch(`/leads/${encodeURIComponent(key)}/insights`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({}),
        });
        const data = await res.json();
        if (data.success) {
          intelRef.label = data.primaryServiceLabel || '';
          intelRef.rationale = data.rationale || '';
          intelRef.talkTrack = data.talkTrack || '';
          const label = escapeHtmlText(data.primaryServiceLabel || 'Recommended offer');
          const rationale = data.rationale ? escapeHtmlText(data.rationale) : '';
          const track = data.talkTrack ? escapeHtmlText(data.talkTrack) : '';
          let html = `<div class="rounded-2xl bg-brand-yellow/10 dark:bg-brand-yellow/15 border border-brand-yellow/30 p-4 mb-3">
            <p class="text-[10px] font-black uppercase tracking-widest text-brand-yellow mb-1">AI recommended focus</p>
            <p class="font-bold text-brand-dark dark:text-white">${label}</p>
          </div>`;
          if (rationale) {
            html += `<p class="text-sm text-brand-muted dark:text-slate-400 leading-relaxed">${rationale.replace(/\n/g, '<br>')}</p>`;
          }
          if (track) {
            html += `<p class="text-xs font-semibold text-brand-dark dark:text-slate-300 mt-4 leading-relaxed">Suggested opener: <span class="italic">“${track}”</span></p>`;
          }
          if (data.cached) {
            html += `<p class="text-[9px] font-bold uppercase tracking-widest text-brand-muted/60 mt-3">Cached insight · ${escapeHtmlText(data.provider || '')}</p>`;
          }
          aiBody.innerHTML = html;
        } else {
          aiBody.innerHTML =
            '<p class="text-sm text-brand-muted dark:text-slate-500">No AI insight yet. Set <code class="text-[10px] bg-brand-cream dark:bg-slate-800 px-1 rounded">GEMINI_API_KEY</code> or other LLM keys, or open the lead detail panel after enrich.</p>';
        }
      } catch {
        if (aiBody) {
          aiBody.innerHTML =
            '<p class="text-sm text-rose-600 dark:text-rose-400">Could not load AI recommendation.</p>';
        }
      }
    } else if (aiBody) {
      aiBody.innerHTML =
        '<p class="text-sm text-brand-muted dark:text-slate-500">Save this lead to unlock AI recommendations.</p>';
    }
  }

  document.addEventListener('click', (e) => {
    const intelBtn = e.target.closest('.email-intel-btn');
    if (intelBtn) {
      e.preventDefault();
      e.stopPropagation();
      const row = intelBtn.closest('.result-row');
      if (row) openEmailIntelModal(row);
      return;
    }
    if (e.target.closest('.email-intel-close') || e.target.closest('.email-intel-backdrop')) {
      closeEmailIntelModal();
      return;
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const modal = document.getElementById('emailIntelModal');
    if (modal && !modal.classList.contains('hidden')) closeEmailIntelModal();
  });

  // Quick outreach logic (results / panel — not leads table email-intel)
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

  // Theme toggle: public/js/theme-toggle.js (included from partials/navbar on all app pages)

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

  // --- Search Form Handling (POST /search → Apify in background) ---
  const searchForm = document.getElementById('searchForm');
  const btn = document.getElementById('searchBtn');
  const loader = document.getElementById('loadingIndicator');
  const modeRunNow = document.getElementById('modeRunNow');
  const modeSchedule = document.getElementById('modeSchedule');
  const searchModeInput = document.getElementById('searchModeInput');
  const userTimezoneInput = document.getElementById('userTimezone');
  const searchBtnLabel = btn ? btn.querySelector('#searchBtnText') : null;

  if (userTimezoneInput) {
    userTimezoneInput.value = Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  function setScheduledDateDefaults() {
    const dateEl = document.getElementById('scheduledDateInput');
    if (!dateEl) return;
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    const isoLocal = `${y}-${m}-${d}`;
    dateEl.min = isoLocal;
    if (!dateEl.value) dateEl.value = isoLocal;
  }

  if (modeRunNow && modeSchedule && searchModeInput) {
    const scheduledSearchSettings = document.getElementById('scheduledSearchSettings');

    modeRunNow.addEventListener('click', () => {
      searchModeInput.value = 'run';
      modeRunNow.className = 'flex-1 h-full rounded-lg text-[9px] font-black uppercase transition-all bg-white dark:bg-slate-700 text-brand-dark dark:text-slate-100 shadow-sm border border-brand-border/10';
      modeSchedule.className = 'flex-1 h-full rounded-lg text-[9px] font-black uppercase transition-all text-brand-muted dark:text-slate-400 hover:text-brand-dark dark:hover:text-slate-100';

      if (scheduledSearchSettings) {
        scheduledSearchSettings.classList.add('hidden');
      }
      const dateEl = document.getElementById('scheduledDateInput');
      if (dateEl) dateEl.required = false;

      if (searchBtnLabel) {
        searchBtnLabel.innerHTML = 'Find Leads<svg class="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>';
      }
    });

    modeSchedule.addEventListener('click', () => {
      searchModeInput.value = 'schedule';
      modeSchedule.className = 'flex-1 h-full rounded-lg text-[9px] font-black uppercase transition-all bg-white dark:bg-slate-700 text-brand-dark dark:text-slate-100 shadow-sm border border-brand-border/10';
      modeRunNow.className = 'flex-1 h-full rounded-lg text-[9px] font-black uppercase transition-all text-brand-muted dark:text-slate-400 hover:text-brand-dark dark:hover:text-slate-100';

      if (scheduledSearchSettings) {
        scheduledSearchSettings.classList.remove('hidden');
      }
      setScheduledDateDefaults();
      const dateElSch = document.getElementById('scheduledDateInput');
      if (dateElSch) dateElSch.required = true;

      if (searchBtnLabel) {
        searchBtnLabel.innerHTML = 'Save schedule ⚡<svg class="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>';
      }
    });
  }

  if (searchForm) {
    searchForm.addEventListener('submit', () => {
      updateProcessingStatus(true);
      const loadingOverlay = document.getElementById('loadingOverlay');
      if (loadingOverlay) loadingOverlay.classList.remove('hidden');

      const isSchedule = searchModeInput && searchModeInput.value === 'schedule';
      if (!isSchedule && btn) {
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
      if (!isSchedule && loader) {
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

  // --- Detail panel & rows (must not depend on mobile nav; panel exists on Prospecting / leads pages) ---
  const mobilePanel = document.getElementById('mobilePanel');
  const closeMobileBtn = document.getElementById('closeMobilePanel');
  const prevLeadBtn = document.getElementById('prevLeadBtn');
  const nextLeadBtn = document.getElementById('nextLeadBtn');
  let rows = document.querySelectorAll('.result-row');
  const navigableRows = () => Array.from(rows).filter((r) => !r.classList.contains('workflow-filtered-out'));
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
          const title = (row.dataset.title || "").trim();
          if (savedLeads.has(title)) {
            row.dataset.leadKey = savedLeads.get(title);
            const bookmarkBtn = row.querySelector('.bookmark-btn');
            if (bookmarkBtn) markBookmarkSaved(bookmarkBtn);
          }
        });
      })
      .catch((err) => console.error('Failed to fetch saved leads:', err));
  }

  // --- Centralized Row Selection Logic ---
  const selectRow = (row) => {
    if (!row) return;

    // Remove existing selection
    rows.forEach((r) => r.classList.remove('selected'));
    row.classList.add('selected');
    
    currentRow = row;
    const nav = navigableRows();
    currentIndex = nav.indexOf(row);

    // Update nav button visibility/state (workflow page may hide filtered-out rows)
    if (prevLeadBtn) prevLeadBtn.style.opacity = currentIndex > 0 ? '1' : '0.3';
    if (nextLeadBtn) nextLeadBtn.style.opacity = currentIndex >= 0 && currentIndex < nav.length - 1 ? '1' : '0.3';

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
    if (mobilePanel) {
      mobilePanel.style.display = 'flex';
      mobilePanel.classList.remove('hidden');
      
      // Lock scroll
      document.body.style.overflow = 'hidden'; 
      
      // Trigger entrance
      setTimeout(() => {
          mobilePanel.classList.add('open');
          mobilePanel.classList.replace('opacity-0', 'opacity-100');
          mobilePanel.style.pointerEvents = 'auto';

          const panelScroll = mobilePanel.querySelector('div.overflow-y-auto');
          if (panelScroll) panelScroll.scrollTop = 0;
          const stickyTitle = document.getElementById('stickyPanelTitle');
          if (stickyTitle) {
            stickyTitle.classList.add('opacity-0', 'pointer-events-none');
            stickyTitle.classList.remove('opacity-100');
          }

          const childDiv = mobilePanel.querySelector('div');
          if (childDiv) {
              childDiv.classList.remove('translate-y-full', 'translate-x-full');
              childDiv.style.display = 'block';
          }
      }, 10);
    }
  };

  // --- Row click -> open slide-up detail panel (Universal) ---
  if (rows.length > 0) {
    rows.forEach((row) => {
      row.style.cursor = 'pointer'; // Ensure it looks clickable
      row.addEventListener('click', (e) => {
        if (!mobilePanel) return;
        // Stop if clicking specific interactive elements
        if (
          e.target.type === 'checkbox' ||
          e.target.closest('.bookmark-btn') ||
          e.target.closest('.view-detail-btn') ||
          e.target.closest('.email-intel-btn') ||
          e.target.closest('select') ||
          e.target.closest('form') ||
          e.target.closest('a')
        ) {
          return;
        }

        selectRow(row);
      });
    });
  }

  // Specific Detail Button Trigger (Reliability)
  document.addEventListener('click', (e) => {
    if (!mobilePanel) return;
    const detailBtn = e.target.closest('.view-detail-btn');
    if (detailBtn) {
      e.stopPropagation();
      const row = detailBtn.closest('.result-row');
      if (row) selectRow(row);
    }
  });

  (function openFocusLeadFromQuery() {
    if (!mobilePanel) return;
    const params = new URLSearchParams(window.location.search);
    const raw = (params.get('focusLead') || '').trim();
    if (!raw) return;
    const short = raw.replace(/^lead:/i, '');
    let target = null;
    document.querySelectorAll('.result-row').forEach((row) => {
      const k = row.getAttribute('data-lead-key') || '';
      const norm = k.startsWith('lead:') ? k.slice(5) : k;
      if (k === raw || k === `lead:${short}` || norm === short) target = row;
    });
    if (target) {
      selectRow(target);
      params.delete('focusLead');
      const clean = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}${window.location.hash}`;
      window.history.replaceState({}, '', clean);
    }
  })();

  if (mobilePanel && rows.length > 0) {

    if (closeMobileBtn) {
        closeMobileBtn.addEventListener('click', () => {
            mobilePanel.classList.remove('open');
            mobilePanel.classList.replace('opacity-100', 'opacity-0');
            mobilePanel.style.pointerEvents = 'none';
            setTimeout(() => mobilePanel.classList.add('hidden'), 300);
            document.body.style.overflow = '';
            rows.forEach((r) => r.classList.remove('selected'));
            currentRow = null;
            currentIndex = -1;
        });
    }

    // Navigation Arrows
    if (prevLeadBtn) {
        prevLeadBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const nav = navigableRows();
            const idx = currentRow ? nav.indexOf(currentRow) : -1;
            if (idx > 0) selectRow(nav[idx - 1]);
        });
    }

    if (nextLeadBtn) {
        nextLeadBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const nav = navigableRows();
            const idx = currentRow ? nav.indexOf(currentRow) : -1;
            if (idx >= 0 && idx < nav.length - 1) selectRow(nav[idx + 1]);
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

    // Sticky title: show compact name in the nav row after scrolling past the hero
    if (mobilePanel) {
      const panelContent = mobilePanel.querySelector('div.overflow-y-auto');
      const stickyTitle = document.getElementById('stickyPanelTitle');
      if (panelContent && stickyTitle) {
        const STICKY_THRESHOLD = 96;
        panelContent.addEventListener(
          'scroll',
          () => {
            const show = panelContent.scrollTop > STICKY_THRESHOLD;
            if (show) {
              stickyTitle.classList.remove('opacity-0', 'pointer-events-none');
              stickyTitle.classList.add('opacity-100');
            } else {
              stickyTitle.classList.add('opacity-0', 'pointer-events-none');
              stickyTitle.classList.remove('opacity-100');
            }
          },
          { passive: true }
        );
      }
    }
  }

  let kieInsightRequestId = 0;

  function scheduleKieServiceInsight(row) {
    const key = row.dataset.leadKey;
    const auditStatus = document.getElementById('mobilePanelAuditStatus');
    const auditSummary = document.getElementById('mobilePanelAuditSummary');
    const auditLoading = document.getElementById('mobilePanelAuditLoading');
    const auditProvider = document.getElementById('mobilePanelAuditProvider');
    const auditSell = document.getElementById('mobilePanelAuditSell');
    const openerWrap = document.getElementById('mobilePanelAuditOpenerWrap');
    const openerEl = document.getElementById('mobilePanelAuditOpener');
    if (!auditStatus || !auditSummary) return;

    const heuristic = auditSummary.textContent;

    if (!key) {
      if (auditLoading) auditLoading.classList.add('hidden');
      if (auditProvider) auditProvider.classList.add('hidden');
      if (auditSell) auditSell.textContent = '—';
      if (openerWrap) openerWrap.classList.add('hidden');
      if (openerEl) openerEl.textContent = '';
      return;
    }

    const reqId = ++kieInsightRequestId;
    if (auditLoading) auditLoading.classList.remove('hidden');
    if (auditProvider) {
      auditProvider.classList.add('hidden');
      auditProvider.textContent = '';
    }

    fetch(`/leads/${key}/insights`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({}),
    })
      .then((r) => r.json())
      .then((data) => {
        if (reqId !== kieInsightRequestId) return;
        if (auditLoading) auditLoading.classList.add('hidden');
        if (!data.success) {
          auditSummary.textContent = heuristic;
          if (auditSell) auditSell.textContent = auditStatus.textContent || '—';
          if (openerWrap) openerWrap.classList.add('hidden');
          if (openerEl) openerEl.textContent = '';
          return;
        }
        const sellLabel = data.primaryServiceLabel || 'Recommended offer';
        auditStatus.textContent = sellLabel;
        auditStatus.className = 'text-[10px] font-black uppercase tracking-widest text-brand-yellow';
        if (auditSell) auditSell.textContent = sellLabel;
        auditSummary.textContent = data.rationale || heuristic;
        if (openerWrap && openerEl) {
          const tt = typeof data.talkTrack === 'string' ? data.talkTrack.trim() : '';
          if (tt) {
            openerEl.textContent = `“${tt}”`;
            openerWrap.classList.remove('hidden');
          } else {
            openerEl.textContent = '';
            openerWrap.classList.add('hidden');
          }
        }
        if (auditProvider) {
          auditProvider.textContent = data.cached ? 'AI insight (cached)' : `AI insight · ${data.provider || 'kie'}`;
          auditProvider.classList.remove('hidden');
        }
      })
      .catch(() => {
        if (reqId !== kieInsightRequestId) return;
        if (auditLoading) auditLoading.classList.add('hidden');
        auditSummary.textContent = heuristic;
        if (auditSell) auditSell.textContent = auditStatus.textContent || '—';
        if (openerWrap) openerWrap.classList.add('hidden');
        if (openerEl) openerEl.textContent = '';
      });
  }

  let reviewIntelRequestId = 0;

  function reviewHeuristicsFromRowDataset(ds) {
    const rating = parseFloat(ds.rating) || 0;
    const n = parseInt(ds.reviews, 10) || 0;
    const strengths = [];
    const weaknesses = [];
    if (rating >= 4.3) strengths.push('Strong average rating — customers generally rate the experience highly.');
    else if (rating >= 3.8 && rating > 0) strengths.push('Solid average rating with room to sharpen the public narrative.');
    if (n >= 50) strengths.push('High review volume — strong social proof in local search.');
    else if (n >= 10) strengths.push('Meaningful review count — an established local footprint.');
    if (rating < 4.0 && rating > 0) weaknesses.push('Below ~4.0★ — sentiment and response cadence may need attention.');
    if (n > 0 && n < 10) weaknesses.push('Thin review footprint — easier for competitors to look more trusted.');
    if (rating === 0 && n === 0) {
      strengths.push('Greenfield — a structured review program can be positioned as growth, not chores.');
      weaknesses.push('No star/review signals on file — enrich or import listings data to tighten the pitch.');
    }
    if (strengths.length === 0) strengths.push('—');
    if (weaknesses.length === 0) weaknesses.push('—');
    return {
      strengths,
      weaknesses,
      sourceNote: 'Quick read from stars and review count only (save the lead for AI + quoted snippets).',
    };
  }

  function scheduleReviewIntelligence(row, opts) {
    const refresh = !!(opts && opts.refresh);
    const section = document.getElementById('reviewReputationSection');
    if (!section || !row) return;

    const loading = document.getElementById('reviewIntelLoading');
    const grid = document.getElementById('reviewIntelGrid');
    const errEl = document.getElementById('reviewIntelError');
    const foot = document.getElementById('reviewIntelFootnote');
    const strengthsUl = document.getElementById('reviewStrengthsList');
    const weaknessesUl = document.getElementById('reviewWeaknessesList');
    const snippetsWrap = document.getElementById('reviewSnippetsWrap');
    const snippetsUl = document.getElementById('reviewSnippetsList');
    const refreshBtn = document.getElementById('reviewIntelRefreshBtn');

    function fillReviewBullets(ul, items) {
      if (!ul) return;
      ul.innerHTML = '';
      const list = Array.isArray(items) ? items : [];
      if (!list.length) {
        const li = document.createElement('li');
        li.className = 'text-xs text-brand-muted dark:text-slate-400';
        li.textContent = '—';
        ul.appendChild(li);
        return;
      }
      for (const t of list.slice(0, 8)) {
        const li = document.createElement('li');
        li.className =
          'text-xs font-semibold text-brand-dark dark:text-slate-200 leading-relaxed pl-3 border-l-2 border-brand-yellow/50 mb-2 last:mb-0';
        li.textContent = String(t);
        ul.appendChild(li);
      }
    }

    function applyIntel(data, heuristicFallback) {
      if (loading) loading.classList.add('hidden');
      if (grid) grid.classList.remove('hidden');
      if (errEl) errEl.classList.add('hidden');
      const src = data && data.sourceNote;
      if (foot) {
        if (src) {
          foot.textContent = data.cached ? `${src} (cached)` : src;
          foot.classList.remove('hidden');
        } else {
          foot.textContent = '';
          foot.classList.add('hidden');
        }
      }
      if (data && Array.isArray(data.strengths)) {
        fillReviewBullets(strengthsUl, data.strengths);
        fillReviewBullets(weaknessesUl, data.weaknesses);
      } else if (heuristicFallback) {
        fillReviewBullets(strengthsUl, heuristicFallback.strengths);
        fillReviewBullets(weaknessesUl, heuristicFallback.weaknesses);
        if (foot && heuristicFallback.sourceNote) {
          foot.textContent = heuristicFallback.sourceNote;
          foot.classList.remove('hidden');
        }
      }
    }

    let snippets = [];
    try {
      const raw = row.dataset.reviewSnippets;
      if (raw && raw !== '[]' && raw !== '') snippets = JSON.parse(raw);
    } catch (_) {
      snippets = [];
    }
    if (snippetsUl && snippetsWrap) {
      snippetsUl.innerHTML = '';
      if (snippets.length) {
        snippetsWrap.classList.remove('hidden');
        for (const s of snippets.slice(0, 8)) {
          const li = document.createElement('li');
          li.className =
            'text-[11px] text-brand-muted dark:text-slate-400 leading-relaxed italic border-l-2 border-brand-border/40 dark:border-white/10 pl-3';
          li.textContent = `"${String(s)}"`;
          snippetsUl.appendChild(li);
        }
      } else {
        snippetsWrap.classList.add('hidden');
      }
    }

    if (refreshBtn) {
      refreshBtn.classList.toggle('hidden', !row.dataset.leadKey);
    }

    const key = row.dataset.leadKey;
    const heuristic = reviewHeuristicsFromRowDataset(row.dataset);

    if (!key) {
      applyIntel(null, heuristic);
      return;
    }

    if (errEl) {
      errEl.classList.add('hidden');
      errEl.textContent = '';
    }
    if (loading) loading.classList.remove('hidden');
    if (grid) grid.classList.add('hidden');
    if (foot) {
      foot.textContent = '';
      foot.classList.add('hidden');
    }

    const reqId = ++reviewIntelRequestId;
    fetch(`/leads/${encodeURIComponent(key)}/review-intelligence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ refresh }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (reqId !== reviewIntelRequestId) return;
        if (data.success) {
          applyIntel(data, null);
        } else {
          if (loading) loading.classList.add('hidden');
          if (grid) grid.classList.remove('hidden');
          applyIntel(null, heuristic);
          if (errEl) {
            const hint = data.error ? String(data.error) : '';
            errEl.textContent = hint
              ? `${hint} Showing quick signals below.`
              : 'AI unavailable. Showing quick signals below.';
            errEl.classList.remove('hidden');
          }
        }
      })
      .catch(() => {
        if (reqId !== reviewIntelRequestId) return;
        if (loading) loading.classList.add('hidden');
        if (grid) grid.classList.remove('hidden');
        applyIntel(null, heuristic);
        if (errEl) {
          errEl.textContent = 'Could not reach review analysis. Showing quick signals below.';
          errEl.classList.remove('hidden');
        }
      });
  }

  function syncPersistedLeadToRowDataset(row, L) {
    if (!row || !L || typeof L !== 'object') return;
    const ds = row.dataset;
    if (L.title != null) ds.title = L.title;
    if (L.phone != null) ds.phone = L.phone || 'N/A';
    if (L.website != null) ds.website = L.website || 'N/A';
    if (L.email != null) ds.email = L.email || 'N/A';
    if (L.address != null) ds.address = L.address || 'N/A';
    if (L.city != null) ds.city = L.city || '';
    if (L.state != null) ds.state = L.state || '';
    if (L.categoryName != null) ds.category = L.categoryName || 'N/A';
    if (L.url != null) ds.url = L.url || '';
    if (L.facebook != null) ds.facebook = L.facebook || 'N/A';
    if (L.instagram != null) ds.instagram = L.instagram || 'N/A';
    if (L.twitter != null) ds.twitter = L.twitter || 'N/A';
    if (L.totalScore != null) ds.rating = String(L.totalScore);
    if (L.reviewsCount != null) ds.reviews = String(L.reviewsCount);
    if (L.reviewSnippets != null) {
      ds.reviewSnippets = Array.isArray(L.reviewSnippets)
        ? JSON.stringify(L.reviewSnippets)
        : String(L.reviewSnippets || '[]');
    }
    if (L.status != null) ds.status = L.status;
    if (L.hasSchemaMarkup !== undefined && L.hasSchemaMarkup !== null) ds.hasSchemaMarkup = L.hasSchemaMarkup;
    if (L.hasChatbot !== undefined && L.hasChatbot !== null) ds.hasChatbot = L.hasChatbot;
    if (L.hasClickToCall !== undefined && L.hasClickToCall !== null) ds.hasClickToCall = L.hasClickToCall;
    if (L.isMobileFriendly !== undefined && L.isMobileFriendly !== null) ds.isMobileFriendly = L.isMobileFriendly;
    if (L.isOutdated !== undefined && L.isOutdated !== null) ds.isOutdated = L.isOutdated;
    if (L.visualModernityScore != null) ds.visualModernityScore = L.visualModernityScore;
    if (L.aeoScore != null) ds.aeoScore = L.aeoScore;
    if (L.geoGaps != null) ds.geoGaps = L.geoGaps;
    if (L.auditSummary != null) ds.auditSummary = L.auditSummary;
    if (L.cmsPlatform != null) ds.cmsPlatform = L.cmsPlatform;
    if (L.competitorName != null) ds.competitorName = L.competitorName;
    if (L.competitorGap != null) ds.competitorGap = L.competitorGap;
    if (L.updates) ds.updates = JSON.stringify(L.updates);
    if (L.cqi !== undefined) ds.cqi = L.cqi == null ? 'null' : JSON.stringify(L.cqi);
  }

  /** Show pitch video URL when status is Video Recorded, or when a URL is already saved (any status). */
  function syncQuickPitchSectionVisibility(row) {
    const section = document.getElementById('quickPitchSection');
    const panelSel = document.getElementById('leadStatusSelect');
    if (!section || !row) return;
    let st = String(row.dataset.status || '').trim();
    if (st === 'Needs Video') st = 'Not Contacted';
    if (row === currentRow && panelSel) {
      const pv = String(panelSel.value || '').trim();
      if (pv) {
        st = pv;
        if (st === 'Needs Video') st = 'Not Contacted';
      }
    }
    const loom = String(row.dataset.loomUrl || '').trim();
    const show = st === 'Video Recorded' || loom.length > 0;
    section.classList.toggle('hidden', !show);
  }

  function syncLoomOpenLink(urlRaw) {
    const loomOpen = document.getElementById('loomUrlOpenBtn');
    if (!loomOpen) return;
    const raw = String(urlRaw || '').trim();
    if (!raw) {
      loomOpen.classList.add('hidden');
      loomOpen.removeAttribute('href');
      return;
    }
    const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, '')}`;
    loomOpen.href = href;
    loomOpen.classList.remove('hidden');
  }

  function parseRowCqi(row) {
    try {
      const raw = row.dataset.cqi;
      if (!raw || raw === '' || raw === 'null' || raw === 'undefined') return null;
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object') return null;
      return obj;
    } catch {
      return null;
    }
  }

  function cqiHasContent(cqi) {
    if (!cqi) return false;
    const r = (cqi.monthlyRevenue || '').toString().trim();
    const s = (cqi.marketingSpend || '').toString().trim();
    const n = (cqi.notes || '').toString().trim();
    return !!(r || s || n);
  }

  function syncMobilePanelCqi(row) {
    const pill = document.getElementById('mobilePanelCqiPill');
    const emptyEl = document.getElementById('mobilePanelCqiEmpty');
    const detailsEl = document.getElementById('mobilePanelCqiDetails');
    const revEl = document.getElementById('mobilePanelCqiRevenue');
    const spendEl = document.getElementById('mobilePanelCqiSpend');
    const notesEl = document.getElementById('mobilePanelCqiNotes');
    const recEl = document.getElementById('mobilePanelCqiRecorded');
    if (!pill || !emptyEl || !detailsEl) return;

    const cqi = parseRowCqi(row);
    const filled = cqiHasContent(cqi);
    const ps = parseInt(row.dataset.pipelineStage, 10);
    const stage = !Number.isNaN(ps) && ps >= 1 && ps <= 10 ? ps : 1;

    if (filled) {
      pill.textContent = 'CQI logged';
      pill.className =
        'shrink-0 whitespace-nowrap px-3 py-1 rounded-full border text-[10px] font-black uppercase tracking-widest bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-500/30';
    } else if (stage >= 4) {
      pill.textContent = 'Log CQI';
      pill.className =
        'shrink-0 whitespace-nowrap px-3 py-1 rounded-full border text-[10px] font-black uppercase tracking-widest bg-amber-500/15 text-amber-800 dark:text-amber-200 border-amber-500/35';
    } else {
      pill.textContent = 'Pre-CQI';
      pill.className =
        'shrink-0 whitespace-nowrap px-3 py-1 rounded-full border text-[10px] font-black uppercase tracking-widest bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border-brand-border/30 dark:border-white/10';
    }

    if (filled) {
      emptyEl.classList.add('hidden');
      detailsEl.classList.remove('hidden');
      if (revEl) revEl.textContent = (cqi.monthlyRevenue && String(cqi.monthlyRevenue).trim()) || '—';
      if (spendEl) spendEl.textContent = (cqi.marketingSpend && String(cqi.marketingSpend).trim()) || '—';
      if (notesEl) notesEl.textContent = (cqi.notes && String(cqi.notes).trim()) || '—';
      if (recEl) {
        if (cqi.recordedAt) {
          try {
            recEl.textContent = `Recorded ${new Date(cqi.recordedAt).toLocaleDateString()}`;
          } catch {
            recEl.textContent = '';
          }
        } else {
          recEl.textContent = '';
        }
      }
    } else {
      emptyEl.classList.remove('hidden');
      detailsEl.classList.add('hidden');
      if (recEl) recEl.textContent = '';
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

    const sourcePill = document.getElementById('mobilePanelSourcePill');
    if (sourcePill) {
      const src = row.dataset.source || '';
      sourcePill.classList.remove('hidden');
      if (src.startsWith('adhello_')) {
        sourcePill.textContent = 'Warm';
        sourcePill.className =
          'shrink-0 whitespace-nowrap px-3 py-1 rounded-full border text-[10px] font-black uppercase tracking-widest bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30';
      } else if (src.includes('csv') || src === 'import' || src === 'manual') {
        sourcePill.textContent = 'Imported';
        sourcePill.className =
          'shrink-0 whitespace-nowrap px-3 py-1 rounded-full border text-[10px] font-black uppercase tracking-widest bg-brand-yellow/15 text-brand-yellow border-brand-yellow/30';
      } else {
        sourcePill.textContent = 'Cold';
        sourcePill.className =
          'shrink-0 whitespace-nowrap px-3 py-1 rounded-full border text-[10px] font-black uppercase tracking-widest bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 border-brand-border/30 dark:border-white/10';
      }
    }

    syncMobilePanelCqi(row);

    // Stars & rating (larger stars in panel for visibility)
    renderStars(rating, reviews, 'mobilePanelStars', 'mobilePanelRatingText', 'w-4 h-4');

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
            const w = (website && String(website).trim()) || '';
            if (!w || w === 'N/A' || w.length < 3) {
              websiteShort.textContent = 'No website';
            } else {
              const domain = new URL(w.startsWith('http') ? w : `https://${w}`).hostname.replace('www.', '');
              websiteShort.textContent = domain && domain.length > 1 ? domain : 'No website';
            }
        } catch (e) {
            websiteShort.textContent = (website && website !== 'N/A' && String(website).length > 2) ? String(website) : 'No website';
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
                            <div class="flex items-center justify-between gap-3 mb-5">
                                <div class="flex items-center gap-3">
                                    <div class="w-8 h-8 rounded-xl bg-brand-yellow flex items-center justify-center text-brand-dark shadow-lg shadow-brand-yellow/20">
                                        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.091 3.091L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
                                    </div>
                                    <div>
                                        <h4 class="text-[10px] font-black uppercase tracking-[0.2em] text-brand-yellow mb-0.5">AdHello Audit Intelligence</h4>
                                        <p class="text-xs font-black text-brand-dark dark:text-white">External Report Data</p>
                                    </div>
                                </div>
                                ${row.dataset.auditUrl ? `
                                    <a href="${row.dataset.auditUrl}" target="_blank" class="px-4 py-2 bg-brand-yellow text-brand-dark rounded-xl text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all shadow-lg shadow-brand-yellow/20 flex items-center gap-2">
                                        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                                        Full Report
                                    </a>
                                ` : ''}
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

    // Strategy Details Section (New)
    const strategyContainer = document.getElementById('strategyDetails');
    const stratIndustry = document.getElementById('strategyIndustry');
    const stratGoal = document.getElementById('strategyGoal');
    const stratVibe = document.getElementById('strategyVibe');
    const industry = row.dataset.industry;
    const goal = row.dataset.goal;
    const vibe = row.dataset.vibe;

    if (strategyContainer) {
        if (industry || goal || vibe) {
            if (stratIndustry) stratIndustry.textContent = industry || 'Not specified';
            if (stratGoal) stratGoal.textContent = goal || 'Not specified';
            if (stratVibe) stratVibe.textContent = vibe || 'Not specified';
            strategyContainer.classList.remove('hidden');
        } else {
            strategyContainer.classList.add('hidden');
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
        headerPhone.onclick = null;
        if (phone && phone !== 'N/A') {
            const tel = `tel:${phone.replace(/\D/g, '')}`;
            headerPhone.href = tel;
            headerPhone.textContent = phone;
            headerPhone.classList.remove('opacity-40', 'pointer-events-none', 'no-underline');
            headerPhone.classList.add('underline', 'decoration-brand-yellow/30', 'decoration-2', 'underline-offset-4');
            headerPhone.onclick = () => {
              if (statusSelect) {
                statusSelect.value = 'Called Lead';
                statusSelect.dispatchEvent(new Event('change'));
              }
            };
        } else {
            headerPhone.textContent = 'No Phone Number';
            headerPhone.href = '#';
            headerPhone.classList.add('opacity-40', 'pointer-events-none', 'no-underline');
            headerPhone.classList.remove('underline', 'decoration-brand-yellow/30', 'decoration-2', 'underline-offset-4');
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

    const panelStatusSelect = document.getElementById('leadStatusSelect');
    if (panelStatusSelect) {
      let st = (row.dataset.status || '').trim() || 'Not Contacted';
      if (st === 'Needs Video') st = 'Not Contacted';
      const hasOption = Array.from(panelStatusSelect.options).some((o) => o.value === st);
      panelStatusSelect.value = hasOption ? st : 'Not Contacted';
    }

    // Loom / pitch video URL (after status select so visibility matches "Video Recorded")
    const loomInput = document.getElementById('loomUrlInput');
    if (loomInput) loomInput.value = loomUrl || '';
    syncLoomOpenLink(loomUrl);
    syncQuickPitchSectionVisibility(row);

    // Logic for Audit Insight Box in Panel (if exists)
    const auditStatus = document.getElementById('mobilePanelAuditStatus');
    const auditSummary = document.getElementById('mobilePanelAuditSummary');
    if (auditStatus && auditSummary) {
        let statusText = '';
        let statusColor = '';
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
            const website = row.dataset.website && row.dataset.website !== 'N/A';
            if (!website) gaps.push('no website');
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
        scheduleKieServiceInsight(row);
    }

    scheduleReviewIntelligence(row, { refresh: false });

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

  const renderStars = (
    rating,
    reviews,
    containerId = 'mobilePanelStars',
    textId = 'mobilePanelRatingText',
    starSizeClass = 'w-3 h-3'
  ) => {
    const starsContainer = document.getElementById(containerId);
    if (starsContainer) {
        renderStarsInElement(starsContainer, rating, starSizeClass);
    }
    const ratingText = document.getElementById(textId);
    if (ratingText) {
        const rc = reviews !== undefined && reviews !== null ? parseInt(reviews, 10) || 0 : null;
        if (rc !== null) {
          if (rating > 0) {
            ratingText.textContent = `${Number(rating).toFixed(1)} (${rc} reviews)`;
          } else if (rc > 0) {
            ratingText.textContent = `— (${rc} reviews)`;
          } else {
            ratingText.textContent = 'No rating';
          }
        } else {
          ratingText.textContent = rating > 0 ? Number(rating).toFixed(1) : 'No rating';
        }
    }
  };

  const renderStarsInElement = (element, rating, starSizeClass = 'w-3 h-3') => {
    if (!element) return;
    element.innerHTML = '';
    const r = Math.max(0, Math.min(5, Number(rating) || 0));
    const fullStars = Math.floor(r);
    const hasHalf = (r % 1) >= 0.5;

    for (let i = 0; i < 5; i++) {
      const lit = i < fullStars || (i === fullStars && hasHalf);
      const star = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      star.setAttribute(
        'class',
        `${starSizeClass} shrink-0 ${lit ? 'text-amber-400 dark:text-brand-yellow' : 'text-slate-300 dark:text-slate-600'}`
      );
      star.setAttribute('viewBox', '0 0 20 20');
      star.setAttribute('fill', 'currentColor');
      star.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute(
        'd',
        'M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z'
      );
      star.appendChild(path);
      element.appendChild(star);
    }
  };

  const applyTableStars = () => {
    document.querySelectorAll('.result-row').forEach((row) => {
      const rating = parseFloat(row.dataset.rating) || 0;
      const starContainer = row.querySelector('.row-stars');
      if (starContainer) {
        renderStarsInElement(starContainer, rating, 'w-3.5 h-3.5');
      }
    });
  };

  document.addEventListener('change', async (e) => {
    const sel = e.target.closest('.pipeline-inline-select');
    if (!sel) return;
    const row = sel.closest('.result-row');
    if (!row) return;
    const key = row.dataset.leadKey;
    if (!key) return;
    const newStage = parseInt(sel.value, 10);
    if (Number.isNaN(newStage) || newStage < 1 || newStage > 10) return;
    const prev = parseInt(row.dataset.pipelineStage, 10) || 1;
    if (newStage === prev) return;
    sel.disabled = true;
    try {
      const res = await fetch(`/leads/${encodeURIComponent(key)}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          pipelineStage: newStage,
          pipelineStageUpdatedAt: new Date().toISOString(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        row.dataset.pipelineStage = String(newStage);
        const labels = window.PIPELINE_STAGE_LABELS || {};
        const fullName = labels[newStage] || '';
        const short =
          (fullName.split('(')[0].trim().slice(0, 22)) + (fullName.length > 22 ? '…' : '');
        row.dataset.pipelineLabel = short;
        const wrap = row.querySelector('.pipeline-stage-pill-wrap');
        if (wrap) wrap.style.boxShadow = `inset 3px 0 0 hsl(${((newStage - 1) * 36) % 360}, 58%, 48%)`;
        if (typeof window.showProspectToast === 'function') window.showProspectToast('Stage updated');
        if (document.querySelector('.result-row.selected') === row) syncMobilePanelCqi(row);
      } else {
        sel.value = String(prev);
      }
    } catch {
      sel.value = String(prev);
    } finally {
      sel.disabled = false;
    }
  });

  // --- Lead Management Actions ---
  const statusSelect = document.getElementById('leadStatusSelect');
  if (statusSelect) {
    statusSelect.addEventListener('change', async () => {
      if (!currentRow) return;
      const key = currentRow.dataset.leadKey;
      const newStatus = statusSelect.value;
      const prevStatus = String(currentRow.dataset.status || '').trim() || 'Not Contacted';

      syncQuickPitchSectionVisibility(currentRow);

      if (!key) {
        currentRow.dataset.status = newStatus;
        return;
      }

      try {
        const res = await fetch(`/leads/${encodeURIComponent(key)}/update`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        });
        const data = await res.json();
        if (data.success) {
          currentRow.dataset.status = newStatus;
          if (data.lead && data.lead.updates) {
            currentRow.dataset.updates = JSON.stringify(data.lead.updates);
          }

          const statusBadge = currentRow.querySelector('td:nth-last-child(2) span') || currentRow.querySelector('span[class*="rounded-full"]');
          if (statusBadge) {
            statusBadge.textContent = newStatus;
            statusBadge.className =
              'px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-brand-yellow/10 text-brand-yellow border border-brand-yellow/20';
          }

          populatePanel(currentRow);
        } else {
          statusSelect.value = prevStatus;
          currentRow.dataset.status = prevStatus;
          syncQuickPitchSectionVisibility(currentRow);
        }
      } catch (err) {
        console.error('Status update failed:', err);
        statusSelect.value = prevStatus;
        currentRow.dataset.status = prevStatus;
        syncQuickPitchSectionVisibility(currentRow);
      }
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
    loomInput.addEventListener('input', () => {
      syncLoomOpenLink(loomInput.value.trim());
    });
    // Save on blur (when user clicks out of the input box)
    loomInput.addEventListener('blur', async () => {
      if (!currentRow) return;
      const key = currentRow.dataset.leadKey;
      const newLoomUrl = loomInput.value.trim();
      syncLoomOpenLink(newLoomUrl);

      if (!key) return;

      // Only save if it actually changed
      if (currentRow.dataset.loomUrl === newLoomUrl) return;

      try {
        const res = await fetch(`/leads/${key}/update`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ loomUrl: newLoomUrl }),
        });
        const data = await res.json();
        if (data.success) {
          currentRow.dataset.loomUrl = newLoomUrl;
          syncQuickPitchSectionVisibility(currentRow);
        }
      } catch (err) {
        console.error('Loom URL update failed:', err);
      }
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
      const loomInputEl = document.getElementById('loomUrlInput');
      const loomFromInput = loomInputEl ? loomInputEl.value.trim() : '';
      const loomFromRow = String(currentRow.dataset.loomUrl || '').trim();
      let loomLink = loomFromInput || loomFromRow;

      const statusForDraft = statusSelect ? String(statusSelect.value || '').trim() : String(currentRow.dataset.status || '').trim();
      if (statusForDraft === 'Video Recorded' && !loomLink) {
        const go = window.confirm(
          'Video Recorded is selected but there is no pitch URL yet. Continue with a draft that does not include a video link?'
        );
        if (!go) return;
      }

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

  const reviewIntelRefreshBtn = document.getElementById('reviewIntelRefreshBtn');
  if (reviewIntelRefreshBtn) {
    reviewIntelRefreshBtn.addEventListener('click', () => {
      if (!currentRow || !currentRow.dataset.leadKey) return;
      scheduleReviewIntelligence(currentRow, { refresh: true });
    });
  }

  // --- Manual Deep Enhance with Firecrawl ---
  const deepEnhanceBtn = document.getElementById('deepEnhanceBtn');
  const huntProgressWrap = document.getElementById('huntProgressWrap');
  if (deepEnhanceBtn) {
    deepEnhanceBtn.addEventListener('click', async () => {
      if (!currentRow) {
        const hint =
          '<span class="flex items-center justify-center gap-2 text-[11px] font-bold text-brand-muted normal-case tracking-normal"><svg class="w-4 h-4 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>Select a lead first</span>';
        const prev = deepEnhanceBtn.innerHTML;
        deepEnhanceBtn.innerHTML = hint;
        setTimeout(() => {
          deepEnhanceBtn.innerHTML = prev;
        }, 2200);
        return;
      }
      if (deepEnhanceBtn.getAttribute('aria-busy') === 'true') return;

      const key = currentRow.dataset.leadKey;
      const title = currentRow.dataset.title;
      const city = currentRow.dataset.city;
      const state = currentRow.dataset.state;
      const url = currentRow.dataset.website;

      const originalHTML = deepEnhanceBtn.innerHTML;

      const clearHuntBusy = () => {
        deepEnhanceBtn.disabled = false;
        deepEnhanceBtn.removeAttribute('aria-busy');
        deepEnhanceBtn.classList.remove('loading', 'animate-magic', 'cursor-wait', 'hunt-active');
        if (huntProgressWrap) huntProgressWrap.classList.add('hidden');
      };

      updateProcessingStatus(true);
      deepEnhanceBtn.disabled = true;
      deepEnhanceBtn.setAttribute('aria-busy', 'true');
      deepEnhanceBtn.classList.add('loading', 'animate-magic', 'cursor-wait', 'hunt-active');
      if (huntProgressWrap) huntProgressWrap.classList.remove('hidden');
      deepEnhanceBtn.innerHTML = `
        <svg class="deep-enhance-icon w-5 h-5 shrink-0 animate-spin text-brand-yellow" fill="none" viewBox="0 0 24 24" aria-hidden="true">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
        </svg>
        <span class="deep-enhance-label animate-pulse text-[11px] font-black uppercase tracking-wider">Searching…</span>
      `;

      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      try {
        let res;
        if (key) {
          res = await fetch(`/leads/${encodeURIComponent(key)}/enhance`, { method: 'POST' });
        } else {
          res = await fetch('/enrich', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ url, title, city, state }),
          });
        }

        const data = await res.json().catch(() => ({}));

        if (data.success) {
          const d = data.lead || data.data;
          if (data.lead && typeof data.lead === 'object') {
            syncPersistedLeadToRowDataset(currentRow, data.lead);
          } else if (d) {
            if (d.website && d.website !== 'N/A') currentRow.dataset.website = d.website;
            if (data.foundUrl) currentRow.dataset.website = data.foundUrl;
            if (d.email && d.email !== 'N/A') currentRow.dataset.email = d.email;
            if (d.facebook && d.facebook !== 'N/A') currentRow.dataset.facebook = d.facebook;
            if (d.instagram && d.instagram !== 'N/A') currentRow.dataset.instagram = d.instagram;
            if (d.twitter && d.twitter !== 'N/A') currentRow.dataset.twitter = d.twitter;
            if (d.updates) currentRow.dataset.updates = JSON.stringify(d.updates);
          }

          const keyAfter = currentRow.dataset.leadKey;
          if (keyAfter) {
            fetch(`/leads/${encodeURIComponent(keyAfter)}/insights`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
              body: JSON.stringify({ refresh: true }),
            }).catch(() => {});
          }

          populatePanel(currentRow);

          clearHuntBusy();
          deepEnhanceBtn.disabled = true;
          deepEnhanceBtn.innerHTML =
            '<span class="flex items-center justify-center gap-2 text-xs font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-400"><svg class="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>Data found</span>';
          updateProcessingStatus(false);
          setTimeout(() => {
            deepEnhanceBtn.disabled = false;
            deepEnhanceBtn.innerHTML = originalHTML;
          }, 2600);
        } else {
          alert(data.error || 'No additional contact data discovered yet.');
          updateProcessingStatus(false);
          clearHuntBusy();
          deepEnhanceBtn.innerHTML = originalHTML;
        }
      } catch (err) {
        console.error('Enhancement failed:', err);
        alert('Enhancement failed. Please try again later.');
        updateProcessingStatus(false);
        clearHuntBusy();
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

  // --- Bookmark icons in table rows (Delegated for reliability) ---
  document.addEventListener('click', async (e) => {
    const bookmarkBtn = e.target.closest('.bookmark-btn');
    if (!bookmarkBtn) return;
    
    e.stopPropagation();
    e.preventDefault();
    
    const row = bookmarkBtn.closest('.result-row');
    if (!row) return;

    const title = row.dataset.title;
    if (!title) return;
    
    const isSaved = savedLeads.has(title.trim());
    console.log(`[BOOKMARK] Action for: ${title} (Currently Saved: ${isSaved})`);

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

  window.showProspectToast = function showProspectToast(message) {
    let el = document.getElementById('prospectToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'prospectToast';
      el.setAttribute('role', 'status');
      el.className =
        'fixed bottom-28 left-1/2 z-[180] -translate-x-1/2 translate-y-3 opacity-0 pointer-events-none transition-all duration-200 ease-out px-5 py-3 rounded-2xl bg-brand-dark dark:bg-slate-900 text-white text-sm font-semibold shadow-lg shadow-black/20 dark:shadow-black/40 border border-white/15 max-w-[min(90vw,20rem)] text-center';
      document.body.appendChild(el);
    }
    el.textContent = message || 'Done';
    requestAnimationFrame(() => {
      el.classList.remove('opacity-0', 'translate-y-3', 'pointer-events-none');
    });
    clearTimeout(window.__prospectToastTimer);
    window.__prospectToastTimer = setTimeout(() => {
      el.classList.add('opacity-0', 'translate-y-3', 'pointer-events-none');
    }, 2400);
  };

  // --- Bulk Selection & Actions ---
  const selectAllLeads = document.getElementById('selectAllLeads');
  const leadCheckboxes = document.querySelectorAll('.lead-checkbox');
  const bulkActionBar = document.getElementById('bulkActionBar');
  const selectedCountCircle = document.getElementById('selectedCountCircle');
  const cancelSelectionBtn = document.getElementById('cancelSelectionBtn');
  const bulkFolderSelect = document.getElementById('bulkFolderSelect');
  const bulkMoveFolderBtn = document.getElementById('bulkMoveFolderBtn');
  const bulkFolderNewToggle = document.getElementById('bulkFolderNewToggle');
  const bulkFolderNewRow = document.getElementById('bulkFolderNewRow');
  const bulkFolderNewName = document.getElementById('bulkFolderNewName');
  const bulkFolderNewSave = document.getElementById('bulkFolderNewSave');
  const bulkFolderNewCancel = document.getElementById('bulkFolderNewCancel');

  let selectedKeys = new Set();

  const updateBulkActionBar = () => {
    const count = selectedKeys.size;
    
    // Update footer bar (common in leads.ejs and added to results.ejs)
    if (selectedCountCircle) selectedCountCircle.textContent = count;
    if (bulkActionBar) {
      if (count > 0) {
        bulkActionBar.classList.remove('opacity-0', 'translate-y-24', 'pointer-events-none');
        bulkActionBar.classList.add('opacity-100', 'translate-y-0');
        bulkActionBar.style.pointerEvents = 'auto';
      } else {
        bulkActionBar.classList.add('opacity-0', 'translate-y-24', 'pointer-events-none');
        bulkActionBar.classList.remove('opacity-100', 'translate-y-0');
        bulkActionBar.style.pointerEvents = 'none';
      }
    }

    if (bulkMoveFolderBtn) {
      bulkMoveFolderBtn.disabled = count === 0;
    }

    // Update header bar (specific to results.ejs)
    const headerBulkActions = document.getElementById('headerBulkActions');
    const headerSelectedCount = document.getElementById('headerSelectedCount');
    if (headerBulkActions) {
      if (count > 0) {
        headerBulkActions.classList.remove('hidden');
        headerBulkActions.classList.add('flex');
        if (headerSelectedCount) headerSelectedCount.textContent = count;
      } else {
        headerBulkActions.classList.add('hidden');
        headerBulkActions.classList.remove('flex');
      }
    }
  };

  function rebuildBulkFolderSelect(preferredValue) {
    if (!bulkFolderSelect) return;
    if (!Array.isArray(window.WORKSPACE_FOLDERS)) window.WORKSPACE_FOLDERS = [];
    const folders = [...window.WORKSPACE_FOLDERS].sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }),
    );
    const prev =
      preferredValue !== undefined && preferredValue !== null
        ? String(preferredValue)
        : bulkFolderSelect.value;
    bulkFolderSelect.innerHTML = '';
    const emptyOpt = document.createElement('option');
    emptyOpt.value = '';
    emptyOpt.textContent = 'No folder';
    bulkFolderSelect.appendChild(emptyOpt);
    folders.forEach((f) => {
      if (!f || !f.key) return;
      const opt = document.createElement('option');
      opt.value = f.key;
      opt.textContent = f.name || 'Folder';
      bulkFolderSelect.appendChild(opt);
    });
    const valid = prev && Array.from(bulkFolderSelect.options).some((o) => o.value === prev);
    bulkFolderSelect.value = valid ? prev : '';
  }

  const initialBulkFolderPref =
    typeof window.PROSPECTING_ACTIVE_FOLDER_KEY === 'string' && window.PROSPECTING_ACTIVE_FOLDER_KEY.trim()
      ? window.PROSPECTING_ACTIVE_FOLDER_KEY.trim()
      : undefined;
  rebuildBulkFolderSelect(initialBulkFolderPref);

  function setBulkFolderNewRowVisible(show) {
    if (!bulkFolderNewRow) return;
    if (show) {
      bulkFolderNewRow.classList.remove('hidden');
      bulkFolderNewRow.classList.add('flex');
    } else {
      bulkFolderNewRow.classList.add('hidden');
      bulkFolderNewRow.classList.remove('flex');
      if (bulkFolderNewName) bulkFolderNewName.value = '';
    }
  }

  if (bulkFolderNewToggle && bulkFolderNewRow) {
    bulkFolderNewToggle.addEventListener('click', () => {
      const isHidden = bulkFolderNewRow.classList.contains('hidden');
      if (isHidden) {
        setBulkFolderNewRowVisible(true);
        if (bulkFolderNewName) bulkFolderNewName.focus();
      } else {
        setBulkFolderNewRowVisible(false);
      }
    });
  }
  if (bulkFolderNewCancel) {
    bulkFolderNewCancel.addEventListener('click', () => setBulkFolderNewRowVisible(false));
  }
  if (bulkFolderNewName) {
    bulkFolderNewName.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') setBulkFolderNewRowVisible(false);
      if (e.key === 'Enter') {
        e.preventDefault();
        if (bulkFolderNewSave && !bulkFolderNewSave.disabled) bulkFolderNewSave.click();
      }
    });
  }
  if (bulkFolderNewSave && bulkFolderNewName) {
    bulkFolderNewSave.addEventListener('click', async () => {
      const name = String(bulkFolderNewName.value || '').trim();
      if (!name) {
        window.alert('Enter a folder name.');
        return;
      }
      bulkFolderNewSave.disabled = true;
      try {
        const res = await fetch('/folders', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ name }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success || !data.folder || !data.folder.key) {
          throw new Error((data && data.error) || `HTTP ${res.status}`);
        }
        const { key, name: folderName } = data.folder;
        if (!Array.isArray(window.WORKSPACE_FOLDERS)) window.WORKSPACE_FOLDERS = [];
        if (!window.WORKSPACE_FOLDERS.some((f) => f && f.key === key)) {
          window.WORKSPACE_FOLDERS.push({ key, name: folderName || name });
        }
        rebuildBulkFolderSelect(key);
        setBulkFolderNewRowVisible(false);
      } catch (err) {
        console.error('Create folder from bulk bar failed:', err);
        window.alert(err.message || 'Could not create folder.');
      } finally {
        bulkFolderNewSave.disabled = false;
      }
    });
  }

  if (selectAllLeads) {
    selectAllLeads.addEventListener('change', (e) => {
      const isChecked = e.target.checked;
      const allCheckboxes = document.querySelectorAll('.lead-checkbox');
      
      allCheckboxes.forEach(cb => {
        cb.checked = isChecked;
        const key = cb.dataset.key;
        if (isChecked) {
          if (key) selectedKeys.add(key);
        } else {
          if (key) selectedKeys.delete(key);
        }
      });
      updateBulkActionBar();
    });
  }

  // Delegate checkbox clicks for better reliability
  document.addEventListener('change', (e) => {
    if (e.target.classList.contains('lead-checkbox')) {
      const cb = e.target;
      const key = cb.dataset.key;
      if (cb.checked) {
        if (key) selectedKeys.add(key);
      } else {
        if (key) selectedKeys.delete(key);
        if (selectAllLeads) selectAllLeads.checked = false;
      }
      updateBulkActionBar();
    }
  });

  if (cancelSelectionBtn) {
    cancelSelectionBtn.addEventListener('click', () => {
      selectedKeys.clear();
      document.querySelectorAll('.lead-checkbox').forEach(cb => cb.checked = false);
      if (selectAllLeads) selectAllLeads.checked = false;
      updateBulkActionBar();
    });
  }

  const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
  if (bulkDeleteBtn) {
    bulkDeleteBtn.addEventListener('click', async () => {
      if (selectedKeys.size === 0) return;
      const n = selectedKeys.size;
      const msg = `Delete ${n} selected lead${n === 1 ? '' : 's'}? This cannot be undone.`;
      if (!window.confirm(msg)) return;

      const keys = [...selectedKeys];
      const closePanel = document.getElementById('closeMobilePanel');
      for (const leadKey of keys) {
        try {
          const res = await fetch(`/leads/${leadKey}/delete`, {
            method: 'POST',
            headers: { Accept: 'application/json' },
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data.success) continue;

          const cb = Array.from(document.querySelectorAll('.lead-checkbox')).find((c) => c.dataset.key === leadKey);
          const row = cb && cb.closest('.result-row');
          if (row) {
            const title = row.dataset.title ? row.dataset.title.trim() : '';
            if (row.classList.contains('selected') && closePanel) closePanel.click();
            row.remove();
            if (title) savedLeads.delete(title);
          }
          selectedKeys.delete(leadKey);
        } catch (err) {
          console.error('Bulk delete failed for', leadKey, err);
        }
      }

      if (selectAllLeads) selectAllLeads.checked = false;
      updateBulkActionBar();

      const remaining = document.querySelectorAll('.result-row').length;
      const countEl = document.querySelector('.text-brand-muted.font-medium');
      if (countEl && remaining > 0) {
        countEl.textContent = `You have ${remaining} bookmarked lead${remaining !== 1 ? 's' : ''} in your collection.`;
      }
      if (remaining === 0) {
        window.location.reload();
      }
    });
  }

  if (bulkMoveFolderBtn && bulkFolderSelect) {
    bulkMoveFolderBtn.addEventListener('click', async () => {
      if (selectedKeys.size === 0) return;
      const keys = [...selectedKeys];
      const folderKey = bulkFolderSelect.value || '';
      bulkMoveFolderBtn.disabled = true;
      try {
        const res = await fetch('/folders/assign-bulk', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ leadKeys: keys, folderKey }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
          throw new Error((data && data.error) || `HTTP ${res.status}`);
        }

        const viewingFolder =
          typeof window.PROSPECTING_ACTIVE_FOLDER_KEY === 'string'
            ? window.PROSPECTING_ACTIVE_FOLDER_KEY.trim()
            : '';
        const targetFolder = folderKey || '';
        keys.forEach((leadKey) => {
          const cb = Array.from(document.querySelectorAll('.lead-checkbox')).find((c) => c.dataset.key === leadKey);
          const row = cb && cb.closest('.result-row');
          if (!row) return;
          let remove = false;
          if (!viewingFolder) {
            if (targetFolder) remove = true;
          } else if (targetFolder !== viewingFolder) {
            remove = true;
          }
          if (remove) row.remove();
        });
        selectedKeys.clear();
        document.querySelectorAll('.lead-checkbox').forEach((cb) => { cb.checked = false; });
        if (selectAllLeads) selectAllLeads.checked = false;
        updateBulkActionBar();
      } catch (e) {
        console.error('Bulk move to folder failed:', e);
        window.alert('Could not move selected leads to that folder. Please try again.');
      } finally {
        bulkMoveFolderBtn.disabled = selectedKeys.size === 0;
      }
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

  function getBulkEnhanceLayout(row) {
    const cells = row.querySelectorAll('td');
    if (row.querySelector('.pipeline-stage-cell')) {
      const contactCell = row.querySelector('.lead-cell-contact');
      const reviewsInner = row.querySelector('.lead-reviews-inner');
      if (!contactCell || !reviewsInner) return null;
      const phone = contactCell.querySelector('.lead-contact-phone-slot');
      const email = contactCell.querySelector('.lead-contact-email-slot');
      const website = contactCell.querySelector('.lead-contact-web-slot');
      if (!phone || !email || !website) return null;
      return {
        kind: 'leads',
        addressEl: row.querySelector('.lead-row-address'),
        phone,
        email,
        website,
        reviews: reviewsInner,
      };
    }
    if (cells.length < 11) return null;
    return {
      kind: 'results',
      phone: cells[2],
      reviews: cells[4],
      opportunity: cells[5],
      website: cells[6],
      email: cells[7],
      social: cells[8],
    };
  }

  function applyEnrichDataToRowDataset(row, d, result) {
    if (!d || typeof d !== 'object') return;
    if (d.facebook) row.dataset.facebook = d.facebook;
    if (d.instagram) row.dataset.instagram = d.instagram;
    if (d.twitter) row.dataset.twitter = d.twitter;
    if (result && result.foundUrl) row.dataset.website = result.foundUrl;
    if (d.website && d.website !== 'N/A') row.dataset.website = d.website;
    const sch = d.has_schema_markup ?? d.hasSchemaMarkup;
    const chat = d.has_chatbot ?? d.hasChatbot;
    const ctc = d.has_click_to_call ?? d.hasClickToCall;
    const mob = d.is_mobile_friendly ?? d.isMobileFriendly;
    const old = d.is_outdated ?? d.isOutdated;
    const vm = d.visual_modernity_score ?? d.visualModernityScore;
    const aeo = d.aeo_score ?? d.aeoScore;
    const gg = d.geo_gaps ?? d.geoGaps;
    const cn = d.competitor_name ?? d.competitorName;
    const cg = d.competitor_gap ?? d.competitorGap;
    const au = d.audit_summary ?? d.auditSummary;
    if (sch !== undefined) row.dataset.hasSchemaMarkup = sch;
    if (chat !== undefined) row.dataset.hasChatbot = chat;
    if (ctc !== undefined) row.dataset.hasClickToCall = ctc;
    if (mob !== undefined) row.dataset.isMobileFriendly = mob;
    if (old !== undefined) row.dataset.isOutdated = old;
    if (vm !== undefined) row.dataset.visualModernityScore = vm;
    if (aeo !== undefined) row.dataset.aeoScore = aeo;
    if (gg !== undefined) row.dataset.geoGaps = gg;
    if (cn !== undefined) row.dataset.competitorName = cn;
    if (cg !== undefined) row.dataset.competitorGap = cg;
    if (au !== undefined) row.dataset.auditSummary = au;
    const cmsPl = d.cms_platform ?? d.cmsPlatform;
    if (cmsPl !== undefined && cmsPl !== null) row.dataset.cmsPlatform = cmsPl;
    if (d.email) row.dataset.email = d.email;
    if (d.phone !== undefined && d.phone !== null) row.dataset.phone = d.phone || 'N/A';
    const ratingVal = d.totalScore ?? d.total_score ?? d.rating;
    const revVal = d.reviewsCount ?? d.reviews_count ?? d.reviews;
    if (ratingVal !== undefined && ratingVal !== null && !Number.isNaN(parseFloat(ratingVal))) {
      row.dataset.rating = String(ratingVal);
    }
    if (revVal !== undefined && revVal !== null && !Number.isNaN(parseInt(revVal, 10))) {
      row.dataset.reviews = String(parseInt(revVal, 10));
    }
    if (d.updates) row.dataset.updates = JSON.stringify(d.updates);
    if (d.address !== undefined && d.address !== null && String(d.address).trim()) {
      row.dataset.address = d.address || 'N/A';
    }
  }

  function renderLeadsTableAddressCell(addr) {
    const a = addr && addr !== 'N/A' ? String(addr).trim() : '';
    if (!a) {
      return '<span class="text-brand-muted/50 dark:text-slate-500 text-sm font-bold">—</span>';
    }
    const safe = escapeHtmlAttr(a);
    return `<span class="block text-xs font-medium text-brand-muted dark:text-slate-300 max-w-[200px] truncate" title="${safe}">${escapeHtmlText(a)}</span>`;
  }

  function renderLeadsTableWebsiteCell(w) {
    if (!w || w === 'N/A') {
      return '<span class="text-brand-muted/50 dark:text-slate-500 font-bold text-sm">-</span>';
    }
    const href = w.startsWith('http') ? w : `https://${w}`;
    const label = w.replace(/^https?:\/\//, '').split('?')[0].replace(/\/$/, '');
    return `<a href="${href}" target="_blank" class="website-link text-brand-muted dark:text-slate-300 hover:text-brand-dark dark:hover:text-white transition-colors border-b border-transparent hover:border-brand-dark dark:hover:border-white pb-0.5 inline-block max-w-[150px] truncate" title="${w}" data-url="${w}">${label}</a>`;
  }

  function renderLeadsTablePhoneCell(phone) {
    const p = phone && phone !== 'N/A' ? phone : '';
    if (p) {
      return `<span class="block text-sm font-medium text-brand-muted dark:text-slate-300">${p}</span>`;
    }
    return '<span class="block text-sm text-brand-muted/60">-</span>';
  }

  function setLeadPhoneSlot(el, phone) {
    if (!el) return;
    const p = phone && phone !== 'N/A' ? String(phone).trim() : '';
    el.textContent = p || '—';
    if (p) el.setAttribute('title', p);
    else el.removeAttribute('title');
  }

  function renderLeadEmailSlotInner(email) {
    const e = email && email !== 'N/A' ? String(email).trim() : '';
    if (!e) {
      return '<span class="text-xs font-semibold text-brand-muted/60 dark:text-slate-500">—</span>';
    }
    return `<a href="mailto:${encodeURIComponent(e)}" class="text-brand-yellow hover:underline font-bold text-xs truncate block max-w-[200px]" title="${escapeHtmlAttr(e)}" onclick="event.stopPropagation()">${escapeHtmlText(e)}</a>`;
  }

  function renderLeadWebSlotInner(website) {
    if (!website || website === 'N/A') {
      return '<span class="text-xs font-semibold text-brand-muted/60 dark:text-slate-500">—</span>';
    }
    const w = String(website).trim();
    const href = w.startsWith('http') ? w : `https://${w}`;
    const label = w.replace(/^https?:\/\//i, '').split('?')[0].replace(/\/$/, '');
    const disp = label.length > 36 ? `${label.slice(0, 36)}…` : label;
    return `<a href="${escapeHtmlAttr(href)}" target="_blank" rel="noopener noreferrer" class="website-link text-xs font-semibold text-brand-dark dark:text-slate-300 hover:text-brand-yellow truncate block border-b border-transparent hover:border-brand-yellow/50 max-w-[200px]" title="${escapeHtmlAttr(w)}" data-url="${escapeHtmlAttr(w)}">${escapeHtmlText(disp)}</a>`;
  }

  function renderLeadsReviewsInnerHtml(rating, reviews) {
    const r = parseFloat(rating) || 0;
    const c = parseInt(reviews, 10) || 0;
    if (r > 0) {
      return `<span class="lead-reviews-line text-sm font-bold tabular-nums text-brand-dark dark:text-slate-100" title="${r.toFixed(1)} stars, ${c} reviews"><span class="text-brand-yellow" aria-hidden="true">★</span> ${r.toFixed(1)} <span class="text-brand-muted dark:text-slate-400 font-semibold">(${c})</span></span>`;
    }
    if (c > 0) {
      return `<span class="text-xs font-semibold text-brand-muted dark:text-slate-400 tabular-nums" title="${c} reviews">— <span class="text-brand-dark dark:text-slate-200">(${c})</span></span>`;
    }
    return '<span class="text-sm font-semibold text-brand-muted/60 dark:text-slate-500">—</span>';
  }

  function renderLeadsTableEmailCell(email) {
    const e = email && email !== 'N/A' ? String(email).trim() : '';
    if (!e) {
      return '<span class="text-brand-muted/50 dark:text-slate-500 font-bold">—</span>';
    }
    return `<a href="mailto:${encodeURIComponent(e)}" class="text-brand-yellow hover:underline font-bold truncate block max-w-[180px]" title="${escapeHtmlAttr(e)}" onclick="event.stopPropagation()">${escapeHtmlText(e)}</a>`;
  }

  function renderReviewsCellInner(rating, reviews) {
    const r = parseFloat(rating) || 0;
    const c = parseInt(reviews, 10) || 0;
    let metaHtml;
    if (r > 0) {
      metaHtml = `<div class="flex flex-col gap-0.5">
        <span class="text-xs font-black tabular-nums text-brand-dark dark:text-slate-100 leading-none">${r.toFixed(1)}</span>
        <span class="text-[10px] font-bold text-brand-muted dark:text-slate-400 leading-snug">${c} reviews</span>
      </div>`;
    } else {
      metaHtml = `<div class="flex flex-col gap-0.5">
        <span class="text-sm font-bold text-brand-muted/50 dark:text-slate-500 leading-none">—</span>
        ${
          c > 0
            ? `<span class="text-[10px] font-bold text-brand-muted/60 dark:text-slate-500 leading-snug">${c} reviews</span>`
            : ''
        }
      </div>`;
    }
    return `<div class="flex flex-col items-start gap-1 min-w-[4.5rem]">
      <div class="row-stars flex items-center gap-0.5 shrink-0" aria-hidden="true"></div>
      ${metaHtml}
    </div>`;
  }

  const enhanceLoadingHtml =
    '<span class="flex items-center gap-2 justify-center"><svg class="animate-spin h-3.5 w-3.5 text-brand-yellow" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg><span class="text-[10px] font-black uppercase tracking-widest">Enhancing…</span></span>';

  // Bulk Enhance (Firecrawl) — `.js-bulk-enhance` on /leads attaches to both header + floating bar (no duplicate ids)
  document.querySelectorAll('.js-bulk-enhance').forEach((bulkEnhanceBtn) => {
    bulkEnhanceBtn.addEventListener('click', async () => {
      const checkedBoxes = document.querySelectorAll('.row-checkbox:checked, .lead-checkbox:checked');
      if (checkedBoxes.length === 0) return;

      const selectedRows = Array.from(checkedBoxes).map((cb) => cb.closest('.result-row')).filter(Boolean);

      const enhanceBtns = document.querySelectorAll('.js-bulk-enhance');
      const enhanceBtnOriginalHtml = Array.from(enhanceBtns).map((b) => b.innerHTML);
      updateProcessingStatus(true);
      enhanceBtns.forEach((b) => {
        b.disabled = true;
        b.classList.add('loading', 'animate-magic');
        b.innerHTML = enhanceLoadingHtml;
      });

      const leadsToProcess = selectedRows.slice(0, 20);
      if (selectedRows.length > 20) console.warn('Bulk audit limited to first 20 selected leads.');

      const spinner = '<span class="text-[9px] font-bold text-brand-yellow uppercase tracking-widest animate-pulse">Scanning…</span>';
      let successCount = 0;
      let attemptedCount = 0;
      let lastError = '';

      for (const row of leadsToProcess) {
        const layout = getBulkEnhanceLayout(row);
        if (!layout) continue;

        const key = row.dataset.leadKey;
        let url = row.dataset.website;
        const title = row.dataset.title;
        const city = row.dataset.city;
        const state = row.dataset.state;

        if (!key && (!url || url === 'N/A') && (!title || !city)) continue;

        attemptedCount += 1;
        const cellOriginals = {};
        if (layout.kind === 'leads') {
          if (layout.addressEl) cellOriginals.address = layout.addressEl.innerHTML;
          cellOriginals.phone = layout.phone.innerHTML;
          cellOriginals.email = layout.email.innerHTML;
          cellOriginals.website = layout.website.innerHTML;
          cellOriginals.reviews = layout.reviews.innerHTML;
          if (layout.addressEl) layout.addressEl.innerHTML = spinner;
          layout.phone.innerHTML = spinner;
          layout.email.innerHTML = spinner;
          layout.website.innerHTML = spinner;
        } else {
          cellOriginals.email = layout.email.innerHTML;
          cellOriginals.social = layout.social.innerHTML;
          layout.social.innerHTML = `<div class="flex items-center gap-2 text-brand-muted">${spinner}</div>`;
          if (!row.dataset.email || row.dataset.email === 'N/A') layout.email.innerHTML = spinner;
        }

        try {
          let res;
          if (key) {
            res = await fetch(`/leads/${encodeURIComponent(key)}/enhance`, { method: 'POST' });
          } else {
            res = await fetch('/enrich', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url, title, city, state }),
            });
          }

          const result = await res.json().catch(() => ({}));
          const d = result.lead || result.data;
          if (result.error) lastError = String(result.error);

          if (res.ok && result.success && d) {
            successCount += 1;
            applyEnrichDataToRowDataset(row, d, result);

            if (layout.kind === 'leads') {
              if (layout.addressEl) {
                layout.addressEl.innerHTML = renderLeadsTableAddressCell(row.dataset.address);
              }
              setLeadPhoneSlot(layout.phone, row.dataset.phone);
              layout.email.innerHTML = renderLeadEmailSlotInner(row.dataset.email);
              layout.website.innerHTML = renderLeadWebSlotInner(row.dataset.website);
              layout.reviews.innerHTML = renderLeadsReviewsInnerHtml(row.dataset.rating, row.dataset.reviews);
              const intelBtn = row.querySelector('.email-intel-btn');
              if (intelBtn) {
                intelBtn.dataset.email = row.dataset.email && row.dataset.email !== 'N/A' ? row.dataset.email : '';
              }
            } else {
              if (row.dataset.email && row.dataset.email !== 'N/A') {
                layout.email.innerHTML = `<a href="mailto:${row.dataset.email}" class="font-bold text-brand-dark hover:text-brand-yellow transition-colors truncate max-w-[120px] inline-block" title="${row.dataset.email}">${row.dataset.email}</a>`;
              } else {
                layout.email.innerHTML = cellOriginals.email;
              }
              let socialsHtml = '<div class="flex items-center justify-center gap-2.5">';
              if (row.dataset.facebook && row.dataset.facebook !== 'N/A') {
                socialsHtml += `<a href="${row.dataset.facebook}" target="_blank" class="w-4 h-4 text-brand-muted hover:text-[#1877F2] transition-colors" title="Facebook"><svg fill="currentColor" viewBox="0 0 24 24"><path d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.991 22 12z" /></svg></a>`;
              }
              if (row.dataset.instagram && row.dataset.instagram !== 'N/A') {
                socialsHtml += `<a href="${row.dataset.instagram}" target="_blank" class="w-4 h-4 text-brand-muted hover:text-[#E4405F] transition-colors" title="Instagram"><svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M7.75 2h8.5A5.75 5.75 0 0122 7.75v8.5A5.75 5.75 0 0116.25 22h-8.5A5.75 5.75 0 012 16.25v-8.5A5.75 5.75 0 017.75 2z" /><path stroke-linecap="round" stroke-linejoin="round" d="M16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37z" /><path stroke-linecap="round" stroke-linejoin="round" d="M17.5 6.5h.01" /></svg></a>`;
              }
              socialsHtml += '</div>';
              layout.social.innerHTML = socialsHtml;
              if (layout.website) {
                const w = row.dataset.website;
                layout.website.innerHTML = w && w !== 'N/A'
                  ? `<a href="${w.startsWith('http') ? w : 'https://' + w}" target="_blank" class="website-link hover:text-brand-dark transition-colors border-b border-transparent hover:border-brand-dark pb-0.5 inline-block max-w-[150px] truncate" title="${w}">${w.replace(/^https?:\/\//, '').split('?')[0].replace(/\/$/, '')}</a>`
                  : '-';
              }
              if (layout.phone && row.dataset.phone) {
                layout.phone.textContent = row.dataset.phone && row.dataset.phone !== 'N/A' ? row.dataset.phone : '-';
              }
              if (layout.reviews) {
                layout.reviews.innerHTML = renderReviewsCellInner(row.dataset.rating, row.dataset.reviews);
                const starEl2 = layout.reviews.querySelector('.row-stars');
                if (starEl2) renderStarsInElement(starEl2, parseFloat(row.dataset.rating) || 0);
              }
            }

            const selectedPanelRow = document.querySelector('.result-row.selected');
            if (selectedPanelRow === row && typeof populatePanel === 'function') populatePanel(row);
          } else {
            if (layout.kind === 'leads') {
              if (layout.addressEl && cellOriginals.address !== undefined) {
                layout.addressEl.innerHTML = cellOriginals.address;
              }
              layout.phone.innerHTML = cellOriginals.phone;
              layout.email.innerHTML = cellOriginals.email;
              layout.website.innerHTML = cellOriginals.website;
              layout.reviews.innerHTML = cellOriginals.reviews;
            } else {
              layout.email.innerHTML = cellOriginals.email;
              layout.social.innerHTML = cellOriginals.social;
            }
          }
        } catch (err) {
          console.error('Enrichment error:', err);
          if (layout.kind === 'leads') {
            if (layout.addressEl && cellOriginals.address !== undefined) {
              layout.addressEl.innerHTML = cellOriginals.address;
            }
            layout.phone.innerHTML = cellOriginals.phone;
            layout.email.innerHTML = cellOriginals.email;
            layout.website.innerHTML = cellOriginals.website;
            layout.reviews.innerHTML = cellOriginals.reviews;
          } else {
            layout.email.innerHTML = cellOriginals.email;
            layout.social.innerHTML = cellOriginals.social;
          }
        }
      }

      updateProcessingStatus(false);
      const summaryLabel =
        successCount > 0
          ? `✨ Updated ${successCount} lead${successCount !== 1 ? 's' : ''}`
          : attemptedCount > 0
            ? 'No new data (check API / console)'
            : '✨ Done';
      enhanceBtns.forEach((b) => {
        b.innerHTML = `<span class="text-[10px] font-black uppercase tracking-widest">${summaryLabel}</span>`;
      });
      if (attemptedCount > 0 && successCount === 0) {
        window.alert(
          lastError
            ? `Enhance finished but no rows were updated.\n\n${lastError}`
            : 'Enhance finished but Firecrawl returned no new fields. Confirm FIRECRAWL_API_KEY and check server logs.'
        );
      }
      updateOpportunityBadges();
      sortLeadsByOpportunity(false);
      applyTableStars();

      setTimeout(() => {
        enhanceBtns.forEach((b, i) => {
          b.classList.remove('loading', 'animate-magic');
          b.disabled = false;
          b.innerHTML = enhanceBtnOriginalHtml[i] || b.innerHTML;
        });
      }, 2800);
    });
  });

  // --- Website Preview Hover Logic Removed ---


  // --- Kanban View & Batch Outreach Logic ---
  
  // View Toggle Logic
  const showTableViewBtn = document.getElementById('showTableView');
  const showKanbanViewBtn = document.getElementById('showKanbanView');
  const tableView = document.getElementById('tableView');
  const kanbanView = document.getElementById('kanbanView');

  if (showTableViewBtn && showKanbanViewBtn) {
    const segActive = ['bg-brand-yellow', 'text-brand-dark', 'shadow-sm'];
    const segInactive = ['text-brand-muted', 'dark:text-slate-400'];
    showTableViewBtn.addEventListener('click', () => {
        tableView.classList.remove('hidden');
        kanbanView.classList.add('hidden');
        showTableViewBtn.classList.add(...segActive);
        showTableViewBtn.classList.remove(...segInactive);
        showKanbanViewBtn.classList.remove(...segActive);
        showKanbanViewBtn.classList.add(...segInactive);
    });

    showKanbanViewBtn.addEventListener('click', () => {
        tableView.classList.add('hidden');
        kanbanView.classList.remove('hidden');
        showKanbanViewBtn.classList.add(...segActive);
        showKanbanViewBtn.classList.remove(...segInactive);
        showTableViewBtn.classList.remove(...segActive);
        showTableViewBtn.classList.add(...segInactive);
        initKanban();
    });
  }

  // Initialize Kanban / pipeline boards (Saved Leads uses 10-stage pipeline; Inbound uses legacy status columns)
  function initKanban() {
    const columns = document.querySelectorAll('.kanban-list');
    const allRows = document.querySelectorAll('.result-row');
    const pipelineMode = kanbanView && kanbanView.dataset && kanbanView.dataset.kanbanMode === 'pipeline';

    columns.forEach((col) => {
        if (typeof Sortable !== 'undefined' && typeof Sortable.get === 'function') {
          const existing = Sortable.get(col);
          if (existing && typeof existing.destroy === 'function') existing.destroy();
        }
        col.innerHTML = '';
        const columnWrap = col.parentElement;
        const targetStatus = columnWrap.dataset.status;
        const targetPipeline = pipelineMode
          ? parseInt(columnWrap.dataset.pipelineStage, 10)
          : NaN;
        let count = 0;

        allRows.forEach((row) => {
            let shouldInclude = false;
            if (pipelineMode && !Number.isNaN(targetPipeline)) {
              let ps = parseInt(row.dataset.pipelineStage, 10);
              if (Number.isNaN(ps) || ps < 1 || ps > 10) ps = 1;
              shouldInclude = ps === targetPipeline;
            } else {
              const leadStatus = row.dataset.status || 'Not Contacted';
              if (targetStatus === 'Not Contacted' && (leadStatus === 'Not Contacted' || leadStatus === 'Needs Video')) shouldInclude = true;
              if (targetStatus === 'Enriched' && leadStatus === 'Enriched') shouldInclude = true;
              if (targetStatus === 'Lead Captured' && leadStatus === 'Lead Captured') shouldInclude = true;
              if (targetStatus === 'Blueprint Purchased' && leadStatus === 'Blueprint Purchased') shouldInclude = true;
              if (targetStatus === 'Action Ongoing' && ['Video Recorded', 'Called Lead', 'Email Sent', 'Follow-up'].includes(leadStatus)) shouldInclude = true;
              if (targetStatus === 'Finished' && ['Closed - Won', 'Closed - Lost'].includes(leadStatus)) shouldInclude = true;
            }

            if (shouldInclude) {
                const card = createKanbanCard(row);
                col.appendChild(card);
                count += 1;
            }
        });
        const countBadge = columnWrap.querySelector('.column-count');
        if (countBadge) countBadge.textContent = count;

        if (typeof Sortable !== 'undefined') {
            Sortable.create(col, {
                group: 'leads',
                animation: 150,
                ghostClass: 'opacity-50',
                onEnd: async (evt) => {
                    const item = evt.item;
                    const toCol = evt.to.parentElement;
                    const leadKey = item.dataset.leadKey;
                    if (!leadKey) return;

                    if (pipelineMode) {
                        const newStage = parseInt(toCol.dataset.pipelineStage, 10);
                        if (Number.isNaN(newStage) || newStage < 1 || newStage > 10) return;
                        try {
                            const res = await fetch(`/leads/${leadKey}/update`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                                body: JSON.stringify({
                                  pipelineStage: newStage,
                                  pipelineStageUpdatedAt: new Date().toISOString(),
                                }),
                            });
                            const data = await res.json();
                            if (data.success) {
                                const originalRow = document.querySelector(`.result-row[data-lead-key="${leadKey}"]`);
                                if (originalRow) {
                                    originalRow.dataset.pipelineStage = String(newStage);
                                    const labels = window.PIPELINE_STAGE_LABELS || {};
                                    const fullName = labels[newStage] || '';
                                    const short = (fullName.split('(')[0].trim().slice(0, 22)) + (fullName.length > 22 ? '…' : '');
                                    originalRow.dataset.pipelineLabel = short;
                                    const pipeSel = originalRow.querySelector('.pipeline-inline-select');
                                    if (pipeSel) pipeSel.value = String(newStage);
                                    const cell = originalRow.querySelector('.pipeline-stage-label');
                                    if (cell) cell.textContent = `${newStage}. ${short || 'Stage'}`;
                                    const wrap = originalRow.querySelector('.pipeline-stage-pill-wrap');
                                    if (wrap) wrap.style.boxShadow = `inset 3px 0 0 hsl(${((newStage - 1) * 36) % 360}, 58%, 48%)`;
                                }
                                updateColumnCounts();
                                if (typeof window.showProspectToast === 'function') {
                                  window.showProspectToast('Stage updated');
                                }
                            }
                        } catch (err) { console.error('Failed to update pipeline:', err); }
                        return;
                    }

                    const targetColStatus = toCol.dataset.status;
                    let newStatus = targetColStatus;
                    if (targetColStatus === 'Action Ongoing') newStatus = 'Follow-up';
                    if (targetColStatus === 'Finished') newStatus = 'Closed - Won';

                    try {
                        const res = await fetch(`/leads/${leadKey}/update`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ status: newStatus }),
                        });
                        const data = await res.json();
                        if (data.success) {
                            const originalRow = document.querySelector(`.result-row[data-lead-key="${leadKey}"]`);
                            if (originalRow) {
                                originalRow.dataset.status = newStatus;
                                const statusBadge = originalRow.querySelector('td:nth-last-child(2) span');
                                if (statusBadge) statusBadge.textContent = newStatus;
                            }
                            updateColumnCounts();
                        }
                    } catch (err) { console.error('Failed to update status:', err); }
                },
            });
        }
    });
  }

  function createKanbanCard(row) {
    const card = document.createElement('div');
    card.className =
      'kanban-card kanban-card--lift p-4 bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-brand-border/10 cursor-grab active:cursor-grabbing hover:border-brand-yellow/50 transition-all duration-150 group';
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
  const batchOutreachBtnBulk = document.getElementById('batchOutreachBtnBulk');
  const warRoomModal = document.getElementById('warRoomModal');
  const closeWarRoom = document.getElementById('closeWarRoom');
  const warRoomGrid = document.getElementById('warRoomGrid');
  const warRoomTotal = document.getElementById('warRoomTotal');

  function openWarRoomFromSelection() {
    if (!warRoomModal) return;
    const selected = document.querySelectorAll('.result-row .lead-checkbox:checked');
    if (selected.length === 0) {
      alert('Please select at least one lead for the War Room.');
      return;
    }
    renderWarRoom(selected);
    warRoomModal.classList.remove('hidden');
  }

  if (warRoomModal) {
    if (batchOutreachBtn) batchOutreachBtn.addEventListener('click', openWarRoomFromSelection);
    if (batchOutreachBtnBulk) batchOutreachBtnBulk.addEventListener('click', openWarRoomFromSelection);
    if (closeWarRoom) {
      closeWarRoom.addEventListener('click', () => {
        warRoomModal.classList.add('hidden');
      });
    }
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

  (function initLeadTableDensity() {
    const table = document.getElementById('prospectLeadsTable');
    if (!table) return;
    const key = 'prospectLeadTableDensity';
    const saved = localStorage.getItem(key) === 'compact' ? 'compact' : 'comfortable';
    function apply(mode) {
      const d = mode === 'compact' ? 'compact' : 'comfortable';
      table.classList.remove('prospect-leads-table--comfortable', 'prospect-leads-table--compact');
      table.classList.add(d === 'compact' ? 'prospect-leads-table--compact' : 'prospect-leads-table--comfortable');
      document.querySelectorAll('.lead-density-btn').forEach((btn) => {
        const on = (btn.dataset.density || 'comfortable') === d;
        btn.classList.toggle('lead-density-btn--active', on);
      });
      try {
        localStorage.setItem(key, d);
      } catch (_) {
        /* ignore */
      }
    }
    apply(saved);
    document.querySelectorAll('.lead-density-btn').forEach((btn) => {
      btn.addEventListener('click', () => apply(btn.dataset.density || 'comfortable'));
    });
  })();
});
