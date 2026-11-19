(function () {
  var modal = document.getElementById('instantlyExportModal');
  if (!modal) return;
  var loadingEl = document.getElementById('instantlyExportLoading');
  var formEl = document.getElementById('instantlyExportForm');
  var selectEl = document.getElementById('instantlyDestination');
  var errorEl = document.getElementById('instantlyExportError');
  var submitBtn = document.getElementById('instantlyExportSubmit');
  var pendingKeys = [];

  function selectedKeys() {
    if (typeof window.__getSelectedLeadKeysForBulk === 'function') {
      var keys = window.__getSelectedLeadKeysForBulk() || [];
      return keys.map(function (key) { return String(key || '').trim(); }).filter(Boolean);
    }
    var found = [];
    document.querySelectorAll('.result-row input[type="checkbox"]:checked, .lead-select:checked').forEach(function (box) {
      var row = box.closest('tr') || box.closest('[data-lead-key]');
      var key = (row && row.getAttribute('data-lead-key')) || box.value || '';
      key = String(key || '').trim();
      if (key && found.indexOf(key) === -1) found.push(key);
    });
    return found;
  }

  function feedback(message, ok) {
    var el = document.getElementById('bulkSaveFeedback');
    if (!el) return;
    el.textContent = message;
    el.classList.remove('hidden', 'text-emerald-300', 'text-rose-300', 'text-white/80');
    el.classList.add(ok ? 'text-emerald-300' : 'text-rose-300');
  }

  function showError(message) {
    if (!errorEl) return;
    errorEl.textContent = message || '';
    errorEl.classList.toggle('hidden', !message);
  }

  function closeModal() {
    modal.classList.add('hidden');
    pendingKeys = [];
    if (submitBtn) submitBtn.disabled = false;
  }

  function openModal() {
    modal.classList.remove('hidden');
  }

  function option(value, label) {
    var node = document.createElement('option');
    node.value = value;
    node.textContent = label;
    return node;
  }

  function fillDestinations(data) {
    selectEl.innerHTML = '';
    var campaigns = (data && data.campaigns) || [];
    var lists = (data && data.lists) || [];
    if (!campaigns.length && !lists.length) {
      selectEl.appendChild(option('', 'No campaigns or lists yet'));
      if (submitBtn) submitBtn.disabled = true;
      return;
    }
    if (campaigns.length) {
      var campaignGroup = document.createElement('optgroup');
      campaignGroup.label = 'Campaigns';
      campaigns.forEach(function (row) {
        var status = row.status ? ' · ' + row.status : '';
        campaignGroup.appendChild(option('campaign:' + row.id, row.name + status));
      });
      selectEl.appendChild(campaignGroup);
    }
    if (lists.length) {
      var listGroup = document.createElement('optgroup');
      listGroup.label = 'Lists';
      lists.forEach(function (row) {
        listGroup.appendChild(option('list:' + row.id, row.name));
      });
      selectEl.appendChild(listGroup);
    }
    if (submitBtn) submitBtn.disabled = false;
  }

  function loadDestinations() {
    loadingEl.classList.remove('hidden');
    loadingEl.textContent = 'Loading campaigns…';
    formEl.classList.add('hidden');
    showError('');
    fetch('/leads/instantly/destinations', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, data: data || {} }; });
      })
      .then(function (result) {
        loadingEl.classList.add('hidden');
        if (!result.ok || !result.data.success) {
          loadingEl.classList.remove('hidden');
          loadingEl.textContent = (result.data && result.data.error) || 'Could not reach Instantly.';
          return;
        }
        if (!result.data.configured) {
          loadingEl.classList.remove('hidden');
          loadingEl.innerHTML = 'Add an Instantly API key under <a class="underline text-sky-300" href="/workspace/integrations#instantly-integration">Workspace → Integrations</a>.';
          return;
        }
        formEl.classList.remove('hidden');
        fillDestinations(result.data);
      })
      .catch(function () {
        loadingEl.classList.remove('hidden');
        loadingEl.textContent = 'Could not reach Instantly.';
      });
  }

  document.addEventListener('click', function (event) {
    var openBtn = event.target.closest('.js-bulk-instantly');
    if (openBtn) {
      event.preventDefault();
      pendingKeys = selectedKeys();
      if (!pendingKeys.length) {
        feedback('Select at least one lead.', false);
        return;
      }
      openModal();
      loadDestinations();
      return;
    }
    if (event.target.closest('.js-instantly-close') || event.target === modal) closeModal();
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !modal.classList.contains('hidden')) closeModal();
  });

  if (submitBtn) {
    submitBtn.addEventListener('click', function () {
      var value = selectEl ? String(selectEl.value || '') : '';
      var splitAt = value.indexOf(':');
      var kind = splitAt > 0 ? value.slice(0, splitAt) : '';
      var id = splitAt > 0 ? value.slice(splitAt + 1) : '';
      if ((kind !== 'campaign' && kind !== 'list') || !id) {
        showError('Choose a campaign or list.');
        return;
      }
      showError('');
      submitBtn.disabled = true;
      var body = { leadKeys: pendingKeys };
      if (kind === 'campaign') body.campaignId = id;
      else body.listId = id;
      fetch('/leads/instantly/export', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      })
        .then(function (res) {
          return res.json().then(function (data) { return { ok: res.ok, data: data || {} }; }).catch(function () {
            return { ok: false, data: {} };
          });
        })
        .then(function (result) {
          submitBtn.disabled = false;
          if (!result.ok || !result.data.success) {
            showError((result.data && result.data.error) || 'Instantly export failed.');
            return;
          }
          var uploaded = Number(result.data.uploaded) || 0;
          var skipped = Number(result.data.skippedNoEmail) || 0;
          var dupes = Number(result.data.duplicated) || 0;
          var msg = 'Sent ' + uploaded + ' to Instantly';
          if (dupes) msg += ' · ' + dupes + ' already there';
          if (skipped) msg += ' · ' + skipped + ' skipped (no email)';
          feedback(msg, true);
          closeModal();
        })
        .catch(function () {
          submitBtn.disabled = false;
          showError('Instantly export failed.');
        });
    });
  }
})();
