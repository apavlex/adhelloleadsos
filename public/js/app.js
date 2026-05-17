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

  /** AI website audit score on the row: 1–10 gap (new), or legacy 11–100 “health” saved before the scale fix. */
  const getAiAuditGap10FromDataset = (lead) => {
    const raw = lead && lead.aiScore != null ? Number(lead.aiScore) : NaN;
    if (!Number.isFinite(raw) || raw <= 0) return null;
    if (raw > 10) return Math.min(10, Math.max(0, Math.round((100 - raw) / 10)));
    return Math.min(10, Math.max(0, raw));
  };

  const getUnifiedClientScore = (lead) => {
    const aiGap = getAiAuditGap10FromDataset(lead);
    if (aiGap != null) return aiGap;
    return calculateOpportunityScore(lead || {});
  };

  const renderOpportunityBadges = (row) => {
    const l = row.dataset;
    const score = getUnifiedClientScore(l);
    const label = `${Math.round(score)}/10`;
    let scoreColor = 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800/50 dark:text-slate-400 dark:border-white/5';

    if (score >= 7) {
        scoreColor = 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20';
    } else if (score >= 4) {
        scoreColor = 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-brand-yellow/10 dark:text-brand-yellow dark:border-brand-yellow/20';
    }

    return `<div class="flex items-center justify-center"><span class="px-2 py-0.5 rounded-md ${scoreColor} text-[9px] font-black border tabular-nums tracking-tight shadow-sm">${label}</span></div>`;
  };

  const updateOpportunityBadges = () => {
    document.querySelectorAll('.result-row').forEach((row) => {
      try {
        const badgeContainer = row.querySelector('.opportunity-badge');
        if (badgeContainer) {
          badgeContainer.innerHTML = renderOpportunityBadges(row);
          badgeContainer.dataset.score = getUnifiedClientScore(row.dataset);
        }
        const sigEl = row.querySelector('.lead-owner-signal');
        if (sigEl) {
          sigEl.textContent = String(row.dataset.ownerSignal || '').trim();
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
  
  const getProspectTableBody = () => document.querySelector('#prospectLeadsTable tbody');

  const sortLeadsByOpportunity = (isAscending) => {
    const tableBody = getProspectTableBody() || document.querySelector('tbody');
    if (!tableBody) return;
    const rows = Array.from(tableBody.querySelectorAll('.result-row'));

    rows.sort((a, b) => {
      const scoreA = getUnifiedClientScore(a.dataset);
      const scoreB = getUnifiedClientScore(b.dataset);
      return isAscending ? scoreA - scoreB : scoreB - scoreA;
    });

    rows.forEach((row) => tableBody.appendChild(row));
  };

  /** Prospect table: count phone + email + website present (not N/A). */
  const prospectContactCompleteness = (ds) => {
    let n = 0;
    if (ds.phone && ds.phone !== 'N/A') n += 1;
    if (ds.email && ds.email !== 'N/A') n += 1;
    if (ds.website && ds.website !== 'N/A') n += 1;
    return n;
  };

  const prospectSortDefaultDesc = (key) =>
    key === 'contact' ||
    key === 'reviews' ||
    key === 'actions' ||
    key === 'added' ||
    key === 'lasttouch';

  let prospectSortState = { key: null, desc: true };

  const updateProspectSortHeaderUi = (activeKey, desc) => {
    document.querySelectorAll('[data-prospect-sort]').forEach((btn) => {
      const k = btn.getAttribute('data-prospect-sort');
      const active = activeKey != null && k === activeKey;
      btn.classList.toggle('prospect-sort-btn--active', active);
      btn.removeAttribute('aria-sort');
      const ind = btn.querySelector('.prospect-sort-indicator');
      if (ind) ind.textContent = '';
      if (active) {
        btn.setAttribute('aria-sort', desc ? 'descending' : 'ascending');
        if (ind) ind.textContent = desc ? '↓' : '↑';
      }
    });
  };

  const sortProspectTableBy = (columnKey, descending) => {
    const tableBody = getProspectTableBody();
    if (!tableBody) return;
    const rows = Array.from(tableBody.querySelectorAll('.result-row'));
    const mult = descending ? -1 : 1;
    const cmpStr = (x, y) => String(x || '').localeCompare(String(y || ''), undefined, { sensitivity: 'base' });

    rows.sort((ra, rb) => {
      const a = ra.dataset;
      const b = rb.dataset;
      let c = 0;
      switch (columnKey) {
        case 'company':
          c = cmpStr((a.title || '').trim(), (b.title || '').trim());
          break;
        case 'category':
          c = cmpStr((a.category || '').trim(), (b.category || '').trim());
          if (c === 0) c = cmpStr(a.title || '', b.title || '');
          break;
        case 'added': {
          const ta = parseInt(a.createdSort, 10) || 0;
          const tb = parseInt(b.createdSort, 10) || 0;
          c = ta - tb;
          if (c === 0) c = cmpStr(a.title || '', b.title || '');
          break;
        }
        case 'lasttouch': {
          const ta = parseInt(a.lastTouchMs, 10) || 0;
          const tb = parseInt(b.lastTouchMs, 10) || 0;
          c = ta - tb;
          if (c === 0) c = cmpStr(a.title || '', b.title || '');
          break;
        }
        case 'cadence': {
          c = cmpStr((a.cadenceSort || a.lastTouchChannel || '').trim(), (b.cadenceSort || b.lastTouchChannel || '').trim());
          if (c === 0) c = cmpStr(a.title || '', b.title || '');
          break;
        }
        case 'pipeline': {
          const na = parseInt(a.pipelineStage, 10) || 0;
          const nb = parseInt(b.pipelineStage, 10) || 0;
          c = na - nb;
          if (c === 0) c = cmpStr(a.title || '', b.title || '');
          break;
        }
        case 'contact': {
          const ca = prospectContactCompleteness(a);
          const cb = prospectContactCompleteness(b);
          c = ca - cb;
          if (c === 0) c = cmpStr(a.title || '', b.title || '');
          break;
        }
        case 'reviews': {
          const raa = parseFloat(a.rating || 0) || 0;
          const rbb = parseFloat(b.rating || 0) || 0;
          c = raa - rbb;
          if (c === 0) {
            const nca = parseInt(a.reviews || 0, 10) || 0;
            const ncb = parseInt(b.reviews || 0, 10) || 0;
            c = nca - ncb;
          }
          if (c === 0) c = cmpStr(a.title || '', b.title || '');
          break;
        }
        case 'status':
          c = cmpStr((a.status || '').trim(), (b.status || '').trim());
          break;
        case 'actions':
          c = getUnifiedClientScore(a) - getUnifiedClientScore(b);
          if (c === 0) c = cmpStr(a.title || '', b.title || '');
          break;
        default:
          return 0;
      }
      return mult * c;
    });

    rows.forEach((row) => tableBody.appendChild(row));
    updateProspectSortHeaderUi(columnKey, descending);
  };

  const prospectTable = document.getElementById('prospectLeadsTable');
  if (prospectTable) {
    document.querySelectorAll('#prospectLeadsTable [data-prospect-sort]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const key = btn.getAttribute('data-prospect-sort');
        if (!key) return;
        if (prospectSortState.key === key) prospectSortState.desc = !prospectSortState.desc;
        else {
          prospectSortState.key = key;
          prospectSortState.desc = prospectSortDefaultDesc(key);
        }
        sortProspectTableBy(key, prospectSortState.desc);
      });
    });
  }

  // Auto-sort by High Opportunity immediately after calculation
  sortLeadsByOpportunity(false);

  // Attach Sort Listener
  const sortOppBtn = document.getElementById('sortOpportunity');
  if (sortOppBtn) {
    let asc = false;
    sortOppBtn.addEventListener('click', () => {
      asc = !asc;
      prospectSortState = { key: null, desc: true };
      updateProspectSortHeaderUi(null, true);
      sortLeadsByOpportunity(asc);
      const svg = sortOppBtn.querySelector('svg');
      if (svg) svg.style.transform = asc ? 'rotate(180deg)' : 'rotate(0deg)';
      sortOppBtn.classList.add('text-brand-dark');
    });
  }

  function collectLeadDatasetsForBulkExport() {
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
    return leadsToExport;
  }

  function buildLeadsCsvFromDatasets(leadsToExport) {
    const headers = [
      'Company',
      'Category',
      'Phone',
      'Website',
      'Email',
      'Address',
      'Rating',
      'Reviews',
      'Claim status',
      'GBP optimization score',
      'Signal',
      'Facebook',
      'Instagram',
      'Twitter',
      'Opportunity (unified /10)',
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
      `"${String(l.gbpClaimStatus || '').replace(/"/g, '""')}"`,
      `"${String(l.gbpOptimizationScore || '').replace(/"/g, '""')}"`,
      `"${(l.ownerSignal || '').replace(/"/g, '""')}"`,
      `"${l.facebook}"`,
      `"${l.instagram}"`,
      `"${l.twitter}"`,
      getUnifiedClientScore(l),
    ]);
    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }

  function defaultLeadsExportFilename() {
    return `AdHello_Leads_${new Date().toISOString().split('T')[0]}.csv`;
  }

  // Export CSV — all `.js-bulk-export-csv` buttons (avoids duplicate id on /leads floating bar vs header bar)
  document.querySelectorAll('.js-bulk-export-csv').forEach((exportBtn) => {
    exportBtn.addEventListener('click', (e) => {
      if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
      const leadsToExport = collectLeadDatasetsForBulkExport();
      if (leadsToExport.length === 0) return alert('No leads found to export.');
      const csvContent = buildLeadsCsvFromDatasets(leadsToExport);
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.setAttribute('download', defaultLeadsExportFilename());
      link.click();
    });
  });

  // Save list to Google Drive (Pipeline — requires Connect Google Drive)
  document.querySelectorAll('.js-bulk-save-drive').forEach((saveBtn) => {
    saveBtn.addEventListener('click', (e) => {
      if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
      const leadsToExport = collectLeadDatasetsForBulkExport();
      if (leadsToExport.length === 0) return alert('No leads found to save.');
      const csvContent = buildLeadsCsvFromDatasets(leadsToExport);
      const filename = defaultLeadsExportFilename();
      saveBtn.disabled = true;
      saveBtn.setAttribute('aria-busy', 'true');
      const fetchJsonFn = typeof window.fetchJson === 'function' ? window.fetchJson : null;
      const uploadReq = fetchJsonFn
        ? fetchJsonFn('/leads/google-drive/upload-csv', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ csv: csvContent, filename }),
          })
        : fetch('/leads/google-drive/upload-csv', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ csv: csvContent, filename }),
          }).then((r) => r.json().then((j) => ({ ok: r.ok, j })));
      uploadReq
        .then((pack) => {
          if (!pack.ok || !pack.j || !pack.j.success) {
            const msg = (pack.j && pack.j.error) || 'Could not save to Google Drive.';
            if (pack.j && pack.j.needsReconnect) {
              if (
                window.confirm(
                  msg + '\n\nOpen Google Drive connection now? (You may need to approve save access.)'
                )
              ) {
                window.location.href = '/auth/google/drive-link';
              }
              return;
            }
            throw new Error(msg);
          }
          const link = pack.j.webViewLink;
          const name = pack.j.name || filename;
          if (link && window.confirm(`Saved "${name}" to Google Drive (AdHello Leads folder).\n\nOpen in Drive?`)) {
            window.open(link, '_blank', 'noopener,noreferrer');
          } else {
            alert(`Saved "${name}" to your Google Drive (AdHello Leads folder).`);
          }
        })
        .catch((e) => {
          alert(e && e.message ? e.message : 'Could not save to Google Drive.');
        })
        .finally(() => {
          saveBtn.disabled = false;
          saveBtn.removeAttribute('aria-busy');
        });
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
    const wr = document.getElementById('warRoomModal');
    if (wr && !wr.classList.contains('hidden') && typeof closeWarRoomModal === 'function') closeWarRoomModal();
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
  const scheduleSubmitBtn = document.getElementById('scheduleSubmitBtn');
  const searchBackgroundNotice = document.getElementById('searchBackgroundNotice');
  const searchFolderKey = document.getElementById('searchFolderKey');
  const searchNewFolderWrap = document.getElementById('searchNewFolderWrap');
  const searchNewFolderName = document.getElementById('searchNewFolderName');
  const runNowAlso = document.getElementById('runNowAlso');

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
    const setModeButtonClasses = (mode) => {
      if (mode === 'run') {
        modeRunNow.className = 'flex-1 h-full rounded-lg text-[9px] font-black uppercase transition-all bg-white dark:bg-slate-700 text-brand-dark dark:text-slate-100 shadow-sm border border-brand-border/10';
        modeSchedule.className = 'flex-1 h-full rounded-lg text-[9px] font-black uppercase transition-all text-brand-muted dark:text-slate-400 hover:text-brand-dark dark:hover:text-slate-100';
      } else {
        modeSchedule.className = 'flex-1 h-full rounded-lg text-[9px] font-black uppercase transition-all bg-white dark:bg-slate-700 text-brand-dark dark:text-slate-100 shadow-sm border border-brand-border/10';
        modeRunNow.className = 'flex-1 h-full rounded-lg text-[9px] font-black uppercase transition-all text-brand-muted dark:text-slate-400 hover:text-brand-dark dark:hover:text-slate-100';
      }
    };

    modeRunNow.addEventListener('click', () => {
      searchModeInput.value = 'run';
      setModeButtonClasses('run');

      if (scheduledSearchSettings) {
        scheduledSearchSettings.classList.add('hidden');
      }
      if (runNowAlso) runNowAlso.checked = false;
      const dateEl = document.getElementById('scheduledDateInput');
      if (dateEl) dateEl.required = false;

      if (searchBtnLabel) {
        searchBtnLabel.innerHTML = 'Search now<svg class="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>';
      }
    });

    modeSchedule.addEventListener('click', () => {
      searchModeInput.value = 'schedule';
      setModeButtonClasses('schedule');

      if (scheduledSearchSettings) {
        scheduledSearchSettings.classList.remove('hidden');
      }
      setScheduledDateDefaults();
      const dateElSch = document.getElementById('scheduledDateInput');
      if (dateElSch) dateElSch.required = true;

      if (searchBtnLabel) {
        searchBtnLabel.innerHTML = 'Search now<svg class="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>';
      }
    });

    setModeButtonClasses(searchModeInput.value === 'run' ? 'run' : 'schedule');
  }

  if (searchForm) {
    const syncSearchFolderMode = () => {
      if (!searchFolderKey || !searchNewFolderWrap || !searchNewFolderName) return;
      const isCreate = searchFolderKey.value === '__new__';
      searchNewFolderWrap.classList.toggle('hidden', !isCreate);
      searchNewFolderName.required = isCreate;
      if (isCreate) {
        searchNewFolderName.focus();
      } else {
        searchNewFolderName.value = '';
      }
    };

    if (searchFolderKey) {
      searchFolderKey.addEventListener('change', syncSearchFolderMode);
      syncSearchFolderMode();
    }

    searchForm.addEventListener('submit', () => {
      if (searchFolderKey && searchFolderKey.value === '__new__') {
        searchFolderKey.value = '';
      }
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
      if (!isSchedule && searchBackgroundNotice) {
        searchBackgroundNotice.classList.remove('hidden');
      }
      if (!isSchedule) {
        const bellBadge = document.getElementById('bulkEnhanceBellBadge');
        const pingDot = document.getElementById('notificationPing');
        if (bellBadge) {
          bellBadge.textContent = 'RUN';
          bellBadge.classList.remove('hidden');
          bellBadge.setAttribute('title', 'Lead search running in background');
        }
        if (pingDot) pingDot.classList.remove('hidden');
      }
      if (isSchedule && runNowAlso && runNowAlso.checked && btn) {
        btn.disabled = true;
        btn.classList.add('opacity-50', 'cursor-not-allowed');
      }
      if (isSchedule && scheduleSubmitBtn) {
        scheduleSubmitBtn.disabled = true;
        scheduleSubmitBtn.classList.add('opacity-50', 'cursor-not-allowed');
      }
    });
  }

  // Find Leads wizard (progressive flow)
  const wizardPanels = document.querySelectorAll('[data-step-panel]');
  if (wizardPanels && wizardPanels.length) {
    const setStep = (stepNo) => {
      wizardPanels.forEach((panel) => {
        panel.classList.toggle('hidden', String(panel.getAttribute('data-step-panel')) !== String(stepNo));
      });
      document.querySelectorAll('[data-step-indicator]').forEach((el) => {
        const active = String(el.getAttribute('data-step-indicator')) === String(stepNo);
        el.classList.toggle('bg-brand-yellow/10', active);
        el.classList.toggle('border-brand-yellow/40', active);
        el.classList.toggle('text-brand-dark', active);
        el.classList.toggle('dark:text-white', active);
        if (active) {
          el.classList.remove('border-brand-border/40', 'dark:border-white/10', 'text-brand-muted');
        } else {
          el.classList.remove('bg-brand-yellow/10', 'border-brand-yellow/40', 'text-brand-dark', 'dark:text-white');
          el.classList.add('border-brand-border/40', 'dark:border-white/10', 'text-brand-muted');
        }
      });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    document.querySelectorAll('[data-step-next]').forEach((btnNext) => {
      btnNext.addEventListener('click', () => setStep(btnNext.getAttribute('data-step-next')));
    });
    document.querySelectorAll('[data-step-prev]').forEach((btnPrev) => {
      btnPrev.addEventListener('click', () => setStep(btnPrev.getAttribute('data-step-prev')));
    });
    setStep(1);
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
  const getLeadDetailPanel = () => document.getElementById('mobilePanel');
  const LEAD_PANEL_INLINE_PROPS = ['display', 'opacity', 'pointer-events', 'visibility', 'z-index'];
  function clearLeadDetailPanelForceStyles(el) {
    if (!el || !el.style) return;
    LEAD_PANEL_INLINE_PROPS.forEach((p) => el.style.removeProperty(p));
  }
  const closeMobileBtn = document.getElementById('closeMobilePanel');
  const prevLeadBtn = document.getElementById('prevLeadBtn');
  const nextLeadBtn = document.getElementById('nextLeadBtn');
  let rows = document.querySelectorAll('.result-row');
  const navigableRows = () =>
    Array.from(document.querySelectorAll('.result-row')).filter(
      (r) =>
        !r.classList.contains('workflow-filtered-out') &&
        !r.classList.contains('result-row--panel-source')
    );
  let currentRow = null;
  let currentIndex = -1;

  /** Workspace SMS-style scripts → quick-log note (declared early — populatePanel may run before later callbacks execute). */
  let leadNotepadScriptOptions = [];

  function fillLeadScriptPlaceholdersForNote(text, row) {
    if (!text) return '';
    const title = String((row && row.dataset && row.dataset.title) || '').trim();
    const city = String((row && row.dataset && row.dataset.city) || '').trim();
    const storedOwner = String((row && row.dataset && row.dataset.ownerFirstName) || '').trim();
    const ownerInp = document.getElementById('leadPanelOwnerFirstName');
    const typedOwner = ownerInp ? String(ownerInp.value || '').trim() : '';
    const ownerTok = (typedOwner || storedOwner).split(/\s+/)[0] || '';
    let t = String(text);
    t = t.replace(/\{\{company\}\}/gi, title || 'your business');
    t = t.replace(/\{\{name\}\}/gi, ownerTok || title || 'there');
    t = t.replace(/\{\{city\}\}/gi, city || 'your area');
    return t;
  }

  function formatSellingScriptForChannel(rawText, channel, row) {
    let t = fillLeadScriptPlaceholdersForNote(rawText, row);
    const ch = String(channel || 'call').toLowerCase();
    const ownerInp = document.getElementById('leadPanelOwnerFirstName');
    const owner = ownerInp
      ? String(ownerInp.value || '').trim().split(/\s+/)[0]
      : String((row && row.dataset && row.dataset.ownerFirstName) || '')
          .trim()
          .split(/\s+/)[0];
    if (ch === 'voicemail') {
      const hi = owner ? `Hi ${owner}, ` : 'Hi, ';
      if (!/^hi\b/i.test(t.trim())) {
        t = `${hi}this is [your name] with [agency]. ${t}`;
      }
      if (!/call\s+back/i.test(t)) {
        t = `${t.trim()} Give me a call back at [your number] when you have a minute.`;
      }
    }
    if (ch === 'email') {
      const title = String((row && row.dataset && row.dataset.title) || 'your business').trim();
      if (!/^subject:/im.test(t)) {
        t = `Subject: Quick idea for ${title}\n\n${t}`;
      }
    }
    return t;
  }

  let leadOutreachScriptsCache = { leadKey: '', data: null, loading: null, loadingKey: '' };
  if (!window.__leadOutreachChannel) window.__leadOutreachChannel = 'call';

  function getEmbeddedOutreachScriptsPayload(row) {
    const library =
      typeof window !== 'undefined' && window.__ADHELLO_OUTREACH_LIBRARY__
        ? window.__ADHELLO_OUTREACH_LIBRARY__
        : null;
    if (!library || typeof library !== 'object') return null;
    const services = Array.isArray(window.ADHELLO_SERVICE_OFFERS) ? window.ADHELLO_SERVICE_OFFERS : [];
    const keys = services.map((s) => s && s.key).filter(Boolean);
    const rowKey = String((row && row.dataset && row.dataset.primaryServiceKey) || '').trim();
    let defaultServiceKey = keys.includes(rowKey) ? rowKey : keys[0] || '';
    if (!defaultServiceKey) {
      const libKeys = Object.keys(library);
      defaultServiceKey = libKeys[0] || '';
    }
    return {
      success: true,
      library,
      services,
      defaultServiceKey,
    };
  }

  function resolveLeadPanelServiceKey(row, data) {
    const sel = document.getElementById('leadPanelPrimaryServiceSelect');
    let serviceKey = sel ? String(sel.value || '').trim() : '';
    if (!serviceKey && row && row.dataset) {
      const rowKey = String(row.dataset.primaryServiceKey || '').trim();
      if (rowKey && data.library && data.library[rowKey]) serviceKey = rowKey;
    }
    if (!serviceKey) serviceKey = String(data.defaultServiceKey || '').trim();
    return serviceKey;
  }

  function applyLeadPanelSellingScriptFromData(row, data) {
    const scriptEl = document.getElementById('leadPanelSellingScript');
    if (!scriptEl || !row || !data || !data.library) return;
    const channel = window.__leadOutreachChannel || 'call';
    const serviceKey = resolveLeadPanelServiceKey(row, data);
    const svc = serviceKey && data.library ? data.library[serviceKey] : null;
    const auditSell = document.getElementById('mobilePanelAuditSell');
    if (auditSell && svc && svc.label) auditSell.textContent = svc.label;
    const raw =
      svc && svc.channels && svc.channels[channel] ? String(svc.channels[channel]) : '';
    if (!raw) {
      scriptEl.textContent = serviceKey
        ? 'No script for this channel yet. Add one in Sales → Script library.'
        : 'Pick a service above, or run AI analyze for a recommendation.';
      return;
    }
    scriptEl.textContent = formatSellingScriptForChannel(raw, channel, row);
  }

  async function fetchLeadOutreachScripts(row) {
    const key = normalizeLeadKeyForScriptsFetch(row && row.dataset ? row.dataset.leadKey : '');
    const embedded = getEmbeddedOutreachScriptsPayload(row);
    if (!key) return embedded;
    if (leadOutreachScriptsCache.leadKey === key && leadOutreachScriptsCache.data) {
      return leadOutreachScriptsCache.data;
    }
    if (leadOutreachScriptsCache.loading && leadOutreachScriptsCache.loadingKey === key) {
      return leadOutreachScriptsCache.loading;
    }
    const p = (async () => {
      const fetchJsonFn = typeof window.fetchJson === 'function' ? window.fetchJson : null;
      const url = `/leads/${encodeURIComponent(key)}/outreach-scripts`;
      let data;
      try {
        if (fetchJsonFn) {
          const { ok, j } = await fetchJsonFn(url, {
            method: 'GET',
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
          });
          if (!ok || !j.success) throw new Error((j && j.error) || 'Scripts failed');
          data = j;
        } else {
          const res = await fetch(url, {
            method: 'GET',
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
          });
          data = await res.json().catch(() => ({}));
          if (!res.ok || !data.success) throw new Error(data.error || 'Scripts failed');
        }
      } catch (err) {
        if (embedded) return embedded;
        throw err;
      }
      if (Array.isArray(data.services) && data.services.length) {
        window.ADHELLO_SERVICE_OFFERS = data.services.map((s) => ({
          key: s.key,
          label: s.label || s.key,
        }));
        ensureLeadPanelPrimaryServiceSelectOptions(true);
      }
      leadOutreachScriptsCache = { leadKey: key, data, loading: null, loadingKey: key };
      return data;
    })();
    leadOutreachScriptsCache.loading = p;
    leadOutreachScriptsCache.loadingKey = key;
    try {
      return await p;
    } catch (err) {
      if (leadOutreachScriptsCache.loadingKey === key) {
        leadOutreachScriptsCache.loading = null;
      }
      if (embedded) return embedded;
      throw err;
    }
  }

  function syncLeadOutreachChannelButtons() {
    const channel = window.__leadOutreachChannel || 'call';
    document.querySelectorAll('.lead-outreach-channel').forEach((btn) => {
      const on = btn.getAttribute('data-outreach-channel') === channel;
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.classList.toggle('border-brand-yellow/50', on);
      btn.classList.toggle('bg-white', on);
      btn.classList.toggle('dark:bg-slate-900', on);
      btn.classList.toggle('text-brand-dark', on);
      btn.classList.toggle('dark:text-white', on);
      btn.classList.toggle('shadow-sm', on);
      btn.classList.toggle('border-brand-border/30', !on);
      btn.classList.toggle('text-brand-muted', !on);
    });
  }

  async function syncLeadPanelSellingScript(row) {
    const scriptEl = document.getElementById('leadPanelSellingScript');
    if (!scriptEl || !row) return;
    syncLeadOutreachChannelButtons();
    const embedded = getEmbeddedOutreachScriptsPayload(row);
    if (embedded) applyLeadPanelSellingScriptFromData(row, embedded);
    else scriptEl.textContent = 'Loading script…';
    try {
      const data = await fetchLeadOutreachScripts(row);
      if (!data) {
        scriptEl.textContent = 'Add scripts in Sales → Script library to use this panel.';
        return;
      }
      applyLeadPanelSellingScriptFromData(row, data);
    } catch (e) {
      if (!embedded) scriptEl.textContent = (e && e.message) || 'Could not load script.';
    }
  }

  function defaultLeadNotepadScriptFallback(row) {
    const biz = String((row && row.dataset && row.dataset.title) || 'there').trim();
    return [
      {
        id: 'fallback',
        label: 'Short outreach',
        text: `Hi ${biz} team — [your name] here. Had a quick thought on your local visibility; open to two minutes when you're between jobs?`,
      },
    ];
  }

  function normalizeLeadKeyForScriptsFetch(raw) {
    const k = String(raw || '').trim();
    if (!k) return '';
    return k.replace(/^lead:/i, '').trim();
  }

  async function syncLeadNotepadScripts(row) {
    const sel = document.getElementById('leadNotepadScriptSelect');
    if (!sel) return;

    const applyOptions = (opts, placeholderLabel) => {
      leadNotepadScriptOptions = Array.isArray(opts) ? opts : [];
      sel.innerHTML = '';
      const ph = document.createElement('option');
      ph.value = '';
      ph.textContent = placeholderLabel || 'Choose script…';
      sel.appendChild(ph);
      leadNotepadScriptOptions.forEach((opt, idx) => {
        const o = document.createElement('option');
        o.value = String(idx);
        o.textContent = opt.label || `Script ${idx + 1}`;
        sel.appendChild(o);
      });
      sel.value = '';
    };

    sel.disabled = true;
    sel.innerHTML = '<option value="">Loading scripts…</option>';
    leadNotepadScriptOptions = [];

    try {
      const leadKeyRaw =
        row && row.dataset ? String(row.dataset.leadKey || '').trim() : '';
      const leadKey = normalizeLeadKeyForScriptsFetch(leadKeyRaw);

      if (leadKey) {
        const res = await fetch(`/leads/${encodeURIComponent(leadKey)}/sms-script-options`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          credentials: 'same-origin',
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error((data && data.error) || 'scripts');
        const opts = Array.isArray(data.options) ? data.options : [];
        if (!opts.length) {
          applyOptions(defaultLeadNotepadScriptFallback(row), 'Choose script…');
        } else {
          applyOptions(opts, 'Choose script…');
        }
      } else {
        applyOptions(defaultLeadNotepadScriptFallback(row), 'Choose script…');
      }
    } catch (err) {
      console.warn('[Lead panel] Script options:', err && err.message ? err.message : err);
      applyOptions(defaultLeadNotepadScriptFallback(row), 'Choose script…');
    } finally {
      sel.disabled = false;
    }
  }

  function openLeadPanelComposer() {
    const d = document.getElementById('leadPanelComposerDrawer');
    const btn = document.getElementById('leadPanelComposerToggle');
    const ch = document.getElementById('leadPanelComposerChevron');
    if (d) d.classList.add('lead-panel-composer-drawer--open');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    if (ch) {
      ch.classList.remove('rotate-180');
      ch.style.transform = '';
    }
  }

  function closeLeadPanelComposer() {
    const d = document.getElementById('leadPanelComposerDrawer');
    const btn = document.getElementById('leadPanelComposerToggle');
    const ch = document.getElementById('leadPanelComposerChevron');
    if (d) d.classList.remove('lead-panel-composer-drawer--open');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    if (ch) {
      ch.classList.add('rotate-180');
      ch.style.transform = '';
    }
  }

  function toggleLeadPanelComposer() {
    const drawer = document.getElementById('leadPanelComposerDrawer');
    if (!drawer) return;
    if (drawer.classList.contains('lead-panel-composer-drawer--open')) {
      closeLeadPanelComposer();
    } else {
      openLeadPanelComposer();
      const ni = document.getElementById('noteInput');
      if (ni) ni.focus();
    }
  }

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

    // OPEN SIDEBAR / PANEL before populatePanel: if populate throws (bad row JSON, partial DOM),
    // the sheet must still appear; previously the open block never ran after a throw.
    const panelRoot = getLeadDetailPanel();
    if (panelRoot) {
      panelRoot.classList.remove('hidden');
      panelRoot.classList.add('open');
      panelRoot.classList.remove('opacity-0');
      panelRoot.classList.add('opacity-100');
      /* Defeat Tailwind `hidden` vs `flex` conflicts and ensure overlay is above app chrome */
      panelRoot.style.setProperty('display', 'flex', 'important');
      panelRoot.style.setProperty('opacity', '1', 'important');
      panelRoot.style.setProperty('pointer-events', 'auto', 'important');
      panelRoot.style.setProperty('visibility', 'visible', 'important');
      panelRoot.style.setProperty('z-index', '400', 'important');

      document.body.style.overflow = 'hidden';

      const innerSheet = panelRoot.querySelector(':scope > div');
      if (innerSheet) {
        innerSheet.classList.remove('translate-y-full', 'translate-x-full');
        innerSheet.style.display = 'flex';
      }

      requestAnimationFrame(() => {
        const panelScroll = document.getElementById('leadPanelTabScroll');
        if (panelScroll) panelScroll.scrollTop = 0;
        const stickyTitle = document.getElementById('stickyPanelTitle');
        if (stickyTitle) {
          stickyTitle.classList.add('opacity-0', 'pointer-events-none');
          stickyTitle.classList.remove('opacity-100');
        }
        if (typeof window.__adhelloRefreshSoftphonePosition === 'function') {
          window.__adhelloRefreshSoftphonePosition();
        }
      });
    } else {
      console.warn('[Lead detail panel] #mobilePanel not found — detail sidebar cannot open on this page.');
    }

    try {
      populatePanel(row);
    } catch (err) {
      console.error('[Lead detail panel] populatePanel failed:', err);
    }

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
  };

  function shouldIgnoreRowOpenClick(target) {
    if (!target) return true;
    return !!(
      target.type === 'checkbox' ||
      target.closest('.bookmark-btn') ||
      target.closest('.view-detail-btn') ||
      target.closest('.email-intel-btn') ||
      target.closest('.ai-analysis-btn') ||
      target.closest('.lead-category-input') ||
      target.closest('select') ||
      target.closest('form') ||
      target.closest('a') ||
      target.closest('button') ||
      target.closest('.plc-col-resize') ||
      target.closest('.js-pipeline-columns-wrap')
    );
  }

  /** Pipeline table: inline row handler runs on bubble at tr before document — survives lost bubbling */
  function pipelineRowActivateFromInline(ev, tr) {
    if (!ev || !tr || !tr.classList || !tr.classList.contains('result-row')) return;
    if (tr.classList.contains('result-row--panel-source')) return;
    const t = ev.target;
    if (!t || !t.closest) return;
    if (shouldIgnoreRowOpenClick(t)) return;
    ev.stopPropagation();
    selectRow(tr);
  }
  window.__pipelineRowActivate = pipelineRowActivateFromInline;

  // Row clicks: delegated handler only (avoids double-invoke + works for dynamically added rows)
  document.addEventListener('click', (e) => {
    const row = e.target.closest('.result-row');
    if (!row || row.classList.contains('result-row--panel-source')) return;
    if (shouldIgnoreRowOpenClick(e.target)) return;
    selectRow(row);
  });

  // Specific Detail Button Trigger (Reliability)
  document.addEventListener('click', (e) => {
    const detailBtn = e.target.closest('.view-detail-btn');
    if (detailBtn) {
      e.stopPropagation();
      const row = detailBtn.closest('.result-row');
      if (row) selectRow(row);
    }
  });

  // Explicit right-chevron trigger fallback (covers icon wrappers/nested taps)
  document.addEventListener('click', (e) => {
    const chevronTrigger =
      e.target.closest('.view-detail-btn') ||
      e.target.closest('[aria-label="Open lead details"]') ||
      e.target.closest('[title="Open lead details"]');
    if (!chevronTrigger) return;
    e.preventDefault();
    e.stopPropagation();
    const row = chevronTrigger.closest('.result-row');
    if (row) selectRow(row);
  });

  async function runAiAnalysisForRow(row) {
    if (!row) return null;
    const leadKey = String(row.dataset.leadKey || '').trim();
    const website = String(row.dataset.website || '').trim();
    if (!leadKey) throw new Error('Lead key missing');
    if (!website || website === 'N/A') throw new Error('This lead has no website URL');

    const fetchJsonFn = typeof window.fetchJson === 'function' ? window.fetchJson : null;
    let data;
    if (fetchJsonFn) {
      const { ok, j } = await fetchJsonFn(`/leads/${encodeURIComponent(leadKey)}/ai-analysis`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({}),
      });
      if (!ok || !j.success) throw new Error((j && j.error) || 'AI analysis failed');
      data = j;
    } else {
      const res = await fetch(`/leads/${encodeURIComponent(leadKey)}/ai-analysis`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({}),
      });
      data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'AI analysis failed');
    }
    const analysis = data.analysis || {};
    const ownerSignal = String(data.ownerSignal || (data.lead && data.lead.ownerSignal) || '').trim();
    const score = Number(analysis.analysisScore || 0);
    row.dataset.aiScore = String(Math.min(10, Math.max(0, Math.round(score))));
    row.dataset.aiAnalysis = JSON.stringify(analysis);
    if (ownerSignal) row.dataset.ownerSignal = ownerSignal;
    const oppContainer = row.querySelector('.opportunity-badge');
    if (oppContainer) {
      oppContainer.innerHTML = renderOpportunityBadges(row);
      oppContainer.dataset.score = row.dataset.aiScore;
    }
    if (currentRow === row) {
      leadOutreachScriptsCache = { leadKey: '', data: null, loading: null, loadingKey: '' };
      if (typeof populatePanel === 'function') populatePanel(row);
      else {
        syncLeadCallAiAnalyzeCta(row);
        syncLeadPanelSellingScript(row).catch(() => {});
      }
    }
    const rowSignal = row.querySelector('.lead-owner-signal');
    if (rowSignal) rowSignal.textContent = ownerSignal || '';
    return data;
  }

  async function fetchAuditReportLinkBundle(row) {
    const leadKey = String(row.dataset.leadKey || '').trim();
    if (!leadKey) throw new Error('Lead key missing');
    const url = `/leads/${encodeURIComponent(leadKey)}/audit-report-link`;
    const fetchJsonFn = typeof window.fetchJson === 'function' ? window.fetchJson : null;
    if (fetchJsonFn) {
      const { ok, j } = await fetchJsonFn(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({}),
      });
      if (!ok || !j.success) throw new Error((j && j.error) || 'Could not create report link');
      return j;
    }
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.error || 'Could not create report link');
    return data;
  }

  function getWorkspaceCouponLink() {
    const store = document.getElementById('workspaceCouponLinkStore');
    return String((store && store.dataset && store.dataset.couponLink) || '').trim();
  }

  function appendCouponLineToReportBody(body) {
    const includeCoupon = document.getElementById('sidebarIncludeCoupon');
    const couponLink = getWorkspaceCouponLink();
    if (!includeCoupon || !includeCoupon.checked || !couponLink) return body;
    return `${body}\n\nAlso, if it helps, here is a free coffee coupon link for your team: ${couponLink}`;
  }

  async function ensureLeadAiAnalysis(row, opts) {
    const options = opts && typeof opts === 'object' ? opts : {};
    let analysis = getAiAnalysisFromRow(row);
    if (analysis) return analysis;
    const hasWebsite = row && row.dataset && row.dataset.website && row.dataset.website !== 'N/A';
    if (!hasWebsite) {
      throw new Error('This lead needs a website URL. Add one or run AI analyze from call mode.');
    }
    if (options.toast !== false && typeof window.showAppToast === 'function') {
      window.showAppToast('Running AI analysis to build your report…', { variant: 'info' });
    }
    const result = await runAiAnalysisForRow(row);
    analysis = (result && result.analysis) || getAiAnalysisFromRow(row);
    if (!analysis) throw new Error('AI analysis did not return usable data. Try again in a moment.');
    return analysis;
  }

  function toDisplayValue(value, fallback) {
    const fb = fallback === undefined ? 'N/A' : fallback;
    if (value == null) return fb;
    const s = String(value).trim();
    return s && s !== 'N/A' ? s : fb;
  }

  function normalizeList(value) {
    if (Array.isArray(value)) return value.map((v) => String(v || '').trim()).filter(Boolean);
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    }
    return [];
  }

  function filterReportEmails(list) {
    const arr = normalizeList(list);
    return arr.filter((e) => {
      const x = String(e || '').trim().toLowerCase();
      if (!x.includes('@')) return false;
      const [local, host] = x.split('@');
      if (!host) return false;
      const h = host.replace(/^www\./, '');
      if (h.includes('sentry') && (h.includes('wix') || h.endsWith('wixpress.com'))) return false;
      if (h === 'sentry.io' || h.endsWith('.sentry.io')) return false;
      if (/^noreply|no-reply|donotreply|mailer-daemon/.test(local)) return false;
      if (/^[0-9a-f]{24,}$/i.test(local)) return false;
      return true;
    });
  }

  function pickPrimaryEmailForReport(emails) {
    const list = filterReportEmails(emails || []);
    if (!list.length) return '';
    for (const p of ['info', 'contact', 'hello', 'sales', 'office', 'support', 'team']) {
      const hit = list.find((e) => e.startsWith(p + '@'));
      if (hit) return hit;
    }
    return [...list].sort((a, b) => a.length - b.length)[0];
  }

  function reportDomainFromWebsite(website) {
    const w = String(website || '').trim();
    if (!w || w === 'N/A') return '';
    try {
      const u = new URL(/^https?:\/\//i.test(w) ? w : `https://${w}`);
      return u.hostname.replace(/^www\./i, '');
    } catch {
      return w.replace(/^https?:\/\//i, '').split('/')[0].split('?')[0] || '';
    }
  }

  function resolveSiteHealth100(analysis) {
    if (!analysis || typeof analysis !== 'object') return 0;
    if (analysis.siteHealth100 != null && Number.isFinite(Number(analysis.siteHealth100))) {
      return Math.min(100, Math.max(0, Math.round(Number(analysis.siteHealth100))));
    }
    const raw = Number(analysis.analysisScore || 0);
    if (raw > 10) return Math.min(100, Math.max(0, Math.round(raw)));
    if (raw > 0) return Math.min(100, Math.max(0, 100 - Math.round(raw) * 10));
    return 0;
  }

  function formatAuditDateShort(iso) {
    const d = iso ? new Date(iso) : null;
    if (!d || Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  /** Mirrors server `computeTopGapLabels` for saved rows missing `topGapLabels`. */
  function computeTopGapLabelsClient(a, maxLabels) {
    const cap = Math.min(10, Math.max(1, Number(maxLabels) || 3));
    const out = [];
    if (!a || typeof a !== 'object') return out;
    const flags = a.flags || {};
    const meta = String(a.metaDescription || '').trim();
    const title = String(a.pageTitle || '').trim();
    const emails = a.emails || [];
    const phones = a.phones || [];
    const signals = a.signals || [];
    const copyYear = parseInt(String(a.copyrightYear || '').trim(), 10);
    const nowYear = new Date().getFullYear();
    const push = (label) => {
      if (out.length >= cap) return;
      if (label && !out.includes(label)) out.push(label);
    };
    if (flags.returned404) push('Homepage availability (404)');
    if (flags.noSsl) push('HTTPS / SSL');
    if (!meta) push('Meta description');
    if (flags.slowLoad) push('Homepage load speed');
    if (!a.mobileResponsive) push('Mobile viewport / responsiveness');
    if (Number.isFinite(copyYear) && copyYear < nowYear - 1) push('Copyright / freshness signal');
    if (!signals.length) push('Above-the-fold call to action');
    if (!title || title.length < 2) push('Page title strength');
    if ((!emails || !emails.length) && (!phones || !phones.length)) push('Visible contact info');
    if (!out.length) push('No major crawl gaps flagged');
    return out.slice(0, cap);
  }

  function getTopGapLabelsForReport(analysis, maxPick) {
    const cap = Math.min(5, Math.max(1, Number(maxPick) || 3));
    if (analysis && Array.isArray(analysis.topGapLabels) && analysis.topGapLabels.length) {
      return analysis.topGapLabels.slice(0, cap);
    }
    return computeTopGapLabelsClient(analysis, cap);
  }

  function auditTierLabel(health) {
    if (health >= 85) return 'Strong';
    if (health >= 70) return 'Good';
    if (health >= 50) return 'Needs Work';
    return 'Critical';
  }

  /** City label for quoted search examples (e.g. "Portland" from "Portland, OR"). */
  function auditCityLabel(row) {
    const raw = String((row && row.dataset && row.dataset.city) || '').trim();
    if (!raw || raw === 'N/A') return '';
    return raw.split(',')[0].trim();
  }

  /**
   * Plausible quoted query for the audit narrative (not a SERP claim).
   * Example: painters + Portland → "painters Portland".
   */
  function buildAuditSearchQueryExample(row) {
    const city = auditCityLabel(row);
    const cat = String((row && row.dataset && row.dataset.category) || '')
      .trim()
      .toLowerCase();
    const c = city ? city.replace(/\b\w/g, (ch) => ch.toUpperCase()) : '';
    if (c) {
      if (/(^|[\s,])paint/.test(cat)) return `painters ${c}`;
      if (/plumb/.test(cat)) return `plumbers ${c}`;
      if (/(hvac|heating|cooling|air conditioning)/.test(cat)) return `hvac ${c}`;
      if (/roof/.test(cat)) return `roofers ${c}`;
      if (/electric/.test(cat)) return `electricians ${c}`;
      if (/landscap|lawn|yard/.test(cat)) return `landscaping ${c}`;
      if (/clean/.test(cat)) return `cleaning services ${c}`;
      if (/contract|remodel|construction|general contractor/.test(cat)) return `contractors ${c}`;
    }
    if (c && cat) {
      const slug = cat
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2 && !['the', 'and', 'for', 'inc', 'llc'].includes(w))
        .slice(0, 3)
        .join(' ');
      if (slug) return `${slug} ${c}`;
    }
    return city ? `services ${c}` : 'your services';
  }

  function buildAuditHeadlineIssue(row, analysis, ownerSignal) {
    const metaMissing = !String((analysis && analysis.metaDescription) || '').trim();
    if (metaMissing) {
      const q = buildAuditSearchQueryExample(row);
      return (
        'The headline issue: You are losing click-throughs to competitors because Google is guessing what your business does — your homepage has no meta description. ' +
        `That means when someone Googles "${q}" (or your brand), Google auto-generates a random snippet from your page — ` +
        "and it's almost never the sentence that converts. Competitors with a written description get more clicks from the same ranking."
      );
    }
    const s = String(ownerSignal || '').trim();
    return s ? `The headline issue: ${s}` : 'The headline issue: A few focused fixes would tighten trust and conversion on your homepage.';
  }

  function buildTopAuditFixes(analysis, copyrightYearRaw) {
    const fixes = [];
    const nowY = new Date().getFullYear();
    const cyNum = parseInt(String(copyrightYearRaw || '').trim(), 10);
    const metaOk = String((analysis && analysis.metaDescription) || '').trim().length > 0;
    const ctas = normalizeList(analysis && (analysis.signals || analysis.bookingSignals));

    if (!metaOk) {
      fixes.push(
        'Write a 150–160 character meta description targeting your top service + city (what you do, where you do it, one proof or offer).',
      );
    }
    if (Number.isFinite(cyNum) && cyNum < nowY - 1) {
      fixes.push(`Update the copyright year to ${nowY} — small trust signal, often a 30-second fix if it's in the footer.`);
    }
    if (!ctas.length) {
      fixes.push('Add a visible "Get a Free Quote" button above the fold with a tap-to-call link on mobile.');
    }
    if (fixes.length < 3 && analysis && analysis.flags && analysis.flags.slowLoad) {
      fixes.push(
        'Improve homepage load speed (compress hero images, trim blocking scripts) so mobile visitors do not bounce before they read your pitch.',
      );
    }
    if (fixes.length < 3 && analysis && analysis.flags && analysis.flags.noSsl) {
      fixes.push('Enable HTTPS across the site so browsers never show a "Not secure" warning before the first scroll.');
    }
    if (!fixes.length) {
      fixes.push('Book a short homepage review: we will prioritize the three changes that lift trust and clicks first.');
    }
    return fixes.slice(0, 3);
  }

  function buildClientReportEmail(row, analysis, ownerSignal) {
    const company = toDisplayValue(row && row.dataset ? row.dataset.title : '', 'Business');
    const website = toDisplayValue(row && row.dataset ? row.dataset.website : '', '');
    const domain = reportDomainFromWebsite(website);
    const summarySignal = String(ownerSignal || (row && row.dataset ? row.dataset.ownerSignal : '') || '').trim();

    const health100 = resolveSiteHealth100(analysis);
    const tier = auditTierLabel(health100);
    const headline = buildAuditHeadlineIssue(row, analysis, summarySignal);
    const rubric = String((analysis && analysis.rubricVersion) || 'rubric_v1.2').trim();
    const auditedIso = analysis && analysis.auditedAt ? String(analysis.auditedAt) : '';
    const scoreMetaLine = auditedIso
      ? `Scored with ${rubric} on ${formatAuditDateShort(auditedIso)}.`
      : `Scored with ${rubric}.`;
    const prior = analysis && analysis.priorAuditSnapshot;
    let progressLine = '';
    if (prior && prior.auditedAt && Number.isFinite(Number(prior.siteHealth100))) {
      const prevRv = prior.rubricVersion ? String(prior.rubricVersion) : '';
      progressLine = `Progress vs last crawl (${formatAuditDateShort(prior.auditedAt)}${prevRv ? `, ${prevRv}` : ''}): ${Math.round(
        Number(prior.siteHealth100),
      )}/100 → ${health100}/100.`;
    }
    const gapTop3 = getTopGapLabelsForReport(analysis, 3);
    const gapLines =
      gapTop3.length > 0
        ? ['Top homepage gaps (highest impact first):', '', ...gapTop3.map((g, i) => `${i + 1}. ${g}`), '']
        : [];
    const rubricTease = 'Full category breakdown available in the deeper audit.';
    const estimatedLift =
      'Estimated lift: Fixing the top three gaps typically moves this score about 15–20 points and, in many markets, organic clicks roughly 10–25% — actual lift varies by niche, geography, and how traffic is measured.';

    const primaryEmail = pickPrimaryEmailForReport(analysis && (analysis.emails || analysis.emailAddresses));
    const phones = normalizeList(analysis && (analysis.phones || analysis.phoneNumbers));
    const primaryPhone = phones[0] || '';
    const primaryContactParts = [];
    if (primaryEmail) primaryContactParts.push(primaryEmail);
    if (primaryPhone) primaryContactParts.push(primaryPhone);
    const primaryContact =
      primaryContactParts.length > 0 ? primaryContactParts.join(' · ') : 'None identified on the homepage crawl';

    const hasHttps = !!(analysis && (analysis.hasHttps === true || analysis.https === true));
    const mobileOk = !!(analysis && (analysis.hasViewportMeta === true || analysis.mobileResponsive === true));
    const is404 = !!(
      analysis &&
      (analysis.has404 === true ||
        analysis.returned404 === true ||
        (analysis.flags && analysis.flags.returned404))
    );
    const title = toDisplayValue(analysis && analysis.pageTitle, '');
    const metaPresent = String((analysis && analysis.metaDescription) || '').trim().length > 0;
    const copyrightRaw = analysis && analysis.copyrightYear != null ? String(analysis.copyrightYear).trim() : '';
    const cyNum = parseInt(copyrightRaw, 10);
    const nowY = new Date().getFullYear();
    let copyrightLine;
    if (Number.isFinite(cyNum)) {
      copyrightLine =
        cyNum < nowY - 1
          ? `Copyright year: ⚠️ ${cyNum} (signals the site may not be actively maintained)`
          : `Copyright year: ✅ ${cyNum}`;
    } else {
      copyrightLine = 'Copyright year: — (not detected in crawl)';
    }
    const ctaSignals = normalizeList(analysis && (analysis.signals || analysis.bookingSignals));

    const compName = row && row.dataset ? String(row.dataset.competitorName || '').trim() : '';
    const compGap = row && row.dataset ? String(row.dataset.competitorGap || '').trim() : '';
    const customBench = row && row.dataset ? String(row.dataset.competitorMetaBenchmark || '').trim() : '';
    let competitorBlurb;
    if (compName && compGap) {
      competitorBlurb = `Competitive angle: ${compGap} (vs ${compName}).`;
    } else if (customBench) {
      competitorBlurb = `Competitive angle: ${customBench}`;
    } else if (!metaPresent) {
      competitorBlurb =
        'Competitive angle: In many local packs, the listings that earn the click already show a hand-written meta description — without one, you are often losing the same-ranking click to whoever controls that line.';
    } else {
      competitorBlurb =
        'Competitive angle: Stronger nearby listings often read sharper in search and on-page — small gaps in trust signals compound into lost calls.';
    }

    const fixes = buildTopAuditFixes(analysis, copyrightRaw);
    const fixLines = fixes.map((t, i) => `${i + 1}. ${t}`);

    const titleLine =
      title && title.length > 1
        ? `Page title: ✅ "${title.replace(/"/g, "'")}"`
        : 'Page title: ❌ Missing or weak';

    const lines = [
      `AI Website Audit — ${company}`,
      domain || '(no domain)',
      '',
      `Overall Score: ${health100}/100 — ${tier}`,
      scoreMetaLine,
      ...(progressLine ? [progressLine] : []),
      '',
      ...gapLines,
      rubricTease,
      '',
      estimatedLift,
      '',
      headline,
      '',
      'Quick scan results',
      '',
      `HTTPS: ${hasHttps ? '✅ Secure' : '❌ Not secure'}`,
      `Mobile responsive: ${mobileOk ? '✅ Yes' : '❌ No'}`,
      `Broken links (404s): ${is404 ? '❌ Detected on homepage' : '✅ None detected on homepage'}`,
      titleLine,
      `Meta description: ${metaPresent ? '✅ Present' : '❌ Missing'}`,
      copyrightLine,
      `Booking / Call-to-Action: ${ctaSignals.length ? `✅ Detected: ${ctaSignals.join(', ')}` : '❌ No clear CTA detected above the fold'}`,
      '',
      `Contact info found: ${primaryContact}`,
      '',
      competitorBlurb,
      '',
      'Top 3 fixes (in priority order)',
      '',
      ...fixLines,
      '',
      'Want the full 12-point report?',
      "Reply or call back and I'll send a deeper audit with the full category breakdown (page speed, local SEO, Google Business Profile alignment, and competitor benchmark) — no charge, no obligation.",
    ];

    const subject = `AI Website Audit — ${company}`;
    const body = appendCouponLineToReportBody(lines.join('\n'));
    const toEmail = toDisplayValue(row && row.dataset ? row.dataset.email : '', '');
    return { subject, body, toEmail };
  }

  function openMailReport(report) {
    if (!report || !report.subject || !report.body) return false;
    const encodedSubject = encodeURIComponent(report.subject);
    const encodedBody = encodeURIComponent(report.body);
    const encodedTo = encodeURIComponent(report.toEmail || '');
    const mailto = `mailto:${encodedTo}?subject=${encodedSubject}&body=${encodedBody}`;
    window.location.href = mailto;
    return true;
  }

  function getAiAnalysisFromRow(row) {
    if (!row || !row.dataset) return null;
    let raw = String(row.dataset.aiAnalysis || '').trim();
    if (!raw || raw === 'null' || raw === 'undefined') {
      const attr = row.getAttribute('data-ai-analysis');
      if (attr && attr.trim() && attr.trim() !== 'null') raw = attr.trim();
    }
    if (!raw || raw === 'null' || raw === 'undefined') return null;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      if (Array.isArray(parsed)) return null;
      return Object.keys(parsed).length ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function syncSidebarOutreachButtons(row) {
    const couponWarning = document.getElementById('sidebarCouponWarning');
    const includeCoupon = document.getElementById('sidebarIncludeCoupon');
    if (couponWarning && includeCoupon) {
      const show = includeCoupon.checked && !getWorkspaceCouponLink();
      couponWarning.classList.toggle('hidden', !show);
    }
    if (!row) return;
    const hasAnalysis = !!getAiAnalysisFromRow(row);
    const hasWebsite = row.dataset && row.dataset.website && row.dataset.website !== 'N/A';
    const ready = hasAnalysis || hasWebsite;
    const ids = [
      'sidebarReportEmailBtn',
      'sidebarHostedAuditBtn',
      'sidebarCopyAuditLinkBtn',
      'sidebarCopySmsAuditBtn',
    ];
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.disabled = false;
      el.classList.toggle('opacity-50', !ready);
      el.classList.toggle('cursor-not-allowed', !ready);
      el.title = hasAnalysis
        ? el.getAttribute('data-title-ready') || el.title
        : hasWebsite
          ? 'Runs AI analysis first if needed, then completes this action'
          : 'Add a website URL to this lead first';
    });
    const reportBtn = document.getElementById('sidebarReportEmailBtn');
    if (reportBtn) {
      reportBtn.title = hasAnalysis
        ? 'Open client report email from saved AI analysis'
        : hasWebsite
          ? 'Generate report email (runs AI analysis if needed)'
          : 'Add a website URL first';
    }
  }

  document.addEventListener('click', async (e) => {
    if (e.target.closest('#leadPanelComposerToggle')) {
      e.preventDefault();
      toggleLeadPanelComposer();
      return;
    }

    const callAiBtn = e.target.closest('#leadCallAiAnalyzeBtn');
    if (callAiBtn) {
      e.preventDefault();
      const row = currentRow;
      if (!row) return;
      const hasWebsite = row.dataset.website && row.dataset.website !== 'N/A';
      if (!hasWebsite) {
        if (typeof window.showAppToast === 'function') {
          window.showAppToast('This lead has no website URL.', { variant: 'error' });
        }
        return;
      }
      const original = callAiBtn.textContent;
      callAiBtn.disabled = true;
      callAiBtn.textContent = 'Analyzing…';
      try {
        await runAiAnalysisForRow(row);
        syncLeadCallAiAnalyzeCta(row);
        if (typeof window.showAppToast === 'function') {
          window.showAppToast('AI analysis complete.', { variant: 'success' });
        }
      } catch (err) {
        const msg = err && err.message ? err.message : 'AI analysis failed';
        if (typeof window.showAppToast === 'function') window.showAppToast(msg, { variant: 'error' });
      } finally {
        callAiBtn.disabled = false;
        callAiBtn.textContent = original;
      }
      return;
    }

    const btn = e.target.closest('.ai-analysis-btn');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const row = btn.closest('.result-row');
    if (!row) return;
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="text-[9px] font-black">...</span>';
    try {
      const result = await runAiAnalysisForRow(row);
      const analysisObj = (result && result.analysis) || {};
      const healthToast = resolveSiteHealth100(analysisObj);
      const ownerSignal = String(result && (result.ownerSignal || (result.lead && result.lead.ownerSignal)) || '').trim();
      const report = buildClientReportEmail(row, analysisObj, ownerSignal);
      const opened = openMailReport(report);
      if (opened) {
        if (typeof window.showAppToast === 'function') {
          window.showAppToast(`Report ready (overall ${healthToast}/100). Email draft opened.`, { variant: 'success' });
        }
      } else if (typeof window.showAppToast === 'function') {
        window.showAppToast(`AI analysis complete (overall ${healthToast}/100)`, { variant: 'success' });
      }
    } catch (err) {
      const msg = err && err.message ? err.message : 'AI analysis failed';
      if (typeof window.showAppToast === 'function') window.showAppToast(msg, { variant: 'error' });
      else window.alert(msg);
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  });

  (function openFocusLeadFromQuery() {
    if (!getLeadDetailPanel()) return;
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
            clearLeadDetailPanelForceStyles(mobilePanel);
            mobilePanel.style.pointerEvents = 'none';
            setTimeout(() => mobilePanel.classList.add('hidden'), 300);
            document.body.style.overflow = '';
            if (typeof window.__adhelloRefreshSoftphonePosition === 'function') {
              window.__adhelloRefreshSoftphonePosition();
            }
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
            clearLeadDetailPanelForceStyles(mobilePanel);
            mobilePanel.style.pointerEvents = 'none';
            setTimeout(() => mobilePanel.classList.add('hidden'), 300);
            document.body.style.overflow = '';
            rows.forEach((r) => r.classList.remove('selected'));
            currentRow = null;
            currentIndex = -1;
        }
    });

    // Sticky title: show compact name in the nav row after scrolling the tab body past the hero
    const panelScroll = document.getElementById('leadPanelTabScroll');
    const stickyTitle = document.getElementById('stickyPanelTitle');
    if (panelScroll && stickyTitle) {
      const STICKY_THRESHOLD = 200;
      panelScroll.addEventListener(
        'scroll',
        () => {
          const show = panelScroll.scrollTop > STICKY_THRESHOLD;
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

  if (document.getElementById('leadPanelTabScroll')) {
    initLeadDetailPanelChrome();
  }

  let kieInsightRequestId = 0;

  function scheduleKieServiceInsight(row) {
    const key = row.dataset.leadKey;
    const auditStatus = document.getElementById('mobilePanelAuditStatus');
    const auditSummary = document.getElementById('mobilePanelAuditSummary');
    const aiScorePill = document.getElementById('mobilePanelAiScore');
    const aiAnalysisBtn = document.getElementById('mobilePanelAiAnalysisBtn');
    const ownerSignalEl = document.getElementById('mobilePanelOwnerSignal');
    const auditLoading = document.getElementById('mobilePanelAuditLoading');
    const auditProvider = document.getElementById('mobilePanelAuditProvider');
    const auditSell = document.getElementById('mobilePanelAuditSell');
    const openerWrap = document.getElementById('mobilePanelAuditOpenerWrap');
    const openerEl = document.getElementById('mobilePanelAuditOpener');
    if (!auditStatus) return;

    const heuristic = auditSummary
      ? auditSummary.textContent
      : 'Analyzing this business for outreach angles.';

    const manualKey = String(row.dataset.primaryServiceKey || '').trim();
    const offers = Array.isArray(window.ADHELLO_SERVICE_OFFERS) ? window.ADHELLO_SERVICE_OFFERS : [];
    const picked = offers.find((o) => o && String(o.key) === manualKey);
    if (picked && auditSell) {
      if (auditLoading) auditLoading.classList.add('hidden');
      if (auditProvider) auditProvider.classList.add('hidden');
      auditSell.textContent = picked.label || manualKey;
      auditStatus.textContent = picked.label || manualKey;
      auditStatus.className = 'text-[10px] font-black uppercase tracking-widest text-brand-yellow';
      if (auditSummary) {
        auditSummary.textContent =
          'Using your selected offer. Clear the dropdown to let AI suggest again, or run Enhance / AI Analysis for deeper gaps.';
      }
      if (openerWrap) openerWrap.classList.add('hidden');
      if (openerEl) openerEl.textContent = '';
      syncLeadPanelSellingScript(row).catch(() => {});
      return;
    }

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
          if (auditSummary) auditSummary.textContent = heuristic;
          if (auditSell) auditSell.textContent = auditStatus.textContent || '—';
          if (openerWrap) openerWrap.classList.add('hidden');
          if (openerEl) openerEl.textContent = '';
          syncLeadPanelSellingScript(row).catch(() => {});
          return;
        }
        const sellLabel = data.primaryServiceLabel || 'Recommended offer';
        auditStatus.textContent = sellLabel;
        auditStatus.className = 'text-[10px] font-black uppercase tracking-widest text-brand-yellow';
        if (auditSell) auditSell.textContent = sellLabel;
        if (auditSummary) auditSummary.textContent = data.rationale || heuristic;
        if (data.primaryServiceKey && row.dataset) {
          row.dataset.primaryServiceKey = String(data.primaryServiceKey);
          syncLeadPrimaryServiceSelect(row);
        }
        syncLeadPanelSellingScript(row).catch(() => {});
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
        if (auditSummary) auditSummary.textContent = heuristic;
        if (auditSell) auditSell.textContent = auditStatus.textContent || '—';
        if (openerWrap) openerWrap.classList.add('hidden');
        if (openerEl) openerEl.textContent = '';
        syncLeadPanelSellingScript(row).catch(() => {});
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
    if (L.competitorMetaBenchmark != null) ds.competitorMetaBenchmark = L.competitorMetaBenchmark;
    if (L.updates) ds.updates = JSON.stringify(L.updates);
    if (L.cqi !== undefined) ds.cqi = L.cqi == null ? 'null' : JSON.stringify(L.cqi);
    if (L.ownerFirstName != null) ds.ownerFirstName = String(L.ownerFirstName || '');
    if (L.doNotCall !== undefined) ds.doNotCall = L.doNotCall ? '1' : '';
    if (L.primaryServiceKey !== undefined) {
      ds.primaryServiceKey = L.primaryServiceKey ? String(L.primaryServiceKey).trim() : '';
    }
    if (L.contacts != null) {
      try {
        ds.contacts = JSON.stringify(Array.isArray(L.contacts) ? L.contacts : []);
      } catch {
        ds.contacts = '[]';
      }
    }
    if (L.logs != null) {
      try {
        ds.logsSnippet = JSON.stringify((L.logs || []).slice(-14));
      } catch {
        ds.logsSnippet = '[]';
      }
    }
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
    const keys = [
      'monthlyRevenue',
      'marketingSpend',
      'notes',
      'decisionMakerName',
      'yearsInBusiness',
      'biggestPain',
      'currentlyUsing',
      'budgetRange',
      'timeline',
    ];
    return keys.some((k) => String(cqi[k] || '').trim());
  }

  function readCqiFormFromDom() {
    const g = (id) => {
      const el = document.getElementById(id);
      return el && 'value' in el ? String(el.value || '').trim() : '';
    };
    return {
      decisionMakerName: g('cqiFieldDecisionMaker'),
      yearsInBusiness: g('cqiFieldYearsInBusiness'),
      monthlyRevenue: g('cqiFieldMonthlyRevenue'),
      marketingSpend: g('cqiFieldMarketingSpend'),
      biggestPain: g('cqiFieldBiggestPain'),
      currentlyUsing: g('cqiFieldCurrentlyUsing'),
      budgetRange: g('cqiFieldBudgetRange'),
      timeline: g('cqiFieldTimeline'),
      notes: g('cqiFieldNotes'),
    };
  }

  function fillCqiFormFromObject(cqi) {
    const c = cqi && typeof cqi === 'object' ? cqi : {};
    const setv = (id, v) => {
      const el = document.getElementById(id);
      if (el && 'value' in el) el.value = v != null ? String(v) : '';
    };
    setv('cqiFieldDecisionMaker', c.decisionMakerName || '');
    setv('cqiFieldYearsInBusiness', c.yearsInBusiness || '');
    setv('cqiFieldMonthlyRevenue', c.monthlyRevenue || '');
    setv('cqiFieldMarketingSpend', c.marketingSpend || '');
    setv('cqiFieldBiggestPain', c.biggestPain || '');
    setv('cqiFieldCurrentlyUsing', c.currentlyUsing || '');
    setv('cqiFieldBudgetRange', c.budgetRange || '');
    setv('cqiFieldTimeline', c.timeline || '');
    setv('cqiFieldNotes', c.notes || '');
    const revEl = document.getElementById('mobilePanelCqiRevenue');
    const spendEl = document.getElementById('mobilePanelCqiSpend');
    const notesEl = document.getElementById('mobilePanelCqiNotes');
    if (revEl) revEl.textContent = (c.monthlyRevenue && String(c.monthlyRevenue).trim()) || '—';
    if (spendEl) spendEl.textContent = (c.marketingSpend && String(c.marketingSpend).trim()) || '—';
    if (notesEl) notesEl.textContent = (c.notes && String(c.notes).trim()) || '—';
  }

  function syncMobilePanelCqi(row) {
    const pill = document.getElementById('mobilePanelCqiPill');
    const emptyEl = document.getElementById('mobilePanelCqiEmpty');
    const detailsEl = document.getElementById('mobilePanelCqiDetails');
    const recEl = document.getElementById('mobilePanelCqiRecorded');
    if (!pill || !emptyEl || !detailsEl) return;

    const cqi = parseRowCqi(row);
    fillCqiFormFromObject(cqi);
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

    emptyEl.classList.toggle('hidden', filled);
    detailsEl.classList.remove('hidden');
    if (recEl) {
      if (cqi && cqi.recordedAt) {
        try {
          recEl.textContent = `Last saved ${new Date(cqi.recordedAt).toLocaleString()}`;
        } catch {
          recEl.textContent = '';
        }
      } else {
        recEl.textContent = '';
      }
    }
  }

  const US_STATE_TZ = {
    AL: 'America/Chicago',
    AK: 'America/Anchorage',
    AZ: 'America/Phoenix',
    AR: 'America/Chicago',
    CA: 'America/Los_Angeles',
    CO: 'America/Denver',
    CT: 'America/New_York',
    DE: 'America/New_York',
    FL: 'America/New_York',
    GA: 'America/New_York',
    HI: 'Pacific/Honolulu',
    ID: 'America/Boise',
    IL: 'America/Chicago',
    IN: 'America/Indiana/Indianapolis',
    IA: 'America/Chicago',
    KS: 'America/Chicago',
    KY: 'America/New_York',
    LA: 'America/Chicago',
    ME: 'America/New_York',
    MD: 'America/New_York',
    MA: 'America/New_York',
    MI: 'America/Detroit',
    MN: 'America/Chicago',
    MS: 'America/Chicago',
    MO: 'America/Chicago',
    MT: 'America/Denver',
    NE: 'America/Chicago',
    NV: 'America/Los_Angeles',
    NH: 'America/New_York',
    NJ: 'America/New_York',
    NM: 'America/Denver',
    NY: 'America/New_York',
    NC: 'America/New_York',
    ND: 'America/Chicago',
    OH: 'America/New_York',
    OK: 'America/Chicago',
    OR: 'America/Los_Angeles',
    PA: 'America/New_York',
    RI: 'America/New_York',
    SC: 'America/New_York',
    SD: 'America/Chicago',
    TN: 'America/Chicago',
    TX: 'America/Chicago',
    UT: 'America/Denver',
    VT: 'America/New_York',
    VA: 'America/New_York',
    WA: 'America/Los_Angeles',
    WV: 'America/New_York',
    WI: 'America/Chicago',
    WY: 'America/Denver',
    DC: 'America/New_York',
  };

  function readPipelineRowDisplayAddress(row) {
    if (!row || !row.dataset) return '';
    let a = String(row.dataset.address || '').trim();
    if ((!a || a === 'N/A') && typeof row.querySelector === 'function') {
      const el = row.querySelector('.lead-row-address');
      const t = el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '';
      if (t && t !== '—' && t !== '-') a = t;
    }
    return a && a !== 'N/A' ? a : '';
  }

  /** Geocoding / map query: street address, else city/metro, else title + city. */
  function readPipelineRowMapCenter(row) {
    if (!row || !row.dataset) return '';
    const addr = readPipelineRowDisplayAddress(row);
    if (addr) return addr;
    const city = String(row.dataset.city || '').trim();
    if (city && city !== 'N/A') return city;
    const title = String(row.dataset.title || '').trim();
    if (title && city) return `${title}, ${city}`;
    return title || '';
  }

  function readPipelineRowLocationLine(row) {
    const addr = readPipelineRowDisplayAddress(row);
    if (addr) return formatLeadPanelAddress(addr);
    const city = String((row && row.dataset && row.dataset.city) || '').trim();
    if (city && city !== 'N/A') return city;
    return '';
  }

  function sanitizeSocialUrl(raw) {
    const s = String(raw || '').trim();
    return s && s !== 'N/A' && s !== 'undefined' ? s : '';
  }

  /** Normalize scraped addresses that use hyphens between segments (e.g. "Ave- City- ST"). */
  function formatLeadPanelAddress(raw) {
    let s = String(raw || '').trim();
    if (!s || s === '—' || s === 'N/A') return s;
    s = s.replace(/\s*-\s*/g, ', ').replace(/,\s*,+/g, ', ').replace(/^,\s*|,\s*$/g, '').trim();
    return s;
  }

  /** Pretty-print NANP-style numbers for the panel; keep `dataset.phone` as raw digits for click-to-call. */
  function formatLeadPanelPhoneDisplay(raw) {
    const d = String(raw || '').replace(/\D/g, '');
    if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
    if (d.length === 11 && d[0] === '1') return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
    const s = String(raw || '').trim();
    return s || '';
  }

  function leadPhoneDigits(raw) {
    return String(raw || '').replace(/\D/g, '');
  }

  function leadPhonesMatch(a, b) {
    const da = leadPhoneDigits(a);
    const db = leadPhoneDigits(b);
    return !!(da && db && da === db);
  }

  function getLeadContactsList(row) {
    let list = parseRowContacts(row);
    const phone = String(row.dataset.phone || '').trim();
    if (!list.length && phone && phone !== 'N/A') {
      return [
        {
          role: 'Primary',
          name: '',
          phone,
          email: String(row.dataset.email || '').trim(),
          primary: true,
        },
      ];
    }
    return list;
  }

  function getPrimaryPhoneFromRow(row) {
    const list = getLeadContactsList(row);
    const pri = list.find((c) => c.primary && String(c.phone || '').trim());
    return pri ? String(pri.phone).trim() : '';
  }

  function isHeaderPhonePrimary(row, displayPhone) {
    const pri = getLeadContactsList(row).find((c) => c.primary && String(c.phone || '').trim());
    if (!pri) return false;
    return leadPhonesMatch(pri.phone, displayPhone);
  }

  function readPipelineRowDisplayPhone(row) {
    if (!row || !row.dataset) return '';
    const primary = getPrimaryPhoneFromRow(row);
    if (primary && primary !== 'N/A') return primary.replace(/\s+/g, ' ').trim();
    let p = String(row.dataset.phone || '').trim();
    if (p && p !== 'N/A') return p.replace(/\s+/g, ' ').trim();

    if (typeof row.querySelector === 'function') {
      const slot =
        row.querySelector('a.lead-contact-phone-slot.js-click-to-call-number') ||
        row.querySelector('a.js-click-to-call-number[data-phone][data-lead-key]') ||
        row.querySelector('a.js-click-to-call-number[data-phone]');
      if (slot) {
        p = String(slot.dataset.phone || slot.textContent || '').trim();
      }
    }
    if (!p || p === 'N/A' || p === '—') return '';
    return p.replace(/\s+/g, ' ').trim();
  }

  function readPipelineRowReviewsSnapshot(row) {
    let rating = parseFloat(row.dataset.rating) || 0;
    let reviews = parseInt(row.dataset.reviews, 10) || 0;
    if (row && typeof row.querySelector === 'function') {
      const line = row.querySelector('.lead-reviews-line');
      const txt = line ? line.textContent : '';
      const m = txt.match(/([\d]+(?:\.[\d]+)?)\s*\(\s*(\d+)\s*\)/);
      if (m) {
        rating = parseFloat(m[1]) || rating;
        reviews = parseInt(m[2], 10) || reviews;
      } else {
        const m2 = txt.match(/\(\s*(\d+)\s*\)/);
        if (m2) reviews = parseInt(m2[1], 10) || reviews;
      }
    }
    return { rating, reviews };
  }

  function guessLeadPanelTimeZone(row) {
    const addr = readPipelineRowDisplayAddress(row) || String((row && row.dataset && row.dataset.address) || '');
    const m = addr.match(/\b([A-Z]{2})\s+\d{5}\b/);
    if (m && US_STATE_TZ[m[1]]) return US_STATE_TZ[m[1]];
    return 'America/Los_Angeles';
  }

  async function postLeadJsonUpdate(row, patch) {
    const key = row && row.dataset && row.dataset.leadKey;
    if (!key) throw new Error('Save this lead before updating.');
    const res = await fetch(`/leads/${encodeURIComponent(key)}/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(patch || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error((data && data.error) || 'Update failed');
    if (data.lead) syncPersistedLeadToRowDataset(row, data.lead);
    return data;
  }

  function syncLeadPanelLocalTime(row) {
    const el = document.getElementById('leadPanelStickyLocalTime');
    if (!el) return;
    try {
      const tz = guessLeadPanelTimeZone(row);
      const now = new Date();
      const s = now.toLocaleTimeString(undefined, { timeZone: tz, hour: 'numeric', minute: '2-digit' });
      el.textContent = `There now: ${s} (${tz.replace(/^America\//, '').replace(/_/g, ' ')})`;
      el.classList.remove('hidden');
    } catch {
      el.classList.add('hidden');
    }
  }

  function syncHeaderPhoneRow(row) {
    const phone = readPipelineRowDisplayPhone(row);
    const headerPhone = document.getElementById('mobilePanelHeaderPhone');
    const starBtn = document.getElementById('headerPhonePrimaryStar');
    const lk = row.dataset.leadKey || '';
    if (headerPhone) {
      if (phone) {
        headerPhone.textContent = formatLeadPanelPhoneDisplay(phone);
        headerPhone.href = '#';
        headerPhone.classList.add('js-click-to-call-number');
        headerPhone.dataset.phone = phone.trim();
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
    if (starBtn) {
      const isPri = !!(phone && isHeaderPhonePrimary(row, phone));
      const icon = starBtn.querySelector('.header-phone-star-icon');
      starBtn.disabled = !phone;
      starBtn.classList.toggle('opacity-40', !phone);
      starBtn.classList.toggle('pointer-events-none', !phone);
      starBtn.classList.toggle('text-brand-yellow', isPri);
      starBtn.classList.toggle('border-brand-yellow/50', isPri);
      starBtn.classList.toggle('bg-brand-yellow/10', isPri);
      starBtn.classList.toggle('text-brand-muted', !isPri);
      if (icon) {
        if (isPri) {
          icon.setAttribute('fill', 'currentColor');
          icon.removeAttribute('stroke');
        } else {
          icon.setAttribute('fill', 'none');
          icon.setAttribute('stroke', 'currentColor');
          icon.setAttribute('stroke-width', '2');
        }
      }
      starBtn.setAttribute('aria-pressed', isPri ? 'true' : 'false');
      starBtn.title = isPri ? 'Primary dial number' : 'Set as primary dial number';
    }
  }

  function renderRowSocialBrandLinksHtml(row, gradSuffix) {
    if (!row || !row.dataset) return '';
    const suffix =
      gradSuffix != null
        ? String(gradSuffix)
        : String(row.dataset.leadKey || row.id || 'row').replace(/[^a-z0-9]+/gi, '-');
    const mapCenter = readPipelineRowMapCenter(row);
    const mapsHref = resolveGoogleMapsSocialHref(
      row.dataset.url,
      row.dataset.title,
      mapCenter || readPipelineRowDisplayAddress(row) || row.dataset.address,
      row.dataset.city
    );
    const links = {
      gm: mapsHref || '',
      fb: sanitizeSocialUrl(row.dataset.facebook),
      ig: sanitizeSocialUrl(row.dataset.instagram),
      tw: sanitizeSocialUrl(row.dataset.twitter),
      gradSuffix: suffix,
    };
    if (__socialBrand) {
      const html = __socialBrand.renderLinks(links);
      return html && html.includes('<a ') ? html : '';
    }
    const slot = renderLeadSocialsSlotInner(
      mapsHref,
      row.dataset.facebook,
      row.dataset.instagram,
      row.dataset.twitter,
      row.dataset.title,
      row.dataset.address,
      row.dataset.city,
      suffix
    );
    const m = slot.match(/<div[^>]*>([\s\S]*)<\/div>/);
    if (m) return m[1].includes('<a ') ? m[1] : '';
    return slot.includes('<a ') ? slot : '';
  }

  function syncHeaderSocialsRow(row) {
    const el = document.getElementById('mobilePanelHeaderSocials');
    const rowWrap = document.getElementById('headerSocialsRow');
    if (!el) return;
    const html = renderRowSocialBrandLinksHtml(row, `panel-${String(row.dataset.leadKey || row.id || 'x').replace(/[^a-z0-9]+/gi, '-')}`);
    el.innerHTML = html;
    const hasLinks = html && html.includes('<a ');
    if (rowWrap) rowWrap.classList.toggle('hidden', !hasLinks);
  }

  function syncRowSocialsUnderPhone(row) {
    if (!row || typeof row.querySelector !== 'function') return;
    const html = renderRowSocialBrandLinksHtml(row);
    const slot = row.querySelector('.lead-cell-socials-content');
    if (slot) slot.innerHTML = html;
  }

  function syncLeadCallAiAnalyzeCta(row) {
    const wrap = document.getElementById('leadCallAiAnalyzeWrap');
    const btn = document.getElementById('leadCallAiAnalyzeBtn');
    if (!wrap || !btn) return;
    const hasAnalysis = !!getAiAnalysisFromRow(row);
    const hasWebsite = row.dataset.website && row.dataset.website !== 'N/A';
    if (hasWebsite) {
      wrap.classList.remove('hidden');
      btn.textContent = hasAnalysis ? 'Re-run AI analyze' : 'AI analyze';
    } else {
      wrap.classList.add('hidden');
    }
  }

  function syncLeadPanelStickyDock(row) {
    const meta = document.getElementById('leadPanelStickyMeta');
    if (meta) {
      const pipe = String(row.dataset.pipelineLabel || row.dataset.pipelineStage || '').trim();
      const st = String(row.dataset.status || '').trim();
      const ms = parseInt(row.dataset.lastTouchMs || '', 10);
      const bits = [];
      if (pipe) bits.push(pipe);
      if (st) bits.push(st);
      if (ms && Number.isFinite(ms)) {
        try {
          bits.push(
            `Last activity ${new Date(ms).toLocaleString(undefined, {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}`
          );
        } catch (_) {
          /* skip last activity if date invalid */
        }
      }
      if (!bits.length) {
        meta.textContent = '';
        meta.classList.add('hidden');
        meta.setAttribute('aria-hidden', 'true');
      } else {
        meta.textContent = bits.join(' · ');
        meta.classList.remove('hidden');
        meta.removeAttribute('aria-hidden');
      }
    }
    syncLeadPanelLocalTime(row);
    if (typeof window.__adhelloSyncRecordingControls === 'function') {
      window.__adhelloSyncRecordingControls();
    }
  }

  function syncLeadCallTalkingPoints(row) {
    const ul = document.getElementById('leadCallTalkingPoints');
    if (!ul) return;
    ul.innerHTML = '';
    const revDom = readPipelineRowReviewsSnapshot(row);
    const reviews = revDom.reviews || parseInt(row.dataset.reviews, 10) || 0;
    const rating = revDom.rating || parseFloat(row.dataset.rating) || 0;
    const web = String(row.dataset.website || '').trim();
    const hasWeb = web && web !== 'N/A' && web.length > 2;
    const add = (text) => {
      const li = document.createElement('li');
      li.className = 'pl-3 border-l-2 border-brand-yellow/50 text-brand-dark dark:text-slate-200';
      li.textContent = text;
      ul.appendChild(li);
    };
    if (reviews > 0) {
      add(`${reviews} Google reviews${rating > 0 ? ` at ${rating.toFixed(1)}★` : ''} — social proof angle.`);
    }
    add(hasWeb ? 'Website on file — reference something specific from their site.' : 'No website on file — lead with missed calls / credibility gap.');
    const flags = [];
    if (row.dataset.hasChatbot === 'false') flags.push('no chatbot');
    if (row.dataset.isMobileFriendly === 'false') flags.push('mobile issues');
    if (row.dataset.hasClickToCall === 'false') flags.push('click-to-call broken');
    if (row.dataset.hasSchemaMarkup === 'false') flags.push('GEO schema weak');
    if (flags.length) add(`Technical hooks: ${flags.join(', ')}.`);
  }

  function syncGoogleReviewsLink(row) {
    const a = document.getElementById('mobilePanelReviewsLink');
    if (!a) return;
    const addr = readPipelineRowDisplayAddress(row);
    const href = resolveGoogleMapsSocialHref(row.dataset.url, row.dataset.title, addr || row.dataset.address, row.dataset.city);
    if (href) {
      a.href = href;
      a.classList.remove('opacity-40', 'pointer-events-none', 'cursor-not-allowed');
    } else {
      a.href = '#';
      a.classList.add('opacity-40', 'pointer-events-none', 'cursor-not-allowed');
    }
  }

  let leadPrimaryServiceSelectPopulated = false;
  function ensureLeadPanelPrimaryServiceSelectOptions(force) {
    const sel = document.getElementById('leadPanelPrimaryServiceSelect');
    if (!sel) return;
    const offers = Array.isArray(window.ADHELLO_SERVICE_OFFERS) ? window.ADHELLO_SERVICE_OFFERS : [];
    if (!offers.length) return;
    const needRebuild = force || sel.options.length <= 1;
    if (!needRebuild && leadPrimaryServiceSelectPopulated) return;
    const prev = sel.value;
    sel.innerHTML = '<option value="">Let AI recommend…</option>';
    offers.forEach((o) => {
      if (!o || !o.key) return;
      const opt = document.createElement('option');
      opt.value = String(o.key);
      opt.textContent = o.label || o.key;
      sel.appendChild(opt);
    });
    leadPrimaryServiceSelectPopulated = true;
    if (prev && Array.from(sel.options).some((o) => o.value === prev)) sel.value = prev;
  }

  function syncLeadPrimaryServiceSelect(row) {
    ensureLeadPanelPrimaryServiceSelectOptions();
    const sel = document.getElementById('leadPanelPrimaryServiceSelect');
    if (!sel || !row) return;
    const v = String(row.dataset.primaryServiceKey || '').trim();
    const has = Array.from(sel.options).some((o) => o.value === v);
    sel.value = has ? v : '';
  }

  function syncOwnerFirstNameAndDnc(row) {
    const inp = document.getElementById('leadPanelOwnerFirstName');
    const dnc = document.getElementById('leadPanelDoNotCall');
    const raw = String(row.dataset.ownerFirstName || '').trim();
    const cqi = parseRowCqi(row);
    const fromCqi = cqi && String(cqi.decisionMakerName || '').trim();
    const firstFromFull = (full) => {
      const t = String(full || '').trim();
      if (!t) return '';
      return t.split(/\s+/)[0];
    };
    const fallback = firstFromFull(fromCqi);
    if (inp) inp.value = raw || fallback;
    if (dnc) dnc.checked = row.dataset.doNotCall === '1' || row.dataset.doNotCall === 'true';
  }

  function parseRowContacts(row) {
    try {
      const raw = row.dataset.contacts;
      if (!raw || raw === 'undefined') return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function mergeActivityEntries(row) {
    const out = [];
    let updates = [];
    try {
      updates = JSON.parse(row.dataset.updates || '[]');
    } catch {
      updates = [];
    }
    (Array.isArray(updates) ? updates : []).forEach((u) => {
      const ts = u.timestamp || u.ts || '';
      const val = u.value != null ? String(u.value) : '';
      const typ = String(u.type || 'update');
      out.push({ ts, typ, text: val, raw: u });
    });
    let logs = [];
    try {
      logs = JSON.parse(row.dataset.logsSnippet || '[]');
    } catch {
      logs = [];
    }
    (Array.isArray(logs) ? logs : []).forEach((e) => {
      const ts = e.timestamp || '';
      const msg = typeof e.message === 'string' ? e.message : JSON.stringify(e).slice(0, 220);
      const typ = String(e.type || 'log');
      out.push({ ts, typ, text: msg, raw: e });
    });
    out.sort((a, b) => {
      const ta = Date.parse(a.ts) || 0;
      const tb = Date.parse(b.ts) || 0;
      return tb - ta;
    });
    return out;
  }

  function renderLeadActivityTimeline(row, filter) {
    const host = document.getElementById('activityLog');
    if (!host) return;
    const entries = mergeActivityEntries(row);
    const f = String(filter || 'all');
    const filtered = entries.filter((e) => {
      if (f === 'all') return true;
      const t = `${e.typ} ${e.text}`.toLowerCase();
      if (f === 'calls') return /\bcall|dial|voicemail|phone\b/i.test(t);
      if (f === 'notes') return e.typ === 'note' || /\bnote\b/i.test(e.typ);
      return true;
    });
    if (!filtered.length) {
      host.innerHTML =
        '<div class="pl-10 text-xs text-brand-muted italic">No entries for this filter yet.</div>';
      return;
    }
    host.innerHTML = filtered
      .map((e) => {
        const when = e.ts
          ? new Date(e.ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
          : '—';
        const label = String(e.typ || '').replace(/_/g, ' ');
        return `<div class="relative pl-10">
          <div class="absolute left-1 top-1 w-2.5 h-2.5 rounded-full bg-brand-yellow shadow-sm ring-2 ring-white dark:ring-slate-900"></div>
          <p class="text-[9px] font-black uppercase tracking-widest text-brand-muted">${when} · ${label}</p>
          <p class="text-xs font-semibold text-brand-dark dark:text-slate-200 mt-1 leading-relaxed">${String(e.text || '')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')}</p>
        </div>`;
      })
      .join('');
  }

  function syncLeadPanelTouchSummary(row) {
    const el = document.getElementById('leadPanelTouchSummary');
    if (!el) return;
    let logs = [];
    try {
      logs = JSON.parse(row.dataset.logsSnippet || '[]');
    } catch {
      logs = [];
    }
    const total = Array.isArray(logs) ? logs.length : 0;
    let calls = 0;
    let connects = 0;
    (Array.isArray(logs) ? logs : []).forEach((e) => {
      const blob = `${e.type || ''} ${e.message || ''}`.toLowerCase();
      if (/\bcall|dial|voicemail|phone\b/.test(blob)) calls += 1;
      if (/connect|picked up|answered|meeting booked/.test(blob)) connects += 1;
    });
    const ms = parseInt(row.dataset.lastTouchMs || '', 10);
    const hasTouchMs = !!(ms && Number.isFinite(ms));
    let ago = '';
    if (hasTouchMs) {
      const days = Math.max(0, Math.round((Date.now() - ms) / 86400000));
      ago = days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`;
    }
    const hasActivityNoise = total > 0 || calls > 0 || connects > 0;
    if (!hasActivityNoise && !hasTouchMs) {
      el.textContent = '';
      el.classList.add('hidden');
      el.setAttribute('aria-hidden', 'true');
    } else {
      const segments = [];
      if (hasActivityNoise) {
        segments.push(`${calls} phone touches · ${connects} connect signals · ${total} log lines`);
      }
      if (hasTouchMs && ago) segments.push(`Last touch ${ago}`);
      el.textContent = segments.join(' · ');
      el.classList.remove('hidden');
      el.removeAttribute('aria-hidden');
    }
    const badge = document.getElementById('leadPanelCallCountsBadge');
    if (badge) {
      if (!hasActivityNoise) {
        badge.textContent = '';
        badge.classList.add('hidden');
      } else {
        badge.textContent = `${calls} dials · ${total} events`;
        badge.classList.remove('hidden');
      }
    }
  }

  let leadDetailChromeDidInit = false;
  function initLeadDetailPanelChrome() {
    if (leadDetailChromeDidInit) return;
    leadDetailChromeDidInit = true;

    document.querySelectorAll('[data-lead-tab-panel]').forEach((panel) => {
      panel.classList.remove('hidden');
    });

    document.querySelectorAll('.lead-activity-filter').forEach((btn) => {
      btn.addEventListener('click', () => {
        window.__leadActivityFilter = btn.getAttribute('data-activity-filter') || 'all';
        document.querySelectorAll('.lead-activity-filter').forEach((b) => {
          const on = b.getAttribute('data-activity-filter') === window.__leadActivityFilter;
          b.classList.toggle('bg-white', on);
          b.classList.toggle('dark:bg-slate-900', on);
          b.classList.toggle('text-brand-dark', on);
          b.classList.toggle('dark:text-white', on);
          b.classList.toggle('shadow-sm', on);
          b.classList.toggle('text-brand-muted', !on);
        });
        if (currentRow) renderLeadActivityTimeline(currentRow, window.__leadActivityFilter);
      });
    });

    const cqiIds = [
      'cqiFieldDecisionMaker',
      'cqiFieldYearsInBusiness',
      'cqiFieldMonthlyRevenue',
      'cqiFieldMarketingSpend',
      'cqiFieldBiggestPain',
      'cqiFieldCurrentlyUsing',
      'cqiFieldBudgetRange',
      'cqiFieldTimeline',
      'cqiFieldNotes',
    ];
    let cqiTimer = null;
    const scheduleCqiSave = () => {
      if (cqiTimer) clearTimeout(cqiTimer);
      cqiTimer = setTimeout(async () => {
        if (!currentRow || !currentRow.dataset.leadKey) return;
        const prev = parseRowCqi(currentRow) || {};
        const next = { ...prev, ...readCqiFormFromDom(), recordedAt: new Date().toISOString() };
        try {
          await postLeadJsonUpdate(currentRow, { cqi: next });
          currentRow.dataset.cqi = JSON.stringify(next);
          syncMobilePanelCqi(currentRow);
        } catch (e) {
          if (typeof window.showAppToast === 'function') window.showAppToast(e.message || 'CQI save failed', { variant: 'error' });
        }
      }, 500);
    };
    cqiIds.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', scheduleCqiSave);
      el.addEventListener('blur', scheduleCqiSave);
    });

    const ownerInp = document.getElementById('leadPanelOwnerFirstName');
    if (ownerInp) {
      const saveOwner = async () => {
        if (!currentRow || !currentRow.dataset.leadKey) return;
        const v = String(ownerInp.value || '').trim();
        try {
          await postLeadJsonUpdate(currentRow, { ownerFirstName: v });
          currentRow.dataset.ownerFirstName = v;
        } catch (e) {
          if (typeof window.showAppToast === 'function') window.showAppToast(e.message || 'Save failed', { variant: 'error' });
        }
      };
      ownerInp.addEventListener('blur', saveOwner);
      ownerInp.addEventListener('input', () => {
        if (currentRow) syncLeadPanelSellingScript(currentRow).catch(() => {});
      });
    }
    const dnc = document.getElementById('leadPanelDoNotCall');
    if (dnc) {
      dnc.addEventListener('change', async () => {
        if (!currentRow || !currentRow.dataset.leadKey) return;
        try {
          await postLeadJsonUpdate(currentRow, { doNotCall: !!dnc.checked });
          currentRow.dataset.doNotCall = dnc.checked ? '1' : '';
        } catch (e) {
          if (typeof window.showAppToast === 'function') window.showAppToast(e.message || 'Save failed', { variant: 'error' });
        }
      });
    }

    const leadRec = document.getElementById('leadPanelRecordToggle');
    if (leadRec) {
      leadRec.addEventListener('click', () => {
        if (typeof window.__adhelloToggleCloudRecording === 'function') {
          window.__adhelloToggleCloudRecording();
        }
      });
    }

    const cbBtn = document.getElementById('leadCallbackSaveBtn');
    if (cbBtn) {
      cbBtn.addEventListener('click', async () => {
        if (!currentRow || !currentRow.dataset.leadKey) {
          if (typeof window.showAppToast === 'function') window.showAppToast('Save the lead first.', { variant: 'error' });
          return;
        }
        const d = document.getElementById('leadCallbackDate');
        const t = document.getElementById('leadCallbackTime');
        const r = document.getElementById('leadCallbackReason');
        const rem = document.getElementById('leadCallbackRemind15');
        const dateStr = d && d.value ? d.value : '';
        const timeStr = t && t.value ? t.value : '';
        if (!dateStr || !timeStr) {
          if (typeof window.showAppToast === 'function') window.showAppToast('Pick a date and time.', { variant: 'error' });
          return;
        }
        const iso = new Date(`${dateStr}T${timeStr}:00`).toISOString();
        const titleBits = [`Callback: ${currentRow.dataset.title || 'Lead'}`];
        if (rem && rem.checked) titleBits.push('(remind T-15)');
        if (r && r.value.trim()) titleBits.push(`— ${r.value.trim()}`);
        try {
          const res = await fetch('/tasks/api', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
              title: titleBits.join(' '),
              scheduledAt: iso,
              leadKey: currentRow.dataset.leadKey,
              column: 'todo',
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data.success) throw new Error((data && data.error) || 'Task create failed');
          const hint = document.getElementById('leadCallbackTaskHint');
          if (hint) {
            hint.textContent = 'Task created — open Tasks to see it on your day.';
            hint.classList.remove('hidden');
          }
          if (typeof window.showAppToast === 'function') window.showAppToast('Callback scheduled', { variant: 'success' });
        } catch (e) {
          if (typeof window.showAppToast === 'function') window.showAppToast(e.message || 'Failed', { variant: 'error' });
        }
      });
    }

    document.querySelectorAll('.lead-notepad-tag').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tag = btn.getAttribute('data-tag') || '';
        const stamp = new Date().toLocaleString(undefined, { hour: 'numeric', minute: '2-digit' });
        const line = `[${stamp}] ${tag}: `;
        const inp = document.getElementById('noteInput');
        openLeadPanelComposer();
        if (inp) inp.value = `${line}${inp.value || ''}`.trimStart();
        inp && inp.focus();
      });
    });

    const leadNotepadScriptSelect = document.getElementById('leadNotepadScriptSelect');
    if (leadNotepadScriptSelect && !leadNotepadScriptSelect.dataset.adhelloBound) {
      leadNotepadScriptSelect.dataset.adhelloBound = '1';
      leadNotepadScriptSelect.addEventListener('change', () => {
        const idx = parseInt(leadNotepadScriptSelect.value, 10);
        const inp = document.getElementById('noteInput');
        if (
          !Number.isFinite(idx) ||
          idx < 0 ||
          !leadNotepadScriptOptions[idx] ||
          !inp ||
          !currentRow
        ) {
          leadNotepadScriptSelect.value = '';
          return;
        }
        const raw = leadNotepadScriptOptions[idx].text || '';
        const filled = fillLeadScriptPlaceholdersForNote(raw, currentRow);
        openLeadPanelComposer();
        const cur = String(inp.value || '').trim();
        inp.value = cur ? `${cur}\n\n${filled}` : filled;
        inp.focus();
        leadNotepadScriptSelect.value = '';
      });
    }

    const primaryServSel = document.getElementById('leadPanelPrimaryServiceSelect');
    if (primaryServSel && !primaryServSel.dataset.adhelloBound) {
      primaryServSel.dataset.adhelloBound = '1';
      primaryServSel.addEventListener('change', async () => {
        if (!currentRow) return;
        const val = String(primaryServSel.value || '').trim();
        if (currentRow.dataset) currentRow.dataset.primaryServiceKey = val || '';
        syncLeadPanelSellingScript(currentRow).catch(() => {});
        if (!currentRow.dataset.leadKey) return;
        try {
          await postLeadJsonUpdate(currentRow, { primaryServiceKey: val || null });
          scheduleKieServiceInsight(currentRow);
          if (typeof window.showProspectToast === 'function') {
            window.showProspectToast(val ? 'Offer focus saved' : 'AI recommendation enabled');
          }
        } catch (e) {
          if (typeof window.showAppToast === 'function') {
            window.showAppToast(e && e.message ? e.message : 'Failed', { variant: 'error' });
          }
          syncLeadPrimaryServiceSelect(currentRow);
        }
      });
    }

    const headerPhoneStar = document.getElementById('headerPhonePrimaryStar');
    if (headerPhoneStar && !headerPhoneStar.dataset.bound) {
      headerPhoneStar.dataset.bound = '1';
      headerPhoneStar.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!currentRow || !currentRow.dataset.leadKey) return;
        const displayPhone = readPipelineRowDisplayPhone(currentRow);
        if (!displayPhone) return;
        if (isHeaderPhonePrimary(currentRow, displayPhone)) {
          if (typeof window.showAppToast === 'function') {
            window.showAppToast('This number is already your primary dial number.', { variant: 'info' });
          }
          return;
        }
        let list = getLeadContactsList(currentRow).map((c) => ({ ...c }));
        let idx = list.findIndex((c) => leadPhonesMatch(c.phone, displayPhone));
        if (idx < 0) {
          list.push({
            role: 'Primary',
            name: '',
            phone: displayPhone,
            email: String(currentRow.dataset.email || '').trim(),
            primary: true,
          });
          idx = list.length - 1;
        }
        const next = list.map((c, j) => ({ ...c, primary: j === idx }));
        try {
          await postLeadJsonUpdate(currentRow, { contacts: next });
          currentRow.dataset.contacts = JSON.stringify(next);
          syncHeaderPhoneRow(currentRow);
          if (typeof window.showAppToast === 'function') {
            window.showAppToast('Primary dial number saved.', { variant: 'success' });
          }
        } catch (err) {
          if (typeof window.showAppToast === 'function') {
            window.showAppToast(err && err.message ? err.message : 'Could not save primary number', { variant: 'error' });
          }
        }
      });
    }

    document.querySelectorAll('.lead-outreach-channel').forEach((btn) => {
      if (btn.dataset.adhelloBound) return;
      btn.dataset.adhelloBound = '1';
      btn.addEventListener('click', () => {
        window.__leadOutreachChannel = btn.getAttribute('data-outreach-channel') || 'call';
        syncLeadOutreachChannelButtons();
        if (currentRow) syncLeadPanelSellingScript(currentRow).catch(() => {});
      });
    });

    const sellingCopyBtn = document.getElementById('leadPanelSellingScriptCopy');
    if (sellingCopyBtn && !sellingCopyBtn.dataset.adhelloBound) {
      sellingCopyBtn.dataset.adhelloBound = '1';
      sellingCopyBtn.addEventListener('click', async () => {
        const scriptEl = document.getElementById('leadPanelSellingScript');
        const text = scriptEl ? String(scriptEl.textContent || '').trim() : '';
        if (!text) return;
        try {
          await navigator.clipboard.writeText(text);
          if (typeof window.showAppToast === 'function') {
            window.showAppToast('Script copied.', { variant: 'success' });
          }
        } catch (_) {
          if (typeof window.showAppToast === 'function') {
            window.showAppToast('Could not copy script.', { variant: 'error' });
          }
        }
      });
    }
  }

  /** Maps listing URL if stored; otherwise a Google Maps search URL from address/title (matches detail panel socials). */
  function resolveGoogleMapsSocialHref(urlRaw, titleRaw, addressRaw, cityRaw) {
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
      } catch {
        return false;
      }
    };
    const raw = String(urlRaw || '').trim();
    if (raw && /^https?:\/\//i.test(raw) && isGoogleMapsListingUrl(raw)) {
      return raw;
    }
    const title = String(titleRaw || '').trim();
    const address = String(addressRaw || '').trim();
    const city = String(cityRaw || '').trim();
    if (address && address !== 'N/A') {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${address} ${title}`.trim())}`;
    }
    if (title && city) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${title} ${city}`.trim())}`;
    }
    if (title) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(title)}`;
    }
    return null;
  }

  const __socialBrand =
    typeof window !== 'undefined' && window.AdhelloSocialBrand ? window.AdhelloSocialBrand : null;
  const GOOGLE_BUSINESS_ICON_SVG =
    (__socialBrand && __socialBrand.GOOGLE_BUSINESS_ICON_SVG) ||
    '<svg class="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>';

  const GOOGLE_SOCIALS_TABLE_BTN_CLASS =
    (__socialBrand && __socialBrand.GOOGLE_SOCIALS_TABLE_BTN_CLASS) ||
    'inline-flex w-8 h-8 shrink-0 rounded-lg bg-brand-cream dark:bg-slate-800 items-center justify-center shadow-sm border border-brand-border/10 hover:bg-[#4285F4]/15 dark:hover:bg-[#4285F4]/25 transition-all hover:scale-105';

  let __leadPanelMapsJsBootLoading = false;
  function loadAdhelloGoogleMapsJs(cb) {
    const key =
      (typeof window !== 'undefined' && window.__ADHELLO_GOOGLE_MAPS_STATIC_KEY__) || '';
    if (!key) {
      cb(new Error('no_maps_key'));
      return;
    }
    if (typeof window !== 'undefined' && window.google && window.google.maps) {
      cb(null);
      return;
    }
    window.__adhelloMapsJsCallbacks = window.__adhelloMapsJsCallbacks || [];
    window.__adhelloMapsJsCallbacks.push(cb);
    if (__leadPanelMapsJsBootLoading) return;
    const existing = document.querySelector('script[data-adhello-google-maps-js-boot]');
    if (existing) {
      __leadPanelMapsJsBootLoading = true;
      return;
    }
    __leadPanelMapsJsBootLoading = true;
    const s = document.createElement('script');
    s.async = true;
    s.defer = true;
    s.setAttribute('data-adhello-google-maps-js-boot', '1');
    window.__adhelloGoogleMapsJsBoot = function mapsJsBoot() {
      __leadPanelMapsJsBootLoading = false;
      const q = window.__adhelloMapsJsCallbacks || [];
      window.__adhelloMapsJsCallbacks = [];
      q.forEach((fn) => {
        try {
          fn(null);
        } catch (e) {
          console.warn('[Google Maps JS]', e);
        }
      });
      try {
        delete window.__adhelloGoogleMapsJsBoot;
      } catch (_) {
        window.__adhelloGoogleMapsJsBoot = undefined;
      }
    };
    s.onerror = function mapsJsOnErr() {
      __leadPanelMapsJsBootLoading = false;
      const q = window.__adhelloMapsJsCallbacks || [];
      window.__adhelloMapsJsCallbacks = [];
      q.forEach((fn) => fn(new Error('maps_script_failed')));
    };
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=__adhelloGoogleMapsJsBoot`;
    document.head.appendChild(s);
  }

  let __leadPanelJsMap = null;
  let __leadPanelJsMarker = null;
  let __leadPanelJsGeocoder = null;
  let __leadPanelJsControlsBound = false;

  function bindLeadPanelJsMapControlsOnce() {
    if (__leadPanelJsControlsBound) return;
    __leadPanelJsControlsBound = true;
    const zIn = document.getElementById('leadPanelMapZoomIn');
    const zOut = document.getElementById('leadPanelMapZoomOut');
    if (zIn) {
      zIn.addEventListener('click', () => {
        if (!__leadPanelJsMap) return;
        __leadPanelJsMap.setZoom((__leadPanelJsMap.getZoom() || 12) + 1);
      });
    }
    if (zOut) {
      zOut.addEventListener('click', () => {
        if (!__leadPanelJsMap) return;
        __leadPanelJsMap.setZoom(Math.max(4, (__leadPanelJsMap.getZoom() || 12) - 1));
      });
    }
  }

  function resizeLeadPanelJsMapSoon() {
    if (!__leadPanelJsMap || typeof google === 'undefined' || !google.maps) return;
    const trigger = () => {
      try {
        google.maps.event.trigger(__leadPanelJsMap, 'resize');
      } catch (_) {}
    };
    requestAnimationFrame(() => {
      requestAnimationFrame(trigger);
    });
    [80, 240, 600].forEach((ms) => setTimeout(trigger, ms));
  }

  function syncLeadPanelInteractiveGoogleMap(opts, onFail, layoutAttempt) {
    const el = document.getElementById('leadPanelJsMap');
    const openLink = document.getElementById('leadPanelJsMapOpenLink');
    const centerQ = opts && String(opts.center || '').trim();
    const attempt = typeof layoutAttempt === 'number' ? layoutAttempt : 0;
    if (!el || !centerQ) {
      if (typeof onFail === 'function') onFail();
      return;
    }
    const minPx = 48;
    const layoutNotReady = el.offsetWidth < minPx || el.offsetHeight < minPx;
    if (layoutNotReady) {
      if (attempt === 0) {
        requestAnimationFrame(() =>
          syncLeadPanelInteractiveGoogleMap(opts, onFail, 1)
        );
      } else if (attempt < 8) {
        setTimeout(
          () => syncLeadPanelInteractiveGoogleMap(opts, onFail, attempt + 1),
          100 + attempt * 40
        );
      } else if (typeof onFail === 'function') {
        onFail();
      }
      return;
    }
    if (openLink && opts.mapsHref) openLink.href = opts.mapsHref;
    bindLeadPanelJsMapControlsOnce();

    loadAdhelloGoogleMapsJs((err) => {
      if (err || typeof google === 'undefined' || !google.maps) {
        if (typeof onFail === 'function') onFail();
        return;
      }
      try {
        if (!__leadPanelJsMap) {
          __leadPanelJsMap = new google.maps.Map(el, {
            zoom: 15,
            center: { lat: 45.5152, lng: -122.6784 },
            gestureHandling: 'greedy',
            mapTypeControl: true,
            mapTypeControlOptions: {
              position: google.maps.ControlPosition.TOP_RIGHT,
            },
            zoomControl: false,
            streetViewControl: false,
            fullscreenControl: true,
            fullscreenControlOptions: {
              position: google.maps.ControlPosition.TOP_RIGHT,
            },
          });
          __leadPanelJsGeocoder = new google.maps.Geocoder();
        }
        resizeLeadPanelJsMapSoon();
        __leadPanelJsGeocoder.geocode({ address: centerQ }, (results, status) => {
          if (status !== 'OK' || !results || !results[0]) {
            if (typeof onFail === 'function') onFail();
            return;
          }
          const geo = results[0].geometry;
          const loc = geo.location;
          if (geo.viewport) __leadPanelJsMap.fitBounds(geo.viewport);
          else {
            __leadPanelJsMap.setCenter(loc);
            __leadPanelJsMap.setZoom(15);
          }
          if (__leadPanelJsMarker) __leadPanelJsMarker.setMap(null);
          __leadPanelJsMarker = new google.maps.Marker({
            map: __leadPanelJsMap,
            position: loc,
            title: opts.title || opts.address || '',
          });
          resizeLeadPanelJsMapSoon();
        });
      } catch (e) {
        console.warn('[Lead panel interactive map]', e);
        if (typeof onFail === 'function') onFail();
      }
    });
  }

  function syncLeadPanelWideMapAndGoogleChip(row, opts) {
    opts = opts || {};
    const skipInteractive = !!opts.skipInteractive;
    const mapKey =
      (typeof window !== 'undefined' && window.__ADHELLO_GOOGLE_MAPS_STATIC_KEY__) || '';
    const title = String(row.dataset.title || '').trim();
    const address = readPipelineRowDisplayAddress(row);
    const city = String(row.dataset.city || '').trim();
    const center = readPipelineRowMapCenter(row);
    const mapsUrl = center
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(center)}`
      : '';
    const gmListing = resolveGoogleMapsSocialHref(
      row.dataset.url,
      row.dataset.title,
      center || address || row.dataset.address,
      row.dataset.city
    );
    const chipHref = gmListing || mapsUrl || '';

    const hrefOpen = chipHref || mapsUrl || '';
    const mapStripWrap = document.getElementById('leadPanelMapStripWrap');
    const setLeadPanelMapEmbedMode = (on) => {
      if (!mapStripWrap) return;
      mapStripWrap.classList.toggle('lead-panel-map-embed-mode', !!on);
    };
    const jsMapWrap = document.getElementById('leadPanelJsMapWrap');
    const heroBackdropEl = document.getElementById('leadPanelHeroBackdrop');
    const preferInteractiveLeadMap =
      typeof window !== 'undefined' && window.__ADHELLO_LEAD_PANEL_JS_MAP__ === true;
    const preferJsMap =
      preferInteractiveLeadMap &&
      !skipInteractive &&
      !!(mapKey && hrefOpen && String(center || '').trim());

    if (mapStripWrap) {
      mapStripWrap.classList.toggle('lead-panel-hero-map', !!hrefOpen);
      mapStripWrap.classList.toggle('hidden', !hrefOpen);
      mapStripWrap.classList.toggle('lead-panel-js-map-mode', !!(hrefOpen && preferJsMap));
    }

    const heroLink = document.getElementById('leadPanelHeroBackdropLink');
    const heroImg = document.getElementById('leadPanelHeroBackdropImg');
    const heroEmbed = document.getElementById('leadPanelHeroBackdropEmbed');
    const heroFallback = document.getElementById('leadPanelHeroBackdropFallback');
    let headerMapBannerActive = false;

    /** Matches Focus page embed behavior; Embed API when key is configured (enable Maps Embed API on the key). */
    const heroEmbedSrcForQuery = (centerQuery) => {
      const q = encodeURIComponent(centerQuery);
      if (mapKey) {
        return `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(mapKey)}&q=${q}&zoom=15&maptype=roadmap`;
      }
      return `https://maps.google.com/maps?q=${q}&hl=en&z=15&output=embed`;
    };

    if (heroLink && heroImg && heroFallback && heroEmbed) {
      const paintHeroBackdrop = () => {
        setLeadPanelMapEmbedMode(false);
        heroImg.onload = null;
        heroImg.onerror = null;
        heroImg.removeAttribute('src');
        heroImg.classList.add('hidden');
        heroEmbed.removeAttribute('src');
        heroEmbed.classList.add('hidden');
        heroFallback.classList.add('hidden');
        heroFallback.classList.remove('flex', 'flex-col');

        if (!hrefOpen) {
          heroLink.href = '#';
          heroLink.classList.add('pointer-events-none');
          headerMapBannerActive = false;
        } else {
          headerMapBannerActive = true;
          heroLink.href = hrefOpen;
          heroLink.classList.remove('pointer-events-none');

          const showHeroPinFallback = () => {
            setLeadPanelMapEmbedMode(false);
            heroImg.classList.add('hidden');
            heroImg.removeAttribute('src');
            heroEmbed.removeAttribute('src');
            heroEmbed.classList.add('hidden');
            heroFallback.classList.remove('hidden');
            heroFallback.classList.add('flex', 'flex-col');
          };

          const openHeroEmbed = () => {
            if (!center) return false;
            heroImg.classList.add('hidden');
            heroImg.removeAttribute('src');
            heroEmbed.src = heroEmbedSrcForQuery(center);
            heroEmbed.title = address
              ? `Map · ${address.slice(0, 100)}`
              : title
                ? `Location · ${title}`
                : 'Business location';
            heroEmbed.classList.remove('hidden');
            setLeadPanelMapEmbedMode(true);
            heroFallback.classList.add('hidden');
            heroFallback.classList.remove('flex', 'flex-col');
            return true;
          };

          if (mapKey && center) {
            const heroMapUrl = buildGoogleStaticMapUrl(center, mapKey, 640, 320);
            heroImg.onload = () => {
              setLeadPanelMapEmbedMode(false);
              heroImg.classList.remove('hidden');
              heroEmbed.removeAttribute('src');
              heroEmbed.classList.add('hidden');
              heroFallback.classList.add('hidden');
              heroFallback.classList.remove('flex', 'flex-col');
            };
            heroImg.onerror = () => {
              heroImg.classList.add('hidden');
              heroImg.removeAttribute('src');
              if (!openHeroEmbed()) showHeroPinFallback();
            };
            heroImg.alt = address
              ? `Map near ${address.slice(0, 120)}`
              : title
                ? `Location of ${title}`
                : 'Location map';
            requestAnimationFrame(() => {
              heroImg.src = heroMapUrl;
            });
          } else if (openHeroEmbed()) {
            /* embedded map, no static API key */
          } else {
            showHeroPinFallback();
          }
        }
      };

      if (!hrefOpen) {
        if (jsMapWrap) jsMapWrap.classList.add('hidden');
        if (heroBackdropEl) heroBackdropEl.classList.add('hidden');
        paintHeroBackdrop();
      } else if (preferJsMap) {
        if (jsMapWrap) jsMapWrap.classList.remove('hidden');
        if (heroBackdropEl) heroBackdropEl.classList.add('hidden');
        setLeadPanelMapEmbedMode(false);
        heroImg.onload = null;
        heroImg.onerror = null;
        heroImg.removeAttribute('src');
        heroImg.classList.add('hidden');
        heroEmbed.removeAttribute('src');
        heroEmbed.classList.add('hidden');
        heroFallback.classList.add('hidden');
        heroFallback.classList.remove('flex', 'flex-col');
        heroLink.href = hrefOpen;
        heroLink.classList.remove('pointer-events-none');
        headerMapBannerActive = true;

        syncLeadPanelInteractiveGoogleMap(
          { center, mapsHref: hrefOpen, title, address },
          () => {
            syncLeadPanelWideMapAndGoogleChip(row, { skipInteractive: true });
          }
        );
      } else {
        if (jsMapWrap) jsMapWrap.classList.add('hidden');
        if (heroBackdropEl) heroBackdropEl.classList.remove('hidden');
        paintHeroBackdrop();
      }
    }

    const chipRow = document.getElementById('mobilePanelGoogleMapsChipRow');
    const chip = document.getElementById('mobilePanelGoogleMapsChip');
    const hideDuplicateMapsChip = !!(chipHref && hrefOpen && center.trim());
    if (chip && chipRow) {
      if (chipHref) {
        chip.href = chipHref;
        chip.innerHTML = `${GOOGLE_BUSINESS_ICON_SVG}<span class="text-[11px] font-bold normal-case tracking-normal text-brand-dark dark:text-slate-200">Google Maps</span>`;
        chipRow.classList.toggle('hidden', hideDuplicateMapsChip);
      } else {
        chip.innerHTML = '';
        chip.href = '#';
        chipRow.classList.add('hidden');
      }
    }

    const wrap = document.getElementById('mobilePanelMapWideWrap');
    const wideLink = document.getElementById('mobilePanelMapWideLink');
    const wideImg = document.getElementById('mobilePanelMapWideImg');
    const fallback = document.getElementById('mobilePanelMapWideFallback');
    if (!wrap || !wideLink || !wideImg || !fallback) return;

    wideImg.onload = null;
    wideImg.onerror = null;
    wideImg.removeAttribute('src');
    wideImg.classList.add('hidden');
    fallback.style.display = 'none';

    if (!chipHref && !center) {
      wrap.classList.add('hidden');
      return;
    }

    if (headerMapBannerActive) {
      wrap.classList.add('hidden');
      return;
    }

    wideLink.href = chipHref || mapsUrl || '#';
    wrap.classList.remove('hidden');

    const showStaticFallback = () => {
      wideImg.classList.add('hidden');
      fallback.style.display = 'flex';
    };

    if (mapKey && center) {
      const staticUrl = buildGoogleStaticMapUrl(center, mapKey, 640, 280);
      wideImg.onload = () => {
        wideImg.classList.remove('hidden');
        fallback.style.display = 'none';
      };
      wideImg.onerror = () => {
        showStaticFallback();
      };
      wideImg.alt = address
        ? `Map near ${address.slice(0, 120)}`
        : title
          ? `Location of ${title}`
          : 'Location map';
      requestAnimationFrame(() => {
        wideImg.src = staticUrl;
      });
    } else {
      showStaticFallback();
    }
  }

  const CADENCE_CHANNEL_LABELS = {
    call: 'Phone call',
    email: 'Email',
    sms: 'SMS',
    social_dm: 'Social DM',
    linkedin: 'LinkedIn',
    hosted_audit: 'Hosted audit',
    voicemail: 'Voicemail',
    meeting: 'Meeting',
    other: 'Other',
  };

  function cadenceHintFromChannel(channel) {
    const ch = String(channel || '').trim();
    if (ch === 'email') {
      return 'If no reply within 48 hours, follow with a quick call or DM referencing the same hook.';
    }
    if (ch === 'call' || ch === 'voicemail') {
      return 'Send a short email with one concrete observation and a soft calendar ask.';
    }
    if (ch === 'sms') {
      return 'Pair SMS with email so stakeholders have something forwardable.';
    }
    if (ch === 'linkedin') {
      return 'Bridge to email or phone while you have attention — send the audit link or book 15 minutes.';
    }
    if (ch === 'social_dm') {
      return 'Move the thread toward email or a call for clear next steps.';
    }
    if (ch === 'meeting') {
      return 'Send a recap with owners and dates before the deal goes idle.';
    }
    return 'Alternate channels every few days until you connect or get a clear outcome — log each touch.';
  }

  function populateCadenceSection(row) {
    const ltEl = document.getElementById('cadenceLastTouchLine');
    const chEl = document.getElementById('cadenceChannelLine');
    const seqWrap = document.getElementById('cadenceSequenceWrap');
    const seqLine = document.getElementById('cadenceSequenceLine');
    const nextEl = document.getElementById('cadenceNextStepLine');
    const logsWrap = document.getElementById('cadenceLogsWrap');
    const logList = document.getElementById('cadenceLogList');
    if (!ltEl || !chEl || !nextEl) return;

    const ms = parseInt(row.dataset.lastTouchMs || '', 10);
    let lastTouchText = '—';
    if (ms && Number.isFinite(ms)) {
      try {
        lastTouchText = new Date(ms).toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        });
      } catch (_) {
        lastTouchText = '—';
      }
    }
    ltEl.textContent = lastTouchText;

    const rawCh = String(row.dataset.lastTouchChannel || '').trim();
    chEl.textContent =
      CADENCE_CHANNEL_LABELS[rawCh] || (rawCh ? rawCh.replace(/_/g, ' ') : 'Not set');

    let seq = null;
    try {
      seq = JSON.parse(row.dataset.sequenceState || 'null');
    } catch (_) {
      seq = null;
    }
    if (seqWrap && seqLine) {
      const tid = seq && seq.templateId ? String(seq.templateId) : '';
      const st = seq && seq.status ? String(seq.status) : '';
      const ix = seq && typeof seq.stepIndex === 'number' ? seq.stepIndex : 0;
      if (tid || st) {
        seqLine.textContent = tid
          ? `${tid.replace(/_/g, ' ')} · step ${ix + 1}${st ? ` · ${st}` : ''}`
          : st;
        seqWrap.classList.remove('hidden');
      } else {
        seqLine.textContent = '—';
        seqWrap.classList.add('hidden');
      }
    }

    nextEl.textContent = cadenceHintFromChannel(rawCh);

    let logs = [];
    try {
      logs = JSON.parse(row.dataset.logsSnippet || '[]');
    } catch (_) {
      logs = [];
    }
    if (logsWrap && logList) {
      logList.innerHTML = '';
      if (Array.isArray(logs) && logs.length) {
        logsWrap.classList.remove('hidden');
        logs.slice(-8).forEach((entry) => {
          const li = document.createElement('li');
          li.className =
            'border-l-2 border-brand-yellow/40 pl-3 py-1 text-brand-muted dark:text-slate-400';
          const ts = entry.timestamp ? new Date(entry.timestamp).toLocaleString() : '';
          const msg =
            typeof entry.message === 'string'
              ? entry.message
              : JSON.stringify(entry).slice(0, 180);
          li.textContent = ts ? `${ts} — ${msg}` : msg;
          logList.appendChild(li);
        });
      } else {
        logsWrap.classList.add('hidden');
      }
    }
  }

  function buildGoogleStaticMapUrl(center, key, width, height) {
    const c = String(center || '').trim();
    const k = String(key || '').trim();
    const w = Math.min(640, Math.max(100, parseInt(width, 10) || 256));
    const h = Math.min(640, Math.max(100, parseInt(height, 10) || 256));
    if (!c || !k) return '';
    const encCenter = encodeURIComponent(c);
    const encKey = encodeURIComponent(k);
    const encMarkers = encodeURIComponent(`color:0xEAB308|${c}`);
    return `https://maps.googleapis.com/maps/api/staticmap?center=${encCenter}&zoom=15&size=${w}x${h}&scale=2&maptype=roadmap&markers=${encMarkers}&key=${encKey}`;
  }

  function syncMobilePanelHeroMap(row) {
    const mapImg = document.getElementById('mobilePanelStaticMapImg');
    const mapLink = document.getElementById('mobilePanelMapLink');
    const mobileAvatar = document.getElementById('mobilePanelAvatar');
    if (!mobileAvatar) return;

    const title = String(row.dataset.title || '').trim();
    const center = readPipelineRowMapCenter(row);
    const mapsUrl = center
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(center)}`
      : '';

    if (mapLink) {
      if (mapsUrl) {
        mapLink.href = mapsUrl;
        mapLink.target = '_blank';
        mapLink.rel = 'noopener noreferrer';
        mapLink.setAttribute('aria-label', 'Open location in Google Maps');
        mapLink.classList.remove('pointer-events-none');
        mapLink.classList.add('cursor-pointer');
      } else {
        mapLink.href = '#';
        mapLink.removeAttribute('target');
        mapLink.removeAttribute('rel');
        mapLink.setAttribute('aria-label', 'Location not available');
        mapLink.classList.add('pointer-events-none');
        mapLink.classList.remove('cursor-pointer');
      }
    }

    if (mapImg) {
      mapImg.onload = null;
      mapImg.onerror = null;
      mapImg.removeAttribute('src');
      mapImg.classList.add('hidden');
    }
    mobileAvatar.classList.remove('hidden');
  }

  /** Hoisted above populatePanel so early callers (e.g. focusLead query sync IIFE) never hit TDZ on panel helpers. */
  function renderStarsInElement(element, rating, starSizeClass = 'w-3 h-3') {
    if (!element) return;
    element.innerHTML = '';
    const r = Math.max(0, Math.min(5, Number(rating) || 0));
    const fullStars = Math.floor(r);
    const hasHalf = r % 1 >= 0.5;

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
  }

  function renderStars(
    rating,
    reviews,
    containerId = 'mobilePanelStars',
    textId = 'mobilePanelRatingText',
    starSizeClass = 'w-3 h-3'
  ) {
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
  }

  // --- Populate panel from row data ---
  function populatePanel(row) {
    closeLeadPanelComposer();

    const title = row.dataset.title;
    const phone = readPipelineRowDisplayPhone(row);
    const website = row.dataset.website;
    const revSnap = readPipelineRowReviewsSnapshot(row);
    const rating = revSnap.rating;
    const reviews = revSnap.reviews;
    const url = row.dataset.url;
    const email = row.dataset.email;
    const facebook = row.dataset.facebook;
    const instagram = row.dataset.instagram;
    const twitter = row.dataset.twitter;
    const address = readPipelineRowDisplayAddress(row);
    const category = row.dataset.category;
    const loomUrl = row.dataset.loomUrl;

    const lkHydrate = row.dataset.leadKey || '';
    if (
      lkHydrate &&
      row.dataset.panelHydrateAttempted !== '1' &&
      (!phone || !address)
    ) {
      row.dataset.panelHydrateAttempted = '1';
      fetch(`/leads/${encodeURIComponent(lkHydrate)}/panel-data`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      })
        .then((r) => r.json())
        .then((data) => {
          if (!data || !data.success || !data.lead) return;
          syncPersistedLeadToRowDataset(row, data.lead);
          if (currentRow === row) populatePanel(row);
        })
        .catch(() => {});
    }

    // Avatar & Sticky Title Logic
    const mobileAvatar = document.getElementById('mobilePanelAvatar');
    const stickyPanelTitle = document.getElementById('stickyPanelTitle');
    if (mobileAvatar) {
        mobileAvatar.textContent = (title || 'A').charAt(0).toUpperCase();
    }
    syncMobilePanelHeroMap(row);
    if (stickyPanelTitle) {
        stickyPanelTitle.textContent = title || 'Company Details';
    }

    const panelTitle = document.getElementById('mobilePanelTitle');
    if (panelTitle) panelTitle.textContent = title;

    const tasksDeep = document.getElementById('leadTasksDeepLink');
    if (tasksDeep) {
      const lk = row.dataset.leadKey || '';
      if (lk) {
        tasksDeep.href = '/tasks?leadKey=' + encodeURIComponent(lk);
        tasksDeep.classList.remove('hidden');
      } else {
        tasksDeep.classList.add('hidden');
      }
    }

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

    // Stars, maps chip, and header contact lines must run before cadence — cadence DOM/JSON edge cases must not block them.
    renderStars(rating, reviews, 'mobilePanelStars', 'mobilePanelRatingText', 'w-4 h-4');

    syncGoogleReviewsLink(row);

    const mapsLink = document.getElementById('mobilePanelMapsLink');
    if (mapsLink) {
      if (address) {
        mapsLink.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${address} ${title || ''}`.trim())}`;
        mapsLink.classList.remove('opacity-20', 'pointer-events-none');
      } else {
        mapsLink.href = '#';
        mapsLink.classList.add('opacity-20', 'pointer-events-none');
      }
    }

    const headerAddress = document.getElementById('mobilePanelHeaderAddress');
    if (headerAddress) {
      const locationLine = readPipelineRowLocationLine(row);
      headerAddress.textContent = locationLine || '—';
    }
    syncHeaderPhoneRow(row);
    syncHeaderSocialsRow(row);
    syncLeadCallAiAnalyzeCta(row);

    syncLeadPanelWideMapAndGoogleChip(row);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resizeLeadPanelJsMapSoon());
    });

    try {
      populateCadenceSection(row);
    } catch (cadenceErr) {
      console.error('[Lead detail panel] populateCadenceSection failed:', cadenceErr);
    }

    syncMobilePanelCqi(row);

    syncLeadNotepadScripts(row).catch((err) => {
      console.warn('[Lead panel] syncLeadNotepadScripts failed:', err);
      const sel = document.getElementById('leadNotepadScriptSelect');
      if (!sel || !currentRow) return;
      try {
        sel.disabled = false;
        sel.innerHTML = '';
        const ph = document.createElement('option');
        ph.value = '';
        ph.textContent = 'Choose script…';
        sel.appendChild(ph);
        leadNotepadScriptOptions = defaultLeadNotepadScriptFallback(currentRow);
        leadNotepadScriptOptions.forEach((opt, idx) => {
          const o = document.createElement('option');
          o.value = String(idx);
          o.textContent = opt.label || `Script ${idx + 1}`;
          sel.appendChild(o);
        });
      } catch (_) {}
    });

    const resolveGoogleBusinessProfileUrlFromRow = (r) =>
      resolveGoogleMapsSocialHref(
        r.dataset.url,
        r.dataset.title,
        readPipelineRowDisplayAddress(r) || r.dataset.address,
        r.dataset.city
      );


    syncLeadPrimaryServiceSelect(row);
    leadOutreachScriptsCache = { leadKey: '', data: null, loading: null, loadingKey: '' };
    syncLeadPanelSellingScript(row).catch((err) => {
      console.warn('[Lead panel] syncLeadPanelSellingScript failed:', err);
    });

    // Phone logic
    const phoneEl = document.getElementById('mobilePanelPhone');
    const phoneLink = document.getElementById('mobilePanelPhoneLink');
    const phoneRow = document.getElementById('mobilePanelPhoneRow');
    
    if (phoneEl) {
        phoneEl.textContent = phone ? phone : '—';
    }
    
    if (phoneLink) {
        if (phone) {
            phoneLink.href = '#';
            phoneLink.classList.add('js-click-to-call-number');
            phoneLink.dataset.phone = phone;
            if (row.dataset.leadKey) phoneLink.dataset.leadKey = row.dataset.leadKey;
            phoneLink.classList.remove('opacity-20', 'pointer-events-none');
            phoneLink.onclick = (e) => { e.preventDefault(); e.stopPropagation(); };
            if (phoneRow) phoneRow.onclick = () => { phoneLink.click(); };
        } else {
            phoneLink.href = '#';
            phoneLink.classList.remove('js-click-to-call-number');
            delete phoneLink.dataset.phone;
            delete phoneLink.dataset.leadKey;
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

    // Address & Maps logic (tile below engagement center)
    const addressEl = document.getElementById('mobilePanelAddress');
    if (addressEl) addressEl.textContent = address ? address : 'Location Hidden';

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

    const evInput = document.getElementById('estimatedValueInput');
    if (evInput) {
      const raw =
        row.dataset.estimatedValue != null ? String(row.dataset.estimatedValue).trim() : '';
      evInput.value = raw || '';
    }

    const auditStatus = document.getElementById('mobilePanelAuditStatus');
    if (auditStatus) {
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
        scheduleKieServiceInsight(row);
    }
    if (aiScorePill) {
      const aiGap = getAiAuditGap10FromDataset(row.dataset);
      if (aiGap != null && aiGap > 0) {
        aiScorePill.textContent = `AI ${aiGap}`;
        aiScorePill.classList.remove('hidden');
      } else {
        aiScorePill.classList.add('hidden');
      }
    }
    if (ownerSignalEl) {
      const ownerSignal = String(row.dataset.ownerSignal || '').trim();
      ownerSignalEl.textContent =
        ownerSignal || 'Run AI Analysis to generate a concrete signal for this business.';
    }
    if (aiAnalysisBtn) {
      aiAnalysisBtn.disabled = false;
      aiAnalysisBtn.classList.remove('opacity-50', 'cursor-not-allowed');
      const hasWebsite = row.dataset.website && row.dataset.website !== 'N/A';
      if (!hasWebsite) {
        aiAnalysisBtn.disabled = true;
        aiAnalysisBtn.classList.add('opacity-50', 'cursor-not-allowed');
      }
      aiAnalysisBtn.onclick = async () => {
        if (!hasWebsite) return;
        const original = aiAnalysisBtn.innerHTML;
        aiAnalysisBtn.disabled = true;
        aiAnalysisBtn.innerHTML = 'Analyzing…';
        try {
          const result = await runAiAnalysisForRow(row);
          const ra = (result && result.analysis) || {};
          const healthToast = resolveSiteHealth100(ra);
          const priorT = ra.priorAuditSnapshot;
          let toastMsg = `AI analysis complete (overall ${healthToast}/100, ${ra.rubricVersion || 'rubric_v1.2'})`;
          if (priorT && priorT.auditedAt && Number.isFinite(Number(priorT.siteHealth100))) {
            toastMsg += ` — up from ${Math.round(Number(priorT.siteHealth100))}/100 on last crawl`;
          }
          if (typeof window.showAppToast === 'function') {
            window.showAppToast(toastMsg, { variant: 'success' });
          }
        } catch (err) {
          const msg = err && err.message ? err.message : 'AI analysis failed';
          if (typeof window.showAppToast === 'function') window.showAppToast(msg, { variant: 'error' });
          else window.alert(msg);
        } finally {
          aiAnalysisBtn.disabled = false;
          aiAnalysisBtn.innerHTML = original;
        }
      };
    }
    syncSidebarOutreachButtons(row);

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

    syncLeadPanelStickyDock(row);
    syncLeadCallTalkingPoints(row);
    syncOwnerFirstNameAndDnc(row);
    window.__leadActivityFilter = window.__leadActivityFilter || 'all';
    renderLeadActivityTimeline(row, window.__leadActivityFilter);
    syncLeadPanelTouchSummary(row);
  }

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
    const newStageId = String(sel.value || '').trim();
    if (!newStageId) return;
    const prevId = String(row.dataset.stageId || '').trim();
    if (newStageId === prevId) return;
    sel.disabled = true;
    try {
      const res = await fetch(`/leads/${encodeURIComponent(key)}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          stageId: newStageId,
          pipelineStageUpdatedAt: new Date().toISOString(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        const lead = data.lead || {};
        row.dataset.stageId = newStageId;
        if (lead.pipelineStage != null) {
          row.dataset.pipelineStage = String(lead.pipelineStage);
        }
        const labels = window.PIPELINE_STAGE_LABELS || {};
        const fullName = labels[newStageId] || '';
        const short =
          (fullName.split('(')[0].trim().slice(0, 22)) + (fullName.length > 22 ? '…' : '');
        row.dataset.pipelineLabel = short;
        const wrap = row.querySelector('.pipeline-stage-pill-wrap');
        if (wrap) {
          const dot =
            (window.PIPELINE_STAGE_COLORS && window.PIPELINE_STAGE_COLORS[newStageId]) || '#94a3b8';
          wrap.style.boxShadow = `inset 3px 0 0 ${dot}`;
        }
        if (typeof window.showProspectToast === 'function') window.showProspectToast('Stage updated');
        if (document.querySelector('.result-row.selected') === row) syncMobilePanelCqi(row);
      } else {
        sel.value = prevId;
      }
    } catch {
      sel.value = prevId;
    } finally {
      sel.disabled = false;
    }
  });

  document.addEventListener('change', async (e) => {
    const inp = e.target.closest('.lead-category-input');
    if (!inp) return;
    const row = inp.closest('.result-row');
    const key = String(inp.dataset.leadKey || (row && row.dataset.leadKey) || '').trim();
    if (!key) return;
    const val = String(inp.value || '').trim();
    try {
      const res = await fetch(`/leads/${encodeURIComponent(key)}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ categoryName: val || 'N/A' }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success && row) {
        row.dataset.category = val || 'N/A';
        if (currentRow === row) populatePanel(row);
      }
    } catch (_) {
      /* ignore */
    }
  });

  document.addEventListener('change', async (e) => {
    const sel = e.target.closest('.lead-touch-channel-select');
    if (!sel) return;
    const row = sel.closest('.result-row');
    const key = String(sel.dataset.leadKey || (row && row.dataset.leadKey) || '').trim();
    if (!key || !row) return;
    const val = String(sel.value || '').trim();
    const prevCh = String(row.dataset.lastTouchChannel || '').trim();
    if (val === prevCh) return;
    sel.disabled = true;
    try {
      const res = await fetch(`/leads/${encodeURIComponent(key)}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          lastTouchChannel: val || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        row.dataset.lastTouchChannel = val;
        row.dataset.cadenceSort = val || '';
        if (currentRow === row) populatePanel(row);
        if (typeof window.showProspectToast === 'function') window.showProspectToast('Cadence updated');
      } else {
        sel.value = prevCh || '';
      }
    } catch (_) {
      sel.value = prevCh || '';
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

  const estimatedValueInput = document.getElementById('estimatedValueInput');
  if (estimatedValueInput) {
    estimatedValueInput.addEventListener('blur', async () => {
      if (!currentRow) return;
      const key = currentRow.dataset.leadKey;
      if (!key) return;
      const raw = estimatedValueInput.value.trim();
      const prev = String(currentRow.dataset.estimatedValue || '').trim();
      if (raw === prev) return;
      let estimatedValue = null;
      if (raw !== '') {
        const n = parseFloat(raw.replace(/,/g, ''), 10);
        if (Number.isFinite(n) && n >= 0) estimatedValue = n;
      }
      try {
        const res = await fetch(`/leads/${encodeURIComponent(key)}/update`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ estimatedValue: estimatedValue == null ? '' : estimatedValue }),
        });
        const data = await res.json();
        if (data.success) {
          currentRow.dataset.estimatedValue =
            estimatedValue != null && estimatedValue !== '' ? String(estimatedValue) : '';
          if (typeof window.showProspectToast === 'function') window.showProspectToast('Value saved');
        }
      } catch (err) {
        console.error('Estimated value update failed:', err);
      }
    });
  }

  function sanitizeContactInput(value) {
    return String(value || '')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function phoneDigitsOnly(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function clearManualContactErrors() {
    const phoneErr = document.getElementById('manualPhoneError');
    const emailErr = document.getElementById('manualEmailError');
    const phoneInput = document.getElementById('manualPhoneInput');
    const emailInput = document.getElementById('manualEmailInput');
    if (phoneErr) {
      phoneErr.textContent = '';
      phoneErr.classList.add('hidden');
    }
    if (emailErr) {
      emailErr.textContent = '';
      emailErr.classList.add('hidden');
    }
    if (phoneInput) phoneInput.classList.remove('ring-2', 'ring-rose-400');
    if (emailInput) emailInput.classList.remove('ring-2', 'ring-rose-400');
  }

  function setManualContactError(kind, message) {
    const isPhone = kind === 'phone';
    const errEl = document.getElementById(isPhone ? 'manualPhoneError' : 'manualEmailError');
    const inputEl = document.getElementById(isPhone ? 'manualPhoneInput' : 'manualEmailInput');
    if (errEl) {
      errEl.textContent = message;
      errEl.classList.remove('hidden');
    }
    if (inputEl) inputEl.classList.add('ring-2', 'ring-rose-400');
  }

  function normalizeManualPhone(raw) {
    const s = sanitizeContactInput(raw);
    if (!s) return '';
    const digits = s.replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('1')) {
      const d = digits.slice(1);
      return `+1 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
    }
    if (digits.length === 10) {
      return `+1 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    if (digits.length >= 7 && digits.length <= 15) return s;
    return null;
  }

  function normalizeManualEmail(raw) {
    const s = sanitizeContactInput(raw).toLowerCase();
    if (!s) return '';
    const basic = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!basic.test(s)) return null;
    return s;
  }

  function updateRowContactCells(row) {
    if (!row) return;
    const phone = sanitizeContactInput(row.dataset.phone);
    const email = sanitizeContactInput(row.dataset.email);
    const website = sanitizeContactInput(row.dataset.website);

    const phoneSlot = row.querySelector('.lead-contact-phone-slot');
    if (phoneSlot) {
      if (phone && phone !== 'N/A') {
        const key = row.dataset.leadKey || '';
        phoneSlot.innerHTML = `<a href="#" class="js-click-to-call-number text-xs font-semibold text-brand-dark dark:text-slate-200 truncate min-w-0 hover:text-brand-yellow transition-colors" title="${escapeHtmlAttr(phone)}" data-phone="${escapeHtmlAttr(phone)}" data-lead-key="${escapeHtmlAttr(key)}" onclick="event.stopPropagation()">${escapeHtmlText(phone)}</a>`;
      } else {
        phoneSlot.innerHTML = '<span class="text-xs font-semibold text-brand-muted/60 dark:text-slate-500">—</span>';
      }
    }

    const emailSlot = row.querySelector('.lead-contact-email-slot');
    if (emailSlot) {
      if (email && email !== 'N/A') {
        emailSlot.innerHTML = `<a href="mailto:${escapeHtmlAttr(email)}" class="text-brand-yellow hover:underline font-bold text-xs truncate block" title="${escapeHtmlAttr(email)}" onclick="event.stopPropagation()">${escapeHtmlText(email)}</a>`;
      } else {
        emailSlot.innerHTML = '<span class="text-xs font-semibold text-brand-muted/60 dark:text-slate-500">—</span>';
      }
    }

    const webSlot = row.querySelector('.lead-contact-web-slot');
    if (webSlot && website && website !== 'N/A') {
      const href = website.startsWith('http') ? website : `https://${website}`;
      const label = website.replace(/^https?:\/\//i, '').split('?')[0].replace(/\/$/, '');
      const short = label.length > 36 ? `${label.slice(0, 36)}…` : label;
      webSlot.innerHTML = `<a href="${escapeHtmlAttr(href)}" target="_blank" class="website-link text-xs font-semibold text-brand-dark dark:text-slate-300 hover:text-brand-yellow truncate block border-b border-transparent hover:border-brand-yellow/50" title="${escapeHtmlAttr(website)}" data-url="${escapeHtmlAttr(website)}">${escapeHtmlText(short)}</a>`;
    }
  }

  async function runLeadTelephonyAction(path, body, loadingLabel) {
    if (!currentRow) return null;
    const key = currentRow.dataset.leadKey;
    if (!key) {
      alert('Save this lead first before running telephony actions.');
      return null;
    }
    const res = await fetch(`/leads/${encodeURIComponent(key)}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      const msg = (data && data.error) || `${loadingLabel || 'Action'} failed`;
      throw new Error(msg);
    }
    if (data.lead && Array.isArray(data.lead.updates)) {
      currentRow.dataset.updates = JSON.stringify(data.lead.updates);
      if (data.lead.status) currentRow.dataset.status = String(data.lead.status);
    }
    if (data && data.dialMode === 'browser_device' && data.phone) {
      openSoftphoneOrTel(data.phone);
    }
    if (typeof window.showProspectToast === 'function') {
      window.showProspectToast(loadingLabel || 'Done');
    }
    populatePanel(currentRow);
    return data;
  }

  function openSoftphoneOrTel(rawPhone) {
    const raw = String(rawPhone || '').trim();
    if (!raw) return false;
    const desktop =
      !(window.matchMedia && window.matchMedia('(max-width: 767px)').matches);
    if (
      desktop &&
      typeof window.__adhelloOpenSoftphoneWithDial === 'function' &&
      window.__adhelloOpenSoftphoneWithDial(raw)
    ) {
      return true;
    }
    const digits = raw.replace(/[^\d+]/g, '');
    if (!digits) return false;
    window.location.href = `tel:${digits}`;
    return true;
  }

  async function requestLeadCallByKey(leadKey, fallbackPhone, options) {
    const key = String(leadKey || '').trim();
    if (!key) throw new Error('Missing lead key.');
    const body = { ...(options || {}) };
    const res = await fetch('/leads/' + encodeURIComponent(key) + '/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      throw new Error((data && data.error) || 'Call failed');
    }
    if (data && data.dialMode === 'browser_device') {
      const raw = String((data && data.phone) || fallbackPhone || '').trim();
      openSoftphoneOrTel(raw);
    }
    return data;
  }

  async function requestLeadVoicemailByKey(leadKey, options) {
    const key = String(leadKey || '').trim();
    if (!key) throw new Error('Missing lead key.');
    const body = { ...(options || {}) };
    const res = await fetch('/leads/' + encodeURIComponent(key) + '/voicemail-drop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      throw new Error((data && data.error) || 'Voicemail drop failed');
    }
    return data;
  }

  const clickToCallBtn = document.getElementById('clickToCallBtn');
  if (clickToCallBtn) {
    clickToCallBtn.addEventListener('click', async () => {
      const original = clickToCallBtn.textContent;
      clickToCallBtn.disabled = true;
      clickToCallBtn.textContent = 'Dialing...';
      try {
        await runLeadTelephonyAction('/call', {}, 'Calling lead');
      } catch (err) {
        alert(err.message || 'Failed to start call.');
      } finally {
        clickToCallBtn.disabled = false;
        clickToCallBtn.textContent = original;
      }
    });
  }

  document.addEventListener('click', async (e) => {
    const trigger = e.target && e.target.closest ? e.target.closest('.js-click-to-call-number') : null;
    if (!trigger) return;
    e.preventDefault();
    e.stopPropagation();

    const explicitPhone = (trigger.dataset && trigger.dataset.phone) || '';
    const leadKey = (trigger.dataset && trigger.dataset.leadKey) || '';
    let row = trigger.closest('.result-row');
    if (!row && leadKey) row = findResultRowByLeadKey(leadKey);
    const fromRow =
      row && row.dataset && row.dataset.phone != null ? String(row.dataset.phone).trim() : '';
    const phoneToFill = String(explicitPhone || fromRow || '').trim();
    if (
      phoneToFill &&
      phoneToFill !== 'N/A' &&
      typeof window.__adhelloOpenSoftphoneWithDial === 'function' &&
      window.__adhelloOpenSoftphoneWithDial(phoneToFill)
    ) {
      if (row && row.dataset && row.dataset.leadKey) {
        currentRow = row;
      }
      return;
    }
    if (!row || !row.dataset || !row.dataset.leadKey) {
      const raw = String(explicitPhone || '').trim();
      openSoftphoneOrTel(raw);
      return;
    }

    const originalRow = currentRow;
    const originalText = trigger.textContent;
    const shouldResetText = trigger.tagName === 'A' || trigger.tagName === 'BUTTON';
    currentRow = row;
    trigger.classList.add('pointer-events-none', 'opacity-70');
    if (shouldResetText) trigger.textContent = 'Dialing...';
    try {
      await runLeadTelephonyAction('/call', {}, 'Calling lead');
    } catch (err) {
      alert(err.message || 'Failed to start call.');
    } finally {
      trigger.classList.remove('pointer-events-none', 'opacity-70');
      if (shouldResetText) trigger.textContent = originalText;
      currentRow = originalRow || row;
    }
  }, true);

  const voicemailDropBtn = document.getElementById('voicemailDropBtn');
  if (voicemailDropBtn) {
    voicemailDropBtn.addEventListener('click', async () => {
      const ok = window.confirm(
        'Start a voicemail drop attempt for this lead? This places an outbound call immediately.'
      );
      if (!ok) return;
      const original = voicemailDropBtn.textContent;
      voicemailDropBtn.disabled = true;
      voicemailDropBtn.textContent = 'Starting...';
      try {
        await runLeadTelephonyAction('/voicemail-drop', {}, 'Voicemail drop started');
      } catch (err) {
        alert(err.message || 'Failed to start voicemail drop.');
      } finally {
        voicemailDropBtn.disabled = false;
        voicemailDropBtn.textContent = original;
      }
    });
  }

  const sendSmsBtn = document.getElementById('sendSmsBtn');
  const smsScriptModal = document.getElementById('smsScriptModal');
  const smsScriptSelect = document.getElementById('smsScriptSelect');
  const smsBodyInput = document.getElementById('smsBodyInput');
  const smsBodyCount = document.getElementById('smsBodyCount');
  const smsScriptWorkspaceLabel = document.getElementById('smsScriptWorkspaceLabel');
  const smsPersonalizeBtn = document.getElementById('smsPersonalizeBtn');
  const smsScriptSendBtn = document.getElementById('smsScriptSendBtn');
  const smsScriptModalClose = document.getElementById('smsScriptModalClose');
  const smsScriptCancelBtn = document.getElementById('smsScriptCancelBtn');
  let smsScriptOptions = [];

  function setSmsCharCount() {
    if (!smsBodyInput || !smsBodyCount) return;
    smsBodyCount.textContent = String((smsBodyInput.value || '').length);
  }

  function closeSmsModal() {
    if (!smsScriptModal) return;
    smsScriptModal.classList.add('hidden');
    smsScriptModal.setAttribute('aria-hidden', 'true');
  }

  function openSmsModal() {
    if (!smsScriptModal) return;
    smsScriptModal.classList.remove('hidden');
    smsScriptModal.setAttribute('aria-hidden', 'false');
    if (smsScriptWorkspaceLabel) {
      const wsNameEl = document.querySelector('#wsSwitcherBtn .font-display');
      const wsName = wsNameEl ? String(wsNameEl.textContent || '').trim() : '';
      smsScriptWorkspaceLabel.textContent = `Workspace: ${wsName || 'Current workspace'}`;
    }
  }

  function getCurrentLeadKey() {
    if (!currentRow || !currentRow.dataset) return '';
    return String(currentRow.dataset.leadKey || '').trim();
  }

  async function loadSmsScriptOptions() {
    const leadKey = getCurrentLeadKey();
    if (!leadKey || !smsScriptSelect || !smsBodyInput) return;
    smsScriptSelect.disabled = true;
    smsScriptSelect.innerHTML = '<option value="">Loading scripts...</option>';
    try {
      const res = await fetch(`/leads/${encodeURIComponent(leadKey)}/sms-script-options`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error((data && data.error) || 'Could not load SMS scripts.');
      smsScriptOptions = Array.isArray(data.options) ? data.options : [];
      if (!smsScriptOptions.length) {
        const title = String((currentRow && currentRow.dataset && currentRow.dataset.title) || 'there').trim();
        smsScriptOptions = [
          {
            id: 'fallback',
            label: 'Default outreach',
            text: `Hi ${title} team, this is [your name] from AdHello. We had a quick idea to help improve your local lead flow. Open to a short call this week?`,
          },
        ];
      }
      smsScriptSelect.innerHTML = '';
      smsScriptOptions.forEach((opt, idx) => {
        const o = document.createElement('option');
        o.value = String(idx);
        o.textContent = opt.label || `Script ${idx + 1}`;
        smsScriptSelect.appendChild(o);
      });
      smsScriptSelect.value = '0';
      smsBodyInput.value = smsScriptOptions[0].text || '';
      setSmsCharCount();
    } catch (err) {
      smsScriptSelect.innerHTML = '<option value="">No scripts available</option>';
      smsBodyInput.value = '';
      setSmsCharCount();
      alert(err.message || 'Failed to load scripts.');
    } finally {
      smsScriptSelect.disabled = false;
    }
  }

  if (sendSmsBtn) {
    sendSmsBtn.addEventListener('click', async () => {
      if (!currentRow) return;
      openSmsModal();
      await loadSmsScriptOptions();
      if (smsBodyInput) smsBodyInput.focus();
    });
  }

  if (smsScriptSelect && smsBodyInput) {
    smsScriptSelect.addEventListener('change', () => {
      const idx = parseInt(smsScriptSelect.value, 10);
      const selected = Number.isFinite(idx) ? smsScriptOptions[idx] : null;
      smsBodyInput.value = selected && selected.text ? selected.text : '';
      setSmsCharCount();
    });
  }
  if (smsBodyInput) {
    smsBodyInput.addEventListener('input', setSmsCharCount);
  }
  if (smsPersonalizeBtn) {
    smsPersonalizeBtn.addEventListener('click', async () => {
      const leadKey = getCurrentLeadKey();
      if (!leadKey || !smsBodyInput) return;
      const scriptText = String(smsBodyInput.value || '').trim();
      if (!scriptText) return;
      const original = smsPersonalizeBtn.textContent;
      smsPersonalizeBtn.disabled = true;
      smsPersonalizeBtn.textContent = 'Personalizing...';
      try {
        const res = await fetch(`/leads/${encodeURIComponent(leadKey)}/sms-personalize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ scriptText }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error((data && data.error) || 'Could not personalize SMS.');
        smsBodyInput.value = data.personalized || scriptText;
        setSmsCharCount();
      } catch (err) {
        alert(err.message || 'Failed to personalize SMS.');
      } finally {
        smsPersonalizeBtn.disabled = false;
        smsPersonalizeBtn.textContent = original;
      }
    });
  }
  if (smsScriptSendBtn) {
    smsScriptSendBtn.addEventListener('click', async () => {
      if (!smsBodyInput) return;
      const smsBody = String(smsBodyInput.value || '').trim();
      if (!smsBody) return;
      const original = smsScriptSendBtn.textContent;
      smsScriptSendBtn.disabled = true;
      smsScriptSendBtn.textContent = 'Sending...';
      try {
        await runLeadTelephonyAction('/sms', { body: smsBody }, 'SMS sent');
        closeSmsModal();
      } catch (err) {
        alert(err.message || 'Failed to send SMS.');
      } finally {
        smsScriptSendBtn.disabled = false;
        smsScriptSendBtn.textContent = original;
      }
    });
  }
  [smsScriptModalClose, smsScriptCancelBtn].forEach((btnEl) => {
    if (!btnEl) return;
    btnEl.addEventListener('click', closeSmsModal);
  });
  if (smsScriptModal) {
    smsScriptModal.addEventListener('click', (e) => {
      if (e.target && e.target.hasAttribute('data-sms-modal-close')) closeSmsModal();
    });
  }

  const vmAudioStatus = document.getElementById('vmAudioStatus');
  const vmWeeklyDay = document.getElementById('vmWeeklyDay');
  const vmWeeklyTime = document.getElementById('vmWeeklyTime');
  const vmWeeklyEnabled = document.getElementById('vmWeeklyEnabled');
  const vmSaveWeeklyBtn = document.getElementById('vmSaveWeeklyBtn');
  const vmUploadInput = document.getElementById('vmUploadInput');
  const vmRecordStartBtn = document.getElementById('vmRecordStartBtn');
  const vmRecordStopBtn = document.getElementById('vmRecordStopBtn');
  let vmRecorder = null;
  let vmChunks = [];
  let vmSettingsLoaded = false;

  async function uploadVoicemailBlob(blob, filename) {
    const fd = new FormData();
    fd.append('audio', blob, filename || 'voicemail.webm');
    const res = await fetch('/leads/telephony/voicemail/upload', {
      method: 'POST',
      body: fd,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error((data && data.error) || 'Voicemail upload failed');
    return data;
  }

  async function loadVoicemailSettings() {
    if (!vmAudioStatus || vmSettingsLoaded) return;
    try {
      const res = await fetch('/leads/telephony/voicemail/settings', {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error((data && data.error) || 'Could not load settings');
      const s = data.settings || {};
      if (vmWeeklyDay) vmWeeklyDay.value = String(s.dayOfWeek != null ? s.dayOfWeek : 1);
      if (vmWeeklyTime) vmWeeklyTime.value = String(s.time || '09:00');
      if (vmWeeklyEnabled) vmWeeklyEnabled.checked = !!s.enabled;
      if (s.audioUrl) {
        vmAudioStatus.innerHTML = `Active voicemail audio: <a class="underline text-brand-yellow" href="${s.audioUrl}" target="_blank" rel="noopener">preview</a>`;
      } else {
        vmAudioStatus.textContent = 'No voicemail audio uploaded yet.';
      }
      vmSettingsLoaded = true;
    } catch (err) {
      vmAudioStatus.textContent = err.message || 'Failed to load voicemail settings.';
    }
  }

  if (vmSaveWeeklyBtn) {
    vmSaveWeeklyBtn.addEventListener('click', async () => {
      const original = vmSaveWeeklyBtn.textContent;
      vmSaveWeeklyBtn.disabled = true;
      vmSaveWeeklyBtn.textContent = 'Saving...';
      try {
        const body = {
          enabled: !!(vmWeeklyEnabled && vmWeeklyEnabled.checked),
          dayOfWeek: vmWeeklyDay ? vmWeeklyDay.value : '1',
          time: vmWeeklyTime ? vmWeeklyTime.value : '09:00',
          maxLeadsPerRun: 25,
        };
        const res = await fetch('/leads/telephony/voicemail/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error((data && data.error) || 'Could not save weekly settings');
        if (typeof window.showProspectToast === 'function') window.showProspectToast('Weekly voicemail settings saved');
      } catch (err) {
        alert(err.message || 'Could not save weekly settings.');
      } finally {
        vmSaveWeeklyBtn.disabled = false;
        vmSaveWeeklyBtn.textContent = original;
      }
    });
  }

  if (vmUploadInput) {
    vmUploadInput.addEventListener('change', async () => {
      const file = vmUploadInput.files && vmUploadInput.files[0];
      if (!file) return;
      try {
        vmAudioStatus.textContent = 'Uploading voicemail audio...';
        const up = await uploadVoicemailBlob(file, file.name || 'voicemail.webm');
        vmAudioStatus.innerHTML = `Voicemail audio saved: <a class="underline text-brand-yellow" href="${up.audioUrl}" target="_blank" rel="noopener">preview</a>`;
      } catch (err) {
        vmAudioStatus.textContent = err.message || 'Upload failed.';
      } finally {
        vmUploadInput.value = '';
      }
    });
  }

  if (vmRecordStartBtn && vmRecordStopBtn) {
    vmRecordStartBtn.addEventListener('click', async () => {
      try {
        if (!navigator.mediaDevices || !window.MediaRecorder) {
          throw new Error('Browser recording is not supported here.');
        }
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        vmChunks = [];
        vmRecorder = new MediaRecorder(stream);
        vmRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) vmChunks.push(e.data);
        };
        vmRecorder.onstop = async () => {
          try {
            const blob = new Blob(vmChunks, { type: 'audio/webm' });
            vmAudioStatus.textContent = 'Uploading recorded voicemail...';
            const up = await uploadVoicemailBlob(blob, 'voicemail-recording.webm');
            vmAudioStatus.innerHTML = `Voicemail recording saved: <a class="underline text-brand-yellow" href="${up.audioUrl}" target="_blank" rel="noopener">preview</a>`;
          } catch (err) {
            vmAudioStatus.textContent = err.message || 'Recording upload failed.';
          }
        };
        vmRecorder.start();
        vmRecordStartBtn.disabled = true;
        vmRecordStopBtn.disabled = false;
        vmAudioStatus.textContent = 'Recording... click Stop + save when done.';
      } catch (err) {
        vmAudioStatus.textContent = err.message || 'Could not start recording.';
      }
    });

    vmRecordStopBtn.addEventListener('click', () => {
      if (!vmRecorder) return;
      try {
        vmRecorder.stop();
      } catch (_) {
        /* ignore */
      }
      vmRecordStopBtn.disabled = true;
      vmRecordStartBtn.disabled = false;
    });
  }
  loadVoicemailSettings();

  // --- Generate Mailto Email Draft ---
  const draftEmailBtn = document.getElementById('draftEmailBtn');
  const sidebarReportEmailBtn = document.getElementById('sidebarReportEmailBtn');
  const sidebarIncludeCoupon = document.getElementById('sidebarIncludeCoupon');
  const sidebarCouponWarning = document.getElementById('sidebarCouponWarning');
  const syncSidebarCouponWarning = () => {
    if (currentRow) syncSidebarOutreachButtons(currentRow);
    else if (sidebarCouponWarning && sidebarIncludeCoupon) {
      const show = sidebarIncludeCoupon.checked && !getWorkspaceCouponLink();
      sidebarCouponWarning.classList.toggle('hidden', !show);
    }
  };
  if (sidebarIncludeCoupon) sidebarIncludeCoupon.addEventListener('change', syncSidebarCouponWarning);
  syncSidebarCouponWarning();
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
      const includeCoupon = !!(sidebarIncludeCoupon && sidebarIncludeCoupon.checked);
      const couponLink = getWorkspaceCouponLink();
      const couponLine = includeCoupon && couponLink ? `\n\nAlso, if it helps, here is a free coffee coupon link for your team: ${couponLink}` : '';
      if (includeCoupon && !couponLink) syncSidebarCouponWarning();

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
        bodyText = `Hey ${title} team,\n\nI was looking for businesses in ${city} and found your site. I recorded a quick 2-minute video sharing a few layout ideas and technical fixes that could help increase your conversions:\n\n${loomLink}\n\n${gapText}${couponLine}\n\nLet me know what you think!\n\nBest,\n[Your Name]`;
      } else {
        bodyText = `Hey ${title} team,\n\nI was looking for local businesses in ${city} and spent some time on your website. ${gapText}${couponLine}\n\nI'd love to share some specific ideas on how to fix these. Are you open to a quick 5-minute chat this week?\n\nBest,\n[Your Name]`;
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

  async function handleSidebarReportEmailClick() {
    if (!currentRow) {
      if (typeof window.showAppToast === 'function') {
        window.showAppToast('Select a lead first.', { variant: 'error' });
      }
      return;
    }
    const btn = document.getElementById('sidebarReportEmailBtn');
    const original = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Preparing…';
    }
    try {
      const analysis = await ensureLeadAiAnalysis(currentRow);
      syncSidebarOutreachButtons(currentRow);
      const report = buildClientReportEmail(
        currentRow,
        analysis,
        String(currentRow.dataset.ownerSignal || '').trim()
      );
      const opened = openMailReport(report);
      if (opened && typeof window.showAppToast === 'function') {
        window.showAppToast('Report email draft opened.', { variant: 'success' });
      }
    } catch (err) {
      const msg = err && err.message ? err.message : 'Could not open report email';
      if (typeof window.showAppToast === 'function') window.showAppToast(msg, { variant: 'error' });
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = original;
      }
    }
  }

  const sidebarHostedAuditBtn = document.getElementById('sidebarHostedAuditBtn');
  const sidebarCopyAuditLinkBtn = document.getElementById('sidebarCopyAuditLinkBtn');
  const sidebarCopySmsAuditBtn = document.getElementById('sidebarCopySmsAuditBtn');

  async function copyTextToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } finally {
      document.body.removeChild(ta);
    }
  }

  async function handleSidebarHostedAuditClick() {
    if (!currentRow) {
      if (typeof window.showAppToast === 'function') {
        window.showAppToast('Select a lead first.', { variant: 'error' });
      }
      return;
    }
    const btn = document.getElementById('sidebarHostedAuditBtn');
    const original = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Preparing…';
    }
    try {
      await ensureLeadAiAnalysis(currentRow);
      syncSidebarOutreachButtons(currentRow);
      const bundle = await fetchAuditReportLinkBundle(currentRow);
      window.open(bundle.reportUrl, '_blank', 'noopener,noreferrer');
      if (typeof window.showAppToast === 'function') {
        window.showAppToast('Hosted audit opened — text them the link while you are talking.', {
          variant: 'success',
        });
      }
    } catch (err) {
      const msg = err && err.message ? err.message : 'Could not open hosted audit';
      if (typeof window.showAppToast === 'function') window.showAppToast(msg, { variant: 'error' });
      else window.alert(msg);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = original;
      }
    }
  }

  async function handleSidebarCopyAuditLinkClick() {
    if (!currentRow) {
      if (typeof window.showAppToast === 'function') {
        window.showAppToast('Select a lead first.', { variant: 'error' });
      }
      return;
    }
    const btn = document.getElementById('sidebarCopyAuditLinkBtn');
    if (btn) btn.disabled = true;
    try {
      await ensureLeadAiAnalysis(currentRow);
      syncSidebarOutreachButtons(currentRow);
      const bundle = await fetchAuditReportLinkBundle(currentRow);
      await copyTextToClipboard(bundle.reportUrl);
      if (typeof window.showAppToast === 'function') {
        window.showAppToast('Report link copied.', { variant: 'success' });
      }
    } catch (err) {
      const msg = err && err.message ? err.message : 'Copy failed';
      if (typeof window.showAppToast === 'function') window.showAppToast(msg, { variant: 'error' });
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  const sidebarCadenceSnooze90Btn = document.getElementById('sidebarCadenceSnooze90Btn');
  const sidebarCadencePauseBtn = document.getElementById('sidebarCadencePauseBtn');
  if (sidebarCadenceSnooze90Btn) {
    sidebarCadenceSnooze90Btn.addEventListener('click', async () => {
      if (!currentRow || !currentRow.dataset.leadKey) {
        if (typeof window.showAppToast === 'function') {
          window.showAppToast('Select a lead first.', { variant: 'error' });
        }
        return;
      }
      if (!window.confirm('Pause cadence and snooze this lead for 90 days? (Re-run audit before the next wave.)')) return;
      const key = currentRow.dataset.leadKey;
      try {
        sidebarCadenceSnooze90Btn.disabled = true;
        const res = await fetch(`/leads/${encodeURIComponent(key)}/cadence/snooze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ days: 90 }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.error || 'Snooze failed');
        if (typeof window.showAppToast === 'function') {
          window.showAppToast('Cadence snoozed 90 days.', { variant: 'success' });
        }
        if (currentRow && typeof populatePanel === 'function') populatePanel(currentRow);
      } catch (err) {
        const msg = err && err.message ? err.message : 'Snooze failed';
        if (typeof window.showAppToast === 'function') window.showAppToast(msg, { variant: 'error' });
      } finally {
        sidebarCadenceSnooze90Btn.disabled = false;
      }
    });
  }
  if (sidebarCadencePauseBtn) {
    sidebarCadencePauseBtn.addEventListener('click', async () => {
      if (!currentRow || !currentRow.dataset.leadKey) {
        if (typeof window.showAppToast === 'function') {
          window.showAppToast('Select a lead first.', { variant: 'error' });
        }
        return;
      }
      const key = currentRow.dataset.leadKey;
      try {
        sidebarCadencePauseBtn.disabled = true;
        const res = await fetch(`/leads/${encodeURIComponent(key)}/sequence/pause`, { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.error || 'Pause failed');
        if (typeof window.showAppToast === 'function') {
          window.showAppToast('Cadence paused.', { variant: 'success' });
        }
        if (currentRow && typeof populatePanel === 'function') populatePanel(currentRow);
      } catch (err) {
        const msg = err && err.message ? err.message : 'Pause failed';
        if (typeof window.showAppToast === 'function') window.showAppToast(msg, { variant: 'error' });
      } finally {
        sidebarCadencePauseBtn.disabled = false;
      }
    });
  }

  async function handleSidebarCopySmsAuditClick() {
    if (!currentRow) {
      if (typeof window.showAppToast === 'function') {
        window.showAppToast('Select a lead first.', { variant: 'error' });
      }
      return;
    }
    const btn = document.getElementById('sidebarCopySmsAuditBtn');
    if (btn) btn.disabled = true;
    try {
      await ensureLeadAiAnalysis(currentRow);
      syncSidebarOutreachButtons(currentRow);
      const bundle = await fetchAuditReportLinkBundle(currentRow);
      const snippet = String(bundle.smsSnippet || bundle.reportUrl || '').trim();
      await copyTextToClipboard(snippet);
      if (typeof window.showAppToast === 'function') {
        window.showAppToast('SMS snippet copied.', { variant: 'success' });
      }
    } catch (err) {
      const msg = err && err.message ? err.message : 'Copy failed';
      if (typeof window.showAppToast === 'function') window.showAppToast(msg, { variant: 'error' });
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('#sidebarReportEmailBtn')) {
      e.preventDefault();
      handleSidebarReportEmailClick();
      return;
    }
    if (e.target.closest('#sidebarHostedAuditBtn')) {
      e.preventDefault();
      handleSidebarHostedAuditClick();
      return;
    }
    if (e.target.closest('#sidebarCopyAuditLinkBtn')) {
      e.preventDefault();
      handleSidebarCopyAuditLinkClick();
      return;
    }
    if (e.target.closest('#sidebarCopySmsAuditBtn')) {
      e.preventDefault();
      handleSidebarCopySmsAuditClick();
      return;
    }
    if (e.target.closest('#sidebarIncludeCoupon') || e.target.closest('label[for="sidebarIncludeCoupon"]')) {
      syncSidebarOutreachButtons(currentRow || null);
    }
  });

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
                          clearLeadDetailPanelForceStyles(mobilePanel);
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
    const targetFolderKey = String(window.SEARCH_TARGET_FOLDER_KEY || '').trim();
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
      folderKey: targetFolderKey,
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
        'fixed bottom-28 left-1/2 z-[180] -translate-x-1/2 translate-y-3 opacity-0 pointer-events-none transition-all duration-200 ease-out px-5 py-3 rounded-2xl bg-brand-dark text-white text-sm font-semibold shadow-[0_10px_24px_rgba(0,0,0,0.34)] border border-brand-yellow/50 max-w-[min(90vw,20rem)] text-center';
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
  const bulkVoicemailBtn = document.getElementById('bulkVoicemailBtn');
  const bulkSaveBtn = document.getElementById('bulkSaveBtn');
  const bulkSmsBtn = document.getElementById('bulkSmsBtn');
  const bulkFocusModeBtn = document.getElementById('bulkFocusModeBtn');

  let selectedKeys = new Set();

  const updateBulkActionBar = () => {
    const count = selectedKeys.size;
    const hasSelection = count > 0;
    
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
    if (bulkSaveBtn) {
      bulkSaveBtn.disabled = count === 0;
    }
    if (bulkVoicemailBtn) {
      bulkVoicemailBtn.disabled = count === 0;
      bulkVoicemailBtn.classList.toggle('opacity-40', count === 0);
      bulkVoicemailBtn.classList.toggle('cursor-not-allowed', count === 0);
    }
    if (bulkSmsBtn) {
      bulkSmsBtn.disabled = count === 0;
      bulkSmsBtn.classList.toggle('opacity-40', count === 0);
      bulkSmsBtn.classList.toggle('cursor-not-allowed', count === 0);
    }
    if (bulkFocusModeBtn) {
      const firstKey = hasSelection ? [...selectedKeys][0] : '';
      bulkFocusModeBtn.classList.toggle('opacity-40', !hasSelection);
      bulkFocusModeBtn.classList.toggle('pointer-events-none', !hasSelection);
      bulkFocusModeBtn.setAttribute('aria-disabled', !hasSelection ? 'true' : 'false');
      bulkFocusModeBtn.setAttribute('href', firstKey ? `/focus?lead=${encodeURIComponent(firstKey)}` : '/focus');
      bulkFocusModeBtn.setAttribute(
        'title',
        firstKey ? 'Open Focus mode with selected lead first' : 'Select at least one lead to seed Focus mode',
      );
    }

    document.querySelectorAll('.js-bulk-enhance').forEach((btn) => {
      btn.classList.toggle('ring-2', hasSelection);
      btn.classList.toggle('ring-brand-yellow/60', hasSelection);
      btn.classList.toggle('shadow-md', hasSelection);
      btn.classList.toggle('bg-brand-yellow/20', hasSelection);
      btn.classList.toggle('border-brand-yellow/60', hasSelection);
      btn.setAttribute(
        'title',
        hasSelection ? `Enrich ${count} selected lead${count === 1 ? '' : 's'} (Firecrawl)` : 'Enrich selected leads (Firecrawl)',
      );
    });
    document.querySelectorAll('.js-bulk-ai-analysis').forEach((btn) => {
      btn.classList.toggle('ring-2', hasSelection);
      btn.classList.toggle('ring-sky-400/60', hasSelection);
      btn.classList.toggle('shadow-md', hasSelection);
      btn.classList.toggle('bg-sky-500/20', hasSelection);
      btn.classList.toggle('border-sky-400/65', hasSelection);
      btn.setAttribute(
        'title',
        hasSelection
          ? `Run AI analysis for ${count} selected lead${count === 1 ? '' : 's'}`
          : 'Run AI website analysis for selected leads',
      );
    });

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

  if (bulkVoicemailBtn) {
    bulkVoicemailBtn.addEventListener('click', async () => {
      if (selectedKeys.size === 0) return;
      const keys = [...selectedKeys];
      const n = keys.length;
      if (!window.confirm(`Run voicemail drop for ${n} selected lead${n === 1 ? '' : 's'}?`)) return;
      const original = bulkVoicemailBtn.textContent;
      bulkVoicemailBtn.disabled = true;
      bulkVoicemailBtn.textContent = 'Dropping...';
      let ok = 0;
      let failed = 0;
      for (const leadKey of keys) {
        const cb = Array.from(document.querySelectorAll('.lead-checkbox')).find((c) => c.dataset.key === leadKey);
        const row = cb && cb.closest('.result-row');
        try {
          const data = await requestLeadVoicemailByKey(leadKey, {});
          if (row && data && data.lead && data.lead.updates) {
            row.dataset.updates = JSON.stringify(data.lead.updates);
            if (data.lead.status) row.dataset.status = String(data.lead.status);
          }
          ok += 1;
        } catch (err) {
          failed += 1;
          console.warn('Bulk voicemail drop failed for', leadKey, err && err.message ? err.message : err);
        }
      }
      window.alert(`Voicemail drops complete: ${ok} succeeded${failed ? `, ${failed} failed` : ''}.`);
      bulkVoicemailBtn.textContent = original;
      bulkVoicemailBtn.disabled = selectedKeys.size === 0;
      if (bulkVoicemailBtn.disabled) {
        bulkVoicemailBtn.classList.add('opacity-40', 'cursor-not-allowed');
      }
    });
  }

  if (bulkSmsBtn) {
    bulkSmsBtn.addEventListener('click', async () => {
      if (selectedKeys.size === 0) return;
      const keys = [...selectedKeys];
      const n = keys.length;
      const smsBody = window.prompt(
        `Type the SMS to send to ${n} selected lead${n === 1 ? '' : 's'}:`,
        'Hi! Quick follow-up from Agency OS. Want a short idea for improving your local lead flow this week?',
      );
      if (smsBody == null) return;
      const body = String(smsBody || '').trim();
      if (!body) {
        window.alert('SMS body cannot be empty.');
        return;
      }
      if (!window.confirm(`Send this SMS to ${n} selected lead${n === 1 ? '' : 's'}?`)) return;
      const original = bulkSmsBtn.textContent;
      bulkSmsBtn.disabled = true;
      bulkSmsBtn.textContent = 'Sending...';
      let ok = 0;
      let failed = 0;
      for (const leadKey of keys) {
        try {
          const res = await fetch(`/leads/${encodeURIComponent(leadKey)}/sms`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ body }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data.success) throw new Error((data && data.error) || `HTTP ${res.status}`);
          ok += 1;
        } catch (err) {
          failed += 1;
          console.warn('Bulk SMS failed for', leadKey, err && err.message ? err.message : err);
        }
      }
      window.alert(`Bulk SMS complete: ${ok} sent${failed ? `, ${failed} failed` : ''}.`);
      bulkSmsBtn.textContent = original;
      bulkSmsBtn.disabled = selectedKeys.size === 0;
      if (bulkSmsBtn.disabled) {
        bulkSmsBtn.classList.add('opacity-40', 'cursor-not-allowed');
      } else {
        bulkSmsBtn.classList.remove('opacity-40', 'cursor-not-allowed');
      }
    });
  }

  // Bulk Save (to saved leads)
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
        if (bulkFolderSelect && bulkFolderSelect.value) {
          leadData.folderKey = bulkFolderSelect.value;
        }

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
      const reviewsInner = row.querySelector('.lead-reviews-inner');
      if (!reviewsInner) return null;
      const phone = row.querySelector('.lead-contact-phone-slot');
      const email = row.querySelector('.lead-contact-email-slot');
      const website = row.querySelector('.lead-contact-web-slot');
      const socials = row.querySelector('.lead-cell-socials-content');
      if (!phone || !email || !website) return null;
      return {
        kind: 'leads',
        addressEl: row.querySelector('.lead-row-address'),
        phone,
        email,
        website,
        socials,
        reviews: reviewsInner,
      };
    }
    const phoneSlot = row.querySelector('.lead-contact-phone-slot');
    const emailSlot = row.querySelector('.lead-contact-email-slot');
    const websiteSlot = row.querySelector('.lead-contact-web-slot');
    const opportunityCell = row.querySelector('.opportunity-cell');
    if (phoneSlot && emailSlot && websiteSlot && opportunityCell) {
      return {
        kind: 'results',
        phone: phoneSlot,
        reviews: cells[4],
        opportunity: opportunityCell,
        website: websiteSlot,
        email: emailSlot,
        social: cells[6],
      };
    }
    if (cells.length < 14) return null;
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
    const cmb = d.competitor_meta_benchmark ?? d.competitorMetaBenchmark;
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
    if (cmb !== undefined) row.dataset.competitorMetaBenchmark = cmb;
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
      return `<a href="#" class="js-click-to-call-number block text-sm font-medium text-brand-muted dark:text-slate-300 hover:text-brand-yellow transition-colors" data-phone="${escapeHtmlAttr(
        p
      )}" onclick="event.stopPropagation()">${escapeHtmlText(p)}</a>`;
    }
    return '<span class="block text-sm text-brand-muted/60">-</span>';
  }

  function setLeadPhoneSlot(el, phone) {
    if (!el) return;
    const p = phone && phone !== 'N/A' ? String(phone).trim() : '';
    if (!p) {
      el.textContent = '—';
      el.removeAttribute('title');
      el.classList.remove('js-click-to-call-number');
      el.removeAttribute('data-phone');
      el.removeAttribute('data-lead-key');
      if (el.tagName === 'A') el.setAttribute('href', '#');
      return;
    }
    const row = el.closest('.result-row');
    const key = row && row.dataset ? row.dataset.leadKey || '' : '';
    el.classList.add('js-click-to-call-number');
    el.setAttribute('data-phone', p);
    if (key) el.setAttribute('data-lead-key', key);
    else el.removeAttribute('data-lead-key');
    if (el.tagName === 'A') el.setAttribute('href', '#');
    el.textContent = p;
    el.setAttribute('title', p);
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

  function renderLeadSocialsSlotInner(mapsUrl, facebook, instagram, twitter, title, address, city, gradSuffix) {
    const gmResolved = resolveGoogleMapsSocialHref(mapsUrl, title, address, city);
    const gm = gmResolved ? String(gmResolved).trim() : '';
    const fb = facebook && facebook !== 'N/A' ? String(facebook).trim() : '';
    const ig = instagram && instagram !== 'N/A' ? String(instagram).trim() : '';
    const tw = twitter && twitter !== 'N/A' ? String(twitter).trim() : '';
    const suffix = gradSuffix != null ? String(gradSuffix) : 'slot';
    if (__socialBrand) {
      return (
        '<div class="flex items-center gap-2.5 pt-1.5">' +
        __socialBrand.renderLinks({ gm, fb, ig, tw, gradSuffix: suffix }) +
        '</div>'
      );
    }
    let html = '<div class="flex items-center gap-2.5 pt-1.5">';
    if (gm) {
      html += `<a href="${escapeHtmlAttr(gm)}" target="_blank" rel="noopener noreferrer" class="${GOOGLE_SOCIALS_TABLE_BTN_CLASS}" title="Google Maps / Business Profile" aria-label="Google Business Profile (opens in Maps)" onclick="event.stopPropagation()">${GOOGLE_BUSINESS_ICON_SVG}</a>`;
    }
    if (!gm && !fb && !ig && !tw) {
      html += '<span class="text-xs font-semibold text-brand-muted/60 dark:text-slate-500">—</span>';
    }
    html += '</div>';
    return html;
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

  const bulkEnhanceDomSnapshots = new WeakMap();
  let bulkEnhanceBtnSnapshotHtml = null;

  function findResultRowByLeadKey(key) {
    const esc = String(key).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return document.querySelector(`tr.result-row[data-lead-key="${esc}"]`);
  }

  function applyBulkEnhanceDomAfterFetch(row, layout, cellOriginals, success, result) {
    const d = result && (result.lead || result.data);
    if (success && d) {
      applyEnrichDataToRowDataset(row, d, result);
      if (layout.kind === 'leads') {
        if (layout.addressEl) {
          layout.addressEl.innerHTML = renderLeadsTableAddressCell(row.dataset.address);
        }
        setLeadPhoneSlot(layout.phone, row.dataset.phone);
        layout.email.innerHTML = renderLeadEmailSlotInner(row.dataset.email);
        layout.website.innerHTML = renderLeadWebSlotInner(row.dataset.website);
        syncRowSocialsUnderPhone(row);
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
        const gmBulk = resolveGoogleMapsSocialHref(
          row.dataset.url,
          row.dataset.title,
          row.dataset.address,
          row.dataset.city
        );
        let socialsHtml = '<div class="flex items-center justify-center gap-2.5">';
        if (__socialBrand) {
          socialsHtml += __socialBrand.renderLinks({
            gm: gmBulk,
            fb: row.dataset.facebook,
            ig: row.dataset.instagram,
            tw: row.dataset.twitter,
            gradSuffix: row.dataset.leadKey || 'bulk',
          });
        }
        socialsHtml += '</div>';
        layout.social.innerHTML = socialsHtml;
        if (layout.website) {
          const w = row.dataset.website;
          layout.website.innerHTML =
            w && w !== 'N/A'
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
        if (cellOriginals.socials !== undefined) layout.socials.innerHTML = cellOriginals.socials;
        layout.reviews.innerHTML = cellOriginals.reviews;
      } else {
        layout.email.innerHTML = cellOriginals.email;
        layout.social.innerHTML = cellOriginals.social;
      }
    }
  }

  document.addEventListener('agency-os-bulk-enhance-item-complete', (ev) => {
    const { key, success, result } = ev.detail || {};
    if (!key) return;
    const row = findResultRowByLeadKey(key);
    if (!row) return;
    const layout = getBulkEnhanceLayout(row);
    const snap = bulkEnhanceDomSnapshots.get(row);
    if (!layout || !snap) return;
    applyBulkEnhanceDomAfterFetch(row, layout, snap, success, result);
  });

  document.addEventListener('agency-os-bulk-enhance-finished', (ev) => {
    const d = ev.detail || {};
    const enhanceBtns = document.querySelectorAll('.js-bulk-enhance');
    const summaryLabel =
      d.successCount > 0
        ? `✨ Updated ${d.successCount} lead${d.successCount !== 1 ? 's' : ''}`
        : d.attempted > 0
          ? 'No new data (check API / console)'
          : '✨ Done';
    enhanceBtns.forEach((b) => {
      b.innerHTML = `<span class="text-[10px] font-black uppercase tracking-widest">${summaryLabel}</span>`;
    });
    if (d.attempted > 0 && d.successCount === 0) {
      const enhanceFailMsg = d.lastError
        ? `Enhance finished but no rows were updated.\n\n${d.lastError}`
        : 'Enhance could not add new fields (Firecrawl or network). Open Workspace → API integrations and confirm your Firecrawl key, then try again. Check server logs if it keeps failing.';
      if (typeof window.showAppToast === 'function') {
        window.showAppToast(enhanceFailMsg, { variant: 'error', duration: 12000 });
      } else {
        window.alert(enhanceFailMsg);
      }
    }
    updateOpportunityBadges();
    sortLeadsByOpportunity(false);
    applyTableStars();
    setTimeout(() => {
      const snap = bulkEnhanceBtnSnapshotHtml;
      bulkEnhanceBtnSnapshotHtml = null;
      enhanceBtns.forEach((b, i) => {
        b.classList.remove('loading', 'animate-magic');
        b.disabled = false;
        b.innerHTML = (snap && snap[i]) || b.innerHTML;
      });
    }, 2200);
  });

  // Bulk Enhance (Firecrawl) — `.js-bulk-enhance` on /leads attaches to both header + floating bar (no duplicate ids)
  document.querySelectorAll('.js-bulk-enhance').forEach((bulkEnhanceBtn) => {
    bulkEnhanceBtn.addEventListener('click', async () => {
      const checkedBoxes = document.querySelectorAll('.row-checkbox:checked, .lead-checkbox:checked');
      if (checkedBoxes.length === 0) return;

      const selectedRows = Array.from(checkedBoxes).map((cb) => cb.closest('.result-row')).filter(Boolean);

      const leadsToProcess = selectedRows.slice(0, 20);
      if (selectedRows.length > 20) console.warn('Bulk audit limited to first 20 selected leads.');

      const allKeyedPipeline =
        leadsToProcess.length > 0 &&
        leadsToProcess.every((r) => r.dataset.leadKey) &&
        leadsToProcess.every((r) => !!getBulkEnhanceLayout(r)) &&
        window.agencyOsBulkEnhance &&
        typeof window.agencyOsBulkEnhance.start === 'function';

      if (allKeyedPipeline) {
        const enhanceBtns = document.querySelectorAll('.js-bulk-enhance');
        const enhanceBtnOriginalHtml = Array.from(enhanceBtns).map((b) => b.innerHTML);
        bulkEnhanceBtnSnapshotHtml = enhanceBtnOriginalHtml;
        enhanceBtns.forEach((b) => {
          b.disabled = true;
          b.classList.add('loading', 'animate-magic');
          b.innerHTML = enhanceLoadingHtml;
        });
        const spinner =
          '<span class="text-[9px] font-bold text-brand-yellow uppercase tracking-widest animate-pulse">Scanning…</span>';
        for (const row of leadsToProcess) {
          const layout = getBulkEnhanceLayout(row);
          const cellOriginals = {};
          if (layout.kind === 'leads') {
            if (layout.addressEl) cellOriginals.address = layout.addressEl.innerHTML;
            cellOriginals.phone = layout.phone.innerHTML;
            cellOriginals.email = layout.email.innerHTML;
            cellOriginals.website = layout.website.innerHTML;
            cellOriginals.socials = layout.socials.innerHTML;
            cellOriginals.reviews = layout.reviews.innerHTML;
            if (layout.addressEl) layout.addressEl.innerHTML = spinner;
            layout.phone.innerHTML = spinner;
            layout.email.innerHTML = spinner;
            layout.website.innerHTML = spinner;
            layout.socials.innerHTML = spinner;
          } else {
            cellOriginals.email = layout.email.innerHTML;
            cellOriginals.social = layout.social.innerHTML;
            layout.social.innerHTML = `<div class="flex items-center gap-2 text-brand-muted">${spinner}</div>`;
            if (!row.dataset.email || row.dataset.email === 'N/A') layout.email.innerHTML = spinner;
          }
          bulkEnhanceDomSnapshots.set(row, cellOriginals);
        }
        window.agencyOsBulkEnhance.start(leadsToProcess.map((r) => r.dataset.leadKey));
        return;
      }

      const enhanceBtns = document.querySelectorAll('.js-bulk-enhance');
      const enhanceBtnOriginalHtml = Array.from(enhanceBtns).map((b) => b.innerHTML);
      let successCount = 0;
      let attemptedCount = 0;
      let lastError = '';
      try {
        try {
          sessionStorage.setItem('agency_os_sync_enhance', '1');
        } catch (_) {}
        updateProcessingStatus(true);
        const bellBadge = document.getElementById('bulkEnhanceBellBadge');
        const pingDot = document.getElementById('notificationPing');
        if (bellBadge) {
          bellBadge.textContent = 'ENR';
          bellBadge.classList.remove('hidden');
          bellBadge.setAttribute('title', 'Enriching selected leads');
        }
        if (pingDot) {
          pingDot.classList.remove('hidden');
          pingDot.classList.add('animate-ping');
        }
        enhanceBtns.forEach((b) => {
          b.disabled = true;
          b.classList.add('loading', 'animate-magic');
          b.innerHTML = enhanceLoadingHtml;
        });

        const spinner =
          '<span class="text-[9px] font-bold text-brand-yellow uppercase tracking-widest animate-pulse">Scanning…</span>';

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
            cellOriginals.socials = layout.socials.innerHTML;
            cellOriginals.reviews = layout.reviews.innerHTML;
            if (layout.addressEl) layout.addressEl.innerHTML = spinner;
            layout.phone.innerHTML = spinner;
            layout.email.innerHTML = spinner;
            layout.website.innerHTML = spinner;
            layout.socials.innerHTML = spinner;
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
            if (result.error) lastError = String(result.error);
            const d = result.lead || result.data;
            const ok = res.ok && result.success && d;
            if (ok) successCount += 1;
            applyBulkEnhanceDomAfterFetch(row, layout, cellOriginals, ok, result);
          } catch (err) {
            console.error('Enrichment error:', err);
            applyBulkEnhanceDomAfterFetch(row, layout, cellOriginals, false, {});
          }
        }
      } finally {
        try {
          sessionStorage.removeItem('agency_os_sync_enhance');
        } catch (_) {}
        updateProcessingStatus(false);
        const pingAfterSync = document.getElementById('notificationPing');
        if (pingAfterSync) {
          pingAfterSync.classList.remove('animate-ping');
          pingAfterSync.classList.add('hidden');
        }
      }

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
        const enhanceFailMsg = lastError
          ? `Enhance finished but no rows were updated.\n\n${lastError}`
          : 'Enhance could not add new fields (Firecrawl or network). Open Workspace → API integrations and confirm your Firecrawl key, then try again. Check server logs if it keeps failing.';
        if (typeof window.showAppToast === 'function') {
          window.showAppToast(enhanceFailMsg, { variant: 'error', duration: 12000 });
        } else {
          window.alert(enhanceFailMsg);
        }
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

  // Backfill missing phone/email (and website hints) for all leads in workspace.
  document.querySelectorAll('.js-bulk-ai-analysis').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const checked = Array.from(document.querySelectorAll('.row-checkbox:checked, .lead-checkbox:checked'));
      const rows = checked.length
        ? checked.map((cb) => cb.closest('.result-row')).filter(Boolean)
        : Array.from(document.querySelectorAll('.result-row'));
      const rowsWithSite = rows.filter((r) => r.dataset.website && r.dataset.website !== 'N/A');
      if (!rowsWithSite.length) return window.alert('No selected leads have a website URL.');
      const leadKeys = rowsWithSite.map((r) => r.dataset.leadKey).filter(Boolean).slice(0, 100);
      if (!leadKeys.length) return;
      const original = btn.innerHTML;
      btn.disabled = true;
      btn.classList.add('opacity-70');
      btn.innerHTML = '<span>Analyzing…</span>';
      try {
        let okCount = 0;
        let failCount = 0;
        for (const r of rowsWithSite.slice(0, 100)) {
          try {
            await runAiAnalysisForRow(r);
            okCount += 1;
          } catch {
            failCount += 1;
          }
        }
        if (typeof window.showAppToast === 'function') {
          window.showAppToast(
            `AI analysis complete: ${okCount} updated${failCount ? `, ${failCount} failed` : ''}.`,
            { variant: failCount ? 'warning' : 'success' }
          );
        }
      } catch (err) {
        const msg = err && err.message ? err.message : 'AI analysis failed';
        if (typeof window.showAppToast === 'function') window.showAppToast(msg, { variant: 'error' });
        else window.alert(msg);
      } finally {
        btn.disabled = false;
        btn.classList.remove('opacity-70');
        btn.innerHTML = original;
      }
    });
  });

  // Backfill missing phone/email (and website hints) for all leads in workspace.
  document.querySelectorAll('.js-enhance-missing-contacts').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = window.confirm(
        'Run deep contact backfill for all leads missing phone/email in this workspace?\n\nThis can take a few minutes.'
      );
      if (!ok) return;

      const originalHtml = btn.innerHTML;
      btn.disabled = true;
      btn.classList.add('opacity-70', 'cursor-wait');
      btn.innerHTML =
        '<svg class="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" aria-hidden="true"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle><path class="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg><span>Running...</span>';
      try {
        const res = await fetch('/leads/enhance-missing-contacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ limit: 200 }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
          throw new Error((data && data.error) || 'Backfill request failed.');
        }

        const msg = `Backfill finished: ${data.updated || 0} updated out of ${data.attempted || 0} attempted${data.remaining > 0 ? ` (${data.remaining} still queued)` : ''}.`;
        if (typeof window.showAppToast === 'function') {
          window.showAppToast(msg, { variant: 'success', duration: 7000 });
        } else {
          window.alert(msg);
        }
        window.setTimeout(() => {
          window.location.reload();
        }, 900);
      } catch (err) {
        const msg = err && err.message ? err.message : 'Backfill failed.';
        if (typeof window.showAppToast === 'function') {
          window.showAppToast(msg, { variant: 'error', duration: 12000 });
        } else {
          window.alert(msg);
        }
      } finally {
        btn.disabled = false;
        btn.classList.remove('opacity-70', 'cursor-wait');
        btn.innerHTML = originalHtml;
      }
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
        const targetPipelineId = pipelineMode ? String(columnWrap.dataset.pipelineStage || '').trim() : '';
        let count = 0;

        allRows.forEach((row) => {
            let shouldInclude = false;
            if (pipelineMode && targetPipelineId) {
              const sid = String(row.dataset.stageId || '').trim();
              shouldInclude = sid === targetPipelineId;
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
                        const newStageId = String(toCol.dataset.pipelineStage || '').trim();
                        if (!newStageId) return;
                        try {
                            const res = await fetch(`/leads/${leadKey}/update`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                                body: JSON.stringify({
                                  stageId: newStageId,
                                  pipelineStageUpdatedAt: new Date().toISOString(),
                                }),
                            });
                            const data = await res.json();
                            if (data.success) {
                                const originalRow = document.querySelector(`.result-row[data-lead-key="${leadKey}"]`);
                                if (originalRow) {
                                    const lead = data.lead || {};
                                    originalRow.dataset.stageId = newStageId;
                                    if (lead.pipelineStage != null) {
                                      originalRow.dataset.pipelineStage = String(lead.pipelineStage);
                                    }
                                    const labels = window.PIPELINE_STAGE_LABELS || {};
                                    const fullName = labels[newStageId] || '';
                                    const short = (fullName.split('(')[0].trim().slice(0, 22)) + (fullName.length > 22 ? '…' : '');
                                    originalRow.dataset.pipelineLabel = short;
                                    const pipeSel = originalRow.querySelector('.pipeline-inline-select');
                                    if (pipeSel) pipeSel.value = newStageId;
                                    const cell = originalRow.querySelector('.pipeline-stage-label');
                                    if (cell) cell.textContent = short || 'Stage';
                                    const wrap = originalRow.querySelector('.pipeline-stage-pill-wrap');
                                    if (wrap) {
                                      const dot =
                                        (window.PIPELINE_STAGE_COLORS && window.PIPELINE_STAGE_COLORS[newStageId]) ||
                                        '#94a3b8';
                                      wrap.style.boxShadow = `inset 3px 0 0 ${dot}`;
                                    }
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

  // --- Cold call war room (cold leads only: business info, script, dial) ---
  const batchOutreachBtn = document.getElementById('batchOutreachBtn');
  const batchOutreachBtnBulk = document.getElementById('batchOutreachBtnBulk');
  const warRoomModal = document.getElementById('warRoomModal');
  const closeWarRoom = document.getElementById('closeWarRoom');
  const warRoomGrid = document.getElementById('warRoomGrid');
  const warRoomTotal = document.getElementById('warRoomTotal');
  const warRoomPrev = document.getElementById('warRoomPrev');
  const warRoomNext = document.getElementById('warRoomNext');
  const warRoomPosition = document.getElementById('warRoomPosition');
  const warRoomTimerDisplay = document.getElementById('warRoomTimerDisplay');
  const warRoomTimerToggle = document.getElementById('warRoomTimerToggle');
  const warRoomTimerReset = document.getElementById('warRoomTimerReset');
  const warRoomAutoDialStart = document.getElementById('warRoomAutoDialStart');
  const warRoomAutoDialPause = document.getElementById('warRoomAutoDialPause');
  const warRoomAutoDialStop = document.getElementById('warRoomAutoDialStop');
  const warRoomAutoDialStatus = document.getElementById('warRoomAutoDialStatus');
  const warRoomDialInterval = document.getElementById('warRoomDialInterval');
  const warRoomSumDialed = document.getElementById('warRoomSumDialed');
  const warRoomSumConnected = document.getElementById('warRoomSumConnected');
  const warRoomSumVm = document.getElementById('warRoomSumVm');
  const warRoomSumNoAnswer = document.getElementById('warRoomSumNoAnswer');
  const warRoomSumGatekeeper = document.getElementById('warRoomSumGatekeeper');
  const warRoomSumWrong = document.getElementById('warRoomSumWrong');
  const warRoomSumCallback = document.getElementById('warRoomSumCallback');
  const warRoomSumFailures = document.getElementById('warRoomSumFailures');
  const warRoomSummaryHint = document.getElementById('warRoomSummaryHint');

  let warRoomRowEls = [];
  let warRoomIndex = 0;

  function isColdLeadRow(row) {
    if (!row) return false;
    const src = String(row.dataset.source || '');
    return !src.startsWith('adhello_');
  }

  function warRoomFormatClock(sec) {
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  }

  let warRoomTimerId = null;
  let warRoomElapsedSec = 0;
  let warRoomTimerRunning = false;
  let warRoomAutoDialTimer = null;
  let warRoomAutoDialRunning = false;
  let warRoomAutoDialPaused = false;
  let warRoomAutoDialCalled = new Set();
  let warRoomCallOptionsCache = null;
  let warRoomSessionStats = {
    dialed: 0,
    connected: 0,
    vmDrops: 0,
    noAnswer: 0,
    gatekeeper: 0,
    wrongNumber: 0,
    callbacks: 0,
    failures: 0,
  };

  function warRoomResetSessionStats() {
    warRoomSessionStats = {
      dialed: 0,
      connected: 0,
      vmDrops: 0,
      noAnswer: 0,
      gatekeeper: 0,
      wrongNumber: 0,
      callbacks: 0,
      failures: 0,
    };
    warRoomRenderSessionStats();
    if (warRoomSummaryHint) warRoomSummaryHint.textContent = 'Running totals for this war room session.';
  }

  function warRoomRenderSessionStats() {
    if (warRoomSumDialed) warRoomSumDialed.textContent = String(warRoomSessionStats.dialed || 0);
    if (warRoomSumConnected) warRoomSumConnected.textContent = String(warRoomSessionStats.connected || 0);
    if (warRoomSumVm) warRoomSumVm.textContent = String(warRoomSessionStats.vmDrops || 0);
    if (warRoomSumNoAnswer) warRoomSumNoAnswer.textContent = String(warRoomSessionStats.noAnswer || 0);
    if (warRoomSumGatekeeper) warRoomSumGatekeeper.textContent = String(warRoomSessionStats.gatekeeper || 0);
    if (warRoomSumWrong) warRoomSumWrong.textContent = String(warRoomSessionStats.wrongNumber || 0);
    if (warRoomSumCallback) warRoomSumCallback.textContent = String(warRoomSessionStats.callbacks || 0);
    if (warRoomSumFailures) warRoomSumFailures.textContent = String(warRoomSessionStats.failures || 0);
  }

  function warRoomFinalizeSummary(label) {
    if (!warRoomSummaryHint) return;
    const handled =
      (warRoomSessionStats.connected || 0) +
      (warRoomSessionStats.vmDrops || 0) +
      (warRoomSessionStats.noAnswer || 0) +
      (warRoomSessionStats.gatekeeper || 0) +
      (warRoomSessionStats.wrongNumber || 0) +
      (warRoomSessionStats.callbacks || 0);
    warRoomSummaryHint.textContent = `${label || 'Session'}: ${handled} outcomes logged, ${warRoomSessionStats.failures || 0} failures, ${warRoomSessionStats.dialed || 0} dial attempts.`;
  }

  function warRoomSetAutoDialStatus(msg, tone) {
    if (!warRoomAutoDialStatus) return;
    warRoomAutoDialStatus.textContent = msg;
    warRoomAutoDialStatus.className =
      'text-[10px] leading-tight ' +
      (tone === 'ok'
        ? 'text-emerald-300'
        : tone === 'warn'
          ? 'text-amber-300'
          : tone === 'err'
            ? 'text-rose-300'
            : 'text-slate-400');
  }

  async function warRoomEnsureCallOptions() {
    if (warRoomCallOptionsCache) return warRoomCallOptionsCache;
    try {
      const res = await fetch('/leads/telephony/call-options', {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error('call options unavailable');
      warRoomCallOptionsCache = {
        options: Array.isArray(data.options) ? data.options : [],
        activeFromNumber: String(data.activeFromNumber || '').trim(),
      };
      return warRoomCallOptionsCache;
    } catch (_) {
      warRoomCallOptionsCache = { options: [], activeFromNumber: '' };
      return warRoomCallOptionsCache;
    }
  }

  function warRoomAreaCode(raw) {
    const digits = String(raw || '').replace(/\D/g, '');
    if (digits.length < 10) return '';
    return digits.slice(-10, -7);
  }

  function warRoomBestRetryIso(row, mode) {
    const now = new Date();
    const dt = new Date(now.getTime());
    if (mode === 'callback') {
      dt.setHours(dt.getHours() + 2);
      dt.setMinutes(0, 0, 0);
      return dt.toISOString();
    }
    dt.setDate(dt.getDate() + 1);
    const category = String((row && row.dataset && row.dataset.category) || '').toLowerCase();
    const hour = category.includes('restaurant') ? 14 : category.includes('medical') ? 11 : 10;
    dt.setHours(hour, 0, 0, 0);
    return dt.toISOString();
  }

  async function warRoomSuggestedFromNumber(row) {
    const opt = await warRoomEnsureCallOptions();
    const list = Array.isArray(opt.options) ? opt.options : [];
    if (!list.length) return '';
    const leadArea = warRoomAreaCode(row && row.dataset ? row.dataset.phone : '');
    if (leadArea) {
      const matched = list.find((n) => warRoomAreaCode(n) === leadArea);
      if (matched) return matched;
    }
    return String(opt.activeFromNumber || list[0] || '').trim();
  }

  async function warRoomAppendLeadNote(leadKey, content) {
    const text = String(content || '').trim();
    if (!text) return;
    await fetch('/leads/' + encodeURIComponent(leadKey) + '/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ content: text }),
    }).catch(() => {});
  }

  async function warRoomPatchLead(leadKey, patch) {
    const res = await fetch('/leads/' + encodeURIComponent(leadKey) + '/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(patch || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error((data && data.error) || 'Update failed');
    return data;
  }

  async function warRoomApplyDisposition(row, code) {
    if (!row || !row.dataset || !row.dataset.leadKey) return;
    const key = String(row.dataset.leadKey || '').trim();
    const company = row.dataset.title || 'Lead';
    const res = await fetch('/leads/' + encodeURIComponent(key) + '/disposition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ code }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error((data && data.error) || 'Disposition failed');
    const status = String(data.status || (data.lead && data.lead.status) || 'Updated');
    if (data && data.lead && data.lead.status) row.dataset.status = String(data.lead.status);
    if (data && data.lead && data.lead.updates) row.dataset.updates = JSON.stringify(data.lead.updates);
    if (code === 'connected') warRoomSessionStats.connected += 1;
    if (code === 'no_answer') warRoomSessionStats.noAnswer += 1;
    if (code === 'gatekeeper') warRoomSessionStats.gatekeeper += 1;
    if (code === 'wrong_number') warRoomSessionStats.wrongNumber += 1;
    if (code === 'callback') warRoomSessionStats.callbacks += 1;
    warRoomRenderSessionStats();
    warRoomAutoDialCalled.add(key);
    const suffix = data.automation ? ` ${data.automation}` : '';
    warRoomSetAutoDialStatus(`${status} logged for ${company}.${suffix}`, code === 'wrong_number' ? 'warn' : 'ok');
    if (warRoomAutoDialCalled.size >= warRoomRowEls.length) {
      warRoomStopAutoDial('Auto dial completed all selected leads.');
    } else {
      warRoomGoNext();
    }
  }

  function warRoomStopAutoDial(reason) {
    if (warRoomAutoDialTimer) {
      clearInterval(warRoomAutoDialTimer);
      warRoomAutoDialTimer = null;
    }
    warRoomAutoDialRunning = false;
    warRoomAutoDialPaused = false;
    if (reason) warRoomSetAutoDialStatus(reason, 'warn');
    if (reason) warRoomFinalizeSummary('Auto dial stopped');
    if (warRoomAutoDialStart) warRoomAutoDialStart.disabled = false;
    if (warRoomAutoDialPause) warRoomAutoDialPause.textContent = 'Pause';
  }

  async function warRoomDialCurrentLead() {
    const row = warRoomRowEls[warRoomIndex];
    if (!row) return;
    const key = row.dataset.leadKey;
    if (!key) {
      warRoomGoNext();
      return;
    }
    const phones = splitPhoneNumbers(row.dataset.phone);
    if (!phones.length) {
      warRoomAutoDialCalled.add(key);
      warRoomSessionStats.failures += 1;
      warRoomRenderSessionStats();
      warRoomSetAutoDialStatus(`Skipped ${row.dataset.title || 'lead'} (no phone).`, 'warn');
      warRoomGoNext();
      return;
    }
    try {
      const fromNumber = await warRoomSuggestedFromNumber(row);
      const data = await requestLeadCallByKey(key, phones[0], fromNumber ? { fromNumber } : {});
      warRoomAutoDialCalled.add(key);
      warRoomSessionStats.dialed += 1;
      warRoomRenderSessionStats();
      warRoomSetAutoDialStatus(
        `Dialed ${row.dataset.title || 'lead'}${fromNumber ? ` from ${fromNumber}` : ''} (${warRoomAutoDialCalled.size}/${warRoomRowEls.length}).`,
        'ok'
      );
      if (data.lead && data.lead.updates) {
        row.dataset.updates = JSON.stringify(data.lead.updates);
      }
      if (data.lead && data.lead.status) {
        row.dataset.status = String(data.lead.status);
      }
      warRoomGoNext();
      if (warRoomAutoDialCalled.size >= warRoomRowEls.length) {
        warRoomStopAutoDial('Auto dial completed all selected leads.');
      }
    } catch (err) {
      warRoomSessionStats.failures += 1;
      warRoomRenderSessionStats();
      warRoomSetAutoDialStatus(`Dial failed: ${err.message || 'unknown error'}`, 'err');
      warRoomGoNext();
    }
  }

  function warRoomStartAutoDial() {
    if (!warRoomRowEls.length) {
      warRoomSetAutoDialStatus('No leads selected for auto dial.', 'warn');
      return;
    }
    const sec = Math.max(5, Math.min(120, parseInt((warRoomDialInterval && warRoomDialInterval.value) || '12', 10) || 12));
    if (warRoomDialInterval) warRoomDialInterval.value = String(sec);
    warRoomStopAutoDial();
    warRoomAutoDialCalled = new Set();
    warRoomAutoDialRunning = true;
    warRoomAutoDialPaused = false;
    if (warRoomAutoDialStart) warRoomAutoDialStart.disabled = true;
    if (warRoomAutoDialPause) warRoomAutoDialPause.textContent = 'Pause';
    warRoomSetAutoDialStatus(`Auto dial running every ${sec}s...`, 'ok');
    warRoomDialCurrentLead();
    warRoomAutoDialTimer = setInterval(() => {
      if (!warRoomAutoDialRunning || warRoomAutoDialPaused) return;
      if (warRoomAutoDialCalled.size >= warRoomRowEls.length) {
        warRoomStopAutoDial('Auto dial completed all selected leads.');
        return;
      }
      warRoomDialCurrentLead();
    }, sec * 1000);
  }

  function warRoomToggleAutoDialPause() {
    if (!warRoomAutoDialRunning) {
      warRoomSetAutoDialStatus('Start auto dial first.', 'warn');
      return;
    }
    warRoomAutoDialPaused = !warRoomAutoDialPaused;
    if (warRoomAutoDialPause) warRoomAutoDialPause.textContent = warRoomAutoDialPaused ? 'Resume' : 'Pause';
    warRoomSetAutoDialStatus(
      warRoomAutoDialPaused
        ? `Auto dial paused (${warRoomAutoDialCalled.size}/${warRoomRowEls.length}).`
        : `Auto dial resumed (${warRoomAutoDialCalled.size}/${warRoomRowEls.length}).`,
      'warn'
    );
  }

  function warRoomUpdateTimerDisplay() {
    if (warRoomTimerDisplay) warRoomTimerDisplay.textContent = warRoomFormatClock(warRoomElapsedSec);
    if (warRoomTimerToggle) {
      warRoomTimerToggle.textContent = warRoomTimerRunning ? 'Pause' : 'Resume';
      warRoomTimerToggle.setAttribute('aria-pressed', warRoomTimerRunning ? 'true' : 'false');
    }
  }

  function warRoomStopTimerInterval() {
    if (warRoomTimerId) {
      clearInterval(warRoomTimerId);
      warRoomTimerId = null;
    }
  }

  function warRoomStartSessionTimer() {
    warRoomStopTimerInterval();
    warRoomElapsedSec = 0;
    warRoomTimerRunning = true;
    warRoomUpdateTimerDisplay();
    warRoomTimerId = setInterval(() => {
      if (!warRoomTimerRunning) return;
      warRoomElapsedSec += 1;
      warRoomUpdateTimerDisplay();
    }, 1000);
  }

  function warRoomPauseResumeTimer() {
    warRoomTimerRunning = !warRoomTimerRunning;
    warRoomUpdateTimerDisplay();
  }

  function warRoomResetTimer() {
    warRoomElapsedSec = 0;
    warRoomTimerRunning = true;
    warRoomStopTimerInterval();
    warRoomUpdateTimerDisplay();
    warRoomTimerId = setInterval(() => {
      if (!warRoomTimerRunning) return;
      warRoomElapsedSec += 1;
      warRoomUpdateTimerDisplay();
    }, 1000);
  }

  function closeWarRoomModal() {
    if (!warRoomModal) return;
    warRoomFlushCurrentScriptDraft();
    warRoomStopTimerInterval();
    warRoomTimerRunning = false;
    warRoomElapsedSec = 0;
    if (warRoomTimerDisplay) warRoomTimerDisplay.textContent = '00:00';
    if (warRoomTimerToggle) warRoomTimerToggle.textContent = 'Pause';
    warRoomRowEls = [];
    warRoomIndex = 0;
    warRoomFinalizeSummary('Session closed');
    warRoomStopAutoDial();
    if (warRoomGrid) warRoomGrid.innerHTML = '';
    if (warRoomPosition) warRoomPosition.textContent = '—';
    warRoomUpdateFooterDial({ dataset: { phone: '' } });
    warRoomModal.classList.add('hidden');
  }

  function warRoomKeyboardConsumesNav(ev) {
    const t = ev && ev.target;
    if (!t) return false;
    if (t.isContentEditable) return true;
    const tag = (t.tagName || '').toUpperCase();
    if (tag === 'TEXTAREA') return true;
    if (tag === 'INPUT') {
      const ty = (t.type || '').toLowerCase();
      if (ty === 'checkbox' || ty === 'radio' || ty === 'button' || ty === 'submit' || ty === 'reset') return false;
      return true;
    }
    return false;
  }

  function warRoomClampIndex(i) {
    const n = warRoomRowEls.length;
    if (n === 0) return 0;
    return ((i % n) + n) % n;
  }

  function warRoomGoDelta(delta) {
    if (!warRoomRowEls.length) return;
    if (warRoomRowEls.length <= 1) return;
    warRoomIndex = warRoomClampIndex(warRoomIndex + delta);
    warRoomRenderCurrent();
  }

  function warRoomGoNext() {
    warRoomGoDelta(1);
  }

  function warRoomGoPrev() {
    warRoomGoDelta(-1);
  }

  const warRoomScriptDrafts = Object.create(null);

  function warRoomDraftKey(leadKey, tab) {
    return String(leadKey || '') + '|' + String(tab || 'opener');
  }

  function warRoomFlushCurrentScriptDraft() {
    if (!warRoomGrid) return;
    const card = warRoomGrid.querySelector('[data-war-room-card]');
    if (!card) return;
    const ta = card.querySelector('.war-room-script-input');
    const lk = card.dataset.leadKey;
    const tab = card.dataset.scriptTab || 'opener';
    if (ta && lk) warRoomScriptDrafts[warRoomDraftKey(lk, tab)] = ta.value;
  }

  function warRoomBuildScripts(title, city, category, gapPhrase, compPhrase, gaps) {
    const cat = category && category !== 'N/A' ? category : 'businesses';
    const place = city || 'the area';
    const opener = `Hi, this is [your name]—I'm reaching out to local ${cat} in ${place}. I came across ${title} and had you on my list to call.\n\n${gapPhrase}${compPhrase}\n\nI'm not looking to waste your time—do you have sixty seconds for one concrete idea? If now's bad, what time works for a two-minute call later today?`;
    const gapHint = gaps.length ? gaps[0] : 'a couple of ways to sharpen your online presence';
    const short = `Hi, this is [your name]—quick call for ${title} in ${place}. I noticed ${gapHint} and have one specific suggestion—got thirty seconds?\n\nIf this is a bad time, when should I try you back?`;
    const voicemail = `Hi, this is [your name] from [company]. I'm calling ${title} with a brief idea on how you're showing up online versus other ${cat} in ${place}. Worth two minutes when you have a moment—my number is [your number]. Thanks, and I'll try you again if I don't hear back.`;
    return { opener, short, voicemail };
  }

  function warRoomParseNoteHistory(row) {
    try {
      const raw = row.dataset.updates;
      if (!raw) return [];
      const u = JSON.parse(raw);
      if (!Array.isArray(u)) return [];
      return u.filter((x) => x && x.type === 'note' && x.value);
    } catch (_) {
      return [];
    }
  }

  function warRoomUpdateFooterDial(row) {
    const a = document.getElementById('warRoomPrimaryDial');
    const label = document.getElementById('warRoomPrimaryDialLabel');
    const alt = document.getElementById('warRoomAltPhones');
    if (!a || !label) return;
    const phones = splitPhoneNumbers(row.dataset.phone);
    if (!phones.length) {
      a.removeAttribute('href');
      a.href = '#';
      a.classList.add('pointer-events-none', 'opacity-60', 'grayscale');
      a.classList.remove('hover:bg-emerald-400');
      label.textContent = 'No phone on file — add in pipeline';
      if (alt) {
        alt.classList.add('hidden');
        alt.textContent = '';
      }
      return;
    }
    a.classList.remove('pointer-events-none', 'opacity-60', 'grayscale');
    a.href = '#';
    a.dataset.leadKey = String(row.dataset.leadKey || '').trim();
    a.dataset.phone = String(phones[0] || '').trim();
    label.textContent = phones[0];
    if (alt) {
      if (phones.length > 1) {
        alt.classList.remove('hidden');
        alt.textContent = 'Also: ' + phones.slice(1).join(' · ');
      } else {
        alt.classList.add('hidden');
        alt.textContent = '';
      }
    }
  }

  function warRoomFetchAiOpener(leadKey, card, scriptDefaults) {
    const ta = card.querySelector('.war-room-script-input');
    const statusEl = card.querySelector('.war-room-ai-opener-status');
    if (!ta || !leadKey) return;
    const placeholderBackup = ta.placeholder;
    ta.placeholder = 'Generating AI opener from audit insights…';
    if (statusEl) statusEl.textContent = 'Drafting opener with AI…';

    fetch('/leads/' + encodeURIComponent(leadKey) + '/insights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({}),
    })
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (!card.isConnected || card.dataset.leadKey !== leadKey) return;
        if (!data || !data.success) return;
        const raw = typeof data.warRoomOpener === 'string' ? data.warRoomOpener.trim() : '';
        if (!raw) return;
        if (card.dataset.openerUserEdited === '1') return;
        scriptDefaults.opener = raw;
        warRoomScriptDrafts[warRoomDraftKey(leadKey, 'opener')] = raw;
        if ((card.dataset.scriptTab || 'opener') === 'opener') ta.value = raw;
      })
      .catch(() => {})
      .finally(() => {
        if (!ta.isConnected) return;
        ta.placeholder = placeholderBackup;
        if (statusEl && card.isConnected) statusEl.textContent = '';
      });
  }

  function warRoomBindCard(card, row, scriptDefaults) {
    const leadKey = row.dataset.leadKey;
    if (!leadKey) return;

    const ta = card.querySelector('.war-room-script-input');
    const tabBtns = card.querySelectorAll('[data-war-script-tab]');
    card.dataset.openerUserEdited = '';

    function flushDraft() {
      if (!ta) return;
      const cur = card.dataset.scriptTab || 'opener';
      warRoomScriptDrafts[warRoomDraftKey(leadKey, cur)] = ta.value;
    }

    function applyTab(tab) {
      flushDraft();
      card.dataset.scriptTab = tab;
      tabBtns.forEach((b) => {
        const on = b.getAttribute('data-war-script-tab') === tab;
        b.classList.toggle('bg-amber-400', on);
        b.classList.toggle('text-slate-900', on);
        b.classList.toggle('border-amber-500', on);
        b.classList.toggle('shadow-md', on);
        b.classList.toggle('bg-slate-100', !on);
        b.classList.toggle('dark:bg-slate-700', !on);
        b.classList.toggle('text-slate-700', !on);
        b.classList.toggle('dark:text-slate-200', !on);
        b.classList.toggle('border-slate-200', !on);
        b.classList.toggle('dark:border-slate-600', !on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      const draft = warRoomScriptDrafts[warRoomDraftKey(leadKey, tab)];
      ta.value = draft != null ? draft : scriptDefaults[tab] || '';
    }

    tabBtns.forEach((btn) => {
      btn.addEventListener('click', () => applyTab(btn.getAttribute('data-war-script-tab')));
    });
    card.dataset.scriptTab = 'opener';
    applyTab('opener');

    if (ta) {
      ta.addEventListener('input', () => {
        if ((card.dataset.scriptTab || 'opener') === 'opener') card.dataset.openerUserEdited = '1';
      });
    }
    warRoomFetchAiOpener(leadKey, card, scriptDefaults);

    const saveBtn = card.querySelector('.war-room-save-note');
    const vmNextBtn = card.querySelector('.war-room-vm-next');
    const dispBtns = card.querySelectorAll('.war-room-disp-btn');
    const noteTa = card.querySelector('.war-room-notes-input');
    const statusEl = card.querySelector('.war-room-note-status');
    if (vmNextBtn) {
      vmNextBtn.addEventListener('click', async () => {
        vmNextBtn.disabled = true;
        const original = vmNextBtn.textContent;
        vmNextBtn.textContent = 'Dropping...';
        try {
          const fromNumber = await warRoomSuggestedFromNumber(row);
          const data = await requestLeadVoicemailByKey(leadKey, fromNumber ? { fromNumber } : {});
          if (data.lead && data.lead.updates) row.dataset.updates = JSON.stringify(data.lead.updates);
          if (data.lead && data.lead.status) row.dataset.status = String(data.lead.status);
          warRoomAutoDialCalled.add(leadKey);
          warRoomSessionStats.vmDrops += 1;
          warRoomRenderSessionStats();
          warRoomSetAutoDialStatus(
            `Voicemail dropped for ${row.dataset.title || 'lead'}${fromNumber ? ` from ${fromNumber}` : ''}; moving next.`,
            'ok'
          );
          if (warRoomAutoDialCalled.size >= warRoomRowEls.length) {
            warRoomStopAutoDial('Auto dial completed all selected leads.');
          } else {
            warRoomGoNext();
          }
        } catch (err) {
          warRoomSessionStats.failures += 1;
          warRoomRenderSessionStats();
          warRoomSetAutoDialStatus(`Voicemail drop failed: ${err.message || 'unknown error'}`, 'err');
        } finally {
          vmNextBtn.disabled = false;
          vmNextBtn.textContent = original;
        }
      });
    }
    if (saveBtn && noteTa && statusEl) {
      saveBtn.addEventListener('click', async () => {
        const content = (noteTa.value || '').trim();
        if (!content) {
          statusEl.textContent = 'Write a note first';
          statusEl.classList.remove('text-emerald-600', 'dark:text-emerald-400');
          statusEl.classList.add('text-amber-700', 'dark:text-amber-300');
          return;
        }
        saveBtn.disabled = true;
        statusEl.textContent = 'Saving…';
        try {
          const res = await fetch('/leads/' + encodeURIComponent(leadKey) + '/notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ content }),
          });
          let data = {};
          try {
            data = await res.json();
          } catch (_) {
            data = {};
          }
          if (res.ok && data.success) {
            statusEl.textContent = 'Saved to lead timeline';
            statusEl.classList.add('text-emerald-600', 'dark:text-emerald-400');
            statusEl.classList.remove('text-amber-700', 'dark:text-amber-300');
            noteTa.value = '';
            try {
              const updates = Array.isArray(data.updates) ? data.updates : [];
              row.dataset.updates = JSON.stringify(updates);
              const hist = card.querySelector('.war-room-notes-history');
              if (hist) {
                const notes = updates.filter((x) => x && x.type === 'note' && x.value);
                const last = notes.slice(-2);
                hist.classList.remove('hidden');
                hist.innerHTML = last.length
                  ? '<span class="text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider text-[9px]">Recent notes</span><ul class="mt-1 space-y-1 list-disc pl-4">' +
                    last.map((n) => '<li class="text-xs text-slate-600 dark:text-slate-300">' + escapeHtmlText(String(n.value).slice(0, 220)) + (String(n.value).length > 220 ? '…' : '') + '</li>').join('') +
                    '</ul>'
                  : '';
              }
            } catch (_) {
              /* ignore */
            }
          } else {
            statusEl.textContent = (data && data.error) || 'Could not save note';
            statusEl.classList.remove('text-emerald-600', 'dark:text-emerald-400');
            statusEl.classList.add('text-rose-600', 'dark:text-rose-400');
          }
        } catch (_) {
          statusEl.textContent = 'Network error';
          statusEl.classList.add('text-rose-600');
        }
        saveBtn.disabled = false;
      });
    }
    if (dispBtns && dispBtns.length) {
      dispBtns.forEach((btn) => {
        btn.addEventListener('click', async () => {
          const code = String(btn.getAttribute('data-disp') || '').trim();
          if (!code) return;
          btn.disabled = true;
          const original = btn.textContent;
          btn.textContent = 'Saving...';
          try {
            await warRoomApplyDisposition(row, code);
          } catch (err) {
            warRoomSetAutoDialStatus(`Disposition failed: ${err.message || 'unknown error'}`, 'err');
          } finally {
            btn.disabled = false;
            btn.textContent = original;
          }
        });
      });
    }
  }

  function warRoomRenderCurrent() {
    if (!warRoomGrid) return;
    warRoomFlushCurrentScriptDraft();
    warRoomGrid.innerHTML = '';
    const row = warRoomRowEls[warRoomIndex];
    if (!row) return;
    const { card, scriptDefaults } = createWarRoomCard(row);
    warRoomGrid.appendChild(card);
    warRoomBindCard(card, row, scriptDefaults);
    warRoomUpdateFooterDial(row);
    const n = warRoomRowEls.length;
    if (warRoomPosition) warRoomPosition.textContent = n ? `${warRoomIndex + 1} / ${n}` : '—';
    const multi = n > 1;
    if (warRoomPrev) {
      warRoomPrev.disabled = !multi;
      warRoomPrev.setAttribute('aria-disabled', multi ? 'false' : 'true');
    }
    if (warRoomNext) {
      warRoomNext.disabled = !multi;
      warRoomNext.setAttribute('aria-disabled', multi ? 'false' : 'true');
    }
  }

  function warRoomOnGlobalKeydown(e) {
    if (!warRoomModal || warRoomModal.classList.contains('hidden')) return;
    if (!warRoomRowEls.length) return;
    if (warRoomKeyboardConsumesNav(e)) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      warRoomGoPrev();
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      warRoomGoNext();
      return;
    }
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      if (warRoomRowEls.length > 1) warRoomGoNext();
    }
    const row = warRoomRowEls[warRoomIndex];
    if (!row) return;
    if (e.key === '1') {
      e.preventDefault();
      warRoomApplyDisposition(row, 'connected').catch(() => {});
      return;
    }
    if (e.key === '2') {
      e.preventDefault();
      const key = String(row.dataset.leadKey || '').trim();
      if (!key) return;
      const fromPromise = warRoomSuggestedFromNumber(row);
      fromPromise
        .then((fromNumber) => requestLeadVoicemailByKey(key, fromNumber ? { fromNumber } : {}))
        .then((data) => {
          if (data.lead && data.lead.updates) row.dataset.updates = JSON.stringify(data.lead.updates);
          if (data.lead && data.lead.status) row.dataset.status = String(data.lead.status);
          warRoomAutoDialCalled.add(key);
          warRoomSessionStats.vmDrops += 1;
          warRoomRenderSessionStats();
          warRoomSetAutoDialStatus(`Voicemail dropped for ${row.dataset.title || 'lead'}; moving next.`, 'ok');
          if (warRoomAutoDialCalled.size >= warRoomRowEls.length) warRoomStopAutoDial('Auto dial completed all selected leads.');
          else warRoomGoNext();
        })
        .catch((err) => {
          warRoomSessionStats.failures += 1;
          warRoomRenderSessionStats();
          warRoomSetAutoDialStatus(`Voicemail drop failed: ${err.message || 'unknown error'}`, 'err');
        });
      return;
    }
    if (e.key === '3') {
      e.preventDefault();
      warRoomApplyDisposition(row, 'no_answer').catch(() => {});
      return;
    }
    if (e.key === '4') {
      e.preventDefault();
      warRoomApplyDisposition(row, 'gatekeeper').catch(() => {});
      return;
    }
    if (e.key === '5') {
      e.preventDefault();
      warRoomApplyDisposition(row, 'wrong_number').catch(() => {});
      return;
    }
    if (e.key === '6') {
      e.preventDefault();
      warRoomApplyDisposition(row, 'callback').catch(() => {});
    }
  }

  function splitPhoneNumbers(raw) {
    if (raw == null || raw === '' || raw === 'N/A') return [];
    return String(raw)
      .split(/[,;/|]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s !== 'N/A');
  }

  function telHref(num) {
    const digits = String(num).replace(/[^\d+]/g, '');
    return digits ? `tel:${digits}` : '#';
  }

  function openWarRoomFromSelection() {
    if (!warRoomModal || !warRoomGrid) return;
    const selected = Array.from(document.querySelectorAll('.result-row .lead-checkbox:checked'));
    if (selected.length === 0) {
      alert('Select at least one lead to open the cold call war room.');
      return;
    }
    const coldOnly = selected.filter((cb) => isColdLeadRow(cb.closest('.result-row')));
    if (coldOnly.length === 0) {
      alert(
        'Cold call war room only includes cold leads. Warm inbound (AdHello) leads are excluded—deselect them or filter the table to Cold, then try again.'
      );
      return;
    }
    if (coldOnly.length < selected.length) {
      const skipped = selected.length - coldOnly.length;
      alert(`Skipped ${skipped} warm lead${skipped === 1 ? '' : 's'}. Opening cold call room with ${coldOnly.length} cold lead${coldOnly.length === 1 ? '' : 's'}.`);
    }
    renderWarRoom(coldOnly);
    warRoomModal.classList.remove('hidden');
    warRoomStartSessionTimer();
    requestAnimationFrame(() => {
      if (warRoomGrid) warRoomGrid.focus();
    });
  }

  if (warRoomModal) {
    if (batchOutreachBtn) batchOutreachBtn.addEventListener('click', openWarRoomFromSelection);
    if (batchOutreachBtnBulk) batchOutreachBtnBulk.addEventListener('click', openWarRoomFromSelection);
    if (closeWarRoom) closeWarRoom.addEventListener('click', closeWarRoomModal);
    if (warRoomTimerToggle) warRoomTimerToggle.addEventListener('click', warRoomPauseResumeTimer);
    if (warRoomTimerReset) warRoomTimerReset.addEventListener('click', warRoomResetTimer);
    if (warRoomPrev) warRoomPrev.addEventListener('click', () => warRoomGoPrev());
    if (warRoomNext) warRoomNext.addEventListener('click', () => warRoomGoNext());
    if (warRoomAutoDialStart) warRoomAutoDialStart.addEventListener('click', warRoomStartAutoDial);
    if (warRoomAutoDialPause) warRoomAutoDialPause.addEventListener('click', warRoomToggleAutoDialPause);
    if (warRoomAutoDialStop) warRoomAutoDialStop.addEventListener('click', () => warRoomStopAutoDial('Auto dial stopped.'));
    const warRoomPrimaryDial = document.getElementById('warRoomPrimaryDial');
    if (warRoomPrimaryDial) {
      warRoomPrimaryDial.addEventListener('click', async (e) => {
        e.preventDefault();
        if (warRoomPrimaryDial.classList.contains('pointer-events-none')) return;
        const row = warRoomRowEls[warRoomIndex];
        if (!row) return;
        const key = String(row.dataset.leadKey || '').trim();
        const phone = splitPhoneNumbers(row.dataset.phone)[0] || '';
        if (!key) return;
        warRoomPrimaryDial.classList.add('pointer-events-none', 'opacity-70');
        try {
          const fromNumber = await warRoomSuggestedFromNumber(row);
          const data = await requestLeadCallByKey(key, phone, fromNumber ? { fromNumber } : {});
          if (data.lead && data.lead.updates) row.dataset.updates = JSON.stringify(data.lead.updates);
          if (data.lead && data.lead.status) row.dataset.status = String(data.lead.status);
          warRoomSessionStats.dialed += 1;
          warRoomRenderSessionStats();
          warRoomSetAutoDialStatus(`Call started for current lead${fromNumber ? ` from ${fromNumber}` : ''}.`, 'ok');
        } catch (err) {
          warRoomSessionStats.failures += 1;
          warRoomRenderSessionStats();
          warRoomSetAutoDialStatus(`Dial failed: ${err.message || 'unknown error'}`, 'err');
        } finally {
          warRoomPrimaryDial.classList.remove('pointer-events-none', 'opacity-70');
        }
      });
    }
    document.addEventListener('keydown', warRoomOnGlobalKeydown, true);
  }

  function renderWarRoom(selectedCheckboxes) {
    warRoomRowEls = [];
    selectedCheckboxes.forEach((cb) => {
      const row = cb.closest('.result-row');
      if (row && isColdLeadRow(row)) warRoomRowEls.push(row);
    });
    warRoomTotal.textContent = String(warRoomRowEls.length);
    warRoomIndex = 0;
    warRoomAutoDialCalled = new Set();
    warRoomResetSessionStats();
    warRoomSetAutoDialStatus('Auto dialer idle.', null);
    if (warRoomAutoDialStart) warRoomAutoDialStart.disabled = false;
    if (warRoomAutoDialPause) warRoomAutoDialPause.textContent = 'Pause';
    warRoomRenderCurrent();
  }

  function createWarRoomCard(row) {
    const card = document.createElement('div');
    card.className =
      'max-w-4xl mx-auto w-full rounded-2xl border-2 border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xl p-5 md:p-6 flex flex-col gap-4';
    card.setAttribute('data-war-room-card', '1');
    card.dataset.leadKey = row.dataset.leadKey || '';

    const title = row.dataset.title || 'Company';
    const city = row.dataset.city || '';
    const category = row.dataset.category || '';
    const address = row.dataset.address || '';
    const website = row.dataset.website || '';
    const pipelineLabel = row.dataset.pipelineLabel || '';
    const email = row.dataset.email || '';
    const competitor = row.dataset.competitorName;
    const compGap = row.dataset.competitorGap;
    const rating = row.dataset.rating || 0;
    const reviews = row.dataset.reviews || '0';

    const gaps = [];
    if (!website || website === 'N/A') gaps.push('no website on file');
    if (row.dataset.isMobileFriendly === 'false') gaps.push("site isn't mobile-friendly");
    if (row.dataset.hasChatbot === 'false') gaps.push('no obvious lead-capture chat');
    if (row.dataset.hasSchemaMarkup === 'false') gaps.push('thin local SEO schema');
    if (row.dataset.hasClickToCall === 'false') gaps.push('click-to-call could be stronger');
    if (row.dataset.isOutdated === 'true') gaps.push('site looks dated vs competitors');

    const gapPhrase =
      gaps.length > 0
        ? `On your site I noticed ${gaps.join(' and ')}.`
        : 'I spent a few minutes on your site and have a couple of ideas that might help conversions.';
    const compPhrase =
      competitor && competitor !== 'N/A'
        ? ` I also saw ${competitor} nearby—they seem stronger on ${compGap || 'digital presence'}.`
        : '';

    const scriptDefaults = warRoomBuildScripts(title, city, category, gapPhrase, compPhrase, gaps);
    const suggestedAction =
      gaps.length > 2
        ? 'Lead with website + conversion gap, then offer a quick fix call.'
        : (parseFloat(rating) || 0) >= 4.5
          ? 'Lead with growth angle and social proof expansion.'
          : 'Lead with visibility + reputation improvement opener.';

    const ws =
      website && website !== 'N/A'
        ? website.startsWith('http')
          ? website
          : `https://${website}`
        : '';
    const wsLabel =
      website && website !== 'N/A' ? String(website).replace(/^https?:\/\//i, '').split('?')[0].replace(/\/$/, '') : '';

    const mailRow =
      email && email !== 'N/A'
        ? `<a href="mailto:${encodeURIComponent(email)}" class="text-sm font-bold text-amber-700 dark:text-amber-300 hover:underline truncate">${escapeHtmlText(email)}</a>`
        : `<span class="text-sm text-slate-400">—</span>`;

    const noteHistory = warRoomParseNoteHistory(row);
    const lastNotes = noteHistory.slice(-2);
    const notesHistoryHtml =
      lastNotes.length > 0
        ? `<div class="war-room-notes-history mt-2 pt-2 border-t border-slate-200 dark:border-slate-600"><span class="text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider text-[9px]">Recent notes</span><ul class="mt-1 space-y-1 list-disc pl-4">${lastNotes
            .map(
              (n) =>
                `<li class="text-xs text-slate-600 dark:text-slate-300">${escapeHtmlText(String(n.value).slice(0, 220))}${String(n.value).length > 220 ? '…' : ''}</li>`
            )
            .join('')}</ul></div>`
        : '<div class="war-room-notes-history mt-2 hidden"></div>';

    card.innerHTML = `
        <div class="flex items-start justify-between gap-3">
            <div class="flex flex-col gap-1 min-w-0">
                <h4 class="font-black text-xl md:text-2xl leading-tight text-slate-900 dark:text-white truncate">${escapeHtmlText(title)}</h4>
                <div class="flex flex-wrap items-center gap-2 war-room-stars-${row.dataset.leadKey}">
                    <span class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">${rating} ★ · ${reviews} reviews</span>
                </div>
            </div>
            <span class="shrink-0 px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-500 bg-slate-100 dark:bg-slate-700 text-[9px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300">Cold</span>
        </div>
        <div class="rounded-xl border-2 border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/50 p-4 space-y-2">
            <p class="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Business</p>
            <p class="text-sm text-slate-800 dark:text-slate-100 leading-relaxed">${category && category !== 'N/A' ? `<span class="font-bold text-slate-900 dark:text-white">${escapeHtmlText(category)}</span> · ` : ''}${escapeHtmlText([address, city].filter(Boolean).join(', ') || '—')}</p>
            ${pipelineLabel ? `<p class="text-sm text-slate-600 dark:text-slate-300">Pipeline: <span class="font-semibold text-slate-900 dark:text-white">${escapeHtmlText(pipelineLabel)}</span></p>` : ''}
            ${
              ws
                ? `<a href="${escapeHtmlAttr(ws)}" target="_blank" rel="noopener noreferrer" class="text-sm font-bold text-amber-700 dark:text-amber-300 hover:underline break-all">${escapeHtmlText(wsLabel)}</a>`
                : `<p class="text-sm text-slate-400">No website on file</p>`
            }
            <p class="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 pt-2">Email</p>
            <div class="min-w-0">${mailRow}</div>
            <p class="text-[11px] text-slate-500 dark:text-slate-400 pt-1">Use the <strong class="text-slate-700 dark:text-slate-200">green call button</strong> in the bar below for the primary number.</p>
            <p class="text-[11px] text-amber-700 dark:text-amber-300 pt-1"><strong>Next best action:</strong> ${escapeHtmlText(suggestedAction)}</p>
            <p class="text-[10px] text-slate-500 dark:text-slate-400">Hotkeys: <strong>1</strong> connected, <strong>2</strong> voicemail drop + next, <strong>3</strong> no answer, <strong>4</strong> gatekeeper, <strong>5</strong> wrong number, <strong>6</strong> callback.</p>
        </div>
        <div>
            <p class="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-2">Call script</p>
            <div class="flex flex-wrap gap-2 mb-2" role="tablist" aria-label="Script type">
              <button type="button" role="tab" data-war-script-tab="opener" aria-selected="true" class="rounded-lg border-2 px-3 py-2 text-[10px] font-black uppercase tracking-widest transition-colors">Opener</button>
              <button type="button" role="tab" data-war-script-tab="short" aria-selected="false" class="rounded-lg border-2 px-3 py-2 text-[10px] font-black uppercase tracking-widest transition-colors">Short pitch</button>
              <button type="button" role="tab" data-war-script-tab="voicemail" aria-selected="false" class="rounded-lg border-2 px-3 py-2 text-[10px] font-black uppercase tracking-widest transition-colors">Voicemail</button>
            </div>
            <textarea class="war-room-script-input w-full rounded-xl border-2 border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 p-4 text-sm text-slate-800 dark:text-slate-100 leading-relaxed min-h-[12rem] focus:border-amber-500 focus:ring-2 focus:ring-amber-400/30 outline-none transition-all resize-y" placeholder="Pick a tab above, then edit…"></textarea>
            <p class="war-room-ai-opener-status text-[10px] font-semibold text-amber-700 dark:text-amber-300 min-h-[1.25rem]" aria-live="polite"></p>
        </div>
        <div class="rounded-xl border-2 border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/40 p-4">
            <p class="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-2">Notes (saved to this lead)</p>
            <textarea class="war-room-notes-input w-full rounded-xl border-2 border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 p-3 text-sm text-slate-800 dark:text-slate-100 min-h-[5rem] focus:border-amber-500 outline-none resize-y" placeholder="Gatekeeper name, objection, follow-up time…"></textarea>
            <div class="mt-2 flex flex-wrap items-center gap-3">
              <button type="button" class="war-room-save-note rounded-xl bg-slate-900 dark:bg-amber-400 text-white dark:text-slate-900 px-4 py-2 text-[10px] font-black uppercase tracking-widest hover:opacity-90 transition-opacity">Save note to lead</button>
              <span class="war-room-note-status text-xs font-semibold text-slate-500" aria-live="polite"></span>
            </div>
            ${notesHistoryHtml}
        </div>
        <div class="flex flex-wrap gap-2">
            <button type="button" class="war-room-vm-next px-3 py-1.5 rounded-lg bg-violet-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-violet-700 transition-colors">Drop VM + Next</button>
            <button type="button" class="war-room-disp-btn px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-emerald-500 transition-colors" data-disp="connected">Connected</button>
            <button type="button" class="war-room-disp-btn px-3 py-1.5 rounded-lg bg-slate-700 text-white text-[10px] font-black uppercase tracking-widest hover:bg-slate-600 transition-colors" data-disp="no_answer">No answer</button>
            <button type="button" class="war-room-disp-btn px-3 py-1.5 rounded-lg bg-amber-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-amber-500 transition-colors" data-disp="gatekeeper">Gatekeeper</button>
            <button type="button" class="war-room-disp-btn px-3 py-1.5 rounded-lg bg-rose-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-rose-500 transition-colors" data-disp="wrong_number">Wrong number</button>
            <button type="button" class="war-room-disp-btn px-3 py-1.5 rounded-lg bg-blue-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-blue-500 transition-colors" data-disp="callback">Callback</button>
            ${gaps.map((g) => `<span class="px-2 py-1 bg-rose-100 dark:bg-rose-950/50 text-rose-800 dark:text-rose-200 text-[9px] font-black uppercase tracking-widest rounded-md border border-rose-200 dark:border-rose-800">${escapeHtmlText(g)}</span>`).join('')}
            ${competitor && competitor !== 'N/A' ? `<span class="px-2 py-1 bg-blue-100 dark:bg-blue-950/40 text-blue-800 dark:text-blue-200 text-[9px] font-black uppercase tracking-widest rounded-md border border-blue-200 dark:border-blue-800">vs ${escapeHtmlText(competitor)}</span>` : ''}
        </div>
    `;

    setTimeout(() => {
      const starContainer = card.querySelector(`.war-room-stars-${row.dataset.leadKey}`);
      if (starContainer) renderStarsInElement(starContainer, parseFloat(rating) || 0);
    }, 0);
    return { card, scriptDefaults };
  }


  // Initial render of stars in the table
  applyTableStars();

  /** Match sticky company column `left` to measured checkbox column width (resize / density). */
  function syncPipelineStickyColumnOffsets() {
    const table = document.getElementById('prospectLeadsTable');
    const host =
      document.getElementById('prospectPipelineTableScroll') ||
      document.querySelector('#tableView .overflow-x-auto');
    if (!table || !host) return;
    const th = table.querySelector('thead th[data-plc="check"]');
    if (!th || th.classList.contains('plc-col-hidden')) {
      host.style.setProperty('--plc-check-sticky-w', '0px');
      return;
    }
    const w = th.getBoundingClientRect().width;
    host.style.setProperty('--plc-check-sticky-w', `${Math.round(w * 1000) / 1000}px`);
  }

  let _stickyOffTimer = null;
  function scheduleSyncPipelineStickyOffsets() {
    if (_stickyOffTimer) clearTimeout(_stickyOffTimer);
    _stickyOffTimer = setTimeout(() => {
      _stickyOffTimer = null;
      syncPipelineStickyColumnOffsets();
    }, 50);
  }

  window.addEventListener('resize', scheduleSyncPipelineStickyOffsets, { passive: true });

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      syncPipelineStickyColumnOffsets();
    });
  });

  (function initLeadTableDensity() {
    const table = document.getElementById('prospectLeadsTable');
    if (!table) return;
    const key = 'prospectLeadTableDensity';
    const saved = localStorage.getItem(key) === 'comfortable' ? 'comfortable' : 'compact';
    function apply(mode) {
      const d = mode === 'compact' ? 'compact' : 'comfortable';
      table.classList.remove('prospect-leads-table--comfortable', 'prospect-leads-table--compact');
      table.classList.add(d === 'compact' ? 'prospect-leads-table--compact' : 'prospect-leads-table--comfortable');
      document.querySelectorAll('.lead-density-btn').forEach((btn) => {
        const on = (btn.dataset.density || 'compact') === d;
        btn.classList.toggle('lead-density-btn--active', on);
      });
      try {
        localStorage.setItem(key, d);
      } catch (_) {
        /* ignore */
      }
      scheduleSyncPipelineStickyOffsets();
    }
    apply(saved);
    document.querySelectorAll('.lead-density-btn').forEach((btn) => {
      btn.addEventListener('click', () => apply(btn.dataset.density || 'compact'));
    });
  })();

  (function initPipelineColumnPrefs() {
    const table = document.getElementById('prospectLeadsTable');
    const boxHost = document.getElementById('pipelineColumnsCheckboxes');
    const colBtn = document.getElementById('pipelineColumnsBtn');
    const pop = document.getElementById('pipelineColumnsPopover');
    const resetW = document.getElementById('pipelineColumnsResetWidths');
    if (!table || !boxHost || !colBtn || !pop) return;

    const PLC_META = [
      { id: 'company', label: 'Company' },
      { id: 'lastTouch', label: 'Last touch' },
      { id: 'cadence', label: 'Cadence' },
      { id: 'category', label: 'Category' },
      { id: 'reviews', label: 'Reviews' },
      { id: 'claimStatus', label: 'Claim status', defaultHidden: true },
      { id: 'optimizationScore', label: 'GBP optimization score', defaultHidden: true },
      { id: 'contact', label: 'Contact (phone, email, domain)' },
      { id: 'socials', label: 'Socials' },
      { id: 'added', label: 'Added' },
      { id: 'pipeline', label: 'Pipeline' },
      { id: 'opportunity', label: 'Opportunity' },
      { id: 'actions', label: 'Actions' },
    ];

    function pipelineColVisible(map, id) {
      const meta = PLC_META.find((x) => x.id === id);
      const defaultOn = !(meta && meta.defaultHidden);
      if (!Object.prototype.hasOwnProperty.call(map, id)) return defaultOn;
      return map[id] !== false;
    }
    const VIS_KEY = 'pipelineTableColVisibility';
    const WIDTH_KEY = 'pipelineTableColWidths';

    function loadVis() {
      try {
        const raw = localStorage.getItem(VIS_KEY);
        return raw ? JSON.parse(raw) : {};
      } catch (_) {
        return {};
      }
    }

    function saveVis(obj) {
      try {
        localStorage.setItem(VIS_KEY, JSON.stringify(obj));
      } catch (_) {
        /* ignore */
      }
    }

    function applyVisibility(map) {
      table.querySelectorAll('[data-plc="check"]').forEach((el) => {
        el.classList.remove('plc-col-hidden');
      });
      PLC_META.forEach(({ id }) => {
        const on = pipelineColVisible(map, id);
        table.querySelectorAll(`[data-plc="${id}"]`).forEach((el) => {
          el.classList.toggle('plc-col-hidden', !on);
        });
      });
    }

    function applyWidths(obj) {
      if (!obj || typeof obj !== 'object') return;
      Object.keys(obj).forEach((id) => {
        const px = Number(obj[id]);
        const ok = Number.isFinite(px) && px >= 48;
        if (!ok) return;
        table.querySelectorAll(`[data-plc="${id}"]`).forEach((el) => {
          el.style.width = `${px}px`;
          el.style.minWidth = `${px}px`;
          el.style.maxWidth = `${px}px`;
        });
      });
    }

    function clearAllWidths() {
      table.querySelectorAll('[data-plc]').forEach((el) => {
        el.style.width = '';
        el.style.minWidth = '';
        el.style.maxWidth = '';
      });
    }

    let vis = loadVis();
    if (vis && vis.check === false) {
      delete vis.check;
      saveVis(vis);
    }
    applyVisibility(vis);
    try {
      applyWidths(JSON.parse(localStorage.getItem(WIDTH_KEY) || '{}'));
    } catch (_) {
      /* ignore */
    }
    scheduleSyncPipelineStickyOffsets();

    PLC_META.forEach(({ id, label }) => {
      const wrap = document.createElement('label');
      wrap.className = 'flex items-center gap-2 cursor-pointer text-brand-dark dark:text-slate-200';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = pipelineColVisible(vis, id);
      cb.className = 'rounded border-brand-border text-brand-yellow focus:ring-brand-yellow';
      cb.addEventListener('change', () => {
        vis[id] = cb.checked;
        saveVis(vis);
        applyVisibility(vis);
        scheduleSyncPipelineStickyOffsets();
      });
      wrap.appendChild(cb);
      const span = document.createElement('span');
      span.textContent = label;
      wrap.appendChild(span);
      boxHost.appendChild(wrap);
    });

    function closePop() {
      pop.classList.add('hidden');
      colBtn.setAttribute('aria-expanded', 'false');
    }

    colBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      pop.classList.toggle('hidden');
      colBtn.setAttribute('aria-expanded', pop.classList.contains('hidden') ? 'false' : 'true');
    });

    document.addEventListener('click', (e) => {
      if (pop.classList.contains('hidden')) return;
      if (e.target.closest('.js-pipeline-columns-wrap')) return;
      closePop();
    });

    if (resetW) {
      resetW.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          localStorage.removeItem(WIDTH_KEY);
        } catch (_) {
          /* ignore */
        }
        clearAllWidths();
        scheduleSyncPipelineStickyOffsets();
      });
    }

    let dragPlc = null;
    let dragStartX = 0;
    let dragStartW = 0;

    document.addEventListener('mousedown', (e) => {
      const h = e.target.closest('.plc-col-resize');
      if (!h || !table.contains(h)) return;
      e.preventDefault();
      const plc = h.getAttribute('data-plc-resize');
      if (!plc) return;
      const th = h.closest('th');
      if (!th) return;
      dragPlc = plc;
      dragStartX = e.clientX;
      dragStartW = th.getBoundingClientRect().width;
      h.classList.add('plc-col-resize--active');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragPlc) return;
      e.preventDefault();
      const dx = e.clientX - dragStartX;
      const next = Math.max(48, dragStartW + dx);
      let o = {};
      try {
        o = JSON.parse(localStorage.getItem(WIDTH_KEY) || '{}');
      } catch (_) {
        o = {};
      }
      o[dragPlc] = next;
      try {
        localStorage.setItem(WIDTH_KEY, JSON.stringify(o));
      } catch (_) {
        /* ignore */
      }
      applyWidths(o);
    });

    document.addEventListener('mouseup', () => {
      if (!dragPlc) return;
      dragPlc = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      table.querySelectorAll('.plc-col-resize--active').forEach((x) => x.classList.remove('plc-col-resize--active'));
      scheduleSyncPipelineStickyOffsets();
    });
  })();

  /** Map API lead JSON onto the hidden panel host (Cadences / pages without a table row). */
  function applyLeadObjectToPanelHost(el, lead) {
    if (!el || !lead) return;
    const ds = el.dataset;
    const str = (v, fb = '') =>
      v != null && v !== undefined && String(v) !== 'undefined' ? String(v) : fb;
    ds.leadKey = str(lead.key);
    ds.title = str(lead.title);
    ds.phone = str(lead.phone, 'N/A');
    ds.email = str(lead.email, 'N/A');
    ds.website = str(lead.website, 'N/A');
    const cat = lead.categoryName;
    ds.category = cat && cat !== 'N/A' ? str(cat) : str(lead.category, 'N/A');
    ds.address = str(lead.address, 'N/A');
    ds.city = str(lead.city);
    ds.url = str(lead.url);
    ds.facebook = str(lead.facebook, 'N/A');
    ds.instagram = str(lead.instagram, 'N/A');
    ds.twitter = str(lead.twitter, 'N/A');
    ds.rating = lead.totalScore != null ? String(lead.totalScore) : '0';
    ds.reviews = lead.reviewsCount != null ? String(lead.reviewsCount) : '0';
    ds.gbpClaimStatus = str(lead.gbpClaimStatus);
    ds.gbpOptimizationScore = str(lead.gbpOptimizationScore);
    ds.status = str(lead.status, 'Not Contacted');
    ds.source = str(lead.source);
    ds.loomUrl = str(lead.loomUrl);
    ds.ownerSignal = str(lead.ownerSignal);
    ds.outreachPrompt = str(lead.outreachPrompt);
    ds.industry = str(lead.industry);
    ds.goal = str(lead.goal);
    ds.vibe = str(lead.vibe);
    ds.pipelineStage = lead.pipelineStage != null ? String(lead.pipelineStage) : '';
    ds.stageId = str(lead.stageId);
    ds.pipelineLabel = str(lead.pipelineLabel);
    ds.auditUrl = str(lead.auditUrl);
    ds.estimatedValue = lead.estimatedValue != null ? String(lead.estimatedValue) : '';
    ds.stitchDesignUrl = str(lead.stitchDesignUrl);
    ds.stitchScreenshotUrl = str(lead.stitchScreenshotUrl);
    ds.stitchScreenId = str(lead.stitchScreenId);
    ds.competitorName = str(lead.competitorName);
    ds.competitorGap = str(lead.competitorGap);
    ds.competitorMetaBenchmark = str(lead.competitorMetaBenchmark);
    ds.cmsPlatform = str(lead.cmsPlatform);
    ds.geoGaps = str(lead.geoGaps);
    ds.auditSummary = str(lead.auditSummary);
    ds.hasSchemaMarkup = lead.hasSchemaMarkup != null ? String(lead.hasSchemaMarkup) : '';
    ds.hasChatbot = lead.hasChatbot != null ? String(lead.hasChatbot) : '';
    ds.hasClickToCall = lead.hasClickToCall != null ? String(lead.hasClickToCall) : '';
    ds.isMobileFriendly = lead.isMobileFriendly != null ? String(lead.isMobileFriendly) : '';
    ds.isOutdated = lead.isOutdated != null ? String(lead.isOutdated) : '';
    ds.visualModernityScore = lead.visualModernityScore != null ? String(lead.visualModernityScore) : '';
    ds.aeoScore = lead.aeoScore != null ? String(lead.aeoScore) : '';
    try {
      ds.reviewSnippets = JSON.stringify(lead.reviewSnippets || []);
    } catch (_) {
      ds.reviewSnippets = '[]';
    }
    try {
      ds.sequenceState = JSON.stringify(lead.sequenceState || null);
    } catch (_) {
      ds.sequenceState = 'null';
    }
    try {
      ds.logsSnippet = JSON.stringify((lead.logs || []).slice(-14));
    } catch (_) {
      ds.logsSnippet = '[]';
    }
    try {
      ds.updates = JSON.stringify(lead.updates || []);
    } catch (_) {
      ds.updates = '[]';
    }
    try {
      ds.auditData = JSON.stringify(lead.auditData || null);
    } catch (_) {
      ds.auditData = 'null';
    }
    try {
      ds.chatHistory = JSON.stringify(lead.chatHistory || null);
    } catch (_) {
      ds.chatHistory = 'null';
    }
    try {
      ds.cqi = JSON.stringify(lead.cqi || null);
    } catch (_) {
      ds.cqi = 'null';
    }
    ds.ownerFirstName = str(lead.ownerFirstName);
    ds.doNotCall = lead.doNotCall ? '1' : '';
    try {
      ds.contacts = JSON.stringify(lead.contacts || []);
    } catch (_) {
      ds.contacts = '[]';
    }
    try {
      ds.aiAnalysis = JSON.stringify(lead.aiWebsiteAnalysis || null);
    } catch (_) {
      ds.aiAnalysis = 'null';
    }
    try {
      ds.buyingSignals = JSON.stringify(lead.buyingSignals || []);
    } catch (_) {
      ds.buyingSignals = '[]';
    }
    ds.aiScore = lead.aiWebsiteAnalysisScore != null ? String(lead.aiWebsiteAnalysisScore) : '';
    const ltc = String(lead.lastTouchChannel || '').trim();
    ds.lastTouchChannel = ltc;
    ds.cadenceSort =
      ltc || (lead.sequenceState && lead.sequenceState.templateId ? String(lead.sequenceState.templateId) : '');
    const rawTouch = lead.updatedAt || lead.lastTouchAt || lead.lastContactAt || lead.createdAt || lead.savedAt;
    let ms = 0;
    if (rawTouch) {
      const d = new Date(rawTouch);
      if (!Number.isNaN(d.getTime())) ms = d.getTime();
    }
    ds.lastTouchMs = String(ms);
    const cr = lead.createdAt || lead.savedAt;
    let csm = 0;
    if (cr) {
      const d = new Date(cr);
      if (!Number.isNaN(d.getTime())) csm = d.getTime();
    }
    ds.createdSort = String(csm);
    ds.createdAt = str(cr);
  }

  window.openLeadDetailFromKey = async (rawKey) => {
    const k = String(rawKey || '').replace(/^lead:/, '').trim();
    if (!k) return;
    const host = document.getElementById('leadPanelDatasetHost');
    if (!host) return;
    try {
      const res = await fetch(`/leads/${encodeURIComponent(k)}/panel-data`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (!data.success || !data.lead) return;
      applyLeadObjectToPanelHost(host, data.lead);
      selectRow(host);
    } catch (err) {
      console.error(err);
    }
  };
});
