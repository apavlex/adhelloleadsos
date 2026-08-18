/**
 * Info pack — per-folder / workspace-default multi-channel outreach (SMS, email, Lob mail).
 */

const dbService = require('./database');
const { applyMergeFields, hasMergeTokens } = require('./directMailPersonalize');
const { getPlaybookById } = require('./directMailPlaybooks');
const { resolveAuditLinksForLead } = require('./auditLandingPage');
const smsOutbound = require('./smsOutbound');
const ghlMessaging = require('./ghlMessaging');
const ghlClient = require('./ghlClient');
const phoneLineType = require('./phoneLineType');
const lobClient = require('./lobClient');
const lobDirectMail = require('./lobDirectMail');
const ghlProspectSync = require('./ghlProspectSync');

const EMPTY_INFO_PACK = Object.freeze({
  auditUrl: '',
  sms: { enabled: false, body: '' },
  email: { enabled: false, subject: '', body: '' },
  directMail: {
    enabled: false,
    playbookId: '',
    headline: '',
    bodyText: '',
    ctaUrl: '',
    frontImageUrl: '',
    backImageUrl: '',
    personalizeOverlay: true,
    includeLobQr: true,
  },
});

const BUILTIN_DEFAULT = Object.freeze({
  auditUrl: '',
  sms: {
    enabled: true,
    body:
      "I'll send you a quick link to your website audit now while we're on the phone — you can open it on your phone: {audit_url}",
  },
  email: {
    enabled: true,
    subject: 'Quick idea for {business}',
    body: 'Hi {business},\n\nGreat speaking with you. Here is your local visibility snapshot:\n{audit_url}\n\nBest,',
  },
  directMail: {
    enabled: false,
    playbookId: 'local_audit_general',
    headline: '',
    bodyText: '',
    ctaUrl: '',
    frontImageUrl: '',
    backImageUrl: '',
    personalizeOverlay: true,
    includeLobQr: true,
  },
});

function parseBool(raw, fallback) {
  if (raw === true || raw === 'true' || raw === '1' || raw === 1) return true;
  if (raw === false || raw === 'false' || raw === '0' || raw === 0) return false;
  return fallback;
}

function normalizeChannelBlock(raw, defaults) {
  const d = defaults && typeof defaults === 'object' ? defaults : {};
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = { ...d };
  for (const key of Object.keys(d)) {
    if (r[key] == null) continue;
    if (typeof d[key] === 'boolean') {
      out[key] = parseBool(r[key], d[key]);
    } else {
      out[key] = String(r[key] ?? d[key] ?? '').trim();
    }
  }
  return out;
}

function normalizeInfoPack(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    auditUrl: String(r.auditUrl ?? '').trim(),
    sms: normalizeChannelBlock(r.sms, EMPTY_INFO_PACK.sms),
    email: normalizeChannelBlock(r.email, EMPTY_INFO_PACK.email),
    directMail: normalizeChannelBlock(r.directMail, EMPTY_INFO_PACK.directMail),
  };
}

function parseInfoPackFromBody(body) {
  const b = body && typeof body === 'object' ? body : {};
  if (b.infoPack && typeof b.infoPack === 'object') {
    return normalizeInfoPack(b.infoPack);
  }
  return normalizeInfoPack({
    auditUrl: b.auditUrl,
    sms: {
      enabled: b.smsEnabled,
      body: b.smsBody,
    },
    email: {
      enabled: b.emailEnabled,
      subject: b.emailSubject,
      body: b.emailBody,
    },
    directMail: {
      enabled: b.directMailEnabled,
      playbookId: b.playbookId || b.directMailPlaybookId,
      headline: b.directMailHeadline,
      bodyText: b.directMailBodyText,
      ctaUrl: b.directMailCtaUrl,
      frontImageUrl: b.directMailFrontImageUrl,
      backImageUrl: b.directMailBackImageUrl,
      personalizeOverlay: b.directMailPersonalizeOverlay,
      includeLobQr: b.directMailIncludeLobQr,
    },
  });
}

function packNeedsAuditUrl(pack) {
  const p = normalizeInfoPack(pack);
  const blobs = [
    p.sms.body,
    p.email.subject,
    p.email.body,
    p.directMail.headline,
    p.directMail.bodyText,
    p.directMail.ctaUrl,
  ];
  return blobs.some((t) => hasMergeTokens(t));
}

function buildAuditReportUrl({ lead, workspaceId, req, workspace }) {
  const wid = String(workspaceId || lead?.workspaceId || '').trim();
  const ws = workspace && typeof workspace === 'object' ? workspace : { id: wid };
  const links = resolveAuditLinksForLead({ workspace: ws, lead, req });
  if (!links.ok) return links;
  return {
    ok: true,
    reportUrl: links.reportUrl,
    auditPageUrl: links.auditPageUrl,
    hostedReportUrl: links.hostedReportUrl || null,
    pdfUrl: links.pdfUrl || null,
    landingEnabled: !!links.landingEnabled,
    smsSnippet: links.smsSnippet || '',
  };
}

function mergeLeadForAuditUrl(lead, auditUrl) {
  if (!auditUrl) return lead;
  return { ...lead, stitchDesignUrl: auditUrl };
}

function fillDirectMailFromPlaybook(dm) {
  const out = { ...dm };
  const pb = out.playbookId ? getPlaybookById(out.playbookId) : null;
  if (!pb) return out;
  if (!out.headline) out.headline = String(pb.headline || '');
  if (!out.bodyText) out.bodyText = String(pb.body || pb.bodyText || '');
  if (!out.ctaUrl) out.ctaUrl = String(pb.ctaUrl || '{audit_url}');
  if (out.personalizeOverlay == null) out.personalizeOverlay = pb.personalizeOverlay !== false;
  return out;
}

function materializeInfoPackForLead(pack, lead, { auditUrl } = {}) {
  const normalized = normalizeInfoPack(pack);
  const mergeLead = mergeLeadForAuditUrl(lead, auditUrl);
  const dm = fillDirectMailFromPlaybook(normalized.directMail);
  return {
    sms: {
      ...normalized.sms,
      body: applyMergeFields(normalized.sms.body, mergeLead),
    },
    email: {
      ...normalized.email,
      subject: applyMergeFields(normalized.email.subject, mergeLead),
      body: applyMergeFields(normalized.email.body, mergeLead),
    },
    directMail: {
      ...dm,
      headline: applyMergeFields(dm.headline, mergeLead),
      bodyText: applyMergeFields(dm.bodyText, mergeLead),
      ctaUrl: applyMergeFields(dm.ctaUrl, mergeLead),
    },
  };
}

async function resolveInfoPackForFolderKey(wid, folderKey) {
  const fk = String(folderKey || '').trim();
  if (!fk) return null;
  const folder = await dbService.getFolder(wid, fk);
  if (!folder || !folder.infoPack) return null;
  return normalizeInfoPack(folder.infoPack);
}

async function resolveInfoPackForLead({ workspace, folder, lead }) {
  const wid = String(workspace?.id || lead?.workspaceId || 'default');
  if (folder && folder.infoPack) {
    return normalizeInfoPack(folder.infoPack);
  }
  const fk = String((folder && folder.key) || lead?.folderKey || '').trim();
  if (fk) {
    const folderPack = await resolveInfoPackForFolderKey(wid, fk);
    if (folderPack) return folderPack;
  }
  if (workspace && workspace.infoPackDefault) {
    return normalizeInfoPack(workspace.infoPackDefault);
  }
  return normalizeInfoPack(BUILTIN_DEFAULT);
}

function mergePackOverrides(basePack, overrides) {
  if (!overrides || typeof overrides !== 'object') return normalizeInfoPack(basePack);
  return normalizeInfoPack({
    ...normalizeInfoPack(basePack),
    sms: { ...normalizeInfoPack(basePack).sms, ...(overrides.sms || {}) },
    email: { ...normalizeInfoPack(basePack).email, ...(overrides.email || {}) },
    directMail: { ...normalizeInfoPack(basePack).directMail, ...(overrides.directMail || {}) },
  });
}

async function resolveAuditUrlForInfoPack({ pack, lead, workspaceId, workspace, req }) {
  const normalized = normalizeInfoPack(pack);
  const configured = String(normalized.auditUrl || '').trim();
  if (configured) {
    return { ok: true, reportUrl: applyMergeFields(configured, lead), source: 'configured' };
  }
  if (!packNeedsAuditUrl(normalized)) {
    return { ok: true, reportUrl: '', source: 'none' };
  }
  const audit = buildAuditReportUrl({ lead, workspaceId, workspace, req });
  return audit.ok ? { ...audit, source: 'auto' } : audit;
}

async function sendInfoPackToLead({
  lead,
  workspaceId,
  workspace,
  integrationEnv,
  pack,
  overrides,
  req,
  resolveCallerNumber,
  appendLeadUpdateFn,
  buildContactedStagePatchFn,
}) {
  const wid = String(workspaceId || lead.workspaceId || '').trim();
  const resolvedPack = mergePackOverrides(pack, overrides);
  let auditUrl = '';
  const configuredAuditUrl = String(resolvedPack.auditUrl || '').trim();
  if (packNeedsAuditUrl(resolvedPack) || configuredAuditUrl) {
    const ws = workspace || (await dbService.getWorkspace(wid)) || { id: wid };
    const audit = await resolveAuditUrlForInfoPack({
      pack: resolvedPack,
      lead,
      workspaceId: wid,
      workspace: ws,
      req,
    });
    if (!audit.ok) {
      return {
        sms: { ok: false, error: audit.error, skipped: true },
        email: { ok: false, error: audit.error, skipped: true },
        directMail: { ok: false, error: audit.error, skipped: true },
        auditError: audit.error,
      };
    }
    auditUrl = audit.reportUrl;
  }

  const materialized = materializeInfoPackForLead(resolvedPack, lead, { auditUrl });
  const phoneOverride = String((overrides && overrides.phone) || '').trim();
  const emailOverride = String((overrides && overrides.email) || '').trim();
  const saveToLead = !!(overrides && overrides.saveToLead);

  const results = { sms: null, email: null, directMail: null };
  let latestLead = lead;

  if (materialized.sms.enabled) {
    const to = phoneOverride || String(lead.phone || '').trim();
    if (!to || to === 'N/A') {
      results.sms = { ok: false, error: 'No phone number.', skipped: true };
    } else if (!phoneLineType.isSmsAllowed(lead)) {
      results.sms = { ok: false, error: 'SMS skipped — landline number.', skipped: true, reason: 'landline_sms_skip' };
    } else if (!String(materialized.sms.body || '').trim()) {
      results.sms = { ok: false, error: 'SMS body is empty.', skipped: true };
    } else {
      try {
        const sent = await smsOutbound.sendSmsToLead({
          lead: latestLead,
          message: materialized.sms.body,
          integrationEnv,
          workspaceId: wid,
          fromNumber: typeof resolveCallerNumber === 'function' ? resolveCallerNumber() : '',
          to,
        });
        results.sms = {
          ok: true,
          provider: sent.provider,
          messageId: sent.messageId || null,
          channel: sent.channel || 'sms',
        };
        if (appendLeadUpdateFn && buildContactedStagePatchFn) {
          const contactedPatch = await buildContactedStagePatchFn(latestLead, wid);
          const updates = appendLeadUpdateFn(latestLead, {
            type: 'sms_outbound',
            value: materialized.sms.body,
            messageSid: sent.messageId || '',
            provider: sent.provider,
          });
          const patch = {
            ...contactedPatch,
            status: 'Follow-up',
            lastTouchChannel: 'sms',
            updates,
            logs: [
              {
                type: 'info_pack_sms',
                message: `Info pack SMS sent${sent.messageId ? ` (${sent.messageId})` : ''}`,
                timestamp: new Date().toISOString(),
              },
            ],
          };
          if (saveToLead && phoneOverride) patch.phone = phoneOverride;
          if (sent.provider === 'ghl' && sent.contactId) patch.ghlContactId = sent.contactId;
          latestLead = (await dbService.updateLead(latestLead.key, patch)) || latestLead;
        }
      } catch (err) {
        results.sms = { ok: false, error: err && err.message ? err.message : 'SMS send failed.' };
      }
    }
  } else {
    results.sms = { ok: false, skipped: true, reason: 'disabled' };
  }

  if (materialized.email.enabled) {
    const to = emailOverride || String(lead.email || '').trim();
    if (!to || to === 'N/A') {
      results.email = { ok: false, error: 'No email address.', skipped: true };
    } else if (!ghlClient.isConfigured(integrationEnv)) {
      results.email = {
        ok: false,
        error: 'Connect Go High Level in Workspace → Integrations to send email.',
        skipped: true,
      };
    } else if (!String(materialized.email.body || '').trim()) {
      results.email = { ok: false, error: 'Email body is empty.', skipped: true };
    } else {
      try {
        const sent = await ghlMessaging.sendEmailToLead({
          lead: latestLead,
          subject: materialized.email.subject || 'Message from Agency OS',
          body: materialized.email.body,
          integrationEnv,
          toEmail: to,
        });
        results.email = {
          ok: true,
          provider: sent.provider || 'ghl',
          messageId: sent.messageId || null,
        };
        if (appendLeadUpdateFn && buildContactedStagePatchFn) {
          const contactedPatch = await buildContactedStagePatchFn(latestLead, wid);
          const updates = appendLeadUpdateFn(latestLead, {
            type: 'email_outbound',
            value: materialized.email.subject || materialized.email.body.slice(0, 120),
            messageSid: sent.messageId || '',
            provider: 'ghl',
            ghlContactId: sent.contactId || latestLead.ghlContactId || '',
          });
          const patch = {
            ...contactedPatch,
            ghlContactId: sent.contactId || latestLead.ghlContactId,
            status: 'Email Sent',
            lastTouchChannel: 'email',
            updates,
            logs: [
              {
                type: 'info_pack_email',
                message: `Info pack email sent${sent.messageId ? ` (${sent.messageId})` : ''}`,
                timestamp: new Date().toISOString(),
              },
            ],
          };
          if (saveToLead && emailOverride) patch.email = emailOverride;
          latestLead = (await dbService.updateLead(latestLead.key, patch)) || latestLead;
        }
      } catch (err) {
        results.email = { ok: false, error: err && err.message ? err.message : 'Email send failed.' };
      }
    }
  } else {
    results.email = { ok: false, skipped: true, reason: 'disabled' };
  }

  if (materialized.directMail.enabled) {
    const dm = materialized.directMail;
    if (!lobClient.isConfigured(integrationEnv)) {
      results.directMail = {
        ok: false,
        error: 'Connect Lob in Workspace → Integrations before sending mail.',
        skipped: true,
      };
    } else if (!lobDirectMail.hasMailableAddress(latestLead)) {
      results.directMail = {
        ok: false,
        error: 'Lead does not have a complete mailable address.',
        skipped: true,
      };
    } else {
      try {
        const sent = await lobDirectMail.sendPostcardToLead({
          lead: latestLead,
          integrationEnv,
          headline: dm.headline || undefined,
          bodyText: dm.bodyText || undefined,
          ctaUrl: dm.ctaUrl || undefined,
          frontImageUrl: dm.frontImageUrl || undefined,
          backImageUrl: dm.backImageUrl || undefined,
          personalizeOverlay: dm.personalizeOverlay !== false,
          includeLobQr: dm.includeLobQr !== false,
          req,
        });
        results.directMail = {
          ok: true,
          provider: sent.provider || 'lob',
          postcardId: sent.postcardId || null,
          url: sent.url || null,
        };
        if (appendLeadUpdateFn) {
          const updates = appendLeadUpdateFn(latestLead, {
            type: 'direct_mail_outbound',
            value: sent.postcardId || 'postcard',
            provider: 'lob',
            postcardId: sent.postcardId || '',
            lobUrl: sent.url || '',
          });
          latestLead =
            (await dbService.updateLead(latestLead.key, {
              status: latestLead.status === 'Not Contacted' ? 'Mail Sent' : latestLead.status,
              lastTouchChannel: 'direct_mail',
              updates,
              logs: [
                {
                  type: 'info_pack_direct_mail',
                  message: `Info pack postcard sent${sent.postcardId ? ` (${sent.postcardId})` : ''}${sent.qrRedirectUrl ? ' · QR' : ''}`,
                  timestamp: new Date().toISOString(),
                  postcardId: sent.postcardId || '',
                  lobUrl: sent.url || '',
                  qrRedirectUrl: sent.qrRedirectUrl || '',
                  provider: 'lob',
                },
              ],
            })) || latestLead;
          const queuedNote = [
            `Info pack postcard sent${sent.postcardId ? ` (${sent.postcardId})` : ''}`,
            sent.qrRedirectUrl ? `QR: ${sent.qrRedirectUrl}` : '',
          ]
            .filter(Boolean)
            .join('\n');
          ghlProspectSync.triggerGhlProspectSync(latestLead.key, wid, {
            trigger: 'postcard_queued',
            note: queuedNote,
          });
        }
      } catch (err) {
        results.directMail = {
          ok: false,
          error: err && err.message ? err.message : 'Direct mail send failed.',
        };
      }
    }
  } else {
    results.directMail = { ok: false, skipped: true, reason: 'disabled' };
  }

  return { ...results, lead: latestLead, materialized, auditUrl: auditUrl || null };
}

module.exports = {
  EMPTY_INFO_PACK,
  BUILTIN_DEFAULT,
  normalizeInfoPack,
  parseInfoPackFromBody,
  resolveInfoPackForLead,
  resolveInfoPackForFolderKey,
  materializeInfoPackForLead,
  sendInfoPackToLead,
  packNeedsAuditUrl,
  buildAuditReportUrl,
  mergePackOverrides,
  resolveAuditUrlForInfoPack,
};
