/**
 * Per-lead facts derived from `updates` / `logs`, memoized on the lead object.
 * Cached workspace lead lists hand out the same objects across requests, so Today's
 * rolling-window counters can skip untouched leads without re-parsing every timestamp.
 * A memo entry is reused only while the lead still holds the same arrays at the same length.
 */

const _memo = new WeakMap();

/**
 * Memo object for this lead's current updates/logs (null for non-objects).
 * Callers may attach their own derived fields; they are dropped when the arrays change.
 */
function leadActivityMemo(lead) {
  if (!lead || typeof lead !== 'object') return null;
  const { updates, logs } = lead;
  const uLen = Array.isArray(updates) ? updates.length : -1;
  const lLen = Array.isArray(logs) ? logs.length : -1;
  let m = _memo.get(lead);
  if (!m || m.updates !== updates || m.logs !== logs || m.uLen !== uLen || m.lLen !== lLen) {
    m = { updates, logs, uLen, lLen };
    _memo.set(lead, m);
  }
  return m;
}

function maxTimestampMs(list) {
  let max = -Infinity;
  for (const entry of list) {
    if (!entry) continue;
    const t = Date.parse(entry.timestamp || '');
    if (t > max) max = t;
  }
  return max;
}

/**
 * Latest parseable `timestamp` across lead.updates and lead.logs (-Infinity when none).
 * Returns +Infinity when either field is present but not an array, so callers never skip it.
 */
function latestActivityTimestampMs(lead) {
  const m = leadActivityMemo(lead);
  if (!m) return -Infinity;
  if (m.latestMs === undefined) {
    const { updates, logs } = m;
    if ((updates != null && !Array.isArray(updates)) || (logs != null && !Array.isArray(logs))) {
      m.latestMs = Infinity;
    } else {
      m.latestMs = Math.max(
        Array.isArray(updates) ? maxTimestampMs(updates) : -Infinity,
        Array.isArray(logs) ? maxTimestampMs(logs) : -Infinity,
      );
    }
  }
  return m.latestMs;
}

/** False only when no update/log `timestamp` on the lead is at or after startMs. */
function leadHasActivitySince(lead, startMs) {
  return latestActivityTimestampMs(lead) >= startMs;
}

/** Any log whose type/message mentions a reply or inbound message (Today "replies waiting"). */
function leadLogsMentionReply(lead) {
  const m = leadActivityMemo(lead);
  if (!m) return false;
  if (m.replySignal === undefined) {
    const logs = lead.logs || [];
    m.replySignal = logs.some((log) => {
      const blob = `${log.type || ''} ${log.message || ''}`.toLowerCase();
      return blob.includes('reply') || blob.includes('inbound') || blob.includes('replied');
    });
  }
  return m.replySignal;
}

module.exports = {
  leadActivityMemo,
  latestActivityTimestampMs,
  leadHasActivitySince,
  leadLogsMentionReply,
};
