/**
 * Stock Tailwind theme (no brand tokens, darkMode 'media') for pages that loaded the Play CDN
 * without a config: views/login.ejs and views/omnichannel.ejs (+ what omnichannel pulls in).
 */
module.exports = {
  content: [
    './views/login.ejs',
    './views/omnichannel.ejs',
    './views/live_demo.ejs',
    './views/oauth_consent.ejs',
    './views/partials/email_intel_modal.ejs',
    './public/js/app.js',
    './public/js/review-stars.js',
    './public/js/pwa-register.js',
  ],
  plugins: [],
};
