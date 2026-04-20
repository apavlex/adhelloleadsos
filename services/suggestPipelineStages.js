/**
 * POST /workspaces/suggest-stages — LLM pipeline proposal + normalizeStages.
 */
const { chatCompletion } = require('./llmClient');
const { normalizeStages } = require('../lib/pipeline/normalize');
const { SUGGEST_STAGES_SYSTEM_PROMPT } = require('../lib/pipeline/suggestSystemPrompt');

const VALID_CYCLE = new Set(['days', '1-2w', '1-2m', '3m+']);
const VALID_MODIFIER = new Set(['simpler', 'more_detailed']);

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
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.stages)) return null;
  const rationale = typeof parsed.rationale === 'string' ? parsed.rationale.trim() : '';
  return { stages: parsed.stages, rationale };
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

async function suggestPipelineStages(body) {
  const err = validateSuggestBody(body);
  if (err) return { success: false, error: err };

  const userPrompt = buildUserPrompt(body);
  const messages = [
    { role: 'system', content: SUGGEST_STAGES_SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];

  async function callOnce() {
    return chatCompletion({
      messages,
      jsonObject: true,
      max_tokens: 2000,
      temperature: 0.3,
    });
  }

  let ai;
  try {
    ai = await withTimeout(callOnce(), 20000);
  } catch {
    return {
      success: false,
      error: 'Could not generate stages, please try again or use a preset.',
    };
  }

  let parsed = parseStagesResponse(ai && ai.content);
  if (!parsed) {
    try {
      const ai2 = await withTimeout(callOnce(), 20000);
      parsed = parseStagesResponse(ai2 && ai2.content);
    } catch {
      parsed = null;
    }
  }

  if (!parsed) {
    return {
      success: false,
      error: 'Could not generate stages, please try again or use a preset.',
    };
  }

  try {
    const stages = normalizeStages(parsed.stages);
    return {
      success: true,
      stages,
      rationale: parsed.rationale || '',
    };
  } catch (e) {
    return {
      success: false,
      error: 'Could not generate stages, please try again or use a preset.',
    };
  }
}

module.exports = {
  suggestPipelineStages,
  validateSuggestBody,
  SALE_INCLUDES_KEYS,
};
