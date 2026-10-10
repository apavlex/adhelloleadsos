/**
 * AdHello business ops agents (Bops-style role bots).
 */
const roles = require('./roles');
const store = require('./store');
const memory = require('./memory');
const tools = require('./tools');
const runtime = require('./runtime');

module.exports = {
  ...roles,
  getSettings: store.getSettings,
  saveSettings: store.saveSettings,
  listRecentRuns: store.listRecentRuns,
  listInsights: store.listInsights,
  remember: memory.remember,
  listNotes: memory.listNotes,
  prepareProspects: tools.prepareProspects,
  prepareFocus: tools.prepareFocus,
  scanOpportunityBoard: tools.scanOpportunityBoard,
  scanPool: tools.scanPool,
  opsHealth: tools.opsHealth,
  runJob: runtime.runJob,
  enqueueAndRun: runtime.enqueueAndRun,
  tickWorkspace: runtime.tickWorkspace,
  tickAllWorkspaces: runtime.tickAllWorkspaces,
  dashboardForWorkspace: runtime.dashboardForWorkspace,
};
