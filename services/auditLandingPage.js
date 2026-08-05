/**
 * Configurable audit request landing page (form gate before hosted report).
 */
const { createAuditReportToken } = require('./auditReportSign');
const { applyMergeFields } = require('./directMailPersonalize');

const DEFAULT_AUDIT_LANDING = Object.freeze({
  enabled: false,
  headline: 'Request your free visibility audit',
  subheadline: 'See how {business} shows up online in {city}',
  intro:
    'Fill out the short form below. We will prepare a personalized snapshot for your business and follow up with next steps.',
  submitLabel: 'Get my audit',
  thankYouTitle: 'Thanks — we received your request',
  thankYouBody:
    'Your audit is being prepared. If your report is ready, you can view it now using the button below.',
  smsSnippetTemplate:
    "I'll send you a quick link to request your free audit now — you can open it on your phone: {audit_url}",
  fields: {
    name: { enabled: true, required: true, label: 'Your name' },
    email: { enabled: true, required: true, label: 'Email' },
    phone: { enabled: true, required: false, label: 'Phone' },
    company: { enabled: true, required: false, label: 'Company' },
    message: { enabled: false, required: false, label: 'Notes (optional)' },
  },
});

function parseBool(raw, fallback) {
  if (raw === true || raw === 'true' || raw === '1' || raw === 1) return true;
  if (raw === false || raw === 'false' || raw === '0' || raw === 0) return false;
  return fallback;
}

function normalizeField(raw, defaults) {
  const d = defaults && typeof defaults === 'object' ? defaults : {};
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: parseBool(r.enabled, d.enabled !== false),
    required: parseBool(r.required, !!d.required),
    label: String(r.label ?? d.label ?? '').trim() || String(d.label || ''),
  };
}

function normalizeAuditLanding(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const fieldsIn = r.fields && typeof r.fields === 'object' ? r.fields : {};
  const fields = {};
  for (const key of Object.keys(DEFAULT_AUDIT_LANDING.fields)) {
    fields[key] = normalizeField(fieldsIn[key], DEFAULT_AUDIT_LANDING.fields[key]);
  }
  return {
    enabled: parseBool(r.enabled, DEFAULT_AUDIT_LANDING.enabled),
    headline: String(r.headline ?? DEFAULT_AUDIT_LANDING.headline).trim(),
    subheadline: String(r.subheadline ?? DEFAULT_AUDIT_LANDING.subheadline).trim(),
    intro: String(r.intro ?? DEFAULT_AUDIT_LANDING.intro).trim(),
    submitLabel: String(r.submitLabel ?? DEFAULT_AUDIT_LANDING.submitLabel).trim(),
    thankYouTitle: String(r.thankYouTitle ?? DEFAULT_AUDIT_LANDING.thankYouTitle).trim(),
    thankYouBody: String(r.thankYouBody ?? DEFAULT_AUDIT_LANDING.thankYouBody).trim(),
    smsSnippetTemplate: String(r.smsSnippetTemplate ?? DEFAULT_AUDIT_LANDING.smsSnippetTemplate).trim(),
    fields,
  };
}

function parseAuditLandingFromBody(body) {
  const b = body && typeof body === 'object' ? body : {};
  if (b.auditLandingPage && typeof b.auditLandingPage === 'object') {
    return normalizeAuditLanding(b.auditLandingPage);
  }
  return normalizeAuditLanding(b);
}

function resolveBaseUrl(req) {
  return (
    String(process.env.BASE_URL || '').trim().replace(/\/$/, '') ||
    (req ? `${req.protocol}://${req.get('host')}`.replace(/\/$/, '') : '')
  );
}

function buildAuditRequestUrl({ leadKey, workspaceId, req }) {
  const token = createAuditReportToken({ leadKey, workspaceId, type: 'website' });
  const base = resolveBaseUrl(req);
  return `${base}/audit/request/${token}`;
}

function buildHostedReportUrl({ leadKey, workspaceId, req }) {
  const token = createAuditReportToken({ leadKey, workspaceId, type: 'website' });
  const base = resolveBaseUrl(req);
  return `${base}/audit/report/${token}`;
}

function materializeLandingCopy(config, lead) {
  const c = normalizeAuditLanding(config);
  return {
    headline: applyMergeFields(c.headline, lead),
    subheadline: applyMergeFields(c.subheadline, lead),
    intro: applyMergeFields(c.intro, lead),
    thankYouTitle: applyMergeFields(c.thankYouTitle, lead),
    thankYouBody: applyMergeFields(c.thankYouBody, lead),
  };
}

function smsSnippetForLead(config, lead, auditUrl) {
  const c = normalizeAuditLanding(config);
  const mergeLead = { ...lead, stitchDesignUrl: auditUrl };
  const tpl = c.smsSnippetTemplate || DEFAULT_AUDIT_LANDING.smsSnippetTemplate;
  return applyMergeFields(tpl, mergeLead).replace(/\{audit_url\}/gi, auditUrl || '');
}

/**
 * Resolve audit links for Send info / dispositions.
 * Landing page mode does not require AI analysis upfront.
 */
function resolveAuditLinksForLead({ workspace, lead, req }) {
  const wid = String(workspace?.id || lead?.workspaceId || '').trim();
  const fullKey = String(lead?.key || '').startsWith('lead:') ? lead.key : `lead:${lead?.key || ''}`;
  if (!wid || !fullKey) {
    return { ok: false, error: 'Lead and workspace required.' };
  }

  const landing = normalizeAuditLanding(workspace?.auditLandingPage);
  const hasAnalysis = !!(lead?.aiWebsiteAnalysis && typeof lead.aiWebsiteAnalysis === 'object');

  if (landing.enabled) {
    const auditPageUrl = buildAuditRequestUrl({ leadKey: fullKey, workspaceId: wid, req });
    const out = {
      ok: true,
      auditPageUrl,
      reportUrl: auditPageUrl,
      landingEnabled: true,
      smsSnippet: smsSnippetForLead(landing, lead, auditPageUrl),
    };
    if (hasAnalysis) {
      out.hostedReportUrl = buildHostedReportUrl({ leadKey: fullKey, workspaceId: wid, req });
      out.pdfUrl = `${out.hostedReportUrl}/download.pdf`;
    }
    return out;
  }

  if (!hasAnalysis) {
    return {
      ok: false,
      error: 'Run AI analysis first, or enable Audit request page in Workspace settings.',
    };
  }

  const reportUrl = buildHostedReportUrl({ leadKey: fullKey, workspaceId: wid, req });
  const company = String(lead.title || 'your team').trim() || 'your team';
  const smsSnippet = `I'll send you a quick link to your website audit now while we're on the phone — you can open it on your phone: ${reportUrl}`;
  return {
    ok: true,
    reportUrl,
    auditPageUrl: reportUrl,
    hostedReportUrl: reportUrl,
    pdfUrl: `${reportUrl}/download.pdf`,
    landingEnabled: false,
    smsSnippet,
    followUpEmail: {
      subject: 'Your audit, attached — plus the 3 fixes we discussed.',
      body: `Hi ${company},\n\nGreat speaking with you. Here is your website audit link:\n${reportUrl}\n\nBest,\n`,
    },
  };
}

module.exports = {
  DEFAULT_AUDIT_LANDING,
  normalizeAuditLanding,
  parseAuditLandingFromBody,
  materializeLandingCopy,
  buildAuditRequestUrl,
  buildHostedReportUrl,
  smsSnippetForLead,
  resolveAuditLinksForLead,
};
