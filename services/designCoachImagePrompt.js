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
  return [
    `Professional ${platLabel || 'social'} ad, ${aspectRatio || '16:9'} aspect ratio.`,
    `Creative direction from the marketer: ${direction}`,
    headline ? `Headline concept: ${headline}` : '',
    bodyText ? `Supporting copy: ${bodyText}` : '',
    kit && kit !== '(no business info set yet)' ? `Business details to include where relevant:\n${kit}` : '',
    'Sharp typography, clean hierarchy, mobile-readable text, no watermark, no invented logos.',
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 3500);
}

module.exports = {
  isUnusableDesignImagePrompt,
  sanitizeDesignImagePrompt,
  userAskedForDesign,
  buildFallbackDesignImagePrompt,
};
