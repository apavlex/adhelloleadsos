/**
 * Resolve workspace business context for Social Post Ideas.
 */

const { isAgencySalesWorkspace } = require('./leadPanelWorkspace');

function isClarkCountyLocalGuide(ws) {
  if (!ws || typeof ws !== 'object') return false;
  const slug = String(ws.slug || '').toLowerCase();
  const name = String(ws.name || '').toLowerCase();
  const preset = String(ws.socialPostsPreset || '').toLowerCase();
  return (
    slug.includes('clark') ||
    name.includes('clark county') ||
    name.includes('clarkcounty') ||
    preset.includes('clark') ||
    preset.includes('clarkcounty')
  );
}

/**
 * Agency / local-guide social voice (AdHello templates, GBP tips, Clark scout).
 * Partner verticals (flooring, etc.) must NOT inherit this from leftover coach
 * prompts or a brand-kit client name — that caused "Ideas for: TPR Supply"
 * with AdHello copy underneath.
 */
function isAgencyOrLocalGuideWorkspace(ws) {
  if (!ws || typeof ws !== 'object') return false;

  // Explicit non-agency sales preset wins (Flooring / retail_install / saas…).
  const salesKey = String(
    ws.salesScriptsPresetKey ||
      (ws.pipelineIntake && ws.pipelineIntake.presetKey) ||
      '',
  )
    .trim()
    .toLowerCase();
  if (salesKey && salesKey !== 'agency') {
    return isClarkCountyLocalGuide(ws);
  }

  if (isAgencySalesWorkspace(ws)) return true;
  if (isClarkCountyLocalGuide(ws)) return true;

  const slug = String(ws.slug || '').toLowerCase();
  const name = String(ws.name || '').toLowerCase();
  if (slug.includes('adhello') || name.includes('adhello')) return true;

  const preset = String(ws.socialPostsPreset || '').toLowerCase();
  if (preset.includes('adhello')) return true;

  return false;
}

/**
 * @param {object|null|undefined} ws
 * @returns {{
 *   niche: string,
 *   businessName: string,
 *   contentSubject: string,
 *   icpKeyword: string,
 *   businessDescription: string,
 *   isAgencyWorkspace: boolean,
 *   showLocalContent: boolean,
 * }}
 */
function resolveSocialPostProfile(ws) {
  ws = ws || {};
  const brandKit = ws.brandKit && typeof ws.brandKit === 'object' ? ws.brandKit : {};
  const intake = ws.cwIntake && typeof ws.cwIntake === 'object' ? ws.cwIntake : {};

  const wsName = String(ws.name || '').trim();
  const brandName = String(brandKit.businessName || '').trim();
  const icpKeyword = String(ws.icpKeyword || '').trim();
  const businessDescription = String(intake.businessDescription || '').trim();
  const socialPostsPreset = String(ws.socialPostsPreset || '').trim();
  const isAgencyWorkspace = isAgencyOrLocalGuideWorkspace(ws);

  // Workspace name is the source of truth for the active business (brand kit may hold a client name).
  const businessName = isAgencyWorkspace
    ? wsName || brandName || 'AdHello'
    : brandName || wsName || '';

  let contentSubject = businessName || icpKeyword || 'local business';
  if (isAgencyWorkspace) {
    contentSubject = 'local business';
  } else if (icpKeyword) {
    contentSubject = icpKeyword;
  }

  let niche = socialPostsPreset;
  if (!niche) {
    if (isAgencyWorkspace) {
      niche = `${businessName} — digital marketing for local businesses`;
    } else {
      const parts = [];
      if (businessName) parts.push(businessName);
      else if (icpKeyword) parts.push(icpKeyword);
      if (
        icpKeyword &&
        businessName &&
        !businessName.toLowerCase().includes(icpKeyword.toLowerCase())
      ) {
        parts.push(icpKeyword);
      }
      if (businessDescription) {
        parts.push(businessDescription.slice(0, 140));
      }
      niche = parts.filter(Boolean).join(' — ');
    }
  }

  if (!niche && isAgencyWorkspace) {
    niche = `${businessName || 'AdHello'} — local business marketing`;
  }
  if (!niche) {
    niche = businessName || icpKeyword || 'local home service business';
  }

  return {
    niche,
    businessName,
    contentSubject,
    icpKeyword,
    businessDescription,
    isAgencyWorkspace,
    showLocalContent: isAgencyWorkspace || isClarkCountyLocalGuide(ws),
  };
}

/** Map social-posts platform keys to Marketing Studio platform keys. */
const SOCIAL_TO_MARKETING_PLATFORM = {
  instagram: 'instagram_feed',
  facebook: 'facebook_feed',
  linkedin: 'linkedin_post',
  x: 'instagram_feed',
  tiktok: 'instagram_story',
  gmb: 'google_business_post',
};

function marketingPlatformForSocial(platform) {
  const key = String(platform || '').trim().toLowerCase();
  return SOCIAL_TO_MARKETING_PLATFORM[key] || 'instagram_feed';
}

module.exports = {
  isAgencyOrLocalGuideWorkspace,
  isClarkCountyLocalGuide,
  resolveSocialPostProfile,
  marketingPlatformForSocial,
  SOCIAL_TO_MARKETING_PLATFORM,
};
