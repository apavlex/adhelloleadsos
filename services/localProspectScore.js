/**
 * Local Client Prospector–style qualification (ported from Codex SKILL.md rubric).
 * Classifies website presence (no site / social-only / weak / has site) and tiers: Hot, Warm, Low, Skip.
 *
 * Profile-aware via options.roiProfile / options.workspace:
 * - agency_gap (default): no site + contact = Hot (website-selling offer)
 * - partner_fit: real site + reviews / referral signals = Hot (flooring & local partners)
 */

const { resolveRoiProfileFromOptions, ROI_PROFILES } = require('./workspaceRoiProfile');

const SOCIAL_ONLY_HOSTS = [
  'facebook.com',
  'm.facebook.com',
  'fb.com',
  'instagram.com',
  'instagr.am',
  'linktr.ee',
  'linktree.com',
  'wa.me',
  'api.whatsapp.com',
  't.me',
  'tiktok.com',
  'youtube.com',
  'youtu.be',
];

const LINK_IN_BIO_HOSTS = [
  'bio.site',
  'campsite.bio',
  'stan.store',
  'beacons.ai',
  'carrd.co',
  'taplink.cc',
  'lnk.bio',
  'withkoji.com',
];

/** Booking / marketplace as primary “website” → Warm in skill rubric */
const BOOKING_MARKETPLACE_HOSTS = [
  'booksy.com',
  'fresha.com',
  'mindbodyonline.com',
  'clients.us',
  'squareup.com',
  'square.site',
  'fareharbor.com',
  'zenoti.com',
  'vagaro.com',
  'schedulicity.com',
  'acuityscheduling.com',
  'appointy.com',
  'simplybook.me',
  'setmore.com',
  'opentable.com',
  'resy.com',
  'toasttab.com',
  'order.online',
];

function hasSocial(val) {
  return !!(val && String(val).trim() && String(val).trim() !== 'N/A');
}

function safeHostname(raw) {
  const s = String(raw || '').trim();
  if (!s || s === 'N/A') return '';
  try {
    const u = new URL(s.includes('://') ? s : `https://${s}`);
    return u.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

function hostMatchesList(hostname, list) {
  const h = String(hostname || '').toLowerCase();
  if (!h) return false;
  return list.some((entry) => h === entry || h.endsWith(`.${entry}`));
}

function isGoogleMapsUrl(u) {
  const s = String(u || '').toLowerCase();
  return s.includes('google.com/maps') || s.includes('maps.app.goo.gl') || s.includes('goo.gl/maps');
}

function hasContact(lead) {
  const phone = lead.phone && String(lead.phone).trim() && lead.phone !== 'N/A';
  const email = lead.email && String(lead.email).trim() && lead.email !== 'N/A';
  return !!(phone || email);
}

function hasAuditSignals(lead) {
  return (
    lead.isOutdated !== undefined ||
    lead.isMobileFriendly !== undefined ||
    lead.hasSchemaMarkup !== undefined ||
    lead.hasChatbot !== undefined ||
    (lead.aeoScore !== undefined && lead.aeoScore !== '') ||
    lead.auditData != null ||
    (lead.aiWebsiteAnalysis && typeof lead.aiWebsiteAnalysis === 'object')
  );
}

function boolGapTrue(lead, key) {
  const v = lead[key];
  return v === false || v === 'false';
}

/**
 * @param {object} lead
 * @returns {{ skip: boolean, reason?: string }}
 */
function shouldSkipProspect(lead) {
  const title = String(lead.title || '').trim();
  if (!title || title === 'N/A') {
    return { skip: true, reason: 'Missing business name' };
  }

  const biz = String(lead.businessStatus || lead.placeStatus || lead.mapsBusinessStatus || '').toLowerCase();
  if (biz.includes('permanently closed') || biz.includes('permanent_closed') || biz.includes('closed permanently')) {
    return { skip: true, reason: 'Business appears closed' };
  }

  return { skip: false };
}

/**
 * @returns {{ status: string, label: string }}
 */
function classifyWebsiteStatus(lead) {
  const rawSite = String(lead.website || '').trim();
  const mapsUrl = String(lead.url || '').trim();

  const siteHost = safeHostname(rawSite && rawSite !== 'N/A' ? rawSite : '');
  const hasWebsiteField = !!(rawSite && rawSite !== 'N/A');

  if (hasWebsiteField) {
    if (hostMatchesList(siteHost, SOCIAL_ONLY_HOSTS) || hostMatchesList(siteHost, LINK_IN_BIO_HOSTS)) {
      return { status: 'social_only', label: 'Social only' };
    }
    if (hostMatchesList(siteHost, BOOKING_MARKETPLACE_HOSTS)) {
      return { status: 'marketplace', label: 'Marketplace / booking primary' };
    }
  } else {
    if (hasSocial(lead.facebook) || hasSocial(lead.instagram) || hasSocial(lead.twitter)) {
      return { status: 'social_only', label: 'Social only' };
    }
    if (mapsUrl && isGoogleMapsUrl(mapsUrl)) {
      return { status: 'no_site', label: 'No site found' };
    }
    return { status: 'no_site', label: 'No site found' };
  }

  if (hasWebsiteField && siteHost) {
    const outdated = lead.isOutdated === true || lead.isOutdated === 'true';
    const badMobile = boolGapTrue(lead, 'isMobileFriendly');
    const thinSignals =
      boolGapTrue(lead, 'hasSchemaMarkup') ||
      boolGapTrue(lead, 'hasChatbot') ||
      boolGapTrue(lead, 'hasClickToCall');

    if (outdated || badMobile || (hasAuditSignals(lead) && thinSignals)) {
      return { status: 'weak_site', label: 'Weak site' };
    }

    if (!hasAuditSignals(lead)) {
      return { status: 'has_site', label: 'Has site' };
    }

    return { status: 'has_site', label: 'Has site' };
  }

  return { status: 'no_site', label: 'No site found' };
}

/**
 * @param {object} lead
 * @param {string} websiteStatus
 * @returns {'High'|'Medium'|'Low'}
 */
function classifyConfidence(lead, websiteStatus) {
  const contact = hasContact(lead);
  const audit = hasAuditSignals(lead);
  if (audit && contact) return 'High';
  if (contact || audit) return 'Medium';
  if (websiteStatus === 'no_site' || websiteStatus === 'social_only') return 'Medium';
  return 'Low';
}

function reviewCount(lead) {
  return parseInt(lead && (lead.reviewsCount != null ? lead.reviewsCount : lead.reviews), 10) || 0;
}

function ratingValue(lead) {
  return parseFloat(lead && (lead.totalScore != null ? lead.totalScore : lead.rating)) || 0;
}

function isActiveReferralPartner(lead) {
  const rp = lead && lead.referralPartner && typeof lead.referralPartner === 'object' ? lead.referralPartner : null;
  if (!rp) return false;
  if (rp.highlighted === true) return true;
  const status = String(rp.status || '').trim().toLowerCase();
  if (status === 'connected' || status === 'intro_sent') return true;
  const sent = parseInt(rp.sent, 10) || 0;
  const received = parseInt(rp.received, 10) || 0;
  return sent > 0 || received > 0;
}

/**
 * Partner / referral ROI: prefer high review volume + recent review activity.
 */
function scorePartnerFitProspect(lead, websiteStatus) {
  const contact = hasContact(lead);
  const reviews = reviewCount(lead);
  const rating = ratingValue(lead);
  const referral = isActiveReferralPartner(lead);
  const last30 = parseInt(lead && lead.reviewsLast30Days, 10) || 0;
  const lastAtMs = lead && lead.lastReviewAt ? Date.parse(lead.lastReviewAt) : NaN;
  const recent =
    last30 > 0 || (Number.isFinite(lastAtMs) && Date.now() - lastAtMs < 90 * 86400000);
  const reasons = [];
  let prospectTier = 'Low';

  if (!contact) {
    prospectTier = 'Low';
    reasons.push('Add phone or email before outreach');
  } else if (websiteStatus === 'has_site') {
    if (referral || (reviews >= 25 && recent) || reviews >= 50 || (reviews >= 15 && rating >= 4.4)) {
      prospectTier = 'Hot';
      if (referral) reasons.push('Active referral partner — prioritize relationship');
      else if (last30 >= 2) {
        reasons.push(`High + fresh reviews (${reviews} total, ${last30} last 30 days)`);
      } else if (reviews >= 50) {
        reasons.push(`High review count (${reviews}) — top local partner signal`);
      } else if (recent) {
        reasons.push(`Strong reviews with recent activity (${reviews})`);
      } else {
        reasons.push(`High reviews (${reviews}) — cultivate as referral partner`);
      }
    } else if (reviews >= 10 || rating >= 4.3) {
      prospectTier = 'Warm';
      reasons.push(
        recent
          ? 'Solid reviews with recent activity — good partner candidate'
          : 'Has reviews — good partner / referral candidate',
      );
    } else {
      prospectTier = 'Warm';
      reasons.push('Has a real website — good partner / referral candidate');
    }
  } else if (websiteStatus === 'weak_site') {
    prospectTier = reviews >= 15 || (reviews >= 5 && recent) || rating >= 4.0 ? 'Warm' : 'Low';
    reasons.push(
      prospectTier === 'Warm'
        ? 'Listed site with review traction — still contactable locally'
        : 'Thin web presence — lower partner priority',
    );
  } else if (websiteStatus === 'marketplace') {
    prospectTier = reviews >= 20 ? 'Warm' : 'Low';
    reasons.push(
      prospectTier === 'Warm'
        ? 'Marketplace listing with reviews — reachable partner'
        : 'Marketplace listing — prefer partners with owned sites + reviews',
    );
  } else if (websiteStatus === 'social_only' || websiteStatus === 'no_site') {
    prospectTier = 'Low';
    reasons.push(
      websiteStatus === 'no_site'
        ? 'No website — weak referral-partner signal for this workspace'
        : 'Social-only — prefer locals with a real site and reviews',
    );
  }

  return { prospectTier, reasons };
}

/**
 * Agency gap ROI (AdHello): no site / social-only + contact = Hot.
 */
function scoreAgencyGapProspect(lead, websiteStatus) {
  const contact = hasContact(lead);
  const reasons = [];
  let prospectTier = 'Low';

  if (websiteStatus === 'no_site' || websiteStatus === 'social_only') {
    if (contact) {
      prospectTier = 'Hot';
      reasons.push(
        websiteStatus === 'no_site'
          ? 'No standalone website — strong owned-site hook'
          : 'Social / link-in-bio only — needs credible standalone site',
      );
    } else {
      prospectTier = 'Low';
      reasons.push('No or thin standalone web presence — add phone/email before strong outbound');
    }
  } else if (websiteStatus === 'weak_site' || websiteStatus === 'marketplace') {
    prospectTier = 'Warm';
    reasons.push(
      websiteStatus === 'marketplace'
        ? 'Booking or marketplace-first — pitch owned funnel + site'
        : 'Standalone site with visible UX / SEO gaps',
    );
  } else if (websiteStatus === 'has_site') {
    prospectTier = 'Low';
    reasons.push('Credible site — pitch specific gaps or nurture');
  }

  return { prospectTier, reasons };
}

/**
 * @param {object} lead — saved or enriched Maps row
 * @param {{ roiProfile?: string, workspace?: object }} [options]
 * @returns {{
 *   prospectTier: 'Hot'|'Warm'|'Low'|'Skip',
 *   websiteStatus: string,
 *   websiteStatusLabel: string,
 *   confidence: 'High'|'Medium'|'Low',
 *   reasons: string[],
 *   why: string,
 *   roiProfile: string
 * }}
 */
function scoreLocalProspect(lead, options) {
  const roiProfile = resolveRoiProfileFromOptions(options);
  const skipMeta = shouldSkipProspect(lead);
  if (skipMeta.skip) {
    return {
      prospectTier: 'Skip',
      websiteStatus: 'skip',
      websiteStatusLabel: 'Skip',
      confidence: 'Low',
      reasons: [skipMeta.reason],
      why: skipMeta.reason,
      roiProfile,
    };
  }

  const ws = classifyWebsiteStatus(lead);
  const conf = classifyConfidence(lead, ws.status);
  const tiered =
    roiProfile === ROI_PROFILES.PARTNER_FIT
      ? scorePartnerFitProspect(lead, ws.status)
      : scoreAgencyGapProspect(lead, ws.status);

  const why = tiered.reasons[0] || '';

  return {
    prospectTier: tiered.prospectTier,
    websiteStatus: ws.status,
    websiteStatusLabel: ws.label,
    confidence: conf,
    reasons: tiered.reasons.slice(0, 5),
    why,
    roiProfile,
  };
}

function prospectTierSortRank(prospectTier) {
  if (prospectTier === 'Hot') return 0;
  if (prospectTier === 'Warm') return 1;
  if (prospectTier === 'Low') return 2;
  return 3;
}

module.exports = {
  scoreLocalProspect,
  prospectTierSortRank,
  classifyWebsiteStatus,
  shouldSkipProspect,
};
