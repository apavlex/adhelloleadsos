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

  function buildPanel(initial) {
    const root = document.createElement('div');
    root.id = ROOT_ID;
    root.innerHTML = `
      <button type="button" class="adhello-fab" title="Save to AdHello">Save lead</button>
      <div class="adhello-panel adhello-panel--hidden" role="dialog" aria-label="Save lead to AdHello">
        <div class="adhello-panel__header">
          <strong>Save to AdHello</strong>
          <button type="button" class="adhello-panel__close" aria-label="Close">×</button>
        </div>
        <label class="adhello-field">
          <span>Name / title</span>
          <input type="text" name="title" required />
        </label>
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
        <div class="adhello-panel__actions">
          <button type="button" class="adhello-btn adhello-btn--ghost adhello-cancel">Cancel</button>
          <button type="button" class="adhello-btn adhello-btn--primary adhello-save">Save lead</button>
        </div>
      </div>
    `;

    const fab = root.querySelector('.adhello-fab');
    const panel = root.querySelector('.adhello-panel');
    const closeBtn = root.querySelector('.adhello-panel__close');
    const cancelBtn = root.querySelector('.adhello-cancel');
    const saveBtn = root.querySelector('.adhello-save');

    const fields = {
      title: root.querySelector('[name="title"]'),
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
      fields.note.value = data.note || '';
      fields.address.value = data.address && data.address !== 'N/A' ? data.address : '';
      fields.city.value = data.city || '';
      fields.state.value = data.state || '';
      fields.website.value = data.website && data.website !== 'N/A' ? data.website : '';
      fields.email.value = data.email && data.email !== 'N/A' ? data.email : '';
      fields.phone.value = data.phone && data.phone !== 'N/A' ? data.phone : '';
    }

    fill(initial);

    function openPanel() {
      fill(extractLeadFromPage());
      panel.classList.remove('adhello-panel--hidden');
    }

    function closePanel() {
      panel.classList.add('adhello-panel--hidden');
    }

    fab.addEventListener('click', openPanel);
    closeBtn.addEventListener('click', closePanel);
    cancelBtn.addEventListener('click', closePanel);

    saveBtn.addEventListener('click', async () => {
      const title = fields.title.value.trim();
      if (!title) {
        toast('Title is required', 'error');
        fields.title.focus();
        return;
      }

      const base = extractLeadFromPage();
      const lead = {
        ...base,
        title,
        note: fields.note.value.trim(),
        address: fields.address.value.trim() || 'N/A',
        city: fields.city.value.trim(),
        state: fields.state.value.trim(),
        website: fields.website.value.trim() || 'N/A',
        email: fields.email.value.trim() || 'N/A',
        phone: fields.phone.value.trim() || 'N/A',
      };

      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';

      try {
        const res = await saveLead(lead);
        if (!res?.ok) throw new Error(res?.error || 'Save failed');
        toast('Lead saved to AdHello', 'success');
        closePanel();
      } catch (err) {
        toast(err.message || 'Save failed', 'error');
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save lead';
      }
    });

    document.documentElement.appendChild(root);
  }

  buildPanel(extractLeadFromPage());
})();
