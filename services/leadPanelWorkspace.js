const { inferScriptPresetKey } = require('./workspaceScriptBootstrap');

/**
 * Agency-style sales workspaces show audits, AI decks, share links, and website-gap
 * heuristics. Non-agency verticals (flooring, SaaS, local service) get a slimmer view.
 *
 * Do not use social/local-guide matching here: slug/name containing "adhello" is too
 * broad (e.g. AdHello Flooring) and would leak website-selling UI.
 */
function isAgencySalesWorkspace(ws) {
  if (!ws || typeof ws !== 'object') return false;

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
