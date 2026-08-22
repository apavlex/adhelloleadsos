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
const MAX_OPTIMIZE_USER_MSG = 12_000;
const MAX_PROMPT_LEN = 24_000;

/** Detect vertical + CTA style from folder goal / sender offer so optimize stays on-message. */
function inferFolderOutreachIntent(ghlGoal, focusOffer) {
  const goal = String(ghlGoal || '').trim();
  const g = goal.toLowerCase();
  const offerBits = [
    focusOffer && focusOffer.label,
    focusOffer && focusOffer.vertical,
    focusOffer && focusOffer.senderBusinessName,
    focusOffer && focusOffer.pitch,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const hay = `${g} ${offerBits}`;

  const wantsSpecials =
    /\b(weekly\s+specials?|specials?\s+list|price\s+list|catalog|wholesale)\b/i.test(hay);
  const wantsEstimates = /\b(estimate|book(ed)?\s+(a\s+)?(job|estimate|install)|in-?home)\b/i.test(
    hay,
  );
  const wantsAuditCta =
    /\b(audit|site\s+scan|website\s+scan|page\s*speed|seo|google\s+visibility)\b/i.test(g);

  let vertical = 'general';
  let label = 'this business';
  if (/\b(floor(ing)?|cabinet|countertop|hardwood|laminate|vinyl|tile|carpet)\b/i.test(hay)) {
    vertical = 'flooring';
    label = 'flooring / cabinets / countertops';
  } else if (/\b(review|reputation|google\s+review)\b/i.test(hay)) {
    vertical = 'reviews';
    label = 'reviews / reputation';
  } else if (/\b(electric|plumber|hvac|roof|landscap|contractor|home\s+service)\b/i.test(hay)) {
    vertical = 'trades';
    label = 'local trade / home services';
  } else if (/\b(market(ing)?|agency|adhello|seo|ads?\s+consult)\b/i.test(hay)) {
    vertical = 'marketing';
    label = 'marketing / consulting';
  } else if (focusOffer && focusOffer.vertical) {
    vertical = 'custom';
    label = String(focusOffer.vertical).trim();
  }

  let ctaStyle = 'conversation';
  if (wantsSpecials) ctaStyle = 'specials_list';
  else if (wantsEstimates) ctaStyle = 'book_estimate';
  else if (wantsAuditCta) ctaStyle = 'audit_link';
  else if (vertical === 'marketing') ctaStyle = 'audit_link';

  return {
    vertical,
    label,
    ctaStyle,
    goal,
    forbidGenericOnlinePitch: vertical === 'flooring' || ctaStyle === 'specials_list',
    forbidOtherVerticalExamples: vertical !== 'general' && vertical !== 'marketing',
  };
}

function intentCtaGuidance(intent) {
  switch (intent.ctaStyle) {
    case 'specials_list':
      return 'Primary CTA: get them interested in receiving the weekly specials / wholesale price list (reply YES, text list, or short form). Do NOT lead with a website audit or “improve online” scan unless the goal explicitly asks for that.';
    case 'book_estimate':
      return 'Primary CTA: book an estimate / showroom visit / measure. Soft secondary link only if useful.';
    case 'audit_link':
      return 'Primary CTA: free scan / demo via {{custom_field.AdHello Audit Link}} or [GHL AUDIT LINK].';
    default:
      return 'Primary CTA must mirror the outreach goal literally. Prefer a reply-based ask over a generic website audit.';
  }
}

function promptLooksOffGoal(workflowPrompt, intent) {
  const text = String(workflowPrompt || '');
  if (!text.trim() || !intent) return true;
  const lower = text.toLowerCase();
  if (intent.forbidGenericOnlinePitch) {
    if (/may have room to improve online/i.test(text)) return true;
    if (/free quick scan/i.test(text) && intent.ctaStyle === 'specials_list') return true;
    if (/adhello consulting/i.test(text) && intent.vertical === 'flooring') return true;
    if (/reviews app variant/i.test(text) && intent.vertical === 'flooring') return true;
  }
  if (intent.vertical === 'flooring') {
    if (!/\bfloor/i.test(lower) && !/\bcabinet/i.test(lower) && !/\bcountertop/i.test(lower)) {
      return true;
    }
  }
  if (intent.ctaStyle === 'specials_list' && !/\b(special|wholesale|price\s*list|catalog)\b/i.test(lower)) {
    return true;
  }
  return false;
}

/**
 * Deterministic goal-aligned GHL setup prompt (used when AI drifts back to generic agency copy).
 */
function buildGoalAlignedWorkflowPrompt({ folderName, ghlGoal, focusOffer, intent }) {
  const folder = String(folderName || '').trim() || 'this folder';
  const goal = String(ghlGoal || '').trim();
  const senderName =
    (focusOffer && (focusOffer.senderBusinessName || focusOffer.label)) ||
    '{{custom_field.AdHello Sender Business}}';
  const verticalLabel =
    (focusOffer && focusOffer.vertical) || intent.label || 'your vertical';
  const pitchHint =
    (focusOffer && focusOffer.pitch) ||
    '{{custom_field.AdHello Sender Pitch}}';

  let emailHook;
  let emailCta;
  let smsBody;
  let aiWriter;
  if (intent.ctaStyle === 'specials_list' && intent.vertical === 'flooring') {
    emailHook = `I'm with {{custom_field.AdHello Sender Business}}. We supply flooring, cabinets, and countertops at wholesale pricing for shops and contractors in {{contact.city}}.

I put together this week's specials and thought {{contact.company_name}} might want the list — materials and packages change weekly.`;
    emailCta = `Reply YES (or SPECIALS) and I'll send the weekly specials list.
If you prefer, tell me whether you care more about flooring, cabinets, or countertops and I'll tailor it.`;
    smsBody = `Hi {{contact.first_name}} — {{custom_field.AdHello Sender Business}} here. Wholesale flooring/cabinets/countertops specials this week for {{contact.company_name}}. Reply YES for the list.`;
    aiWriter = `"Write a short cold email under 100 words from a wholesale flooring / cabinets / countertops supplier ({{custom_field.AdHello Sender Business}}) to {{contact.company_name}} in {{contact.city}}. Goal: spark interest in this week's specials list — not a website audit. Warm trade tone. Ask them to reply YES for the list. Sign as [Your name] + {{custom_field.AdHello Sender Business}}."`;
  } else if (intent.vertical === 'flooring') {
    emailHook = `I'm with {{custom_field.AdHello Sender Business}} (${verticalLabel}). I work with flooring pros in {{contact.city}} and wanted to reach out to {{contact.company_name}}.

{{custom_field.AdHello Sender Pitch}}`;
    emailCta =
      intent.ctaStyle === 'book_estimate'
        ? 'If helpful, reply and we can book a quick estimate / measure conversation.'
        : 'If this is useful, reply and tell me the best next step for your shop.';
    smsBody = `Hi {{contact.first_name}} — {{custom_field.AdHello Sender Business}} here about flooring for {{contact.company_name}} in {{contact.city}}. {{custom_field.AdHello Sender Pitch}} Reply YES if you want details.`;
    aiWriter = `"Write under 90 words to {{contact.company_name}} in {{contact.city}} as {{custom_field.AdHello Sender Business}} (flooring). Goal: ${goal.slice(0, 180)}. No generic 'improve online' pitch unless the goal is SEO/audit. Sign with [Your name] and sender business."`;
  } else {
    emailHook = `I'm with {{custom_field.AdHello Sender Business}}. Reaching out about {{contact.company_name}} in {{contact.city}}.

Goal for this folder: ${goal}

{{custom_field.AdHello Sender Pitch}}`;
    emailCta =
      intent.ctaStyle === 'audit_link'
        ? 'Here is a free quick scan — no signup required:\n{{custom_field.AdHello Audit Link}}\n(If blank, use [GHL AUDIT LINK])'
        : 'If useful, reply and I can share the next step.';
    smsBody = `Hi {{contact.first_name}} — {{custom_field.AdHello Sender Business}} here for {{contact.company_name}} in {{contact.city}}. ${goal.slice(0, 120)} Reply YES for details.`;
    aiWriter = `"Write under 100 words as {{custom_field.AdHello Sender Business}} to {{contact.company_name}} in {{contact.city}}. Folder goal: ${goal.slice(0, 200)}. Use {{custom_field.AdHello Sender Pitch}}. Match the goal's CTA — do not default to a website audit unless the goal asks for it."`;
  }

  return [
    'Set up a Go High Level automation workflow for cold outreach when AdHello / Agency OS enrolls a lead.',
    '',
    `Folder: ${folder}`,
    `Outreach goal (optimize every message toward this): ${goal}`,
    `Primary vertical: ${verticalLabel}`,
    focusOffer
      ? `Sender profile: ${senderName}${focusOffer.key ? ` (offer key: ${focusOffer.key})` : ''}`
      : 'Sender profile: use synced AdHello Sender * merge fields on enroll',
    '',
    'GHL must sound like THIS business — not a generic multi-vertical agency blast. Do not keep reviews-app or AdHello-consulting example blocks as primary copy unless that is the goal.',
    '',
    '═══════════════════════════════════════',
    'TRIGGER',
    '═══════════════════════════════════════',
    '• Workflow type: Contact tag added',
    '• Tag name (exact): auto-outreach',
    '• Run once per contact when tag is first added',
    '',
    '═══════════════════════════════════════',
    'WAIT (important)',
    '═══════════════════════════════════════',
    '• Wait 2 minutes after trigger',
    '  (AdHello syncs contact + sender custom fields first)',
    '',
    '═══════════════════════════════════════',
    'MERGE FIELDS',
    '═══════════════════════════════════════',
    'Prospect: {{contact.company_name}}, {{contact.first_name}}, {{contact.city}}, {{contact.state}}, {{contact.website}}, {{contact.phone}}',
    'Signals: AdHello Google Rating, AdHello Google Reviews, AdHello Phone Line Type, AdHello SMS OK',
    'Sender: AdHello Sender Business, AdHello Sender Vertical, AdHello Sender Offer, AdHello Sender Pitch, AdHello Audit Link',
    '',
    `CTA guidance: ${intentCtaGuidance(intent)}`,
    '',
    '═══════════════════════════════════════',
    'STEP 1 — DAY 0 EMAIL',
    '═══════════════════════════════════════',
    'Subject:',
    intent.ctaStyle === 'specials_list'
      ? '{{contact.first_name}} — this week\'s flooring specials for {{contact.company_name}}?'
      : '{{contact.first_name}}, quick note for {{contact.company_name}} in {{contact.city}}',
    '',
    'Body:',
    `Hi {{contact.first_name}},`,
    '',
    emailHook,
    '',
    emailCta,
    '',
    'Best,',
    '[Your name]',
    '{{custom_field.AdHello Sender Business}}',
    '',
    'Pitch reference from Agency OS offer (also available as merge field):',
    pitchHint,
    '',
    '═══════════════════════════════════════',
    'STEP 2 — WAIT 2 DAYS',
    '═══════════════════════════════════════',
    '',
    '═══════════════════════════════════════',
    'STEP 3 — DAY 3 SMS (mobile only)',
    '═══════════════════════════════════════',
    'IF AdHello SMS OK = Yes OR Phone Line Type is Mobile/VoIP; skip Landline.',
    '',
    'SMS:',
    smsBody,
    '',
    '═══════════════════════════════════════',
    'STEP 4 — DAY 5 VOICEMAIL / RVM (optional)',
    '═══════════════════════════════════════',
    `"Hi, this is [Your name] with {{custom_field.AdHello Sender Business}}. I emailed {{contact.company_name}} in {{contact.city}} about ${goal.slice(0, 100)}. Happy to send details if you reply."`,
    '',
    '═══════════════════════════════════════',
    'REPLY & STOP RULES',
    '═══════════════════════════════════════',
    '• If contact replies → remove from workflow, notify owner',
    '• Max 1 email + 1 SMS in first 7 days unless they engage',
    '• Sign as {{custom_field.AdHello Sender Business}}',
    '• Do NOT mention AdHello internal audit reports',
    '',
    '═══════════════════════════════════════',
    'GHL AI EMAIL WRITER PROMPT',
    '═══════════════════════════════════════',
    aiWriter,
  ].join('\n');
}

function buildWorkspaceContext(workspace) {
  const ws = workspace && typeof workspace === 'object' ? workspace : {};
  const { catalog, library } = workspaceSalesScripts.buildWorkspaceOfferLibrary(ws, SCRIPT_LIBRARY);
  const brandName = String((ws.brandKit && ws.brandKit.businessName) || '').trim();
  const autoPool = ws.prospecting && ws.prospecting.autoPool ? ws.prospecting.autoPool : {};
  const bp = ws.acquisitionBlueprint && typeof ws.acquisitionBlueprint === 'object' ? ws.acquisitionBlueprint : null;
  const bpDraft = bp && bp.draft && typeof bp.draft === 'object' ? bp.draft : null;

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
    acquisitionBlueprint: bpDraft
      ? {
          sourceUrl: String(bp.sourceUrl || '').trim(),
          appliedAt: String(bp.appliedAt || '').trim(),
          businessName: String(bpDraft.businessName || '').trim(),
          vertical: String(bpDraft.vertical || '').trim(),
          ghlGoal: String(bpDraft.ghlGoal || bpDraft.primaryGoal || '').trim(),
          strategySummary: String(bpDraft.strategySummary || '').trim().slice(0, 600),
          offerName: String(bpDraft.offerName || '').trim(),
        }
      : null,
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
${
  ctx.acquisitionBlueprint
    ? `
Acquisition Blueprint (owner GTM — align workflows to this, not generic agency audit pitches):
• URL: ${ctx.acquisitionBlueprint.sourceUrl || '(n/a)'}
• Business: ${ctx.acquisitionBlueprint.businessName || '(n/a)'}
• Vertical: ${ctx.acquisitionBlueprint.vertical || '(n/a)'}
• GHL goal: ${ctx.acquisitionBlueprint.ghlGoal || '(n/a)'}
• Offer: ${ctx.acquisitionBlueprint.offerName || '(n/a)'}
• Strategy: ${ctx.acquisitionBlueprint.strategySummary || '(n/a)'}
`
    : ''
}

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
async function runGhlWorkflowCoach({ workspace, userMessage, chatHistory, senderOfferKey, integrationEnv }) {
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
    integrationEnv,
  });

  if (!ai.content || ai.error) {
    return {
      success: false,
      error: 'No AI provider configured (add OpenRouter in Workspace → Integrations) or request failed.',
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

function buildFolderOptimizerSystemPrompt(ctx, { folderName, senderOfferKey, ghlGoal, intent }) {
  const focusOffer = senderOfferKey
    ? ctx.offers.find((o) => o.key === senderOfferKey)
    : null;
  const focusLine = focusOffer
    ? `Sender profile for this folder: ${focusOffer.label} (${focusOffer.key})${focusOffer.vertical ? ` · vertical ${focusOffer.vertical}` : ''}.`
    : 'No specific sender profile — still write as ONE business matching the outreach goal (use merge fields).';
  const inferred = intent || inferFolderOutreachIntent(ghlGoal, focusOffer);

  return `You write Go High Level (GHL) auto-outreach workflow setup documents for ONE folder.

This is NOT a multi-business encyclopedia. Produce a single-vertical workflow that matches the outreach goal.

TRIGGER (fixed — never change):
• Workflow type: Contact tag added
• Tag name (exact): auto-outreach
• Wait 2 minutes after trigger

PROSPECT merge fields: {{contact.company_name}}, {{contact.first_name}}, {{contact.city}}, {{contact.state}}, {{contact.website}}, {{contact.phone}}, AdHello Google Rating/Reviews, AdHello Phone Line Type, AdHello SMS OK

SENDER merge fields: {{custom_field.AdHello Sender Business}}, {{custom_field.AdHello Sender Vertical}}, {{custom_field.AdHello Sender Offer}}, {{custom_field.AdHello Sender Pitch}}, {{custom_field.AdHello Audit Link}}

Workspace brand: ${ctx.brandName || '(not set)'}
Folder: ${String(folderName || '').trim() || '(unnamed folder)'}
Outreach goal (MANDATORY — every email/SMS/CTA must serve this): ${String(ghlGoal || '').trim()}
Inferred vertical: ${inferred.label} (${inferred.vertical})
CTA style: ${inferred.ctaStyle}
${intentCtaGuidance(inferred)}
${focusLine}

Configured business profiles (context only — do not invent extra verticals):
${formatOffersForPrompt(ctx)}

HARD RULES:
• Do NOT keep "may have room to improve online" or "free quick scan" as the primary Day 0 email unless CTA style is audit_link.
• Do NOT include Reviews App / AdHello Consulting example blocks when vertical is flooring (or any single non-marketing vertical).
• Do NOT paste a generic multi-business template. Write fresh copy for THIS goal.
• Keep merge tags exact. Plain text with TRIGGER / WAIT / MERGE FIELDS / STEP sections.
• SMS only when AdHello SMS OK = Yes (or Mobile/VoIP).
• Under ${MAX_PROMPT_LEN} characters.

Respond with JSON only, no markdown fences:
{"workflowPrompt":"complete plain-text GHL workflow setup document"}`;
}

function buildFolderOptimizerUserPrompt({ ghlGoal, folderName, focusOffer, intent, structureHint }) {
  const goal = String(ghlGoal || '').trim();
  const folder = String(folderName || '').trim() || 'this folder';
  const inferred = intent || inferFolderOutreachIntent(ghlGoal, focusOffer);
  const hint = String(structureHint || '').trim().slice(0, 1200);
  return `Create a GHL auto-outreach workflow setup prompt for folder "${folder}".

OUTREACH GOAL (primary source of truth — rewrite all copy toward this):
${goal}

Vertical focus: ${inferred.label}
CTA requirement: ${intentCtaGuidance(inferred)}
${
  focusOffer
    ? `Sender offer: ${focusOffer.label}${focusOffer.vertical ? ` (${focusOffer.vertical})` : ''}${focusOffer.pitch ? `\nOffer pitch: ${focusOffer.pitch}` : ''}`
    : 'Sender offer: use AdHello Sender * merge fields'
}

Write a complete setup document (trigger, wait, merge fields, day-0 email, wait, SMS branch, optional RVM, stop rules, GHL AI writer prompt).
${hint ? `\nOptional structure hint (do not copy wrong-vertical examples):\n${hint}` : ''}`;
}

/**
 * @param {object} opts
 * @param {object} opts.workspace
 * @param {string} opts.folderName
 * @param {string} [opts.folderKey]
 * @param {string} opts.ghlGoal
 * @param {string} [opts.senderOfferKey]
 * @param {string} [opts.basePrompt]
 */
async function optimizeFolderGhlWorkflowPrompt({
  workspace,
  folderName,
  folderKey,
  ghlGoal,
  senderOfferKey,
  basePrompt,
  integrationEnv,
}) {
  const goal = String(ghlGoal || '').trim();
  if (!goal) {
    return { success: false, error: 'Outreach goal is required.' };
  }

  const ctx = buildWorkspaceContext(workspace);
  const focusOffer = senderOfferKey
    ? ctx.offers.find((o) => o.key === senderOfferKey) || null
    : null;
  const intent = inferFolderOutreachIntent(goal, focusOffer);

  const deterministic = buildGoalAlignedWorkflowPrompt({
    folderName,
    ghlGoal: goal,
    focusOffer,
    intent,
  });

  const system = buildFolderOptimizerSystemPrompt(ctx, {
    folderName,
    senderOfferKey,
    ghlGoal: goal,
    intent,
  });
  const user = buildFolderOptimizerUserPrompt({
    ghlGoal: goal,
    folderName,
    focusOffer,
    intent,
    // Do not feed the full multi-vertical base prompt — it anchors the model to agency copy.
    structureHint: String(basePrompt || '').trim().slice(0, 900),
  });

  const ai = await chatCompletion({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user.slice(0, MAX_OPTIMIZE_USER_MSG) },
    ],
    jsonObject: true,
    max_tokens: 3600,
    temperature: 0.35,
    integrationEnv,
  });

  if (!ai.content || ai.error) {
    return {
      success: true,
      workflowPrompt: deterministic,
      folderKey: String(folderKey || '').trim(),
      provider: 'deterministic_fallback',
      usedFallback: true,
      warning:
        'No AI provider configured or request failed — used goal-aligned template. Add OpenRouter under Integrations for AI rewrites.',
    };
  }

  const parsed = parseLlmJson(ai.content);
  let workflowPrompt = parsed && typeof parsed.workflowPrompt === 'string' ? parsed.workflowPrompt : null;
  if (workflowPrompt && workflowPrompt.length > MAX_PROMPT_LEN) {
    workflowPrompt = `${workflowPrompt.slice(0, MAX_PROMPT_LEN - 1)}…`;
  }

  if (!workflowPrompt || !workflowPrompt.trim() || promptLooksOffGoal(workflowPrompt, intent)) {
    return {
      success: true,
      workflowPrompt: deterministic,
      folderKey: String(folderKey || '').trim(),
      provider: ai.provider || 'unknown',
      usedFallback: true,
      warning: 'AI output was too generic for this goal — replaced with a goal-aligned flooring/business template.',
    };
  }

  return {
    success: true,
    workflowPrompt: workflowPrompt.trim(),
    folderKey: String(folderKey || '').trim(),
    provider: ai.provider || 'unknown',
    usedFallback: false,
  };
}

module.exports = {
  buildWorkspaceContext,
  buildSystemPrompt,
  buildFolderOptimizerSystemPrompt,
  buildFolderOptimizerUserPrompt,
  inferFolderOutreachIntent,
  promptLooksOffGoal,
  buildGoalAlignedWorkflowPrompt,
  runGhlWorkflowCoach,
  optimizeFolderGhlWorkflowPrompt,
};
