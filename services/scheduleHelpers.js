const { DateTime } = require('luxon');

function normalizeScheduledTime(raw) {
  const scheduledTime = String(raw || '09:00').trim();
  const timeMatch = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(scheduledTime);
  if (!timeMatch) return null;
  const hh = String(timeMatch[1]).padStart(2, '0');
  return `${hh}:${timeMatch[2]}`;
}

/**
 * Parse schedule fields from a form POST body.
 * @returns {{ ok: true, data: object } | { ok: false, message: string }}
 */
function parseSchedulePayload(body) {
  const scheduleKind = String(body.scheduleKind || 'once').trim().toLowerCase();
  const timezone = String(body.timezone || 'UTC').trim() || 'UTC';
  const normalizedTime = normalizeScheduledTime(body.scheduledTime);
  if (!normalizedTime) {
    return { ok: false, message: 'Choose a valid time for your scheduled search.' };
  }

  if (scheduleKind === 'recurring') {
    const frequency = String(body.frequency || 'daily').trim().toLowerCase();
    const allowed = ['daily', 'weekly', 'monthly'];
    if (!allowed.includes(frequency)) {
      return { ok: false, message: 'Choose daily, weekly, or monthly for recurring jobs.' };
    }
    return {
      ok: true,
      data: {
        scheduleKind: 'recurring',
        frequency,
        scheduledTime: normalizedTime,
        timezone,
      },
    };
  }

  const scheduledDate = String(body.scheduledDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) {
    return { ok: false, message: 'Choose a run date for your scheduled search.' };
  }

  const local = DateTime.fromISO(`${scheduledDate}T${normalizedTime}`, { zone: timezone });
  if (!local.isValid) {
    return { ok: false, message: 'Could not interpret that schedule in your timezone. Try again.' };
  }

  const scheduledRunAt = local.toUTC().toISO();
  if (DateTime.utc() >= DateTime.fromISO(scheduledRunAt)) {
    return { ok: false, message: 'Scheduled run must be in the future.' };
  }

  return {
    ok: true,
    data: {
      scheduleKind: 'once',
      scheduledRunAt,
      scheduledDate,
      scheduledTime: normalizedTime,
      timezone,
    },
  };
}

function scheduleFrequencyLabel(schedule) {
  if (schedule && schedule.scheduledRunAt) return 'One-time';
  const freq = String((schedule && schedule.frequency) || 'daily').toLowerCase();
  if (freq === '4hours') return 'Every 4 hours';
  return freq.charAt(0).toUpperCase() + freq.slice(1);
}

module.exports = {
  parseSchedulePayload,
  normalizeScheduledTime,
  scheduleFrequencyLabel,
};
