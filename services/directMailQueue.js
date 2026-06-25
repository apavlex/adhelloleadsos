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

async function resolveLeadKeyForQueue(rawKey, visibleLeads, workspaceId) {
  const visibleKeys = new Set((visibleLeads || []).map((l) => l.key));
  const fromVisible = resolveLeadKey(rawKey, visibleKeys);
  if (fromVisible) return fromVisible;

  const resolved = await dbService.resolveLeadStorageKey(rawKey, workspaceId);
  if (!resolved) return null;
  if (visibleKeys.has(resolved)) return resolved;

  const short = resolved.replace(/^lead:/i, '');
  for (const key of visibleKeys) {
    if (String(key).replace(/^lead:/i, '') === short) return key;
  }
  return null;
}

function leadQueuedAt(lead) {
  const updates = Array.isArray(lead && lead.updates) ? lead.updates : [];
  for (let i = updates.length - 1; i >= 0; i -= 1) {
    const u = updates[i];
    if (u && u.type === 'direct_mail_queued' && u.timestamp) return String(u.timestamp);
  }
  const logs = Array.isArray(lead && lead.logs) ? lead.logs : [];
  for (let j = logs.length - 1; j >= 0; j -= 1) {
    const log = logs[j];
    if (log && log.type === 'direct_mail_queued' && log.timestamp) return String(log.timestamp);
  }
  return '';
}

function serializeQueuedLead(lead, extra = {}) {
  return {
    key: lead.key,
    title: lead.title || 'Lead',
    address: lead.address || '',
    city: lead.city || '',
    state: lead.state || '',
    mailable: lobDirectMail.hasMailableAddress(lead),
    addedAt: leadQueuedAt(lead) || extra.addedAt || '',
    alreadyQueued: !!extra.alreadyQueued,
  };
}

/**
 * List leads currently tagged / filed for direct mail in this workspace.
 * @param {string} workspaceId
 * @param {object[]} visibleLeads
 */
async function listDirectMailQueueLeads(workspaceId, visibleLeads) {
  const folder = await ensureDirectMailFolder(workspaceId);
  const tag = await ensureDirectMailListTag(workspaceId);
  const folderKey = String(folder.key || '').trim();
  const tagKey = String(tag.key || '').trim();
  const out = [];
  const seen = new Set();

  for (const lead of visibleLeads || []) {
    if (!lead || !lead.key || seen.has(lead.key)) continue;
    const inFolder = folderKey && String(lead.folderKey || '') === folderKey;
    const tags = dbService.normalizeTagKeys(lead.tags);
    const hasTag = tagKey && tags.includes(tagKey);
    if (!inFolder && !hasTag) continue;
    seen.add(lead.key);
    out.push(serializeQueuedLead(lead));
  }

  out.sort((a, b) => String(b.addedAt || '').localeCompare(String(a.addedAt || '')));
  return {
    folderKey,
    folderName: folder.name || DIRECT_MAIL_FOLDER_NAME,
    tagKey,
    tagName: tag.name || DIRECT_MAIL_TAG_NAME,
    leads: out,
  };
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
    const fullKey = await resolveLeadKeyForQueue(raw, visibleLeads, workspaceId);
    if (!fullKey) {
      skipped += 1;
      continue;
    }
    const existing = visibleByKey.get(fullKey);
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
    out.push(
      serializeQueuedLead(updated, {
        alreadyQueued,
        addedAt: new Date().toISOString(),
      }),
    );
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
  listDirectMailQueueLeads,
  addLeadsToDirectMailQueue,
};
