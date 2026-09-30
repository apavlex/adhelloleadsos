/**
 * Build-time Tailwind (v3.4, same as the Play CDN it replaces). Theme must stay in sync with the
 * TAILWIND_CDN=1 fallback config in views/partials/tailwind_css.ejs.
 *
 * `content` includes server-side JS because services/routes/config emit class strings into HTML
 * (e.g. services/socialBrandIcons.js, services/salesConstants.js). Class names must appear as
 * complete literals somewhere in these files — never build them like `'bg-' + color`.
 */
module.exports = {
  darkMode: 'class',
  content: [
    './views/**/*.ejs',
    './public/**/*.{js,html}',
    '!./public/course/**',
    './services/**/*.js',
    './routes/**/*.js',
    './lib/**/*.js',
    './utils/**/*.js',
    './config/**/*.js',
    './middleware/**/*.js',
    './server.js',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui'],
        display: ['Manrope', 'sans-serif'],
      },
      colors: {
        brand: {
          bg: 'var(--brand-bg)',
          cream: 'var(--brand-cream)',
          yellow: 'var(--brand-yellow)',
          yellowHover: '#FACC15',
          dark: 'var(--brand-dark)',
          muted: 'var(--brand-muted)',
          border: 'var(--brand-border)',
        },
      },
      borderRadius: {
        '4xl': '2rem',
        '5xl': '3rem',
      },
      boxShadow: {
        brutal: '4px 4px 0px rgba(0,0,0,0.1)',
        'brutal-hover': '0 0 15px rgba(253, 224, 71, 0.6)',
      },
    },
  },
  plugins: [],
};
