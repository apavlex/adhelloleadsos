/**
 * Human-readable labels for lead sourceChannel / import source fields.
 */

const { mapImportSourceChannel } = require('./csvLeadImport');

const SOURCE_CHANNEL_LABELS = {
  google_maps: 'Google Maps',
  yelp: 'Yelp',
  yellowpages: 'Yellow Pages',
  bbb: 'BBB',
  tripadvisor: 'TripAdvisor',
  angi: 'Angi',
  homeadvisor: 'HomeAdvisor',
  thumbtack: 'Thumbtack',
  apple_maps: 'Apple Maps',
  bing_maps: 'Bing Maps',
  foursquare: 'Foursquare',
  manta: 'Manta',
  citysearch: 'Citysearch',
  superpages: 'Superpages',
  linkedin_company: 'LinkedIn Company',
  linkedin_profile: 'LinkedIn Profile',
  facebook: 'Facebook',
  facebook_marketplace: 'Facebook Marketplace',
  instagram: 'Instagram',
  groupon: 'Groupon',
  craigslist: 'Craigslist',
  nextdoor: 'Nextdoor',
  houzz: 'Houzz',
  zillow: 'Zillow',
  mhvillage: 'MHVillage',
  realtor: 'Realtor.com',
  redfin: 'Redfin',
  offerup: 'OfferUp',
  ebay: 'eBay',
  web: 'Web',
};

const HIDDEN_SOURCE_KEYS = new Set([
  'csv_import',
  'google_drive',
  'chrome_extension',
  'autonomous',
  'import',
  'manual',
  'unknown',
]);

function pickImportField(importFields, keys) {
  if (!importFields || typeof importFields !== 'object') return '';
  const entries = Object.entries(importFields);
  for (const key of keys) {
    const lk = String(key || '').toLowerCase();
    for (const [k, v] of entries) {
      if (String(k || '').toLowerCase() === lk) {
        const s = String(v || '').trim();
        if (s) return s;
      }
    }
  }
  return '';
}

function normalizeSourceChannel(raw) {
  return mapImportSourceChannel(raw);
}

function resolveLeadSourceChannel(lead) {
  if (!lead || typeof lead !== 'object') return '';
  const imp = lead.importFields && typeof lead.importFields === 'object' ? lead.importFields : {};
  const raw =
    String(lead.sourceChannel || '').trim() ||
    pickImportField(imp, ['source_channel', 'sourcechannel']) ||
    String(imp.source || '').trim() ||
    String(lead.source || '').trim();
  return normalizeSourceChannel(raw);
}

function formatSourceChannelLabel(raw) {
  const key = normalizeSourceChannel(raw);
  if (!key || HIDDEN_SOURCE_KEYS.has(key)) return '';
  if (SOURCE_CHANNEL_LABELS[key]) return SOURCE_CHANNEL_LABELS[key];
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatLeadSourceLabel(lead) {
  return formatSourceChannelLabel(resolveLeadSourceChannel(lead));
}

module.exports = {
  SOURCE_CHANNEL_LABELS,
  normalizeSourceChannel,
  resolveLeadSourceChannel,
  formatSourceChannelLabel,
  formatLeadSourceLabel,
};
