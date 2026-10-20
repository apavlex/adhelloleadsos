/**
 * Workspace accent tints (bg-brand-yellow/15, etc.) must compile against CSS variables.
 * Bare var(--brand-yellow) colors drop opacity modifiers, so custom blues never tinted.
 */
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { cssVarColor, appBrandColors } = require('../lib/tailwindBrandColors');

const css = fs.readFileSync(path.join(__dirname, '..', 'public/css/tailwind.css'), 'utf8');
const engagement = fs.readFileSync(path.join(__dirname, '..', 'views/engagement.ejs'), 'utf8');

test('cssVarColor emits color-mix for opacity modifiers', () => {
  assert.equal(cssVarColor('--brand-yellow')({}), 'var(--brand-yellow)');
  assert.equal(
    cssVarColor('--brand-yellow')({ opacityValue: '0.15' }),
    'color-mix(in srgb, var(--brand-yellow) 15%, transparent)',
  );
  assert.equal(typeof appBrandColors.yellow, 'function');
});

test('compiled Tailwind includes brand-yellow opacity utilities', () => {
  assert.match(css, /bg-brand-yellow\\\/15\{[^}]*color-mix\(in srgb,\s*var\(--brand-yellow\)\s*15%/);
  assert.match(css, /border-brand-yellow\\\/50\{[^}]*color-mix\(in srgb,\s*var\(--brand-yellow\)\s*50%/);
  assert.match(css, /border-brand-yellow\\\/30\{[^}]*var\(--brand-yellow\)/);
});

test('Engagement inbox accent chips use brand-yellow (workspace accent)', () => {
  assert.match(engagement, /text-brand-yellow/);
  assert.match(engagement, /bg-brand-yellow\/15/);
  assert.match(engagement, /border-brand-yellow\/50/);
  assert.match(engagement, /dark:text-brand-yellow/);
  assert.match(engagement, /bg-brand-yellow/);
  // Solid accent CTA relies on --brand-on-accent via custom.css, not text-brand-dark.
  assert.doesNotMatch(
    engagement,
    /bg-brand-yellow text-brand-dark/,
  );
});
