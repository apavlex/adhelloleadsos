/**
 * Track inbound call outcomes per workspace DID (phone bank entry).
 * Requires SignalWire Voice Status Callback → POST /api/telephony/voice/status
 * with Direction=inbound (workspace resolved by matching To → number bank).
 */
const signalwire = require('./signalwire');

function sanitizeInboundStats(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  return {
    incoming: Math.max(0, parseInt(String(o.incoming || '0'), 10) || 0),
    connected: Math.max(0, parseInt(String(o.connected || '0'), 10) || 0),
    missed: Math.max(0, parseInt(String(o.missed || '0'), 10) || 0),
    voicemail: Math.max(0, parseInt(String(o.voicemail || '0'), 10) || 0),
  };
}

function workspaceOwnsDid(ws, didNorm) {
  if (!didNorm) return false;
  const tp = ws && ws.telephony && typeof ws.telephony === 'object' ? ws.telephony : {};
  const entries = Array.isArray(tp.numberBankEntries) ? tp.numberBankEntries : [];
  const fromEntries = entries.map((e) => signalwire.normalizePhone(e && e.number)).filter(Boolean);
  const legacy = Array.isArray(tp.numberBank)
    ? tp.numberBank.map((n) => signalwire.normalizePhone(n)).filter(Boolean)
    : [];
  const set = new Set([...fromEntries, ...legacy]);
  return set.has(didNorm);
}

async function findWorkspaceIdForDid(dbService, toRaw) {
  const did = signalwire.normalizePhone(toRaw || '');
  if (!did) return '';
  let ids = [];
  try {
    ids = await dbService.listWorkspaceIds();
  } catch (_) {
    return '';
  }
  for (const id of ids) {
    let ws = null;
    try {
      ws = await dbService.getWorkspace(id);
    } catch (_) {
      /* skip */
    }
    if (ws && workspaceOwnsDid(ws, did)) return String(id);
  }
  return '';
}

function ensureDedupe(tp) {
  if (!tp.inboundCallDedupe || typeof tp.inboundCallDedupe !== 'object') tp.inboundCallDedupe = {};
  const d = tp.inboundCallDedupe;
  if (!Array.isArray(d.terminalSids)) d.terminalSids = [];
  return d;
}

function alreadyProcessedTerminal(tp, sid) {
  const d = ensureDedupe(tp);
  return d.terminalSids.includes(sid);
}

function markTerminalProcessed(tp, sid) {
  const d = ensureDedupe(tp);
  if (d.terminalSids.includes(sid)) return;
  d.terminalSids.push(sid);
  while (d.terminalSids.length > 2500) d.terminalSids.shift();
}

function classifyInboundOutcome(body) {
  const status = String(body.CallStatus || '').trim().toLowerCase();
  const duration = parseInt(String(body.CallDuration || body.Duration || '0'), 10) || 0;
  const answeredBy = String(body.AnsweredBy || '').trim().toLowerCase();

  if (['no-answer', 'busy', 'failed', 'canceled'].includes(status)) return 'missed';

  if (status !== 'completed') return null;

  if (answeredBy.includes('fax')) return 'voicemail';
  if (answeredBy.includes('machine')) return 'voicemail';

  if (duration <= 0) return 'missed';

  if (answeredBy.includes('human')) return 'connected';

  if (duration >= 18) return 'connected';

  if (duration >= 8 && !answeredBy.includes('machine')) return 'connected';

  if (duration < 8 && answeredBy.includes('unknown')) return 'voicemail';

  if (duration < 12) return 'voicemail';

  return 'connected';
}

/**
 * Record one inbound terminal event against the phone-bank entry for `To` DID.
 * Mutates workspace.telephony in memory; caller must save workspace if returns true.
 */
function recordInboundTerminalEvent(workspace, body) {
  const ws = workspace;
  if (!ws || !ws.telephony || typeof ws.telephony !== 'object') return false;

  const direction = String(body.Direction || body.CallDirection || '').trim().toLowerCase();
  if (!direction.includes('inbound')) return false;

  const callSid = String(body.CallSid || '').trim();
  const toNorm = signalwire.normalizePhone(body.To || '');
  if (!callSid || !toNorm) return false;

  const status = String(body.CallStatus || '').trim().toLowerCase();
  const terminal = ['completed', 'no-answer', 'busy', 'failed', 'canceled'].includes(status);
  if (!terminal) return false;

  const tp = ws.telephony;
  if (alreadyProcessedTerminal(tp, callSid)) return false;

  const bucket = classifyInboundOutcome(body);
  if (!bucket) return false;

  markTerminalProcessed(tp, callSid);

  const entries = Array.isArray(tp.numberBankEntries) ? [...tp.numberBankEntries] : [];
  const idx = entries.findIndex((e) => signalwire.normalizePhone(e && e.number) === toNorm);
  if (idx === -1) return false;

  const entry = { ...entries[idx] };
  const stats = sanitizeInboundStats(entry.inboundStats);
  stats.incoming += 1;
  if (bucket === 'connected') stats.connected += 1;
  else if (bucket === 'voicemail') stats.voicemail += 1;
  else stats.missed += 1;

  entry.inboundStats = stats;
  entry.lastInboundAt = new Date().toISOString();
  entries[idx] = entry;

  tp.numberBankEntries = entries;
  tp.numberBank = entries.map((e) => e.number).filter(Boolean);
  ws.telephony = tp;
  return true;
}

module.exports = {
  sanitizeInboundStats,
  workspaceOwnsDid,
  findWorkspaceIdForDid,
  recordInboundTerminalEvent,
};
