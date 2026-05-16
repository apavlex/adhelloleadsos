const cheerio = require('cheerio');

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const PHONE_RE = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;

function uniqueStrings(arr, max = 12) {
  const out = [];
  const seen = new Set();
  for (const raw of arr || []) {
    const s = String(raw || '').trim();
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

function extractJsonLdBusinesses(html) {
  const businesses = [];
  if (!html) return businesses;
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1]);
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of nodes) {
        const items = node && node['@graph'] ? node['@graph'] : [node];
        for (const item of items) {
          if (!item || typeof item !== 'object') continue;
          const type = String(item['@type'] || '').toLowerCase();
          if (!type.includes('localbusiness') && !type.includes('organization') && !type.includes('store')) {
            continue;
          }
          businesses.push({
            title: item.name || item.legalName || '',
            phone: item.telephone || '',
            email: item.email || '',
            website: item.url || (item.sameAs && item.sameAs[0]) || '',
            address:
              typeof item.address === 'string'
                ? item.address
                : item.address && item.address.streetAddress
                  ? [item.address.streetAddress, item.address.addressLocality, item.address.addressRegion]
                      .filter(Boolean)
                      .join(', ')
                  : '',
          });
        }
      }
    } catch {
      /* ignore malformed JSON-LD */
    }
  }
  return businesses;
}

/**
 * Contact + tech signals from static HTML (BeautifulSoup-equivalent via Cheerio).
 */
function parsePageContacts(html, pageUrl) {
  const $ = cheerio.load(html || '');
  const text = $.text();
  const emails = uniqueStrings((text.match(EMAIL_RE) || []).map((e) => e.toLowerCase()));
  const phones = uniqueStrings(text.match(PHONE_RE) || []);

  $('a[href^="mailto:"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const e = href.replace(/^mailto:/i, '').split('?')[0].trim();
    if (e) emails.push(e.toLowerCase());
  });
  $('a[href^="tel:"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const p = href.replace(/^tel:/i, '').trim();
    if (p) phones.push(p);
  });

  const ogTitle = $('meta[property="og:title"]').attr('content') || $('title').first().text() || '';
  const canonical =
    $('link[rel="canonical"]').attr('href') ||
    $('meta[property="og:url"]').attr('content') ||
    pageUrl ||
    '';

  const jsonLd = extractJsonLdBusinesses(html);
  const primaryLd = jsonLd[0] || null;

  return {
    businessName: (primaryLd && primaryLd.title) || ogTitle.trim(),
    emails: uniqueStrings(emails),
    phones: uniqueStrings(phones),
    email: (primaryLd && primaryLd.email) || emails[0] || '',
    phone: (primaryLd && primaryLd.phone) || phones[0] || '',
    website: (primaryLd && primaryLd.website) || canonical,
    address: (primaryLd && primaryLd.address) || '',
    jsonLdCount: jsonLd.length,
  };
}

/**
 * Heuristic directory listing cards (Yelp, Yellow Pages, BBB patterns).
 */
function parseDirectoryListings(html, sourceId) {
  const $ = cheerio.load(html || '');
  const listings = [];
  const seen = new Set();

  function pushListing(row) {
    const title = String(row.title || '').trim();
    if (!title || title.length < 2) return;
    const key = `${title.toLowerCase()}|${row.phone || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    listings.push(row);
  }

  const cardSelectors = [
    '[data-testid="serp-ia-card"]',
    'motion.li[class*="container"]',
    'div[class*="businessName"]',
    'div.search-results ol li',
    'motion.li',
    '.result',
    '.srp-listing',
    '.v-card',
    'article[data-loc]',
    'div.org-card',
    'li.business-result',
    'div.business-card',
    'div[class*="BusinessCard"]',
    'a[href*="/biz/"]',
    'a[href*="/mip/"]',
  ];

  for (const sel of cardSelectors) {
    $(sel).each((_, el) => {
      const $el = $(el);
      const title =
        $el.find('a[href*="/biz/"]').first().text().trim() ||
        $el.find('a[href*="/mip/"]').first().text().trim() ||
        $el.find('h2, h3, h4, .business-name, [class*="businessName"]').first().text().trim() ||
        $el.find('a').first().text().trim();
      const phone =
        $el.find('a[href^="tel:"]').first().attr('href')?.replace(/^tel:/i, '') ||
        (($el.text().match(PHONE_RE) || [])[0] || '');
      const href =
        $el.find('a[href*="/biz/"]').first().attr('href') ||
        $el.find('a[href*="/mip/"]').first().attr('href') ||
        $el.find('a').first().attr('href') ||
        '';
      const website = $el.find('a[href^="http"]').not('[href*="yelp"]').not('[href*="yellowpages"]').first().attr('href') || '';
      pushListing({
        title,
        phone: phone || 'N/A',
        website: website || 'N/A',
        address: $el.find('[class*="address"], .adr, address').first().text().trim() || 'N/A',
        url: href,
        source: sourceId,
      });
    });
    if (listings.length >= 3) break;
  }

  for (const ld of extractJsonLdBusinesses(html)) {
    pushListing({
      title: ld.title,
      phone: ld.phone || 'N/A',
      website: ld.website || 'N/A',
      address: ld.address || 'N/A',
      url: ld.website || '',
      source: sourceId,
    });
  }

  return listings.slice(0, 80);
}

module.exports = {
  parsePageContacts,
  parseDirectoryListings,
  extractJsonLdBusinesses,
  uniqueStrings,
};
