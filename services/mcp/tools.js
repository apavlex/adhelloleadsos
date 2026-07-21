/**
 * CRM MCP tool registry and in-process execution.
 */
const { getOpenAiToolManifest } = require('./mcpServerFactory');
const {
  TOOL_NAMES,
  executeCrmTool,
  getOpenAiFunctionTools,
} = require('./mcpToolExecutor');

function listToolDefinitions() {
  const manifest = getOpenAiToolManifest();
  return manifest.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
}

function discoverToolsFromManifest(manifestJson) {
  if (!manifestJson || !Array.isArray(manifestJson.tools)) {
    return TOOL_NAMES.slice();
  }
  return manifestJson.tools.map((t) => t.name).filter(Boolean);
}

module.exports = {
  TOOL_NAMES,
  CRM_TOOL_NAMES: TOOL_NAMES,
  executeCrmTool,
  getOpenAiFunctionTools,
  listToolDefinitions,
  discoverToolsFromManifest,
};
