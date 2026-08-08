/**
 * Resolve which business profile (sender offer) applies when syncing auto-outreach to GHL.
 * Maps to workspace Offer Catalog entries (Workspace → Scripts / Offers).
 */
const { SCRIPT_LIBRARY } = require('./salesConstants');
const workspaceSalesScripts = require('./workspaceSalesScripts');
const { buildMergedScriptLibrary } = require('./salesScriptsStorage');

const MAX_PITCH_LEN = 320;

function normalizeBrandKit(raw) {
  const k = raw && typeof raw === 'object' ? raw : {};
  return {
    businessName: String(k.businessName || '').trim().slice(0, 120),
  };
}

function resolveSenderOfferKey({ lead, folder, workspace }) {
  const fromLead = String((lead && lead.prospecting && lead.prospecting.senderOfferKey) || '').trim();
  if (fromLead) return fromLead;

  const fromFolder = String(
    (folder && folder.outreachAutomation && folder.outreachAutomation.senderOfferKey) || '',
  ).trim();
  if (fromFolder) return fromFolder;

  const fromPool = String(
    (workspace &&
      workspace.prospecting &&
      workspace.prospecting.autoPool &&
      workspace.prospecting.autoPool.senderOfferKey) ||
      '',
  ).trim();
  if (fromPool) return fromPool;

  return '';
}

function firstCatalogKey(ws) {
  const { catalog } = workspaceSalesScripts.buildWorkspaceOfferLibrary(ws, SCRIPT_LIBRARY);
  return catalog.length ? catalog[0].key : '';
}

function catalogEntryByKey(ws, offerKey) {
  const { catalog } = workspaceSalesScripts.buildWorkspaceOfferLibrary(ws, SCRIPT_LIBRARY);
  return catalog.find((row) => row.key === offerKey) || null;
}

function pitchFromOfferBlock(block) {
  const b = block && typeof block === 'object' ? block : {};
  const raw = String(b.valueProp || b.opening || '').trim();
  if (!raw) return '';
  return raw.length > MAX_PITCH_LEN ? `${raw.slice(0, MAX_PITCH_LEN - 1)}…` : raw;
}

/**
 * @param {object} workspace
 * @param {object} lead
 * @param {object|null} folder
 * @returns {{
 *   offerKey: string,
 *   offerLabel: string,
 *   senderBusinessName: string,
 *   vertical: string,
 *   pitch: string,
 *   auditLink: string,
 * }}
 */
function resolveOutreachSenderProfile(workspace, lead, folder) {
  const ws = workspace && typeof workspace === 'object' ? workspace : {};
  const brand = normalizeBrandKit(ws.brandKit);
  const library = buildMergedScriptLibrary(ws, SCRIPT_LIBRARY);

  let offerKey = resolveSenderOfferKey({ lead, folder, workspace: ws });
  if (!offerKey || !library[offerKey]) {
    offerKey = firstCatalogKey(ws);
  }

  const entry = offerKey ? catalogEntryByKey(ws, offerKey) : null;
  const block = offerKey && library[offerKey] ? library[offerKey] : null;
  const offerLabel = String(
    (entry && entry.label) || (block && block.label) || offerKey || brand.businessName || '',
  ).trim();

  const senderBusinessName = String(
    (entry && entry.senderBusinessName) || offerLabel || brand.businessName || 'Our team',
  ).trim();

  const vertical = String((entry && entry.vertical) || offerLabel || '').trim();
  const pitch = pitchFromOfferBlock(block);
  const auditLink = String((entry && entry.auditLink) || '').trim();

  return {
    offerKey: offerKey || '',
    offerLabel,
    senderBusinessName,
    vertical,
    pitch,
    auditLink,
  };
}

module.exports = {
  MAX_PITCH_LEN,
  resolveSenderOfferKey,
  resolveOutreachSenderProfile,
  pitchFromOfferBlock,
};
