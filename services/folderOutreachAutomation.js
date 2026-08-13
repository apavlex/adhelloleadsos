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
  enrollLeadInAutoOutreach,
  remainingAutoOutreachDailyBudget,
} = require('./prospectingEnroll');
const { reviewLeadIcpFit, DEFAULT_MIN_ICP_SCORE } = require('./icpFitReview');
const { ensureLeadEmail, hasUsableEmail, hasUsableWebsite } = require('./ensureLeadEmail');
const { buildFolderTree, folderKeysIncludingDescendants } = require('./folderTree');
const { pauseSequence } = require('./sequenceEngine');

const DEFAULT_FOLDER_OUTREACH = {
  enabled: false,
  maxLeads: 25,
  minScore: null,
  tier: '',
  smsOnly: false,
  senderOfferKey: '',
  ghlGoal: '',
  ghlWorkflowPrompt: '',
  aiIcpReview: true,
  minIcpScore: DEFAULT_MIN_ICP_SCORE,
  serviceCities: '',
  serviceStates: '',
  findMissingEmail: true,
  requireEmail: false,
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

function clampMinIcpScore(n) {
  const score = parseFloat(n);
  return Number.isFinite(score) ? Math.max(1, Math.min(10, score)) : DEFAULT_MIN_ICP_SCORE;
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
    aiIcpReview: s.aiIcpReview !== false,
    minIcpScore: clampMinIcpScore(s.minIcpScore),
    serviceCities: trimStringField(s.serviceCities, 400),
    serviceStates: trimStringField(s.serviceStates, 80),
    findMissingEmail: s.findMissingEmail !== false,
    requireEmail: s.requireEmail === true,
    lastRunAt: s.lastRunAt ? String(s.lastRunAt) : '',
    lastEnrolled: Number.isFinite(Number(s.lastEnrolled)) ? Number(s.lastEnrolled) : 0,
    lastCandidateCount: Number.isFinite(Number(s.lastCandidateCount)) ? Number(s.lastCandidateCount) : 0,
    lastFolderLeadCount: Number.isFinite(Number(s.lastFolderLeadCount)) ? Number(s.lastFolderLeadCount) : 0,
    lastSkipSummary: String(s.lastSkipSummary || '').trim().slice(0, 200),
    lastIcpRejected: Number.isFinite(Number(s.lastIcpRejected)) ? Number(s.lastIcpRejected) : 0,
    lastEmailsFound: Number.isFinite(Number(s.lastEmailsFound)) ? Number(s.lastEmailsFound) : 0,
    lastEmailSkipped: Number.isFinite(Number(s.lastEmailSkipped)) ? Number(s.lastEmailSkipped) : 0,
  };
}

function loadFolderOutreachFromFolder(folder) {
  const f = folder && typeof folder === 'object' ? folder : {};
  return normalizeFolderOutreachSettings(f.outreachAutomation);
}

/**
 * Match pipeline folder views: parent folders include leads in nested subfolders.
 * Uses parentFolderKey edges (reliable) and folder tree when available.
 * @param {object[]} folders
 * @param {string} folderKey
 * @returns {Set<string>}
 */
function resolveFolderKeysForOutreach(folders, folderKey) {
  const root = String(folderKey || '').trim();
  if (!root) return new Set();
  const list = Array.isArray(folders) ? folders : [];
  const out = new Set([root]);
  const byParent = new Map();
  for (const f of list) {
    const key = String((f && f.key) || '').trim();
    if (!key) continue;
    const pk = String((f && f.parentFolderKey) || '').trim();
    if (!pk) continue;
    if (!byParent.has(pk)) byParent.set(pk, []);
    byParent.get(pk).push(key);
  }
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    for (const child of byParent.get(cur) || []) {
      if (out.has(child)) continue;
      out.add(child);
      stack.push(child);
    }
  }
  try {
    const tree = buildFolderTree(list);
    const treeKeys = folderKeysIncludingDescendants(tree, root);
    if (treeKeys) {
      for (const k of treeKeys) out.add(k);
    }
  } catch (_) {
    /* tree is best-effort; parent edges above are enough */
  }
  return out;
}

function leadInFolderScope(lead, folderKeyOrKeys) {
  const leadFk = String((lead && lead.folderKey) || '').trim();
  if (!folderKeyOrKeys) return true;
  if (folderKeyOrKeys instanceof Set) {
    if (!folderKeyOrKeys.size) return true;
    return folderKeyOrKeys.has(leadFk);
  }
  const want = String(folderKeyOrKeys).trim();
  if (!want) return true;
  return leadFk === want;
}

/** Only block true active internal cadences — not paused/completed, not legacy GHL auto_outreach. */
function isBlockingActiveCadence(lead) {
  const st = lead && lead.sequenceState;
  if (!st || String(st.status || '') !== 'active') return false;
  const tid = String(st.templateId || '');
  return tid !== AUTO_OUTREACH_CAMPAIGN;
}

/**
 * Why a folder lead is skipped from the drip pool (null = eligible).
 */
function folderOutreachSkipReason(lead, settings, folderKeyOrKeys) {
  if (!lead || !lead.key) return 'invalid';
  if (!leadInFolderScope(lead, folderKeyOrKeys)) return 'wrong_folder';

  const status = String(lead.status || '').toLowerCase();
  if (status.includes('closed - won') || status.includes('closed - lost')) return 'closed';
  if (isActiveProspecting(lead)) return 'already_ghl';
  // Active internal cadences are paused at enroll time so GHL drip can take over.
  // (Do not pre-filter them out of the candidate pool.)

  if (settings.tier) {
    const tier = lead.prospectTier || scoreLocalProspect(lead).prospectTier;
    if (String(tier).toLowerCase() !== String(settings.tier).toLowerCase()) return 'tier';
  }
  if (settings.minScore != null) {
    const scored = scoreLeadRecord(lead);
    if (scored.score < settings.minScore) return 'score';
  }

  const phone = String(lead.phone || '').trim();
  const email = String(lead.email || '').trim();
  const hasPhone = !!(phone && phone !== 'N/A');
  const hasEmail = !!(email && email !== 'N/A');
  if (!hasPhone && !hasEmail) {
    // Website-only Maps leads can enter the pool when email hunt is on.
    if (!(settings.findMissingEmail && hasUsableWebsite(lead))) return 'no_contact';
  }

  if (settings.smsOnly && hasPhone && !phoneLineType.isSmsAllowed(lead)) {
    return 'sms_only';
  }

  return null;
}

function leadEligibleForFolderOutreach(lead, settings, folderKeyOrKeys) {
  return folderOutreachSkipReason(lead, settings, folderKeyOrKeys) == null;
}

function summarizeFolderSkipReasons(leads, settings, folderKeyOrKeys) {
  const counts = {};
  for (const lead of leads || []) {
    const reason = folderOutreachSkipReason(lead, settings, folderKeyOrKeys);
    if (!reason) continue;
    counts[reason] = (counts[reason] || 0) + 1;
  }
  const order = [
    'active_cadence',
    'already_ghl',
    'no_contact',
    'sms_only',
    'tier',
    'score',
    'closed',
    'wrong_folder',
    'invalid',
  ];
  const parts = [];
  for (const key of order) {
    if (!counts[key]) continue;
    const label =
      key === 'active_cadence'
        ? 'on cadence'
        : key === 'already_ghl'
          ? 'already GHL'
          : key === 'no_contact'
            ? 'no phone/email'
            : key === 'sms_only'
              ? 'not SMS-ready'
              : key === 'tier'
                ? 'tier'
                : key === 'score'
                  ? 'score'
                  : key === 'closed'
                    ? 'closed'
                    : key;
    parts.push(`${counts[key]} ${label}`);
  }
  return { counts, summary: parts.slice(0, 3).join(', ') };
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
  const folders = await dbService.listFolders(workspaceId);
  const folderKeys = resolveFolderKeysForOutreach(folders, folderKey);
  const ws = (await dbService.getWorkspace(workspaceId)) || { id: workspaceId };
  const poolSize = Math.min(150, Math.max(cap * 5, cap));
  const inFolder = all.filter((l) => leadInFolderScope(l, folderKeys));
  const skipPack = summarizeFolderSkipReasons(inFolder, settings, folderKeys);
  const candidates = inFolder
    .filter((l) => leadEligibleForFolderOutreach(l, settings, folderKeys))
    .map((l) => ({ lead: l, rank: rankLeadForFolderOutreach(l) }))
    .sort((a, b) => b.rank - a.rank)
    .slice(0, poolSize);

  const results = [];
  let enrolled = 0;
  let icpRejected = 0;
  let emailsFound = 0;
  let emailSkipped = 0;
  let budgetLeft = remainingBudget;
  for (const row of candidates) {
    if (enrolled >= cap || budgetLeft <= 0) break;
    let lead = row.lead;

    if (settings.aiIcpReview) {
      // eslint-disable-next-line no-await-in-loop
      const icp = await reviewLeadIcpFit({
        lead,
        workspace: ws,
        folder,
        settings,
        minIcpScore: settings.minIcpScore,
        persist: true,
      });
      if (!icp.passes) {
        icpRejected += 1;
        results.push({
          enrolled: false,
          reason: 'icp_rejected',
          leadKey: lead.key,
          icpReview: icp,
        });
        continue;
      }
    }

    if (settings.findMissingEmail && !hasUsableEmail(lead)) {
      let emailPack = { found: false, reason: 'error' };
      try {
        // eslint-disable-next-line no-await-in-loop
        emailPack = await ensureLeadEmail({
          lead,
          workspaceId,
          persist: true,
        });
      } catch (e) {
        console.warn(
          `[folderOutreach] email find failed for ${lead.key}:`,
          e && e.message,
        );
      }
      if (emailPack.found && !emailPack.alreadyHad) {
        emailsFound += 1;
        lead = emailPack.lead || lead;
      } else if (settings.requireEmail && !emailPack.found) {
        emailSkipped += 1;
        results.push({
          enrolled: false,
          reason: 'email_missing',
          leadKey: lead.key,
          emailFind: emailPack,
        });
        continue;
      }
    } else if (settings.requireEmail && !hasUsableEmail(lead)) {
      emailSkipped += 1;
      results.push({
        enrolled: false,
        reason: 'email_missing',
        leadKey: lead.key,
      });
      continue;
    }

    if (isBlockingActiveCadence(lead)) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await pauseSequence(lead.key);
      } catch (e) {
        console.warn(
          `[folderOutreach] could not pause cadence for ${lead.key}:`,
          e && e.message,
        );
      }
    }

    // eslint-disable-next-line no-await-in-loop
    const r = await enrollLeadInAutoOutreach({
      leadKey: lead.key,
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
    lastFolderLeadCount: inFolder.length,
    lastSkipSummary: skipPack.summary || '',
    lastIcpRejected: icpRejected,
    lastEmailsFound: emailsFound,
    lastEmailSkipped: emailSkipped,
  };
  await dbService.updateFolder(workspaceId, folderKey, { outreachAutomation: outreachNext });

  return {
    enrolled,
    candidates: candidates.length,
    folderLeadCount: inFolder.length,
    skipSummary: skipPack.summary || '',
    icpRejected,
    emailsFound,
    emailSkipped,
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
 * Start a folder outreach pass without blocking the HTTP request (enable / resume).
 * Safe to call after settings are persisted with enabled: true.
 */
function kickoffFolderOutreachInBackground(opts) {
  const workspaceId = String((opts && opts.workspaceId) || 'default').trim() || 'default';
  const folderKey = String((opts && opts.folderKey) || '').trim();
  if (!folderKey) return false;
  const settings = opts && opts.settings;
  setImmediate(() => {
    runFolderOutreach({ workspaceId, folderKey, settings })
      .then((r) => {
        console.log(
          `[FOLDER-OUTREACH] kickoff ${workspaceId} ${folderKey}: enrolled ${r.enrolled || 0} · ${r.candidates || 0} candidates`,
        );
      })
      .catch((e) => {
        console.error(
          `[FOLDER-OUTREACH] kickoff failed ${workspaceId} ${folderKey}:`,
          e && e.message ? e.message : e,
        );
      });
  });
  return true;
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

/**
 * Active background auto-outreach campaigns for bell / status UI.
 * Scheduler runs on the server — safe to close the browser.
 */
async function getActiveAutoOutreachSummary(workspaceId) {
  const wid = String(workspaceId || 'default').trim() || 'default';
  const folders = await dbService.listFolders(wid);
  const enabledFolders = [];
  for (const folder of folders) {
    const settings = loadFolderOutreachFromFolder(folder);
    if (!settings.enabled) continue;
    enabledFolders.push({
      key: String(folder.key || ''),
      name: String(folder.name || folder.key || 'Folder'),
      maxLeads: settings.maxLeads,
      lastRunAt: settings.lastRunAt || '',
      lastEnrolled: settings.lastEnrolled || 0,
      lastCandidateCount: settings.lastCandidateCount || 0,
    });
  }

  let autoPoolEnabled = false;
  let autoPoolLastRunAt = '';
  let autoPoolLastEnrolled = 0;
  try {
    const ws = await dbService.getWorkspace(wid);
    const pool = ws && ws.prospecting && ws.prospecting.autoPool;
    autoPoolEnabled = !!(pool && pool.enabled === true);
    autoPoolLastRunAt = pool && pool.lastRunAt ? String(pool.lastRunAt) : '';
    autoPoolLastEnrolled = pool && Number.isFinite(Number(pool.lastEnrolled))
      ? Number(pool.lastEnrolled)
      : 0;
  } catch (_) {
    /* ignore */
  }

  const active = enabledFolders.length > 0 || autoPoolEnabled;
  const names = enabledFolders.map((f) => f.name).filter(Boolean);
  let headline = 'Auto outreach running in background';
  let body =
    'Campaigns keep enrolling on the server on a schedule. Safe to close this tab — work continues without you staying on the app.';
  if (enabledFolders.length === 1 && !autoPoolEnabled) {
    headline = `Auto outreach on · ${names[0]}`;
    body = `"${names[0]}" enrolls new eligible leads into GHL daily in the background. Safe to close the app — the campaign keeps running on the server.`;
  } else if (enabledFolders.length > 1 && !autoPoolEnabled) {
    headline = `Auto outreach on · ${enabledFolders.length} folders`;
    body = `${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''} are enrolled on a server schedule. Safe to close this tab.`;
  } else if (autoPoolEnabled && enabledFolders.length === 0) {
    headline = 'Auto-pool outreach running in background';
    body =
      'Workspace auto-pool enrolls leads into GHL on a schedule. Safe to close the app — it continues on the server.';
  } else if (autoPoolEnabled && enabledFolders.length > 0) {
    headline = 'Auto outreach + auto-pool active';
    body = `${enabledFolders.length} folder campaign(s) and auto-pool are on. Safe to close — enrolls continue in the background.`;
  }

  return {
    active,
    folderCount: enabledFolders.length,
    folders: enabledFolders.slice(0, 8),
    autoPoolEnabled,
    autoPoolLastRunAt,
    autoPoolLastEnrolled,
    headline,
    body,
    href:
      enabledFolders.length === 1
        ? `/prospecting?tab=folders&folderKey=${encodeURIComponent(enabledFolders[0].key)}`
        : '/prospecting?tab=folders',
  };
}

module.exports = {
  DEFAULT_FOLDER_OUTREACH,
  MAX_GHL_GOAL_LEN,
  MAX_GHL_WORKFLOW_PROMPT_LEN,
  clampMaxLeads,
  normalizeFolderOutreachSettings,
  loadFolderOutreachFromFolder,
  resolveFolderKeysForOutreach,
  leadInFolderScope,
  folderOutreachSkipReason,
  leadEligibleForFolderOutreach,
  summarizeFolderSkipReasons,
  rankLeadForFolderOutreach,
  runFolderOutreach,
  kickoffFolderOutreachInBackground,
  runEnabledFoldersForWorkspace,
  getActiveAutoOutreachSummary,
};
