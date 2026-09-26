/**
 * Keep Marketing Studio design-chat drafts usable for GPT Image 2.
 * Models sometimes copy the system-prompt JSON field instructions into imagePrompt.
 */

function isUnusableDesignImagePrompt(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) return true;
  if (/^(null|undefined|none)$/i.test(text)) return true;
  if (/null if still exploring/i.test(text)) return true;
  if (/null or a detailed english prompt/i.test(text)) return true;
  if (/ready for gpt image/i.test(text) && /specify platform/i.test(text)) return true;
  if (/typography zones/i.test(text) && /brand colors,\s*mood/i.test(text)) return true;
  if (/^null\b/i.test(text) && /detailed english prompt/i.test(text)) return true;
  return false;
}

function sanitizeDesignImagePrompt(raw) {
  const text = String(raw == null ? '' : raw).trim();
  return isUnusableDesignImagePrompt(text) ? '' : text;
}

function userAskedForDesign(message) {
  const text = String(message || '').trim();
  if (text.length < 12) return false;
  return /\b(make|create|generate|design|draft|build)\b.{0,40}\b(ad|post|cover|banner|graphic|creative|image|prompt|postcard|flyer)\b/i.test(
    text,
  )
    || /\b(make|create|generate|design)\b.{0,20}\b(me|a|an|the)\b/i.test(text)
    || /\b(facebook cover|instagram|linkedin|google business|postcard)\b/i.test(text);
}

/**
 * Enough visual direction to write a production imagePrompt (vs industry-only briefs).
 */
function hasRichCreativeDirection(message) {
  const text = String(message || '').trim();
  if (text.length < 40) return false;

  const signals = [
    /#[0-9a-f]{3,8}\b/i,
    /\b(navy|amber|gold|cream|charcoal|slate|teal|coral|burgundy|forest|olive|ivory|black|white|orange|blue|green|red|yellow|purple|pink|brown|beige|copper|bronze|silver)\b.{0,30}\b(and|with|accent|palette|color|colour|tone)/i,
    /\b(color|colour|palette|hex)\b/i,
    /\b(photo|photograph|photography|photoreal|realistic|cinematic|aerial|drone|lifestyle|studio|close[- ]?up|macro|editorial)\b/i,
    /\b(illustration|illustrated|flat design|3d|render|vector|collage|watercolor|line art)\b/i,
    /\b(mood|vibe|aesthetic|look(?:ing)?|feel|tone)\b.{0,40}\b(warm|cool|bold|dark|bright|premium|trust|modern|rustic|clean|gritty|lux)/i,
    /\b(headline|tagline|copy|say|text|reads?|words?)\b.{0,60}["“']/i,
    /["“'][^"”']{8,}["”']/,
    /\b(left|right|center|centre|top|bottom|split|overlay|gradient|full[- ]?bleed|hero|safe zone|margin)\b.{0,40}\b(text|copy|photo|image|panel|half)/i,
    /\b(sans[- ]?serif|serif|bold type|typography|kerning|all[- ]?caps)\b/i,
    /\b(golden hour|blue hour|soft light|hard light|natural light|dusk|dawn)\b/i,
    /\b(worker|crew|homeowner|family|technician|van|truck|storefront|kitchen|bathroom|job site)\b/i,
  ];

  let hits = 0;
  for (const re of signals) {
    if (re.test(text)) hits += 1;
  }

  // Long briefs with concrete nouns + at least one visual signal count as rich.
  if (hits >= 2) return true;
  if (hits >= 1 && text.length >= 120) return true;
  return false;
}

/**
 * Format + industry only — coach should ask clarifying questions, not dump a template prompt.
 */
function isVagueDesignBrief(message) {
  const text = String(message || '').trim();
  if (!text) return true;
  if (hasRichCreativeDirection(text)) return false;
  if (userAskedForDesign(text)) return true;
  // Short direction without visual specifics
  if (text.length < 100 && !/\b(color|photo|illustration|mood|headline|layout)\b/i.test(text)) {
    return true;
  }
  return false;
}

/** Model chain-of-thought / meta instructions leaking into the chat reply. */
function isDesignCoachReasoningLeak(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) return false;
  if (/need (obey|valid )?json|respond json|json only|escaped\.|developer (role|user|content)|system prompt|imagePrompt null|must null and ask/i.test(text)) {
    return true;
  }
  if (/we (need|should|must)\b.{0,40}\b(json|null|ask)/i.test(text) && /photo vs illustration|palette|headline/i.test(text)) {
    return true;
  }
  if (/\b(chain of thought|reasoning|thinking out loud)\b/i.test(text)) return true;
  // Dense meta prose without a normal marketer-facing greeting/question shape
  const looksLikeQuestions = /\b(1\.|2\.|do you prefer|what colors|what(?:'s| is) the)\b/i.test(text);
  const looksLikeMeta =
    /\b(we need|need obey|ensure no|since brief|perhaps concise|no markdown)\b/i.test(text);
  if (looksLikeMeta && !looksLikeQuestions) return true;
  if (looksLikeMeta && text.length > 280 && (text.match(/\?/g) || []).length < 2) return true;
  return false;
}

function sanitizeDesignCoachReply(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) return '';
  if (isDesignCoachReasoningLeak(text)) return '';
  if (/^\{[\s\S]*"reply"\s*:/i.test(text)) return '';
  return text;
}

/**
 * Multi-line clarifying reply for chat (newlines render as <br> in the UI).
 */
function formatDesignCoachClarifyReply(opts = {}) {
  const plat = String(opts.platformLabel || 'ad').trim() || 'ad';
  return [
    `Happy to help with your ${plat}.`,
    '',
    'A few quick questions so I can write a strong prompt:',
    '',
    '1. Photo, illustration, or mixed?',
    '2. Main colors or brand palette?',
    '3. What’s the headline/hook — and who or what should be the hero in the shot?',
    '',
    'Reply here, or say “just draft it” and I’ll pick a strong direction.',
  ].join('\n');
}

/** Turn single-line "1. … 2. … 3. …" replies into readable multi-line chat text. */
function formatDesignCoachReplyForDisplay(raw) {
  let text = sanitizeDesignCoachReply(raw);
  if (!text) return '';

  // Normalize escaped newlines from JSON
  text = text.replace(/\\n/g, '\n');

  // Put numbered items on their own lines when jammed into one paragraph
  if (!/\n\s*\d+\.\s/.test(text) && /(?:^|\s)1\.\s/.test(text) && /\s2\.\s/.test(text)) {
    text = text.replace(/(?:^|\s+)(\d+)\.\s+/g, '\n$1. ');
  }

  // Blank line before a numbered list when it follows a colon
  text = text.replace(/:\s*\n(\d+)\.\s/g, ':\n\n$1. ');

  // Collapse excess blank lines
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return text;
}

/** True when the chat reply tells the user a draft prompt is ready (must pair with imagePrompt). */
function replyClaimsDraftReady(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) return false;
  return (
    /locking that look/i.test(text) ||
    /drafted an optimized (image )?prompt/i.test(text) ||
    /draft (image )?prompt is ready/i.test(text) ||
    /optimized image prompt from your direction/i.test(text) ||
    (/prompt (?:is )?ready/i.test(text) && /edit (?:it )?in Prompt/i.test(text))
  );
}

/** User wants to refine caption / headline / post text (not the image prompt yet). */
function userWantsCopyRefine(message) {
  const text = String(message || '').trim();
  if (!text) return false;
  if (
    /\b(image prompt|visual prompt|draft (the )?(image )?prompt|photo[- ]?real|illustration style|generate (the )?image)\b/i.test(
      text,
    )
  ) {
    // Mixed: copy + image — treat as copy refine only if copy words dominate and they didn't ask to draft prompt
    if (!/\b(copy|caption|headline|hook|post text|wording|rewrite|rephrase)\b/i.test(text)) {
      return false;
    }
    if (/\b(draft (the )?(image )?prompt|write (the )?prompt|ready for (the )?(image|prompt))\b/i.test(text)) {
      return false;
    }
  }
  return (
    /\b(copy|caption|headline|hook|post text|wording|rewrite|rephrase|punchier|shorter|longer|soften|tone|cta text|opening line|first line)\b/i.test(
      text,
    ) ||
    /\b(make (it|the) (copy|caption|headline|post)\b)/i.test(text) ||
    /\b(improve|tweak|fix|edit|change)\b.{0,40}\b(copy|caption|headline|post)\b/i.test(text)
  );
}

/** User explicitly wants the image prompt drafted now. */
function userAsksForImagePromptDraft(message) {
  const text = String(message || '').trim();
  if (!text) return false;
  return (
    /\b(just draft|draft it|best judgment|surprise me|use your (best )?judgment|skip (the )?questions|go ahead and (draft|write)|enough —?\s*draft)\b/i.test(
      text,
    ) ||
    /\b(draft (the )?(image )?prompt|write (the )?(image )?prompt|ready for (the )?(image|prompt|visual)|lock(ing)? (in )?the look|image (prompt )?now|visual prompt)\b/i.test(
      text,
    )
  );
}

function sanitizePostCopyField(raw, maxLen = 4000) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) return '';
  if (/^(null|undefined|none)$/i.test(text)) return '';
  if (/null if still exploring|null or a detailed/i.test(text)) return '';
  return text.slice(0, maxLen);
}

function buildFallbackDesignImagePrompt({
  userMessage,
  platformLabel: platLabel,
  aspectRatio,
  headline,
  bodyText,
  brandKitSummary: kitSummary,
}) {
  const direction = String(userMessage || '').trim();
  if (!direction) return '';
  const kit = String(kitSummary || '').trim();
  const plat = platLabel || 'social';
  const ratio = aspectRatio || '16:9';

  return [
    `Production-ready ${plat} creative, ${ratio} aspect ratio.`,
    'Art direction: premium local-business marketing — one dominant photographic hero, clear visual hierarchy, generous breathing room, no cluttered icon rows or stock-collage grids.',
    `Marketer brief (interpret into concrete visuals, do not paste as on-image copy unless it reads like a headline): ${direction}`,
    headline ? `Primary headline idea: ${headline}` : 'Invent one short, punchy benefit headline suited to the brief (8 words or fewer).',
    bodyText ? `Supporting line: ${bodyText}` : 'Optional one short supporting line under the headline; keep it secondary.',
    kit && kit !== '(no business info set yet)'
      ? `Business details — place contact info in a clean footer or corner block where format allows:\n${kit}`
      : '',
    'Typography: bold modern sans for the headline, high contrast against the photo (subtle dark gradient or soft panel behind text if needed). Mobile-readable. No watermarks, no fake logos, no UI chrome.',
    'Lighting and finish: natural, trustworthy, slightly elevated commercial photography — sharp focus on the hero subject, soft depth of field on background.',
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 3500);
}

module.exports = {
  isUnusableDesignImagePrompt,
  sanitizeDesignImagePrompt,
  userAskedForDesign,
  hasRichCreativeDirection,
  isVagueDesignBrief,
  isDesignCoachReasoningLeak,
  sanitizeDesignCoachReply,
  formatDesignCoachClarifyReply,
  formatDesignCoachReplyForDisplay,
  replyClaimsDraftReady,
  userWantsCopyRefine,
  userAsksForImagePromptDraft,
  sanitizePostCopyField,
  buildFallbackDesignImagePrompt,
};
