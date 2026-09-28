/**
 * Teammate onboarding emails sent through the workspace's own GHL sub-account:
 * an invite email when someone is invited, then one activation email per day after they join.
 */
const { DateTime } = require('luxon');
const dbService = require('./database');
const ghlClient = require('./ghlClient');
const { messagingReady } = require('./ghlMessaging');
const workspaceIntegrations = require('./workspaceIntegrations');
const { resolveWorkspaceTimezone } = require('./workspaceTimezone');
const activationService = require('./activationService');
const { onboardingForWorkspace, renderTemplate } = require('./onboardingConfig');

const TEAMMATE_TAG = 'agency os teammate';
const MAX_ATTEMPTS = 3;
const NOT_READY_MESSAGE =
  'GHL email is not set up for this workspace. Add the GHL API key, location ID, and "Email from" address in Workspace → Integrations.';

function normEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function enrollmentKey(workspaceId, email) {
  return `onboarding:${workspaceId}:${dbService._emailKeyFragment(normEmail(email))}`;
}

async function readEnrollment(workspaceId, email) {
  const raw = await dbService.peekStorageKey(enrollmentKey(workspaceId, email));
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

async function saveEnrollment(enr) {
  await dbService.putStorageKey(enrollmentKey(enr.workspaceId, enr.email), enr);
  return enr;
}

function appBaseUrl(fallback) {
  return String(process.env.BASE_URL || fallback || '').trim().replace(/\/+$/, '');
}

function absoluteLink(base, href) {
  const h = String(href || '/today');
  if (/^https?:\/\//i.test(h)) return h;
  return `${base || ''}${h.startsWith('/') ? h : `/${h}`}`;
}

function firstNameFrom(name) {
  const n = String(name || '').trim();
  if (!n || n.includes('@')) return '';
  return n.split(/\s+/)[0];
}

function bodyToHtml(text) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const linkify = (s) => s.replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, (u) => `<a href="${u}">${u}</a>`);
  return String(text || '')
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px;line-height:1.5">${linkify(esc(p)).replace(/\n/g, '<br/>')}</p>`)
    .join('');
}

function templateVars({ ws, cfg, name, baseUrl, stepIndex, inviteLink, inviterName }) {
  const step = stepIndex != null ? cfg.steps[stepIndex] : null;
  const wsName = (ws && ws.name) || 'Agency OS';
  return {
    first_name: firstNameFrom(name) || 'there',
    workspace_name: wsName,
    inviter_name: inviterName || `The ${wsName} team`,
    invite_link: inviteLink || absoluteLink(baseUrl, '/today'),
    app_link: absoluteLink(baseUrl, '/today'),
    day: step ? stepIndex + 1 : '',
    total_days: cfg.steps.length,
    step_title: step ? step.title : '',
    step_hint: step ? step.hint : '',
    step_link: step ? absoluteLink(baseUrl, step.href) : '',
  };
}

async function workspaceEmailEnv(workspaceId) {
  const env = await workspaceIntegrations.getResolvedIntegrationEnv(workspaceId);
  return { env, ready: messagingReady(env).emailReady };
}

/** Find the teammate in the workspace's GHL location by exact email, or create them. */
async function ensureTeammateContact(env, email, name) {
  const em = normEmail(email);
  const found = await ghlClient.searchContactByEmailOrPhone({ email: em }, env);
  if (found && found.id && normEmail(found.email) === em) {
    await ghlClient.addTagsToContact(found.id, [TEAMMATE_TAG], env).catch(() => {});
    return String(found.id);
  }
  const contact = { title: String(name || '').trim() || em.split('@')[0], email: em, companyName: '', tags: [TEAMMATE_TAG] };
  try {
    const created = await ghlClient.createContact(contact, env);
    const id = String((created && created.id) || '').trim();
    if (!id) throw new Error('GHL did not return a contact id.');
    return id;
  } catch (e) {
    const meta = e && e.body && e.body.meta;
    const dupId = String((meta && (meta.contactId || meta.contact_id || meta.id)) || '').trim();
    if (dupId) return dupId;
    throw e;
  }
}

async function sendTeammateEmail({ env, email, name, subject, body, contactId }) {
  const { emailFrom } = ghlClient.resolveConfig(env);
  let cid = String(contactId || '').trim();
  if (!cid) cid = await ensureTeammateContact(env, email, name);
  const res = await ghlClient.sendConversationMessage(
    {
      type: 'Email',
      contactId: cid,
      subject: String(subject || '').trim() || 'Welcome',
      html: bodyToHtml(body),
      message: String(body || '').trim(),
      emailFrom,
      emailTo: normEmail(email),
      status: 'pending',
    },
    env,
  );
  const messageId = String((res && (res.messageId || res.emailMessageId || res.id)) || '');
  return { contactId: cid, messageId };
}

/**
 * Email the invite link. Returns { sent: false, reason } when disabled; throws when GHL email is not ready.
 */
async function sendInviteEmail({ ws, email, inviteLink, inviterName, baseUrl }) {
  const cfg = onboardingForWorkspace(ws);
  if (!cfg.enabled || !cfg.sendInviteEmail) return { sent: false, reason: 'disabled' };
  const { env, ready } = await workspaceEmailEnv(ws.id);
  if (!ready) throw new Error(NOT_READY_MESSAGE);
  const vars = templateVars({ ws, cfg, name: '', baseUrl: appBaseUrl(baseUrl), inviteLink, inviterName });
  const out = await sendTeammateEmail({
    env,
    email,
    name: '',
    subject: renderTemplate(cfg.invite.subject, vars),
    body: renderTemplate(cfg.invite.body, vars),
  });
  return { sent: true, ...out };
}

function localNow(tz, now) {
  return DateTime.fromJSDate(now, { zone: 'utc' }).setZone(tz);
}

/** When step `index` becomes due: Day 1 right at enrollment, later days at sendHour on each following local day. */
function stepDueAt(enrolledAtIso, index, tz, sendHour) {
  const start = DateTime.fromISO(enrolledAtIso, { zone: 'utc' });
  if (index <= 0) return start.toJSDate();
  return start.setZone(tz).startOf('day').plus({ days: index }).set({ hour: sendHour }).toJSDate();
}

/**
 * Decide the next action for an enrollment at `now`: send | skip | wait | done.
 * At most one email per local day, and catch-up emails wait for the send hour.
 * Day 1 is the welcome email, so it is never skipped.
 */
function nextAction(enr, cfg, tz, now, completed) {
  const idx = enr.nextIndex || 0;
  if (idx >= cfg.steps.length) return { type: 'done' };
  const step = cfg.steps[idx];
  const due = stepDueAt(enr.enrolledAt, idx, tz, cfg.sendHour);
  if (now < due) return { type: 'wait', index: idx, dueAt: due };
  if (idx > 0) {
    const nowLocal = localNow(tz, now);
    if (nowLocal.hour < cfg.sendHour) return { type: 'wait', index: idx, dueAt: due };
    if (enr.lastSentAt) {
      const lastDay = DateTime.fromISO(enr.lastSentAt, { zone: 'utc' }).setZone(tz).toISODate();
      if (lastDay >= nowLocal.toISODate()) return { type: 'wait', index: idx, dueAt: due };
    }
  }
  if (idx > 0 && cfg.skipCompleted && completed && completed[step.id]) return { type: 'skip', index: idx };
  return { type: 'send', index: idx };
}

async function processEnrollment({ ws, cfg, env, ready, tz, enr, now }) {
  let changed = false;
  let completed = null;
  if (cfg.skipCompleted) {
    const act = await activationService.getState(enr.email, ws);
    completed = act.days;
  }
  for (let guard = 0; guard < cfg.steps.length + 1; guard++) {
    const action = nextAction(enr, cfg, tz, now, completed);
    if (action.type === 'done') {
      enr.status = 'done';
      enr.completedAt = enr.completedAt || now.toISOString();
      changed = true;
      break;
    }
    if (action.type === 'wait') break;
    const step = cfg.steps[action.index];
    enr.sent = enr.sent || {};
    if (action.type === 'skip') {
      enr.sent[step.id] = { at: now.toISOString(), skipped: true };
      enr.nextIndex = action.index + 1;
      changed = true;
      continue;
    }
    if (!ready) {
      if (enr.lastError !== NOT_READY_MESSAGE) {
        enr.lastError = NOT_READY_MESSAGE;
        changed = true;
      }
      break;
    }
    const vars = templateVars({
      ws,
      cfg,
      name: enr.name,
      baseUrl: appBaseUrl(enr.baseUrl),
      stepIndex: action.index,
      inviterName: enr.inviterName,
    });
    try {
      const out = await sendTeammateEmail({
        env,
        email: enr.email,
        name: enr.name,
        contactId: enr.ghlContactId,
        subject: renderTemplate(step.subject, vars),
        body: renderTemplate(step.body, vars),
      });
      enr.ghlContactId = out.contactId;
      enr.sent[step.id] = { at: now.toISOString(), messageId: out.messageId };
      enr.lastSentAt = now.toISOString();
      enr.lastError = '';
      enr.attempts = 0;
      enr.nextIndex = action.index + 1;
    } catch (e) {
      enr.attempts = (enr.attempts || 0) + 1;
      enr.lastError = (e && e.message) || 'Send failed';
      if (enr.attempts >= MAX_ATTEMPTS) {
        enr.sent[step.id] = { at: now.toISOString(), failed: true, error: enr.lastError };
        enr.nextIndex = action.index + 1;
        enr.attempts = 0;
      }
    }
    changed = true;
    if (enr.nextIndex >= cfg.steps.length) {
      enr.status = 'done';
      enr.completedAt = now.toISOString();
    }
    break;
  }
  if (changed) {
    enr.updatedAt = now.toISOString();
    await saveEnrollment(enr);
  }
  return enr;
}

async function processMember(workspaceId, email, now = new Date()) {
  const ws = await dbService.getWorkspace(workspaceId);
  const enr = await readEnrollment(workspaceId, email);
  if (!ws || !enr || enr.status !== 'active') return enr;
  const cfg = onboardingForWorkspace(ws);
  if (!cfg.enabled) return enr;
  const { env, ready } = await workspaceEmailEnv(workspaceId);
  return processEnrollment({ ws, cfg, env, ready, tz: resolveWorkspaceTimezone(ws), enr, now });
}

/** Start (or restart) the daily emails for a member and send Day 1 right away. */
async function enrollMember({ workspaceId, email, name, baseUrl, inviterName, restart = false }) {
  const em = normEmail(email);
  if (!workspaceId || !em) return null;
  const existing = await readEnrollment(workspaceId, em);
  if (existing && !restart) return existing;
  const now = new Date().toISOString();
  const enr = {
    workspaceId,
    email: em,
    name: String(name || (existing && existing.name) || '').trim(),
    inviterName: String(inviterName || (existing && existing.inviterName) || '').trim(),
    baseUrl: appBaseUrl(baseUrl) || (existing && existing.baseUrl) || '',
    ghlContactId: (existing && existing.ghlContactId) || '',
    enrolledAt: now,
    status: 'active',
    nextIndex: 0,
    sent: {},
    attempts: 0,
    lastSentAt: '',
    lastError: '',
    updatedAt: now,
  };
  await saveEnrollment(enr);
  return processMember(workspaceId, em);
}

async function stopMember(workspaceId, email) {
  const enr = await readEnrollment(workspaceId, email);
  if (!enr) return null;
  enr.status = 'stopped';
  enr.updatedAt = new Date().toISOString();
  return saveEnrollment(enr);
}

async function runOnboardingDrips(now = new Date()) {
  const ids = await dbService.listWorkspaceIds();
  let sent = 0;
  for (const wid of ids) {
    const keys = await dbService.listStorageKeysWithPrefix(`onboarding:${wid}:`);
    if (!keys.length) continue;
    const ws = await dbService.getWorkspace(wid);
    if (!ws) continue;
    const cfg = onboardingForWorkspace(ws);
    if (!cfg.enabled) continue;
    const { env, ready } = await workspaceEmailEnv(wid);
    const tz = resolveWorkspaceTimezone(ws);
    const members = ws.members || {};
    for (const key of keys) {
      let enr;
      try {
        const raw = await dbService.peekStorageKey(key);
        enr = raw ? JSON.parse(raw) : null;
      } catch {
        enr = null;
      }
      if (!enr || enr.status !== 'active') continue;
      if (!members[enr.email]) {
        enr.status = 'stopped';
        enr.lastError = 'No longer a member of this workspace.';
        enr.updatedAt = now.toISOString();
        await saveEnrollment(enr);
        continue;
      }
      try {
        const before = enr.lastSentAt;
        const after = await processEnrollment({ ws, cfg, env, ready, tz, enr, now });
        if (after.lastSentAt && after.lastSentAt !== before) sent++;
      } catch (e) {
        console.error('[ONBOARDING] drip failed for', enr.email, e.message);
      }
    }
  }
  return { sent };
}

/** Send the invite or a step email to the admin with sample values, using unsaved editor content. */
async function sendTestEmail({ ws, toEmail, toName, subject, body, stepIndex, steps, baseUrl }) {
  const { env, ready } = await workspaceEmailEnv(ws.id);
  if (!ready) throw new Error(NOT_READY_MESSAGE);
  const cfg = onboardingForWorkspace({ onboarding: { ...(ws.onboarding || {}), steps: steps || (ws.onboarding || {}).steps } });
  const base = appBaseUrl(baseUrl);
  const idx = stepIndex != null && Number.isFinite(Number(stepIndex)) ? Math.min(Math.max(0, Number(stepIndex)), cfg.steps.length - 1) : null;
  const vars = templateVars({
    ws,
    cfg,
    name: toName,
    baseUrl: base,
    stepIndex: idx,
    inviteLink: absoluteLink(base, '/workspace/invite/sample-link'),
    inviterName: toName || '',
  });
  return sendTeammateEmail({
    env,
    email: toEmail,
    name: toName,
    subject: `[Test] ${renderTemplate(subject, vars)}`,
    body: renderTemplate(body, vars),
  });
}

/** Onboarding status for every workspace member (for the settings page). */
async function memberStatuses(ws) {
  const cfg = onboardingForWorkspace(ws);
  const tz = resolveWorkspaceTimezone(ws);
  const out = [];
  for (const [email, m] of Object.entries((ws && ws.members) || {})) {
    const enr = await readEnrollment(ws.id, email);
    const sentCount = enr && enr.sent ? Object.values(enr.sent).filter((s) => s && !s.skipped && !s.failed).length : 0;
    let nextDueAt = null;
    if (enr && enr.status === 'active' && (enr.nextIndex || 0) < cfg.steps.length) {
      nextDueAt = stepDueAt(enr.enrolledAt, enr.nextIndex || 0, tz, cfg.sendHour).toISOString();
    }
    out.push({
      email: normEmail(email),
      name: (enr && enr.name) || (m && m.name) || '',
      role: (m && m.role) || '',
      joinedAt: (m && m.joinedAt) || '',
      status: enr ? enr.status : 'not_started',
      nextIndex: enr ? enr.nextIndex || 0 : 0,
      total: cfg.steps.length,
      sentCount,
      lastSentAt: (enr && enr.lastSentAt) || '',
      lastError: (enr && enr.lastError) || '',
      nextDueAt,
    });
  }
  return out.sort((a, b) => String(b.joinedAt).localeCompare(String(a.joinedAt)));
}

module.exports = {
  TEAMMATE_TAG,
  NOT_READY_MESSAGE,
  bodyToHtml,
  templateVars,
  stepDueAt,
  nextAction,
  workspaceEmailEnv,
  sendInviteEmail,
  enrollMember,
  stopMember,
  processMember,
  runOnboardingDrips,
  sendTestEmail,
  memberStatuses,
  readEnrollment,
};
