/**
 * Apply call disposition + follow-up scheduling (shared by API route and auto-dial).
 */
const dbService = require('./database');
const signalwire = require('./signalwire');
const sequenceEngine = require('./sequenceEngine');
const { autoAttachCadenceIfNeeded } = require('./leadCadence');
const { upsertOpenTaskForLead } = require('./userTasks');
const { resolveFollowUpForDisposition } = require('./dispositionFollowUp');
const { quickLogLabelForDisposition } = require('./quickLogConfig');
const { triggerGhlProspectSync } = require('./ghlProspectSync');
const {
  resolveDialRetryPrefs,
  resolveNoAnswerRetryAt,
  formatRetryDelayLabel,
} = require('./dialRetryPrefs');

function humanizeDisposition(code) {
  const label = quickLogLabelForDisposition(code);
  if (label) return label;
  return String(code || '')
    .trim()
    .replace(/_/g, ' ');
}

function appendLeadUpdate(lead, entry) {
  const updates = Array.isArray(lead && lead.updates) ? [...lead.updates] : [];
  updates.push({
    timestamp: new Date().toISOString(),
    ...entry,
  });
  return updates;
}

function resolveWorkspaceCallerNumber(ws) {
  if (!ws || typeof ws !== 'object') return '';
  const telephony = ws.telephony && typeof ws.telephony === 'object' ? ws.telephony : {};
  const entries = Array.isArray(telephony.numberBankEntries) ? telephony.numberBankEntries : [];
  const fromEntries = entries.map((e) => signalwire.normalizePhone(e && e.number)).filter(Boolean);
  const fromLegacy = Array.isArray(telephony.numberBank)
    ? telephony.numberBank.map((n) => signalwire.normalizePhone(n)).filter(Boolean)
    : [];
  const bank = [...new Set([...fromEntries, ...fromLegacy])];
  const active = signalwire.normalizePhone(telephony.activeFromNumber || '');
  if (active && bank.includes(active)) return active;
  return bank[0] || '';
}

function workspaceCallerNumbers(ws) {
  if (!ws || typeof ws !== 'object') return [];
  const telephony = ws.telephony && typeof ws.telephony === 'object' ? ws.telephony : {};
  const entries = Array.isArray(telephony.numberBankEntries) ? telephony.numberBankEntries : [];
  const fromEntries = entries.map((e) => signalwire.normalizePhone(e && e.number)).filter(Boolean);
  const fromLegacy = Array.isArray(telephony.numberBank)
    ? telephony.numberBank.map((n) => signalwire.normalizePhone(n)).filter(Boolean)
    : [];
  return [...new Set([...fromEntries, ...fromLegacy])];
}

/**
 * @param {object} ctx
 * @param {string} ctx.workspaceId
 * @param {string} ctx.userEmail
 * @param {string} ctx.fullKey
 * @param {object} ctx.lead
 * @param {object} [ctx.ws]
 * @param {string} ctx.code
 * @param {string} [ctx.notes]
 * @param {string} [ctx.scheduledAt]
 * @param {boolean} [ctx.skipFollowUp]
 * @param {boolean} [ctx.deferGhlSync]
 * @param {string} [ctx.source] — 'auto_dial' | 'api'
 */
async function applyLeadDisposition(ctx) {
  const {
    workspaceId,
    userEmail,
    fullKey,
    lead,
    code: rawCode,
    notes: rawNotes = '',
    scheduledAt: clientScheduledAt = '',
    skipFollowUp = false,
    deferGhlSync = false,
    source = 'api',
  } = ctx;

  const code = String(rawCode || '').trim().toLowerCase();
  const notes = String(rawNotes || '').trim();
  if (!code) throw new Error('Disposition code is required.');

  const ws = ctx.ws || (await dbService.getWorkspace(workspaceId)) || { id: workspaceId };
  const dialRetry = resolveDialRetryPrefs(ws.telephony);
  const now = new Date();
  const patch = {};
  let status = lead.status || 'Not Contacted';
  let nextStep = '';
  let automation = '';

  if (code === 'connected') {
    status = 'Connected - Follow Up';
    nextStep = 'Send a concise recap with next step.';
  } else if (code === 'no_answer') {
    status = 'No Answer';
    const numbers = workspaceCallerNumbers(ws);
    const active = resolveWorkspaceCallerNumber(ws);
    const alternate = numbers.find((n) => n && n !== active) || '';
    nextStep = 'Retry in the next window.';
    const retryAt = clientScheduledAt
      ? new Date(clientScheduledAt)
      : resolveNoAnswerRetryAt(dialRetry, now);
    const retryIso = retryAt.toISOString();
    const delayLabel = formatRetryDelayLabel(retryIso, now);
    if (alternate) {
      patch.nextCallerId = alternate;
      automation = `Retry queued ${delayLabel} using alternate caller ID ${alternate}.`;
    } else {
      automation = `Retry queued ${delayLabel}.`;
    }
  } else if (code === 'voicemail') {
    status = 'Voicemail Left';
    const auto = await autoAttachCadenceIfNeeded({ leadKey: fullKey, workspaceId });
    automation =
      auto && auto.attached
        ? `Follow-up cadence queued (${auto.templateId}).`
        : 'Follow-up cadence already active.';
    nextStep = 'Run immediate day-0 follow-up email task.';
  } else if (code === 'callback') {
    status = 'Callback Requested';
    nextStep = 'Confirm callback window and prepare notes.';
  } else if (code === 'gatekeeper') {
    status = 'Gatekeeper';
    patch.scriptVariant = 'gatekeeper_bypass';
    automation = 'Switched to gatekeeper bypass script variant.';
    nextStep = 'Use gatekeeper bypass opener on next touch.';
  } else if (code === 'site_audit') {
    status = 'Follow-up';
    patch.lastTouchChannel = 'hosted_audit';
    automation = 'Site audit tagged for GHL follow-up.';
    nextStep = 'Deliver or confirm site audit review; follow up after they open it.';
  } else if (code === 'not_interested') {
    status = 'Closed - Lost';
    automation = 'Tagged not interested in GHL.';
    nextStep = 'Archive or remove from active prospecting lists.';
  } else if (code === 'send_info') {
    status = 'Email Sent';
    patch.lastTouchChannel = 'email';
    automation = 'Send-info action tagged for GHL follow-up.';
    nextStep = 'Confirm info was sent and schedule a review follow-up.';
  } else if (code === 'wrong_number') {
    status = 'Bad Number';
    patch.needsReenrichment = true;
    automation = 'Lead flagged for re-enrichment and alternate contact lookup.';
    nextStep = 'Run contact enrichment before next dial.';
  }

  patch.status = status;
  patch.lastDisposition = code;
  patch.lastDispositionAt = new Date().toISOString();
  if (notes) patch.lastDispositionNotes = notes.slice(0, 2000);
  if (code === 'callback' || code === 'connected' || code === 'gatekeeper') {
    patch.lastTouchChannel = 'call';
  } else if (code === 'voicemail') {
    patch.lastTouchChannel = 'email';
  }

  const dispNotes =
    source === 'auto_dial' && !notes ? 'Auto-tagged after dial (no pickup).' : notes;

  const updates = appendLeadUpdate(lead, {
    type: 'call_disposition',
    value: `Disposition: ${humanizeDisposition(code)}${dispNotes ? ` — ${dispNotes}` : ''}`,
    code,
    notes: dispNotes,
    automation,
    source: source === 'auto_dial' ? 'auto_dial' : undefined,
  });
  patch.updates = updates;
  patch.logs = [
    {
      type: 'call_disposition',
      message: `Disposition set to ${humanizeDisposition(code)}${automation ? ` · ${automation}` : ''}`,
      timestamp: new Date().toISOString(),
    },
  ];

  if (code === 'connected' || code === 'callback') {
    try {
      await sequenceEngine.pauseSequence(fullKey);
    } catch (_) {
      /* ignore */
    }
  }

  let effectiveScheduledAt = clientScheduledAt;
  if (code === 'no_answer' && !effectiveScheduledAt) {
    effectiveScheduledAt = resolveNoAnswerRetryAt(dialRetry, now).toISOString();
  }

  const followUp = resolveFollowUpForDisposition(code, {
    scheduledAt: effectiveScheduledAt || undefined,
    skipFollowUp,
    lead,
    notes: dispNotes,
    now,
  });

  let followUpTask = null;
  let scheduledAt = followUp.scheduledAt;
  if (!followUp.skipFollowUp && followUp.scheduledAt && followUp.taskTitle) {
    patch.nextActionAt = followUp.scheduledAt;
    if (code === 'no_answer' || code === 'callback') {
      patch.redialBlockedUntil = followUp.scheduledAt;
    }
    try {
      followUpTask = await upsertOpenTaskForLead(workspaceId, userEmail, {
        title: followUp.taskTitle,
        column: 'todo',
        scheduledAt: followUp.scheduledAt,
        leadKey: fullKey,
        preferredTaskId: code === 'callback' ? lead.callbackTaskId || null : null,
        source: 'disposition',
      });
      if (code === 'callback' && followUpTask && followUpTask.id) {
        patch.callbackTaskId = followUpTask.id;
      }
      if (code === 'callback') {
        automation = 'Callback task updated and redial paused until follow-up window.';
      } else if (!automation) {
        automation = 'Follow-up task scheduled.';
      } else if (!automation.includes('Follow-up task')) {
        automation = `${automation} Follow-up task scheduled.`;
      }
    } catch (taskErr) {
      console.warn('[disposition] follow-up task failed:', taskErr && taskErr.message);
    }
  }

  if (patch.logs && patch.logs[0]) {
    patch.logs[0].message = `Disposition set to ${humanizeDisposition(code)}${automation ? ` · ${automation}` : ''}`;
  }

  const updated = await dbService.updateLead(fullKey, patch, workspaceId);

  const shouldDeferGhl = deferGhlSync || source === 'auto_dial';
  if (!shouldDeferGhl) {
    triggerGhlProspectSync(fullKey, workspaceId, {
      trigger: `disposition:${code}`,
      note: dispNotes ? `Disposition: ${humanizeDisposition(code)}\n${dispNotes}` : '',
    });
  }

  return {
    lead: updated,
    status,
    nextStep,
    automation,
    followUpTask,
    scheduledAt,
    skipFollowUp: followUp.skipFollowUp,
  };
}

async function applyAutoNoAnswerAfterDial(ctx) {
  const ws = ctx.ws || (await dbService.getWorkspace(ctx.workspaceId));
  const prefs = resolveDialRetryPrefs(ws && ws.telephony);
  if (!prefs.autoNoAnswerOnDial) return ctx.lead;

  return applyLeadDisposition({
    ...ctx,
    ws,
    code: 'no_answer',
    notes: '',
    skipFollowUp: false,
    deferGhlSync: true,
    source: 'auto_dial',
  }).then((r) => r.lead);
}

module.exports = {
  applyLeadDisposition,
  applyAutoNoAnswerAfterDial,
  humanizeDisposition,
};
