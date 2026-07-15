(function () {
  'use strict';

  const DEFAULT_ACCENT = '#CA8A04';

  function normalizeHex(raw) {
    const s = String(raw || '').trim();
    if (!/^#[0-9A-Fa-f]{6}$/.test(s)) return null;
    return '#' + s.slice(1).toUpperCase();
  }

  function hexToRgb(hex) {
    const norm = normalizeHex(hex);
    if (!norm) return null;
    return {
      r: parseInt(norm.slice(1, 3), 16),
      g: parseInt(norm.slice(3, 5), 16),
      b: parseInt(norm.slice(5, 7), 16),
    };
  }

  function mixHex(hex, target, amount) {
    const a = hexToRgb(hex);
    const b = hexToRgb(target);
    if (!a || !b) return hex;
    const t = Math.max(0, Math.min(1, Number(amount) || 0));
    const r = Math.round(a.r + (b.r - a.r) * t);
    const g = Math.round(a.g + (b.g - a.g) * t);
    const bl = Math.round(a.b + (b.b - a.b) * t);
    return (
      '#' +
      [r, g, bl]
        .map((n) => n.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase()
    );
  }

  function applyWorkspaceTheme(theme) {
    applyWorkspaceThemeToElement(document.documentElement, theme);
  }

  function applyWorkspaceThemeToElement(el, theme) {
    if (!el) return;
    const accent = normalizeHex(theme && theme.accentColor) || DEFAULT_ACCENT;
    el.style.setProperty('--ws-accent', accent);
    el.style.setProperty('--ws-accent-soft', mixHex(accent, '#FFFFFF', 0.88));
    el.style.setProperty('--ws-accent-muted', mixHex(accent, '#FFFFFF', 0.72));
    el.style.setProperty('--ws-accent-text', mixHex(accent, '#111827', 0.72));
    el.style.setProperty('--ws-accent-hover', mixHex(accent, '#111827', 0.12));
    el.style.setProperty('--ws-accent-hover', mixHex(accent, '#111827', 0.12));

    if (el === document.documentElement) {
      const nameEl = document.getElementById('workspaceThemeName');
      const rowEl = document.getElementById('workspaceThemeRow');
      const selectEl = document.getElementById('workspaceSelect');
      if (nameEl) {
        const name = theme && theme.name ? String(theme.name).trim() : '';
        if (name) {
          nameEl.textContent = name;
          if (rowEl && !selectEl) rowEl.classList.remove('hidden');
        } else {
          nameEl.textContent = '';
          if (rowEl && !selectEl) rowEl.classList.add('hidden');
        }
      }

      const swatch = document.getElementById('workspaceThemeSwatch');
      if (swatch) swatch.style.backgroundColor = accent;
    }
  }

  function renderWorkspaceSelect(selectEl, workspaces, selectedId) {
    if (!selectEl) return;
    const list = Array.isArray(workspaces) ? workspaces : [];
    const selected = String(selectedId || '').trim();
    selectEl.innerHTML = '';
    if (!list.length) {
      const opt = document.createElement('option');
      opt.value = selected || 'default';
      opt.textContent = selected || 'Default workspace';
      selectEl.appendChild(opt);
      return;
    }
    for (const ws of list) {
      const opt = document.createElement('option');
      opt.value = ws.id;
      opt.textContent = ws.name || ws.id;
      if (ws.id === selected) opt.selected = true;
      selectEl.appendChild(opt);
    }
    if (selected && !list.some((w) => w.id === selected)) {
      const opt = document.createElement('option');
      opt.value = selected;
      opt.textContent = selected;
      opt.selected = true;
      selectEl.insertBefore(opt, selectEl.firstChild);
    }
  }

  async function fetchWorkspaces(settings) {
    const apiBaseUrl = String(settings?.apiBaseUrl || '').replace(/\/+$/, '');
    const apiKey = String(settings?.apiKey || '').trim();
    const workspaceId = String(settings?.workspaceId || 'default').trim() || 'default';
    const accountEmail = String(settings?.accountEmail || '').trim().toLowerCase();
    if (!apiBaseUrl || !apiKey) {
      return { workspaces: [], activeWorkspaceId: workspaceId, requiresEmail: true };
    }
    const headers = {
      'x-api-key': apiKey,
      'x-workspace-id': workspaceId,
      Accept: 'application/json',
    };
    if (accountEmail) headers['x-user-email'] = accountEmail;
    const res = await fetch(`${apiBaseUrl}/autonomous/workspaces`, { headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      throw new Error((data && data.error) || `Could not load workspaces (${res.status})`);
    }
    return {
      workspaces: Array.isArray(data.workspaces) ? data.workspaces : [],
      activeWorkspaceId: data.activeWorkspaceId || workspaceId,
      requiresEmail: !!data.requiresEmail,
    };
  }

  async function fetchWorkspaceTheme(settings) {
    const apiBaseUrl = String(settings?.apiBaseUrl || '').replace(/\/+$/, '');
    const apiKey = String(settings?.apiKey || '').trim();
    const workspaceId = String(settings?.workspaceId || 'default').trim() || 'default';
    if (!apiBaseUrl || !apiKey) {
      return { accentColor: DEFAULT_ACCENT, name: '', id: workspaceId };
    }
    const res = await fetch(`${apiBaseUrl}/autonomous/status`, {
      headers: {
        'x-api-key': apiKey,
        'x-workspace-id': workspaceId,
        Accept: 'application/json',
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      throw new Error((data && data.error) || `Could not load workspace theme (${res.status})`);
    }
    return (
      data.workspace || {
        id: data.workspaceId || workspaceId,
        name: '',
        accentColor: DEFAULT_ACCENT,
      }
    );
  }

  async function fetchAndApplyTheme(settings) {
    try {
      const theme = await fetchWorkspaceTheme(settings);
      applyWorkspaceTheme(theme);
      return theme;
    } catch (_) {
      applyWorkspaceTheme({ accentColor: DEFAULT_ACCENT });
      return null;
    }
  }

  window.AdHelloTheme = {
    DEFAULT_ACCENT,
    applyWorkspaceTheme,
    applyWorkspaceThemeToElement,
    fetchWorkspaceTheme,
    fetchAndApplyTheme,
    fetchWorkspaces,
    renderWorkspaceSelect,
  };
})();
