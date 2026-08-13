/**
 * Auto-pool: select top-scoring leads, tag auto-outreach, sync to GHL workflow.
 */
const dbService = require('./database');
const { scoreLeadRecord } = require('./opportunityScore');
const { scoreLocalProspect } = require('./localProspectScore');
const {
  AUTO_OUTREACH_CAMPAIGN,
  AUTO_OUTREACH_DAILY_CAP,
  isActiveProspecting,
  isActiveCadence,
  enrollLeadInAutoOutreach,
  remainingAutoOutreachDailyBudget,
} = require('./prospectingEnroll');
const { reviewLeadIcpFit, DEFAULT_MIN_ICP_SCORE } = require('./icpFitReview');
const { ensureLeadEmail, hasUsableEmail } = require('./ensureLeadEmail');

const DEFAULT_AUTO_POOL = {
  enabled: false,
  maxLeads: 50,
  minScore: null,
  tier: 'Hot',
  senderOfferKey: '',
  aiIcpReview: true,
  minIcpScore: DEFAULT_MIN_ICP_SCORE,
  serviceCities: '',
  serviceStates: '',
  findMissingEmail: true,
  requireEmail: false,
};

function clampAutoPoolMaxLeads(n) {
  const maxLeads = parseInt(n, 10);
  return Number.isFinite(maxLeads)
    ? Math.max(1, Math.min(AUTO_OUTREACH_DAILY_CAP, maxLeads))
    : DEFAULT_AUTO_POOL.maxLeads;
}

function clampMinIcpScore(n) {
  const score = parseFloat(n);
  return Number.isFinite(score) ? Math.max(1, Math.min(10, score)) : DEFAULT_MIN_ICP_SCORE;
}

function normalizeAutoPoolSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const minScore = s.minScore != null && s.minScore !== '' ? parseFloat(s.minScore) : null;
  return {
    enabled: s.enabled === true,
    maxLeads: clampAutoPoolMaxLeads(s.maxLeads),
    minScore: Number.isFinite(minScore) ? minScore : null,
    tier: String(s.tier || DEFAULT_AUTO_POOL.tier).trim() || DEFAULT_AUTO_POOL.tier,
    senderOfferKey: String(s.senderOfferKey || '').trim(),
    aiIcpReview: s.aiIcpReview !== false,
    minIcpScore: clampMinIcpScore(s.minIcpScore),
    serviceCities: String(s.serviceCities || '').trim().slice(0, 400),
    serviceStates: String(s.serviceStates || '').trim().slice(0, 80),
    findMissingEmail: s.findMissingEmail !== false,
    requireEmail: s.requireEmail === true,
  };
}

function loadAutoPoolFromWorkspace(ws) {
  const p = ws && ws.prospecting && ws.prospecting.autoPool;
  return normalizeAutoPoolSettings(p);
}

function leadEligibleForPool(lead, settings) {
  if (!lead || !lead.key) return false;
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
  return true;
}

function rankLeadForPool(lead) {
  const scored = scoreLeadRecord(lead);
  const lp = scoreLocalProspect(lead);
  const tierRank =
    lp.prospectTier === 'Hot' ? 3 : lp.prospectTier === 'Warm' ? 2 : lp.prospectTier === 'Low' ? 1 : 0;
  return tierRank * 100 + scored.score;
}

/**
 * @param {{ workspaceId: string, settings?: object, maxLeads?: number }} opts
 */
async function runAutoPool(opts) {
  const workspaceId = String(opts.workspaceId || 'default').trim() || 'default';
  const ws = (await dbService.getWorkspace(workspaceId)) || { id: workspaceId };
  const settings = normalizeAutoPoolSettings(opts.settings || loadAutoPoolFromWorkspace(ws));
  const requestedCap =
    typeof opts.maxLeads === 'number' ? clampAutoPoolMaxLeads(opts.maxLeads) : settings.maxLeads;
  const remainingBudget = await remainingAutoOutreachDailyBudget(workspaceId);
  const cap = Math.min(requestedCap, remainingBudget);

  if (cap <= 0) {
    const runAt = new Date().toISOString();
    const autoPoolNext = {
      ...settings,
      lastRunAt: runAt,
      lastEnrolled: 0,
      lastCandidateCount: 0,
      lastSkippedReason: 'daily_cap_reached',
    };
    await dbService.saveWorkspace(workspaceId, {
      ...ws,
      prospecting: {
        ...(ws.prospecting && typeof ws.prospecting === 'object' ? ws.prospecting : {}),
        autoPool: autoPoolNext,
      },
    });
    return {
      enrolled: 0,
      candidates: 0,
      campaign: AUTO_OUTREACH_CAMPAIGN,
      settings: autoPoolNext,
      results: [],
      dailyCap: AUTO_OUTREACH_DAILY_CAP,
      remainingBudget: 0,
      skippedReason: 'daily_cap_reached',
    };
  }

  const all = await dbService.getAllLeads(workspaceId);
  const poolSize = Math.min(150, Math.max(cap * 5, cap));
  const candidates = all
    .filter((l) => leadEligibleForPool(l, settings))
    .map((l) => ({ lead: l, rank: rankLeadForPool(l) }))
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
        folder: null,
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
      // eslint-disable-next-line no-await-in-loop
      const emailPack = await ensureLeadEmail({
        lead,
        workspaceId,
        persist: true,
      });
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
  const autoPoolNext = {
    ...settings,
    lastRunAt: runAt,
    lastEnrolled: enrolled,
    lastCandidateCount: candidates.length,
    lastIcpRejected: icpRejected,
    lastEmailsFound: emailsFound,
    lastEmailSkipped: emailSkipped,
  };
  await dbService.saveWorkspace(workspaceId, {
    ...ws,
    prospecting: {
      ...(ws.prospecting && typeof ws.prospecting === 'object' ? ws.prospecting : {}),
      autoPool: autoPoolNext,
    },
  });

  return {
    enrolled,
    candidates: candidates.length,
    icpRejected,
    emailsFound,
    emailSkipped,
    campaign: AUTO_OUTREACH_CAMPAIGN,
    settings: autoPoolNext,
    results,
    dailyCap: AUTO_OUTREACH_DAILY_CAP,
    remainingBudget: budgetLeft,
  };
}

module.exports = {
  DEFAULT_AUTO_POOL,
  clampAutoPoolMaxLeads,
  normalizeAutoPoolSettings,
  loadAutoPoolFromWorkspace,
  leadEligibleForPool,
  rankLeadForPool,
  runAutoPool,
};
