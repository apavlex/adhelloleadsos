/**
 * Member review page (/rv/:slug): which platforms to show and how the star
 * rating changes the layout. Soft gate only: public review links are always
 * visible (Google forbids hiding them from unhappy customers); low ratings
 * just put the private feedback form first.
 */

const PLATFORMS = [
  {
    key: 'google', label: 'Google', field: 'Google review link', color: '#4285F4', letter: 'G',
    placeholder: 'https://g.page/r/…/review',
    hint: 'In Google Business Profile, tap "Ask for reviews" and copy the link.',
  },
  { key: 'facebook', label: 'Facebook', field: 'Facebook page', color: '#1877F2', letter: 'f', placeholder: 'https://facebook.com/yourpage/reviews' },
  { key: 'yelp', label: 'Yelp', field: 'Yelp page', color: '#D32323', letter: 'y', placeholder: 'https://yelp.com/biz/your-business' },
  { key: 'thumbtack', label: 'Thumbtack', field: 'Thumbtack profile', color: '#009FD9', letter: 'T', placeholder: 'https://thumbtack.com/…/service/…' },
  { key: 'angi', label: 'Angi', field: 'Angi profile', color: '#FF6153', letter: 'A', placeholder: 'https://angi.com/companylist/us/…' },
  { key: 'nextdoor', label: 'Nextdoor', field: 'Nextdoor business page', color: '#0A8A3C', letter: 'n', placeholder: 'https://nextdoor.com/pages/…' },
  { key: 'bbb', label: 'BBB', field: 'BBB profile', color: '#005A78', letter: 'B', placeholder: 'https://bbb.org/us/…' },
  { key: 'houzz', label: 'Houzz', field: 'Houzz profile', color: '#3A9A0F', letter: 'h', placeholder: 'https://houzz.com/professionals/…' },
];

const PLATFORM_KEYS = PLATFORMS.map((p) => p.key);
const MAX_OTHER_LINKS = 10;

/** Raw review links from a settings form (fields named by platform key, plus otherLabel[]/otherUrl[]). */
function linksFromForm(body) {
  const b = body && typeof body === 'object' ? body : {};
  const labels = [].concat(b.otherLabel || []);
  const urls = [].concat(b.otherUrl || []);
  const out = { other: labels.map((label, i) => ({ label, url: urls[i] })) };
  PLATFORM_KEYS.forEach((key) => { out[key] = b[key]; });
  return out;
}

/** Label of the first platform the user typed something into that didn't survive cleaning. */
function firstRejectedLink(body, cleaned) {
  const b = body && typeof body === 'object' ? body : {};
  const bad = PLATFORMS.find((p) => String(b[p.key] || '').trim() && !(cleaned && cleaned[p.key]));
  return bad ? bad.label : '';
}

function countLinks(reviewLinks) {
  const links = reviewLinks && typeof reviewLinks === 'object' ? reviewLinks : {};
  return PLATFORM_KEYS.filter((key) => links[key]).length + (Array.isArray(links.other) ? links.other.length : 0);
}

/** Saved custom rows plus blanks to fill in, capped at MAX_OTHER_LINKS. */
function otherFormRows(reviewLinks, blanks = 2) {
  const saved = reviewLinks && Array.isArray(reviewLinks.other) ? reviewLinks.other : [];
  const extra = Math.max(0, Math.min(blanks, MAX_OTHER_LINKS - saved.length));
  return saved.concat(Array.from({ length: extra }, () => ({ label: '', url: '' }))).slice(0, MAX_OTHER_LINKS);
}

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
  PLATFORM_KEYS,
  MAX_OTHER_LINKS,
  linksFromForm,
  firstRejectedLink,
  countLinks,
  otherFormRows,
  reviewDestinations,
  reviewGate,
  parseRating,
  destinationFor,
};
