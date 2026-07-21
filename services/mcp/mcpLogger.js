/**
 * Structured logging for MCP connection, tool discovery, invocation, and errors.
 */
const PREFIX = '[MCP]';

function log(level, event, meta) {
  const payload = { event, ts: new Date().toISOString(), ...(meta || {}) };
  const line = `${PREFIX} ${event} ${JSON.stringify(payload)}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

function connectionStatus(meta) {
  log('info', 'connection_status', meta);
}

function toolsDiscovered(meta) {
  log('info', 'tools_discovered', meta);
}

function toolInvoke(meta) {
  log('info', 'tool_invoke', meta);
}

function toolResponse(meta) {
  log('info', 'tool_response', meta);
}

function transportError(meta) {
  log('error', 'transport_error', meta);
}

function authError(meta) {
  log('error', 'auth_error', meta);
}

function chatRuntime(meta) {
  log('info', 'chat_runtime', meta);
}

module.exports = {
  connectionStatus,
  toolsDiscovered,
  toolInvoke,
  toolResponse,
  transportError,
  authError,
  chatRuntime,
};
