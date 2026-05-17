/**
 * Browser build of services/socialBrandIcons.js — keep SVG markup in sync.
 */
(function () {
  const SOCIAL_BTN_BASE =
    'inline-flex w-8 h-8 shrink-0 rounded-lg bg-brand-cream dark:bg-slate-800 items-center justify-center shadow-sm border border-brand-border/10 transition-all hover:scale-105';

  const PLATFORMS = {
    google: {
      title: 'Google Maps / Business Profile',
      ariaLabel: 'Google Business Profile (opens in Maps)',
      hover: 'hover:bg-[#4285F4]/15 dark:hover:bg-[#4285F4]/25',
      icon:
        '<svg class="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>',
    },
    facebook: {
      title: 'Facebook',
      ariaLabel: 'Facebook',
      hover: 'hover:bg-[#1877F2]/15 dark:hover:bg-[#1877F2]/25',
      icon:
        '<svg class="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true"><path fill="#1877F2" d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>',
    },
    instagram: {
      title: 'Instagram',
      ariaLabel: 'Instagram',
      hover: 'hover:bg-[#E4405F]/15 dark:hover:bg-[#E4405F]/25',
      iconForId(id) {
        return `<svg class="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="${id}" x1="0%" y1="100%" x2="100%" y2="0%"><stop offset="0%" stop-color="#F58529"/><stop offset="35%" stop-color="#DD2A7B"/><stop offset="70%" stop-color="#8134AF"/><stop offset="100%" stop-color="#515BD4"/></linearGradient></defs><path fill="url(#${id})" d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zm0 10.162a3.999 3.999 0 110-7.998 3.999 3.999 0 010 7.998zm6.406-11.845a1.44 1.44 0 11-2.881.001 1.44 1.44 0 012.881-.001z"/></svg>`;
      },
    },
    twitter: {
      title: 'X / Twitter',
      ariaLabel: 'X',
      hover: 'hover:bg-black/10 dark:hover:bg-white/15',
      icon:
        '<svg class="w-4 h-4 text-brand-dark dark:text-white" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.045 4.126H5.078z"/></svg>',
    },
    linkedin: {
      title: 'LinkedIn',
      ariaLabel: 'LinkedIn',
      hover: 'hover:bg-[#0A66C2]/15 dark:hover:bg-[#0A66C2]/25',
      icon:
        '<svg class="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true"><path fill="#0A66C2" d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a1.44 1.44 0 01-2.063-2.065 1.44 1.44 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>',
    },
  };

  function escapeHtmlAttr(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }

  function isBlankLink(v) {
    const s = String(v || '').trim();
    return !s || s === 'N/A' || s === 'undefined';
  }

  function normalizeHref(href) {
    const s = String(href || '').trim();
    if (!s) return '';
    return /^https?:\/\//i.test(s) ? s : `https://${s}`;
  }

  function linkHtml(platform, href, opts) {
    opts = opts || {};
    const p = PLATFORMS[platform];
    if (!p || isBlankLink(href)) return '';
    const url = normalizeHref(href);
    const gradId = opts.gradId || 'igGrad' + platform;
    const icon =
      platform === 'instagram' && typeof p.iconForId === 'function'
        ? p.iconForId(gradId)
        : p.icon;
    const stop = opts.stopPropagation !== false ? ' onclick="event.stopPropagation()"' : '';
    return (
      '<a href="' +
      escapeHtmlAttr(url) +
      '" target="_blank" rel="noopener noreferrer"' +
      ' class="' +
      SOCIAL_BTN_BASE +
      ' ' +
      p.hover +
      '" title="' +
      escapeHtmlAttr(p.title) +
      '" aria-label="' +
      escapeHtmlAttr(p.ariaLabel) +
      '"' +
      stop +
      '>' +
      icon +
      '</a>'
    );
  }

  function renderLinks(links) {
    links = links || {};
    const suffix = links.gradSuffix != null ? String(links.gradSuffix) : '';
    const parts = [];
    if (!isBlankLink(links.gm)) parts.push(linkHtml('google', links.gm));
    if (!isBlankLink(links.fb)) parts.push(linkHtml('facebook', links.fb));
    if (!isBlankLink(links.ig)) parts.push(linkHtml('instagram', links.ig, { gradId: 'igGrad' + suffix }));
    if (!isBlankLink(links.tw)) parts.push(linkHtml('twitter', links.tw));
    if (!isBlankLink(links.li)) parts.push(linkHtml('linkedin', links.li));
    if (!parts.length) {
      return '<span class="text-xs font-semibold text-brand-muted/60 dark:text-slate-500">—</span>';
    }
    return parts.join('');
  }

  window.AdhelloSocialBrand = {
    SOCIAL_BTN_BASE: SOCIAL_BTN_BASE,
    PLATFORMS: PLATFORMS,
    linkHtml: linkHtml,
    renderLinks: renderLinks,
    escapeHtmlAttr: escapeHtmlAttr,
    GOOGLE_BUSINESS_ICON_SVG: PLATFORMS.google.icon,
    GOOGLE_SOCIALS_TABLE_BTN_CLASS:
      SOCIAL_BTN_BASE + ' hover:bg-[#4285F4]/15 dark:hover:bg-[#4285F4]/25',
  };
})();
