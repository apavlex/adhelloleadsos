/**
 * Warm inbound routing — fast-track audit/booking/form leads; skip cold cadences.
 */
const dbService = require('./database');
const sequenceEngine = require('./sequenceEngine');
const { upsertOpenTaskForLead } = require('./userTasks');
const { resolveTaskOwnerEmail } = require('./dispositionFollowUp');
const { triggerGhlProspectSync } = require('./ghlProspectSync');

const WARM_SOURCE_PREFIXES = ['adhello_', 'booking_', 'inbound_'];
const COLD_TEMPLATE_IDS = new Set([
  'audit_local_14',
  'clay_standard',
  'paul_standard',
  'bob_standard',
]);

function isWarmInboundSource(source) {
  const s = String(source || '').trim().toLowerCase();
  if (!s) return false;
  return WARM_SOURCE_PREFIXES.some((p) => s.startsWith(p)) || s === 'booking' || s === 'newsletter';
}

function isBookingSource(source) {
  const s = String(source || '').trim().toLowerCase();
  return s === 'booking' || s.startsWith('booking_') || s.includes('calendly') || s.includes('cal.com');
}

/**
 * After ingest/booking/form: warm leads get hot cadence + SLA task + GHL sync (no cold sequence).
 */
async function applyWarmInboundRules({ leadKey, workspaceId, source }) {
  const src = String(source || '').trim().toLowerCase();
  if (!isWarmInboundSource(src)) {
    return { applied: false, reason: 'not_warm_source' };
  }

  const fullKey = String(leadKey || '').startsWith('lead:') ? String(leadKey) : `lead:${leadKey}`;
  let lead = await dbService.getLead(fullKey);
  if (!lead) return { applied: false, reason: 'lead_not_found' };

  const wid = String(workspaceId || lead.workspaceId || '').trim();
  const ws = (await dbService.getWorkspace(wid)) || { id: wid };
  const ownerEmail = resolveTaskOwnerEmail(lead, ws);
  const now = new Date();
  const slaAt = new Date(now.getTime() + (isBookingSource(src) ? 60 : 5) * 60 * 1000).toISOString();

  const st = lead.sequenceState;
  const onCold =
    st &&
    st.status === 'active' &&
    COLD_TEMPLATE_IDS.has(String(st.templateId || ''));

  if (onCold) {
    try {
      await sequenceEngine.pauseSequence(fullKey);
    } catch (_) {
      /* ignore */
    }
  }

  let hotStarted = false;
  const refreshed = await dbService.getLead(fullKey);
  const st2 = refreshed && refreshed.sequenceState;
  const needsHot =
    !st2 ||
    st2.status === 'completed' ||
    st2.status === 'paused' ||
    COLD_TEMPLATE_IDS.has(String(st2.templateId || ''));

  if (needsHot) {
    try {
      await sequenceEngine.startSequence(fullKey, 'audit_hot_5');
      hotStarted = true;
    } catch (e) {
      console.warn('[leadRoutingRules] audit_hot_5 start failed:', e && e.message);
    }
  }

  lead = (await dbService.getLead(fullKey)) || lead;

  let task = null;
  if (ownerEmail) {
    const title = isBookingSource(src)
      ? `Meeting booked — prep for ${lead.title || 'Lead'}`
      : `Warm inbound — personal reply: ${lead.title || 'Lead'}`;
    try {
      task = await upsertOpenTaskForLead(wid, ownerEmail, {
        title,
        column: 'todo',
        scheduledAt: slaAt,
        leadKey: fullKey,
      });
    } catch (e) {
      console.warn('[leadRoutingRules] SLA task failed:', e && e.message);
    }
  }

  const patch = {
    status: isBookingSource(src) ? 'Meeting Booked' : 'Connected - Follow Up',
    nextActionAt: slaAt,
    routingApplied: {
      warm: true,
      source: src,
      hotCadence: hotStarted,
      at: now.toISOString(),
    },
    logs: [
      {
        type: 'warm_inbound_route',
        message: hotStarted
          ? 'Warm inbound fast-track — hot cadence started, cold sequence skipped.'
          : 'Warm inbound fast-track — SLA task created.',
        timestamp: now.toISOString(),
      },
    ],
  };

  await dbService.updateLead(fullKey, patch, wid);

  try {
    triggerGhlProspectSync(fullKey, wid, {
      trigger: `warm_inbound:${src}`,
      note: isBookingSource(src)
        ? 'Inbound booking — prep for call.'
        : 'Warm inbound lead — respond within 5 minutes.',
    });
  } catch (_) {
    /* non-fatal */
  }

  return {
    applied: true,
    hotCadenceStarted: hotStarted,
    taskId: task && task.id,
    slaAt,
  };
}

module.exports = {
  isWarmInboundSource,
  isBookingSource,
  applyWarmInboundRules,
  WARM_SOURCE_PREFIXES,
  COLD_TEMPLATE_IDS,
};
