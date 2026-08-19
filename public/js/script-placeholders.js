/**
 * Client helper for script sender placeholders and call-script markup.
 * Mirrors services/scriptPlaceholders.js + services/scriptMarkup.js.
 */
(function (global) {
  var EMPTY_MARK = '\u0000';
  var SENDER_GROUPS = [
    { key: 'name', aliases: ['your name', 'sender name'] },
    {
      key: 'company',
      aliases: ['company name', 'your company', 'agency name', 'business name', 'your agency', 'your company name'],
    },
    { key: 'phone', aliases: ['phone number', 'your phone', 'your number', 'phone'] },
    { key: 'email', aliases: ['email address', 'your email', 'email'] },
  ];

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
    var s = String(raw || '');
    if (!s) return '';
    s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
    s = s.replace(/<style[\s\S]*?<\/style>/gi, '');
    s = s.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    s = s.replace(/<\/?([a-z0-9]+)([^>]*)>/gi, function (full, tag, attrs) {
      if (!/^(b|strong|i|em|u|br|p|div|span)$/i.test(tag)) return '';
      var t = String(tag).toLowerCase();
      if (t === 'br') return '<br>';
      if (full.indexOf('</') === 0) return '</' + t + '>';
      var safeAttrs = String(attrs || '').replace(
        /\s(?:style|class|id|dir|contenteditable|href|src)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi,
        '',
      );
      return '<' + t + safeAttrs + '>';
    });
    return s;
  }

  function scriptTextToEditorHtml(text) {
    var s = String(text || '');
    if (!s) return '';
    var html = looksLikeScriptHtml(s) ? sanitizeScriptHtml(s) : escapeHtml(s);
    return html.replace(/\r\n/g, '\n').replace(/\n/g, '<br>');
  }

  function htmlToPlain(raw) {
    var s = String(raw || '');
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
    var s = sanitizeScriptHtml(raw);
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

  function aliasPattern(aliases) {
    var inner = aliases
      .slice()
      .sort(function (a, b) {
        return b.length - a.length;
      })
      .map(function (a) {
        return a.replace(/\s+/g, '\\s+');
      })
      .join('|');
    return new RegExp('\\[(?:' + inner + ')\\]', 'gi');
  }

  function lineIsOnlyPlaceholder(line, regex) {
    var stripped = String(line || '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .trim();
    if (!stripped) return false;
    regex.lastIndex = 0;
    var m = regex.exec(stripped);
    if (!m) return false;
    return stripped.replace(m[0], '').trim() === '';
  }

  function cleanupEmptyMarks(text) {
    var s = String(text || '');
    s = s
      .split('\n')
      .filter(function (line) {
        var stripped = String(line)
          .replace(/<br\s*\/?>/gi, '')
          .replace(new RegExp(EMPTY_MARK, 'g'), '')
          .trim();
        return !(String(line).indexOf(EMPTY_MARK) !== -1 && !stripped);
      })
      .join('\n');
    s = s.replace(new RegExp(EMPTY_MARK, 'g'), '');
    s = s.replace(/[ \t]{2,}/g, ' ');
    s = s.replace(/[ \t]+\n/g, '\n');
    return s.replace(/\n{3,}/g, '\n\n');
  }

  function replaceSenderPlaceholders(text, profile) {
    var p = profile && typeof profile === 'object' ? profile : {};
    var s = String(text || '');
    if (!s) return '';
    SENDER_GROUPS.forEach(function (group) {
      var re = aliasPattern(group.aliases);
      var value = p[group.key] || '';
      s = s
        .split('\n')
        .map(function (line) {
          if (!String(value || '').trim() && lineIsOnlyPlaceholder(line, aliasPattern(group.aliases))) {
            return EMPTY_MARK;
          }
          return String(value || '').trim() ? line.replace(re, String(value).trim()) : line;
        })
        .join('\n');
    });
    ['agency', 'company'].forEach(function (alias) {
      var re = aliasPattern([alias]);
      var value = p.company || '';
      s = s
        .split('\n')
        .map(function (line) {
          if (!String(value || '').trim() && lineIsOnlyPlaceholder(line, aliasPattern([alias]))) {
            return EMPTY_MARK;
          }
          return String(value || '').trim() ? line.replace(re, String(value).trim()) : line;
        })
        .join('\n');
    });
    return cleanupEmptyMarks(s);
  }

  function replaceProspectPlaceholders(text, prospect) {
    var pr = prospect && typeof prospect === 'object' ? prospect : {};
    var name = String(pr.name || pr.contact || pr.owner || '').trim();
    var company = String(pr.company || pr.title || pr.business || '').trim();
    var city = String(pr.city || '').trim();
    var s = String(text || '');
    if (name) {
      s = s.replace(/\{\{\s*name\s*\}\}/gi, name);
      s = s.replace(/\[name\]/gi, name);
    }
    if (company) {
      s = s.replace(/\{\{\s*company\s*\}\}/gi, company);
      s = s.replace(/\{\{\s*business_name\s*\}\}/gi, company);
    }
    if (city) s = s.replace(/\{\{\s*city\s*\}\}/gi, city);
    return s;
  }

  function fillScriptPlaceholders(text, ctx) {
    var c = ctx && typeof ctx === 'object' ? ctx : {};
    var s = replaceSenderPlaceholders(text, c.sender || getScriptProfile());
    return replaceProspectPlaceholders(s, c.prospect);
  }

  function getScriptProfile() {
    var p = global.__ADHELLO_SCRIPT_PROFILE__;
    return p && typeof p === 'object' ? p : { name: '', company: '', phone: '', email: '' };
  }

  async function copyScriptFormatted(html, opts) {
    var o = opts || {};
    var sender = o.sender || getScriptProfile();
    var prospect = o.prospect || null;
    var filledHtml = fillScriptPlaceholders(sanitizeScriptHtml(html), { sender: sender, prospect: prospect });
    var filledMd = fillScriptPlaceholders(htmlToMarkdown(html), { sender: sender, prospect: prospect });
    if (global.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([filledHtml], { type: 'text/html' }),
            'text/plain': new Blob([filledMd], { type: 'text/plain' }),
          }),
        ]);
        return;
      } catch (_) {}
    }
    await navigator.clipboard.writeText(filledMd);
  }

  global.AdHelloScripts = {
    escapeHtml: escapeHtml,
    sanitizeScriptHtml: sanitizeScriptHtml,
    scriptTextToEditorHtml: scriptTextToEditorHtml,
    htmlToPlain: htmlToPlain,
    htmlToMarkdown: htmlToMarkdown,
    replaceSenderPlaceholders: replaceSenderPlaceholders,
    replaceProspectPlaceholders: replaceProspectPlaceholders,
    fillScriptPlaceholders: fillScriptPlaceholders,
    getScriptProfile: getScriptProfile,
    copyScriptFormatted: copyScriptFormatted,
  };
})(typeof window !== 'undefined' ? window : globalThis);
