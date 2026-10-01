const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const { userEmail, filterLeadsForRequest } = require('../services/workspaceService');
const { filterBusinessPipelineLeads } = require('../services/leadListFilters');
const store = require('../services/networkStore');
const ex = require('../services/referralExchange');
const trades = require('../services/networkTrades');
const notify = require('../services/networkNotify');
const networkReferrals = require('../services/networkReferrals');
const referralNetwork = require('../services/referralNetwork');
const networkBrand = require('../services/networkBrand');
const networkMembers = require('../services/networkMembers');
const reviewPage = require('../services/reviewPage');
const { ICONS: MEMBER_APP_ICONS } = require('../services/memberAppIcons');
const multer = require('multer');

const TABS = new Set(['seats', 'members', 'applications', 'referrals', 'send', 'brand', 'setup']);

const brandUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 2 },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(jpeg|jpg|png|webp|gif)$/i.test(String(file.mimetype || ''));
    cb(ok ? null : new Error('Upload a JPEG, PNG, WebP, or GIF image.'), ok);
  },
});

function wantsJson(req) {
  return /application\/json/i.test(String(req.get('accept') || ''));
}

function listFrom(value) {
  if (Array.isArray(value)) return value.map((v) => String(v || '').trim()).filter(Boolean);
  if (value == null || value === '') return [];
  return String(value).split(',').map((v) => v.trim()).filter(Boolean);
}

function back(tab, notice, extra) {
  const params = new URLSearchParams();
  if (tab) params.set('tab', tab);
  if (notice) params.set('notice', notice);
  Object.entries(extra || {}).forEach(([k, v]) => { if (v) params.set(k, v); });
  return `/network?${params.toString()}`;
}

function reply(req, res, { ok, tab, notice, data, status }) {
  if (wantsJson(req)) return res.status(ok ? 200 : (status || 400)).json({ success: ok, notice, error: ok ? undefined : notice, ...(data || {}) });
  return res.redirect(back(tab, notice));
}

function canManage(req) {
  return req.canManageWorkspace !== false;
}

async function loadNetwork(req) {
  return store.getOrCreateNetworkForWorkspace(req.workspaceId, {
    name: req.workspace && req.workspace.name ? `${req.workspace.name} network` : 'Referral network',
    ownerEmail: userEmail(req),
  });
}

function money(n) {
  return `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`;
}

function formatWhen(iso) {
  const ms = Date.parse(iso || '');
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function presentReferral(ref, membersById, zonesById, network) {
  const h = ref.homeowner || {};
  const from = ref.fromMemberId === 'operator' ? 'You' : (membersById[ref.fromMemberId] || {}).companyName || 'Removed member';
  const to = ref.toMemberId ? (membersById[ref.toMemberId] || {}).companyName || 'Removed member' : '';
  return {
    id: ref.id,
    status: ref.status,
    statusLabel: ex.STATUS_LABELS[ref.status] || ref.status,
    trade: trades.tradeLabel(ref.tradeSlug, network),
    tradeSlug: ref.tradeSlug,
    zone: ref.zoneId && zonesById[ref.zoneId] ? zonesById[ref.zoneId].name : '',
    from,
    to,
    toMemberId: ref.toMemberId || '',
    fromMemberId: ref.fromMemberId,
    homeowner: h,
    note: h.note || '',
    value: ref.value ? money(ref.value) : '',
    when: formatWhen(ref.createdAt),
    reason: ref.status === 'unrouted' ? (ex.UNROUTED_REASONS[ref.unroutedReason] || '') : '',
    actions: ex.allowedActions(ref),
    canAssign: ['unrouted', 'declined', 'sent'].includes(ref.status),
    lastEvent: (ref.events || []).slice(-1)[0] || null,
  };
}

router.get('/', async (req, res, next) => {
  try {
    const network = await loadNetwork(req);
    const tab = TABS.has(String(req.query.tab || '')) ? String(req.query.tab) : 'seats';
    const [zones, members, referrals, applications] = await Promise.all([
      store.listZones(network.id),
      store.listMembers(network.id),
      store.listReferrals(network.id),
      store.listApplications(network.id),
    ]);
    const membersById = Object.fromEntries(members.map((m) => [m.id, m]));
    const zonesById = Object.fromEntries(zones.map((z) => [z.id, z]));
    const networkTrades = trades.tradesForNetwork(network);

    const seatRows = zones.map((zone) => ({
      zone,
      seats: networkTrades.map((trade) => {
        const holders = ex.seatHolders(zone, trade.slug)
          .map((id) => membersById[id])
          .filter(Boolean)
          .map((holder) => ({
            id: holder.id,
            name: holder.companyName,
            paused: holder.status !== 'active',
            href: holder.leadKey ? `/referrals?focus=${encodeURIComponent(holder.leadKey)}` : '/network?tab=members',
          }));
        const full = network.seatLimit > 0 && holders.length >= network.seatLimit;
        const holderIds = new Set(holders.map((h) => h.id));
        const waiting = members
          .filter((m) => !holderIds.has(m.id) && m.trades.includes(trade.slug) && m.zoneIds.includes(zone.id))
          .map((m) => ({
            id: m.id,
            name: m.companyName,
            href: m.leadKey ? `/referrals?focus=${encodeURIComponent(m.leadKey)}` : '/network?tab=members',
          }));
        return {
          trade,
          holders,
          waiting,
          full,
          recruitUrl: full ? '' : trades.recruitSearchUrl(trade.slug, zone, network),
        };
      }),
    }));

    const activeSlugs = new Set(networkTrades.map((t) => t.slug));
    const hiddenTrades = trades.catalogFor(network).filter((t) => !activeSlugs.has(t.slug));

    const memberRows = members.map((member) => ({
      ...member,
      tradeLabels: member.trades.map((slug) => trades.tradeLabel(slug, network)),
      zoneNames: member.zoneIds.map((id) => (zonesById[id] ? zonesById[id].name : '')).filter(Boolean),
      seats: ex.seatsForMember(zones, member.id).map((s) => `${trades.tradeLabel(s.tradeSlug, network)} · ${s.zoneName}`),
      stats: ex.memberStats(referrals, member.id),
      reviewLinkCount: reviewPage.countLinks(member.reviewLinks),
      reviewOtherRows: reviewPage.otherFormRows(member.reviewLinks),
    }));

    const statusFilter = ex.STATUSES.includes(String(req.query.status || '')) ? String(req.query.status) : '';
    const referralRows = referrals
      .filter((ref) => !statusFilter || ref.status === statusFilter)
      .slice(0, 200)
      .map((ref) => presentReferral(ref, membersById, zonesById, network));

    let candidates = [];
    if (tab === 'members') {
      const memberLeadKeys = new Set(members.map((m) => m.leadKey));
      const leads = filterBusinessPipelineLeads(filterLeadsForRequest(req, await dbService.getAllLeads(req.workspaceId)));
      candidates = referralNetwork.listPartners(leads, '')
        .filter((card) => !memberLeadKeys.has(card.key))
        .map((card) => ({ key: card.key, title: card.title, where: [card.category, card.city].filter(Boolean).join(' · ') }));
      const prefill = String(req.query.leadKey || '').trim();
      if (prefill && !memberLeadKeys.has(prefill) && !candidates.some((c) => c.key === prefill)) {
        const lead = await dbService.getLead(prefill, req.workspaceId);
        if (lead && lead.key) candidates.unshift({ key: lead.key, title: lead.title || 'Untitled', where: lead.city || '' });
      }
    }

    const totals = ex.networkTotals(referrals);
    const openSeats = seatRows.reduce((n, row) => n + row.seats.filter((s) => !s.holders.length).length, 0);
    const heldSeats = seatRows.reduce((n, row) => n + row.seats.filter((s) => s.holders.length).length, 0);

    res.render('network', {
      title: 'Referral network',
      activePage: 'network',
      navPrimary: 'network',
      tab,
      network,
      networkTrades,
      allTrades: trades.catalogFor(network),
      hiddenTrades,
      customTrades: trades.normalizeCustomTrades(network.customTrades).map((t) => ({
        ...t,
        seatsHeld: zones.filter((z) => ex.seatHolders(z, t.slug).length).length,
      })),
      maxCustomTrades: trades.MAX_CUSTOM_TRADES,
      zones,
      seatRows,
      members: memberRows,
      reviewPlatforms: reviewPage.PLATFORMS,
      activeMembers: members.filter((m) => m.status === 'active'),
      referrals: referralRows,
      statusFilter,
      statuses: ex.STATUSES.map((s) => ({ id: s, label: ex.STATUS_LABELS[s], count: referrals.filter((r) => r.status === s).length })),
      totals: { ...totals, wonValueLabel: money(totals.wonValue), openSeats, heldSeats, members: members.length },
      canManage: canManage(req),
      ghlSubaccounts: networkMembers.ghlSubaccountsAllowedFor(req.workspace),
      notice: String(req.query.notice || '').trim(),
      editZoneId: String(req.query.zone || '').trim(),
      prefillLeadKey: String(req.query.leadKey || '').trim(),
      prefillTrade: networkTrades.some((t) => t.slug === req.query.trade) ? String(req.query.trade) : '',
      candidates,
      brand: networkBrand.brandView(network),
      applications: applications.map((app) => ({
        ...app,
        tradeLabel: app.tradeSlug ? trades.tradeLabel(app.tradeSlug, network) : '',
        invitedBy: app.invitedByMemberId && membersById[app.invitedByMemberId] ? membersById[app.invitedByMemberId].companyName : '',
        suggestedZoneId: (ex.resolveZone(zones, { city: app.city }) || {}).id || '',
        memberName: app.memberId && membersById[app.memberId] ? membersById[app.memberId].companyName : '',
        when: formatWhen(app.createdAt),
      })),
      pendingApplications: applications.filter((app) => app.status === 'pending').length,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/setup', async (req, res) => {
  if (!canManage(req)) return reply(req, res, { ok: false, tab: 'setup', notice: 'Only owners and admins can change the network.', status: 403 });
  try {
    const network = await loadNetwork(req);
    const chosen = trades.normalizeTradeSlugs(listFrom(req.body.trades), trades.catalogFor(network));
    const saved = await store.saveNetwork({
      ...network,
      name: String(req.body.name || '').trim() || network.name,
      trades: chosen.length ? chosen : network.trades,
      autoGhlSubaccount: req.body.ghlToggle ? req.body.autoGhlSubaccount === 'on' : network.autoGhlSubaccount,
      seatLimit: req.body.seatLimit != null ? req.body.seatLimit : network.seatLimit,
    });
    const seated = req.body.seatLimit != null ? await networkReferrals.reseatWaitingMembers(saved) : [];
    const notice = seated.length ? `Network saved. Seated ${seated.join(', ')}.` : 'Network saved.';
    return reply(req, res, { ok: true, tab: req.body.back === 'seats' ? 'seats' : 'setup', notice });
  } catch (err) {
    console.error('[network] setup failed:', err.message);
    return reply(req, res, { ok: false, tab: 'setup', notice: 'Could not save the network.', status: 500 });
  }
});

router.post('/trades', async (req, res) => {
  if (!canManage(req)) return reply(req, res, { ok: false, tab: 'setup', notice: 'Only owners and admins can add trades.', status: 403 });
  try {
    const network = await loadNetwork(req);
    const name = String(req.body.name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!name) return reply(req, res, { ok: false, tab: 'setup', notice: 'Name the trade, e.g. Interior designers.' });
    const builtIn = trades.DEFAULT_TRADES.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (builtIn) {
      const enabled = network.trades.includes(builtIn.slug);
      if (!enabled) await store.saveNetwork({ ...network, trades: network.trades.concat(builtIn.slug) });
      return reply(req, res, { ok: true, tab: 'setup', notice: enabled ? `${builtIn.name} is already in your network.` : `${builtIn.name} is a built-in trade — turned it on.` });
    }
    const slug = trades.customSlug(name);
    const current = trades.normalizeCustomTrades(network.customTrades);
    if (!slug) return reply(req, res, { ok: false, tab: 'setup', notice: 'Name the trade with letters or numbers.' });
    if (current.some((t) => t.slug === slug)) {
      if (!network.trades.includes(slug)) await store.saveNetwork({ ...network, trades: network.trades.concat(slug) });
      return reply(req, res, { ok: true, tab: 'setup', notice: `${name} is already in your network.` });
    }
    if (current.length >= trades.MAX_CUSTOM_TRADES) {
      return reply(req, res, { ok: false, tab: 'setup', notice: `Can't add more than ${trades.MAX_CUSTOM_TRADES} custom trades.` });
    }
    const keyword = String(req.body.keyword || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    await store.saveNetwork({
      ...network,
      customTrades: current.concat({ slug, name, keyword }),
      trades: network.trades.concat(slug),
    });
    return reply(req, res, { ok: true, tab: 'setup', notice: `${name} added. It now has an open seat in every zone.` });
  } catch (err) {
    console.error('[network] add trade failed:', err.message);
    return reply(req, res, { ok: false, tab: 'setup', notice: 'Could not add that trade.', status: 500 });
  }
});

router.post('/trades/:slug/toggle', async (req, res) => {
  if (!canManage(req)) return reply(req, res, { ok: false, tab: 'seats', notice: 'Only owners and admins can change trades.', status: 403 });
  try {
    const network = await loadNetwork(req);
    const slug = String(req.params.slug || '');
    const trade = trades.catalogFor(network).find((t) => t.slug === slug);
    if (!trade) return reply(req, res, { ok: false, tab: 'seats', notice: 'That trade was not found.', status: 404 });
    const turnOn = req.body.on === '1';
    const active = trades.tradesForNetwork(network).map((t) => t.slug);
    if (turnOn) {
      if (!active.includes(slug)) await store.saveNetwork({ ...network, trades: active.concat(slug) });
      return reply(req, res, { ok: true, tab: 'seats', notice: `${trade.name} is back on the list.` });
    }
    const zones = await store.listZones(network.id);
    const held = zones.filter((z) => ex.seatHolder(z, slug));
    if (held.length) {
      return reply(req, res, { ok: false, tab: 'seats', notice: `Can't hide ${trade.name} while a member holds its seat in ${held.map((z) => z.name).join(', ')}.` });
    }
    const remaining = active.filter((s) => s !== slug);
    if (!remaining.length) return reply(req, res, { ok: false, tab: 'seats', notice: "Can't hide the last trade in the network." });
    await store.saveNetwork({ ...network, trades: remaining });
    return reply(req, res, { ok: true, tab: 'seats', notice: `${trade.name} hidden. Bring it back from "Show hidden trades".` });
  } catch (err) {
    console.error('[network] toggle trade failed:', err.message);
    return reply(req, res, { ok: false, tab: 'seats', notice: 'Could not update that trade.', status: 500 });
  }
});

router.post('/trades/:slug/delete', async (req, res) => {
  if (!canManage(req)) return reply(req, res, { ok: false, tab: 'setup', notice: 'Only owners and admins can remove trades.', status: 403 });
  try {
    const network = await loadNetwork(req);
    const slug = String(req.params.slug || '');
    const trade = trades.normalizeCustomTrades(network.customTrades).find((t) => t.slug === slug);
    if (!trade) return reply(req, res, { ok: false, tab: 'setup', notice: 'That trade was not found.', status: 404 });
    const zones = await store.listZones(network.id);
    const held = zones.filter((z) => ex.seatHolder(z, slug));
    if (held.length) {
      return reply(req, res, { ok: false, tab: 'setup', notice: `Can't remove ${trade.name} while a member holds its seat in ${held.map((z) => z.name).join(', ')}. Edit that member's trades first.` });
    }
    await store.saveNetwork({
      ...network,
      customTrades: network.customTrades.filter((t) => t.slug !== slug),
      trades: network.trades.filter((s) => s !== slug),
    });
    return reply(req, res, { ok: true, tab: 'setup', notice: `Removed ${trade.name}.` });
  } catch (err) {
    console.error('[network] remove trade failed:', err.message);
    return reply(req, res, { ok: false, tab: 'setup', notice: 'Could not remove that trade.', status: 500 });
  }
});

router.post('/brand', (req, res, next) => {
  brandUpload.fields([{ name: 'logo', maxCount: 1 }, { name: 'hero', maxCount: 1 }])(req, res, (err) => {
    if (err) return reply(req, res, { ok: false, tab: 'brand', notice: `Could not upload that image: ${err.message}` });
    return next();
  });
}, async (req, res) => {
  if (!canManage(req)) return reply(req, res, { ok: false, tab: 'brand', notice: 'Only owners and admins can change branding.', status: 403 });
  try {
    const network = await loadNetwork(req);
    const body = req.body || {};
    const brand = { ...network.brand };
    ['appName', 'tagline', 'subtitle', 'accent', 'statValue', 'statLabel', 'statSuffix'].forEach((field) => {
      if (body[field] !== undefined) brand[field] = body[field];
    });
    const files = req.files || {};
    for (const kind of ['logo', 'hero']) {
      const file = files[kind] && files[kind][0];
      if (file && file.buffer) {
        const prepared = await networkBrand.prepareImage(kind, file.buffer);
        const stamp = await store.saveBrandImage(network.id, kind, prepared);
        brand[`${kind}Url`] = `/m/brand/${network.id}/${kind}?v=${Date.parse(stamp) || Date.now()}`;
      } else if (body[`remove_${kind}`] === 'on') {
        await store.deleteBrandImage(network.id, kind);
        brand[`${kind}Url`] = '';
      } else if (body[`${kind}Url`] !== undefined) {
        const typed = String(body[`${kind}Url`] || '').trim();
        const uploaded = String(brand[`${kind}Url`] || '').startsWith(`/m/brand/${network.id}/`);
        if (typed && typed !== brand[`${kind}Url`]) brand[`${kind}Url`] = typed;
        else if (!typed && !uploaded) brand[`${kind}Url`] = '';
      }
    }
    await store.saveNetwork({ ...network, brand });
    return reply(req, res, { ok: true, tab: 'brand', notice: 'Branding saved. Members see it the next time they open the app.' });
  } catch (err) {
    console.error('[network] brand save failed:', err.message);
    return reply(req, res, { ok: false, tab: 'brand', notice: 'Could not save branding.', status: 500 });
  }
});

router.post('/zones', async (req, res) => {
  if (!canManage(req)) return reply(req, res, { ok: false, tab: 'setup', notice: 'Only owners and admins can edit zones.', status: 403 });
  try {
    const network = await loadNetwork(req);
    const name = String(req.body.name || '').trim();
    if (!name) return reply(req, res, { ok: false, tab: 'setup', notice: 'Name the zone.' });
    const existing = req.body.id ? await store.getZone(network.id, String(req.body.id)) : null;
    const zone = await store.saveZone(network.id, {
      ...(existing || {}),
      name,
      cities: ex.parseCityList(req.body.cities),
      zips: ex.parseZipList(req.body.zips),
    });
    return reply(req, res, { ok: true, tab: 'setup', notice: existing ? `Updated ${zone.name}.` : `Added ${zone.name}.`, data: { zone } });
  } catch (err) {
    console.error('[network] zone save failed:', err.message);
    return reply(req, res, { ok: false, tab: 'setup', notice: 'Could not save that zone.', status: 500 });
  }
});

router.post('/zones/:id/delete', async (req, res) => {
  if (!canManage(req)) return reply(req, res, { ok: false, tab: 'setup', notice: 'Only owners and admins can edit zones.', status: 403 });
  try {
    const network = await loadNetwork(req);
    const zone = await store.getZone(network.id, req.params.id);
    if (!zone) return reply(req, res, { ok: false, tab: 'setup', notice: 'Zone not found.', status: 404 });
    await store.deleteZone(network.id, zone.id);
    const members = await store.listMembers(network.id);
    for (const member of members.filter((m) => m.zoneIds.includes(zone.id))) {
      await store.saveMember(network.id, { ...member, zoneIds: member.zoneIds.filter((id) => id !== zone.id) });
    }
    return reply(req, res, { ok: true, tab: 'setup', notice: `Removed ${zone.name}.` });
  } catch (err) {
    console.error('[network] zone delete failed:', err.message);
    return reply(req, res, { ok: false, tab: 'setup', notice: 'Could not remove that zone.', status: 500 });
  }
});

function seatNotice(prefix, conflicts, network) {
  if (!conflicts.length) return prefix;
  const list = conflicts.map((c) => `${trades.tradeLabel(c.tradeSlug, network)} in ${c.zoneName}`).join(', ');
  if (network.seatLimit === 1) return `${prefix} Already taken by another member: ${list}.`;
  return `${prefix} Already full (${network.seatLimit || 'no limit'} per trade): ${list}. Raise "Partners per trade" in Setup to add more.`;
}

router.post('/members', async (req, res) => {
  if (!canManage(req)) return reply(req, res, { ok: false, tab: 'members', notice: 'Only owners and admins can add members.', status: 403 });
  try {
    const network = await loadNetwork(req);
    const leadKey = String(req.body.leadKey || '').trim();
    const lead = leadKey ? await dbService.getLead(leadKey, req.workspaceId) : null;
    if (!lead || !lead.key) return reply(req, res, { ok: false, tab: 'members', notice: 'Pick a saved partner lead first.', status: 404 });
    const tradeSlugs = trades.normalizeTradeSlugs(listFrom(req.body.trades), trades.catalogFor(network));
    if (!tradeSlugs.length) return reply(req, res, { ok: false, tab: 'members', notice: 'Pick at least one trade.' });
    const existing = await store.findMemberByLeadKey(network.id, lead.key);
    const clean = (v) => (v && v !== 'N/A' ? String(v).trim() : '');
    const { member, conflicts } = await networkReferrals.saveMemberWithSeats(network, {
      ...(existing || {}),
      leadKey: lead.key,
      companyName: clean(lead.title) || 'Member',
      contactName: clean(lead.contactName) || (existing && existing.contactName) || '',
      phone: clean(lead.phone) || (existing && existing.phone) || '',
      email: clean(lead.email) || (existing && existing.email) || '',
      status: existing ? existing.status : 'active',
    }, { trades: tradeSlugs, zoneIds: listFrom(req.body.zoneIds) });

    const applied = referralNetwork.applyPartnerAction(lead, 'connect');
    if (applied.ok) await dbService.updateLead(lead.key, { referralPartner: applied.referralPartner }, req.workspaceId);

    let ghl = null;
    if (!existing && network.autoGhlSubaccount && !member.ghlLocationId && networkMembers.ghlSubaccountsAllowedFor(req.workspace)) {
      ghl = await networkMembers.provisionGhlSubaccount(network, member);
    }
    const notice = seatNotice(existing ? `Updated ${member.companyName}.` : `${member.companyName} joined the network.`, conflicts, network)
      + networkMembers.ghlNotice(ghl);
    return reply(req, res, { ok: true, tab: 'members', notice, data: { member: ghl && ghl.member ? ghl.member : member, conflicts, ghl } });
  } catch (err) {
    console.error('[network] add member failed:', err.message);
    return reply(req, res, { ok: false, tab: 'members', notice: 'Could not add that member.', status: 500 });
  }
});

router.post('/members/:id/seats', async (req, res) => {
  if (!canManage(req)) return reply(req, res, { ok: false, tab: 'members', notice: 'Only owners and admins can change seats.', status: 403 });
  try {
    const network = await loadNetwork(req);
    const member = await store.getMember(network.id, req.params.id);
    if (!member) return reply(req, res, { ok: false, tab: 'members', notice: 'Member not found.', status: 404 });
    const { member: saved, conflicts } = await networkReferrals.saveMemberWithSeats(network, member, {
      trades: trades.normalizeTradeSlugs(listFrom(req.body.trades), trades.catalogFor(network)),
      zoneIds: listFrom(req.body.zoneIds),
    });
    return reply(req, res, { ok: true, tab: 'members', notice: seatNotice(`Seats saved for ${saved.companyName}.`, conflicts, network), data: { member: saved, conflicts } });
  } catch (err) {
    console.error('[network] seats failed:', err.message);
    return reply(req, res, { ok: false, tab: 'members', notice: 'Could not save those seats.', status: 500 });
  }
});

router.post('/members/:id/trades/:slug/remove', async (req, res) => {
  const tab = req.body.back === 'seats' ? 'seats' : 'members';
  if (!canManage(req)) return reply(req, res, { ok: false, tab, notice: 'Only owners and admins can change seats.', status: 403 });
  try {
    const network = await loadNetwork(req);
    const member = await store.getMember(network.id, req.params.id);
    if (!member) return reply(req, res, { ok: false, tab, notice: 'Member not found.', status: 404 });
    const tradeName = trades.tradeLabel(req.params.slug, network);
    if (!member.trades.includes(req.params.slug)) return reply(req, res, { ok: true, tab, notice: `${member.companyName} is not in ${tradeName}.` });
    const { seated } = await networkReferrals.removeMemberFromTrade(network, member, req.params.slug);
    const notice = `Removed ${member.companyName} from ${tradeName}.${seated.length ? ` Seated ${seated.join(', ')}.` : ''}`;
    return reply(req, res, { ok: true, tab, notice });
  } catch (err) {
    console.error('[network] remove from trade failed:', err.message);
    return reply(req, res, { ok: false, tab, notice: 'Could not remove that member from the trade.', status: 500 });
  }
});

router.post('/members/:id/remove', async (req, res) => {
  if (!canManage(req)) return reply(req, res, { ok: false, tab: 'members', notice: 'Only owners and admins can remove members.', status: 403 });
  try {
    const network = await loadNetwork(req);
    const member = await store.getMember(network.id, req.params.id);
    if (!member) return reply(req, res, { ok: false, tab: 'members', notice: 'Member not found.', status: 404 });
    const { seated } = await networkReferrals.removeMember(network, member);
    const notice = `Removed ${member.companyName} from the network.${seated.length ? ` Seated ${seated.join(', ')}.` : ''}`;
    return reply(req, res, { ok: true, tab: 'members', notice });
  } catch (err) {
    console.error('[network] remove member failed:', err.message);
    return reply(req, res, { ok: false, tab: 'members', notice: 'Could not remove that member.', status: 500 });
  }
});

router.post('/members/:id/status', async (req, res) => {
  if (!canManage(req)) return reply(req, res, { ok: false, tab: 'members', notice: 'Only owners and admins can pause members.', status: 403 });
  try {
    const network = await loadNetwork(req);
    const member = await store.getMember(network.id, req.params.id);
    if (!member) return reply(req, res, { ok: false, tab: 'members', notice: 'Member not found.', status: 404 });
    const status = req.body.status === 'paused' ? 'paused' : 'active';
    const saved = await store.saveMember(network.id, { ...member, status });
    return reply(req, res, { ok: true, tab: 'members', notice: status === 'paused' ? `${saved.companyName} paused — their seats stop receiving referrals.` : `${saved.companyName} is active again.` });
  } catch (err) {
    console.error('[network] member status failed:', err.message);
    return reply(req, res, { ok: false, tab: 'members', notice: 'Could not update that member.', status: 500 });
  }
});

router.post('/members/:id/review-links', async (req, res) => {
  if (!canManage(req)) return reply(req, res, { ok: false, tab: 'members', notice: 'Only owners and admins can edit review links.', status: 403 });
  try {
    const network = await loadNetwork(req);
    const member = await store.getMember(network.id, req.params.id);
    if (!member) return reply(req, res, { ok: false, tab: 'members', notice: 'Member not found.', status: 404 });
    const body = req.body || {};
    const links = store.normalizeReviewLinks(reviewPage.linksFromForm(body));
    const rejected = reviewPage.firstRejectedLink(body, links);
    if (rejected) return reply(req, res, { ok: false, tab: 'members', notice: `That ${rejected} link for ${member.companyName} doesn't look like a web address.` });
    const withSlug = await store.ensureReviewSlug(network.id, member);
    const saved = await store.saveMember(network.id, { ...withSlug, reviewLinks: links });
    return reply(req, res, { ok: true, tab: 'members', notice: `Review links saved for ${saved.companyName}.`, data: { reviewLinks: saved.reviewLinks } });
  } catch (err) {
    console.error('[network] review links failed:', err.message);
    return reply(req, res, { ok: false, tab: 'members', notice: 'Could not save those review links.', status: 500 });
  }
});

router.post('/members/:id/ghl', async (req, res) => {
  if (!canManage(req)) return reply(req, res, { ok: false, tab: 'members', notice: 'Only owners and admins can create GHL sub-accounts.', status: 403 });
  if (!networkMembers.ghlSubaccountsAllowedFor(req.workspace)) return reply(req, res, { ok: false, tab: 'members', notice: 'This workspace does not create GHL sub-accounts.', status: 403 });
  try {
    const network = await loadNetwork(req);
    const member = await store.getMember(network.id, req.params.id);
    if (!member) return reply(req, res, { ok: false, tab: 'members', notice: 'Member not found.', status: 404 });
    const ghl = await networkMembers.provisionGhlSubaccount(network, member);
    return reply(req, res, { ok: !!ghl.ok, tab: 'members', notice: `${member.companyName}:${networkMembers.ghlNotice(ghl)}`, data: { ghl } });
  } catch (err) {
    console.error('[network] ghl provision failed:', err.message);
    return reply(req, res, { ok: false, tab: 'members', notice: 'Could not create the GHL sub-account.', status: 500 });
  }
});

router.post('/applications/:id/approve', async (req, res) => {
  if (!canManage(req)) return reply(req, res, { ok: false, tab: 'applications', notice: 'Only owners and admins can approve applicants.', status: 403 });
  try {
    const network = await loadNetwork(req);
    const result = await networkMembers.approveApplication({
      network,
      applicationId: req.params.id,
      zoneIds: listFrom(req.body.zoneIds),
      tradeSlugs: listFrom(req.body.trades),
      baseUrl: notify.baseUrlFromReq(req),
    });
    if (!result.ok) return reply(req, res, { ok: false, tab: 'applications', notice: result.error });
    let notice = seatNotice(`${result.member.companyName} joined the network.`, result.conflicts || [], network);
    notice += networkMembers.ghlNotice(result.ghl);
    notice += result.notified && result.notified.ok
      ? ` App link sent by ${result.notified.channel === 'sms' ? 'text' : 'email'}.`
      : ' App link not sent — use "Text app link" on the member.';
    return reply(req, res, { ok: true, tab: 'applications', notice, data: { member: result.member } });
  } catch (err) {
    console.error('[network] approve failed:', err.message);
    return reply(req, res, { ok: false, tab: 'applications', notice: 'Could not approve that applicant.', status: 500 });
  }
});

router.post('/applications/:id/reject', async (req, res) => {
  if (!canManage(req)) return reply(req, res, { ok: false, tab: 'applications', notice: 'Only owners and admins can reject applicants.', status: 403 });
  try {
    const network = await loadNetwork(req);
    const result = await networkMembers.rejectApplication({ network, applicationId: req.params.id });
    if (!result.ok) return reply(req, res, { ok: false, tab: 'applications', notice: result.error });
    return reply(req, res, { ok: true, tab: 'applications', notice: `Rejected ${result.application.companyName}.` });
  } catch (err) {
    console.error('[network] reject failed:', err.message);
    return reply(req, res, { ok: false, tab: 'applications', notice: 'Could not reject that applicant.', status: 500 });
  }
});

function previewDate(daysAhead) {
  return new Date(Date.now() + daysAhead * 86400000).toISOString().slice(0, 10);
}

// The real member Home screen with demo numbers, framed as an iPhone on the App branding tab.
router.get('/brand/preview', async (req, res, next) => {
  try {
    const network = await loadNetwork(req);
    const base = '/network/brand/preview';
    res.set('Cache-Control', 'no-store');
    return res.render('member_app/home', {
      preview: true,
      network,
      brand: networkBrand.brandView(network),
      member: { companyName: 'Patrick Plumbing', status: 'active' },
      greetingName: 'Patrick',
      base,
      active: 'home',
      icons: MEMBER_APP_ICONS,
      flash: null,
      tiles: [
        { key: 'sent', label: 'Sent', value: 7, href: base },
        { key: 'received', label: 'Received', value: 6, href: base },
        { key: 'pending', label: 'Pending', value: 3, href: base },
        { key: 'completed', label: 'Completed', value: 8, href: base },
      ],
      wonValue: '$12,400',
      upcoming: [
        { href: base, date: previewDate(1), customerName: 'Avery Moss', title: 'Kitchen floor install', whenLabel: 'Tomorrow · 9:00 AM', durationLabel: '1 day', status: 'scheduled', statusLabel: 'Scheduled', valueLabel: '$4,800' },
        { href: base, date: previewDate(3), customerName: 'Jordan Reyes', title: 'Hallway LVP estimate', whenLabel: 'In 3 days · 2:30 PM', durationLabel: '1 hr', status: 'estimate', statusLabel: 'Estimate', valueLabel: '$1,250' },
      ],
      waiting: [
        { id: 'demo1', customer: { name: 'Avery Moss', city: 'Camas' }, trade: 'Roofing', from: 'Camas Electric' },
        { id: 'demo2', customer: { name: 'Jordan Reyes', city: 'Washougal' }, trade: 'HVAC', from: 'Evergreen Landscaping' },
      ],
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/members/:id/portal-link', async (req, res) => {
  try {
    const network = await loadNetwork(req);
    const member = await store.getMember(network.id, req.params.id);
    if (!member) return res.status(404).json({ success: false, error: 'Member not found.' });
    return res.json({ success: true, url: notify.memberPortalLink(notify.baseUrlFromReq(req), network, member) });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Could not build that link.' });
  }
});

router.post('/members/:id/send-portal-link', async (req, res) => {
  try {
    const network = await loadNetwork(req);
    const member = await store.getMember(network.id, req.params.id);
    if (!member) return reply(req, res, { ok: false, tab: 'members', notice: 'Member not found.', status: 404 });
    const sent = await notify.sendMemberPortalLink({ network, member, baseUrl: notify.baseUrlFromReq(req) });
    const notice = sent.ok
      ? `App link sent to ${member.companyName} by ${sent.channel === 'sms' ? 'text' : 'email'}.`
      : `Could not send the link: ${sent.error}`;
    return reply(req, res, { ok: sent.ok, tab: 'members', notice });
  } catch (err) {
    console.error('[network] portal link send failed:', err.message);
    return reply(req, res, { ok: false, tab: 'members', notice: 'Could not send the member page link.', status: 500 });
  }
});

function sendNotice(result) {
  const r = result.referral;
  if (r.status === 'unrouted') {
    return `Referral saved but not routed: ${ex.UNROUTED_REASONS[r.unroutedReason] || 'no seat holder.'} A task was added so you can assign it.`;
  }
  const n = result.notified;
  if (n && n.ok) return `Referral sent and the member was notified by ${n.channel === 'sms' ? 'text' : 'email'}.`;
  const why = n && n.error ? ` (${String(n.error).replace(/[.\s]+$/, '')})` : '';
  return `Referral sent. The member was not notified${why}. Copy their member page link from Members.`;
}

router.post('/referrals', async (req, res) => {
  try {
    const network = await loadNetwork(req);
    const result = await networkReferrals.sendReferral({
      network,
      input: req.body || {},
      fromMemberId: 'operator',
      by: userEmail(req) || 'operator',
      baseUrl: notify.baseUrlFromReq(req),
    });
    if (!result.ok) return reply(req, res, { ok: false, tab: 'send', notice: result.error });
    return reply(req, res, { ok: true, tab: 'referrals', notice: sendNotice(result), data: { referral: result.referral } });
  } catch (err) {
    console.error('[network] send referral failed:', err.message);
    return reply(req, res, { ok: false, tab: 'send', notice: 'Could not send that referral.', status: 500 });
  }
});

router.post('/referrals/:id/action', async (req, res) => {
  try {
    const network = await loadNetwork(req);
    const action = String(req.body.action || '').trim();
    const result = await networkReferrals.actOnReferral({
      network,
      referralId: req.params.id,
      action,
      opts: {
        value: req.body.value,
        text: req.body.text,
        toMemberId: String(req.body.toMemberId || '').trim(),
        by: userEmail(req) || 'operator',
      },
      baseUrl: notify.baseUrlFromReq(req),
    });
    if (!result.ok) return reply(req, res, { ok: false, tab: 'referrals', notice: result.error });
    let notice = `Marked ${ex.STATUS_LABELS[result.referral.status].toLowerCase()}.`;
    if (action === 'note') notice = 'Note added.';
    if (action === 'assign') notice = result.notified && result.notified.ok ? 'Assigned and the member was notified.' : `Assigned. The member was not notified${result.notified && result.notified.error ? ` (${String(result.notified.error).replace(/[.\s]+$/, '')})` : ''}.`;
    return reply(req, res, { ok: true, tab: 'referrals', notice, data: { referral: result.referral } });
  } catch (err) {
    console.error('[network] referral action failed:', err.message);
    return reply(req, res, { ok: false, tab: 'referrals', notice: 'Could not update that referral.', status: 500 });
  }
});

module.exports = router;
