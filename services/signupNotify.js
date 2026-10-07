/**
 * New trial signup → the AdHello Agency GHL location: the signup becomes a
 * tagged contact (with a note of their answers), and the platform admin gets an
 * SMS (SIGNUP_NOTIFY_PHONE) and email (SIGNUP_NOTIFY_EMAIL, else the agency
 * workspace owner) from that same location.
 */
const dbService = require('./database');
const ghlClient = require('./ghlClient');
const workspaceIntegrations = require('./workspaceIntegrations');
const { textToHtml } = require('./ghlMessaging');

const SIGNUP_TAG = 'agency os trial';
const ADMIN_TAG = 'agency os admin';

async function agencyContext() {
  const wid = await dbService.getWorkspaceIdForSlug('adhello-agency');
  const ws = wid ? await dbService.getWorkspace(wid) : null;
  const env = await workspaceIntegrations.getResolvedIntegrationEnv(wid || 'default');
  return { ws, env };
}

/** Exact email / phone match only — GHL's search falls back to fuzzy hits. */
async function findExactContact({ email, phone }, env) {
  const found = await ghlClient.searchContactByEmailOrPhone({ email, phone }, env);
  if (!found || !found.id) return null;
  const em = String(email || '').trim().toLowerCase();
  if (em && String(found.email || '').trim().toLowerCase() === em) return found;
  const p = ghlClient.normalizePhoneE164(phone || '');
  if (p && ghlClient.normalizePhoneE164(found.phone || '') === p) return found;
  return null;
}

async function ensureContact({ name, company, email, phone, website, tag }, env) {
  const existing = await findExactContact({ email, phone }, env);
  if (existing) {
    await ghlClient.addTagsToContact(existing.id, [tag], env).catch(() => {});
    return String(existing.id);
  }
  const created = await ghlClient.createContact(
    {
      title: name || company || email,
      companyName: company || '',
      email: email || 'N/A',
      phone: phone || 'N/A',
      website: website || 'N/A',
      tags: [tag],
    },
    env,
  );
  const id = String((created && created.id) || '').trim();
  if (!id) throw new Error('GHL did not return a contact id.');
  return id;
}

function summaryLines(s, baseUrl) {
  return [
    `Name: ${s.name || s.googleName || '-'}`,
    `Email: ${s.email}`,
    `Phone: ${s.phone || '-'}`,
    `Company: ${s.company || '-'}`,
    `Website: ${s.website || '-'}`,
    `Niche: ${s.niche || '-'}`,
    `Team size: ${s.teamSize || '-'}`,
    `Heard about us: ${s.source || '-'}${s.sourceOther ? ` (${s.sourceOther})` : ''}`,
    `Admin: ${baseUrl}/admin/signups`,
  ];
}

/**
 * Best effort — never throws. Returns what happened for logging.
 * @param {object} signup record from trials.createTrialWorkspace
 * @param {{ baseUrl: string }} opts
 */
async function notifyNewSignup(signup, { baseUrl }) {
  const out = { contact: false, sms: false, email: false, errors: [] };
  let ctx;
  try {
    ctx = await agencyContext();
  } catch (e) {
    out.errors.push(e.message);
    return out;
  }
  const { ws, env } = ctx;
  if (!ghlClient.isConfigured(env)) {
    out.errors.push('AdHello Agency workspace has no GHL connection.');
    return out;
  }
  const lines = summaryLines(signup, baseUrl);

  try {
    const cid = await ensureContact(
      {
        name: signup.name || signup.googleName,
        company: signup.company,
        email: signup.email,
        phone: signup.phone,
        website: signup.website,
        tag: SIGNUP_TAG,
      },
      env,
    );
    out.contact = true;
    await ghlClient.createContactNote(cid, `Agency OS free trial signup\n${lines.join('\n')}`, env).catch(() => {});
  } catch (e) {
    out.errors.push(`contact: ${e.message}`);
  }

  const cfg = ghlClient.resolveConfig(env);
  const adminPhone = String(process.env.SIGNUP_NOTIFY_PHONE || '').trim();
  const adminEmail = String(process.env.SIGNUP_NOTIFY_EMAIL || (ws && ws.ownerUserId) || '').trim();
  const who = signup.company || signup.name || signup.email;

  if (adminPhone && cfg.smsFromNumber) {
    try {
      const cid = await ensureContact({ name: 'Agency OS admin', phone: adminPhone, tag: ADMIN_TAG }, env);
      await ghlClient.sendConversationMessage(
        {
          type: 'SMS',
          contactId: cid,
          message: `New Agency OS trial: ${who}\n${lines.slice(0, 4).join('\n')}\n${lines[lines.length - 1]}`,
          fromNumber: cfg.smsFromNumber,
          toNumber: ghlClient.normalizePhoneE164(adminPhone),
          status: 'pending',
        },
        env,
      );
      out.sms = true;
    } catch (e) {
      out.errors.push(`sms: ${e.message}`);
    }
  }

  if (adminEmail && cfg.emailFrom) {
    try {
      const cid = await ensureContact({ name: 'Agency OS admin', email: adminEmail, tag: ADMIN_TAG }, env);
      const body = `Someone just started a free trial of Agency OS.\n\n${lines.join('\n')}`;
      await ghlClient.sendConversationMessage(
        {
          type: 'Email',
          contactId: cid,
          subject: `New Agency OS trial: ${who}`,
          html: textToHtml(body),
          message: body,
          emailFrom: cfg.emailFrom,
          emailTo: adminEmail,
          status: 'pending',
        },
        env,
      );
      out.email = true;
    } catch (e) {
      out.errors.push(`email: ${e.message}`);
    }
  }
  return out;
}

module.exports = { notifyNewSignup, SIGNUP_TAG };
