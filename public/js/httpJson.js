/**
 * fetch() helper: never throws on HTML login/error pages; returns { ok, status, j }.
 */
async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (!ct.includes('application/json')) {
    const text = await res.text();
    const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 120);
    if (res.status === 401 || res.redirected || /^<!DOCTYPE/i.test(text)) {
      throw new Error('Session expired or not signed in. Refresh the page and sign in again.');
    }
    throw new Error(snippet || `Request failed (${res.status})`);
  }
  const j = await res.json();
  return { ok: res.ok, status: res.status, j };
}

if (typeof window !== 'undefined') {
  window.fetchJson = fetchJson;
}
