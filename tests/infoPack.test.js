const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeInfoPack,
  parseInfoPackFromBody,
  materializeInfoPackForLead,
  mergePackOverrides,
  packNeedsAuditUrl,
  BUILTIN_DEFAULT,
} = require('../services/infoPack');

test('normalizeInfoPack fills defaults', () => {
  const pack = normalizeInfoPack({});
  assert.equal(pack.sms.enabled, false);
  assert.equal(pack.email.enabled, false);
  assert.equal(pack.directMail.personalizeOverlay, true);
  assert.equal(pack.directMail.includeLobQr, true);
});

test('parseInfoPackFromBody reads nested infoPack', () => {
  const pack = parseInfoPackFromBody({
    infoPack: {
      sms: { enabled: true, body: 'Hi {business}' },
      email: { enabled: false, subject: 'S', body: 'B' },
      directMail: { enabled: true, playbookId: 'local_audit_general' },
    },
  });
  assert.equal(pack.sms.enabled, true);
  assert.equal(pack.sms.body, 'Hi {business}');
  assert.equal(pack.directMail.playbookId, 'local_audit_general');
});

test('parseInfoPackFromBody reads flat form fields', () => {
  const pack = parseInfoPackFromBody({
    smsEnabled: 'true',
    smsBody: 'Text',
    emailEnabled: '1',
    emailSubject: 'Sub',
    emailBody: 'Body',
    directMailEnabled: 'false',
    playbookId: 'hvac_audit',
  });
  assert.equal(pack.sms.enabled, true);
  assert.equal(pack.sms.body, 'Text');
  assert.equal(pack.email.enabled, true);
  assert.equal(pack.email.subject, 'Sub');
  assert.equal(pack.directMail.playbookId, 'hvac_audit');
});

test('materializeInfoPackForLead applies merge fields and playbook fallback', () => {
  const lead = {
    title: 'Acme HVAC',
    city: 'Austin',
    state: 'TX',
  };
  const pack = normalizeInfoPack({
    sms: { enabled: true, body: 'Hello {business} in {city}, {state}' },
    directMail: {
      enabled: true,
      playbookId: 'local_audit_general',
      headline: '',
      bodyText: '',
      ctaUrl: '',
    },
  });
  const materialized = materializeInfoPackForLead(pack, lead, {
    auditUrl: 'https://example.com/audit/abc',
  });
  assert.match(materialized.sms.body, /Acme HVAC/);
  assert.match(materialized.sms.body, /Austin/);
  assert.match(materialized.directMail.headline, /Acme HVAC/);
  assert.match(materialized.directMail.ctaUrl, /https:\/\/example.com\/audit\/abc/);
});

test('mergePackOverrides keeps base channels', () => {
  const base = normalizeInfoPack(BUILTIN_DEFAULT);
  const merged = mergePackOverrides(base, { sms: { body: 'Override only' } });
  assert.equal(merged.sms.body, 'Override only');
  assert.equal(merged.email.enabled, base.email.enabled);
});

test('packNeedsAuditUrl detects audit token usage', () => {
  assert.equal(packNeedsAuditUrl({ sms: { body: 'See {audit_url}' } }), true);
  assert.equal(packNeedsAuditUrl({ sms: { body: 'Hello there' } }), false);
});

test('resolveInfoPackForLead prefers folder pack over workspace default', async () => {
  const infoPack = require('../services/infoPack');
  const dbService = require('../services/database');
  const origGetFolder = dbService.getFolder;
  dbService.getFolder = async () => ({
    key: 'folder:test:1',
    infoPack: { sms: { enabled: true, body: 'Folder pack' }, email: { enabled: false, subject: '', body: '' } },
  });
  try {
    const pack = await infoPack.resolveInfoPackForLead({
      workspace: { id: 'ws1', infoPackDefault: { sms: { enabled: true, body: 'Workspace default' } } },
      folder: null,
      lead: { folderKey: 'folder:test:1' },
    });
    assert.equal(pack.sms.body, 'Folder pack');
  } finally {
    dbService.getFolder = origGetFolder;
  }
});
