/**
 * AI (or rules) action plan from stored Local SEO research.
 * Rules fallback must produce distinct, actionable steps — never one duplicate
 * “Improve Maps visibility” row per keyword.
 */

const { chatCompletion, parseLlmJson } = require('./llmClient');

function pushStep(steps, step) {
  if (!step || !step.title) return;
  const titleKey = String(step.title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (steps.some((s) => s._key === titleKey)) return;
  steps.push({
    rank: steps.length + 1,
    impact: step.impact || 'Med',
    effort: step.effort || 'Med',
    title: String(step.title).slice(0, 200),
    why: String(step.why || '').slice(0, 400),
    how: step.how ? String(step.how).slice(0, 400) : '',
    _key: titleKey,
  });
}

function formatMapsRank(k) {
  if (k.mapsRank == null) return `${k.keyword} (not in top Maps)`;
  return `${k.keyword} (#${k.mapsRank})`;
}

function fallbackPlan(research) {
  const r = research || {};
  const steps = [];
  const scores = r.scores || {};
  const gbp = r.gbp || null;
  const reviews = r.reviews || null;
  const ranks = Array.isArray(r.keywordRanks) ? r.keywordRanks : [];
  const competitors = Array.isArray(r.competitors) ? r.competitors : [];
  const profile = r.profileSnapshot || {};
  const city = profile.city || '';
  const vertical = profile.vertical || 'your trade';

  const weakMaps = ranks
    .filter((x) => x.mapsRank == null || x.mapsRank > 3)
    .sort((a, b) => (a.mapsRank == null ? 99 : a.mapsRank) - (b.mapsRank == null ? 99 : b.mapsRank));
  const strongMaps = ranks.filter((x) => x.mapsRank != null && x.mapsRank <= 3);
  const missingMaps = weakMaps.filter((x) => x.mapsRank == null);
  const rankedWeak = weakMaps.filter((x) => x.mapsRank != null);

  // 1) GBP identity first when missing — unlocks reviews + completeness.
  if (!gbp) {
    pushStep(steps, {
      impact: 'High',
      effort: 'Low',
      title: 'Connect Google Business Profile (Place ID or CID)',
      why: 'No GBP snapshot yet — Maps ranks alone cannot drive photos, hours, categories, or review actions.',
      how: 'In Local SEO profile, paste your Google Place ID (or CID from Maps URL), Save profile, then Update. Or open your Google listing and copy the Place ID from the URL.',
    });
  } else {
    const c = gbp.checks || {};
    if (!c.hasHours) {
      pushStep(steps, {
        impact: 'High',
        effort: 'Low',
        title: 'Publish complete hours on GBP',
        why: 'Hours are missing — Map Pack often prefers profiles with clear open/closed times.',
        how: 'In Google Business Profile → Hours, set weekday + weekend hours (and special hours if needed), then verify the listing shows Open/Closed correctly.',
      });
    }
    if (!c.hasDescription) {
      pushStep(steps, {
        impact: 'Med',
        effort: 'Low',
        title: 'Write a keyword-aware GBP description',
        why: 'Description is empty — you are missing on-profile relevance for local queries.',
        how: `Write 750 chars covering ${vertical}${city ? ` in ${city}` : ''}, services, and a clear call to action. Lead with the primary service + city.`,
      });
    }
    if ((c.photos || gbp.photos || 0) < 10) {
      pushStep(steps, {
        impact: 'Med',
        effort: 'Med',
        title: 'Upload 10+ fresh GBP photos (jobs + team + storefront)',
        why: `Only ${c.photos != null ? c.photos : gbp.photos || 0} photos detected — thin photo profiles lose Map Pack clicks.`,
        how: 'Add exterior, interior, before/after job shots, and team photos this week. Prefer recent uploads over stock.',
      });
    }
    if (!gbp.category) {
      pushStep(steps, {
        impact: 'High',
        effort: 'Low',
        title: 'Set primary GBP category + relevant secondary categories',
        why: 'No category on the snapshot — category mismatch kills Maps relevance.',
        how: `Set the closest primary category for ${vertical}, then add 2–4 secondaries that match services you actually sell.`,
      });
    }
  }

  // 2) One consolidated Maps action (not one row per keyword).
  if (weakMaps.length) {
    const sample = weakMaps.slice(0, 5).map(formatMapsRank).join('; ');
    const best = strongMaps[0];
    pushStep(steps, {
      impact: 'High',
      effort: 'Med',
      title: city
        ? `Win the Map Pack for ${vertical || 'core services'} in ${city}`
        : 'Win the Map Pack for your core local queries',
      why: missingMaps.length
        ? `${missingMaps.length} quer${missingMaps.length === 1 ? 'y is' : 'ies are'} missing from top Maps; others sit outside the top 3 (${sample}).`
        : `You are outside the top 3 on: ${sample}.`,
      how: [
        'Treat these as one campaign, not separate tasks:',
        'align GBP primary category + services to the main query,',
        'build/refresh a city landing page with NAP + embedded map,',
        'earn 2–3 local citations with consistent NAP,',
        best
          ? `double down on what already works (you rank #${best.mapsRank} for “${best.keyword}”).`
          : 'request reviews that mention the city + service.',
      ].join(' '),
    });
  }

  // 3) Competitor-specific action.
  const topComp = competitors.find((c) => c.domain || c.title) || null;
  if (topComp) {
    pushStep(steps, {
      impact: 'High',
      effort: 'Med',
      title: `Close the gap vs ${topComp.title || topComp.domain}`,
      why: [
        topComp.bestRank != null ? `They appear as high as Maps #${topComp.bestRank}` : 'They appear often in your Maps results',
        topComp.appearances != null ? `across ${topComp.appearances} tracked quer${topComp.appearances === 1 ? 'y' : 'ies'}` : null,
        topComp.avgRating != null ? `· ${topComp.avgRating}★ avg` : null,
      ]
        .filter(Boolean)
        .join(' '),
      how: `Open their GBP and site: match (or beat) category coverage, photo volume, review velocity, and service-area pages. Do not copy — cover the same intent better for ${city || 'your city'}.`,
    });
  }

  // 4) Reviews — only when we have signal, or nudge after GBP.
  if (reviews) {
    if ((reviews.unanswered || 0) > 0) {
      pushStep(steps, {
        impact: 'High',
        effort: 'Low',
        title: `Reply to ${reviews.unanswered} unanswered Google review${reviews.unanswered === 1 ? '' : 's'}`,
        why: 'Unanswered reviews weaken trust next to competitors who respond.',
        how: 'Answer the oldest unanswered reviews first (thank + specific detail). Use Business Reviews in Agency OS to draft replies.',
      });
    }
    const votes = reviews.votes != null ? reviews.votes : gbp && gbp.votes != null ? gbp.votes : null;
    if (votes != null && votes < 25) {
      pushStep(steps, {
        impact: 'High',
        effort: 'Med',
        title: 'Start a weekly review request cadence',
        why: `Only ${votes} Google reviews — thin volume loses Map Pack to busier locals.`,
        how: 'Text/email every completed job within 24h with your Google review link. Aim for 4–8 new reviews/month until you pass 40.',
      });
    } else if (votes != null && votes < 80 && weakMaps.length) {
      pushStep(steps, {
        impact: 'Med',
        effort: 'Med',
        title: 'Keep review velocity above competitors',
        why: `${votes} reviews helps, but Map Pack still favors steady new reviews.`,
        how: 'Keep the post-job ask automated; ask happy customers to mention the service + city in the review text.',
      });
    }
  } else if (!gbp) {
    pushStep(steps, {
      impact: 'Med',
      effort: 'Low',
      title: 'Pull Google reviews after GBP is linked',
      why: 'No review snapshot yet — review actions unlock once Place ID/CID resolves.',
      how: 'After Place ID is saved and Update succeeds, use unanswered replies + a review request cadence as your next trust lever.',
    });
  }

  // 5) Website / landing hygiene when Maps are weak.
  if (weakMaps.length >= 2) {
    pushStep(steps, {
      impact: 'Med',
      effort: 'Med',
      title: city
        ? `Publish a dedicated “${vertical || 'services'} in ${city}” page`
        : 'Publish a dedicated city + service landing page',
      why: 'Multiple weak Maps queries usually mean thin local relevance on-site and on-profile.',
      how: 'One indexable page: H1 with service + city, NAP, service list, FAQ, photos, and link it from the homepage + GBP website field.',
    });
  }

  if (!steps.length) {
    pushStep(steps, {
      impact: 'Med',
      effort: 'Low',
      title: 'Re-run Update after the next GBP or review change',
      why: 'Research looks healthy — keep measuring after each change.',
      how: 'Update Local SEO monthly, or sooner after category/photo/review pushes.',
    });
  }

  const cleaned = steps.slice(0, 8).map(({ _key, ...rest }) => rest);
  return {
    source: 'rules',
    summary: `Local score ${scores.overall != null ? scores.overall : '—'} · Maps ${scores.mapsScore != null ? scores.mapsScore : '—'} · GBP ${scores.gbpScore != null ? scores.gbpScore : '—'} · Reviews ${scores.reviewScore != null ? scores.reviewScore : '—'}.`,
    steps: cleaned,
  };
}

async function generateLocalActionPlan(research, opts) {
  const options = opts || {};
  if (!research) {
    return { source: 'rules', summary: 'No research stored yet. Run Update first.', steps: [] };
  }

  const compact = {
    profile: research.profileSnapshot,
    scores: research.scores,
    keywordRanks: (research.keywordRanks || []).map((k) => ({
      keyword: k.keyword,
      mapsRank: k.mapsRank,
      localPackRank: k.localPackRank,
    })),
    competitors: (research.competitors || []).slice(0, 6).map((c) => ({
      title: c.title,
      domain: c.domain,
      bestRank: c.bestRank,
      appearances: c.appearances,
      avgRating: c.avgRating,
    })),
    gbp: research.gbp
      ? {
          completeness: research.gbp.completeness,
          checks: research.gbp.checks,
          rating: research.gbp.rating,
          votes: research.gbp.votes,
          category: research.gbp.category,
          photos: research.gbp.photos,
        }
      : null,
    reviews: research.reviews
      ? {
          rating: research.reviews.rating,
          votes: research.reviews.votes,
          unanswered: research.reviews.unanswered,
          fetched: research.reviews.fetched,
        }
      : null,
  };

  const system = [
    'You are a local SEO strategist for agencies.',
    'Use ONLY the provided Local SEO JSON — never invent rankings, ratings, or Place IDs.',
    'Return strict JSON: { "summary": string, "steps": [ { "rank": number, "impact": "High"|"Med"|"Low", "effort": "High"|"Med"|"Low", "title": string, "why": string, "how": string } ] }',
    'Produce 5–8 DISTINCT actions. Never create one step per keyword.',
    'If several keywords are weak on Maps, collapse them into ONE Map Pack strategy step that lists the keywords in "why" and gives a concrete playbook in "how".',
    'Prioritize: missing GBP identity, category/hours/photos, review replies/volume, beating a named competitor, then on-site city pages.',
    'Each "how" must be a specific next action the business can do this week.',
  ].join(' ');

  try {
    const result = await chatCompletion({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(compact) },
      ],
      integrationEnv: options.integrationEnv,
      temperature: 0.3,
      maxTokens: 2000,
      responseFormat: { type: 'json_object' },
    });
    const parsed = parseLlmJson(result && result.text);
    if (parsed && Array.isArray(parsed.steps) && parsed.steps.length) {
      const seen = new Set();
      const steps = [];
      for (const s of parsed.steps.slice(0, 12)) {
        const title = String(s.title || '').slice(0, 200);
        const key = title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        if (!title || seen.has(key)) continue;
        // Drop near-duplicate "Improve Maps visibility for …" spam if model regresses.
        if (/^improve maps visibility for/i.test(title) && steps.some((x) => /map pack|maps visibility|map pack/i.test(x.title))) {
          continue;
        }
        seen.add(key);
        steps.push({
          rank: steps.length + 1,
          impact: ['High', 'Med', 'Low'].includes(s.impact) ? s.impact : 'Med',
          effort: ['High', 'Med', 'Low'].includes(s.effort) ? s.effort : 'Med',
          title,
          why: String(s.why || '').slice(0, 400),
          how: String(s.how || '').slice(0, 400),
        });
      }
      if (steps.length) {
        return {
          source: 'llm',
          summary: String(parsed.summary || '').slice(0, 500),
          steps,
          generatedAt: new Date().toISOString(),
        };
      }
    }
  } catch (_) {
    /* fall through */
  }

  const plan = fallbackPlan(research);
  plan.generatedAt = new Date().toISOString();
  return plan;
}

module.exports = {
  generateLocalActionPlan,
  fallbackPlan,
};
