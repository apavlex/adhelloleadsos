/**
 * Theme toggle — loaded from partials/navbar so every authenticated page gets it.
 * Persisted preference: localStorage key `color-theme` (matches inline script in partials/head.ejs).
 */
(function () {
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

  function bind() {
    document.querySelectorAll('#themeToggleBtn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var isDark = document.documentElement.classList.contains('dark');
        setTheme(isDark ? 'light' : 'dark');
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
