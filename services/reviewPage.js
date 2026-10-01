/**
 * Member review page (/rv/:slug): which platforms to show and how the star
 * rating changes the layout. Soft gate only: public review links are always
 * visible (Google forbids hiding them from unhappy customers); low ratings
 * just put the private feedback form first.
 */

const PLATFORMS = [
  { key: 'google', label: 'Google', color: '#4285F4', letter: 'G' },
  { key: 'facebook', label: 'Facebook', color: '#1877F2', letter: 'f' },
  { key: 'yelp', label: 'Yelp', color: '#D32323', letter: 'y' },
];

/** Ordered list of review destinations the member has set up. */
function reviewDestinations(reviewLinks, slug) {
  const links = reviewLinks && typeof reviewLinks === 'object' ? reviewLinks : {};
  const out = PLATFORMS
    .filter((p) => links[p.key])
    .map((p) => ({ ...p, url: links[p.key], href: `/rv/${slug}/go/${p.key}` }));
  (Array.isArray(links.other) ? links.other : []).forEach((row, i) => {
    if (!row || !row.url || !row.label) return;
    out.push({
      key: 'other',
      label: row.label,
      color: '#475569',
      letter: String(row.label).trim().charAt(0).toUpperCase() || '★',
      url: row.url,
      href: `/rv/${slug}/go/other/${i}`,
    });
  });
  return out;
}

function parseRating(value) {
  const n = parseInt(value, 10);
  return n >= 1 && n <= 5 ? n : 0;
}

/**
 * Layout for a rating. Every state keeps the public links on the page.
 * @returns {{ rating: number, stage: 'ask'|'happy'|'unhappy', feedbackFirst: boolean, showPublicLinks: true, publicProminent: boolean }}
 */
function reviewGate(rating) {
  const r = parseRating(rating);
  if (!r) return { rating: 0, stage: 'ask', feedbackFirst: false, showPublicLinks: true, publicProminent: false };
  if (r >= 4) return { rating: r, stage: 'happy', feedbackFirst: false, showPublicLinks: true, publicProminent: true };
  return { rating: r, stage: 'unhappy', feedbackFirst: true, showPublicLinks: true, publicProminent: false };
}

/** Destination URL for a click-through, only ever one the member saved (no open redirect). */
function destinationFor(reviewLinks, platform, index) {
  const links = reviewLinks && typeof reviewLinks === 'object' ? reviewLinks : {};
  if (platform === 'other') {
    const row = (Array.isArray(links.other) ? links.other : [])[parseInt(index, 10) || 0];
    return row && row.url ? row.url : '';
  }
  return PLATFORMS.some((p) => p.key === platform) ? (links[platform] || '') : '';
}

module.exports = {
  PLATFORMS,
  reviewDestinations,
  reviewGate,
  parseRating,
  destinationFor,
};
