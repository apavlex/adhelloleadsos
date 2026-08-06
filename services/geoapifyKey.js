/** Geoapify Static Maps + Geocoding — free tier 3,000 credits/day. */
function getGeoapifyApiKey() {
  return String(process.env.GEOAPIFY_API_KEY || '').trim() || null;
}

module.exports = { getGeoapifyApiKey };
