/**
 * Client website-build URLs on the GHL white-label host (my.adhello.ai),
 * shown in Agency OS and pushed to GHL contacts.
 */

const DEFAULT_CRM_HOST = 'https://my.adhello.ai';

function ghlCrmBaseUrl(raw) {
  const s = String(raw || process.env.GHL_DASHBOARD_URL || DEFAULT_CRM_HOST)
    .trim()
    .replace(/\/$/, '');
  return s || DEFAULT_CRM_HOST;
}

function websiteBuildSlug(title) {
  const s = String(title || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return s || 'site';
}

function websiteBuildPublicUrl(leadOrTitle) {
  if (leadOrTitle && typeof leadOrTitle === 'object') {
    const stored = String(leadOrTitle.websiteBuildUrl || '').trim();
    if (/^https?:\/\//i.test(stored)) return stored;
    return `https://${websiteBuildSlug(leadOrTitle.title || leadOrTitle.company || '')}.my.adhello.ai`;
  }
  return `https://${websiteBuildSlug(leadOrTitle)}.my.adhello.ai`;
}

function ghlWebsitesBuilderUrl({ dashboardUrl, locationId } = {}) {
  const base = ghlCrmBaseUrl(dashboardUrl);
  const loc = String(locationId || '').trim();
  if (loc) {
    return `${base}/v2/location/${encodeURIComponent(loc)}/funnels-websites/websites`;
  }
  return `${base}/v2/location`;
}

function ghlContactCrmUrl({ dashboardUrl, locationId, contactId } = {}) {
  const base = ghlCrmBaseUrl(dashboardUrl);
  const loc = String(locationId || '').trim();
  const id = String(contactId || '').trim();
  if (loc && id) {
    return `${base}/v2/location/${encodeURIComponent(loc)}/contacts/detail/${encodeURIComponent(id)}`;
  }
  return `${base}/`;
}

module.exports = {
  DEFAULT_CRM_HOST,
  ghlCrmBaseUrl,
  websiteBuildSlug,
  websiteBuildPublicUrl,
  ghlWebsitesBuilderUrl,
  ghlContactCrmUrl,
};
