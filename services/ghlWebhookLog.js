/**
 * Last GHL webhook hits per workspace, so Integrations can show whether GHL is sending anything.
 */
const dbService = require('./database');

const MAX_ENTRIES = 20;
const kvKey = (wid) => `ghlWebhookLog:${wid}`;

function describePayload(body) {
  const b = body && typeof body === 'object' ? body : {};
  const wf = b.workflow && typeof b.workflow === 'object' ? String(b.workflow.name || '').trim() : '';
  if (wf) return `Workflow: ${wf}`;
  const type = String(b.type || b.event || b.eventType || '').trim();
  const mt = String(b.messageType || '').trim();
  return [type || 'Unknown event', mt].filter(Boolean).join(' · ');
}

function list(workspaceId) {
  const wid = String(workspaceId || '').trim();
  if (!wid) return [];
  const raw = dbService.getKvSync(kvKey(wid));
  let arr = raw;
  if (typeof raw === 'string') {
    try {
      arr = JSON.parse(raw);
    } catch {
      arr = [];
    }
  }
  return Array.isArray(arr) ? arr : [];
}

/** Never throws. */
function record(workspaceId, body, result) {
  try {
    const wid = String(workspaceId || 'default').trim();
    const r = result && typeof result === 'object' ? result : {};
    const entry = {
      at: new Date().toISOString(),
      event: describePayload(body).slice(0, 120),
      action: String(r.action || '').slice(0, 40),
      ignored: !!r.ignored,
      reason: String(r.reason || '').slice(0, 60),
      leadKey: r.key ? String(r.key) : '',
    };
    console.log('[ghl:webhook] ws=%s event=%s action=%s reason=%s', wid, entry.event, entry.action || '-', entry.reason || '-');
    dbService.setKvSync(kvKey(wid), [entry, ...list(wid)].slice(0, MAX_ENTRIES));
  } catch (e) {
    console.warn('[ghl:webhook] log failed:', e && e.message);
  }
}

module.exports = { record, list, describePayload };
