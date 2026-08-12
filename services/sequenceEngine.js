const dbService = require('./database');
const { getTemplate, dueAtIso } = require('./sequenceTemplates');
const { createAuditReportToken } = require('./auditReportSign');
const { expandCadenceText } = require('./cadenceTokens');
const { upsertOpenTaskForLead } = require('./userTasks');
const { resolveTaskOwnerEmail } = require('./dispositionFollowUp');

function fullLeadKey(key) {
  return key.startsWith('lead:') ? key : `lead:${key}`;
}

/**
 * Attach sequence + first due time (step 0 fires when due).
 */
async function startSequence(leadKey, templateId, options = {}) {
  const tpl = getTemplate(templateId);
  if (!tpl || !tpl.steps.length) {
    throw new Error(`Unknown sequence template: ${templateId}`);
  }

  const key = fullLeadKey(leadKey);
  const lead = await dbService.getLead(key);
  if (!lead) throw new Error('Lead not found');

  const anchorTime = options.anchorTime || new Date().toISOString();
  const stepIndex = 0;
  const nextDueAt = dueAtIso(anchorTime, tpl.steps[stepIndex].dayOffset);

  const sequenceState = {
    templateId,
    anchorTime,
    stepIndex,
    nextDueAt,
    status: 'active',
    startedAt: new Date().toISOString(),
  };

  if (/^(audit_|auto_outreach)/i.test(String(templateId)) && lead.workspaceId) {
    try {
      sequenceState.publicAuditToken = createAuditReportToken({
        leadKey: key,
        workspaceId: lead.workspaceId,
      });
    } catch (e) {
      console.warn('[sequenceEngine] audit token skipped:', e && e.message);
    }
  }

  await dbService.updateLead(key, {
    sequenceState,
    logs: [
      {
        type: 'sequence_start',
        message: `Cadence started: ${tpl.name} (${tpl.steps.length} steps)`,
        timestamp: new Date().toISOString(),
      },
    ],
  });

  return { key, sequenceState, template: tpl };
}

async function pauseSequence(leadKey) {
  const key = fullLeadKey(leadKey);
  const lead = await dbService.getLead(key);
  if (!lead || !lead.sequenceState) return null;
  await dbService.updateLead(key, {
    sequenceState: {
      ...lead.sequenceState,
      status: 'paused',
      pausedAt: new Date().toISOString(),
    },
    logs: [
      {
        type: 'sequence_pause',
        message: 'Cadence paused',
        timestamp: new Date().toISOString(),
      },
    ],
  });
  return true;
}

function formatStepMessage(step, tplName, lead, baseUrl) {
  const ch = (step.channel || 'task').toUpperCase();
  const title = expandCadenceText(step.title || '', lead, { baseUrl });
  const hint = expandCadenceText(step.hint || '', lead, { baseUrl });
  return `[${ch}] ${title}${hint ? ` — ${hint}` : ''}`;
}

/**
 * Fire one due step and advance; called by scheduler.
 */
async function processLeadSequence(lead) {
  const st = lead.sequenceState;
  if (!st || st.status !== 'active' || !st.nextDueAt) return false;

  const tpl = getTemplate(st.templateId);
  if (!tpl || !tpl.steps.length) {
    await dbService.updateLead(lead.key, {
      sequenceState: null,
      logs: [
        {
          type: 'sequence_error',
          message: 'Cadence stopped — template missing',
          timestamp: new Date().toISOString(),
        },
      ],
    });
    return false;
  }

  const now = Date.now();
  if (Date.parse(st.nextDueAt) > now) return false;

  const idx = typeof st.stepIndex === 'number' ? st.stepIndex : 0;
  if (idx >= tpl.steps.length) {
    await dbService.updateLead(lead.key, {
      sequenceState: {
        templateId: st.templateId,
        status: 'completed',
        completedAt: new Date().toISOString(),
      },
      logs: [
        {
          type: 'sequence_complete',
          message: `Cadence completed: ${tpl.name}`,
          timestamp: new Date().toISOString(),
        },
      ],
    });
    return true;
  }

  const step = tpl.steps[idx];
  const baseUrl = String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  const msg = formatStepMessage(step, tpl.name, lead, baseUrl);

  let sendResult = null;
  const { executeSequenceStep, isAutoChannel } = require('./sequenceStepExecutor');
  if (isAutoChannel(step.channel)) {
    try {
      sendResult = await executeSequenceStep({
        lead,
        step,
        workspaceId: lead.workspaceId,
      });
    } catch (e) {
      sendResult = { executed: false, reason: 'send_failed', error: e && e.message };
    }
  }

  const nextIdx = idx + 1;
  let sequenceState;
  if (nextIdx >= tpl.steps.length) {
    sequenceState = {
      templateId: st.templateId,
      status: 'completed',
      completedAt: new Date().toISOString(),
      anchorTime: st.anchorTime,
    };
  } else {
    sequenceState = {
      ...st,
      stepIndex: nextIdx,
      nextDueAt: dueAtIso(st.anchorTime, tpl.steps[nextIdx].dayOffset),
      status: 'active',
    };
  }

  const logMeta = {
    templateId: st.templateId,
    stepIndex: idx,
    channel: step.channel,
  };
  if (sendResult) {
    logMeta.send = {
      executed: !!sendResult.executed,
      reason: sendResult.reason || null,
      provider: sendResult.provider || null,
      messageId: sendResult.messageId || null,
    };
  }

  let sendNote = '';
  if (sendResult && sendResult.executed) {
    sendNote = ` · Sent via ${sendResult.provider || 'GHL'}`;
  } else if (sendResult && sendResult.reason === 'send_failed') {
    sendNote = ` · Send failed: ${(sendResult.error || 'unknown').slice(0, 80)}`;
  } else if (sendResult && isAutoChannel(step.channel)) {
    sendNote = ` · Send skipped (${sendResult.reason || 'not ready'})`;
  }

  const stepUpdates = [
    {
      type: 'sequence_step',
      value: msg,
      timestamp: new Date().toISOString(),
      meta: logMeta,
    },
  ];
  if (sendResult && sendResult.executed) {
    stepUpdates.push({
      type: sendResult.channel === 'email' ? 'email_outbound' : 'sms_outbound',
      value:
        sendResult.channel === 'email'
          ? `Cadence email: ${msg.slice(0, 200)}`
          : `Cadence SMS: ${msg.slice(0, 200)}`,
      timestamp: new Date().toISOString(),
      provider: sendResult.provider || 'ghl',
      ghlMessageId: sendResult.messageId || '',
      cadenceStep: idx,
      templateId: st.templateId,
    });
  }

  const existingUpdates = Array.isArray(lead.updates) ? lead.updates : [];

  await dbService.updateLead(lead.key, {
    sequenceState,
    updates: [...existingUpdates, ...stepUpdates],
    logs: [
      {
        type: 'sequence_step',
        message: `${msg}${sendNote}`,
        timestamp: new Date().toISOString(),
        meta: logMeta,
      },
    ],
  });

  const workspaceId = lead.workspaceId;
  if (workspaceId) {
    try {
      const ws = await dbService.getWorkspace(workspaceId);
      const email = resolveTaskOwnerEmail(lead, ws);
      if (email) {
        const dueIso = st.nextDueAt || new Date().toISOString();
        await upsertOpenTaskForLead(workspaceId, email, {
          title: msg.slice(0, 200),
          column: 'todo',
          scheduledAt: dueIso,
          leadKey: lead.key,
          source: 'cadence',
        });
      }
    } catch (e) {
      console.warn('[sequenceEngine] cadence task skipped:', e && e.message);
    }
  }

  return true;
}

async function runDueSequenceSteps() {
  const leads = await dbService.getAllLeadsUnscoped();
  let n = 0;
  for (const lead of leads) {
    const st = lead.sequenceState;
    if (!st || st.status !== 'active') continue;
    if (!st.nextDueAt || Date.parse(st.nextDueAt) > Date.now()) continue;
    const ran = await processLeadSequence(lead);
    if (ran) n += 1;
  }
  return n;
}

module.exports = {
  startSequence,
  pauseSequence,
  processLeadSequence,
  runDueSequenceSteps,
  listTemplates: require('./sequenceTemplates').listTemplates,
};
