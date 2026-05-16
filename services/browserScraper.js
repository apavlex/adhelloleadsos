/**
 * Dynamic page capture (Playwright / Selenium-equivalent: Puppeteer by default).
 */

const { DEFAULT_UA } = require('./staticHtmlFetch');

const PUPPETEER_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];

function browserEngine() {
  const v = String(process.env.BROWSER_SCRAPER || 'puppeteer').toLowerCase().trim();
  return v === 'playwright' ? 'playwright' : 'puppeteer';
}

async function launchBrowser() {
  const engine = browserEngine();
  if (engine === 'playwright') {
    let playwright;
    try {
      playwright = require('playwright');
    } catch {
      throw new Error('BROWSER_SCRAPER=playwright but playwright is not installed. Run: npm install playwright');
    }
    const browser = await playwright.chromium.launch({
      headless: true,
      args: PUPPETEER_ARGS,
    });
    return { engine: 'playwright', browser, close: () => browser.close() };
  }

  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch {
    throw new Error('Puppeteer is not installed. Run npm install puppeteer');
  }
  const browser = await puppeteer.launch({
    headless: true,
    args: PUPPETEER_ARGS,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  });
  return { engine: 'puppeteer', browser, close: () => browser.close() };
}

async function scrollPage(page, engine, opts) {
  const steps = Number(opts.scrollSteps) > 0 ? Number(opts.scrollSteps) : 4;
  const pauseMs = Number(opts.scrollPauseMs) > 0 ? Number(opts.scrollPauseMs) : 650;
  for (let i = 0; i < steps; i += 1) {
    if (engine === 'playwright') {
      await page.evaluate(() => window.scrollBy(0, Math.max(400, window.innerHeight * 0.85)));
    } else {
      await page.evaluate(() => window.scrollBy(0, Math.max(400, window.innerHeight * 0.85)));
    }
    await new Promise((r) => setTimeout(r, pauseMs));
  }
}

/**
 * @param {string} url
 * @param {{ timeoutMs?: number, scrollSteps?: number }} [opts]
 */
async function scrapeDynamicHtml(url, opts = {}) {
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 45_000;
  const started = Date.now();
  let session;
  try {
    session = await launchBrowser();
    const { engine, browser } = session;

    if (engine === 'playwright') {
      const context = await browser.newContext({ userAgent: DEFAULT_UA });
      const page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
        await scrollPage(page, engine, opts);
        await new Promise((r) => setTimeout(r, 800));
        const html = await page.content();
        return {
          ok: true,
          status: 200,
          url: page.url(),
          html,
          error: '',
          method: 'playwright',
          fetchMs: Date.now() - started,
        };
      } finally {
        await context.close();
      }
    }

    const page = await browser.newPage();
    try {
      await page.setUserAgent(DEFAULT_UA);
      await page.setViewport({ width: 1280, height: 900 });
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      await scrollPage(page, engine, opts);
      await new Promise((r) => setTimeout(r, 800));
      const html = await page.content();
      return {
        ok: true,
        status: 200,
        url: page.url(),
        html,
        error: '',
        method: 'puppeteer',
        fetchMs: Date.now() - started,
      };
    } finally {
      await page.close();
    }
  } catch (e) {
    return {
      ok: false,
      status: 0,
      url,
      html: '',
      error: e && e.message ? String(e.message) : 'Browser scrape failed',
      method: browserEngine(),
      fetchMs: Date.now() - started,
    };
  } finally {
    if (session && session.close) await session.close();
  }
}

module.exports = {
  scrapeDynamicHtml,
  browserEngine,
  launchBrowser,
};
