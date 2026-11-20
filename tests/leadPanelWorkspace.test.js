const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isAgencySalesWorkspace } = require('../services/leadPanelWorkspace');
const { inferScriptPresetKey } = require('../services/workspaceScriptBootstrap');
const { pickHeuristicServiceKey, leadToFocusPayload } = require('../routes/focus')._test;

test('isAgencySalesWorkspace true for agency preset', () => {
  assert.equal(isAgencySalesWorkspace({ salesScriptsPresetKey: 'agency' }), true);
});

test('isAgencySalesWorkspace false for retail/install workspace', () => {
  assert.equal(
    isAgencySalesWorkspace({ name: 'Premier Flooring', salesScriptsPresetKey: 'retail_install' }),
    false,
  );
});

test('isAgencySalesWorkspace true for AdHello agency by slug', () => {
  assert.equal(
    isAgencySalesWorkspace({ name: 'AdHello Agency', slug: 'adhello-agency' }),
    true,
  );
});

test('Flooring name/slug is not agency even without explicit preset', () => {
  const ws = { name: 'Flooring', slug: 'flooring' };
  assert.equal(inferScriptPresetKey(ws), 'retail_install');
  assert.equal(isAgencySalesWorkspace(ws), false);
});

test('Flooring is not agency when slug or name includes adhello', () => {
  const ws = { name: 'AdHello Flooring', slug: 'adhello-flooring' };
  assert.equal(inferScriptPresetKey(ws), 'retail_install');
  assert.equal(isAgencySalesWorkspace(ws), false);
});

test('Clark County local guide is not treated as agency sales', () => {
  assert.equal(isAgencySalesWorkspace({ name: 'Clark County Guide', slug: 'clark-county' }), false);
});

test('pickHeuristicServiceKey does not prefer website offers for non-agency', () => {
  const lead = { website: '', isOutdated: true, isMobileFriendly: false };
  const keys = ['flooring_install', 'aiWebsites', 'reputation'];
  assert.equal(pickHeuristicServiceKey(lead, keys, { isAgency: false }), 'flooring_install');
  assert.equal(pickHeuristicServiceKey(lead, keys, { isAgency: true }), 'aiWebsites');
});

test('leadToFocusPayload uses partner-fit why chips for non-agency (not website-gap UI)', () => {
  const lead = {
    title: 'Acme Floors',
    phone: '360-555-0100',
    website: 'https://example.com',
    reviewsCount: 22,
    totalScore: 4.6,
    isOutdated: true,
    isMobileFriendly: false,
    hasChatbot: false,
    hasSchemaMarkup: false,
    ownerSignal: 'Their site UX is weak — pitch a redesign.',
    auditSummary: 'Standalone site UX/SEO gaps',
  };
  const agency = leadToFocusPayload(lead, [], {}, ['aiWebsites'], {
    isAgency: true,
    scoreOpts: { roiProfile: 'agency_gap' },
  });
  const retail = leadToFocusPayload(lead, [], { flooring_install: { label: 'Install' } }, ['flooring_install'], {
    isAgency: false,
    scoreOpts: { roiProfile: 'partner_fit' },
  });
  assert.ok(agency.whyReasons.length > 0);
  assert.ok(agency.whyReasons.some((r) => /gap|outdated|mobile|schema|chat/i.test(r)));
  assert.ok(retail.whyReasons.length > 0);
  assert.ok(retail.whyReasons.some((r) => /website|review|partner|referral/i.test(r)));
  assert.ok(!retail.whyReasons.some((r) => /owned-site hook|redesign pitch|No chatbot/i.test(r)));
  assert.equal(retail.ownerSignal, '');
  assert.equal(retail.businessNeeds.rationale, '');
  assert.equal(retail.hasAiWebsiteAnalysis, false);
});

test('leadToFocusPayload includes FMCSA carrier chips for Money Mode first paint', () => {
  const payload = leadToFocusPayload(
    {
      title: 'ALP TRANSPORTATION LLC',
      phone: '2145550100',
      importFields: {
        mc_no: '1161446',
        dot_no: '3509949',
        power: 'E',
        driver: '10',
        ins_co: 'UNITED STATES FIRE INSURANCE C',
        cover: 'BI&PD',
      },
    },
    [],
    {},
    [],
    { isAgency: false },
  );
  assert.equal(payload.mcNumber, '1161446');
  assert.equal(payload.dotNumber, '3509949');
  assert.equal(payload.driverCount, '10');
  assert.equal(payload.powerUnits, 'E');
  assert.equal(payload.insuranceCompany, 'UNITED STATES FIRE INSURANCE C');
  assert.ok(Array.isArray(payload.carrierChips));
  assert.ok(payload.carrierChips.some((c) => /MC 1161446/i.test(c)));
  assert.ok(payload.carrierChips.some((c) => /10 driver/i.test(c)));
  assert.ok(payload.importFields && payload.importFields.mc_no === '1161446');
});
