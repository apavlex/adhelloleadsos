/**
 * Auto SMS reminders for upcoming member-app jobs.
 *
 * Owner sets lead time on the job (1h / 2h / 1 day / …). When due, we text the
 * business owner and optionally the customer via the network's GHL connection.
 */

const { DateTime } = require('luxon');
const dbService = require('./database');
const store = require('./networkStore');
const work = require('./memberWork');
const notify = require('./networkNotify');
const ghlMessaging = require('./ghlMessaging');
const workspaceIntegrations = require('./workspaceIntegrations');

const JOB_KEY = /^netjob:([a-z0-9]+):([a-z0-9]+):([a-z0-9]+)$/i;
/** Still fire if the tick lands a few hours late. */
const LOOKBACK_MS = 6 * 60 * 60 * 1000;
const MAX_PER_TICK = 40;

function visitStartMs(job) {
  if (!job || !job.date) return null;
  const time = job.time || '09:00';
  const tz = work.cleanTimeZone(job.timeZone) || 'America/Los_Angeles';
  const dt = DateTime.fromISO(`${job.date}T${time}`, { zone: tz });
  return dt.isValid ? dt.toMillis() : null;
}

function dueForSide(job, side, now) {
  if (!job || !work.isOpen(job)) return false;
  const before = side === 'owner' ? job.remindOwnerBeforeMins : job.remindCustomerBeforeMins;
  const stamped = side === 'owner' ? job.ownerRemindedAt : job.customerRemindedAt;
  if (!before || stamped) return false;
  const start = visitStartMs(job);
  if (start == null) return false;
  const fireAt = start - before * 60000;
  return now >= fireAt && now <= fireAt + LOOKBACK_MS;
}

function formatWhen(job) {
  const start = visitStartMs(job);
  if (start == null) return job.date || '';
  const tz = work.cleanTimeZone(job.timeZone) || 'America/Los_Angeles';
  return DateTime.fromMillis(start, { zone: tz }).toFormat("ccc, LLL d 'at' h:mm a");
}

async function listCandidateJobs() {
  const keys = await dbService.listStorageKeysWithPrefix('netjob:');
  const out = [];
  for (const key of keys) {
    const m = String(key).match(JOB_KEY);
    if (!m) continue;
    const networkId = m[1];
    const memberId = m[2];
    const job = await work.getJob(networkId, memberId, m[3]);
    if (!job) continue;
    if (!job.remindOwnerBeforeMins && !job.remindCustomerBeforeMins) continue;
    if (!job.date || !work.isOpen(job)) continue;
    out.push({ networkId, memberId, job });
  }
  return out;
}

async function sendOwnerReminder(network, member, job, customer) {
  const when = formatWhen(job);
  const who = (customer && customer.name) || 'your customer';
  const addr = customer && customer.address ? ` · ${customer.address}` : '';
  const sms = `Reminder: ${job.title} with ${who} ${when}${addr}`;
  return notify.messageMember(network, member, {
    sms,
    subject: `Upcoming job: ${job.title}`,
    email: `<p>${sms}</p>`,
  });
}

async function sendCustomerReminder(network, member, job, customer) {
  const phone = customer && customer.phone;
  if (!phone) return { ok: false, error: 'no_phone' };
  const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(network.ownerWorkspaceId);
  const ready = ghlMessaging.messagingReady(integrationEnv);
  if (!ready.smsReady) return { ok: false, error: ready.configured ? 'no_from' : 'no_ghl' };
  const company = member.companyName || 'us';
  const name = String(customer.name || '').trim().split(/\s+/)[0] || 'there';
  const when = formatWhen(job);
  const message = `Hi ${name} — reminder from ${company}: you're on the schedule ${when}. Reply if you need to reschedule.`;
  try {
    const result = await ghlMessaging.sendSmsToPerson({
      name: customer.name || name,
      phone,
      message,
      companyName: company,
      integrationEnv,
    });
    return { ok: true, messageId: result.messageId || '', provider: result.provider || 'ghl' };
  } catch (err) {
    return { ok: false, error: err.message || 'sms_failed' };
  }
}

async function processJobReminders({ networkId, memberId, job }, now = Date.now()) {
  const needOwner = dueForSide(job, 'owner', now);
  const needCustomer = dueForSide(job, 'customer', now);
  if (!needOwner && !needCustomer) return { sent: 0, skipped: 1 };

  const [network, member, customer] = await Promise.all([
    store.getNetwork(networkId),
    store.getMember(networkId, memberId),
    work.getCustomer(networkId, memberId, job.customerId),
  ]);
  if (!network || !member) return { sent: 0, skipped: 1 };

  let sent = 0;
  let next = { ...job };
  const stamp = new Date(now).toISOString();

  if (needOwner) {
    const result = await sendOwnerReminder(network, member, job, customer);
    if (result && result.ok) {
      next.ownerRemindedAt = stamp;
      sent += 1;
    }
  }

  if (needCustomer) {
    const result = await sendCustomerReminder(network, member, job, customer);
    if (result.ok) {
      next.customerRemindedAt = stamp;
      sent += 1;
    }
  }

  if (next.ownerRemindedAt !== job.ownerRemindedAt || next.customerRemindedAt !== job.customerRemindedAt) {
    await work.writeJob(networkId, memberId, next);
  }
  return { sent, skipped: sent ? 0 : 1 };
}

/** Cron entry: fire due visit reminders. */
async function runJobVisitReminders(now = Date.now()) {
  const candidates = await listCandidateJobs();
  let due = 0;
  let sent = 0;
  let skipped = 0;
  for (const row of candidates) {
    if (due >= MAX_PER_TICK) break;
    const ownerDue = dueForSide(row.job, 'owner', now);
    const customerDue = dueForSide(row.job, 'customer', now);
    if (!ownerDue && !customerDue) continue;
    due += 1;
    // Re-read in case the member edited the job mid-tick
    const fresh = await work.getJob(row.networkId, row.memberId, row.job.id);
    if (!fresh) {
      skipped += 1;
      continue;
    }
    const result = await processJobReminders(
      { networkId: row.networkId, memberId: row.memberId, job: fresh },
      now,
    );
    sent += result.sent;
    skipped += result.skipped;
  }
  if (sent || due) {
    console.log(`[SCHEDULER] Job visit reminders: sent=${sent} due=${due} skipped=${skipped}`);
  }
  return { due, sent, skipped };
}

module.exports = {
  LOOKBACK_MS,
  visitStartMs,
  dueForSide,
  formatWhen,
  listCandidateJobs,
  processJobReminders,
  runJobVisitReminders,
};
