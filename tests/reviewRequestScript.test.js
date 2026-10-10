const test = require('node:test');
const assert = require('node:assert/strict');
const review = require('../services/reviewRequestScript');

test('fillPlaceholders swaps name, company, and review link', () => {
  const out = review.fillPlaceholders(
    'Hi {{name}} from {{company}}: {{review_link}}',
    { name: 'Jamie Lee', company: 'Brightline Electric', reviewLink: 'https://app.example/rv/brightline' },
  );
  assert.equal(out, 'Hi Jamie from Brightline Electric: https://app.example/rv/brightline');
});

test('ensureReviewLink appends the URL when AI drops it', () => {
  const link = 'https://app.example/rv/brightline';
  assert.equal(review.ensureReviewLink(`Thanks! ${link}`, link), `Thanks! ${link}`);
  assert.match(review.ensureReviewLink('Thanks for choosing us!', link), new RegExp(link.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('buildReviewSms without AI fills the member script and keeps the link', async () => {
  const built = await review.buildReviewSms({
    member: {
      companyName: 'Brightline Electric',
      reviewSmsScript: 'Hey {{name}}, leave {{company}} a review {{review_link}}',
    },
    customerName: 'Jamie Lee',
    reviewLink: 'https://app.example/rv/brightline',
    useAi: false,
  });
  assert.equal(built.provider, 'script');
  assert.equal(built.message, 'Hey Jamie, leave Brightline Electric a review https://app.example/rv/brightline');
});

test('buildGhlReviewWorkflowPrompt includes script and review link for Workflow AI', () => {
  const prompt = review.buildGhlReviewWorkflowPrompt({
    companyName: 'Brightline Electric',
    reviewLink: 'https://app.example/rv/brightline',
    smsScript: 'Hi {{name}} — review {{company}}: {{review_link}}',
  });
  assert.match(prompt, /Go High Level workflow/i);
  assert.match(prompt, /https:\/\/app\.example\/rv\/brightline/);
  assert.match(prompt, /Brightline Electric/);
  assert.match(prompt, /\{\{contact\.first_name\}\}/);
});
