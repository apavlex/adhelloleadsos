const dbService = require('./database');
const { getPublicBaseUrl, googleOAuthRedirectUris } = require('../lib/publicBaseUrl');

/**
 * @param {string} accessToken
 * @returns {Promise<{ email: string, displayName: string }|null>}
 */
async function fetchGoogleUserInfo(accessToken) {
  if (!accessToken) return null;
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const json = await res.json().catch(() => null);
  if (!json || !json.email) return null;
  return {
    email: String(json.email).trim().toLowerCase(),
    displayName: String(json.name || json.email).trim(),
  };
}

/**
 * Linked Google account for Drive (stored at connect, or backfilled from userinfo).
 * @param {string} email — AdHello user email
 * @returns {Promise<{ email: string, displayName: string }|null>}
 */
async function getGoogleDriveAccount(email) {
  const em = String(email || '').trim().toLowerCase();
  if (!em) return null;
  const row = await dbService.getGoogleDriveTokens(em);
  if (!row || !row.refreshToken) return null;
  if (row.googleAccountEmail) {
    return {
      email: row.googleAccountEmail,
      displayName: row.googleAccountName || row.googleAccountEmail,
    };
  }
  const token = await getValidAccessToken(em);
  if (!token) return null;
  const info = await fetchGoogleUserInfo(token);
  if (!info) return null;
  await dbService.mergeGoogleDriveTokens(em, {
    googleAccountEmail: info.email,
    googleAccountName: info.displayName,
  });
  return info;
}

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

/**
 * Locals for Pipeline / Leads nav (Drive connect pill + picker).
 * @param {import('express').Request} req
 * @param {string} userEmail
 */
async function buildDriveImportBundle(req, userEmail) {
  const email = String(userEmail || '').trim().toLowerCase();
  const driveTokens = email ? await dbService.getGoogleDriveTokens(email) : null;
  const connected = !!(driveTokens && driveTokens.refreshToken);
  let googleAccountEmail = (driveTokens && driveTokens.googleAccountEmail) || '';
  let googleAccountName = (driveTokens && driveTokens.googleAccountName) || '';
  if (connected && !googleAccountEmail) {
    const acct = await getGoogleDriveAccount(email);
    if (acct) {
      googleAccountEmail = acct.email;
      googleAccountName = acct.displayName;
    }
  }
  const oauthBase = getPublicBaseUrl(req);
  return {
    pickerReady: Boolean(
      process.env.GOOGLE_CLIENT_ID &&
        process.env.GOOGLE_CLIENT_SECRET &&
        process.env.GOOGLE_PICKER_API_KEY
    ),
    connected,
    googleAccountEmail,
    googleAccountName,
    driveConnectedBanner: req.query.driveConnected === '1',
    driveOAuthError: req.query.driveError === 'oauth',
    oauthRedirects: googleOAuthRedirectUris(oauthBase),
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    pickerApiKey: process.env.GOOGLE_PICKER_API_KEY || '',
    setupHint:
      Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) &&
      !process.env.GOOGLE_PICKER_API_KEY,
  };
}

module.exports = {
  getValidAccessToken,
  getGoogleDriveAccount,
  buildDriveImportBundle,
};
