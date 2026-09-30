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
  assert.equal(pack.auditUrl, '');
  assert.equal(pack.sms.enabled, false);
  assert.equal(pack.email.enabled, false);
  assert.equal(pack.directMail.personalizeOverlay, true);
  assert.equal(pack.directMail.includeLobQr, true);
});

test('parseInfoPackFromBody reads nested infoPack', () => {
  const pack = parseInfoPackFromBody({
    infoPack: {
      auditUrl: 'https://example.com/audit-form',
      sms: { enabled: true, body: 'Hi {business}' },
      email: { enabled: false, subject: 'S', body: 'B' },
      directMail: { enabled: true, playbookId: 'local_audit_general' },
    },
  });
  assert.equal(pack.sms.enabled, true);
  assert.equal(pack.auditUrl, 'https://example.com/audit-form');
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

test('resolveAuditUrlForInfoPack uses configured audit URL', async () => {
  const { resolveAuditUrlForInfoPack } = require('../services/infoPack');
  const out = await resolveAuditUrlForInfoPack({
    pack: { auditUrl: 'https://forms.example.com/audit' },
    lead: { title: 'Acme', city: 'Austin' },
    workspaceId: 'ws1',
    workspace: { id: 'ws1' },
  });
  assert.equal(out.ok, true);
  assert.equal(out.reportUrl, 'https://forms.example.com/audit');
  assert.equal(out.source, 'configured');
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

test('buildConfiguredAuditUrl fills URL-encoded per-lead tokens', () => {
  const { buildConfiguredAuditUrl } = require('../services/infoPack');
  const lead = {
    key: 'lead:abc123',
    title: 'Acme HVAC & Plumbing',
    city: 'San Antonio',
    state: 'TX',
    website: 'https://www.acmehvac.com/contact',
  };
  assert.equal(
    buildConfiguredAuditUrl('https://audit.example.com/{slug}?id={leadKey}&c={city}&d={domain}', lead),
    'https://audit.example.com/acme-hvac-plumbing?id=abc123&c=San%20Antonio&d=acmehvac.com',
  );
  assert.equal(
    buildConfiguredAuditUrl('https://a.example.com/?b={business}&co={company}', lead),
    'https://a.example.com/?b=Acme%20HVAC%20%26%20Plumbing&co=Acme%20HVAC%20%26%20Plumbing',
  );
  assert.equal(buildConfiguredAuditUrl('https://a.example.com/static', lead), 'https://a.example.com/static');
  assert.equal(buildConfiguredAuditUrl('', lead), '');
});

test('createConfiguredAuditLinkResolver: folder pack wins, blank setting hides the link', () => {
  const { createConfiguredAuditLinkResolver } = require('../services/infoPack');
  const resolve = createConfiguredAuditLinkResolver({
    workspace: { id: 'ws1', infoPackDefault: { auditUrl: 'https://ws.example.com/audit/{slug}' } },
    folders: [
      { key: 'folder:ws1:1', infoPack: { auditUrl: 'https://folder.example.com/{leadKey}' } },
      { key: 'folder:ws1:2', infoPack: { auditUrl: '' } },
      { key: 'folder:ws1:3', name: 'No pack' },
    ],
  });
  assert.equal(resolve({ key: 'lead:k1', title: 'Bob Co' }), 'https://ws.example.com/audit/bob-co');
  assert.equal(resolve({ key: 'lead:k1', title: 'Bob Co', folderKey: 'folder:ws1:1' }), 'https://folder.example.com/k1');
  assert.equal(resolve({ key: 'lead:k1', title: 'Bob Co', folderKey: 'folder:ws1:2' }), '');
  assert.equal(resolve({ key: 'lead:k1', title: 'Bob Co', folderKey: 'folder:ws1:3' }), 'https://ws.example.com/audit/bob-co');
  assert.equal(createConfiguredAuditLinkResolver({ workspace: { id: 'ws1' }, folders: [] })({ title: 'X' }), '');
  const notUrl = createConfiguredAuditLinkResolver({ workspace: { id: 'ws1', infoPackDefault: { auditUrl: 'audit page' } } });
  assert.equal(notUrl({ title: 'X' }), '');
});

test('resolveConfiguredAuditLinkForLead ignores the auto-generated audit page when unset', async () => {
  const { resolveConfiguredAuditLinkForLead } = require('../services/infoPack');
  const url = await resolveConfiguredAuditLinkForLead({
    workspace: { id: 'ws1', infoPackDefault: { sms: { enabled: true, body: 'See {audit_url}' } } },
    folder: null,
    lead: { key: 'lead:k1', title: 'Acme' },
  });
  assert.equal(url, '');
  const configured = await resolveConfiguredAuditLinkForLead({
    workspace: { id: 'ws1', infoPackDefault: { auditUrl: 'https://forms.example.com/a?b={business}' } },
    folder: null,
    lead: { key: 'lead:k1', title: 'Acme Co' },
  });
  assert.equal(configured, 'https://forms.example.com/a?b=Acme%20Co');
});
