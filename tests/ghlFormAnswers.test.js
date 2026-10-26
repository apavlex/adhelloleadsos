const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeFormAnswers,
  answersFromContact,
  answersPreview,
  humanizeLabel,
} = require('../services/ghlFormAnswers');

describe('ghlFormAnswers', () => {
  it('humanizeLabel turns snake/camel keys into titles', () => {
    assert.equal(humanizeLabel('project_type'), 'Project Type');
    assert.equal(humanizeLabel('squareFootage'), 'Square Footage');
    assert.equal(humanizeLabel('Already Human'), 'Already Human');
  });

  it('normalizeFormAnswers dedupes and skips AdHello internals', () => {
    const out = normalizeFormAnswers([
      { q: 'Project type', a: 'Hardwood' },
      { q: 'project_type', a: 'Vinyl' },
      { q: 'AdHello Audit Link', a: 'https://x.test' },
      { q: '', a: 'nope' },
      { q: 'Message', a: 'Need quote' },
    ]);
    assert.deepEqual(out, [
      { q: 'Project type', a: 'Hardwood' },
      { q: 'Message', a: 'Need quote' },
    ]);
  });

  it('answersFromContact maps custom fields via catalog and extras', () => {
    const answers = answersFromContact(
      {
        firstName: 'Alex',
        phone: '+15551212',
        email: 'alex@test.com',
        companyName: 'Alex Homes',
        source: 'Website',
        address1: '12 Oak St',
        city: 'Austin',
        state: 'TX',
        customFields: [
          { id: 'cf_proj', value: 'Kitchen remodel' },
          { id: 'cf_adhello', value: 'skip me' },
        ],
      },
      [
        { id: 'cf_proj', name: 'What do you need?' },
        { id: 'cf_adhello', name: 'AdHello Website Build', fieldKey: 'adhello_website_build' },
      ],
    );
    assert.ok(answers.some((a) => a.q === 'Company' && a.a === 'Alex Homes'));
    assert.ok(answers.some((a) => a.q === 'Source' && a.a === 'Website'));
    assert.ok(answers.some((a) => a.q === 'Address' && /12 Oak St/.test(a.a) && /Austin/.test(a.a)));
    assert.ok(answers.some((a) => a.q === 'What Do You Need?' || a.q === 'What do you need?'));
    // Prefer catalog name as-is when already spaced
    const proj = answers.find((a) => /need/i.test(a.q));
    assert.equal(proj.a, 'Kitchen remodel');
    assert.ok(!answers.some((a) => /AdHello/i.test(a.q)));
    assert.ok(!answers.some((a) => a.a === '+15551212'));
  });

  it('answersPreview joins first answers', () => {
    const preview = answersPreview([
      { q: 'A', a: '1' },
      { q: 'B', a: '2' },
      { q: 'C', a: '3' },
      { q: 'D', a: '4' },
    ]);
    assert.equal(preview, 'A: 1 · B: 2 · C: 3');
  });
});
