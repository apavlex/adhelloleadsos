const express = require('express');
const router = express.Router();
const https = require('https');
const http = require('http');

function fetchPage(url, timeout=5000) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {headers:{'User-Agent':'Mozilla/5.0','Accept':'text/html'},timeout}, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
        return fetchPage(res.headers.location, timeout).then(resolve).catch(reject);
      let html = '';
      res.setEncoding('utf8');
      res.on('data', c => { html += c; if(html.length>150000){req.destroy();resolve(html);} });
      res.on('end', () => resolve(html));
      res.on('error', reject);
    });
    req.on('error', reject);
    setTimeout(() => { req.destroy(); reject(new Error('timeout')); }, timeout);
  });
}

function extractSocials(html) {
  const result = {};
  const skip = ['sharer','share?','dialog','plugins','tr?','intent','home?','search?','/p/','/reel/'];
  const patterns = {
    facebook: /https?:\/\/(?:www\.)?facebook\.com\/([a-zA-Z0-9._%-]+)/gi,
    instagram: /https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9._]+)/gi,
    twitter: /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/([a-zA-Z0-9_]+)/gi,
  };
  for (const [net, pat] of Object.entries(patterns)) {
    pat.lastIndex = 0;
    let m;
    while ((m = pat.exec(html)) !== null) {
      const url = m[0].split('"')[0].split("'")[0].replace(/\/$/,'');
      if (skip.some(s => url.includes(s))) continue;
      result[net] = url; break;
    }
  }
  return result;
}

router.get('/', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.json({});
  try { res.json(extractSocials(await fetchPage(url))); }
  catch { res.json({}); }
});

module.exports = router;
