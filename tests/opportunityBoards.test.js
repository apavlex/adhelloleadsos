const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeBoards,
  selectPipeline,
  buildOpportunityBoard,
  cardNotePreview,
  addPipeline,
  addStage,
  renameStage,
  removeStage,
  resolvePlacement,
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
        phone: 'N/A',
        email: 'ada@example.com',
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
  assert.equal(board.stages[2].cards[0].phone, '');
  assert.equal(board.stages[2].cards[0].email, 'ada@example.com');
  assert.equal(board.stages[2].cards[0].emailHref, 'mailto:ada@example.com');
  assert.match(board.stages[2].cards[0].scheduleHref, /intent=schedule/);
  assert.match(board.stages[2].cards[0].taskHref, /intent=task/);
  assert.match(board.stages[2].cards[0].tagsHref, /focusLead=/);
});

test('opportunity cards show category, status, the latest note, and reviews', () => {
  const { boards } = normalizeBoards(null);
  const board = buildOpportunityBoard({
    boards,
    leads: [
      {
        key: 'lead:cafe',
        title: 'Bluebird Cafe',
        source: 'manual',
        categoryName: 'Cafe',
        city: 'Austin',
        state: 'TX',
        totalScore: 4.8,
        reviewsCount: 48,
        opportunityPipelineId: boards.pipelines[0].id,
        opportunityStageId: boards.pipelines[0].stages[0].id,
        lastDisposition: 'connected',
        lastDispositionAt: new Date().toISOString(),
        updates: [{ type: 'note', value: 'Asked for a proposal next week.', timestamp: '2026-09-22T15:00:00.000Z' }],
      },
    ],
    tasks: [],
  });
  const card = board.stages[0].cards[0];
  assert.equal(card.category, 'Cafe');
  assert.match(card.status, /^DM connected/);
  assert.equal(card.note, 'Asked for a proposal next week.');
  assert.equal(card.reviews, '4.8 · 48 reviews');
  assert.equal(card.city, 'Austin, TX');
});

test('opportunity cards hide a note that only repeats the status', () => {
  const { boards } = normalizeBoards(null);
  const stageId = boards.pipelines[0].stages[1].id;
  const board = buildOpportunityBoard({
    boards,
    leads: [
      {
        key: 'lead:floor',
        title: 'Columbia Flooring Group, LLC',
        opportunityPipelineId: boards.pipelines[0].id,
        opportunityStageId: stageId,
        lastDisposition: 'not_interested',
        lastDispositionAt: '2026-07-23T21:37:00.000Z',
        lastDispositionNotes: '[Jul 23, 2026, 2:37 PM] Not interested',
      },
      {
        key: 'lead:keep',
        title: 'Keep Note Co',
        opportunityPipelineId: boards.pipelines[0].id,
        opportunityStageId: stageId,
        lastDisposition: 'not_interested',
        lastDispositionAt: '2026-07-23T21:37:00.000Z',
        updates: [{ type: 'note', value: 'Owner said they already signed with another agency.', timestamp: '2026-07-23T21:40:00.000Z' }],
      },
    ],
    tasks: [],
  });
  const floor = board.stages[1].cards.find((card) => card.key === 'lead:floor');
  const keep = board.stages[1].cards.find((card) => card.key === 'lead:keep');
  assert.match(floor.status, /^Not interested/);
  assert.equal(floor.note, '');
  assert.equal(keep.note, 'Owner said they already signed with another agency.');
});

test('dismissed leads stay off the opportunity board until they are placed again', () => {
  const { boards } = normalizeBoards(null);
  const board = buildOpportunityBoard({
    boards,
    leads: [
      {
        key: 'lead:gone',
        title: 'Columbia Flooring Group, LLC',
        source: 'manual',
        opportunityDismissed: true,
      },
      {
        key: 'lead:back',
        title: 'Courtney Coffee',
        source: 'manual',
        opportunityDismissed: true,
        opportunityPipelineId: boards.pipelines[0].id,
        opportunityStageId: boards.pipelines[0].stages[1].id,
      },
    ],
    tasks: [],
  });
  const titles = board.stages.flatMap((stage) => stage.cards.map((card) => card.title));
  assert.deepEqual(titles, ['Courtney Coffee']);
  assert.equal(board.stages[1].cards[0].key, 'lead:back');
});

test('resolvePlacement maps a same-named stage onto the selected board', () => {
  const { boards } = normalizeBoards(null);
  const extra = addPipeline(boards, 'Marketing Pipeline');
  const otherStage = boards.pipelines[0].stages[0];
  const resolved = resolvePlacement(extra.boards, extra.pipelineId, otherStage.id);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.pipelineId, extra.pipelineId);
  assert.equal(resolved.stageName, 'New opportunity');
  assert.notEqual(resolved.stageId, otherStage.id);
  const byLabel = resolvePlacement(extra.boards, extra.pipelineId, 'ops_missing', 'Qualified');
  assert.equal(byLabel.ok, true);
  assert.equal(byLabel.stageName, 'Qualified');
  const missing = resolvePlacement(extra.boards, extra.pipelineId, 'ops_missing', 'Not a stage');
  assert.equal(missing.ok, false);
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

test('cardNotePreview strips Focus call script body for compact cards', () => {
  assert.equal(
    cardNotePreview('[Focus · call script]\n\nHi —, I noticed Diplomat Flooring on Maps…'),
    'Focus · call script',
  );
  assert.equal(
    cardNotePreview('[Focus · call script]\n\nLong script\n\nOutcome: Call back'),
    'Focus · call script · Call back',
  );
  assert.equal(cardNotePreview('Asked for a proposal next week.'), 'Asked for a proposal next week.');
});

test('opportunity cards show Focus label without script body', () => {
  const { boards } = normalizeBoards(null);
  const board = buildOpportunityBoard({
    boards,
    leads: [
      {
        key: 'lead:diplomat',
        title: 'Diplomat Flooring',
        opportunityPipelineId: boards.pipelines[0].id,
        opportunityStageId: boards.pipelines[0].stages[0].id,
        updates: [
          {
            type: 'note',
            value: '[Focus · call script]\n\nHi —, I noticed Diplomat Flooring…',
            timestamp: '2026-09-24T15:00:00.000Z',
          },
        ],
      },
    ],
    tasks: [],
  });
  assert.equal(board.stages[0].cards[0].note, 'Focus · call script');
});
