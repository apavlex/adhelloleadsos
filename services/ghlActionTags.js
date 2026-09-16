/**
 * Maps AdHello prospecting actions to GHL contact tags (prefix AO:).
 * Used so operators can filter GHL by next action after a prospecting session.
 */

const { mergeTagLists, tagKey } = require('./ghlSyncHelpers');

const ACTION_TAG_PREFIX = 'AO:';

const AO_ACTION_TAGS = Object.freeze({
  CALL_BACK: `${ACTION_TAG_PREFIX} Call back`,
  TEXT: `${ACTION_TAG_PREFIX} Text`,
  EMAIL: `${ACTION_TAG_PREFIX} Email`,
  CALL: `${ACTION_TAG_PREFIX} Call`,
  FOLLOW_UP: `${ACTION_TAG_PREFIX} Follow-up`,
  VOICEMAIL: `${ACTION_TAG_PREFIX} Voicemail`,
  GATEKEEPER: `${ACTION_TAG_PREFIX} Gatekeeper`,
  NO_ANSWER: `${ACTION_TAG_PREFIX} No answer`,
  LINKEDIN: `${ACTION_TAG_PREFIX} LinkedIn`,
  SOCIAL: `${ACTION_TAG_PREFIX} Social`,
  MEETING: `${ACTION_TAG_PREFIX} Meeting`,
  SITE_AUDIT: `${ACTION_TAG_PREFIX} Site audit`,
  NOT_INTERESTED: `${ACTION_TAG_PREFIX} Not interested`,
  SEND_INFO: `${ACTION_TAG_PREFIX} Send info`,
  DIRECT_MAIL: `${ACTION_TAG_PREFIX} Direct mail`,
  QR_SCAN: `${ACTION_TAG_PREFIX} QR scan`,
});

const ALL_ACTION_TAG_VALUES = Object.freeze(Object.values(AO_ACTION_TAGS));

function isActionTag(tag) {
  const raw = String(tag || '').trim();
  if (!raw) return false;
  return ALL_ACTION_TAG_VALUES.some((a) => tagKey(a) === tagKey(raw));
}

function stripActionTags(tags) {
  return (Array.isArray(tags) ? tags : []).filter((t) => !isActionTag(t));
}

function channelToActionTag(channel) {
  const c = String(channel || '').trim().toLowerCase();
  if (!c) return null;
  if (c === 'call') return AO_ACTION_TAGS.CALL;
  if (c === 'email' || c === 'hosted_audit') return AO_ACTION_TAGS.EMAIL;
  if (c === 'sms') return AO_ACTION_TAGS.TEXT;
  if (c === 'social_dm') return AO_ACTION_TAGS.SOCIAL;
  if (c === 'linkedin') return AO_ACTION_TAGS.LINKEDIN;
  if (c === 'voicemail') return AO_ACTION_TAGS.VOICEMAIL;
  if (c === 'meeting') return AO_ACTION_TAGS.MEETING;
  if (c === 'other') return AO_ACTION_TAGS.FOLLOW_UP;
  if (c === 'direct_mail' || c === 'postcard' || c === 'lob') return AO_ACTION_TAGS.DIRECT_MAIL;
  return null;
}

/** Map a GHL AO: tag back to AdHello cadence channel (lastTouchChannel). */
function actionTagToChannel(tag) {
  const key = tagKey(tag);
  if (!key) return null;
  if (tagKey(AO_ACTION_TAGS.CALL) === key || tagKey(AO_ACTION_TAGS.CALL_BACK) === key) return 'call';
  if (tagKey(AO_ACTION_TAGS.TEXT) === key) return 'sms';
  if (tagKey(AO_ACTION_TAGS.EMAIL) === key || tagKey(AO_ACTION_TAGS.SEND_INFO) === key) return 'email';
  if (tagKey(AO_ACTION_TAGS.SOCIAL) === key) return 'social_dm';
  if (tagKey(AO_ACTION_TAGS.LINKEDIN) === key) return 'linkedin';
  if (tagKey(AO_ACTION_TAGS.VOICEMAIL) === key || tagKey(AO_ACTION_TAGS.NO_ANSWER) === key) {
    return 'voicemail';
  }
  if (tagKey(AO_ACTION_TAGS.MEETING) === key) return 'meeting';
  if (
    tagKey(AO_ACTION_TAGS.DIRECT_MAIL) === key ||
    tagKey(AO_ACTION_TAGS.QR_SCAN) === key
  ) {
    return 'direct_mail';
  }
  if (tagKey(AO_ACTION_TAGS.FOLLOW_UP) === key || tagKey(AO_ACTION_TAGS.GATEKEEPER) === key) {
    return 'other';
  }
  if (tagKey(AO_ACTION_TAGS.SITE_AUDIT) === key) return 'hosted_audit';
  return null;
}

/** Map a GHL AO: tag back to AdHello disposition code when applicable. */
function actionTagToDisposition(tag) {
  const key = tagKey(tag);
  if (!key) return null;
  if (tagKey(AO_ACTION_TAGS.CALL_BACK) === key) return 'callback';
  if (tagKey(AO_ACTION_TAGS.VOICEMAIL) === key) return 'voicemail';
  if (tagKey(AO_ACTION_TAGS.NO_ANSWER) === key) return 'no_answer';
  if (tagKey(AO_ACTION_TAGS.GATEKEEPER) === key) return 'gatekeeper';
  if (tagKey(AO_ACTION_TAGS.SITE_AUDIT) === key) return 'site_audit';
  if (tagKey(AO_ACTION_TAGS.NOT_INTERESTED) === key) return 'not_interested';
  if (tagKey(AO_ACTION_TAGS.SEND_INFO) === key) return 'send_info';
  if (tagKey(AO_ACTION_TAGS.FOLLOW_UP) === key) return 'connected';
  if (tagKey(AO_ACTION_TAGS.TEXT) === key) return 'sms_replied';
  return null;
}

/**
 * From GHL contact tags, pick the primary AO action and derive cadence/disposition fields.
 * @param {string[]} ghlTags
 * @returns {{ lastTouchChannel?: string, lastDisposition?: string, ghlActionTags?: string[] }}
 */
function cadenceFieldsFromGhlTags(ghlTags) {
  const tags = (Array.isArray(ghlTags) ? ghlTags : [])
    .map((t) => String(t || '').trim())
    .filter(Boolean);
  const actionTags = tags.filter((t) => isActionTag(t));
  if (!actionTags.length) return {};

  // Prefer disposition-style tags over channel-only tags.
  const priority = [
    AO_ACTION_TAGS.NOT_INTERESTED,
    AO_ACTION_TAGS.CALL_BACK,
    AO_ACTION_TAGS.SITE_AUDIT,
    AO_ACTION_TAGS.SEND_INFO,
    AO_ACTION_TAGS.FOLLOW_UP,
    AO_ACTION_TAGS.VOICEMAIL,
    AO_ACTION_TAGS.NO_ANSWER,
    AO_ACTION_TAGS.GATEKEEPER,
    AO_ACTION_TAGS.QR_SCAN,
    AO_ACTION_TAGS.DIRECT_MAIL,
    AO_ACTION_TAGS.TEXT,
    AO_ACTION_TAGS.EMAIL,
    AO_ACTION_TAGS.CALL,
    AO_ACTION_TAGS.LINKEDIN,
    AO_ACTION_TAGS.SOCIAL,
    AO_ACTION_TAGS.MEETING,
  ];
  let primary = actionTags[0];
  for (const want of priority) {
    const hit = actionTags.find((t) => tagKey(t) === tagKey(want));
    if (hit) {
      primary = hit;
      break;
    }
  }

  const out = { ghlActionTags: [primary] };
  const channel = actionTagToChannel(primary);
  if (channel) out.lastTouchChannel = channel;
  const disposition = actionTagToDisposition(primary);
  if (disposition) out.lastDisposition = disposition;
  return out;
}

function dispositionToActionTag(code) {
  const c = String(code || '').trim().toLowerCase();
  if (!c) return null;
  if (c === 'callback') return AO_ACTION_TAGS.CALL_BACK;
  if (c === 'connected' || c === 'sms_replied') return AO_ACTION_TAGS.FOLLOW_UP;
  if (c === 'voicemail') return AO_ACTION_TAGS.VOICEMAIL;
  if (c === 'no_answer') return AO_ACTION_TAGS.NO_ANSWER;
  if (c === 'gatekeeper') return AO_ACTION_TAGS.GATEKEEPER;
  if (c === 'site_audit') return AO_ACTION_TAGS.SITE_AUDIT;
  if (c === 'not_interested') return AO_ACTION_TAGS.NOT_INTERESTED;
  if (c === 'send_info') return AO_ACTION_TAGS.SEND_INFO;
  return null;
}

function statusToActionTag(status) {
  const s = String(status || '').trim().toLowerCase();
  if (!s) return null;
  if (s.includes('callback')) return AO_ACTION_TAGS.CALL_BACK;
  if (s.includes('connected') && s.includes('follow')) return AO_ACTION_TAGS.FOLLOW_UP;
  if (s.includes('voicemail')) return AO_ACTION_TAGS.VOICEMAIL;
  if (s.includes('no answer')) return AO_ACTION_TAGS.NO_ANSWER;
  if (s.includes('gatekeeper')) return AO_ACTION_TAGS.GATEKEEPER;
  if (s === 'follow-up') return AO_ACTION_TAGS.FOLLOW_UP;
  if (s.includes('site audit')) return AO_ACTION_TAGS.SITE_AUDIT;
  if (s.includes('email sent')) return AO_ACTION_TAGS.SEND_INFO;
  if (s.includes('mail sent') || s.includes('postcard')) return AO_ACTION_TAGS.DIRECT_MAIL;
  if (s.includes('closed') && s.includes('lost')) return AO_ACTION_TAGS.NOT_INTERESTED;
  return null;
}

function parseStampMs(raw) {
  const ms = Date.parse(String(raw || '').trim());
  return Number.isFinite(ms) ? ms : 0;
}

/** Postcard QR scan wins over a stale disposition until the operator logs a newer action. */
function mailScanActionTagFromLead(lead) {
  const s = lead && lead.engagementSignals && typeof lead.engagementSignals === 'object'
    ? lead.engagementSignals
    : {};
  const type = String(s.lastSignalType || '').trim();
  if (type !== 'mail_scan') return null;
  const scanAt = parseStampMs(s.mailScannedAt || s.lastSignalAt) || 1;
  const dispAt = parseStampMs(lead && lead.lastDispositionAt);
  if (dispAt > scanAt) return null;
  return AO_ACTION_TAGS.QR_SCAN;
}

function isTerminalProspectStatus(lead) {
  const s = String((lead && lead.status) || '').trim().toLowerCase();
  if (!s) return false;
  return s.includes('closed - won') || s.includes('closed - lost') || s.includes('closed-won') || s.includes('closed-lost');
}

/**
 * Compute the current next-action tag(s) for a lead (usually one primary tag).
 * @param {object} lead
 * @returns {string[]}
 */
function computeActionTagsFromLead(lead) {
  if (!lead || typeof lead !== 'object') return [];

  const fromDisposition = dispositionToActionTag(lead.lastDisposition);
  if (fromDisposition === AO_ACTION_TAGS.NOT_INTERESTED) return [fromDisposition];
  if (isTerminalProspectStatus(lead)) return [];

  const fromScan = mailScanActionTagFromLead(lead);
  if (fromScan) return [fromScan];

  if (fromDisposition) {
    return [fromDisposition];
  }

  const fromStatus = statusToActionTag(lead.status);
  if (fromStatus) {
    if (fromStatus === AO_ACTION_TAGS.NOT_INTERESTED) return [fromStatus];
    if (isTerminalProspectStatus(lead)) return [];
    return [fromStatus];
  }

  if (isTerminalProspectStatus(lead)) return [];

  const fromChannel = channelToActionTag(lead.lastTouchChannel);
  if (fromChannel) return [fromChannel];

  return [];
}

function formatNextActionNote(lead) {
  const tags = computeActionTagsFromLead(lead);
  if (!tags.length) return '';
  const lines = [`Next action: ${tags[0].replace(/^AO:\s*/, '')}`];
  if (lead.nextActionAt) {
    try {
      const d = new Date(lead.nextActionAt);
      if (!Number.isNaN(d.getTime())) {
        lines.push(`Scheduled: ${d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`);
      }
    } catch (_) {
      /* ignore */
    }
  }
  const notes = String(lead.lastDispositionNotes || '').trim();
  if (notes) lines.push(notes);
  return lines.join('\n');
}

module.exports = {
  ACTION_TAG_PREFIX,
  AO_ACTION_TAGS,
  ALL_ACTION_TAG_VALUES,
  isActionTag,
  stripActionTags,
  channelToActionTag,
  actionTagToChannel,
  actionTagToDisposition,
  cadenceFieldsFromGhlTags,
  dispositionToActionTag,
  computeActionTagsFromLead,
  formatNextActionNote,
  mailScanActionTagFromLead,
};
