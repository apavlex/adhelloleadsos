/**
 * Forward-only pipeline stage moves from operator actions (call, SMS, tag, automate).
 * Reuses workspace stages + patchLeadStageFields — does not invent a board schema.
 */
const pipelineStagesService = require('./pipelineStagesService');

const PIPELINE_ACTIONS = {
  CALL: 'CALL',
  SMS: 'SMS',
  ADD_TAG: 'ADD_TAG',
  AUTOMATE: 'AUTOMATE',
};

function sortStages(stages) {
  return [...(Array.isArray(stages) ? stages : [])].sort(
    (a, b) => (a.sortOrder || 0) - (b.sortOrder || 0),
  );
}

function normKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function normName(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function normalizeAction(action) {
  const s = normKey(action);
  if (s === 'call' || s === 'call_outbound' || s === 'voicemail' || s === 'voicemail_drop') {
    return PIPELINE_ACTIONS.CALL;
  }
  if (s === 'sms' || s === 'text' || s === 'imessage' || s === 'sms_outbound') {
    return PIPELINE_ACTIONS.SMS;
  }
  if (s === 'add_tag' || s === 'tag' || s === 'tags' || s === 'tag_add') {
    return PIPELINE_ACTIONS.ADD_TAG;
  }
  if (
    s === 'automate' ||
    s === 'auto_outreach' ||
    s === 'enroll' ||
    s === 'auto_outreach_enroll'
  ) {
    return PIPELINE_ACTIONS.AUTOMATE;
  }
  return s.toUpperCase();
}

function currentStageIndex(lead, stages) {
  if (!lead || !stages.length) return 0;
  if (lead.stageId) {
    const byId = stages.findIndex((s) => s && s.id === lead.stageId);
    if (byId >= 0) return byId;
  }
  if (lead.pipelineStageKey) {
    const want = normKey(lead.pipelineStageKey);
    const byKey = stages.findIndex((s) => s && normKey(s.key) === want);
    if (byKey >= 0) return byKey;
  }
  const n = parseInt(lead.pipelineStage, 10);
  if (Number.isFinite(n) && n >= 1) return Math.min(n - 1, stages.length - 1);
  return 0;
}

function isClosedTerminal(lead, stages) {
  const status = String((lead && lead.status) || '').toLowerCase();
  if (/closed\s*-?\s*(won|lost)/.test(status)) return true;
  if (status === 'won' || status === 'lost' || status === 'closed won' || status === 'closed lost') {
    return true;
  }
  const idx = currentStageIndex(lead, stages);
  const row = stages[idx];
  return !!(row && (row.isWon || row.isLost));
}

function stageMatches(stage, keyNeedles, nameNeedles) {
  if (!stage) return false;
  const key = normKey(stage.key);
  const name = normName(stage.name);
  for (const needle of keyNeedles) {
    if (key === normKey(needle)) return true;
  }
  for (const needle of nameNeedles) {
    const n = String(needle || '').toLowerCase();
    if (n && name.includes(n)) return true;
  }
  return false;
}

function findStage(stages, keyNeedles, nameNeedles) {
  return stages.find((s) => stageMatches(s, keyNeedles, nameNeedles)) || null;
}

function firstOpenAfterNew(stages) {
  const open = stages.filter((s) => s && !s.isWon && !s.isLost);
  if (open.length >= 2) return open[1];
  return open[0] || null;
}

function contactedOrFirstTouch(stages) {
  return (
    findStage(stages, ['contacted', 'first_touch'], ['contacted', 'first touch']) ||
    firstOpenAfterNew(stages)
  );
}

function workingOrContacted(stages) {
  return (
    findStage(stages, ['working'], ['working']) ||
    contactedOrFirstTouch(stages)
  );
}

function autoOutreachOrFollowUp(stages) {
  return (
    findStage(
      stages,
      ['auto_outreach', 'automate', 'automated', 'auto_nurture'],
      ['auto-outreach', 'auto outreach', 'automate'],
    ) ||
    findStage(stages, ['follow_up', 'followup'], ['follow-up', 'follow up']) ||
    contactedOrFirstTouch(stages)
  );
}

/**
 * Pick the destination stage for an action. Does not apply forward-only yet.
 * @param {string} action
 * @param {Array<object>} stages
 */
function resolveAdvanceTargetStage(action, stages) {
  const sorted = sortStages(stages);
  if (!sorted.length) return null;
  const act = normalizeAction(action);
  if (act === PIPELINE_ACTIONS.CALL || act === PIPELINE_ACTIONS.SMS) {
    return contactedOrFirstTouch(sorted);
  }
  if (act === PIPELINE_ACTIONS.ADD_TAG) {
    return workingOrContacted(sorted);
  }
  if (act === PIPELINE_ACTIONS.AUTOMATE) {
    return autoOutreachOrFollowUp(sorted);
  }
  return null;
}

function withPipelineLabel(patch, target) {
  if (!patch || !Object.keys(patch).length || !target) return patch || {};
  const name = String(target.name || '').trim();
  if (name) patch.pipelineLabel = name;
  return patch;
}

/**
 * Compute a lead patch that moves the card forward for this action.
 * Never rewinds. Never moves Closed-Won / Closed-Lost (status or isWon/isLost).
 *
 * @param {object} lead
 * @param {string} action CALL | SMS | ADD_TAG | AUTOMATE
 * @param {Array<object>} stages workspace pipeline stages
 * @returns {object} fields for updateLead, or {}
 */
function maybeAdvancePipelineStage(lead, action, stages) {
  if (!lead || !Array.isArray(stages) || !stages.length) return {};
  const sorted = sortStages(stages);
  if (isClosedTerminal(lead, sorted)) return {};

  const target = resolveAdvanceTargetStage(action, sorted);
  if (!target || !target.id) return {};

  const currentIdx = currentStageIndex(lead, sorted);
  const targetIdx = sorted.findIndex((s) => s && s.id === target.id);
  if (targetIdx < 0) return {};
  if (targetIdx <= currentIdx) return {};

  const patch = pipelineStagesService.patchLeadStageFields(lead, sorted, target.id);
  return withPipelineLabel(patch, target);
}

/**
 * Load workspace stages then maybeAdvancePipelineStage.
 * @param {object} lead
 * @param {string} action
 * @param {string} workspaceId
 */
async function buildPipelineAdvancePatch(lead, action, workspaceId) {
  if (!lead || !workspaceId) return {};
  const stages = await pipelineStagesService.ensureWorkspaceStagesSeeded(workspaceId);
  return maybeAdvancePipelineStage(lead, action, stages);
}

module.exports = {
  PIPELINE_ACTIONS,
  maybeAdvancePipelineStage,
  buildPipelineAdvancePatch,
  resolveAdvanceTargetStage,
  normalizeAction,
};
