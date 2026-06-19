/**
 * Solid surfaces for menus/popovers portaled to document.body.
 * Tailwind CDN bg-* and cached custom.css can leave panels transparent — enforce inline.
 */
(function (global) {
  function portaledPopoverSolidBg() {
    return document.documentElement.classList.contains('dark') ? '#0f172a' : '#ffffff';
  }

  function applyPortaledPopoverSurface(el) {
    if (!el) return;
    var bg = portaledPopoverSolidBg();
    el.style.setProperty('background-color', bg, 'important');
    el.style.setProperty('background-image', 'none', 'important');
    el.style.setProperty('background', bg, 'important');
    el.style.setProperty('backdrop-filter', 'none', 'important');
    el.style.setProperty('-webkit-backdrop-filter', 'none', 'important');
    el.style.setProperty('opacity', '1', 'important');
    el.style.setProperty('isolation', 'isolate', 'important');
    el.style.setProperty('box-decoration-break', 'clone', 'important');
    el.querySelectorAll('.pipeline-import-export-menu-panel__surface').forEach(function (inner) {
      inner.style.setProperty('background-color', bg, 'important');
      inner.style.setProperty('background-image', 'none', 'important');
      inner.style.setProperty('background', bg, 'important');
    });
  }

  global.portaledPopoverSolidBg = portaledPopoverSolidBg;
  global.applyPortaledPopoverSurface = applyPortaledPopoverSurface;
})(window);
