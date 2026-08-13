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
    folderKey: String(r.folderKey || '').trim(),
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

function evaluateNicheMatch(snap, profile, area, folderContext = null) {
  const hay = normalizeToken([snap.title, snap.category, snap.website].filter(Boolean).join(' '));
  const folderNeedles = [
    ...parseListField(folderContext && folderContext.name),
    ...parseListField(folderContext && folderContext.goal),
  ].filter((t) => t.length >= 3);
  const needles = [
    ...folderNeedles,
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
  // Folder drips: if the folder itself is the niche (e.g. "Water Restoration") and the
  // lead title/category shares a strong token with that folder, treat as niche match.
  if (folderNeedles.length && hay) {
    const folderHits = folderNeedles.filter((n) => {
      if (hay.includes(n)) return true;
      const parts = n.split(' ').filter((p) => p.length >= 4);
      return parts.length > 0 && parts.some((p) => hay.includes(p));
    });
    if (folderHits.length) {
      return { nicheMatch: true, note: `Folder niche overlap: ${folderHits.slice(0, 3).join(', ')}` };
    }
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

function cachedReviewStillValid(lead, offerKey, folderKey = '') {
  const prev = lead && lead.icpReview ? normalizeIcpReview(lead.icpReview) : null;
  if (!prev || !prev.reviewedAt) return null;
  if (offerKey && prev.offerKey && prev.offerKey !== offerKey) return null;
  const prevFolder = String(prev.folderKey || '').trim();
  const wantFolder = String(folderKey || '').trim();
  if (wantFolder && prevFolder && prevFolder !== wantFolder) return null;
  if (wantFolder && !prevFolder) return null;
  const ts = Date.parse(prev.reviewedAt);
  if (!Number.isFinite(ts) || Date.now() - ts > ICP_CACHE_MS) return null;
  return prev;
}

async function scoreIcpWithAi({ snap, profile, area, rules, opportunityScore, integrationEnv, folderContext }) {
  const folderName = String((folderContext && folderContext.name) || '').trim();
  const folderGoal = String((folderContext && folderContext.goal) || '').trim();
  const ai = await chatCompletion({
    messages: [
      {
        role: 'system',
        content: `You are a B2B outbound list quality reviewer. Decide if this local business is a strong fit for THIS drip.

${folderName ? `Priority: this drip is for folder "${folderName}"${folderGoal ? ` with goal: ${folderGoal}` : ''}. Approve leads that match that folder niche/trade even if the workspace default offer vertical differs.` : 'Approve only strong fits for the seller offer and service area.'}

Respond with JSON only:
{
  "score": number (0-10, 10 = perfect ICP fit),
  "decision": "approve" | "reject",
  "nicheMatch": boolean,
  "geoMatch": boolean,
  "reason": string (one short sentence)
}

Approve strong fits (typically score >= 7 for folder drips, >= 8 otherwise). Reject wrong geography, obvious franchises/chains that rarely buy, or leads with too little signal. Do not invent facts not in the data.`,
      },
      {
        role: 'user',
        content: JSON.stringify(
          {
            folder: folderName
              ? { name: folderName, goal: folderGoal || null }
              : null,
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
  const folderKey = String((folder && folder.key) || (settings && settings.folderKey) || '').trim();
  const folderContext = {
    name: String((folder && folder.name) || '').trim(),
    goal: String((settings && settings.ghlGoal) || '').trim(),
    key: folderKey,
  };
  const cached = opts.forceRefresh
    ? null
    : cachedReviewStillValid(lead, profile.offerKey, folderKey);
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
  const niche = evaluateNicheMatch(snap, profile, area, folderContext);
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
      folderKey,
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
    folderContext,
  });

  // Folder drips: slightly softer floor so curated trade folders aren't wiped by A+ default.
  const effectiveMin =
    folderContext.name && Number.isFinite(minIcpScore)
      ? Math.min(minIcpScore, 7)
      : minIcpScore;

  let review;
  if (ai.parsed) {
    const score = Math.max(0, Math.min(10, Number(ai.parsed.score) || 0));
    let decision =
      ai.parsed.decision === 'approve' || ai.parsed.decision === 'reject'
        ? ai.parsed.decision
        : score >= effectiveMin
          ? 'approve'
          : 'reject';
    if (decision === 'approve' && score < effectiveMin) decision = 'reject';
    // If rules say folder niche matches and geo is ok, don't let a vague AI reject win at borderline scores.
    if (
      decision === 'reject' &&
      folderContext.name &&
      niche.nicheMatch &&
      geo.geoMatch &&
      score >= effectiveMin - 1
    ) {
      decision = 'approve';
    }
    review = normalizeIcpReview({
      decision,
      score: decision === 'approve' && score < effectiveMin ? effectiveMin : score,
      grade: scoreToGrade(score),
      reason:
        String(ai.parsed.reason || '').trim() ||
        (decision === 'approve' ? 'AI approved ICP fit.' : 'AI rejected ICP fit.'),
      nicheMatch: ai.parsed.nicheMatch === true || niche.nicheMatch,
      geoMatch: ai.parsed.geoMatch === true || geo.geoMatch,
      offerKey: profile.offerKey,
      folderKey,
      reviewedAt: new Date().toISOString(),
      source: 'ai',
    });
  } else {
    const score = rulesOnlyScore({ geo, niche, opportunityScore });
    const decision =
      geo.geoMatch && niche.nicheMatch && score >= effectiveMin ? 'approve' : 'reject';
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
      folderKey,
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
    passes: passesIcpAPlusGate(review, effectiveMin),
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
