const form = document.getElementById('leadForm');
const importForm = document.getElementById('importForm');
const statusEl = document.getElementById('status');
const importStatusEl = document.getElementById('importStatus');
const platformLabel = document.getElementById('platformLabel');
const saveTypeLabel = document.getElementById('saveTypeLabel');
const setupNotice = document.getElementById('setupNotice');
const saveBtn = document.getElementById('saveBtn');
const openOptions = document.getElementById('openOptions');
const panelSave = document.getElementById('panelSave');
const panelImport = document.getElementById('panelImport');
const EXT_VERSION = '1.4.0';

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
    panelImport.classList.toggle('hidden', tab !== 'import');
  });
});

function setStatus(msg, type = '') {
  statusEl.textContent = msg;
  statusEl.className = `status${type ? ` status--${type}` : ''}`;
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

async function getActiveTabLead() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab');

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
  }

  try {
    const { tab, lead } = await getActiveTabLead();
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

  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

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
    setStatus(`Saved (${res.data?.key || 'ok'})${folderNote}`, 'success');
  } catch (err) {
    setStatus(err.message || 'Save failed', 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save to AdHello';
  }
});

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
  importBtn.disabled = true;
  importBtn.textContent = 'Importing…';

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
    importBtn.disabled = false;
    importBtn.textContent = 'Import list to AdHello';
  }
});

init();
