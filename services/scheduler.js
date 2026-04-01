const cron = require('node-cron');
const { DateTime } = require('luxon');
const db = require('./database');
const apify = require('./apify');
const enricher = require('./enricher');

/**
 * Autopilot Scheduler: 
 * Periodically wakes up to run scheduled searches and discover new leads.
 */
async function runDueSchedules() {
  console.log('[SCHEDULER] Checking for due autopilot jobs...');
  const schedules = await db.listSchedules();
  
  for (const schedule of schedules) {
    try {
      const timezone = schedule.timezone || 'UTC';
      const now = DateTime.now().setZone(timezone);
      
      // Parse scheduled time (format "HH:mm")
      const [sHour, sMin] = (schedule.scheduledTime || '09:00').split(':').map(Number);
      
      // Calculate when the job SHOULD run today
      const targetToday = now.set({ hour: sHour, minute: sMin, second: 0, millisecond: 0 });
      
      let due = false;
      
      if (!schedule.lastRun) {
        // First run: only if current time is AT or AFTER the scheduled time today
        if (now >= targetToday) {
          due = true;
        }
      } else {
        const lastRun = DateTime.fromISO(schedule.lastRun).setZone(timezone);
        
        // Frequency logic
        if (schedule.frequency === 'daily') {
          // Due if it's the next day (or later) and we are past the target time
          const nextDay = lastRun.plus({ days: 1 }).set({ hour: sHour, minute: sMin, second: 0, millisecond: 0 });
          if (now >= nextDay) due = true;
        } else if (schedule.frequency === 'weekly') {
          const nextWeek = lastRun.plus({ weeks: 1 }).set({ hour: sHour, minute: sMin, second: 0, millisecond: 0 });
          if (now >= nextWeek) due = true;
        } else if (schedule.frequency === 'monthly') {
          const nextMonth = lastRun.plus({ months: 1 }).set({ hour: sHour, minute: sMin, second: 0, millisecond: 0 });
          if (now >= nextMonth) due = true;
        }
      }

      if (due) {
        console.log(`[SCHEDULER] Running due autopilot for: "${schedule.keyword}" at ${schedule.scheduledTime} (${timezone})`);
        
        // Update lastRun first to prevent overlaps
        await db.updateSchedule(schedule.key, { lastRun: now.toISOString() });

        // 1. Apify Search
        let results = await apify.searchGoogleMaps({
          keyword: schedule.keyword,
          city: schedule.city,
          state: schedule.state,
          maxResults: schedule.maxResults || 20
        });

        // 2. Enrich
        results = await enricher.enrichLeads(results);

        // 3. Store results in History
        const searchRecord = {
          keyword: schedule.keyword,
          city: schedule.city,
          state: schedule.state,
          maxResults: schedule.maxResults || 20,
          resultCount: results.length,
          results,
          isAutopilot: true,
          timestamp: now.toISOString()
        };
        await db.saveSearch(searchRecord);

        console.log(`[SCHEDULER] Autopilot search complete for "${schedule.keyword}". Found ${results.length} leads.`);
      }
    } catch (err) {
      console.error(`[SCHEDULER] Autopilot execution failed for ${schedule.keyword}:`, err.stack);
    }
  }
}

module.exports = {
  init() {
    console.log('[SCHEDULER] Initializing Autopilot Heartbeat (Every hour)...');
    
    // Check every hour (0 * * * *)
    cron.schedule('0 * * * *', () => {
      runDueSchedules();
    });

    // Also run once immediately on startup for any catching up
    setTimeout(runDueSchedules, 5000); 
  }
};
