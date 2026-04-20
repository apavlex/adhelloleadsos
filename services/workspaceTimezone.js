const { DateTime } = require('luxon');

function workspaceTodayYmd(ws) {
  const tz = (ws && ws.timezone) || process.env.WORKSPACE_DEFAULT_TZ || 'America/New_York';
  try {
    return DateTime.now().setZone(tz).toISODate();
  } catch {
    return DateTime.utc().toISODate();
  }
}

module.exports = { workspaceTodayYmd };
