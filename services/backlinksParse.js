/**
 * Pure parsers / gap helpers for backlink payloads (no DB).
 */

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function hostKey(raw) {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split('?')[0];
  return s || '';
}

/** Directories / social / aggregators — never treat as local business competitors. */
const DIRECTORY_OR_PLATFORM_HOSTS = new Set([
  'facebook.com',
  'fb.com',
  'instagram.com',
  'yelp.com',
  'google.com',
  'maps.google.com',
  'goo.gl',
  'bbb.org',
  'angi.com',
  'angieslist.com',
  'thumbtack.com',
  'nextdoor.com',
  'yellowpages.com',
  'yp.com',
  'tripadvisor.com',
  'houzz.com',
  'homeadvisor.com',
  'bark.com',
  'mapquest.com',
  'apple.com',
  'bing.com',
  'wikipedia.org',
  'linkedin.com',
  'twitter.com',
  'x.com',
  'youtube.com',
  'tiktok.com',
  'pinterest.com',
  'craigslist.org',
  'foursquare.com',
  'waze.com',
  'yahoo.com',
  'msn.com',
  'amazon.com',
  'ebay.com',
  'etsy.com',
  'reddit.com',
]);

function registrableHost(domain) {
  const parts = String(domain || '')
    .toLowerCase()
    .split('.')
    .filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  return parts.slice(-2).join('.');
}

function isDirectoryOrPlatformDomain(raw) {
  const d = hostKey(raw);
  if (!d) return false;
  if (DIRECTORY_OR_PLATFORM_HOSTS.has(d)) return true;
  const reg = registrableHost(d);
  if (DIRECTORY_OR_PLATFORM_HOSTS.has(reg)) return true;
  for (const blocked of DIRECTORY_OR_PLATFORM_HOSTS) {
    if (d === blocked || d.endsWith('.' + blocked)) return true;
  }
  return false;
}

function parseSummaryResult(result) {
  if (!result || typeof result !== 'object') {
    return {
      backlinks: 0,
      referringDomains: 0,
      referringMainDomains: 0,
      rank: null,
      spamScore: null,
      brokenBacklinks: 0,
      referringLinksTypes: {},
      referringLinksTld: {},
    };
  }
  return {
    backlinks: num(result.backlinks),
    referringDomains: num(result.referring_domains),
    referringMainDomains: num(result.referring_main_domains),
    rank: result.rank != null ? num(result.rank, null) : null,
    spamScore: result.backlinks_spam_score != null ? num(result.backlinks_spam_score, null) : null,
    brokenBacklinks: num(result.broken_backlinks),
    referringLinksTypes:
      result.referring_links_types && typeof result.referring_links_types === 'object'
        ? result.referring_links_types
        : {},
    referringLinksTld:
      result.referring_links_tld && typeof result.referring_links_tld === 'object'
        ? result.referring_links_tld
        : {},
    firstSeen: result.first_seen || null,
  };
}

function parseReferringDomainItems(items) {
  const list = Array.isArray(items) ? items : [];
  return list
    .map((it) => {
      const domain = hostKey(it.domain || it.domain_from || it.target || '');
      if (!domain) return null;
      return {
        domain,
        rank: it.rank != null ? num(it.rank, null) : null,
        backlinks: num(it.backlinks),
        referringPages: num(it.referring_pages),
        spamScore: it.backlinks_spam_score != null ? num(it.backlinks_spam_score, null) : null,
        firstSeen: it.first_seen || null,
        lostDate: it.lost_date || null,
      };
    })
    .filter(Boolean);
}

function parseAnchorItems(items) {
  const list = Array.isArray(items) ? items : [];
  return list
    .map((it) => {
      const anchor = String(it.anchor != null ? it.anchor : '').trim();
      return {
        anchor: anchor || '(empty)',
        backlinks: num(it.backlinks),
        referringDomains: num(it.referring_domains),
        rank: it.rank != null ? num(it.rank, null) : null,
        firstSeen: it.first_seen || null,
      };
    })
    .filter((a) => a.backlinks > 0 || a.referringDomains > 0);
}

function parseTimeseriesItems(items) {
  const list = Array.isArray(items) ? items : [];
  return list.map((it) => ({
    date: it.date || it.datetime || null,
    newBacklinks: num(it.new_backlinks),
    lostBacklinks: num(it.lost_backlinks),
    newReferringDomains: num(it.new_referring_domains),
    lostReferringDomains: num(it.lost_referring_domains),
  }));
}

/**
 * Referring domains on any competitor that do not appear in your set.
 */
function computeCompetitorLinkGaps({ yourReferring = [], competitorProfiles = [] }) {
  const yours = new Set(
    (Array.isArray(yourReferring) ? yourReferring : []).map((r) => hostKey(r.domain)).filter(Boolean)
  );
  const byDomain = new Map();
  for (const profile of Array.isArray(competitorProfiles) ? competitorProfiles : []) {
    const competitor = hostKey(profile.domain);
    for (const row of Array.isArray(profile.referringDomains) ? profile.referringDomains : []) {
      const d = hostKey(row.domain);
      if (!d || yours.has(d) || d === competitor) continue;
      const prev = byDomain.get(d) || {
        domain: d,
        competitors: [],
        maxRank: null,
        maxBacklinks: 0,
      };
      prev.competitors.push(competitor);
      if (row.rank != null && (prev.maxRank == null || row.rank > prev.maxRank)) prev.maxRank = row.rank;
      if (num(row.backlinks) > prev.maxBacklinks) prev.maxBacklinks = num(row.backlinks);
      byDomain.set(d, prev);
    }
  }
  return Array.from(byDomain.values())
    .map((g) => ({
      ...g,
      competitors: Array.from(new Set(g.competitors)).slice(0, 8),
      opportunityScore: Math.round(
        (g.maxRank != null ? g.maxRank : 0) * 0.6 + Math.min(100, g.maxBacklinks) * 0.4
      ),
    }))
    .sort((a, b) => (b.opportunityScore || 0) - (a.opportunityScore || 0));
}

module.exports = {
  hostKey,
  isDirectoryOrPlatformDomain,
  DIRECTORY_OR_PLATFORM_HOSTS,
  parseSummaryResult,
  parseReferringDomainItems,
  parseAnchorItems,
  parseTimeseriesItems,
  computeCompetitorLinkGaps,
};
