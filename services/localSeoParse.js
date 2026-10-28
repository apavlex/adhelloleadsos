/**
 * Pure helpers for Local SEO research payloads (no DB).
 */

function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function hostKey(raw) {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split('?')[0];
  return s || '';
}

function normName(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function namesMatch(a, b) {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

function flattenSerpItems(apiJson) {
  const tasks = Array.isArray(apiJson && apiJson.tasks) ? apiJson.tasks : [];
  const items = [];
  for (const t of tasks) {
    for (const r of Array.isArray(t.result) ? t.result : []) {
      if (Array.isArray(r.items)) items.push(...r.items);
    }
  }
  return items;
}

function findBusinessInMapsItems(items, { businessName, website }) {
  const list = Array.isArray(items) ? items : [];
  const domain = hostKey(website);
  let best = null;
  for (const it of list) {
    const type = String(it.type || '');
    if (type && !/maps|local|place/i.test(type) && it.rank_group == null && it.rank_absolute == null) {
      continue;
    }
    const title = it.title || it.domain || '';
    const itemDomain = hostKey(it.domain || it.url || it.website || '');
    const byDomain = domain && itemDomain && (itemDomain === domain || itemDomain.endsWith('.' + domain) || domain.endsWith('.' + itemDomain));
    const byName = namesMatch(businessName, title);
    if (!byDomain && !byName) continue;
    const rank = num(it.rank_group != null ? it.rank_group : it.rank_absolute, 99);
    if (!best || rank < best.rank) {
      best = {
        title: String(title || '').slice(0, 200),
        domain: itemDomain || null,
        rank,
        rating: num(it.rating && it.rating.value != null ? it.rating.value : it.rating, null),
        votes: num(it.rating && it.rating.votes_count != null ? it.rating.votes_count : it.reviews_count, null),
        address: it.address || it.address_info && it.address_info.address || null,
        phone: it.phone || null,
        cid: it.cid || it.cid_info || null,
        placeId: it.place_id || null,
        category: it.category || it.main_category || null,
        url: it.url || it.website || null,
      };
    }
  }
  return best;
}

function extractLocalPackFromOrganic(items, { businessName, website }) {
  const list = Array.isArray(items) ? items : [];
  const pack = [];
  let you = null;

  function consider(child) {
    const row = {
      title: child.title || '',
      rank: num(child.rank_group != null ? child.rank_group : child.rank_absolute, null),
      domain: hostKey(child.domain || child.url || ''),
      rating: num(child.rating && child.rating.value, null),
    };
    pack.push(row);
    if (!you && (namesMatch(businessName, row.title) || (website && row.domain === hostKey(website)))) {
      you = row;
    }
  }

  for (const it of list) {
    const type = String(it.type || '');
    if (type === 'local_pack' && Array.isArray(it.items)) {
      it.items.forEach(consider);
      continue;
    }
    if (type === 'local_pack' || type === 'local_pack_element') {
      consider(it);
    }
  }
  return { pack: pack.slice(0, 10), you };
}

function parseGbpInfo(apiJson) {
  const tasks = Array.isArray(apiJson && apiJson.tasks) ? apiJson.tasks : [];
  let item = null;
  for (const t of tasks) {
    for (const r of Array.isArray(t.result) ? t.result : []) {
      if (Array.isArray(r.items) && r.items.length) {
        item = r.items[0];
        break;
      }
      if (r.title || r.cid || r.place_id) {
        item = r;
        break;
      }
    }
    if (item) break;
  }
  if (!item) return null;

  const attributes = item.attributes || item.additional_categories || [];
  const workHours = item.work_hours || item.working_hours || null;
  const photos =
    num(item.total_photos != null ? item.total_photos : item.photos_count, 0) ||
    (Array.isArray(item.local_business_links) ? item.local_business_links.length : 0);
  const hasPhone = !!(item.phone || item.main_phone);
  const hasAddress = !!(item.address || (item.address_info && item.address_info.address));
  const hasWebsite = !!(item.url || item.domain || item.website);
  const hasCategory = !!(item.category || item.main_category || item.category_ids);
  const hasHours = !!(workHours && (workHours.timetable || workHours.current_status || Object.keys(workHours).length));
  const hasDescription = !!(item.description || item.snippet);
  const checks = { hasPhone, hasAddress, hasWebsite, hasCategory, hasHours, hasDescription, photos: photos || 0 };
  const boolScore =
    (hasPhone ? 15 : 0) +
    (hasAddress ? 15 : 0) +
    (hasWebsite ? 15 : 0) +
    (hasCategory ? 15 : 0) +
    (hasHours ? 15 : 0) +
    (hasDescription ? 10 : 0) +
    Math.min(15, Math.round((photos || 0) / 2));

  return {
    title: item.title || null,
    cid: item.cid || null,
    placeId: item.place_id || null,
    category: item.category || item.main_category || null,
    phone: item.phone || item.main_phone || null,
    address: item.address || (item.address_info && item.address_info.address) || null,
    website: item.url || item.domain || item.website || null,
    rating: num(item.rating && item.rating.value != null ? item.rating.value : item.rating_value, null),
    votes: num(item.rating && item.rating.votes_count != null ? item.rating.votes_count : item.reviews_count, null),
    photos: photos || 0,
    attributes: Array.isArray(attributes) ? attributes.slice(0, 20) : [],
    completeness: Math.min(100, boolScore),
    checks,
    rawType: item.type || null,
  };
}

function parseReviews(apiJson) {
  const tasks = Array.isArray(apiJson && apiJson.tasks) ? apiJson.tasks : [];
  let result = null;
  const reviews = [];
  for (const t of tasks) {
    for (const r of Array.isArray(t.result) ? t.result : []) {
      result = r;
      if (Array.isArray(r.items)) reviews.push(...r.items);
    }
  }
  let unanswered = 0;
  const sample = [];
  for (const rev of reviews.slice(0, 40)) {
    const hasReply = !!(rev.owner_answer || rev.owner_response || rev.reply || (rev.responses && rev.responses.length));
    if (!hasReply) unanswered += 1;
    sample.push({
      rating: num(rev.rating && rev.rating.value != null ? rev.rating.value : rev.rating, null),
      timestamp: rev.timestamp || rev.time || rev.datetime || null,
      hasReply,
      snippet: String(rev.review_text || rev.text || rev.snippet || '').slice(0, 160),
    });
  }
  return {
    rating: result ? num(result.rating && result.rating.value != null ? result.rating.value : result.rating_value, null) : null,
    votes: result ? num(result.reviews_count != null ? result.reviews_count : result.rating && result.rating.votes_count, null) : null,
    fetched: reviews.length,
    unanswered,
    sample,
  };
}

/**
 * Score 0–100 from maps ranks, GBP completeness, reviews.
 */
function scoreLocalResearch({ keywordRanks = [], gbp = null, reviews = null }) {
  const ranks = (Array.isArray(keywordRanks) ? keywordRanks : [])
    .map((k) => num(k.mapsRank, null))
    .filter((n) => n != null && n > 0);
  let mapsScore = 35;
  if (ranks.length) {
    const avg = ranks.reduce((a, b) => a + b, 0) / ranks.length;
    // #1 → 100, #3 → ~70, #10 → ~30, missing handled separately
    mapsScore = Math.max(0, Math.min(100, Math.round(110 - avg * 12)));
  } else {
    mapsScore = 15;
  }

  const gbpScore = gbp && gbp.completeness != null ? Math.min(100, gbp.completeness) : 25;

  const rating = reviews && reviews.rating != null ? reviews.rating : gbp && gbp.rating != null ? gbp.rating : null;
  const votes = reviews && reviews.votes != null ? reviews.votes : gbp && gbp.votes != null ? gbp.votes : 0;
  let reviewScore = 30;
  if (rating != null) {
    reviewScore = Math.round((rating / 5) * 70 + Math.min(30, Math.log10(Math.max(1, votes) + 1) * 15));
  }
  const unanswered = reviews && reviews.unanswered != null ? reviews.unanswered : 0;
  reviewScore = Math.max(0, reviewScore - Math.min(25, unanswered * 2));

  const overall = Math.round(mapsScore * 0.45 + gbpScore * 0.3 + reviewScore * 0.25);
  return {
    overall: Math.min(100, Math.max(0, overall)),
    mapsScore,
    gbpScore,
    reviewScore,
    avgMapsRank: ranks.length ? Math.round((ranks.reduce((a, b) => a + b, 0) / ranks.length) * 10) / 10 : null,
    rankedKeywords: ranks.length,
  };
}

function defaultKeywords({ businessName, vertical, city }) {
  const cityPart = String(city || '').trim();
  const vert = String(vertical || '').trim() || 'near me';
  const name = String(businessName || '').trim();
  const out = [];
  if (vert && cityPart) out.push(`${vert} ${cityPart}`);
  if (vert) out.push(`${vert} near me`);
  if (name && cityPart) out.push(`${name} ${cityPart}`);
  if (vert && cityPart) out.push(`best ${vert} ${cityPart}`);
  return Array.from(new Set(out.map((k) => k.trim()).filter(Boolean))).slice(0, 6);
}

module.exports = {
  hostKey,
  namesMatch,
  flattenSerpItems,
  findBusinessInMapsItems,
  extractLocalPackFromOrganic,
  parseGbpInfo,
  parseReviews,
  scoreLocalResearch,
  defaultKeywords,
};
