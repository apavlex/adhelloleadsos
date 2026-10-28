/**
 * Client-facing AI Visibility share report — snapshot normalize, share tokens,
 * email stub, and read-only view model (no agency controls).
 */

const { createAuditReportToken, verifyAuditReportToken } = require('./auditReportSign');
const { normalizeWorkspaceAccentHex } = require('../lib/workspaceAccent');

const REPORT_TYPE = 'ai_visibility';
const DEFAULT_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const FALLBACK_ACCENT = '#CA8A04';

function clampScore(n) {
  const x = Math.round(Number(n) || 0);
  if (!Number.isFinite(x)) return 0;
  return Math.min(100, Math.max(0, x));
}

function scoreLabel(score) {
  if (score >= 80) return 'Excellent';
  if (score >= 65) return 'Good';
  if (score >= 45) return 'Fair';
  if (score >= 25) return 'Weak';
  return 'Critical';
}

function cleanStr(v, max = 200) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

/**
 * Normalize a persisted scan snapshot for client rendering.
 * Accepts partial/demo data; fills safe defaults.
 */
function normalizeAiVisibilitySnapshot(raw, lead) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const leadRec = lead && typeof lead === 'object' ? lead : {};
  const businessName =
    cleanStr(r.businessName, 120) ||
    cleanStr(leadRec.title, 120) ||
    'Your business';
  const market =
    cleanStr(r.market, 80) ||
    [cleanStr(leadRec.city, 40), cleanStr(leadRec.state, 8)].filter(Boolean).join(', ') ||
    'United States';
  const score = clampScore(r.score != null ? r.score : r.overallScore);
  const engines = asArray(r.engines).length
    ? asArray(r.engines).map((e) => ({
      id: cleanStr(e.id || e.name, 40).toLowerCase().replace(/\s+/g, '_') || 'engine',
      label: cleanStr(e.label || e.name, 60) || 'Engine',
      pct: clampScore(e.pct != null ? e.pct : e.percent),
      cited: Math.max(0, Math.round(Number(e.cited) || 0)),
      total: Math.max(0, Math.round(Number(e.total) || 0)),
      detail: cleanStr(e.detail, 80),
    }))
    : defaultEngines();

  const local = r.local && typeof r.local === 'object' ? r.local : {};
  const trend = asArray(r.trend).map((p) => ({
    date: cleanStr(p.date || p.label, 20),
    score: clampScore(p.score != null ? p.score : p.value),
  })).slice(-24);

  const competitors = asArray(r.competitors).map((c, i) => ({
    rank: Math.max(1, Math.round(Number(c.rank) || i + 1)),
    name: cleanStr(c.name || c.domain, 80) || `Competitor ${i + 1}`,
    isYou: !!(c.isYou || c.you),
    aiSov: clampScore(c.aiSov != null ? c.aiSov : c.shareOfVoice),
    mapPackWins: Math.max(0, Math.round(Number(c.mapPackWins) || 0)),
    surfaces: cleanStr(c.surfaces, 120),
  }));

  const nextSteps = asArray(r.nextSteps || r.recommendations).map((s, i) => ({
    rank: i + 1,
    impact: cleanStr(s.impact, 20) || 'Med',
    title: cleanStr(s.title || s.action, 160) || 'Improve visibility',
    why: cleanStr(s.why || s.reason, 280),
  })).slice(0, 12);

  return {
    businessName,
    market,
    website: cleanStr(r.website || leadRec.website, 200),
    scannedAt: cleanStr(r.scannedAt || r.updatedAt, 40) || new Date().toISOString(),
    promptCount: Math.max(0, Math.round(Number(r.promptCount) || 24)),
    score,
    scoreLabel: scoreLabel(score),
    scoreDelta: Math.round(Number(r.scoreDelta) || 0),
    blendNote: cleanStr(r.blendNote, 80) || 'AI 70% · Local 30%',
    engines,
    local: {
      packPosition: cleanStr(local.packPosition, 40) || '—',
      mapsCityRank: cleanStr(local.mapsCityRank, 40) || '—',
      mapsZipRank: cleanStr(local.mapsZipRank, 40) || '—',
      gbpCompleteness: clampScore(local.gbpCompleteness != null ? local.gbpCompleteness : 0),
      gbpSummary: cleanStr(local.gbpSummary, 160),
      googleRating: local.googleRating != null ? Number(local.googleRating) : null,
      googleReviews: Math.max(0, Math.round(Number(local.googleReviews) || 0)),
      unansweredReviews: Math.max(0, Math.round(Number(local.unansweredReviews) || 0)),
      trustpilotRating: local.trustpilotRating != null ? Number(local.trustpilotRating) : null,
      localKeywordGaps: asArray(local.localKeywordGaps).map((k) => cleanStr(k, 100)).filter(Boolean).slice(0, 8),
    },
    trend,
    competitors,
    nextSteps,
  };
}

function defaultEngines() {
  return [
    { id: 'chatgpt', label: 'ChatGPT', pct: 0, cited: 0, total: 0, detail: '' },
    { id: 'gemini', label: 'Gemini', pct: 0, cited: 0, total: 0, detail: '' },
    { id: 'ai_overviews', label: 'AI Overviews', pct: 0, cited: 0, total: 0, detail: '' },
    { id: 'ai_mode', label: 'AI Mode', pct: 0, cited: 0, total: 0, detail: '' },
    { id: 'local_map_pack', label: 'Local / Map Pack', pct: 0, cited: 0, total: 0, detail: '' },
  ];
}

/** Demo snapshot for tests / empty leads (Acme Flooring wireframe numbers). */
function sampleAiVisibilitySnapshot(lead) {
  const title = cleanStr(lead && lead.title, 120) || 'Acme Flooring';
  return normalizeAiVisibilitySnapshot({
    businessName: title,
    market: 'Portland, OR',
    scannedAt: '2026-10-28T19:00:00.000Z',
    promptCount: 24,
    score: 61,
    scoreDelta: 5,
    blendNote: 'AI 70% · Local 30%',
    engines: [
      { id: 'chatgpt', label: 'ChatGPT', pct: 62, cited: 15, total: 24 },
      { id: 'gemini', label: 'Gemini', pct: 46, cited: 11, total: 24 },
      { id: 'ai_overviews', label: 'AI Overviews', pct: 71, cited: 17, total: 24 },
      { id: 'ai_mode', label: 'AI Mode', pct: 38, cited: 9, total: 24 },
      { id: 'local_map_pack', label: 'Local / Map Pack', pct: 55, detail: 'avg pack #2.4' },
    ],
    local: {
      packPosition: '#2 of 3',
      mapsCityRank: '#4',
      mapsZipRank: '#1 (97214)',
      gbpCompleteness: 78,
      gbpSummary: 'Categories & hours OK · 12 photos · NAP phone mismatch',
      googleRating: 4.7,
      googleReviews: 214,
      unansweredReviews: 6,
      trustpilotRating: 4.5,
      localKeywordGaps: [
        'hardwood floors portland',
        'flooring near me',
        'hardwood install portland',
      ],
    },
    trend: [
      { date: 'Aug', score: 48 },
      { date: 'Sep', score: 54 },
      { date: 'Oct', score: 61 },
    ],
    competitors: [
      { rank: 1, name: 'floors.com', aiSov: 28, mapPackWins: 12, surfaces: 'ChatGPT · Pack' },
      { rank: 2, name: 'homedepot.com', aiSov: 19, mapPackWins: 9, surfaces: 'Gemini · Maps' },
      { rank: 3, name: title, isYou: true, aiSov: 14, mapPackWins: 5, surfaces: 'AI Overviews' },
      { rank: 4, name: 'localfloors.co', aiSov: 11, mapPackWins: 4, surfaces: 'ChatGPT' },
    ],
    nextSteps: [
      {
        impact: 'High',
        title: 'Respond to 6 unanswered Google reviews',
        why: 'Pack rivals average higher ratings and review volume.',
      },
      {
        impact: 'High',
        title: 'Rewrite /hardwood-floors as step-by-step + FAQ',
        why: 'AI Overview answers as a list; a competitor is cited instead.',
      },
      {
        impact: 'High',
        title: 'Fix NAP: align site phone with Google Business Profile',
        why: 'GBP completeness penalty and proximity signal risk.',
      },
      {
        impact: 'Med',
        title: 'Add comparison table: engineered vs solid hardwood',
        why: 'AI Mode favors table format for this query type.',
      },
      {
        impact: 'Med',
        title: 'Build local citations on oregonhomebuilders.org',
        why: 'Cited in ChatGPT answers you miss and used by pack rivals.',
      },
    ],
  }, lead);
}

function getShareMeta(lead) {
  const report = lead && lead.aiVisibilityReport && typeof lead.aiVisibilityReport === 'object'
    ? lead.aiVisibilityReport
    : {};
  const share = report.share && typeof report.share === 'object' ? report.share : {};
  return {
    version: Math.max(1, Math.round(Number(share.version) || 1)),
    revokedAt: cleanStr(share.revokedAt, 40),
    sharedAt: cleanStr(share.sharedAt, 40),
    expiresAt: cleanStr(share.expiresAt, 40),
    jobId: cleanStr(share.jobId || report.jobId, 80),
  };
}

function getSnapshotFromLead(lead, { allowSample = false } = {}) {
  const report = lead && lead.aiVisibilityReport && typeof lead.aiVisibilityReport === 'object'
    ? lead.aiVisibilityReport
    : null;
  const snap = report && report.snapshot && typeof report.snapshot === 'object'
    ? report.snapshot
    : report && report.score != null
      ? report
      : null;
  if (snap) return normalizeAiVisibilitySnapshot(snap, lead);
  if (allowSample) return sampleAiVisibilitySnapshot(lead);
  return null;
}

/**
 * Mint a signed share URL token and return share fields to persist on the lead.
 */
function createAiVisibilityShare({
  leadKey,
  workspaceId,
  jobId = '',
  ttlMs = DEFAULT_TTL_MS,
  version = 1,
  baseUrl = '',
}) {
  const expMs = Date.now() + (Number(ttlMs) > 0 ? Number(ttlMs) : DEFAULT_TTL_MS);
  const token = createAuditReportToken({
    leadKey,
    workspaceId,
    ttlMs: expMs - Date.now(),
    type: REPORT_TYPE,
    jobId,
    version,
  });
  const base = String(baseUrl || '').replace(/\/$/, '');
  const reportUrl = base
    ? `${base}/ai-visibility/report/${token}`
    : `/ai-visibility/report/${token}`;
  return {
    token,
    reportUrl,
    share: {
      version: Math.max(1, Math.round(Number(version) || 1)),
      jobId: cleanStr(jobId, 80),
      sharedAt: new Date().toISOString(),
      expiresAt: new Date(expMs).toISOString(),
      revokedAt: '',
    },
  };
}

function revokeShareMeta(existingShare) {
  const prev = existingShare && typeof existingShare === 'object' ? existingShare : {};
  return {
    ...prev,
    version: Math.max(1, Math.round(Number(prev.version) || 1)) + 1,
    revokedAt: new Date().toISOString(),
  };
}

/**
 * Validate token against lead share meta (expiry already checked in verify).
 */
function shareAccessError(payload, lead) {
  if (!payload || payload.type !== REPORT_TYPE) return 'invalid';
  if (!lead) return 'notfound';
  const meta = getShareMeta(lead);
  if (meta.revokedAt) return 'revoked';
  if (payload.version != null && Number(payload.version) !== Number(meta.version)) {
    return 'revoked';
  }
  const snap = getSnapshotFromLead(lead, { allowSample: false });
  const hasSampleFlag = !!(lead.aiVisibilityReport && lead.aiVisibilityReport.allowSample);
  if (!snap && !hasSampleFlag) return 'noreport';
  return null;
}

function buildAiVisibilityClientViewModel(lead, opts) {
  opts = opts || {};
  const allowSample = opts.allowSample !== false;
  const snapshot = getSnapshotFromLead(lead, { allowSample }) || sampleAiVisibilitySnapshot(lead);
  const accent = normalizeWorkspaceAccentHex(opts.workspaceAccent) || FALLBACK_ACCENT;
  const agencyName = cleanStr(opts.agencyName, 80) || 'AdHello';
  const contactFirst =
    cleanStr(lead && (lead.contactName || lead.firstName), 60).split(/\s+/)[0] || 'there';
  const expiryDate = opts.expiresAt
    ? formatShortDate(opts.expiresAt)
    : formatShortDate(getShareMeta(lead).expiresAt);

  return {
    ...snapshot,
    accent,
    agencyName,
    mode: 'client',
    reportUrl: cleanStr(opts.reportUrl, 500),
    expiresLabel: expiryDate,
    followUpEmail: buildShareEmailStub({
      businessName: snapshot.businessName,
      contactFirstName: contactFirst,
      reportUrl: opts.reportUrl || '',
      score: snapshot.score,
      topNextStep: snapshot.nextSteps[0] ? snapshot.nextSteps[0].title : 'Review your opportunities',
      expiryDate,
      agencyName,
    }),
  };
}

function formatShortDate(iso) {
  const ms = Date.parse(String(iso || ''));
  if (!Number.isFinite(ms)) return '';
  try {
    return new Date(ms).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'America/Los_Angeles',
    });
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

function buildShareEmailStub({
  businessName,
  contactFirstName,
  reportUrl,
  score,
  topNextStep,
  expiryDate,
  agencyName,
}) {
  const company = cleanStr(businessName, 120) || 'your business';
  const first = cleanStr(contactFirstName, 60) || 'there';
  const url = cleanStr(reportUrl, 500) || '[report link]';
  const agency = cleanStr(agencyName, 80) || 'AdHello';
  const expRaw = cleanStr(expiryDate, 40);
  const exp = (expRaw && Date.parse(expRaw) ? formatShortDate(expRaw) : expRaw) || 'in 90 days';
  const subject = `Your AI & local visibility report — ${company}`;
  const body = [
    `Hi ${first},`,
    '',
    `Here's a snapshot of how ${company} shows up in AI answers and local search.`,
    '',
    `View your report (link expires ${exp}):`,
    url,
    '',
    'Highlights:',
    `• Overall score: ${clampScore(score)}/100`,
    `• Top opportunity: ${cleanStr(topNextStep, 160)}`,
    '',
    'Questions? Just reply to this email.',
    '',
    `— ${agency}`,
  ].join('\n');
  return { subject, body };
}

function verifyAiVisibilityToken(token) {
  const payload = verifyAuditReportToken(token);
  if (!payload || payload.type !== REPORT_TYPE) return null;
  return payload;
}

module.exports = {
  REPORT_TYPE,
  DEFAULT_TTL_MS,
  normalizeAiVisibilitySnapshot,
  sampleAiVisibilitySnapshot,
  getShareMeta,
  getSnapshotFromLead,
  createAiVisibilityShare,
  revokeShareMeta,
  shareAccessError,
  buildAiVisibilityClientViewModel,
  buildShareEmailStub,
  verifyAiVisibilityToken,
};
