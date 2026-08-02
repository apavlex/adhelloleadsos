const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyDriveImage } = require('../services/googleDriveImages');

test('classifyDriveImage accepts common image types', () => {
  assert.equal(classifyDriveImage('image/png', 'logo.png'), 'image');
  assert.equal(classifyDriveImage('image/jpeg', 'photo.jpg'), 'image');
  assert.equal(classifyDriveImage('application/octet-stream', 'art.PNG'), 'image');
  assert.equal(
    classifyDriveImage('application/vnd.google-apps.drawing', 'Logo'),
    'drawing',
  );
  assert.equal(classifyDriveImage('text/csv', 'leads.csv'), null);
});
