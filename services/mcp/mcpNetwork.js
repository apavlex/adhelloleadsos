/**
 * Referral network tools for MCP clients (ChatGPT, Claude, Gemini) and the in-app chat:
 * overview, members, referrals (send / update), applications, and review stats.
 */
const { z } = require('zod/v3');
const { zodToJsonSchema } = require('zod-to-json-schema');
const dbService = require('../database');
const workspaceService = require('../workspaceService');
const store = require('../networkStore');
const ex = require('../referralExchange');
const trades = require('../networkTrades');
const notify = require('../networkNotify');
const networkReferrals = require('../networkReferrals');
const networkMembers = require('../networkMembers');

function toolError(message, code = 'NETWORK_ERROR') {
  const err = new Error(message);
  err.code = code;
  return err;
}

function baseUrl(ctx) {
  return (ctx && ctx.baseUrl) || notify.baseUrlFromReq(null);
}

function actor(ctx) {
  return (ctx && ctx.userEmail) || 'AI assistant';
}

async function requireNetwork(ctx) {
  const network = await store.getNetworkForWorkspace(ctx.workspaceId);
  if (!network) {
    throw toolError('This workspace has no referral network yet. Open Network in AdHello to set one up.', 'NO_NETWORK');
  }
  return network;
}

async function requireManager(ctx) {
  if (ctx && ctx.canManage === true) return;
  const ws = await dbService.getWorkspace(ctx.workspaceId);
  const role = workspaceService.roleForEmail(ws, ctx.userEmail || '');
  if (!workspaceService.canManageTeam(role)) {
    throw toolError('Only workspace owners and admins can do that.', 'FORBIDDEN');
  }
}

function normWords(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function commonPrefix(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i;
}

/** Accepts a slug ("pest_control"), a label ("Pest control"), or a trade word ("plumber"). */
function resolveTrade(network, value) {
  const wanted = normWords(value);
  if (!wanted) throw toolError('Say which trade (e.g. plumbing, HVAC, roofing).', 'TRADE_REQUIRED');
  const options = trades.tradesForNetwork(network);
  const names = (t) => [normWords(t.slug), normWords(t.name), normWords(t.keyword)];
  const exact = options.find((t) => names(t).includes(wanted));
  if (exact) return exact.slug;
  const close = options.filter((t) =>
    names(t).some((n) => n.includes(wanted) || wanted.includes(n) || commonPrefix(n, wanted) >= 4),
  );
  if (close.length === 1) return close[0].slug;
  const list = (close.length ? close : options).map((t) => t.name).join(', ');
  throw toolError(
    close.length ? `"${value}" matches several trades: ${list}.` : `"${value}" is not a trade in this network. Trades: ${list}.`,
    'TRADE_UNKNOWN',
  );
}

function resolveMember(members, ref) {
  const wanted = String(ref || '').trim();
  if (!wanted) return null;
  const byId = members.find((m) => m.id === wanted);
  if (byId) return byId;
  const q = normWords(wanted);
  const exact = members.filter((m) => normWords(m.companyName) === q || normWords(m.contactName) === q);
  const hits = exact.length ? exact : members.filter((m) => normWords(m.companyName).includes(q) || normWords(m.contactName).includes(q));
  if (hits.length === 1) return hits[0];
  if (!hits.length) throw toolError(`No network member matches "${wanted}".`, 'MEMBER_NOT_FOUND');
  throw toolError(`"${wanted}" matches several members: ${hits.map((m) => m.companyName).join(', ')}.`, 'MEMBER_AMBIGUOUS');
}

function resolveZoneRef(zones, ref) {
  const wanted = String(ref || '').trim();
  if (!wanted) return null;
  const zone = zones.find((z) => z.id === wanted) || zones.find((z) => normWords(z.name) === normWords(wanted));
  if (!zone) throw toolError(`No zone named "${wanted}". Zones: ${zones.map((z) => z.name).join(', ') || 'none yet'}.`, 'ZONE_NOT_FOUND');
  return zone;
}

function memberName(membersById, id) {
  if (id === 'operator') return 'You (operator)';
  return id && membersById[id] ? membersById[id].companyName : '';
}

function presentReferral(ref, membersById, zonesById) {
  const h = ref.homeowner || {};
  return {
    id: ref.id,
    status: ref.status,
    status_label: ex.STATUS_LABELS[ref.status] || ref.status,
    trade: trades.tradeLabel(ref.tradeSlug),
    zone: ref.zoneId && zonesById[ref.zoneId] ? zonesById[ref.zoneId].name : '',
    from: memberName(membersById, ref.fromMemberId),
    to: memberName(membersById, ref.toMemberId),
    homeowner: { name: h.name || '', phone: h.phone || '', email: h.email || '', address: h.address || '', city: h.city || '', zip: h.zip || '' },
    note: h.note || '',
    job_value: Number(ref.value) || 0,
    unrouted_reason: ref.status === 'unrouted' ? ex.UNROUTED_REASONS[ref.unroutedReason] || '' : '',
    next_actions: ex.allowedActions(ref).concat(['unrouted', 'declined', 'sent'].includes(ref.status) ? ['assign'] : [], ['note']),
    created_at: ref.createdAt || '',
    updated_at: ref.updatedAt || '',
  };
}

async function loadAll(network) {
  const [zones, members, referrals] = await Promise.all([
    store.listZones(network.id),
    store.listMembers(network.id),
    store.listReferrals(network.id),
  ]);
  return {
    zones,
    members,
    referrals,
    membersById: Object.fromEntries(members.map((m) => [m.id, m])),
    zonesById: Object.fromEntries(zones.map((z) => [z.id, z])),
  };
}

function notifiedText(notified) {
  if (notified && notified.ok) return `notified by ${notified.channel === 'sms' ? 'text' : 'email'}`;
  return `not notified${notified && notified.error ? ` (${String(notified.error).replace(/[.\s]+$/, '')})` : ''}`;
}

// ── Tools ────────────────────────────────────────────────────────────────────

async function getNetworkOverview(ctx) {
  const network = await requireNetwork(ctx);
  const { zones, members, referrals, membersById } = await loadAll(network);
  const applications = await store.listApplications(network.id);
  const networkTrades = trades.tradesForNetwork(network);
  const ghlAllowed = await networkMembers.ghlSubaccountsAllowed(network);
  return {
    network: {
      name: network.name,
      app_name: network.brand && network.brand.appName ? network.brand.appName : network.name,
      trades: networkTrades.map((t) => t.name),
      ...(ghlAllowed ? { auto_ghl_subaccount: network.autoGhlSubaccount } : {}),
      partners_per_trade: network.seatLimit || 'no limit',
    },
    zones: zones.map((zone) => ({
      id: zone.id,
      name: zone.name,
      cities: zone.cities,
      zips: zone.zips,
      seats_held: networkTrades
        .filter((t) => ex.seatHolder(zone, t.slug))
        .map((t) => `${t.name}: ${ex.seatHolders(zone, t.slug).map((id) => memberName(membersById, id) || 'member').join(', ')}`),
      open_seats: networkTrades.filter((t) => !ex.seatHolder(zone, t.slug)).map((t) => t.name),
    })),
    members: {
      active: members.filter((m) => m.status === 'active').length,
      paused: members.filter((m) => m.status !== 'active').length,
    },
    referrals: ex.networkTotals(referrals),
    pending_applications: applications.filter((a) => a.status === 'pending').length,
  };
}

async function listNetworkMembers(ctx, input) {
  const network = await requireNetwork(ctx);
  const { zones, members, referrals, zonesById } = await loadAll(network);
  const tradeSlug = input.trade ? resolveTrade(network, input.trade) : '';
  const q = normWords(input.query);
  const ghlAllowed = await networkMembers.ghlSubaccountsAllowed(network);
  const rows = members
    .filter((m) => !input.status || m.status === input.status)
    .filter((m) => !tradeSlug || m.trades.includes(tradeSlug))
    .filter((m) => !q || normWords(`${m.companyName} ${m.contactName}`).includes(q))
    .map((m) => ({
      id: m.id,
      company: m.companyName,
      contact: m.contactName,
      phone: m.phone,
      email: m.email,
      status: m.status,
      trades: m.trades.map(trades.tradeLabel),
      zones: m.zoneIds.map((id) => (zonesById[id] ? zonesById[id].name : '')).filter(Boolean),
      seats: ex.seatsForMember(zones, m.id).map((s) => `${trades.tradeLabel(s.tradeSlug)} · ${s.zoneName}`),
      stats: ex.memberStats(referrals, m.id),
      ...(ghlAllowed ? { ghl_subaccount: m.ghlLocationId ? 'created' : m.ghlError ? `failed: ${m.ghlError}` : 'none' } : {}),
      review_page: m.reviewSlug ? `${baseUrl(ctx)}/rv/${m.reviewSlug}` : '',
    }));
  return { count: rows.length, members: rows };
}

async function listReferrals(ctx, input) {
  const network = await requireNetwork(ctx);
  const { members, referrals, membersById, zonesById } = await loadAll(network);
  const member = input.member ? resolveMember(members, input.member) : null;
  const direction = input.direction || 'any';
  const limit = Math.min(Math.max(parseInt(input.limit, 10) || 25, 1), 100);
  const rows = referrals
    .filter((ref) => !input.status || ref.status === input.status)
    .filter((ref) => {
      if (!member) return true;
      if (direction === 'received') return ref.toMemberId === member.id;
      if (direction === 'sent') return ref.fromMemberId === member.id;
      return ref.toMemberId === member.id || ref.fromMemberId === member.id;
    })
    .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
  return {
    total: rows.length,
    referrals: rows.slice(0, limit).map((ref) => presentReferral(ref, membersById, zonesById)),
  };
}

async function sendReferral(ctx, input) {
  const network = await requireNetwork(ctx);
  const [zones, members] = await Promise.all([store.listZones(network.id), store.listMembers(network.id)]);
  const tradeSlug = resolveTrade(network, input.trade);
  const zone = resolveZoneRef(zones, input.zone);
  const from = input.from_member ? resolveMember(members, input.from_member) : null;
  const result = await networkReferrals.sendReferral({
    network,
    input: {
      tradeSlug,
      zoneId: zone ? zone.id : '',
      name: input.homeowner_name,
      phone: input.phone,
      email: input.email,
      address: input.address,
      city: input.city,
      zip: input.zip,
      note: input.note,
      consent: input.homeowner_consent === true,
    },
    fromMemberId: from ? from.id : 'operator',
    by: actor(ctx),
    baseUrl: baseUrl(ctx),
  });
  if (!result.ok) throw toolError(result.error, 'REFERRAL_INVALID');
  const membersById = Object.fromEntries(members.map((m) => [m.id, m]));
  const zonesById = Object.fromEntries(zones.map((z) => [z.id, z]));
  const referral = presentReferral(result.referral, membersById, zonesById);
  const message = result.referral.status === 'unrouted'
    ? `Saved but not routed: ${referral.unrouted_reason || 'no seat holder for that trade and area.'} Use update_referral with action "assign" to pick a member.`
    : `Sent to ${referral.to}, who was ${notifiedText(result.notified)}.`;
  return { message, referral };
}

async function updateReferral(ctx, input) {
  const network = await requireNetwork(ctx);
  const members = await store.listMembers(network.id);
  const toMember = input.action === 'assign' ? resolveMember(members, input.assign_to_member) : null;
  if (input.action === 'assign' && !toMember) throw toolError('Say which member to assign it to (assign_to_member).', 'MEMBER_REQUIRED');
  const result = await networkReferrals.actOnReferral({
    network,
    referralId: input.referral_id,
    action: input.action,
    opts: { value: input.job_value, text: input.note, toMemberId: toMember ? toMember.id : '', by: actor(ctx) },
    baseUrl: baseUrl(ctx),
  });
  if (!result.ok) throw toolError(result.error, 'REFERRAL_ACTION_FAILED');
  const zones = await store.listZones(network.id);
  const referral = presentReferral(
    result.referral,
    Object.fromEntries(members.map((m) => [m.id, m])),
    Object.fromEntries(zones.map((z) => [z.id, z])),
  );
  let message = input.action === 'note' ? 'Note added.' : `Marked ${referral.status_label.toLowerCase()}.`;
  if (input.action === 'assign') message = `Assigned to ${referral.to}, who was ${notifiedText(result.notified)}.`;
  return { message, referral };
}

async function listNetworkApplications(ctx, input) {
  const network = await requireNetwork(ctx);
  const [applications, zones, members] = await Promise.all([
    store.listApplications(network.id),
    store.listZones(network.id),
    store.listMembers(network.id),
  ]);
  const membersById = Object.fromEntries(members.map((m) => [m.id, m]));
  const status = input.status || 'pending';
  const rows = applications
    .filter((a) => status === 'all' || a.status === status)
    .map((a) => {
      const zone = ex.resolveZone(zones, { city: a.city });
      return {
        id: a.id,
        company: a.companyName,
        contact: a.contactName,
        phone: a.phone,
        email: a.email,
        trade: trades.tradeLabel(a.tradeSlug),
        city: a.city,
        note: a.note,
        invited_by: memberName(membersById, a.invitedByMemberId),
        suggested_zone: zone ? zone.name : '',
        status: a.status,
        created_at: a.createdAt,
      };
    });
  return { count: rows.length, applications: rows };
}

async function approveNetworkApplication(ctx, input) {
  await requireManager(ctx);
  const network = await requireNetwork(ctx);
  const zones = await store.listZones(network.id);
  const application = await store.getApplication(network.id, input.application_id);
  if (!application) throw toolError('Application not found.', 'APPLICATION_NOT_FOUND');
  const tradeSlugs = (input.trades || []).map((t) => resolveTrade(network, t));
  let zoneIds = (input.zones || []).map((ref) => resolveZoneRef(zones, ref).id);
  if (!zoneIds.length) {
    const suggested = ex.resolveZone(zones, { city: application.city });
    if (suggested) zoneIds = [suggested.id];
  }
  const result = await networkMembers.approveApplication({
    network,
    applicationId: application.id,
    zoneIds,
    tradeSlugs,
    baseUrl: baseUrl(ctx),
  });
  if (!result.ok) throw toolError(result.error, 'APPROVE_FAILED');
  return {
    message: `${result.member.companyName} joined the network.${networkMembers.ghlNotice(result.ghl)} App link ${notifiedText(result.notified).replace(/^notified/, 'sent')}.`,
    member: { id: result.member.id, company: result.member.companyName, trades: result.member.trades.map(trades.tradeLabel) },
    seats_already_taken: (result.conflicts || []).map((c) => `${trades.tradeLabel(c.tradeSlug)} in ${c.zoneName}`),
  };
}

async function rejectNetworkApplication(ctx, input) {
  await requireManager(ctx);
  const network = await requireNetwork(ctx);
  const result = await networkMembers.rejectApplication({ network, applicationId: input.application_id });
  if (!result.ok) throw toolError(result.error, 'REJECT_FAILED');
  return { message: `Rejected ${result.application.companyName}.` };
}

async function getReviewStats(ctx, input) {
  const network = await requireNetwork(ctx);
  const members = await store.listMembers(network.id);
  const picked = input.member ? [resolveMember(members, input.member)] : members;
  const rows = [];
  for (const m of picked) {
    const [stats, feedback] = await Promise.all([store.getReviewStats(network.id, m.id), store.listFeedback(network.id, m.id)]);
    const totalStars = Object.values(stats.stars).reduce((a, b) => a + b, 0);
    const weighted = Object.entries(stats.stars).reduce((sum, [star, n]) => sum + Number(star) * n, 0);
    rows.push({
      member: m.companyName,
      review_page: m.reviewSlug ? `${baseUrl(ctx)}/rv/${m.reviewSlug}` : '',
      links_set: Object.entries(m.reviewLinks || {}).filter(([k, v]) => k !== 'other' && v).map(([k]) => k)
        .concat((m.reviewLinks && m.reviewLinks.other ? m.reviewLinks.other : []).map((o) => o.label || 'other')),
      page_views: stats.views,
      star_ratings: stats.stars,
      average_star: totalStars ? Math.round((weighted / totalStars) * 10) / 10 : null,
      review_link_clicks: stats.clicks,
      private_feedback: feedback.slice(0, 5).map((f) => ({ rating: f.rating, name: f.name, message: f.message, at: f.createdAt })),
    });
  }
  return { members: rows };
}

/** A catalog trade by slug, name, or search keyword; plural/singular differences are tolerated. */
function findCatalogTrade(catalog, value) {
  const wanted = normWords(value);
  if (!wanted) return null;
  const names = (t) => [normWords(t.slug), normWords(t.name), normWords(t.keyword)];
  const exact = catalog.find((t) => names(t).includes(wanted));
  if (exact) return exact;
  const close = catalog.filter((t) => names(t).some((n) => n.length >= 4 && commonPrefix(n, wanted) >= Math.min(n.length, wanted.length) - 2 && commonPrefix(n, wanted) >= 4));
  return close.length === 1 ? close[0] : null;
}

function tradeLists(network) {
  const active = trades.tradesForNetwork(network);
  const activeSlugs = new Set(active.map((t) => t.slug));
  return {
    active_trades: active.map((t) => t.name),
    hidden_trades: trades.catalogFor(network).filter((t) => !activeSlugs.has(t.slug)).map((t) => t.name),
  };
}

async function manageNetworkTrades(ctx, input) {
  const network = await requireNetwork(ctx);
  if (input.action === 'list') return tradeLists(network);
  await requireManager(ctx);
  const names = (input.trades || []).map((t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 40)).filter(Boolean);
  if (!names.length) throw toolError('Say which trades, e.g. ["Interior design", "Cabinets"].', 'TRADE_REQUIRED');

  let active = trades.tradesForNetwork(network).map((t) => t.slug);
  let custom = trades.normalizeCustomTrades(network.customTrades);
  const zones = input.action === 'hide' ? await store.listZones(network.id) : [];
  const done = [];
  const skipped = [];

  for (const name of names) {
    const catalog = trades.DEFAULT_TRADES.concat(custom);
    const trade = findCatalogTrade(catalog, name);
    if (input.action === 'hide') {
      if (!trade || !active.includes(trade.slug)) { skipped.push(`${name}: not on the list`); continue; }
      const held = zones.filter((z) => ex.seatHolder(z, trade.slug));
      if (held.length) { skipped.push(`${trade.name}: a member holds its seat in ${held.map((z) => z.name).join(', ')}`); continue; }
      if (active.length === 1) { skipped.push(`${trade.name}: it's the last trade`); continue; }
      active = active.filter((s) => s !== trade.slug);
      done.push(trade.name);
      continue;
    }
    if (trade) {
      if (active.includes(trade.slug)) { skipped.push(`${trade.name}: already on the list`); continue; }
      active = active.concat(trade.slug);
      done.push(trade.name);
      continue;
    }
    if (input.action === 'show') { skipped.push(`${name}: not a trade yet (use action "add")`); continue; }
    const slug = trades.customSlug(name);
    if (!slug) { skipped.push(`${name}: needs letters or numbers`); continue; }
    if (custom.length >= trades.MAX_CUSTOM_TRADES) { skipped.push(`${name}: custom trade limit (${trades.MAX_CUSTOM_TRADES}) reached`); continue; }
    custom = custom.concat({ slug, name, keyword: name.toLowerCase(), custom: true });
    active = active.concat(slug);
    done.push(`${name} (custom)`);
  }

  const saved = done.length
    ? await store.saveNetwork({
        ...network,
        customTrades: custom.map(({ slug, name, keyword }) => ({ slug, name, keyword })),
        trades: active,
      })
    : network;
  const verb = input.action === 'hide' ? 'Hidden' : input.action === 'show' ? 'Back on the list' : 'Added';
  return {
    message: done.length
      ? `${verb}: ${done.join(', ')}.${input.action === 'hide' ? '' : ' Each has an open seat in every zone.'}`
      : 'Nothing changed.',
    skipped,
    ...tradeLists(saved),
  };
}

// ── Registry ─────────────────────────────────────────────────────────────────

const STATUS_ENUM = z.enum(['unrouted', 'sent', 'accepted', 'declined', 'booked', 'won', 'lost']);

const NETWORK_TOOLS = [
  {
    name: 'get_network_overview',
    description:
      'Referral network summary: trades, zones with held and open seats, member counts, referral totals by status and won value, pending applications.',
    schema: z.object({}),
    run: getNetworkOverview,
  },
  {
    name: 'list_network_members',
    description:
      'List referral network member businesses with trades, zones, seats, referral stats (given, received, open, won), GHL sub-account status, and review page link.',
    schema: z.object({
      status: z.enum(['active', 'paused']).optional(),
      trade: z.string().optional().describe('Filter by trade, e.g. "plumbing".'),
      query: z.string().optional().describe('Company or contact name contains.'),
    }),
    run: listNetworkMembers,
  },
  {
    name: 'list_referrals',
    description:
      'List referrals in the network, newest activity first, optionally by status or by member (received, sent, or either). Includes homeowner contact and next allowed actions.',
    schema: z.object({
      status: STATUS_ENUM.optional(),
      member: z.string().optional().describe('Member id or company/contact name.'),
      direction: z.enum(['received', 'sent', 'any']).optional().describe('With member: which side they are on (default any).'),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    run: listReferrals,
  },
  {
    name: 'send_referral',
    description:
      'Send a homeowner referral into the network. It routes to the member holding that trade in the zone matching the city/ZIP and texts them. ' +
      'Only send when the homeowner agreed to be contacted (homeowner_consent=true). Needs a phone or email.',
    schema: z.object({
      trade: z.string().min(1).describe('Trade needed, e.g. "plumbing", "HVAC", "roofer".'),
      homeowner_name: z.string().min(1),
      phone: z.string().optional(),
      email: z.string().optional(),
      address: z.string().optional(),
      city: z.string().optional().describe('Used to pick the zone when zone is not given.'),
      zip: z.string().optional(),
      note: z.string().optional().describe('What the homeowner needs.'),
      zone: z.string().optional().describe('Zone name or id; overrides city/ZIP matching.'),
      from_member: z.string().optional().describe('Member sending it (id or name). Omit when the operator sends it.'),
      homeowner_consent: z.boolean().describe('True only if the homeowner agreed to be contacted.'),
    }),
    run: sendReferral,
  },
  {
    name: 'update_referral',
    description:
      'Move a referral along: accept, decline, book, win (needs job_value), lose, assign (needs assign_to_member), or add a note.',
    schema: z.object({
      referral_id: z.string().min(1),
      action: z.enum(['accept', 'decline', 'book', 'win', 'lose', 'assign', 'note']),
      job_value: z.number().positive().optional().describe('Dollar value of the job, required for win.'),
      note: z.string().optional(),
      assign_to_member: z.string().optional().describe('Member id or name, required for assign.'),
    }),
    run: updateReferral,
  },
  {
    name: 'list_network_applications',
    description:
      'List businesses that applied or were invited to join the network (default: pending), with trade, city, who invited them, and the suggested zone.',
    schema: z.object({ status: z.enum(['pending', 'approved', 'rejected', 'all']).optional() }),
    run: listNetworkApplications,
  },
  {
    name: 'approve_network_application',
    description:
      'Approve a pending application: adds the business as a member with seats, creates its GHL sub-account when enabled, and texts it the member app link. Owners/admins only.',
    schema: z.object({
      application_id: z.string().min(1),
      trades: z.array(z.string()).optional().describe('Trades to seat them in (default: the trade they applied with).'),
      zones: z.array(z.string()).optional().describe('Zone names or ids (default: the zone matching their city).'),
    }),
    run: approveNetworkApplication,
  },
  {
    name: 'reject_network_application',
    description: 'Reject a pending network application. Owners/admins only.',
    schema: z.object({ application_id: z.string().min(1) }),
    run: rejectNetworkApplication,
  },
  {
    name: 'get_review_stats',
    description:
      'Review page results per member: page views, star ratings, average, clicks per review site (Google, Yelp, Thumbtack, Angi, etc.), and recent private feedback.',
    schema: z.object({ member: z.string().optional().describe('Member id or name; omit for all members.') }),
    run: getReviewStats,
  },
  {
    name: 'manage_network_trades',
    description:
      'See or change which trades have seats in the referral network. list: active and hidden trades. ' +
      'add: turn on built-in trades or create custom ones (e.g. partners that send a flooring business work: Interior design, Real estate, Cabinets, Countertops, Remodeling). ' +
      'hide / show: take trades off the seat list or bring them back. Changes are owners/admins only.',
    schema: z.object({
      action: z.enum(['list', 'add', 'hide', 'show']),
      trades: z.array(z.string()).optional().describe('Trade names for add/hide/show, e.g. ["Interior design", "Property managers"].'),
    }),
    run: manageNetworkTrades,
  },
];

const BY_NAME = Object.fromEntries(NETWORK_TOOLS.map((t) => [t.name, t]));
const NETWORK_TOOL_NAMES = NETWORK_TOOLS.map((t) => t.name);

async function executeNetworkTool(ctx, name, input) {
  const tool = BY_NAME[name];
  if (!tool) throw toolError(`Unknown tool: ${name}`, 'UNKNOWN_TOOL');
  const parsed = tool.schema.safeParse(input || {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw toolError(`${issue.path.join('.') || 'input'}: ${issue.message}`, 'INVALID_ARGUMENTS');
  }
  return tool.run(ctx, parsed.data);
}

function openAiFunctionTools() {
  return NETWORK_TOOLS.map((tool) => {
    const { $schema, ...parameters } = zodToJsonSchema(tool.schema, { target: 'openApi3' });
    return { type: 'function', function: { name: tool.name, description: tool.description, parameters } };
  });
}

module.exports = {
  NETWORK_TOOLS,
  NETWORK_TOOL_NAMES,
  READ_ONLY_NETWORK_TOOLS: ['get_network_overview', 'list_network_members', 'list_referrals', 'list_network_applications', 'get_review_stats'],
  DESTRUCTIVE_NETWORK_TOOLS: ['reject_network_application'],
  OPEN_WORLD_NETWORK_TOOLS: ['send_referral', 'update_referral', 'approve_network_application'],
  executeNetworkTool,
  openAiFunctionTools,
  resolveTrade,
  resolveMember,
};
