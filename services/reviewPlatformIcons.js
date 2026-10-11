/**
 * Recognizable brand marks for review platforms (settings + public /rv page).
 * Simplified SVGs for wayfinding — not a claim of partnership with these brands.
 * All marks are drawn in a square 24×24 viewBox and must stay 1:1 in CSS.
 */

function svg(body, { viewBox = '0 0 24 24' } = {}) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="24" height="24" ` +
    `preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">${body}</svg>`
  );
}

/** Google “G” in brand colors. */
const google = svg(
  `<path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>` +
  `<path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>` +
  `<path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>` +
  `<path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>`,
);

/** Meta / Facebook circle “f”. */
const facebook = svg(
  `<circle cx="12" cy="12" r="12" fill="#1877F2"/>` +
  `<path fill="#fff" d="M13.5 24V14.7h3.1l.5-3.5h-3.6V9.1c0-1 .3-1.7 1.8-1.7h1.9V4.3c-.3 0-1.5-.1-2.8-.1-2.8 0-4.7 1.7-4.7 4.8v2.2H7v3.5h2.7V24h3.8z"/>`,
);

/** Yelp burst — five petals around a center (classic mark, square-safe). */
const yelp = svg(
  `<g fill="#D32323" transform="translate(12 12)">` +
  `<ellipse rx="2.15" ry="7.1" transform="rotate(0)"/>` +
  `<ellipse rx="2.15" ry="7.1" transform="rotate(72)"/>` +
  `<ellipse rx="2.15" ry="7.1" transform="rotate(144)"/>` +
  `<ellipse rx="2.15" ry="7.1" transform="rotate(216)"/>` +
  `<ellipse rx="2.15" ry="7.1" transform="rotate(288)"/>` +
  `</g>`,
);

/** Thumbtack pin. */
const thumbtack = svg(
  `<path fill="#009FD9" d="M12 1.5C7.86 1.5 4.5 4.86 4.5 9c0 5.7 7.5 13.5 7.5 13.5S19.5 14.7 19.5 9c0-4.14-3.36-7.5-7.5-7.5zm0 10.2a2.7 2.7 0 1 1 0-5.4 2.7 2.7 0 0 1 0 5.4z"/>`,
);

/** Angi house. */
const angi = svg(
  `<path fill="#FF6153" d="M12 3.2 2.4 10.6c-.35.27-.18.8.28.8H5v8.6c0 .33.27.6.6.6h3.7c.33 0 .6-.27.6-.6v-4.2h4.2v4.2c0 .33.27.6.6.6h3.7c.33 0 .6-.27.6-.6v-8.6h2.32c.46 0 .63-.53.28-.8L12 3.2z"/>`,
);

/** Nextdoor circle “N”. */
const nextdoor = svg(
  `<circle cx="12" cy="12" r="12" fill="#0A8A3C"/>` +
  `<path fill="#fff" d="M10.9 17.4H8.2V9.85L6.35 11.9V9.2L11 5.7v11.7zm4.7 0h-2.7V7.2h2.7v10.2z"/>`,
);

/** BBB shield + B. */
const bbb = svg(
  `<path fill="#005A78" d="M12 2.2 4 5.4v5.8c0 4.9 3.4 9.5 8 10.6 4.6-1.1 8-5.7 8-10.6V5.4L12 2.2z"/>` +
  `<path fill="#fff" d="M10.2 8.1h2.1c1.15 0 1.85.55 1.85 1.45 0 .55-.28.95-.75 1.15.7.25 1.1.8 1.1 1.55v.7c0 1.15-.75 1.85-2.05 1.85H10.2V8.1zm1.55 2.55h.55c.4 0 .65-.2.65-.5s-.22-.5-.62-.5h-.58v1zm0 3.1h.65c.45 0 .7-.22.7-.58 0-.35-.25-.57-.7-.57h-.65v1.15z"/>`,
);

/** Houzz “h” blocks. */
const houzz = svg(
  `<path fill="#4DBC15" d="M3 3h8v8H3V3zm10 5h8v13h-8V8zM3 13h8v8H3v-8z"/>`,
);

const ICONS = {
  google,
  facebook,
  yelp,
  thumbtack,
  angi,
  nextdoor,
  bbb,
  houzz,
};

/** Tile background behind the mark. */
const TILE = {
  google: '#FFFFFF',
  facebook: '#FFFFFF',
  yelp: '#FFFFFF',
  thumbtack: '#FFFFFF',
  angi: '#FFFFFF',
  nextdoor: '#FFFFFF',
  bbb: '#FFFFFF',
  houzz: '#FFFFFF',
  other: '#F1F5F9',
};

function iconFor(key) {
  return ICONS[key] || '';
}

function tileFor(key) {
  return TILE[key] || '#F1F5F9';
}

module.exports = {
  ICONS,
  iconFor,
  tileFor,
};
