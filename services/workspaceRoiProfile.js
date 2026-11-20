/**
 * Workspace ROI / “what makes a lead hot” goals for Today queue and Money Mode.
 *
 * Profiles (also stored as ws.prospecting.roiProfile when the user picks one):
 * - agency_gap — Marketing agencies: no website / weak site = hottest
 * - partner_fit — Local / retail / flooring: site + reviews / partner signals
 * - license_renewal — Insurance / licensed trades: license or policy expiry soon
 */

const { isAgencySalesWorkspace } = require('./leadPanelWorkspace');
const { resolveWorkspaceScriptPresetKey } = require('./workspaceScriptBootstrap');

const ROI_PROFILES = Object.freeze({
  AGENCY_GAP: 'agency_gap',
  PARTNER_FIT: 'partner_fit',
  LICENSE_RENEWAL: 'license_renewal',
});

const GOAL_CATALOG = Object.freeze([
  {
    id: ROI_PROFILES.AGENCY_GAP,
    label: 'Website & SEO gaps',
    shortLabel: 'No website / weak site',
    bestFor: 'Marketing agencies, web design, SEO, AdHello-style offers',
    blurb:
      'Sorted by overdue cadence, aging pipeline, gap score, and Local Prospector tiers (Hot / Warm / Low / Skip). Hot = no site or social-only with a phone or email.',
    badgeHint: 'No site found · weak site · SEO gaps',
  },
  {
    id: ROI_PROFILES.PARTNER_FIT,
    label: 'Reviews & partner fit',
    shortLabel: 'Site + reviews',
    bestFor: 'Flooring, retail/install, local services, referral networks',
    blurb:
      'Sorted by overdue cadence, then high + recent reviews (volume, last 30 days, last review date), star rating, and partner fit. Hot = real site with review traction.',
    badgeHint: 'Has site · reviews · partner fit',
  },
  {
    id: ROI_PROFILES.LICENSE_RENEWAL,
    label: 'CCB & COI expiry',
    shortLabel: 'CCB / COI expiring',
    bestFor: 'HomeElk, contractor networks, insurance & bonding for licensed trades',
    blurb:
      'Sorted by overdue cadence, then soonest CCB license or COI (liability insurance) expiry, then contactability. Hot = CCB or COI within ~60 days (or already expired) with a phone or email.',
    badgeHint: 'CCB expires · COI due',
  },
]);

const GOAL_BY_ID = Object.freeze(
  Object.fromEntries(GOAL_CATALOG.map((g) => [g.id, g])),
);

function normalizeRoiProfile(raw) {
  const v = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (v === 'agency' || v === 'agencygap' || v === 'no_website' || v === 'website_gap') {
    return ROI_PROFILES.AGENCY_GAP;
  }
  if (v === 'partner' || v === 'partnerfit' || v === 'reviews' || v === 'retail') {
    return ROI_PROFILES.PARTNER_FIT;
  }
  if (
    v === 'license' ||
    v === 'license_expiry' ||
    v === 'insurance' ||
    v === 'insurance_expiry' ||
    v === 'renewal' ||
    v === 'compliance' ||
    v === 'ccb' ||
    v === 'coi' ||
    v === 'ccb_coi' ||
    v === 'homeelk' ||
    v === 'contractors'
  ) {
    return ROI_PROFILES.LICENSE_RENEWAL;
  }
  if (
    v === ROI_PROFILES.AGENCY_GAP ||
    v === ROI_PROFILES.PARTNER_FIT ||
    v === ROI_PROFILES.LICENSE_RENEWAL
  ) {
    return v;
  }
  return '';
}

/**
 * Infer default goal from workspace type when the user has not set one.
 * @param {object|null|undefined} ws
 * @returns {'agency_gap'|'partner_fit'|'license_renewal'}
 */
function inferRoiProfile(ws) {
  if (!ws || typeof ws !== 'object') return ROI_PROFILES.AGENCY_GAP;
  if (isAgencySalesWorkspace(ws)) return ROI_PROFILES.AGENCY_GAP;

  const preset = resolveWorkspaceScriptPresetKey(ws);
  if (preset === 'agency') return ROI_PROFILES.AGENCY_GAP;

  const intake = ws.pipelineIntake && typeof ws.pipelineIntake === 'object' ? ws.pipelineIntake : {};
  const salesIntake = ws.salesIntake && typeof ws.salesIntake === 'object' ? ws.salesIntake : {};
  const probe = [
    ws.name,
    ws.slug,
    ws.coachPrompt,
    (ws.icp && ws.icp.keyword) || ws.icpKeyword,
    intake.businessDescription,
    salesIntake.vertical,
    salesIntake.primaryGoal,
    preset,
  ]
    .map((x) => String(x || '').toLowerCase())
    .join(' ');

  if (
    /homeelk|home elk|insurance|insurtech|bond|bonding|license renew|renewal|compliance|contractor license|l&i|ccb|\bcoi\b/.test(
      probe,
    )
  ) {
    return ROI_PROFILES.LICENSE_RENEWAL;
  }

  // retail_install, local_service, saas, ecommerce_b2b, and other non-agency verticals
  return ROI_PROFILES.PARTNER_FIT;
}

/**
 * @param {object|null|undefined} ws
 * @returns {'agency_gap'|'partner_fit'|'license_renewal'}
 */
function resolveRoiProfile(ws) {
  if (!ws || typeof ws !== 'object') return ROI_PROFILES.AGENCY_GAP;
  const prospecting = ws.prospecting && typeof ws.prospecting === 'object' ? ws.prospecting : {};
  const explicit =
    normalizeRoiProfile(prospecting.roiProfile) ||
    normalizeRoiProfile(ws.roiProfile) ||
    normalizeRoiProfile(ws.workspaceGoal);
  if (explicit) return explicit;
  return inferRoiProfile(ws);
}

/**
 * @param {object|null|undefined} options — scoreLeadRecord / queue opts
 * @returns {'agency_gap'|'partner_fit'|'license_renewal'}
 */
function resolveRoiProfileFromOptions(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const explicit = normalizeRoiProfile(opts.roiProfile);
  if (explicit) return explicit;
  if (opts.workspace) return resolveRoiProfile(opts.workspace);
  return ROI_PROFILES.AGENCY_GAP;
}

function isPartnerFitProfile(profileOrOptions) {
  if (typeof profileOrOptions === 'string') {
    return normalizeRoiProfile(profileOrOptions) === ROI_PROFILES.PARTNER_FIT;
  }
  return resolveRoiProfileFromOptions(profileOrOptions) === ROI_PROFILES.PARTNER_FIT;
}

function isLicenseRenewalProfile(profileOrOptions) {
  if (typeof profileOrOptions === 'string') {
    return normalizeRoiProfile(profileOrOptions) === ROI_PROFILES.LICENSE_RENEWAL;
  }
  return resolveRoiProfileFromOptions(profileOrOptions) === ROI_PROFILES.LICENSE_RENEWAL;
}

/**
 * Short blurb under “Highest-ROI leads to contact”.
 * @param {'agency_gap'|'partner_fit'|'license_renewal'|object} profileOrWs
 */
function contactQueueSortBlurb(profileOrWs) {
  const profile =
    typeof profileOrWs === 'string'
      ? normalizeRoiProfile(profileOrWs) || ROI_PROFILES.AGENCY_GAP
      : resolveRoiProfile(profileOrWs);
  const goal = GOAL_BY_ID[profile];
  return (goal && goal.blurb) || GOAL_BY_ID[ROI_PROFILES.AGENCY_GAP].blurb;
}

function goalMeta(profileOrWs) {
  const profile =
    typeof profileOrWs === 'string'
      ? normalizeRoiProfile(profileOrWs) || ROI_PROFILES.AGENCY_GAP
      : resolveRoiProfile(profileOrWs);
  return GOAL_BY_ID[profile] || GOAL_BY_ID[ROI_PROFILES.AGENCY_GAP];
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

/**
 * Default goal when creating a workspace from a script/pipeline preset.
 * @param {string} presetKey
 */
function defaultRoiProfileForPreset(presetKey) {
  const pk = String(presetKey || '')
    .trim()
    .toLowerCase();
  if (pk === 'agency') return ROI_PROFILES.AGENCY_GAP;
  if (pk === 'insurance' || pk === 'contractors' || pk === 'compliance' || pk === 'homeelk') {
    return ROI_PROFILES.LICENSE_RENEWAL;
  }
  return ROI_PROFILES.PARTNER_FIT;
}

module.exports = {
  ROI_PROFILES,
  GOAL_CATALOG,
  GOAL_BY_ID,
  normalizeRoiProfile,
  inferRoiProfile,
  resolveRoiProfile,
  resolveRoiProfileFromOptions,
  isPartnerFitProfile,
  isLicenseRenewalProfile,
  contactQueueSortBlurb,
  goalMeta,
  roiScoreOptionsFromWorkspace,
  defaultRoiProfileForPreset,
};
