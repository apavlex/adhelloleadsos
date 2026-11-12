/**
 * Copy-paste prompt so AI Studio can build index + per-business pages
 * against this workspace's public directory APIs.
 */
function clean(v, max) {
  return String(v == null ? '' : v)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max || 400);
}

function buildDirectoryPagePrompt({
  siteUrl,
  pathPrefix,
  businessName,
  pageTitle,
  feedUrl,
  detailUrlTemplate,
  accentHint,
} = {}) {
  const site = clean(siteUrl, 200) || 'https://adhello.io';
  const prefix = clean(pathPrefix, 80) || '/directory';
  const brand = clean(businessName, 120) || 'Your Business';
  const title = clean(pageTitle, 160) || 'Local Business Directory';
  const feed = clean(feedUrl, 500);
  const detail =
    clean(detailUrlTemplate, 500) ||
    '[SAVE SETTINGS ON /directory TO GET DETAIL URL TEMPLATE]';
  const accent = clean(accentHint, 80) || 'warm gold / tan accent on an off-white cream page (not purple)';

  return `Build a public Local Business Directory for ${site}${prefix} that matches the design system of the existing ${brand} AI Studio site (reuse header, nav, footer, fonts, and colors).

## Pages (required)
1) Index — ${site}${prefix}
   - H1: “${title}” (or brand-appropriate equivalent)
   - Short intro under it
   - Search + category/city filters (client-side OK on top of SSR list)
   - Grid/list of business cards from the feed: name, category, city/state, rating, short blurb, “View” link to ${prefix}/{slug}
2) Detail — ${site}${prefix}/{slug}
   - One page per published business
   - Name as H1, category, city/state, phone, website, rating/reviews, description/blurb
   - Keep the same site chrome as the index
   - 404 state when the slug is missing

## Data: AdHello Leads dashboard (required)
This site is a frontend only. Content is curated in Leads → SEO → Directory.

1) Index feed
   GET ${feed || '[SAVE SETTINGS ON /directory TO GET FEED URL]'}
   CORS is open. Response includes:
   - page: { title, business_name, page_url, path_prefix }
   - businesses: [{ slug, name, category, city, state, address, phone, website, rating, review_count, image_url, description, blurb, … }]
   - item_list_schema: ItemList JSON-LD object
   - counts, seo_note

2) Detail feed (per business)
   GET ${detail}
   Replace {slug} with the route param.
   Response includes:
   - business: { …same fields… }
   - local_business_schema: LocalBusiness JSON-LD object

## SEO (critical — AI Studio SSR)
- Use AI Studio SSR / server functions so HTML is rendered on the server (not client-only paint).
- Index: inject feed.item_list_schema as <script type="application/ld+json">…
- Detail: inject local_business_schema as <script type="application/ld+json">…
- Unique title/meta per detail page: “{name} · ${title}”.
- Enable Advanced SEO Support on the published AI Studio project with a custom domain.
- Browser-only SPA rendering without HTML/JSON-LD will not rank well.

## Visual / UX
- Match the existing ${brand} site design; accent direction if starting fresh: ${accent}.
- Mobile-first cards, accessible links/buttons, no purple AI-slop theme unless the host brand already uses it.
- Do not hardcode sample businesses; always use the live feed.

## Constraints
- Only show published businesses from the API.
- Do not invent phone/website/address fields that the API omits.
- If feed URLs are missing, still build the UI with clear TODO comments for the endpoints.

Deliver production-ready AI Studio pages (index + dynamic {slug} detail) that work on ${site}.`;
}

module.exports = { buildDirectoryPagePrompt };
