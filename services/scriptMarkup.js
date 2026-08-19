/**
 * Small HTML whitelist for call-script formatting (bold / italic / underline).
 */

const ALLOWED_TAG = /^(b|strong|i|em|u|br|p|div|span)$/i;

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function looksLikeScriptHtml(raw) {
  return /<(?:b|strong|i|em|u|br|p|div|span)\b/i.test(String(raw || ''));
}

function sanitizeScriptHtml(raw) {
  let s = String(raw || '');
  if (!s) return '';
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, '');
  s = s.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  s = s.replace(/<\/?([a-z0-9]+)([^>]*)>/gi, (full, tag, attrs) => {
    if (!ALLOWED_TAG.test(tag)) return '';
    const t = String(tag).toLowerCase();
    if (t === 'br') return '<br>';
    if (full.startsWith('</')) return `</${t}>`;
    const safeAttrs = String(attrs || '').replace(/\s(?:style|class|id|dir|contenteditable|href|src)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    return `<${t}${safeAttrs}>`;
  });
  return s;
}

function scriptTextToEditorHtml(text) {
  const s = String(text || '');
  if (!s) return '';
  const html = looksLikeScriptHtml(s) ? sanitizeScriptHtml(s) : escapeHtml(s);
  return html.replace(/\r\n/g, '\n').replace(/\n/g, '<br>');
}

function htmlToPlain(raw) {
  let s = String(raw || '');
  if (!s) return '';
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(?:p|div)>/gi, '\n');
  s = s.replace(/<(?:p|div)[^>]*>/gi, '');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/&nbsp;/gi, ' ');
  s = s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

function htmlToMarkdown(raw) {
  let s = sanitizeScriptHtml(raw);
  if (!s) return '';
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(?:p|div)>/gi, '\n');
  s = s.replace(/<(?:p|div|span)[^>]*>/gi, '');
  s = s.replace(/<\/span>/gi, '');
  s = s.replace(/<(?:strong|b)>/gi, '**').replace(/<\/(?:strong|b)>/gi, '**');
  s = s.replace(/<(?:em|i)>/gi, '*').replace(/<\/(?:em|i)>/gi, '*');
  s = s.replace(/<u>/gi, '__').replace(/<\/u>/gi, '__');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/&nbsp;/gi, ' ');
  s = s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = {
  escapeHtml,
  looksLikeScriptHtml,
  sanitizeScriptHtml,
  scriptTextToEditorHtml,
  htmlToPlain,
  htmlToMarkdown,
};
