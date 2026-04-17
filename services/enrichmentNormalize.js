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
  copy('google_places', 'googlePlaces');
  copy('yelp', 'yelp');
  copy('email', 'email');

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
