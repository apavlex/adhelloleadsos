const net = require('net');
const { normalizeUrl, DEFAULT_UA } = require('./staticHtmlFetch');

const CACHE = new Map();
const CACHE_MAX = 80;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

let browserInst = null;
let browserLaunchPromise = null;

function isBlockedHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!h || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  const ipVersion = net.isIP(h);
  if (ipVersion === 4) {
    const [a, b] = h.split('.').map((x) => parseInt(x, 10));
    if (a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 0) return true;
  }
  if (ipVersion === 6) {
    if (h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true;
  }
  return false;
}

function assertPreviewUrl(raw) {
  const normalized = normalizeUrl(raw);
  if (!normalized) return '';
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    return '';
  }
  if (!/^https?:$/i.test(parsed.protocol)) return '';
  if (isBlockedHost(parsed.hostname)) return '';
  return parsed.toString();
}

async function getBrowser() {
  if (browserInst && typeof browserInst.isConnected === 'function' && browserInst.isConnected()) {
    return browserInst;
  }
  if (browserLaunchPromise) return browserLaunchPromise;
  browserLaunchPromise = (async () => {
    let puppeteer;
    try {
      puppeteer = require('puppeteer');
    } catch {
      throw new Error('Puppeteer is not installed');
    }
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    });
    browser.on('disconnected', () => {
      browserInst = null;
      browserLaunchPromise = null;
    });
    browserInst = browser;
    return browser;
  })();
  try {
    return await browserLaunchPromise;
  } finally {
    browserLaunchPromise = null;
  }
}

async function captureMshots(url, width) {
  const shotUrl = `https://s0.wp.com/mshots/v1/${encodeURIComponent(url)}?w=${width}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 22000);
  try {
    const res = await fetch(shotUrl, { signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 800) return null;
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    return { buffer, contentType, source: 'mshots' };
  } catch (e) {
    console.warn('[websitePreview] mshots failed:', e.message);
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function captureWithPuppeteer(url, width, height) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width, height: height + 120, deviceScaleFactor: 1 });
    await page.setUserAgent(DEFAULT_UA);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await new Promise((r) => setTimeout(r, 700));
    const buffer = await page.screenshot({
      type: 'jpeg',
      quality: 74,
      clip: { x: 0, y: 0, width, height: Math.min(height + 120, 900) },
    });
    return { buffer, contentType: 'image/jpeg', source: 'puppeteer' };
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * @param {string} rawUrl
 * @param {{ width?: number, height?: number }} [opts]
 */
async function getWebsitePreviewImage(rawUrl, opts = {}) {
  const url = assertPreviewUrl(rawUrl);
  if (!url) return null;

  const width = Math.min(900, Math.max(320, parseInt(opts.width, 10) || 520));
  const height = Math.min(700, Math.max(200, parseInt(opts.height, 10) || 340));
  const cacheKey = `${url}|${width}|${height}`;
  const cached = CACHE.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.payload;

  let payload = null;
  try {
    payload = await captureWithPuppeteer(url, width, height);
  } catch (e) {
    console.warn('[websitePreview] puppeteer failed:', url, e.message);
  }
  if (!payload) payload = await captureMshots(url, width);
  if (!payload) return null;

  CACHE.set(cacheKey, { at: Date.now(), payload });
  if (CACHE.size > CACHE_MAX) {
    const first = CACHE.keys().next().value;
    CACHE.delete(first);
  }
  return payload;
}

module.exports = {
  assertPreviewUrl,
  getWebsitePreviewImage,
  isBlockedHost,
};
