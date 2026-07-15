/**
 * Package the chrome-extension/ folder as a zip for "Load unpacked" installs.
 */
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const EXTENSION_ROOT = path.join(__dirname, '..', 'chrome-extension');
const ZIP_ROOT_FOLDER = 'adhello-leads-chrome-extension';
const ZIP_FILENAME = 'adhello-leads-chrome-extension.zip';

function getChromeExtensionRoot() {
  return EXTENSION_ROOT;
}

function isChromeExtensionAvailable() {
  return fs.existsSync(path.join(EXTENSION_ROOT, 'manifest.json'));
}

/**
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
function streamChromeExtensionZip(res) {
  if (!isChromeExtensionAvailable()) {
    return Promise.reject(new Error('Chrome extension files are not available on this server.'));
  }

  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('error', reject);
    res.on('close', resolve);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${ZIP_FILENAME}"`);
    archive.pipe(res);
    archive.directory(EXTENSION_ROOT, ZIP_ROOT_FOLDER);
    archive.finalize();
  });
}

module.exports = {
  ZIP_ROOT_FOLDER,
  ZIP_FILENAME,
  getChromeExtensionRoot,
  isChromeExtensionAvailable,
  streamChromeExtensionZip,
};
