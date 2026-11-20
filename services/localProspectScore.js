/**
 * Local Client Prospector–style qualification (ported from Codex SKILL.md rubric).
 * Classifies website presence (no site / social-only / weak / has site) and tiers: Hot, Warm, Low, Skip.
 *
 * Profile-aware via options.roiProfile / options.workspace:
 * - agency_gap (default): no site + contact = Hot (website-selling offer)
 * - partner_fit: real site + reviews / referral signals = Hot (flooring & local partners)
 * - license_renewal: soon-expiring / expired license or insurance = Hot
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
 * Parse YYYY-MM-DD, ISO, or Oregon CCB-style MM/DD/YYYY into epoch ms (noon UTC).
 */
function parseFlexibleDateMs(raw) {
  const s = String(raw || '').trim();
  if (!s || s === 'N/A') return NaN;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return Date.parse(`${s.slice(0, 10)}T12:00:00.000Z`);
  }
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdy) {
    const mm = mdy[1].padStart(2, '0');
    const dd = mdy[2].padStart(2, '0');
    return Date.parse(`${mdy[3]}-${mm}-${dd}T12:00:00.000Z`);
  }
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : NaN;
}

/** CCB / contractor license expiry fields (WA L&I + Oregon CCB lic_exp_date). */
function ccbExpiryRawCandidates(lead) {
  if (!lead || typeof lead !== 'object') return [];
  return [
    lead.contractorLicenseExpires,
    lead.ccbExpires,
    lead.ccb_expires,
    lead.licenseExpires,
    lead.license_expires,
    lead.licenseExpirationDate,
    lead.licenseexpirationdate,
    lead.lic_exp_date,
  ];
}

/** COI / liability insurance expiry (Oregon CCB ins_exp_date + CRM aliases). */
function coiExpiryRawCandidates(lead) {
  if (!lead || typeof lead !== 'object') return [];
  return [
    lead.contractorCoiExpires,
    lead.contractorInsuranceExpires,
    lead.coiExpires,
    lead.coi_expires,
    lead.insuranceExpires,
    lead.insurance_expires,
    lead.ins_exp_date,
    lead.insExpDate,
    lead.policyExpires,
    lead.policy_expires,
  ];
}

function firstParsedExpiry(candidates) {
  for (const raw of candidates) {
    const ms = parseFlexibleDateMs(raw);
    if (Number.isFinite(ms)) return ms;
  }
  return NaN;
}

/**
 * HomeElk / contractor renewals: soonest of CCB license vs COI.
 * @returns {{ days: number|null, kind: 'ccb'|'coi'|null, ms: number, ccbDays: number|null, coiDays: number|null }}
 */
function resolveComplianceExpiry(lead, nowMs = Date.now()) {
  const ccbMs = firstParsedExpiry(ccbExpiryRawCandidates(lead));
  const coiMs = firstParsedExpiry(coiExpiryRawCandidates(lead));
  const ccbDays = Number.isFinite(ccbMs) ? Math.floor((ccbMs - nowMs) / 86400000) : null;
  const coiDays = Number.isFinite(coiMs) ? Math.floor((coiMs - nowMs) / 86400000) : null;

  if (ccbDays == null && coiDays == null) {
    return { days: null, kind: null, ms: NaN, ccbDays: null, coiDays: null };
  }
  if (ccbDays == null) {
    return { days: coiDays, kind: 'coi', ms: coiMs, ccbDays: null, coiDays };
  }
  if (coiDays == null) {
    return { days: ccbDays, kind: 'ccb', ms: ccbMs, ccbDays, coiDays: null };
  }
  if (coiDays < ccbDays) {
    return { days: coiDays, kind: 'coi', ms: coiMs, ccbDays, coiDays };
  }
  return { days: ccbDays, kind: 'ccb', ms: ccbMs, ccbDays, coiDays };
}

/** @deprecated Prefer resolveComplianceExpiry — kept for opportunityScore callers. */
function parseLicenseExpiryMs(lead) {
  const resolved = resolveComplianceExpiry(lead);
  return Number.isFinite(resolved.ms) ? resolved.ms : NaN;
}

function hasLicenseNumber(lead) {
  const n = String(
    (lead && (lead.contractorLicenseNumber || lead.licenseNumber || lead.license_number)) || '',
  ).trim();
  return !!(n && n !== 'N/A');
}

/**
 * Days until soonest CCB/COI expiry (negative = already expired). Null when unknown.
 */
function daysUntilLicenseExpiry(lead, nowMs = Date.now()) {
  return resolveComplianceExpiry(lead, nowMs).days;
}

function kindLabel(kind) {
  if (kind === 'coi') return 'COI';
  if (kind === 'ccb') return 'CCB';
  return 'License';
}

function formatLicenseStatusLabel(days, kind = null) {
  const who = kindLabel(kind);
  if (days == null || !Number.isFinite(days)) return 'No CCB/COI expiry on file';
  if (days < 0) {
    const ago = Math.abs(days);
    if (ago === 0) return `${who} expired today`;
    if (ago === 1) return `${who} expired yesterday`;
    if (ago < 60) return `${who} expired ${ago}d ago`;
    return `${who} expired`;
  }
  if (days === 0) return `${who} expires today`;
  if (days === 1) return `${who} expires tomorrow`;
  if (days <= 60) return `${who} expires in ${days}d`;
  if (days <= 180) return `${who} expires in ${Math.round(days / 30)} mo`;
  const ms = Date.now() + days * 86400000;
  try {
    return `${who} expires ${new Date(ms).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })}`;
  } catch {
    return `${who} expires in ${days}d`;
  }
}

/**
 * HomeElk / insurance / licensed trades: soonest CCB or COI expiry + contact = Hot.
 */
function scoreLicenseRenewalProspect(lead) {
  const contact = hasContact(lead);
  const resolved = resolveComplianceExpiry(lead);
  const days = resolved.days;
  const kind = resolved.kind;
  const who = kindLabel(kind);
  const reasons = [];
  let prospectTier = 'Low';
  const statusLabel = formatLicenseStatusLabel(days, kind);

  if (days == null) {
    prospectTier = contact && hasLicenseNumber(lead) ? 'Warm' : 'Low';
    reasons.push(
      hasLicenseNumber(lead)
        ? 'CCB license on file but no CCB/COI expiry — enrich from registry'
        : 'No CCB or COI expiry on file — import WA L&I / Oregon CCB or enrich',
    );
  } else if (days <= 60) {
    if (contact) {
      prospectTier = 'Hot';
      reasons.push(
        days < 0
          ? `${who} already expired — strongest renewals / compliance hook`
          : `${who} expires in ${days} day${days === 1 ? '' : 's'} — call now`,
      );
    } else {
      prospectTier = 'Low';
      reasons.push(`${who} expiry is soon — add phone or email before outreach`);
    }
  } else if (days <= 180) {
    prospectTier = contact ? 'Warm' : 'Low';
    reasons.push(
      contact
        ? `${who} renewal window in ~${Math.round(days / 30)} months — nurture now`
        : `${who} upcoming — add contact details`,
    );
  } else {
    prospectTier = 'Low';
    reasons.push(`${who} expiry is far out — lower priority for this workspace`);
  }

  return {
    prospectTier,
    reasons,
    statusLabel,
    daysUntilExpiry: days,
    expiryKind: kind,
    ccbDays: resolved.ccbDays,
    coiDays: resolved.coiDays,
  };
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
  let tiered;
  if (roiProfile === ROI_PROFILES.PARTNER_FIT) {
    tiered = scorePartnerFitProspect(lead, ws.status);
  } else if (roiProfile === ROI_PROFILES.LICENSE_RENEWAL) {
    tiered = scoreLicenseRenewalProspect(lead);
  } else {
    tiered = scoreAgencyGapProspect(lead, ws.status);
  }

  const why = tiered.reasons[0] || '';
  const websiteStatusLabel =
    roiProfile === ROI_PROFILES.LICENSE_RENEWAL && tiered.statusLabel
      ? tiered.statusLabel
      : ws.label;

  return {
    prospectTier: tiered.prospectTier,
    websiteStatus: ws.status,
    websiteStatusLabel,
    confidence: conf,
    reasons: tiered.reasons.slice(0, 5),
    why,
    roiProfile,
    daysUntilExpiry:
      roiProfile === ROI_PROFILES.LICENSE_RENEWAL && tiered.daysUntilExpiry != null
        ? tiered.daysUntilExpiry
        : null,
    expiryKind: roiProfile === ROI_PROFILES.LICENSE_RENEWAL ? tiered.expiryKind || null : null,
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
  parseFlexibleDateMs,
  parseLicenseExpiryMs,
  daysUntilLicenseExpiry,
  resolveComplianceExpiry,
  formatLicenseStatusLabel,
  scoreLicenseRenewalProspect,
};
