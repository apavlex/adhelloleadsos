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
  return null;
}

function dispositionToActionTag(code) {
  const c = String(code || '').trim().toLowerCase();
  if (!c) return null;
  if (c === 'callback') return AO_ACTION_TAGS.CALL_BACK;
  if (c === 'connected') return AO_ACTION_TAGS.FOLLOW_UP;
  if (c === 'voicemail') return AO_ACTION_TAGS.VOICEMAIL;
  if (c === 'no_answer') return AO_ACTION_TAGS.NO_ANSWER;
  if (c === 'gatekeeper') return AO_ACTION_TAGS.GATEKEEPER;
  if (c === 'site_audit') return AO_ACTION_TAGS.SITE_AUDIT;
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
  return null;
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
  if (isTerminalProspectStatus(lead)) return [];

  const fromDisposition = dispositionToActionTag(lead.lastDisposition);
  if (fromDisposition) return [fromDisposition];

  const fromStatus = statusToActionTag(lead.status);
  if (fromStatus) return [fromStatus];

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
  dispositionToActionTag,
  computeActionTagsFromLead,
  formatNextActionNote,
};
