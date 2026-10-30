/**
 * Import Q&A content from an existing public page (FAQ schema + article markup).
 */
const seoQaStore = require('./seoQaStore');

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripTags(html) {
  return decodeEntities(String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function extractFaqSchema(html) {
  const out = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const json = JSON.parse(m[1]);
      const nodes = Array.isArray(json) ? json : [json];
      for (const node of nodes) {
        if (!node || typeof node !== 'object') continue;
        const type = String(node['@type'] || '');
        if (type !== 'FAQPage' && !(Array.isArray(node['@type']) && node['@type'].includes('FAQPage'))) {
          continue;
        }
        const entities = Array.isArray(node.mainEntity) ? node.mainEntity : [];
        for (const ent of entities) {
          if (!ent || ent['@type'] !== 'Question') continue;
          const question = stripTags(ent.name);
          const answer = stripTags(ent.acceptedAnswer && ent.acceptedAnswer.text);
          if (!question || !answer) continue;
          out.push({
            importKey: `faq:${question.toLowerCase().slice(0, 100)}`,
            question,
            answer,
            answerDetail: '',
            author: 'FAQ',
            category: 'General',
            status: 'answered',
            source: 'import-faq',
          });
        }
      }
    } catch (_) {
      /* ignore bad json-ld */
    }
  }
  return out;
}

function extractArticles(html) {
  const out = [];
  const articleRe = /<article\b[^>]*>([\s\S]*?)<\/article>/gi;
  let m;
  while ((m = articleRe.exec(html))) {
    const block = m[1];
    const qMatch = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
    if (!qMatch) continue;
    const question = stripTags(qMatch[1]);
    if (!question) continue;
    const categoryMatch = block.match(/<span[^>]*>([^<]{2,40})<\/span>\s*<span[^>]*>\s*(Answered|Open)\s*<\/span>/i);
    const category = categoryMatch ? stripTags(categoryMatch[1]) : 'General';
    const authorMatch = block.match(/Answered<\/span>\s*<span[^>]*>([^<]+)<\/span>/i)
      || block.match(/Open<\/span>\s*<span[^>]*>([^<]+)<\/span>/i);
    let author = authorMatch ? stripTags(authorMatch[1]).replace(/\s*·\s*.*$/, '').trim() : 'Visitor';
    const upvoteMatch = block.match(/aria-label="Upvote this question"[\s\S]*?<span[^>]*>(\d+)<\/span>/i);
    const upvotes = upvoteMatch ? Number(upvoteMatch[1]) || 0 : 0;

    // Context: first <p> after h3 that is not inside the answer card
    let context = '';
    const afterH3 = block.slice(block.indexOf(qMatch[0]) + qMatch[0].length);
    const pMatch = afterH3.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    if (pMatch) context = stripTags(pMatch[1]);

    // Answer: look for business name + following paragraph pattern
    let answer = '';
    let answerBy = '';
    const answerBlock = afterH3.match(/<div>\s*<p[^>]*>([^<]{2,120})<\/p>\s*<p[^>]*>([\s\S]*?)<\/p>\s*<\/div>/i);
    if (answerBlock) {
      answerBy = stripTags(answerBlock[1]);
      answer = stripTags(answerBlock[2]);
      // If first p was context and second pair is answer, prefer the longer answer-looking text
      if (context && answerBy === context) {
        // fall through
      }
    }
    // If FAQ schema already has this question we still keep article metadata
    out.push({
      importKey: `page:${question.toLowerCase().slice(0, 100)}`,
      question,
      context: context && context !== answer ? context : '',
      category,
      author: author || 'Visitor',
      answer,
      answerBy,
      upvotes,
      status: answer ? 'answered' : 'open',
      source: 'import-page',
    });
  }
  return out;
}

function mergeImportRows(faqRows, articleRows) {
  const byQ = new Map();
  for (const row of [...faqRows, ...articleRows]) {
    const key = seoQaStore.clean(row.question, 500).toLowerCase();
    if (!key) continue;
    const prev = byQ.get(key);
    if (!prev) {
      byQ.set(key, { ...row });
      continue;
    }
    byQ.set(key, {
      ...prev,
      ...row,
      answer: row.answer || prev.answer,
      answerDetail: row.answerDetail || prev.answerDetail,
      answerBy: row.answerBy || prev.answerBy,
      context: row.context || prev.context,
      category: row.category && row.category !== 'General' ? row.category : prev.category,
      author: row.author && row.author !== 'FAQ' ? row.author : prev.author,
      upvotes: Math.max(Number(prev.upvotes) || 0, Number(row.upvotes) || 0),
      importKey: prev.importKey || row.importKey,
    });
  }
  return [...byQ.values()];
}

async function fetchPageHtml(pageUrl) {
  const url = String(pageUrl || '').trim();
  if (!/^https?:\/\//i.test(url)) {
    const err = new Error('Enter a full http(s) URL to import from.');
    err.code = 'INVALID_URL';
    throw err;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'AdHelloSeoQaImport/1.0 (+https://adhello.io)',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });
    if (!res.ok) {
      const err = new Error(`Could not fetch page (${res.status}).`);
      err.code = 'FETCH_FAILED';
      throw err;
    }
    const html = await res.text();
    if (!html || html.length < 40) {
      const err = new Error('Page returned empty HTML.');
      err.code = 'EMPTY';
      throw err;
    }
    return html;
  } finally {
    clearTimeout(timer);
  }
}

async function importFromUrl(workspaceId, pageUrl, opts = {}) {
  const html = await fetchPageHtml(pageUrl);
  const faqRows = extractFaqSchema(html);
  const articleRows = extractArticles(html);
  const rows = mergeImportRows(faqRows, articleRows);
  if (!rows.length) {
    const err = new Error('No questions found. The page needs FAQ schema or article Q&A markup.');
    err.code = 'NONE_FOUND';
    throw err;
  }
  const result = await seoQaStore.mergeImported(workspaceId, rows, {
    publishImported: opts.publishImported !== false,
  });
  // Remember the page URL on settings
  const bundle = await seoQaStore.load(workspaceId);
  await seoQaStore.save(workspaceId, {
    settings: { ...bundle.settings, pageUrl: String(pageUrl).trim() },
    questions: bundle.questions,
  });
  return {
    ...result,
    imported: rows.length,
    fromFaq: faqRows.length,
    fromArticles: articleRows.length,
  };
}

module.exports = {
  extractFaqSchema,
  extractArticles,
  mergeImportRows,
  fetchPageHtml,
  importFromUrl,
};
