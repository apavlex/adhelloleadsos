const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveScriptSignOffProfile,
  replaceSenderPlaceholders,
  replaceProspectPlaceholders,
  fillScriptPlaceholders,
} = require('../services/scriptPlaceholders');
const { htmlToMarkdown, sanitizeScriptHtml, scriptTextToEditorHtml } = require('../services/scriptMarkup');

describe('scriptPlaceholders', () => {
  it('fills sender sign-off lines from profile and omits missing phone/email lines', () => {
    const profile = {
      name: 'Alex Pavlenko',
      company: 'AdHello',
      phone: '',
      email: 'alex@adhello.ai',
    };
    const raw = 'Thank you,\n[Your Name]\n[Company Name]\n[Phone]\n[Email]';
    const out = replaceSenderPlaceholders(raw, profile);
    assert.equal(out, 'Thank you,\nAlex Pavlenko\nAdHello\nalex@adhello.ai');
    assert.ok(!out.includes('[Phone]'));
    assert.ok(!out.includes('[Your Name]'));
  });

  it('handles lowercase and close variants without inventing a name', () => {
    const out = replaceSenderPlaceholders(
      'Hi, this is [your name] from [your company]. Call [your number].',
      { name: 'Alex Pavlenko', company: 'AdHello', phone: '555-0100', email: '' },
    );
    assert.equal(out, 'Hi, this is Alex Pavlenko from AdHello. Call 555-0100.');
    const emptyName = replaceSenderPlaceholders('Hi, this is [Your Name].', { name: '', company: 'AdHello' });
    assert.equal(emptyName, 'Hi, this is [Your Name].');
  });

  it('does not treat [Name] as the sender', () => {
    const out = replaceSenderPlaceholders('Hi [Name], this is [Your Name] at [Company Name].', {
      name: 'Alex Pavlenko',
      company: 'AdHello',
    });
    assert.match(out, /Hi \[Name], this is Alex Pavlenko at AdHello/);
  });

  it('fills [Name] from prospect context only', () => {
    const out = fillScriptPlaceholders('Hi [Name], I am [Your Name] at {{company}}.', {
      sender: { name: 'Alex Pavlenko', company: 'AdHello' },
      prospect: { name: 'Jordan', company: 'Northside' },
    });
    assert.equal(out, 'Hi Jordan, I am Alex Pavlenko at Northside.');
  });

  it('resolves profile from user, brand kit, and outreach sender name', () => {
    const profile = resolveScriptSignOffProfile({
      user: { displayName: 'Alex Pavlenko', emails: [{ value: 'alex@adhello.ai' }] },
      workspace: {
        name: 'Workspace Label',
        brandKit: { businessName: 'Brand Co', phone: '555-0100', email: 'hello@brand.co' },
        salesScriptOfferCatalog: [{ key: 'flooring', senderBusinessName: 'Premier Flooring' }],
      },
      offerKey: 'flooring',
    });
    assert.equal(profile.name, 'Alex Pavlenko');
    assert.equal(profile.company, 'Premier Flooring');
    assert.equal(profile.phone, '555-0100');
    assert.equal(profile.email, 'hello@brand.co');
  });

  it('falls back to Google email when brand kit email is empty', () => {
    const profile = resolveScriptSignOffProfile({
      user: { displayName: 'Alex Pavlenko', emails: [{ value: 'alex@adhello.ai' }] },
      workspace: { name: 'AdHello', brandKit: {} },
    });
    assert.equal(profile.email, 'alex@adhello.ai');
    assert.equal(profile.company, 'AdHello');
  });
});

describe('scriptMarkup', () => {
  it('round-trips bold italic underline to markdown', () => {
    const html = 'Hello <b>there</b> <i>friend</i> <u>now</u>';
    assert.equal(htmlToMarkdown(html), 'Hello **there** *friend* __now__');
  });

  it('sanitizes unsafe tags', () => {
    const dirty = 'Hi <b>Alex</b><script>alert(1)</script><img src=x onerror=alert(1)>';
    const clean = sanitizeScriptHtml(dirty);
    assert.match(clean, /<b>Alex<\/b>/);
    assert.ok(!clean.includes('script'));
    assert.ok(!clean.includes('img'));
  });

  it('converts plain text newlines to br for the editor', () => {
    assert.equal(scriptTextToEditorHtml('Hi\nthere'), 'Hi<br>there');
  });

  it('keeps formatting tags and turns remaining newlines into br', () => {
    assert.equal(scriptTextToEditorHtml('<b>Hi</b>\nthere'), '<b>Hi</b><br>there');
  });
});

describe('scriptPlaceholders html', () => {
  it('fills placeholders without stripping call-script markup', () => {
    const html = '<b>Cold Call Script</b><br><br>Hi [Name], this is [Your Name] at [Company Name].';
    const out = fillScriptPlaceholders(html, {
      sender: { name: 'Alex Pavlenko', company: 'AdHello' },
      prospect: { name: 'Jordan' },
    });
    assert.equal(out, '<b>Cold Call Script</b><br><br>Hi Jordan, this is Alex Pavlenko at AdHello.');
    assert.ok(!out.includes('<b>Cold Call Script for'));
    assert.equal(scriptTextToEditorHtml(out), out);
  });
});
