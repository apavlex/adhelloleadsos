(function () {
  function parsePrice(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const n = parseInt(String(value).replace(/[^\d]/g, ''), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function parseNumber(value) {
    if (value == null || value === '') return null;
    const n = parseFloat(String(value).replace(/[^\d.]/g, ''));
    return Number.isFinite(n) ? n : null;
  }

  function meta(prop) {
    const el = document.querySelector(`meta[property="${prop}"], meta[name="${prop}"]`);
    return el?.content?.trim() || '';
  }

  function flattenJsonLd(node, out) {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach((n) => flattenJsonLd(n, out));
      return;
    }
    if (typeof node !== 'object') return;
    out.push(node);
    if (node['@graph']) flattenJsonLd(node['@graph'], out);
  }

  function findListingJsonLd() {
    const types = new Set([
      'RealEstateListing',
      'SingleFamilyResidence',
      'Apartment',
      'House',
      'Product',
      'Offer',
      'Vehicle',
      'Residence',
    ]);
    const nodes = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
      try {
        flattenJsonLd(JSON.parse(s.textContent), nodes);
      } catch (_) {
        /* ignore */
      }
    });
    return (
      nodes.find((n) => {
        const t = n['@type'];
        if (Array.isArray(t)) return t.some((x) => types.has(x));
        return types.has(t);
      }) || null
    );
  }

  const JOB_META = {
    real_estate: { source: 'real_estate_search', sourceType: 'real_estate', label: 'Real estate' },
    products: { source: 'products_search', sourceType: 'product_listing', label: 'Product' },
    wholesale: { source: 'wholesale_search', sourceType: 'wholesale_listing', label: 'Wholesale' },
    home_owners: { source: 'home_owners_search', sourceType: 'home_owners', label: 'Home owner' },
  };

  function buildListingLead({
    source,
    jobType = 'real_estate',
    title,
    price,
    url,
    description = '',
    city = '',
    state = '',
    address = '',
    postalCode = '',
    phone = '',
    email = '',
    sellerName = '',
    beds = null,
    baths = null,
    sqft = null,
    propertyType = '',
    sourceId = '',
    imageUrl = '',
    noteParts = [],
  }) {
    const jt = JOB_META[jobType] ? jobType : 'real_estate';
    const metaRow = JOB_META[jt];
    const parsedPrice = parsePrice(price);
    const priceLabel = parsedPrice ? `$${parsedPrice.toLocaleString()}` : '';
    const baseTitle = String(title || 'Listing').trim();
    const displayTitle = priceLabel ? `${baseTitle} · ${priceLabel}` : baseTitle;

    const listing = {
      source,
      sourceId: String(sourceId || '').trim(),
      price: parsedPrice,
      beds: beds != null ? parseNumber(beds) : null,
      baths: baths != null ? parseNumber(baths) : null,
      sqft: sqft != null ? parseNumber(sqft) : null,
      propertyType: propertyType || (jt === 'real_estate' ? 'listing' : 'product'),
      description: String(description || '').slice(0, 4000),
      sellerName: sellerName || '',
      postedAt: '',
      imageUrl: imageUrl || meta('og:image') || '',
    };

    const note = [
      metaRow.label,
      priceLabel,
      beds != null ? `${beds} bed` : '',
      baths != null ? `${baths} bath` : '',
      sqft != null ? `${sqft} sqft` : '',
      description ? description.slice(0, 280) : '',
      ...noteParts,
    ]
      .filter(Boolean)
      .join(' · ');

    return {
      title: displayTitle,
      phone: phone || 'N/A',
      website: url || 'N/A',
      email: email || 'N/A',
      categoryName: propertyType || metaRow.label,
      address: address || 'N/A',
      city,
      state,
      postalCode,
      url: url || '',
      note,
      source: 'chrome_extension',
      sourceChannel: source,
      jobType: jt,
      sourceType: metaRow.sourceType,
      listing,
      listingType: jt,
      listingPrice: parsedPrice,
      listingBeds: listing.beds,
      listingBaths: listing.baths,
      listingSqft: listing.sqft,
    };
  }

  function priceFromPage(selectors) {
    for (const sel of selectors || []) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const p = parsePrice(el.textContent || el.getAttribute('content'));
      if (p) return p;
    }
    const bodyMatch = document.body?.innerText?.match(/\$\s?[\d,]+(?:\.\d{2})?/);
    return bodyMatch ? parsePrice(bodyMatch[0]) : null;
  }

  function specsFromText(text) {
    const raw = String(text || '');
    const beds = raw.match(/(\d+(?:\.\d+)?)\s*(?:bd|bed|beds|br|bedroom)/i);
    const baths = raw.match(/(\d+(?:\.\d+)?)\s*(?:ba|bath|baths|bathroom)/i);
    const sqft = raw.match(/([\d,]+)\s*(?:sq\.?\s*ft|sqft|sf)\b/i);
    return {
      beds: beds ? parseNumber(beds[1]) : null,
      baths: baths ? parseNumber(baths[1]) : null,
      sqft: sqft ? parseNumber(sqft[1]) : null,
    };
  }

  window.AdHelloListingHelpers = {
    parsePrice,
    parseNumber,
    findListingJsonLd,
    buildListingLead,
    priceFromPage,
    specsFromText,
    meta,
  };
})();
