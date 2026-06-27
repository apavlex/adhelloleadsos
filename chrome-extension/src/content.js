(function () {
  const { extractLeadFromPage, isSupportedPage } = window.AdHelloExtractors;

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
    return chrome.runtime.sendMessage({ type: 'SAVE_LEAD', lead });
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

    const saveTypeEl = root.querySelector('#adhello-save-type');

    const fields = {
      title: root.querySelector('[name="title"]'),
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
    };

    function fill(data) {
      fields.title.value = data.title || '';
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
      const lead = {
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
        website: fields.website.value.trim() || 'N/A',
        email: fields.email.value.trim() || 'N/A',
        phone: fields.phone.value.trim() || 'N/A',
      };

      setSaving(true);

      try {
        const res = await saveLead(lead);
        if (!res?.ok) throw new Error(res?.error || 'Save failed');
        toast('Lead saved to AdHello', 'success');
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

    document.documentElement.appendChild(root);
    applyContentTheme(root);
  }

  buildPanel(extractLeadFromPage());
})();
