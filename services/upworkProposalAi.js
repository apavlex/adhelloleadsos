const { chatCompletion, parseLlmJson } = require('./llmClient');
const { UPWORK_PROPOSAL_EXAMPLE } = require('../config/upworkProposalExample');
const { UPWORK_SERVICE_LABEL_BY_KEY } = require('../config/upworkProposalServices');

function sanitizeProposalOutput(text) {
  let s = String(text || '').trim();
  s = s.replace(/^#+\s*Upwork Proposal\s*\n+/i, '');
  s = s.replace(/^---+\s*\n+/m, '');
  return s.trim();
}

function buildSystemPrompt(serviceLabel) {
  return `You write winning Upwork cover letter proposals for freelancers/agencies offering: ${serviceLabel}.

Match this EXACT structure, tone, and level of specificity (study every line):

${UPWORK_PROPOSAL_EXAMPLE}

Structure rules (always follow):
1. OPENING: Reference ONE specific detail from the client's job post (use **bold** around the phrase you noticed). Show you read their post — not generic fluff.
2. CREDIBILITY: One short paragraph — your specialty, years of experience, why this project scope fits you.
3. **My approach for your project:** then exactly 3 bullet points starting with "- "
4. SOCIAL PROOF: One paragraph — a similar recent project with concrete outcome (pages, issues fixed, client reaction).
5. QUESTIONS: "For a project like yours..." then one or two smart qualifying questions with key phrase in **bold**.
6. CLOSE: Friendly CTA — quick call or share examples. Warm sign-off.

Voice rules:
- First person, confident but not arrogant
- Plain English, no buzzword soup
- Do NOT start with "Dear" or "Hello Client"
- Do NOT mention AI, ChatGPT, or that this was generated
- Use **double asterisks** for emphasis on 2-4 phrases only
- Output plain text only — no "# Upwork Proposal" header, no horizontal rules
- Length: roughly 180-280 words

Respond with JSON only: {"proposal":"full cover letter text"}`;
}

async function generateUpworkProposal(input) {
  const jobTitle = String(input.jobTitle || '').trim();
  const jobDescription = String(input.jobDescription || '').trim();
  const experience = String(input.experience || '').trim();
  const serviceKey = String(input.serviceKey || 'general').trim();
  const serviceLabel = UPWORK_SERVICE_LABEL_BY_KEY[serviceKey] || 'General Digital Marketing';
  const currentProposal = String(input.currentProposal || '').trim();
  const isRegenerate = !!input.regenerate;

  if (!jobDescription) {
    return { success: false, error: 'Paste the job description first.' };
  }

  let userContent = `JOB TITLE:\n${jobTitle || '(not provided)'}\n\nJOB DESCRIPTION:\n${jobDescription.slice(0, 10000)}`;
  if (experience) {
    userContent += `\n\nMY RELEVANT EXPERIENCE TO WEAVE IN:\n${experience.slice(0, 3000)}`;
  }
  userContent += `\n\nSERVICE I AM PITCHING: ${serviceLabel}`;
  if (isRegenerate && currentProposal) {
    userContent += `\n\nCURRENT DRAFT (write a fresh variation — same structure, different hook and wording, do not copy verbatim):\n${currentProposal.slice(0, 8000)}`;
  } else {
    userContent += '\n\nWrite the full Upwork cover letter proposal now.';
  }

  const ai = await chatCompletion({
    messages: [
      { role: 'system', content: buildSystemPrompt(serviceLabel) },
      { role: 'user', content: userContent },
    ],
    jsonObject: true,
    max_tokens: 900,
    temperature: isRegenerate ? 0.68 : 0.55,
  });

  if (!ai.content || ai.error) {
    return { success: false, error: ai.error || 'AI request failed. Set OPENROUTER_API_KEY.' };
  }

  const parsed = parseLlmJson(ai.content);
  let proposal =
    parsed && typeof parsed.proposal === 'string' ? sanitizeProposalOutput(parsed.proposal) : '';
  if (!proposal) {
    return { success: false, error: 'Invalid AI response' };
  }

  return { success: true, proposal, provider: ai.provider || 'unknown' };
}

module.exports = {
  generateUpworkProposal,
  sanitizeProposalOutput,
};
