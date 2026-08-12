/**
 * Enroll leads in auto outreach via GHL workflow (tag auto-outreach + sync contact).
 * Sends are handled in GHL when the contact tag triggers a workflow — not an internal cadence.
 */
const dbService = require('./database');
const { scoreLocalProspect } = require('./localProspectScore');
const { scoreLeadRecord } = require('./opportunityScore');
const phoneLineType = require('./phoneLineType');
const { triggerGhlProspectSync } = require('./ghlProspectSync');

const AUTO_OUTREACH_TAG_NAME = 'auto-outreach';
const AUTO_OUTREACH_CAMPAIGN = 'auto_outreach_7';
/** Workspace-wide GHL safety cap: enrolls (tag pushes) per UTC day to avoid spam flags. */
const AUTO_OUTREACH_DAILY_CAP = 100;

function fullLeadKey(key) {
  const k = String(key || '').trim();
  if (!k) return '';
  return k.startsWith('lead:') ? k : `lead:${k}`;
}

function isActiveCadence(lead) {
  return !!(
    lead &&
    lead.sequenceState &&
    lead.sequenceState.status &&
    lead.sequenceState.status !== 'completed'
  );
}

function isActiveProspecting(lead) {
  const p = lead && lead.prospecting;
  return !!(p && p.status === 'active' && p.campaign === AUTO_OUTREACH_CAMPAIGN);
}

/** Active internal cadence on a template other than legacy auto_outreach_7. */
function isActiveOtherCadence(lead) {
  if (!isActiveCadence(lead)) return false;
  const tid = String((lead.sequenceState && lead.sequenceState.templateId) || '');
  if (tid === AUTO_OUTREACH_CAMPAIGN) return false;
  return true;
}

async function resolveAutoOutreachTagKey(workspaceId) {
  const tags = await dbService.listTags(workspaceId);
  const found = tags.find(
    (t) => String(t.name || '').trim().toLowerCase() === AUTO_OUTREACH_TAG_NAME,
  );
  if (found && found.key) return found.key;
  const created = await dbService.createTag(workspaceId, AUTO_OUTREACH_TAG_NAME, '#EAB308');
  return created.key;
}

async function leadHasAutoOutreachTag(lead, workspaceId) {
  const tagKey = await resolveAutoOutreachTagKey(workspaceId);
  const keys = dbService.normalizeTagKeys(lead && lead.tags);
  return keys.includes(tagKey);
}

function leadMatchesFilter(lead, filter = {}) {
  if (!lead || !filter || typeof filter !== 'object') return true;
  if (filter.tier) {
    const want = String(filter.tier).trim();
    const tier =
      lead.prospectTier ||
      scoreLocalProspect(lead).prospectTier ||
      '';
    if (String(tier).toLowerCase() !== want.toLowerCase()) return false;
  }
  if (filter.minScore != null && filter.minScore !== '') {
    const min = parseFloat(filter.minScore);
    const scored = scoreLeadRecord(lead);
    if (Number.isFinite(min) && scored.score < min) return false;
  }
  if (filter.folderKey) {
    if (String(lead.folderKey || '').trim() !== String(filter.folderKey).trim()) return false;
  }
  if (filter.tagKey) {
    const keys = dbService.normalizeTagKeys(lead.tags);
    if (!keys.includes(String(filter.tagKey).trim())) return false;
  }
  return true;
}

function utcDayKey(isoOrDate) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate || Date.now());
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function leadAutoOutreachEnrolledOnDay(lead, dayKey) {
  if (!lead || !dayKey) return false;
  const p = lead.prospecting;
  if (!p || p.campaign !== AUTO_OUTREACH_CAMPAIGN) return false;
  const at = p.lastEnrolledAt || p.enrolledAt || '';
  return utcDayKey(at) === dayKey;
}

/**
 * Count workspace auto-outreach enrolls for a UTC calendar day (GHL spam budget).
 * @param {string} workspaceId
 * @param {string} [dayKey] YYYY-MM-DD UTC
 */
async function countAutoOutreachEnrollsToday(workspaceId, dayKey) {
  const wid = String(workspaceId || 'default').trim() || 'default';
  const day = dayKey || utcDayKey(new Date());
  const all = await dbService.getAllLeads(wid);
  let n = 0;
  for (const lead of all) {
    if (leadAutoOutreachEnrolledOnDay(lead, day)) n += 1;
  }
  return n;
}

async function remainingAutoOutreachDailyBudget(workspaceId, dayKey) {
  const used = await countAutoOutreachEnrollsToday(workspaceId, dayKey);
  return Math.max(0, AUTO_OUTREACH_DAILY_CAP - used);
}

/**
 * @param {{ leadKey: string, workspaceId: string, reEnroll?: boolean, tagLead?: boolean }} opts
 */
async function enrollLeadInAutoOutreach(opts) {
  const workspaceId = String(opts.workspaceId || 'default').trim() || 'default';
  const key = fullLeadKey(opts.leadKey);
  if (!key) return { enrolled: false, reason: 'missing_lead_key' };

  let lead = await dbService.getLead(key, workspaceId);
  if (!lead) return { enrolled: false, reason: 'missing_lead', leadKey: key };

  if (phoneLineType.hasUsablePhone(lead.phone)) {
    const linePatch = await phoneLineType.refreshIfNeeded(lead, null);
    if (linePatch) {
      lead = await dbService.updateLead(key, linePatch, workspaceId);
    }
  }

  const reEnroll = opts.reEnroll === true;
  if (isActiveProspecting(lead) && !reEnroll) {
    return { enrolled: false, reason: 'already_enrolled', leadKey: key };
  }
  if (isActiveOtherCadence(lead) && !reEnroll) {
    return { enrolled: false, reason: 'active_other_cadence', leadKey: key };
  }

  const today = utcDayKey(new Date());
  // Re-enrolling the same lead again today does not consume another GHL send budget slot.
  const alreadyCountedToday = leadAutoOutreachEnrolledOnDay(lead, today);
  if (!alreadyCountedToday) {
    const remaining =
      typeof opts._remainingBudget === 'number'
        ? opts._remainingBudget
        : await remainingAutoOutreachDailyBudget(workspaceId, today);
    if (remaining <= 0) {
      return {
        enrolled: false,
        reason: 'daily_cap_reached',
        leadKey: key,
        dailyCap: AUTO_OUTREACH_DAILY_CAP,
      };
    }
  }

  const now = new Date().toISOString();

  let tags = dbService.normalizeTagKeys(lead.tags);
  if (opts.tagLead !== false) {
    const tagKey = await resolveAutoOutreachTagKey(workspaceId);
    if (!tags.includes(tagKey)) tags = dbService.normalizeTagKeys([...tags, tagKey]);
  }

  const prospecting = {
    enrolledAt: lead.prospecting && lead.prospecting.enrolledAt ? lead.prospecting.enrolledAt : now,
    campaign: AUTO_OUTREACH_CAMPAIGN,
    status: 'active',
    lastEnrolledAt: now,
  };
  const senderOfferKey = String(opts.senderOfferKey || '').trim();
  if (senderOfferKey) {
    prospecting.senderOfferKey = senderOfferKey;
  } else if (lead.prospecting && lead.prospecting.senderOfferKey) {
    prospecting.senderOfferKey = String(lead.prospecting.senderOfferKey).trim();
  }

  const updated = await dbService.updateLead(
    key,
    {
      tags,
      prospecting,
      logs: [
        {
          type: 'prospecting_enroll',
          message: reEnroll
            ? 'Re-enrolled in auto outreach — tagged auto-outreach and synced to GHL workflow'
            : 'Enrolled in auto outreach — tagged auto-outreach and synced to GHL workflow',
          timestamp: now,
        },
      ],
    },
    workspaceId,
  );

  try {
    triggerGhlProspectSync(key, workspaceId, { trigger: 'auto_outreach_enroll' });
  } catch (_) {
    /* non-fatal */
  }

  return {
    enrolled: true,
    leadKey: key,
    lead: updated,
    reEnroll: !!reEnroll,
    budgetConsumed: !alreadyCountedToday,
  };
}

/**
 * @param {{ workspaceId: string, leadKeys?: string[], filter?: object, reEnroll?: boolean, tag?: string }} opts
 */
async function enrollLeadsBulk(opts) {
  const workspaceId = String(opts.workspaceId || 'default').trim() || 'default';
  const reEnroll = opts.reEnroll === true;
  const results = [];
  let keys = Array.isArray(opts.leadKeys)
    ? opts.leadKeys.map((k) => fullLeadKey(k)).filter(Boolean)
    : [];

  if (!keys.length && opts.filter && typeof opts.filter === 'object') {
    const all = await dbService.getAllLeads(workspaceId);
    keys = all
      .filter((l) => l && l.key && leadMatchesFilter(l, opts.filter))
      .map((l) => l.key);
  }

  if (!keys.length) {
    return { enrolled: 0, skipped: 0, total: 0, results: [], error: 'no_leads' };
  }

  let enrolled = 0;
  let skipped = 0;
  let dailyCapHits = 0;
  let remaining = await remainingAutoOutreachDailyBudget(workspaceId);
  for (const key of keys) {
    if (remaining <= 0) {
      dailyCapHits += 1;
      results.push({
        enrolled: false,
        reason: 'daily_cap_reached',
        leadKey: key,
        dailyCap: AUTO_OUTREACH_DAILY_CAP,
      });
      skipped += 1;
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const r = await enrollLeadInAutoOutreach({
      leadKey: key,
      workspaceId,
      reEnroll,
      tagLead: opts.tag !== false,
      _remainingBudget: remaining,
    });
    results.push(r);
    if (r.enrolled) {
      enrolled += 1;
      if (r.budgetConsumed) remaining = Math.max(0, remaining - 1);
    } else {
      skipped += 1;
      if (r.reason === 'daily_cap_reached') dailyCapHits += 1;
    }
  }

  return {
    enrolled,
    skipped,
    total: keys.length,
    results,
    dailyCap: AUTO_OUTREACH_DAILY_CAP,
    dailyCapHits,
    remainingBudget: remaining,
  };
}

module.exports = {
  AUTO_OUTREACH_TAG_NAME,
  AUTO_OUTREACH_CAMPAIGN,
  AUTO_OUTREACH_DAILY_CAP,
  fullLeadKey,
  isActiveCadence,
  isActiveOtherCadence,
  isActiveProspecting,
  resolveAutoOutreachTagKey,
  leadHasAutoOutreachTag,
  leadMatchesFilter,
  utcDayKey,
  leadAutoOutreachEnrolledOnDay,
  countAutoOutreachEnrollsToday,
  remainingAutoOutreachDailyBudget,
  enrollLeadInAutoOutreach,
  enrollLeadsBulk,
};
