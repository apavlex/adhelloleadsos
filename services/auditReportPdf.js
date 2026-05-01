let puppeteer;

async function renderAuditReportPdfBuffer(reportUrl) {
  try {
    puppeteer = puppeteer || require('puppeteer');
  } catch (e) {
    const err = new Error('Puppeteer is not installed. Run npm install puppeteer to enable PDF export.');
    err.code = 'PUPPETEER_MISSING';
    throw err;
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 1600, deviceScaleFactor: 1 });
    await page.goto(reportUrl, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.emulateMediaType('print');
    const buf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '0.5in', bottom: '0.5in', left: '0.6in', right: '0.6in' },
    });
    return buf;
  } finally {
    await browser.close();
  }
}

module.exports = {
  renderAuditReportPdfBuffer,
};
