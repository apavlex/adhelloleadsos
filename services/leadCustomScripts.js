/**
 * Custom outreach scripts saved on one lead (`lead.customScripts`), keyed by channel.
 * They win over the offer's script in Money mode, the lead panel and the MCP get_lead_script tool.
 * Rows: { text, html?, updatedAt, updatedBy } — `text` is what AI tools read; `html` keeps B/I/U from the editor.
 */
const { htmlToPlain, looksLikeScriptHtml, sanitizeScriptHtml } = require('./scriptMarkup');
const { clampSectionText } = require('./salesScriptsStorage');

const CHANNELS = ['call', 'sms', 'email', 'dm', 'voicemail'];
const CHANNEL_ALIASES = { text: 'sms', 'call-script': 'call' };

function normalizeChannel(raw) {
  const ch = String(raw || '').trim().toLowerCase();
  const mapped = CHANNEL_ALIASES[ch] || ch;
  return CHANNELS.includes(mapped) ? mapped : '';
}

function sectionFor(channel) {
  return channel === 'call' ? 'opening' : channel;
}

function cleanRow(row) {
  if (!row || typeof row !== 'object') return null;
  const text = String(row.text || '').trim();
  if (!text) return null;
  const out = { text, updatedAt: String(row.updatedAt || ''), updatedBy: String(row.updatedBy || '') };
  if (row.html && String(row.html).trim()) out.html = String(row.html);
  return out;
}

/** Saved scripts for a lead, safe to send to the browser. */
function publicCustomScripts(lead) {
  const all = lead && lead.customScripts && typeof lead.customScripts === 'object' ? lead.customScripts : {};
  const out = {};
  CHANNELS.forEach((channel) => {
    const row = cleanRow(all[channel]);
    if (row) out[channel] = row;
  });
  return out;
}

/**
 * Next `customScripts` value after saving `body` (plain text or editor HTML) for one channel.
 * An empty body removes the channel's script.
 */
function withCustomScript(lead, channel, body, userEmail) {
  const ch = normalizeChannel(channel);
  if (!ch) return { ok: false, error: 'Unknown script channel.' };
  const raw = String(body == null ? '' : body);
  const isHtml = looksLikeScriptHtml(raw);
  const clean = isHtml ? sanitizeScriptHtml(raw) : '';
  const text = clampSectionText(sectionFor(ch), (isHtml ? htmlToPlain(clean) : raw).trim());
  const prev = lead && lead.customScripts && typeof lead.customScripts === 'object' ? lead.customScripts : {};
  const next = { ...prev };
  if (!text) {
    delete next[ch];
    return { ok: true, channel: ch, customScripts: next, script: null };
  }
  const row = { text, updatedAt: new Date().toISOString(), updatedBy: String(userEmail || '').toLowerCase() };
  if (isHtml) {
    const html = clampSectionText(sectionFor(ch), clean);
    if (html.trim()) row.html = html;
  }
  next[ch] = row;
  return { ok: true, channel: ch, customScripts: next, script: row };
}

module.exports = {
  CUSTOM_SCRIPT_CHANNELS: CHANNELS,
  normalizeChannel,
  publicCustomScripts,
  withCustomScript,
};
