/**
 * Normalize and record lead engagement signals (SMS/email reply, opens, clicks, audit views).
 */
const dbService = require('./database');
const { upsertOpenTaskForLead } = require('./userTasks');
const { resolveTaskOwnerEmail } = require('./dispositionFollowUp');

const SIGNAL_FIELD = {
  sms_reply: 'smsRepliedAt',
  email_reply: 'emailRepliedAt',
  email_open: 'emailOpenedAt',
  link_click: 'linkClickedAt',
  audit_open: 'auditOpenedAt',
  mail_scan: 'mailScannedAt',
};

const SIGNAL_PRIORITY = {
  sms_reply: 1,
  email_reply: 1,
  link_click: 2,
  mail_scan: 2,
  audit_open: 3,
  email_open: 4,
};

function normalizeEngagementSignals(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    smsRepliedAt: s.smsRepliedAt || null,
    emailRepliedAt: s.emailRepliedAt || null,
    emailOpenedAt: s.emailOpenedAt || null,
    linkClickedAt: s.linkClickedAt || null,
    auditOpenedAt: s.auditOpenedAt || null,
    mailScannedAt: s.mailScannedAt || null,
    lastSignalAt: s.lastSignalAt || null,
    lastSignalType: s.lastSignalType || null,
  };
}

function recordEngagementSignals(existing, signalType, atIso) {
  const now = atIso || new Date().toISOString();
  const base = normalizeEngagementSignals(existing);
  const field = SIGNAL_FIELD[signalType];
  const patch = { ...base, lastSignalAt: now, lastSignalType: signalType };
  if (field) patch[field] = now;
  return patch;
}

function signalPriorityForLead(lead) {
  const s = normalizeEngagementSignals(lead && lead.engagementSignals);
  if (s.smsRepliedAt || s.emailRepliedAt) return 1;
  if (s.linkClickedAt) return 2;
  if (s.mailScannedAt) return 2;
  if (s.auditOpenedAt) return 3;
  if (s.emailOpenedAt) return 4;
  return 99;
}

function signalLabel(signalType) {
  const map = {
    sms_reply: 'SMS reply',
    email_reply: 'Email reply',
    link_click: 'Link click',
    audit_open: 'Audit open',
    email_open: 'Email open',
    mail_scan: 'Postcard QR scan',
  };
  return map[signalType] || 'Engagement';
}

function buildEngagementUpdateEntry(signalType, atIso, meta) {
  const m = meta && typeof meta === 'object' ? meta : {};
  const at = atIso || new Date().toISOString();
  const label = signalLabel(signalType);
  const parts = [label];
  if (m.linkUrl) parts.push(String(m.linkUrl).trim().slice(0, 120));
  if (m.provider) parts.push(`via ${String(m.provider).trim()}`);
  return {
    timestamp: at,
    type: 'engagement_signal',
    signalType: String(signalType || '').trim(),
    value: parts.join(' · '),
    provider: String(m.provider || 'ghl').trim(),
    linkUrl: String(m.linkUrl || '').trim(),
    messageId: String(m.messageId || '').trim(),
  };
}

/** Recent engagement pill for pipeline rows (null if none in window). */
function engagementBadgeForLead(lead, windowDays = 7, nowMs) {
  const s = normalizeEngagementSignals(lead && lead.engagementSignals);
  if (!s.lastSignalAt || !s.lastSignalType) return null;
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const cutoff = now - windowDays * 86400000;
  const atMs = Date.parse(s.lastSignalAt);
  if (!Number.isFinite(atMs) || atMs < cutoff) return null;
  return {
    signalType: s.lastSignalType,
    label: signalLabel(s.lastSignalType),
    at: s.lastSignalAt,
    atMs,
  };
}

function isClosedOrConnected(lead) {
  const status = String((lead && lead.status) || '').toLowerCase();
  if (status.includes('closed - won') || status.includes('closed - lost')) return true;
  if (status.startsWith('connected')) return true;
  return false;
}

async function ensureEngagementCallTask(workspaceId, lead, scheduledAt) {
  const ws = (await dbService.getWorkspace(workspaceId)) || { id: workspaceId };
  const ownerEmail = resolveTaskOwnerEmail(lead, ws);
  if (!ownerEmail || !lead || !lead.key) return null;
  const respondBy =
    scheduledAt ||
    new Date(Date.now() + 15 * 60 * 1000).toISOString();
  return upsertOpenTaskForLead(workspaceId, ownerEmail, {
    title: `Call — they engaged (${lead.title || 'Lead'})`,
    column: 'todo',
    scheduledAt: respondBy,
    leadKey: lead.key,
    source: 'engagement',
  });
}

/**
 * Persist engagement signal on lead and optionally create a high-priority call task.
 * @param {{ lead: object, workspaceId: string, signalType: string, at?: string, createTask?: boolean, taskAt?: string, extraPatch?: object }} ctx
 */
async function applyEngagementSignal(ctx) {
  const lead = ctx.lead;
  const workspaceId = String(ctx.workspaceId || (lead && lead.workspaceId) || '').trim();
  const signalType = String(ctx.signalType || '').trim();
  if (!lead || !lead.key || !workspaceId || !SIGNAL_FIELD[signalType]) {
    return { applied: false, reason: 'invalid_context' };
  }

  const atIso = ctx.at || new Date().toISOString();
  const engagementSignals = recordEngagementSignals(lead.engagementSignals, signalType, atIso);
  const updates = Array.isArray(lead.updates) ? [...lead.updates] : [];
  updates.push(
    buildEngagementUpdateEntry(signalType, atIso, {
      provider: ctx.provider || 'ghl',
      linkUrl: ctx.linkUrl || '',
      messageId: ctx.messageId || '',
    }),
  );
  const patch = {
    engagementSignals,
    updates,
    ...(ctx.extraPatch && typeof ctx.extraPatch === 'object' ? ctx.extraPatch : {}),
  };

  let task = null;
  if (ctx.createTask !== false) {
    try {
      task = await ensureEngagementCallTask(workspaceId, lead, ctx.taskAt);
    } catch (e) {
      console.warn('[engagementSignals] task upsert failed:', e && e.message);
    }
  }

  const updated = await dbService.updateLead(lead.key, patch, workspaceId);
  return { applied: true, lead: updated, taskId: task && task.id, engagementSignals };
}

module.exports = {
  SIGNAL_FIELD,
  SIGNAL_PRIORITY,
  normalizeEngagementSignals,
  recordEngagementSignals,
  signalPriorityForLead,
  signalLabel,
  buildEngagementUpdateEntry,
  engagementBadgeForLead,
  isClosedOrConnected,
  ensureEngagementCallTask,
  applyEngagementSignal,
};
