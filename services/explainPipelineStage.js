/**
 * POST /pipeline/stages/explain — short LLM blurb; cache on row when stageId + workspace known.
 */
const { chatCompletion } = require('./llmClient');

const EXPLAIN_STAGE_SYSTEM = `You help CRM users understand their pipeline. Given a stage (name + key + position in the overall pipeline + the business description for the workspace), write 2–3 short sentences: first, what a lead in this stage typically looks like; second, the single most important action to move it forward. Plain prose, no bullets, no preamble. Max 60 words.`;

async function explainPipelineStage({
  stageKey,
  stageName,
  position1Based,
  totalStages,
  businessDescription,
}) {
  const user = JSON.stringify({
    stageKey: String(stageKey || ''),
    stageName: String(stageName || ''),
    position1Based: position1Based || 1,
    totalStages: totalStages || 1,
    businessDescription: String(businessDescription || '').slice(0, 500),
  });

  let ai;
  try {
    ai = await Promise.race([
      chatCompletion({
        messages: [
          { role: 'system', content: EXPLAIN_STAGE_SYSTEM },
          { role: 'user', content: user },
        ],
        jsonObject: false,
        max_tokens: 200,
        temperature: 0.35,
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000)),
    ]);
  } catch {
    return { success: false, error: 'Could not generate explanation. Try again.' };
  }

  const text = (ai && ai.content && String(ai.content).trim()) || '';
  if (!text) {
    return { success: false, error: 'Could not generate explanation. Try again.' };
  }
  return { success: true, description: text };
}

module.exports = {
  explainPipelineStage,
  EXPLAIN_STAGE_SYSTEM,
};
