const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeBoards,
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
    ['New lead', 'Contacted', 'Qualified', 'Proposal sent', 'Won'],
  );
});

test('buildOpportunityBoard places important leads in New lead until they are moved', () => {
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
