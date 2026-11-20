/**
 * Full-page Pavlex chat (/chat): conversation sidebar, thread, composer.
 * Server: /api/pavlex/conversations* + POST /api/pavlex/chat (platform "chat").
 */
(function () {
  'use strict';

  var CFG = window.__PAVLEX_CHAT__ || {};
  var REQUEST_TIMEOUT_MS = 90000;
  var EMPLOYEES = Array.isArray(CFG.employees) && CFG.employees.length ? CFG.employees : [
    {
      id: 'alex',
      name: 'Alex',
      title: 'Receptionist & sales assistant',
      greeting: "Hey, I'm Alex.",
      emptyLead: 'Find prospects, update your pipeline, add tasks, and write scripts',
      placeholder: 'Message Alex… or tap the mic',
      avatarKind: 'alex',
      suggestions: [],
    },
  ];
  var EMPLOYEE_BY_ID = {};
  EMPLOYEES.forEach(function (e) {
    EMPLOYEE_BY_ID[e.id] = e;
  });
  var DEFAULT_EMPLOYEE_ID = CFG.defaultEmployeeId || EMPLOYEES[0].id;
  var AVATARS = CFG.avatars || {};
  var AVATARS_LARGE = CFG.avatarsLarge || {};
  var ICONS = CFG.icons || {};
  var AVATAR_SVG = CFG.avatarSvg || AVATARS.alex || '';

  function getEmployee(id) {
    return EMPLOYEE_BY_ID[id] || EMPLOYEE_BY_ID[DEFAULT_EMPLOYEE_ID] || EMPLOYEES[0];
  }

  function avatarHtml(kind, size) {
    var map = size === 'large' ? AVATARS_LARGE : AVATARS;
    if (kind === 'grok' && map.grok) return map.grok;
    if (map.alex) return map.alex;
    return AVATAR_SVG;
  }

  var TOOL_LABELS = {
    search_leads: 'Searched leads',
    find_leads: 'Started a prospect search',
    get_search_status: 'Checked search progress',
    list_leads: 'Listed leads',
    get_lead: 'Opened a lead',
    count_leads: 'Counted leads',
    update_lead: 'Updated a lead',
    bulk_update_leads: 'Updated leads',
    bookmark_leads: 'Bookmarked leads',
    list_folders: 'Listed folders',
    get_folder: 'Opened a folder',
    create_folder: 'Created a folder',
    list_custom_cadences: 'Checked your cadences',
    save_custom_cadence: 'Saved a cadence',
    get_cadence_ghl_prompt: 'Got the GHL prompt',
    rename_folder: 'Renamed a folder',
    list_opportunity_pipelines: 'Listed pipelines',
    get_opportunity_board: 'Read the pipeline',
    create_opportunity_pipeline: 'Created a pipeline',
    move_opportunity: 'Moved a lead',
    move_opportunities: 'Moved leads',
    enrich_lead: 'Enriched a lead',
    list_tasks: 'Listed tasks',
    create_task: 'Created a task',
    update_task: 'Updated a task',
    list_followups: 'Checked follow-ups',
    suggest_daily_leads: 'Picked leads for today',
    save_script: 'Saved a script',
  };

  var VERB_PAST = {
    search: 'Searched', find: 'Found', list: 'Listed', get: 'Opened', count: 'Counted', create: 'Created',
    update: 'Updated', bulk: 'Updated', move: 'Moved', enrich: 'Enriched', suggest: 'Suggested', save: 'Saved',
    add: 'Added', tag: 'Tagged', sync: 'Synced', delete: 'Deleted', remove: 'Removed', rename: 'Renamed',
    bookmark: 'Bookmarked', send: 'Sent', write: 'Wrote', check: 'Checked', set: 'Set', assign: 'Assigned',
  };

  function friendlyToolName(raw) {
    var name = String(raw || '').replace(/^mcp[_:.-]+/i, '').trim();
    if (!name) return '';
    if (TOOL_LABELS[name]) return TOOL_LABELS[name];
    var parts = name.split(/[_\s-]+/).filter(Boolean);
    if (!parts.length) return '';
    var verb = VERB_PAST[parts[0].toLowerCase()];
    var rest = parts.slice(verb ? 1 : 0).join(' ').toLowerCase();
    if (rest === 'ghl') rest = 'to GHL';
    else rest = rest.replace(/\bghl\b/g, 'GHL');
    var label = verb ? verb + (rest ? ' ' + rest : '') : rest;
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  // ── Safe markdown ───────────────────────────────────────────────────────────

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function unescapeHtml(s) {
    return String(s)
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&gt;/g, '>')
      .replace(/&lt;/g, '<')
      .replace(/&amp;/g, '&');
  }

  /** Only http(s), mailto, tel, and same-origin paths. Returns a raw URL or ''. */
  function safeUrl(raw) {
    var url = unescapeHtml(String(raw || '').trim());
    if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url) || /^tel:/i.test(url)) return url;
    if (url.charAt(0) === '/' && url.charAt(1) !== '/' && url.charAt(1) !== '\\') return url;
    if (/^lead:[A-Za-z0-9_-]+$/i.test(url)) return '/focus?lead=' + encodeURIComponent(url.slice(5));
    return '';
  }

  function anchorHtml(url, labelHtml) {
    var internal = url.charAt(0) === '/';
    if (internal && /^\/focus\?lead=lead(%3A|:)/i.test(url)) {
      url = url.replace(/^\/focus\?lead=lead(%3A|:)/i, '/focus?lead=');
    }
    return (
      '<a href="' + escapeHtml(url) + '"' +
      (internal ? '' : ' target="_blank" rel="noopener noreferrer"') +
      '>' + labelHtml + '</a>'
    );
  }

  function renderInline(text) {
    var tokens = [];
    function stash(html) {
      tokens.push(html);
      return '\u0001' + (tokens.length - 1) + '\u0001';
    }
    var s = escapeHtml(text);
    s = s.replace(/`([^`\n]+)`/g, function (_, code) {
      return stash('<code>' + code + '</code>');
    });
    s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, function (m, label, url) {
      var safe = safeUrl(url);
      return safe ? stash(anchorHtml(safe, label)) : label;
    });
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"&])/g, function (m, pre, url) {
      var safe = safeUrl(url);
      return safe ? pre + stash(anchorHtml(safe, url)) : m;
    });
    s = s.replace(/(^|[^\w/=])lead:([A-Za-z0-9_-]{4,})/g, function (m, pre, key) {
      return pre + stash(anchorHtml('/focus?lead=' + encodeURIComponent(key), 'lead:' + key));
    });
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>');
    s = s.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
    return s.replace(/\u0001(\d+)\u0001/g, function (_, i) {
      return tokens[Number(i)];
    });
  }

  function splitTableRow(line) {
    var t = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    return t.split('|').map(function (c) {
      return c.trim();
    });
  }

  function renderMarkdown(src) {
    var text = String(src || '').replace(/\r\n?/g, '\n');
    var codeBlocks = [];
    text = text.replace(/```[^\n]*\n?([\s\S]*?)```/g, function (_, code) {
      codeBlocks.push('<pre><code>' + escapeHtml(code.replace(/\n$/, '')) + '</code></pre>');
      return '\n\u0002' + (codeBlocks.length - 1) + '\u0002\n';
    });

    var lines = text.split('\n');
    var out = [];
    var para = [];
    var i = 0;

    function flushPara() {
      if (!para.length) return;
      out.push('<p>' + para.map(renderInline).join('<br>') + '</p>');
      para = [];
    }

    var reUl = /^(\s*)[-*+]\s+(.*)$/;
    var reOl = /^(\s*)\d+[.)]\s+(.*)$/;
    var reTableSep = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

    while (i < lines.length) {
      var line = lines[i];
      var trimmed = line.trim();

      if (!trimmed) {
        flushPara();
        i++;
        continue;
      }

      var codeMatch = trimmed.match(/^\u0002(\d+)\u0002$/);
      if (codeMatch) {
        flushPara();
        out.push(codeBlocks[Number(codeMatch[1])]);
        i++;
        continue;
      }

      var h = trimmed.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        flushPara();
        var level = Math.min(5, Math.max(2, h[1].length + 1));
        out.push('<h' + level + '>' + renderInline(h[2].replace(/\s*#+\s*$/, '')) + '</h' + level + '>');
        i++;
        continue;
      }

      if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
        flushPara();
        out.push('<hr>');
        i++;
        continue;
      }

      if (trimmed.charAt(0) === '|' && i + 1 < lines.length && reTableSep.test(lines[i + 1])) {
        flushPara();
        var head = splitTableRow(trimmed);
        i += 2;
        var rows = [];
        while (i < lines.length && lines[i].trim().charAt(0) === '|') {
          rows.push(splitTableRow(lines[i]));
          i++;
        }
        var html = '<div class="pc-table-wrap"><table><thead><tr>';
        head.forEach(function (c) {
          html += '<th>' + renderInline(c) + '</th>';
        });
        html += '</tr></thead><tbody>';
        rows.forEach(function (r) {
          html += '<tr>';
          for (var c = 0; c < head.length; c++) html += '<td>' + renderInline(r[c] || '') + '</td>';
          html += '</tr>';
        });
        out.push(html + '</tbody></table></div>');
        continue;
      }

      if (reUl.test(line) || reOl.test(line)) {
        flushPara();
        var ordered = !reUl.test(line);
        var re = ordered ? reOl : reUl;
        var items = [];
        while (i < lines.length && re.test(lines[i])) {
          var m = lines[i].match(re);
          items.push('<li' + (m[1].length >= 2 ? ' class="pc-li-nested"' : '') + '>' + renderInline(m[2]) + '</li>');
          i++;
          while (i < lines.length && lines[i].trim() && !reUl.test(lines[i]) && !reOl.test(lines[i]) && /^\s{2,}/.test(lines[i])) {
            items[items.length - 1] = items[items.length - 1].replace(/<\/li>$/, '<br>' + renderInline(lines[i].trim()) + '</li>');
            i++;
          }
        }
        out.push((ordered ? '<ol>' : '<ul>') + items.join('') + (ordered ? '</ol>' : '</ul>'));
        continue;
      }

      if (/^&gt;|^>/.test(trimmed)) {
        flushPara();
        var quote = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) {
          quote.push(renderInline(lines[i].replace(/^\s*>\s?/, '')));
          i++;
        }
        out.push('<blockquote>' + quote.join('<br>') + '</blockquote>');
        continue;
      }

      para.push(trimmed);
      i++;
    }
    flushPara();
    return out.join('');
  }

  // ── DOM refs / state ────────────────────────────────────────────────────────

  var els = {
    sidebar: document.getElementById('pcSidebar'),
    backdrop: document.getElementById('pcDrawerBackdrop'),
    drawerOpen: document.getElementById('pcDrawerOpen'),
    drawerClose: document.getElementById('pcDrawerClose'),
    appMenu: document.getElementById('pcAppMenu'),
    newChat: document.getElementById('pcNewChat'),
    newChatHeader: document.getElementById('pcNewChatHeader'),
    search: document.getElementById('pcSearch'),
    list: document.getElementById('pcConvList'),
    title: document.getElementById('pcTitle'),
    thread: document.getElementById('pcThread'),
    empty: document.getElementById('pcEmpty'),
    messages: document.getElementById('pcMessages'),
    typing: document.getElementById('pcTyping'),
    typingLabel: document.getElementById('pcTypingLabel'),
    form: document.getElementById('pcForm'),
    input: document.getElementById('pcInput'),
    send: document.getElementById('pcSend'),
    employee: document.getElementById('pcEmployee'),
    employeeTitle: document.getElementById('pcEmployeeTitle'),
    headerAvatar: document.getElementById('pcHeaderAvatar'),
    heroAvatar: document.getElementById('pcHeroAvatar'),
    emptyGreeting: document.getElementById('pcEmptyGreeting'),
    emptyLead: document.getElementById('pcEmptyLead'),
    suggestions: document.getElementById('pcSuggestions'),
    typingAvatar: document.getElementById('pcTypingAvatar'),
    composerHint: document.getElementById('pcComposerHint'),
    handoffBtn: document.getElementById('pcHandoffGrok'),
    handoffModal: document.getElementById('pcHandoffModal'),
    handoffText: document.getElementById('pcHandoffText'),
    handoffCopy: document.getElementById('pcHandoffCopy'),
    handoffClose: document.getElementById('pcHandoffClose'),
    addEmployee: document.getElementById('pcAddEmployee'),
    settingsOpen: document.getElementById('pcSettingsOpen'),
    settingsClose: document.getElementById('pcSettingsClose'),
    settingsPanel: document.getElementById('pcSettingsPanel'),
    settingsBackdrop: document.getElementById('pcSettingsBackdrop'),
    settingsHandoff: document.getElementById('pcSettingsHandoff'),
    settingsAddBot: document.getElementById('pcSettingsAddBot'),
    handoffEnabled: document.getElementById('pcHandoffEnabled'),
  };
  if (!els.form || !els.thread) return;

  var state = {
    conversations: [],
    activeId: '',
    busy: false,
    /** Bumped whenever the visible thread changes, so late replies never render into the wrong chat. */
    epoch: 0,
    filter: '',
    employeeId: DEFAULT_EMPLOYEE_ID,
    employeeLocked: false,
  };

  function workspaceId() {
    return String(CFG.workspaceId || window.__ADHELLO_WORKSPACE_ID__ || '').trim();
  }

  function withWs(url) {
    var wid = workspaceId();
    if (!wid) return url;
    return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'workspaceId=' + encodeURIComponent(wid);
  }

  function readJson(r) {
    return r.text().then(function (txt) {
      var body = null;
      try {
        body = txt ? JSON.parse(txt) : {};
      } catch (_) {
        body = null;
      }
      if (body && typeof body === 'object') {
        body.__status = r.status;
        return body;
      }
      var msg;
      if (r.status >= 502 && r.status <= 504) msg = 'AdHello is restarting after an update. Wait a minute, then try again.';
      else if (r.status === 401 || r.status === 403 || (r.redirected && /\/login/.test(r.url || '')))
        msg = 'Your session expired. Refresh the page and sign in again.';
      else msg = 'The server sent an unexpected reply (' + r.status + '). Try again.';
      return { success: false, error: msg, __status: r.status };
    });
  }

  function api(method, url, body) {
    var opts = {
      method: method,
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(Object.assign({ workspaceId: workspaceId() || undefined }, body));
    }
    return fetch(withWs(url), opts).then(readJson);
  }

  // ── Sidebar ─────────────────────────────────────────────────────────────────

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  function groupLabel(iso) {
    var t = Date.parse(iso || '');
    if (!Number.isFinite(t)) return 'Older';
    var today = startOfDay(new Date());
    var day = 86400000;
    if (t >= today) return 'Today';
    if (t >= today - day) return 'Yesterday';
    if (t >= today - 7 * day) return 'Previous 7 days';
    return 'Older';
  }

  var ICON_PIN =
    '<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z"/></svg>';
  var ICON_PIN_FILLED =
    '<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z"/></svg>';
  var ICON_EDIT =
    '<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z"/></svg>';
  var ICON_TRASH =
    '<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/></svg>';

  function renderList() {
    if (!els.list) return;
    var q = state.filter.trim().toLowerCase();
    var items = state.conversations.filter(function (c) {
      if (!q) return true;
      return (
        String(c.title || '').toLowerCase().indexOf(q) >= 0 ||
        String(c.lastPreview || '').toLowerCase().indexOf(q) >= 0
      );
    });
    if (!items.length) {
      els.list.innerHTML =
        '<p class="px-3 py-6 text-xs text-brand-muted text-center">' +
        (q ? 'No chats match “' + escapeHtml(state.filter.trim()) + '”.' : 'No chats yet. Pick a teammate and ask anything to start one.') +
        '</p>';
      return;
    }
    var groups = [];
    var byLabel = {};
    items.forEach(function (c) {
      var label = c.pinned ? 'Pinned' : groupLabel(c.updatedAt);
      if (!byLabel[label]) {
        byLabel[label] = [];
        groups.push(label);
      }
      byLabel[label].push(c);
    });
    var html = '';
    groups.forEach(function (label) {
      html +=
        '<p class="px-3 pt-4 pb-1.5 text-[10px] font-black uppercase tracking-widest text-brand-muted opacity-70 dark:text-slate-500">' +
        escapeHtml(label) +
        '</p>';
      byLabel[label].forEach(function (c) {
        var active = c.id === state.activeId;
        var emp = getEmployee(c.employeeId);
        html +=
          '<div role="listitem" class="pc-conv flex items-center rounded-2xl mb-0.5' + (active ? ' pc-conv--active' : '') +
          '" data-id="' + escapeHtml(c.id) + '">' +
          '<a href="/chat?c=' + encodeURIComponent(c.id) + '" class="pc-conv-open flex-1 min-w-0 pl-4 pr-3 py-2.5" data-id="' + escapeHtml(c.id) + '"' + (active ? ' aria-current="page"' : '') + '>' +
          '<span class="block text-[13px] ' + (active ? 'font-bold' : 'font-semibold') + ' text-brand-dark dark:text-white truncate">' + escapeHtml(c.title || 'New chat') + '</span>' +
          '<span class="block text-[10px] font-bold uppercase tracking-wider text-brand-muted dark:text-slate-500 truncate mt-0.5">' +
          escapeHtml(emp.name) +
          (c.lastPreview ? ' · ' + escapeHtml(c.lastPreview) : '') +
          '</span>' +
          '</a>' +
          '<div class="pc-conv-actions flex items-center pr-1">' +
          '<button type="button" class="pc-conv-pin pc-conv-act ' + (c.pinned ? 'text-brand-dark dark:text-brand-yellow' : 'text-brand-muted') + ' hover:bg-black/5 dark:hover:bg-white/10" data-id="' + escapeHtml(c.id) + '" aria-label="' + (c.pinned ? 'Unpin chat' : 'Pin chat') + '" title="' + (c.pinned ? 'Unpin' : 'Pin') + '">' + (c.pinned ? ICON_PIN_FILLED : ICON_PIN) + '</button>' +
          '<button type="button" class="pc-conv-rename pc-conv-act text-brand-muted hover:text-brand-dark dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10" data-id="' + escapeHtml(c.id) + '" aria-label="Rename chat" title="Rename">' + ICON_EDIT + '</button>' +
          '<button type="button" class="pc-conv-delete pc-conv-act text-brand-muted hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40" data-id="' + escapeHtml(c.id) + '" aria-label="Delete chat" title="Delete">' + ICON_TRASH + '</button>' +
          '</div></div>';
      });
    });
    els.list.innerHTML = html;
  }

  function upsertConversation(conv) {
    if (!conv || !conv.id) return;
    var idx = -1;
    for (var i = 0; i < state.conversations.length; i++) {
      if (state.conversations[i].id === conv.id) {
        idx = i;
        break;
      }
    }
    if (idx >= 0) state.conversations[idx] = conv;
    else state.conversations.unshift(conv);
    state.conversations.sort(function (a, b) {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    });
    renderList();
    if (conv.id === state.activeId) setTitle(conv.title);
  }

  function findConversation(id) {
    for (var i = 0; i < state.conversations.length; i++) {
      if (state.conversations[i].id === id) return state.conversations[i];
    }
    return null;
  }

  function loadConversations() {
    return api('GET', '/api/pavlex/conversations').then(function (d) {
      if (d.success && Array.isArray(d.conversations)) {
        var loadedIds = {};
        d.conversations.forEach(function (c) {
          loadedIds[c.id] = true;
        });
        // A chat created while this list was in flight (auto-sent ?q=) must not vanish.
        var fresh = state.conversations.filter(function (c) {
          return c && c.id && !loadedIds[c.id];
        });
        state.conversations = fresh.concat(d.conversations);
        renderList();
      } else if (els.list) {
        els.list.innerHTML =
          '<p class="px-3 py-6 text-xs text-red-600 text-center">' + escapeHtml(d.error || 'Could not load chats.') + '</p>';
      }
    });
  }

  // ── Drawer (phone) ──────────────────────────────────────────────────────────

  function isDesktop() {
    return window.matchMedia && window.matchMedia('(min-width: 768px)').matches;
  }

  function setDrawer(open) {
    if (!els.sidebar) return;
    if (open) {
      els.sidebar.classList.remove('-translate-x-full');
      if (els.backdrop) els.backdrop.classList.remove('hidden');
    } else {
      els.sidebar.classList.add('-translate-x-full');
      if (els.backdrop) els.backdrop.classList.add('hidden');
    }
    if (els.drawerOpen) els.drawerOpen.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  // ── Thread ──────────────────────────────────────────────────────────────────

  function setTitle(title) {
    var emp = getEmployee(state.employeeId);
    var t = title || emp.name;
    if (els.title) els.title.textContent = t;
    document.title = (title ? title + ' · ' : '') + emp.name + ' | Agency OS';
  }

  function applyEmployeeUi(opts) {
    opts = opts || {};
    var emp = getEmployee(state.employeeId);
    if (els.employee && !opts.skipSelect) {
      els.employee.value = emp.id;
      els.employee.disabled = state.employeeLocked === true;
      els.employee.title = state.employeeLocked
        ? 'This chat stays with ' + emp.name + '. Start a new chat to switch teammates.'
        : 'Choose who you are talking to';
    }
    if (els.employeeTitle) els.employeeTitle.textContent = emp.title;
    if (els.headerAvatar) els.headerAvatar.innerHTML = avatarHtml(emp.avatarKind, 'small');
    if (els.heroAvatar) els.heroAvatar.innerHTML = avatarHtml(emp.avatarKind, 'large');
    if (els.typingAvatar) els.typingAvatar.innerHTML = avatarHtml(emp.avatarKind, 'small');
    if (els.emptyGreeting) els.emptyGreeting.textContent = emp.greeting;
    if (els.emptyLead) {
      els.emptyLead.innerHTML =
        escapeHtml(emp.emptyLead) +
        ' in <strong class="font-semibold text-brand-dark dark:text-white">' +
        escapeHtml(CFG.workspaceName || 'this workspace') +
        '</strong>. Pick a teammate above — each chat stays with that employee.';
    }
    if (els.input) els.input.placeholder = emp.placeholder || ('Message ' + emp.name + '…');
    if (els.composerHint) {
      els.composerHint.textContent =
        'Mic to dictate · Enter to send · Shift+Enter for a new line · ' +
        emp.name +
        ' can make mistakes — check important changes.';
    }
    if (els.suggestions && Array.isArray(emp.suggestions) && emp.suggestions.length) {
      els.suggestions.innerHTML = emp.suggestions
        .map(function (s) {
          var iconPath = ICONS[s.icon] || ICONS.search || '';
          var attrs = s.prompt
            ? ' data-prompt="' + escapeHtml(s.prompt) + '"'
            : ' data-prefill="' + escapeHtml(s.prefill || '') + '" data-caret="' + escapeHtml(String(s.caret || '')) + '"';
          return (
            '<button type="button" class="pc-suggest group flex items-center gap-3 rounded-2xl border border-brand-border dark:border-white/10 bg-white dark:bg-slate-900 px-3.5 py-3 min-h-[3.5rem] text-left text-sm font-semibold leading-snug text-brand-dark dark:text-slate-100"' +
            attrs +
            '>' +
            '<span class="pc-suggest-icon w-9 h-9 shrink-0 rounded-xl flex items-center justify-center" aria-hidden="true">' +
            '<svg class="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="' +
            iconPath +
            '"/></svg></span>' +
            '<span class="min-w-0 flex-1">' +
            escapeHtml(s.label || '') +
            '</span></button>'
          );
        })
        .join('');
      bindSuggestionClicks();
    }
    if (!state.activeId) setTitle(emp.name);
  }

  function bindSuggestionClicks() {
    if (!els.suggestions) return;
    els.suggestions.querySelectorAll('.pc-suggest').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var prompt = btn.getAttribute('data-prompt');
        var prefill = btn.getAttribute('data-prefill');
        if (prompt) {
          sendMessage(prompt);
          return;
        }
        if (prefill) {
          els.input.value = prefill;
          autosize();
          els.input.focus();
          var caret = parseInt(btn.getAttribute('data-caret'), 10);
          if (Number.isFinite(caret)) {
            try {
              els.input.setSelectionRange(caret, caret);
            } catch (_) {
              /* ignore */
            }
          }
        }
      });
    });
  }

  function showEmpty(show) {
    if (els.empty) els.empty.classList.toggle('hidden', !show);
    if (els.messages) els.messages.classList.toggle('hidden', show);
  }

  function nearBottom() {
    var t = els.thread;
    return t.scrollHeight - t.scrollTop - t.clientHeight < 160;
  }

  function scrollToBottom(force) {
    if (!force && !nearBottom()) return;
    requestAnimationFrame(function () {
      els.thread.scrollTop = els.thread.scrollHeight;
    });
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy') ? resolve() : reject(new Error('copy failed'));
      } catch (e) {
        reject(e);
      } finally {
        document.body.removeChild(ta);
      }
    });
  }

  function avatar() {
    var emp = getEmployee(state.employeeId);
    return (
      '<span class="pc-avatar shrink-0 w-8 h-8 rounded-full overflow-hidden bg-white" aria-hidden="true">' +
      avatarHtml(emp.avatarKind, 'small') +
      '</span>'
    );
  }

  function toolChips(tools) {
    var seen = {};
    var labels = [];
    (Array.isArray(tools) ? tools : []).forEach(function (t) {
      var label = friendlyToolName(typeof t === 'string' ? t : t && t.name);
      if (label && !seen[label]) {
        seen[label] = true;
        labels.push(label);
      }
    });
    if (!labels.length) return '';
    return (
      '<div class="flex flex-wrap gap-1.5 mt-3" aria-label="Tools used">' +
      labels
        .map(function (l) {
          return (
            '<span class="inline-flex items-center gap-1.5 rounded-full border border-brand-border dark:border-white/10 bg-brand-cream dark:bg-slate-800 pl-2 pr-2.5 py-1 text-[11px] font-semibold text-brand-muted dark:text-slate-300">' +
            '<svg class="w-3 h-3 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>' +
            escapeHtml(l) +
            '</span>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  function appendUser(text) {
    var row = document.createElement('div');
    row.className = 'pc-msg pc-msg-user flex justify-end';
    row.innerHTML =
      '<div class="pc-bubble-user max-w-[85%] md:max-w-[75%] px-4 py-2.5 text-[15px] font-medium leading-relaxed whitespace-pre-wrap break-words"></div>';
    row.firstChild.textContent = text;
    els.messages.appendChild(row);
    return row;
  }

  function appendAssistant(text, tools) {
    var row = document.createElement('div');
    row.className = 'pc-msg pc-msg-assistant flex gap-3 items-start';
    row.innerHTML =
      avatar() +
      '<div class="min-w-0 flex-1 max-w-full pt-1">' +
      '<div class="pc-md text-[15px] leading-relaxed text-brand-dark dark:text-slate-100 break-words">' +
      renderMarkdown(text) +
      '</div>' +
      toolChips(tools) +
      '<div class="mt-2 -ml-2 flex items-center gap-2">' +
      '<button type="button" class="pc-copy inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px] font-semibold text-brand-muted hover:text-brand-dark dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors" aria-label="Copy reply">' +
      '<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75"/></svg>' +
      '<span>Copy</span></button>' +
      '</div></div>';
    var copyBtn = row.querySelector('.pc-copy');
    copyBtn.addEventListener('click', function () {
      var label = copyBtn.querySelector('span');
      copyText(text).then(
        function () {
          label.textContent = 'Copied';
          setTimeout(function () {
            label.textContent = 'Copy';
          }, 1600);
        },
        function () {
          label.textContent = 'Copy failed';
        },
      );
    });
    els.messages.appendChild(row);
    return row;
  }

  function appendError(message, onRetry) {
    var row = document.createElement('div');
    row.className = 'pc-msg pc-msg-error flex gap-3 items-start';
    row.innerHTML =
      avatar() +
      '<div class="min-w-0 flex-1">' +
      '<div class="pc-error-text rounded-3xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-700 dark:text-red-300 leading-relaxed"></div>' +
      '<button type="button" class="pc-retry mt-2 inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[10px] font-black uppercase tracking-widest bg-white dark:bg-slate-800 border border-brand-border dark:border-white/10 text-brand-dark dark:text-white hover:border-brand-yellow transition-colors">' +
      '<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"/></svg>' +
      'Retry</button></div>';
    row.querySelector('.pc-error-text').textContent = message;
    row.querySelector('.pc-retry').addEventListener('click', function () {
      row.parentNode && row.parentNode.removeChild(row);
      onRetry();
    });
    els.messages.appendChild(row);
    return row;
  }

  function clearThread() {
    els.messages.innerHTML = '';
  }

  function renderMessages(messages) {
    clearThread();
    (messages || []).forEach(function (m) {
      if (m.role === 'user') appendUser(m.content);
      else if (m.role === 'assistant') appendAssistant(m.content, m.toolsUsed);
    });
    showEmpty(!messages || !messages.length);
    scrollToBottom(true);
  }

  function updateUrl(id) {
    var url = id ? '/chat?c=' + encodeURIComponent(id) : '/chat';
    try {
      window.history.replaceState({ c: id || '' }, '', url);
    } catch (_) {
      /* ignore */
    }
  }

  function cancelVoice() {
    if (state.voice) state.voice.cancel();
  }

  function openConversation(id, opts) {
    opts = opts || {};
    if (id !== state.activeId) cancelVoice();
    var seq = ++state.epoch;
    state.activeId = id;
    updateUrl(id);
    renderList();
    var known = findConversation(id);
    if (known && known.employeeId) {
      state.employeeId = known.employeeId;
      state.employeeLocked = true;
      applyEmployeeUi();
    }
    setTitle(known ? known.title : 'Loading…');
    if (!isDesktop()) setDrawer(false);
    showTyping(false);
    clearThread();
    showEmpty(false);
    els.messages.innerHTML = '<p class="py-10 text-center text-xs font-semibold text-brand-muted">Loading chat…</p>';
    return api('GET', '/api/pavlex/conversations/' + encodeURIComponent(id) + '/messages').then(function (d) {
      if (seq !== state.epoch) return;
      if (d.success) {
        if (d.conversation) {
          upsertConversation(d.conversation);
          state.employeeId = d.conversation.employeeId || state.employeeId;
          state.employeeLocked = true;
          applyEmployeeUi();
        }
        setTitle(d.conversation ? d.conversation.title : getEmployee(state.employeeId).name);
        renderMessages(d.messages || []);
        if (!opts.keepFocus && isDesktop()) els.input.focus();
      } else if (d.__status === 404) {
        startNewChat();
        flash('That chat no longer exists.');
      } else {
        clearThread();
        appendError(d.error || 'Could not load this chat.', function () {
          openConversation(id);
        });
      }
    });
  }

  function startNewChat() {
    cancelVoice();
    state.epoch++;
    state.activeId = '';
    state.employeeLocked = false;
    updateUrl('');
    clearThread();
    showEmpty(true);
    showTyping(false);
    applyEmployeeUi();
    setTitle(getEmployee(state.employeeId).name);
    renderList();
    if (!isDesktop()) setDrawer(false);
    if (isDesktop()) els.input.focus();
  }

  function flash(text) {
    var row = document.createElement('p');
    row.className = 'max-w-3xl mx-auto px-4 pt-4 text-center text-xs font-semibold text-brand-muted';
    row.textContent = text;
    els.thread.insertBefore(row, els.thread.firstChild);
    setTimeout(function () {
      row.parentNode && row.parentNode.removeChild(row);
    }, 3500);
  }

  // ── Sending ─────────────────────────────────────────────────────────────────

  var typingTimer = null;
  function showTyping(show) {
    if (!els.typing) return;
    els.typing.classList.toggle('hidden', !show);
    clearInterval(typingTimer);
    if (show) {
      var started = Date.now();
      if (els.typingLabel) els.typingLabel.textContent = 'Working on it…';
      typingTimer = setInterval(function () {
        var s = Math.round((Date.now() - started) / 1000);
        if (els.typingLabel) {
          els.typingLabel.textContent = s >= 20 ? 'Still working — CRM tools can take a bit (' + s + 's)' : 'Working on it…';
        }
      }, 1000);
      scrollToBottom(true);
    }
  }

  function setBusy(busy) {
    state.busy = busy;
    els.send.disabled = busy || !els.input.value.trim();
    els.form.setAttribute('aria-busy', busy ? 'true' : 'false');
    document.querySelectorAll('.pc-suggest').forEach(function (b) {
      b.disabled = busy;
    });
  }

  function sendMessage(text, opts) {
    opts = opts || {};
    var msg = String(text || '').trim();
    if (!msg || state.busy) return;
    var convAtSend = state.activeId;
    var epochAtSend = state.epoch;
    setBusy(true);
    showEmpty(false);
    if (!opts.isRetry) appendUser(msg);
    showTyping(true);

    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timedOut = false;
    var timer = setTimeout(function () {
      timedOut = true;
      if (controller) controller.abort();
    }, REQUEST_TIMEOUT_MS);

    function stillViewing() {
      return state.epoch === epochAtSend;
    }

    function fail(message) {
      setBusy(false);
      if (!stillViewing()) return;
      showTyping(false);
      appendError(message, function () {
        if (!stillViewing()) return;
        sendMessage(msg, { isRetry: true });
      });
      scrollToBottom(true);
    }

    fetch(withWs('/api/pavlex/chat'), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      signal: controller ? controller.signal : undefined,
      body: JSON.stringify({
        message: msg,
        conversationId: convAtSend || undefined,
        workspaceId: workspaceId() || undefined,
        platform: 'chat',
        employeeId: state.employeeId,
        page: '/chat',
        pageTitle: document.title || '',
        ui:
          typeof window.collectPavlexUiContext === 'function'
            ? window.collectPavlexUiContext()
            : { path: '/chat', title: document.title || '' },
      }),
    })
      .then(readJson)
      .then(function (d) {
        clearTimeout(timer);
        if (d.success && d.reply) {
          setBusy(false);
          var viewing = stillViewing();
          if (d.conversation) {
            if (viewing && !convAtSend) {
              state.activeId = d.conversation.id;
              state.employeeId = d.conversation.employeeId || state.employeeId;
              state.employeeLocked = true;
              updateUrl(d.conversation.id);
              applyEmployeeUi();
            }
            upsertConversation(d.conversation);
          }
          if (viewing) {
            showTyping(false);
            appendAssistant(d.reply, d.toolsUsed);
            scrollToBottom(true);
          } else if (d.conversation && state.activeId === d.conversation.id) {
            openConversation(d.conversation.id, { keepFocus: true });
          }
          return;
        }
        if (d.__status === 404 && convAtSend) {
          fail('This chat was deleted. Start a new chat to keep going.');
          loadConversations();
          return;
        }
        fail(d.error || getEmployee(state.employeeId).name + ' could not answer just now. Try again.');
      })
      .catch(function () {
        clearTimeout(timer);
        fail(
          timedOut
            ? 'Alex took longer than 90 seconds. Big jobs (like prospect searches) may still finish in the background — check the chat list in a minute, or retry.'
            : 'Connection error. Check your internet and try again.',
        );
      });
  }

  // ── Composer ────────────────────────────────────────────────────────────────

  function autosize() {
    els.input.style.height = 'auto';
    els.input.style.height = Math.min(els.input.scrollHeight, 192) + 'px';
    els.send.disabled = state.busy || !els.input.value.trim();
  }

  function submitComposer() {
    var text = els.input.value;
    if (!text.trim() || state.busy) return;
    cancelVoice();
    els.input.value = '';
    autosize();
    sendMessage(text);
  }

  els.form.addEventListener('submit', function (e) {
    e.preventDefault();
    submitComposer();
  });

  els.input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submitComposer();
    }
  });
  els.input.addEventListener('input', autosize);

  var micBtn = document.getElementById('pcMic');
  function attachVoice() {
    if (!micBtn || !els.input || !window.AlexVoice || typeof window.AlexVoice.attach !== 'function') return;
    // Always show the mic; speech lands in the composer (never auto-sends).
    // Server POST /api/voice/transcribe when live browser speech isn't available.
    state.voice = window.AlexVoice.attach({
      button: micBtn,
      input: els.input,
      hideIfUnsupported: false,
    });
  }
  if (window.AlexVoice) attachVoice();
  else document.addEventListener('alexvoice:ready', attachVoice, { once: true });

  bindSuggestionClicks();

  if (els.employee) {
    els.employee.addEventListener('change', function () {
      if (state.employeeLocked) {
        els.employee.value = state.employeeId;
        return;
      }
      state.employeeId = els.employee.value || DEFAULT_EMPLOYEE_ID;
      applyEmployeeUi({ skipSelect: true });
    });
  }

  function refreshEmployeeSelect(list) {
    if (!els.employee || !Array.isArray(list)) return;
    EMPLOYEES.length = 0;
    list.forEach(function (e) {
      EMPLOYEES.push(e);
      EMPLOYEE_BY_ID[e.id] = e;
    });
    var current = state.employeeId;
    els.employee.innerHTML = list
      .map(function (e) {
        return (
          '<option value="' +
          escapeHtml(e.id) +
          '"' +
          (e.id === current ? ' selected' : '') +
          '>' +
          escapeHtml(e.name) +
          '</option>'
        );
      })
      .join('');
    applyEmployeeUi();
  }

  var HANDOFF_PREF_KEY = 'pavlexChatHandoffEnabled';

  function isHandoffEnabled() {
    try {
      var raw = localStorage.getItem(HANDOFF_PREF_KEY);
      if (raw == null) return true;
      return raw === '1' || raw === 'true';
    } catch (_) {
      return true;
    }
  }

  function setHandoffEnabled(on) {
    try {
      localStorage.setItem(HANDOFF_PREF_KEY, on ? '1' : '0');
    } catch (_) {
      /* ignore */
    }
    syncHandoffVisibility();
  }

  function syncHandoffVisibility() {
    var on = isHandoffEnabled();
    if (els.handoffBtn) {
      // Base classes: hidden on phone, inline on sm+ when enabled.
      els.handoffBtn.classList.toggle('hidden', !on);
      els.handoffBtn.classList.toggle('sm:inline-flex', on);
    }
    if (els.handoffEnabled) els.handoffEnabled.checked = on;
  }

  function setSettingsOpen(open) {
    if (!els.settingsPanel) return;
    if (open) {
      els.settingsPanel.hidden = false;
      els.settingsPanel.setAttribute('aria-hidden', 'false');
      requestAnimationFrame(function () {
        els.settingsPanel.classList.remove('translate-x-full');
      });
      if (els.settingsBackdrop) els.settingsBackdrop.classList.remove('hidden');
      if (els.settingsOpen) els.settingsOpen.setAttribute('aria-expanded', 'true');
      try {
        if (location.hash !== '#settings') history.replaceState(null, '', '#settings');
      } catch (_) {
        /* ignore */
      }
    } else {
      els.settingsPanel.classList.add('translate-x-full');
      els.settingsPanel.setAttribute('aria-hidden', 'true');
      if (els.settingsBackdrop) els.settingsBackdrop.classList.add('hidden');
      if (els.settingsOpen) els.settingsOpen.setAttribute('aria-expanded', 'false');
      setTimeout(function () {
        if (els.settingsPanel.getAttribute('aria-hidden') === 'true') els.settingsPanel.hidden = true;
      }, 300);
      try {
        if (location.hash === '#settings') history.replaceState(null, '', location.pathname + location.search);
      } catch (_) {
        /* ignore */
      }
    }
  }

  function openHandoffModal(text) {
    if (!els.handoffModal || !els.handoffText) return;
    els.handoffText.textContent = text || '';
    els.handoffModal.classList.remove('hidden');
  }

  function closeHandoffModal() {
    if (els.handoffModal) els.handoffModal.classList.add('hidden');
  }

  function runHandoff(triggerBtn) {
    if (triggerBtn) triggerBtn.disabled = true;
    if (els.handoffBtn) els.handoffBtn.disabled = true;
    api('POST', '/api/pavlex/handoff', {
      employeeId: state.employeeId,
      conversationId: state.activeId || undefined,
      createToken: true,
    })
      .then(function (d) {
        if (!d.success || !d.setupMessage) {
          window.alert(d.error || 'Could not build a Grok handoff.');
          return;
        }
        setSettingsOpen(false);
        openHandoffModal(d.setupMessage);
      })
      .catch(function () {
        window.alert('Could not build a Grok handoff. Try again.');
      })
      .finally(function () {
        if (triggerBtn) triggerBtn.disabled = false;
        if (els.handoffBtn) els.handoffBtn.disabled = false;
      });
  }

  if (els.handoffBtn) {
    els.handoffBtn.addEventListener('click', function () {
      runHandoff(els.handoffBtn);
    });
  }

  if (els.settingsOpen) {
    els.settingsOpen.addEventListener('click', function () {
      setSettingsOpen(true);
    });
  }
  if (els.settingsClose) els.settingsClose.addEventListener('click', function () { setSettingsOpen(false); });
  if (els.settingsBackdrop) els.settingsBackdrop.addEventListener('click', function () { setSettingsOpen(false); });
  if (els.settingsHandoff) {
    els.settingsHandoff.addEventListener('click', function () {
      runHandoff(els.settingsHandoff);
    });
  }
  if (els.settingsAddBot && els.addEmployee) {
    els.settingsAddBot.addEventListener('click', function () {
      setSettingsOpen(false);
      els.addEmployee.click();
    });
  }
  if (els.handoffEnabled) {
    els.handoffEnabled.addEventListener('change', function () {
      setHandoffEnabled(els.handoffEnabled.checked);
    });
  }
  syncHandoffVisibility();
  if (location.hash === '#settings') setSettingsOpen(true);
  window.addEventListener('hashchange', function () {
    if (location.hash === '#settings') setSettingsOpen(true);
  });
  if (els.handoffClose) els.handoffClose.addEventListener('click', closeHandoffModal);
  if (els.handoffModal) {
    els.handoffModal.addEventListener('click', function (e) {
      if (e.target === els.handoffModal) closeHandoffModal();
    });
  }
  if (els.handoffCopy) {
    els.handoffCopy.addEventListener('click', function () {
      var text = els.handoffText ? els.handoffText.textContent : '';
      copyText(text).then(
        function () {
          els.handoffCopy.textContent = 'Copied';
          setTimeout(function () {
            els.handoffCopy.textContent = 'Copy handoff';
          }, 1600);
        },
        function () {
          window.prompt('Copy this into Grok:', text);
        },
      );
    });
  }

  if (els.addEmployee) {
    els.addEmployee.addEventListener('click', function () {
      var name = window.prompt('Specialist name (e.g. Permit Grok)');
      if (name == null) return;
      name = name.trim();
      if (!name) return;
      var title = window.prompt('One-line job title', 'Specialist') || 'Specialist';
      var promptText =
        window.prompt(
          'Role instructions (what this bot specializes in)',
          'You are ' + name + ', a specialized AdHello employee. Use CRM tools. Stay in character.',
        ) || '';
      api('POST', '/api/pavlex/employees', {
        name: name,
        title: title,
        family: 'grok',
        identityPrompt: promptText,
        blurb: title,
      }).then(function (d) {
        if (!d.success) {
          window.alert(d.error || 'Could not add specialist.');
          return;
        }
        if (Array.isArray(d.employees)) refreshEmployeeSelect(d.employees);
        if (d.employee && d.employee.id && !state.employeeLocked) {
          state.employeeId = d.employee.id;
          applyEmployeeUi();
        }
      });
    });
  }

  // ── Sidebar events ──────────────────────────────────────────────────────────

  if (els.list) {
    els.list.addEventListener('click', function (e) {
      var target = e.target.closest('button, a');
      if (!target) return;
      var id = target.getAttribute('data-id');
      if (!id) return;
      if (target.classList.contains('pc-conv-open')) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
        e.preventDefault();
        if (id !== state.activeId) openConversation(id);
        else if (!isDesktop()) setDrawer(false);
        return;
      }
      var conv = findConversation(id);
      if (!conv) return;
      if (target.classList.contains('pc-conv-rename')) {
        var next = window.prompt('Rename chat', conv.title || '');
        if (next == null) return;
        next = next.trim();
        if (!next || next === conv.title) return;
        api('PATCH', '/api/pavlex/conversations/' + encodeURIComponent(id), { title: next }).then(function (d) {
          if (d.success && d.conversation) upsertConversation(d.conversation);
          else window.alert(d.error || 'Could not rename this chat.');
        });
      } else if (target.classList.contains('pc-conv-pin')) {
        api('PATCH', '/api/pavlex/conversations/' + encodeURIComponent(id), { pinned: !conv.pinned }).then(function (d) {
          if (d.success && d.conversation) upsertConversation(d.conversation);
        });
      } else if (target.classList.contains('pc-conv-delete')) {
        if (!window.confirm('Delete “' + (conv.title || 'this chat') + '”? Its messages will be removed for good.')) return;
        api('DELETE', '/api/pavlex/conversations/' + encodeURIComponent(id)).then(function (d) {
          if (!d.success && d.__status !== 404) {
            window.alert(d.error || 'Could not delete this chat.');
            return;
          }
          state.conversations = state.conversations.filter(function (c) {
            return c.id !== id;
          });
          if (state.activeId === id) startNewChat();
          else renderList();
        });
      }
    });
  }

  if (els.search) {
    els.search.addEventListener('input', function () {
      state.filter = els.search.value || '';
      renderList();
    });
  }

  [els.newChat, els.newChatHeader].forEach(function (b) {
    if (b) b.addEventListener('click', startNewChat);
  });
  if (els.drawerOpen) els.drawerOpen.addEventListener('click', function () { setDrawer(true); });
  if (els.drawerClose) els.drawerClose.addEventListener('click', function () { setDrawer(false); });
  if (els.backdrop) els.backdrop.addEventListener('click', function () { setDrawer(false); });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (els.handoffModal && !els.handoffModal.classList.contains('hidden')) {
      closeHandoffModal();
      return;
    }
    if (els.settingsPanel && els.settingsPanel.getAttribute('aria-hidden') === 'false') {
      setSettingsOpen(false);
      return;
    }
    if (!isDesktop()) setDrawer(false);
  });
  if (els.appMenu) {
    els.appMenu.addEventListener('click', function () {
      var btn = document.getElementById('mobileMenuBtn');
      if (btn) btn.click();
    });
  }

  // ── iOS keyboard: size the shell to the visual viewport ─────────────────────

  if (window.visualViewport) {
    var vv = window.visualViewport;
    var syncViewport = function () {
      document.documentElement.style.setProperty('--pc-vh', Math.round(vv.height) + 'px');
      if (window.scrollY !== 0 || vv.offsetTop > 0) window.scrollTo(0, 0);
      if (document.activeElement === els.input) scrollToBottom(true);
    };
    vv.addEventListener('resize', syncViewport);
    vv.addEventListener('scroll', syncViewport);
    syncViewport();
  }

  // ── Boot ────────────────────────────────────────────────────────────────────

  /** Starts a fresh chat and sends `text` as its first message. Returns false when a reply is still pending. */
  function startNewChatWith(text) {
    var msg = String(text || '').trim();
    if (!msg || state.busy) return false;
    startNewChat();
    sendMessage(msg);
    return true;
  }

  autosize();
  var initial = String(CFG.initialConversationId || '').trim();
  var bootParams = new URLSearchParams(window.location.search);
  var autoPrompt = bootParams.get('new') === '1' ? String(bootParams.get('q') || '').trim().slice(0, 6000) : '';
  if (autoPrompt) {
    // Drop ?q= from history before sending so a refresh or Back never re-sends it.
    initial = '';
    updateUrl('');
    startNewChatWith(autoPrompt);
  }
  loadConversations()
    .catch(function () {
      if (els.list) {
        els.list.innerHTML = '<p class="px-3 py-6 text-xs text-red-600 text-center">Could not load chats. Check your connection.</p>';
      }
    })
    .then(function () {
      if (autoPrompt) return;
      if (initial) openConversation(initial, { keepFocus: true });
      else startNewChat();
    });
  if (initial) {
    state.activeId = initial;
    showEmpty(false);
  }

  window.__pavlexChatPage = { startNewChatWith: startNewChatWith };
  window.__pavlexChatTest = { renderMarkdown: renderMarkdown, friendlyToolName: friendlyToolName };
})();
