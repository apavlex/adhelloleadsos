/**
 * Find a real business email before auto-outreach enrolls to GHL.
 * Uses website scrape + BetterContact — never invents addresses.
 */
const dbService = require('./database');
const { isValidEmailForGhl } = require('./ghlClient');
const workspaceIntegrations = require('./workspaceIntegrations');
const betterContact = require('./betterContactClient');
const rapidapiWebsiteEnrich = require('./rapidapiWebsiteEnrich');
const outscraperLeadEnrich = require('./outscraperLeadEnrich');
const localPageExtract = require('./localPageExtract');

function hasUsableEmail(lead) {
  const email = String((lead && lead.email) || '').trim();
  return isValidEmailForGhl(email);
}

function normalizeWebsite(lead) {
  const raw = String((lead && (lead.website || lead.url)) || '').trim();
  if (!raw || raw === 'N/A') return '';
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
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

async function tryLocalWebsiteEmail(lead, integrationEnv) {
  const website = normalizeWebsite(lead);
  if (!website) return null;
  if (!localPageExtract.localScrapeEnrichEnabled(integrationEnv)) return null;
  try {
    const pack = await localPageExtract.extractFromLocalScrape(website);
    const email = pack && pack.extract && pack.extract.email;
    if (isValidEmailForGhl(email)) {
      return { email: String(email).trim(), source: 'local_website' };
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
      return { email: String(email).trim(), source: 'rapidapi_website', patch: pack.patch };
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
      };
    }
  } catch (e) {
    console.warn('[ensureLeadEmail] Outscraper contacts failed:', e && e.message);
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
    };
  } catch (e) {
    console.warn('[ensureLeadEmail] BetterContact failed:', e && e.message);
  }
  return null;
}

/**
 * @param {{
 *   lead: object,
 *   workspaceId: string,
 *   integrationEnv?: object|null,
 *   persist?: boolean,
 *   betterContactMaxWaitMs?: number,
 * }} opts
 */
async function ensureLeadEmail(opts) {
  const lead = opts.lead && typeof opts.lead === 'object' ? opts.lead : {};
  const workspaceId = String(opts.workspaceId || 'default').trim() || 'default';
  if (hasUsableEmail(lead)) {
    return { found: true, alreadyHad: true, lead, email: String(lead.email).trim(), sources: [] };
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
  const attempts = [
    () => tryLocalWebsiteEmail(lead, integrationEnv),
    () => tryRapidApiWebsiteEmail(lead, integrationEnv),
    () => tryOutscraperEmail(lead, integrationEnv),
    () =>
      tryBetterContactEmail(lead, integrationEnv, {
        maxWaitMs: opts.betterContactMaxWaitMs || 45_000,
      }),
  ];

  let hit = null;
  for (const run of attempts) {
    // eslint-disable-next-line no-await-in-loop
    const result = await run();
    if (!result) continue;
    sourcesTried.push(result.source);
    if (result.email && isValidEmailForGhl(result.email)) {
      hit = result;
      break;
    }
  }

  if (!hit) {
    return {
      found: false,
      alreadyHad: false,
      lead,
      email: '',
      sources: sourcesTried,
      reason: 'not_found',
    };
  }

  const patch = {
    ...(hit.patch && typeof hit.patch === 'object' ? hit.patch : {}),
    ...buildEmailPatch(lead, hit.email, hit),
  };
  patch.email = hit.email;

  let updated = lead;
  if (opts.persist !== false && lead.key) {
    try {
      const key = String(lead.key).startsWith('lead:') ? lead.key : `lead:${lead.key}`;
      updated = await dbService.updateLead(key, patch, workspaceId);
    } catch (e) {
      console.warn('[ensureLeadEmail] persist failed:', e && e.message);
      updated = { ...lead, ...patch };
    }
  } else {
    updated = { ...lead, ...patch };
  }

  return {
    found: true,
    alreadyHad: false,
    lead: updated,
    email: hit.email,
    sources: sourcesTried,
    source: hit.source,
  };
}

module.exports = {
  hasUsableEmail,
  ensureLeadEmail,
  buildEmailPatch,
  normalizeWebsite,
};
