/**
 * Instantly.ai API v2. Auth is a workspace API key sent as a bearer token.
 * https://developer.instantly.ai
 */

const BASE = 'https://api.instantly.ai';
const BATCH_LIMIT = 1000;

const CAMPAIGN_STATUS = {
  0: 'Draft',
  1: 'Active',
  2: 'Paused',
  3: 'Completed',
  4: 'Running',
  '-1': 'Unhealthy',
  '-2': 'Bounce protect',
  '-99': 'Suspended',
};

function apiKey(integrationEnv) {
  return String((integrationEnv && integrationEnv.INSTANTLY_API_KEY) || process.env.INSTANTLY_API_KEY || '').trim();
}

function isConfigured(integrationEnv) {
  return apiKey(integrationEnv).length > 0;
}

function campaignStatusLabel(status) {
  const key = String(status);
  return CAMPAIGN_STATUS[key] || '';
}

function itemsOf(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data.lead_lists)) return data.lead_lists;
  return [];
}

function errorMessage(data, status) {
  const raw = data && (data.message || data.error || data.detail);
  if (typeof raw === 'string' && raw.trim()) return raw.trim().slice(0, 280);
  if (status === 401) {
    return 'Instantly rejected the API key. Use a v2 key with leads:create and campaigns:read.';
  }
  return `Instantly request failed (${status})`;
}

async function request(integrationEnv, path, { method = 'GET', body, fetchImpl } = {}) {
  const key = apiKey(integrationEnv);
  if (!key) {
    const err = new Error('Instantly is not connected. Add an API key under Workspace → Integrations.');
    err.code = 'INSTANTLY_NOT_CONFIGURED';
    throw err;
  }
  const fetchFn = fetchImpl || global.fetch;
  if (typeof fetchFn !== 'function') {
    throw new Error('Instantly client has no fetch implementation.');
  }
  const res = await fetchFn(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text.slice(0, 280) };
    }
  }
  if (!res.ok) {
    const err = new Error(errorMessage(data, res.status));
    err.status = res.status;
    err.code = res.status === 401 ? 'INSTANTLY_UNAUTHORIZED' : 'INSTANTLY_ERROR';
    throw err;
  }
  return data;
}

async function listPaged(integrationEnv, path, opts = {}) {
  const fetchImpl = opts.fetchImpl;
  const pageLimit = Math.max(1, Math.min(5, Number(opts.pageLimit) || 3));
  const limit = Math.max(1, Math.min(100, Number(opts.limit) || 100));
  const items = [];
  let startingAfter = '';
  for (let page = 0; page < pageLimit; page += 1) {
    const q = new URLSearchParams({ limit: String(limit) });
    if (startingAfter) q.set('starting_after', startingAfter);
    // eslint-disable-next-line no-await-in-loop
    const data = await request(integrationEnv, `${path}?${q}`, { fetchImpl });
    const batch = itemsOf(data);
    items.push(...batch);
    const next = data && typeof data.next_starting_after === 'string' ? data.next_starting_after : '';
    if (!next || !batch.length) break;
    startingAfter = next;
  }
  return items;
}

function listCampaigns(integrationEnv, opts = {}) {
  return listPaged(integrationEnv, '/api/v2/campaigns', opts);
}

async function listLeadLists(integrationEnv, opts = {}) {
  try {
    return await listPaged(integrationEnv, '/api/v2/lead-lists', opts);
  } catch (e) {
    if (e && e.status === 404) return [];
    throw e;
  }
}

/**
 * Bulk-add up to 1000 leads. Pass campaignId or listId, not both.
 * @returns {Promise<object>} Instantly import summary
 */
async function addLeads(integrationEnv, { campaignId, listId, leads, fetchImpl, idempotencyKey } = {}) {
  const campaign = String(campaignId || '').trim();
  const list = String(listId || '').trim();
  if (campaign && list) {
    throw new Error('Choose either an Instantly campaign or a list.');
  }
  if (!campaign && !list) {
    throw new Error('Choose an Instantly campaign or list.');
  }
  const rows = Array.isArray(leads) ? leads.filter(Boolean) : [];
  if (!rows.length) {
    throw new Error('No leads to send to Instantly.');
  }
  if (rows.length > BATCH_LIMIT) {
    throw new Error(`Instantly accepts ${BATCH_LIMIT} leads per request.`);
  }
  const body = {
    leads: rows,
    verify_leads_on_import: false,
    ...(campaign
      ? { campaign_id: campaign, skip_if_in_campaign: true }
      : { list_id: list, skip_if_in_list: true }),
  };
  const key = String(idempotencyKey || '').trim();
  if (key) body.idempotency_key = key.slice(0, 128);
  const data = await request(integrationEnv, '/api/v2/leads/add', {
    method: 'POST',
    body,
    fetchImpl,
  });
  return data && typeof data === 'object' ? data : {};
}

/**
 * Reply in-thread to an Instantly email.
 * @param {object} integrationEnv
 * @param {{ eaccount: string, replyToUuid: string, subject: string, text?: string, html?: string, fetchImpl?: Function }} opts
 */
async function replyToEmail(integrationEnv, opts = {}) {
  const eaccount = String(opts.eaccount || '').trim();
  const replyToUuid = String(opts.replyToUuid || opts.reply_to_uuid || '').trim();
  const subject = String(opts.subject || '').trim() || 'Re:';
  const text = String(opts.text || '').trim();
  const html = String(opts.html || '').trim();
  if (!eaccount) throw Object.assign(new Error('Instantly sending account (eaccount) is required.'), { code: 'INSTANTLY_REPLY_MISSING_ACCOUNT' });
  if (!replyToUuid) throw Object.assign(new Error('Instantly reply_to_uuid (email id) is required.'), { code: 'INSTANTLY_REPLY_MISSING_UUID' });
  if (!text && !html) throw Object.assign(new Error('Reply body is required.'), { code: 'INSTANTLY_REPLY_MISSING_BODY' });
  const body = {
    eaccount,
    reply_to_uuid: replyToUuid,
    subject,
    body: {
      ...(text ? { text } : {}),
      ...(html ? { html } : !text ? { text: '' } : {}),
    },
  };
  return request(integrationEnv, '/api/v2/emails/reply', {
    method: 'POST',
    body,
    fetchImpl: opts.fetchImpl,
  });
}

module.exports = {
  BASE,
  BATCH_LIMIT,
  apiKey,
  isConfigured,
  campaignStatusLabel,
  listCampaigns,
  listLeadLists,
  addLeads,
  replyToEmail,
};
