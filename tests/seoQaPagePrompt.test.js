const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildSeoQaPagePrompt } = require('../services/seoQaPagePrompt');

describe('SEO Q&A page-builder prompt', () => {
  it('includes TPR reference, feed/submit URLs, and SEO rules', () => {
    const prompt = buildSeoQaPagePrompt({
      siteUrl: 'https://adhello.io',
      pagePath: '/questions',
      businessName: 'AdHello',
      pageTitle: 'Questions & Answers',
      categories: ['General', 'Pricing'],
      feedUrl: 'https://leads.adhello.io/api/public/seo-qa/tok/feed.json',
      submitUrl: 'https://leads.adhello.io/api/public/seo-qa/tok/questions',
    });
    assert.match(prompt, /tprflooring\.com\/flooring-questions/);
    assert.match(prompt, /adhello\.io/);
    assert.match(prompt, /AdHello/);
    assert.match(prompt, /feed\.json/);
    assert.match(prompt, /\/questions/);
    assert.match(prompt, /faq_schema/);
    assert.match(prompt, /JSON-LD/);
    assert.match(prompt, /Pricing/);
  });

  it('is exposed on the Q&A dashboard with a copy control', () => {
    const route = fs.readFileSync(path.join(__dirname, '../routes/seoQa.js'), 'utf8');
    const view = fs.readFileSync(path.join(__dirname, '../views/seo_qa.ejs'), 'utf8');
    assert.match(route, /buildSeoQaPagePrompt/);
    assert.match(route, /pageBuilderPrompt/);
    assert.match(view, /sqaCopyPromptBtn/);
    assert.match(view, /Page-builder prompt/);
  });
});
