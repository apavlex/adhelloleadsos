/**
 * Maps Firecrawl extract (snake_case) + merged tech fields to persisted lead shape (camelCase).
 */

function firecrawlExtractToLeadUpdates(raw) {
  if (!raw || typeof raw !== 'object') return {};

  const u = {};
  const copy = (snake, camel) => {
    if (raw[snake] !== undefined) u[camel] = raw[snake];
  };

  copy('facebook', 'facebook');
  copy('instagram', 'instagram');
  copy('twitter', 'twitter');
  copy('linkedin', 'linkedin');
  copy('tiktok', 'tiktok');
  copy('google_places', 'googlePlaces');
  copy('yelp', 'yelp');
  copy('email', 'email');
  copy('phone', 'phone');
  copy('address', 'address');
  if (raw.total_score !== undefined && raw.total_score !== null) {
    const n = Number(raw.total_score);
    if (!Number.isNaN(n)) u.totalScore = n;
  }
  if (raw.reviews_count !== undefined && raw.reviews_count !== null) {
    const n = parseInt(raw.reviews_count, 10);
    if (!Number.isNaN(n)) u.reviewsCount = n;
  }

  if (Array.isArray(raw.review_snippets) && raw.review_snippets.length) {
    u.reviewSnippets = raw.review_snippets
      .map((s) => String(s || '').trim())
      .filter(Boolean)
      .slice(0, 12)
      .map((s) => (s.length > 500 ? `${s.slice(0, 497)}…` : s));
  }

  copy('has_schema_markup', 'hasSchemaMarkup');
  copy('has_chatbot', 'hasChatbot');
  copy('has_click_to_call', 'hasClickToCall');
  copy('is_mobile_friendly', 'isMobileFriendly');
  copy('is_outdated', 'isOutdated');
  copy('visual_modernity_score', 'visualModernityScore');
  copy('aeo_score', 'aeoScore');
  copy('geo_gaps', 'geoGaps');
  copy('competitor_name', 'competitorName');
  copy('competitor_gap', 'competitorGap');
  copy('audit_summary', 'auditSummary');

  copy('cms_platform', 'cmsPlatform');
  if (raw.tech_stack_tags !== undefined) {
    u.techStackTags = Array.isArray(raw.tech_stack_tags)
      ? raw.tech_stack_tags
      : String(raw.tech_stack_tags || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
  }
  copy('html_chat_widget_detected', 'htmlChatWidgetDetected');

  return u;
}

module.exports = {
  firecrawlExtractToLeadUpdates,
};
