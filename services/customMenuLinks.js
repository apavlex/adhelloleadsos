const crypto = require('crypto');

const MAX_LINKS = 24;
const MAX_LABEL = 40;
const ID_RE = /^ml_[a-z0-9]{8,24}$/i;
const MENU_LINK_ICONS = [
  'letter',
  'link',
  'grid',
  'star',
  'pin',
  'home',
  'calendar',
  'chat',
  'briefcase',
  'globe',
  'phone',
  'mail',
  'users',
];

function cleanIcon(raw) {
  const icon = String(raw || '').trim().toLowerCase();
  return MENU_LINK_ICONS.includes(icon) ? icon : 'letter';
}

function newMenuLinkId() {
  return `ml_${crypto.randomBytes(6).toString('hex')}`;
}

function parseHttpUrl(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  let parsed;
  try {
    parsed = new URL(text);
  } catch (_) {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;
  return parsed.toString();
}

/**
 * Keep saved links that are safe to render. Drops blank or invalid rows.
 * @param {unknown} raw
 * @returns {{ id: string, label: string, url: string, open: 'iframe' | 'tab', icon: string }[]}
 */
function normalizeCustomMenuLinks(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const label = String(item.label || '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, MAX_LABEL);
    const url = parseHttpUrl(item.url);
    if (!label || !url) continue;
    let id = String(item.id || '').trim();
    if (!ID_RE.test(id) || seen.has(id)) id = newMenuLinkId();
    seen.add(id);
    const open = String(item.open || item.mode || '').toLowerCase() === 'tab' ? 'tab' : 'iframe';
    out.push({ id, label, url, open, icon: cleanIcon(item.icon) });
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}

/**
 * Validate a settings save. Empty rows are ignored. A named row with a bad URL is an error.
 * @param {unknown} raw
 * @returns {{ ok: true, links: ReturnType<typeof normalizeCustomMenuLinks> } | { ok: false, error: string }}
 */
function parseCustomMenuLinksInput(raw) {
  if (raw == null) return { ok: true, links: [] };
  if (!Array.isArray(raw)) return { ok: false, error: 'Send a list of links.' };
  if (raw.length > MAX_LINKS) {
    return { ok: false, error: `You can add up to ${MAX_LINKS} links.` };
  }
  const pending = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const label = String(item.label || '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, MAX_LABEL);
    const urlText = String(item.url || '').trim();
    if (!label && !urlText) continue;
    if (!label) return { ok: false, error: 'Each link needs a name.' };
    if (!urlText) return { ok: false, error: `"${label}" needs a URL.` };
    const url = parseHttpUrl(urlText);
    if (!url) {
      return { ok: false, error: `"${label}" needs an http or https URL.` };
    }
    pending.push({
      id: item.id,
      label,
      url,
      open: item.open || item.mode,
      icon: item.icon,
    });
  }
  return { ok: true, links: normalizeCustomMenuLinks(pending) };
}

module.exports = {
  MAX_LINKS,
  MAX_LABEL,
  MENU_LINK_ICONS,
  newMenuLinkId,
  normalizeCustomMenuLinks,
  parseCustomMenuLinksInput,
};
