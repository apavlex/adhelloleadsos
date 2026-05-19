/**
 * BetterContact waterfall enrichment — email + phone for a business contact.
 * @see https://doc.bettercontact.rocks/api-reference/endpoint/create
 */

const BASE_URL = 'https://app.bettercontact.rocks/api/v2';

function apiKeyFromEnv(integrationEnv) {
  const fromWs = integrationEnv && integrationEnv.BETTERCONTACT_API_KEY;
  if (typeof fromWs === 'string' && fromWs.trim()) return fromWs.trim();
  return String(process.env.BETTERCONTACT_API_KEY || '').trim();
}

function isConfigured(integrationEnv) {
  return Boolean(apiKeyFromEnv(integrationEnv));
}

/**
 * Verify API key via GET /account (see doc.bettercontact.rocks/api-reference/endpoint/account).
 * @returns {Promise<{ creditsLeft: number|null, email: string|null }>}
 */
async function checkApiConnection(integrationEnv) {
  const apiKey = apiKeyFromEnv(integrationEnv);
  if (!apiKey) {
    throw new Error('BetterContact is not configured. Set BETTERCONTACT_API_KEY in Workspace → API integrations.');
  }

  const res = await fetch(`${BASE_URL}/account`, {
    method: 'GET',
    headers: { 'X-API-Key': apiKey, Accept: 'application/json' },
  });
  const body = await res.json().catch(() => ({}));

  if (res.status === 401) {
    throw new Error(
      (body && (body.error || body.message)) || 'BetterContact API key is invalid or unauthorized.'
    );
  }
  if (res.status === 404) {
    throw new Error(
      'BetterContact API path not found. Contact support — expected GET /api/v2/account.'
    );
  }
  if (!res.ok) {
    throw new Error(
      (body && (body.error || body.message)) || `BetterContact check failed (HTTP ${res.status})`
    );
  }

  const creditsLeft =
    body && body.credits_left != null
      ? Number(body.credits_left)
      : body && body.credits != null
        ? Number(body.credits)
        : null;

  return {
    creditsLeft: Number.isFinite(creditsLeft) ? creditsLeft : null,
    email: body && body.email ? String(body.email) : null,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractDomain(website) {
  const raw = String(website || '').trim();
  if (!raw || raw === 'N/A') return '';
  try {
    const host = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname;
    return host.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

/**
 * Map a pipeline lead to BetterContact's required lead shape.
 * @param {object} lead
 */
function buildLeadInput(lead) {
  const company = String(lead.title || lead.company || '').trim();
  if (!company) return null;

  let firstName = 'Owner';
  let lastName = company.slice(0, 60);

  const dm = String(lead.decisionMakerName || '').trim();
  if (dm) {
    const parts = dm.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      firstName = parts[0];
      lastName = parts.slice(1).join(' ');
    } else if (parts.length === 1) {
      firstName = parts[0];
      lastName = company || 'Contact';
    }
  }

  const domain = extractDomain(lead.website || lead.companyDomain);
  const row = {
    first_name: firstName.slice(0, 80),
    last_name: lastName.slice(0, 80),
    company: company.slice(0, 120),
    custom_fields: {
      lead_key: String(lead.key || lead.id || ''),
    },
  };

  const linkedin = String(lead.linkedin || '').trim();
  if (linkedin && linkedin !== 'N/A') row.linkedin_url = linkedin;
  if (domain) row.company_domain = domain;

  return row;
}

/**
 * @param {object} row — BetterContact result item
 * @returns {object} Firecrawl-shaped extract for mergeExtractPreferFirecrawl
 */
function betterContactRowToExtract(row) {
  if (!row || typeof row !== 'object') return {};
  const email = String(row.contact_email_address || '').trim();
  const phone =
    String(row.contact_phone_number || row.contact_additional_phone_number || '').trim();
  const linkedin = String(row.contact_linkedin_profile_url || '').trim();
  const jobTitle = String(row.contact_job_title || '').trim();
  const fullName = [row.contact_first_name, row.contact_last_name].filter(Boolean).join(' ').trim();

  const out = {};
  if (email) out.email = email;
  if (phone) out.phone = phone;
  if (linkedin) out.linkedin = linkedin;
  if (jobTitle) out.decision_maker_title = jobTitle;
  if (fullName) out.decision_maker_name = fullName;
  if (row.contact_email_address_status) {
    out.email_validation_status = String(row.contact_email_address_status);
  }
  return out;
}

function extractHasSignal(extract) {
  if (!extract || typeof extract !== 'object') return false;
  return Boolean(
    (extract.email && extract.email !== 'N/A') ||
      (extract.phone && extract.phone !== 'N/A') ||
      extract.linkedin
  );
}

async function submitEnrichment(leadInput, integrationEnv) {
  const apiKey = apiKeyFromEnv(integrationEnv);
  if (!apiKey) throw new Error('BetterContact is not configured. Set BETTERCONTACT_API_KEY in Workspace → API integrations.');

  const res = await fetch(`${BASE_URL}/async`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify({
      data: [leadInput],
      enrich_email_address: true,
      enrich_phone_number: true,
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (res.status === 401) {
    throw new Error('BetterContact API key is invalid or unauthorized.');
  }
  if (!res.ok) {
    throw new Error(body.error || body.message || `BetterContact submit failed (${res.status})`);
  }
  const requestId = body.id || body.request_id;
  if (!requestId) throw new Error('BetterContact did not return a request id.');
  return String(requestId);
}

async function fetchEnrichmentResult(requestId, integrationEnv) {
  const apiKey = apiKeyFromEnv(integrationEnv);
  const res = await fetch(`${BASE_URL}/async/${encodeURIComponent(requestId)}`, {
    headers: { 'X-API-Key': apiKey },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || body.message || `BetterContact fetch failed (${res.status})`);
  }
  return body;
}

/**
 * Poll until enrichment completes or times out.
 */
async function pollEnrichmentResult(requestId, integrationEnv, opts = {}) {
  const maxWaitMs = Number(opts.maxWaitMs) > 0 ? Number(opts.maxWaitMs) : 90_000;
  const pollIntervalMs = Number(opts.pollIntervalMs) > 0 ? Number(opts.pollIntervalMs) : 3_000;
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    const body = await fetchEnrichmentResult(requestId, integrationEnv);
    const status = String(body.status || '').toLowerCase();
    if (status === 'terminated' || status === 'completed' || status === 'done') {
      return body;
    }
    if (status === 'failed' || status === 'error' || status === 'cancelled') {
      throw new Error(body.message || 'BetterContact enrichment failed.');
    }
    const rows = Array.isArray(body.data) ? body.data : [];
    if (rows.length && rows.some((r) => r && r.enriched)) {
      return body;
    }
    await sleep(pollIntervalMs);
  }
  throw new Error('BetterContact enrichment timed out. Try again in a minute.');
}

/**
 * Full waterfall enrich for one business lead.
 * @param {object} lead
 * @param {Record<string, string>|null} [integrationEnv]
 * @returns {Promise<{ extract: object, requestId: string, raw: object }|null>}
 */
async function enrichLeadForBusiness(lead, integrationEnv) {
  if (!isConfigured(integrationEnv)) return null;

  const leadInput = buildLeadInput(lead);
  if (!leadInput) {
    throw new Error('Lead needs a business name before BetterContact can hunt.');
  }

  const requestId = await submitEnrichment(leadInput, integrationEnv);
  console.log(`[BetterContact] Enrichment started for "${lead.title}" — request ${requestId}`);

  const result = await pollEnrichmentResult(requestId, integrationEnv);
  const rows = Array.isArray(result.data) ? result.data : [];
  const row = rows[0] || null;
  const extract = betterContactRowToExtract(row);

  if (!extractHasSignal(extract)) {
    return { extract: {}, requestId, raw: result, enriched: false };
  }

  return { extract, requestId, raw: result, enriched: true };
}

module.exports = {
  isConfigured,
  apiKeyFromEnv,
  checkApiConnection,
  buildLeadInput,
  betterContactRowToExtract,
  extractHasSignal,
  submitEnrichment,
  pollEnrichmentResult,
  enrichLeadForBusiness,
  extractDomain,
};
