/**
 * Per-folder auto outreach: enroll leads into GHL workflow (auto-outreach tag).
 */
const dbService = require('./database');
const { scoreLeadRecord } = require('./opportunityScore');
const { scoreLocalProspect } = require('./localProspectScore');
const phoneLineType = require('./phoneLineType');
const {
  AUTO_OUTREACH_CAMPAIGN,
  AUTO_OUTREACH_DAILY_CAP,
  isActiveProspecting,
  isActiveCadence,
  enrollLeadInAutoOutreach,
  remainingAutoOutreachDailyBudget,
} = require('./prospectingEnroll');

const DEFAULT_FOLDER_OUTREACH = {
  enabled: false,
  maxLeads: 25,
  minScore: null,
  tier: '',
  smsOnly: false,
  senderOfferKey: '',
  ghlGoal: '',
  ghlWorkflowPrompt: '',
};

const MAX_GHL_GOAL_LEN = 2000;
const MAX_GHL_WORKFLOW_PROMPT_LEN = 51_200;

function trimStringField(val, maxLen) {
  const s = String(val || '').trim();
  if (!s) return '';
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function clampMaxLeads(n) {
  const maxLeads = parseInt(n, 10);
  return Number.isFinite(maxLeads)
    ? Math.max(1, Math.min(AUTO_OUTREACH_DAILY_CAP, maxLeads))
    : DEFAULT_FOLDER_OUTREACH.maxLeads;
}

function normalizeFolderOutreachSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const minScore = s.minScore != null && s.minScore !== '' ? parseFloat(s.minScore) : null;
  return {
    enabled: s.enabled === true,
    maxLeads: clampMaxLeads(s.maxLeads),
    minScore: Number.isFinite(minScore) ? minScore : null,
    tier: String(s.tier || '').trim(),
    smsOnly: s.smsOnly === true,
    senderOfferKey: String(s.senderOfferKey || '').trim(),
    ghlGoal: trimStringField(s.ghlGoal, MAX_GHL_GOAL_LEN),
    ghlWorkflowPrompt: trimStringField(s.ghlWorkflowPrompt, MAX_GHL_WORKFLOW_PROMPT_LEN),
    lastRunAt: s.lastRunAt ? String(s.lastRunAt) : '',
    lastEnrolled: Number.isFinite(Number(s.lastEnrolled)) ? Number(s.lastEnrolled) : 0,
    lastCandidateCount: Number.isFinite(Number(s.lastCandidateCount)) ? Number(s.lastCandidateCount) : 0,
  };
}

function loadFolderOutreachFromFolder(folder) {
  const f = folder && typeof folder === 'object' ? folder : {};
  return normalizeFolderOutreachSettings(f.outreachAutomation);
}

function leadEligibleForFolderOutreach(lead, settings, folderKey) {
  if (!lead || !lead.key) return false;
  if (folderKey && String(lead.folderKey || '').trim() !== String(folderKey).trim()) return false;

  const status = String(lead.status || '').toLowerCase();
  if (status.includes('closed - won') || status.includes('closed - lost')) return false;
  if (isActiveProspecting(lead)) return false;
  if (isActiveCadence(lead)) return false;

  if (settings.tier) {
    const tier = lead.prospectTier || scoreLocalProspect(lead).prospectTier;
    if (String(tier).toLowerCase() !== String(settings.tier).toLowerCase()) return false;
  }
  if (settings.minScore != null) {
    const scored = scoreLeadRecord(lead);
    if (scored.score < settings.minScore) return false;
  }

  const phone = String(lead.phone || '').trim();
  const email = String(lead.email || '').trim();
  if ((!phone || phone === 'N/A') && (!email || email === 'N/A')) return false;

  if (settings.smsOnly && phone && phone !== 'N/A' && !phoneLineType.isSmsAllowed(lead)) {
    return false;
  }

  return true;
}

function rankLeadForFolderOutreach(lead) {
  const scored = scoreLeadRecord(lead);
  const lp = scoreLocalProspect(lead);
  const tierRank =
    lp.prospectTier === 'Hot' ? 3 : lp.prospectTier === 'Warm' ? 2 : lp.prospectTier === 'Low' ? 1 : 0;
  const smsBoost = phoneLineType.isSmsAllowed(lead) ? 5 : 0;
  return tierRank * 100 + scored.score + smsBoost;
}

/**
 * @param {{ workspaceId: string, folderKey: string, settings?: object, maxLeads?: number }} opts
 */
async function runFolderOutreach(opts) {
  const workspaceId = String(opts.workspaceId || 'default').trim() || 'default';
  const folderKey = String(opts.folderKey || '').trim();
  if (!folderKey) throw new Error('folderKey is required');

  const folder = await dbService.getFolder(workspaceId, folderKey);
  if (!folder) throw new Error('Folder not found');

  const settings = normalizeFolderOutreachSettings(opts.settings || loadFolderOutreachFromFolder(folder));
  const requestedCap =
    typeof opts.maxLeads === 'number' ? clampMaxLeads(opts.maxLeads) : settings.maxLeads;
  const remainingBudget = await remainingAutoOutreachDailyBudget(workspaceId);
  const cap = Math.min(requestedCap, remainingBudget);

  if (cap <= 0) {
    const runAt = new Date().toISOString();
    const outreachNext = {
      ...settings,
      enabled: settings.enabled,
      lastRunAt: runAt,
      lastEnrolled: 0,
      lastCandidateCount: 0,
      lastSkippedReason: 'daily_cap_reached',
    };
    await dbService.updateFolder(workspaceId, folderKey, { outreachAutomation: outreachNext });
    return {
      enrolled: 0,
      candidates: 0,
      campaign: AUTO_OUTREACH_CAMPAIGN,
      folderKey,
      folderName: folder.name || '',
      settings: outreachNext,
      results: [],
      dailyCap: AUTO_OUTREACH_DAILY_CAP,
      remainingBudget: 0,
      skippedReason: 'daily_cap_reached',
    };
  }

  const all = await dbService.getAllLeads(workspaceId);
  const candidates = all
    .filter((l) => leadEligibleForFolderOutreach(l, settings, folderKey))
    .map((l) => ({ lead: l, rank: rankLeadForFolderOutreach(l) }))
    .sort((a, b) => b.rank - a.rank)
    .slice(0, cap);

  const results = [];
  let enrolled = 0;
  let budgetLeft = remainingBudget;
  for (const row of candidates) {
    if (budgetLeft <= 0) break;
    // eslint-disable-next-line no-await-in-loop
    const r = await enrollLeadInAutoOutreach({
      leadKey: row.lead.key,
      workspaceId,
      reEnroll: false,
      tagLead: true,
      senderOfferKey: settings.senderOfferKey || '',
      _remainingBudget: budgetLeft,
    });
    results.push(r);
    if (r.enrolled) {
      enrolled += 1;
      if (r.budgetConsumed) budgetLeft = Math.max(0, budgetLeft - 1);
    }
  }

  const runAt = new Date().toISOString();
  const outreachNext = {
    ...settings,
    enabled: settings.enabled,
    lastRunAt: runAt,
    lastEnrolled: enrolled,
    lastCandidateCount: candidates.length,
  };
  await dbService.updateFolder(workspaceId, folderKey, { outreachAutomation: outreachNext });

  return {
    enrolled,
    candidates: candidates.length,
    campaign: AUTO_OUTREACH_CAMPAIGN,
    folderKey,
    folderName: folder.name || '',
    settings: outreachNext,
    results,
    dailyCap: AUTO_OUTREACH_DAILY_CAP,
    remainingBudget: budgetLeft,
  };
}

/**
 * Run outreach for every folder with outreachAutomation.enabled in a workspace.
 */
async function runEnabledFoldersForWorkspace(workspaceId) {
  const wid = String(workspaceId || 'default').trim() || 'default';
  const folders = await dbService.listFolders(wid);
  let totalEnrolled = 0;
  const folderResults = [];

  for (const folder of folders) {
    const settings = loadFolderOutreachFromFolder(folder);
    if (!settings.enabled) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await runFolderOutreach({
        workspaceId: wid,
        folderKey: folder.key,
        settings,
      });
      totalEnrolled += result.enrolled || 0;
      folderResults.push(result);
      if (result.enrolled) {
        console.log(
          `[FOLDER-OUTREACH] ${wid} ${folder.name || folder.key}: enrolled ${result.enrolled} lead(s)`,
        );
      }
    } catch (e) {
      console.error(`[FOLDER-OUTREACH] ${wid} ${folder.key} failed:`, e && e.message);
    }
  }

  return { totalEnrolled, folderResults, workspaceId: wid };
}

module.exports = {
  DEFAULT_FOLDER_OUTREACH,
  MAX_GHL_GOAL_LEN,
  MAX_GHL_WORKFLOW_PROMPT_LEN,
  clampMaxLeads,
  normalizeFolderOutreachSettings,
  loadFolderOutreachFromFolder,
  leadEligibleForFolderOutreach,
  rankLeadForFolderOutreach,
  runFolderOutreach,
  runEnabledFoldersForWorkspace,
};
