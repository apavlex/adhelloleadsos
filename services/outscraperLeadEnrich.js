/**
 * Outscraper Leads & Contacts enrichment — domain contacts, socials, decision makers.
 * Complements outscraperGmbEnrich (Google Business Profile).
 */

const outscraper = require('./outscraperClient');
const { normalizeSocialUrl } = require('./socialUrlNormalize');

function hasValue(v) {
  const s = String(v == null ? '' : v).trim();
  return s && s !== 'N/A' && s !== '—';
}

function resolveLeadDomain(lead) {
  const raw = String((lead && lead.website) || '').trim();
  if (!hasValue(raw)) return '';
  try {
    const u = raw.startsWith('http') ? raw : `https://${raw}`;
    return new URL(u).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

function firstEmailFromList(list) {
  if (!Array.isArray(list)) return '';
  for (const item of list) {
    if (!item) continue;
    if (typeof item === 'string' && hasValue(item)) return String(item).trim();
    const v = item.value || item.email;
    if (hasValue(v)) return String(v).trim();
  }
  return '';
}

function firstPhoneFromList(list) {
  if (!Array.isArray(list)) return '';
  for (const item of list) {
    if (!item) continue;
    if (typeof item === 'string' && hasValue(item)) return String(item).trim();
    const v = item.value || item.phone;
    if (hasValue(v)) return String(v).trim();
  }
  return '';
}

function pickDecisionMaker(contacts) {
  if (!Array.isArray(contacts)) return null;
  for (const c of contacts) {
    if (!c || typeof c !== 'object') continue;
    const name = String(c.full_name || c.fullName || c.name || '').trim();
    const email = firstEmailFromList(c.emails);
    const title = String(c.title || '').trim();
    if (name || email) return { name, email, title };
  }
  return null;
}

/**
 * Map Outscraper contacts-and-leads row to Firecrawl-style extract + lead patch.
 * @param {object|null} row
 * @param {object} lead
 */
function buildEnrichmentFromContactsRow(row, lead) {
  const extract = {};
  const patch = {};
  if (!row || typeof row !== 'object') {
    return { extract, patch, used: false };
  }

  const setExtract = (k, v) => {
    if (!hasValue(v)) return;
    extract[k] = v;
  };

  const email =
    firstEmailFromList(row.emails) ||
    firstEmailFromList(
      Array.isArray(row.contacts)
        ? row.contacts.flatMap((c) => (c && c.emails) || [])
        : [],
    );
  const phone = firstPhoneFromList(row.phones);
  const socials = row.socials && typeof row.socials === 'object' ? row.socials : {};
  const details = row.details && typeof row.details === 'object' ? row.details : {};
  const dm = pickDecisionMaker(row.contacts);

  setExtract('email', email);
  setExtract('phone', phone);
  setExtract('facebook', normalizeSocialUrl(socials.facebook, 'facebook'));
  setExtract('instagram', normalizeSocialUrl(socials.instagram, 'instagram'));
  setExtract('twitter', normalizeSocialUrl(socials.twitter, 'twitter'));
  setExtract('linkedin', normalizeSocialUrl(socials.linkedin, 'linkedin'));
  if (dm && dm.name) setExtract('decision_maker_name', dm.name);
  if (dm && dm.title) setExtract('decision_maker_title', dm.title);
  if (dm && dm.email && !extract.email) setExtract('email', dm.email);

  const domain = String(row.domain || row.query || '').trim();
  if (domain && !hasValue(lead.website)) {
    patch.website = domain.startsWith('http') ? domain : `https://${domain}`;
  }

  if (!hasValue(lead.email) && email) patch.email = email;
  if (!hasValue(lead.phone) && phone) patch.phone = phone;
  if (!hasValue(lead.facebook) && extract.facebook) patch.facebook = extract.facebook;
  if (!hasValue(lead.instagram) && extract.instagram) patch.instagram = extract.instagram;
  if (!hasValue(lead.twitter) && extract.twitter) patch.twitter = extract.twitter;
  if (!hasValue(lead.linkedin) && extract.linkedin) patch.linkedin = extract.linkedin;
  if (!lead.decisionMakerName && dm && dm.name) patch.decisionMakerName = dm.name;
  if (!lead.decisionMakerTitle && dm && dm.title) patch.decisionMakerTitle = dm.title;

  if (!hasValue(lead.address) && hasValue(details.address)) patch.address = String(details.address).trim();
  if (!hasValue(lead.city) && hasValue(details.city)) patch.city = String(details.city).trim();
  if (!hasValue(lead.state) && hasValue(details.state)) patch.state = String(details.state).trim();

  const used = Object.keys(extract).length > 0 || Object.keys(patch).length > 0;
  return { extract, patch, used, domain: domain || resolveLeadDomain(lead) };
}

/**
 * @param {object} lead
 * @param {Record<string, string>|null|undefined} integrationEnv
 */
async function enrichLeadFromOutscraperContacts(lead, integrationEnv) {
  if (!outscraper.isConfigured(integrationEnv)) return null;

  const domain = resolveLeadDomain(lead);
  if (!domain) return { used: false, extract: {}, patch: {}, domain: '', error: 'no_domain' };

  try {
    const row = await outscraper.fetchContactsAndLeads({
      query: domain,
      integrationEnv,
    });
    const pack = buildEnrichmentFromContactsRow(row, lead);
    return { ...pack, row, error: null };
  } catch (e) {
    console.warn('[outscraperLeadEnrich] contacts-and-leads failed:', e.message);
    return { used: false, extract: {}, patch: {}, domain, error: e.message || 'contacts_failed' };
  }
}

function leadNeedsOutscraperContacts(lead) {
  if (!lead) return false;
  const missingEmail = !hasValue(lead.email);
  const missingPhone = !hasValue(lead.phone);
  const missingSocial =
    !hasValue(lead.facebook) && !hasValue(lead.instagram) && !hasValue(lead.linkedin);
  const missingDm = !hasValue(lead.decisionMakerName);
  const hasDomain = !!resolveLeadDomain(lead);
  return hasDomain && (missingEmail || missingPhone || missingSocial || missingDm);
}

module.exports = {
  resolveLeadDomain,
  buildEnrichmentFromContactsRow,
  enrichLeadFromOutscraperContacts,
  leadNeedsOutscraperContacts,
  firstEmailFromList,
  firstPhoneFromList,
};
