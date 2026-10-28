/**
 * Agency AI Visibility scan — domain → snapshot + prioritized next steps.
 * Uses DataForSEO when configured; otherwise heuristic/sample so the admin UI works.
 */

const crypto = require('crypto');
const dataForSeo = require('./dataForSeoClient');
const {
  normalizeAiVisibilitySnapshot,
  sampleAiVisibilitySnapshot,
} = require('./aiVisibilityReport');

function cleanStr(v, max = 200) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

function clampScore(n) {
  const x = Math.round(Number(n) || 0);
  if (!Number.isFinite(x)) return 0;
  return Math.min(100, Math.max(0, x));
}

function seedKeywords(lead) {
  const title = cleanStr(lead && lead.title, 80);
  const city = cleanStr(lead && lead.city, 40);
  const category = cleanStr(lead && (lead.category || lead.primaryCategory), 60);
  const niche = category || title.split(/\s+/).slice(0, 2).join(' ') || 'local business';
  const place = city || cleanStr(lead && lead.state, 20) || 'near me';
  const seeds = [
    `${niche} ${place}`.trim(),
    `best ${niche} ${place}`.trim(),
    `${niche} near me`.trim(),
    `${title} reviews`.trim(),
  ].filter((k) => k.length > 3);
  return [...new Set(seeds)].slice(0, 6);
}

function locationLabel(lead) {
  return [cleanStr(lead && lead.city, 40), cleanStr(lead && lead.state, 8)].filter(Boolean).join(', ');
}

function extractMentionsItems(apiJson) {
  const tasks = Array.isArray(apiJson && apiJson.tasks) ? apiJson.tasks : [];
  const items = [];
  for (const t of tasks) {
    const results = Array.isArray(t.result) ? t.result : [];
    for (const r of results) {
      if (Array.isArray(r.items)) items.push(...r.items);
      else if (r && typeof r === 'object') items.push(r);
    }
  }
  return items;
}

function mentionRateFromItems(items, domain) {
  const host = dataForSeo.hostFromWebsite(domain);
  if (!items.length) return { pct: 0, cited: 0, total: 0 };
  let cited = 0;
  let total = 0;
  for (const it of items) {
    total += 1;
    const blob = JSON.stringify(it).toLowerCase();
    if (host && blob.includes(host)) cited += 1;
  }
  const pct = total ? Math.round((cited / total) * 100) : 0;
  return { pct: clampScore(pct), cited, total };
}

function competitorsFromTopDomains(apiJson, selfDomain, limit = 6) {
  const host = dataForSeo.hostFromWebsite(selfDomain);
  const items = extractMentionsItems(apiJson);
  const rows = [];
  for (const it of items) {
    const name = cleanStr(
      it.domain || it.mentioned_domain || it.target || it.url || it.title,
      80,
    );
    if (!name) continue;
    const domainHost = dataForSeo.hostFromWebsite(name) || name.toLowerCase();
    const mentions = Math.max(
      0,
      Math.round(Number(it.mentions || it.mention_count || it.count || it.rank || 0) || 0),
    );
    const aiSov = clampScore(
      it.share != null
        ? Number(it.share) * (Number(it.share) <= 1 ? 100 : 1)
        : mentions,
    );
    rows.push({
      name: domainHost,
      aiSov: aiSov || Math.min(40, mentions * 3),
      mapPackWins: 0,
      surfaces: 'AI',
      isYou: !!(host && domainHost.includes(host)),
    });
  }
  rows.sort((a, b) => b.aiSov - a.aiSov);
  const sliced = rows.slice(0, limit).map((r, i) => ({ ...r, rank: i + 1 }));
  if (host && !sliced.some((r) => r.isYou)) {
    sliced.push({
      rank: sliced.length + 1,
      name: host,
      isYou: true,
      aiSov: 8,
      mapPackWins: 0,
      surfaces: '—',
    });
  }
  return sliced.slice(0, limit);
}

function mapsRankForBusiness(apiJson, lead) {
  const title = cleanStr(lead && lead.title, 80).toLowerCase();
  const host = dataForSeo.hostFromWebsite(lead && (lead.website || lead.url));
  const tasks = Array.isArray(apiJson && apiJson.tasks) ? apiJson.tasks : [];
  const items = [];
  for (const t of tasks) {
    for (const r of Array.isArray(t.result) ? t.result : []) {
      if (Array.isArray(r.items)) items.push(...r.items);
    }
  }
  let rank = null;
  let rating = null;
  let reviews = 0;
  items.forEach((it, idx) => {
    const name = cleanStr(it.title || it.domain, 120).toLowerCase();
    const url = cleanStr(it.url || it.domain, 200).toLowerCase();
    const match =
      (title && name.includes(title.slice(0, Math.min(12, title.length)))) ||
      (host && url.includes(host));
    if (match && rank == null) {
      rank = idx + 1;
      if (it.rating != null) rating = Number(it.rating.value != null ? it.rating.value : it.rating);
      reviews = Math.max(0, Math.round(Number(it.reviews_count || it.rating?.votes_count || 0) || 0));
    }
  });
  return { rank, rating, reviews, total: items.length };
}

function buildNextSteps({ snapshot, lead, source }) {
  const steps = [];
  const local = snapshot.local || {};
  const engines = snapshot.engines || [];
  const unanswered = Number(local.unansweredReviews) || 0;
  const gbp = Number(local.gbpCompleteness) || 0;
  const mapDetail = engines.find((e) => e.id === 'local_map_pack');
  const weakAi = engines
    .filter((e) => e.id !== 'local_map_pack' && e.pct < 50)
    .sort((a, b) => a.pct - b.pct);

  if (unanswered > 0) {
    steps.push({
      impact: 'High',
      title: `Respond to ${unanswered} unanswered Google review${unanswered === 1 ? '' : 's'}`,
      why: 'Review responsiveness and volume influence Map Pack and AI trust signals.',
    });
  }
  if (gbp > 0 && gbp < 85) {
    steps.push({
      impact: 'High',
      title: 'Complete Google Business Profile (categories, photos, NAP)',
      why: `Profile completeness is ${gbp}% — missing attributes and NAP mismatches suppress local rank.`,
    });
  }
  if (mapDetail && mapDetail.pct < 60) {
    steps.push({
      impact: 'High',
      title: 'Strengthen Map Pack presence for primary local queries',
      why: mapDetail.detail || `Local/Map Pack signal is ${mapDetail.pct}% — rivals outrank you on pack.`,
    });
  }
  if (weakAi[0]) {
    steps.push({
      impact: 'High',
      title: `Improve citations on ${weakAi[0].label}`,
      why: `Only ${weakAi[0].pct}% visibility (${weakAi[0].cited || 0}/${weakAi[0].total || 0}). Rewrite key pages as step-by-step + FAQ that match how AI answers.`,
    });
  }
  const gaps = Array.isArray(local.localKeywordGaps) ? local.localKeywordGaps : [];
  if (gaps[0]) {
    steps.push({
      impact: 'Med',
      title: `Build a landing page for “${gaps[0]}”`,
      why: 'Local keyword gap with competitor pack/AI coverage and weak on-site match.',
    });
  }
  steps.push({
    impact: 'Med',
    title: 'Add comparison or how-to table on your top service page',
    why: 'AI Mode and Overviews prefer structured tables and lists when citing sources.',
  });
  if (cleanStr(lead && (lead.website || lead.url), 20)) {
    steps.push({
      impact: 'Med',
      title: 'Align site phone and address with Google Business Profile (NAP)',
      why: 'Inconsistent NAP weakens proximity and trust for Maps and LLM grounding.',
    });
  }
  if (source === 'sample' || source === 'heuristic') {
    steps.push({
      impact: 'Low',
      title: 'Connect DataForSEO and re-run scan for live engine data',
      why: 'Current scores are estimated. Live LLM Mentions + Maps require Workspace → Integrations → DataForSEO.',
    });
  }
  return steps.slice(0, 8);
}

function blendOverall(engines, local) {
  const aiEngines = (engines || []).filter((e) => e.id !== 'local_map_pack');
  const aiAvg = aiEngines.length
    ? Math.round(aiEngines.reduce((s, e) => s + e.pct, 0) / aiEngines.length)
    : 0;
  const localPct = (() => {
    const map = (engines || []).find((e) => e.id === 'local_map_pack');
    const mapScore = map ? map.pct : 40;
    const gbp = Number(local && local.gbpCompleteness) || 50;
    const reviewBoost =
      local && local.googleRating != null
        ? Math.min(20, Math.round((Number(local.googleRating) / 5) * 20))
        : 8;
    return clampScore(Math.round(mapScore * 0.55 + gbp * 0.3 + reviewBoost));
  })();
  return {
    score: clampScore(Math.round(aiAvg * 0.7 + localPct * 0.3)),
    aiAvg,
    localPct,
  };
}

function heuristicSnapshot(lead) {
  const sample = sampleAiVisibilitySnapshot(lead);
  const rating = lead && lead.rating != null ? Number(lead.rating) : sample.local.googleRating;
  const reviews =
    lead && (lead.reviewsCount != null || lead.reviewCount != null)
      ? Math.round(Number(lead.reviewsCount != null ? lead.reviewsCount : lead.reviewCount) || 0)
      : sample.local.googleReviews;
  const local = {
    ...sample.local,
    googleRating: Number.isFinite(rating) ? rating : sample.local.googleRating,
    googleReviews: reviews,
    unansweredReviews: Math.max(0, Math.min(12, Math.round(reviews * 0.03))),
    gbpCompleteness: reviews >= 50 ? 82 : reviews >= 10 ? 68 : 55,
    gbpSummary: reviews
      ? `Estimated from lead data · ${reviews} Google reviews on file`
      : 'Estimated — connect DataForSEO for live GBP/Maps',
    localKeywordGaps: seedKeywords(lead).slice(0, 3),
  };
  const engines = sample.engines.map((e) => {
    if (e.id === 'local_map_pack') {
      const pct = reviews >= 100 ? 62 : reviews >= 20 ? 48 : 35;
      return { ...e, pct, detail: reviews ? `est. from ${reviews} reviews` : 'est.' };
    }
    const bump = Math.min(15, Math.round((reviews || 0) / 20));
    return { ...e, pct: clampScore(e.pct - 8 + bump) };
  });
  const { score } = blendOverall(engines, local);
  return normalizeAiVisibilitySnapshot(
    {
      ...sample,
      businessName: cleanStr(lead && lead.title, 120) || sample.businessName,
      market: locationLabel(lead) || sample.market,
      website: cleanStr(lead && (lead.website || lead.url), 200),
      scannedAt: new Date().toISOString(),
      score,
      scoreDelta: 0,
      engines,
      local,
      competitors: sample.competitors.map((c) =>
        c.isYou
          ? { ...c, name: cleanStr(lead && lead.title, 80) || c.name }
          : c,
      ),
      nextSteps: [],
    },
    lead,
  );
}

async function fetchLivePartial(lead, integrationEnv, fetchImpl) {
  const domain = lead.website || lead.url || '';
  const host = dataForSeo.hostFromWebsite(domain);
  const keywords = seedKeywords(lead);
  const market = locationLabel(lead);
  const warnings = [];
  let chatgpt = { pct: 0, cited: 0, total: 0 };
  let googleAi = { pct: 0, cited: 0, total: 0 };
  let competitors = [];
  let maps = { rank: null, rating: null, reviews: 0, total: 0 };

  try {
    const chatJson = await dataForSeo.searchMentionsLive({
      domain: host,
      keywords,
      platform: 'chat_gpt',
      integrationEnv,
      fetchImpl,
    });
    chatgpt = mentionRateFromItems(extractMentionsItems(chatJson), host);
  } catch (err) {
    warnings.push(`ChatGPT mentions: ${err && err.message ? err.message : 'failed'}`);
  }

  try {
    const gJson = await dataForSeo.searchMentionsLive({
      domain: host,
      keywords,
      platform: 'google',
      integrationEnv,
      fetchImpl,
    });
    googleAi = mentionRateFromItems(extractMentionsItems(gJson), host);
  } catch (err) {
    warnings.push(`Google AI mentions: ${err && err.message ? err.message : 'failed'}`);
  }

  try {
    const top = await dataForSeo.topMentionedDomainsLive({
      keywords,
      platform: 'chat_gpt',
      integrationEnv,
      fetchImpl,
    });
    competitors = competitorsFromTopDomains(top, host);
  } catch (err) {
    warnings.push(`Competitor SOV: ${err && err.message ? err.message : 'failed'}`);
  }

  try {
    const mapsJson = await dataForSeo.googleMapsLive({
      keyword: keywords[0] || cleanStr(lead.title, 80),
      locationName: market || undefined,
      integrationEnv,
      fetchImpl,
    });
    maps = mapsRankForBusiness(mapsJson, lead);
  } catch (err) {
    warnings.push(`Maps: ${err && err.message ? err.message : 'failed'}`);
  }

  const leadReviews = Math.max(
    maps.reviews,
    Math.round(Number(lead.reviewsCount != null ? lead.reviewsCount : lead.reviewCount) || 0),
  );
  const leadRating =
    maps.rating != null
      ? maps.rating
      : lead.rating != null
        ? Number(lead.rating)
        : null;

  const mapPct =
    maps.rank == null
      ? 30
      : maps.rank <= 3
        ? clampScore(100 - (maps.rank - 1) * 12)
        : maps.rank <= 10
          ? clampScore(55 - (maps.rank - 4) * 4)
          : 22;

  const engines = [
    {
      id: 'chatgpt',
      label: 'ChatGPT',
      pct: chatgpt.pct,
      cited: chatgpt.cited,
      total: chatgpt.total,
    },
    {
      id: 'gemini',
      label: 'Gemini',
      pct: clampScore(Math.round(chatgpt.pct * 0.85)),
      cited: 0,
      total: 0,
      detail: 'est. from ChatGPT signal',
    },
    {
      id: 'ai_overviews',
      label: 'AI Overviews',
      pct: googleAi.pct,
      cited: googleAi.cited,
      total: googleAi.total,
    },
    {
      id: 'ai_mode',
      label: 'AI Mode',
      pct: clampScore(Math.round(googleAi.pct * 0.75)),
      cited: 0,
      total: 0,
      detail: 'est. from AI Overview signal',
    },
    {
      id: 'local_map_pack',
      label: 'Local / Map Pack',
      pct: mapPct,
      detail: maps.rank != null ? `Maps rank #${maps.rank}` : 'not in top results',
    },
  ];

  const local = {
    packPosition: maps.rank != null && maps.rank <= 3 ? `#${maps.rank} of 3` : maps.rank != null ? `#${maps.rank}` : '—',
    mapsCityRank: maps.rank != null ? `#${maps.rank}` : '—',
    mapsZipRank: '—',
    gbpCompleteness: leadReviews >= 50 ? 80 : leadReviews >= 10 ? 65 : 50,
    gbpSummary: warnings.length
      ? `Live scan with gaps: ${warnings[0]}`
      : 'Live DataForSEO Maps + LLM Mentions',
    googleRating: leadRating,
    googleReviews: leadReviews,
    unansweredReviews: Math.max(0, Math.min(15, Math.round(leadReviews * 0.025))),
    localKeywordGaps: keywords.slice(0, 3),
  };

  const { score } = blendOverall(engines, local);
  const raw = {
    businessName: cleanStr(lead.title, 120) || host || 'Your business',
    market: market || 'United States',
    website: cleanStr(domain, 200),
    scannedAt: new Date().toISOString(),
    promptCount: Math.max(chatgpt.total, googleAi.total, keywords.length * 4, 8),
    score,
    scoreDelta: 0,
    blendNote: 'AI 70% · Local 30%',
    engines,
    local,
    trend: [{ date: 'Now', score }],
    competitors: competitors.length
      ? competitors
      : [
          {
            rank: 1,
            name: host || 'you',
            isYou: true,
            aiSov: clampScore(chatgpt.pct),
            mapPackWins: maps.rank && maps.rank <= 3 ? 1 : 0,
            surfaces: 'ChatGPT',
          },
        ],
    nextSteps: [],
  };
  const snapshot = normalizeAiVisibilitySnapshot(raw, lead);
  snapshot.nextSteps = buildNextSteps({ snapshot, lead, source: 'live' });
  return { snapshot, warnings, source: 'live' };
}

/**
 * Run a scan for a lead. Returns { snapshot, source, warnings, jobId }.
 */
async function runAiVisibilityScan(lead, opts) {
  const options = opts || {};
  const integrationEnv = options.integrationEnv || {};
  const fetchImpl = options.fetchImpl;
  const jobId =
    cleanStr(options.jobId, 80) ||
    `avis_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;

  const domain = cleanStr(lead && (lead.website || lead.url), 200);
  if (!domain) {
    const err = new Error('Lead needs a website/domain to scan AI Visibility.');
    err.code = 'NO_WEBSITE';
    throw err;
  }

  if (dataForSeo.isConfigured(integrationEnv) && options.forceSample !== true) {
    try {
      const live = await fetchLivePartial(lead, integrationEnv, fetchImpl);
      return { ...live, jobId };
    } catch (err) {
      // Fall through to heuristic with warning
      const snap = heuristicSnapshot(lead);
      snap.nextSteps = buildNextSteps({ snapshot: snap, lead, source: 'heuristic' });
      return {
        snapshot: snap,
        source: 'heuristic',
        warnings: [err && err.message ? err.message : 'Live scan failed'],
        jobId,
      };
    }
  }

  const snap = heuristicSnapshot(lead);
  snap.nextSteps = buildNextSteps({ snapshot: snap, lead, source: 'heuristic' });
  return {
    snapshot: snap,
    source: dataForSeo.isConfigured(integrationEnv) ? 'heuristic' : 'heuristic',
    warnings: dataForSeo.isConfigured(integrationEnv)
      ? []
      : ['DataForSEO not configured — showing estimated scores from lead data.'],
    jobId,
  };
}

function markNextStepDone(snapshot, stepRank, done = true) {
  const snap = normalizeAiVisibilitySnapshot(snapshot, null);
  snap.nextSteps = (snap.nextSteps || []).map((s) =>
    Number(s.rank) === Number(stepRank) ? { ...s, done: !!done } : s,
  );
  return snap;
}

module.exports = {
  seedKeywords,
  buildNextSteps,
  blendOverall,
  heuristicSnapshot,
  runAiVisibilityScan,
  markNextStepDone,
};
