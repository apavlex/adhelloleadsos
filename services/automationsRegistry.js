/**
 * Aggregates folder outreach, auto-pool, scheduled searches, and cadence automations
 * for the Automate command center.
 */
const { DateTime } = require('luxon');
const dbService = require('./database');
const { loadFolderOutreachFromFolder, resolveFolderKeysForOutreach } = require('./folderOutreachAutomation');
const { loadAutoPoolFromWorkspace, normalizeAutoPoolSettings } = require('./prospectingAutoPool');
const {
  isActiveProspecting,
  isActiveCadence,
  AUTO_OUTREACH_CAMPAIGN,
} = require('./prospectingEnroll');
const {
  scheduleDisplayTitle,
  scheduleDisplaySubtitle,
  normalizeJobType,
  JOB_TYPE_LABELS,
} = require('./scrapeJobTypes');

const DAILY_OUTREACH_HOUR_UTC = 9;
const DAILY_OUTREACH_MINUTE_UTC = 30;

function computeNextDailyRunUtc(fromDate = new Date()) {
  const now = DateTime.fromJSDate(fromDate, { zone: 'utc' });
  let next = now.set({
    hour: DAILY_OUTREACH_HOUR_UTC,
    minute: DAILY_OUTREACH_MINUTE_UTC,
    second: 0,
    millisecond: 0,
  });
  if (next <= now) {
    next = next.plus({ days: 1 });
  }
  return next.toISO();
}

function scheduleFrequencyLabel(schedule) {
  if (schedule && schedule.scheduledRunAt) return 'One-time';
  const freq = String((schedule && schedule.frequency) || 'daily').toLowerCase();
  if (freq === 'weekly') return 'Weekly';
  if (freq === 'monthly') return 'Monthly';
  return 'Daily';
}

function computeScheduleNextRun(schedule) {
  if (!schedule || typeof schedule !== 'object') return null;
  const timezone = schedule.timezone || 'UTC';
  const nowLocal = DateTime.now().setZone(timezone);
  const [sHour, sMin] = (schedule.scheduledTime || '09:00').split(':').map(Number);

  if (schedule.scheduledRunAt) {
    const targetUtc = DateTime.fromISO(schedule.scheduledRunAt, { zone: 'utc' });
    if (targetUtc.isValid && !schedule.lastRun) {
      return targetUtc.toUTC().toISO();
    }
    return null;
  }

  if (!schedule.lastRun) {
    const targetToday = nowLocal.set({ hour: sHour, minute: sMin, second: 0, millisecond: 0 });
    if (nowLocal >= targetToday) {
      return targetToday.toUTC().toISO();
    }
    return targetToday.toUTC().toISO();
  }

  const lastRun = DateTime.fromISO(schedule.lastRun).setZone(timezone);
  const freq = String(schedule.frequency || 'daily').toLowerCase();
  let nextLocal;
  if (freq === 'weekly') {
    nextLocal = lastRun.plus({ weeks: 1 }).set({ hour: sHour, minute: sMin, second: 0, millisecond: 0 });
  } else if (freq === 'monthly') {
    nextLocal = lastRun.plus({ months: 1 }).set({ hour: sHour, minute: sMin, second: 0, millisecond: 0 });
  } else {
    nextLocal = lastRun.plus({ days: 1 }).set({ hour: sHour, minute: sMin, second: 0, millisecond: 0 });
  }
  return nextLocal.toUTC().toISO();
}

function outreachStatus(settings) {
  if (settings.enabled) return 'running';
  if (settings.lastRunAt || settings.lastEnrolled > 0) return 'paused';
  return 'idle';
}

function countActiveOutreachInFolder(leads, folderKeyOrKeys) {
  return leads.filter((l) => {
    if (!isActiveProspecting(l)) return false;
    if (folderKeyOrKeys instanceof Set) {
      return folderKeyOrKeys.has(String(l.folderKey || '').trim());
    }
    const fk = String(folderKeyOrKeys || '').trim();
    if (!fk) return false;
    return String(l.folderKey || '').trim() === fk;
  }).length;
}

function countActiveOutreachWorkspace(leads) {
  return leads.filter((l) => isActiveProspecting(l)).length;
}

function countActiveCadences(leads) {
  return leads.filter((l) => {
    if (!isActiveCadence(l)) return false;
    const tid = String((l.sequenceState && l.sequenceState.templateId) || '');
    return tid !== AUTO_OUTREACH_CAMPAIGN;
  }).length;
}

function folderHasOutreachConfig(folder) {
  if (!folder || !folder.outreachAutomation) return false;
  const s = loadFolderOutreachFromFolder(folder);
  return (
    s.enabled ||
    !!s.lastRunAt ||
    s.lastEnrolled > 0 ||
    s.maxLeads !== 25 ||
    s.tier ||
    s.minScore != null ||
    s.smsOnly ||
    s.senderOfferKey
  );
}

function autoPoolHasConfig(settings) {
  return (
    settings.enabled ||
    !!settings.lastRunAt ||
    settings.lastEnrolled > 0 ||
    settings.senderOfferKey ||
    settings.minScore != null
  );
}

function leadShortKey(key) {
  const k = String(key || '').trim();
  return k.replace(/^lead:/i, '');
}

function pickLastAutomationTouch(lead) {
  const candidates = [];
  const updates = Array.isArray(lead && lead.updates) ? lead.updates : [];
  for (const u of updates) {
    const type = String(u && u.type || '').trim();
    if (
      ![
        'email_outbound',
        'sms_outbound',
        'sequence_step',
        'prospecting_enroll',
        'status_change',
      ].includes(type)
    ) {
      continue;
    }
    const ts = Date.parse(u.timestamp || '') || 0;
    if (!ts) continue;
    let label = String(u.value || type).trim();
    if (type === 'email_outbound') label = 'Email sent';
    else if (type === 'sms_outbound') label = 'SMS sent';
    else if (type === 'sequence_step') label = 'Cadence step logged';
    else if (type === 'prospecting_enroll') label = 'Enrolled in GHL outreach';
    candidates.push({ ts, label: label.slice(0, 120) });
  }
  const logs = Array.isArray(lead && lead.logs) ? lead.logs : [];
  for (const entry of logs) {
    const type = String(entry && entry.type || '').trim();
    if (type !== 'prospecting_enroll') continue;
    const ts = Date.parse(entry.timestamp || '') || 0;
    if (!ts) continue;
    candidates.push({
      ts,
      label: String(entry.message || 'Enrolled in GHL outreach').slice(0, 120),
    });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.ts - a.ts);
  return candidates[0];
}

function summarizeEnrolledLead(lead, context) {
  if (!lead || !lead.key) return null;
  const title = String(lead.title || lead.company || lead.email || 'Lead').slice(0, 120);
  const shortKey = leadShortKey(lead.key);
  let enrolledAt = null;
  let statusDetail = '';

  if (context === 'ghl_outreach') {
    const p = lead.prospecting || {};
    enrolledAt = p.lastEnrolledAt || p.enrolledAt || null;
    statusDetail = 'GHL auto-outreach';
    if (p.senderOfferKey) statusDetail += ` · ${p.senderOfferKey}`;
  } else if (context === 'cadence') {
    const st = lead.sequenceState || {};
    enrolledAt = st.anchorTime || st.startedAt || null;
    const tpl = String(st.templateId || 'cadence');
    const stepIdx = typeof st.stepIndex === 'number' ? st.stepIndex + 1 : 1;
    statusDetail = `${tpl} · step ${stepIdx}`;
    if (st.nextDueAt) {
      statusDetail += ` · next due ${new Date(st.nextDueAt).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })}`;
    }
  }

  const touch = pickLastAutomationTouch(lead);
  const lastTouchAt =
    (touch && new Date(touch.ts).toISOString()) ||
    lead.lastTouchAt ||
    lead.updatedAt ||
    null;

  return {
    key: lead.key,
    shortKey,
    title,
    enrolledAt,
    lastTouchAt,
    lastTouchLabel:
      (touch && touch.label) ||
      String(lead.lastTouchChannel || '').trim() ||
      '—',
    statusDetail,
    openUrl: `/focus?lead=${encodeURIComponent(shortKey)}`,
  };
}

function listGhlOutreachEnrolledLeads(leads, folderKeyOrKeys = null) {
  const scope =
    folderKeyOrKeys instanceof Set
      ? folderKeyOrKeys
      : folderKeyOrKeys != null && String(folderKeyOrKeys).trim()
        ? new Set([String(folderKeyOrKeys).trim()])
        : null;
  return leads
    .filter((l) => {
      if (!isActiveProspecting(l)) return false;
      if (scope && !scope.has(String(l.folderKey || '').trim())) return false;
      return true;
    })
    .map((l) => summarizeEnrolledLead(l, 'ghl_outreach'))
    .filter(Boolean)
    .sort((a, b) => {
      const ea = Date.parse(a.enrolledAt || '') || 0;
      const eb = Date.parse(b.enrolledAt || '') || 0;
      if (ea !== eb) return eb - ea;
      const ta = Date.parse(a.lastTouchAt || '') || 0;
      const tb = Date.parse(b.lastTouchAt || '') || 0;
      return tb - ta;
    });
}

function listCadenceEnrolledLeads(leads) {
  return leads
    .filter((l) => {
      if (!isActiveCadence(l)) return false;
      const tid = String((l.sequenceState && l.sequenceState.templateId) || '');
      return tid !== AUTO_OUTREACH_CAMPAIGN;
    })
    .map((l) => summarizeEnrolledLead(l, 'cadence'))
    .filter(Boolean)
    .sort((a, b) => {
      const na = Date.parse((a.enrolledAt || a.lastTouchAt) || '') || 0;
      const nb = Date.parse((b.enrolledAt || b.lastTouchAt) || '') || 0;
      return nb - na;
    });
}

/**
 * @param {string} workspaceId
 * @returns {Promise<{ automations: object[], summary: object }>}
 */
async function listAutomationsForWorkspace(workspaceId) {
  const wid = String(workspaceId || 'default').trim() || 'default';
  const [folders, ws, allSchedules, leads] = await Promise.all([
    dbService.listFolders(wid),
    dbService.getWorkspace(wid),
    dbService.listSchedules(),
    dbService.getAllLeads(wid),
  ]);

  const automations = [];
  const autoPool = normalizeAutoPoolSettings(
    loadAutoPoolFromWorkspace(ws || { id: wid }),
  );
  const folderKeySets = new Map();
  for (const folder of folders) {
    const key = String(folder.key || '').trim();
    if (!key) continue;
    folderKeySets.set(key, resolveFolderKeysForOutreach(folders, key));
  }

  // Workspace auto-pool outreach
  if (autoPoolHasConfig(autoPool)) {
    automations.push({
      id: 'auto_pool',
      type: 'outreach',
      subtype: 'auto_pool',
      name: 'Workspace auto-pool',
      subtitle: `Top ${autoPool.maxLeads}/day · ${autoPool.tier || 'any tier'}${autoPool.minScore != null ? ` · score ≥${autoPool.minScore}` : ''}`,
      status: outreachStatus(autoPool),
      leadsEnrolled: countActiveOutreachWorkspace(leads),
      lastActivity: autoPool.lastRunAt || null,
      lastRunDetail:
        autoPool.lastRunAt != null
          ? `Enrolled ${autoPool.lastEnrolled || 0} · ${autoPool.lastCandidateCount || 0} candidates`
          : '',
      nextRun: autoPool.enabled ? computeNextDailyRunUtc() : null,
      nextRunDetail: autoPool.enabled ? 'Runs when turned on · next daily 09:30 UTC' : '',
      maxLeads: autoPool.maxLeads,
      settingsLink: '/workspace/integrations/ghl-setup',
      canPause: autoPool.enabled,
      canResume: !autoPool.enabled,
      canRun: true,
      canStop: false,
      enrolledLeads: listGhlOutreachEnrolledLeads(leads).slice(0, 50),
    });
  }
  for (const folder of folders) {
    if (!folderHasOutreachConfig(folder)) continue;
    const settings = loadFolderOutreachFromFolder(folder);
    const folderKey = folder.key || '';
    const folderKeys = folderKeySets.get(String(folderKey).trim()) || new Set([folderKey]);
    let lastRunDetail = '';
    if (settings.lastRunAt != null && settings.lastRunAt !== '') {
      lastRunDetail = `Enrolled ${settings.lastEnrolled || 0} · ${settings.lastCandidateCount || 0} candidates`;
      if (settings.lastFolderLeadCount > 0 && settings.lastCandidateCount === 0) {
        lastRunDetail += ` · ${settings.lastFolderLeadCount} in folder`;
        if (settings.lastSkipSummary) {
          lastRunDetail += ` (${settings.lastSkipSummary})`;
        } else {
          lastRunDetail += ' (filtered)';
        }
      }
    }
    automations.push({
      id: `folder_outreach:${folderKey}`,
      type: 'outreach',
      subtype: 'folder_outreach',
      name: folder.name || 'Folder',
      subtitle: `Up to ${settings.maxLeads}/day${settings.tier ? ` · ${settings.tier}` : ''}${settings.smsOnly ? ' · SMS only' : ''}`,
      status: outreachStatus(settings),
      leadsEnrolled: countActiveOutreachInFolder(leads, folderKeys),
      lastActivity: settings.lastRunAt || null,
      lastRunDetail,
      nextRun: settings.enabled ? computeNextDailyRunUtc() : null,
      nextRunDetail: settings.enabled ? 'Runs when turned on · next daily 09:30 UTC' : '',
      folderKey,
      settingsLink: '/prospecting?tab=folders',
      canPause: settings.enabled,
      canResume: !settings.enabled,
      canRun: true,
      canStop: false,
      enrolledLeads: listGhlOutreachEnrolledLeads(leads, folderKeys).slice(0, 50),
    });
  }
  const schedules = allSchedules.filter(
    (s) => !s.workspaceId || String(s.workspaceId) === wid,
  );
  for (const schedule of schedules) {
    const jobType = normalizeJobType(schedule.jobType);
    automations.push({
      id: `schedule:${schedule.key}`,
      type: 'prospecting',
      subtype: 'scheduled_search',
      name: scheduleDisplayTitle(schedule),
      subtitle: scheduleDisplaySubtitle(schedule),
      status: 'running',
      leadsEnrolled: null,
      lastActivity: schedule.lastRun || null,
      lastRunDetail: scheduleFrequencyLabel(schedule),
      nextRun: computeScheduleNextRun(schedule),
      scheduleKey: schedule.key,
      jobTypeLabel: JOB_TYPE_LABELS[jobType] || 'Search',
      settingsLink: '/prospecting?tab=queue',
      canPause: false,
      canResume: false,
      canRun: false,
      canStop: true,
    });
  }

  // Active internal cadence sequences (read-only summary)
  const activeCadences = countActiveCadences(leads);
  if (activeCadences > 0) {
    automations.push({
      id: 'cadence_active',
      type: 'messages',
      subtype: 'cadence',
      name: 'Active cadence sequences',
      subtitle: 'Internal multi-step outreach running on leads',
      status: 'running',
      leadsEnrolled: activeCadences,
      lastActivity: null,
      lastRunDetail: 'Steps run every 15 minutes',
      nextRun: null,
      settingsLink: '/sequences',
      canPause: false,
      canResume: false,
      canRun: false,
      canStop: false,
      enrolledLeads: listCadenceEnrolledLeads(leads).slice(0, 50),
    });
  }
  const statusOrder = { running: 0, paused: 1, idle: 2 };
  automations.sort((a, b) => {
    const sa = statusOrder[a.status] ?? 3;
    const sb = statusOrder[b.status] ?? 3;
    if (sa !== sb) return sa - sb;
    const ta = a.lastActivity ? new Date(a.lastActivity).getTime() : 0;
    const tb = b.lastActivity ? new Date(b.lastActivity).getTime() : 0;
    return tb - ta;
  });

  const summary = {
    total: automations.length,
    running: automations.filter((a) => a.status === 'running').length,
    paused: automations.filter((a) => a.status === 'paused').length,
    outreach: automations.filter((a) => a.type === 'outreach').length,
    prospecting: automations.filter((a) => a.type === 'prospecting').length,
    messages: automations.filter((a) => a.type === 'messages').length,
  };

  let lastRunEnrolled = 0;
  let lastRunAt = null;
  if (autoPool.lastEnrolled) lastRunEnrolled += Number(autoPool.lastEnrolled) || 0;
  if (autoPool.lastRunAt && (!lastRunAt || autoPool.lastRunAt > lastRunAt)) {
    lastRunAt = autoPool.lastRunAt;
  }
  for (const folder of folders) {
    if (!folderHasOutreachConfig(folder)) continue;
    const settings = loadFolderOutreachFromFolder(folder);
    if (settings.lastEnrolled) lastRunEnrolled += Number(settings.lastEnrolled) || 0;
    if (settings.lastRunAt && (!lastRunAt || settings.lastRunAt > lastRunAt)) {
      lastRunAt = settings.lastRunAt;
    }
  }

  const reportStats = {
    running: summary.running,
    paused: summary.paused,
    totalAutomations: summary.total,
    outreachAutomations: summary.outreach,
    prospectingAutomations: summary.prospecting,
    messageAutomations: summary.messages,
    ghlOutreachEnrolled: countActiveOutreachWorkspace(leads),
    cadenceEnrolled: countActiveCadences(leads),
    scheduledSearches: schedules.length,
    lastRunEnrolled,
    lastRunAt,
    nextDailyRun: computeNextDailyRunUtc(),
  };

  return { automations, summary, reportStats };
}

module.exports = {
  computeNextDailyRunUtc,
  computeScheduleNextRun,
  outreachStatus,
  listAutomationsForWorkspace,
  summarizeEnrolledLead,
  listGhlOutreachEnrolledLeads,
  listCadenceEnrolledLeads,
};
