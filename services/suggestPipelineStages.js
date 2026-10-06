/**
 * POST /workspaces/suggest-stages — LLM pipeline proposal + normalizeStages.
 */
const { chatCompletion, parseLlmJson, providersForChain } = require('./llmClient');
const { normalizeStages } = require('../lib/pipeline/normalize');
const { PALETTE } = require('../lib/pipeline/presets');
const { SUGGEST_STAGES_SYSTEM_PROMPT } = require('../lib/pipeline/suggestSystemPrompt');

const VALID_CYCLE = new Set(['days', '1-2w', '1-2m', '3m+']);
const VALID_MODIFIER = new Set(['simpler', 'more_detailed']);

const PROVIDER_TIMEOUT_MS = 20000;
const TOTAL_BUDGET_MS = 50000;
const MAX_PROVIDERS = 3;

const FALLBACK_NOTE =
  'The AI designer was busy, so this starter pipeline was built from your answers. Edit it below or press Try again.';

const SALE_INCLUDES_KEYS = new Set([
  'site_visit',
  'estimate',
  'contract',
  'deposit',
  'install',
  'subscription',
  'multi_stakeholder',
]);

function validateSuggestBody(body) {
  if (!body || typeof body !== 'object') return 'Invalid JSON body.';
  const desc = String(body.businessDescription || '').trim();
  if (desc.length < 3 || desc.length > 500) {
    return 'businessDescription must be 3–500 characters.';
  }
  const cycle = String(body.cycleLength || '').trim();
  if (!VALID_CYCLE.has(cycle)) {
    return 'cycleLength must be one of: days, 1-2w, 1-2m, 3m+.';
  }
  const won = String(body.wonDefinition || '').trim();
  if (won.length < 2 || won.length > 200) {
    return 'wonDefinition must be 2–200 characters.';
  }
  let saleIncludes = body.saleIncludes;
  if (saleIncludes == null) saleIncludes = [];
  if (!Array.isArray(saleIncludes)) return 'saleIncludes must be an array.';
  for (const x of saleIncludes) {
    if (!SALE_INCLUDES_KEYS.has(String(x))) {
      return `Invalid saleIncludes entry: ${String(x)}`;
    }
  }
  const mod = body.modifier;
  if (mod != null && mod !== '' && !VALID_MODIFIER.has(String(mod))) {
    return 'modifier must be simpler, more_detailed, or omitted.';
  }
  return null;
}

function buildUserPrompt(body) {
  const lines = [
    `Business description:\n${String(body.businessDescription || '').trim()}`,
    `Sales cycle length: ${String(body.cycleLength || '').trim()}`,
    `Sale includes (flags): ${JSON.stringify(body.saleIncludes || [])}`,
    `Definition of "won": ${String(body.wonDefinition || '').trim()}`,
  ];
  const mod = body.modifier;
  if (mod === 'simpler') {
    lines.push('Prefer 5–6 stages and merge adjacent steps.');
  } else if (mod === 'more_detailed') {
    lines.push('Prefer 8–10 stages and split distinct operational steps.');
  }
  return lines.join('\n\n');
}

function parseStagesResponse(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const parsed = parseLlmJson(raw);
  if (!parsed || typeof parsed !== 'object') return null;
  let stages = null;
  if (Array.isArray(parsed)) stages = parsed;
  else if (Array.isArray(parsed.stages)) stages = parsed.stages;
  else if (Array.isArray(parsed.pipeline)) stages = parsed.pipeline;
  else if (parsed.pipeline && Array.isArray(parsed.pipeline.stages)) stages = parsed.pipeline.stages;
  if (!stages || !stages.length) return null;
  const rationale = !Array.isArray(parsed) && typeof parsed.rationale === 'string' ? parsed.rationale.trim() : '';
  return { stages, rationale };
}

function suggestProviders(integrationEnv) {
  const seen = new Set();
  const list = [];
  for (const p of [...providersForChain('openrouter', integrationEnv), ...providersForChain('legacy')]) {
    const id = `${p.name}:${p.model || ''}`;
    if (seen.has(id)) continue;
    seen.add(id);
    list.push(p);
  }
  return list.slice(0, MAX_PROVIDERS);
}

const CYCLE_SLA = { days: 4, '1-2w': 24, '1-2m': 48, '3m+': 72 };

/** Rule-based pipeline from the intake answers, used when every AI provider fails. */
function starterStagesFromIntake(body) {
  const inc = new Set(Array.isArray(body.saleIncludes) ? body.saleIncludes.map(String) : []);
  const base = CYCLE_SLA[String(body.cycleLength || '')] || 48;
  const wonName = String(body.wonDefinition || '').trim().slice(0, 30) || 'Won';
  const wonLower = wonName.toLowerCase();
  const stage = (key, name, color, slaHours) => ({ key, name, color, slaHours, isWon: false, isLost: false });

  const stages = [stage('new_lead', 'New lead', PALETTE.slate, base), stage('contacted', 'Contacted', PALETTE.blue, base * 2)];
  if (inc.has('site_visit')) stages.push(stage('site_visit', 'Site visit scheduled', PALETTE.violet, base * 2));
  if (inc.has('estimate')) stages.push(stage('estimate_sent', 'Estimate sent', PALETTE.pink, base * 2));
  if (inc.has('multi_stakeholder')) stages.push(stage('decision_review', 'Decision review', PALETTE.orange, base * 3));
  if (inc.has('contract')) stages.push(stage('contract_sent', 'Contract sent', PALETTE.orange, base * 2));
  if (!inc.has('estimate') && !inc.has('contract')) stages.push(stage('quote_sent', 'Quote sent', PALETTE.pink, base * 2));
  if (inc.has('deposit') && !wonLower.includes('deposit')) {
    stages.push(stage('awaiting_deposit', 'Awaiting deposit', PALETTE.yellow, base * 2));
  }
  if (inc.has('install') && /complet|install|deliver/.test(wonLower)) {
    stages.push(stage('install_scheduled', 'Install scheduled', PALETTE.yellow, base * 3));
  }
  stages.push({ key: 'won', name: wonName, color: PALETTE.green, slaHours: null, isWon: true, isLost: false });
  stages.push({ key: 'lost', name: 'Lost', color: PALETTE.red, slaHours: null, isWon: false, isLost: true });
  return stages;
}

function fallbackResult(body) {
  return {
    success: true,
    stages: normalizeStages(starterStagesFromIntake(body)),
    rationale: FALLBACK_NOTE,
    fallback: true,
  };
}

/**
 * @param {object} body intake answers
 * @param {{ integrationEnv?: Record<string,string>|null }} [opts]
 */
async function suggestPipelineStages(body, opts = {}) {
  const err = validateSuggestBody(body);
  if (err) return { success: false, error: err };

  const integrationEnv = (opts && opts.integrationEnv) || null;
  const providers = suggestProviders(integrationEnv);
  const messages = [
    { role: 'system', content: SUGGEST_STAGES_SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt(body) },
  ];

  const started = Date.now();
  for (const prov of providers) {
    const remaining = TOTAL_BUDGET_MS - (Date.now() - started);
    if (remaining < 5000) break;
    let ai;
    try {
      ai = await chatCompletion({
        providersOverride: [prov],
        integrationEnv,
        messages,
        jsonObject: true,
        max_tokens: 1500,
        temperature: 0.3,
        timeoutMs: Math.min(PROVIDER_TIMEOUT_MS, remaining),
        allowReasoningFallback: false,
      });
    } catch (e) {
      console.warn('[suggest-stages]', prov.name, e.message);
      continue;
    }
    const parsed = ai && ai.content && !ai.error ? parseStagesResponse(ai.content) : null;
    if (!parsed) {
      console.warn('[suggest-stages] no usable stages from', prov.name, (ai && ai.errorMessage) || '');
      continue;
    }
    try {
      return { success: true, stages: normalizeStages(parsed.stages), rationale: parsed.rationale || '' };
    } catch (e) {
      console.warn('[suggest-stages] normalize failed for', prov.name, e.message);
    }
  }

  console.warn('[suggest-stages] AI unavailable, using starter pipeline');
  return fallbackResult(body);
}

module.exports = {
  suggestPipelineStages,
  validateSuggestBody,
  starterStagesFromIntake,
  parseStagesResponse,
  suggestProviders,
  SALE_INCLUDES_KEYS,
};
