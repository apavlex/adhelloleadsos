const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { scoreLocalProspect } = require('../services/localProspectScore');
const { scoreLeadRecord } = require('../services/opportunityScore');
const { buildFocusQueue } = require('../services/focusQueue');
const {
  resolveRoiProfile,
  ROI_PROFILES,
  contactQueueSortBlurb,
} = require('../services/workspaceRoiProfile');

const flooringWs = { name: 'Flooring', salesScriptsPresetKey: 'retail_install' };
const agencyWs = { name: 'AdHello Agency', salesScriptsPresetKey: 'agency' };
const homeelkWs = { name: 'HomeElk', slug: 'homeelk' };
const homeelkExplicit = {
  name: 'HomeElk',
  prospecting: { roiProfile: 'license_renewal' },
};

describe('workspaceRoiProfile', () => {
  it('maps agency preset to agency_gap and retail to partner_fit', () => {
    assert.equal(resolveRoiProfile(agencyWs), ROI_PROFILES.AGENCY_GAP);
    assert.equal(resolveRoiProfile(flooringWs), ROI_PROFILES.PARTNER_FIT);
  });

  it('maps HomeElk to CCB/COI license_renewal', () => {
    assert.equal(resolveRoiProfile(homeelkWs), ROI_PROFILES.LICENSE_RENEWAL);
    assert.equal(resolveRoiProfile(homeelkExplicit), ROI_PROFILES.LICENSE_RENEWAL);
    assert.match(contactQueueSortBlurb(homeelkWs), /CCB|COI/i);
  });

  it('uses partner-fit blurb for Flooring', () => {
    assert.match(contactQueueSortBlurb(flooringWs), /high \+ recent reviews/i);
    assert.match(contactQueueSortBlurb(agencyWs), /gap score/i);
  });
});

describe('partner_fit vs agency_gap scoring', () => {
  const noSiteLead = {
    title: 'No Site Co',
    phone: '360-555-0100',
    website: 'N/A',
    email: 'N/A',
    url: 'https://maps.google.com/?q=1',
    pipelineStage: 1,
  };
  const partnerLead = {
    title: 'Referral Cabinets LLC',
    phone: '360-555-0200',
    email: 'hello@cabinets.example',
    website: 'https://cabinets.example',
    reviewsCount: 42,
    reviewsLast30Days: 4,
    lastReviewAt: new Date().toISOString(),
    totalScore: 4.7,
    referralPartner: { highlighted: true, status: 'connected', sent: 2, received: 1 },
    pipelineStage: 1,
  };
  const staleLead = {
    title: 'Quiet Floors Inc',
    phone: '360-555-0300',
    email: 'hi@quiet.example',
    website: 'https://quietfloors.example',
    reviewsCount: 12,
    reviewsLast30Days: 0,
    lastReviewAt: '2024-01-01T00:00:00.000Z',
    totalScore: 4.2,
    pipelineStage: 1,
  };
  const hotReviewsLead = {
    title: 'Busy Tile Co',
    phone: '360-555-0400',
    email: 'sales@busytile.example',
    website: 'https://busytile.example',
    reviewsCount: 180,
    reviewsLast30Days: 8,
    lastReviewAt: new Date().toISOString(),
    totalScore: 4.8,
    pipelineStage: 1,
  };

  it('agency: no-site stays Hot; partner with site is Low', () => {
    const hot = scoreLocalProspect(noSiteLead, { workspace: agencyWs });
    const low = scoreLocalProspect(partnerLead, { workspace: agencyWs });
    assert.equal(hot.prospectTier, 'Hot');
    assert.equal(low.prospectTier, 'Low');
  });

  it('Flooring: no-site is Low; site+reviews+referral is Hot', () => {
    const low = scoreLocalProspect(noSiteLead, { workspace: flooringWs });
    const hot = scoreLocalProspect(partnerLead, { workspace: flooringWs });
    assert.equal(low.prospectTier, 'Low');
    assert.equal(hot.prospectTier, 'Hot');
    assert.match(hot.why, /referral|reviews|website/i);
  });

  it('Flooring queue ranks partner-fit leads above no-site Hot leftovers', () => {
    const ordered = buildFocusQueue([noSiteLead, partnerLead], 10, {
      workspace: flooringWs,
      earlyStagesOnly: true,
    });
    assert.equal(ordered[0].title, partnerLead.title);
    const scored = scoreLeadRecord(partnerLead, { workspace: flooringWs });
    assert.equal(scored.tier, 'high');
    assert.ok(scored.score >= 7);
    const weak = scoreLeadRecord(noSiteLead, { workspace: flooringWs });
    assert.ok(weak.score < scored.score);
  });

  it('Flooring ranks high + recent reviews above stale lower-volume leads', () => {
    const ordered = buildFocusQueue([staleLead, hotReviewsLead], 10, {
      workspace: flooringWs,
      earlyStagesOnly: true,
    });
    assert.equal(ordered[0].title, hotReviewsLead.title);
    const hot = scoreLeadRecord(hotReviewsLead, { workspace: flooringWs });
    const stale = scoreLeadRecord(staleLead, { workspace: flooringWs });
    assert.ok(hot.score > stale.score);
    assert.match(hot.reasons.join(' '), /review|30 days|High review/i);
  });
});

describe('HomeElk CCB & COI scoring', () => {
  const soonCoi = {
    title: 'Soon COI LLC',
    phone: '503-555-1001',
    email: 'a@example.com',
    website: 'https://sooncoi.example',
    contractorLicenseNumber: 'OR-1',
    contractorLicenseExpires: '2028-12-01',
    contractorCoiExpires: new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10),
    pipelineStage: 1,
  };
  const farCcb = {
    title: 'Far CCB LLC',
    phone: '503-555-1002',
    email: 'b@example.com',
    website: 'https://farccb.example',
    contractorLicenseNumber: 'OR-2',
    contractorLicenseExpires: '2029-06-01',
    contractorCoiExpires: '2029-06-01',
    pipelineStage: 1,
  };
  const noSiteAgencyStyle = {
    title: 'No Site Trucking',
    phone: '503-555-1003',
    website: 'N/A',
    email: 'N/A',
    url: 'https://maps.google.com/?q=1',
    pipelineStage: 1,
  };

  it('scores soon COI as Hot/high and far expiry as Low', () => {
    const hot = scoreLocalProspect(soonCoi, { workspace: homeelkWs });
    const cold = scoreLocalProspect(farCcb, { workspace: homeelkWs });
    assert.equal(hot.prospectTier, 'Hot');
    assert.match(hot.websiteStatusLabel, /COI/i);
    assert.equal(cold.prospectTier, 'Low');
    const hotOpp = scoreLeadRecord(soonCoi, { workspace: homeelkWs });
    const coldOpp = scoreLeadRecord(farCcb, { workspace: homeelkWs });
    assert.ok(hotOpp.score > coldOpp.score);
    assert.ok(hotOpp.score >= 7);
    assert.match(hotOpp.reasons.join(' '), /COI/i);
  });

  it('does not treat no-website as high opp under HomeElk goal', () => {
    const scored = scoreLeadRecord(noSiteAgencyStyle, { workspace: homeelkWs });
    assert.ok(scored.score < 4);
    const lp = scoreLocalProspect(noSiteAgencyStyle, { workspace: homeelkWs });
    assert.equal(lp.prospectTier, 'Low');
  });

  it('queues soonest CCB/COI ahead of far expiry', () => {
    const ordered = buildFocusQueue([farCcb, soonCoi], 10, {
      workspace: homeelkWs,
      earlyStagesOnly: true,
    });
    assert.equal(ordered[0].title, soonCoi.title);
  });

  it('honors explicit prospecting.roiProfile over name inference', () => {
    const agencyNamedHomeelk = {
      name: 'HomeElk Marketing',
      prospecting: { roiProfile: 'agency_gap' },
    };
    assert.equal(resolveRoiProfile(agencyNamedHomeelk), ROI_PROFILES.AGENCY_GAP);
  });
});
