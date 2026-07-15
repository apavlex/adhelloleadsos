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

  function parseUsAddress(raw) {
    const text = String(raw || '')
      .trim()
      .replace(/\s*[-–|]\s*\$\s?[\d,]+.*$/i, '')
      .replace(/\s*\|\s*Zillow.*$/i, '');
    if (!text || text === 'N/A') {
      return { street: '', city: '', state: '', postalCode: '' };
    }
    const postalCode = (text.match(/\b(\d{5})(?:-\d{4})?\b/) || [])[1] || '';
    const utils = window.AdHelloAddressUtils;
    const parsed = utils?.parseCityState ? utils.parseCityState(text) : { street: text, city: '', state: '' };
    let street = String(parsed.street || '').trim();
    let city = String(parsed.city || '').trim();
    let state = String(parsed.state || '').trim();

    if ((!city || !state) && text.includes(',')) {
      const parts = text.split(',').map((s) => s.trim()).filter(Boolean);
      if (parts.length >= 3) {
        street = parts.slice(0, -2).join(', ');
        city = city || parts[parts.length - 2];
        const tail = parts[parts.length - 1];
        const st = tail.match(/\b([A-Z]{2})\b/);
        state = state || (st ? st[1] : tail.replace(/\d{5}(-\d{4})?.*$/i, '').trim());
      } else if (parts.length === 2) {
        street = parts[0];
        const st = parts[1].match(/\b([A-Z]{2})\b/);
        state = state || (st ? st[1] : parts[1].replace(/\d{5}(-\d{4})?.*$/i, '').trim());
      }
    }

    return { street, city, state, postalCode };
  }

  function enrichLeadGeo(lead) {
    if (!lead || typeof lead !== 'object') return lead;
    const sources = [lead.address, lead.title].filter((v) => v && v !== 'N/A');
    for (const raw of sources) {
      const geo = parseUsAddress(raw);
      if (!lead.city && geo.city) lead.city = geo.city;
      if (!lead.state && geo.state) lead.state = geo.state;
      if (!lead.postalCode && !lead.zip && geo.postalCode) {
        lead.postalCode = geo.postalCode;
        lead.zip = geo.postalCode;
      }
      if ((!lead.address || lead.address === 'N/A') && geo.street) {
        lead.address = geo.street;
      } else if (geo.street && geo.city && String(lead.address || '').includes(geo.city)) {
        lead.address = geo.street;
      }
      if (lead.city && lead.state) break;
    }
    return lead;
  }

  function normalizeSchemaPropertyType(raw, fallback = 'listing') {
    if (!raw) return fallback;
    const list = Array.isArray(raw) ? raw : [raw];
    const pick =
      list.find((t) => /real\s*estate|residence|house|apartment|singlefamily/i.test(String(t))) ||
      list.find((t) => String(t).toLowerCase() !== 'product') ||
      list[0];
    const s = String(pick || '').trim();
    if (!s || s === 'Product') return fallback;
    if (/^real/i.test(s)) return fallback;
    return s;
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
      propertyType: normalizeSchemaPropertyType(propertyType, jt === 'real_estate' ? 'listing' : 'product'),
      description: String(description || '').slice(0, 4000),
      sellerName: sellerName || '',
      postedAt: '',
      imageUrl: imageUrl || meta('og:image') || '',
    };

    const geo = parseUsAddress(address || title);
    const resolvedCity = city || geo.city || '';
    const resolvedState = state || geo.state || '';
    const resolvedZip = postalCode || geo.postalCode || '';
    const resolvedAddress = address && address !== 'N/A' ? address : geo.street || address || '';

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

    return enrichLeadGeo({
      title: displayTitle,
      phone: phone || 'N/A',
      website: url || 'N/A',
      email: email || 'N/A',
      categoryName: metaRow.label,
      address: resolvedAddress || 'N/A',
      city: resolvedCity,
      state: resolvedState,
      postalCode: resolvedZip,
      zip: resolvedZip,
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
    });
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
    parseUsAddress,
    enrichLeadGeo,
  };
})();
