const dbService = require('./database');

/**
 * @param {string} email
 * @returns {Promise<string|null>}
 */
async function getValidAccessToken(email) {
  const em = String(email || '').trim().toLowerCase();
  if (!em) return null;
  const row = await dbService.getGoogleDriveTokens(em);
  if (!row || !row.refreshToken) return null;

  const skew = 120_000;
  if (row.accessToken && row.expiresAt && Number(row.expiresAt) > Date.now() + skew) {
    return String(row.accessToken);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: String(row.refreshToken),
    grant_type: 'refresh_token',
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    console.warn('[googleDriveAccess] refresh failed', res.status, json.error || json);
    return null;
  }

  await dbService.mergeGoogleDriveTokens(em, {
    accessToken: json.access_token,
    refreshToken: json.refresh_token || undefined,
    expiresIn: json.expires_in,
  });
  return String(json.access_token);
}

module.exports = { getValidAccessToken };
