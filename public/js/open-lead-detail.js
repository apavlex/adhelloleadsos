/**
 * Lightweight lead-detail opener for Today / Opportunities / Referral pages.
 * Registers immediately so opportunity cards work even if app.js init is slow or errors mid-way.
 * app.js may overwrite this with the full selectRow-based implementation later.
 */
(function (global) {
  function reportError(message) {
    var text = String(message || 'Could not open that company.');
    var msg = document.getElementById('oppBoardMsg');
    if (msg) {
      msg.textContent = text;
      msg.classList.remove('hidden', 'is-ok');
    }
    if (typeof global.showProspectToast === 'function') {
      try {
        global.showProspectToast(text);
      } catch (_) {}
    }
    console.warn('[openLeadDetailFromKey]', text);
  }

  function openPanelShell() {
    var panel = document.getElementById('mobilePanel');
    if (!panel) return null;
    panel.classList.remove('hidden');
    panel.classList.add('open');
    panel.classList.remove('opacity-0');
    panel.classList.add('opacity-100');
    panel.style.setProperty('display', 'flex', 'important');
    panel.style.setProperty('opacity', '1', 'important');
    panel.style.setProperty('pointer-events', 'auto', 'important');
    panel.style.setProperty('visibility', 'visible', 'important');
    panel.style.setProperty('z-index', '400', 'important');
    document.body.style.overflow = 'hidden';
    var inner = panel.querySelector(':scope > div');
    if (inner) {
      inner.classList.remove('translate-y-full', 'translate-x-full');
      inner.style.display = 'flex';
    }
    return panel;
  }

  function applyLeadToHost(host, lead) {
    if (!host || !lead) return;
    var ds = host.dataset;
    function str(v, fb) {
      if (v != null && v !== undefined && String(v) !== 'undefined') return String(v);
      return fb != null ? fb : '';
    }
    ds.leadKey = str(lead.key);
    ds.title = str(lead.title);
    ds.phone = str(lead.phone, 'N/A');
    ds.email = str(lead.email, 'N/A');
    ds.website = str(lead.website, 'N/A');
    var cat = lead.categoryName;
    ds.category = cat && cat !== 'N/A' ? str(cat) : str(lead.category, 'N/A');
    ds.address = str(lead.address, 'N/A');
    ds.city = str(lead.city);
    ds.state = str(lead.state);
    ds.url = str(lead.url);
    ds.facebook = str(lead.facebook, 'N/A');
    ds.instagram = str(lead.instagram, 'N/A');
    ds.twitter = str(lead.twitter, 'N/A');
    ds.rating = lead.totalScore != null ? String(lead.totalScore) : '0';
    ds.reviews = lead.reviewsCount != null ? String(lead.reviewsCount) : '0';
    ds.status = str(lead.status, 'Not Contacted');
    ds.source = str(lead.source);
    ds.pipelineStage = lead.pipelineStage != null ? String(lead.pipelineStage) : '';
    ds.stageId = str(lead.stageId);
    ds.pipelineLabel = str(lead.pipelineLabel);
    ds.onPipelineBoard = lead.onPipelineBoard ? '1' : '';
    try {
      ds.tags = JSON.stringify(Array.isArray(lead.tags) ? lead.tags : []);
    } catch (_) {
      ds.tags = '[]';
    }
    ds.estimatedValue = lead.estimatedValue != null ? String(lead.estimatedValue) : '';
    if (lead.placeId) ds.placeId = str(lead.placeId);
    if (lead.lat != null) ds.lat = String(lead.lat);
    if (lead.lng != null) ds.lng = String(lead.lng);
  }

  function paintHost(host, lead) {
    if (typeof global.__applyLeadObjectToPanelHost === 'function') {
      try {
        global.__applyLeadObjectToPanelHost(host, lead);
        return;
      } catch (_) {}
    }
    applyLeadToHost(host, lead);
  }

  function populateWhenReady(host, lead, attempts) {
    if (typeof global.__populateLeadPanel === 'function') {
      try {
        global.__populateLeadPanel(host);
        return;
      } catch (err) {
        console.warn('[openLeadDetailFromKey] populate failed:', err);
      }
    }
    if (typeof global.__paintPanelFromLeadRecord === 'function') {
      try {
        global.__paintPanelFromLeadRecord(lead, host);
      } catch (_) {}
    }
    if (attempts < 60) {
      setTimeout(function () {
        populateWhenReady(host, lead, attempts + 1);
      }, 50);
    }
  }

  async function openLeadDetailFromKey(rawKey) {
    var k = String(rawKey || '')
      .replace(/^lead:/i, '')
      .trim();
    if (!k) {
      reportError('Could not open that company.');
      return { ok: false };
    }

    var host = document.getElementById('leadPanelDatasetHost');
    var panel = document.getElementById('mobilePanel');
    if (!host || !panel) {
      reportError('Company profile panel is missing on this page. Refresh and try again.');
      return { ok: false };
    }

    openPanelShell();

    try {
      var res = await fetch('/leads/' + encodeURIComponent(k) + '/panel-data', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data.success || !data.lead) {
        reportError((data && data.error) || 'Could not load that company.');
        return { ok: false };
      }

      paintHost(host, data.lead);
      host.classList.add('selected');

      // Prefer full app.js path once ready
      if (typeof global.__selectLeadPanelRow === 'function') {
        try {
          await global.__selectLeadPanelRow(host);
          return { ok: true };
        } catch (err) {
          console.warn('[openLeadDetailFromKey] selectRow failed, using fallback paint:', err);
        }
      }

      populateWhenReady(host, data.lead, 0);
      return { ok: true };
    } catch (err) {
      reportError((err && err.message) || 'Could not open that company.');
      return { ok: false };
    }
  }

  // Always install as the immediate opener; app.js may replace with the full selectRow path.
  global.openLeadDetailFromKey = openLeadDetailFromKey;
  global.__adhelloOpenLeadDetailFromKeyLite = openLeadDetailFromKey;
})(window);
