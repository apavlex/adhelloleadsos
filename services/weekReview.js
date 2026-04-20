/**
 * "This week's review" card data (tracker + lead activity).
 */

const { getTemplate } = require('./sequenceTemplates');

function weekBoundsMs() {
  const end = Date.now();
  const start = end - 7 * 86400000;
  return { start, end };
}

function eventTimestampMs(iso) {
  const t = Date.parse(iso || '');
  return Number.isNaN(t) ? 0 : t;
}

function engagementCount(lead, start, end) {
  let n = 0;
  for (const u of lead.updates || []) {
    const t = eventTimestampMs(u.timestamp);
    if (t >= start && t <= end) n += 1;
  }
  for (const log of lead.logs || []) {
    const t = eventTimestampMs(log.timestamp);
    if (t >= start && t <= end) n += 1;
  }
  return n;
}

function bestCadenceLabel(leads, start, end) {
  const counts = new Map();
  for (const lead of leads || []) {
    for (const log of lead.logs || []) {
      const t = eventTimestampMs(log.timestamp);
      if (t < start || t > end) continue;
      if (String(log.type || '') !== 'sequence_step') continue;
      const meta = log.meta && typeof log.meta === 'object' ? log.meta : {};
      const tid =
        (meta.templateId && String(meta.templateId)) ||
        (log.templateId && String(log.templateId)) ||
        (lead.sequenceState && lead.sequenceState.templateId) ||
        'unknown';
      counts.set(tid, (counts.get(tid) || 0) + 1);
    }
  }
  let bestId = '';
  let bestN = 0;
  for (const [id, c] of counts) {
    if (c > bestN) {
      bestN = c;
      bestId = id;
    }
  }
  if (!bestId || bestN === 0) {
    return { label: 'No cadence touches logged this week', templateId: '', count: 0 };
  }
  const tpl = getTemplate(bestId);
  const label = tpl ? tpl.name || tpl.id : bestId.replace(/_/g, ' ');
  return { label, templateId: bestId, count: bestN };
}

function topLeadsByEngagement(leads, start, end, limit = 3) {
  const scored = (leads || []).map((l) => ({
    lead: l,
    n: engagementCount(l, start, end),
  }));
  scored.sort((a, b) => b.n - a.n);
  return scored
    .filter((x) => x.n > 0)
    .slice(0, limit)
    .map((x) => ({
      key: x.lead.key,
      title: x.lead.title || 'Lead',
      touches: x.n,
    }));
}

function suggestExperiment(conversion) {
  const r = conversion && conversion.replyRate7d != null ? conversion.replyRate7d : 0;
  const m = conversion && conversion.meetingsBooked7d != null ? conversion.meetingsBooked7d : 0;
  if (r < 0.02 && (conversion.touches7d || 0) > 5) {
    return 'Experiment: tighten ICP and send 10 shorter emails with one specific observation per lead; measure reply rate for 7 days.';
  }
  if (m === 0 && (conversion.touches7d || 0) > 8) {
    return 'Experiment: end each touch with a calendar link or “15m this week?” and log outcomes in notes to grow meetings booked.';
  }
  return 'Experiment: pick one high-opportunity lead and try a multi-channel day (email + DM + call) logged in sequence; compare to your weekly baseline.';
}

function buildWeekReview(leads, conversionSnapshot) {
  const { start, end } = weekBoundsMs();
  const cadence = bestCadenceLabel(leads, start, end);
  const topLeads = topLeadsByEngagement(leads, start, end, 3);
  const experiment = suggestExperiment(conversionSnapshot || {});
  return {
    cadence,
    topLeads,
    experiment,
  };
}

module.exports = {
  buildWeekReview,
  weekBoundsMs,
};
