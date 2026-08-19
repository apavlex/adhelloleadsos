(function () {
  // AdHello Pipeline can postMessage to start website enrich even when this page
  // is not a "supported" lead-save page (FAB exits early below).
  function postToAdHelloApp(payload) {
    try {
      window.postMessage({ source: 'adhello-extension', ...payload }, '*');
    } catch (_) {
      /* ignore */
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.action !== 'bulkScrapeProgress') return;
    if (message?.phase === 'website-enrich-parallel') {
      postToAdHelloApp({
        type: 'WEBSITE_ENRICH_PROGRESS',
        current: Number(message.current) || 0,
        total: Number(message.total) || 0,
      });
      return;
    }
    if (message?.phase === 'website-enrich-done') {
      postToAdHelloApp({
        type: 'WEBSITE_ENRICH_DONE',
        ok: true,
        current: Number(message.current) || 0,
        total: Number(message.total) || 0,
        updated: Number(message.updated) || 0,
        data: message,
      });
    }
  });

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'adhello-app') return;
    if (data.type !== 'START_WEBSITE_ENRICH_QUEUE') return;
    const workspaceId = String(data.workspaceId || '').trim();
    postToAdHelloApp({
      type: 'WEBSITE_ENRICH_PROGRESS',
      current: 0,
      total: Number(data.queued) || 0,
    });
    chrome.runtime
      .sendMessage({
        type: 'PARALLEL_WEBSITE_ENRICH_QUEUE',
        limit: Math.min(Math.max(parseInt(data.limit, 10) || 150, 1), 150),
        workspaceId: workspaceId || undefined,
        clearWhenDone: true,
      })
      .then((res) => {
        const payload = res?.data || {};
        postToAdHelloApp({
          type: 'WEBSITE_ENRICH_DONE',
          ok: !!res?.ok,
          error: res?.ok ? null : res?.error || 'Website enrich failed',
          current: Number(payload.attempted) || Number(payload.totalNeeding) || 0,
          total: Number(payload.attempted) || Number(payload.totalNeeding) || 0,
          updated: Number(payload.updated) || 0,
          data: payload,
        });
      })
      .catch((err) => {
        postToAdHelloApp({
          type: 'WEBSITE_ENRICH_DONE',
          ok: false,
          error: (err && err.message) || 'Extension enrich failed',
        });
      });
  });

  const { extractLeadFromPage, isSupportedPage } = window.AdHelloExtractors;

  // Never show Save lead FAB on the AdHello app (covers chatbot / in-app UI).
  const onAdHelloApp =
    !!(typeof window !== 'undefined' && window.__ADHELLO_WORKSPACE_ID__) ||
    !!(
      window.AdHelloWebsiteScrape &&
      typeof window.AdHelloWebsiteScrape.isAdHelloAppUrl === 'function' &&
      window.AdHelloWebsiteScrape.isAdHelloAppUrl(window.location.href)
    );
  if (onAdHelloApp) {
    try {
      const existing = document.getElementById('adhello-lead-saver-root');
      if (existing) existing.remove();
    } catch (_) {
      /* ignore */
    }
    return;
  }

  if (!isSupportedPage()) return;

  const ROOT_ID = 'adhello-lead-saver-root';

  function toast(msg, type = 'info') {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    let el = root.querySelector('.adhello-toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'adhello-toast';
      root.appendChild(el);
    }
    el.textContent = msg;
    el.dataset.type = type;
    el.classList.add('adhello-toast--show');
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => el.classList.remove('adhello-toast--show'), 3500);
  }

  async function saveLead(lead) {
    const settingsRes = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    const workspaceId = String(settingsRes?.settings?.workspaceId || '').trim();
    return chrome.runtime.sendMessage({
      type: 'SAVE_LEAD',
      lead,
      workspaceId: workspaceId || undefined,
    });
  }

  function enrichPayloadGeo(payload) {
    if (window.AdHelloListingHelpers?.enrichLeadGeo) {
      return window.AdHelloListingHelpers.enrichLeadGeo({ ...payload });
    }
    return payload;
  }

  async function applyContentTheme(root) {
    if (!root || !window.AdHelloTheme) return;
    try {
      const res = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      if (!res?.ok) {
        window.AdHelloTheme.applyWorkspaceThemeToElement(root, { accentColor: window.AdHelloTheme.DEFAULT_ACCENT });
        return;
      }
      const theme = await window.AdHelloTheme.fetchWorkspaceTheme(res.settings);
      window.AdHelloTheme.applyWorkspaceThemeToElement(root, theme);
    } catch (_) {
      window.AdHelloTheme.applyWorkspaceThemeToElement(root, { accentColor: window.AdHelloTheme.DEFAULT_ACCENT });
    }
  }

  function buildPanel(initial) {
    const root = document.createElement('div');
    root.id = ROOT_ID;
    root.innerHTML = `
      <button type="button" class="adhello-fab" title="Save to AdHello">Save lead</button>
      <div class="adhello-panel adhello-panel--hidden" role="dialog" aria-label="Save lead to AdHello">
        <div class="adhello-panel__header">
          <strong>Save to AdHello</strong>
          <div class="adhello-panel__header-actions">
            <button type="button" class="adhello-btn adhello-btn--primary adhello-btn--compact adhello-save adhello-save--header">Save lead</button>
            <button type="button" class="adhello-panel__close" aria-label="Close">×</button>
          </div>
        </div>
        <div class="adhello-panel__body">
          <p id="adhello-save-type" class="adhello-save-type"></p>
          <label class="adhello-field">
            <span>Source</span>
            <input type="text" name="sourceChannelDisplay" readonly tabindex="-1" placeholder="Detected from page" />
            <input type="hidden" name="sourceChannel" />
          </label>
          <label class="adhello-field">
            <span>Name / title</span>
            <input type="text" name="title" required />
          </label>
          <label class="adhello-field">
            <span>Price</span>
            <input type="text" name="price" placeholder="$0" />
          </label>
          <div class="adhello-field-row">
            <label class="adhello-field adhello-field--third">
              <span>Beds</span>
              <input type="text" name="beds" inputmode="decimal" />
            </label>
            <label class="adhello-field adhello-field--third">
              <span>Baths</span>
              <input type="text" name="baths" inputmode="decimal" />
            </label>
            <label class="adhello-field adhello-field--third">
              <span>Sqft</span>
              <input type="text" name="sqft" inputmode="numeric" />
            </label>
          </div>
          <label class="adhello-field">
            <span>Headline / notes</span>
            <textarea name="note" rows="3"></textarea>
          </label>
          <label class="adhello-field">
            <span>Address</span>
            <input type="text" name="address" placeholder="Street, city, state" />
          </label>
          <div class="adhello-field-row">
            <label class="adhello-field adhello-field--half">
              <span>City</span>
              <input type="text" name="city" />
            </label>
            <label class="adhello-field adhello-field--half">
              <span>State</span>
              <input type="text" name="state" />
            </label>
          </div>
          <label class="adhello-field">
            <span>Website</span>
            <input type="url" name="website" placeholder="https://" />
          </label>
          <label class="adhello-field">
            <span>Email</span>
            <input type="email" name="email" placeholder="optional" />
          </label>
          <label class="adhello-field">
            <span>Phone</span>
            <input type="tel" name="phone" placeholder="optional" />
          </label>
          <details class="adhello-social-details">
            <summary>Social profiles</summary>
            <label class="adhello-field">
              <span>Facebook</span>
              <input type="url" name="facebook" placeholder="https://facebook.com/…" />
            </label>
            <label class="adhello-field">
              <span>Instagram</span>
              <input type="url" name="instagram" placeholder="https://instagram.com/…" />
            </label>
            <label class="adhello-field">
              <span>X / Twitter</span>
              <input type="url" name="twitter" placeholder="https://x.com/…" />
            </label>
            <label class="adhello-field">
              <span>LinkedIn</span>
              <input type="url" name="linkedin" placeholder="https://linkedin.com/…" />
            </label>
            <label class="adhello-field">
              <span>TikTok</span>
              <input type="url" name="tiktok" placeholder="https://tiktok.com/@…" />
            </label>
          </details>
          <div class="adhello-tool-block">
            <button type="button" class="adhello-btn adhello-btn--ghost adhello-loyalty">Find loyalty rewards</button>
            <p class="adhello-loyalty-status" aria-live="polite"></p>
          </div>
        </div>
        <div class="adhello-panel__actions">
          <button type="button" class="adhello-btn adhello-btn--ghost adhello-cancel">Cancel</button>
          <button type="button" class="adhello-btn adhello-btn--primary adhello-btn--compact adhello-save adhello-save--footer">Save lead</button>
        </div>
      </div>
    `;

    const fab = root.querySelector('.adhello-fab');
    const panel = root.querySelector('.adhello-panel');
    const closeBtn = root.querySelector('.adhello-panel__close');
    const cancelBtn = root.querySelector('.adhello-cancel');
    const saveBtns = root.querySelectorAll('.adhello-save');
    const loyaltyBtn = root.querySelector('.adhello-loyalty');
    const loyaltyStatusEl = root.querySelector('.adhello-loyalty-status');
    let lastLoyaltyResult = null;

    const saveTypeEl = root.querySelector('#adhello-save-type');

    const fields = {
      title: root.querySelector('[name="title"]'),
      sourceChannel: root.querySelector('[name="sourceChannel"]'),
      sourceChannelDisplay: root.querySelector('[name="sourceChannelDisplay"]'),
      price: root.querySelector('[name="price"]'),
      beds: root.querySelector('[name="beds"]'),
      baths: root.querySelector('[name="baths"]'),
      sqft: root.querySelector('[name="sqft"]'),
      note: root.querySelector('[name="note"]'),
      address: root.querySelector('[name="address"]'),
      city: root.querySelector('[name="city"]'),
      state: root.querySelector('[name="state"]'),
      website: root.querySelector('[name="website"]'),
      email: root.querySelector('[name="email"]'),
      phone: root.querySelector('[name="phone"]'),
      facebook: root.querySelector('[name="facebook"]'),
      instagram: root.querySelector('[name="instagram"]'),
      twitter: root.querySelector('[name="twitter"]'),
      linkedin: root.querySelector('[name="linkedin"]'),
      tiktok: root.querySelector('[name="tiktok"]'),
      socialDetails: root.querySelector('.adhello-social-details'),
    };

    function fill(data) {
      fields.title.value = data.title || '';
      const sourceKey = String(data.sourceChannel || '').trim();
      if (fields.sourceChannel) fields.sourceChannel.value = sourceKey;
      if (fields.sourceChannelDisplay) {
        const fmt =
          typeof window.AdHelloExtractors?.formatSourceChannelLabel === 'function'
            ? window.AdHelloExtractors.formatSourceChannelLabel(sourceKey)
            : sourceKey.replace(/_/g, ' ');
        fields.sourceChannelDisplay.value = fmt || '';
      }
      fields.price.value =
        data.listingPrice != null
          ? `$${Number(data.listingPrice).toLocaleString()}`
          : data.listing?.price != null
            ? `$${Number(data.listing.price).toLocaleString()}`
            : '';
      fields.beds.value = data.listingBeds ?? data.listing?.beds ?? '';
      fields.baths.value = data.listingBaths ?? data.listing?.baths ?? '';
      fields.sqft.value = data.listingSqft ?? data.listing?.sqft ?? '';
      fields.note.value = data.note || '';
      fields.address.value =
        data.address && data.address !== 'N/A'
          ? (window.AdHelloAddressUtils?.cleanAddress?.(data.address) || data.address)
          : '';
      fields.city.value = data.city || '';
      fields.state.value = data.state || '';
      fields.website.value = data.website && data.website !== 'N/A' ? data.website : '';
      fields.email.value = data.email && data.email !== 'N/A' ? data.email : '';
      fields.phone.value = data.phone && data.phone !== 'N/A' ? data.phone : '';
      if (fields.facebook) {
        fields.facebook.value = data.facebook && data.facebook !== 'N/A' ? data.facebook : '';
      }
      if (fields.instagram) {
        fields.instagram.value = data.instagram && data.instagram !== 'N/A' ? data.instagram : '';
      }
      if (fields.twitter) {
        fields.twitter.value = data.twitter && data.twitter !== 'N/A' ? data.twitter : '';
      }
      if (fields.linkedin) {
        fields.linkedin.value = data.linkedin && data.linkedin !== 'N/A' ? data.linkedin : '';
      }
      if (fields.tiktok) {
        fields.tiktok.value = data.tiktok && data.tiktok !== 'N/A' ? data.tiktok : '';
      }
      if (fields.socialDetails) {
        const hasSocial = [data.facebook, data.instagram, data.twitter, data.linkedin, data.tiktok].some(
          (v) => v && v !== 'N/A',
        );
        fields.socialDetails.open = hasSocial;
      }
      if (saveTypeEl) {
        const label =
          data.listingType === 'products'
            ? 'Product listing'
            : data.listingType === 'real_estate'
              ? 'Real estate listing'
              : data.jobType === 'products'
                ? 'Product listing'
                : data.jobType === 'real_estate'
                  ? 'Real estate listing'
                  : '';
        saveTypeEl.textContent = label;
        saveTypeEl.style.display = label ? 'block' : 'none';
      }
    }

    function parsePriceInput(raw) {
      const n = parseInt(String(raw || '').replace(/[^\d]/g, ''), 10);
      return Number.isFinite(n) && n > 0 ? n : null;
    }

    function buildListingPayload(base, form) {
      if (!base.listing && !base.jobType && !base.listingType) return {};
      const price = parsePriceInput(form.price);
      const beds = form.beds !== '' ? parseFloat(form.beds) : null;
      const baths = form.baths !== '' ? parseFloat(form.baths) : null;
      const sqft = form.sqft !== '' ? parseInt(form.sqft, 10) : null;
      const listing = {
        ...(base.listing || {}),
        source: (base.listing && base.listing.source) || base.sourceChannel || 'chrome_extension',
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

    fill(initial);

    function openPanel() {
      fill(extractLeadFromPage());
      panel.classList.remove('adhello-panel--hidden');
      fab.classList.add('adhello-fab--hidden');
      if (!fields.title.value.trim()) {
        toast('Select a business on the map to auto-fill, or enter details manually.');
      }
    }

    function closePanel() {
      panel.classList.add('adhello-panel--hidden');
      fab.classList.remove('adhello-fab--hidden');
    }

    function setSaving(isSaving) {
      saveBtns.forEach((btn) => {
        btn.disabled = isSaving;
        btn.textContent = isSaving ? 'Saving…' : 'Save lead';
      });
    }

    async function handleSave() {
      const title = fields.title.value.trim();
      if (!title) {
        toast('Title is required', 'error');
        fields.title.focus();
        return;
      }

      const base = extractLeadFromPage();
      const settingsRes = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      const defaultFolderName = String(settingsRes?.settings?.defaultFolderName || '').trim();
      const lead = enrichPayloadGeo({
        ...base,
        ...buildListingPayload(base, {
          price: fields.price.value,
          beds: fields.beds.value,
          baths: fields.baths.value,
          sqft: fields.sqft.value,
        }),
        title,
        note: fields.note.value.trim(),
        address: fields.address.value.trim() || 'N/A',
        city: fields.city.value.trim(),
        state: fields.state.value.trim(),
        zip: base?.zip || base?.postalCode || '',
        postalCode: base?.postalCode || base?.zip || '',
        website: fields.website.value.trim() || 'N/A',
        email: fields.email.value.trim() || 'N/A',
        phone: fields.phone.value.trim() || 'N/A',
        facebook: fields.facebook?.value?.trim() || base?.facebook || 'N/A',
        instagram: fields.instagram?.value?.trim() || base?.instagram || 'N/A',
        twitter: fields.twitter?.value?.trim() || base?.twitter || 'N/A',
        linkedin: fields.linkedin?.value?.trim() || base?.linkedin || 'N/A',
        tiktok: fields.tiktok?.value?.trim() || base?.tiktok || 'N/A',
        url: base?.url || '',
        source: 'chrome_extension',
        sourceChannel: String(fields.sourceChannel?.value || base.sourceChannel || '').trim(),
      });
      if (defaultFolderName) lead.folderName = defaultFolderName;
      if (lastLoyaltyResult) {
        lead.loyaltyProgram = lastLoyaltyResult.found ? 'yes' : 'no';
        lead.hasLoyaltyProgram = !!lastLoyaltyResult.found;
        lead.loyaltyProgramEvidence = String(lastLoyaltyResult.evidence || '').slice(0, 500);
        lead.loyaltyProgramUrl = String(lastLoyaltyResult.url || '').slice(0, 2000);
        lead.loyaltyProgramCheckedAt = new Date().toISOString();
      }

      setSaving(true);

      try {
        const res = await saveLead(lead);
        if (!res?.ok) throw new Error(res?.error || 'Save failed');
        const mergeMsg =
          res.data?.merged && res.data?.folderApplied === false
            ? 'Lead updated (kept in current folder)'
            : res.data?.merged
              ? 'Lead updated'
              : 'Lead saved to AdHello';
        toast(mergeMsg, 'success');
        closePanel();
      } catch (err) {
        toast(err.message || 'Save failed', 'error');
      } finally {
        setSaving(false);
      }
    }

    fab.addEventListener('click', openPanel);
    closeBtn.addEventListener('click', closePanel);
    cancelBtn.addEventListener('click', closePanel);
    saveBtns.forEach((btn) => btn.addEventListener('click', handleSave));

    function setLoyaltyStatus(msg) {
      if (loyaltyStatusEl) loyaltyStatusEl.textContent = msg || '';
    }

    loyaltyBtn?.addEventListener('click', async () => {
      if (!loyaltyBtn) return;
      loyaltyBtn.disabled = true;
      loyaltyBtn.textContent = 'Scanning…';
      setLoyaltyStatus('Scanning this site…');
      try {
        const res = await chrome.runtime.sendMessage({ type: 'FIND_LOYALTY_PROGRAM' });
        if (!res?.ok) throw new Error(res?.error || 'Scan failed');
        lastLoyaltyResult = res.data || { found: false, evidence: '', url: window.location.href };
        if (lastLoyaltyResult.found) {
          const extra = lastLoyaltyResult.evidence || lastLoyaltyResult.url || '';
          setLoyaltyStatus(extra ? `Found — ${extra}` : 'Found');
        } else {
          setLoyaltyStatus('Not found — no on-site loyalty program');
        }
        const title = fields.title.value.trim();
        if (!title) {
          toast('Enter a title, then Save to mark this lead.', 'error');
          return;
        }
        await handleSave();
      } catch (err) {
        lastLoyaltyResult = null;
        setLoyaltyStatus(err.message || 'Scan failed');
        toast(err.message || 'Scan failed', 'error');
      } finally {
        loyaltyBtn.disabled = false;
        loyaltyBtn.textContent = 'Find loyalty rewards';
      }
    });

    document.documentElement.appendChild(root);
    applyContentTheme(root);
  }

  function isFabEnabled(value) {
    return value !== false;
  }

  function removeFab() {
    try {
      const existing = document.getElementById(ROOT_ID);
      if (existing) existing.remove();
    } catch (_) {
      /* ignore */
    }
  }

  async function syncFabVisibility(explicitValue) {
    let enabled = true;
    if (explicitValue !== undefined) {
      enabled = isFabEnabled(explicitValue);
    } else {
      try {
        const stored = await chrome.storage.sync.get({ showSaveLeadFab: true });
        enabled = isFabEnabled(stored.showSaveLeadFab);
      } catch (_) {
        enabled = true;
      }
    }
    if (enabled) {
      if (!document.getElementById(ROOT_ID)) {
        buildPanel(extractLeadFromPage());
      }
      return;
    }
    removeFab();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes.showSaveLeadFab) return;
    syncFabVisibility(changes.showSaveLeadFab.newValue);
  });

  syncFabVisibility();
})();
