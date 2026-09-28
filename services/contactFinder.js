/**
 * "Find a contact" — decision makers, emails, phones and socials for one business.
 * Outscraper Contacts & Leads first (people + company inboxes); Apify Contact Details
 * Scraper crawls the website when Outscraper is missing or comes back empty.
 */

const outscraper = require('./outscraperClient');
const { resolveLeadDomain } = require('./outscraperLeadEnrich');
const { normalizeSocialUrl } = require('./socialUrlNormalize');
const { mergeContactLists } = require('./leadEmailContacts');
const { normalizeEmail } = require('./leadDedupe');

const APIFY_CONTACT_ACTOR_ID = process.env.APIFY_CONTACT_ACTOR_ID || 'vdrmota/contact-info-scraper';
const APIFY_WAIT_SECS = Math.max(30, parseInt(process.env.APIFY_CONTACT_WAIT_SECS || '120', 10) || 120);
const MAX_PEOPLE = 10;
const MAX_CONTACTS = 40;
const SOCIAL_KEYS = ['facebook', 'instagram', 'twitter', 'linkedin', 'tiktok', 'youtube'];
const GENERIC_ROLES = new Set(['', 'email', 'primary', 'contact', 'phone']);

function str(v) {
  const s = String(v == null ? '' : v).trim();
  return s && s !== 'N/A' && s !== '—' ? s : '';
}

function looksLikeEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(str(v)) && !/\.(png|jpe?g|gif|webp|svg)$/i.test(str(v));
}

function valuesFrom(list, keys) {
  if (!list) return [];
  const arr = Array.isArray(list) ? list : [list];
  const out = [];
  arr.forEach((item) => {
    if (!item) return;
    if (typeof item === 'string') {
      if (str(item)) out.push(str(item));
      return;
    }
    for (const k of keys) {
      if (str(item[k])) {
        out.push(str(item[k]));
        return;
      }
    }
  });
  return out;
}

function apifyToken(integrationEnv) {
  const fromWs = integrationEnv && integrationEnv.APIFY_API_TOKEN;
  if (typeof fromWs === 'string' && fromWs.trim()) return fromWs.trim();
  return (process.env.APIFY_API_TOKEN || '').trim();
}

function finderConfigured(integrationEnv) {
  return {
    outscraper: outscraper.isConfigured(integrationEnv),
    apify: !!apifyToken(integrationEnv),
  };
}

function emptyResult(domain) {
  return { domain, people: [], emails: [], phones: [], socials: {}, sources: [], errors: [] };
}

function addEmail(result, raw) {
  const email = normalizeEmail(raw);
  if (email && looksLikeEmail(email) && !result.emails.includes(email)) result.emails.push(email);
}

function addPhone(result, raw) {
  const phone = str(raw);
  if (phone && phone.replace(/\D/g, '').length >= 7 && !result.phones.includes(phone)) result.phones.push(phone);
}

function setSocial(result, key, raw) {
  if (result.socials[key]) return;
  const url = key === 'youtube' ? str(raw) : normalizeSocialUrl(str(raw), key);
  if (url && /^https?:\/\//i.test(url)) result.socials[key] = url;
}

function addPerson(result, person) {
  const name = str(person.name);
  const email = normalizeEmail(person.email);
  if (!name && !email) return;
  const dup = result.people.find(
    (p) => (email && p.email === email) || (name && p.name.toLowerCase() === name.toLowerCase()),
  );
  if (dup) {
    ['title', 'email', 'phone', 'linkedin'].forEach((k) => {
      if (!dup[k] && person[k]) dup[k] = k === 'email' ? email : str(person[k]);
    });
    return;
  }
  if (result.people.length >= MAX_PEOPLE) return;
  result.people.push({
    name,
    title: str(person.title),
    email: looksLikeEmail(email) ? email : '',
    phone: str(person.phone),
    linkedin: str(person.linkedin),
    source: person.source || '',
  });
}

/** Map one Outscraper contacts-and-leads row into the finder result. */
function collectFromOutscraperRow(result, row) {
  if (!row || typeof row !== 'object') return;
  const contacts = Array.isArray(row.contacts) ? row.contacts : [];
  contacts.forEach((c) => {
    if (!c || typeof c !== 'object') return;
    const name =
      str(c.full_name || c.fullName || c.name) || [str(c.first_name), str(c.last_name)].filter(Boolean).join(' ');
    const emails = valuesFrom(c.emails || c.email, ['value', 'email']);
    const phones = valuesFrom(c.phones || c.phone, ['value', 'phone']);
    const socials = c.socials && typeof c.socials === 'object' ? c.socials : {};
    addPerson(result, {
      name,
      title: c.title || c.position || c.job_title || c.level,
      email: emails[0],
      phone: phones[0],
      linkedin: c.linkedin || c.linkedin_url || socials.linkedin,
      source: 'Outscraper',
    });
    emails.forEach((e) => addEmail(result, e));
  });

  (Array.isArray(row.emails) ? row.emails : []).forEach((item) => {
    const email = typeof item === 'string' ? item : item && (item.value || item.email);
    addEmail(result, email);
    if (item && typeof item === 'object' && str(item.full_name || item.name)) {
      addPerson(result, {
        name: item.full_name || item.name,
        title: item.title,
        email,
        source: 'Outscraper',
      });
    }
  });
  valuesFrom(row.phones, ['value', 'phone']).forEach((p) => addPhone(result, p));
  const socials = row.socials && typeof row.socials === 'object' ? row.socials : {};
  SOCIAL_KEYS.forEach((k) => setSocial(result, k, socials[k]));
}

/** Aggregate Apify Contact Details Scraper items (one per crawled page). */
function collectFromApifyItems(result, items) {
  (Array.isArray(items) ? items : []).forEach((item) => {
    if (!item || typeof item !== 'object') return;
    (item.emails || []).forEach((e) => addEmail(result, e));
    (item.phones || []).forEach((p) => addPhone(result, p));
    setSocial(result, 'facebook', (item.facebooks || [])[0]);
    setSocial(result, 'instagram', (item.instagrams || [])[0]);
    setSocial(result, 'twitter', (item.twitters || [])[0]);
    setSocial(result, 'tiktok', (item.tiktoks || [])[0]);
    setSocial(result, 'youtube', (item.youtubes || [])[0]);
    const linkedIns = item.linkedIns || item.linkedins || [];
    linkedIns.forEach((url) => {
      if (/linkedin\.com\/company\//i.test(url)) setSocial(result, 'linkedin', url);
    });
  });
}

async function runApifyContactScraper(website, integrationEnv) {
  const { ApifyClient } = require('apify-client');
  const client = new ApifyClient({ token: apifyToken(integrationEnv) });
  const url = /^https?:\/\//i.test(website) ? website : `https://${website}`;
  const run = await client.actor(APIFY_CONTACT_ACTOR_ID).call(
    {
      startUrls: [{ url }],
      maxRequestsPerStartUrl: 12,
      maxDepth: 2,
      sameDomain: true,
      considerChildFrames: false,
    },
    { waitSecs: APIFY_WAIT_SECS, memory: 1024 },
  );
  if (!run || !run.defaultDatasetId) return [];
  const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit: 50 });
  return items || [];
}

/**
 * @param {object} lead
 * @param {Record<string, string>|null} integrationEnv
 * @param {{ deps?: { fetchContactsAndLeads?: Function, runApify?: Function } }} [opts]
 */
/** Listing / directory / social hosts — searching these by domain returns the platform's staff, not the business. */
const DIRECTORY_HOSTS = [
  'procore.com', 'yelp.com', 'yellowpages.com', 'bbb.org', 'houzz.com', 'angi.com', 'angieslist.com',
  'homeadvisor.com', 'thumbtack.com', 'porch.com', 'buildzoom.com', 'manta.com', 'superpages.com',
  'nextdoor.com', 'mapquest.com', 'facebook.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'x.com',
  'tiktok.com', 'youtube.com', 'google.com', 'g.page', 'goo.gl', 'business.site', 'linktr.ee',
  'zillow.com', 'realtor.com', 'trulia.com', 'redfin.com', 'loopnet.com', 'craigslist.org',
];

function directoryHost(domain) {
  const d = String(domain || '').toLowerCase();
  return DIRECTORY_HOSTS.find((h) => d === h || d.endsWith(`.${h}`)) || '';
}

async function findContactsForLead(lead, integrationEnv, opts = {}) {
  const deps = opts.deps || {};
  const domain = resolveLeadDomain(lead);
  const result = emptyResult(domain);
  if (!domain) {
    const err = new Error('Add a website to this lead first — contacts are looked up by domain.');
    err.code = 'no_website';
    throw err;
  }
  const listing = directoryHost(domain);
  if (listing) {
    const err = new Error(
      `This lead's website is a ${listing} listing, not the company's own site — add the company website to find contacts.`,
    );
    err.code = 'no_website';
    throw err;
  }
  const cfg = finderConfigured(integrationEnv);
  if (!cfg.outscraper && !cfg.apify) {
    const err = new Error('Connect Outscraper or Apify under Workspace → Integrations to find contacts.');
    err.code = 'not_configured';
    throw err;
  }

  if (cfg.outscraper) {
    try {
      const fetchRow = deps.fetchContactsAndLeads || outscraper.fetchContactsAndLeads;
      const row = await fetchRow({ query: domain, integrationEnv, contactsPerCompany: 5, emailsPerContact: 2 });
      collectFromOutscraperRow(result, row);
      result.sources.push('Outscraper');
    } catch (e) {
      result.errors.push(`Outscraper: ${e.message}`);
    }
  }

  const outscraperEmpty = !result.people.length && !result.emails.length;
  if (cfg.apify && outscraperEmpty) {
    try {
      const runApify = deps.runApify || runApifyContactScraper;
      const items = await runApify(lead.website || domain, integrationEnv);
      collectFromApifyItems(result, items);
      result.sources.push('Apify');
    } catch (e) {
      result.errors.push(`Apify: ${e.message}`);
    }
  }

  return result;
}

/** People already on the lead (named contacts, or the legacy decisionMaker fields). */
function leadPeople(lead) {
  const contacts = Array.isArray(lead && lead.contacts) ? lead.contacts : [];
  const people = contacts
    .filter((c) => c && str(c.name) && !c.primary)
    .map((c) => ({
      name: str(c.name),
      title: GENERIC_ROLES.has(str(c.role).toLowerCase()) ? '' : str(c.role),
      email: str(c.email),
      phone: str(c.phone),
      linkedin: str(c.linkedin),
    }));
  const dm = str(lead && lead.decisionMakerName);
  if (dm && !people.some((p) => p.name.toLowerCase() === dm.toLowerCase())) {
    people.unshift({ name: dm, title: str(lead.decisionMakerTitle), email: '', phone: '', linkedin: '' });
  }
  return people;
}

/**
 * Turn a finder result into a lead update. Only fills blank fields; appends new contacts.
 * @param {object} lead
 * @param {ReturnType<typeof emptyResult>} result
 * @param {(email: string) => boolean} [isValidEmail]
 */
function buildLeadPatchFromFinder(lead, result, isValidEmail) {
  const ok = (e) => looksLikeEmail(e) && (!isValidEmail || isValidEmail(e));
  const patch = {};
  const filled = [];
  const incoming = [];

  result.people.forEach((p) => {
    incoming.push({
      role: p.title || 'Contact',
      name: p.name,
      phone: p.phone || '',
      email: ok(p.email) ? p.email : '',
      primary: false,
      ...(p.linkedin ? { linkedin: p.linkedin } : {}),
      ...(p.source ? { source: p.source } : {}),
    });
  });

  const companyEmails = result.emails.filter(ok);
  const personEmails = new Set(result.people.map((p) => p.email).filter(Boolean));
  const mainEmail = normalizeEmail(lead.email);
  if (!str(lead.email)) {
    const pick = companyEmails.find((e) => !personEmails.has(e)) || companyEmails[0];
    if (pick) {
      patch.email = pick;
      filled.push('email');
    }
  }
  const primaryEmail = patch.email || mainEmail;
  companyEmails.forEach((email) => {
    if (email === primaryEmail || personEmails.has(email)) return;
    incoming.push({ role: 'Email', name: '', phone: '', email, primary: false });
  });

  const existing = Array.isArray(lead.contacts) ? lead.contacts : [];
  const merged = mergeContactLists(existing, incoming).slice(0, Math.max(MAX_CONTACTS, existing.length));
  if (merged.length !== existing.length) {
    patch.contacts = merged;
    filled.push('contacts');
  }

  if (!str(lead.phone) && result.phones[0]) {
    patch.phone = result.phones[0];
    filled.push('phone');
  }
  ['facebook', 'instagram', 'twitter', 'linkedin', 'tiktok'].forEach((k) => {
    if (!str(lead[k]) && result.socials[k]) {
      patch[k] = result.socials[k];
      filled.push(k);
    }
  });
  const top = result.people.find((p) => p.name);
  if (!str(lead.decisionMakerName) && top) {
    patch.decisionMakerName = top.name;
    if (top.title && !str(lead.decisionMakerTitle)) patch.decisionMakerTitle = top.title;
  }

  const found = result.people.length + companyEmails.length + result.phones.length + Object.keys(result.socials).length;
  patch.contactFinder = {
    at: new Date().toISOString(),
    status: found ? 'found' : result.sources.length ? 'none' : 'error',
    people: result.people.length,
    emails: companyEmails.length,
    phones: result.phones.length,
    socials: Object.keys(result.socials),
    sources: result.sources,
    error: result.sources.length ? '' : result.errors.join(' · ').slice(0, 300),
  };
  return { patch, filled };
}

/** Outscraper contacts row → contacts[] entries for the Enrich leads pipeline. */
function contactsPatchFromOutscraperRow(lead, row, isValidEmail) {
  const result = emptyResult(resolveLeadDomain(lead));
  collectFromOutscraperRow(result, row);
  result.sources.push('Outscraper');
  const { patch } = buildLeadPatchFromFinder(lead, result, isValidEmail);
  return patch.contacts ? { contacts: patch.contacts } : {};
}

module.exports = {
  findContactsForLead,
  buildLeadPatchFromFinder,
  contactsPatchFromOutscraperRow,
  collectFromOutscraperRow,
  collectFromApifyItems,
  finderConfigured,
  leadPeople,
  emptyResult,
};
