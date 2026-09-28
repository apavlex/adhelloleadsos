/**
 * AI helpers for the teammate onboarding editor: rewrite one email, or draft a whole plan
 * tailored to the workspace's business.
 */
const { chatCompletion, parseLlmJson } = require('./llmClient');
const {
  ACTIVATION_EVENTS,
  SUGGESTED_LINKS,
  PLACEHOLDERS,
  MAX_STEPS,
  normalizeStep,
} = require('./onboardingConfig');

function workspaceContext(ws) {
  const intake = (ws && ws.salesIntake) || {};
  return {
    workspaceName: (ws && ws.name) || '',
    businessName: intake.businessName || '',
    vertical: intake.vertical || '',
    offer: intake.offerName || '',
    targetAudience: intake.targetAudience || intake.sellTo || '',
    primaryGoal: intake.primaryGoal || '',
  };
}

const PLACEHOLDER_RULES = `Merge tags look like {{first_name}}. Available: ${PLACEHOLDERS.map((p) => `{{${p.key}}}`).join(', ')}.
Keep every merge tag that appears in the original, spelled exactly the same. Never invent new merge tags.`;

async function rewriteEmail({ ws, kind, subject, body, title, hint, instruction, integrationEnv }) {
  const isInvite = kind === 'invite';
  const ai = await chatCompletion({
    messages: [
      {
        role: 'system',
        content: `You rewrite onboarding emails a business sends to a NEW TEAMMATE (an employee or sales rep), not to customers.
${isInvite ? 'This is the invitation email: it must contain {{invite_link}} and explain they sign in with Google using this email.' : "This is one daily activation email: it teaches one habit in the app and must link to {{step_link}}."}
Rules:
- Return JSON only: {"subject":"...","body":"..."}
- Plain text body (no markdown, no HTML), short paragraphs separated by a blank line, under 140 words.
- Warm, direct, specific to the business below. One clear action.
${PLACEHOLDER_RULES}`,
      },
      {
        role: 'user',
        content: JSON.stringify({
          business: workspaceContext(ws),
          step: isInvite ? null : { title: title || '', hint: hint || '' },
          instruction: String(instruction || '').trim() || 'Make it clearer and more motivating.',
          current: { subject: subject || '', body: body || '' },
        }),
      },
    ],
    jsonObject: true,
    max_tokens: 900,
    temperature: 0.55,
    integrationEnv,
  });
  if (!ai.content || ai.error) throw new Error('No AI provider configured or the request failed.');
  const parsed = parseLlmJson(ai.content) || {};
  const nextBody = typeof parsed.body === 'string' ? parsed.body.trim() : '';
  if (!nextBody) throw new Error('AI returned an empty email. Try again.');
  return {
    subject: typeof parsed.subject === 'string' && parsed.subject.trim() ? parsed.subject.trim() : subject || '',
    body: nextBody,
    provider: ai.provider || '',
  };
}

async function generatePlan({ ws, instruction, days, integrationEnv }) {
  const count = Math.min(MAX_STEPS, Math.max(3, parseInt(days, 10) || 7));
  const ai = await chatCompletion({
    messages: [
      {
        role: 'system',
        content: `You design a ${count}-day onboarding plan for a NEW TEAMMATE joining a business's sales workspace in "Agency OS" (a lead-gen + outreach CRM).
Each day teaches ONE habit in the app and has a matching email sent that morning.
App areas you can link to (use these hrefs exactly): ${JSON.stringify(SUGGESTED_LINKS)}.
Auto-complete events (use these keys exactly, "" means the teammate marks it done): ${JSON.stringify(ACTIVATION_EVENTS)}.
Return JSON only: {"steps":[{"title":"2-5 words","hint":"one short line shown in the checklist","href":"...","event":"...","subject":"...","body":"..."}]}
Email bodies: plain text, short paragraphs separated by a blank line, under 120 words, start with "Hi {{first_name}}," and include {{step_link}}.
Tailor the habits and wording to the business (its industry, offer, and customers).
${PLACEHOLDER_RULES}`,
      },
      {
        role: 'user',
        content: JSON.stringify({
          business: workspaceContext(ws),
          instruction: String(instruction || '').trim(),
          days: count,
        }),
      },
    ],
    jsonObject: true,
    max_tokens: 3500,
    temperature: 0.6,
    integrationEnv,
  });
  if (!ai.content || ai.error) throw new Error('No AI provider configured or the request failed.');
  const parsed = parseLlmJson(ai.content) || {};
  const used = new Set();
  const steps = (Array.isArray(parsed.steps) ? parsed.steps : [])
    .slice(0, count)
    .map((s) => normalizeStep({ ...s, id: '' }, used))
    .filter(Boolean);
  if (steps.length < 3) throw new Error('AI did not return a usable plan. Try again.');
  return { steps, provider: ai.provider || '' };
}

module.exports = { rewriteEmail, generatePlan, workspaceContext };
