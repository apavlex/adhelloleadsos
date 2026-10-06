/**
 * Single-purpose lead enrichment shared by the lead panel buttons and AI tools:
 * Google reviews refresh (Outscraper), social profile discovery (TikHub), phone line type (SignalWire Lookup).
 */
const dbService = require('./database');
const workspaceIntegrations = require('./workspaceIntegrations');
const outscraper = require('./outscraperClient');
const outscraperGmbEnrich = require('./outscraperGmbEnrich');
const tikHub = require('./tikHubClient');
const phoneLineType = require('./phoneLineType');
const { firecrawlExtractToLeadUpdates } = require('./enrichmentNormalize');
const { sanitizeExtractSocialsForLead, buildRejectedSocialCleanupPatch } = require('./socialUrlNormalize');

function storageKey(lead) {
  return lead.key.startsWith('lead:') ? lead.key : `lead:${lead.key}`;
}

/**
 * Reviews-only refresh: Outscraper GMB listing + review rows → rating, count, freshness.
 * Skips contacts, Firecrawl, BetterContact, and AI review summary.
 */
async function runReviewsRefresh(lead, workspaceId) {
  if (!lead || !lead.key) return { success: false, error: 'Lead not found.' };
  const fullKey = storageKey(lead);
  const leadWorkspaceId = (lead && lead.workspaceId) || workspaceId;
  const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(leadWorkspaceId);

  if (!outscraper.isConfigured(integrationEnv)) {
    return {
      success: false,
      error: 'Outscraper is not configured. Add Outscraper under Workspace → Integrations.',
    };
  }

  let gmbPack;
  try {
    gmbPack = await outscraperGmbEnrich.enrichLeadFromOutscraperGmb(lead, integrationEnv);
  } catch (e) {
    return { success: false, error: e.message || 'Reviews refresh failed.' };
  }

  if (!gmbPack || !gmbPack.used) {
    return {
      success: false,
      error:
        (gmbPack && gmbPack.reviewError) ||
        'No Google Business listing or reviews found for this lead.',
      lead,
      reviewsFetched: false,
      reviewError: (gmbPack && gmbPack.reviewError) || null,
      reviewQuery: (gmbPack && gmbPack.reviewQuery) || null,
    };
  }

  const patch = { ...(gmbPack.patch || {}) };
  const updates = [...(lead.updates || [])];
  updates.push({
    type: 'review_refresh',
    value: gmbPack.reviewsFetched
      ? 'Google reviews & freshness refreshed via Outscraper.'
      : 'Google Business listing refreshed via Outscraper (reviews sample limited).',
    timestamp: new Date().toISOString(),
  });
  patch.updates = updates;
  patch.lastReviewRefreshAt = new Date().toISOString();

  const updated = await dbService.updateLead(fullKey, patch, leadWorkspaceId);
  return {
    success: true,
    lead: updated || { ...lead, ...patch },
    reviewsFetched: !!gmbPack.reviewsFetched,
    reviewError: gmbPack.reviewError || null,
    reviewQuery: gmbPack.reviewQuery || null,
  };
}

/**
 * TikHub-only social profile discovery (Instagram, TikTok, X).
 */
async function runSocialEnrichment(lead, workspaceId) {
  if (!lead || !lead.key) return { success: false, error: 'Lead not found.' };
  const fullKey = storageKey(lead);
  const leadWorkspaceId = (lead && lead.workspaceId) || workspaceId;
  const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(leadWorkspaceId);
  const rejectedSocialCleanup = buildRejectedSocialCleanupPatch(lead);
  if (Object.keys(rejectedSocialCleanup).length) {
    lead =
      (await dbService.updateLead(fullKey, rejectedSocialCleanup, leadWorkspaceId)) ||
      { ...lead, ...rejectedSocialCleanup };
  }

  if (!tikHub.isConfigured(integrationEnv)) {
    return {
      success: false,
      error: 'TikHub is not configured. Add your API key under Workspace → Integrations → TikHub.',
    };
  }

  let pack;
  try {
    pack = await tikHub.enrichLeadSocialProfiles(lead, integrationEnv);
  } catch (e) {
    return { success: false, error: e.message || 'Social search failed.' };
  }

  if (pack.skipped) {
    return {
      success: true,
      skipped: true,
      message: pack.message,
      lead,
      socialsFound: [],
    };
  }

  const extract = sanitizeExtractSocialsForLead(pack.extract || {}, lead);
  if (!tikHub.extractHasSignal(extract)) {
    return {
      success: false,
      error: pack.message || 'No matching social profiles found for this business.',
      lead,
      socialsFound: [],
      errors: pack.errors || [],
    };
  }

  const patch = firecrawlExtractToLeadUpdates(extract);
  if ((!lead.instagram || lead.instagram === 'N/A') && extract.instagram) patch.instagram = extract.instagram;
  if ((!lead.tiktok || lead.tiktok === 'N/A') && extract.tiktok) patch.tiktok = extract.tiktok;
  if ((!lead.twitter || lead.twitter === 'N/A') && extract.twitter) patch.twitter = extract.twitter;
  if ((!lead.facebook || lead.facebook === 'N/A') && extract.facebook) patch.facebook = extract.facebook;
  if (!lead.linkedin && extract.linkedin) patch.linkedin = extract.linkedin;

  const updates = [...(lead.updates || [])];
  updates.push({
    type: 'social_enrichment',
    value: `Social profiles found via TikHub (${(pack.platforms || []).join(', ') || 'updated'}).`,
    timestamp: new Date().toISOString(),
  });
  patch.updates = updates;
  patch.lastSocialEnrichAt = new Date().toISOString();

  const updatedLead = (await dbService.updateLead(fullKey, patch, leadWorkspaceId)) || { ...lead, ...patch };
  return {
    success: true,
    lead: updatedLead,
    socialsFound: pack.platforms || [],
    message: pack.message,
  };
}

const LOOKUP_UNAVAILABLE_SOURCES = new Set(['signalwire_not_configured', 'missing_space_url', 'lookup_disabled']);

/** Mobile vs landline + carrier. Failures carry an HTTP-ish status and a code for the route. */
async function verifyPhoneLine(lead, workspaceId) {
  if (!phoneLineType.hasUsablePhone(lead.phone)) {
    return { success: false, status: 422, code: 'no_phone', error: 'Lead has no usable phone number to verify.' };
  }
  const blocked = phoneLineType.lookupBlockedReason();
  if (blocked) return { success: false, status: 503, code: 'lookup_unavailable', error: blocked };

  const patch = await phoneLineType.forceRefresh(lead);
  if (!patch) return { success: false, status: 422, code: 'lookup_empty', error: 'Could not verify phone line type.' };
  if (LOOKUP_UNAVAILABLE_SOURCES.has(patch.phoneLineTypeSource)) {
    return {
      success: false,
      status: 503,
      code: patch.phoneLineTypeSource,
      error:
        phoneLineType.lookupBlockedReason() ||
        'Phone line-type lookup is unavailable. Configure SignalWire under Workspace → Phone bank / Integrations.',
    };
  }

  const updated = await dbService.updateLead(storageKey(lead), patch, workspaceId);
  const leadOut = updated || { ...lead, ...patch };
  return {
    success: true,
    lead: leadOut,
    lineType: leadOut.phoneLineType || patch.phoneLineType,
    carrier: leadOut.phoneCarrier || patch.phoneCarrier || '',
    source: leadOut.phoneLineTypeSource || patch.phoneLineTypeSource || '',
  };
}

module.exports = {
  runReviewsRefresh,
  runSocialEnrichment,
  verifyPhoneLine,
};
