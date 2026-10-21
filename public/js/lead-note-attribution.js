/**
 * Client-side note attribution (AI / you / teammate) for lead panel touch points + history.
 * Keep in sync with services/leadNoteAttribution.js.
 */
(function (global) {
  'use strict';

  var AI_SOURCES = {
    ai_assistant: 1,
    ai: 1,
    pavlex: 1,
    cursor_agent: 1,
    mcp: 1,
  };

  function viewerEmail() {
    if (global.__adhelloUserEmail) return String(global.__adhelloUserEmail).trim().toLowerCase();
    var el = document.body;
    if (el && el.getAttribute) {
      return String(el.getAttribute('data-user-email') || '').trim().toLowerCase();
    }
    return '';
  }

  function extractEmail(value) {
    var s = String(value || '');
    var m = s.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return m ? m[0].toLowerCase() : '';
  }

  function extractDisplayName(by) {
    var s = String(by || '').trim();
    if (!s) return '';
    var beforeParen = s.split('(')[0].trim();
    if (beforeParen && beforeParen.indexOf('@') >= 0) return beforeParen.split('@')[0];
    if (beforeParen) return beforeParen.slice(0, 40);
    return '';
  }

  function emailAliases(email) {
    var e = String(email || '').trim().toLowerCase();
    if (!e) return [];
    var out = [e];
    if (e.slice(-11) === '@adhello.io') out.push(e.replace(/@adhello\.io$/, '@adhello.ai'));
    else if (e.slice(-11) === '@adhello.ai') out.push(e.replace(/@adhello\.ai$/, '@adhello.io'));
    return out;
  }

  function emailsMatch(a, b) {
    var left = emailAliases(a);
    var right = {};
    emailAliases(b).forEach(function (x) {
      right[x] = 1;
    });
    return left.some(function (e) {
      return !!right[e];
    });
  }

  function isBotEmail(email) {
    return String(email || '').indexOf('bot:') === 0;
  }

  function noteBody(raw) {
    if (!raw || typeof raw !== 'object') return '';
    if (raw.value != null && String(raw.value).trim()) return String(raw.value);
    if (raw.content != null && String(raw.content).trim()) return String(raw.content);
    if (raw.message != null && String(raw.message).trim()) return String(raw.message);
    if (raw.note != null && String(raw.note).trim()) return String(raw.note);
    if (raw.text != null && String(raw.text).trim()) return String(raw.text);
    return '';
  }

  function looksLikeAiNote(raw, body) {
    var source = String((raw && raw.source) || '').toLowerCase();
    if (AI_SOURCES[source]) return true;
    var byEmail = String((raw && raw.byEmail) || '').toLowerCase();
    if (isBotEmail(byEmail)) return true;
    var by = String((raw && raw.by) || '').trim();
    if (isBotEmail(by)) return true;
    if (/^ai(\s|$| assistant)/i.test(by) || /^assistant\b/i.test(by)) return true;
    if (/\(prospecting digest\)/i.test(body) || /^Prospect #\d+/i.test(body)) return true;
    return false;
  }

  function classifyNoteAttribution(raw, opts) {
    var entry = raw && typeof raw === 'object' ? raw : {};
    var body = noteBody(entry);
    var by = String(entry.by || '').trim();
    var byEmail = String(entry.byEmail || extractEmail(by) || '').toLowerCase();
    var viewer = String((opts && opts.viewerEmail) || viewerEmail() || '').trim().toLowerCase();

    if (looksLikeAiNote(entry, body)) {
      return {
        kind: 'ai',
        label: 'AI note',
        badge: 'AI',
        detail: by && !isBotEmail(by) ? by : 'AI assistant',
      };
    }
    if (viewer && byEmail && emailsMatch(viewer, byEmail)) {
      return { kind: 'me', label: 'Your note', badge: 'You', detail: by || viewer };
    }
    if (byEmail || by) {
      var name = extractDisplayName(by) || (byEmail ? byEmail.split('@')[0] : '') || 'Teammate';
      return {
        kind: 'teammate',
        label: name + "'s note",
        badge: name,
        detail: by || byEmail,
      };
    }
    return { kind: 'unknown', label: 'Note', badge: '', detail: '' };
  }

  function noteTypeLabel(raw, opts) {
    var attr = classifyNoteAttribution(raw, opts);
    return attr.kind === 'unknown' ? 'Note' : attr.label;
  }

  var BADGE_CLASS = {
    ai: 'border-violet-500/40 text-violet-800 dark:text-violet-200 bg-violet-500/10',
    me: 'border-sky-500/40 text-sky-900 dark:text-sky-200 bg-sky-500/10',
    teammate: 'border-amber-500/40 text-amber-950 dark:text-amber-100 bg-amber-500/10',
  };

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function attributionBadgeHtml(attr) {
    if (!attr || !attr.badge || attr.kind === 'unknown') return '';
    var cls = BADGE_CLASS[attr.kind] || BADGE_CLASS.teammate;
    var title = attr.detail ? ' title="' + escapeHtml(attr.detail) + '"' : '';
    return (
      '<span class="inline-flex items-center rounded-md border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest ' +
      cls +
      '"' +
      title +
      '>' +
      escapeHtml(attr.badge) +
      '</span>'
    );
  }

  /** Expandable note body — full text available, collapsed when long. */
  function noteBodyHtml(text, opts) {
    var full = String(text || '').trim();
    if (!full) return '';
    var limit = (opts && opts.collapseAt) || 320;
    var escaped = escapeHtml(full).replace(/\n/g, '<br>');
    if (full.length <= limit) {
      return (
        '<p class="text-[11px] font-semibold text-brand-dark dark:text-slate-200 mt-0.5 leading-snug whitespace-pre-wrap break-words">' +
        escaped +
        '</p>'
      );
    }
    var preview = escapeHtml(full.slice(0, limit)).replace(/\n/g, '<br>') + '…';
    return (
      '<div class="lead-note-body mt-0.5" data-expanded="false">' +
      '<p class="lead-note-preview text-[11px] font-semibold text-brand-dark dark:text-slate-200 leading-snug whitespace-pre-wrap break-words">' +
      preview +
      '</p>' +
      '<p class="lead-note-full hidden text-[11px] font-semibold text-brand-dark dark:text-slate-200 leading-snug whitespace-pre-wrap break-words">' +
      escaped +
      '</p>' +
      '<button type="button" class="lead-note-expand mt-1 text-[9px] font-black uppercase tracking-widest text-brand-yellow hover:underline">Show full note</button>' +
      '</div>'
    );
  }

  function bindNoteExpand(root) {
    var host = root || document;
    if (!host || host.__leadNoteExpandBound) return;
    host.__leadNoteExpandBound = true;
    host.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('.lead-note-expand') : null;
      if (!btn) return;
      e.preventDefault();
      var wrap = btn.closest('.lead-note-body');
      if (!wrap) return;
      var open = wrap.getAttribute('data-expanded') === 'true';
      var next = !open;
      wrap.setAttribute('data-expanded', next ? 'true' : 'false');
      var preview = wrap.querySelector('.lead-note-preview');
      var full = wrap.querySelector('.lead-note-full');
      if (preview) preview.classList.toggle('hidden', next);
      if (full) full.classList.toggle('hidden', !next);
      btn.textContent = next ? 'Show less' : 'Show full note';
    });
  }

  global.AdhelloLeadNoteAttribution = {
    viewerEmail: viewerEmail,
    classifyNoteAttribution: classifyNoteAttribution,
    noteTypeLabel: noteTypeLabel,
    attributionBadgeHtml: attributionBadgeHtml,
    noteBodyHtml: noteBodyHtml,
    bindNoteExpand: bindNoteExpand,
    looksLikeAiNote: looksLikeAiNote,
  };
})(typeof window !== 'undefined' ? window : globalThis);
