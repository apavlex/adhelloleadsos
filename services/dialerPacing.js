const signalwire = require('./signalwire');

function toInt(v, fallback) {
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function parseHm(raw, fallback) {
  const s = String(raw || '').trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return fallback;
  const hh = clamp(toInt(m[1], 0), 0, 23);
  const mm = clamp(toInt(m[2], 0), 0, 59);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function minutesOfDay(hm) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(hm || '00:00'));
  if (!m) return 0;
  return clamp(toInt(m[1], 0), 0, 23) * 60 + clamp(toInt(m[2], 0), 0, 59);
}

function tzFromState(state) {
  const s = String(state || '')
    .trim()
    .toUpperCase();
  const MAP = {
    CA: 'America/Los_Angeles',
    OR: 'America/Los_Angeles',
    WA: 'America/Los_Angeles',
    NV: 'America/Los_Angeles',
    AZ: 'America/Phoenix',
    CO: 'America/Denver',
    UT: 'America/Denver',
    NM: 'America/Denver',
    TX: 'America/Chicago',
    IL: 'America/Chicago',
    FL: 'America/New_York',
    GA: 'America/New_York',
    NY: 'America/New_York',
    NJ: 'America/New_York',
    NC: 'America/New_York',
    SC: 'America/New_York',
    VA: 'America/New_York',
    MA: 'America/New_York',
    PA: 'America/New_York',
  };
  return MAP[s] || '';
}

/** NANP area code → IANA zone (primary zone for that NPA). */
function tzFromPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  let npa = '';
  if (digits.length === 11 && digits.startsWith('1')) npa = digits.slice(1, 4);
  else if (digits.length === 10) npa = digits.slice(0, 3);
  if (!npa) return '';
  const PACIFIC = new Set([
    '206', '253', '360', '425', '509', '564', // WA
    '503', '541', '971', '458', // OR
    '209', '213', '279', '310', '323', '341', '350', '408', '415', '424', '442', '510', '530',
    '559', '562', '619', '626', '628', '650', '657', '661', '669', '707', '714', '747', '760',
    '805', '818', '820', '831', '858', '909', '916', '925', '949', '951', // CA
    '702', '725', '775', // NV
  ]);
  const MOUNTAIN = new Set([
    '303', '719', '720', '970', '983', // CO
    '385', '435', '801', // UT
    '505', '575', // NM
    '406', // MT
    '208', '986', // ID
    '307', // WY
  ]);
  const ARIZONA = new Set(['480', '520', '602', '623', '928']);
  const CENTRAL = new Set([
    '214', '254', '281', '325', '346', '361', '409', '430', '432', '469', '512', '682', '713',
    '726', '737', '806', '817', '830', '832', '903', '915', '936', '940', '945', '956', '972',
    '979', // TX
    '217', '224', '309', '312', '331', '447', '464', '618', '630', '708', '773', '779', '815',
    '847', '872', // IL
  ]);
  if (PACIFIC.has(npa)) return 'America/Los_Angeles';
  if (ARIZONA.has(npa)) return 'America/Phoenix';
  if (MOUNTAIN.has(npa)) return 'America/Denver';
  if (CENTRAL.has(npa)) return 'America/Chicago';
  return '';
}

function formatHmInZone(tz, now) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(now || new Date());
  } catch (_) {
    return '';
  }
}

function resolveLeadTimezone(lead, workspaceTimezone) {
  const explicit = String((lead && lead.timezone) || '').trim();
  const fromState = tzFromState(lead && lead.state);
  const fromPhone = tzFromPhone((lead && (lead.phone || lead.mobile || lead.telephone)) || '');
  // Prefer geography signals over a stale/default timezone on the lead record.
  // Example: 360 WA number must not inherit workspace America/New_York.
  if (fromState) return fromState;
  if (fromPhone) return fromPhone;
  if (explicit) return explicit;
  return String(workspaceTimezone || '').trim() || 'America/Los_Angeles';
}

function currentMinuteInZone(tz, now) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(now || new Date());
    const hh = toInt((parts.find((p) => p.type === 'hour') || {}).value, 0);
    const mm = toInt((parts.find((p) => p.type === 'minute') || {}).value, 0);
    return clamp(hh, 0, 23) * 60 + clamp(mm, 0, 59);
  } catch (_) {
    return null;
  }
}

function buildBank(telephony) {
  const tp = telephony && typeof telephony === 'object' ? telephony : {};
  const entries = Array.isArray(tp.numberBankEntries) ? tp.numberBankEntries : [];
  const fromEntries = entries.map((e) => signalwire.normalizePhone(e && e.number)).filter(Boolean);
  const fromLegacy = Array.isArray(tp.numberBank)
    ? tp.numberBank.map((n) => signalwire.normalizePhone(n)).filter(Boolean)
    : [];
  return [...new Set([...fromEntries, ...fromLegacy])];
}

function getPacingConfig(workspace, telephony) {
  const ws = workspace && typeof workspace === 'object' ? workspace : {};
  const tp = telephony && typeof telephony === 'object' ? telephony : {};
  const perNumberHourCap = clamp(
    toInt(tp.perNumberHourCap, toInt(process.env.DIALER_PER_NUMBER_HOUR_CAP, 24)),
    1,
    120,
  );
  const quietStart = parseHm(tp.quietHoursStart, process.env.DIALER_QUIET_START || '08:00');
  const quietEnd = parseHm(tp.quietHoursEnd, process.env.DIALER_QUIET_END || '20:00');
  const cooldownMinutes = clamp(
    toInt(tp.burnCooldownMinutes, toInt(process.env.DIALER_BURN_COOLDOWN_MIN, 120)),
    15,
    24 * 60,
  );
  return {
    perNumberHourCap,
    quietStart,
    quietEnd,
    cooldownMinutes,
    workspaceTimezone: String(ws.timezone || '').trim() || 'America/Los_Angeles',
  };
}

function inAllowedWindow(minuteNow, quietStart, quietEnd) {
  const start = minutesOfDay(quietStart);
  const end = minutesOfDay(quietEnd);
  if (start === end) return true;
  if (start < end) return minuteNow >= start && minuteNow < end;
  return minuteNow >= start || minuteNow < end;
}

function ensureStore(telephony) {
  const tp = telephony && typeof telephony === 'object' ? telephony : {};
  if (!tp.dialerPacing || typeof tp.dialerPacing !== 'object') tp.dialerPacing = {};
  const store = tp.dialerPacing;
  if (!Array.isArray(store.events)) store.events = [];
  if (!store.burned || typeof store.burned !== 'object') store.burned = {};
  return store;
}

function trimStore(store, nowIso) {
  const nowMs = Date.parse(nowIso || new Date().toISOString());
  const keepAfter = nowMs - 7 * 24 * 60 * 60 * 1000;
  store.events = store.events
    .filter((e) => e && e.at && Date.parse(e.at) >= keepAfter)
    .slice(-2500);
}

function countAttemptsLastHour(store, from, nowIso) {
  const nowMs = Date.parse(nowIso || new Date().toISOString());
  const cutoff = nowMs - 60 * 60 * 1000;
  return store.events.filter((e) => e && e.from === from && e.type === 'attempt' && Date.parse(e.at) >= cutoff)
    .length;
}

function selectCallerIdForDial({ workspace, telephony, lead, requestedFrom, now }) {
  const nowObj = now || new Date();
  const nowIso = nowObj.toISOString();
  const cfg = getPacingConfig(workspace, telephony);
  const bank = buildBank(telephony);
  const picked = signalwire.normalizePhone(requestedFrom || '');
  const store = ensureStore(telephony);
  trimStore(store, nowIso);

  if (!bank.length) {
    return { allowed: false, reason: 'No caller IDs in workspace phone bank.' };
  }
  if (picked && bank.includes(picked)) {
    return { allowed: true, from: picked, reason: 'Requested caller ID accepted', changed: false };
  }

  const leadTz = resolveLeadTimezone(lead, cfg.workspaceTimezone);
  if (lead) {
    const minute = currentMinuteInZone(leadTz, nowObj);
    if (minute != null && !inAllowedWindow(minute, cfg.quietStart, cfg.quietEnd)) {
      const localHm = formatHmInZone(leadTz, nowObj);
      return {
        allowed: false,
        reason:
          `Outside lead local dial window ${cfg.quietStart}–${cfg.quietEnd} in ${leadTz}` +
          (localHm ? ` (local time there is ${localHm})` : '') +
          '.',
        leadTimezone: leadTz,
      };
    }
  }

  const activeBurned = store.burned || {};
  const candidateStats = bank.map((n) => {
    const burnUntil = activeBurned[n] && activeBurned[n].until ? Date.parse(activeBurned[n].until) : 0;
    const burned = burnUntil && burnUntil > Date.parse(nowIso);
    const attemptsLastHour = countAttemptsLastHour(store, n, nowIso);
    return { number: n, burned, attemptsLastHour };
  });
  const eligible = candidateStats.filter((x) => !x.burned && x.attemptsLastHour < cfg.perNumberHourCap);
  const pool = eligible.length ? eligible : candidateStats.filter((x) => !x.burned);
  if (!pool.length) {
    return { allowed: false, reason: 'All caller IDs are temporarily burned or capped. Wait and retry.' };
  }
  pool.sort((a, b) => a.attemptsLastHour - b.attemptsLastHour);
  const from = pool[0].number;
  return {
    allowed: true,
    from,
    reason: `Selected by pacing (cap ${cfg.perNumberHourCap}/hr).`,
    leadTimezone: leadTz || undefined,
    changed: from !== (store.lastFrom || ''),
  };
}

function recordDialAttempt(telephony, payload) {
  const store = ensureStore(telephony);
  const nowIso = new Date().toISOString();
  trimStore(store, nowIso);
  store.lastFrom = payload.from || store.lastFrom || '';
  store.events.push({
    type: 'attempt',
    at: nowIso,
    from: String(payload.from || ''),
    to: String(payload.to || ''),
    action: String(payload.action || 'call'),
    leadKey: String(payload.leadKey || ''),
    callSid: String(payload.callSid || ''),
  });
  return true;
}

function detectBurnAndUpdate(telephony, from, cfg) {
  const store = ensureStore(telephony);
  const outcomes = store.events.filter((e) => e && e.from === from && e.type === 'outcome');
  if (outcomes.length < 10) return;
  const recent = outcomes.slice(-12);
  const all = outcomes.slice(-40);
  const rate = (list) => {
    if (!list.length) return 0;
    const hits = list.filter((x) => x.answered === true).length;
    return hits / list.length;
  };
  const recentRate = rate(recent);
  const allRate = rate(all);
  const now = Date.now();
  if (recentRate <= 0.12 && allRate <= 0.2) {
    store.burned[from] = {
      until: new Date(now + cfg.cooldownMinutes * 60 * 1000).toISOString(),
      reason: `Low answer rate (${Math.round(recentRate * 100)}% recent).`,
      updatedAt: new Date(now).toISOString(),
    };
  } else if (store.burned[from] && recentRate >= 0.25) {
    delete store.burned[from];
  }
}

function recordCallOutcome(telephony, payload) {
  const tp = telephony && typeof telephony === 'object' ? telephony : {};
  const cfg = getPacingConfig({}, tp);
  const store = ensureStore(tp);
  const nowIso = new Date().toISOString();
  trimStore(store, nowIso);
  const status = String(payload.callStatus || '').trim().toLowerCase();
  const answeredBy = String(payload.answeredBy || '').trim().toLowerCase();
  let answered = null;
  if (['completed', 'answered', 'in-progress', 'in_progress'].includes(status)) answered = true;
  if (['no-answer', 'failed', 'busy', 'canceled'].includes(status)) answered = false;
  if (answeredBy) {
    if (answeredBy.includes('human') || answeredBy.includes('person')) answered = true;
    if (answeredBy.includes('machine') || answeredBy.includes('voicemail')) answered = false;
  }
  const from = signalwire.normalizePhone(payload.from || '') || '';
  if (!from) return false;
  store.events.push({
    type: 'outcome',
    at: nowIso,
    from,
    to: String(payload.to || ''),
    callSid: String(payload.callSid || ''),
    callStatus: status,
    answered,
    answeredBy,
  });
  detectBurnAndUpdate(tp, from, cfg);
  return true;
}

module.exports = {
  selectCallerIdForDial,
  recordDialAttempt,
  recordCallOutcome,
  getPacingConfig,
  resolveLeadTimezone,
  tzFromPhone,
  tzFromState,
  inAllowedWindow,
};
