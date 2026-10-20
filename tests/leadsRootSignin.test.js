const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

describe('leads root shows sign-in', () => {
  it('server serves login at / for the CRM host and /app for reviews', () => {
    const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    assert.match(server, /function renderLoginPage/);
    assert.match(server, /app\.get\('\/'/);
    assert.match(server, /reviews\.adhello\.io/);
    assert.match(server, /redirect\(302, '\/app'\)/);
    assert.match(server, /return renderLoginPage\(req, res\)/);
  });

  it('authenticated index no longer renders the marketing home page', () => {
    const index = fs.readFileSync(path.join(__dirname, '../routes/index.js'), 'utf8');
    assert.doesNotMatch(index, /render\(\s*['"]home['"]/);
    assert.match(index, /redirect\(302, '\/today'\)/);
  });
});
