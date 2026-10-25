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

test('fillPlaceholders swaps job, city, and keywords', () => {
  const out = review.fillPlaceholders(
    'Please mention {{keywords}} ({{job}} in {{city}})',
    {
      name: 'Sam',
      company: 'Cabinets Pro',
      reviewLink: 'https://x.test/rv/c',
      jobTitle: 'cabinet install',
      city: 'Camas',
    },
  );
  assert.equal(out, 'Please mention cabinet install in Camas (cabinet install in Camas)');
});

test('cityFromAddress and buildKeywordHint build SEO phrases', () => {
  assert.equal(review.cityFromAddress('12 Oak St, Camas, WA 98607'), 'Camas');
  assert.equal(
    review.buildKeywordHint({ jobTitle: 'cabinet install', city: 'Camas' }),
    'cabinet install in Camas',
  );
  const resolved = review.resolveReviewKeywords({
    customer: { address: '9 Main, Camas, WA 98607' },
    jobs: [
      { id: 'j1', title: 'Fence repair', status: 'scheduled', updatedAt: '2026-01-01' },
      { id: 'j2', title: 'cabinet install', status: 'completed', completedAt: '2026-02-01' },
    ],
  });
  assert.equal(resolved.keywords, 'cabinet install in Camas');
  assert.equal(resolved.jobTitle, 'cabinet install');
  assert.equal(resolved.city, 'Camas');
});

test('member defaults fill keywords when customer has no job or city', () => {
  const defs = review.memberKeywordDefaults({
    reviewKeywordJob: 'roof repair',
    reviewKeywordCity: 'Vancouver',
  });
  assert.equal(defs.jobTitle, 'roof repair');
  assert.equal(defs.city, 'Vancouver');
  const resolved = review.resolveReviewKeywords({
    customer: { address: '' },
    jobs: [],
    defaults: defs,
  });
  assert.equal(resolved.keywords, 'roof repair in Vancouver');
  assert.equal(resolved.jobTitle, 'roof repair');
  assert.equal(resolved.city, 'Vancouver');
});

test('explicit reviewKeywords override wins over job+city composition', () => {
  const resolved = review.resolveReviewKeywords({
    defaults: {
      jobTitle: 'cabinet install',
      city: 'Camas',
      keywords: 'custom kitchen remodel near Camas',
    },
  });
  assert.equal(resolved.keywords, 'custom kitchen remodel near Camas');
});

test('customer job beats member defaults', () => {
  const resolved = review.resolveReviewKeywords({
    customer: { address: '1 Oak, Camas, WA 98607' },
    jobs: [{ id: 'j1', title: 'deck build', status: 'completed', completedAt: '2026-03-01' }],
    defaults: { jobTitle: 'cabinet install', city: 'Portland' },
  });
  assert.equal(resolved.jobTitle, 'deck build');
  assert.equal(resolved.city, 'Camas');
  assert.equal(resolved.keywords, 'deck build in Camas');
});

test('DEFAULT_SMS_SCRIPT includes keywords placeholder', () => {
  assert.match(review.DEFAULT_SMS_SCRIPT, /\{\{\s*keywords\s*\}\}/);
  assert.match(review.KEYWORDS_SCRIPT_SNIPPET, /\{\{\s*keywords\s*\}\}/);
});

test('ensureReviewLink and placeReviewLinkAtEnd put the URL last for previews', () => {
  const link = 'https://app.example/rv/brightline';
  assert.equal(
    review.placeReviewLinkAtEnd(`Thanks! ${link} Please mention the cabinets.`, link),
    `Thanks! Please mention the cabinets.\n\n${link}`,
  );
  assert.equal(review.ensureReviewLink(`Thanks! ${link}`, link), `Thanks!\n\n${link}`);
  assert.equal(
    review.ensureReviewLink('Thanks for choosing us!', link),
    `Thanks for choosing us!\n\n${link}`,
  );
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
  // Link is moved to the end (own paragraph) so iMessage/SMS can unfurl the preview.
  assert.equal(
    built.message,
    'Hey Jamie, leave Brightline Electric a review\n\nhttps://app.example/rv/brightline',
  );
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

test('maybeAttachVcardUrl keeps review link last for OG unfurl', () => {
  const reviewLink = 'https://reviews.adhello.io/rv/brightline';
  const vcard = 'https://reviews.adhello.io/c/brightline.vcf';
  assert.equal(
    review.maybeAttachVcardUrl('Thanks!', vcard, { attach: false }),
    'Thanks!',
  );
  assert.equal(
    review.maybeAttachVcardUrl('Thanks!', vcard, { attach: true }),
    `Thanks!\n\n${vcard}`,
  );
  assert.equal(
    review.maybeAttachVcardUrl(`Thanks!\n\n${reviewLink}`, vcard, {
      attach: true,
      reviewLink,
    }),
    `Thanks!\n\n${vcard}\n\n${reviewLink}`,
  );
});

test('buildReviewSms appends vCard URL when reviewAttachVcard is on', async () => {
  const built = await review.buildReviewSms({
    member: {
      companyName: 'Brightline Electric',
      reviewSlug: 'brightline',
      reviewAttachVcard: true,
      reviewSmsScript: 'Hey {{name}}, leave {{company}} a review {{review_link}}',
    },
    customerName: 'Jamie Lee',
    reviewLink: 'https://reviews.adhello.io/rv/brightline',
    useAi: false,
  });
  assert.match(built.message, /https:\/\/reviews\.adhello\.io\/c\/brightline\.vcf/);
  // Review link last so iMessage can unfurl the OG image.
  assert.match(
    built.message,
    /https:\/\/reviews\.adhello\.io\/c\/brightline\.vcf\n\nhttps:\/\/reviews\.adhello\.io\/rv\/brightline$/,
  );
});

test('buildReviewSms omits vCard URL when attach is off', async () => {
  const built = await review.buildReviewSms({
    member: {
      companyName: 'Brightline Electric',
      reviewSlug: 'brightline',
      reviewAttachVcard: false,
      reviewSmsScript: 'Hey {{name}}, leave a review {{review_link}}',
    },
    customerName: 'Jamie',
    reviewLink: 'https://reviews.adhello.io/rv/brightline',
    useAi: false,
  });
  assert.doesNotMatch(built.message, /\.vcf/);
});

test('buildGhlReviewWorkflowPrompt includes script and review link for Workflow AI', () => {
  const prompt = review.buildGhlReviewWorkflowPrompt({
    companyName: 'Brightline Electric',
    reviewLink: 'https://app.example/rv/brightline',
    smsScript: 'Hi {{name}} — review {{company}}: {{review_link}}',
  });
  assert.match(prompt, /GHL CRM workflow/i);
  assert.match(prompt, /event = request_review/);
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
