/**
 * Theme toggle — loaded from partials/navbar so every authenticated page gets it.
 * Persisted preference: localStorage key `color-theme` (matches inline script in partials/head.ejs).
 */
(function () {
  if (window.__adhelloThemeToggleBound) return;
  window.__adhelloThemeToggleBound = true;

  function setTheme(theme) {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      localStorage.setItem('color-theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('color-theme', 'light');
    }
    try {
      window.dispatchEvent(new CustomEvent('agencyos:theme', { detail: { theme } }));
    } catch (_) {}
  }

  // Delegated so every theme button works (desktop top bar, mobile menu, ones added later).
  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('.theme-toggle-btn, #themeToggleBtn') : null;
    if (!btn) return;
    var isDark = document.documentElement.classList.contains('dark');
    setTheme(isDark ? 'light' : 'dark');
  });
})();
