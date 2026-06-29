/**
 * Merge multiple workspace leads into one primary record (multi-location / name variants).
 */

const { mergeTagLists } = require('./ghlSyncHelpers');
const { normalizePhone, normalizeEmail } = require('./leadDedupe');

function isBlank(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') {
    const s = value.trim();
    return s === '' || s.toLowerCase() === 'n/a' || s === '—' || s === '-';
  }
  return false;
}

function coalesceField(primary, secondary, field) {
  const cur = primary ? primary[field] : undefined;
  const inc = secondary ? secondary[field] : undefined;
  if (isBlank(cur) && !isBlank(inc)) return inc;
  return cur;
}

function contactIdentity(contact) {
  if (!contact || typeof contact !== 'object') return '';
  const phone = normalizePhone(contact.phone);
  if (phone) return `p:${phone}`;
  const email = normalizeEmail(contact.email);
  if (email) return `e:${email}`;
  const name = String(contact.name || '').trim().toLowerCase();
  return name ? `n:${name}` : '';
}

function mergeContacts(primaryContacts, secondaryContacts) {
  const out = [];
  const seen = new Set();
  [...(Array.isArray(primaryContacts) ? primaryContacts : []), ...(Array.isArray(secondaryContacts) ? secondaryContacts : [])].forEach(
    (contact) => {
      const id = contactIdentity(contact);
      if (!id || seen.has(id)) return;
      seen.add(id);
      out.push(contact);
    },
  );
  return out;
}

function snapshotLocation(lead, sourceLeadKey) {
  if (!lead || typeof lead !== 'object') return null;
  const snap = {
    title: String(lead.title || '').trim(),
    address: String(lead.address || '').trim(),
    city: String(lead.city || '').trim(),
    state: String(lead.state || '').trim(),
    phone: String(lead.phone || '').trim(),
    email: String(lead.email || '').trim(),
    website: String(lead.website || '').trim(),
    url: String(lead.url || '').trim(),
    sourceLeadKey: String(sourceLeadKey || lead.key || '').trim(),
    mergedAt: new Date().toISOString(),
  };
  if (
    !snap.title &&
    !snap.address &&
    !snap.city &&
    !snap.phone &&
    !snap.email &&
    !snap.website &&
    !snap.url
  ) {
    return null;
  }
  return snap;
}

function locationIdentity(loc) {
  if (!loc || typeof loc !== 'object') return '';
  return [
    String(loc.title || '').trim().toLowerCase(),
    String(loc.address || '').trim().toLowerCase(),
    String(loc.city || '').trim().toLowerCase(),
    String(loc.state || '').trim().toLowerCase(),
    normalizePhone(loc.phone),
    normalizeEmail(loc.email),
    String(loc.url || '').trim().toLowerCase(),
  ].join('|');
}

function mergeLocationLists(primaryLocations, secondaryLocations, extraSnapshots) {
  const out = [];
  const seen = new Set();
  const add = (loc) => {
    if (!loc || typeof loc !== 'object') return;
    const id = locationIdentity(loc);
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(loc);
  };
  (Array.isArray(primaryLocations) ? primaryLocations : []).forEach(add);
  (Array.isArray(secondaryLocations) ? secondaryLocations : []).forEach(add);
  (Array.isArray(extraSnapshots) ? extraSnapshots : []).forEach(add);
  return out;
}

function mergeReviewSnippets(primary, secondary) {
  const seen = new Set();
  const out = [];
  [...(Array.isArray(primary) ? primary : []), ...(Array.isArray(secondary) ? secondary : [])].forEach((snippet) => {
    const s = String(snippet || '').trim();
    if (!s) return;
    const key = s.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(s);
  });
  return out;
}

function pickHigherReviews(primary, secondary) {
  const patch = {};
  const pCount = parseInt(String(primary?.reviewsCount ?? ''), 10);
  const sCount = parseInt(String(secondary?.reviewsCount ?? ''), 10);
  if (Number.isFinite(sCount) && sCount > 0 && (!Number.isFinite(pCount) || sCount > pCount)) {
    patch.reviewsCount = secondary.reviewsCount;
  }
  const pRating = parseFloat(String(primary?.totalScore ?? ''));
  const sRating = parseFloat(String(secondary?.totalScore ?? ''));
  if (Number.isFinite(sRating) && sRating > 0 && (!Number.isFinite(pRating) || sRating > pRating)) {
    patch.totalScore = secondary.totalScore;
  }
  return patch;
}

function mergeSecondaryIntoPrimary(primary, secondary, secondaryKey) {
  const merged = { ...primary };
  const scalarFields = [
    'email',
    'phone',
    'website',
    'address',
    'city',
    'state',
    'zip',
    'url',
    'companyDomain',
    'categoryName',
    'sourceChannel',
    'ghlContactId',
    'auditSummary',
    'facebook',
    'instagram',
    'linkedin',
    'assignedTo',
  ];
  scalarFields.forEach((field) => {
    merged[field] = coalesceField(primary, secondary, field);
  });

  Object.assign(merged, pickHigherReviews(primary, secondary));

  merged.tags = mergeTagLists(primary.tags, secondary.tags);
  merged.contacts = mergeContacts(primary.contacts, secondary.contacts);
  merged.updates = [
    ...(Array.isArray(primary.updates) ? primary.updates : []),
    ...(Array.isArray(secondary.updates) ? secondary.updates : []),
  ];
  merged.logs = [
    ...(Array.isArray(primary.logs) ? primary.logs : []),
    ...(Array.isArray(secondary.logs) ? secondary.logs : []),
    {
      type: 'merge',
      message: `Merged "${String(secondary.title || 'Lead').trim()}" into this record (multi-location)`,
      timestamp: new Date().toISOString(),
      mergedLeadKey: String(secondaryKey || secondary.key || '').trim(),
    },
  ];
  merged.chatHistory = [
    ...(Array.isArray(primary.chatHistory) ? primary.chatHistory : []),
    ...(Array.isArray(secondary.chatHistory) ? secondary.chatHistory : []),
  ];
  merged.reviewSnippets = mergeReviewSnippets(primary.reviewSnippets, secondary.reviewSnippets);
  merged.importFields = {
    ...(typeof primary.importFields === 'object' && primary.importFields ? primary.importFields : {}),
    ...(typeof secondary.importFields === 'object' && secondary.importFields ? secondary.importFields : {}),
  };

  if (isBlank(primary.ghlContactId) && !isBlank(secondary.ghlContactId)) {
    merged.ghlContactId = secondary.ghlContactId;
  }

  const primarySnap = snapshotLocation(primary, primary.key);
  const secondarySnap = snapshotLocation(secondary, secondaryKey || secondary.key);
  const snapshots = [];
  if (secondarySnap && locationIdentity(secondarySnap) !== locationIdentity(primarySnap)) {
    snapshots.push(secondarySnap);
  }
  merged.leadLocations = mergeLocationLists(primary.leadLocations, secondary.leadLocations, snapshots);

  if (
    !isBlank(secondary.title) &&
    String(secondary.title || '').trim().toLowerCase() !== String(primary.title || '').trim().toLowerCase()
  ) {
    const altTitles = mergeTagLists(primary.alternateTitles, [secondary.title]);
    merged.alternateTitles = altTitles;
  } else if (Array.isArray(primary.alternateTitles)) {
    merged.alternateTitles = primary.alternateTitles;
  }

  merged.updatedAt = new Date().toISOString();
  return merged;
}

/**
 * @param {object} opts
 * @param {import('./database')} opts.dbService
 * @param {string} opts.workspaceId
 * @param {string[]} opts.keys - lead keys in selection order (first = default primary)
 * @param {string} [opts.primaryKey]
 */
async function mergeLeadsByKeys({ dbService, workspaceId, keys, primaryKey }) {
  const normKeys = [...new Set((keys || []).map((k) => String(k || '').trim()).filter(Boolean))];
  if (normKeys.length < 2) {
    return { success: false, error: 'Select at least two leads to merge.' };
  }

  const resolved = [];
  for (const raw of normKeys) {
    // eslint-disable-next-line no-await-in-loop
    const storageKey = await dbService.resolveLeadStorageKey(raw, workspaceId);
    if (!storageKey) {
      return { success: false, error: `Lead not found: ${raw}` };
    }
    // eslint-disable-next-line no-await-in-loop
    const lead = await dbService.getLead(storageKey);
    if (!lead) {
      return { success: false, error: `Lead not found: ${raw}` };
    }
    // eslint-disable-next-line no-await-in-loop
    const belongs = await dbService.leadBelongsToWorkspace(lead, workspaceId);
    if (!belongs) {
      return { success: false, error: 'One or more leads are in another workspace.' };
    }
    resolved.push({ storageKey, lead: { ...lead, key: lead.key || storageKey } });
  }

  const wantPrimary = String(primaryKey || normKeys[0] || '').trim();
  const wantPrimaryNorm = wantPrimary.replace(/^lead:/i, '');
  const primaryEntry =
    resolved.find((r) => r.storageKey === wantPrimary || r.lead.key === wantPrimary) ||
    resolved.find((r) => String(r.lead.key || '').replace(/^lead:/i, '') === wantPrimaryNorm) ||
    resolved.find((r) => String(r.storageKey || '').replace(/^lead:/i, '') === wantPrimaryNorm) ||
    resolved[0];
  const secondaryEntries = resolved.filter((r) => r.storageKey !== primaryEntry.storageKey);

  let mergedLead = { ...primaryEntry.lead, key: primaryEntry.storageKey };
  const mergedAwayKeys = [];

  secondaryEntries.forEach(({ storageKey, lead }) => {
    mergedLead = mergeSecondaryIntoPrimary(mergedLead, lead, storageKey);
    mergedAwayKeys.push(storageKey);
  });

  await dbService.updateLead(
    primaryEntry.storageKey,
    {
      ...mergedLead,
      logsMode: 'replace',
      chatHistoryMode: 'replace',
    },
    workspaceId,
  );
  for (const key of mergedAwayKeys) {
    // eslint-disable-next-line no-await-in-loop
    await dbService.deleteLead(key);
  }

  return {
    success: true,
    primaryKey: primaryEntry.storageKey,
    mergedCount: mergedAwayKeys.length,
    mergedAwayKeys,
    lead: mergedLead,
  };
}

module.exports = {
  mergeLeadsByKeys,
  mergeSecondaryIntoPrimary,
  snapshotLocation,
  mergeLocationLists,
};
