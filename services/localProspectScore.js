/**
 * Local Client Prospector–style qualification (ported from Codex SKILL.md rubric).
 * Classifies website presence (no site / social-only / weak / has site) and tiers: Hot, Warm, Low, Skip.
 */

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

/**
 * @param {object} lead — saved or enriched Maps row
 * @returns {{
 *   prospectTier: 'Hot'|'Warm'|'Low'|'Skip',
 *   websiteStatus: string,
 *   websiteStatusLabel: string,
 *   confidence: 'High'|'Medium'|'Low',
 *   reasons: string[],
 *   why: string
 * }}
 */
function scoreLocalProspect(lead) {
  const skipMeta = shouldSkipProspect(lead);
  if (skipMeta.skip) {
    return {
      prospectTier: 'Skip',
      websiteStatus: 'skip',
      websiteStatusLabel: 'Skip',
      confidence: 'Low',
      reasons: [skipMeta.reason],
      why: skipMeta.reason,
    };
  }

  const ws = classifyWebsiteStatus(lead);
  const conf = classifyConfidence(lead, ws.status);
  const contact = hasContact(lead);
  const reasons = [];
  let prospectTier = 'Low';

  if (ws.status === 'no_site' || ws.status === 'social_only') {
    if (contact) {
      prospectTier = 'Hot';
      reasons.push(
        ws.status === 'no_site'
          ? 'No standalone website — strong owned-site hook'
          : 'Social / link-in-bio only — needs credible standalone site',
      );
    } else {
      prospectTier = 'Low';
      reasons.push('No or thin standalone web presence — add phone/email before strong outbound');
    }
  } else if (ws.status === 'weak_site' || ws.status === 'marketplace') {
    prospectTier = 'Warm';
    reasons.push(
      ws.status === 'marketplace'
        ? 'Booking or marketplace-first — pitch owned funnel + site'
        : 'Standalone site with visible UX / SEO gaps',
    );
  } else if (ws.status === 'has_site') {
    prospectTier = 'Low';
    reasons.push('Credible site — pitch specific gaps or nurture');
  }

  const why = reasons[0] || '';

  return {
    prospectTier,
    websiteStatus: ws.status,
    websiteStatusLabel: ws.label,
    confidence: conf,
    reasons: reasons.slice(0, 5),
    why,
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
