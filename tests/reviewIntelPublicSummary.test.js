const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  toPublicReviewSummary,
  toPublicReviewSnippet,
} = require('../services/reviewIntel');

test('toPublicReviewSummary strips sales-coaching sentences', () => {
  const raw =
    '4 Elements Landscape & Design has a perfect 5-star rating from 2 reviews, and customers praise the team for going out of their way. A good sales angle is to use their strong reputation and positive customer feedback to discuss ways to attract more local leads and improve visibility.';
  const out = toPublicReviewSummary(raw);
  assert.match(out, /5-star|praise|going out of their way/i);
  assert.doesNotMatch(out, /sales angle/i);
  assert.doesNotMatch(out, /attract more local leads/i);
});

test('toPublicReviewSnippet drops hunt labels for public quotes', () => {
  const raw =
    '[Highest rated] 5★ — Micahel Andreyev: "what an amazing company, they really went out of their way"';
  const out = toPublicReviewSnippet(raw);
  assert.doesNotMatch(out, /Highest rated/i);
  assert.match(out, /amazing company/i);
  assert.match(out, /Micahel Andreyev/i);
});

test('reviewIntel prompt is customer-facing, not sales-rep coaching', () => {
  const src = fs.readFileSync(path.join(__dirname, '../services/reviewIntel.js'), 'utf8');
  assert.match(src, /Google-Maps-style|customer-facing|Google Business Profile/i);
  assert.match(src, /Never coach sales/);
  assert.doesNotMatch(src, /agency sales reps calling/);
  assert.doesNotMatch(src, /End with one practical angle for a sales conversation/);
});
