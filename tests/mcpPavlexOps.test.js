const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { TOOL_NAMES, getOpenAiFunctionTools } = require('../services/mcp/mcpToolExecutor');
const { getOpenAiToolManifest } = require('../services/mcp/mcpServerFactory');
const { MCP_UPDATABLE_LEAD_FIELDS } = require('../services/mcp/mcpCrmService');
const {
  listPipelineTemplates,
  addPipeline,
  normalizeBoards,
  resolvePlacement,
} = require('../services/opportunityBoards');

const NEW_TOOLS = [
  'list_opportunity_pipelines',
  'get_opportunity_board',
  'create_opportunity_pipeline',
  'move_opportunity',
  'enrich_lead',
  'list_tasks',
  'create_task',
  'update_task',
  'list_followups',
  'suggest_daily_leads',
];

describe('Pavlex MCP ops registry', () => {
  it('registers opportunity, enrich, task, and suggestion tools', () => {
    for (const name of NEW_TOOLS) {
      assert.ok(TOOL_NAMES.includes(name), `missing ${name}`);
    }
  });

  it('OpenAI function tools match TOOL_NAMES', () => {
    const names = getOpenAiFunctionTools().map((t) => t.function.name);
    assert.deepEqual(names.sort(), TOOL_NAMES.slice().sort());
  });

  it('manifest tools match TOOL_NAMES', () => {
    const names = getOpenAiToolManifest().tools.map((t) => t.name);
    assert.deepEqual(names.sort(), TOOL_NAMES.slice().sort());
  });

  it('allows opportunity placement fields on update_lead', () => {
    assert.ok(MCP_UPDATABLE_LEAD_FIELDS.has('opportunityPipelineId'));
    assert.ok(MCP_UPDATABLE_LEAD_FIELDS.has('opportunityStageId'));
  });

  it('creates a pipeline from a template and resolves stage by name', () => {
    const templates = listPipelineTemplates();
    assert.ok(templates.length > 0);
    const boards = normalizeBoards(null).boards;
    const created = addPipeline(boards, 'Chat Pipeline', templates[0].id);
    assert.equal(created.ok, true);
    const stageName = created.boards.pipelines.find((p) => p.id === created.pipelineId).stages[0]
      .name;
    const placement = resolvePlacement(created.boards, created.pipelineId, null, stageName);
    assert.equal(placement.ok, true);
    assert.equal(placement.stageName, stageName);
  });
});
