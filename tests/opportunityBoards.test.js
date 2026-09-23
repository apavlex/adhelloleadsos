const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeBoards,
  selectPipeline,
  buildOpportunityBoard,
  addPipeline,
  addStage,
  renameStage,
  removeStage,
} = require('../services/opportunityBoards');

test('normalizeBoards creates a marketing pipeline with default stages', () => {
  const { boards, created } = normalizeBoards(null);
  assert.equal(created, true);
  assert.equal(boards.pipelines.length, 1);
  assert.deepEqual(
    boards.pipelines[0].stages.map((stage) => stage.name),
    ['New opportunity', 'Contacted', 'Qualified', 'Proposal sent', 'Won'],
  );
});

test('selectPipeline remembers a chosen pipeline', () => {
  const { boards } = normalizeBoards(null);
  const extra = addPipeline(boards, 'Referrals');
  const selected = selectPipeline(extra.boards, boards.pipelines[0].id);
  assert.equal(selected.changed, true);
  assert.equal(selected.boards.activePipelineId, boards.pipelines[0].id);
  const again = selectPipeline(selected.boards, boards.pipelines[0].id);
  assert.equal(again.changed, false);
});

test('normalizeBoards renames the default New lead stage to New opportunity', () => {
  const { boards, created } = normalizeBoards({
    activePipelineId: 'opl_abc123',
    pipelines: [
      {
        id: 'opl_abc123',
        name: 'Marketing Pipeline',
        stages: [{ id: 'ops_abc123', name: 'New lead' }, { id: 'ops_def456', name: 'Won' }],
      },
    ],
  });
  assert.equal(created, true);
  assert.equal(boards.pipelines[0].stages[0].name, 'New opportunity');
  assert.equal(boards.pipelines[0].stages[1].name, 'Won');
});

test('buildOpportunityBoard places important leads in New opportunity until they are moved', () => {
  const { boards } = normalizeBoards(null);
  const board = buildOpportunityBoard({
    boards,
    leads: [
      { key: 'lead:reply', title: 'Lawn Co', engagementSignals: { emailRepliedAt: '2026-09-22T12:00:00.000Z' } },
      {
        key: 'lead:moved',
        title: 'Moved Co',
        source: 'manual',
        opportunityPipelineId: boards.pipelines[0].id,
        opportunityStageId: boards.pipelines[0].stages[2].id,
        opportunityValue: 880,
      },
    ],
    tasks: [],
  });
  assert.equal(board.stages[0].cards[0].title, 'Lawn Co');
  assert.equal(board.stages[0].cards[0].source, 'Replied');
  assert.equal(board.stages[2].cards[0].title, 'Moved Co');
  assert.equal(board.stages[2].valueLabel, '$880.00');
});

test('stage edits stay on the same board object the Today page reads', () => {
  const { boards } = normalizeBoards(null);
  const pipelineId = boards.pipelines[0].id;
  const added = addStage(boards, pipelineId, 'Negotiation');
  assert.equal(added.ok, true);
  const renamed = renameStage(added.boards, added.stageId, 'Negotiation');
  assert.equal(renamed.ok, true);
  const removed = removeStage(renamed.boards, added.stageId);
  assert.equal(removed.ok, true);
  assert.equal(removed.fallbackStageId, renamed.boards.pipelines[0].stages[renamed.boards.pipelines[0].stages.length - 2].id);
  const extra = addPipeline(removed.boards, 'Referral pipeline');
  assert.equal(extra.ok, true);
  assert.equal(extra.boards.pipelines.length, 2);
  assert.equal(extra.boards.activePipelineId, extra.pipelineId);
});
