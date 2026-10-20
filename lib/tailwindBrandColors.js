/**
 * Tailwind brand palette backed by CSS variables (see views/partials/head.ejs).
 *
 * Bare `var(--token)` colors cannot generate opacity modifiers (`/15`, `/50`, …).
 * Use color-mix so workspace accents (e.g. #2F5B98) tint borders/backgrounds correctly.
 *
 * @param {string} cssVar  e.g. '--brand-yellow'
 * @returns {(info: { opacityValue?: string }) => string}
 */
function cssVarColor(cssVar) {
  return ({ opacityValue } = {}) => {
    if (opacityValue === undefined || opacityValue === null || opacityValue === '') {
      return `var(${cssVar})`;
    }
    const n = Number(opacityValue);
    const pct = Number.isFinite(n) ? Math.max(0, Math.min(100, n * 100)) : 100;
    const pctStr = Number.isInteger(pct) ? String(pct) : pct.toFixed(2).replace(/\.?0+$/, '');
    return `color-mix(in srgb, var(${cssVar}) ${pctStr}%, transparent)`;
  };
}

/** App shell brand tokens (workspace accent overrides --brand-yellow / --brand-on-accent). */
const appBrandColors = {
  bg: cssVarColor('--brand-bg'),
  cream: cssVarColor('--brand-cream'),
  yellow: cssVarColor('--brand-yellow'),
  // Hover stays tied to accent; never a hardcoded yellow that fights custom blues.
  yellowHover: cssVarColor('--brand-yellow'),
  dark: cssVarColor('--brand-dark'),
  muted: cssVarColor('--brand-muted'),
  border: cssVarColor('--brand-border'),
};

module.exports = {
  cssVarColor,
  appBrandColors,
};
