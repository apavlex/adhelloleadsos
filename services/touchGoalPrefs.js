const dbService = require('./database');
const { userEmail } = require('./workspaceService');
const { resolveDailyTouchGoal, clampDailyTouchGoal } = require('./trackerStats');

async function loadDailyTouchGoal(req) {
  const email = userEmail(req);
  const prefs = email ? await dbService.getUserPrefs(email) : null;
  return resolveDailyTouchGoal(prefs);
}

async function saveDailyTouchGoal(email, raw) {
  const touchGoal = clampDailyTouchGoal(raw);
  await dbService.saveUserPrefs(email, { dailyTouchGoal: touchGoal });
  return touchGoal;
}

module.exports = {
  loadDailyTouchGoal,
  saveDailyTouchGoal,
};
