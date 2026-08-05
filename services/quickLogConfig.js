/**
 * Shared quick-log pills for Focus mode and lead panel sidemenu.
 * Disposition codes sync to GHL via ghlActionTags (AO: tags).
 */

const SKIP_FOLLOW_UP_DISPOSITIONS = new Set(['not_interested', 'wrong_number']);

const QUICK_LOG_ITEMS = Object.freeze([
  {
    label: 'Gatekeeper',
    disposition: 'gatekeeper',
    noteTemplate: 'Reached gatekeeper — used bypass opener.',
  },
  {
    label: 'No pickup',
    disposition: 'no_answer',
    noteTemplate: 'No pickup. Retry in next calling window.',
  },
  {
    label: 'Left VM',
    disposition: 'voicemail',
    noteTemplate: 'Left voicemail with value prop and callback number.',
  },
  {
    label: 'Not interested',
    disposition: 'not_interested',
    status: 'Closed - Lost',
    noteTemplate: 'Not interested at this time.',
  },
  {
    label: 'Callback requested',
    disposition: 'callback',
    noteTemplate: 'Requested callback. Confirm best time and call back as scheduled.',
  },
  {
    label: 'DM connected',
    disposition: 'connected',
    noteTemplate: 'Connected with decision maker. Follow up with tailored recap.',
  },
  {
    label: 'Send info',
    disposition: 'send_info',
    status: 'Email Sent',
    noteTemplate: 'Sending info package — follow up after they review.',
  },
  {
    label: 'Site audit',
    disposition: 'site_audit',
    noteTemplate: 'Site audit scheduled or sent. Follow up after they review.',
  },
].map((item) => ({
  ...item,
  enableFollowup: item.disposition ? !SKIP_FOLLOW_UP_DISPOSITIONS.has(item.disposition) : false,
})));

function getQuickLogTagConfigMap() {
  const map = Object.create(null);
  for (const item of QUICK_LOG_ITEMS) {
    map[item.label] = {
      disposition: item.disposition || '',
      status: item.status || '',
      noteTemplate: item.noteTemplate || '',
      enableFollowup: !!item.enableFollowup,
    };
  }
  return map;
}

function getQuickLogClientPayload() {
  return {
    items: QUICK_LOG_ITEMS.map(({ label, disposition, status, noteTemplate, enableFollowup }) => ({
      label,
      disposition: disposition || '',
      status: status || '',
      noteTemplate: noteTemplate || '',
      enableFollowup: !!enableFollowup,
    })),
    tagConfig: getQuickLogTagConfigMap(),
    pillLabelsPattern: QUICK_LOG_ITEMS.map((i) =>
      i.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    ).join('|'),
  };
}

function quickLogLabelForDisposition(code) {
  const c = String(code || '').trim().toLowerCase();
  if (!c) return '';
  const item = QUICK_LOG_ITEMS.find((i) => i.disposition === c);
  return item ? item.label : '';
}

function quickLogItemForDisposition(code) {
  const c = String(code || '').trim().toLowerCase();
  return QUICK_LOG_ITEMS.find((i) => i.disposition === c) || null;
}

function quickLogItemForLabel(label) {
  const l = String(label || '').trim();
  return QUICK_LOG_ITEMS.find((i) => i.label === l) || null;
}

function quickLogItemForStatus(status) {
  const s = String(status || '').trim();
  if (!s) return null;
  return QUICK_LOG_ITEMS.find((i) => i.status === s) || null;
}

/** Resolve the active quick-log pill label from a lead record. */
function resolveActiveQuickLogFromLead(lead) {
  if (!lead || typeof lead !== 'object') return '';
  const fromDisp = quickLogLabelForDisposition(lead.lastDisposition);
  if (fromDisp) return fromDisp;
  const fromStatus = quickLogItemForStatus(lead.status);
  return fromStatus ? fromStatus.label : '';
}

/** Focus / client selection value stored in hidden input. */
function focusValueForItem(item) {
  if (!item) return '';
  if (item.disposition) return item.disposition;
  if (item.status) return `status:${item.status}`;
  return '';
}

function focusValueFromLead(lead) {
  if (!lead || typeof lead !== 'object') return '';
  const disp = String(lead.lastDisposition || '').trim().toLowerCase();
  if (disp) {
    const item = quickLogItemForDisposition(disp);
    if (item) return focusValueForItem(item);
  }
  const statusItem = quickLogItemForStatus(lead.status);
  if (statusItem) return focusValueForItem(statusItem);
  return '';
}

/** Prefix for quick-log entries in the pipeline tag filter (`ql:voicemail`, etc.). */
const QUICK_LOG_TAG_PREFIX = 'ql:';

function quickLogFilterTagKey(disposition) {
  const code = String(disposition || '').trim().toLowerCase();
  return code ? `${QUICK_LOG_TAG_PREFIX}${code}` : '';
}

function isQuickLogFilterTagKey(tagKey) {
  return String(tagKey || '').trim().startsWith(QUICK_LOG_TAG_PREFIX);
}

function dispositionFromQuickLogFilterTagKey(tagKey) {
  return String(tagKey || '')
    .trim()
    .slice(QUICK_LOG_TAG_PREFIX.length)
    .toLowerCase();
}

function quickLogLabelForFilterTagKey(tagKey) {
  if (!isQuickLogFilterTagKey(tagKey)) return '';
  const item = quickLogItemForDisposition(dispositionFromQuickLogFilterTagKey(tagKey));
  return item ? item.label : '';
}

/** Match a lead against a quick-log tag filter (same rules as the touch pill). */
function leadMatchesQuickLogFilter(lead, tagKey) {
  const code = isQuickLogFilterTagKey(tagKey)
    ? dispositionFromQuickLogFilterTagKey(tagKey)
    : String(tagKey || '').trim().toLowerCase();
  if (!code || !lead || typeof lead !== 'object') return false;
  const item = quickLogItemForDisposition(code);
  if (!item) return false;
  const disp = String(lead.lastDisposition || '').trim().toLowerCase();
  if (disp === code) return true;
  if (item.status) {
    return String(lead.status || '').trim() === item.status;
  }
  return false;
}

module.exports = {
  QUICK_LOG_ITEMS,
  QUICK_LOG_TAG_PREFIX,
  getQuickLogTagConfigMap,
  getQuickLogClientPayload,
  quickLogLabelForDisposition,
  quickLogItemForDisposition,
  quickLogItemForLabel,
  quickLogItemForStatus,
  resolveActiveQuickLogFromLead,
  focusValueForItem,
  focusValueFromLead,
  quickLogFilterTagKey,
  isQuickLogFilterTagKey,
  dispositionFromQuickLogFilterTagKey,
  quickLogLabelForFilterTagKey,
  leadMatchesQuickLogFilter,
};
