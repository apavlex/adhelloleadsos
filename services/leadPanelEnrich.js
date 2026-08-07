/**
 * Fast Outscraper enrichment when the lead detail sidebar opens (panel-data).
 * Runs GMB → Contacts & Leads → Maps fallback within a timeout budget.
 */

const outscraper = require('./outscraperClient');
const outscraperGmbEnrich = require('./outscraperGmbEnrich');
const outscraperLeadEnrich = require('./outscraperLeadEnrich');
const builtWithEnrich = require('./builtWithEnrich');
const mapsEnrichFallback = require('./mapsEnrichFallback');
const { firecrawlExtractToLeadUpdates } = require('./enrichmentNormalize');
const { hasContactValue, leadMissingCoreContact } = require('./leadPanelNormalize');

function raceTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label || 'enrich'}_timeout`)), ms);
    }),
  ]);
}

function mergePatch(target, source) {
  if (!source || typeof source !== 'object') return target;
  for (const [k, v] of Object.entries(source)) {
    if (v === undefined || v === null) continue;
    target[k] = v;
  }
  return target;
}

function mergeExtract(into, add) {
  return mapsEnrichFallback.mergeExtractPreferFirecrawl(add || {}, into || {});
}

/**
 * @param {object} lead
 * @param {Record<string, string>|null|undefined} integrationEnv
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<{ patch: object, sources: string[], extract: object }>}
 */
async function enrichLeadForPanelSidebar(lead, integrationEnv, opts) {
  opts = opts || {};
  const timeoutMs = Math.max(5000, parseInt(opts.timeoutMs, 10) || 14000);
  const patch = {};
  let extract = {};
  const sources = [];

  const working = { ...lead };

  if (outscraper.isConfigured(integrationEnv)) {
    try {
      const gmb = await raceTimeout(
        outscraperGmbEnrich.enrichLeadFromOutscraperGmb(working, integrationEnv),
        timeoutMs,
        'outscraper_gmb',
      );
      if (gmb && gmb.used) {
        sources.push('Outscraper GMB');
        mergePatch(patch, gmb.patch || {});
        extract = mergeExtract(extract, gmb.extract || {});
        Object.assign(working, patch);
      }
    } catch (e) {
      if (!String(e.message || '').includes('_timeout')) {
        console.warn('[leadPanelEnrich] GMB skipped:', e.message);
      }
    }

    const domain = outscraperLeadEnrich.resolveLeadDomain(working);
    if (domain && outscraperLeadEnrich.leadNeedsOutscraperContacts(working)) {
      try {
        const contacts = await raceTimeout(
          outscraperLeadEnrich.enrichLeadFromOutscraperContacts(working, integrationEnv),
          timeoutMs,
          'outscraper_contacts',
        );
        if (contacts && contacts.used) {
          sources.push('Outscraper contacts');
          mergePatch(patch, contacts.patch || {});
          extract = mergeExtract(extract, contacts.extract || {});
          Object.assign(working, patch);
        }
      } catch (e) {
        if (!String(e.message || '').includes('_timeout')) {
          console.warn('[leadPanelEnrich] contacts skipped:', e.message);
        }
      }
    }
  }

  if (outscraper.isConfigured(integrationEnv) && builtWithEnrich.leadNeedsBuiltWith({ ...working, ...patch })) {
    try {
      const bw = await raceTimeout(
        builtWithEnrich.enrichLeadFromBuiltWith({ ...working, ...patch }, integrationEnv),
        timeoutMs,
        'builtwith',
      );
      if (bw && bw.used && bw.patch) {
        sources.push('BuiltWith');
        mergePatch(patch, bw.patch);
        Object.assign(working, patch);
      }
    } catch (e) {
      if (!String(e.message || '').includes('_timeout')) {
        console.warn('[leadPanelEnrich] BuiltWith skipped:', e.message);
      }
    }
  }

  if (leadMissingCoreContact({ ...working, ...patch })) {
    try {
      const maps = await raceTimeout(
        mapsEnrichFallback.enrichFromMapsForLead(working, integrationEnv),
        timeoutMs,
        'maps_fallback',
      );
      if (maps && maps.extract) {
        sources.push('Maps');
        const mapsPatch = firecrawlExtractToLeadUpdates(maps.extract);
        if (maps.websiteHint && !hasContactValue(mapsPatch.website) && !hasContactValue(working.website)) {
          mapsPatch.website = maps.websiteHint;
        }
        mergePatch(patch, mapsPatch);
        extract = mergeExtract(extract, maps.extract);
      }
    } catch (e) {
      if (!String(e.message || '').includes('_timeout')) {
        console.warn('[leadPanelEnrich] maps fallback skipped:', e.message);
      }
    }
  }

  return { patch, sources, extract };
}

function panelLeadNeedsBackgroundEnhance(lead) {
  if (!lead) return false;
  const missingEmail = !hasContactValue(lead.email);
  const missingPhone = !hasContactValue(lead.phone);
  const missingReviews =
    !(parseInt(lead.reviewsCount, 10) > 0) && !(Number(lead.totalScore) > 0);
  const lastHunt = String(lead.lastContactHuntAt || '').trim();
  const stale =
    !lastHunt ||
    Date.now() - new Date(lastHunt).getTime() > 30 * 24 * 60 * 60 * 1000;
  return (missingEmail || missingPhone || missingReviews) && stale;
}

module.exports = {
  enrichLeadForPanelSidebar,
  panelLeadNeedsBackgroundEnhance,
};
