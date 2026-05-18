/** Browser Maps / Static / Embed / Geocoding — single env key (trimmed). */
function getGoogleMapsApiKey() {
  return String(process.env.GOOGLE_MAPS_API_KEY || '').trim() || null;
}

module.exports = { getGoogleMapsApiKey };
