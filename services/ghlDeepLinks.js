/**
 * Deep links into the GHL / Lead Connector contact & conversation UI.
 *
 * Always use app.gohighlevel.com (not the white-label host like my.adhello.io).
 * White-label URLs open a browser login page and never hand off to the Lead
 * Connector mobile app. The native host is what Android (and sometimes iOS)
 * can associate with Lead Connector when the app is installed. GHL still does
 * not publish reliable contact deep links for every platform — if the app
 * does not claim the URL, the browser falls back to the web CRM.
 */
const LEAD_CONNECTOR_APP_HOST = 'https://app.gohighlevel.com';

function leadConnectorAppBaseUrl() {
  return LEAD_CONNECTOR_APP_HOST;
}

function ghlConversationCrmUrl({ locationId, conversationId } = {}) {
  const base = leadConnectorAppBaseUrl();
  const loc = String(locationId || '').trim();
  const id = String(conversationId || '').trim();
  if (!loc || !id) return '';
  return `${base}/v2/location/${encodeURIComponent(loc)}/conversations/conversations/${encodeURIComponent(id)}`;
}

function ghlContactAppUrl({ locationId, contactId } = {}) {
  const base = leadConnectorAppBaseUrl();
  const loc = String(locationId || '').trim();
  const id = String(contactId || '').trim();
  if (!loc || !id) return '';
  return `${base}/v2/location/${encodeURIComponent(loc)}/contacts/detail/${encodeURIComponent(id)}`;
}

/**
 * Best URL to open this contact in Lead Connector / GHL.
 * Prefer conversation for SMS replies; otherwise the contact detail page (Call lives there).
 * `dashboardUrl` is ignored — Lead Connector must use the native GHL host.
 */
function leadConnectorOpenUrl({
  locationId,
  contactId,
  conversationId,
  preferConversation = false,
} = {}) {
  if (preferConversation) {
    const conv = ghlConversationCrmUrl({ locationId, conversationId });
    if (conv) return conv;
  }
  return ghlContactAppUrl({ locationId, contactId }) || '';
}

module.exports = {
  LEAD_CONNECTOR_APP_HOST,
  leadConnectorAppBaseUrl,
  ghlConversationCrmUrl,
  ghlContactAppUrl,
  leadConnectorOpenUrl,
};
