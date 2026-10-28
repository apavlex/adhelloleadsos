/**
 * Pure parsers for DataForSEO Labs SEO gap payloads (no DB).
 */

const dataForSeo = require('./dataForSeoClient');
const { normKeyword } = require('./seoGapEngine');

function cleanDomain(raw) {
  return dataForSeo.hostFromWebsite(raw);
}

function parseKeywordMetrics(item) {
  const kdInfo = item.keyword_data || item;
  const info = kdInfo.keyword_info || {};
  const props = kdInfo.keyword_properties || {};
  const keyword =
    normKeyword(kdInfo.keyword || item.keyword_data?.keyword || item.keyword) || '';
  const serp = item.ranked_serp_element || item.serp_item || {};
  const element = serp.serp_item || serp;
  const position = Number(
    element.rank_group != null
      ? element.rank_group
      : element.rank_absolute != null
        ? element.rank_absolute
        : item.rank_group != null
          ? item.rank_group
          : item.position,
  );
  const url = String(element.url || item.url || '').slice(0, 500);
  return {
    keyword,
    position: Number.isFinite(position) && position > 0 ? Math.round(position) : null,
    url,
    volume: Math.max(0, Math.round(Number(info.search_volume || item.volume) || 0)),
    cpc: Number(info.cpc || item.cpc) || 0,
    kd: Number(
      props.keyword_difficulty != null
        ? props.keyword_difficulty
        : item.keyword_difficulty != null
          ? item.keyword_difficulty
          : item.kd,
    ),
    etv: Number(item.etv || element.etv || info.etv) || 0,
  };
}

function parseCompetitorDomainItems(apiJson) {
  const items = dataForSeo.extractLabsItems(apiJson);
  return items
    .map((it) => ({
      domain: cleanDomain(it.domain || it.competitor || ''),
      avgPosition: Number(it.avg_position || it.median_position) || null,
      intersections: Math.round(Number(it.intersections || it.keywords_count || 0) || 0),
      etv: Number(it.etv || it.full_domain_metrics?.organic?.etv) || 0,
      similarity: Number(it.avg_position) ? Math.max(0, 100 - Number(it.avg_position)) : 50,
    }))
    .filter((c) => c.domain)
    .slice(0, 20);
}

function parseKeywordsForSite(apiJson, domain) {
  return dataForSeo
    .extractLabsItems(apiJson)
    .map(parseKeywordMetrics)
    .filter((r) => r.keyword)
    .map((r) => ({ ...r, domain: cleanDomain(domain) }));
}

function parseIntersectionAsCompetitorRanks(apiJson, rivalDomain) {
  const domain = cleanDomain(rivalDomain);
  return dataForSeo
    .extractLabsItems(apiJson)
    .map((item) => {
      const base = parseKeywordMetrics(item);
      const first = item.keyword_data || item;
      const serp1 = item.first_domain_serp_element || item.ranked_serp_element || {};
      const el = serp1.serp_item || serp1;
      const position = Number(
        el.rank_group != null
          ? el.rank_group
          : el.rank_absolute != null
            ? el.rank_absolute
            : base.position,
      );
      return {
        ...base,
        position: Number.isFinite(position) && position > 0 ? Math.round(position) : base.position,
        url: String(el.url || base.url || '').slice(0, 500),
        domain,
        keyword: base.keyword || normKeyword(first.keyword),
      };
    })
    .filter((r) => r.keyword && r.position != null);
}

module.exports = {
  cleanDomain,
  parseKeywordMetrics,
  parseCompetitorDomainItems,
  parseKeywordsForSite,
  parseIntersectionAsCompetitorRanks,
};
