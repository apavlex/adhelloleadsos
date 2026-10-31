/**
 * Copy-paste prompt so Cursor / a builder can recreate the TPR-style
 * community Q&A page on any site, wired to this workspace's public APIs.
 */
function clean(v, max) {
  return String(v == null ? '' : v)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max || 400);
}

function buildSeoQaPagePrompt({
  siteUrl,
  pagePath,
  businessName,
  pageTitle,
  categories,
  feedUrl,
  submitUrl,
  accentHint,
} = {}) {
  const site = clean(siteUrl, 200) || 'https://adhello.io';
  const path = clean(pagePath, 120) || '/questions';
  const brand = clean(businessName, 120) || 'Your Business';
  const title = clean(pageTitle, 160) || 'Questions & Answers';
  const cats = Array.isArray(categories) && categories.length
    ? categories.map((c) => clean(c, 80)).filter(Boolean)
    : ['General'];
  const feed = clean(feedUrl, 500);
  const submit = clean(submitUrl, 500);
  const accent = clean(accentHint, 80) || 'warm gold / tan accent on an off-white cream page (not purple)';

  return `Build a public Community Q&A page for ${site}${path} that matches the design language of https://tprflooring.com/flooring-questions, adapted for ${brand}.

## Visual / UX (match TPR closely)
- Clean, modern, minimal: off-white / light cream background, dark gray text, ${accent}.
- Keep the site’s existing header/nav/footer; only build the Q&A main content.
- Above the H1: two small pills — “Community Q&A” (active, accent fill + chat icon) and “Admin” (muted, lock icon — link to https://leads.adhello.io/seo-qa or hide if not staff).
- H1: “Ask the community & our team” (or brand-appropriate equivalent). Short intro under it.
- Ask form in a large white rounded card:
  - Your name (optional) — placeholder “Anonymous”
  - Category — select from: ${cats.join(', ')}
  - Your question * — textarea
  - Extra context (optional)
  - Accent “Post my question” button with send icon
- Below: search input + horizontal category filter pills (All + each category). All selected by default.
- Question cards:
  - Left: upvote affordance (can be visual-only if no vote API)
  - Category pill, Answered/Open state, author · relative time
  - Question as bold heading; optional italic context line
  - If answered: nested soft-cream answer block with star + “${brand}” label + answer text
  - Footer: comments count optional (0 comments OK)

## Data: AdHello Leads dashboard (required)
This page is a frontend only. Content is managed in Leads → SEO → Q&A Pages.

1) Load published Q&As
   GET ${feed || '[SAVE SETTINGS ON /seo-qa TO GET FEED URL]'}
   CORS is open. Response includes:
   - page: { title, business_name, page_url, categories }
   - questions: [{ id, question, context, category, author, answer, answer_by, answer_detail, published_at, … }]
   - faq_schema: FAQPage JSON-LD object
   - counts, seo_note

2) Visitor submit
   POST ${submit || '[SAVE SETTINGS ON /seo-qa TO GET SUBMIT URL]'}
   Content-Type: application/json
   Body: { "question": "...", "category": "...", "author": "...", "context": "..." }
   On success: show a thank-you state; new items appear in the Leads inbox to answer/publish/hide. Do NOT show unpublished answers on the public page.

## SEO (critical)
- Server-render or statically render question + answer HTML from the feed (not client-only paint).
- Inject feed.faq_schema as <script type="application/ld+json">…
- Use page title “${title}” and brand “${brand}”.
- Browser-only SPA rendering without HTML/JSON-LD will not rank well.

## Constraints
- Mobile-first, accessible forms/labels.
- No purple AI-slop theme; follow the cream + gold direction unless the host site already has a strong brand system — then match the host brand while keeping the same layout.
- Do not hardcode TPR Flooring content; use the live feed for ${brand}.
- If the feed URL is missing, still build the UI and leave clear TODO comments for the two endpoints.

Deliver a production-ready page (HTML/CSS/JS or the site’s stack) that works on ${site}.`;
}

module.exports = { buildSeoQaPagePrompt };
