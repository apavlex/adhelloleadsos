/** Shared Local SEO sync progress helpers (no DB deps). */

function emptySyncProgress() {
  return {
    active: false,
    percent: 0,
    phase: '',
    label: '',
    error: null,
    startedAt: null,
    updatedAt: null,
  };
}

function phasePercent(phase, keywordIndex, keywordTotal) {
  const n = Math.max(1, Number(keywordTotal) || 1);
  const i = Math.max(0, Math.min(n, Number(keywordIndex) || 0));
  const mapsSpan = 55;
  switch (phase) {
    case 'maps':
      return Math.round((i / n) * mapsSpan);
    case 'volume':
      return 58;
    case 'category':
      return 68;
    case 'gbp':
      return 78;
    case 'reviews':
      return 88;
    case 'score':
      return 94;
    case 'plan':
      return 97;
    case 'save':
      return 99;
    case 'done':
      return 100;
    default:
      return Math.min(99, Math.round((i / n) * mapsSpan));
  }
}

module.exports = {
  emptySyncProgress,
  phasePercent,
};
