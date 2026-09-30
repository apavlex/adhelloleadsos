/** Marketing home page (views/home.ejs) — its own brand palette; mirrors the TAILWIND_CDN=1 fallback in partials/tailwind_css.ejs. */
module.exports = {
  darkMode: 'class',
  content: ['./views/home.ejs'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui'], display: ['Manrope', 'sans-serif'] },
      colors: {
        brand: {
          bg: '#FAF7ED',
          cream: '#FAF7ED',
          yellow: '#FFD644',
          dark: '#111827',
          muted: 'rgba(17,24,39,0.7)',
          border: 'rgba(17,24,39,0.1)',
        },
      },
    },
  },
  plugins: [],
};
