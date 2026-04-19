const cron = require('node-cron');
const { DateTime } = require('luxon');
const db = require('./database');
const apify = require('./apify');
const enricher = require('./enricher');
const { runDueSequenceSteps } = require('./sequenceEngine');

/**
 * Autopilot Scheduler: 
 * Periodically wakes up to run scheduled searches and discover new leads.
 */
async function runDueSchedules() {
  console.log('[SCHEDULER] Checking for due scheduled jobs...');
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
        } else if (schedule.frequency === '4hours') {
          // Due every 4 hours regardless of specific clock time
          const nextRun = lastRun.plus({ hours: 4 });
          if (now >= nextRun) due = true;
        }
      }

      if (due) {
        console.log(`[SCHEDULER] Running due schedule for: "${schedule.keyword}" at ${schedule.scheduledTime} (${timezone})`);
        
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

        try {
          await db.recordCompletedSearchNotification({
            keyword: schedule.keyword,
            city: schedule.city,
            state: schedule.state,
            maxResults: schedule.maxResults || 20,
            resultCount: results.length,
            source: 'scheduled',
          });
        } catch (notifyErr) {
          console.error('[SCHEDULER] Failed to record completion notification:', notifyErr.message);
        }

        console.log(`[SCHEDULER] Scheduled scrape complete for "${schedule.keyword}". Found ${results.length} leads.`);

        const hook = process.env.AUTOPILOT_WEBHOOK_URL;
        if (hook) {
          try {
            await fetch(hook, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                event: 'autopilot.search_complete',
                scheduleKey: schedule.key,
                keyword: schedule.keyword,
                city: schedule.city,
                state: schedule.state,
                maxResults: schedule.maxResults || 20,
                resultCount: results.length,
                timestamp: now.toISOString(),
              }),
            });
          } catch (whErr) {
            console.error('[SCHEDULER] AUTOPILOT_WEBHOOK_URL failed:', whErr.message);
          }
        }
      }
    } catch (err) {
      console.error(`[SCHEDULER] Scheduled scrape failed for ${schedule.keyword}:`, err.stack);
    }
  }
}

async function runReferralAskReminders() {
  const leads = await db.getAllLeads();
  const reminderDays = Math.max(1, parseInt(process.env.REFERRAL_REMINDER_DAYS || '30', 10) || 30);
  const windowMs = reminderDays * 86400000;
  const hook = process.env.REFERRAL_REMINDER_WEBHOOK_URL;

  for (const lead of leads) {
    if (lead.referralAskReminderLogged) continue;
    const entered = lead.enteredStage8At;
    if (!entered) continue;
    if (Date.now() < Date.parse(entered) + windowMs) continue;

    const ps = parseInt(lead.pipelineStage, 10);
    if (![8, 9, 10].includes(ps)) continue;

    const msg = `Referral ask reminder: ${reminderDays}+ days since retainer onboarding started — schedule ask or case study.`;

    await db.updateLead(lead.key, {
      referralAskReminderLogged: true,
      logs: [
        {
          type: 'referral_reminder',
          message: msg,
          timestamp: new Date().toISOString(),
        },
      ],
    });

    if (hook) {
      try {
        await fetch(hook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'referral_ask_due',
            leadKey: lead.key,
            title: lead.title,
            pipelineStage: ps,
            enteredStage8At: entered,
            website: lead.website,
            email: lead.email,
          }),
        });
      } catch (e) {
        console.error('[SCHEDULER] REFERRAL_REMINDER_WEBHOOK_URL failed:', e.message);
      }
    }
  }
}

module.exports = {
  runDueSchedules,
  runReferralAskReminders,
  init() {
    console.log('[SCHEDULER] Initializing scheduled lead runs (hourly check)...');
    
    // Check every hour (0 * * * *)
    cron.schedule('0 * * * *', () => {
      runDueSchedules();
    });

    // Daily referral prompts (09:00 UTC)
    cron.schedule('0 9 * * *', () => {
      runReferralAskReminders().catch((e) =>
        console.error('[SCHEDULER] Referral reminders failed:', e.message)
      );
    });

    // Outreach cadence — due steps land in lead logs (every 15 min)
    cron.schedule('*/15 * * * *', () => {
      runDueSequenceSteps().catch((e) =>
        console.error('[SCHEDULER] Sequence steps failed:', e.message)
      );
    });

    // Also run once immediately on startup for any catching up
    setTimeout(runDueSchedules, 5000);
    setTimeout(() => {
      runReferralAskReminders().catch((e) =>
        console.error('[SCHEDULER] Referral reminders (startup) failed:', e.message)
      );
    }, 8000);
    setTimeout(() => {
      runDueSequenceSteps().catch((e) =>
        console.error('[SCHEDULER] Sequence steps (startup) failed:', e.message)
      );
    }, 11000);
  }
};
