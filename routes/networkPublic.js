/**
 * No-login pages for network members, reached from signed links in texts:
 *   /r/:token     one referral — accept, decline, booked, won, lost, note
 *   /r/m/:token   member page — referrals sent to them + send a referral
 */

const express = require('express');
const store = require('../services/networkStore');
const ex = require('../services/referralExchange');
const trades = require('../services/networkTrades');
const notify = require('../services/networkNotify');
const networkReferrals = require('../services/networkReferrals');
const { verifyNetworkToken, createMemberPortalToken } = require('../services/networkLinkSign');

const router = express.Router();
const form = express.urlencoded({ extended: true });

const ACTION_DONE = {
  accept: 'Accepted — reach out to the homeowner.',
  decline: 'Declined. The network operator will reassign it.',
  book: 'Marked booked.',
  win: 'Marked won. Thanks for reporting the job value.',
  lose: 'Marked lost.',
  note: 'Note saved.',
};

function noStore(res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
}

function unavailable(res, message) {
  noStore(res);
  return res.status(404).render('network_referral_public', { invalid: true, message: message || '' });
}

async function loadMemberContext(payload) {
  if (!payload) return null;
  const network = await store.getNetwork(payload.networkId);
  if (!network) return null;
  const member = await store.getMember(network.id, payload.memberId);
  if (!member) return null;
  return { network, member };
}

function referralView(referral, membersById) {
  const from = referral.fromMemberId === 'operator'
    ? 'the network'
    : ((membersById[referral.fromMemberId] || {}).companyName || 'a member');
  return {
    id: referral.id,
    status: referral.status,
    statusLabel: ex.STATUS_LABELS[referral.status] || referral.status,
    trade: trades.tradeLabel(referral.tradeSlug),
    homeowner: referral.homeowner || {},
    from,
    value: referral.value ? `$${Math.round(referral.value).toLocaleString('en-US')}` : '',
    actions: ex.allowedActions(referral),
    events: (referral.events || []).filter((e) => e.type === 'note').slice(-5).reverse(),
    createdAt: referral.createdAt,
  };
}

async function renderReferral(req, res, token, flash) {
  const payload = verifyNetworkToken(token, 'ref');
  const ctx = await loadMemberContext(payload);
  if (!ctx) return unavailable(res);
  const referral = await store.getReferral(ctx.network.id, payload.referralId);
  if (!referral) return unavailable(res);
  if (referral.toMemberId !== ctx.member.id) {
    return unavailable(res, 'This referral was moved to another member.');
  }
  const members = await store.listMembers(ctx.network.id);
  const membersById = Object.fromEntries(members.map((m) => [m.id, m]));
  const portalToken = createMemberPortalToken({ networkId: ctx.network.id, memberId: ctx.member.id });
  noStore(res);
  return res.status(flash && flash.error ? 400 : 200).render('network_referral_public', {
    invalid: false,
    token,
    network: ctx.network,
    member: ctx.member,
    referral: referralView(referral, membersById),
    portalHref: `/m/${encodeURIComponent(portalToken)}`,
    flash: flash || null,
  });
}

// Old member page links now open the member app.
router.get('/r/m/:token', (req, res) => res.redirect(302, `/m/${encodeURIComponent(req.params.token)}`));

router.post('/r/m/:token/referrals', form, async (req, res) => {
  const token = req.params.token;
  try {
    const payload = verifyNetworkToken(token, 'mem');
    const ctx = await loadMemberContext(payload);
    if (!ctx) return unavailable(res);
    if (ctx.member.status !== 'active') {
      return renderPortal(req, res, token, { error: 'Your membership is paused. Contact the network operator.' }, req.body);
    }
    const result = await networkReferrals.sendReferral({
      network: ctx.network,
      input: req.body || {},
      fromMemberId: ctx.member.id,
      by: ctx.member.companyName,
      baseUrl: notify.baseUrlFromReq(req),
    });
    if (!result.ok) return renderPortal(req, res, token, { error: result.error }, req.body);
    const message = result.referral.status === 'sent'
      ? 'Referral sent. The member was notified.'
      : 'Referral received. The network operator will match it with a member.';
    return renderPortal(req, res, token, { ok: message });
  } catch (err) {
    console.error('[network-public] member send failed:', err.message);
    return renderPortal(req, res, token, { error: 'Could not send that referral. Try again.' }, req.body);
  }
});

async function renderPortal(req, res, token, flash, formValues) {
  const payload = verifyNetworkToken(token, 'mem');
  const ctx = await loadMemberContext(payload);
  if (!ctx) return unavailable(res);
  const [members, referrals, zones] = await Promise.all([
    store.listMembers(ctx.network.id),
    store.listReferrals(ctx.network.id),
    store.listZones(ctx.network.id),
  ]);
  const membersById = Object.fromEntries(members.map((m) => [m.id, m]));
  const baseUrl = notify.baseUrlFromReq(req);
  const received = referrals
    .filter((r) => r.toMemberId === ctx.member.id)
    .slice(0, 50)
    .map((r) => ({
      ...referralView(r, membersById),
      href: notify.referralLink(baseUrl, ctx.network, r, ctx.member.id).replace(baseUrl, ''),
    }));
  const given = referrals
    .filter((r) => r.fromMemberId === ctx.member.id)
    .slice(0, 20)
    .map((r) => ({
      trade: trades.tradeLabel(r.tradeSlug, ctx.network),
      homeowner: (r.homeowner || {}).name || '',
      to: r.toMemberId ? ((membersById[r.toMemberId] || {}).companyName || 'Member') : 'Being matched',
      statusLabel: ex.STATUS_LABELS[r.status] || r.status,
      status: r.status,
    }));
  const directory = trades.tradesForNetwork(ctx.network)
    .filter((t) => !ctx.member.trades.includes(t.slug))
    .map((t) => {
      const holders = zones
        .map((z) => ex.seatHolder(z, t.slug))
        .filter(Boolean)
        .map((id) => membersById[id])
        .filter((m) => m && m.status === 'active' && m.id !== ctx.member.id);
      return { ...t, holders: [...new Set(holders.map((m) => m.companyName))] };
    });
  noStore(res);
  return res.status(flash && flash.error ? 400 : 200).render('network_member_portal', {
    invalid: false,
    token,
    network: ctx.network,
    member: ctx.member,
    stats: ex.memberStats(referrals, ctx.member.id),
    received,
    given,
    directory,
    flash: flash || null,
    formValues: flash && flash.error ? (formValues || {}) : {},
  });
}

router.get('/r/:token', async (req, res) => {
  try {
    return await renderReferral(req, res, req.params.token, null);
  } catch (err) {
    console.error('[network-public] referral view failed:', err.message);
    return unavailable(res);
  }
});

router.post('/r/:token', form, async (req, res) => {
  const token = req.params.token;
  try {
    const payload = verifyNetworkToken(token, 'ref');
    const ctx = await loadMemberContext(payload);
    if (!ctx) return unavailable(res);
    const action = String(req.body.action || '').trim();
    if (!ACTION_DONE[action]) return renderReferral(req, res, token, { error: 'Unknown action.' });
    const result = await networkReferrals.actOnReferral({
      network: ctx.network,
      referralId: payload.referralId,
      action,
      opts: { value: req.body.value, text: req.body.text, by: ctx.member.companyName },
      actorMemberId: ctx.member.id,
      baseUrl: notify.baseUrlFromReq(req),
    });
    if (!result.ok) return renderReferral(req, res, token, { error: result.error });
    return renderReferral(req, res, token, { ok: ACTION_DONE[action] });
  } catch (err) {
    console.error('[network-public] referral action failed:', err.message);
    return renderReferral(req, res, token, { error: 'Could not save that. Try again.' });
  }
});

module.exports = router;
