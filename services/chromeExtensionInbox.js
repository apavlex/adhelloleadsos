/**
 * Inbox folder for leads saved via the Chrome extension.
 */

const dbService = require('./database');

const CHROME_EXTENSION_FOLDER_NAME = 'Chrome Extension';

async function ensureChromeExtensionFolder(workspaceId) {
  const wid = workspaceId || 'default';
  const folders = await dbService.listFolders(wid);
  const hit = (folders || []).find(
    (f) => String(f.name || '').trim().toLowerCase() === CHROME_EXTENSION_FOLDER_NAME.toLowerCase(),
  );
  if (hit) return hit;
  return dbService.createFolder(wid, CHROME_EXTENSION_FOLDER_NAME, {
    isChromeExtensionFolder: true,
  });
}

function chromeExtensionFolderUrl(folderKey) {
  const key = String(folderKey || '').trim();
  if (!key) return '/prospecting?tab=pipeline';
  return `/prospecting?tab=pipeline&folderKey=${encodeURIComponent(key)}`;
}

module.exports = {
  CHROME_EXTENSION_FOLDER_NAME,
  ensureChromeExtensionFolder,
  chromeExtensionFolderUrl,
};
