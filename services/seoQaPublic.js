/**
 * Public feed + submit helpers for SEO Q&A pages.
 */
const notificationLog = require('./notificationLog');
const seoQaStore = require('./seoQaStore');

const submitHits = new Map();
const SUBMIT_WINDOW_MS = 60 * 60 * 1000;
const SUBMIT_MAX = 8;

function submitAllowed(ip) {
  const key = String(ip || 'unknown');
  const now = Date.now();
  const recent = (submitHits.get(key) || []).filter((t) => now - t < SUBMIT_WINDOW_MS);
  if (recent.length >= SUBMIT_MAX) return false;
  recent.push(now);
  submitHits.set(key, recent);
  if (submitHits.size > 8000) submitHits.clear();
  return true;
}

function buildFaqSchema(questions, pageUrl) {
  const entities = (Array.isArray(questions) ? questions : [])
    .filter((q) => q && q.published && q.status === 'answered' && q.answer)
    .map((q) => {
      const text = [q.answer, q.answerDetail].filter(Boolean).join(' ');
      return {
        '@type': 'Question',
        name: q.question,
        acceptedAnswer: { '@type': 'Answer', text },
      };
    });
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    ...(pageUrl ? { url: pageUrl } : {}),
    mainEntity: entities,
  };
}

function publicQuestionView(q) {
  return {
    id: q.id,
    question: q.question,
    context: q.context || '',
    category: q.category || 'General',
    author: q.author || 'Visitor',
    answer: q.answer || '',
    answer_detail: q.answerDetail || '',
    answer_by: q.answerBy || '',
    status: q.status,
    published: !!q.published,
    upvotes: q.upvotes || 0,
    link_text: q.linkText || '',
    link_url: q.linkUrl || '',
    created_at: q.createdAt || null,
    answered_at: q.answeredAt || null,
    published_at: q.publishedAt || null,
  };
}

async function loadByToken(token) {
  const workspaceId = await seoQaStore.resolveWorkspaceIdByToken(token);
  if (!workspaceId) return null;
  const bundle = await seoQaStore.ensurePublicToken(workspaceId);
  if (seoQaStore.clean(bundle.settings.publicToken, 80) !== seoQaStore.clean(token, 80)) {
    return null;
  }
  return { workspaceId, bundle };
}

async function getPublicFeed(token) {
  const resolved = await loadByToken(token);
  if (!resolved) {
    const err = new Error('Invalid or unknown publish token.');
    err.code = 'UNAUTHORIZED';
    throw err;
  }
  const { bundle } = resolved;
  const published = seoQaStore
    .listQuestions(bundle)
    .filter((q) => q.published && q.status === 'answered' && q.answer);
  const openCount = seoQaStore.listQuestions(bundle, { status: 'open' }).length;
  return {
    page: {
      title: bundle.settings.pageTitle || 'Questions & Answers',
      business_name: bundle.settings.businessName || '',
      page_url: bundle.settings.pageUrl || '',
      categories: bundle.settings.categories || [],
    },
    questions: published.map(publicQuestionView),
    faq_schema: buildFaqSchema(published, bundle.settings.pageUrl || ''),
    counts: {
      published: published.length,
      open: openCount,
    },
    seo_note:
      'Render these questions and answers in HTML on your page and inject faq_schema as JSON-LD so Google can index them.',
  };
}

async function submitPublicQuestion(token, input, { ip } = {}) {
  if (!submitAllowed(ip)) {
    const err = new Error('Too many questions from this network. Try again later.');
    err.code = 'RATE_LIMIT';
    throw err;
  }
  const resolved = await loadByToken(token);
  if (!resolved) {
    const err = new Error('Invalid or unknown publish token.');
    err.code = 'UNAUTHORIZED';
    throw err;
  }
  const { workspaceId, bundle } = resolved;
  const question = seoQaStore.clean(input && input.question, 500);
  if (question.length < 8) {
    const err = new Error('Please enter a longer question.');
    err.code = 'INVALID';
    throw err;
  }
  const cats = bundle.settings.categories || [];
  let category = seoQaStore.clean(input && input.category, 80) || 'General';
  if (cats.length && !cats.includes(category)) category = cats[0] || 'General';

  const row = await seoQaStore.upsertQuestion(workspaceId, {
    question,
    context: input && input.context,
    category,
    author: (input && input.author) || 'Visitor',
    status: 'open',
    published: false,
    source: 'submit',
  });

  if (bundle.settings.notifyOnSubmit !== false) {
    try {
      notificationLog.add(
        workspaceId,
        {
          title: 'New website Q&A question',
          body: `${row.author}: ${row.question}`.slice(0, 400),
          href: `/seo-qa?q=${encodeURIComponent(row.id)}`,
          linkLabel: 'Answer',
        },
        ''
      );
    } catch (_) {
      /* ignore */
    }
  }

  return {
    id: row.id,
    status: row.status,
    message: 'Thanks — our team will review your question.',
  };
}

module.exports = {
  buildFaqSchema,
  publicQuestionView,
  getPublicFeed,
  submitPublicQuestion,
  submitAllowed,
};
