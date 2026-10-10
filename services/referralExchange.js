/**
 * Referral exchange rules: zones, one exclusive seat per trade per zone,
 * routing a referral to the seat holder, and the referral status flow.
 * Pure functions only — storage lives in networkStore.
 */

const STATUSES = ['unrouted', 'sent', 'accepted', 'declined', 'booked', 'won', 'lost'];
const OPEN_STATUSES = new Set(['unrouted', 'sent', 'accepted', 'booked']);

const STATUS_LABELS = {
  unrouted: 'Needs a member',
  sent: 'Sent',
  accepted: 'Accepted',
  declined: 'Declined',
  booked: 'Booked',
  won: 'Won',
  lost: 'Lost',
};

// action -> statuses it may be applied from, and the status it moves to
const TRANSITIONS = {
  accept: { from: ['sent'], to: 'accepted' },
  decline: { from: ['sent', 'accepted'], to: 'declined' },
  book: { from: ['accepted'], to: 'booked' },
  win: { from: ['accepted', 'booked'], to: 'won' },
  lose: { from: ['accepted', 'booked'], to: 'lost' },
  assign: { from: ['unrouted', 'declined', 'sent'], to: 'sent' },
  /** Member claims an unassigned pool referral (unrouted → accepted). */
  claim: { from: ['unrouted'], to: 'accepted' },
};

const ACTION_LABELS = {
  accept: 'Accept',
  decline: 'Decline',
  book: 'Booked',
  win: 'Won',
  lose: 'Lost',
  assign: 'Assign',
  claim: 'Claim',
  note: 'Note',
};

const ACTION_ERROR_VERBS = {
  accept: 'Accepting',
  decline: 'Declining',
  book: 'Marking booked',
  win: 'Marking won',
  lose: 'Marking lost',
  assign: 'Assigning',
  claim: 'Claiming',
  note: 'Adding a note',
};

function cleanText(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max || 200);
}

// ── Zones ────────────────────────────────────────────────────────────────────

function normalizeZip(value) {
  const match = String(value == null ? '' : value).match(/\b(\d{5})(?:-\d{4})?\b/);
  return match ? match[1] : '';
}

/** "Austin, TX" and "austin" both compare as "austin". */
function normalizeCity(value) {
  return String(value == null ? '' : value)
    .split(',')[0]
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** One city per line (a city may contain a comma, e.g. "Austin, TX"). */
function parseCityList(input) {
  const raw = Array.isArray(input) ? input : String(input == null ? '' : input).split(/[\n;]+/);
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const city = cleanText(item, 80);
    const key = normalizeCity(city);
    if (!city || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(city);
  }
  return out.slice(0, 100);
}

function parseZipList(input) {
  const raw = Array.isArray(input) ? input.join(' ') : String(input == null ? '' : input);
  const zips = raw.match(/\b\d{5}\b/g) || [];
  return [...new Set(zips)].slice(0, 500);
}

/** zone.seats[slug] is a list of holders; older records stored one `{ memberId, since }`. */
function normalizeSeats(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [slug, value] of Object.entries(raw)) {
    const seen = new Set();
    const holders = (Array.isArray(value) ? value : [value])
      .map((seat) => ({
        memberId: seat && typeof seat === 'object' ? String(seat.memberId || '').trim() : '',
        since: (seat && seat.since) || '',
      }))
      .filter((seat) => seat.memberId && !seen.has(seat.memberId) && seen.add(seat.memberId));
    if (slug && holders.length) out[slug] = holders;
  }
  return out;
}

/** Partners allowed per trade in each zone: 1 = exclusive seat, 0 = no limit. */
function normalizeSeatLimit(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) return 1;
  return Math.min(n, 50);
}

function normalizeZone(raw) {
  const z = raw && typeof raw === 'object' ? raw : {};
  return {
    id: String(z.id || ''),
    name: cleanText(z.name, 80) || 'Zone',
    cities: parseCityList(z.cities),
    zips: parseZipList(z.zips),
    seats: normalizeSeats(z.seats),
    createdAt: z.createdAt || '',
    updatedAt: z.updatedAt || '',
  };
}

/** ZIP match wins over a city match; returns null when nothing matches. */
function resolveZone(zones, { city, zip } = {}) {
  const list = Array.isArray(zones) ? zones : [];
  const z = normalizeZip(zip);
  if (z) {
    const byZip = list.find((zone) => Array.isArray(zone.zips) && zone.zips.includes(z));
    if (byZip) return byZip;
  }
  const c = normalizeCity(city);
  if (c) {
    const byCity = list.find((zone) => (zone.cities || []).some((name) => normalizeCity(name) === c));
    if (byCity) return byCity;
  }
  return null;
}

// ── Seats ────────────────────────────────────────────────────────────────────

function seatList(zone, tradeSlug) {
  const value = zone && zone.seats ? zone.seats[tradeSlug] : null;
  if (!value) return [];
  return (Array.isArray(value) ? value : [value]).filter((seat) => seat && seat.memberId);
}

/** Member ids holding a trade in a zone, in the order they joined. */
function seatHolders(zone, tradeSlug) {
  return seatList(zone, tradeSlug).map((seat) => seat.memberId);
}

/** First holder of a trade in a zone (the only one when seats are exclusive). */
function seatHolder(zone, tradeSlug) {
  return seatHolders(zone, tradeSlug)[0] || null;
}

/**
 * Give a member a seat for a trade in a zone. Rejects when the trade already
 * has `limit` holders (0 = no limit). Passing a null memberId clears the trade.
 */
function assignSeat(zone, tradeSlug, memberId, now, limit = 1) {
  const slug = String(tradeSlug || '').trim();
  if (!zone || !slug) return { ok: false, error: 'Pick a zone and trade.' };
  const seats = { ...(zone.seats || {}) };
  const current = seatList(zone, slug);
  const id = memberId ? String(memberId).trim() : '';
  if (!id) {
    delete seats[slug];
    return { ok: true, zone: { ...zone, seats } };
  }
  if (current.some((seat) => seat.memberId === id)) return { ok: true, zone };
  const max = normalizeSeatLimit(limit);
  if (max && current.length >= max) {
    return {
      ok: false,
      error: max === 1 ? 'That seat is already held by another member.' : `That trade already has ${max} partners in this zone.`,
      holder: current[0].memberId,
    };
  }
  seats[slug] = current.concat({ memberId: id, since: now || new Date().toISOString() });
  return { ok: true, zone: { ...zone, seats } };
}

function releaseMemberSeats(zone, memberId, keepTrades) {
  const keep = new Set(keepTrades || []);
  const seats = {};
  for (const slug of Object.keys((zone && zone.seats) || {})) {
    const holders = seatList(zone, slug).filter((seat) => seat.memberId !== memberId || keep.has(slug));
    if (holders.length) seats[slug] = holders;
  }
  return { ...zone, seats };
}

/**
 * Rebuild a member's seats across zones for the chosen trades x zones.
 * Full trades are reported as conflicts; nobody else's seat is taken.
 */
function planMemberSeats(zones, memberId, { trades, zoneIds }, now, limit = 1) {
  const wantedZones = new Set(zoneIds || []);
  const wantedTrades = trades || [];
  const conflicts = [];
  const changed = [];
  for (const zone of zones || []) {
    const keep = wantedZones.has(zone.id) ? wantedTrades : [];
    let next = releaseMemberSeats(zone, memberId, keep);
    for (const slug of keep) {
      const result = assignSeat(next, slug, memberId, now, limit);
      if (result.ok) next = result.zone;
      else conflicts.push({ zoneId: zone.id, zoneName: zone.name, tradeSlug: slug, holder: result.holder });
    }
    if (JSON.stringify(normalizeSeats(next.seats)) !== JSON.stringify(normalizeSeats(zone.seats))) changed.push(next);
  }
  return { changed, conflicts };
}

function seatsForMember(zones, memberId) {
  const out = [];
  for (const zone of zones || []) {
    for (const slug of Object.keys(zone.seats || {})) {
      if (seatHolders(zone, slug).includes(memberId)) out.push({ zoneId: zone.id, zoneName: zone.name, tradeSlug: slug });
    }
  }
  return out;
}

// ── Routing ──────────────────────────────────────────────────────────────────

/**
 * Pick the member who receives a referral: an active holder of the trade in
 * the zone other than the sender. With several holders it rotates to whoever
 * was sent a referral least recently. Anything else leaves it unrouted.
 */
function routeReferral(zone, tradeSlug, { members, fromMemberId, referrals } = {}) {
  if (!zone) return { toMemberId: null, status: 'unrouted', reason: 'no_zone' };
  const holders = seatHolders(zone, tradeSlug);
  if (!holders.length) return { toMemberId: null, status: 'unrouted', reason: 'open_seat' };
  const others = holders.filter((id) => !fromMemberId || id !== fromMemberId);
  if (!others.length) return { toMemberId: null, status: 'unrouted', reason: 'sender_holds_seat' };
  const active = members
    ? others.filter((id) => {
        const member = members.find((row) => row.id === id);
        return member && member.status === 'active';
      })
    : others;
  if (!active.length) return { toMemberId: null, status: 'unrouted', reason: 'member_paused' };
  const lastSent = {};
  for (const ref of referrals || []) {
    if (!ref || !active.includes(ref.toMemberId)) continue;
    const at = String(ref.createdAt || '');
    if (at > (lastSent[ref.toMemberId] || '')) lastSent[ref.toMemberId] = at;
  }
  const pick = active.reduce((best, id) => ((lastSent[id] || '') < (lastSent[best] || '') ? id : best), active[0]);
  return { toMemberId: pick, status: 'sent', reason: '' };
}

const UNROUTED_REASONS = {
  no_zone: 'No zone covers that city or ZIP.',
  open_seat: 'Nobody holds that trade seat in this zone yet.',
  sender_holds_seat: 'The sender is the only partner for that trade here.',
  member_paused: 'Every partner for that trade here is paused.',
};

// ── Referral record ──────────────────────────────────────────────────────────

/**
 * Validate the send-referral form into a new referral (status unrouted until
 * routed). Homeowner consent is required.
 */
function buildReferral(input, now) {
  const body = input && typeof input === 'object' ? input : {};
  const stamp = now || new Date().toISOString();
  const tradeSlug = String(body.tradeSlug || '').trim();
  if (!tradeSlug) return { ok: false, error: 'Pick a trade.' };
  const homeowner = {
    name: cleanText(body.name, 120),
    phone: cleanText(body.phone, 40),
    email: cleanText(body.email, 200),
    address: cleanText(body.address, 200),
    city: cleanText(body.city, 80),
    zip: normalizeZip(body.zip),
    note: cleanText(body.note, 1000),
    consentAt: '',
  };
  if (!homeowner.name) return { ok: false, error: 'Add the homeowner name.' };
  if (!homeowner.phone && !homeowner.email) return { ok: false, error: 'Add a phone or email for the homeowner.' };
  const consent = body.consent === true || body.consent === 'on' || body.consent === '1' || body.consent === 'true';
  if (!consent) return { ok: false, error: 'Confirm the homeowner agreed to be contacted.' };
  homeowner.consentAt = stamp;
  const by = cleanText(body.by, 160) || 'operator';
  return {
    ok: true,
    referral: {
      id: body.id || '',
      zoneId: String(body.zoneId || '').trim(),
      tradeSlug,
      fromMemberId: String(body.fromMemberId || '').trim() || 'operator',
      toMemberId: null,
      homeowner,
      status: 'unrouted',
      value: 0,
      events: [{ type: 'created', at: stamp, by, text: '' }],
      createdAt: stamp,
      updatedAt: stamp,
    },
  };
}

function parseMoney(value) {
  const n = Number(String(value == null ? '' : value).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

function allowedActions(referral) {
  const status = referral && referral.status;
  return Object.keys(TRANSITIONS).filter(
    (action) => action !== 'assign' && action !== 'claim' && TRANSITIONS[action].from.includes(status),
  );
}

/**
 * Can this active member claim an unrouted pool referral?
 * Must share the trade; zone must match when the member has zone preferences.
 */
function canClaimPoolReferral(referral, member) {
  if (!referral || referral.status !== 'unrouted') return false;
  const m = member && typeof member === 'object' ? member : {};
  if (m.status === 'paused') return false;
  if (!m.id || referral.fromMemberId === m.id) return false;
  const trades = Array.isArray(m.trades) ? m.trades : [];
  if (!trades.includes(referral.tradeSlug)) return false;
  const zones = Array.isArray(m.zoneIds) ? m.zoneIds : [];
  if (referral.zoneId && zones.length && !zones.includes(referral.zoneId)) return false;
  return true;
}

/** Unrouted referrals this member can claim from the pool. */
function poolReferralsForMember(referrals, member) {
  return (Array.isArray(referrals) ? referrals : [])
    .filter((r) => canClaimPoolReferral(r, member))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

/**
 * Apply an action to a referral. Returns a new referral object.
 * `win` needs a job value; `assign` needs toMemberId; `note` needs text.
 */
function applyReferralAction(referral, action, opts = {}) {
  if (!referral || typeof referral !== 'object') return { ok: false, error: 'Referral not found.' };
  const name = String(action || '').trim();
  const stamp = opts.now || new Date().toISOString();
  const by = cleanText(opts.by, 160) || 'operator';
  const text = cleanText(opts.text, 1000);
  const events = Array.isArray(referral.events) ? referral.events.slice(-40) : [];

  if (name === 'note') {
    if (!text) return { ok: false, error: 'Write a note first.' };
    return {
      ok: true,
      referral: { ...referral, events: events.concat({ type: 'note', at: stamp, by, text }), updatedAt: stamp },
    };
  }

  const rule = TRANSITIONS[name];
  if (!rule) return { ok: false, error: 'Unknown action.' };
  if (!rule.from.includes(referral.status)) {
    const current = STATUS_LABELS[referral.status] ? STATUS_LABELS[referral.status].toLowerCase() : referral.status;
    return { ok: false, error: `${ACTION_ERROR_VERBS[name] || 'Update'} isn't available while the referral is ${current}.` };
  }

  const next = { ...referral, status: rule.to, updatedAt: stamp };
  if (name === 'win') {
    const value = parseMoney(opts.value);
    if (!value) return { ok: false, error: 'Add the job value to mark it won.' };
    next.value = value;
    next.wonAt = stamp;
  }
  if (name === 'assign') {
    const toMemberId = String(opts.toMemberId || '').trim();
    if (!toMemberId) return { ok: false, error: 'Pick a member to assign.' };
    if (toMemberId === referral.fromMemberId) return { ok: false, error: 'The sender cannot receive their own referral.' };
    next.toMemberId = toMemberId;
    next.sentAt = stamp;
    delete next.acceptedAt;
  }
  if (name === 'claim') {
    const toMemberId = String(opts.toMemberId || '').trim();
    if (!toMemberId) return { ok: false, error: 'Sign in as a member to claim this referral.' };
    if (toMemberId === referral.fromMemberId) return { ok: false, error: 'You cannot claim your own referral.' };
    if (referral.toMemberId) return { ok: false, error: 'Someone already claimed this referral.' };
    next.toMemberId = toMemberId;
    next.sentAt = stamp;
    next.acceptedAt = stamp;
    delete next.unroutedReason;
  }
  if (name === 'accept') next.acceptedAt = stamp;
  if (name === 'book') next.bookedAt = stamp;
  if (name === 'decline') next.declinedAt = stamp;
  if (name === 'lose') next.lostAt = stamp;
  next.events = events.concat({
    type: name,
    at: stamp,
    by,
    text: name === 'win' ? `$${next.value.toLocaleString('en-US')}` : text,
  });
  return { ok: true, referral: next };
}

/** Mark a freshly built referral as routed (or unrouted with a reason). */
function applyRouting(referral, route, now) {
  const stamp = now || new Date().toISOString();
  const events = Array.isArray(referral.events) ? referral.events.slice() : [];
  if (route.status === 'sent' && route.toMemberId) {
    events.push({ type: 'routed', at: stamp, by: 'system', text: '' });
    return { ...referral, status: 'sent', toMemberId: route.toMemberId, sentAt: stamp, events };
  }
  events.push({ type: 'unrouted', at: stamp, by: 'system', text: UNROUTED_REASONS[route.reason] || '' });
  return { ...referral, status: 'unrouted', toMemberId: null, unroutedReason: route.reason || '', events };
}

// ── Stats ────────────────────────────────────────────────────────────────────

function memberStats(referrals, memberId) {
  const list = Array.isArray(referrals) ? referrals : [];
  const given = list.filter((ref) => ref.fromMemberId === memberId);
  const received = list.filter((ref) => ref.toMemberId === memberId);
  const won = received.filter((ref) => ref.status === 'won');
  return {
    given: given.length,
    received: received.length,
    open: received.filter((ref) => OPEN_STATUSES.has(ref.status)).length,
    accepted: received.filter((ref) => ['accepted', 'booked', 'won', 'lost'].includes(ref.status)).length,
    won: won.length,
    wonValue: won.reduce((sum, ref) => sum + (Number(ref.value) || 0), 0),
  };
}

/**
 * Operator partner-card counters from live network referrals:
 *   sent     = referrals routed TO this member (we sent them a lead)
 *   received = referrals FROM this member (they sent a lead into the network)
 * Matches syncPartnerCounter in networkNotify.
 */
function partnerCountersFromReferrals(referrals, memberId) {
  const id = String(memberId || '').trim();
  const list = Array.isArray(referrals) ? referrals : [];
  if (!id) return { sent: 0, received: 0, lastSentAt: '', lastReceivedAt: '' };
  let sent = 0;
  let received = 0;
  let lastSentAt = '';
  let lastReceivedAt = '';
  for (const ref of list) {
    if (!ref) continue;
    if (ref.toMemberId === id) {
      sent += 1;
      const at = String(ref.sentAt || ref.createdAt || '');
      if (at && at > lastSentAt) lastSentAt = at;
    }
    if (ref.fromMemberId === id) {
      received += 1;
      const at = String(ref.createdAt || '');
      if (at && at > lastReceivedAt) lastReceivedAt = at;
    }
  }
  return { sent, received, lastSentAt, lastReceivedAt };
}

function networkTotals(referrals) {
  const list = Array.isArray(referrals) ? referrals : [];
  const count = (status) => list.filter((ref) => ref.status === status).length;
  return {
    total: list.length,
    open: list.filter((ref) => OPEN_STATUSES.has(ref.status)).length,
    unrouted: count('unrouted'),
    sent: count('sent'),
    accepted: count('accepted'),
    booked: count('booked'),
    won: count('won'),
    lost: count('lost'),
    declined: count('declined'),
    wonValue: list
      .filter((ref) => ref.status === 'won')
      .reduce((sum, ref) => sum + (Number(ref.value) || 0), 0),
  };
}

module.exports = {
  STATUSES,
  STATUS_LABELS,
  ACTION_LABELS,
  UNROUTED_REASONS,
  normalizeZip,
  normalizeCity,
  parseCityList,
  parseZipList,
  normalizeZone,
  resolveZone,
  normalizeSeatLimit,
  seatHolder,
  seatHolders,
  assignSeat,
  planMemberSeats,
  seatsForMember,
  routeReferral,
  buildReferral,
  applyRouting,
  allowedActions,
  canClaimPoolReferral,
  poolReferralsForMember,
  applyReferralAction,
  parseMoney,
  memberStats,
  partnerCountersFromReferrals,
  networkTotals,
};
