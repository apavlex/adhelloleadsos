/**
 * AI brainstorm partner for Go High Level auto-outreach workflow design.
 */
const { chatCompletion, parseLlmJson } = require('./llmClient');
const workspaceSalesScripts = require('./workspaceSalesScripts');
const { SCRIPT_LIBRARY } = require('./salesConstants');
const { buildMergedScriptLibrary } = require('./salesScriptsStorage');
const { pitchFromOfferBlock } = require('./outreachSenderProfile');

const MAX_HISTORY = 14;
const MAX_USER_MSG = 4000;
const MAX_PROMPT_LEN = 24_000;

function buildWorkspaceContext(workspace) {
  const ws = workspace && typeof workspace === 'object' ? workspace : {};
  const { catalog, library } = workspaceSalesScripts.buildWorkspaceOfferLibrary(ws, SCRIPT_LIBRARY);
  const brandName = String((ws.brandKit && ws.brandKit.businessName) || '').trim();
  const autoPool = ws.prospecting && ws.prospecting.autoPool ? ws.prospecting.autoPool : {};

  const offers = catalog.map((entry) => {
    const block = library[entry.key] || {};
    return {
      key: entry.key,
      label: entry.label,
      vertical: String(entry.vertical || '').trim(),
      senderBusinessName: String(entry.senderBusinessName || entry.label || '').trim(),
      auditLink: String(entry.auditLink || '').trim(),
      pitch: pitchFromOfferBlock(block).slice(0, 280),
    };
  });

  return {
    brandName,
    autoPoolSenderOfferKey: String(autoPool.senderOfferKey || '').trim(),
    offers,
  };
}

function formatOffersForPrompt(ctx) {
  if (!ctx.offers.length) return 'No custom offers configured yet.';
  return ctx.offers
    .map((o) => {
      const bits = [`- ${o.label} (key: ${o.key})`];
      if (o.vertical) bits.push(`vertical: ${o.vertical}`);
      if (o.senderBusinessName && o.senderBusinessName !== o.label) {
        bits.push(`sender: ${o.senderBusinessName}`);
      }
      if (o.auditLink) bits.push(`audit: ${o.auditLink}`);
      if (o.pitch) bits.push(`pitch: ${o.pitch}`);
      return bits.join(' · ');
    })
    .join('\n');
}

function buildSystemPrompt(ctx, senderOfferKey) {
  const focusOffer = senderOfferKey
    ? ctx.offers.find((o) => o.key === senderOfferKey)
    : null;
  const focusLine = focusOffer
    ? `User is focusing on sender profile: ${focusOffer.label} (${focusOffer.key}).`
    : 'No specific sender profile selected — design for merge-field multi-business approach unless user names one.';

  return `You are a Go High Level (GHL) automation architect. Help the user brainstorm and produce copy-paste setup instructions for cold outreach workflows triggered when AdHello / Agency OS enrolls a lead.

TRIGGER (fixed by AdHello):
• Workflow type: Contact tag added
• Tag name (exact): auto-outreach
• Wait 2 minutes after trigger (AdHello syncs contact + custom fields first)

PROSPECT merge fields (the lead being contacted):
• {{contact.company_name}}, {{contact.first_name}}, {{contact.city}}, {{contact.state}}, {{contact.website}}, {{contact.phone}}
• AdHello Google Rating, AdHello Google Reviews
• AdHello Phone Line Type, AdHello SMS OK (Yes = safe to SMS; No = landline)

SENDER PROFILE merge fields (which business is reaching out — synced from Agency OS Offers):
• {{custom_field.AdHello Sender Business}}
• {{custom_field.AdHello Sender Vertical}}
• {{custom_field.AdHello Sender Offer}}
• {{custom_field.AdHello Sender Pitch}}
• {{custom_field.AdHello Audit Link}} — use [GHL AUDIT LINK] if blank

Workspace brand: ${ctx.brandName || '(not set)'}
Auto-pool default sender offer key: ${ctx.autoPoolSenderOfferKey || '(first offer)'}
${focusLine}

Configured business profiles (Offers):
${formatOffersForPrompt(ctx)}

Your job:
1. Brainstorm sequence design: timing, email/SMS/RVM steps, IF branches (SMS OK, vertical), tone, CTAs.
2. Ask clarifying questions when helpful (vertical, aggressiveness, number of touches, audit link strategy).
3. When the user wants a draft, final prompt, or copy-paste instructions — output a complete workflowPrompt.

Respond with JSON only, no markdown fences:
{"reply":"2-5 sentences: coaching, brainstorm, or questions","workflowPrompt":null or "full plain-text GHL workflow setup document"}

Rules for workflowPrompt when present:
• Plain text, structured with section headers (TRIGGER, WAIT, MERGE FIELDS, STEP 1 EMAIL, etc.)
• Include exact email subject/body and SMS templates with merge tags
• Include SMS branch: only when AdHello SMS OK = Yes (or Mobile/VoIP)
• Include reply/stop rules
• Optional GHL AI email writer sub-prompt block
• Under ${MAX_PROMPT_LEN} characters
• Do NOT mention AdHello internal audit reports — use GHL audit widget or AdHello Audit Link
• Sign emails as the sender business from merge fields

Keep reply conversational during brainstorming. workflowPrompt null until user asks to generate/draft/finalize OR you have enough detail and they said "create it" / "write the prompt".`;
}

/**
 * @param {object} opts
 * @param {object} opts.workspace
 * @param {string} opts.userMessage
 * @param {Array<{role:string,content:string}>} [opts.chatHistory]
 * @param {string} [opts.senderOfferKey]
 */
async function runGhlWorkflowCoach({ workspace, userMessage, chatHistory, senderOfferKey }) {
  const msg = String(userMessage || '').trim();
  if (!msg) {
    return { success: false, error: 'Message is required.' };
  }

  const ctx = buildWorkspaceContext(workspace);
  const trimmedHistory = (Array.isArray(chatHistory) ? chatHistory : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));

  const messages = [{ role: 'system', content: buildSystemPrompt(ctx, senderOfferKey) }];
  for (const turn of trimmedHistory) {
    messages.push({ role: turn.role, content: turn.content });
  }
  messages.push({ role: 'user', content: msg.slice(0, MAX_USER_MSG) });

  const ai = await chatCompletion({
    messages,
    jsonObject: true,
    max_tokens: 2800,
    temperature: 0.5,
  });

  if (!ai.content || ai.error) {
    return {
      success: false,
      error: 'No AI provider configured (set OPENROUTER_API_KEY) or request failed.',
    };
  }

  const parsed = parseLlmJson(ai.content);
  if (!parsed) {
    return { success: false, error: 'Invalid AI response' };
  }

  const reply = typeof parsed.reply === 'string' ? parsed.reply.trim() : '';
  let workflowPrompt = parsed.workflowPrompt;
  if (workflowPrompt != null && typeof workflowPrompt !== 'string') workflowPrompt = null;
  if (workflowPrompt && workflowPrompt.length > MAX_PROMPT_LEN) {
    workflowPrompt = `${workflowPrompt.slice(0, MAX_PROMPT_LEN - 1)}…`;
  }

  return {
    success: true,
    reply: reply || 'Here is a direction to explore.',
    workflowPrompt: workflowPrompt && workflowPrompt.trim() ? workflowPrompt.trim() : null,
    provider: ai.provider || 'unknown',
  };
}

module.exports = {
  buildWorkspaceContext,
  buildSystemPrompt,
  runGhlWorkflowCoach,
};
