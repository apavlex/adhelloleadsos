/**
 * Deterministic keyword gap analysis from stored DataForSEO-normalized rankings.
 * No crawler — operates only on warehouse rows.
 */

function clamp(n, lo, hi) {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.min(hi, Math.max(lo, x));
}

function normKeyword(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .slice(0, 200);
}

function posOrNull(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

/**
 * Build gap rows from:
 * - youRankings: [{ keyword, position, url, volume, cpc, kd, etv }]
 * - competitorRankings: [{ domain, keyword, position, url, volume, cpc, kd, etv }]
 */
function buildGapRows({ youRankings = [], competitorRankings = [], limit = 200 } = {}) {
  const youByKw = new Map();
  for (const row of youRankings) {
    const kw = normKeyword(row.keyword);
    if (!kw) continue;
    const prev = youByKw.get(kw);
    const pos = posOrNull(row.position);
    if (!prev || (pos != null && (prev.position == null || pos < prev.position))) {
      youByKw.set(kw, {
        keyword: kw,
        position: pos,
        url: String(row.url || '').slice(0, 500),
        volume: Math.max(0, Math.round(Number(row.volume) || 0)),
        cpc: Number(row.cpc) || 0,
        kd: clamp(row.kd != null ? row.kd : row.keyword_difficulty, 0, 100),
        etv: Number(row.etv) || 0,
      });
    }
  }

  const rivalBest = new Map();
  for (const row of competitorRankings) {
    const kw = normKeyword(row.keyword);
    if (!kw) continue;
    const pos = posOrNull(row.position);
    if (pos == null) continue;
    const domain = String(row.domain || '').toLowerCase().slice(0, 120);
    const prev = rivalBest.get(kw);
    if (!prev || pos < prev.position) {
      rivalBest.set(kw, {
        keyword: kw,
        position: pos,
        domain,
        url: String(row.url || '').slice(0, 500),
        volume: Math.max(0, Math.round(Number(row.volume) || prev?.volume || 0)),
        cpc: Number(row.cpc) || prev?.cpc || 0,
        kd: clamp(
          row.kd != null ? row.kd : row.keyword_difficulty != null ? row.keyword_difficulty : prev?.kd,
          0,
          100,
        ),
        etv: Number(row.etv) || prev?.etv || 0,
      });
    }
  }

  const rows = [];
  for (const [kw, rival] of rivalBest.entries()) {
    const you = youByKw.get(kw);
    const youPos = you ? you.position : null;
    let gapType = 'missing';
    if (youPos != null && rival.position != null) {
      if (youPos <= rival.position) gapType = 'protect';
      else gapType = 'weaker';
    }
    if (gapType === 'protect') continue;

    const volume = Math.max(rival.volume || 0, (you && you.volume) || 0);
    const kd = rival.kd != null ? rival.kd : you && you.kd != null ? you.kd : 50;
    const rankDelta =
      youPos == null ? Math.max(0, 100 - rival.position) : Math.max(0, youPos - rival.position);
    const volumeScore = Math.min(40, Math.log10(volume + 1) * 12);
    const gapScore = Math.min(35, rankDelta * 0.6);
    const kdScore = Math.max(0, 25 - kd * 0.25);
    const opportunityScore = Math.round(clamp(volumeScore + gapScore + kdScore, 0, 100));

    rows.push({
      keyword: kw,
      gapType,
      youPos: youPos,
      rivalPos: rival.position,
      rivalDomain: rival.domain,
      rivalUrl: rival.url,
      yourUrl: you ? you.url : '',
      volume,
      cpc: rival.cpc || (you && you.cpc) || 0,
      kd,
      etv: rival.etv || (you && you.etv) || 0,
      opportunityScore,
    });
  }

  rows.sort((a, b) => b.opportunityScore - a.opportunityScore || b.volume - a.volume);
  return rows.slice(0, Math.max(1, Number(limit) || 200));
}

function summarizeGaps(gapRows) {
  const rows = Array.isArray(gapRows) ? gapRows : [];
  const missing = rows.filter((r) => r.gapType === 'missing').length;
  const weaker = rows.filter((r) => r.gapType === 'weaker').length;
  const trafficAtStake = rows.reduce((s, r) => s + (Number(r.etv) || Math.round((r.volume || 0) * 0.1)), 0);
  return {
    total: rows.length,
    missing,
    weaker,
    trafficAtStake: Math.round(trafficAtStake),
    topKeyword: rows[0] ? rows[0].keyword : '',
  };
}

module.exports = {
  normKeyword,
  buildGapRows,
  summarizeGaps,
};
