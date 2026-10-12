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

test('maybeEnsureReviewLink respects scripts that omit the review link', () => {
  const link = 'https://app.example/rv/brightline';
  const noLinkScript = 'Hi {{name}} — thanks for choosing {{company}}! Leave a quick review :)';
  assert.equal(
    review.maybeEnsureReviewLink('Hi Jamie — thanks for choosing us! Leave a quick review :)', link, noLinkScript),
    'Hi Jamie — thanks for choosing us! Leave a quick review :)',
  );
  assert.equal(review.scriptWantsReviewLink(noLinkScript), false);
  assert.equal(review.scriptWantsReviewLink('See {{review_link}}'), true);
  assert.match(
    review.maybeEnsureReviewLink('Thanks!', link, 'Thanks! {{review_link}}'),
    new RegExp(link.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  );
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

test('buildReviewSms without AI does not force-append a removed review link', async () => {
  const built = await review.buildReviewSms({
    member: {
      companyName: 'Adhello Agency',
      reviewSmsScript: 'Hi {{name}} — thanks for choosing {{company}}! When you have a minute, leave a quick review :)',
    },
    customerName: 'Alex',
    reviewLink: 'https://leads.adhello.io/rv/adhello-agency',
    useAi: false,
  });
  assert.equal(built.provider, 'script');
  assert.equal(
    built.message,
    'Hi Alex — thanks for choosing Adhello Agency! When you have a minute, leave a quick review :)',
  );
  assert.doesNotMatch(built.message, /leads\.adhello\.io|review_link|https?:\/\//i);
});

test('buildGhlReviewWorkflowPrompt includes script and review link for Workflow AI', () => {
  const prompt = review.buildGhlReviewWorkflowPrompt({
    companyName: 'Brightline Electric',
    reviewLink: 'https://app.example/rv/brightline',
    smsScript: 'Hi {{name}} — review {{company}}: {{review_link}}',
  });
  assert.match(prompt, /GHL CRM workflow/i);
  assert.match(prompt, /https:\/\/app\.example\/rv\/brightline/);
  assert.match(prompt, /Brightline Electric/);
  assert.match(prompt, /\{\{contact\.first_name\}\}/);
  assert.match(prompt, /Include the review link/);
});

test('buildGhlReviewWorkflowPrompt does not require a link when script omits it', () => {
  const prompt = review.buildGhlReviewWorkflowPrompt({
    companyName: 'Adhello Agency',
    reviewLink: 'https://leads.adhello.io/rv/adhello-agency',
    smsScript: 'Hi {{name}} — thanks for choosing {{company}}!',
  });
  assert.match(prompt, /do not add a review link/i);
  assert.doesNotMatch(prompt, /Always include the review link/);
});
