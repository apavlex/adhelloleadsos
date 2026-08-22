/**
 * Workspace-owner GTM / Acquisition Blueprint.
 * Scrape the seller's site → LLM strategy → seed offers + GHL copy-paste prompts.
 * Not lead geoSeoGhlAudit (prospect sales).
 */
const { chatCompletion, parseLlmJson, isOpenRouterConfigured } = require('./llmClient');
const websiteAiAnalysis = require('./websiteAiAnalysis');
const firecrawl = require('./firecrawl');
const {
  buildGoalAlignedWorkflowPrompt,
  inferFolderOutreachIntent,
  buildWorkspaceContext,
} = require('./ghlWorkflowCoach');
const workspaceScriptBootstrap = require('./workspaceScriptBootstrap');
const { splitOfferScriptForSave } = require('./salesScriptsStorage');
const folderOutreachAutomation = require('./folderOutreachAutomation');

const MAX_SUMMARY = 2000;
const MAX_GOAL = 2000;
const MAX_PITCH = 1200;
const MAX_PROMPT = 24_000;
const MAX_LIBRARY = 12;

function normalizeUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.toString();
  } catch {
    return '';
  }
}

function hasFirecrawlKey(integrationEnv) {
  const env = integrationEnv && typeof integrationEnv === 'object' ? integrationEnv : {};
  const fromWs = typeof env.FIRECRAWL_API_KEY === 'string' ? env.FIRECRAWL_API_KEY.trim() : '';
  const fromProc = typeof process.env.FIRECRAWL_API_KEY === 'string' ? process.env.FIRECRAWL_API_KEY.trim() : '';
  return !!(fromWs || fromProc);
}

function trimStr(val, max) {
  const s = String(val || '').trim();
  if (!s) return '';
  return s.length > max ? s.slice(0, max) : s;
}

function trimList(arr, maxItems, maxItemLen) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => trimStr(x, maxItemLen))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeOfferRow(row) {
  if (!row || typeof row !== 'object') return null;
  const name = trimStr(row.name || row.label || row.offerName, 120);
  const pitch = trimStr(row.pitch || row.description, MAX_PITCH);
  if (!name && !pitch) return null;
  return {
    name: name || 'Primary offer',
    pitch,
    cta: trimStr(row.cta || row.desiredCta, 280),
  };
}

function normalizePromptLibrary(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const title = trimStr(row.title || row.name || row.label, 120);
    const prompt = trimStr(row.prompt || row.text || row.content, 4000);
    if (!title || !prompt) continue;
    out.push({ title, prompt });
    if (out.length >= MAX_LIBRARY) break;
  }
  return out;
}

function normalizeDraft(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const offers = Array.isArray(d.offers)
    ? d.offers.map(normalizeOfferRow).filter(Boolean).slice(0, 5)
    : [];
  return {
    strategySummary: trimStr(d.strategySummary || d.summary || d.strategy, MAX_SUMMARY),
    businessName: trimStr(d.businessName || d.brandName, 120),
    vertical: trimStr(d.vertical || d.industry, 80),
    primaryGoal: trimStr(d.primaryGoal || d.ghlGoal || d.goal, MAX_GOAL),
    ghlGoal: trimStr(d.ghlGoal || d.primaryGoal || d.goal, MAX_GOAL),
    offerName: trimStr(d.offerName || (offers[0] && offers[0].name), 120),
    openingScript: trimStr(d.openingScript || d.pitchScript, MAX_PITCH),
    targetAudience: trimStr(d.targetAudience || d.icpSummary || d.icp, 500),
    mainPainPoint: trimStr(d.mainPainPoint || d.painPoint, 400),
    differentiator: trimStr(d.differentiator || d.uniqueValue, 400),
    desiredCta: trimStr(d.desiredCta || (offers[0] && offers[0].cta), 280),
    auditLink: trimStr(d.auditLink, 500),
    valueProps: trimList(d.valueProps || d.benefits || d.features, 8, 200),
    offers,
    channels: trimList(d.channels || d.acquisitionChannels, 8, 80),
    promptLibrary: normalizePromptLibrary(d.promptLibrary || d.prompts),
    coachStarters: trimList(d.coachStarters || d.starters, 6, 400),
    ghlWorkflowPrompt: trimStr(d.ghlWorkflowPrompt, MAX_PROMPT),
  };
}

function normalizeBlueprintDoc(raw) {
  const b = raw && typeof raw === 'object' ? raw : {};
  return {
    sourceUrl: trimStr(b.sourceUrl, 500),
    generatedAt: trimStr(b.generatedAt, 64),
    appliedAt: trimStr(b.appliedAt, 64) || null,
    provider: trimStr(b.provider, 80),
    scrapeProvider: trimStr(b.scrapeProvider, 80),
    draft: normalizeDraft(b.draft),
  };
}

/**
 * Compact site signals for the LLM (owner GTM — not prospect GEO audit).
 */
async function scrapeOwnerSite(url, integrationEnv) {
  const audit = await websiteAiAnalysis.analyzeWebsite(url);
  const signals = {
    url,
    pageTitle: audit.pageTitle || '',
    metaDescription: audit.metaDescription || '',
    signals: audit.signals || [],
    emails: (audit.emails || []).slice(0, 3),
    phones: (audit.phones || []).slice(0, 2),
    mobileResponsive: !!audit.mobileResponsive,
    hasHttps: !!audit.hasHttps,
    topGapLabels: audit.topGapLabels || [],
    analysisScore: audit.analysisScore,
    error: audit.error || '',
  };

  let scrapeProvider = 'websiteAiAnalysis';
  let enrich = null;
  if (hasFirecrawlKey(integrationEnv)) {
    try {
      enrich = await firecrawl.enrichLead(url, { integrationEnv });
      scrapeProvider = 'websiteAiAnalysis+firecrawl';
    } catch (e) {
      signals.firecrawlError = e && e.message ? String(e.message).slice(0, 200) : 'Firecrawl failed';
    }
  }

  if (enrich && typeof enrich === 'object') {
    signals.enrich = {
      email: enrich.email || '',
      phone: enrich.phone || '',
      address: enrich.address || '',
      cms_platform: enrich.cms_platform || '',
      tech_stack_tags: Array.isArray(enrich.tech_stack_tags) ? enrich.tech_stack_tags.slice(0, 12) : [],
      audit_summary: enrich.audit_summary || '',
      geo_gaps: enrich.geo_gaps || '',
      visual_modernity_score: enrich.visual_modernity_score,
      aeo_score: enrich.aeo_score,
      has_chatbot: enrich.has_chatbot,
      has_schema_markup: enrich.has_schema_markup,
      review_snippets: Array.isArray(enrich.review_snippets) ? enrich.review_snippets.slice(0, 5) : [],
    };
  }

  return { signals, scrapeProvider, auditError: audit.error || '' };
}

function buildLlmSystemPrompt() {
  return `You are a go-to-market strategist for the OWNER of a business/app (not auditing a prospect).
Given scraped signals from THEIR website, produce an Acquisition Blueprint for outbound GTM via Go High Level (GHL) + Agency OS.

Return JSON only (no markdown fences) with this shape:
{
  "strategySummary": "3-6 sentences: ICP, positioning, primary acquisition motion",
  "businessName": "string",
  "vertical": "short vertical label",
  "primaryGoal": "one clear outreach goal for cold outreach",
  "ghlGoal": "same goal, phrased for a GHL workflow designer (what success looks like)",
  "offerName": "primary offer name",
  "openingScript": "2-4 short paragraphs cold open with {{name}}, {{company}}, {{city}} merge tags",
  "targetAudience": "who to contact",
  "mainPainPoint": "core pain",
  "differentiator": "why them",
  "desiredCta": "reply / book / get list / etc.",
  "auditLink": "" ,
  "valueProps": ["benefit1", "benefit2"],
  "offers": [{"name":"...", "pitch":"2-4 sentences seller pitch for AdHello Sender Pitch", "cta":"..."}],
  "channels": ["cold email+SMS via GHL", "..."],
  "promptLibrary": [
    {"title":"Day-0 email angle", "prompt":"copy-paste prompt for GHL AI writer or ops"},
    {"title":"SMS follow-up", "prompt":"..."}
  ],
  "coachStarters": [
    "Short user message to start the GHL workflow coach chat about this blueprint"
  ]
}

Rules:
- Owner GTM only — do NOT invent prospect GEO/SEO audit sales pitches unless the site is clearly a marketing agency selling audits.
- Be specific to the scraped title/description/signals; never generic "improve your online presence" unless that is clearly their product.
- openingScript and offers[0].pitch must be usable as sales copy.
- promptLibrary: 4-8 practical prompts (email, SMS, objection, workflow design).
- coachStarters: 2-4 short messages a user can click in the GHL workflow coach.
- Keep strategySummary under 1200 characters.`;
}

function ensureGhlWorkflowPrompt(draft, workspace) {
  if (draft.ghlWorkflowPrompt && draft.ghlWorkflowPrompt.trim()) {
    return trimStr(draft.ghlWorkflowPrompt, MAX_PROMPT);
  }
  const focusOffer = {
    label: draft.offerName || draft.businessName || 'Primary offer',
    vertical: draft.vertical,
    senderBusinessName: draft.businessName,
    pitch: (draft.offers[0] && draft.offers[0].pitch) || draft.openingScript || '',
  };
  const intent = inferFolderOutreachIntent(draft.ghlGoal || draft.primaryGoal, focusOffer);
  const ctx = buildWorkspaceContext(workspace || {});
  const folderName = (ctx.brandName || draft.businessName || 'Primary').slice(0, 80);
  return buildGoalAlignedWorkflowPrompt({
    folderName,
    ghlGoal: draft.ghlGoal || draft.primaryGoal,
    focusOffer,
    intent,
  });
}

/**
 * Generate + persist Acquisition Blueprint draft on the workspace doc.
 * @returns {Promise<{success:boolean, error?:string, blueprint?:object, integrationsHint?:string}>}
 */
async function generateAcquisitionBlueprint({ workspace, url, integrationEnv }) {
  const sourceUrl = normalizeUrl(url);
  if (!sourceUrl) {
    return { success: false, error: 'Enter a valid business or app URL (https://…).' };
  }

  if (!isOpenRouterConfigured(integrationEnv)) {
    return {
      success: false,
      error: 'OpenRouter is required to generate a blueprint.',
      integrationsHint:
        'Add an OpenRouter API key under Workspace → Integrations (free at openrouter.ai/keys). Firecrawl is optional but improves site feature extraction.',
    };
  }

  const { signals, scrapeProvider, auditError } = await scrapeOwnerSite(sourceUrl, integrationEnv);
  if (auditError && !signals.pageTitle && !signals.metaDescription && !signals.enrich) {
    return {
      success: false,
      error: `Could not scrape that URL (${auditError}). Check the address is public HTTPS.`,
    };
  }

  const ai = await chatCompletion({
    messages: [
      { role: 'system', content: buildLlmSystemPrompt() },
      {
        role: 'user',
        content: JSON.stringify({
          sourceUrl,
          siteSignals: signals,
          note: hasFirecrawlKey(integrationEnv)
            ? 'Firecrawl enrich included when present.'
            : 'No Firecrawl key — strategy based on HTML signals only. Optional: add FIRECRAWL under Integrations for richer extract.',
        }),
      },
    ],
    jsonObject: true,
    max_tokens: 3200,
    temperature: 0.45,
    integrationEnv,
  });

  if (!ai.content || ai.error) {
    return {
      success: false,
      error: 'AI request failed or OpenRouter is not configured.',
      integrationsHint:
        'Add or fix your OpenRouter key under Workspace → Integrations, then try again.',
    };
  }

  const parsed = parseLlmJson(ai.content);
  if (!parsed) {
    return { success: false, error: 'Invalid AI response — try Regenerate.' };
  }

  const draft = normalizeDraft(parsed);
  if (!draft.strategySummary && !draft.primaryGoal && !draft.offerName) {
    return { success: false, error: 'AI returned an empty blueprint — try Regenerate.' };
  }
  if (!draft.ghlGoal) draft.ghlGoal = draft.primaryGoal;
  if (!draft.primaryGoal) draft.primaryGoal = draft.ghlGoal;
  if (!draft.businessName && signals.pageTitle) {
    draft.businessName = trimStr(signals.pageTitle, 120);
  }
  draft.ghlWorkflowPrompt = ensureGhlWorkflowPrompt(draft, workspace);

  if (!draft.promptLibrary.length && draft.ghlWorkflowPrompt) {
    draft.promptLibrary = [
      {
        title: 'Full GHL workflow setup',
        prompt: draft.ghlWorkflowPrompt.slice(0, 4000),
      },
    ];
  }

  const blueprint = {
    sourceUrl,
    generatedAt: new Date().toISOString(),
    appliedAt: null,
    provider: ai.provider || 'openrouter',
    scrapeProvider,
    draft,
  };

  return { success: true, blueprint: normalizeBlueprintDoc(blueprint) };
}

/**
 * Apply draft → salesIntake + first offer pitch + optional first folder ghlGoal/prompt.
 * Mutates workspace; caller saves. Optionally mutates first folder via dbService (passed in).
 */
function applyBlueprintToWorkspace(workspace, blueprint) {
  const ws = workspace && typeof workspace === 'object' ? workspace : {};
  const bp = normalizeBlueprintDoc(blueprint || ws.acquisitionBlueprint);
  const draft = bp.draft || normalizeDraft({});

  const prevIntake = ws.salesIntake && typeof ws.salesIntake === 'object' ? ws.salesIntake : {};
  const salesIntake = {
    ...prevIntake,
    businessName: draft.businessName || prevIntake.businessName || '',
    vertical: draft.vertical || prevIntake.vertical || '',
    primaryGoal: draft.primaryGoal || draft.ghlGoal || prevIntake.primaryGoal || '',
    offerName: draft.offerName || prevIntake.offerName || '',
    auditLink: draft.auditLink || prevIntake.auditLink || '',
    targetAudience: draft.targetAudience || prevIntake.targetAudience || '',
    mainPainPoint: draft.mainPainPoint || prevIntake.mainPainPoint || '',
    differentiator: draft.differentiator || prevIntake.differentiator || '',
    desiredCta: draft.desiredCta || prevIntake.desiredCta || '',
    openingScript: draft.openingScript || prevIntake.openingScript || '',
  };
  ws.salesIntake = salesIntake;

  if (!workspaceScriptBootstrap.workspaceHasScriptCatalog(ws)) {
    workspaceScriptBootstrap.seedWorkspaceScriptsOnCreate(ws);
  }
  workspaceScriptBootstrap.applySalesIntakeToFirstOffer(ws, salesIntake);

  const catalog = Array.isArray(ws.salesScriptOfferCatalog) ? ws.salesScriptOfferCatalog : [];
  const first = catalog[0];
  const pitch =
    (draft.offers[0] && draft.offers[0].pitch) ||
    draft.openingScript ||
    '';
  if (first && first.key && pitch) {
    const prev =
      ws.salesScriptBlockOverrides && typeof ws.salesScriptBlockOverrides === 'object'
        ? ws.salesScriptBlockOverrides
        : {};
    const existing = prev[first.key];
    const existingText =
      existing && typeof existing === 'object'
        ? [existing.opening, existing.body, existing.closing].filter(Boolean).join('\n\n')
        : '';
    if (!existingText || draft.openingScript) {
      ws.salesScriptBlockOverrides = {
        ...prev,
        [first.key]: splitOfferScriptForSave(pitch),
      };
    }
  }

  ws.acquisitionBlueprint = {
    ...bp,
    appliedAt: new Date().toISOString(),
    draft: {
      ...draft,
      ghlWorkflowPrompt: ensureGhlWorkflowPrompt(draft, ws),
    },
  };
  ws.salesScriptsUpdatedAt = new Date().toISOString();
  return ws;
}

/**
 * Seed ghlGoal + workflow prompt onto the first folder (if any).
 * @returns {Promise<{folderKey?:string, folderName?:string}|null>}
 */
async function applyBlueprintToFirstFolder(dbService, workspaceId, blueprint) {
  if (!dbService || typeof dbService.listFolders !== 'function') return null;
  const wid = String(workspaceId || '').trim();
  if (!wid) return null;
  const bp = normalizeBlueprintDoc(blueprint);
  const draft = bp.draft || {};
  const goal = draft.ghlGoal || draft.primaryGoal || '';
  const prompt = draft.ghlWorkflowPrompt || '';
  if (!goal && !prompt) return null;

  const folders = await dbService.listFolders(wid);
  if (!Array.isArray(folders) || !folders.length) return null;
  const folder = folders[0];
  const key = folder.key || folder.id;
  if (!key) return null;

  const prev = folderOutreachAutomation.loadFolderOutreachFromFolder(folder);
  const next = folderOutreachAutomation.normalizeFolderOutreachSettings({
    ...prev,
    ghlGoal: goal || prev.ghlGoal,
    ghlWorkflowPrompt: prompt || prev.ghlWorkflowPrompt,
  });
  await dbService.updateFolder(wid, key, { outreachAutomation: next });
  return { folderKey: key, folderName: folder.name || '' };
}

/** Compact context string for GHL workflow coach system prompt. */
function blueprintContextForCoach(workspace) {
  const bp = workspace && workspace.acquisitionBlueprint;
  if (!bp || !bp.draft) return '';
  const d = normalizeDraft(bp.draft);
  if (!d.strategySummary && !d.ghlGoal) return '';
  const lines = [
    'Acquisition Blueprint (owner GTM — prefer this over generic agency examples):',
    d.businessName ? `Business: ${d.businessName}` : '',
    d.vertical ? `Vertical: ${d.vertical}` : '',
    d.ghlGoal ? `GHL goal: ${d.ghlGoal}` : '',
    d.strategySummary ? `Strategy: ${d.strategySummary.slice(0, 600)}` : '',
    d.offerName ? `Offer: ${d.offerName}` : '',
    d.valueProps.length ? `Value props: ${d.valueProps.slice(0, 4).join('; ')}` : '',
  ].filter(Boolean);
  return lines.join('\n');
}

module.exports = {
  normalizeUrl,
  normalizeDraft,
  normalizeBlueprintDoc,
  scrapeOwnerSite,
  generateAcquisitionBlueprint,
  applyBlueprintToWorkspace,
  applyBlueprintToFirstFolder,
  ensureGhlWorkflowPrompt,
  blueprintContextForCoach,
  hasFirecrawlKey,
};
