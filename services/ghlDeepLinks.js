/**
 * Deep links into the GHL / Lead Connector contact & conversation UI.
 * On mobile, white-label / app.gohighlevel.com contact URLs typically open the
 * LeadConnector app via universal links when installed.
 */
const { ghlCrmBaseUrl, ghlContactCrmUrl } = require('./websiteBuildLinks');

function ghlConversationCrmUrl({ dashboardUrl, locationId, conversationId } = {}) {
  const base = ghlCrmBaseUrl(dashboardUrl);
  const loc = String(locationId || '').trim();
  const id = String(conversationId || '').trim();
  if (!loc || !id) return '';
  return `${base}/v2/location/${encodeURIComponent(loc)}/conversations/conversations/${encodeURIComponent(id)}`;
}

/**
 * Best URL to open this contact in Lead Connector / GHL.
 * Prefer conversation for SMS replies; otherwise the contact detail page (Call lives there).
 */
function leadConnectorOpenUrl({
  dashboardUrl,
  locationId,
  contactId,
  conversationId,
  preferConversation = false,
} = {}) {
  if (preferConversation) {
    const conv = ghlConversationCrmUrl({ dashboardUrl, locationId, conversationId });
    if (conv) return conv;
  }
  return ghlContactCrmUrl({ dashboardUrl, locationId, contactId }) || '';
}

module.exports = {
  ghlConversationCrmUrl,
  leadConnectorOpenUrl,
};
