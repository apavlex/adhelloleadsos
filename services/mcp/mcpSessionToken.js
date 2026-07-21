/**
 * Short-lived signed tokens tying MCP access to a logged-in user + workspace.
 * Used by OpenAI Responses API when calling our remote MCP server on behalf of Pavlex chat.
 */
const crypto = require('crypto');

const DEFAULT_TTL_SEC = 15 * 60;

function signingSecret() {
  return (
    String(process.env.MCP_SESSION_SECRET || '').trim() ||
    String(process.env.SESSION_SECRET || '').trim() ||
    'adhello-mcp-session-dev-only'
  );
}

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function fromB64url(str) {
  return Buffer.from(String(str || ''), 'base64url').toString('utf8');
}

function signPayload(payloadB64) {
  return crypto.createHmac('sha256', signingSecret()).update(payloadB64).digest('base64url');
}

/**
 * @param {{ workspaceId: string, userEmail: string, ttlSec?: number }} opts
 */
function createMcpSessionToken({ workspaceId, userEmail, ttlSec = DEFAULT_TTL_SEC }) {
  const wid = String(workspaceId || '').trim();
  const email = String(userEmail || '').trim().toLowerCase();
  if (!wid || !email) return null;

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    typ: 'mcp_session',
    wid,
    email,
    iat: now,
    exp: now + Math.max(60, ttlSec),
  };
  const payloadB64 = b64url(JSON.stringify(payload));
  const sig = signPayload(payloadB64);
  return `${payloadB64}.${sig}`;
}

function verifyMcpSessionToken(token) {
  const raw = String(token || '').trim();
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;

  const payloadB64 = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  if (!payloadB64 || !sig) return null;

  const expected = signPayload(payloadB64);
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(fromB64url(payloadB64));
  } catch {
    return null;
  }

  if (!payload || payload.typ !== 'mcp_session') return null;
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < now) return null;
  if (!payload.wid || !payload.email) return null;

  return {
    workspaceId: String(payload.wid),
    userEmail: String(payload.email),
    authMethod: 'session_token',
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  };
}

module.exports = {
  createMcpSessionToken,
  verifyMcpSessionToken,
  DEFAULT_TTL_SEC,
};
