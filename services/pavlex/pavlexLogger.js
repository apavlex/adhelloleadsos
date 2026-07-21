/**
 * Pavlex agent request logging — [PAVLEX] prefix with tool execution detail.
 */
const PREFIX = '[PAVLEX]';

function logBlock(lines) {
  console.log(`${PREFIX}\n${lines.filter(Boolean).join('\n')}`);
}

function chatRequest(meta) {
  logBlock([
    `User: ${meta.user || 'unknown'}`,
    `Workspace: ${meta.workspaceId || '—'}`,
    meta.conversationId ? `Conversation: ${meta.conversationId}` : '',
    `Question: ${meta.question || '—'}`,
    `MCP: ${meta.mcpConnected ? 'Connected' : 'Disconnected'}`,
    meta.mcpMode ? `Mode: ${meta.mcpMode}` : '',
  ]);
}

function toolExecution(meta) {
  logBlock([
    `User: ${meta.user || 'unknown'}`,
    meta.question ? `Question: ${meta.question}` : '',
    `MCP: ${meta.mcpConnected !== false ? 'Connected' : 'Disconnected'}`,
    `Tool: ${meta.tool || 'unknown'}`,
    `Arguments: ${JSON.stringify(meta.args || {})}`,
    `Response: ${truncate(JSON.stringify(meta.response || {}), 800)}`,
    `Latency: ${meta.latencyMs != null ? `${meta.latencyMs}ms` : '—'}`,
  ]);
}

function chatResponse(meta) {
  logBlock([
    `User: ${meta.user || 'unknown'}`,
    `Question: ${truncate(meta.question || '', 200)}`,
    `MCP: ${meta.mcpEnabled ? 'Connected' : 'Disconnected'}`,
    meta.toolsUsed && meta.toolsUsed.length ? `Tools: ${meta.toolsUsed.join(', ')}` : '',
    `Provider: ${meta.provider || '—'}`,
    `Latency: ${meta.latencyMs != null ? `${meta.latencyMs}ms` : '—'}`,
  ]);
}

function error(meta) {
  console.error(`${PREFIX} ERROR ${JSON.stringify(meta)}`);
}

function truncate(str, max) {
  const s = String(str || '');
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

module.exports = {
  chatRequest,
  toolExecution,
  chatResponse,
  error,
};
