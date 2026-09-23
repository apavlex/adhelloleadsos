const crypto = require('crypto');
const { isManualSource } = require('./leadListFilters');
const { normalizeEngagementSignals } = require('./engagementSignals');
const { isReferralLead, isFollowUpTask } = require('./todayPriorityLeads');

const DEFAULT_STAGE_NAMES = ['New opportunity', 'Contacted', 'Qualified', 'Proposal sent', 'Won'];
const MAX_PIPELINES = 12;
const MAX_STAGES = 12;
const MAX_NAME = 40;

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function cleanName(raw, fallback) {
  const name = String(raw || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, MAX_NAME);
  return name || fallback;
}

function defaultStages() {
  return DEFAULT_STAGE_NAMES.map((name) => ({ id: newId('ops'), name }));
}

function defaultPipeline(name) {
  return {
    id: newId('opl'),
    name: cleanName(name, 'Marketing Pipeline'),
    stages: defaultStages(),
  };
}

function normalizeStage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim();
  const name = cleanName(raw.name, '');
  if (!/^ops_[a-z0-9]+$/i.test(id) || !name) return null;
  return { id, name };
}

function normalizePipeline(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim();
  if (!/^opl_[a-z0-9]+$/i.test(id)) return null;
  const stages = (Array.isArray(raw.stages) ? raw.stages : [])
    .map(normalizeStage)
    .filter(Boolean)
    .slice(0, MAX_STAGES);
  if (!stages.length) return null;
  return { id, name: cleanName(raw.name, 'Pipeline'), stages };
}

function normalizeBoards(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  let pipelines = (Array.isArray(src.pipelines) ? src.pipelines : [])
    .map(normalizePipeline)
    .filter(Boolean)
    .slice(0, MAX_PIPELINES);
  let created = false;
  if (!pipelines.length) {
    pipelines = [defaultPipeline('Marketing Pipeline')];
    created = true;
  }
  let activePipelineId = String(src.activePipelineId || '').trim();
  if (!pipelines.some((pipeline) => pipeline.id === activePipelineId)) {
    activePipelineId = pipelines[0].id;
    created = true;
  }
  pipelines.forEach((pipeline) => {
    pipeline.stages.forEach((stage) => {
      if (stage.name.toLowerCase() === 'new lead') {
        stage.name = 'New opportunity';
        created = true;
      }
    });
  });
  return { boards: { activePipelineId, pipelines }, created };
}

function selectPipeline(boards, pipelineId) {
  const normalized = normalizeBoards(boards);
  const next = normalized.boards;
  const id = String(pipelineId || '').trim();
  let changed = normalized.created;
  if (id && next.pipelines.some((pipeline) => pipeline.id === id) && next.activePipelineId !== id) {
    next.activePipelineId = id;
    changed = true;
  }
  return { boards: next, changed };
}

function cloneBoards(boards) {
  return JSON.parse(JSON.stringify(boards));
}

function followUpKeys(tasks) {
  const keys = new Set();
  (Array.isArray(tasks) ? tasks : []).forEach((task) => {
    if (isFollowUpTask(task)) keys.add(task.leadKey);
  });
  return keys;
}

function hasReply(lead) {
  const signals = normalizeEngagementSignals(lead && lead.engagementSignals);
  return !!(signals.smsRepliedAt || signals.emailRepliedAt);
}

function isImportantLead(lead, keys) {
  if (!lead || !lead.key) return false;
  if (isManualSource(lead) || isReferralLead(lead) || hasReply(lead)) return true;
  return keys.has(lead.key);
}

function cardSource(lead, keys) {
  const custom = String((lead && lead.opportunitySource) || '').trim();
  if (custom) return custom.slice(0, 40);
  if (isReferralLead(lead)) return 'Referral';
  if (isManualSource(lead)) return 'Added by you';
  if (hasReply(lead)) return 'Replied';
  if (keys.has(lead && lead.key)) return 'Follow-up';
  return 'Opportunity';
}

function cardValue(lead) {
  const n = Number(lead && lead.opportunityValue);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function money(amount) {
  if (!amount) return '';
  return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function leadTitle(lead) {
  return String((lead && (lead.title || lead.company || lead.email)) || 'Opportunity').slice(0, 80);
}

function focusHref(lead) {
  const short = String((lead && lead.key) || '').replace(/^lead:/i, '');
  return `/focus?lead=${encodeURIComponent(short)}`;
}

function stageForLead(lead, pipeline, homePipelineId, keys) {
  if (!lead || !pipeline) return null;
  const stageIds = new Set(pipeline.stages.map((stage) => stage.id));
  const savedPipeline = String(lead.opportunityPipelineId || '');
  const savedStage = String(lead.opportunityStageId || '');
  if (savedPipeline && savedPipeline !== pipeline.id) return null;
  if (savedPipeline === pipeline.id && stageIds.has(savedStage)) return savedStage;
  if (savedPipeline === pipeline.id) return pipeline.stages[0].id;
  if (pipeline.id !== homePipelineId) return null;
  if (!isImportantLead(lead, keys)) return null;
  return pipeline.stages[0].id;
}

function buildOpportunityBoard(input) {
  const normalized = normalizeBoards(input && input.boards);
  const boards = normalized.boards;
  const want = String((input && input.pipelineId) || '').trim();
  const pipeline = boards.pipelines.find((item) => item.id === want) || boards.pipelines.find((item) => item.id === boards.activePipelineId) || boards.pipelines[0];
  const homePipelineId = boards.pipelines[0].id;
  const keys = followUpKeys(input && input.tasks);
  const leads = Array.isArray(input && input.leads) ? input.leads : [];
  const compactLimit = Number(input && input.compactLimit) > 0 ? Number(input.compactLimit) : 0;
  const grouped = new Map(pipeline.stages.map((stage) => [stage.id, []]));

  leads.forEach((lead) => {
    const stageId = stageForLead(lead, pipeline, homePipelineId, keys);
    if (!stageId || !grouped.has(stageId)) return;
    const value = cardValue(lead);
    grouped.get(stageId).push({
      key: String(lead.key),
      title: leadTitle(lead),
      href: focusHref(lead),
      source: cardSource(lead, keys),
      value,
      valueLabel: money(value),
    });
  });

  const stages = pipeline.stages.map((stage) => {
    const cards = grouped.get(stage.id) || [];
    const value = cards.reduce((sum, card) => sum + card.value, 0);
    return {
      id: stage.id,
      name: stage.name,
      count: cards.length,
      value,
      valueLabel: money(value),
      cards: compactLimit ? cards.slice(0, compactLimit) : cards,
      hiddenCount: compactLimit ? Math.max(0, cards.length - compactLimit) : 0,
    };
  });

  return {
    boards,
    created: normalized.created,
    pipeline: { id: pipeline.id, name: pipeline.name },
    pipelines: boards.pipelines.map((item) => ({ id: item.id, name: item.name })),
    stages,
    homePipelineId,
  };
}

function addPipeline(boards, name) {
  const next = cloneBoards(normalizeBoards(boards).boards);
  if (next.pipelines.length >= MAX_PIPELINES) {
    return { ok: false, error: `You can keep up to ${MAX_PIPELINES} pipelines.` };
  }
  const pipeline = defaultPipeline(name);
  next.pipelines.push(pipeline);
  next.activePipelineId = pipeline.id;
  return { ok: true, boards: next, pipelineId: pipeline.id };
}

function addStage(boards, pipelineId, name) {
  const next = cloneBoards(normalizeBoards(boards).boards);
  const pipeline = next.pipelines.find((item) => item.id === pipelineId);
  if (!pipeline) return { ok: false, error: 'Pipeline not found.' };
  const label = cleanName(name, '');
  if (!label) return { ok: false, error: 'Stage name is required.' };
  if (pipeline.stages.length >= MAX_STAGES) {
    return { ok: false, error: `A pipeline can have up to ${MAX_STAGES} stages.` };
  }
  const stage = { id: newId('ops'), name: label };
  pipeline.stages.push(stage);
  next.activePipelineId = pipeline.id;
  return { ok: true, boards: next, stageId: stage.id };
}

function renameStage(boards, stageId, name) {
  const next = cloneBoards(normalizeBoards(boards).boards);
  const label = cleanName(name, '');
  if (!label) return { ok: false, error: 'Stage name is required.' };
  let found = false;
  next.pipelines.forEach((pipeline) => {
    pipeline.stages.forEach((stage) => {
      if (stage.id === stageId) {
        stage.name = label;
        next.activePipelineId = pipeline.id;
        found = true;
      }
    });
  });
  if (!found) return { ok: false, error: 'Stage not found.' };
  return { ok: true, boards: next };
}

function renamePipeline(boards, pipelineId, name) {
  const next = cloneBoards(normalizeBoards(boards).boards);
  const pipeline = next.pipelines.find((item) => item.id === pipelineId);
  if (!pipeline) return { ok: false, error: 'Pipeline not found.' };
  pipeline.name = cleanName(name, pipeline.name);
  next.activePipelineId = pipeline.id;
  return { ok: true, boards: next };
}

function removeStage(boards, stageId) {
  const next = cloneBoards(normalizeBoards(boards).boards);
  for (const pipeline of next.pipelines) {
    const index = pipeline.stages.findIndex((stage) => stage.id === stageId);
    if (index === -1) continue;
    if (pipeline.stages.length <= 1) {
      return { ok: false, error: 'A pipeline needs at least one stage.' };
    }
    const fallback = pipeline.stages[index === 0 ? 1 : index - 1];
    pipeline.stages.splice(index, 1);
    next.activePipelineId = pipeline.id;
    return { ok: true, boards: next, pipelineId: pipeline.id, fallbackStageId: fallback.id };
  }
  return { ok: false, error: 'Stage not found.' };
}

function stageBelongsToPipeline(boards, pipelineId, stageId) {
  const normalized = normalizeBoards(boards).boards;
  const pipeline = normalized.pipelines.find((item) => item.id === pipelineId);
  if (!pipeline) return false;
  return pipeline.stages.some((stage) => stage.id === stageId);
}

module.exports = {
  DEFAULT_STAGE_NAMES,
  normalizeBoards,
  selectPipeline,
  buildOpportunityBoard,
  addPipeline,
  addStage,
  renameStage,
  renamePipeline,
  removeStage,
  stageBelongsToPipeline,
};
