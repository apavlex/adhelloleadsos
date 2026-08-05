const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeAuditLanding,
  resolveAuditLinksForLead,
  smsSnippetForLead,
} = require('../services/auditLandingPage');

test('normalizeAuditLanding fills defaults', () => {
  const c = normalizeAuditLanding({});
  assert.equal(typeof c.headline, 'string');
  assert.equal(c.fields.email.enabled, true);
  assert.equal(c.fields.message.enabled, false);
});

test('resolveAuditLinksForLead uses landing page when enabled', () => {
  const lead = { key: 'lead:abc', title: 'Acme HVAC', city: 'Austin', workspaceId: 'ws1' };
  const workspace = {
    id: 'ws1',
    auditLandingPage: { enabled: true, smsSnippetTemplate: 'Link: {audit_url}' },
  };
  const links = resolveAuditLinksForLead({
    workspace,
    lead,
    req: { protocol: 'https', get: () => 'leads.example.com' },
  });
  assert.equal(links.ok, true);
  assert.match(links.auditPageUrl, /\/audit\/request\//);
  assert.equal(links.reportUrl, links.auditPageUrl);
  assert.match(links.smsSnippet, /\/audit\/request\//);
});

test('resolveAuditLinksForLead requires AI analysis when landing disabled', () => {
  const lead = { key: 'lead:abc', title: 'Acme', workspaceId: 'ws1' };
  const links = resolveAuditLinksForLead({
    workspace: { id: 'ws1', auditLandingPage: { enabled: false } },
    lead,
    req: { protocol: 'https', get: () => 'leads.example.com' },
  });
  assert.equal(links.ok, false);
});

test('smsSnippetForLead substitutes audit_url token', () => {
  const snippet = smsSnippetForLead(
    { smsSnippetTemplate: 'Open {audit_url} for {business}' },
    { title: 'Bob\'s Plumbing' },
    'https://x.test/audit/request/tok',
  );
  assert.match(snippet, /Bob's Plumbing|Bob\u2019s Plumbing/);
  assert.match(snippet, /https:\/\/x\.test\/audit\/request\/tok/);
});
