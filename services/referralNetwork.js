/**
 * Referral partners are saved business leads the workspace wants to trade
 * introductions with. Status lives on the lead as `referralPartner`.
 */

const STATUSES = new Set(['connected', 'intro_sent']);
const ACTIONS = new Set(['connect', 'intro', 'highlight', 'clear', 'sent', 'received']);

function usableText(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text || /^n\/?a$/i.test(text) || text === '—' || text === '-') return '';
  return text;
}

function partnerRecord(lead) {
  const raw = lead && lead.referralPartner && typeof lead.referralPartner === 'object'
    ? lead.referralPartner
    : {};
  const status = STATUSES.has(raw.status) ? raw.status : '';
  const sent = Math.max(0, parseInt(raw.sent, 10) || 0);
  const received = Math.max(0, parseInt(raw.received, 10) || 0);
  const highlighted = raw.highlighted === false
    ? false
    : raw.highlighted === true || !!status || sent > 0 || received > 0;
  return {
    highlighted,
    status,
    sent,
    received,
    connectedAt: raw.connectedAt || '',
    introSentAt: raw.introSentAt || '',
  };
}

function hasWebsite(lead) {
  return !!usableText(lead && lead.website);
}

function reviewCount(lead) {
  const n = parseInt(lead && lead.reviewsCount, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function ratingValue(lead) {
  const n = parseFloat(lead && lead.totalScore);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Reviews, rating, and a real website — the same order the finder advertises. */
function partnerScore(lead) {
  return reviewCount(lead) + ratingValue(lead) * 40 + (hasWebsite(lead) ? 80 : 0);
}

function haystack(lead) {
  const tags = Array.isArray(lead && lead.tags) ? lead.tags : [];
  return [
    lead && lead.title,
    lead && lead.categoryName,
    lead && lead.city,
    lead && lead.state,
    ...tags,
  ]
    .map((part) => String(part || '').toLowerCase())
    .join(' ');
}

function queryTokens(query) {
  return String(query || '')
    .toLowerCase()
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function matchesQuery(lead, query) {
  const tokens = queryTokens(query);
  if (!tokens.length) return false;
  const hay = haystack(lead);
  return tokens.some((token) => hay.includes(token));
}

function toCard(lead) {
  const partner = partnerRecord(lead);
  const rating = ratingValue(lead);
  return {
    key: String(lead.key || ''),
    title: usableText(lead.title) || 'Untitled',
    category: usableText(lead.categoryName),
    city: usableText(lead.city),
    state: usableText(lead.state),
    website: hasWebsite(lead),
    rating: rating ? rating.toFixed(1) : '',
    reviews: reviewCount(lead),
    status: partner.status,
    highlighted: partner.highlighted,
    sent: partner.sent,
    received: partner.received,
  };
}

/**
 * With a search, return matching saved businesses, best prospects first.
 * With no search, return the highlighted network.
 */
function listPartners(leads, query) {
  const rows = (Array.isArray(leads) ? leads : []).filter((lead) => lead && usableText(lead.title) && lead.key);
  const q = String(query || '').trim();
  const picked = q
    ? rows.filter((lead) => matchesQuery(lead, q))
    : rows.filter((lead) => partnerRecord(lead).highlighted);
  picked.sort((a, b) => {
    const score = partnerScore(b) - partnerScore(a);
    if (score) return score;
    return String(a.title || '').localeCompare(String(b.title || ''));
  });
  return picked.slice(0, 40).map(toCard);
}

function applyPartnerAction(lead, action, now) {
  const name = String(action || '').trim();
  if (!ACTIONS.has(name)) return { ok: false, error: 'Unknown action.' };
  const next = partnerRecord(lead);
  const stamp = now || new Date().toISOString();
  if (name === 'connect') {
    next.highlighted = true;
    next.status = 'connected';
    next.connectedAt = stamp;
  } else if (name === 'intro') {
    next.highlighted = true;
    next.status = 'intro_sent';
    next.introSentAt = stamp;
  } else if (name === 'highlight') {
    next.highlighted = true;
  } else if (name === 'clear') {
    next.highlighted = false;
    next.status = '';
  } else if (name === 'sent') {
    next.highlighted = true;
    next.sent += 1;
  } else if (name === 'received') {
    next.highlighted = true;
    next.received += 1;
  }
  return { ok: true, referralPartner: next };
}

function networkTotals(leads) {
  const rows = (Array.isArray(leads) ? leads : []).map(partnerRecord).filter((row) => row.highlighted);
  return {
    partners: rows.length,
    connected: rows.filter((row) => row.status === 'connected').length,
    intros: rows.filter((row) => row.status === 'intro_sent').length,
    sent: rows.reduce((sum, row) => sum + row.sent, 0),
    received: rows.reduce((sum, row) => sum + row.received, 0),
  };
}

module.exports = {
  partnerRecord,
  partnerScore,
  matchesQuery,
  listPartners,
  applyPartnerAction,
  networkTotals,
};
