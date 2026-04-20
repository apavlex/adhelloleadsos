/**
 * Revenue / conversion metrics for Today + analytics (rolling windows).
 */

const { PERSONALIZED_TOUCH_STATUSES } = require('./trackerStats');

function inTimeWindow(iso, startMs, endMs) {
  const t = Date.parse(iso || '');
  if (Number.isNaN(t)) return false;
  return t >= startMs && t <= endMs;
}

function blobFromUpdate(u) {
  return `${u.type || ''} ${u.value || ''}`.toLowerCase();
}

function blobFromLog(log) {
  return `${log.type || ''} ${log.message || ''}`.toLowerCase();
}

function isReplyBlob(blob) {
  return (
    blob.includes('reply') ||
    blob.includes('inbound') ||
    blob.includes('replied') ||
    blob.includes(' responded')
  );
}

function isMeetingBlob(blob) {
  return (
    /\bmeeting\b/.test(blob) ||
    /\bbooked\b/.test(blob) ||
    /\bcalendar\b/.test(blob) ||
    /\bzoom\b/.test(blob) ||
    /\bdemo\b/.test(blob) ||
    /\bscheduled\b/.test(blob)
  );
}

function isTouchUpdateInWindow(u, startMs, endMs) {
  if (!inTimeWindow(u.timestamp, startMs, endMs)) return false;
  if (u.type === 'note' && String(u.value || '').trim()) return true;
  if (u.type === 'status_change' && PERSONALIZED_TOUCH_STATUSES.has(String(u.value || '').trim())) {
    return true;
  }
  return false;
}

function isTouchLogInWindow(log, startMs, endMs) {
  if (!inTimeWindow(log.timestamp, startMs, endMs)) return false;
  return String(log.type || '') === 'sequence_step';
}

/** Count qualifying personalized-touch *events* in [startMs, endMs]. */
function countTouchEvents(leads, startMs, endMs) {
  let n = 0;
  for (const lead of leads || []) {
    for (const u of lead.updates || []) {
      if (isTouchUpdateInWindow(u, startMs, endMs)) n += 1;
    }
    for (const log of lead.logs || []) {
      if (isTouchLogInWindow(log, startMs, endMs)) n += 1;
    }
  }
  return n;
}

function countReplyEvents(leads, startMs, endMs) {
  let n = 0;
  for (const lead of leads || []) {
    for (const u of lead.updates || []) {
      if (!inTimeWindow(u.timestamp, startMs, endMs)) continue;
      const b = blobFromUpdate(u);
      if (isReplyBlob(b)) n += 1;
    }
    for (const log of lead.logs || []) {
      if (!inTimeWindow(log.timestamp, startMs, endMs)) continue;
      const b = blobFromLog(log);
      if (isReplyBlob(b)) n += 1;
    }
  }
  return n;
}

function countMeetingEvents(leads, startMs, endMs) {
  let n = 0;
  for (const lead of leads || []) {
    for (const u of lead.updates || []) {
      if (!inTimeWindow(u.timestamp, startMs, endMs)) continue;
      if (isMeetingBlob(blobFromUpdate(u))) n += 1;
    }
    for (const log of lead.logs || []) {
      if (!inTimeWindow(log.timestamp, startMs, endMs)) continue;
      if (isMeetingBlob(blobFromLog(log))) n += 1;
    }
  }
  return n;
}

function parseEstimatedValue(lead) {
  const raw = lead.estimatedValue != null ? lead.estimatedValue : lead.estimated_value;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw || '').replace(/[^0-9.-]/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function defaultAvgDealValue(workspace) {
  const raw = workspace && workspace.avgDealValue != null ? workspace.avgDealValue : null;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw || '').replace(/,/g, ''), 10);
  if (Number.isFinite(n) && n > 0) return n;
  return 3000;
}

/**
 * Sum deal value for leads that moved to pipeline stage 3+ with pipelineStageUpdatedAt in window.
 */
function sumPipelineValueCreated(leads, startMs, endMs, avgDealFallback) {
  let sum = 0;
  for (const lead of leads || []) {
    const ps = parseInt(lead.pipelineStage, 10);
    if (Number.isNaN(ps) || ps < 3) continue;
    const at = lead.pipelineStageUpdatedAt;
    if (!at || !inTimeWindow(at, startMs, endMs)) continue;
    const v = parseEstimatedValue(lead);
    sum += v != null ? v : avgDealFallback;
  }
  return sum;
}

function rolling7dBounds() {
  const end = Date.now();
  const start = end - 7 * 86400000;
  return { start, end };
}

function buildConversionSnapshot(leads, workspace) {
  const { start, end } = rolling7dBounds();
  const avgDeal = defaultAvgDealValue(workspace);
  const touches = countTouchEvents(leads, start, end);
  const replies = countReplyEvents(leads, start, end);
  const meetingsBooked = countMeetingEvents(leads, start, end);
  const pipelineValueCreated = sumPipelineValueCreated(leads, start, end, avgDeal);
  const replyRate7d = touches > 0 ? replies / touches : 0;
  return {
    replyRate7d,
    replyRate7dDisplay: `${Math.round(replyRate7d * 1000) / 10}%`,
    touches7d: touches,
    replies7d: replies,
    meetingsBooked7d: meetingsBooked,
    pipelineValueCreated7d: pipelineValueCreated,
    avgDealValue: avgDeal,
  };
}

module.exports = {
  buildConversionSnapshot,
  defaultAvgDealValue,
  countTouchEvents,
  countReplyEvents,
  rolling7dBounds,
};
