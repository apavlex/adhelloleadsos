/**
 * Resolve person + company for name-based contact enrichment.
 * Used when the lead website is a listing portal (Zillow, Realtor, etc.)
 * or missing — enrichment must use agent/brokerage name, not the portal domain.
 */

const DIRECTORY_HOSTS = [
  'procore.com',
  'yelp.com',
  'yellowpages.com',
  'bbb.org',
  'houzz.com',
  'angi.com',
  'angieslist.com',
  'homeadvisor.com',
  'thumbtack.com',
  'porch.com',
  'buildzoom.com',
  'manta.com',
  'superpages.com',
  'nextdoor.com',
  'mapquest.com',
  'facebook.com',
  'instagram.com',
  'linkedin.com',
  'twitter.com',
  'x.com',
  'tiktok.com',
  'youtube.com',
  'google.com',
  'g.page',
  'goo.gl',
  'business.site',
  'linktr.ee',
  'zillow.com',
  'realtor.com',
  'trulia.com',
  'redfin.com',
  'homes.com',
  'compass.com',
  'loopnet.com',
  'craigslist.org',
  'apartments.com',
  'apartmentlist.com',
];

function str(v) {
  const s = String(v == null ? '' : v).trim();
  return s && s !== 'N/A' && s !== '—' && s !== '-' ? s : '';
}

function directoryHost(domainOrUrl) {
  let d = String(domainOrUrl || '')
    .trim()
    .toLowerCase();
  if (!d) return '';
  try {
    if (d.includes('/') || d.includes(':')) {
      const u = d.startsWith('http') ? d : `https://${d}`;
      d = new URL(u).hostname;
    }
  } catch {
    /* keep raw */
  }
  d = d.replace(/^www\./i, '');
  return DIRECTORY_HOSTS.find((h) => d === h || d.endsWith(`.${h}`)) || '';
}

function isDirectoryWebsite(website) {
  return !!directoryHost(website);
}

function splitPersonName(raw) {
  const name = str(raw).replace(/\s+/g, ' ');
  if (!name) return { first: '', last: '', full: '' };
  const parts = name.split(' ').filter(Boolean);
  if (parts.length === 1) return { first: parts[0], last: '', full: name };
  return { first: parts[0], last: parts.slice(1).join(' '), full: name };
}

function looksLikePersonName(raw) {
  const name = str(raw);
  if (!name || name.length < 3 || name.length > 80) return false;
  if (/https?:\/\//i.test(name) || /@/.test(name)) return false;
  if (/\d{3,}/.test(name)) return false; // street numbers / zips
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length < 1 || parts.length > 5) return false;
  // Prefer Capitalized words (agent names)
  const capped = parts.filter((p) => /^[A-Z][A-Za-z.'’-]*$/.test(p)).length;
  return capped >= Math.min(1, parts.length);
}

/**
 * Parse "Agent Name - Brokerage" company titles common on Zillow imports.
 * @param {string} title
 * @returns {{ person: string, company: string }}
 */
function splitTitlePersonCompany(title) {
  const t = str(title);
  if (!t) return { person: '', company: '' };
  const m = t.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (!m) return { person: '', company: t };
  const left = m[1].trim();
  const right = m[2].trim();
  if (looksLikePersonName(left) && right.length >= 2) {
    return { person: left, company: right };
  }
  return { person: '', company: t };
}

/**
 * @param {object} lead
 * @returns {{
 *   personName: string,
 *   companyName: string,
 *   firstName: string,
 *   lastName: string,
 *   canEnrichByName: boolean,
 *   listingHost: string,
 * }}
 */
function resolvePersonCompany(lead) {
  const L = lead && typeof lead === 'object' ? lead : {};
  const fromTitle = splitTitlePersonCompany(L.title);
  const contacts = Array.isArray(L.contacts) ? L.contacts : [];
  const contactPerson =
    str(L.contactName) ||
    str(L.decisionMakerName) ||
    str(L.permitOwner) ||
    str(contacts.find((c) => c && str(c.name))?.name) ||
    '';

  let personName = contactPerson || fromTitle.person;
  let companyName =
    str(L.company) ||
    str(L.brokerName) ||
    (L.listing && str(L.listing.brokerName)) ||
    fromTitle.company ||
    '';

  // If we only have a person-shaped title with no brokerage, use that as person.
  if (!personName && looksLikePersonName(L.title) && !fromTitle.person) {
    personName = str(L.title);
  }
  if (!companyName && personName) {
    companyName = fromTitle.company && fromTitle.company !== personName ? fromTitle.company : personName;
  }
  if (!companyName) companyName = str(L.title);

  const parts = splitPersonName(personName);
  const listingHost = directoryHost(L.website || L.url || L.companyDomain || '');
  const canEnrichByName = !!(parts.full && companyName);

  return {
    personName: parts.full,
    companyName: str(companyName),
    firstName: parts.first,
    lastName: parts.last || parts.first || 'Contact',
    canEnrichByName,
    listingHost,
  };
}

module.exports = {
  DIRECTORY_HOSTS,
  directoryHost,
  isDirectoryWebsite,
  splitPersonName,
  splitTitlePersonCompany,
  looksLikePersonName,
  resolvePersonCompany,
};
