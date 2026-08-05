/**
 * Omnichannel Lead Labeling Service
 * 
 * Analyzes a lead's enrichment data and returns:
 * - labels: array of signal tags (e.g. ["website_missing", "review_weak"])
 * - channels: ranked list of recommended outreach channels
 * - next_channel: single best next step
 * 
 * Channel scoring logic:
 * - Direct call: phone available, no email/website
 * - Cold email: email available, weak website/socials
 * - Direct mail: no website, physical address available
 * - Social outreach: social profiles active, email weak
 * - SMS: phone available as secondary channel (skipped for landline)
 */

const phoneLineType = require('./phoneLineType');

const CHANNEL_SCORES = {
  'cold_call': {
    label: 'Cold Call',
    icon: '📞',
    color: 'blue',
    description: 'Phone available, direct contact',
  },
  'cold_email': {
    label: 'Cold Email',
    icon: '✉️',
    color: 'yellow',
    description: 'Email available, warm pitch',
  },
  'direct_mail': {
    label: 'Direct Mail',
    icon: '📬',
    color: 'purple',
    description: 'QR postcard to physical address',
  },
  'social_outreach': {
    label: 'Social',
    icon: '💬',
    color: 'pink',
    description: 'DM via social platform',
  },
  'sms': {
    label: 'SMS',
    icon: '💬',
    color: 'green',
    description: 'Text message follow-up',
  },
};

const LABEL_DEFINITIONS = {
  website_missing: {
    label: 'No Website',
    color: 'red',
    description: 'No website URL found in GBP or enrichment',
  },
  social_inactive: {
    label: 'Inactive Socials',
    color: 'orange',
    description: 'Social profiles exist but stale or absent',
  },
  email_unverified: {
    label: 'No Email',
    color: 'gray',
    description: 'No email address found',
  },
  phone_direct: {
    label: 'Phone Available',
    color: 'green',
    description: 'Direct phone number found',
  },
  review_weak: {
    label: 'Weak Reviews',
    color: 'amber',
    description: 'Low review count or rating',
  },
  no_current_ads: {
    label: 'No Active Ads',
    color: 'blue',
    description: 'No Google Ads detected',
  },
  high_value: {
    label: 'High Value',
    color: 'emerald',
    description: 'Strong GBP + reviews, likely spender',
  },
};

/**
 * Analyze a lead and return labels + channel suggestions
 * @param {Object} lead - Lead data (from DB or enrichment)
 * @returns {Object} { labels, channels, next_channel, reasons }
 */
function analyzeLead(lead) {
  const labels = [];
  const channels = [];
  const reasons = [];

  const website = (lead.website || lead.domainNorm || '').trim();
  const email = (lead.email || lead.emailNorm || '').trim();
  const phone = (lead.phone || lead.phoneNorm || '').trim();
  const facebook = (lead.facebook || '').trim();
  const instagram = (lead.instagram || lead.instagram_url || '').trim();
  const reviewsCount = parseInt(lead.reviewsCount || lead.review_count || 0, 10);
  const rating = parseFloat(lead.totalScore || lead.rating || 0);
  const city = (lead.city || '').trim();
  const state = (lead.state || '').trim();
  const address = (lead.address || '').trim();

  // ── Detect labels ──

  // Website missing
  if (!website || website === 'N/A' || website === '') {
    labels.push('website_missing');
    reasons.push('No website found');
  }

  // Email unverified
  if (!email || email === 'N/A' || email === '') {
    labels.push('email_unverified');
    reasons.push('No email found');
  }

  // Phone direct
  if (phone && phone !== 'N/A') {
    labels.push('phone_direct');
    reasons.push('Phone number available');
  }

  // Social inactive (has social field but likely stale, or no social at all)
  const hasSocial = (facebook && facebook !== 'N/A') || (instagram && instagram !== 'N/A');
  if (!hasSocial) {
    labels.push('social_inactive');
    reasons.push('No social profiles found');
  }

  // Review weak
  if ((reviewsCount > 0 && reviewsCount < 10) || (rating > 0 && rating < 3.5)) {
    labels.push('review_weak');
    reasons.push(`Weak reviews: ${reviewsCount} reviews, ${rating} rating`);
  } else if (reviewsCount === 0) {
    labels.push('review_weak');
    reasons.push('No reviews found');
  }

  // No current ads (we can't always detect this, but if no website, likely no ads)
  if (!website || website === 'N/A') {
    labels.push('no_current_ads');
    reasons.push('No website → likely no ad tracking');
  }

  // High value
  if (reviewsCount >= 20 && rating >= 4.0 && hasSocial) {
    labels.push('high_value');
    reasons.push('Strong online presence');
  }

  // ── Score channels ──

  const channelScores = {};

  // Cold Call: best when phone available + no email/website
  if (phone && phone !== 'N/A') {
    channelScores.cold_call = 80;
    if (!website) channelScores.cold_call += 15;
    if (!email) channelScores.cold_call += 10;
  }

  // Cold Email: best when email available
  if (email && email !== 'N/A') {
    channelScores.cold_email = 70;
    if (website) channelScores.cold_email -= 10; // they have a site, less urgent
    if (labels.includes('social_inactive')) channelScores.cold_email += 10;
  }

  // Direct Mail: best when no website + physical address
  if ((!website || website === 'N/A') && (address || (city && state))) {
    channelScores.direct_mail = 60;
    if (phone) channelScores.direct_mail -= 10; // prefer call over mail
    if (email) channelScores.direct_mail -= 5;
  }

  // Social Outreach: best when social profiles exist
  if (hasSocial) {
    channelScores.social_outreach = 50;
    if (!email) channelScores.social_outreach += 15;
  }

  // SMS: secondary channel when phone available (not for landline)
  if (phone && phone !== 'N/A') {
    const lineType = phoneLineType.normalizeLineType(lead.phoneLineType);
    if (lineType === 'landline') {
      channelScores.cold_call = (channelScores.cold_call || 50) + 25;
    } else if (lineType === 'unknown') {
      channelScores.cold_call = (channelScores.cold_call || 50) + 15;
    }
    if (lineType !== 'landline') {
      if (channelScores.cold_call) {
        channelScores.sms = Math.max(channelScores.cold_call - 20, 30);
      } else {
        channelScores.sms = 40;
      }
    }
  }

  // Sort and rank channels
  const rankedChannels = Object.entries(channelScores)
    .sort((a, b) => b[1] - a[1])
    .map(([key, score]) => ({
      channel: key,
      score,
      ...CHANNEL_SCORES[key],
    }));

  const next_channel = rankedChannels.length > 0 ? rankedChannels[0].channel : 'cold_call';

  return {
    labels,
    labelDetails: labels.map(l => ({ key: l, ...LABEL_DEFINITIONS[l] })),
    channels: rankedChannels,
    next_channel,
    next_channel_detail: CHANNEL_SCORES[next_channel] || CHANNEL_SCORES.cold_call,
    reasons,
  };
}

/**
 * Enrich lead data with omnichannel labels before saving
 * Leads should have: website, email, phone, facebook, instagram, reviewsCount, totalScore, city, state, address
 */
function enrichWithLabels(lead) {
  const analysis = analyzeLead(lead);

  return {
    ...lead,
    ...(analysis.labels.length > 0 ? { labels: analysis.labels } : {}),
    ...(analysis.next_channel ? { next_channel: analysis.next_channel } : {}),
    _channel_analysis: analysis,
  };
}

module.exports = {
  analyzeLead,
  enrichWithLabels,
  CHANNEL_SCORES,
  LABEL_DEFINITIONS,
};
