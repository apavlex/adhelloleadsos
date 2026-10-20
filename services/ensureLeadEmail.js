/**
 * Find a real business email before auto-outreach enrolls to GHL.
 * Order: website scrape → RapidAPI website → MoltSets → Outscraper → BetterContact.
 * Never invents addresses. (Monid domain-unlock retired — use RapidAPI / Outscraper.)
 */
const dbService = require('./database');
const { isValidEmailForGhl } = require('./ghlClient');
const workspaceIntegrations = require('./workspaceIntegrations');
const betterContact = require('./betterContactClient');
const moltsetsLeadEnrich = require('./moltsetsLeadEnrich');
const rapidapiWebsiteEnrich = require('./rapidapiWebsiteEnrich');
const outscraperLeadEnrich = require('./outscraperLeadEnrich');
const localPageExtract = require('./localPageExtract');
const { firecrawlExtractToLeadUpdates } = require('./enrichmentNormalize');

/** Soft budgets so a hung provider never blocks the whole drip run. */
const STEP_TIMEOUT_MS = {
  local_website: 12_000,
  rapidapi_website: 18_000,
  outscraper_contacts: 25_000,
  moltsets: 35_000,
  bettercontact: 45_000,
}
const DEFAULT_TOTAL_BUDGET_MS = 90_000;

function hasUsableEmail(lead) {
  const email = String((lead && lead.email) || '').trim();
  return isValidEmailForGhl(email);
}

function hasUsableWebsite(lead) {
  const raw = String((lead && (lead.website || lead.url)) || '').trim();
  return !!(raw && raw !== 'N/A');
}

function normalizeWebsite(lead) {
  const raw = String((lead && (lead.website || lead.url)) || '').trim();
  if (!raw || raw === 'N/A') return '';
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

function withTimeout(promise, ms, label) {
  const timeoutMs = Math.max(1, Number(ms) || 1);
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label || 'step'} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function buildEmailPatch(lead, email, extras = {}) {
  const patch = {
    email: String(email).trim(),
    logs: [
      {
        type: 'email_find',
        message: `Found email before auto outreach (${extras.source || 'enrich'}): ${String(email).trim()}`,
        timestamp: new Date().toISOString(),
      },
    ],
  };
  if (extras.emailValidationStatus) {
    patch.emailValidationStatus = String(extras.emailValidationStatus).trim().slice(0, 80);
  }
  if (extras.decisionMakerName && !String(lead.decisionMakerName || '').trim()) {
    patch.decisionMakerName = String(extras.decisionMakerName).trim().slice(0, 120);
  }
  if (extras.linkedin && (!lead.linkedin || lead.linkedin === 'N/A')) {
    patch.linkedin = String(extras.linkedin).trim();
  }
  return patch;
}

function mergeEnrichmentOntoLead(lead, extract) {
  if (!extract || typeof extract !== 'object') return { lead, patch: {} };
  const updates = firecrawlExtractToLeadUpdates(extract);
  const patch = {};
  for (const [key, value] of Object.entries(updates)) {
    if (value == null || value === '' || value === 'N/A') continue;
    const existing = lead[key];
    if (existing != null && String(existing).trim() && String(existing).trim() !== 'N/A') continue;
    patch[key] = value;
  }
  if (extract.website && !hasUsableWebsite(lead)) {
    patch.website = String(extract.website).trim();
  }
  return {
    lead: { ...lead, ...patch },
    patch,
  };
}

async function tryLocalWebsiteEmail(lead, integrationEnv) {
  const website = normalizeWebsite(lead);
  if (!website) return null;
  if (!localPageExtract.localScrapeEnrichEnabled(integrationEnv)) return null;
  try {
    const hunt = await localPageExtract.findWebsiteContactEmail(website);
    const email = hunt && hunt.email;
    if (isValidEmailForGhl(email)) {
      return { email: String(email).trim(), source: 'local_website', lead };
    }
  } catch (e) {
    console.warn('[ensureLeadEmail] local scrape failed:', e && e.message);
  }
  return null;
}

async function tryRapidApiWebsiteEmail(lead, integrationEnv) {
  if (!rapidapiWebsiteEnrich.leadCanEnrichFromWebsite(lead)) return null;
  if (!rapidapiWebsiteEnrich.isConfigured(integrationEnv)) return null;
  try {
    const pack = await rapidapiWebsiteEnrich.enrichLeadFromWebsite(lead, integrationEnv, {
      mode: 'fill_missing',
    });
    const email = pack && pack.patch && pack.patch.email;
    if (isValidEmailForGhl(email)) {
      return {
        email: String(email).trim(),
        source: 'rapidapi_website',
        patch: pack.patch,
        lead: { ...lead, ...(pack.patch || {}) },
      };
    }
  } catch (e) {
    console.warn('[ensureLeadEmail] RapidAPI website failed:', e && e.message);
  }
  return null;
}

async function tryOutscraperEmail(lead, integrationEnv) {
  try {
    const pack = await outscraperLeadEnrich.enrichLeadFromOutscraperContacts(lead, integrationEnv);
    if (!pack) return null;
    const email = (pack.patch && pack.patch.email) || (pack.extract && pack.extract.email);
    if (isValidEmailForGhl(email)) {
      return {
        email: String(email).trim(),
        source: 'outscraper_contacts',
        patch: pack.patch || {},
        lead: { ...lead, ...(pack.patch || {}), email: String(email).trim() },
      };
    }
  } catch (e) {
    console.warn('[ensureLeadEmail] Outscraper contacts failed:', e && e.message);
  }
  return null;
}

async function tryMoltsetsEmail(lead, integrationEnv) {
  const moltsetsClient = require('./moltsetsClient');
  if (!moltsetsClient.isConfigured(integrationEnv)) return null;
  try {
    const pack = await moltsetsLeadEnrich.enrichLeadForBusiness(lead, integrationEnv, {
      includeMobile: false,
    });
    const extract = (pack && pack.extract) || {};
    if (!isValidEmailForGhl(extract.email)) return null;
    const { lead: merged, patch } = mergeEnrichmentOntoLead(lead, extract);
    return {
      email: String(extract.email).trim(),
      source: 'moltsets',
      emailValidationStatus: extract.email_validation_status || '',
      decisionMakerName: extract.decision_maker_name || '',
      linkedin: extract.linkedin || '',
      patch,
      lead: { ...merged, email: String(extract.email).trim() },
    };
  } catch (e) {
    console.warn('[ensureLeadEmail] MoltSets failed:', e && e.message);
  }
  return null;
}

async function tryBetterContactEmail(lead, integrationEnv, opts = {}) {
  if (!betterContact.isConfigured(integrationEnv)) return null;
  try {
    const maxWaitMs = Number(opts.maxWaitMs) > 0 ? Number(opts.maxWaitMs) : 45_000;
    const leadInput = betterContact.buildLeadInput(lead);
    if (!leadInput) return null;
    const requestId = await betterContact.submitEnrichment(leadInput, integrationEnv);
    const result = await betterContact.pollEnrichmentResult(requestId, integrationEnv, {
      maxWaitMs,
      pollIntervalMs: 3_000,
    });
    const rows = Array.isArray(result.data) ? result.data : [];
    const extract = betterContact.betterContactRowToExtract(rows[0] || null);
    if (!isValidEmailForGhl(extract.email)) return null;
    return {
      email: String(extract.email).trim(),
      source: 'bettercontact',
      emailValidationStatus: extract.email_validation_status || '',
      decisionMakerName: extract.decision_maker_name || '',
      linkedin: extract.linkedin || '',
      lead,
    };
  } catch (e) {
    console.warn('[ensureLeadEmail] BetterContact failed:', e && e.message);
  }
  return null;
}

async function persistLeadPatch(lead, patch, workspaceId) {
  if (!lead || !lead.key || !patch || !Object.keys(patch).length) return lead;
  try {
    const key = String(lead.key).startsWith('lead:') ? lead.key : `lead:${lead.key}`;
    return await dbService.updateLead(key, patch, workspaceId);
  } catch (e) {
    console.warn('[ensureLeadEmail] persist failed:', e && e.message);
    return { ...lead, ...patch };
  }
}

/**
 * @param {{
 *   lead: object,
 *   workspaceId: string,
 *   integrationEnv?: object|null,
 *   persist?: boolean,
 *   betterContactMaxWaitMs?: number,
 *   totalBudgetMs?: number,
 * }} opts
 */
async function ensureLeadEmail(opts) {
  let lead = opts.lead && typeof opts.lead === 'object' ? { ...opts.lead } : {};
  const workspaceId = String(opts.workspaceId || 'default').trim() || 'default';
  const persist = opts.persist !== false;
  const totalBudgetMs =
    Number(opts.totalBudgetMs) > 0 ? Number(opts.totalBudgetMs) : DEFAULT_TOTAL_BUDGET_MS;
  const deadline = Date.now() + totalBudgetMs;

  if (hasUsableEmail(lead)) {
    return { found: true, alreadyHad: true, lead, email: String(lead.email).trim(), sources: [] };
  }

  // Present but unusable (asset scrape / placeholder) — clear so we hunt and don't keep junk.
  const rawExisting = String(lead.email || '').trim();
  let clearedJunk = false;
  let accumulatedPatch = {};
  if (rawExisting && rawExisting !== 'N/A') {
    clearedJunk = true;
    lead = { ...lead, email: '', emailValidationStatus: 'rejected_junk' };
    accumulatedPatch = {
      email: '',
      emailValidationStatus: 'rejected_junk',
      logs: [
        {
          type: 'email_find',
          message: `Cleared unusable scraped/placeholder email: ${rawExisting.slice(0, 80)}`,
          timestamp: new Date().toISOString(),
        },
      ],
    };
  }

  let integrationEnv = opts.integrationEnv || null;
  if (!integrationEnv) {
    try {
      integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(workspaceId);
    } catch (_) {
      integrationEnv = null;
    }
  }

  const sourcesTried = [];
  let timedOut = false;

  function remainingMs() {
    return Math.max(0, deadline - Date.now());
  }

  function stepBudget(defaultMs) {
    const left = remainingMs();
    if (left <= 0) return 0;
    return Math.min(defaultMs, left);
  }

  async function runStep(label, defaultMs, fn) {
    const budget = stepBudget(defaultMs);
    if (budget <= 0) {
      timedOut = true;
      return null;
    }
    try {
      return await withTimeout(Promise.resolve().then(fn), budget, label);
    } catch (e) {
      console.warn(`[ensureLeadEmail] ${label} failed/skipped:`, e && e.message);
      if (e && /timed out/i.test(String(e.message || ''))) timedOut = true;
      return null;
    }
  }

  const contactEnrichPreference = require('./contactEnrichPreference');
  const useMoltsetsFirst = contactEnrichPreference.preferMoltsets(integrationEnv);
  const attempts = [
    {
      label: 'local_website',
      ms: STEP_TIMEOUT_MS.local_website,
      run: () => tryLocalWebsiteEmail(lead, integrationEnv),
    },
    {
      label: 'rapidapi_website',
      ms: STEP_TIMEOUT_MS.rapidapi_website,
      run: () => tryRapidApiWebsiteEmail(lead, integrationEnv),
    },
    ...(useMoltsetsFirst
      ? [
          {
            label: 'moltsets',
            ms: STEP_TIMEOUT_MS.moltsets,
            run: () => tryMoltsetsEmail(lead, integrationEnv),
          },
          {
            label: 'outscraper_contacts',
            ms: STEP_TIMEOUT_MS.outscraper_contacts,
            run: () => tryOutscraperEmail(lead, integrationEnv),
          },
        ]
      : [
          {
            label: 'outscraper_contacts',
            ms: STEP_TIMEOUT_MS.outscraper_contacts,
            run: () => tryOutscraperEmail(lead, integrationEnv),
          },
        ]),
    {
      label: 'bettercontact',
      ms: Math.min(
        STEP_TIMEOUT_MS.bettercontact,
        Number(opts.betterContactMaxWaitMs) > 0
          ? Number(opts.betterContactMaxWaitMs)
          : STEP_TIMEOUT_MS.bettercontact,
      ),
      run: () =>
        tryBetterContactEmail(lead, integrationEnv, {
          maxWaitMs: stepBudget(
            Number(opts.betterContactMaxWaitMs) > 0
              ? Number(opts.betterContactMaxWaitMs)
              : STEP_TIMEOUT_MS.bettercontact,
          ),
        }),
    },
  ];

  let hit = null;
  for (const step of attempts) {
    if (remainingMs() <= 0) {
      timedOut = true;
      break;
    }
    // eslint-disable-next-line no-await-in-loop
    const result = await runStep(step.label, step.ms, step.run);
    if (!result) continue;
    sourcesTried.push(result.source || step.label);
    if (result.lead) lead = result.lead;
    if (result.email && isValidEmailForGhl(result.email)) {
      hit = result;
      break;
    }
  }

  if (!hit) {
    if (clearedJunk && persist && lead.key) {
      lead = await persistLeadPatch(lead, accumulatedPatch, workspaceId);
    }
    return {
      found: false,
      alreadyHad: false,
      lead,
      email: '',
      sources: sourcesTried,
      reason: timedOut ? 'timed_out' : 'not_found',
      clearedJunk,
      unlockedWebsite: hasUsableWebsite(lead),
    };
  }

  const patch = {
    ...accumulatedPatch,
    ...(hit.patch && typeof hit.patch === 'object' ? hit.patch : {}),
    ...buildEmailPatch(lead, hit.email, hit),
  };
  patch.email = hit.email;

  if (persist) lead = await persistLeadPatch(lead, patch, workspaceId);
  else lead = { ...lead, ...patch };

  return {
    found: true,
    alreadyHad: false,
    lead,
    email: hit.email,
    sources: sourcesTried,
    source: hit.source,
  };
}

module.exports = {
  hasUsableEmail,
  hasUsableWebsite,
  ensureLeadEmail,
  buildEmailPatch,
  normalizeWebsite,
  mergeEnrichmentOntoLead,
  withTimeout,
  STEP_TIMEOUT_MS,
  DEFAULT_TOTAL_BUDGET_MS,
};
