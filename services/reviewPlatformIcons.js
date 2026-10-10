/**
 * Recognizable brand marks for review platforms (settings + public /rv page).
 * Simplified SVGs for wayfinding — not a claim of partnership with these brands.
 */

function svg(body, { viewBox = '0 0 24 24' } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="24" height="24" aria-hidden="true" focusable="false">${body}</svg>`;
}

/** Google “G” in brand colors on a light tile. */
const google = svg(
  `<path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
   <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
   <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
   <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>`,
);

/** Meta / Facebook “f”. */
const facebook = svg(
  `<path fill="#1877F2" d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/>`,
);

/** Yelp burst. */
const yelp = svg(
  `<path fill="#D32323" d="M20.16 12.55c-.3-.4-.83-.5-1.26-.24l-3.54 2.18c-.18-1.94-.43-3.87-.78-5.78l3.95-1.65c.47-.2.7-.72.53-1.2-.18-.48-.7-.72-1.18-.54l-4.12 1.72c-.5-1.85-1.14-3.65-1.92-5.38C11.6.9 10.9.5 10.27.75c-.62.25-.9.96-.65 1.58.9 2.03 1.64 4.12 2.22 6.25L8.1 9.8c-.48-.2-1.03 0-1.25.47-.22.47 0 1.02.46 1.24l3.87 1.73c-.55 1.9-1.24 3.75-2.08 5.54-.26.56 0 1.22.56 1.48.56.26 1.22 0 1.48-.56.72-1.55 1.32-3.16 1.8-4.81l3.3 2.03c.42.26.97.13 1.23-.3.26-.42.13-.97-.3-1.23l-.01-.02z"/>`,
);

/** Thumbtack pin mark. */
const thumbtack = svg(
  `<path fill="#009FD9" d="M12 0C7.03 0 3 4.03 3 9c0 6.75 9 15 9 15s9-8.25 9-15c0-4.97-4.03-9-9-9zm0 12.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/>`,
);

/** Angi house mark. */
const angi = svg(
  `<path fill="#FF6153" d="M12 2.2 1.5 10.4c-.4.3-.2.9.3.9H4v9.2c0 .4.3.7.7.7h4.1c.4 0 .7-.3.7-.7v-4.6h4.9v4.6c0 .4.3.7.7.7h4.1c.4 0 .7-.3.7-.7V11.3h2.2c.5 0 .7-.6.3-.9L12 2.2z"/>`,
);

/** Nextdoor “N”. */
const nextdoor = svg(
  `<path fill="#0A8A3C" d="M12 0C5.37 0 0 5.37 0 12s5.37 12 12 12 12-5.37 12-12S18.63 0 12 0zm-.2 17.6h-3.3V9.55L6.1 12.1V8.85l5.7-4.35v13.1zm5.4 0h-3.3V6.75h3.3v10.85z"/>`,
);

/** BBB seal-style B. */
const bbb = svg(
  `<path fill="#005A78" d="M12 1.5 3 5v6.5c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-3.5zm1.4 14.2c0 .9-.7 1.5-1.9 1.5H8.2v-9.4h3.2c1.1 0 1.8.5 1.8 1.4 0 .6-.3 1-.8 1.25.7.2 1.1.8 1.1 1.55v1.1c0 1.1-.5 1.9-1.4 2.3.7.3 1.1.9 1.1 1.8v.5zm-2.9-5.5h.7c.4 0 .6-.2.6-.5s-.2-.5-.6-.5h-.7v1zm0 3.5h.8c.45 0 .7-.25.7-.6s-.25-.55-.7-.55h-.8v1.15z"/>`,
);

/** Houzz “h”. */
const houzz = svg(
  `<path fill="#3A9A0F" d="M1.5 1.5h9.2v9.2H1.5V1.5zm11.8 5.5H22.5V22.5h-9.2V7zM1.5 13.3h9.2v9.2H1.5v-9.2z"/>`,
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

/** Tile background behind the mark (Google is light so the multicolor G reads). */
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
