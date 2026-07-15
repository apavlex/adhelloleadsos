const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  getChromeExtensionRoot,
  isChromeExtensionAvailable,
  ZIP_ROOT_FOLDER,
} = require('../services/chromeExtensionPack');

test('chrome extension pack finds bundled extension files', () => {
  assert.equal(isChromeExtensionAvailable(), true);
  const root = getChromeExtensionRoot();
  assert.equal(fs.existsSync(path.join(root, 'manifest.json')), true);
  assert.equal(fs.existsSync(path.join(root, 'icons', 'icon48.png')), true);
  assert.equal(ZIP_ROOT_FOLDER, 'adhello-leads-chrome-extension');
});
