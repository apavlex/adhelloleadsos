const test = require('node:test');
const assert = require('node:assert/strict');
const sign = require('../services/networkLinkSign');
const { createAuditReportToken } = require('../services/auditReportSign');

test('referral link round trip', () => {
  const token = sign.createReferralLinkToken({ networkId: 'n1', referralId: 'r1', memberId: 'm1' });
  assert.deepEqual(
    { ...sign.verifyNetworkToken(token, 'ref'), exp: 0 },
    { type: 'ref', networkId: 'n1', referralId: 'r1', memberId: 'm1', exp: 0 },
  );
});

test('member portal link round trip', () => {
  const token = sign.createMemberPortalToken({ networkId: 'n1', memberId: 'm1' });
  const payload = sign.verifyNetworkToken(token, 'mem');
  assert.equal(payload.memberId, 'm1');
  assert.equal(payload.referralId, '');
});

test('tampered signature or body is rejected', () => {
  const token = sign.createReferralLinkToken({ networkId: 'n1', referralId: 'r1', memberId: 'm1' });
  const [body, sig] = token.split('.');
  assert.equal(sign.verifyNetworkToken(`${body}.${sig.slice(0, -2)}xx`, 'ref'), null);
  const forged = Buffer.from(JSON.stringify({ t: 'ref', n: 'n1', r: 'r1', m: 'm2', exp: Date.now() + 1e6 })).toString('base64url');
  assert.equal(sign.verifyNetworkToken(`${forged}.${sig}`, 'ref'), null);
  assert.equal(sign.verifyNetworkToken('garbage', 'ref'), null);
});

test('expired links are rejected', () => {
  const token = sign.createReferralLinkToken({ networkId: 'n1', referralId: 'r1', memberId: 'm1', ttlMs: 1000, now: Date.now() - 5000 });
  assert.equal(sign.verifyNetworkToken(token, 'ref'), null);
});

test('wrong link type is rejected', () => {
  const portal = sign.createMemberPortalToken({ networkId: 'n1', memberId: 'm1' });
  assert.equal(sign.verifyNetworkToken(portal, 'ref'), null);
  const ref = sign.createReferralLinkToken({ networkId: 'n1', referralId: 'r1', memberId: 'm1' });
  assert.equal(sign.verifyNetworkToken(ref, 'mem'), null);
});

test('audit report tokens never verify as network links', () => {
  const audit = createAuditReportToken({ leadKey: 'lead:1', workspaceId: 'w1' });
  assert.equal(sign.verifyNetworkToken(audit, 'ref'), null);
  assert.equal(sign.verifyNetworkToken(audit), null);
});
