/**
 * Referral partners are saved business leads the workspace wants to trade
 * introductions with. Status lives on the lead as `referralPartner`.
 */

const { noteEntryBody } = require('./leadNotes');

const STATUSES = new Set(['connected', 'intro_sent']);
const ACTIONS = new Set(['connect', 'intro', 'highlight', 'clear', 'sent', 'received', 'note', 'ghl']);
const EVENT_LABELS = {
  connected: 'Connected',
  intro: 'Intro sent',
  sent: 'Lead sent',
  received: 'Lead received',
  note: 'Note',
  ghl: 'Synced to GHL',
};

function usableText(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text || /^n\/?a$/i.test(text) || text === '—' || text === '-') return '';
  return text;
}

function cleanEvents(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(-12).map((event) => {
    if (!event || typeof event !== 'object') return null;
    const type = String(event.type || '').trim();
    if (!EVENT_LABELS[type]) return null;
    return {
      type,
      at: String(event.at || ''),
      text: String(event.text || '').trim().slice(0, 180),
    };
  }).filter(Boolean);
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
    lastSentAt: raw.lastSentAt || '',
    lastReceivedAt: raw.lastReceivedAt || '',
    lastNoteAt: raw.lastNoteAt || '',
    lastGhlAt: raw.lastGhlAt || '',
    events: cleanEvents(raw.events),
  };
}

function pushEvent(record, event) {
  record.events = cleanEvents(record.events).concat(event).slice(-12);
}

function formatWhen(value) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const date = new Date(ms);
  const now = new Date();
  const day = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
  let hour = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const suffix = hour >= 12 ? 'p' : 'a';
  hour = hour % 12 || 12;
  return `${day}, ${hour}:${minutes}${suffix}`;
}

function latestLeadNote(lead) {
  const rows = []
    .concat(Array.isArray(lead && lead.updates) ? lead.updates : [])
    .concat(Array.isArray(lead && lead.logs) ? lead.logs : []);
  let best = null;
  rows.forEach((entry) => {
    if (!entry || String(entry.type || '') !== 'note') return;
    const text = noteEntryBody(entry);
    if (!text) return;
    const at = Date.parse(entry.timestamp || entry.ts || entry.createdAt);
    const ms = Number.isFinite(at) ? at : 0;
    if (!best || ms >= best.at) best = { at: ms, text };
  });
  return best;
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

function whenOrEmpty(value) {
  return formatWhen(value);
}

function tagKeys(lead) {
  const raw = lead && lead.tags;
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 40);
}

function toCard(lead) {
  const partner = partnerRecord(lead);
  const rating = ratingValue(lead);
  const leadNote = latestLeadNote(lead);
  const eventNote = partner.events.slice().reverse().find((event) => event.type === 'note' && event.text);
  const noteMs = leadNote ? leadNote.at : 0;
  const eventMs = eventNote ? Date.parse(eventNote.at) || 0 : 0;
  const note = noteMs >= eventMs
    ? (leadNote ? leadNote.text : '')
    : (eventNote ? eventNote.text : '');
  const ghlAt = lead && lead.ghlSyncedAt ? lead.ghlSyncedAt : partner.lastGhlAt;
  return {
    key: String(lead.key || ''),
    title: usableText(lead.title) || 'Untitled',
    category: usableText(lead.categoryName),
    city: usableText(lead.city),
    state: usableText(lead.state),
    phone: usableText(lead && lead.phone),
    email: usableText(lead && lead.email),
    instagram: usableText(lead && (lead.instagram || lead.instagram_url)),
    facebook: usableText(lead && (lead.facebook || lead.facebook_url)),
    tagKeys: tagKeys(lead),
    website: hasWebsite(lead),
    rating: rating ? rating.toFixed(1) : '',
    reviews: reviewCount(lead),
    status: partner.status,
    highlighted: partner.highlighted,
    sent: partner.sent,
    received: partner.received,
    connectedWhen: whenOrEmpty(partner.connectedAt),
    introWhen: whenOrEmpty(partner.introSentAt),
    sentWhen: whenOrEmpty(partner.lastSentAt),
    receivedWhen: whenOrEmpty(partner.lastReceivedAt),
    ghlWhen: whenOrEmpty(ghlAt),
    note: String(note || '').replace(/\s+/g, ' ').trim().slice(0, 180),
    activity: partner.events.slice(-4).reverse().map((event) => ({
      label: EVENT_LABELS[event.type] || 'Update',
      when: whenOrEmpty(event.at),
      text: event.text,
    })),
  };
}

function lastActivityMs(lead) {
  const partner = partnerRecord(lead);
  const times = [
    partner.connectedAt,
    partner.introSentAt,
    partner.lastSentAt,
    partner.lastReceivedAt,
    partner.lastNoteAt,
    partner.lastGhlAt,
  ].map((value) => Date.parse(value)).filter((ms) => Number.isFinite(ms) && ms > 0);
  return times.length ? Math.max(...times) : 0;
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
    if (!q) {
      const recent = lastActivityMs(b) - lastActivityMs(a);
      if (recent) return recent;
    } else {
      const score = partnerScore(b) - partnerScore(a);
      if (score) return score;
    }
    return String(a.title || '').localeCompare(String(b.title || ''));
  });
  return picked.slice(0, 60).map(toCard);
}

function applyPartnerAction(lead, action, now, detail) {
  const name = String(action || '').trim();
  if (!ACTIONS.has(name)) return { ok: false, error: 'Unknown action.' };
  const next = partnerRecord(lead);
  const stamp = now || new Date().toISOString();
  if (name === 'connect') {
    next.highlighted = true;
    next.status = 'connected';
    next.connectedAt = stamp;
    pushEvent(next, { type: 'connected', at: stamp });
  } else if (name === 'intro') {
    next.highlighted = true;
    next.status = 'intro_sent';
    next.introSentAt = stamp;
    pushEvent(next, { type: 'intro', at: stamp });
  } else if (name === 'highlight') {
    next.highlighted = true;
  } else if (name === 'clear') {
    next.highlighted = false;
    next.status = '';
  } else if (name === 'sent') {
    next.highlighted = true;
    next.sent += 1;
    next.lastSentAt = stamp;
    pushEvent(next, { type: 'sent', at: stamp });
  } else if (name === 'received') {
    next.highlighted = true;
    next.received += 1;
    next.lastReceivedAt = stamp;
    pushEvent(next, { type: 'received', at: stamp });
  } else if (name === 'note') {
    const text = String(detail || '').trim().slice(0, 500);
    if (!text) return { ok: false, error: 'Write a note first.' };
    next.highlighted = true;
    next.lastNoteAt = stamp;
    pushEvent(next, { type: 'note', at: stamp, text });
  } else if (name === 'ghl') {
    next.highlighted = true;
    next.lastGhlAt = stamp;
    pushEvent(next, { type: 'ghl', at: stamp });
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
