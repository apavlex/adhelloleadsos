/**
 * Tool adapters — role bots call these; mutations land in AdHello as system of record.
 */
const db = require('../database');
const teamActivity = require('../teamActivity');
const { buildFocusQueue, shortLeadKey } = require('../focusQueue');
const { filterBusinessPipelineLeads } = require('../leadListFilters');
const { resolveDialRetryPrefs } = require('../dialRetryPrefs');
const { roiScoreOptionsFromWorkspace } = require('../workspaceRoiProfile');
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

function leadEmail(l) {
  return String((l && l.email) || '').trim();
}

function isWonishLead(l) {
  const ps = parseInt(l && l.pipelineStage, 10);
  // Schema tops out near stage 7 (Closed/Won territory).
  if (Number.isFinite(ps) && ps >= 6) return true;
  const stage = String((l && (l.stageName || l.status || '')) || '').toLowerCase();
  return /\b(won|closed|customer|client|sold)\b/.test(stage);
}

function hadRecentReviewAsk(l, withinMs = 14 * 86400000) {
  const updates = Array.isArray(l && l.updates) ? l.updates : [];
  const logs = Array.isArray(l && l.logs) ? l.logs : [];
  const cutoff = Date.now() - withinMs;
  const hit = (entry) => {
    const text = `${entry && entry.note ? entry.note : ''} ${entry && entry.message ? entry.message : ''} ${entry && entry.source ? entry.source : ''}`.toLowerCase();
    if (!/review/.test(text)) return false;
    const t = Date.parse((entry && (entry.timestamp || entry.at || entry.createdAt)) || '');
    return Number.isFinite(t) && t >= cutoff;
  };
  return updates.some(hit) || logs.some(hit);
}

/**
 * SDR — prepare Focus queue snapshot + insight for Today.
 */
async function prepareFocus(workspaceId, { role, onBehalfOf, limit = 20 } = {}) {
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
      ? 'No early-stage leads ready for Focus yet.'
      : `${queue.length} early-stage lead${queue.length === 1 ? '' : 's'} in Focus (${withPhone} with phone). Top: ${top
          .slice(0, 3)
          .map((t) => t.title)
          .join(', ') || '—'}.`;

  memory.remember(wid, 'sdr', {
    kind: 'focus_prep',
    text: summary,
    meta: { count: queue.length, withPhone },
  });
  store.upsertInsight(wid, {
    roleId: 'sdr',
    type: 'sdr.prepare_focus',
    title: queue.length ? `${queue.length} ready in Focus` : 'Focus queue empty',
    body: summary,
    href: '/focus',
    severity: queue.length ? 'action' : 'info',
    counts: { queue: queue.length, withPhone },
    meta: { top },
  });
  recordBot(wid, role, onBehalfOf, {
    category: 'outreach',
    action: 'sdr_prepare_focus',
    summary: summary.slice(0, 200),
  });
  return { ok: true, summary, counts: { queue: queue.length, withPhone }, top };
}

/**
 * Review — scan won/customer leads and network review readiness.
 */
async function scanReviews(workspaceId, { role, onBehalfOf, limit = 15 } = {}) {
  const wid = String(workspaceId || '').trim();
  const all = await db.getAllLeads(wid);
  const candidates = filterBusinessPipelineLeads(all)
    .filter((l) => isWonishLead(l) && !hadRecentReviewAsk(l))
    .filter((l) => leadPhone(l) || (leadEmail(l) && leadEmail(l).includes('@')))
    .slice(0, Math.min(40, Math.max(5, limit)))
    .map((l) => ({
      key: l.key,
      title: String(l.title || l.company || 'Customer').slice(0, 120),
      phone: leadPhone(l) || null,
      email: leadEmail(l) || null,
      stage: parseInt(l.pipelineStage, 10) || null,
    }));

  let networkReady = null;
  let membersMissingLinks = 0;
  try {
    const network = await networkStore.getNetworkForWorkspace(wid);
    if (network) {
      const members = await networkStore.listMembers(network.id);
      const active = members.filter((m) => m && m.status !== 'paused');
      membersMissingLinks = active.filter((m) => !m.reviewSlug && !(m.reviewLinks && m.reviewLinks.length)).length;
      networkReady = {
        networkId: network.id,
        members: active.length,
        missingLinks: membersMissingLinks,
      };
    }
  } catch (_) {
    /* optional */
  }

  const parts = [];
  if (candidates.length) {
    parts.push(`${candidates.length} customer${candidates.length === 1 ? '' : 's'} ready for a review ask`);
  } else {
    parts.push('No new review candidates in the pipeline');
  }
  if (networkReady) {
    parts.push(
      networkReady.missingLinks
        ? `${networkReady.missingLinks} member${networkReady.missingLinks === 1 ? '' : 's'} missing review links`
        : `${networkReady.members} member${networkReady.members === 1 ? '' : 's'} review-ready`,
    );
  }
  const summary = `${parts.join('. ')}.`;

  memory.remember(wid, 'review', {
    kind: 'review_scan',
    text: summary,
    meta: { candidates: candidates.length, networkReady },
  });
  store.upsertInsight(wid, {
    roleId: 'review',
    type: 'review.scan',
    title: candidates.length ? `${candidates.length} review asks ready` : 'Review scan clear',
    body: summary,
    href: '/network',
    severity: candidates.length || (networkReady && networkReady.missingLinks) ? 'action' : 'info',
    counts: {
      candidates: candidates.length,
      missingLinks: (networkReady && networkReady.missingLinks) || 0,
    },
    meta: { candidates: candidates.slice(0, 8), networkReady },
  });
  recordBot(wid, role, onBehalfOf, {
    category: 'outreach',
    action: 'review_scan',
    summary: summary.slice(0, 200),
  });
  return {
    ok: true,
    summary,
    counts: { candidates: candidates.length, missingLinks: (networkReady && networkReady.missingLinks) || 0 },
    candidates,
    networkReady,
  };
}

/**
 * Review — send one request when member + customer contact are provided.
 */
async function requestReview(workspaceId, payload = {}, { role, onBehalfOf } = {}) {
  const wid = String(workspaceId || '').trim();
  const network = await networkStore.getNetworkForWorkspace(wid);
  if (!network) {
    return { ok: false, error: 'No partner network linked to this workspace.' };
  }
  const memberId = String(payload.memberId || '').trim();
  const member = memberId ? await networkStore.getMember(network.id, memberId) : null;
  if (!member) {
    return { ok: false, error: 'memberId is required (active network member).' };
  }
  const networkNotify = require('../networkNotify');
  const result = await networkNotify.sendReviewRequest({
    network,
    member,
    toPhone: payload.toPhone,
    toEmail: payload.toEmail,
    customerName: payload.customerName,
    channel: payload.channel || 'auto',
    useAi: payload.useAi !== false,
    scriptOverride: payload.scriptOverride,
    imageId: payload.imageId,
  });
  const summary = result.ok
    ? `Review request sent for ${member.companyName || memberId}.`
    : `Review request failed: ${result.error || 'unknown'}`;
  memory.remember(wid, 'review', { kind: 'review_request', text: summary });
  store.upsertInsight(wid, {
    roleId: 'review',
    type: 'review.request',
    title: result.ok ? 'Review request sent' : 'Review request failed',
    body: summary,
    href: '/network',
    severity: result.ok ? 'info' : 'warn',
  });
  if (result.ok) {
    recordBot(wid, role, onBehalfOf, {
      category: 'outreach',
      action: 'review_request',
      summary: summary.slice(0, 200),
    });
  }
  return { ...result, summary };
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
  prepareFocus,
  scanReviews,
  requestReview,
  scanPool,
  opsHealth,
  actorFor,
};
