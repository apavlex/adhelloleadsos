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
const EXT_VERSION = '1.5.3';
const BULK_IMPORT_BATCH_SIZE = 15;

let bulkRunning = false;
let bulkStopRequested = false;

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
    if (tab === 'bulk') refreshBulkMapsHint();
  });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.action !== 'bulkScrapeProgress' || !bulkProgressEl) return;
  if (message.phase === 'enrich') {
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

async function ensureBulkScript(tabId) {
  const files = ['src/address-utils.js', 'src/maps-bulk-scrape.js'];
  for (const file of files) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: [file] });
    } catch (_) {
      /* content script may already be present */
    }
  }
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

function mapCompanyToImportRow(company) {
  const address = String(company.Address || '').trim();
  const parsed = window.AdHelloAddressUtils?.parseCityState
    ? window.AdHelloAddressUtils.parseCityState(address)
    : { street: address, city: '', state: '' };
  const city = String(company.City || parsed.city || '').trim();
  const state = String(company.State || parsed.state || '').trim();
  const street = parsed.street || address;
  const fullAddress = city && state ? `${street}, ${city}, ${state}` : city ? `${street}, ${city}` : street;
  let snippet = String(company['Review Snippet'] || '').trim();
  if (snippet.startsWith('"') && snippet.endsWith('"')) snippet = snippet.slice(1, -1).trim();
  const website = String(company.Website || '').trim();
  const domain = window.AdHelloAddressUtils?.hostnameFromUrl?.(website) || '';
  return {
    company_name: company['Business Name'] || '',
    phone_number: company['Phone Number'] || '',
    company_location: fullAddress || address,
    address: fullAddress || address,
    city,
    state,
    company_type: company.Category || '',
    category: company.Category || '',
    rating: company.Rating || '',
    review_count: String(company['Review Count'] || '').replace(/[^\d]/g, ''),
    review_snippet: snippet,
    sponsored: company.Sponsored || '',
    company_website: website,
    website,
    company_domain: domain,
    domain,
    google_maps_url: company['Google Maps URL'] || '',
    booking_url: company['Booking URL'] || '',
    source: 'chrome_extension_maps_bulk',
  };
}

function companiesToCsv(companies) {
  if (!companies?.length) return '';
  const headers = [
    'company_name',
    'phone_number',
    'company_location',
    'address',
    'city',
    'state',
    'company_type',
    'category',
    'rating',
    'review_count',
    'review_snippet',
    'sponsored',
    'company_website',
    'website',
    'company_domain',
    'domain',
    'google_maps_url',
    'booking_url',
    'source',
  ];
  const esc = (val) => {
    const s = val == null ? '' : String(val);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const rows = companies.map((c) => mapCompanyToImportRow(c));
  let csv = headers.join(',') + '\n';
  rows.forEach((row) => {
    csv += headers.map((h) => esc(row[h] ?? '')).join(',') + '\n';
  });
  return csv;
}

async function importCompaniesInBatches(companies, folderName, fileSlug, onProgress) {
  let created = 0;
  let updated = 0;
  let failed = 0;
  let folderLabel = folderName;
  const total = companies.length;

  for (let i = 0; i < total; i += BULK_IMPORT_BATCH_SIZE) {
    const chunk = companies.slice(i, i + BULK_IMPORT_BATCH_SIZE);
    const batchNum = Math.floor(i / BULK_IMPORT_BATCH_SIZE) + 1;
    const batchTotal = Math.ceil(total / BULK_IMPORT_BATCH_SIZE);
    if (onProgress) {
      onProgress(
        `Importing batch ${batchNum}/${batchTotal} (${Math.min(i + chunk.length, total)}/${total} businesses)…`,
      );
    }

    const res = await chrome.runtime.sendMessage({
      type: 'IMPORT_CSV',
      csvContent: companiesToCsv(chunk),
      fileName: `${fileSlug || 'maps-scrape'}-batch-${batchNum}.csv`,
      folderName,
    });
    if (!res?.ok) {
      const msg = res?.error || 'Import failed';
      if (/502|503|504|timeout/i.test(msg) && i > 0) {
        throw new Error(
          `${msg} — ${created + updated} of ${total} imported before the server timed out. Try again; duplicates will merge.`,
        );
      }
      throw new Error(msg);
    }

    const data = res.data || {};
    created += data.created || 0;
    updated += data.updated || 0;
    failed += data.failed || 0;
    if (data.folderName) folderLabel = data.folderName;
  }

  return { created, updated, failed, folderName: folderLabel };
}

async function refreshBulkMapsHint() {
  if (!bulkMapsHintEl) return;
  try {
    const tab = await getActiveTab();
    if (isGoogleMapsUrl(tab.url)) {
      bulkMapsHintEl.textContent = 'Connected to Google Maps — ready to bulk scrape this results list.';
      bulkMapsHintEl.className = 'bulk-maps-hint bulk-maps-hint--ready';
    } else {
      bulkMapsHintEl.textContent =
        'Open a Google Maps search results page first (e.g. “electricians near me”), then reopen this tab.';
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

  const scripts = ['src/address-utils.js', 'src/listing-helpers.js', 'src/listing-extractors.js', 'src/extractors.js'];
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

function fillForm(lead, defaultFolderName) {
  if (!lead) return;
  form.title.value = lead.title || '';
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
  form.website.value = lead.website && lead.website !== 'N/A' ? lead.website : '';
  form.email.value = lead.email && lead.email !== 'N/A' ? lead.email : '';
  form.phone.value = lead.phone && lead.phone !== 'N/A' ? lead.phone : '';
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

async function init() {
  const settingsRes = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  const hasKey = !!settingsRes?.settings?.apiKey;
  const defaultFolderName = settingsRes?.settings?.defaultFolderName || '';
  setupNotice.classList.toggle('hidden', hasKey);
  if (defaultFolderName) {
    form.folderName.value = defaultFolderName;
    if (importForm) importForm.importFolderName.value = defaultFolderName;
    if (bulkForm) bulkForm.bulkFolderName.value = defaultFolderName;
  }

  if (window.AdHelloTheme && settingsRes?.settings) {
    await window.AdHelloTheme.fetchAndApplyTheme(settingsRes.settings);
  }

  refreshBulkMapsHint();

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
      ? `From ${platform.replace(/_/g, ' ')} · ${new URL(tab.url).hostname}`
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

  try {
    const { lead: base } = await getActiveTabLead();
    const reviews = parseReviewsField(form.reviews.value);
    const payload = {
      ...(base || {}),
      ...buildListingPayload(base, form),
      title,
      note: form.note.value.trim(),
      address: form.address.value.trim() || 'N/A',
      city: form.city.value.trim(),
      state: form.state.value.trim(),
      website: form.website.value.trim() || 'N/A',
      email: form.email.value.trim() || 'N/A',
      phone: form.phone.value.trim() || 'N/A',
      totalScore: reviews.totalScore || base?.totalScore || 0,
      reviewsCount: reviews.reviewsCount || base?.reviewsCount || 0,
      url: base?.url || '',
      categoryName: base?.categoryName || undefined,
      reviewSnippets: base?.reviewSnippets || undefined,
      sponsored: typeof base?.sponsored === 'boolean' ? base.sponsored : undefined,
      source: 'chrome_extension',
    };
    const folderName = form.folderName.value.trim();
    if (folderName) payload.folderName = folderName;

    const res = await chrome.runtime.sendMessage({ type: 'SAVE_LEAD', lead: payload });
    if (!res?.ok) throw new Error(res?.error || 'Save failed');
    const folderNote =
      res.data?.folderName && res.data?.folderUrl
        ? ` · Open ${res.data.folderName} folder in AdHello`
        : res.data?.folderName
          ? ` · ${res.data.folderName} folder`
          : '';
    const mergeNote = res.data?.merged ? ' · Updated existing lead' : '';
    setStatus(`Saved (${res.data?.key || 'ok'})${mergeNote}${folderNote}`, 'success');
  } catch (err) {
    setStatus(err.message || 'Save failed', 'error');
  } finally {
    saveButtons.forEach((btn) => {
      btn.disabled = false;
      btn.textContent = 'Save to AdHello';
    });
  }
});

async function runBulkScrapeSubmit(e) {
  e.preventDefault();
  if (bulkRunning) {
    bulkStopRequested = true;
    try {
      const tab = await getActiveTab();
      await sendTabMessage(tab.id, { action: 'bulkStopPreload' });
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

    await chrome.tabs.update(tab.id, { active: true });
    await ensureBulkScript(tab.id);

    if (scrollAll) {
      if (bulkProgressEl) bulkProgressEl.textContent = 'Scrolling to load all results…';
      const preload = await sendTabMessage(tab.id, { action: 'bulkPreload' });
      if (!preload?.success) {
        throw new Error(
          preload?.reason === 'no_container'
            ? 'Could not find the Maps results list. Try opening the left-side results panel.'
            : 'Could not scroll the results list.',
        );
      }
      if (bulkStopRequested || preload.stoppedByUser) {
        if (bulkProgressEl) bulkProgressEl.textContent = `Stopped early — extracting ${preload.businessCount || 0} loaded businesses…`;
      }
    }

    if (bulkProgressEl) bulkProgressEl.textContent = 'Extracting business data…';
    const extract = await sendTabMessage(tab.id, {
      action: 'bulkGetCompanies',
      enrichDetails,
    });
    const companies = extract?.companies || [];
    if (!companies.length) {
      throw new Error('No businesses found. Scroll the Maps list manually, then try again.');
    }

    const searchSlug = String(extract?.searchQuery || 'maps-scrape')
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9_-]/g, '')
      .slice(0, 40);

    const data = await importCompaniesInBatches(companies, folderName, searchSlug, (msg) => {
      if (bulkProgressEl) bulkProgressEl.textContent = msg;
    });

    const parts = [`${data.created} new`];
    if (data.updated) parts.push(`${data.updated} updated`);
    if (data.failed) parts.push(`${data.failed} failed`);
    const enrichNote =
      enrichDetails && extract?.enrichedCount != null ? ` · ${extract.enrichedCount} websites found` : '';
    setBulkStatus(
      `Imported ${companies.length} scraped businesses (${parts.join(', ')}) into “${data.folderName || folderName}”.${enrichNote}`,
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
