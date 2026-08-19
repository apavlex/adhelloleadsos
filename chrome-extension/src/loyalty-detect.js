/**
 * Conservative on-site loyalty / rewards program detector.
 * Pure: HTML or text in → found / not found. No network.
 */
(function (root) {
  'use strict';

  const STRONG_PHRASE_RES = [
    /loyalty\s+program/i,
    /loyalty\s+rewards/i,
    /rewards?\s+program/i,
    /rewards?\s+club/i,
    /loyalty\s+club/i,
    /join\s+our\s+rewards/i,
    /join\s+(our\s+)?loyalty/i,
    /join\s+our\s+vip/i,
    /punch[\s-]?cards?/i,
    /stamp[\s-]?cards?/i,
    /points\s+for\s+every\s+(visit|purchase|dollar|order|stay)/i,
    /earn\s+points\s+(with|on|for)\s+(every|each|your)/i,
    /vip\s+club/i,
    /vip\s+rewards/i,
    /member\s+rewards/i,
    /rewards\s+members?/i,
    /our\s+rewards\s+program/i,
    /buy\s+\d+\s+get\s+\d+/i,
    /\d+(?:st|nd|rd|th)\s+visit\s+free/i,
  ];

  const PATH_HINT_RE =
    /\/(loyalty|loyalties|rewards?|reward-program|loyalty-program|punch-?cards?|stamp-?cards?|vip-?club|vip-rewards|points-club|member-rewards)(\b|\/|$|\?)/i;

  const LINK_TEXT_RE =
    /\b(loyalty(\s+program|\s+rewards|\s+club)?|rewards?\s+(club|program|members?)|punch[\s-]?card|stamp[\s-]?card|vip\s+club|points\s+club|member\s+rewards|join\s+rewards)\b/i;

  const LINK_LABEL_RE = /^(loyalty|rewards?|points|punch[\s-]?card|stamp[\s-]?card|vip(\s+club)?)$/i;

  const THIRD_PARTY_RE =
    /\b(american\s+express|\bamex\b|marriott(\s+bonvoy)?|hilton\s+honors|ihg\s+rewards|aadvantage|mileageplus|skymiles|united\s+mileage|delta\s+skymiles|airline\s+miles|chase\s+sapphire|capital\s+one\s+miles|credit\s+card\s+rewards|uber\s+rewards|airbnb\s+plus)\b/i;

  const SKIP_HREF_RE = /^(mailto:|tel:|javascript:|sms:|#)/i;

  function htmlToText(html) {
    return String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&quot;/gi, '"')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function originOf(url) {
    try {
      return new URL(String(url || '')).origin;
    } catch (_) {
      return '';
    }
  }

  function sameOrigin(a, b) {
    const oa = originOf(a);
    const ob = originOf(b);
    return !!(oa && ob && oa === ob);
  }

  function absolutize(href, baseUrl) {
    const raw = String(href || '').trim();
    if (!raw || SKIP_HREF_RE.test(raw)) return '';
    try {
      return new URL(raw, baseUrl || undefined).href;
    } catch (_) {
      return '';
    }
  }

  function extractLinksFromHtml(html, baseUrl) {
    const links = [];
    const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
    let m;
    const src = String(html || '');
    while ((m = re.exec(src))) {
      const attrs = m[1] || '';
      const hrefMatch = attrs.match(/\bhref\s*=\s*(["'])([^"']*)\1/i) || attrs.match(/\bhref\s*=\s*([^\s>]+)/i);
      const href = hrefMatch ? String(hrefMatch[2] || hrefMatch[1] || '').trim() : '';
      const text = htmlToText(m[2] || '').slice(0, 160);
      const abs = absolutize(href, baseUrl);
      if (abs) links.push({ href: abs, text });
    }
    return links;
  }

  function snippetAround(text, index, len) {
    const start = Math.max(0, index - 40);
    const end = Math.min(text.length, index + len + 80);
    let snip = text.slice(start, end).replace(/\s+/g, ' ').trim();
    if (start > 0) snip = `…${snip}`;
    if (end < text.length) snip = `${snip}…`;
    return snip.slice(0, 220);
  }

  function isThirdPartyContext(text, index) {
    const windowStart = Math.max(0, index - 80);
    const windowEnd = Math.min(text.length, index + 120);
    return THIRD_PARTY_RE.test(text.slice(windowStart, windowEnd));
  }

  function findStrongPhrase(text) {
    const src = String(text || '');
    for (const re of STRONG_PHRASE_RES) {
      re.lastIndex = 0;
      const m = re.exec(src);
      if (!m) continue;
      if (isThirdPartyContext(src, m.index)) continue;
      return { evidence: snippetAround(src, m.index, m[0].length), match: m[0] };
    }
    return null;
  }

  function pathLooksLikeLoyalty(url) {
    try {
      const u = new URL(String(url || ''));
      return PATH_HINT_RE.test(`${u.pathname}${u.search}`);
    } catch (_) {
      return PATH_HINT_RE.test(String(url || ''));
    }
  }

  function linkLooksLikeLoyalty(link) {
    const href = String(link?.href || '');
    const text = String(link?.text || '').trim();
    if (pathLooksLikeLoyalty(href)) return true;
    if (LINK_LABEL_RE.test(text)) return true;
    if (LINK_TEXT_RE.test(text) && text.length < 80) return true;
    return false;
  }

  function normalizePages(input) {
    const pageUrl = String(input.pageUrl || input.url || '');
    let text = String(input.pageText || input.text || '');
    let links = Array.isArray(input.links) ? input.links.slice() : [];
    if (input.html) {
      if (!text) text = htmlToText(input.html);
      if (!links.length) links = extractLinksFromHtml(input.html, pageUrl);
    }
    const pages = [{ url: pageUrl, text, links }];
    if (Array.isArray(input.extraPages)) {
      for (const extra of input.extraPages) {
        if (!extra) continue;
        let extraText = String(extra.pageText || extra.text || '');
        let extraLinks = Array.isArray(extra.links) ? extra.links : [];
        if (extra.html) {
          if (!extraText) extraText = htmlToText(extra.html);
          if (!extraLinks.length) extraLinks = extractLinksFromHtml(extra.html, extra.url || pageUrl);
        }
        pages.push({
          url: String(extra.url || extra.pageUrl || ''),
          text: extraText,
          links: extraLinks,
        });
      }
    }
    return pages;
  }

  function pickCandidateUrls(snapshot, origin) {
    const pageUrl = String(snapshot?.pageUrl || snapshot?.url || '');
    const baseOrigin = origin || originOf(pageUrl);
    const seen = new Set();
    const out = [];
    const links = Array.isArray(snapshot?.links) ? snapshot.links : [];
    for (const link of links) {
      const href = absolutize(link?.href, pageUrl);
      if (!href) continue;
      if (baseOrigin && !sameOrigin(href, baseOrigin)) continue;
      try {
        const u = new URL(href);
        u.hash = '';
        const key = u.href;
        if (seen.has(key)) continue;
        if (key === pageUrl) continue;
        if (!linkLooksLikeLoyalty({ href: key, text: link?.text })) continue;
        seen.add(key);
        out.push(key);
      } catch (_) {
        /* skip */
      }
      if (out.length >= 5) break;
    }
    return out;
  }

  function collectSnapshot(doc, loc) {
    const pageUrl = String((loc && loc.href) || '');
    let origin = '';
    try {
      origin = new URL(pageUrl).origin;
    } catch (_) {
      origin = '';
    }
    const body = doc && doc.body;
    const pageText = String((body && (body.innerText || body.textContent)) || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80000);
    const links = [];
    const nodes = doc && doc.querySelectorAll ? doc.querySelectorAll('a[href]') : [];
    for (const a of nodes) {
      const href = String(a.href || a.getAttribute('href') || '').trim();
      const text = String(a.textContent || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
      if (href) links.push({ href, text });
    }
    return { pageUrl, origin, pageText, links };
  }

  function detectLoyaltyProgram(input) {
    const pages = normalizePages(input || {});
    const pageUrl = pages[0]?.url || String(input?.pageUrl || input?.url || '');

    function firstLoyaltyLinkUrl(page) {
      const links = Array.isArray(page?.links) ? page.links : [];
      for (const link of links) {
        const href = absolutize(link.href, page.url || pageUrl);
        if (!href) continue;
        if (pageUrl && !sameOrigin(href, pageUrl) && originOf(pageUrl)) continue;
        if (!linkLooksLikeLoyalty({ href, text: link.text })) continue;
        if (THIRD_PARTY_RE.test(String(link.text || href))) continue;
        return href;
      }
      return '';
    }

    for (const page of pages) {
      const phrase = findStrongPhrase(page.text);
      if (phrase) {
        return {
          found: true,
          evidence: phrase.evidence,
          url: firstLoyaltyLinkUrl(page) || page.url || pageUrl,
          reason: 'on-site program language',
        };
      }
    }

    for (const page of pages) {
      const links = Array.isArray(page.links) ? page.links : [];
      for (const link of links) {
        const href = absolutize(link.href, page.url || pageUrl);
        if (!href) continue;
        if (pageUrl && !sameOrigin(href, pageUrl) && originOf(pageUrl)) continue;
        if (!linkLooksLikeLoyalty({ href, text: link.text })) continue;
        const around = String(link.text || href);
        if (THIRD_PARTY_RE.test(around)) continue;
        return {
          found: true,
          evidence: String(link.text || '').trim() || href,
          url: href,
          reason: 'on-site rewards/loyalty link',
        };
      }
    }

    return {
      found: false,
      evidence: '',
      url: pageUrl,
      reason: 'no on-site loyalty program signals',
    };
  }

  const api = {
    detectLoyaltyProgram,
    collectSnapshot,
    pickCandidateUrls,
    extractLinksFromHtml,
    htmlToText,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.AdHelloLoyaltyDetect = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : self);
