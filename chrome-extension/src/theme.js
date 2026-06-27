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
    const accent = normalizeHex(theme && theme.accentColor) || DEFAULT_ACCENT;
    const root = document.documentElement;
    root.style.setProperty('--ws-accent', accent);
    root.style.setProperty('--ws-accent-soft', mixHex(accent, '#FFFFFF', 0.88));
    root.style.setProperty('--ws-accent-muted', mixHex(accent, '#FFFFFF', 0.72));
    root.style.setProperty('--ws-accent-text', mixHex(accent, '#111827', 0.72));

    const nameEl = document.getElementById('workspaceThemeName');
    const rowEl = document.getElementById('workspaceThemeRow');
    if (nameEl) {
      const name = theme && theme.name ? String(theme.name).trim() : '';
      if (name) {
        nameEl.textContent = name;
        if (rowEl) rowEl.classList.remove('hidden');
      } else {
        nameEl.textContent = '';
        if (rowEl) rowEl.classList.add('hidden');
      }
    }

    const swatch = document.getElementById('workspaceThemeSwatch');
    if (swatch) swatch.style.backgroundColor = accent;
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
    fetchWorkspaceTheme,
    fetchAndApplyTheme,
  };
})();
