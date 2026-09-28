/**
 * "Find a contact" pipeline cell and the lead's full contacts list — shared by EJS templates (server),
 * contact-finder.js, the Company Details panel and Money mode (browser).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AdhelloContactFinderCell = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const GENERIC_ROLES = { '': 1, email: 1, primary: 1, contact: 1, phone: 1 };

  function str(v) {
    const s = String(v == null ? '' : v).trim();
    return s && s !== 'N/A' && s !== '—' ? s : '';
  }

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function parseJson(v, fallback) {
    if (v && typeof v === 'object') return v;
    try {
      const parsed = JSON.parse(v);
      return parsed == null ? fallback : parsed;
    } catch (_) {
      return fallback;
    }
  }

  /** Normalise a saved lead (server) or a row dataset (browser) into the cell model. */
  function buildModel(lead) {
    const L = lead || {};
    const contacts = parseJson(L.contacts, []);
    const list = Array.isArray(contacts) ? contacts : [];
    const people = list
      .filter((c) => c && str(c.name) && !c.primary)
      .map((c) => ({
        name: str(c.name),
        title: GENERIC_ROLES[str(c.role).toLowerCase()] ? '' : str(c.role),
        email: str(c.email),
        phone: str(c.phone),
        linkedin: str(c.linkedin),
      }));
    const dm = str(L.decisionMakerName);
    if (dm && !people.some((p) => p.name.toLowerCase() === dm.toLowerCase())) {
      people.unshift({ name: dm, title: str(L.decisionMakerTitle), email: '', phone: '', linkedin: '' });
    }
    const mainEmail = str(L.email).toLowerCase();
    const peopleEmails = people.map((p) => p.email.toLowerCase()).filter(Boolean);
    const otherEmails = [];
    list.forEach((c) => {
      const e = c && str(c.email).toLowerCase();
      if (!e || e === mainEmail || peopleEmails.includes(e) || otherEmails.includes(e)) return;
      otherEmails.push(e);
    });
    return {
      people,
      otherEmails,
      mainEmail,
      finder: parseJson(L.contactFinder, null),
      hasWebsite: !!str(L.website),
    };
  }

  function initials(name) {
    const parts = String(name || '').split(/\s+/).filter(Boolean);
    return ((parts[0] || '?').charAt(0) + (parts.length > 1 ? parts[parts.length - 1].charAt(0) : '')).toUpperCase();
  }

  function defaultFormatDate(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  const SEARCH_ICON =
    '<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-4.35-4.35M17 10.5a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z"/></svg>';
  const PERSON_ICON =
    '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.5 20.1a7.5 7.5 0 0115 0A17.9 17.9 0 0112 21.75c-2.68 0-5.22-.58-7.5-1.65z"/></svg>';
  const MAIL_ICON =
    '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>';
  const SPINNER =
    '<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-opacity=".25" stroke-width="3"/><path d="M21 12a9 9 0 00-9-9" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>';

  const BOX =
    'lead-find-contact w-full max-w-[14rem] flex items-center gap-2 rounded-xl border px-2 py-1.5 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-brand-yellow/40';
  const BOX_IDLE = `${BOX} border-brand-border/40 dark:border-white/10 bg-white/70 dark:bg-slate-900/40 hover:border-brand-yellow/60 hover:bg-brand-yellow/10`;
  const AVATAR =
    'shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black';
  const LINE1 = 'block truncate text-[11px] font-bold text-brand-dark dark:text-white';
  const LINE2 = 'block truncate text-[10px] font-semibold text-brand-muted dark:text-slate-400';

  function box(cls, attrs, avatarHtml, line1, line2, trailing) {
    return (
      `<button type="button" class="${cls}" ${attrs}>` +
      avatarHtml +
      `<span class="min-w-0 flex-1"><span class="${LINE1}">${line1}</span><span class="${LINE2}">${line2}</span></span>` +
      (trailing || '') +
      '</button>'
    );
  }

  function searchTrail() {
    return `<span class="shrink-0 w-6 h-6 rounded-full border border-brand-border/50 dark:border-white/15 flex items-center justify-center text-brand-dark dark:text-slate-200">${SEARCH_ICON}</span>`;
  }

  /**
   * @param {object} lead saved lead or row dataset
   * @param {{ formatDate?: (iso: string) => string, loading?: boolean }} [opts]
   */
  function renderCell(lead, opts) {
    const o = opts || {};
    const fmt = typeof o.formatDate === 'function' ? o.formatDate : defaultFormatDate;
    const m = buildModel(lead);
    const f = m.finder || {};
    const when = f.at ? fmt(f.at) : '';

    if (o.loading) {
      return box(
        `${BOX} border-brand-yellow/50 bg-brand-yellow/10 cursor-wait`,
        'disabled aria-busy="true"',
        `<span class="${AVATAR} bg-brand-yellow/20 text-brand-dark dark:text-brand-yellow">${SPINNER}</span>`,
        'Searching…',
        'Outscraper / Apify · up to a minute',
      );
    }

    if (m.people.length) {
      const top = m.people[0];
      const more = m.people.length - 1 + m.otherEmails.length;
      const sub = [top.title || top.email || 'Decision maker', more > 0 ? `+${more} more` : ''].filter(Boolean).join(' · ');
      return box(
        `${BOX_IDLE} js-find-contact-open`,
        `aria-haspopup="dialog" title="${esc(`${top.name}${top.title ? ` — ${top.title}` : ''}`)} · click for all contacts"`,
        `<span class="${AVATAR} bg-brand-yellow/25 text-brand-dark dark:text-brand-yellow border border-brand-yellow/40">${esc(initials(top.name))}</span>`,
        esc(top.name),
        esc(sub),
      );
    }

    if (f.status === 'found') {
      const n = m.otherEmails.length + (m.mainEmail ? 1 : 0);
      const line1 = n ? `${n} email${n === 1 ? '' : 's'} found` : 'Contacts found';
      return box(
        `${BOX_IDLE} js-find-contact-open`,
        'aria-haspopup="dialog" title="No named decision maker — click to see what was found"',
        `<span class="${AVATAR} bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-400/30">${MAIL_ICON}</span>`,
        esc(line1),
        'No decision maker listed',
      );
    }

    if (f.status === 'none' || f.status === 'error') {
      return box(
        `${BOX_IDLE} js-find-contact-search`,
        `title="${esc(f.error || 'Nothing found last time — search again')}"`,
        `<span class="${AVATAR} bg-slate-100 dark:bg-slate-800 text-brand-muted dark:text-slate-400">${PERSON_ICON}</span>`,
        f.status === 'error' ? 'Search failed' : 'No contacts found',
        esc(`${when ? `Searched ${when} · ` : ''}Try again`),
        searchTrail(),
      );
    }

    return box(
      `${BOX_IDLE} js-find-contact-search`,
      `title="${m.hasWebsite ? 'Find decision makers, emails & socials (Outscraper / Apify)' : 'Add a website first — contacts are looked up by domain'}"`,
      `<span class="${AVATAR} bg-slate-100 dark:bg-slate-800 text-brand-muted dark:text-slate-400">${PERSON_ICON}</span>`,
      'Find a contact',
      m.hasWebsite ? 'Emails, people &amp; socials' : 'Needs a website',
      searchTrail(),
    );
  }

  /** Every email on the lead (main first), lowercased and de-duplicated. */
  function allEmails(lead) {
    const m = buildModel(lead);
    const out = [];
    [m.mainEmail, ...m.people.map((p) => p.email.toLowerCase()), ...m.otherEmails].forEach((e) => {
      if (e && !out.includes(e)) out.push(e);
    });
    return out;
  }

  const LIST_LINK = 'text-[12px] font-semibold text-brand-dark dark:text-slate-200 hover:text-brand-yellow truncate no-underline';
  const LIST_LABEL = 'text-[9px] font-black uppercase tracking-widest text-brand-muted dark:text-slate-500';

  /**
   * Named contacts + every extra email (not the main one), for the Company Details panel and Money mode.
   * Returns '' when the lead has nothing beyond its main email.
   */
  function renderContactsList(lead) {
    const m = buildModel(lead);
    const mailto = (e) => `<a href="mailto:${esc(e)}" class="${LIST_LINK} block" title="${esc(e)}">${esc(e)}</a>`;
    const peopleHtml = m.people
      .map((p) => {
        const bits = [];
        if (p.email) bits.push(mailto(p.email));
        if (p.phone) {
          bits.push(`<a href="tel:${esc(p.phone)}" class="${LIST_LINK} block tabular-nums">${esc(p.phone)}</a>`);
        }
        if (p.linkedin) {
          bits.push(`<a href="${esc(p.linkedin)}" target="_blank" rel="noopener noreferrer" class="text-[11px] font-semibold text-sky-700 dark:text-sky-300 hover:underline">LinkedIn</a>`);
        }
        return (
          '<li class="lead-contacts-person flex gap-2 min-w-0">' +
          `<span class="shrink-0 w-6 h-6 rounded-full bg-brand-yellow/25 border border-brand-yellow/40 flex items-center justify-center text-[9px] font-black text-brand-dark dark:text-brand-yellow">${esc(initials(p.name))}</span>` +
          '<div class="min-w-0 flex-1">' +
          `<p class="text-[12px] font-bold text-brand-dark dark:text-white truncate">${esc(p.name)}${p.title ? `<span class="font-semibold text-brand-muted dark:text-slate-400"> · ${esc(p.title)}</span>` : ''}</p>` +
          bits.join('') +
          '</div></li>'
        );
      })
      .join('');
    const emailsHtml = m.otherEmails.map((e) => `<li class="lead-contacts-email min-w-0">${mailto(e)}</li>`).join('');
    if (!peopleHtml && !emailsHtml) return '';
    return (
      (peopleHtml ? `<p class="${LIST_LABEL}">Contacts (${m.people.length})</p><ul class="space-y-1.5 mb-1.5">${peopleHtml}</ul>` : '') +
      (emailsHtml ? `<p class="${LIST_LABEL}">Other emails (${m.otherEmails.length})</p><ul class="space-y-0.5">${emailsHtml}</ul>` : '')
    );
  }

  return { buildModel, renderCell, renderContactsList, allEmails, initials, esc };
});
