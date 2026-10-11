/**
 * Member-app “Request leads” (freemium): free app stays limited; requesting
 * lead packs requires an active (paid) agency workspace plan, then pings
 * AdHello / agency admins that the business is ready for more work.
 */

const dbService = require('./database');
const trials = require('./trials');
const store = require('./networkStore');
const contractorPortal = require('./contractorPortal');
const notify = require('./networkNotify');

const COOLDOWN_MS = 24 * 60 * 60 * 1000;
const DEFAULT_QTY = 25;

async function planAllowsLeadRequests(network) {
  if (!network || !network.ownerWorkspaceId) return false;
  const ws = await dbService.getWorkspace(network.ownerWorkspaceId);
  if (!ws) return false;
  // Paid / activated workspace — not unpaid trial or expired trial.
  return !trials.isRestricted(ws);
}

function pendingLeadRequests(appointment) {
  if (!appointment || !Array.isArray(appointment.pendingRequests)) return 0;
  return appointment.pendingRequests.filter((r) => !r.type || r.type === 'leads').length;
}

function onCooldown(member, now = Date.now()) {
  const last = Date.parse((member && member.leadRequestAt) || 0);
  if (!last) return false;
  return now - last < COOLDOWN_MS;
}

async function leadRequestState(ctx) {
  const planActive = await planAllowsLeadRequests(ctx.network);
  const pending = pendingLeadRequests(ctx.appointment);
  const cooldown = onCooldown(ctx.member);
  const memberActive = ctx.member && ctx.member.status === 'active';
  return {
    planActive,
    pending,
    cooldown,
    memberActive,
    canRequest: planActive && memberActive && !cooldown,
    leadCreditsRemaining: ctx.appointment && ctx.appointment.leadCredits
      ? Number(ctx.appointment.leadCredits.remaining) || 0
      : null,
    defaultQuantity: DEFAULT_QTY,
  };
}

/**
 * Submit a lead-pack request and ping agency admins.
 * @returns {{ ok: true } | { ok: false, code: string, error: string }}
 */
async function requestMoreLeads(ctx, { quantity, note } = {}) {
  const state = await leadRequestState(ctx);
  if (!state.memberActive) {
    return { ok: false, code: 'paused', error: 'Your membership is paused, so lead requests can’t be sent.' };
  }
  if (!state.planActive) {
    return {
      ok: false,
      code: 'subscribe',
      error: 'Requesting leads is on the monthly plan. The app stays free — subscribe to unlock leads, SMS, and email.',
    };
  }
  if (state.cooldown) {
    return {
      ok: false,
      code: 'cooldown',
      error: 'You already requested leads recently. Your agency was pinged — try again tomorrow.',
    };
  }

  const qty = Math.max(1, Math.min(100, Math.round(Number(quantity) || DEFAULT_QTY)));
  const noteText = String(note || 'Ready for more work — requested from the member app.').trim().slice(0, 200);

  if (ctx.appointment && ctx.appointment.workspaceId && ctx.appointment.packageId) {
    const created = await contractorPortal.submitRequest(
      ctx.appointment.workspaceId,
      ctx.appointment.packageId,
      { type: 'leads', quantity: qty, note: noteText },
    );
    if (!created) {
      return { ok: false, code: 'failed', error: 'Could not send that request. Try again.' };
    }
  } else {
    const ping = await notify.notifyLeadRequest({
      network: ctx.network,
      member: ctx.member,
      quantity: qty,
      note: noteText,
    });
    if (!ping.ok) {
      return { ok: false, code: 'failed', error: ping.error || 'Could not ping your agency.' };
    }
  }

  await store.saveMember(ctx.network.id, {
    ...ctx.member,
    leadRequestAt: new Date().toISOString(),
  });

  return { ok: true, quantity: qty };
}

module.exports = {
  COOLDOWN_MS,
  DEFAULT_QTY,
  planAllowsLeadRequests,
  leadRequestState,
  requestMoreLeads,
  onCooldown,
  pendingLeadRequests,
};
