/**
 * Client website-build URLs on the GHL white-label host (my.adhello.io),
 * shown in Agency OS and pushed to GHL contacts.
 */

const DEFAULT_CRM_HOST = 'https://my.adhello.io';
const CRM_PUBLIC_HOST = 'my.adhello.io';

function ghlCrmBaseUrl(raw) {
  let s = String(raw || process.env.GHL_DASHBOARD_URL || DEFAULT_CRM_HOST)
    .trim()
    .replace(/\/$/, '');
  // Historical white-label domain → current .io host.
  s = s.replace(/^(https?:\/\/)my\.adhello\.ai(?=$|[/:?#])/i, `$1${CRM_PUBLIC_HOST}`);
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
    if (/^https?:\/\//i.test(stored)) {
      return stored.replace(/^(https?:\/\/)([^/]*\.)?my\.adhello\.ai(?=$|[/:?#])/i, (m, proto, sub) => {
        return `${proto}${sub || ''}${CRM_PUBLIC_HOST}`;
      });
    }
    return `https://${websiteBuildSlug(leadOrTitle.title || leadOrTitle.company || '')}.${CRM_PUBLIC_HOST}`;
  }
  return `https://${websiteBuildSlug(leadOrTitle)}.${CRM_PUBLIC_HOST}`;
}

function ghlWebsitesBuilderUrl({ dashboardUrl, locationId } = {}) {
  const base = ghlCrmBaseUrl(dashboardUrl);
  const loc = String(locationId || '').trim();
  if (loc) {
    return `${base}/v2/location/${encodeURIComponent(loc)}/funnels-websites/websites`;
  }
  return `${base}/v2/location`;
}

function ghlLocationDashboardUrl({ dashboardUrl, locationId } = {}) {
  const base = ghlCrmBaseUrl(dashboardUrl);
  const loc = String(locationId || '').trim();
  if (loc) return `${base}/v2/location/${encodeURIComponent(loc)}`;
  return `${base}/`;
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
  ghlLocationDashboardUrl,
  ghlContactCrmUrl,
};
