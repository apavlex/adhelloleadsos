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

  function cleanZillowAgentName(raw) {
    return String(raw || '')
      .replace(/\s+/g, ' ')
      .replace(/^(listed by|listing agent|agent|seller|broker)\s*[:\-–]?\s*/i, '')
      .replace(/\s*\|\s*Zillow.*$/i, '')
      .trim();
  }

  function cleanZillowPhone(raw) {
    const m = String(raw || '').match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
    return m ? m[0].trim() : '';
  }

  function cleanZillowEmail(raw) {
    const m = String(raw || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return m ? m[0].trim() : '';
  }

  /** Pull listing agent / broker card when present on a Zillow home details page. */
  function extractZillowAgentCard() {
    const out = {
      agentName: '',
      brokerName: '',
      phone: '',
      email: '',
      agentProfileUrl: '',
    };

    const agentEl =
      document.querySelector('[data-testid="attribution-LISTING_AGENT"]') ||
      document.querySelector('[data-testid="listing-agent-info"]') ||
      document.querySelector('[data-testid="seller-card"]') ||
      document.querySelector('[data-testid="agent-info"]') ||
      document.querySelector('[class*="ListingAgent"]') ||
      document.querySelector('[class*="listing-agent"]');

    const brokerEl =
      document.querySelector('[data-testid="attribution-BROKER"]') ||
      document.querySelector('[data-testid="attribution-LISTING_OFFICE"]') ||
      document.querySelector('[data-testid="brokerage-info"]');

    if (agentEl) {
      const link = agentEl.querySelector('a[href*="/profile/"], a[href*="/agent/"], a[href*="premieragent"]');
      if (link?.href) out.agentProfileUrl = link.href.split('?')[0];
      out.agentName = cleanZillowAgentName(
        link?.textContent ||
          agentEl.querySelector('[class*="Text"]')?.textContent ||
          agentEl.textContent,
      );
    }

    if (brokerEl) {
      out.brokerName = cleanZillowAgentName(brokerEl.textContent);
    }

    const phoneCandidates = [
      ...document.querySelectorAll(
        'a[href^="tel:"], [data-testid*="phone" i], [aria-label*="phone" i], button[aria-label*="call" i]',
      ),
    ];
    for (const el of phoneCandidates) {
      const hrefPhone = cleanZillowPhone(el.getAttribute('href') || '');
      const textPhone = cleanZillowPhone(el.getAttribute('aria-label') || el.textContent || '');
      const phone = hrefPhone || textPhone;
      if (!phone) continue;
      // Prefer phones near agent/contact UI; still accept first valid page phone as fallback.
      const nearAgent =
        (agentEl && agentEl.contains(el)) ||
        /agent|contact|call|listing/i.test(
          `${el.getAttribute('data-testid') || ''} ${el.getAttribute('aria-label') || ''} ${el.className || ''}`,
        );
      if (nearAgent || !out.phone) out.phone = phone;
      if (nearAgent) break;
    }

    const emailCandidates = [
      ...document.querySelectorAll('a[href^="mailto:"], [data-testid*="email" i], [aria-label*="email" i]'),
    ];
    for (const el of emailCandidates) {
      const hrefEmail = cleanZillowEmail(el.getAttribute('href') || '');
      const textEmail = cleanZillowEmail(el.getAttribute('aria-label') || el.textContent || '');
      const email = hrefEmail || textEmail;
      if (!email) continue;
      out.email = email;
      break;
    }

    // JSON blobs sometimes embed listing agent phone / email even when UI hides them.
    if (!out.agentName || !out.phone || !out.email) {
      const scripts = document.querySelectorAll('script[type="application/ld+json"], script#__NEXT_DATA__, script[type="application/json"]');
      for (const script of scripts) {
        const raw = script.textContent || '';
        if (!raw || raw.length > 2_000_000) continue;
        if (!out.agentName) {
          const nameMatch =
            raw.match(/"listingAgent"\s*:\s*\{[^}]{0,800}?"name"\s*:\s*"([^"]{2,120})"/i) ||
            raw.match(/"agentName"\s*:\s*"([^"]{2,120})"/i) ||
            raw.match(/"listingAgentName"\s*:\s*"([^"]{2,120})"/i);
          if (nameMatch) out.agentName = cleanZillowAgentName(nameMatch[1]);
        }
        if (!out.brokerName) {
          const brokerMatch =
            raw.match(/"brokerageName"\s*:\s*"([^"]{2,160})"/i) ||
            raw.match(/"brokerName"\s*:\s*"([^"]{2,160})"/i) ||
            raw.match(/"listingOfficeName"\s*:\s*"([^"]{2,160})"/i);
          if (brokerMatch) out.brokerName = cleanZillowAgentName(brokerMatch[1]);
        }
        if (!out.phone) {
          const phoneMatch =
            raw.match(/"agentPhone(?:Number)?"\s*:\s*"([^"]{7,40})"/i) ||
            raw.match(/"businessPhone(?:Number)?"\s*:\s*"([^"]{7,40})"/i) ||
            raw.match(/"telephone"\s*:\s*"([^"]{7,40})"/i);
          if (phoneMatch) out.phone = cleanZillowPhone(phoneMatch[1]);
        }
        if (!out.email) {
          const emailMatch =
            raw.match(/"agentEmail"\s*:\s*"([^"]+@[^"]+)"/i) ||
            raw.match(/"email"\s*:\s*"([^"]+@[^"]+)"/i);
          if (emailMatch) out.email = cleanZillowEmail(emailMatch[1]);
        }
        if (!out.agentProfileUrl) {
          const profileMatch = raw.match(/"(?:profileUrl|agentUrl|premierAgentUrl)"\s*:\s*"(https?:[^"]+)"/i);
          if (profileMatch) out.agentProfileUrl = profileMatch[1].replace(/\\u002F/g, '/').split('?')[0];
        }
        if (out.agentName && out.phone && out.email) break;
      }
    }

    // Attribution line fallback: "Listing by Jane Doe, Acme Realty"
    if (!out.agentName) {
      const body = document.body?.innerText?.slice(0, 20000) || '';
      const listedBy =
        body.match(/Listed by\s+([A-Z][A-Za-z.'\-]+(?:\s+[A-Z][A-Za-z.'\-]+){0,3})(?:\s*,\s*([^\n|]{2,80}))?/i) ||
        body.match(/Listing (?:agent|by)\s*[:\-]?\s*([A-Z][A-Za-z.'\-]+(?:\s+[A-Z][A-Za-z.'\-]+){0,3})/i);
      if (listedBy) {
        out.agentName = cleanZillowAgentName(listedBy[1]);
        if (listedBy[2] && !out.brokerName) out.brokerName = cleanZillowAgentName(listedBy[2]);
      }
    }

    if (out.agentName && out.agentName.length > 80) out.agentName = '';
    if (out.brokerName && out.brokerName.length > 120) out.brokerName = '';
    return out;
  }

  function applyZillowAgentToLead(lead, agent) {
    if (!lead || !agent) return lead;
    if (agent.agentName) {
      lead.contactName = agent.agentName;
      lead.decisionMakerName = agent.agentName;
      if (lead.listing) lead.listing.sellerName = agent.agentName;
    }
    if (agent.brokerName && lead.listing) lead.listing.brokerName = agent.brokerName;
    if (agent.agentProfileUrl && lead.listing) lead.listing.agentProfileUrl = agent.agentProfileUrl;
    if (agent.phone && (!lead.phone || lead.phone === 'N/A')) lead.phone = agent.phone;
    if (agent.email && (!lead.email || lead.email === 'N/A')) lead.email = agent.email;
    const agentNote = agent.agentName
      ? agent.brokerName
        ? `Agent: ${agent.agentName} · ${agent.brokerName}`
        : `Agent: ${agent.agentName}`
      : agent.brokerName
        ? `Broker: ${agent.brokerName}`
        : '';
    if (agentNote && lead.note && !String(lead.note).includes(agentNote)) {
      lead.note = `${lead.note} · ${agentNote}`;
    } else if (agentNote && !lead.note) {
      lead.note = agentNote;
    }
    return lead;
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
    const agent = extractZillowAgentCard();
    const fromLd = extractFromJsonLd('zillow', 'real_estate', url, title);
    if (fromLd) {
      if (!fromLd.listing?.beds && specs.beds) fromLd.listing.beds = specs.beds;
      if (!fromLd.listing?.baths && specs.baths) fromLd.listing.baths = specs.baths;
      if (!fromLd.listing?.sqft && specs.sqft) fromLd.listing.sqft = specs.sqft;
      fromLd.listingBeds = fromLd.listing?.beds ?? null;
      fromLd.listingBaths = fromLd.listing?.baths ?? null;
      fromLd.listingSqft = fromLd.listing?.sqft ?? null;
      if (agent.agentName && fromLd.listing) fromLd.listing.sellerName = agent.agentName;
      if (agent.brokerName && fromLd.listing) fromLd.listing.brokerName = agent.brokerName;
      if (agent.agentProfileUrl && fromLd.listing) fromLd.listing.agentProfileUrl = agent.agentProfileUrl;
      if (agent.phone && (!fromLd.phone || fromLd.phone === 'N/A')) fromLd.phone = agent.phone;
      if (agent.email && (!fromLd.email || fromLd.email === 'N/A')) fromLd.email = agent.email;
      applyZillowAgentToLead(fromLd, agent);
      return H().enrichLeadGeo ? H().enrichLeadGeo(fromLd) : fromLd;
    }
    const geo = H().parseUsAddress ? H().parseUsAddress(address || title) : { street: address, city: '', state: '', postalCode: '' };
    const lead = H().buildListingLead({
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
      phone: agent.phone,
      email: agent.email,
      sellerName: agent.agentName,
      brokerName: agent.brokerName,
      agentProfileUrl: agent.agentProfileUrl,
      beds: specs.beds,
      baths: specs.baths,
      sqft: specs.sqft,
      propertyType: 'real_estate',
      sourceId: (url.match(/(\d+)_zpid/) || [])[1] || '',
    });
    return applyZillowAgentToLead(lead, agent);
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
    extractZillowAgentCard,
    craigslistJobType,
    LISTING_PLATFORMS: Object.keys(EXTRACTORS).concat(['craigslist_listing']),
  };
})();
