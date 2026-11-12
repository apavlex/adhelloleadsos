/**
 * Copy-paste prompt so AI Studio can build index + per-business pages
 * against this workspace's public directory APIs.
 *
 * Site URL / brand come from the workspace Directory settings (custom domain).
 * Never default to AdHello.io — each workspace publishes on its own site.
 */
function clean(v, max) {
  return String(v == null ? '' : v)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max || 400);
}

function originFromPageUrl(pageUrl) {
  const raw = clean(pageUrl, 400);
  if (!raw) return '';
  try {
    const u = new URL(raw.includes('://') ? raw : `https://${raw}`);
    return `${u.protocol}//${u.host}`;
  } catch {
    return raw
      .replace(/\/directory\/?$/i, '')
      .replace(/\/$/, '');
  }
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
  const site =
    clean(siteUrl, 200) ||
    '[SET LIVE DIRECTORY URL IN SEO → Directory — e.g. https://flooringquote.com]';
  const prefix = clean(pathPrefix, 80) || '/directory';
  const brand = clean(businessName, 120) || 'your brand';
  const title = clean(pageTitle, 160) || 'Local Business Directory';
  const feed = clean(feedUrl, 500);
  const detail =
    clean(detailUrlTemplate, 500) ||
    '[SAVE SETTINGS ON SEO → Directory TO GET DETAIL URL TEMPLATE]';
  const accent =
    clean(accentHint, 80) ||
    'match the existing site; if starting fresh use warm gold / tan on off-white cream (not purple)';
  const missingSite = site.startsWith('[');
  const siteLabel = missingSite ? 'your custom domain' : site;

  return `Build a public Local Business Directory for ${site}${missingSite ? '' : prefix} that matches the design system of the existing ${brand} website / AI Studio project (reuse that site’s header, nav, footer, fonts, and colors — do not use AdHello branding).

## Hosting / brand (required)
- This directory is published on the customer’s own site / custom domain (${siteLabel}), not on AdHello.io.
- Reuse the live ${brand} chrome. AdHello Leads OS only supplies the JSON feeds below.

## Pages (required)
1) Index — ${missingSite ? `${siteLabel}${prefix}` : `${site}${prefix}`}
   - H1: “${title}” (or brand-appropriate equivalent)
   - Short intro under it
   - Search + category/city filters (client-side OK on top of SSR list)
   - Grid/list of business cards from the feed: name, category, city/state, rating, short blurb, “View” link to ${prefix}/{slug}
2) Detail — ${missingSite ? `${siteLabel}${prefix}/{slug}` : `${site}${prefix}/{slug}`}
   - One page per published business
   - Name as H1, category, city/state, phone, website, rating/reviews, description/blurb
   - Keep the same site chrome as the index
   - 404 state when the slug is missing

## Data: Leads OS Directory API (required)
This site is a frontend only. Content is curated per workspace in Leads OS → SEO → Directory (each workspace has its own directory + publish token).

1) Index feed
   GET ${feed || '[SAVE SETTINGS ON SEO → Directory TO GET FEED URL]'}
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
- Enable Advanced SEO Support on the published AI Studio project with this workspace’s custom domain.
- Browser-only SPA rendering without HTML/JSON-LD will not rank well.

## Visual / UX
- Match the existing ${brand} site design; accent direction if starting fresh: ${accent}.
- Mobile-first cards, accessible links/buttons, no purple AI-slop theme unless the host brand already uses it.
- Do not hardcode sample businesses; always use the live feed.
- Do not brand the public pages as AdHello.

## Constraints
- Only show published businesses from the API.
- Do not invent phone/website/address fields that the API omits.
- If feed URLs are missing, still build the UI with clear TODO comments for the endpoints.

Deliver production-ready AI Studio pages (index + dynamic {slug} detail) that work on ${siteLabel}.`;
}

module.exports = { buildDirectoryPagePrompt, originFromPageUrl };
