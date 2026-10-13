/**
 * Public claim page for outside share invites.
 *   GET/POST /share/c/:token
 * Mounted before ensureAuthenticated (no Google / workspace session).
 */
const express = require('express');
const shareInvite = require('../services/memberShareInvite');
const store = require('../services/networkStore');
const networkBrand = require('../services/networkBrand');
const notify = require('../services/networkNotify');
const { ICONS } = require('../services/memberAppIcons');
const { getPublicBaseUrl } = require('../lib/publicBaseUrl');

const router = express.Router();
const form = express.urlencoded({ extended: false, limit: '16kb' });

function noStore(res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

async function loadClaimContext(token) {
  const invite = await shareInvite.getInvite(token);
  if (!invite) return { ok: false, error: 'That invite link is invalid or expired.', status: 404 };
  if (invite.status === 'claimed' && invite.claimedMemberId) {
    const network = await store.getNetwork(invite.networkId);
    const member = network ? await store.getMember(network.id, invite.claimedMemberId) : null;
    if (network && member) {
      return { ok: true, already: true, invite, network, member };
    }
  }
  if (shareInvite.isExpired(invite)) {
    if (invite.status === 'pending') {
      await shareInvite.saveInvite({ ...invite, status: 'expired' });
    }
    return { ok: false, error: 'That invite has expired. Ask them to share again.', status: 410 };
  }
  const network = await store.getNetwork(invite.networkId);
  if (!network) return { ok: false, error: 'That network is no longer available.', status: 404 };
  const fromMember = await store.getMember(network.id, invite.fromMemberId);
  if (!fromMember || fromMember.status !== 'active') {
    return { ok: false, error: 'The person who shared this is no longer active.', status: 410 };
  }
  return { ok: true, invite, network, fromMember };
}

function renderClaim(res, {
  invite,
  network,
  fromMember,
  formValues = {},
  errors = [],
  status = 200,
  claimed = null,
}) {
  noStore(res);
  const brand = networkBrand.brandView(network);
  const who = (fromMember && (fromMember.contactName || fromMember.companyName)) || 'A partner';
  return res.status(status).render('share_invite_claim', {
    brand,
    icons: ICONS,
    invite,
    network,
    fromMember,
    who,
    customerName: (invite && invite.customerName) || 'a contact',
    form: formValues,
    errors,
    claimed,
  });
}

router.get('/share/c/:token', async (req, res, next) => {
  try {
    const token = String(req.params.token || '').trim().toLowerCase();
    const ctx = await loadClaimContext(token);
    if (!ctx.ok) {
      return renderClaim(res, {
        invite: null,
        network: null,
        fromMember: null,
        errors: [ctx.error],
        status: ctx.status || 404,
      });
    }
    if (ctx.already) {
      const baseUrl = getPublicBaseUrl(req);
      const portal = notify.memberPortalLink(baseUrl, ctx.network, ctx.member);
      const href = ctx.invite.claimedCustomerId
        ? `${portal}/customers/c/${encodeURIComponent(ctx.invite.claimedCustomerId)}`
        : portal;
      return renderClaim(res, {
        invite: ctx.invite,
        network: ctx.network,
        fromMember: null,
        claimed: { already: true, portal: href },
      });
    }
    return renderClaim(res, {
      invite: ctx.invite,
      network: ctx.network,
      fromMember: ctx.fromMember,
      formValues: {
        companyName: ctx.invite.companyName || '',
        contactName: ctx.invite.contactName || '',
        phone: ctx.invite.phone || '',
        email: ctx.invite.email || '',
      },
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/share/c/:token', form, async (req, res, next) => {
  try {
    const token = String(req.params.token || '').trim().toLowerCase();
    const body = req.body || {};
    const formValues = {
      companyName: String(body.companyName || '').trim(),
      contactName: String(body.contactName || '').trim(),
      phone: String(body.phone || '').trim(),
      email: String(body.email || '').trim(),
    };
    const result = await shareInvite.claimInvite(token, formValues, {
      baseUrl: getPublicBaseUrl(req),
    });
    if (!result.ok) {
      const ctx = await loadClaimContext(token).catch(() => null);
      return renderClaim(res, {
        invite: ctx && ctx.invite,
        network: ctx && ctx.network,
        fromMember: ctx && ctx.fromMember,
        formValues,
        errors: [result.error || 'Could not join. Try again.'],
        status: 400,
      });
    }
    return renderClaim(res, {
      invite: result.invite,
      network: result.network,
      fromMember: null,
      claimed: {
        already: !!result.already,
        created: !!result.created,
        portal: result.portal,
      },
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
