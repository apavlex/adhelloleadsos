/**
 * Resolve workspace business context for Social Post Ideas.
 */

function isAgencyOrLocalGuideWorkspace(ws) {
  if (!ws || typeof ws !== 'object') return false;
  const slug = String(ws.slug || '').toLowerCase();
  const name = String(ws.name || '').toLowerCase();
  const preset = String(ws.socialPostsPreset || '').toLowerCase();
  if (
    slug.includes('adhello') ||
    slug.includes('clark') ||
    name.includes('clark county') ||
    name.includes('adhello') ||
    name.includes('clarkcounty')
  ) {
    return true;
  }
  if (preset.includes('clark') || preset.includes('adhello') || preset.includes('clarkcounty')) {
    return true;
  }
  const coach = String(ws.coachPrompt || '').toLowerCase();
  if (
    coach.includes('digital ad agency') ||
    coach.includes('clarkcounty') ||
    coach.includes('@clarkcountyguide')
  ) {
    return true;
  }
  return false;
}

/**
 * @param {object|null|undefined} ws
 * @returns {{
 *   niche: string,
 *   businessName: string,
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
      if (icpKeyword) parts.push(icpKeyword);
      else if (businessName) parts.push(businessName);
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
    niche = icpKeyword || businessName || 'local home service business';
  }

  return {
    niche,
    businessName,
    contentSubject,
    icpKeyword,
    businessDescription,
    isAgencyWorkspace,
    showLocalContent: isAgencyWorkspace,
  };
}

/** Map social-posts platform keys to Marketing Studio platform keys. */
const SOCIAL_TO_MARKETING_PLATFORM = {
  instagram: 'instagram_feed',
  facebook: 'facebook_feed',
  linkedin: 'linkedin_post',
  x: 'instagram_feed',
  tiktok: 'instagram_story',
};

function marketingPlatformForSocial(platform) {
  const key = String(platform || '').trim().toLowerCase();
  return SOCIAL_TO_MARKETING_PLATFORM[key] || 'instagram_feed';
}

module.exports = {
  isAgencyOrLocalGuideWorkspace,
  resolveSocialPostProfile,
  marketingPlatformForSocial,
  SOCIAL_TO_MARKETING_PLATFORM,
};
