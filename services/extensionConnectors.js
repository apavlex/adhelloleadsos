/**
 * Placeholders for non-Maps channels. Wire Apify actors or vendor APIs via env when you add them.
 */

function notConfigured(channelId) {
  return {
    ok: false,
    channelId,
    reason: 'not_configured',
    message:
      'Set the env vars listed on GET /api/acquisition-channels for this channel, then implement the actor/API call in extensionConnectors.js.',
  };
}

async function fetchJobPostingSignals(_query) {
  if (!process.env.APIFY_JOBS_ACTOR_ID) return notConfigured('jobs_indeed_linkedin');
  return {
    ok: false,
    channelId: 'jobs_indeed_linkedin',
    reason: 'implement_actor',
    message: 'Actor id is set — add run input + dataset mapping to lead rows in extensionConnectors.fetchJobPostingSignals.',
  };
}

async function fetchAdsLibrarySnapshot(_advertiserName) {
  if (!process.env.APIFY_META_ADS_ACTOR_ID && !process.env.GOOGLE_ADS_TRANSPARENCY_API_KEY) {
    return notConfigured('ads_library');
  }
  return {
    ok: false,
    channelId: 'ads_library',
    reason: 'implement_connector',
    message: 'Configure Meta/Google transparency access and map creatives → company domain.',
  };
}

async function fetchCommunityIntent(_opts) {
  return {
    ok: false,
    channelId: 'community_intent',
    reason: 'policy_sensitive',
    message:
      'Use official APIs or permitted data exports. Implement keyword subscriptions + human review before automation.',
  };
}

module.exports = {
  fetchJobPostingSignals,
  fetchAdsLibrarySnapshot,
  fetchCommunityIntent,
  notConfigured,
};
