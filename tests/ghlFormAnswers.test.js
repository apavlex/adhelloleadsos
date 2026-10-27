const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeFormAnswers,
  answersFromContact,
  answersPreview,
  formLeadNotifyBody,
  addressFromFormAnswers,
  descriptionFromFormAnswers,
  presentFormAnswersForProfile,
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

  it('answersFromSubmission reads others + standard fields', () => {
    const { answersFromSubmission, coreIdentityAnswers } = require('../services/ghlFormAnswers');
    const answers = answersFromSubmission(
      {
        name: 'Alex',
        email: 'alex@adhelo.io',
        phone: '+13608726483',
        others: {
          project_type: 'Hardwood',
          message: 'Need living room floors',
          custom_field_id: 'cf_ignore_shape',
        },
      },
      [{ id: 'cf_proj', name: 'Project type', fieldKey: 'project_type' }],
    );
    assert.ok(answers.some((a) => a.q === 'Name' && a.a === 'Alex'));
    assert.ok(answers.some((a) => /Hardwood/i.test(a.a)));
    assert.ok(answers.some((a) => /living room/i.test(a.a)));

    const core = coreIdentityAnswers({
      name: 'Alex',
      phone: '+13608726483',
      email: 'alex@adhelo.io',
      address: 'Camas',
    });
    assert.deepEqual(
      core.map((a) => a.q),
      ['Name', 'Phone', 'Email', 'Address'],
    );
  });

  it('rewrites Source ai_studio / Direct to Website', () => {
    const out = normalizeFormAnswers([
      { q: 'Source', a: 'ai_studio' },
      { q: 'Contact Source', a: 'Direct' },
      { q: 'Project Interest', a: 'Hardwood Collection' },
    ]);
    assert.equal(out.find((a) => a.q === 'Source').a, 'Website');
    assert.equal(out.find((a) => a.q === 'Contact Source').a, 'Website');
    assert.equal(out.find((a) => a.q === 'Project Interest').a, 'Hardwood Collection');
  });

  it('formLeadNotifyBody is phone · description · address', () => {
    assert.equal(
      formLeadNotifyBody({
        phone: '+15551234567',
        answers: [
          { q: 'Source', a: 'Website' },
          { q: 'Project Interest', a: 'Hardwood floors' },
          { q: 'Address', a: '98682' },
        ],
      }),
      '(555) 123-4567 · Hardwood floors · 98682',
    );
    // Alex-style: only source + zip in preview — no Source clutter, still phone + address.
    assert.equal(
      formLeadNotifyBody({
        phone: '3602611532',
        preview: 'Website form · Source: Website · Address: 98682',
      }),
      '(360) 261-1532 · 98682',
    );
    assert.doesNotMatch(
      formLeadNotifyBody({
        phone: '+15551234567',
        preview: 'Source: Website · Address: 98682',
      }),
      /Source:|Website form/i,
    );
    // Kaily-style: blank placeholders must not become "N/A" on the lock screen.
    assert.equal(
      formLeadNotifyBody({
        phone: '2384723564',
        answers: [
          { q: 'Est Sq Footage', a: 'N/A' },
          { q: 'Additional Details', a: 'N/A' },
          { q: 'PROJECT ADDRESS / ZIP', a: 'Camas, WA 98607' },
        ],
      }),
      '(238) 472-3564 · Camas, WA 98607',
    );
  });

  it('maps PROJECT ADDRESS / ZIP into Address and skips N/A placeholders', () => {
    const answers = [
      { q: 'PROJECT ADDRESS / ZIP', a: 'Camas, WA 98607' },
      { q: 'EST. SQ FOOTAGE', a: '1,200 sq ft' },
      { q: 'ADDITIONAL DETAILS', a: 'N/A' },
    ];
    assert.equal(addressFromFormAnswers(answers), 'Camas, WA 98607');
    assert.equal(descriptionFromFormAnswers(answers), '1,200 sq ft');
    assert.equal(
      normalizeFormAnswers([{ q: 'Notes', a: 'N/A' }, { q: 'Zip', a: '98682' }]).length,
      1,
    );
  });

  it('presentFormAnswersForProfile replaces Agency OS source with teammate Added by', () => {
    const out = presentFormAnswersForProfile(
      [
        { q: 'Company', a: 'na sharon' },
        { q: 'Source', a: 'Agency OS' },
        { q: 'Type', a: 'lead' },
        { q: 'Address', a: 'BEAVERTON, OR 97007, US' },
      ],
      { addedByName: 'Greg Arakelyan' },
    );
    assert.ok(out.some((r) => r.q === 'Added by' && r.a === 'Greg Arakelyan'));
    assert.equal(out.some((r) => /Agency OS|AdHello/i.test(r.a)), false);
    assert.ok(out.some((r) => r.q === 'Company'));
  });
});
