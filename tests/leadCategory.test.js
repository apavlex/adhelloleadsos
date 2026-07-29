const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeLeadCategoryName,
  categoryLooksLikeBusinessName,
  sanitizeLeadCategoryName,
} = require('../services/leadCategory');

test('normalizeLeadCategoryName handles empty and arrays', () => {
  assert.equal(normalizeLeadCategoryName(''), 'N/A');
  assert.equal(normalizeLeadCategoryName(['General', 'Contractor']), 'General, Contractor');
});

test('categoryLooksLikeBusinessName detects title duplicates', () => {
  assert.equal(
    categoryLooksLikeBusinessName('Tom Griffith Construction Inc', 'Tom Griffith Construction Inc'),
    true,
  );
  assert.equal(categoryLooksLikeBusinessName('General contractor', 'Tom Griffith Construction Inc'), false);
});

test('sanitizeLeadCategoryName rejects business-name categories', () => {
  assert.equal(
    sanitizeLeadCategoryName('RIGHTWAY CONSTRUCTION SIDING AND REPAIR', 'Rightway Construction Siding and Repair'),
    'N/A',
  );
  assert.equal(sanitizeLeadCategoryName('Kitchen remodeler', 'Tom Griffith Construction Inc'), 'Kitchen remodeler');
});
