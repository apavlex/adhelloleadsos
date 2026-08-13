const form = document.getElementById('leadForm');
const importForm = document.getElementById('importForm');
const bulkForm = document.getElementById('bulkForm');
const statusEl = document.getElementById('status');
const importStatusEl = document.getElementById('importStatus');
const bulkStatusEl = document.getElementById('bulkStatus');
const bulkProgressEl = document.getElementById('bulkProgress');
const bulkMapsHintEl = document.getElementById('bulkMapsHint');
const platformLabel = document.getElementById('platformLabel');
const saveTypeLabel = document.getElementById('saveTypeLabel');
const setupNotice = document.getElementById('setupNotice');
const saveBtn = document.getElementById('saveBtn');
const saveBtnTop = document.getElementById('saveBtnTop');
const openOptions = document.getElementById('openOptions');
const panelSave = document.getElementById('panelSave');
const panelImport = document.getElementById('panelImport');
const panelBulk = document.getElementById('panelBulk');
const workspaceSelect = document.getElementById('workspaceSelect');
const workspaceThemeRow = document.getElementById('workspaceThemeRow');
const EXT_VERSION = '1.8.0';
const PARALLEL_LABEL = '5 at a time';

let bulkRunning = false;
let bulkStopRequested = false;
let reEnrichRunning = false;
let websiteEnrichRunning = false;
let cachedSettings = null;

document.getElementById('extVersion').textContent = `v${EXT_VERSION}`;

openOptions.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

document.querySelectorAll('.popup-tab').forEach((tabBtn) => {
  tabBtn.addEventListener('click', () => {
    const tab = tabBtn.getAttribute('data-tab');
    document.querySelectorAll('.popup-tab').forEach((b) => {
      b.classList.toggle('popup-tab--active', b === tabBtn);
    });
    panelSave.classList.toggle('hidden', tab !== 'save');
    panelBulk.classList.toggle('hidden', tab !== 'bulk');
    panelImport.classList.toggle('hidden', tab !== 'import');
    if (tab === 'bulk') {
      refreshBulkMapsHint();
      refreshWebsiteQueueHint();
    }
  });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.action !== 'bulkScrapeProgress') return;
  if (message?.phase === 'import' && message.message && bulkProgressEl) {
    bulkProgressEl.textContent = message.message;
    bulkProgressEl.classList.add('bulk-progress--active');
    return;
  }
  if (message?.phase === 'import-done' && bulkProgressEl) {
    bulkProgressEl.textContent = `Saved ${message.businessCount || 0} leads to “${message.folderName || 'folder'}”. Fetching websites…`;
    bulkProgressEl.classList.add('bulk-progress--active');
    return;
  }
  if (message?.phase === 'extract' && bulkProgressEl) {
    bulkProgressEl.textContent = 'Extracting business data from results list…';
    bulkProgressEl.classList.add('bulk-progress--active');
    return;
  }
  if (message?.phase === 're-enrich-start' && bulkProgressEl) {
    bulkProgressEl.textContent = `Leads saved — fetching websites (${PARALLEL_LABEL})…`;
    bulkProgressEl.classList.add('bulk-progress--active');
    return;
  }
  if (!bulkProgressEl) return;
  if (message?.phase === 'enrich-parallel') {
    bulkProgressEl.textContent = `Fetching websites (${PARALLEL_LABEL})… ${message.current || 0}/${message.total || 0}`;
  } else if (message?.phase === 're-enrich-parallel') {
    bulkProgressEl.textContent = `Re-enriching (${PARALLEL_LABEL})… ${message.current || 0}/${message.total || 0}`;
  } else if (message?.phase === 'website-enrich-parallel') {
    bulkProgressEl.textContent = `Scraping websites (${PARALLEL_LABEL})… ${message.current || 0}/${message.total || 0}`;
  } else if (message.phase === 'enrich') {
    bulkProgressEl.textContent = `Fetching websites… ${message.current || 0}/${message.total || 0}`;
  } else {
    bulkProgressEl.textContent = `Scrolling… ${message.businessCount || 0} businesses loaded (${message.scrollAttempts || 0} scrolls)`;
  }
  bulkProgressEl.classList.add('bulk-progress--active');
});

function setStatus(msg, type = '') {
  statusEl.textContent = msg;
  statusEl.className = `status${type ? ` status--${type}` : ''}`;
}

function setBulkStatus(msg, type = '') {
  if (!bulkStatusEl) return;
  bulkStatusEl.textContent = msg;
  bulkStatusEl.className = `status${type ? ` status--${type}` : ''}`;
}

function isGoogleMapsUrl(url) {
  const u = String(url || '').toLowerCase();
  return u.includes('google.com/maps') || u.includes('maps.google.com');
}

function isGoogleMapsSearchUrl(url) {
  const u = String(url || '').toLowerCase();
  return u.includes('/maps/search') || (u.includes('google.com/maps') && u.includes('search?'));
}

function parsePriceInput(raw) {
  const n = parseInt(String(raw || '').replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function formatReviewsField(lead) {
  if (!lead) return '';
  let rating = parseFloat(lead.totalScore || lead.rating || 0);
  let count = parseInt(lead.reviewsCount || lead.reviews || 0, 10) || 0;
  if (!count && lead.note) {
    const fromNote = String(lead.note).match(/(\d[\d,]*)\s*reviews?\b/i);
    if (fromNote) count = parseInt(fromNote[1].replace(/,/g, ''), 10) || 0;
  }
  const parts = [];
  if (Number.isFinite(rating) && rating > 0) parts.push(`${rating}★`);
  if (count > 0) parts.push(`${count.toLocaleString()} review${count === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

function parseReviewsField(raw) {
  const s = String(raw || '').trim();
  if (!s) return { totalScore: 0, reviewsCount: 0 };
  const ratingMatch = s.match(/([\d.]+)\s*★/);
  const countMatch = s.match(/([\d,]+)\s*reviews?\b/i);
  const totalScore = ratingMatch ? parseFloat(ratingMatch[1]) : parseFloat(s) || 0;
  const reviewsCount = countMatch ? parseInt(countMatch[1].replace(/,/g, ''), 10) : 0;
  return {
    totalScore: Number.isFinite(totalScore) ? totalScore : 0,
    reviewsCount: Number.isFinite(reviewsCount) ? reviewsCount : 0,
  };
}

function enrichPayloadGeo(payload) {
  if (window.AdHelloListingHelpers?.enrichLeadGeo) {
    return window.AdHelloListingHelpers.enrichLeadGeo({ ...payload });
  }
  if (window.AdHelloAddressUtils?.parseCityState) {
    const raw = payload.address && payload.address !== 'N/A' ? payload.address : payload.title || '';
    const parsed = window.AdHelloAddressUtils.parseCityState(raw);
    if (!payload.city && parsed.city) payload.city = parsed.city;
    if (!payload.state && parsed.state) payload.state = parsed.state;
    if ((!payload.address || payload.address === 'N/A') && parsed.street) payload.address = parsed.street;
    const zipMatch = String(raw).match(/\b(\d{5})(?:-\d{4})?\b/);
    if (zipMatch && !payload.zip && !payload.postalCode) {
      payload.zip = zipMatch[1];
      payload.postalCode = zipMatch[1];
    }
  }
  return payload;
}

function buildListingPayload(base, formEl) {
  if (!base?.listing && !base?.jobType && !base?.listingType) return {};
  const price = parsePriceInput(formEl.price.value);
  const beds = formEl.beds.value !== '' ? parseFloat(formEl.beds.value) : null;
  const baths = formEl.baths.value !== '' ? parseFloat(formEl.baths.value) : null;
  const sqft = formEl.sqft.value !== '' ? parseInt(formEl.sqft.value, 10) : null;
  const listing = {
    ...(base.listing || {}),
    source: base.listing?.source || base.sourceChannel || 'chrome_extension',
    price: price ?? base.listing?.price ?? null,
    beds: beds ?? base.listing?.beds ?? null,
    baths: baths ?? base.listing?.baths ?? null,
    sqft: sqft ?? base.listing?.sqft ?? null,
  };
  return {
    jobType: base.jobType || base.listingType || 'real_estate',
    sourceType: base.sourceType,
    listing,
  };
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab');
  return tab;
}

function detectActiveSiteLabel(url) {
  const u = String(url || '').toLowerCase();
  if (isGoogleMapsUrl(url)) return 'Google Maps';
  if (u.includes('yelp.com')) return 'Yelp';
  if (u.includes('yellowpages.com')) return 'Yellow Pages';
  if (u.includes('bbb.org')) return 'BBB';
  if (u.includes('tripadvisor.com')) return 'TripAdvisor';
  if (u.includes('angi.com')) return 'Angi';
  if (u.includes('homeadvisor.com')) return 'HomeAdvisor';
  if (u.includes('thumbtack.com')) return 'Thumbtack';
  if (u.includes('linkedin.com')) return 'LinkedIn';
  if (u.includes('facebook.com')) return 'Facebook';
  if (u.includes('instagram.com')) return 'Instagram';
  if (u.includes('zillow.com')) return 'Zillow';
  if (/^https?:\/\//i.test(u) && !u.includes('google.com') && !u.includes('chrome://')) {
    return 'Business website';
  }
  return '';
}

async function refreshBulkMapsHint() {
  if (!bulkMapsHintEl) return;
  try {
    const tab = await getActiveTab();
    const site = detectActiveSiteLabel(tab.url);
    if (isGoogleMapsUrl(tab.url)) {
      bulkMapsHintEl.textContent = 'Connected to Google Maps — ready to bulk scrape this results list.';
      bulkMapsHintEl.className = 'bulk-maps-hint bulk-maps-hint--ready';
    } else if (site) {
      bulkMapsHintEl.textContent = `${site} — bulk scrape is Google Maps only. Use Save lead here, or Import CSV for a ${site} export.`;
      bulkMapsHintEl.className = 'bulk-maps-hint bulk-maps-hint--warn';
    } else {
      bulkMapsHintEl.textContent =
        'Open Google Maps search results first (e.g. “flooring near Vancouver WA”). Other sites: Save lead or Import CSV.';
      bulkMapsHintEl.className = 'bulk-maps-hint bulk-maps-hint--warn';
    }
  } catch (_) {
    bulkMapsHintEl.textContent = 'Could not detect the active tab.';
    bulkMapsHintEl.className = 'bulk-maps-hint bulk-maps-hint--warn';
  }
}

function setBulkButtonsRunning(running, asStop = false) {
  const buttons = [document.getElementById('bulkRunBtnTop')].filter(Boolean);
  buttons.forEach((btn) => {
    btn.disabled = false;
    btn.classList.toggle('btn-stop', running && asStop);
    if (running && asStop) {
      btn.textContent = 'Stop scrolling';
    } else if (running) {
      btn.textContent = 'Working…';
      btn.disabled = true;
    } else {
      btn.textContent = 'Scrape & import to AdHello';
      btn.classList.remove('btn-stop');
    }
  });
}

async function getActiveTabLead() {
  const tab = await getActiveTab();

  const scripts = [
    'src/address-utils.js',
    'src/website-utils.js',
    'src/website-scrape.js',
    'src/listing-helpers.js',
    'src/listing-extractors.js',
    'src/extractors.js',
  ];
  for (const file of scripts) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [file] });
    } catch (_) {
      /* content script may already be present */
    }
  }

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      if (!window.AdHelloExtractors) return null;
      return window.AdHelloExtractors.extractLeadFromPage();
    },
  });

  return { tab, lead: result };
}

function cleanAddress(raw) {
  if (window.AdHelloAddressUtils && typeof window.AdHelloAddressUtils.cleanAddress === 'function') {
    return window.AdHelloAddressUtils.cleanAddress(raw);
  }
  return String(raw || '')
    .replace(/[\uE000-\uF8FF\u200B-\u200D\uFEFF]/g, '')
    .replace(/^[^\dA-Za-z#]+/, '')
    .trim();
}

function formatSourceChannelLabel(sourceChannel) {
  const key = String(sourceChannel || '').trim().toLowerCase();
  if (!key) return '';
  const labels = {
    yelp: 'Yelp',
    google_maps: 'Google Maps',
    chrome_extension_maps_bulk: 'Google Maps',
    yellowpages: 'Yellow Pages',
    bbb: 'BBB',
    tripadvisor: 'TripAdvisor',
    angi: 'Angi',
    homeadvisor: 'HomeAdvisor',
    thumbtack: 'Thumbtack',
    linkedin_company: 'LinkedIn Company',
    linkedin_profile: 'LinkedIn Profile',
    facebook: 'Facebook',
    instagram: 'Instagram',
    groupon: 'Groupon',
    craigslist: 'Craigslist',
    nextdoor: 'Nextdoor',
    houzz: 'Houzz',
    business_website: 'Business Website',
    web: 'Business Website',
  };
  if (labels[key]) return labels[key];
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function fillForm(lead, defaultFolderName) {
  if (!lead) return;
  form.title.value = lead.title || '';
  const sourceKey = String(lead.sourceChannel || '').trim();
  if (form.sourceChannel) form.sourceChannel.value = sourceKey;
  if (form.sourceChannelDisplay) {
    form.sourceChannelDisplay.value = formatSourceChannelLabel(sourceKey) || '';
  }
  form.price.value =
    lead.listingPrice != null
      ? `$${Number(lead.listingPrice).toLocaleString()}`
      : lead.listing?.price != null
        ? `$${Number(lead.listing.price).toLocaleString()}`
        : '';
  form.beds.value = lead.listingBeds ?? lead.listing?.beds ?? '';
  form.baths.value = lead.listingBaths ?? lead.listing?.baths ?? '';
  form.sqft.value = lead.listingSqft ?? lead.listing?.sqft ?? '';
  form.note.value = lead.note || '';
  if (defaultFolderName) form.folderName.value = defaultFolderName;
  form.address.value =
    lead.address && lead.address !== 'N/A' ? cleanAddress(lead.address) : '';
  form.city.value = lead.city || '';
  form.state.value = lead.state || '';
  if (form.zip) form.zip.value = lead.zip || lead.postalCode || '';
  form.website.value = lead.website && lead.website !== 'N/A' ? lead.website : '';
  form.email.value = lead.email && lead.email !== 'N/A' ? lead.email : '';
  form.phone.value = lead.phone && lead.phone !== 'N/A' ? lead.phone : '';
  if (form.facebook) form.facebook.value = lead.facebook && lead.facebook !== 'N/A' ? lead.facebook : '';
  if (form.instagram) form.instagram.value = lead.instagram && lead.instagram !== 'N/A' ? lead.instagram : '';
  if (form.twitter) form.twitter.value = lead.twitter && lead.twitter !== 'N/A' ? lead.twitter : '';
  if (form.linkedin) form.linkedin.value = lead.linkedin && lead.linkedin !== 'N/A' ? lead.linkedin : '';
  if (form.tiktok) form.tiktok.value = lead.tiktok && lead.tiktok !== 'N/A' ? lead.tiktok : '';
  const socialDetails = document.getElementById('socialDetails');
  if (socialDetails) {
    const hasSocial = [lead.facebook, lead.instagram, lead.twitter, lead.linkedin, lead.tiktok].some(
      (v) => v && v !== 'N/A',
    );
    socialDetails.open = hasSocial;
  }
  form.reviews.value = formatReviewsField(lead);

  const listingLabel =
    lead.listingType === 'products' || lead.jobType === 'products'
      ? 'Product listing'
      : lead.listingType === 'real_estate' || lead.jobType === 'real_estate'
        ? 'Real estate listing'
        : '';
  if (listingLabel) {
    saveTypeLabel.textContent = listingLabel;
    saveTypeLabel.classList.remove('hidden');
  } else {
    saveTypeLabel.textContent = '';
    saveTypeLabel.classList.add('hidden');
  }
}

function getSelectedWorkspaceId() {
  return workspaceSelect?.value || cachedSettings?.workspaceId || 'default';
}

async function persistWorkspaceSelection(workspaceId) {
  const wid = String(workspaceId || '').trim();
  if (!wid) return;
  await chrome.storage.sync.set({ workspaceId: wid });
  if (cachedSettings) cachedSettings.workspaceId = wid;
}

async function loadWorkspacePicker(settings) {
  if (!workspaceSelect || !window.AdHelloTheme) return settings;
  cachedSettings = { ...settings };

  try {
    const data = await window.AdHelloTheme.fetchWorkspaces(settings);
    const activeId = data.activeWorkspaceId || settings.workspaceId || 'default';
    window.AdHelloTheme.renderWorkspaceSelect(workspaceSelect, data.workspaces, activeId);
    workspaceThemeRow?.classList.remove('hidden');

    const active =
      data.workspaces.find((w) => w.id === activeId) ||
      data.workspaces[0] ||
      null;
    if (active) {
      window.AdHelloTheme.applyWorkspaceTheme(active);
    } else {
      await window.AdHelloTheme.fetchAndApplyTheme({ ...settings, workspaceId: activeId });
    }

    if (data.requiresEmail && data.workspaces.length <= 1) {
      setupNotice.classList.remove('hidden');
      setupNotice.innerHTML =
        'Add your <strong>AdHello login email</strong> in <a href="#" id="openOptionsEmail">Settings</a> to switch workspaces (e.g. Flooring).';
      document.getElementById('openOptionsEmail')?.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.runtime.openOptionsPage();
      });
    }

    if (activeId !== settings.workspaceId) {
      await persistWorkspaceSelection(activeId);
    }
    return { ...settings, workspaceId: activeId };
  } catch (_) {
    window.AdHelloTheme.renderWorkspaceSelect(
      workspaceSelect,
      [{ id: settings.workspaceId, name: settings.workspaceId }],
      settings.workspaceId,
    );
    workspaceThemeRow?.classList.remove('hidden');
    await window.AdHelloTheme.fetchAndApplyTheme(settings);
    return settings;
  }
}

workspaceSelect?.addEventListener('change', async () => {
  const wid = getSelectedWorkspaceId();
  await persistWorkspaceSelection(wid);
  const nextSettings = { ...(cachedSettings || {}), workspaceId: wid };
  cachedSettings = nextSettings;
  const ws = await window.AdHelloTheme.fetchAndApplyTheme(nextSettings);
  const swatch = document.getElementById('workspaceThemeSwatch');
  if (swatch && ws?.accentColor) swatch.style.backgroundColor = ws.accentColor;
});

async function init() {
  const settingsRes = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  let settings = settingsRes?.settings || {};
  const hasKey = !!settings.apiKey;
  const defaultFolderName = settings.defaultFolderName || '';
  setupNotice.classList.toggle('hidden', hasKey);
  if (defaultFolderName) {
    form.folderName.value = defaultFolderName;
    if (importForm) importForm.importFolderName.value = defaultFolderName;
    if (bulkForm) bulkForm.bulkFolderName.value = defaultFolderName;
  }

  if (window.AdHelloTheme && hasKey) {
    settings = await loadWorkspacePicker(settings);
  } else if (window.AdHelloTheme && settings) {
    await window.AdHelloTheme.fetchAndApplyTheme(settings);
  }

  refreshBulkMapsHint();
  refreshWebsiteQueueHint();

  try {
    const { tab, lead } = await getActiveTabLead();
    const onMapsSearch =
      isGoogleMapsUrl(tab.url) &&
      (isGoogleMapsSearchUrl(tab.url) ||
        !lead?.title ||
        /^(results?|search)$/i.test(String(lead.title || '').trim()) ||
        /find local businesses/i.test(String(lead?.address || '')));

    if (onMapsSearch) {
      platformLabel.textContent = 'Maps search results — use Bulk scrape to import the full list.';
      document.querySelector('.popup-tab[data-tab="bulk"]')?.click();
      return;
    }

    const platform = lead?.sourceChannel || 'current page';
    platformLabel.textContent = lead
      ? `From ${formatSourceChannelLabel(platform) || platform.replace(/_/g, ' ')} · ${new URL(tab.url).hostname}`
      : 'Open a supported listing, profile, or business page to auto-fill.';
    fillForm(lead, defaultFolderName);
  } catch (err) {
    platformLabel.textContent = 'Could not read this page. Use the on-page Save lead button.';
    setStatus(err.message, 'error');
    if (defaultFolderName) form.folderName.value = defaultFolderName;
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  setStatus('');

  const title = form.title.value.trim();
  if (!title) {
    setStatus('Title is required.', 'error');
    return;
  }

  const saveButtons = [saveBtn, saveBtnTop].filter(Boolean);
  saveButtons.forEach((btn) => {
    btn.disabled = true;
    btn.textContent = 'Saving…';
  });

  let saveSucceeded = false;

  try {
    const { lead: base } = await getActiveTabLead();
    const reviews = parseReviewsField(form.reviews.value);
    const payload = enrichPayloadGeo({
      ...(base || {}),
      ...buildListingPayload(base, form),
      title,
      note: form.note.value.trim(),
      address: form.address.value.trim() || 'N/A',
      city: form.city.value.trim(),
      state: form.state.value.trim(),
      zip: form.zip?.value?.trim() || base?.zip || base?.postalCode || '',
      postalCode: form.zip?.value?.trim() || base?.postalCode || base?.zip || '',
      website: form.website.value.trim() || 'N/A',
      email: form.email.value.trim() || 'N/A',
      phone: form.phone.value.trim() || 'N/A',
      facebook: form.facebook?.value?.trim() || base?.facebook || 'N/A',
      instagram: form.instagram?.value?.trim() || base?.instagram || 'N/A',
      twitter: form.twitter?.value?.trim() || base?.twitter || 'N/A',
      linkedin: form.linkedin?.value?.trim() || base?.linkedin || 'N/A',
      tiktok: form.tiktok?.value?.trim() || base?.tiktok || 'N/A',
      totalScore: reviews.totalScore || base?.totalScore || 0,
      reviewsCount: reviews.reviewsCount || base?.reviewsCount || 0,
      url: base?.url || '',
      categoryName: base?.categoryName || undefined,
      reviewSnippets: base?.reviewSnippets || undefined,
      sponsored: typeof base?.sponsored === 'boolean' ? base.sponsored : undefined,
      source: 'chrome_extension',
      sourceChannel: String(form.sourceChannel?.value || base?.sourceChannel || '').trim(),
    });
    const folderName = form.folderName.value.trim();
    if (folderName) payload.folderName = folderName;

    const res = await chrome.runtime.sendMessage({
      type: 'SAVE_LEAD',
      lead: payload,
      workspaceId: getSelectedWorkspaceId(),
    });
    if (!res?.ok) throw new Error(res?.error || 'Save failed');
    const folderNote =
      res.data?.folderName && res.data?.folderUrl
        ? ` · Open ${res.data.folderName} folder in AdHello`
        : res.data?.folderName
          ? ` · ${res.data.folderName} folder`
          : '';
    const mergeNote =
      res.data?.merged && res.data?.folderApplied === false
        ? ' · Updated existing lead (kept in current folder)'
        : res.data?.merged
          ? ' · Updated existing lead'
          : '';
    setStatus(`Saved (${res.data?.key || 'ok'})${mergeNote}${folderNote}`, 'success');
    saveSucceeded = true;
    saveButtons.forEach((btn) => {
      btn.textContent = 'Saved';
    });
    setTimeout(() => {
      saveButtons.forEach((btn) => {
        btn.textContent = 'Save';
      });
    }, 2500);
  } catch (err) {
    setStatus(err.message || 'Save failed', 'error');
  } finally {
    saveButtons.forEach((btn) => {
      btn.disabled = false;
      if (!saveSucceeded) btn.textContent = 'Save';
    });
  }
});

async function runBulkScrapeSubmit(e) {
  e.preventDefault();
  if (reEnrichRunning || websiteEnrichRunning) return;
  if (bulkRunning) {
    bulkStopRequested = true;
    try {
      const tab = await getActiveTab();
      await chrome.runtime.sendMessage({ type: 'BULK_SCRAPE_STOP', tabId: tab.id });
    } catch (_) {
      /* ignore */
    }
    if (bulkProgressEl) bulkProgressEl.textContent = 'Stopping scroll…';
    return;
  }

  setBulkStatus('');
  if (bulkProgressEl) {
    bulkProgressEl.textContent = '';
    bulkProgressEl.classList.remove('bulk-progress--active');
  }

  const folderName = bulkForm.bulkFolderName.value.trim();
  const scrollAll = !!bulkForm.bulkScrollAll?.checked;
  const enrichDetails = !!bulkForm.bulkEnrichDetails?.checked;
  if (!folderName) {
    setBulkStatus('Folder name is required.', 'error');
    return;
  }

  bulkRunning = true;
  bulkStopRequested = false;
  setBulkButtonsRunning(true, scrollAll);

  try {
    const tab = await getActiveTab();
    if (!isGoogleMapsUrl(tab.url)) {
      throw new Error('Open a Google Maps search results page first.');
    }

    const res = await chrome.runtime.sendMessage({
      type: 'RUN_BULK_SCRAPE',
      tabId: tab.id,
      folderName,
      scrollAll,
      enrichDetails,
      workspaceId: getSelectedWorkspaceId(),
    });
    if (!res?.ok) throw new Error(res?.error || 'Bulk scrape failed');

    const data = res.data || {};
    const parts = [`${data.created || 0} new`];
    if (data.updated) parts.push(`${data.updated} updated`);
    if (data.failed) parts.push(`${data.failed} failed`);
    const enrichNote =
      enrichDetails && data.enrichData?.updated
        ? ` · ${data.enrichData.updated} websites backfilled`
        : enrichDetails && data.enrichData?.empty
          ? ' · websites already complete'
          : '';
    const folderLabel = data.folderName || folderName;
    setBulkStatus(
      `Imported ${data.companiesCount || 0} businesses (${parts.join(', ')}) into “${folderLabel}”.${enrichNote} Check Pipeline → Folders.`,
      'success',
    );
    if (bulkProgressEl) bulkProgressEl.textContent = '';
  } catch (err) {
    setBulkStatus(err.message || 'Bulk scrape failed', 'error');
  } finally {
    bulkRunning = false;
    bulkStopRequested = false;
    setBulkButtonsRunning(false);
  }
}

bulkForm?.addEventListener('submit', runBulkScrapeSubmit);

async function runReEnrichFolder() {
  if (bulkRunning || reEnrichRunning || websiteEnrichRunning) return;

  const folderName = bulkForm.bulkFolderName.value.trim();
  if (!folderName) {
    setBulkStatus('Folder name is required.', 'error');
    return;
  }

  reEnrichRunning = true;
  setBulkStatus('');
  const reEnrichBtn = document.getElementById('bulkReEnrichBtn');
  if (reEnrichBtn) {
    reEnrichBtn.disabled = true;
    reEnrichBtn.textContent = 'Re-enriching…';
  }

  try {
    if (bulkProgressEl) {
      bulkProgressEl.textContent = `Loading folder queue…`;
      bulkProgressEl.classList.add('bulk-progress--active');
    }

    const res = await chrome.runtime.sendMessage({
      type: 'PARALLEL_REENRICH_FOLDER',
      folderName,
      limit: 150,
      workspaceId: getSelectedWorkspaceId(),
    });
    if (!res?.ok) throw new Error(res?.error || 'Re-enrich failed');

    const data = res.data || {};
    if (data.empty) {
      setBulkStatus(`No leads in “${folderName}” need website or city/state backfill.`, 'success');
      if (bulkProgressEl) bulkProgressEl.textContent = '';
      return;
    }
    const updated = data.updated || 0;
    const attempted = data.attempted || 0;
    const remaining = Math.max(0, (data.totalNeeding || attempted) - updated);
    setBulkStatus(
      `Re-enriched ${updated} of ${attempted} leads in “${data.folderName || folderName}” (${PARALLEL_LABEL}).${remaining ? ` Run again for any that timed out.` : ''}`,
      'success',
    );
    if (bulkProgressEl) bulkProgressEl.textContent = '';
  } catch (err) {
    setBulkStatus(err.message || 'Re-enrich failed', 'error');
  } finally {
    reEnrichRunning = false;
    if (reEnrichBtn) {
      reEnrichBtn.disabled = false;
      reEnrichBtn.textContent = 'Re-enrich folder (websites & domains)';
    }
  }
}

document.getElementById('bulkReEnrichBtn')?.addEventListener('click', runReEnrichFolder);

async function runWebsiteEnrichQueue() {
  if (bulkRunning || reEnrichRunning || websiteEnrichRunning) return;

  websiteEnrichRunning = true;
  setBulkStatus('');
  const btn = document.getElementById('bulkWebsiteEnrichBtn');
  const prevLabel = btn ? btn.textContent : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Scraping websites…';
  }

  try {
    if (bulkProgressEl) {
      bulkProgressEl.textContent = 'Loading pipeline website queue…';
      bulkProgressEl.classList.add('bulk-progress--active');
    }

    const res = await chrome.runtime.sendMessage({
      type: 'PARALLEL_WEBSITE_ENRICH_QUEUE',
      limit: 150,
      workspaceId: getSelectedWorkspaceId(),
    });
    if (!res?.ok) throw new Error(res?.error || 'Website enrich failed');

    const data = res.data || {};
    if (data.empty) {
      setBulkStatus(
        'No pipeline website queue. In AdHello, select leads with websites → Scrape websites, then try again.',
        'success',
      );
      if (bulkProgressEl) bulkProgressEl.textContent = '';
      return;
    }
    const updated = data.updated || 0;
    const attempted = data.attempted || 0;
    setBulkStatus(
      `Website enrich: updated ${updated} of ${attempted} leads (${PARALLEL_LABEL}). Refresh Pipeline if columns look stale.`,
      'success',
    );
    if (bulkProgressEl) bulkProgressEl.textContent = '';
  } catch (err) {
    setBulkStatus(err.message || 'Website enrich failed', 'error');
  } finally {
    websiteEnrichRunning = false;
    if (btn) {
      btn.disabled = false;
      btn.textContent = prevLabel || 'Process website queue (pipeline)';
    }
  }
}

document.getElementById('bulkWebsiteEnrichBtn')?.addEventListener('click', runWebsiteEnrichQueue);

async function refreshWebsiteQueueHint() {
  const btn = document.getElementById('bulkWebsiteEnrichBtn');
  if (!btn) return;
  try {
    const res = await chrome.runtime.sendMessage({
      type: 'GET_WEBSITE_ENRICH_QUEUE',
      limit: 150,
      workspaceId: getSelectedWorkspaceId(),
    });
    const count = res?.ok ? Number(res.data?.count || 0) : 0;
    if (count > 0) {
      btn.textContent = `Process website queue (${count})`;
      btn.classList.add('btn-accent');
    } else {
      btn.textContent = 'Process website queue (pipeline)';
      btn.classList.remove('btn-accent');
    }
  } catch (_) {
    /* ignore */
  }
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.readAsText(file);
  });
}

importForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  importStatusEl.textContent = '';
  importStatusEl.className = 'status';

  const folderName = importForm.importFolderName.value.trim();
  const file = importForm.importFile.files && importForm.importFile.files[0];
  if (!folderName) {
    importStatusEl.textContent = 'Folder name is required.';
    importStatusEl.className = 'status status--error';
    return;
  }
  if (!file) {
    importStatusEl.textContent = 'Choose a CSV file.';
    importStatusEl.className = 'status status--error';
    return;
  }

  const importBtn = document.getElementById('importBtn');
  const importBtnTop = document.getElementById('importBtnTop');
  const importButtons = [importBtn, importBtnTop].filter(Boolean);
  importButtons.forEach((btn) => {
    btn.disabled = true;
    btn.textContent = 'Importing…';
  });

  try {
    const csvContent = await readFileAsText(file);
    const res = await chrome.runtime.sendMessage({
      type: 'IMPORT_CSV',
      csvContent,
      fileName: file.name || 'import.csv',
      folderName,
      workspaceId: getSelectedWorkspaceId(),
    });
    if (!res?.ok) throw new Error(res?.error || 'Import failed');
    const data = res.data || {};
    importStatusEl.textContent = `Imported ${data.created || 0} lead(s) into “${data.folderName || folderName}”.`;
    importStatusEl.className = 'status status--success';
    importForm.importFile.value = '';
  } catch (err) {
    importStatusEl.textContent = err.message || 'Import failed';
    importStatusEl.className = 'status status--error';
  } finally {
    importButtons.forEach((btn) => {
      btn.disabled = false;
      btn.textContent = 'Import list to AdHello';
    });
  }
});

init();
