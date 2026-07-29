/**
 * TikHub — social profile discovery for local business leads.
 * Docs: https://docs.tikhub.io/ · API: https://api.tikhub.io
 */

const TIKHUB_API_BASE = 'https://api.tikhub.io';

function resolveConfig(integrationEnv) {
  const env = integrationEnv || {};
  const apiKey = String(env.TIKHUB_API_KEY || process.env.TIKHUB_API_KEY || '').trim();
  const apiBase = String(env.TIKHUB_API_BASE || process.env.TIKHUB_API_BASE || TIKHUB_API_BASE).trim();
  return {
    apiKey,
    apiBase: apiBase.replace(/\/$/, '') || TIKHUB_API_BASE,
  };
}

function isConfigured(integrationEnv) {
  return Boolean(resolveConfig(integrationEnv).apiKey);
}

function unwrapPayload(json) {
  if (!json || typeof json !== 'object') return json;
  if (json.data !== undefined && json.data !== null) return json.data;
  return json;
}

async function tikHubRequest(path, { integrationEnv, query } = {}) {
  const { apiKey, apiBase } = resolveConfig(integrationEnv);
  if (!apiKey) throw new Error('TikHub API key is not configured.');

  let url = `${apiBase}${path.startsWith('/') ? path : `/${path}`}`;
  if (query && typeof query === 'object') {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v != null && String(v).trim() !== '') params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  });

  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    const msg =
      (json && (json.message || json.detail || json.error)) ||
      `TikHub API error (${res.status})`;
    const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    err.status = res.status;
    err.body = json;
    throw err;
  }

  if (json && json.code != null && Number(json.code) !== 200) {
    const msg = json.message || json.msg || `TikHub returned code ${json.code}`;
    const err = new Error(String(msg));
    err.status = res.status;
    err.body = json;
    throw err;
  }

  return unwrapPayload(json);
}

async function testConnection(integrationEnv) {
  const data = await tikHubRequest('/api/v1/tikhub/user/get_user_info', { integrationEnv });
  const user = (data && data.user_data) || data || {};
  const balance = user.balance != null ? Number(user.balance) : null;
  const free = user.free_credit != null ? Number(user.free_credit) : null;
  const parts = [];
  if (Number.isFinite(balance)) parts.push(`balance $${balance.toFixed(2)}`);
  if (Number.isFinite(free)) parts.push(`free credit $${free.toFixed(2)}`);
  return {
    ok: true,
    message: parts.length
      ? `Connected — TikHub OK (${parts.join(', ')}).`
      : 'Connected — TikHub API authenticated.',
  };
}

function normalizeTokens(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

function tokenOverlapScore(a, b) {
  const ta = new Set(normalizeTokens(a));
  const tb = new Set(normalizeTokens(b));
  if (!ta.size || !tb.size) return 0;
  let hit = 0;
  for (const t of ta) {
    if (tb.has(t)) hit += 1;
  }
  return hit / Math.max(ta.size, 1);
}

function buildSearchKeyword(lead) {
  const title = String(lead.title || lead.company || '').trim();
  const city = String(lead.city || '').trim();
  const state = String(lead.state || '').trim();
  if (!title) return '';
  const loc = [city, state].filter(Boolean).join(' ');
  return loc ? `${title} ${loc}` : title;
}

function leadLocationHint(lead) {
  return [lead.city, lead.state].filter(Boolean).join(' ').toLowerCase();
}

function scoreCandidate(lead, candidate) {
  const business = String(lead.title || lead.company || '');
  const locHint = leadLocationHint(lead);
  const name = candidate.name || candidate.full_name || candidate.fullName || candidate.nickname || '';
  const bio = candidate.bio || candidate.biography || candidate.signature || candidate.desc || '';
  const username = candidate.username || candidate.unique_id || candidate.uniqueId || '';

  let score = tokenOverlapScore(business, name) * 4;
  score += tokenOverlapScore(business, username) * 2;
  score += tokenOverlapScore(business, bio) * 1.5;
  if (locHint && String(bio).toLowerCase().includes(locHint.split(' ')[0] || '')) score += 1.5;
  if (locHint && String(name).toLowerCase().includes(locHint.split(' ')[0] || '')) score += 1;
  if (candidate.is_verified || candidate.verified) score += 0.3;
  return score;
}

function pickBestCandidate(lead, candidates) {
  const list = Array.isArray(candidates) ? candidates.filter(Boolean) : [];
  if (!list.length) return null;
  let best = null;
  let bestScore = -1;
  for (const c of list.slice(0, 8)) {
    const s = scoreCandidate(lead, c);
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  if (!best || bestScore < 1.2) return null;
  return best;
}

function collectArray(data, keys) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  for (const k of keys) {
    if (Array.isArray(data[k])) return data[k];
  }
  return [];
}

function instagramProfileUrl(candidate) {
  const username = String(
    candidate.username || candidate.user_name || candidate.pk_id || '',
  ).trim();
  if (!username || username.includes('/')) return '';
  return `https://www.instagram.com/${username.replace(/^@/, '')}/`;
}

function tiktokProfileUrl(candidate) {
  const id = String(
    candidate.unique_id || candidate.uniqueId || candidate.username || candidate.nickname || '',
  ).trim();
  if (!id) return '';
  return `https://www.tiktok.com/@${id.replace(/^@/, '')}`;
}

function twitterProfileUrl(candidate) {
  const username = String(
    candidate.username ||
      candidate.screen_name ||
      candidate.screenName ||
      candidate.user_name ||
      '',
  ).trim();
  if (!username) return '';
  return `https://x.com/${username.replace(/^@/, '')}`;
}

function socialMissing(lead, field) {
  const v = String(lead[field] || '').trim();
  return !v || v === 'N/A';
}

async function searchInstagram(lead, integrationEnv) {
  const keyword = buildSearchKeyword(lead);
  if (!keyword) return '';
  const data = await tikHubRequest('/api/v1/instagram/v2/search_users', {
    integrationEnv,
    query: { keyword },
  });
  const items = collectArray(data, ['items', 'users', 'user_list', 'results']);
  const best = pickBestCandidate(lead, items);
  return best ? instagramProfileUrl(best) : '';
}

async function searchTikTok(lead, integrationEnv) {
  const keyword = buildSearchKeyword(lead);
  if (!keyword) return '';
  const data = await tikHubRequest('/api/v1/tiktok/app/v3/fetch_user_search_result', {
    integrationEnv,
    query: {
      keyword,
      offset: 0,
      count: 10,
      user_search_other_pref: 'USERNAME',
    },
  });
  const items = collectArray(data, ['user_list', 'users', 'items', 'user_info_list']);
  const best = pickBestCandidate(lead, items);
  return best ? tiktokProfileUrl(best) : '';
}

async function searchTwitter(lead, integrationEnv) {
  const keyword = buildSearchKeyword(lead);
  if (!keyword) return '';
  const data = await tikHubRequest('/api/v1/twitter/web/fetch_search_timeline', {
    integrationEnv,
    query: { keyword, search_type: 'People' },
  });
  const entries = collectArray(data, ['entries', 'users', 'items', 'results']);
  const users = entries
    .map((e) => {
      if (!e || typeof e !== 'object') return null;
      if (e.user) return e.user;
      if (e.content && e.content.user) return e.content.user;
      if (e.username || e.screen_name) return e;
      return null;
    })
    .filter(Boolean);
  const best = pickBestCandidate(lead, users);
  return best ? twitterProfileUrl(best) : '';
}

function rowToExtract(row) {
  const extract = {};
  if (row.instagram) extract.instagram = row.instagram;
  if (row.tiktok) extract.tiktok = row.tiktok;
  if (row.twitter) extract.twitter = row.twitter;
  if (row.facebook) extract.facebook = row.facebook;
  if (row.linkedin) extract.linkedin = row.linkedin;
  return extract;
}

function extractHasSignal(extract) {
  if (!extract || typeof extract !== 'object') return false;
  return ['instagram', 'tiktok', 'twitter', 'facebook', 'linkedin'].some((k) => {
    const v = String(extract[k] || '').trim();
    return v && v !== 'N/A';
  });
}

/**
 * Discover DM-ready social profile URLs for a lead.
 * @param {object} lead
 * @param {Record<string, string>} integrationEnv
 */
async function enrichLeadSocialProfiles(lead, integrationEnv) {
  if (!isConfigured(integrationEnv)) {
    throw new Error('TikHub is not configured. Add your API key in Workspace → Integrations.');
  }
  const title = String(lead.title || lead.company || '').trim();
  if (!title) {
    return { extract: {}, platforms: [], message: 'Lead has no business name.' };
  }

  const found = {};
  const platforms = [];
  const errors = [];

  const tasks = [];
  if (socialMissing(lead, 'instagram')) {
    tasks.push(
      searchInstagram(lead, integrationEnv)
        .then((url) => {
          if (url) {
            found.instagram = url;
            platforms.push('instagram');
          }
        })
        .catch((e) => errors.push(`Instagram: ${e.message}`)),
    );
  }
  if (socialMissing(lead, 'tiktok')) {
    tasks.push(
      searchTikTok(lead, integrationEnv)
        .then((url) => {
          if (url) {
            found.tiktok = url;
            platforms.push('tiktok');
          }
        })
        .catch((e) => errors.push(`TikTok: ${e.message}`)),
    );
  }
  if (socialMissing(lead, 'twitter')) {
    tasks.push(
      searchTwitter(lead, integrationEnv)
        .then((url) => {
          if (url) {
            found.twitter = url;
            platforms.push('twitter');
          }
        })
        .catch((e) => errors.push(`X: ${e.message}`)),
    );
  }

  if (!tasks.length) {
    return {
      extract: {},
      platforms: [],
      message: 'All supported socials already present on this lead.',
      skipped: true,
    };
  }

  await Promise.all(tasks);
  const extract = rowToExtract(found);
  return {
    extract,
    platforms,
    errors,
    message:
      platforms.length > 0
        ? `Found ${platforms.join(', ')}.`
        : errors.length
          ? errors.join(' ')
          : 'No matching social profiles found.',
  };
}

module.exports = {
  TIKHUB_API_BASE,
  resolveConfig,
  isConfigured,
  testConnection,
  buildSearchKeyword,
  scoreCandidate,
  pickBestCandidate,
  enrichLeadSocialProfiles,
  extractHasSignal,
  rowToExtract,
  instagramProfileUrl,
  tiktokProfileUrl,
  twitterProfileUrl,
};
