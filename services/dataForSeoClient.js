/**
 * DataForSEO API client (Basic auth login + API password).
 * Used by AI Visibility scans (LLM Mentions + Maps / local pack).
 * @see https://docs.dataforseo.com/
 */

const API_BASE = 'https://api.dataforseo.com';

function resolveCredentials(integrationEnv) {
  const env = integrationEnv || {};
  const login = String(
    env.DATAFORSEO_LOGIN ||
      process.env.DATAFORSEO_LOGIN ||
      '',
  ).trim();
  const password = String(
    env.DATAFORSEO_API_PASSWORD ||
      process.env.DATAFORSEO_API_PASSWORD ||
      '',
  ).trim();
  return { login, password };
}

function isConfigured(integrationEnv) {
  const { login, password } = resolveCredentials(integrationEnv);
  return !!(login && password);
}

function authHeader(login, password) {
  return `Basic ${Buffer.from(`${login}:${password}`, 'utf8').toString('base64')}`;
}

/**
 * @param {string} path — e.g. /v3/appendix/user_data
 * @param {{ method?: string, body?: object|array, integrationEnv?: object, fetchImpl?: typeof fetch, timeoutMs?: number }} opts
 */
async function dfsRequest(path, opts) {
  const options = opts || {};
  const { login, password } = resolveCredentials(options.integrationEnv);
  if (!login || !password) {
    const err = new Error(
      'DataForSEO is not configured. Add login + API password under Workspace → API integrations.',
    );
    err.code = 'DATAFORSEO_NOT_CONFIGURED';
    throw err;
  }
  const fetchImpl = options.fetchImpl || fetch;
  const method = String(options.method || (options.body != null ? 'POST' : 'GET')).toUpperCase();
  const url = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 90000;
  const timer = controller
    ? setTimeout(() => {
      try {
        controller.abort();
      } catch (_) {}
    }, timeoutMs)
    : null;

  try {
    const res = await fetchImpl(url, {
      method,
      headers: {
        Authorization: authHeader(login, password),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: options.body != null ? JSON.stringify(options.body) : undefined,
      signal: controller ? controller.signal : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg =
        (json && (json.status_message || json.message)) ||
        `DataForSEO HTTP ${res.status}`;
      const err = new Error(msg);
      err.code = 'DATAFORSEO_HTTP';
      err.status = res.status;
      err.body = json;
      throw err;
    }
    if (json && Number(json.status_code) >= 40000) {
      const err = new Error(String(json.status_message || 'DataForSEO error'));
      err.code = 'DATAFORSEO_API';
      err.status_code = json.status_code;
      err.body = json;
      throw err;
    }
    return json;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function testConnection(integrationEnv, fetchImpl) {
  if (!isConfigured(integrationEnv)) {
    throw new Error(
      'Missing DataForSEO login or API password — paste both and save, or type them before testing.',
    );
  }
  const json = await dfsRequest('/v3/appendix/user_data', {
    method: 'GET',
    integrationEnv,
    fetchImpl,
    timeoutMs: 20000,
  });
  const task = Array.isArray(json.tasks) ? json.tasks[0] : null;
  const result = task && Array.isArray(task.result) ? task.result[0] : null;
  const login =
    (result && (result.login || result.email)) ||
    resolveCredentials(integrationEnv).login;
  return { message: `Connected as ${login}` };
}

function hostFromWebsite(raw) {
  const s = String(raw || '').trim();
  if (!s || s === 'N/A') return '';
  try {
    const withProto = /^https?:\/\//i.test(s) ? s : `https://${s.replace(/^\/\//, '')}`;
    const u = new URL(withProto);
    return String(u.hostname || '')
      .replace(/^www\./i, '')
      .toLowerCase();
  } catch {
    return s
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .split('/')[0]
      .toLowerCase()
      .trim();
  }
}

/**
 * Live LLM Mentions for a domain (+ optional keyword seeds).
 * platform: chat_gpt | google
 */
async function searchMentionsLive({
  domain,
  keywords = [],
  platform = 'chat_gpt',
  locationCode = 2840,
  languageCode = 'en',
  integrationEnv,
  fetchImpl,
  limit = 50,
}) {
  const d = hostFromWebsite(domain);
  if (!d) {
    const err = new Error('Domain required for LLM Mentions');
    err.code = 'NO_DOMAIN';
    throw err;
  }
  const target = [{ domain: d, search_filter: 'include', search_scope: ['any'] }];
  for (const kw of (keywords || []).slice(0, 5)) {
    const k = String(kw || '').trim();
    if (!k) continue;
    target.push({
      keyword: k.slice(0, 250),
      search_filter: 'include',
      search_scope: ['any'],
      match_type: 'partial_match',
    });
  }
  const body = [
    {
      target,
      platform,
      location_code: locationCode,
      language_code: languageCode,
      limit: Math.min(100, Math.max(1, Number(limit) || 50)),
    },
  ];
  return dfsRequest('/v3/ai_optimization/llm_mentions/search_mentions/live', {
    method: 'POST',
    body,
    integrationEnv,
    fetchImpl,
    timeoutMs: 120000,
  });
}

async function topMentionedDomainsLive({
  keywords = [],
  platform = 'chat_gpt',
  locationCode = 2840,
  languageCode = 'en',
  integrationEnv,
  fetchImpl,
  limit = 20,
}) {
  const target = [];
  for (const kw of (keywords || []).slice(0, 8)) {
    const k = String(kw || '').trim();
    if (!k) continue;
    target.push({
      keyword: k.slice(0, 250),
      search_filter: 'include',
      search_scope: ['any'],
      match_type: 'partial_match',
    });
  }
  if (!target.length) {
    const err = new Error('At least one keyword required for top mentioned domains');
    err.code = 'NO_KEYWORDS';
    throw err;
  }
  const body = [
    {
      target,
      platform,
      location_code: locationCode,
      language_code: languageCode,
      limit: Math.min(100, Math.max(1, Number(limit) || 20)),
    },
  ];
  // Prefer new path; fall back to legacy top_pages if needed by caller.
  return dfsRequest('/v3/ai_optimization/llm_mentions/top_mentioned_domains/live', {
    method: 'POST',
    body,
    integrationEnv,
    fetchImpl,
    timeoutMs: 120000,
  });
}

/**
 * Google Maps live SERP (local pack / Maps ranking signal).
 */
async function googleMapsLive({
  keyword,
  locationName,
  locationCode = 2840,
  languageCode = 'en',
  depth = 20,
  integrationEnv,
  fetchImpl,
}) {
  const kw = String(keyword || '').trim();
  if (!kw) {
    const err = new Error('Keyword required for Maps live');
    err.code = 'NO_KEYWORD';
    throw err;
  }
  const task = {
    keyword: kw.slice(0, 700),
    language_code: languageCode,
    depth: Math.min(100, Math.max(10, Number(depth) || 20)),
  };
  if (locationName) task.location_name = String(locationName).slice(0, 200);
  else task.location_code = locationCode;

  return dfsRequest('/v3/serp/google/maps/live/advanced', {
    method: 'POST',
    body: [task],
    integrationEnv,
    fetchImpl,
    timeoutMs: 90000,
  });
}

function labsTaskBase({ locationCode = 2840, languageCode = 'en', limit = 100 }) {
  return {
    location_code: locationCode,
    language_code: languageCode,
    limit: Math.min(1000, Math.max(1, Number(limit) || 100)),
  };
}

/** Keywords a domain ranks for (Labs). */
async function keywordsForSiteLive({
  target,
  locationCode = 2840,
  languageCode = 'en',
  limit = 100,
  includeSubdomains = true,
  integrationEnv,
  fetchImpl,
}) {
  const domain = hostFromWebsite(target);
  if (!domain) {
    const err = new Error('Domain required for keywords_for_site');
    err.code = 'NO_DOMAIN';
    throw err;
  }
  const body = [
    {
      ...labsTaskBase({ locationCode, languageCode, limit }),
      target: domain,
      include_subdomains: !!includeSubdomains,
    },
  ];
  return dfsRequest('/v3/dataforseo_labs/google/keywords_for_site/live', {
    method: 'POST',
    body,
    integrationEnv,
    fetchImpl,
    timeoutMs: 120000,
  });
}

/** Domains that compete organically with the seed. */
async function competitorsDomainLive({
  target,
  locationCode = 2840,
  languageCode = 'en',
  limit = 10,
  integrationEnv,
  fetchImpl,
}) {
  const domain = hostFromWebsite(target);
  if (!domain) {
    const err = new Error('Domain required for competitors_domain');
    err.code = 'NO_DOMAIN';
    throw err;
  }
  const body = [
    {
      ...labsTaskBase({ locationCode, languageCode, limit }),
      target: domain,
    },
  ];
  return dfsRequest('/v3/dataforseo_labs/google/competitors_domain/live', {
    method: 'POST',
    body,
    integrationEnv,
    fetchImpl,
    timeoutMs: 120000,
  });
}

/**
 * Domain intersection / gap.
 * intersections:true → shared SERP keywords
 * intersections:false → target1 ranks, target2 does not
 */
async function domainIntersectionLive({
  target1,
  target2,
  intersections = false,
  locationCode = 2840,
  languageCode = 'en',
  limit = 100,
  integrationEnv,
  fetchImpl,
}) {
  const a = hostFromWebsite(target1);
  const b = hostFromWebsite(target2);
  if (!a || !b) {
    const err = new Error('Both domains required for domain_intersection');
    err.code = 'NO_DOMAIN';
    throw err;
  }
  const body = [
    {
      ...labsTaskBase({ locationCode, languageCode, limit }),
      target1: a,
      target2: b,
      intersections: !!intersections,
      item_types: ['organic'],
    },
  ];
  return dfsRequest('/v3/dataforseo_labs/google/domain_intersection/live', {
    method: 'POST',
    body,
    integrationEnv,
    fetchImpl,
    timeoutMs: 120000,
  });
}

/** Flatten Labs task result items from a live response. */
function extractLabsItems(apiJson) {
  const tasks = Array.isArray(apiJson && apiJson.tasks) ? apiJson.tasks : [];
  const items = [];
  for (const t of tasks) {
    for (const r of Array.isArray(t.result) ? t.result : []) {
      if (Array.isArray(r.items)) items.push(...r.items);
    }
  }
  return items;
}

function firstTaskResult(apiJson) {
  const tasks = Array.isArray(apiJson && apiJson.tasks) ? apiJson.tasks : [];
  for (const t of tasks) {
    const result = Array.isArray(t.result) ? t.result : [];
    if (result.length) return result[0];
  }
  return null;
}

/** Domain-level backlink summary (totals, rank, referring domains). */
async function backlinksSummaryLive({ target, includeSubdomains = true, integrationEnv, fetchImpl }) {
  const domain = hostFromWebsite(target);
  if (!domain) {
    const err = new Error('Domain required for backlinks summary');
    err.code = 'NO_DOMAIN';
    throw err;
  }
  return dfsRequest('/v3/backlinks/summary/live', {
    method: 'POST',
    body: [
      {
        target: domain,
        include_subdomains: !!includeSubdomains,
        internal_list_limit: 10,
        backlinks_status_type: 'live',
      },
    ],
    integrationEnv,
    fetchImpl,
    timeoutMs: 120000,
  });
}

/** Referring domains pointing at target. */
async function referringDomainsLive({
  target,
  limit = 100,
  orderBy = ['rank,desc'],
  includeSubdomains = true,
  integrationEnv,
  fetchImpl,
}) {
  const domain = hostFromWebsite(target);
  if (!domain) {
    const err = new Error('Domain required for referring domains');
    err.code = 'NO_DOMAIN';
    throw err;
  }
  return dfsRequest('/v3/backlinks/referring_domains/live', {
    method: 'POST',
    body: [
      {
        target: domain,
        limit: Math.min(1000, Math.max(1, Number(limit) || 100)),
        order_by: Array.isArray(orderBy) ? orderBy : ['rank,desc'],
        include_subdomains: !!includeSubdomains,
        exclude_internal_backlinks: true,
        backlinks_status_type: 'live',
      },
    ],
    integrationEnv,
    fetchImpl,
    timeoutMs: 120000,
  });
}

/** Anchor text overview for target. */
async function backlinksAnchorsLive({
  target,
  limit = 50,
  orderBy = ['backlinks,desc'],
  includeSubdomains = true,
  integrationEnv,
  fetchImpl,
}) {
  const domain = hostFromWebsite(target);
  if (!domain) {
    const err = new Error('Domain required for anchors');
    err.code = 'NO_DOMAIN';
    throw err;
  }
  return dfsRequest('/v3/backlinks/anchors/live', {
    method: 'POST',
    body: [
      {
        target: domain,
        limit: Math.min(1000, Math.max(1, Number(limit) || 50)),
        order_by: Array.isArray(orderBy) ? orderBy : ['backlinks,desc'],
        include_subdomains: !!includeSubdomains,
        backlinks_status_type: 'live',
      },
    ],
    integrationEnv,
    fetchImpl,
    timeoutMs: 120000,
  });
}

/** New & lost backlinks / referring domains over time. */
async function backlinksTimeseriesNewLostLive({
  target,
  dateFrom,
  dateTo,
  groupRange = 'month',
  includeSubdomains = true,
  integrationEnv,
  fetchImpl,
}) {
  const domain = hostFromWebsite(target);
  if (!domain) {
    const err = new Error('Domain required for new/lost timeseries');
    err.code = 'NO_DOMAIN';
    throw err;
  }
  const task = {
    target: domain,
    group_range: groupRange,
    include_subdomains: !!includeSubdomains,
  };
  if (dateFrom) task.date_from = String(dateFrom).slice(0, 10);
  if (dateTo) task.date_to = String(dateTo).slice(0, 10);
  return dfsRequest('/v3/backlinks/timeseries_new_lost_summary/live', {
    method: 'POST',
    body: [task],
    integrationEnv,
    fetchImpl,
    timeoutMs: 120000,
  });
}

module.exports = {
  API_BASE,
  resolveCredentials,
  isConfigured,
  dfsRequest,
  testConnection,
  hostFromWebsite,
  searchMentionsLive,
  topMentionedDomainsLive,
  googleMapsLive,
  keywordsForSiteLive,
  competitorsDomainLive,
  domainIntersectionLive,
  extractLabsItems,
  firstTaskResult,
  backlinksSummaryLive,
  referringDomainsLive,
  backlinksAnchorsLive,
  backlinksTimeseriesNewLostLive,
};
