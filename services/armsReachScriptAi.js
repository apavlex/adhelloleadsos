const { chatCompletion, parseLlmJson } = require('./llmClient');
const {
  ARMS_REACH_FACEBOOK_EXAMPLES,
  ARMS_REACH_REFERRAL_SEED,
  ARMS_REACH_REFERRAL_STYLE_EXAMPLES,
} = require('../config/armsReachScripts');

function sanitizeArmsReachScript(text) {
  let s = String(text || '').trim();
  s = s.replace(/^here['']s a new variation:?\s*/i, '');
  s = s.replace(/^["']|["']$/g, '');
  return s.trim();
}

function facebookPostSystemPrompt() {
  return `You write casual first-person Facebook posts for someone tapping their personal network (not a business page) to find small business owners who need more customers.

Match this EXACT voice — conversational, humble, not salesy, no emojis, no hashtags, no bullet points, no meta labels:

${ARMS_REACH_FACEBOOK_EXAMPLES}

Rules:
- Output ONLY the post text — never prefix with "Here's a new variation" or quotes around the whole post
- 3–5 sentences, plain prose
- Open with "Hey", "Quick question", "Does anyone know", or similar casual hook
- Ask if anyone knows a small business owner who could use more customers/revenue
- Mention testing or trying something with someone in their network before going wider
- Invite them to tag someone or send a message
- Do NOT mention your company name, AI, marketing agency, or "LMV"
- Sound like a real person posting to friends

Respond with JSON only: {"script":"full post text only"}`;
}

function referralFollowUpSystemPrompt(ownerName, referrerName) {
  const owner = String(ownerName || 'there').trim() || 'there';
  const referrer = String(referrerName || 'a friend').trim() || 'a friend';
  const extraExamples = ARMS_REACH_REFERRAL_STYLE_EXAMPLES.map((ex) =>
    ex.replace(/\{\{ownerName\}\}/g, owner).replace(/\{\{referrerName\}\}/g, referrer),
  ).join('\n');
  return `You write short, casual referral follow-up messages (DM or text) when someone in your network connects you to a business owner.

Match this EXACT tone — friendly, brief, first person:

${extraExamples}

Template:
"${ARMS_REACH_REFERRAL_SEED.replace(/\{\{ownerName\}\}/g, owner).replace(/\{\{referrerName\}\}/g, referrer)}"

Write ONE message for:
- Business owner first name or business name: ${owner}
- Person/company who referred you: ${referrer}

Rules:
- Output ONLY the message text — no labels or quotes wrapping the whole message
- Start with "Hey ${owner}!" or similar
- Reference the referrer naturally (e.g. "pointed me your way")
- End with a soft question about taking on new customers
- 1–3 sentences max, friendly, not corporate
- No emojis

Respond with JSON only: {"script":"full message text only"}`;
}

async function regenerateArmsReachFacebookPost(currentText, versionLabel) {
  const userContent = currentText
    ? `Current version (${versionLabel || 'draft'}):\n${currentText.slice(0, 4000)}\n\nWrite a fresh variation in the same voice. Do not copy verbatim.`
    : `Write version ${versionLabel || '1'} in the example voice.`;

  const ai = await chatCompletion({
    messages: [
      { role: 'system', content: facebookPostSystemPrompt() },
      { role: 'user', content: userContent },
    ],
    jsonObject: true,
    max_tokens: 400,
    temperature: 0.72,
  });

  if (!ai.content || ai.error) {
    return { success: false, error: ai.error || 'AI request failed. Set OPENROUTER_API_KEY.' };
  }

  const parsed = parseLlmJson(ai.content);
  let script = parsed && typeof parsed.script === 'string' ? sanitizeArmsReachScript(parsed.script) : '';
  if (!script) {
    return { success: false, error: 'Invalid AI response' };
  }

  return { success: true, script, provider: ai.provider || 'unknown' };
}

async function regenerateArmsReachReferralMessage(ownerName, referrerName, currentText) {
  const owner = String(ownerName || '').trim();
  const referrer = String(referrerName || '').trim();
  if (!owner || !referrer) {
    return { success: false, error: 'Enter both the business owner name and referrer name.' };
  }

  let userContent = `Business owner: ${owner}\nReferrer: ${referrer}`;
  if (currentText && String(currentText).trim()) {
    userContent += `\n\nCurrent draft:\n${String(currentText).trim().slice(0, 2000)}\n\nRewrite in the same voice.`;
  }

  const ai = await chatCompletion({
    messages: [
      { role: 'system', content: referralFollowUpSystemPrompt(owner, referrer) },
      { role: 'user', content: userContent },
    ],
    jsonObject: true,
    max_tokens: 250,
    temperature: 0.55,
  });

  if (!ai.content || ai.error) {
    return { success: false, error: ai.error || 'AI request failed. Set OPENROUTER_API_KEY.' };
  }

  const parsed = parseLlmJson(ai.content);
  let script = parsed && typeof parsed.script === 'string' ? sanitizeArmsReachScript(parsed.script) : '';
  if (!script) {
    return { success: false, error: 'Invalid AI response' };
  }

  return { success: true, script, provider: ai.provider || 'unknown' };
}

module.exports = {
  regenerateArmsReachFacebookPost,
  regenerateArmsReachReferralMessage,
  sanitizeArmsReachScript,
};
