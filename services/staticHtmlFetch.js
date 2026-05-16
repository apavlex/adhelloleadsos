const DEFAULT_TIMEOUT_MS = 18_000;
const MAX_HTML_BYTES = 2_500_000;
const DEFAULT_UA =
  'Mozilla/5.0 (compatible; AdHelloLeadBot/1.0; +https://adhello.ai) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function normalizeUrl(raw) {
  const s = String(raw || '').trim();
  if (!s || s === 'N/A') return '';
  try {
    return new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`).toString();
  } catch {
    return '';
  }
}

/**
 * Fetch HTML with native fetch (Requests-equivalent for static pages).
 * @param {string} url
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<{ ok: boolean, status: number, url: string, html: string, error: string }>}
 */
async function fetchStaticHtml(url, opts = {}) {
  const absolute = normalizeUrl(url);
  if (!absolute) {
    return { ok: false, status: 0, url: '', html: '', error: 'Invalid URL' };
  }

  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = Date.now();

  try {
    const res = await fetch(absolute, {
      method: 'GET',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'User-Agent': DEFAULT_UA,
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    const buf = await res.arrayBuffer();
    const slice = buf.byteLength > MAX_HTML_BYTES ? buf.slice(0, MAX_HTML_BYTES) : buf;
    const html = new TextDecoder('utf-8', { fatal: false }).decode(slice);
    return {
      ok: res.ok,
      status: res.status,
      url: res.url || absolute,
      html,
      error: res.ok ? '' : `HTTP ${res.status}`,
      fetchMs: Date.now() - started,
      method: 'static',
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      url: absolute,
      html: '',
      error: e && e.message ? String(e.message) : 'Fetch failed',
      fetchMs: Date.now() - started,
      method: 'static',
    };
  } finally {
    clearTimeout(t);
  }
}

module.exports = { fetchStaticHtml, normalizeUrl, DEFAULT_UA, MAX_HTML_BYTES };
