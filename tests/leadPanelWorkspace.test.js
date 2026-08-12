const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isAgencySalesWorkspace } = require('../services/leadPanelWorkspace');

test('isAgencySalesWorkspace true for agency preset', () => {
  assert.equal(isAgencySalesWorkspace({ salesScriptsPresetKey: 'agency' }), true);
});

test('isAgencySalesWorkspace false for retail/install workspace', () => {
  assert.equal(
    isAgencySalesWorkspace({ name: 'Premier Flooring', salesScriptsPresetKey: 'retail_install' }),
    false,
  );
});

test('isAgencySalesWorkspace true for AdHello agency by slug', () => {
  assert.equal(
    isAgencySalesWorkspace({ name: 'AdHello Agency', slug: 'adhello-agency' }),
    true,
  );
});
