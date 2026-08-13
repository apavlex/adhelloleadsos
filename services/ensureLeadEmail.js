/**
 * Find a real business email before auto-outreach enrolls to GHL.
 * Order: Monid (domain unlock) → website scrape → Outscraper → BetterContact.
 * Never invents addresses.
 */
const dbService = require('./database');
const { isValidEmailForGhl } = require('./ghlClient');
const workspaceIntegrations = require('./workspaceIntegrations');
const betterContact = require('./betterContactClient');
const rapidapiWebsiteEnrich = require('./rapidapiWebsiteEnrich');
const outscraperLeadEnrich = require('./outscraperLeadEnrich');
const localPageExtract = require('./localPageExtract');
const monidLeadEnrich = require('./monidLeadEnrich');
const { firecrawlExtractToLeadUpdates } = require('./enrichmentNormalize');

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

/**
 * Monid unlocks website/domain (and sometimes phone/socials) so later email finders work.
 * If Monid returns an email, use it immediately.
 */
async function tryMonidEnrich(lead, integrationEnv) {
  if (!monidLeadEnrich.isConfigured(integrationEnv)) return null;
  try {
    const pack = await monidLeadEnrich.enrichLeadFromMonid(lead, integrationEnv);
    if (!pack || !pack.enriched || !pack.extract) return null;
    const merged = mergeEnrichmentOntoLead(lead, pack.extract);
    const email = pack.extract.email || merged.patch.email;
    if (isValidEmailForGhl(email)) {
      return {
        email: String(email).trim(),
        source: 'monid',
        patch: merged.patch,
        lead: merged.lead,
        unlockedWebsite: !!(merged.patch.website || pack.extract.website),
      };
    }
    if (Object.keys(merged.patch).length) {
      return {
        email: '',
        source: 'monid',
        patch: merged.patch,
        lead: merged.lead,
        unlockedWebsite: !!merged.patch.website,
        enrichOnly: true,
      };
    }
  } catch (e) {
    console.warn('[ensureLeadEmail] Monid failed:', e && e.message);
  }
  return null;
}

async function tryLocalWebsiteEmail(lead, integrationEnv) {
  const website = normalizeWebsite(lead);
  if (!website) return null;
  if (!localPageExtract.localScrapeEnrichEnabled(integrationEnv)) return null;
  try {
    const pack = await localPageExtract.extractFromLocalScrape(website);
    const email = pack && pack.extract && pack.extract.email;
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
 * }} opts
 */
async function ensureLeadEmail(opts) {
  let lead = opts.lead && typeof opts.lead === 'object' ? { ...opts.lead } : {};
  const workspaceId = String(opts.workspaceId || 'default').trim() || 'default';
  const persist = opts.persist !== false;
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
  let accumulatedPatch = {};

  // Step 0: Monid first when website/domain is missing (or always as a cheap unlock attempt).
  if (!hasUsableWebsite(lead) || !betterContact.extractDomain(lead.website)) {
    const monidHit = await tryMonidEnrich(lead, integrationEnv);
    if (monidHit) {
      sourcesTried.push(monidHit.source);
      if (monidHit.patch && Object.keys(monidHit.patch).length) {
        accumulatedPatch = { ...accumulatedPatch, ...monidHit.patch };
        lead = monidHit.lead || { ...lead, ...monidHit.patch };
        if (persist) {
          lead = await persistLeadPatch(lead, {
            ...monidHit.patch,
            logs: [
              {
                type: 'email_find',
                message: monidHit.unlockedWebsite
                  ? `Monid unlocked website before email hunt: ${monidHit.patch.website}`
                  : 'Monid enriched company signals before email hunt',
                timestamp: new Date().toISOString(),
              },
            ],
          }, workspaceId);
        }
      }
      if (monidHit.email && isValidEmailForGhl(monidHit.email)) {
        const patch = {
          ...accumulatedPatch,
          ...buildEmailPatch(lead, monidHit.email, monidHit),
          email: monidHit.email,
        };
        if (persist) lead = await persistLeadPatch(lead, patch, workspaceId);
        else lead = { ...lead, ...patch };
        return {
          found: true,
          alreadyHad: false,
          lead,
          email: monidHit.email,
          sources: sourcesTried,
          source: 'monid',
        };
      }
    }
  }

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
    if (result.lead) lead = result.lead;
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
};
