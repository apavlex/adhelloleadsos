/**
 * AI + rules ICP fit review before auto-outreach enroll (GHL drip).
 * Scores whether a lead matches the active offer + service location (A+ gate).
 */
const dbService = require('./database');
const { chatCompletion, parseLlmJson } = require('./llmClient');
const { getWorkspaceIcp } = require('./workspaceIcp');
const { resolveOutreachSenderProfile } = require('./outreachSenderProfile');
const { scoreLeadRecord } = require('./opportunityScore');
const workspaceIntegrations = require('./workspaceIntegrations');

const ICP_CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MIN_ICP_SCORE = 8; // A / A+
const A_PLUS_MIN = 9;

function normalizeToken(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseListField(raw) {
  return String(raw || '')
    .split(/[,;\n|/]+/)
    .map((p) => normalizeToken(p))
    .filter(Boolean);
}

function scoreToGrade(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return 'F';
  if (n >= A_PLUS_MIN) return 'A+';
  if (n >= 8) return 'A';
  if (n >= 6) return 'B';
  if (n >= 4) return 'C';
  return 'D';
}

function normalizeIcpReview(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const score = Math.max(0, Math.min(10, Number(r.score) || 0));
  const decision = r.decision === 'approve' ? 'approve' : 'reject';
  return {
    decision,
    score,
    grade: String(r.grade || scoreToGrade(score)).trim() || scoreToGrade(score),
    reason: String(r.reason || '').trim().slice(0, 400),
    nicheMatch: r.nicheMatch === true,
    geoMatch: r.geoMatch === true,
    offerKey: String(r.offerKey || '').trim(),
    reviewedAt: r.reviewedAt ? String(r.reviewedAt) : '',
    source: String(r.source || '').trim() || 'rules',
  };
}

function passesIcpAPlusGate(review, minScore = DEFAULT_MIN_ICP_SCORE) {
  const r = normalizeIcpReview(review);
  const floor = Number.isFinite(Number(minScore)) ? Number(minScore) : DEFAULT_MIN_ICP_SCORE;
  return r.decision === 'approve' && r.score >= floor;
}

function leadSnapshot(lead) {
  const l = lead && typeof lead === 'object' ? lead : {};
  return {
    title: String(l.title || l.company || '').trim().slice(0, 160),
    category: String(l.categoryName || l.category || '').trim().slice(0, 120),
    city: String(l.city || '').trim().slice(0, 80),
    state: String(l.state || '')
      .trim()
      .slice(0, 2)
      .toUpperCase(),
    address: String(l.address || '').trim().slice(0, 160),
    website: String(l.website || l.url || '').trim().slice(0, 200),
    phone: String(l.phone || '').trim().slice(0, 40),
    email: String(l.email || '').trim().slice(0, 120),
    rating: l.totalScore != null ? Number(l.totalScore) : l.rating != null ? Number(l.rating) : null,
    reviewsCount: l.reviewsCount != null ? Number(l.reviewsCount) : null,
    prospectTier: String(l.prospectTier || '').trim(),
  };
}

function resolveServiceArea({ workspace, settings, offer }) {
  const icp = getWorkspaceIcp(workspace);
  const settingsCities = parseListField(settings && settings.serviceCities);
  const settingsStates = parseListField(settings && settings.serviceStates).map((s) =>
    s.slice(0, 2).toUpperCase(),
  );
  const offerCities = parseListField(offer && offer.serviceCities);
  const offerStates = parseListField(offer && offer.serviceStates).map((s) =>
    s.slice(0, 2).toUpperCase(),
  );

  const cities = settingsCities.length
    ? settingsCities
    : offerCities.length
      ? offerCities
      : icp.city
        ? [normalizeToken(icp.city)]
        : [];
  const states = settingsStates.length
    ? settingsStates
    : offerStates.length
      ? offerStates
      : icp.state
        ? [String(icp.state).toUpperCase()]
        : [];

  return {
    cities: [...new Set(cities)],
    states: [...new Set(states)],
    icpKeyword: normalizeToken(icp.keyword),
    targetAudience: String(
      (workspace && workspace.salesIntake && workspace.salesIntake.targetAudience) ||
        (workspace && workspace.salesIntake && workspace.salesIntake.sellTo) ||
        '',
    )
      .trim()
      .slice(0, 200),
  };
}

function evaluateGeoMatch(snap, area) {
  const leadState = String(snap.state || '').toUpperCase();
  const leadCity = normalizeToken(snap.city);
  const states = area.states || [];
  const cities = area.cities || [];

  if (!states.length && !cities.length) {
    return { geoMatch: true, hardReject: false, note: 'No service area configured — geo not gated.' };
  }

  if (states.length && leadState) {
    if (!states.includes(leadState)) {
      return {
        geoMatch: false,
        hardReject: true,
        note: `Lead state ${leadState} outside service states ${states.join(',')}.`,
      };
    }
  }

  if (cities.length && leadCity) {
    const cityHit = cities.some(
      (c) => leadCity === c || leadCity.includes(c) || c.includes(leadCity),
    );
    if (cityHit) {
      return { geoMatch: true, hardReject: false, note: 'City matches service area.' };
    }
    if (states.length && leadState && states.includes(leadState)) {
      return {
        geoMatch: true,
        hardReject: false,
        note: 'State matches; city not exact — soft geo pass.',
      };
    }
    if (!states.length) {
      return {
        geoMatch: false,
        hardReject: true,
        note: `Lead city "${snap.city}" outside service cities.`,
      };
    }
  }

  if (states.length && leadState && states.includes(leadState)) {
    return { geoMatch: true, hardReject: false, note: 'State matches service area.' };
  }

  if (!leadState && !leadCity) {
    return { geoMatch: false, hardReject: false, note: 'Lead missing city/state.' };
  }

  return { geoMatch: false, hardReject: false, note: 'Weak geo signals.' };
}

function evaluateNicheMatch(snap, profile, area) {
  const hay = normalizeToken([snap.title, snap.category, snap.website].filter(Boolean).join(' '));
  const needles = [
    ...parseListField(profile.vertical),
    ...parseListField(profile.offerLabel),
    ...parseListField(area.icpKeyword),
    ...parseListField(area.targetAudience),
  ].filter((t) => t.length >= 3);

  if (!needles.length) {
    return { nicheMatch: true, note: 'No niche keywords configured — niche not gated.' };
  }
  if (!hay) {
    return { nicheMatch: false, note: 'Lead missing category/title for niche check.' };
  }

  const hits = needles.filter((n) => {
    if (hay.includes(n)) return true;
    const parts = n.split(' ').filter((p) => p.length >= 3);
    return parts.length > 0 && parts.every((p) => hay.includes(p));
  });
  if (hits.length) {
    return { nicheMatch: true, note: `Niche overlap: ${hits.slice(0, 3).join(', ')}` };
  }
  return { nicheMatch: false, note: 'No clear niche overlap with offer/vertical.' };
}

function rulesOnlyScore({ geo, niche, opportunityScore }) {
  let score = 4;
  if (geo.geoMatch) score += 2.5;
  if (niche.nicheMatch) score += 2.5;
  if (opportunityScore >= 7) score += 1;
  else if (opportunityScore >= 5) score += 0.5;
  if (!geo.geoMatch && !niche.nicheMatch) score = Math.min(score, 3);
  return Math.max(0, Math.min(10, Math.round(score * 10) / 10));
}

function cachedReviewStillValid(lead, offerKey) {
  const prev = lead && lead.icpReview ? normalizeIcpReview(lead.icpReview) : null;
  if (!prev || !prev.reviewedAt) return null;
  if (offerKey && prev.offerKey && prev.offerKey !== offerKey) return null;
  const ts = Date.parse(prev.reviewedAt);
  if (!Number.isFinite(ts) || Date.now() - ts > ICP_CACHE_MS) return null;
  return prev;
}

async function scoreIcpWithAi({ snap, profile, area, rules, opportunityScore, integrationEnv }) {
  const ai = await chatCompletion({
    messages: [
      {
        role: 'system',
        content: `You are a B2B outbound list quality reviewer. Decide if this local business is an A+ fit for the seller's offer and service area.

Respond with JSON only:
{
  "score": number (0-10, 10 = perfect ICP fit),
  "decision": "approve" | "reject",
  "nicheMatch": boolean,
  "geoMatch": boolean,
  "reason": string (one short sentence)
}

Approve only strong fits (typically score >= 8). Reject wrong niche, wrong geography, franchises/chains that rarely buy this offer, or leads with too little signal. Do not invent facts not in the data.`,
      },
      {
        role: 'user',
        content: JSON.stringify(
          {
            offer: {
              key: profile.offerKey,
              label: profile.offerLabel,
              senderBusinessName: profile.senderBusinessName,
              vertical: profile.vertical,
              pitch: profile.pitch,
            },
            serviceArea: {
              cities: area.cities,
              states: area.states,
              icpKeyword: area.icpKeyword,
              targetAudience: area.targetAudience,
            },
            lead: snap,
            rulesHint: {
              geoMatch: rules.geo.geoMatch,
              geoNote: rules.geo.note,
              nicheMatch: rules.niche.nicheMatch,
              nicheNote: rules.niche.note,
              opportunityScore,
            },
          },
          null,
          2,
        ),
      },
    ],
    jsonObject: true,
    max_tokens: 280,
    temperature: 0.2,
    integrationEnv: integrationEnv || null,
  });

  if (!ai.content || ai.error) {
    return { error: ai.errorMessage || ai.error || 'AI unavailable', provider: ai.provider || 'none' };
  }
  const parsed = parseLlmJson(ai.content);
  if (!parsed || parsed.score == null) {
    return { error: 'Invalid AI response', provider: ai.provider || 'none' };
  }
  return { parsed, provider: ai.provider || 'openrouter' };
}

async function persistIcpReview(leadKey, workspaceId, review) {
  const key = String(leadKey || '').trim();
  if (!key) return;
  const wid = String(workspaceId || 'default').trim() || 'default';
  try {
    await dbService.updateLead(
      key.startsWith('lead:') ? key : `lead:${key}`,
      {
        icpReview: normalizeIcpReview(review),
        logs: [
          {
            type: 'icp_review',
            message: `ICP ${review.decision} ${review.grade} (${review.score}/10): ${review.reason}`,
            timestamp: review.reviewedAt || new Date().toISOString(),
          },
        ],
      },
      wid,
    );
  } catch (e) {
    console.warn('[icpFitReview] persist failed:', e && e.message);
  }
}

/**
 * @param {{
 *   lead: object,
 *   workspace: object,
 *   folder?: object|null,
 *   settings?: object,
 *   minIcpScore?: number,
 *   forceRefresh?: boolean,
 *   persist?: boolean,
 * }} opts
 */
async function reviewLeadIcpFit(opts) {
  const lead = opts.lead && typeof opts.lead === 'object' ? opts.lead : {};
  const workspace = opts.workspace && typeof opts.workspace === 'object' ? opts.workspace : {};
  const folder = opts.folder || null;
  const settings = opts.settings && typeof opts.settings === 'object' ? opts.settings : {};
  const minIcpScore =
    opts.minIcpScore != null && opts.minIcpScore !== ''
      ? Number(opts.minIcpScore)
      : settings.minIcpScore != null && settings.minIcpScore !== ''
        ? Number(settings.minIcpScore)
        : DEFAULT_MIN_ICP_SCORE;

  const profile = resolveOutreachSenderProfile(workspace, lead, folder);
  const cached = opts.forceRefresh ? null : cachedReviewStillValid(lead, profile.offerKey);
  if (cached) {
    return {
      ...cached,
      fromCache: true,
      passes: passesIcpAPlusGate(cached, minIcpScore),
    };
  }

  const snap = leadSnapshot(lead);
  const area = resolveServiceArea({ workspace, settings, offer: profile });

  const geo = evaluateGeoMatch(snap, area);
  const niche = evaluateNicheMatch(snap, profile, area);
  const opportunityScore = scoreLeadRecord(lead).score;
  const wid = String(workspace.id || workspace.workspaceId || 'default').trim() || 'default';

  if (geo.hardReject) {
    const review = normalizeIcpReview({
      decision: 'reject',
      score: Math.min(3, rulesOnlyScore({ geo, niche, opportunityScore })),
      grade: 'D',
      reason: geo.note,
      nicheMatch: niche.nicheMatch,
      geoMatch: false,
      offerKey: profile.offerKey,
      reviewedAt: new Date().toISOString(),
      source: 'rules',
    });
    if (opts.persist !== false && lead.key) {
      await persistIcpReview(lead.key, wid, review);
    }
    return { ...review, fromCache: false, passes: false };
  }

  let integrationEnv = null;
  try {
    integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(wid);
  } catch (_) {
    /* ignore */
  }

  const ai = await scoreIcpWithAi({
    snap,
    profile,
    area,
    rules: { geo, niche },
    opportunityScore,
    integrationEnv,
  });

  let review;
  if (ai.parsed) {
    const score = Math.max(0, Math.min(10, Number(ai.parsed.score) || 0));
    let decision =
      ai.parsed.decision === 'approve' || ai.parsed.decision === 'reject'
        ? ai.parsed.decision
        : score >= minIcpScore
          ? 'approve'
          : 'reject';
    if (decision === 'approve' && score < minIcpScore) decision = 'reject';
    review = normalizeIcpReview({
      decision,
      score,
      grade: scoreToGrade(score),
      reason:
        String(ai.parsed.reason || '').trim() ||
        (decision === 'approve' ? 'AI approved ICP fit.' : 'AI rejected ICP fit.'),
      nicheMatch: ai.parsed.nicheMatch === true || niche.nicheMatch,
      geoMatch: ai.parsed.geoMatch === true || geo.geoMatch,
      offerKey: profile.offerKey,
      reviewedAt: new Date().toISOString(),
      source: 'ai',
    });
  } else {
    const score = rulesOnlyScore({ geo, niche, opportunityScore });
    const decision = geo.geoMatch && niche.nicheMatch && score >= minIcpScore ? 'approve' : 'reject';
    review = normalizeIcpReview({
      decision,
      score,
      grade: scoreToGrade(score),
      reason:
        (ai.error ? `AI unavailable (${ai.error}). ` : '') +
        (decision === 'approve'
          ? `Rules-only approve: ${geo.note} ${niche.note}`
          : `Rules-only reject: ${geo.note} ${niche.note}`),
      nicheMatch: niche.nicheMatch,
      geoMatch: geo.geoMatch,
      offerKey: profile.offerKey,
      reviewedAt: new Date().toISOString(),
      source: 'rules_fallback',
    });
  }

  if (opts.persist !== false && lead.key) {
    await persistIcpReview(lead.key, wid, review);
  }

  return {
    ...review,
    fromCache: false,
    passes: passesIcpAPlusGate(review, minIcpScore),
  };
}

module.exports = {
  ICP_CACHE_MS,
  DEFAULT_MIN_ICP_SCORE,
  A_PLUS_MIN,
  normalizeIcpReview,
  passesIcpAPlusGate,
  scoreToGrade,
  leadSnapshot,
  resolveServiceArea,
  evaluateGeoMatch,
  evaluateNicheMatch,
  rulesOnlyScore,
  reviewLeadIcpFit,
  persistIcpReview,
};
