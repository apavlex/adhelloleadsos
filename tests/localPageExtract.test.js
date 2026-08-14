const test = require('node:test');
const assert = require('node:assert/strict');

const {
  contactsToExtract,
  discoverContactPageUrls,
  isContactableEmail,
  pickBestEmail,
} = require('../services/localPageExtract');
const { parsePageContacts } = require('../services/cheerioParser');

const BUILDEX_HTML = `
  <html>
    <head><title>Buildex Construction NW</title></head>
    <body>
      <script>Sentry.init({ dsn: "https://abc@sentry.wixpress.com/1" })</script>
      <img src="/assets/banner@2x.png" alt="banner">
      <nav><a href="/about-us">About</a><a href="/contact">Contact</a></nav>
      <footer>
        Call (503) 863-8030 or email
        <a href="mailto:buildexnw@gmail.com">buildexnw@gmail.com</a>
        <a href="mailto:support@wix.com">Site by Wix</a>
      </footer>
    </body>
  </html>
`;

test('footer mailto email survives asset and vendor noise', () => {
  const contacts = parsePageContacts(BUILDEX_HTML, 'https://buildexconstructionnw.com');
  const extract = contactsToExtract(contacts, { website: 'https://buildexconstructionnw.com' });

  assert.equal(extract.email, 'buildexnw@gmail.com');
  assert.ok(extract.phone);
});

test('vendor, sentry, and asset-style emails are not contactable', () => {
  assert.equal(isContactableEmail('support@wix.com'), false);
  assert.equal(isContactableEmail('abc@sentry.wixpress.com'), false);
  assert.equal(isContactableEmail('banner@2x.png'), false);
  assert.equal(isContactableEmail('noreply@buildexconstructionnw.com'), false);
  assert.equal(isContactableEmail('buildexnw@gmail.com'), true);
});

test('business-domain inbox beats a free-provider inbox', () => {
  const best = pickBestEmail(['buildexnw@gmail.com', 'office@buildexconstructionnw.com'], {
    website: 'buildexconstructionnw.com',
  });
  assert.equal(best, 'office@buildexconstructionnw.com');
});

test('contact pages are discovered same-host and ranked before about pages', () => {
  const urls = discoverContactPageUrls(BUILDEX_HTML, 'https://buildexconstructionnw.com');

  assert.equal(urls[0], 'https://buildexconstructionnw.com/contact');
  assert.ok(urls.every((u) => u.includes('buildexconstructionnw.com')));
});

test('off-host and asset links are ignored during contact page discovery', () => {
  const html = `
    <a href="https://facebook.com/contact">fb</a>
    <a href="/contact-us.pdf">pdf</a>
    <a href="/get-in-touch">reach us</a>
  `;
  const urls = discoverContactPageUrls(html, 'https://buildexconstructionnw.com');

  assert.deepEqual(urls, ['https://buildexconstructionnw.com/get-in-touch']);
});

test('empty contact fields are dropped so merges do not clobber providers', () => {
  const extract = contactsToExtract({ emails: [], phones: [], address: '', businessName: '' });
  assert.deepEqual(extract, {});
});
