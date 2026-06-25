/**
 * Queue leads for direct mail — folder + tag + activity log.
 */

const dbService = require('./database');
const { OUTREACH_LIST_TAG_NAMES } = require('../config/lmvProspectingMethods');
const lobDirectMail = require('./lobDirectMail');

const DIRECT_MAIL_FOLDER_NAME = 'Direct Mail';
const DIRECT_MAIL_TAG_NAME = OUTREACH_LIST_TAG_NAMES.directMail || 'Direct Mail List';

function appendLeadUpdate(lead, entry) {
  const updates = Array.isArray(lead && lead.updates) ? [...lead.updates] : [];
  updates.push({ timestamp: new Date().toISOString(), ...entry });
  return updates;
}

function resolveLeadKey(rawKey, visibleKeys) {
  const k = String(rawKey || '').trim();
  if (!k) return null;
  const candidates = [k, k.startsWith('lead:') ? k : `lead:${k}`, k.startsWith('lead:') ? k.slice(5) : null].filter(
    Boolean,
  );
  for (const c of candidates) {
    if (visibleKeys.has(c)) return c;
  }
  return null;
}

async function ensureDirectMailFolder(workspaceId) {
  const wid = workspaceId || 'default';
  const folders = await dbService.listFolders(wid);
  const hit = (folders || []).find(
    (f) => String(f.name || '').trim().toLowerCase() === DIRECT_MAIL_FOLDER_NAME.toLowerCase(),
  );
  if (hit) return hit;
  return dbService.createFolder(wid, DIRECT_MAIL_FOLDER_NAME, { isDirectMailFolder: true });
}

async function ensureDirectMailListTag(workspaceId) {
  const wid = workspaceId || 'default';
  const tags = await dbService.listTags(wid);
  const want = DIRECT_MAIL_TAG_NAME.toLowerCase();
  const hit = (tags || []).find((t) => String(t.name || '').trim().toLowerCase() === want);
  if (hit) return hit;
  return dbService.createTag(wid, DIRECT_MAIL_TAG_NAME);
}

/**
 * Tag leads and move them into the Direct Mail folder.
 * @param {string} workspaceId
 * @param {string[]} leadKeys
 * @param {object[]} visibleLeads — leads the user can access
 */
async function addLeadsToDirectMailQueue(workspaceId, leadKeys, visibleLeads) {
  const keysIn = (Array.isArray(leadKeys) ? leadKeys : [])
    .map((k) => String(k || '').trim())
    .filter(Boolean);
  if (!keysIn.length) {
    return { added: 0, skipped: 0, folderKey: '', tagKey: '', leads: [] };
  }

  const folder = await ensureDirectMailFolder(workspaceId);
  const tag = await ensureDirectMailListTag(workspaceId);
  const folderKey = String(folder.key || '').trim();
  const tagKey = String(tag.key || '').trim();
  const visibleByKey = new Map((visibleLeads || []).map((l) => [l.key, l]));
  const visibleKeys = new Set(visibleByKey.keys());

  const out = [];
  let added = 0;
  let skipped = 0;

  for (const raw of keysIn) {
    const fullKey = resolveLeadKey(raw, visibleKeys);
    if (!fullKey) {
      skipped += 1;
      continue;
    }
    const existing = visibleByKey.get(fullKey) || (await dbService.getLead(fullKey));
    if (!existing) {
      skipped += 1;
      continue;
    }

    const prevTags = dbService.normalizeTagKeys(existing.tags);
    const nextTags = dbService.normalizeTagKeys([...prevTags, tagKey]);
    const alreadyQueued =
      String(existing.folderKey || '') === folderKey && prevTags.includes(tagKey);

    const patch = {
      folderKey,
      tags: nextTags,
      updates: appendLeadUpdate(existing, {
        type: 'direct_mail_queued',
        value: 'Added to Direct Mail queue',
      }),
      logs: [
        {
          type: 'direct_mail_queued',
          message: 'Queued for direct mail',
          timestamp: new Date().toISOString(),
        },
      ],
    };

    const updated = await dbService.updateLead(fullKey, patch, workspaceId);
    out.push({
      key: updated.key,
      title: updated.title || existing.title || 'Lead',
      address: updated.address || existing.address || '',
      city: updated.city || existing.city || '',
      state: updated.state || existing.state || '',
      mailable: lobDirectMail.hasMailableAddress(updated),
      alreadyQueued,
    });
    if (!alreadyQueued) added += 1;
    else skipped += 1;
  }

  return {
    added,
    skipped,
    folderKey,
    tagKey,
    folderName: folder.name || DIRECT_MAIL_FOLDER_NAME,
    tagName: tag.name || DIRECT_MAIL_TAG_NAME,
    leads: out,
  };
}

module.exports = {
  DIRECT_MAIL_FOLDER_NAME,
  DIRECT_MAIL_TAG_NAME,
  ensureDirectMailFolder,
  ensureDirectMailListTag,
  addLeadsToDirectMailQueue,
};
