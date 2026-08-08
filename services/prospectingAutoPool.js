/**
 * Auto-pool: select top-scoring leads, tag auto-outreach, sync to GHL workflow.
 */
const dbService = require('./database');
const { scoreLeadRecord } = require('./opportunityScore');
const { scoreLocalProspect } = require('./localProspectScore');
const {
  AUTO_OUTREACH_CAMPAIGN,
  isActiveProspecting,
  isActiveCadence,
  enrollLeadInAutoOutreach,
} = require('./prospectingEnroll');

const DEFAULT_AUTO_POOL = {
  enabled: false,
  maxLeads: 50,
  minScore: null,
  tier: 'Hot',
  senderOfferKey: '',
};

function normalizeAutoPoolSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const maxLeads = parseInt(s.maxLeads, 10);
  const minScore = s.minScore != null && s.minScore !== '' ? parseFloat(s.minScore) : null;
  return {
    enabled: s.enabled === true,
    maxLeads: Number.isFinite(maxLeads) ? Math.max(1, Math.min(200, maxLeads)) : DEFAULT_AUTO_POOL.maxLeads,
    minScore: Number.isFinite(minScore) ? minScore : null,
    tier: String(s.tier || DEFAULT_AUTO_POOL.tier).trim() || DEFAULT_AUTO_POOL.tier,
    senderOfferKey: String(s.senderOfferKey || '').trim(),
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
  const cap =
    typeof opts.maxLeads === 'number'
      ? Math.max(1, Math.min(200, opts.maxLeads))
      : settings.maxLeads;

  const all = await dbService.getAllLeads(workspaceId);
  const candidates = all
    .filter((l) => leadEligibleForPool(l, settings))
    .map((l) => ({ lead: l, rank: rankLeadForPool(l) }))
    .sort((a, b) => b.rank - a.rank)
    .slice(0, cap);

  const results = [];
  let enrolled = 0;
  for (const row of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const r = await enrollLeadInAutoOutreach({
      leadKey: row.lead.key,
      workspaceId,
      reEnroll: false,
      tagLead: true,
      senderOfferKey: settings.senderOfferKey || '',
    });
    results.push(r);
    if (r.enrolled) enrolled += 1;
  }

  const runAt = new Date().toISOString();
  const autoPoolNext = {
    ...settings,
    lastRunAt: runAt,
    lastEnrolled: enrolled,
    lastCandidateCount: candidates.length,
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
    campaign: AUTO_OUTREACH_CAMPAIGN,
    settings: autoPoolNext,
    results,
  };
}

module.exports = {
  DEFAULT_AUTO_POOL,
  normalizeAutoPoolSettings,
  loadAutoPoolFromWorkspace,
  leadEligibleForPool,
  rankLeadForPool,
  runAutoPool,
};
