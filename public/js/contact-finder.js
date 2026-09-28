/**
 * Pipeline "Find a contact" column: per-row search, contacts popover, bulk "Find contacts".
 * Cell markup comes from contact-finder-cell.js (shared with the server template).
 */
(function () {
  'use strict';

  const BULK_MAX = 25;
  const BULK_CONCURRENCY = 2;
  const running = new Set();
  let popover = null;

  function cellApi() {
    return window.AdhelloContactFinderCell;
  }

  function esc(v) {
    return cellApi() ? cellApi().esc(v) : String(v == null ? '' : v);
  }

  function rowFor(el) {
    return el && el.closest ? el.closest('tr.result-row') : null;
  }

  function findCell(row) {
    return row ? row.querySelector('td[data-plc="findContact"]') : null;
  }

  function renderRowCell(row, opts) {
    const cell = findCell(row);
    if (!cell || !cellApi()) return;
    cell.innerHTML = cellApi().renderCell(row.dataset, opts || {});
  }

  function showCellMessage(row, text, tone) {
    const cell = findCell(row);
    if (!cell || !text) return;
    const p = document.createElement('p');
    p.className = `lead-find-contact-msg mt-1 max-w-[14rem] text-[9px] font-bold leading-snug ${
      tone === 'error' ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400'
    }`;
    p.textContent = text;
    cell.appendChild(p);
    setTimeout(() => p.remove(), 7000);
  }

  function setJsonDataset(row, key, value) {
    try {
      row.dataset[key] = JSON.stringify(value == null ? null : value);
    } catch (_) {
      row.dataset[key] = 'null';
    }
  }

  function syncContactsCell(row) {
    const emailRow = row.querySelector('.lead-contact-row-email');
    const model = cellApi() ? cellApi().buildModel(row.dataset) : null;
    if (emailRow && model) {
      const email = model.mainEmail;
      const existing = emailRow.querySelector('a[href^="mailto:"]');
      if (email && !existing) {
        const placeholder = Array.from(emailRow.children).find((el) => el.tagName === 'SPAN' && !el.classList.contains('lead-contact-more-emails'));
        const a = document.createElement('a');
        a.href = `mailto:${email}`;
        a.className = 'text-brand-yellow hover:underline font-bold text-xs truncate block min-w-0';
        a.title = email;
        a.textContent = email;
        a.addEventListener('click', (e) => e.stopPropagation());
        if (placeholder) placeholder.replaceWith(a);
        else emailRow.appendChild(a);
      }
    }
    if (model) {
      const extra = cellApi().allEmails(row.dataset).filter((e) => e !== model.mainEmail);
      row.querySelectorAll('.lead-contact-more-emails').forEach((chip) => {
        chip.textContent = `+${extra.length}`;
        chip.title = extra.join('\n');
        chip.classList.toggle('hidden', !extra.length);
      });
    }
    const slot = row.querySelector('.lead-cell-socials-content');
    const sb = window.AdhelloSocialBrand;
    if (slot && sb && typeof sb.renderLinks === 'function') {
      const gmLink = slot.querySelector('a[href*="google."], a[href*="goo.gl"]');
      slot.innerHTML = sb.renderLinks({
        gm: gmLink ? gmLink.getAttribute('href') : '',
        fb: row.dataset.facebook,
        ig: row.dataset.instagram,
        tt: row.dataset.tiktok,
        tw: row.dataset.twitter,
        li: row.dataset.linkedin,
        gradSuffix: String(row.dataset.leadKey || 'finder').replace(/[^a-z0-9]+/gi, '-'),
      });
    }
  }

  function applyLeadToRow(row, lead) {
    if (!row || !lead) return;
    if (typeof window.__syncPersistedLeadToRowDataset === 'function') {
      window.__syncPersistedLeadToRowDataset(row, lead);
    } else {
      setJsonDataset(row, 'contacts', Array.isArray(lead.contacts) ? lead.contacts : []);
      ['email', 'phone', 'facebook', 'instagram', 'twitter', 'linkedin', 'tiktok'].forEach((k) => {
        if (lead[k]) row.dataset[k] = lead[k];
      });
    }
    setJsonDataset(row, 'contactFinder', lead.contactFinder || null);
    row.dataset.decisionMakerName = lead.decisionMakerName || '';
    row.dataset.decisionMakerTitle = lead.decisionMakerTitle || '';
    if (lead.contactFinder && lead.contactFinder.at) {
      row.dataset.lastEnrichedMs = String(new Date(lead.contactFinder.at).getTime() || 0);
    }
    renderRowCell(row);
    syncContactsCell(row);
    if (lead.phone && typeof window.syncPipelineRowCallButton === 'function') {
      window.syncPipelineRowCallButton(row, lead.phone);
    }
    if (row.classList.contains('selected') && typeof window.populatePanel === 'function') {
      window.populatePanel(row);
    }
  }

  async function searchRow(row, { quiet } = {}) {
    const key = row && row.dataset.leadKey;
    if (!key || running.has(key)) return { ok: false, skipped: true };
    running.add(key);
    closePopover();
    renderRowCell(row, { loading: true });
    try {
      const res = await fetch(`/leads/${encodeURIComponent(key)}/find-contacts`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: '{}',
      });
      const data = await res.json().catch(() => ({}));
      if (data.lead) applyLeadToRow(row, data.lead);
      else renderRowCell(row);
      if (!res.ok || !data.success) {
        if (!quiet) showCellMessage(row, data.error || `Search failed (${res.status})`, 'error');
        return { ok: false, error: data.error, code: data.code };
      }
      if (!quiet) showCellMessage(row, data.message, 'ok');
      return { ok: true, found: data.lead && data.lead.contactFinder && data.lead.contactFinder.status === 'found' };
    } catch (err) {
      renderRowCell(row);
      if (!quiet) showCellMessage(row, err.message || 'Network error', 'error');
      return { ok: false, error: err.message };
    } finally {
      running.delete(key);
    }
  }

  function closePopover() {
    if (!popover) return;
    popover.remove();
    popover = null;
    document.removeEventListener('keydown', onPopoverKey, true);
  }

  function onPopoverKey(e) {
    if (e.key === 'Escape') closePopover();
  }

  function contactLine(label, valueHtml) {
    return `<div class="flex items-center gap-1.5 min-w-0 text-[11px]"><span class="shrink-0 w-12 text-[9px] font-black uppercase tracking-wider text-brand-muted dark:text-slate-500">${label}</span><span class="min-w-0 truncate">${valueHtml}</span></div>`;
  }

  function emailLink(email, mainEmail) {
    const isMain = email.toLowerCase() === mainEmail;
    return (
      `<a href="mailto:${esc(email)}" class="font-bold text-brand-dark dark:text-brand-yellow hover:underline">${esc(email)}</a>` +
      (isMain
        ? ' <span class="ml-1 text-[8px] font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-400">Main</span>'
        : ` <button type="button" class="js-find-contact-make-main ml-1 text-[9px] font-bold text-brand-muted hover:text-brand-dark dark:hover:text-white underline" data-email="${esc(email)}">Make main</button>`)
    );
  }

  function openPopover(row, anchor) {
    closePopover();
    const api = cellApi();
    if (!api) return;
    const m = api.buildModel(row.dataset);
    const title = row.dataset.title || 'this business';
    const f = m.finder || {};
    const peopleHtml = m.people.length
      ? m.people
          .map((p) => {
            const lines = [];
            if (p.email) lines.push(contactLine('Email', emailLink(p.email, m.mainEmail)));
            if (p.phone) lines.push(contactLine('Phone', `<a href="tel:${esc(p.phone)}" class="font-semibold hover:underline">${esc(p.phone)}</a>`));
            if (p.linkedin) {
              lines.push(contactLine('LinkedIn', `<a href="${esc(p.linkedin)}" target="_blank" rel="noopener noreferrer" class="font-semibold text-sky-700 dark:text-sky-300 hover:underline">Profile</a>`));
            }
            return (
              '<li class="flex gap-2.5 py-2 border-b border-brand-border/20 dark:border-white/10 last:border-0">' +
              `<span class="shrink-0 w-8 h-8 rounded-full bg-brand-yellow/25 border border-brand-yellow/40 flex items-center justify-center text-[10px] font-black text-brand-dark dark:text-brand-yellow">${esc(api.initials(p.name))}</span>` +
              '<div class="min-w-0 flex-1 space-y-0.5">' +
              `<p class="text-xs font-bold text-brand-dark dark:text-white truncate">${esc(p.name)}</p>` +
              (p.title ? `<p class="text-[10px] font-semibold text-brand-muted dark:text-slate-400 truncate">${esc(p.title)}</p>` : '') +
              lines.join('') +
              '</div></li>'
            );
          })
          .join('')
      : '<li class="py-2 text-[11px] font-semibold text-brand-muted dark:text-slate-400">No named decision maker was listed for this business.</li>';

    const emails = [m.mainEmail, ...m.otherEmails].filter(Boolean);
    const emailsHtml = emails.length
      ? `<div class="mt-2 pt-2 border-t border-brand-border/30 dark:border-white/10"><p class="text-[9px] font-black uppercase tracking-widest text-brand-muted dark:text-slate-500 mb-1">Company emails (${emails.length})</p><ul class="space-y-1">${emails
          .map((e) => `<li class="text-[11px] truncate">${emailLink(e, m.mainEmail)}</li>`)
          .join('')}</ul></div>`
      : '';
    const when = f.at ? new Date(f.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    const via = f.sources && f.sources.length ? `via ${f.sources.join(' + ')}` : '';

    popover = document.createElement('div');
    popover.className =
      'lead-find-contact-popover fixed z-[80] w-80 max-h-[26rem] overflow-y-auto rounded-2xl border border-brand-border/50 dark:border-white/10 bg-white dark:bg-slate-900 shadow-2xl p-3';
    popover.dataset.leadKey = row.dataset.leadKey || '';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-label', `Contacts at ${title}`);
    popover.innerHTML =
      '<div class="flex items-start justify-between gap-2 mb-1">' +
      `<div class="min-w-0"><p class="text-[9px] font-black uppercase tracking-widest text-brand-muted dark:text-slate-500">Contacts at</p><p class="text-sm font-bold text-brand-dark dark:text-white truncate">${esc(title)}</p></div>` +
      '<button type="button" class="js-find-contact-close shrink-0 w-7 h-7 rounded-lg text-brand-muted hover:bg-brand-cream dark:hover:bg-slate-800" aria-label="Close">×</button>' +
      '</div>' +
      `<ul>${peopleHtml}</ul>` +
      emailsHtml +
      '<div class="mt-3 pt-2 border-t border-brand-border/30 dark:border-white/10 flex items-center justify-between gap-2">' +
      `<span class="text-[9px] font-semibold text-brand-muted dark:text-slate-500 truncate">${esc([when && `Searched ${when}`, via].filter(Boolean).join(' · '))}</span>` +
      '<button type="button" class="js-find-contact-again shrink-0 rounded-full border border-brand-border/50 dark:border-white/15 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-brand-dark dark:text-slate-200 hover:border-brand-yellow/60 hover:bg-brand-yellow/10">Search again</button>' +
      '</div>';
    document.body.appendChild(popover);

    const rect = anchor.getBoundingClientRect();
    const w = popover.offsetWidth;
    const h = popover.offsetHeight;
    let left = Math.min(rect.left, window.innerWidth - w - 12);
    let top = rect.bottom + 6;
    if (top + h > window.innerHeight - 12) top = Math.max(12, rect.top - h - 6);
    popover.style.left = `${Math.max(12, left)}px`;
    popover.style.top = `${top}px`;

    popover.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (e.target.closest('.js-find-contact-close')) return closePopover();
      if (e.target.closest('.js-find-contact-again')) return searchRow(row);
      const makeMain = e.target.closest('.js-find-contact-make-main');
      if (makeMain) {
        makeMain.disabled = true;
        makeMain.textContent = 'Saving…';
        try {
          const email = makeMain.dataset.email;
          const body = { email, keepPreviousEmail: true };
          let saved = null;
          if (typeof window.__postLeadJsonUpdate === 'function') {
            saved = await window.__postLeadJsonUpdate(row, body);
          } else {
            const res = await fetch(`/leads/${encodeURIComponent(row.dataset.leadKey)}/update`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
              credentials: 'same-origin',
              body: JSON.stringify(body),
            });
            if (!res.ok) throw new Error('Save failed');
            saved = await res.json().catch(() => null);
          }
          row.dataset.email = email;
          if (saved && saved.lead && Array.isArray(saved.lead.contacts)) {
            setJsonDataset(row, 'contacts', saved.lead.contacts);
          }
          const link = row.querySelector('.lead-contact-row-email a[href^="mailto:"]');
          if (link) {
            link.href = `mailto:${email}`;
            link.title = email;
            link.textContent = email;
          }
          syncContactsCell(row);
          renderRowCell(row);
          openPopover(row, findCell(row) || anchor);
        } catch (err) {
          makeMain.textContent = err.message || 'Failed';
        }
      }
    });
    document.addEventListener('keydown', onPopoverKey, true);
  }

  function bulkCandidateRows() {
    const checked = Array.from(document.querySelectorAll('#prospectLeadsTable .lead-checkbox:checked'))
      .map(rowFor)
      .filter(Boolean);
    if (checked.length) return { rows: checked, selected: true };
    const api = cellApi();
    const visible = Array.from(document.querySelectorAll('#prospectLeadsTable tbody tr.result-row')).filter((row) => {
      if (row.classList.contains('pipeline-row-page-hidden') || row.offsetParent === null) return false;
      if (!api) return false;
      const m = api.buildModel(row.dataset);
      return m.hasWebsite && !m.finder && !m.people.length;
    });
    return { rows: visible, selected: false };
  }

  async function runBulk(btn) {
    if (btn.dataset.running === '1') return;
    const { rows, selected } = bulkCandidateRows();
    const label = btn.querySelector('.js-find-contacts-bulk-label') || btn;
    const original = label.dataset.original || label.textContent;
    label.dataset.original = original;
    if (!rows.length) {
      label.textContent = selected ? 'Nothing selected' : 'All visible searched';
      setTimeout(() => (label.textContent = original), 2500);
      return;
    }
    const batch = rows.slice(0, BULK_MAX);
    const scope = selected ? 'selected' : 'visible, not yet searched';
    const extra = rows.length > BULK_MAX ? ` (first ${BULK_MAX} of ${rows.length})` : '';
    if (!window.confirm(`Find contacts for ${batch.length} ${scope} lead${batch.length === 1 ? '' : 's'}${extra}?\n\nEach search uses Outscraper / Apify credits.`)) return;

    btn.dataset.running = '1';
    btn.disabled = true;
    let done = 0;
    let found = 0;
    const queue = batch.slice();
    const tick = () => (label.textContent = `Finding… ${done}/${batch.length}`);
    tick();
    const worker = async () => {
      while (queue.length) {
        const row = queue.shift();
        const r = await searchRow(row, { quiet: true });
        done += 1;
        if (r.found) found += 1;
        tick();
      }
    };
    await Promise.all(Array.from({ length: Math.min(BULK_CONCURRENCY, batch.length) }, worker));
    label.textContent = `Found for ${found}/${batch.length}`;
    btn.dataset.running = '';
    btn.disabled = false;
    setTimeout(() => (label.textContent = original), 5000);
  }

  document.addEventListener(
    'click',
    (e) => {
      const target = e.target;
      if (!target || !target.closest) return;
      const search = target.closest('.js-find-contact-search');
      if (search) {
        e.preventDefault();
        e.stopPropagation();
        searchRow(rowFor(search));
        return;
      }
      const open = target.closest('.js-find-contact-open');
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        const row = rowFor(open);
        if (popover && popover.dataset.leadKey === (row && row.dataset.leadKey)) return closePopover();
        openPopover(row, open);
        return;
      }
      const bulk = target.closest('.js-find-contacts-bulk');
      if (bulk) {
        e.preventDefault();
        runBulk(bulk);
        return;
      }
      if (popover && !popover.contains(target)) closePopover();
    },
    true,
  );
  window.addEventListener(
    'scroll',
    (e) => {
      if (popover && e.target instanceof Node && popover.contains(e.target)) return;
      closePopover();
    },
    { passive: true, capture: true },
  );
  window.addEventListener('resize', () => closePopover());

  window.__adhelloFindContactsForRow = searchRow;
  window.__adhelloSyncRowContacts = function syncRowContacts(row) {
    if (!row || !row.dataset) return;
    renderRowCell(row);
    syncContactsCell(row);
  };
})();
