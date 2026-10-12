/**
 * Composer title should say Send Message (not Bulk SMS).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

describe('Send Message label', () => {
  it('modal title uses Send Message instead of Bulk SMS', () => {
    const app = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
    assert.match(app, /Send Message — \$\{n\} leads/);
    assert.match(app, /['"]Send Message['"]/);
    assert.doesNotMatch(app, /Bulk SMS/);
    const messages = fs.readFileSync(path.join(root, 'routes/messages.js'), 'utf8');
    assert.match(messages, /Send Message/);
    assert.doesNotMatch(messages, /Bulk SMS/);
  });
});
