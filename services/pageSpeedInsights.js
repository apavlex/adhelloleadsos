/**
 * Google PageSpeed Insights API v5 (Lighthouse-powered).
 * @see https://developers.google.com/speed/docs/insights/v5/get-started
 */

const PAGESPEED_ENDPOINT = 'https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed';

const CATEGORY_IDS = ['performance', 'accessibility', 'best-practices', 'seo'];

function normalizeWebsiteUrl(raw) {
  const s = String(raw || '').trim();
  if (!s || s === 'N/A') return '';
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s.replace(/^\/\//, '')}`;
}

function scoreFromCategory(cat) {
  if (!cat || cat.score == null) return null;
  const n = Number(cat.score);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, Math.round(n * 100)));
}

/**
 * @param {object} apiJson — PageSpeed API response body
 * @returns {{ scores: object, averageScore: number|null, topIssues: string[] }}
 */
function parsePageSpeedResponse(apiJson) {
  const categories = (apiJson && apiJson.lighthouseResult && apiJson.lighthouseResult.categories) || {};
  const scores = {};
  const vals = [];
  for (const id of CATEGORY_IDS) {
    const sc = scoreFromCategory(categories[id]);
    if (sc != null) {
      const key = id === 'best-practices' ? 'bestPractices' : id;
      scores[key] = sc;
      vals.push(sc);
    }
  }
  const averageScore =
    vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;

  const audits = (apiJson && apiJson.lighthouseResult && apiJson.lighthouseResult.audits) || {};
  const topIssues = [];
  for (const audit of Object.values(audits)) {
    if (!audit || audit.score === null || audit.score === undefined) continue;
    if (Number(audit.score) >= 0.9) continue;
    const title = String(audit.title || '').trim();
    if (!title) continue;
    topIssues.push(title);
    if (topIssues.length >= 6) break;
  }

  return { scores, averageScore, topIssues };
}

function buildPublicReportUrl(auditedUrl) {
  const u = normalizeWebsiteUrl(auditedUrl);
  if (!u) return '';
  return `https://pagespeed.web.dev/analysis?url=${encodeURIComponent(u)}`;
}

function buildOwnerSignalFromAudit(leadTitle, audit) {
  const company = String(leadTitle || 'This business').trim() || 'This business';
  if (!audit || !audit.scores) {
    return `Run a Lighthouse audit on ${company}'s website to get concrete performance and SEO scores for your pitch.`;
  }
  const s = audit.scores;
  const parts = [];
  if (s.performance != null) parts.push(`performance ${s.performance}`);
  if (s.seo != null) parts.push(`SEO ${s.seo}`);
  if (s.accessibility != null) parts.push(`accessibility ${s.accessibility}`);
  const line = parts.length ? parts.join(', ') : `overall ${audit.averageScore ?? '—'}/100`;
  const weakest = CATEGORY_IDS.map((id) => {
    const key = id === 'best-practices' ? 'bestPractices' : id;
    return { id, sc: s[key] };
  })
    .filter((x) => x.sc != null)
    .sort((a, b) => a.sc - b.sc)[0];
  let hint = '';
  if (weakest && weakest.sc < 75) {
    const label =
      weakest.id === 'best-practices'
        ? 'best practices'
        : weakest.id === 'seo'
          ? 'SEO'
          : weakest.id;
    hint = ` Weakest area: ${label} (${weakest.sc}/100).`;
  }
  return `Lighthouse (${audit.strategy || 'mobile'}): ${line}/100 for ${company}.${hint}`;
}

/**
 * @param {string} websiteUrl
 * @param {{ apiKey: string, strategy?: 'mobile'|'desktop', fetchImpl?: typeof fetch }} opts
 */
async function runPageSpeedAudit(websiteUrl, opts) {
  const options = opts || {};
  const apiKey = String(options.apiKey || '').trim();
  if (!apiKey) {
    const err = new Error(
      'PageSpeed API key not configured. Set PAGESPEED_API_KEY in deployment env or Workspace → API integrations.'
    );
    err.code = 'PAGESPEED_NOT_CONFIGURED';
    throw err;
  }

  const url = normalizeWebsiteUrl(websiteUrl);
  if (!url) {
    const err = new Error('Lead has no valid website URL to audit.');
    err.code = 'NO_WEBSITE';
    throw err;
  }

  const strategy = options.strategy === 'desktop' ? 'desktop' : 'mobile';
  const params = new URLSearchParams({
    url,
    key: apiKey,
    strategy,
    category: 'performance',
  });
  params.append('category', 'accessibility');
  params.append('category', 'best-practices');
  params.append('category', 'seo');

  const fetchFn = options.fetchImpl || fetch;
  const apiUrl = `${PAGESPEED_ENDPOINT}?${params.toString()}`;

  const res = await fetchFn(apiUrl, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      (body && body.error && body.error.message) ||
      (body && body.error && typeof body.error === 'string' ? body.error : null) ||
      `PageSpeed API error (${res.status})`;
    const err = new Error(msg);
    err.code = 'PAGESPEED_API_ERROR';
    err.status = res.status;
    throw err;
  }

  const parsed = parsePageSpeedResponse(body);
  const fetchedAt = new Date().toISOString();

  const audit = {
    provider: 'google_pagespeed_v5',
    url,
    strategy,
    fetchedAt,
    scores: parsed.scores,
    averageScore: parsed.averageScore,
    topIssues: parsed.topIssues,
    reportUrl: buildPublicReportUrl(url),
    id: body && body.id ? String(body.id) : '',
  };

  return { audit, raw: body };
}

/** Workspace env + deployment fallbacks (same GCP key often works if PageSpeed Insights API is enabled). */
function resolvePageSpeedApiKey(integrationEnv) {
  const env = integrationEnv && typeof integrationEnv === 'object' ? integrationEnv : {};
  return String(
    env.PAGESPEED_API_KEY ||
      process.env.PAGESPEED_API_KEY ||
      process.env.GOOGLE_PAGESPEED_API_KEY ||
      process.env.GOOGLE_MAPS_API_KEY ||
      ''
  ).trim();
}

module.exports = {
  PAGESPEED_ENDPOINT,
  CATEGORY_IDS,
  normalizeWebsiteUrl,
  parsePageSpeedResponse,
  buildPublicReportUrl,
  buildOwnerSignalFromAudit,
  resolvePageSpeedApiKey,
  runPageSpeedAudit,
};
