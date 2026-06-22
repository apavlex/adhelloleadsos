const form = document.getElementById('leadForm');
const statusEl = document.getElementById('status');
const platformLabel = document.getElementById('platformLabel');
const saveTypeLabel = document.getElementById('saveTypeLabel');
const setupNotice = document.getElementById('setupNotice');
const saveBtn = document.getElementById('saveBtn');
const openOptions = document.getElementById('openOptions');

openOptions.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

function setStatus(msg, type = '') {
  statusEl.textContent = msg;
  statusEl.className = `status${type ? ` status--${type}` : ''}`;
}

function parsePriceInput(raw) {
  const n = parseInt(String(raw || '').replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
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

  const scripts = ['src/listing-helpers.js', 'src/listing-extractors.js', 'src/extractors.js'];
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

function fillForm(lead) {
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
  form.address.value = lead.address && lead.address !== 'N/A' ? lead.address : '';
  form.city.value = lead.city || '';
  form.state.value = lead.state || '';
  form.website.value = lead.website && lead.website !== 'N/A' ? lead.website : '';
  form.email.value = lead.email && lead.email !== 'N/A' ? lead.email : '';
  form.phone.value = lead.phone && lead.phone !== 'N/A' ? lead.phone : '';

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
  setupNotice.classList.toggle('hidden', hasKey);

  try {
    const { tab, lead } = await getActiveTabLead();
    const platform = lead?.sourceChannel || 'current page';
    platformLabel.textContent = lead
      ? `From ${platform.replace(/_/g, ' ')} · ${new URL(tab.url).hostname}`
      : 'Open a supported listing, profile, or business page to auto-fill.';
    fillForm(lead);
  } catch (err) {
    platformLabel.textContent = 'Could not read this page. Use the on-page Save lead button.';
    setStatus(err.message, 'error');
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
      source: 'chrome_extension',
    };

    const res = await chrome.runtime.sendMessage({ type: 'SAVE_LEAD', lead: payload });
    if (!res?.ok) throw new Error(res?.error || 'Save failed');
    setStatus(`Saved (${res.data?.key || 'ok'})`, 'success');
  } catch (err) {
    setStatus(err.message || 'Save failed', 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save to AdHello';
  }
});

init();
