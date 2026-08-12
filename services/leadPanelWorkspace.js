const { isAgencyOrLocalGuideWorkspace } = require('./socialPostProfile');
const { inferScriptPresetKey } = require('./workspaceScriptBootstrap');

/**
 * Agency-style sales workspaces show audits, AI tools, share links, and enrich hunts
 * in the lead detail panel. Non-agency workspaces (flooring, SaaS, web dev, etc.) get
 * a slimmer company view focused on contact + cadence.
 */
function isAgencySalesWorkspace(ws) {
  if (!ws || typeof ws !== 'object') return false;
  if (isAgencyOrLocalGuideWorkspace(ws)) return true;

  const explicit = String(
    ws.salesScriptsPresetKey ||
      (ws.pipelineIntake && ws.pipelineIntake.presetKey) ||
      '',
  )
    .trim()
    .toLowerCase();
  if (explicit === 'agency') return true;
  if (explicit && explicit !== 'agency') return false;

  return inferScriptPresetKey(ws) === 'agency';
}

module.exports = {
  isAgencySalesWorkspace,
};
