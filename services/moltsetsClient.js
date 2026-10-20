/**
 * MoltSets REST client — verified emails, reverse lookups, people search.
 * Docs: https://developer.moltsets.com
 * Base: https://api.moltsets.com/api/v1/tools
 */

const DEFAULT_API_BASE = 'https://api.moltsets.com/api/v1/tools';
const USER_AGENT = 'AdHello/1.0';

function resolveConfig(integrationEnv) {
  const env = integrationEnv || {};
  const apiKey = String(env.MOLTSETS_API_KEY || process.env.MOLTSETS_API_KEY || '').trim();
  const apiBase = String(
    env.MOLTSETS_API_BASE || process.env.MOLTSETS_API_BASE || DEFAULT_API_BASE,
  )
    .trim()
    .replace(/\/$/, '');
  return { apiKey, apiBase: apiBase || DEFAULT_API_BASE };
}

function isConfigured(integrationEnv) {
  return Boolean(resolveConfig(integrationEnv).apiKey);
}

function formatApiError(status, data) {
  if (data && data.error && typeof data.error.message === 'string') {
    return data.error.message;
  }
  if (data && data.error && typeof data.error.code === 'string') {
    return `MoltSets ${data.error.code}`;
  }
  if (data && typeof data.message === 'string') return data.message;
  return `MoltSets API error (${status})`;
}

/**
 * POST a MoltSets tool. Completions are HTTP 200 with body.status ok|not_found.
 * @returns {Promise<{ status: string, results: any, metadata: object, httpStatus: number }>}
 */
async function callTool(tool, body, integrationEnv) {
  const { apiKey, apiBase } = resolveConfig(integrationEnv);
  if (!apiKey) {
    throw new Error('MoltSets is not configured. Set MOLTSETS_API_KEY in Workspace → Integrations.');
  }
  const path = String(tool || '').replace(/^\//, '');
  if (!path) throw new Error('MoltSets tool name required.');

  const res = await fetch(`${apiBase}/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify(body && typeof body === 'object' ? body : {}),
  });

  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const err = new Error(formatApiError(res.status, data));
    err.status = res.status;
    err.code = data && data.error && data.error.code ? String(data.error.code) : '';
    err.body = data;
    throw err;
  }

  return {
    status: String(data.status || 'ok').toLowerCase(),
    results: data.results != null ? data.results : null,
    metadata: data.metadata && typeof data.metadata === 'object' ? data.metadata : {},
    httpStatus: res.status,
  };
}

/** Free account check — used by Workspace → Test connection. */
async function testConnection(integrationEnv) {
  const out = await callTool('get_account', {}, integrationEnv);
  if (out.status !== 'ok') {
    throw new Error('MoltSets account lookup returned no data.');
  }
  const r = out.results || {};
  const name = String(r.name || r.id || 'account').trim();
  const plan = String(r.plan || '').trim();
  const tokens =
    r.token_balance != null
      ? Number(r.token_balance)
      : out.metadata && out.metadata.tokens_remaining != null
        ? Number(out.metadata.tokens_remaining)
        : null;
  const bits = [`Connected · ${name}`];
  if (plan) bits.push(plan);
  if (Number.isFinite(tokens)) bits.push(`${tokens} tokens`);
  return { message: bits.join(' · '), account: r, metadata: out.metadata };
}

function getAccount(integrationEnv) {
  return callTool('get_account', {}, integrationEnv);
}

function reverseEmailLookup(email, integrationEnv) {
  return callTool('reverse_email_lookup', { email: String(email || '').trim() }, integrationEnv);
}

function searchBusinessEmailByName(input, integrationEnv) {
  const body = {};
  const name = String((input && input.name) || '').trim();
  const first = String((input && input.first_name) || '').trim();
  const last = String((input && input.last_name) || '').trim();
  const company = String((input && (input.company || input.company_domain)) || '').trim();
  if (name) body.name = name;
  else {
    if (first) body.first_name = first;
    if (last) body.last_name = last;
  }
  if (company) {
    body.company = company;
    body.company_domain = company;
  }
  return callTool('search_business_email_by_name', body, integrationEnv);
}

function searchPeople(input, integrationEnv) {
  const body = { ...(input && typeof input === 'object' ? input : {}) };
  if (body.size == null) body.size = 5;
  return callTool('search_people', body, integrationEnv);
}

function linkedinToBusinessEmail(linkedinUrl, integrationEnv) {
  return callTool(
    'linkedin_to_business_email',
    { linkedin_url: String(linkedinUrl || '').trim() },
    integrationEnv,
  );
}

function linkedinToMobilePhone(linkedinUrl, integrationEnv) {
  return callTool(
    'linkedin_to_mobile_phone',
    { linkedin_url: String(linkedinUrl || '').trim() },
    integrationEnv,
  );
}

/** Flatten search_people envelope → profile array. */
function peopleFromSearchResults(results) {
  if (!results) return [];
  if (Array.isArray(results)) return results;
  if (Array.isArray(results.results)) return results.results;
  if (Array.isArray(results.people)) return results.people;
  if (Array.isArray(results.profiles)) return results.profiles;
  return [];
}

module.exports = {
  DEFAULT_API_BASE,
  USER_AGENT,
  resolveConfig,
  isConfigured,
  callTool,
  testConnection,
  getAccount,
  reverseEmailLookup,
  searchBusinessEmailByName,
  searchPeople,
  linkedinToBusinessEmail,
  linkedinToMobilePhone,
  peopleFromSearchResults,
};
