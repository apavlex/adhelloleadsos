const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCustomMenuLinks, parseCustomMenuLinksInput } = require('../services/customMenuLinks');

test('normalizeCustomMenuLinks keeps https links and assigns ids', () => {
  const links = normalizeCustomMenuLinks([
    { label: ' Calendar ', url: 'https://calendar.google.com/calendar', open: 'iframe' },
    { label: 'Docs', url: 'https://docs.example.com', open: 'tab' },
  ]);
  assert.equal(links.length, 2);
  assert.equal(links[0].label, 'Calendar');
  assert.equal(links[0].open, 'iframe');
  assert.match(links[0].id, /^ml_[a-z0-9]+$/);
  assert.equal(links[1].open, 'tab');
  assert.notEqual(links[0].id, links[1].id);
});

test('normalizeCustomMenuLinks drops javascript and blank rows', () => {
  const links = normalizeCustomMenuLinks([
    { label: 'Bad', url: 'javascript:alert(1)', open: 'iframe' },
    { label: '', url: 'https://example.com' },
    { label: 'Ok', url: 'http://example.com/path' },
  ]);
  assert.equal(links.length, 1);
  assert.equal(links[0].label, 'Ok');
  assert.equal(links[0].url, 'http://example.com/path');
});

test('parseCustomMenuLinksInput reports a named row with a bad URL', () => {
  const result = parseCustomMenuLinksInput([
    { label: 'CRM', url: 'not a url', open: 'tab' },
  ]);
  assert.equal(result.ok, false);
  assert.match(result.error, /CRM/);
});

test('parseCustomMenuLinksInput ignores empty rows and keeps a valid id', () => {
  const result = parseCustomMenuLinksInput([
    { label: '', url: '' },
    { id: 'ml_abc12345', label: 'Board', url: 'https://example.com/board', open: 'iframe' },
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.links.length, 1);
  assert.equal(result.links[0].id, 'ml_abc12345');
});
