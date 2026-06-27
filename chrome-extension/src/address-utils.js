(function () {
  'use strict';

  /** Strip Google Maps icon glyphs and label noise from scraped addresses. */
  function cleanAddress(raw) {
    let s = String(raw || '').trim();
    if (!s || s === 'N/A') return '';

    s = s.replace(/[\uE000-\uF8FF\u200B-\u200D\uFEFF\u2060-\u206F]/g, '');
    s = s.replace(/^(?:address|copy\s*address,?)\s*:?\s*/i, '').trim();
    s = s.replace(/^[\u2630-\u2633☰≡⋮▤▥▦▧▨▩]+/u, '').trim();

    const streetStart = s.search(/\b\d{1,6}\s+[A-Za-z0-9#]/);
    if (streetStart > 0) s = s.slice(streetStart);
    else s = s.replace(/^[^\dA-Za-z#]+/, '').trim();

    s = s.replace(/\s+/g, ' ').trim();
    return s;
  }

  function extractAddressFromElement(el) {
    if (!el) return '';
    const aria = String(el.getAttribute('aria-label') || el.getAttribute('data-tooltip') || '').trim();
    if (aria) {
      const copyMatch = aria.match(
        /(?:copy\s*address,?\s*)?(\d{1,6}\s+[^,]+(?:,\s*[^,]+){0,4}(?:\s+\d{5}(?:-\d{4})?)?)/i,
      );
      if (copyMatch && copyMatch[1]) return cleanAddress(copyMatch[1]);

      const cleanedAria = cleanAddress(aria.replace(/^copy\s*address,?\s*/i, ''));
      if (cleanedAria && (/\d/.test(cleanedAria) || cleanedAria.includes(','))) return cleanedAria;
    }

    const clone = el.cloneNode(true);
    clone.querySelectorAll('svg, img, i, span[aria-hidden="true"], [class*="google-symbols"]').forEach((node) => {
      node.remove();
    });
    return cleanAddress(clone.textContent || el.textContent || '');
  }

  window.AdHelloAddressUtils = {
    cleanAddress,
    extractAddressFromElement,
  };
})();
