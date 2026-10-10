/**
 * Tool adapters — role bots call these; mutations land in AdHello as system of record.
 */
const db = require('../database');
const teamActivity = require('../teamActivity');
const { buildFocusQueue, shortLeadKey } = require('../focusQueue');
const { filterBusinessPipelineLeads } = require('../leadListFilters');
const { resolveDialRetryPrefs } = require('../dialRetryPrefs');
const { roiScoreOptionsFromWorkspace } = require('../workspaceRoiProfile');
const { buildOpportunityBoard } = require('../opportunityBoards');
const workspaceIntegrations = require('../workspaceIntegrations');
const ghlClient = require('../ghlClient');
const ghlMessaging = require('../ghlMessaging');
const appointmentPackages = require('../appointmentPackages');
const appointmentPool = require('../appointmentPool');
const networkStore = require('../networkStore');
const { poolReferralsForMember } = require('../referralExchange');
const store = require('./store');
const memory = require('./memory');

function actorFor(role, onBehalfOf) {
  const name = (role && (role.title || role.name)) || 'Ops bot';
  return teamActivity.botActor(name, onBehalfOf || '');
}

function recordBot(workspaceId, role, onBehalfOf, entry) {
  try {
    const actor = actorFor(role, onBehalfOf);
    teamActivity.record({ workspaceId, actor }, entry);
  } catch (_) {
    /* never break a job on activity */
  }
}

function leadPhone(l) {
  return String((l && (l.phone || l.phoneNumber || l.mobile)) || '').trim();
}

function isClosedStageName(name) {
  return /\b(won|lost|closed)\b/i.test(String(name || ''));
}

function nextMoveForStage(stageName) {
  const n = String(stageName || '').toLowerCase();
  if (/\b(proposal|negotiat)/.test(n)) return 'Close it — follow up on the proposal today';
  if (/\b(qualif|discover)/.test(n)) return 'Advance to proposal';
  if (/\bcontact/.test(n)) return 'Qualify fit and book the next step';
  if (/\b(new|lead|opportunit)/.test(n)) return 'First contact — call or email today';
  return 'Move this deal one stage forward';
}

/**
 * Prospect SDR — prepare early-stage prospect queue (Focus under the hood).
 */
async function prepareProspects(workspaceId, { role, onBehalfOf, limit = 20 } = {}) {
  const wid = String(workspaceId || '').trim();
  const ws = (await db.getWorkspace(wid)) || { id: wid };
  const all = await db.getAllLeads(wid);
  const business = filterBusinessPipelineLeads(all);
  const dialRetry = resolveDialRetryPrefs(ws && ws.telephony);
  const roiOpts = roiScoreOptionsFromWorkspace(ws);
  const queue = buildFocusQueue(business, Math.min(500, Math.max(5, limit)), {
    earlyStagesOnly: true,
    queueMode: dialRetry.queueMode || 'continue_list',
    workspace: ws,
    ...roiOpts,
  });
  const top = queue.slice(0, Math.min(8, limit)).map((l) => ({
    key: l.key,
    shortKey: shortLeadKey(l),
    title: String(l.title || l.company || l.email || 'Lead').slice(0, 120),
    phone: leadPhone(l) || null,
    stage: parseInt(l.pipelineStage, 10) || 1,
  }));
  const withPhone = queue.filter((l) => leadPhone(l)).length;
  const summary =
    queue.length === 0
      ? 'No early-stage prospects ready yet.'
      : `${queue.length} early-stage prospect${queue.length === 1 ? '' : 's'} ready (${withPhone} with phone). Top: ${top
          .slice(0, 3)
          .map((t) => t.title)
          .join(', ') || '—'}.`;

  memory.remember(wid, 'prospect', {
    kind: 'prospect_prep',
    text: summary,
    meta: { count: queue.length, withPhone },
  });
  store.upsertInsight(wid, {
    roleId: 'prospect',
    type: 'prospect.prepare',
    title: queue.length ? `${queue.length} prospects ready` : 'Prospect queue empty',
    body: summary,
    href: '/focus',
    severity: queue.length ? 'action' : 'info',
    counts: { queue: queue.length, withPhone },
    meta: { top },
  });
  recordBot(wid, role, onBehalfOf, {
    category: 'outreach',
    action: 'prospect_prepare',
    summary: summary.slice(0, 200),
  });
  return { ok: true, summary, counts: { queue: queue.length, withPhone }, top };
}

/** @deprecated alias — Focus SDR renamed to Prospect SDR */
async function prepareFocus(workspaceId, opts) {
  return prepareProspects(workspaceId, opts);
}

/**
 * Opportunity SDR — review opportunity boards; rank top open deals to move.
 */
async function scanOpportunityBoard(workspaceId, { role, onBehalfOf, limit = 8 } = {}) {
  const wid = String(workspaceId || '').trim();
  const ws = (await db.getWorkspace(wid)) || { id: wid };
  const all = await db.getAllLeads(wid);
  const business = filterBusinessPipelineLeads(all);
  let tasks = [];
  try {
    if (onBehalfOf) tasks = await db.listUserTasks(wid, onBehalfOf);
  } catch (_) {
    tasks = [];
  }

  const board = buildOpportunityBoard({
    boards: ws.opportunityBoards,
    leads: business,
    tasks,
    compactLimit: 0,
  });

  const openStages = (board.stages || []).filter((s) => !isClosedStageName(s.name));
  const closedStages = (board.stages || []).filter((s) => isClosedStageName(s.name));
  const openCount = openStages.reduce((n, s) => n + (s.count || 0), 0);
  const stageIndex = new Map(openStages.map((s, i) => [s.id, i]));

  const candidates = [];
  for (const stage of openStages) {
    const progress = stageIndex.get(stage.id) || 0;
    for (const card of stage.cards || []) {
      candidates.push({
        key: card.key,
        title: card.title,
        href: card.href || `/pipeline?focusLead=${encodeURIComponent(String(card.key || '').replace(/^lead:/i, ''))}`,
        stageId: stage.id,
        stageName: stage.name,
        value: Number(card.value) || 0,
        valueLabel: card.valueLabel || '',
        phone: card.phone || null,
        email: card.email || null,
        status: card.status || '',
        nextMove: nextMoveForStage(stage.name),
        progress,
      });
    }
  }

  candidates.sort((a, b) => {
    if (b.value !== a.value) return b.value - a.value;
    if (b.progress !== a.progress) return b.progress - a.progress;
    return String(a.title).localeCompare(String(b.title));
  });

  const topN = Math.min(12, Math.max(3, limit));
  const top = candidates.slice(0, topN);
  const pipelineName = (board.pipeline && board.pipeline.name) || 'Opportunity board';
  const topNames = top
    .slice(0, 3)
    .map((t) => t.title)
    .join(', ');

  let summary;
  if (!top.length) {
    summary = openCount === 0 && closedStages.length
      ? `${pipelineName}: no open opportunities — add deals to move the pipeline.`
      : `${pipelineName}: no open opportunities on the board yet.`;
  } else {
    summary = `${pipelineName}: ${openCount} open · focus next on ${topNames}. ${top[0].nextMove}`;
  }

  memory.remember(wid, 'opportunity', {
    kind: 'opp_scan',
    text: summary,
    meta: { openCount, top: top.length, pipeline: pipelineName },
  });
  store.upsertInsight(wid, {
    roleId: 'opportunity',
    type: 'opportunity.scan_board',
    title: top.length ? `Top ${Math.min(3, top.length)} to move` : 'Opportunity board clear',
    body: summary,
    href: '/prospecting?tab=pipeline',
    severity: top.length ? 'action' : 'info',
    counts: { open: openCount, top: top.length },
    meta: {
      pipeline: pipelineName,
      top,
      stages: openStages.map((s) => ({ id: s.id, name: s.name, count: s.count, value: s.value })),
    },
  });
  recordBot(wid, role, onBehalfOf, {
    category: 'pipeline',
    action: 'opportunity_scan_board',
    summary: summary.slice(0, 200),
  });
  return {
    ok: true,
    summary,
    counts: { open: openCount, top: top.length },
    top,
    pipeline: pipelineName,
  };
}

/**
 * Dispatcher — referral pool + appointment leftovers.
 */
async function scanPool(workspaceId, { role, onBehalfOf } = {}) {
  const wid = String(workspaceId || '').trim();
  let unrouted = 0;
  let poolForMembers = 0;
  let networkId = null;
  try {
    const network = await networkStore.getNetworkForWorkspace(wid);
    if (network) {
      networkId = network.id;
      const refs = await networkStore.listReferrals(network.id);
      unrouted = refs.filter((r) => r && r.status === 'unrouted').length;
      const members = await networkStore.listMembers(network.id);
      for (const m of members) {
        if (!m || m.status === 'paused') continue;
        poolForMembers += poolReferralsForMember(refs, m).length;
      }
    }
  } catch (_) {
    /* optional */
  }

  let apptRemaining = 0;
  let pendingRequests = 0;
  try {
    const view = await appointmentPackages.loadTodayView(wid);
    apptRemaining = (view && view.totals && view.totals.remaining) || 0;
    pendingRequests = (view && view.totals && view.totals.pendingRequests) || 0;
  } catch (_) {
    /* optional */
  }

  let marketplaceLeft = 0;
  try {
    marketplaceLeft = appointmentPool.listAvailable().reduce((n, l) => n + (l.slotsLeft || 0), 0);
  } catch (_) {
    /* optional */
  }

  const actionBits = [];
  if (unrouted) actionBits.push(`${unrouted} unrouted referral${unrouted === 1 ? '' : 's'}`);
  if (apptRemaining) actionBits.push(`${apptRemaining} appointment slot${apptRemaining === 1 ? '' : 's'} left`);
  if (pendingRequests) actionBits.push(`${pendingRequests} portal request${pendingRequests === 1 ? '' : 's'}`);
  const summary = actionBits.length
    ? `Dispatcher: ${actionBits.join(', ')}.`
    : 'Dispatcher: referral pool and appointments look clear.';

  memory.remember(wid, 'dispatcher', {
    kind: 'pool_scan',
    text: summary,
    meta: { unrouted, apptRemaining, pendingRequests, marketplaceLeft, networkId },
  });
  store.upsertInsight(wid, {
    roleId: 'dispatcher',
    type: 'dispatcher.scan_pool',
    title: actionBits.length ? actionBits[0] : 'Pool clear',
    body: summary,
    href: unrouted ? '/referrals' : '/appointments',
    severity: actionBits.length ? 'action' : 'info',
    counts: { unrouted, poolForMembers, apptRemaining, pendingRequests, marketplaceLeft },
  });
  recordBot(wid, role, onBehalfOf, {
    category: 'leads',
    action: 'dispatcher_scan_pool',
    summary: summary.slice(0, 200),
  });
  return {
    ok: true,
    summary,
    counts: { unrouted, poolForMembers, apptRemaining, pendingRequests, marketplaceLeft },
  };
}

/**
 * Ops — GHL + messaging + recent failed agent jobs.
 */
async function opsHealth(workspaceId, { role, onBehalfOf } = {}) {
  const wid = String(workspaceId || '').trim();
  const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(wid);
  const ghlOk = ghlClient.isConfigured(integrationEnv);
  const messaging = ghlMessaging.messagingReady(integrationEnv);
  const runs = store.listRecentRuns(wid, 15);
  const failed = runs.filter((r) => r.status === 'error' || r.status === 'failed');
  const settings = store.getSettings(wid);

  const issues = [];
  if (!ghlOk) issues.push('GHL not connected');
  else {
    if (!messaging.smsReady) issues.push('SMS from-number missing');
    if (!messaging.emailReady) issues.push('Email from-address missing');
  }
  if (failed.length) issues.push(`${failed.length} recent failed bot run${failed.length === 1 ? '' : 's'}`);

  const summary = issues.length
    ? `Ops: ${issues.join('; ')}.`
    : 'Ops: GHL, messaging, and recent bot runs look healthy.';

  memory.remember(wid, 'ops', {
    kind: 'health',
    text: summary,
    meta: { ghlOk, messaging, failed: failed.length },
  });
  store.upsertInsight(wid, {
    roleId: 'ops',
    type: 'ops.health',
    title: issues.length ? 'Needs attention' : 'All clear',
    body: summary,
    href: '/workspace?tab=integrations',
    severity: issues.length ? 'warn' : 'info',
    counts: {
      ghl: ghlOk ? 1 : 0,
      sms: messaging.smsReady ? 1 : 0,
      email: messaging.emailReady ? 1 : 0,
      failed: failed.length,
    },
    meta: { issues, enabled: settings.enabled },
  });
  recordBot(wid, role, onBehalfOf, {
    category: 'notes',
    action: 'ops_health',
    summary: summary.slice(0, 200),
  });
  return {
    ok: true,
    summary,
    counts: {
      ghl: ghlOk ? 1 : 0,
      sms: messaging.smsReady ? 1 : 0,
      email: messaging.emailReady ? 1 : 0,
      failed: failed.length,
    },
    issues,
    messaging,
  };
}

module.exports = {
  prepareProspects,
  prepareFocus,
  scanOpportunityBoard,
  scanPool,
  opsHealth,
  actorFor,
  nextMoveForStage,
  isClosedStageName,
};
