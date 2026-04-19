/**
 * Optional self-hosted Crawl4AI (Docker) HTTP client.
 * Does not replace Firecrawl — use for $0 infra when your Crawl4AI server is running.
 * @see https://github.com/unclecode/crawl4ai
 */

const DEFAULT_TIMEOUT_MS = 8000;

/** @param {Record<string, string>|null|undefined} [integrationEnv] */
function baseUrl(integrationEnv) {
  const fromWs = integrationEnv && integrationEnv.CRAWL4AI_BASE_URL;
  if (typeof fromWs === 'string' && fromWs.trim()) {
    return fromWs.trim().replace(/\/$/, '');
  }
  const raw = (process.env.CRAWL4AI_BASE_URL || '').trim();
  if (!raw) return null;
  return raw.replace(/\/$/, '');
}

/** @param {Record<string, string>|null|undefined} [integrationEnv] */
function authHeaders(integrationEnv) {
  const fromWs = integrationEnv && integrationEnv.CRAWL4AI_API_TOKEN;
  const token =
    typeof fromWs === 'string' && fromWs.trim()
      ? fromWs.trim()
      : (process.env.CRAWL4AI_API_TOKEN || '').trim();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

function isConfigured(integrationEnv) {
  return Boolean(baseUrl(integrationEnv));
}

/**
 * Lightweight reachability check (optional for dashboards).
 * @param {Record<string, string>|null|undefined} [integrationEnv]
 * @returns {{ ok: boolean, configured: boolean, message: string }}
 */
async function pingHealth(integrationEnv) {
  const b = baseUrl(integrationEnv);
  if (!b) {
    return { ok: false, configured: false, message: 'Not configured (set CRAWL4AI_BASE_URL to your Docker host, e.g. http://localhost:11235).' };
  }
  const paths = ['/health', '/'];
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
  try {
    for (const p of paths) {
      const r = await fetch(`${b}${p}`, {
        method: 'GET',
        headers: { ...authHeaders(integrationEnv), Accept: 'application/json,*/*' },
        signal: ctrl.signal,
      });
      if (r.ok) {
        return { ok: true, configured: true, message: `Reachable at ${b}${p}` };
      }
    }
    return { ok: false, configured: true, message: 'Base URL set but health check did not return OK.' };
  } catch (e) {
    return { ok: false, configured: true, message: e.name === 'AbortError' ? 'Timed out reaching Crawl4AI.' : String(e.message || e) };
  } finally {
    clearTimeout(t);
  }
}

/**
 * POST /crawl — returns raw JSON from the server (shape varies by version).
 * @param {string} url
 * @param {Record<string, string>|null|undefined} [integrationEnv]
 */
async function crawlUrls(urls, integrationEnv) {
  const b = baseUrl(integrationEnv);
  if (!b) throw new Error('Crawl4AI is not configured.');
  const body = { urls: Array.isArray(urls) ? urls : [urls] };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS * 2);
  try {
    const r = await fetch(`${b}/crawl`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...authHeaders(integrationEnv),
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await r.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-json */
    }
    if (!r.ok) {
      throw new Error((json && (json.error || json.message)) || text.slice(0, 200) || `HTTP ${r.status}`);
    }
    return json;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Best-effort HTML from Crawl4AI /crawl JSON (shape varies by version).
 * @param {object|null} data
 * @returns {string|null}
 */
function extractFirstHtmlFromCrawlResult(data) {
  if (!data || typeof data !== 'object') return null;
  const results = data.results || data.data || data.items;
  if (!Array.isArray(results) || results.length === 0) return null;
  const first = results[0];
  if (!first || typeof first !== 'object') return null;
  const candidates = [
    first.html,
    first.cleaned_html,
    first.cleanedHtml,
    first.raw_html,
    first.rawHtml,
    first.document && first.document.html,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 80) return c;
  }
  return null;
}

module.exports = {
  isConfigured,
  pingHealth,
  crawlUrls,
  extractFirstHtmlFromCrawlResult,
};
