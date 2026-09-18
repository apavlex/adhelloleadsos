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
const panelLibrary = document.getElementById('panelLibrary');
const workspaceSelect = document.getElementById('workspaceSelect');
const workspaceThemeRow = document.getElementById('workspaceThemeRow');
const showSaveLeadFabEl = document.getElementById('showSaveLeadFab');
const findLoyaltyBtn = document.getElementById('findLoyaltyBtn');
const loyaltyStatusEl = document.getElementById('loyaltyStatus');
const EXT_VERSION = '1.9.6';
const PARALLEL_LABEL = '5 at a time';

let bulkRunning = false;
let bulkStopRequested = false;
let reEnrichRunning = false;
let websiteEnrichRunning = false;
let cachedSettings = null;
let lastLoyaltyResult = null;

document.getElementById('extVersion').textContent = `v${EXT_VERSION}`;

openOptions.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

showSaveLeadFabEl?.addEventListener('change', async () => {
  await chrome.storage.sync.set({ showSaveLeadFab: !!showSaveLeadFabEl.checked });
});

document.querySelectorAll('.popup-tab').forEach((tabBtn) => {
  tabBtn.addEventListener('click', () => {
    const tab = tabBtn.getAttribute('data-tab');
    document.querySelectorAll('.popup-tab').forEach((b) => {
      b.classList.toggle('popup-tab--active', b === tabBtn);
    });
    panelSave.classList.toggle('hidden', tab !== 'save');
    if (panelLibrary) panelLibrary.classList.toggle('hidden', tab !== 'library');
    panelBulk.classList.toggle('hidden', tab !== 'bulk');
    panelImport.classList.toggle('hidden', tab !== 'import');
    if (tab === 'bulk') {
      refreshBulkMapsHint();
      refreshWebsiteQueueHint({ autoStart: true });
    }
    if (tab === 'library') {
      loadLibraryPanel();
    }
    if (tab === 'save') {
      detectActiveFacebookGroup();
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

function setLoyaltyStatus(msg, type = '') {
  if (!loyaltyStatusEl) return;
  loyaltyStatusEl.textContent = msg;
  loyaltyStatusEl.className = `status loyalty-status${type ? ` status--${type}` : ''}`;
}

function loyaltyFieldsFromResult(result) {
  if (!result) return {};
  return {
    loyaltyProgram: result.found ? 'yes' : 'no',
    hasLoyaltyProgram: !!result.found,
    loyaltyProgramEvidence: String(result.evidence || '').slice(0, 500),
    loyaltyProgramUrl: String(result.url || '').slice(0, 2000),
    loyaltyProgramCheckedAt: new Date().toISOString(),
  };
}

function formatLoyaltyResult(result) {
  if (!result) return '';
  if (result.found) {
    const extra = [result.evidence, result.url].filter(Boolean).join('\n');
    return extra ? `Found\n${extra}` : 'Found';
  }
  return 'Not found — no on-site loyalty program';
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

  const listingDetails = document.getElementById('listingDetails');
  if (listingDetails) {
    const hasListing = !!(
      form.price.value ||
      form.beds.value ||
      form.baths.value ||
      form.sqft.value ||
      lead.listingType === 'products' ||
      lead.jobType === 'products' ||
      lead.listingType === 'real_estate' ||
      lead.jobType === 'real_estate'
    );
    listingDetails.open = hasListing;
  }

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

  if (showSaveLeadFabEl) {
    showSaveLeadFabEl.checked = settings.showSaveLeadFab !== false;
  }

  if (window.AdHelloTheme && hasKey) {
    settings = await loadWorkspacePicker(settings);
  } else if (window.AdHelloTheme && settings) {
    await window.AdHelloTheme.fetchAndApplyTheme(settings);
  }

  refreshBulkMapsHint();
  refreshWebsiteQueueHint({ autoStart: true });

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
    await detectActiveFacebookGroup();
  } catch (err) {
    platformLabel.textContent = 'Could not read this page. Save from this popup, or enable the on-page button in Settings.';
    setStatus(err.message, 'error');
    if (defaultFolderName) form.folderName.value = defaultFolderName;
    await detectActiveFacebookGroup().catch(() => {});
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
      ...loyaltyFieldsFromResult(lastLoyaltyResult),
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

findLoyaltyBtn?.addEventListener('click', async () => {
  setLoyaltyStatus('Scanning this site…');
  findLoyaltyBtn.disabled = true;
  findLoyaltyBtn.textContent = 'Scanning…';
  try {
    const tab = await getActiveTab();
    const res = await chrome.runtime.sendMessage({ type: 'FIND_LOYALTY_PROGRAM', tabId: tab.id });
    if (!res?.ok) throw new Error(res?.error || 'Scan failed');
    lastLoyaltyResult = res.data || { found: false, evidence: '', url: tab.url || '' };
    setLoyaltyStatus(formatLoyaltyResult(lastLoyaltyResult), lastLoyaltyResult.found ? 'success' : '');
    const title = form.title.value.trim();
    if (!title) {
      setStatus('Enter a title, then Save to mark this lead.', 'error');
      return;
    }
    form.requestSubmit();
  } catch (err) {
    lastLoyaltyResult = null;
    setLoyaltyStatus(err.message || 'Scan failed', 'error');
  } finally {
    findLoyaltyBtn.disabled = false;
    findLoyaltyBtn.textContent = 'Find loyalty rewards';
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
        'No pipeline website queue. In AdHello, select leads with websites → Enrich leads, then try again.',
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

async function refreshWebsiteQueueHint(opts) {
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
      if (opts && opts.autoStart && !bulkRunning && !reEnrichRunning && !websiteEnrichRunning) {
        void runWebsiteEnrichQueue();
      }
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

let libraryCache = null;
let libraryActiveTabUrl = '';

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setLibraryStatus(msg, type) {
  const el = document.getElementById('libraryStatus');
  if (!el) return;
  el.textContent = msg || '';
  el.className = `status${type ? ` status--${type}` : ''}`;
}

function copyLibraryTextFallback(value) {
  const ta = document.createElement('textarea');
  ta.value = value;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, value.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } finally {
    document.body.removeChild(ta);
  }
  if (!ok) throw new Error('Could not copy');
}

async function copyLibraryText(text) {
  const value = String(text || '');
  if (!value) throw new Error('Nothing to copy');
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch (_) {
      /* fall through — popup contexts often need execCommand */
    }
  }
  copyLibraryTextFallback(value);
}

function renderLibraryScripts(scripts) {
  const host = document.getElementById('libraryScripts');
  if (!host) return;
  if (!scripts || !scripts.length) {
    host.innerHTML = '<p class="import-hint">No scripts loaded.</p>';
    return;
  }
  host.innerHTML = scripts
    .map((s, i) => {
      const body = String(s.body || '');
      return (
        `<article class="library-card" data-kind="script" data-idx="${i}">` +
        `<p class="library-card__meta">${escapeHtml(s.categoryLabel || '')}</p>` +
        `<p class="library-card__title">${escapeHtml(s.title || 'Script')}</p>` +
        `<p class="library-card__body">${escapeHtml(body)}</p>` +
        `<div class="library-card__actions"><button type="button" class="js-lib-copy" data-copy="${encodeURIComponent(body)}">Copy</button></div>` +
        `</article>`
      );
    })
    .join('');
}

function renderLibraryBookmarks(bookmarks) {
  const host = document.getElementById('libraryBookmarks');
  if (!host) return;
  if (!bookmarks || !bookmarks.length) {
    host.innerHTML =
      '<p class="import-hint">No bookmarked Social Posts yet. Bookmark ideas on /social-posts.</p>';
    return;
  }
  host.innerHTML = bookmarks
    .map((b, i) => {
      const body = String(b.content || [b.hook, b.cta].filter(Boolean).join('\n\n') || '');
      return (
        `<article class="library-card" data-kind="bookmark" data-idx="${i}">` +
        `<p class="library-card__meta">${escapeHtml(b.platform || 'post')}</p>` +
        `<p class="library-card__title">${escapeHtml((b.hook || body || 'Post').slice(0, 80))}</p>` +
        `<p class="library-card__body">${escapeHtml(body)}</p>` +
        `<div class="library-card__actions"><button type="button" class="js-lib-copy" data-copy="${encodeURIComponent(body)}">Copy</button></div>` +
        `</article>`
      );
    })
    .join('');
}

function renderLibraryGroups(groups) {
  const host = document.getElementById('libraryGroups');
  if (!host) return;
  if (!groups || !groups.length) {
    host.innerHTML =
      '<p class="import-hint">No saved groups yet. Open a group and tap Save this group, or add one on /fb-groups.</p>';
    return;
  }
  host.innerHTML = groups
    .map((g, i) => {
      const url = String(g.url || '');
      const members =
        g.memberCountLabel ||
        (g.memberCount != null ? `${Number(g.memberCount).toLocaleString()} members` : '');
      const metaBits = [
        g.category || 'Facebook Group',
        members,
        g.privacy,
        g.lastPosted ? `Posted ${g.lastPosted}` : '',
        g.adminContact ? `Admin ${g.adminContact}` : '',
      ].filter(Boolean);
      return (
        `<article class="library-card" data-kind="group" data-idx="${i}">` +
        `<p class="library-card__meta">${escapeHtml(metaBits.join(' · '))}</p>` +
        `<p class="library-card__title">${escapeHtml(g.title || 'Group')}</p>` +
        (g.note ? `<p class="library-card__body">${escapeHtml(g.note)}</p>` : '') +
        (g.location ? `<p class="library-card__body">${escapeHtml(g.location)}</p>` : '') +
        `<div class="library-card__actions">` +
        `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Open</a>` +
        `<button type="button" class="js-lib-copy" data-copy="${encodeURIComponent(url)}">Copy URL</button>` +
        `</div></article>`
      );
    })
    .join('');
}

function libraryTextForCard(card) {
  if (!card || !libraryCache) return '';
  const kind = card.getAttribute('data-kind');
  const idx = Number(card.getAttribute('data-idx'));
  if (!Number.isFinite(idx) || idx < 0) return '';
  if (kind === 'script') {
    const s = (libraryCache.scripts || [])[idx];
    return (s && s.body) || '';
  }
  if (kind === 'bookmark') {
    const b = (libraryCache.bookmarks || [])[idx];
    if (!b) return '';
    return b.content || [b.hook, b.cta].filter(Boolean).join('\n\n');
  }
  if (kind === 'group') {
    const g = (libraryCache.groups || [])[idx];
    return (g && g.url) || '';
  }
  return '';
}

function bindLibraryCopyClicks(root) {
  if (!root) return;
  root.querySelectorAll('.js-lib-copy').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('.library-card');
      let text = '';
      const encoded = btn.getAttribute('data-copy');
      if (encoded) {
        try {
          text = decodeURIComponent(encoded);
        } catch (_) {
          text = '';
        }
      }
      if (!text) text = libraryTextForCard(card);
      try {
        await copyLibraryText(text);
        setLibraryStatus('Copied — paste into Facebook', 'success');
      } catch (err) {
        setLibraryStatus(err.message || 'Could not copy', 'error');
      }
    });
  });
}

function showLibrarySection(which) {
  document.querySelectorAll('.library-subtab').forEach((b) => {
    b.classList.toggle('library-subtab--active', b.getAttribute('data-lib') === which);
  });
  const scripts = document.getElementById('libraryScripts');
  const bookmarks = document.getElementById('libraryBookmarks');
  const groups = document.getElementById('libraryGroups');
  if (scripts) scripts.classList.toggle('hidden', which !== 'scripts');
  if (bookmarks) bookmarks.classList.toggle('hidden', which !== 'bookmarks');
  if (groups) groups.classList.toggle('hidden', which !== 'groups');
}

async function detectActiveFacebookGroup() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = String((tab && tab.url) || '');
  libraryActiveTabUrl = url;
  let isGroup = false;
  try {
    const u = new URL(url);
    const h = u.hostname.replace(/^www\./, '').toLowerCase();
    isGroup =
      (h === 'facebook.com' || h === 'm.facebook.com' || h === 'web.facebook.com') &&
      /\/groups\//i.test(u.pathname);
  } catch (_) {
    isGroup = false;
  }
  const bar = document.getElementById('saveGroupBar');
  if (bar) bar.classList.toggle('hidden', !isGroup);
  return { isGroup, url, title: (tab && tab.title) || '', tabId: tab && tab.id };
}

function scrapeFbGroupMetaInPage() {
  function cleanTitle(raw) {
    let t = String(raw || '').trim();
    t = t.replace(/^\(\d+\)\s*/, '');
    t = t.replace(/\s*[|·•]\s*Groups\s*[|·•]\s*Facebook\s*$/i, '');
    t = t.replace(/\s*[|·•]\s*Facebook\s*$/i, '');
    t = t.replace(/\s*[|·•]\s*Groups\s*$/i, '');
    return t.trim();
  }
  function isJunkTitle(raw) {
    const s = cleanTitle(raw).toLowerCase();
    if (!s) return true;
    return /^(notifications?|facebook|home|watch|marketplace|menu|friends|feeds?|groups?|search|reels|gaming|messages?|inbox|profile|settings|login|log in)$/i.test(
      s,
    );
  }
  function titleFromPath() {
    try {
      const m = location.pathname.match(/\/groups\/([^/?#]+)/i);
      if (!m) return '';
      const slug = decodeURIComponent(m[1]).replace(/[-_]+/g, ' ').trim();
      if (/^\d+$/.test(slug)) return '';
      return slug.replace(/\b\w/g, (c) => c.toUpperCase());
    } catch (_) {
      return '';
    }
  }
  const candidates = [];
  const og = document.querySelector('meta[property="og:title"]');
  if (og && og.getAttribute('content')) candidates.push(og.getAttribute('content'));
  document.querySelectorAll('h1').forEach((el) => {
    if (el && el.textContent) candidates.push(el.textContent);
  });
  candidates.push(document.title || '');
  let title = '';
  for (let i = 0; i < candidates.length; i += 1) {
    const cleaned = cleanTitle(candidates[i]);
    if (cleaned && !isJunkTitle(cleaned)) {
      title = cleaned;
      break;
    }
  }
  if (!title) title = titleFromPath();
  const text = String((document.body && document.body.innerText) || '').slice(0, 80000);
  let memberCount = null;
  let memberCountLabel = '';
  const memberMatch = text.match(/([\d][\d,]*(?:\.\d+)?)\s*([KkMm])?\s*\+?\s*members?\b/);
  if (memberMatch) {
    let n = Number(String(memberMatch[1]).replace(/,/g, ''));
    if (Number.isFinite(n)) {
      if (/k/i.test(memberMatch[2] || '')) n *= 1000;
      if (/m/i.test(memberMatch[2] || '')) n *= 1000000;
      memberCount = Math.round(n);
      memberCountLabel = memberMatch[0].replace(/\s+/g, ' ').trim();
    }
  }
  let privacy = '';
  if (/\bPublic\s+group\b/i.test(text)) privacy = 'public';
  else if (/\bPrivate\s+group\b/i.test(text)) privacy = 'private';
  let lastPosted = '';
  const postMatch = text.match(
    /\b((?:\d+\s*(?:min|mins|minute|minutes|hr|hrs|hour|hours|d|day|days|w|week|weeks)\s*ago)|Yesterday(?:\s+at\s+\d{1,2}:\d{2}\s*[AP]M)?|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:,?\s+\d{4})?(?:\s+at\s+\d{1,2}:\d{2}\s*[AP]M)?)\b/i,
  );
  if (postMatch) lastPosted = postMatch[1].replace(/\s+/g, ' ').trim().slice(0, 80);
  let adminContact = '';
  const adminMatch = text.match(
    /(?:Group\s+)?(?:Admin|Admins|Owner)\s*[:\-]?\s*([A-Z][A-Za-z0-9 .'-]{1,48})/,
  );
  if (adminMatch) adminContact = adminMatch[1].trim().slice(0, 200);
  return {
    title,
    memberCount,
    memberCountLabel,
    privacy,
    location: '',
    lastPosted,
    adminContact,
  };
}

async function scrapeActiveFbGroupMeta(tabId) {
  if (!tabId) return null;
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: scrapeFbGroupMetaInPage,
    });
    return result || null;
  } catch (_) {
    return null;
  }
}

async function loadLibraryPanel() {
  setLibraryStatus('Loading library…');
  try {
    const res = await chrome.runtime.sendMessage({
      type: 'GET_PROSPECTING_LIBRARY',
      workspaceId: getSelectedWorkspaceId(),
    });
    if (!res?.ok) throw new Error(res?.error || 'Could not load library');
    libraryCache = res.data || {};
    renderLibraryScripts(libraryCache.scripts || []);
    renderLibraryBookmarks(libraryCache.bookmarks || []);
    renderLibraryGroups(libraryCache.groups || []);
    bindLibraryCopyClicks(document.getElementById('libraryScripts'));
    bindLibraryCopyClicks(document.getElementById('libraryBookmarks'));
    bindLibraryCopyClicks(document.getElementById('libraryGroups'));
    setLibraryStatus(
      `${(libraryCache.scripts || []).length} scripts · ${(libraryCache.bookmarks || []).length} bookmarks · ${(libraryCache.groups || []).length} groups`,
    );
  } catch (err) {
    setLibraryStatus(err.message || 'Could not load library', 'error');
  }
}

document.querySelectorAll('.library-subtab').forEach((btn) => {
  btn.addEventListener('click', () => {
    showLibrarySection(btn.getAttribute('data-lib') || 'scripts');
  });
});

document.getElementById('saveGroupBtn')?.addEventListener('click', async () => {
  const statusEl = document.getElementById('saveGroupStatus');
  const btn = document.getElementById('saveGroupBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving…';
  }
  if (statusEl) {
    statusEl.textContent = '';
    statusEl.className = 'status';
  }
  try {
    const detected = await detectActiveFacebookGroup();
    if (!detected.isGroup) throw new Error('Open a Facebook group tab first.');
    const meta = (await scrapeActiveFbGroupMeta(detected.tabId)) || {};
    const res = await chrome.runtime.sendMessage({
      type: 'SAVE_FB_GROUP',
      url: detected.url,
      title: meta.title || detected.title,
      memberCount: meta.memberCount,
      memberCountLabel: meta.memberCountLabel || '',
      privacy: meta.privacy || '',
      location: meta.location || '',
      lastPosted: meta.lastPosted || '',
      adminContact: meta.adminContact || '',
      workspaceId: getSelectedWorkspaceId(),
    });
    if (!res?.ok) throw new Error(res?.error || 'Save failed');
    const already = res.data && res.data.alreadySaved;
    const saved = res.data && res.data.group;
    let msg = already ? 'Already in your library.' : 'Group saved to AdHello.';
    if (saved && saved.memberCountLabel) msg += ` · ${saved.memberCountLabel}`;
    else if (saved && saved.memberCount != null) msg += ` · ${Number(saved.memberCount).toLocaleString()} members`;
    if (saved && saved.lastPosted) msg += ` · last post ${saved.lastPosted}`;
    if (statusEl) {
      statusEl.textContent = msg;
      statusEl.className = 'status status--success';
    }
  } catch (err) {
    if (statusEl) {
      statusEl.textContent = err.message || 'Could not save group';
      statusEl.className = 'status status--error';
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Save this group to AdHello';
    }
  }
});

init();
