/**
 * In-memory ring of client-reported menu-hop timings.
 * Used to prove whether navigations are fast — not guess from code review alone.
 */
const MAX = 80;
const _rows = [];

function push(row) {
  if (!row || typeof row !== 'object') return null;
  const entry = {
    at: Date.now(),
    path: String(row.path || '').slice(0, 200),
    from: String(row.from || '').slice(0, 200),
    version: String(row.version || '').slice(0, 32),
    clickToPageshowMs: clampMs(row.clickToPageshowMs),
    clickToHydrateMs: clampMs(row.clickToHydrateMs),
    serverTimingMs: clampMs(row.serverTimingMs),
    coarse: !!row.coarse,
    ua: String(row.ua || '').slice(0, 160),
    email: String(row.email || '').slice(0, 120),
    workspaceId: String(row.workspaceId || '').slice(0, 64),
  };
  _rows.push(entry);
  while (_rows.length > MAX) _rows.shift();
  return entry;
}

function clampMs(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(Math.round(n), 120000);
}

function recent(limit = 40) {
  const n = Math.max(1, Math.min(MAX, Number(limit) || 40));
  return _rows.slice(-n).reverse();
}

function summary(limit = 40) {
  const rows = recent(limit);
  const byPath = Object.create(null);
  rows.forEach((r) => {
    const key = r.path || '(unknown)';
    if (!byPath[key]) byPath[key] = { path: key, n: 0, pageshow: [], hydrate: [] };
    byPath[key].n += 1;
    if (r.clickToPageshowMs != null) byPath[key].pageshow.push(r.clickToPageshowMs);
    if (r.clickToHydrateMs != null) byPath[key].hydrate.push(r.clickToHydrateMs);
  });
  const paths = Object.keys(byPath).map((k) => {
    const b = byPath[k];
    return {
      path: b.path,
      n: b.n,
      pageshowP50: percentile(b.pageshow, 0.5),
      pageshowP90: percentile(b.pageshow, 0.9),
      hydrateP50: percentile(b.hydrate, 0.5),
      hydrateP90: percentile(b.hydrate, 0.9),
      slowPageshow: b.pageshow.filter((ms) => ms >= 1500).length,
      slowHydrate: b.hydrate.filter((ms) => ms >= 4000).length,
    };
  });
  paths.sort((a, b) => (b.pageshowP90 || 0) - (a.pageshowP90 || 0));
  return {
    thresholds: {
      pageshowPassMs: 1500,
      hydratePassMs: 4000,
      note: 'Pass = click→pageshow < 1.5s and click→hydrate < 4s on mobile-ish hops',
    },
    sample: rows.length,
    paths,
    recent: rows.slice(0, 20),
  };
}

function percentile(arr, p) {
  if (!arr || !arr.length) return null;
  const sorted = arr.slice().sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[i];
}

module.exports = { push, recent, summary };
