/**
 * Outscraper Ads Checker — detect paid ads (Google Ads Transparency / LinkedIn Ad Library)
 * for a lead's website domain. Used by business details + Money mode.
 */

const outscraper = require('./outscraperClient');
const { resolveLeadDomain } = require('./outscraperLeadEnrich');

function truthy(v) {
  return v === true || v === 'true' || v === 1 || v === '1';
}

function summarizeAds(pack) {
  if (!pack) return 'No ads data returned.';
  if (!pack.ads) return 'No paid ads detected (Google / LinkedIn).';
  const parts = [];
  if (pack.google) parts.push('Google');
  if (pack.linkedin) parts.push('LinkedIn');
  if (!parts.length) return 'Paid ads detected.';
  return `Running ads on ${parts.join(' + ')}.`;
}

/**
 * @param {object} lead
 * @param {Record<string, string>|null|undefined} integrationEnv
 */
async function checkLeadAds(lead, integrationEnv) {
  if (!outscraper.isConfigured(integrationEnv)) {
    return { used: false, skipped: true, reason: 'not_configured', patch: {}, message: '' };
  }
  const domain = resolveLeadDomain(lead);
  if (!domain) {
    return { used: false, skipped: true, reason: 'no_website', patch: {}, message: '' };
  }

  const row = await outscraper.fetchAdsChecker({ query: domain, integrationEnv });
  if (!row) {
    return {
      used: false,
      skipped: false,
      reason: 'empty',
      domain,
      patch: {},
      message: 'Ads checker returned no data for this domain.',
    };
  }

  const ads = truthy(row.ads);
  const google = truthy(row.google);
  const linkedin = truthy(row.linkedin);
  const pack = { ads, google, linkedin, query: row.query || domain };
  const now = new Date().toISOString();
  const patch = {
    adsRunning: ads,
    adsRunningGoogle: google,
    adsRunningLinkedin: linkedin,
    adsCheckedAt: now,
    adsCheckDomain: String(pack.query || domain).trim(),
    logs: [
      {
        type: 'ads_check',
        message: `Outscraper Ads Checker (${pack.query || domain}): ${summarizeAds(pack)}`,
        timestamp: now,
      },
    ],
  };

  return {
    used: true,
    skipped: false,
    reason: 'ok',
    domain: pack.query || domain,
    result: pack,
    patch,
    message: summarizeAds(pack),
  };
}

module.exports = {
  checkLeadAds,
  summarizeAds,
};
