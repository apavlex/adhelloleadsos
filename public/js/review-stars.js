/**
 * Shared SVG star renderer for Reviews columns and panels.
 * Load before app.js (included from partials/head.ejs).
 */
(function (global) {
  const STAR_PATH =
    'M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z';

  function renderStarsInElement(element, rating, starSizeClass) {
    if (!element) return;
    element.innerHTML = '';
    const size = starSizeClass || element.dataset.starSize || 'w-3.5 h-3.5';
    const r = Math.max(0, Math.min(5, Number(rating) || 0));
    const fullStars = Math.floor(r);
    const hasHalf = r % 1 >= 0.5;

    for (let i = 0; i < 5; i++) {
      const lit = i < fullStars || (i === fullStars && hasHalf);
      const star = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      star.setAttribute(
        'class',
        `${size} shrink-0 ${lit ? 'text-amber-400 dark:text-brand-yellow' : 'text-slate-300 dark:text-slate-600'}`
      );
      star.setAttribute('viewBox', '0 0 20 20');
      star.setAttribute('fill', 'currentColor');
      star.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', STAR_PATH);
      star.appendChild(path);
      element.appendChild(star);
    }
  }

  function resolveRating(starContainer) {
    const direct = parseFloat(starContainer.dataset.rating);
    if (Number.isFinite(direct)) return direct;
    const host = starContainer.closest('[data-rating]');
    if (host) return parseFloat(host.dataset.rating) || 0;
    return 0;
  }

  function applyReviewStars(root) {
    if (root && typeof root.length === 'number' && typeof root.querySelectorAll !== 'function') {
      Array.from(root).forEach((row) => {
        if (!row || typeof row.querySelectorAll !== 'function') return;
        row.querySelectorAll('.row-stars, [data-review-stars]').forEach((starContainer) => {
          const rating = resolveRating(starContainer);
          const size = starContainer.dataset.starSize || 'w-3.5 h-3.5';
          renderStarsInElement(starContainer, rating, size);
        });
      });
      return;
    }
    const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
    scope.querySelectorAll('.row-stars, [data-review-stars]').forEach((starContainer) => {
      const rating = resolveRating(starContainer);
      const size = starContainer.dataset.starSize || 'w-3.5 h-3.5';
      renderStarsInElement(starContainer, rating, size);
    });
  }

  global.__renderStarsInElement = renderStarsInElement;
  global.__applyReviewStars = applyReviewStars;

  function runInitialReviewStars() {
    if (document.getElementById('prospectLeadsTable')) {
      if (document.documentElement.getAttribute('data-pipeline-prefs-ready') === '1') {
        applyReviewStars();
        return;
      }
      const reveal = function () {
        document.removeEventListener('adhello-pipeline-prefs-ready', reveal);
        applyReviewStars();
      };
      document.addEventListener('adhello-pipeline-prefs-ready', reveal);
      return;
    }
    applyReviewStars();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runInitialReviewStars);
  } else {
    runInitialReviewStars();
  }
})(typeof window !== 'undefined' ? window : global);
