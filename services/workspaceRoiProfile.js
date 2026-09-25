/**
 * Workspace ROI ranking profiles for Today queue / Money Mode ordering.
 *
 * agency_gap — AdHello-style: website / SEO gaps (no site = hottest).
 * partner_fit — Flooring / retail / local: referral-ready locals with a site + reviews.
 */

const { isAgencySalesWorkspace } = require('./leadPanelWorkspace');
const { resolveWorkspaceScriptPresetKey } = require('./workspaceScriptBootstrap');

const ROI_PROFILES = Object.freeze({
  AGENCY_GAP: 'agency_gap',
  PARTNER_FIT: 'partner_fit',
});

/**
 * @param {object|null|undefined} ws
 * @returns {'agency_gap'|'partner_fit'}
 */
function resolveRoiProfile(ws) {
  if (!ws || typeof ws !== 'object') return ROI_PROFILES.AGENCY_GAP;
  if (isAgencySalesWorkspace(ws)) return ROI_PROFILES.AGENCY_GAP;

  const preset = resolveWorkspaceScriptPresetKey(ws);
  if (preset === 'agency') return ROI_PROFILES.AGENCY_GAP;

  // retail_install, local_service, saas, and any non-agency vertical
  return ROI_PROFILES.PARTNER_FIT;
}

/**
 * @param {object|null|undefined} options — scoreLeadRecord / queue opts
 * @returns {'agency_gap'|'partner_fit'}
 */
function resolveRoiProfileFromOptions(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const explicit = String(opts.roiProfile || '').trim().toLowerCase();
  if (explicit === ROI_PROFILES.PARTNER_FIT || explicit === ROI_PROFILES.AGENCY_GAP) {
    return explicit;
  }
  if (opts.workspace) return resolveRoiProfile(opts.workspace);
  return ROI_PROFILES.AGENCY_GAP;
}

function isPartnerFitProfile(profileOrOptions) {
  if (typeof profileOrOptions === 'string') {
    return profileOrOptions === ROI_PROFILES.PARTNER_FIT;
  }
  return resolveRoiProfileFromOptions(profileOrOptions) === ROI_PROFILES.PARTNER_FIT;
}

/**
 * Short blurb under “Highest-ROI leads to contact”.
 * @param {'agency_gap'|'partner_fit'|object} profileOrWs
 */
function contactQueueSortBlurb(profileOrWs) {
  const profile =
    typeof profileOrWs === 'string'
      ? profileOrWs
      : resolveRoiProfile(profileOrWs);
  if (profile === ROI_PROFILES.PARTNER_FIT) {
    return 'Sorted by overdue cadence, aging pipeline, and partner fit — website, reviews, and referral-ready locals. Next channel follows your sequence template.';
  }
  return 'Sorted by overdue cadence, aging pipeline, gap score, and Local Prospector tiers (Hot / Warm / Low / Skip). Next channel follows your sequence template.';
}

/**
 * Options bag to thread into scoreLeadRecord / buildFocusQueue.
 * @param {object|null|undefined} ws
 */
function roiScoreOptionsFromWorkspace(ws) {
  const roiProfile = resolveRoiProfile(ws);
  return {
    workspace: ws || null,
    roiProfile,
  };
}

module.exports = {
  ROI_PROFILES,
  resolveRoiProfile,
  resolveRoiProfileFromOptions,
  isPartnerFitProfile,
  contactQueueSortBlurb,
  roiScoreOptionsFromWorkspace,
};
