/**
 * Workspace-persisted Upwork proposals (Computer's Reach).
 */

const MAX_PROPOSALS = 80;
const MAX_TEXT = 20_000;
const MAX_TITLE = 300;
const MAX_DESC = 12_000;
const MAX_EXP = 4000;

const ALLOWED_SERVICE_KEYS = new Set([
  'website_design',
  'seo',
  'social_media',
  'ppc',
  'reputation',
  'lead_generation',
  'general',
]);

function normalizeUpworkProposal(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const proposal = raw.proposal != null ? String(raw.proposal).trim() : '';
  if (!proposal) return null;
  const jobTitle = raw.jobTitle != null ? String(raw.jobTitle).trim().slice(0, MAX_TITLE) : '';
  const jobDescription =
    raw.jobDescription != null ? String(raw.jobDescription).trim().slice(0, MAX_DESC) : '';
  const experience = raw.experience != null ? String(raw.experience).trim().slice(0, MAX_EXP) : '';
  let serviceKey = raw.serviceKey != null ? String(raw.serviceKey).trim() : 'general';
  if (!ALLOWED_SERVICE_KEYS.has(serviceKey)) serviceKey = 'general';
  return {
    id:
      raw.id != null && String(raw.id).trim()
        ? String(raw.id).trim().slice(0, 80)
        : `uw_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    savedAt: raw.savedAt != null ? String(raw.savedAt).slice(0, 40) : new Date().toISOString(),
    jobTitle: jobTitle || 'Untitled job',
    jobDescription,
    serviceKey,
    experience,
    proposal: proposal.slice(0, MAX_TEXT),
  };
}

function getUpworkProposalsFromWorkspace(ws) {
  return Array.isArray(ws && ws.upworkSavedProposals) ? ws.upworkSavedProposals : [];
}

function trimProposalList(list) {
  const arr = Array.isArray(list) ? list.filter(Boolean) : [];
  if (arr.length <= MAX_PROPOSALS) return arr;
  return arr.slice(arr.length - MAX_PROPOSALS);
}

module.exports = {
  normalizeUpworkProposal,
  getUpworkProposalsFromWorkspace,
  trimProposalList,
  ALLOWED_SERVICE_KEYS,
};
