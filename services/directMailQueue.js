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

function queuedDayFromTimestamp(iso) {
  const s = String(iso || '').trim();
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function normalizeCategoryName(raw) {
  const c = String(raw || '').trim();
  if (!c || c === 'N/A') return 'Uncategorized';
  return c;
}

function serializeQueuedLead(lead, extra = {}) {
  const addedAt = leadQueuedAt(lead) || extra.addedAt || '';
  return {
    key: lead.key,
    title: lead.title || 'Lead',
    address: lead.address || '',
    city: lead.city || '',
    state: lead.state || '',
    categoryName: normalizeCategoryName(lead.categoryName),
    mailable: lobDirectMail.hasMailableAddress(lead),
    addedAt,
    queuedDay: queuedDayFromTimestamp(addedAt),
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

/**
 * Remove direct mail tag (and clear Direct Mail folder when set) from selected leads.
 */
async function removeLeadsFromDirectMailQueue(workspaceId, leadKeys, visibleLeads) {
  const keysIn = (Array.isArray(leadKeys) ? leadKeys : [])
    .map((k) => String(k || '').trim())
    .filter(Boolean);
  if (!keysIn.length) {
    return { removed: 0, skipped: 0, folderKey: '', tagKey: '', leadKeys: [] };
  }

  const folder = await ensureDirectMailFolder(workspaceId);
  const tag = await ensureDirectMailListTag(workspaceId);
  const folderKey = String(folder.key || '').trim();
  const tagKey = String(tag.key || '').trim();
  const visibleByKey = new Map((visibleLeads || []).map((l) => [l.key, l]));

  const out = [];
  let removed = 0;
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
    const nextTags = prevTags.filter((t) => t !== tagKey);
    const inDmFolder = folderKey && String(existing.folderKey || '') === folderKey;
    const hadTag = tagKey && prevTags.includes(tagKey);
    if (!inDmFolder && !hadTag) {
      skipped += 1;
      continue;
    }

    const patch = {
      tags: nextTags,
      updates: appendLeadUpdate(existing, {
        type: 'direct_mail_removed',
        value: 'Removed from Direct Mail queue',
      }),
      logs: [
        {
          type: 'direct_mail_removed',
          message: 'Removed from Direct Mail queue',
          timestamp: new Date().toISOString(),
        },
      ],
    };
    if (inDmFolder) patch.folderKey = '';

    // eslint-disable-next-line no-await-in-loop
    await dbService.updateLead(fullKey, patch, workspaceId);
    out.push(fullKey);
    removed += 1;
  }

  return {
    removed,
    skipped,
    folderKey,
    tagKey,
    folderName: folder.name || DIRECT_MAIL_FOLDER_NAME,
    tagName: tag.name || DIRECT_MAIL_TAG_NAME,
    leadKeys: out,
  };
}

function isClosedWonOrLostStatus(lead) {
  const status = String((lead && lead.status) || '').toLowerCase();
  if (/closed\s*-?\s*(won|lost)/.test(status)) return true;
  return status === 'won' || status === 'lost' || status === 'closed won' || status === 'closed lost';
}

function leadAlreadyInDirectMail(lead, folderKey, tagKey) {
  if (!lead) return false;
  const inFolder = folderKey && String(lead.folderKey || '').trim() === String(folderKey).trim();
  const tags = dbService.normalizeTagKeys(lead.tags);
  const hasTag = tagKey && tags.includes(tagKey);
  return !!(inFolder || hasTag);
}

/**
 * Queue one lead for Direct Mail if not already queued and not Closed-Won/Lost.
 * Used when auto-outreach enrolls a lead.
 */
async function queueLeadForDirectMailIfEligible(workspaceId, lead) {
  if (!lead || !lead.key) return { queued: false, reason: 'missing_lead' };
  if (isClosedWonOrLostStatus(lead)) return { queued: false, reason: 'closed' };

  const folder = await ensureDirectMailFolder(workspaceId);
  const tag = await ensureDirectMailListTag(workspaceId);
  const folderKey = String(folder.key || '').trim();
  const tagKey = String(tag.key || '').trim();
  if (leadAlreadyInDirectMail(lead, folderKey, tagKey)) {
    return { queued: false, reason: 'already_queued', folderKey, tagKey };
  }

  const result = await addLeadsToDirectMailQueue(workspaceId, [lead.key], [lead]);
  return {
    queued: Number(result.added || 0) > 0,
    reason: Number(result.added || 0) > 0 ? 'queued' : 'skipped',
    folderKey: result.folderKey || folderKey,
    tagKey: result.tagKey || tagKey,
    added: result.added || 0,
    skipped: result.skipped || 0,
  };
}

module.exports = {
  DIRECT_MAIL_FOLDER_NAME,
  DIRECT_MAIL_TAG_NAME,
  ensureDirectMailFolder,
  ensureDirectMailListTag,
  listDirectMailQueueLeads,
  addLeadsToDirectMailQueue,
  queueLeadForDirectMailIfEligible,
  isClosedWonOrLostStatus,
  leadAlreadyInDirectMail,
  removeLeadsFromDirectMailQueue,
  leadQueuedAt,
  queuedDayFromTimestamp,
  normalizeCategoryName,
};
