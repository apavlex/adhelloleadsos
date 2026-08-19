const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  maybeAdvancePipelineStage,
  resolveAdvanceTargetStage,
  PIPELINE_ACTIONS,
} = require('../services/pipelineAdvance');

function agencyStages() {
  return [
    { id: 's-new', key: 'new', name: 'New', sortOrder: 0, isWon: false, isLost: false },
    { id: 's-contacted', key: 'contacted', name: 'Contacted', sortOrder: 1, isWon: false, isLost: false },
    { id: 's-engaged', key: 'engaged', name: 'Engaged / replied', sortOrder: 2, isWon: false, isLost: false },
    { id: 's-discovery', key: 'discovery', name: 'Discovery booked', sortOrder: 3, isWon: false, isLost: false },
    { id: 's-proposal', key: 'proposal_sent', name: 'Proposal sent', sortOrder: 4, isWon: false, isLost: false },
    { id: 's-won', key: 'retainer_signed', name: 'Retainer signed', sortOrder: 5, isWon: true, isLost: false },
    { id: 's-lost', key: 'lost', name: 'Lost', sortOrder: 6, isWon: false, isLost: true },
  ];
}

function stagesWithWorkingAndAuto() {
  return [
    { id: 's-new', key: 'new', name: 'New', sortOrder: 0, isWon: false, isLost: false },
    { id: 's-working', key: 'working', name: 'Working', sortOrder: 1, isWon: false, isLost: false },
    { id: 's-contacted', key: 'contacted', name: 'Contacted', sortOrder: 2, isWon: false, isLost: false },
    { id: 's-auto', key: 'auto_outreach', name: 'Auto-outreach', sortOrder: 3, isWon: false, isLost: false },
    { id: 's-follow', key: 'follow_up', name: 'Follow-up', sortOrder: 4, isWon: false, isLost: false },
    { id: 's-won', key: 'won', name: 'Closed won', sortOrder: 5, isWon: true, isLost: false },
    { id: 's-lost', key: 'lost', name: 'Closed lost', sortOrder: 6, isWon: false, isLost: true },
  ];
}

function leadAt(stageId, extra = {}) {
  const stages = extra.stages || agencyStages();
  const row = stages.find((s) => s.id === stageId) || stages[0];
  const idx = stages.findIndex((s) => s.id === row.id);
  return {
    key: 'lead:test',
    status: extra.status || 'Not Contacted',
    stageId: row.id,
    pipelineStageKey: row.key,
    pipelineStage: idx + 1,
    ...extra,
  };
}

describe('maybeAdvancePipelineStage mapping', () => {
  it('CALL from New moves to Contacted', () => {
    const stages = agencyStages();
    const patch = maybeAdvancePipelineStage(leadAt('s-new', { stages }), 'CALL', stages);
    assert.equal(patch.stageId, 's-contacted');
    assert.equal(patch.pipelineStageKey, 'contacted');
    assert.equal(patch.pipelineStage, 2);
    assert.equal(patch.pipelineLabel, 'Contacted');
  });

  it('SMS from New moves to Contacted', () => {
    const stages = agencyStages();
    const patch = maybeAdvancePipelineStage(leadAt('s-new', { stages }), 'SMS', stages);
    assert.equal(patch.stageId, 's-contacted');
    assert.equal(patch.pipelineLabel, 'Contacted');
  });

  it('CALL from Contacted stays (forward-only)', () => {
    const stages = agencyStages();
    const patch = maybeAdvancePipelineStage(leadAt('s-contacted', { stages }), 'CALL', stages);
    assert.deepEqual(patch, {});
  });

  it('SMS from Discovery stays (already further)', () => {
    const stages = agencyStages();
    const patch = maybeAdvancePipelineStage(leadAt('s-discovery', { stages }), 'SMS', stages);
    assert.deepEqual(patch, {});
  });

  it('ADD_TAG bumps New to Contacted so it is not stuck in New', () => {
    const stages = agencyStages();
    const patch = maybeAdvancePipelineStage(leadAt('s-new', { stages }), 'ADD_TAG', stages);
    assert.equal(patch.stageId, 's-contacted');
    assert.equal(patch.pipelineStageKey, 'contacted');
  });

  it('ADD_TAG prefers Working when that stage exists', () => {
    const stages = stagesWithWorkingAndAuto();
    const patch = maybeAdvancePipelineStage(leadAt('s-new', { stages }), 'ADD_TAG', stages);
    assert.equal(patch.stageId, 's-working');
    assert.equal(patch.pipelineLabel, 'Working');
  });

  it('ADD_TAG leaves a further stage alone', () => {
    const stages = agencyStages();
    const patch = maybeAdvancePipelineStage(leadAt('s-engaged', { stages }), 'ADD_TAG', stages);
    assert.deepEqual(patch, {});
  });

  it('AUTOMATE uses Auto-outreach when that stage exists', () => {
    const stages = stagesWithWorkingAndAuto();
    const patch = maybeAdvancePipelineStage(leadAt('s-new', { stages }), 'AUTOMATE', stages);
    assert.equal(patch.stageId, 's-auto');
    assert.equal(patch.pipelineStageKey, 'auto_outreach');
    assert.equal(patch.pipelineLabel, 'Auto-outreach');
  });

  it('AUTOMATE falls back to Contacted when Auto-outreach is missing', () => {
    const stages = agencyStages();
    const patch = maybeAdvancePipelineStage(leadAt('s-new', { stages }), 'AUTOMATE', stages);
    assert.equal(patch.stageId, 's-contacted');
    assert.equal(patch.pipelineLabel, 'Contacted');
  });

  it('AUTOMATE does not rewind from Discovery to Contacted', () => {
    const stages = agencyStages();
    const patch = maybeAdvancePipelineStage(leadAt('s-discovery', { stages }), 'AUTOMATE', stages);
    assert.deepEqual(patch, {});
  });

  it('never moves Closed-Won status', () => {
    const stages = agencyStages();
    const patch = maybeAdvancePipelineStage(
      leadAt('s-new', { stages, status: 'Closed - Won' }),
      'CALL',
      stages,
    );
    assert.deepEqual(patch, {});
  });

  it('never moves Closed-Lost status', () => {
    const stages = agencyStages();
    const patch = maybeAdvancePipelineStage(
      leadAt('s-new', { stages, status: 'Closed - Lost' }),
      'SMS',
      stages,
    );
    assert.deepEqual(patch, {});
  });

  it('never moves a lead already on a won stage', () => {
    const stages = agencyStages();
    const patch = maybeAdvancePipelineStage(leadAt('s-won', { stages }), 'CALL', stages);
    assert.deepEqual(patch, {});
  });

  it('never moves a lead already on a lost stage', () => {
    const stages = agencyStages();
    const patch = maybeAdvancePipelineStage(leadAt('s-lost', { stages }), 'ADD_TAG', stages);
    assert.deepEqual(patch, {});
  });

  it('resolves first-touch to Contacted on the agency preset', () => {
    const target = resolveAdvanceTargetStage(PIPELINE_ACTIONS.CALL, agencyStages());
    assert.equal(target && target.key, 'contacted');
  });

  it('CALL still works with pipelineStage number only (no stageId)', () => {
    const stages = agencyStages();
    const patch = maybeAdvancePipelineStage(
      { key: 'lead:legacy', pipelineStage: 1, status: 'Not Contacted' },
      'CALL',
      stages,
    );
    assert.equal(patch.stageId, 's-contacted');
    assert.equal(patch.pipelineStage, 2);
  });
});
