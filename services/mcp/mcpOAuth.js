/**
 * OAuth 2.1 authorization server for MCP clients (ChatGPT apps, Claude connectors, etc.):
 * dynamic client registration, authorization codes with PKCE (S256), rotating refresh
 * tokens, and per-workspace grants the owner can revoke from Integrations.
 *
 * KV keys (values JSON; secrets stored as sha256 only):
 *   oauthclient:<clientId>
 *   oauthcode:<sha256(code)>
 *   oauthtoken:<sha256(accessToken)>
 *   oauthrefresh:<sha256(refreshToken)>
 *   oauthgrant:<grantId>
 */
const crypto = require('crypto');
const dbService = require('../database');
const workspaceBootstrap = require('../workspaceBootstrap');

const CODE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TTL_MS = 60 * 60 * 1000;
const REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const GRANT_TOUCH_MS = 10 * 60 * 1000;
const SCOPE = 'crm';
const ACCESS_PREFIX = 'aho_at_';
const REFRESH_PREFIX = 'aho_rt_';
const MAX_REDIRECT_URIS = 10;
const BLOCKED_SCHEMES = new Set(['javascript:', 'data:', 'file:', 'vbscript:', 'blob:', 'about:']);

class OAuthError extends Error {
  constructor(error, description, status = 400) {
    super(description);
    this.error = error;
    this.status = status;
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function randomToken(prefix = '') {
  return `${prefix}${crypto.randomBytes(32).toString('base64url')}`;
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

async function readJson(key) {
  const raw = await dbService.peekStorageKey(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function cleanText(value, max) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, max);
}

/** https anywhere, http only on loopback, or a native app scheme (claude://, cursor://). No fragments. */
function validRedirectUri(value) {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch {
    return false;
  }
  if (url.hash) return false;
  if (BLOCKED_SCHEMES.has(url.protocol)) return false;
  if (url.protocol === 'https:') return true;
  if (url.protocol === 'http:') return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  return /^[a-z][a-z0-9+.-]*:$/i.test(url.protocol);
}

// ── Clients (RFC 7591) ───────────────────────────────────────────────────────

async function registerClient(body) {
  const input = body && typeof body === 'object' ? body : {};
  const redirectUris = Array.isArray(input.redirect_uris) ? input.redirect_uris.map((u) => String(u || '').trim()) : [];
  if (!redirectUris.length) throw new OAuthError('invalid_redirect_uri', 'redirect_uris is required.');
  if (redirectUris.length > MAX_REDIRECT_URIS) throw new OAuthError('invalid_redirect_uri', 'Too many redirect_uris.');
  const bad = redirectUris.find((u) => !validRedirectUri(u));
  if (bad) throw new OAuthError('invalid_redirect_uri', `Redirect URI not allowed: ${bad}`);

  const grantTypes = Array.isArray(input.grant_types) && input.grant_types.length ? input.grant_types : ['authorization_code', 'refresh_token'];
  if (grantTypes.some((g) => !['authorization_code', 'refresh_token'].includes(g))) {
    throw new OAuthError('invalid_client_metadata', 'Only authorization_code and refresh_token grants are supported.');
  }
  const authMethod = String(input.token_endpoint_auth_method || 'none');
  if (!['none', 'client_secret_post', 'client_secret_basic'].includes(authMethod)) {
    throw new OAuthError('invalid_client_metadata', 'Unsupported token_endpoint_auth_method.');
  }

  const clientId = `mcp_${crypto.randomBytes(12).toString('hex')}`;
  const clientSecret = authMethod === 'none' ? '' : randomToken();
  const now = new Date();
  const client = {
    id: clientId,
    name: cleanText(input.client_name, 120) || 'AI assistant',
    clientUri: /^https:\/\//i.test(String(input.client_uri || '')) ? cleanText(input.client_uri, 300) : '',
    redirectUris,
    grantTypes,
    tokenEndpointAuthMethod: authMethod,
    secretHash: clientSecret ? sha256(clientSecret) : '',
    createdAt: now.toISOString(),
  };
  await dbService.putStorageKey(`oauthclient:${clientId}`, client);
  return {
    client_id: clientId,
    ...(clientSecret ? { client_secret: clientSecret, client_secret_expires_at: 0 } : {}),
    client_id_issued_at: Math.floor(now.getTime() / 1000),
    client_name: client.name,
    redirect_uris: redirectUris,
    grant_types: grantTypes,
    response_types: ['code'],
    token_endpoint_auth_method: authMethod,
    scope: SCOPE,
  };
}

async function getClient(clientId) {
  const id = String(clientId || '').trim();
  if (!/^mcp_[a-f0-9]{24}$/.test(id)) return null;
  return readJson(`oauthclient:${id}`);
}

/**
 * Client created by a workspace admin for apps that ask for a Client ID instead of
 * registering themselves (Meta AI, some Grok/agent builders). Always confidential.
 * With no redirect URI, the first one used at /authorize is locked in.
 */
async function createManualClient({ workspaceId, name, redirectUri, createdBy }) {
  const uri = String(redirectUri || '').trim();
  if (uri && !validRedirectUri(uri)) throw new OAuthError('invalid_redirect_uri', `Redirect URI not allowed: ${uri}`);
  const clientId = `mcp_${crypto.randomBytes(12).toString('hex')}`;
  const clientSecret = randomToken();
  const client = {
    id: clientId,
    name: cleanText(name, 120) || 'AI assistant',
    clientUri: '',
    redirectUris: uri ? [uri] : [],
    grantTypes: ['authorization_code', 'refresh_token'],
    tokenEndpointAuthMethod: 'client_secret_post',
    secretHash: sha256(clientSecret),
    manual: true,
    workspaceId: String(workspaceId),
    createdBy: String(createdBy || '').toLowerCase(),
    createdAt: new Date().toISOString(),
  };
  await dbService.putStorageKey(`oauthclient:${clientId}`, client);
  return { client, clientSecret };
}

async function listManualClients(workspaceId) {
  const keys = await dbService.listStorageKeysWithPrefix('oauthclient:');
  const rows = [];
  for (const key of keys) {
    const c = await readJson(key);
    if (c && c.manual && c.workspaceId === workspaceId) {
      rows.push({ id: c.id, name: c.name, redirectUris: c.redirectUris || [], createdBy: c.createdBy || '', createdAt: c.createdAt || '' });
    }
  }
  return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

async function deleteManualClient(workspaceId, clientId) {
  const client = await getClient(clientId);
  if (!client || !client.manual || client.workspaceId !== workspaceId) return false;
  for (const key of await dbService.listStorageKeysWithPrefix('oauthgrant:')) {
    const grant = await readJson(key);
    if (grant && grant.clientId === client.id && !grant.revokedAt) await revokeGrantById(grant.id);
  }
  await dbService.deleteStorageKey(`oauthclient:${client.id}`);
  return true;
}

function authenticateClient(client, secret) {
  if (!client) throw new OAuthError('invalid_client', 'Unknown client.', 401);
  if (client.tokenEndpointAuthMethod === 'none') return;
  if (!secret || !safeEqual(sha256(secret), client.secretHash)) throw new OAuthError('invalid_client', 'Client authentication failed.', 401);
}

// ── Authorization requests ───────────────────────────────────────────────────

/**
 * Check an /authorize request. Errors that can't be safely redirected (bad client or
 * redirect_uri) come back with `redirect: false` so the caller shows them on a page.
 */
async function checkAuthorizeRequest(query) {
  const q = query || {};
  const client = await getClient(q.client_id);
  if (!client) return { ok: false, redirect: false, error: 'This app is not registered. Remove the connector and add it again.' };
  let redirectUri = String(q.redirect_uri || '').trim();
  if (!redirectUri && client.redirectUris.length === 1) redirectUri = client.redirectUris[0];
  if (client.manual && !client.redirectUris.length && validRedirectUri(redirectUri)) {
    client.redirectUris = [redirectUri];
    await dbService.putStorageKey(`oauthclient:${client.id}`, client);
  }
  if (!client.redirectUris.includes(redirectUri)) {
    return { ok: false, redirect: false, error: 'The redirect address does not match what this app registered.' };
  }
  const fail = (error, description) => ({ ok: false, redirect: true, redirectUri, state: q.state, error, description });
  if (q.response_type !== 'code') return fail('unsupported_response_type', 'Only response_type=code is supported.');
  // Public clients must use PKCE; confidential clients prove themselves with the secret at /token.
  const confidential = client.tokenEndpointAuthMethod !== 'none';
  if (!q.code_challenge && !confidential) return fail('invalid_request', 'PKCE code_challenge is required.');
  if (q.code_challenge) {
    if ((q.code_challenge_method || 'plain') !== 'S256') return fail('invalid_request', 'code_challenge_method must be S256.');
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(String(q.code_challenge))) return fail('invalid_request', 'Malformed code_challenge.');
  }
  return {
    ok: true,
    client,
    params: {
      clientId: client.id,
      redirectUri,
      codeChallenge: q.code_challenge ? String(q.code_challenge) : '',
      state: q.state == null ? '' : String(q.state).slice(0, 500),
      resource: cleanText(q.resource, 400),
    },
  };
}

function redirectWith(redirectUri, params) {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function issueAuthorizationCode({ params, workspaceId, userEmail }) {
  const code = randomToken();
  await dbService.putStorageKey(`oauthcode:${sha256(code)}`, {
    ...params,
    workspaceId: String(workspaceId),
    userEmail: String(userEmail || '').toLowerCase(),
    expiresAt: Date.now() + CODE_TTL_MS,
  });
  return code;
}

// ── Tokens ───────────────────────────────────────────────────────────────────

async function issueTokens(grant, { previousAccessHash } = {}) {
  const accessToken = randomToken(ACCESS_PREFIX);
  const refreshToken = randomToken(REFRESH_PREFIX);
  const accessHash = sha256(accessToken);
  const now = Date.now();
  if (previousAccessHash) await dbService.deleteStorageKey(`oauthtoken:${previousAccessHash}`);
  await dbService.putStorageKey(`oauthtoken:${accessHash}`, { grantId: grant.id, expiresAt: now + ACCESS_TTL_MS });
  await dbService.putStorageKey(`oauthrefresh:${sha256(refreshToken)}`, {
    grantId: grant.id,
    clientId: grant.clientId,
    accessHash,
    expiresAt: now + REFRESH_TTL_MS,
  });
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: Math.floor(ACCESS_TTL_MS / 1000),
    refresh_token: refreshToken,
    scope: SCOPE,
  };
}

async function exchangeAuthorizationCode({ code, clientId, clientSecret, redirectUri, codeVerifier }) {
  const client = await getClient(clientId);
  authenticateClient(client, clientSecret);
  const key = `oauthcode:${sha256(code || '')}`;
  const record = code ? await readJson(key) : null;
  if (record) await dbService.deleteStorageKey(key);
  if (!record || record.expiresAt < Date.now()) throw new OAuthError('invalid_grant', 'Authorization code is invalid or expired.');
  if (record.clientId !== client.id) throw new OAuthError('invalid_grant', 'Code was issued to another client.');
  if (redirectUri && redirectUri !== record.redirectUri) throw new OAuthError('invalid_grant', 'redirect_uri does not match.');
  if (record.codeChallenge || client.tokenEndpointAuthMethod === 'none') {
    const verifier = String(codeVerifier || '');
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw new OAuthError('invalid_grant', 'code_verifier is missing or malformed.');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    if (!safeEqual(challenge, record.codeChallenge || '')) throw new OAuthError('invalid_grant', 'PKCE verification failed.');
  }

  const grant = {
    id: `g_${crypto.randomBytes(10).toString('hex')}`,
    clientId: client.id,
    clientName: client.name,
    workspaceId: record.workspaceId,
    userEmail: record.userEmail,
    scope: SCOPE,
    resource: record.resource || '',
    createdAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
    revokedAt: '',
  };
  await dbService.putStorageKey(`oauthgrant:${grant.id}`, grant);
  return issueTokens(grant);
}

async function liveGrant(grantId) {
  const grant = grantId ? await readJson(`oauthgrant:${grantId}`) : null;
  if (!grant || grant.revokedAt) return null;
  const ws = await dbService.getWorkspace(grant.workspaceId);
  if (!ws || !workspaceBootstrap.userCanAccessWorkspace(ws, grant.userEmail)) return null;
  return { grant, workspace: ws };
}

async function refreshAccessToken({ refreshToken, clientId, clientSecret }) {
  const client = await getClient(clientId);
  authenticateClient(client, clientSecret);
  const key = `oauthrefresh:${sha256(refreshToken || '')}`;
  const record = refreshToken ? await readJson(key) : null;
  if (record) await dbService.deleteStorageKey(key);
  if (!record || record.expiresAt < Date.now() || record.clientId !== client.id) {
    throw new OAuthError('invalid_grant', 'Refresh token is invalid or expired.');
  }
  const live = await liveGrant(record.grantId);
  if (!live) throw new OAuthError('invalid_grant', 'Access was revoked.');
  return issueTokens(live.grant, { previousAccessHash: record.accessHash });
}

/** Returns { workspaceId, workspace, userEmail, grantId, clientName } or null. */
async function validateAccessToken(token) {
  const raw = String(token || '');
  if (!raw.startsWith(ACCESS_PREFIX)) return null;
  const key = `oauthtoken:${sha256(raw)}`;
  const record = await readJson(key);
  if (!record) return null;
  if (record.expiresAt < Date.now()) {
    await dbService.deleteStorageKey(key);
    return null;
  }
  const live = await liveGrant(record.grantId);
  if (!live) return null;
  const { grant } = live;
  if (Date.now() - Date.parse(grant.lastUsedAt || 0) > GRANT_TOUCH_MS) {
    await dbService.putStorageKey(`oauthgrant:${grant.id}`, { ...grant, lastUsedAt: new Date().toISOString() });
  }
  return {
    workspaceId: grant.workspaceId,
    workspace: live.workspace,
    userEmail: grant.userEmail,
    grantId: grant.id,
    clientName: grant.clientName,
  };
}

/** RFC 7009: revoking either token kills the whole grant. Unknown tokens are not an error. */
async function revokeToken(token) {
  const raw = String(token || '');
  const kind = raw.startsWith(REFRESH_PREFIX) ? 'oauthrefresh' : 'oauthtoken';
  const record = await readJson(`${kind}:${sha256(raw)}`);
  if (record && record.grantId) await revokeGrantById(record.grantId);
}

async function revokeGrantById(grantId) {
  const grant = await readJson(`oauthgrant:${grantId}`);
  if (!grant || grant.revokedAt) return false;
  await dbService.putStorageKey(`oauthgrant:${grant.id}`, { ...grant, revokedAt: new Date().toISOString() });
  return true;
}

async function listGrantsForWorkspace(workspaceId) {
  const keys = await dbService.listStorageKeysWithPrefix('oauthgrant:');
  const rows = [];
  for (const key of keys) {
    const grant = await readJson(key);
    if (grant && grant.workspaceId === workspaceId && !grant.revokedAt) rows.push(grant);
  }
  return rows.sort((a, b) => String(b.lastUsedAt || '').localeCompare(String(a.lastUsedAt || '')));
}

async function revokeGrantForWorkspace(workspaceId, grantId) {
  const grant = await readJson(`oauthgrant:${String(grantId || '')}`);
  if (!grant || grant.workspaceId !== workspaceId) return false;
  return revokeGrantById(grant.id);
}

// ── Discovery (RFC 8414 / RFC 9728) ──────────────────────────────────────────

function authorizationServerMetadata(base) {
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    scopes_supported: [SCOPE],
    service_documentation: `${base}/workspace/integrations#mcp-integration`,
  };
}

function protectedResourceMetadata(base) {
  return {
    resource: `${base}/ceo/mcp`,
    authorization_servers: [base],
    bearer_methods_supported: ['header'],
    scopes_supported: [SCOPE],
    resource_name: 'AdHello Leads',
    resource_documentation: `${base}/workspace/integrations#mcp-integration`,
  };
}

module.exports = {
  OAuthError,
  SCOPE,
  ACCESS_PREFIX,
  validRedirectUri,
  registerClient,
  getClient,
  createManualClient,
  listManualClients,
  deleteManualClient,
  checkAuthorizeRequest,
  redirectWith,
  issueAuthorizationCode,
  exchangeAuthorizationCode,
  refreshAccessToken,
  validateAccessToken,
  revokeToken,
  listGrantsForWorkspace,
  revokeGrantForWorkspace,
  authorizationServerMetadata,
  protectedResourceMetadata,
};
