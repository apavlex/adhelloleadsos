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

  /** Parse street / city / state from Maps-style address strings. */
  function parseCityState(address) {
    let raw = cleanAddress(address);
    if (!raw) return { street: '', city: '', state: '' };

    if (raw.includes('·')) {
      const dotParts = raw
        .split('·')
        .map((p) => p.trim())
        .filter(Boolean);
      if (dotParts.length >= 2) {
        const street = dotParts[0];
        const loc = dotParts.slice(1).join(', ');
        const locParsed = parseCityState(loc);
        return {
          street,
          city: locParsed.city || locParsed.street || '',
          state: locParsed.state || '',
        };
      }
    }

    const fullMatch = raw.match(/^(.+?),\s*([^,]+),\s*([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?\s*$/i);
    if (fullMatch) {
      return {
        street: fullMatch[1].trim(),
        city: fullMatch[2].trim(),
        state: fullMatch[3].toUpperCase(),
      };
    }

    const stateZipMatch = raw.match(/^(.+?),\s*([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?\s*$/i);
    if (stateZipMatch) {
      const before = stateZipMatch[1].trim();
      const parts = before.split(',').map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        return {
          street: parts.slice(0, -1).join(', '),
          city: parts[parts.length - 1],
          state: stateZipMatch[2].toUpperCase(),
        };
      }
      return { street: before, city: '', state: stateZipMatch[2].toUpperCase() };
    }

    const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 3) {
      const state = parts[parts.length - 1].replace(/\d{5}(-\d{4})?.*$/, '').trim();
      return {
        street: parts.slice(0, -2).join(', '),
        city: parts[parts.length - 2],
        state,
      };
    }
    if (parts.length === 2) {
      return {
        street: parts[0],
        city: parts[0],
        state: parts[1].replace(/\d{5}(-\d{4})?.*$/, '').trim(),
      };
    }

    return { street: raw, city: '', state: '' };
  }

  function hostnameFromUrl(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    try {
      const u = new URL(s.includes('://') ? s : `https://${s}`);
      return u.hostname.replace(/^www\./i, '').toLowerCase();
    } catch (_) {
      return '';
    }
  }

  window.AdHelloAddressUtils = {
    cleanAddress,
    extractAddressFromElement,
    parseCityState,
    hostnameFromUrl,
  };
})();
