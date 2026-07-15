(function () {
  const H = () => window.AdHelloListingHelpers || {};

  function lhMeta(prop) {
    return H().meta ? H().meta(prop) : '';
  }

  function craigslistJobType(path) {
    const p = String(path || '').toLowerCase();
    if (/(^|\/)(rea|apa|hsh|hos|sbw|trv|lod|rew|reh)(\/|$)/.test(p)) return 'real_estate';
    if (/(^|\/)(for|zip|fua|fuo|fnc|mat|gra|hlb|syp|bab|taa|mca|cta|bka|ema|jwa|msa|pha|boo|pta|gra|tia|haa|gra)(\/|$)/.test(p)) {
      return 'products';
    }
    return null;
  }

  function extractFromJsonLd(source, jobType, url, fallbackTitle) {
    const json = H().findListingJsonLd ? H().findListingJsonLd() : null;
    if (!json) return null;
    const addrRaw = json.address || {};
    const addr = typeof addrRaw === 'string' ? { streetAddress: addrRaw } : addrRaw;
    let address =
      typeof addrRaw === 'string'
        ? addrRaw
        : [addr.streetAddress, addr.addressLocality, addr.addressRegion, addr.postalCode].filter(Boolean).join(', ');
    const offer = json.offers || {};
    const price = json.price ?? offer.price ?? offer.lowPrice ?? json.lowPrice;
    const geo = H().parseUsAddress ? H().parseUsAddress(address || fallbackTitle) : { street: '', city: '', state: '', postalCode: '' };
    const street = addr.streetAddress || geo.street || '';
    const city = addr.addressLocality || geo.city || '';
    const state = addr.addressRegion || geo.state || '';
    const postalCode = addr.postalCode || geo.postalCode || '';
    if (street || city || state || postalCode) {
      address = [street, city, state, postalCode].filter(Boolean).join(', ');
    }
    return H().buildListingLead({
      source,
      jobType,
      title: json.name || fallbackTitle,
      price,
      url,
      description: json.description || lhMeta('og:description'),
      city,
      state,
      address: address || street,
      postalCode,
      phone: json.telephone || '',
      beds: json.numberOfBedrooms ?? json.bedrooms,
      baths: json.numberOfBathroomsTotal ?? json.bathrooms,
      sqft: json.floorSize?.value ?? json.floorSize,
      propertyType: json['@type'] || '',
      sourceId: String(json.sku || json.productID || json.identifier || '').trim(),
    });
  }

  function zillowHomeSpecs() {
    const chunks = [];
    document
      .querySelectorAll(
        '[data-testid="bed-bath-sqft-fact"], [data-testid="bed-bath-sqft-fact-container"], [data-testid="property-facts"], [data-testid="home-facts"]',
      )
      .forEach((el) => {
        chunks.push(el.textContent || '');
      });
    const fromFacts = H().specsFromText ? H().specsFromText(chunks.join(' ')) : {};
    if (fromFacts.beds || fromFacts.baths || fromFacts.sqft) return fromFacts;
    return H().specsFromText ? H().specsFromText(document.body?.innerText?.slice(0, 14000) || '') : {};
  }

  function extractZillow() {
    const url = window.location.href.split('?')[0].split('#')[0];
    const title =
      document.querySelector('h1')?.textContent?.trim() ||
      lhMeta('og:title') ||
      document.title;
    const price = H().priceFromPage
      ? H().priceFromPage([
          '[data-testid="price"]',
          'span[data-testid="price"]',
          '[data-test="property-price"]',
          '.ds-price',
          '[data-testid="zestimate-text"]',
        ])
      : null;
    const address =
      document.querySelector('[data-testid="bdp-address"]')?.textContent?.trim() ||
      document.querySelector('[data-testid="home-info"] h1')?.textContent?.trim() ||
      document.querySelector('h1')?.textContent?.trim() ||
      lhMeta('og:description') ||
      '';
    const specs = zillowHomeSpecs();
    const fromLd = extractFromJsonLd('zillow', 'real_estate', url, title);
    if (fromLd) {
      if (!fromLd.listing?.beds && specs.beds) fromLd.listing.beds = specs.beds;
      if (!fromLd.listing?.baths && specs.baths) fromLd.listing.baths = specs.baths;
      if (!fromLd.listing?.sqft && specs.sqft) fromLd.listing.sqft = specs.sqft;
      fromLd.listingBeds = fromLd.listing?.beds ?? null;
      fromLd.listingBaths = fromLd.listing?.baths ?? null;
      fromLd.listingSqft = fromLd.listing?.sqft ?? null;
      return H().enrichLeadGeo ? H().enrichLeadGeo(fromLd) : fromLd;
    }
    const geo = H().parseUsAddress ? H().parseUsAddress(address || title) : { street: address, city: '', state: '', postalCode: '' };
    return H().buildListingLead({
      source: 'zillow',
      jobType: 'real_estate',
      title: title.replace(/\s*\|\s*Zillow.*$/i, ''),
      price,
      url,
      description: lhMeta('og:description'),
      address: geo.street || address,
      city: geo.city,
      state: geo.state,
      postalCode: geo.postalCode,
      beds: specs.beds,
      baths: specs.baths,
      sqft: specs.sqft,
      propertyType: 'real_estate',
      sourceId: (url.match(/(\d+)_zpid/) || [])[1] || '',
    });
  }

  function extractMhvillage() {
    const url = window.location.href.split('?')[0].split('#')[0];
    const title =
      document.querySelector('h1')?.textContent?.trim() ||
      lhMeta('og:title') ||
      document.title;
    const price = H().priceFromPage
      ? H().priceFromPage(['.price', '[class*="price"]', '[data-testid="price"]'])
      : null;
    const address =
      document.querySelector('[class*="address"]')?.textContent?.trim() ||
      document.querySelector('address')?.textContent?.trim() ||
      lhMeta('og:description') ||
      '';
    const description = document.querySelector('[class*="description"]')?.textContent?.trim() || lhMeta('og:description');
    const specs = H().specsFromText ? H().specsFromText(document.body?.innerText || '') : {};
    const fromLd = extractFromJsonLd('mhvillage', 'real_estate', url, title);
    if (fromLd) {
      fromLd.listing.propertyType = 'mobile_home';
      return fromLd;
    }
    return H().buildListingLead({
      source: 'mhvillage',
      jobType: 'real_estate',
      title: title.replace(/\s*\|\s*MHVillage.*$/i, ''),
      price,
      url,
      description,
      address,
      beds: specs.beds,
      baths: specs.baths,
      sqft: specs.sqft,
      propertyType: 'mobile_home',
    });
  }

  function extractRealtor() {
    const url = window.location.href.split('?')[0].split('#')[0];
    const title = document.querySelector('h1')?.textContent?.trim() || lhMeta('og:title');
    const price = H().priceFromPage
      ? H().priceFromPage(['[data-label="pc-price"]', '.price', '[data-testid="list-price"]'])
      : null;
    const address = document.querySelector('[data-label="ldp-address"]')?.textContent?.trim() || title;
    const specs = H().specsFromText ? H().specsFromText(document.body?.innerText || '') : {};
    const fromLd = extractFromJsonLd('realtor', 'real_estate', url, title);
    if (fromLd) return fromLd;
    return H().buildListingLead({
      source: 'realtor',
      jobType: 'real_estate',
      title,
      price,
      url,
      description: lhMeta('og:description'),
      address,
      beds: specs.beds,
      baths: specs.baths,
      sqft: specs.sqft,
      propertyType: 'real_estate',
    });
  }

  function extractRedfin() {
    const url = window.location.href.split('?')[0].split('#')[0];
    const title = document.querySelector('h1')?.textContent?.trim() || lhMeta('og:title');
    const price = H().priceFromPage
      ? H().priceFromPage(['.statsValue.price', '[data-rf-test-id="abp-price"]', '.price'])
      : null;
    const address = document.querySelector('[data-rf-test-id="abp-streetLine"]')?.textContent?.trim() || title;
    const specs = H().specsFromText ? H().specsFromText(document.body?.innerText || '') : {};
    const fromLd = extractFromJsonLd('redfin', 'real_estate', url, title);
    if (fromLd) return fromLd;
    return H().buildListingLead({
      source: 'redfin',
      jobType: 'real_estate',
      title,
      price,
      url,
      description: lhMeta('og:description'),
      address,
      beds: specs.beds,
      baths: specs.baths,
      sqft: specs.sqft,
      propertyType: 'real_estate',
    });
  }

  function extractOfferUp() {
    const url = window.location.href.split('?')[0].split('#')[0];
    const title = document.querySelector('h1')?.textContent?.trim() || lhMeta('og:title');
    const price = H().priceFromPage ? H().priceFromPage(['[data-test="item-price"]', 'h1 + p', 'p[class*="price"]']) : null;
    const description = lhMeta('og:description') || document.querySelector('[data-test="item-description"]')?.textContent?.trim() || '';
    const location = document.querySelector('[data-test="item-location"]')?.textContent?.trim() || '';
    const fromLd = extractFromJsonLd('offerup', 'products', url, title);
    if (fromLd) return fromLd;
    return H().buildListingLead({
      source: 'offerup',
      jobType: 'products',
      title,
      price,
      url,
      description,
      address: location,
      propertyType: 'product',
    });
  }

  function extractEbay() {
    const url = window.location.href.split('?')[0].split('#')[0];
    const title =
      document.querySelector('h1.x-item-title__mainTitle')?.textContent?.trim() ||
      document.querySelector('h1')?.textContent?.trim() ||
      lhMeta('og:title');
    const price = H().priceFromPage
      ? H().priceFromPage(['[itemprop="price"]', '#prcIsum', '.x-price-primary', '[data-testid="x-price-primary"]'])
      : null;
    const fromLd = extractFromJsonLd('ebay', 'products', url, title);
    if (fromLd) return fromLd;
    return H().buildListingLead({
      source: 'ebay',
      jobType: 'products',
      title,
      price,
      url,
      description: lhMeta('og:description'),
      propertyType: 'product',
      sourceId: (url.match(/\/itm\/(\d+)/) || [])[1] || '',
    });
  }

  function extractFacebookMarketplace() {
    const url = window.location.href.split('?')[0].split('#')[0];
    const title = lhMeta('og:title') || document.querySelector('h1')?.textContent?.trim() || document.title;
    const price = H().priceFromPage ? H().priceFromPage(['[aria-label*="Price"]', 'span[class*="price"]']) : null;
    const description = lhMeta('og:description') || '';
    const path = window.location.pathname.toLowerCase();
    const jobType = /mobile|home|manufactured|trailer|real estate|house|land/.test(`${title} ${description}`.toLowerCase())
      ? 'real_estate'
      : 'products';
    return H().buildListingLead({
      source: 'facebook_marketplace',
      jobType,
      title: title.replace(/\s*\|\s*Facebook.*$/i, ''),
      price,
      url,
      description,
      propertyType: jobType === 'real_estate' ? 'listing' : 'product',
    });
  }

  function extractCraigslistListing(path) {
    const url = window.location.href.split('?')[0].split('#')[0];
    const jobType = craigslistJobType(path);
    const rawTitle = document.querySelector('#titletextonly, .postingtitletext, h1')?.textContent?.trim() || document.title;
    const title = rawTitle.replace(/\([^)]*\)\s*$/, '').trim();
    const location = document.querySelector('.postingtitletext small, .mapaddress')?.textContent?.trim() || '';
    const body = document.querySelector('#postingbody, .postingbody')?.textContent?.trim() || '';
    const priceMatch = `${rawTitle} ${body}`.match(/\$\s?[\d,]+/);
    const price = priceMatch ? H().parsePrice(priceMatch[0]) : null;
    const phoneMatch = body.match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
    const specs = H().specsFromText ? H().specsFromText(`${rawTitle} ${body}`) : {};
    return H().buildListingLead({
      source: 'craigslist',
      jobType,
      title,
      price,
      url,
      description: body.slice(0, 2000),
      address: location,
      phone: phoneMatch ? phoneMatch[0] : '',
      beds: specs.beds,
      baths: specs.baths,
      sqft: specs.sqft,
      propertyType: jobType === 'real_estate' ? 'listing' : 'product',
    });
  }

  const EXTRACTORS = {
    zillow: extractZillow,
    mhvillage: extractMhvillage,
    realtor: extractRealtor,
    redfin: extractRedfin,
    offerup: extractOfferUp,
    ebay: extractEbay,
    facebook_marketplace: extractFacebookMarketplace,
  };

  function detectListingPlatform(url) {
    let host = '';
    let path = '';
    try {
      const u = new URL(url);
      host = u.hostname.replace(/^www\./, '').toLowerCase();
      path = u.pathname.toLowerCase();
    } catch (_) {
      return null;
    }

    if (host.includes('zillow.com')) return 'zillow';
    if (host.includes('mhvillage.com')) return 'mhvillage';
    if (host.includes('realtor.com')) return 'realtor';
    if (host.includes('redfin.com')) return 'redfin';
    if (host.includes('offerup.com')) return 'offerup';
    if (host.includes('ebay.com')) return 'ebay';
    if ((host.includes('facebook.com') || host.includes('fb.com')) && path.includes('/marketplace/')) {
      return 'facebook_marketplace';
    }
    if (host.includes('craigslist.org') && (/\d+\.html$/i.test(path) || /\/d\/[^/]+\/\d+\.html$/i.test(path))) {
      return craigslistJobType(path) ? 'craigslist_listing' : null;
    }
    return null;
  }

  function isListingPage(platform, url) {
    const path = (() => {
      try {
        return new URL(url).pathname.toLowerCase();
      } catch (_) {
        return '';
      }
    })();

    switch (platform) {
      case 'zillow':
        return path.includes('/homedetails/') || path.includes('/b/') || path.includes('/community/');
      case 'mhvillage':
        return path.includes('/home') || path.includes('/listing') || path.includes('/mobile-home') || path.includes('/Manufactured-Home');
      case 'realtor':
        return path.includes('/realestateandhomes-detail/') || path.includes('/homedetails/');
      case 'redfin':
        return /\/home\//.test(path) || path.includes('/house/');
      case 'offerup':
        return path.includes('/item/detail/') || path.includes('/item/');
      case 'ebay':
        return path.includes('/itm/');
      case 'facebook_marketplace':
        return path.includes('/marketplace/item/') || path.includes('/marketplace/product/');
      case 'craigslist_listing':
        return /\d+\.html$/i.test(path) || /\/d\/[^/]+\/\d+\.html$/i.test(path);
      default:
        return false;
    }
  }

  function extractListing(platform, path) {
    if (platform === 'craigslist_listing') return extractCraigslistListing(path);
    const fn = EXTRACTORS[platform];
    return fn ? fn() : null;
  }

  window.AdHelloListingExtractors = {
    detectListingPlatform,
    isListingPage,
    extractListing,
    craigslistJobType,
    LISTING_PLATFORMS: Object.keys(EXTRACTORS).concat(['craigslist_listing']),
  };
})();
