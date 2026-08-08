const cron = require('node-cron');
const { DateTime } = require('luxon');
const db = require('./database');
const workspaceIntegrations = require('./workspaceIntegrations');
const scrapeJobRunner = require('./scrapeJobRunner');
const { scheduleDisplayTitle, normalizeJobType, JOB_TYPES } = require('./scrapeJobTypes');
const { persistFormationSearchResults } = require('./businessFormationPersist');
const { runDueSequenceSteps } = require('./sequenceEngine');
const { maybeWarmAllMorningBriefs } = require('./morningBriefWarm');
const signalwire = require('./signalwire');
const { runAutoPoolForEnabledWorkspaces } = require('./prospectingAutoPoolScheduler');
const { runFolderOutreachForEnabledWorkspaces } = require('./folderOutreachScheduler');

function normalizeVoicemailLibrary(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const audioUrl = String(item.audioUrl || item.url || '').trim();
      if (!audioUrl) return null;
      return { id: String(item.id || '').trim(), audioUrl };
    })
    .filter(Boolean);
}

function resolveActiveVoicemailAudioUrl(telephony) {
  const tp = telephony && typeof telephony === 'object' ? telephony : {};
  const lib = normalizeVoicemailLibrary(tp.voicemailLibrary);
  const activeId = String(tp.activeVoicemailId || '').trim();
  const active = activeId ? lib.find((x) => x.id === activeId) : null;
  if (active && active.audioUrl) return active.audioUrl;
  if (lib.length) return lib[lib.length - 1].audioUrl;
  return String(tp.voicemailAudioUrl || '').trim();
}

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
      const nowLocal = DateTime.now().setZone(timezone);
      const nowUtc = DateTime.utc();

      // Parse scheduled time (format "HH:mm") — legacy recurring jobs
      const [sHour, sMin] = (schedule.scheduledTime || '09:00').split(':').map(Number);

      // Calculate when the job SHOULD run today (legacy)
      const targetToday = nowLocal.set({ hour: sHour, minute: sMin, second: 0, millisecond: 0 });

      let due = false;

      if (schedule.scheduledRunAt) {
        const targetUtc = DateTime.fromISO(schedule.scheduledRunAt);
        if (targetUtc.isValid && !schedule.lastRun && nowUtc >= targetUtc) {
          due = true;
        }
      } else if (!schedule.lastRun) {
        // Legacy first run: only if current time is AT or AFTER the scheduled time today
        if (nowLocal >= targetToday) {
          due = true;
        }
      } else {
        const lastRun = DateTime.fromISO(schedule.lastRun).setZone(timezone);

        // Legacy frequency logic
        if (schedule.frequency === 'daily') {
          const nextDay = lastRun.plus({ days: 1 }).set({ hour: sHour, minute: sMin, second: 0, millisecond: 0 });
          if (nowLocal >= nextDay) due = true;
        } else if (schedule.frequency === 'weekly') {
          const nextWeek = lastRun.plus({ weeks: 1 }).set({ hour: sHour, minute: sMin, second: 0, millisecond: 0 });
          if (nowLocal >= nextWeek) due = true;
        } else if (schedule.frequency === 'monthly') {
          const nextMonth = lastRun.plus({ months: 1 }).set({ hour: sHour, minute: sMin, second: 0, millisecond: 0 });
          if (nowLocal >= nextMonth) due = true;
        } else if (schedule.frequency === '4hours') {
          const nextRun = lastRun.plus({ hours: 4 });
          if (nowLocal >= nextRun) due = true;
        }
      }

      if (due) {
        const jobLabel = scheduleDisplayTitle(schedule);
        console.log(
          `[SCHEDULER] Running due schedule for: "${jobLabel}" at ${schedule.scheduledTime || '?'} (${timezone})`
        );

        // Update lastRun first to prevent overlaps
        await db.updateSchedule(schedule.key, { lastRun: nowLocal.toISO() });

        try {
          const wid = schedule.workspaceId || 'default';
          const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(wid);

          if (!scrapeJobRunner.isJobConfigured(schedule, integrationEnv)) {
            throw new Error('Scrape provider not configured for this job type.');
          }

          const results = await scrapeJobRunner.executeScrapeJob(schedule, integrationEnv);
          let savedCount = 0;
          if (normalizeJobType(schedule.jobType) === JOB_TYPES.BUSINESS_FORMATIONS) {
            const persisted = await persistFormationSearchResults(wid, schedule, results);
            savedCount = persisted.savedCount || 0;
          }
          const searchRecord = scrapeJobRunner.buildSearchRecord(schedule, results, nowLocal.toISO());
          if (savedCount) searchRecord.savedCount = savedCount;
          await db.saveSearch(searchRecord);

          try {
            const wsMeta = await db.getWorkspace(wid);
            await db.recordCompletedSearchNotification({
              keyword: searchRecord.keyword || jobLabel,
              city: schedule.city,
              state: schedule.state,
              maxResults: schedule.maxResults || 20,
              resultCount: results.length,
              source: 'scheduled',
              workspaceId: wid,
              workspaceName: (wsMeta && wsMeta.name) || '',
            });
          } catch (notifyErr) {
            console.error('[SCHEDULER] Failed to record completion notification:', notifyErr.message);
          }

          console.log(`[SCHEDULER] Scheduled scrape complete for "${jobLabel}". Found ${results.length} results.`);

          const hook = process.env.AUTOPILOT_WEBHOOK_URL;
          if (hook) {
            try {
              await fetch(hook, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  event: 'autopilot.search_complete',
                  scheduleKey: schedule.key,
                  jobType: schedule.jobType || 'maps_business',
                  keyword: searchRecord.keyword || jobLabel,
                  city: schedule.city,
                  state: schedule.state,
                  maxResults: schedule.maxResults || 20,
                  resultCount: results.length,
                  timestamp: nowLocal.toISO(),
                }),
              });
            } catch (whErr) {
              console.error('[SCHEDULER] AUTOPILOT_WEBHOOK_URL failed:', whErr.message);
            }
          }

          if (schedule.scheduledRunAt) {
            await db.deleteSchedule(schedule.key);
            console.log(`[SCHEDULER] One-time schedule removed after success: ${schedule.key}`);
          }
        } catch (runErr) {
          if (schedule.scheduledRunAt) {
            await db.updateSchedule(schedule.key, { lastRun: null });
            console.error(`[SCHEDULER] One-time schedule ${schedule.key} will retry after error:`, runErr.message);
          }
          throw runErr;
        }
      }
    } catch (err) {
      console.error(`[SCHEDULER] Scheduled scrape failed for ${scheduleDisplayTitle(schedule)}:`, err.stack);
    }
  }
}

async function runReferralAskReminders() {
  const leads = await db.getAllLeadsUnscoped();
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

async function runWeeklyVoicemailDrops() {
  if (!signalwire.configured()) return;
  const workspaceIds = await db.listWorkspaceIds();
  for (const wid of workspaceIds) {
    try {
      const ws = await db.getWorkspace(wid);
      const telephony = ws && ws.telephony ? ws.telephony : {};
      const entries = Array.isArray(telephony.numberBankEntries) ? telephony.numberBankEntries : [];
      const fromEntries = entries.map((e) => signalwire.normalizePhone(e && e.number)).filter(Boolean);
      const fromLegacy = Array.isArray(telephony.numberBank)
        ? telephony.numberBank.map((n) => signalwire.normalizePhone(n)).filter(Boolean)
        : [];
      const bank = [...new Set([...fromEntries, ...fromLegacy])];
      const activeFrom = signalwire.normalizePhone(telephony.activeFromNumber || '');
      const selectedFrom = activeFrom && bank.includes(activeFrom) ? activeFrom : bank[0] || '';
      const weekly = telephony && telephony.weeklyVoicemail ? telephony.weeklyVoicemail : {};
      if (!weekly.enabled) continue;
      const timezone = weekly.timezone || ws.timezone || 'America/Los_Angeles';
      const now = DateTime.now().setZone(timezone);
      const targetDay = Math.max(0, Math.min(6, parseInt(weekly.dayOfWeek, 10) || 1));
      const time = String(weekly.time || '09:00');
      const match = /^(\d{1,2}):(\d{2})$/.exec(time);
      const hh = match ? Math.max(0, Math.min(23, parseInt(match[1], 10) || 9)) : 9;
      const mm = match ? Math.max(0, Math.min(59, parseInt(match[2], 10) || 0)) : 0;
      if (now.weekday % 7 !== targetDay) continue;
      const dueToday = now.set({ hour: hh, minute: mm, second: 0, millisecond: 0 });
      if (now < dueToday) continue;
      const lastRunAt = weekly.lastRunAt ? DateTime.fromISO(weekly.lastRunAt).setZone(timezone) : null;
      if (lastRunAt && lastRunAt.isValid && lastRunAt.hasSame(now, 'day')) continue;

      const maxLeads = Math.max(1, Math.min(200, parseInt(weekly.maxLeadsPerRun || '25', 10) || 25));
      const leads = await db.getAllLeads(wid);
      const candidates = leads
        .filter((l) => {
          const phone = signalwire.normalizePhone(l.phone);
          if (!phone) return false;
          const status = String(l.status || '').toLowerCase();
          if (status.includes('closed - won') || status.includes('closed - lost')) return false;
          const updates = Array.isArray(l.updates) ? l.updates : [];
          const hadRecentDrop = updates.some((u) => {
            if (!u || u.type !== 'voicemail_drop') return false;
            const ts = Date.parse(String(u.timestamp || ''));
            if (!Number.isFinite(ts)) return false;
            return Date.now() - ts < 6 * 24 * 60 * 60 * 1000;
          });
          return !hadRecentDrop;
        })
        .slice(0, maxLeads);

      let sent = 0;
      for (const lead of candidates) {
        try {
          const call = await signalwire.createLeadCall({
            to: lead.phone,
            leadKey: lead.key,
            workspaceId: wid,
            action: 'voicemail_drop',
            voicemailAudioUrl: resolveActiveVoicemailAudioUrl(telephony),
            from: selectedFrom,
          });
          const updates = Array.isArray(lead.updates) ? [...lead.updates] : [];
          updates.push({
            type: 'voicemail_drop',
            value: 'Weekly voicemail drop attempt started.',
            callSid: call.sid || '',
            provider: 'signalwire',
            timestamp: new Date().toISOString(),
          });
          await db.updateLead(lead.key, {
            updates,
            logs: [
              {
                type: 'voicemail_drop',
                message: `Weekly voicemail drop initiated (${call.sid || 'no sid'})`,
                timestamp: new Date().toISOString(),
              },
            ],
          });
          sent += 1;
        } catch (err) {
          console.error(`[SCHEDULER] Weekly voicemail drop failed for ${lead.key}:`, err.message);
        }
      }

      const wsNext = ws && typeof ws === 'object' ? { ...ws } : { id: wid };
      const telephonyNext =
        wsNext.telephony && typeof wsNext.telephony === 'object' ? { ...wsNext.telephony } : {};
      const weeklyNext =
        telephonyNext.weeklyVoicemail && typeof telephonyNext.weeklyVoicemail === 'object'
          ? { ...telephonyNext.weeklyVoicemail }
          : {};
      weeklyNext.lastRunAt = DateTime.utc().toISO();
      weeklyNext.lastRunCount = sent;
      telephonyNext.weeklyVoicemail = weeklyNext;
      wsNext.telephony = telephonyNext;
      await db.saveWorkspace(wid, wsNext);
      console.log(`[SCHEDULER] Weekly voicemail run complete for ${wid}: ${sent} drops.`);
    } catch (err) {
      console.error('[SCHEDULER] Weekly voicemail run failed:', err.message);
    }
  }
}

module.exports = {
  runDueSchedules,
  runReferralAskReminders,
  runWeeklyVoicemailDrops,
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

    // Daily auto-pool enroll (09:30 UTC)
    cron.schedule('30 9 * * *', () => {
      runAutoPoolForEnabledWorkspaces().catch((e) =>
        console.error('[SCHEDULER] Auto-pool failed:', e.message)
      );
      runFolderOutreachForEnabledWorkspaces().catch((e) =>
        console.error('[SCHEDULER] Folder outreach failed:', e.message)
      );
    });

    // Outreach cadence — due steps land in lead logs (every 15 min)
    cron.schedule('*/15 * * * *', () => {
      runDueSequenceSteps().catch((e) =>
        console.error('[SCHEDULER] Sequence steps failed:', e.message)
      );
      maybeWarmAllMorningBriefs().catch((e) =>
        console.error('[SCHEDULER] Morning brief warm failed:', e.message)
      );
      runWeeklyVoicemailDrops().catch((e) =>
        console.error('[SCHEDULER] Weekly voicemail drops failed:', e.message)
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
    setTimeout(() => {
      runWeeklyVoicemailDrops().catch((e) =>
        console.error('[SCHEDULER] Weekly voicemail drops (startup) failed:', e.message)
      );
    }, 13000);
  }
};
