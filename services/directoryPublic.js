/**
 * Public feed + detail helpers for the business directory.
 */
const directoryStore = require('./directoryStore');

function publicListingView(row, settings = {}) {
  const showPhone = settings.showPhone !== false;
  const showWebsite = settings.showWebsite !== false;
  const showAddress = settings.showAddress !== false;
  const showRating = settings.showRating !== false;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: row.category || '',
    city: row.city || '',
    state: row.state || '',
    address: showAddress ? row.address || '' : '',
    phone: showPhone ? row.phone || '' : '',
    website: showWebsite ? row.website || '' : '',
    rating: showRating ? row.rating : null,
    review_count: showRating ? row.reviewCount : null,
    image_url: row.imageUrl || '',
    description: row.description || '',
    blurb: row.blurb || '',
    published_at: row.publishedAt || null,
  };
}

function buildItemListSchema(listings, pageUrl, pageTitle) {
  const elements = (Array.isArray(listings) ? listings : []).map((row, idx) => {
    const path = row.slug ? String(row.slug) : '';
    const itemUrl =
      pageUrl && path
        ? `${String(pageUrl).replace(/\/$/, '')}/${encodeURIComponent(path)}`
        : undefined;
    return {
      '@type': 'ListItem',
      position: idx + 1,
      name: row.name,
      ...(itemUrl ? { url: itemUrl } : {}),
    };
  });
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: pageTitle || 'Local Business Directory',
    ...(pageUrl ? { url: pageUrl } : {}),
    numberOfItems: elements.length,
    itemListElement: elements,
  };
}

function buildLocalBusinessSchema(row, pageUrl) {
  const url =
    pageUrl && row.slug
      ? `${String(pageUrl).replace(/\/$/, '')}/${encodeURIComponent(row.slug)}`
      : pageUrl || undefined;
  const image = row.imageUrl || row.image_url || '';
  const reviewCount =
    row.reviewCount != null
      ? row.reviewCount
      : row.review_count != null
        ? row.review_count
        : null;
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: row.name,
    ...(url ? { url } : {}),
    ...(row.website ? { sameAs: [row.website] } : {}),
    ...(row.phone ? { telephone: row.phone } : {}),
    ...(image ? { image } : {}),
    ...(row.description || row.blurb
      ? { description: row.blurb || row.description }
      : {}),
    ...(row.category ? { additionalType: row.category } : {}),
  };
  if (row.address || row.city || row.state) {
    schema.address = {
      '@type': 'PostalAddress',
      ...(row.address ? { streetAddress: row.address } : {}),
      ...(row.city ? { addressLocality: row.city } : {}),
      ...(row.state ? { addressRegion: row.state } : {}),
    };
  }
  if (row.rating != null && Number.isFinite(Number(row.rating))) {
    schema.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: Number(row.rating),
      ...(reviewCount != null ? { reviewCount: Number(reviewCount) } : {}),
    };
  }
  return schema;
}

async function loadByToken(token) {
  const workspaceId = await directoryStore.resolveWorkspaceIdByToken(token);
  if (!workspaceId) return null;
  const bundle = await directoryStore.ensurePublicToken(workspaceId);
  if (directoryStore.clean(bundle.settings.publicToken, 80) !== directoryStore.clean(token, 80)) {
    return null;
  }
  return { workspaceId, bundle };
}

async function getPublicFeed(token) {
  const resolved = await loadByToken(token);
  if (!resolved) {
    const err = new Error('Invalid or unknown publish token.');
    err.code = 'UNAUTHORIZED';
    throw err;
  }
  const { bundle } = resolved;
  const published = directoryStore.listListings(bundle, { published: true });
  const pageUrl = bundle.settings.pageUrl || '';
  const views = published.map((row) => publicListingView(row, bundle.settings));
  return {
    page: {
      title: bundle.settings.pageTitle || 'Local Business Directory',
      business_name: bundle.settings.businessName || '',
      page_url: pageUrl,
      path_prefix: bundle.settings.pathPrefix || '/directory',
    },
    businesses: views,
    item_list_schema: buildItemListSchema(views, pageUrl, bundle.settings.pageTitle),
    counts: {
      published: published.length,
      draft: directoryStore.inboxSummary(bundle).draft,
    },
    seo_note:
      'Render these businesses in HTML on your directory index and inject item_list_schema as JSON-LD. Each business detail page should load /businesses/{slug}.json and inject local_business_schema.',
  };
}

async function getPublicBusiness(token, slug) {
  const resolved = await loadByToken(token);
  if (!resolved) {
    const err = new Error('Invalid or unknown publish token.');
    err.code = 'UNAUTHORIZED';
    throw err;
  }
  const { bundle } = resolved;
  const row = directoryStore.findBySlug(bundle, slug);
  if (!row) {
    const err = new Error('Business not found.');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const pageUrl = bundle.settings.pageUrl || '';
  const view = publicListingView(row, bundle.settings);
  return {
    page: {
      title: bundle.settings.pageTitle || 'Local Business Directory',
      business_name: bundle.settings.businessName || '',
      page_url: pageUrl,
      path_prefix: bundle.settings.pathPrefix || '/directory',
    },
    business: view,
    local_business_schema: buildLocalBusinessSchema(view, pageUrl),
    seo_note:
      'Render this business in HTML and inject local_business_schema as JSON-LD on the detail page.',
  };
}

module.exports = {
  publicListingView,
  buildItemListSchema,
  buildLocalBusinessSchema,
  getPublicFeed,
  getPublicBusiness,
};
