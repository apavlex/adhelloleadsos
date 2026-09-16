const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  AO_SIGNAL_TAGS,
  computeLeadSignalTags,
  leadOpportunityScore,
  isSignalTag,
  stripSignalTags,
  hasKnownReviewCount,
} = require('../services/leadSignalTags');
const { mergeTagLists, tagsToAdd } = require('../services/ghlSyncHelpers');

describe('leadSignalTags', () => {
  it('tags the queue badge combo: high opp + hot + no site found + low reviews', () => {
    const lead = {
      title: 'Sarkinen Restoration',
      phone: '360-555-1234',
      reviewsCount: 8,
      rating: 3.9,
    };
    const tags = computeLeadSignalTags(lead);
    assert.deepEqual(tags, [
      AO_SIGNAL_TAGS.HIGH_OPP,
      AO_SIGNAL_TAGS.HOT_PROSPECT,
      AO_SIGNAL_TAGS.NO_SITE_FOUND,
      AO_SIGNAL_TAGS.LOW_REVIEWS,
    ]);
    assert.equal(leadOpportunityScore(lead), 7.5);
  });

  it('bands opportunity at the 7 and 4 boundaries', () => {
    // 3.0 (no mobile) + 2.5 (outdated) + 1.5 (low reviews) = 7.0
    const atHigh = computeLeadSignalTags({
      title: 'Diplomat Flooring',
      website: 'https://diplomatflooring.example',
      isMobileFriendly: false,
      isOutdated: true,
      facebook: 'https://facebook.com/diplomat',
      instagram: 'https://instagram.com/diplomat',
      reviewsCount: 12,
      rating: 4.8,
    });
    assert.ok(atHigh.includes(AO_SIGNAL_TAGS.HIGH_OPP));
    assert.ok(!atHigh.includes(AO_SIGNAL_TAGS.MEDIUM_OPP));

    // Drop the outdated flag: 3.0 + 1.5 = 4.5 → medium band.
    const belowHigh = computeLeadSignalTags({
      title: 'Diplomat Flooring',
      website: 'https://diplomatflooring.example',
      isMobileFriendly: false,
      facebook: 'https://facebook.com/diplomat',
      instagram: 'https://instagram.com/diplomat',
      reviewsCount: 12,
      rating: 4.8,
    });
    assert.ok(belowHigh.includes(AO_SIGNAL_TAGS.MEDIUM_OPP));

    // 1.0 (light social) + 1.5 (low reviews) + 1.5 (rating < 4.2) = 4.0 → medium band.
    const atMedium = computeLeadSignalTags({
      title: 'Comfort Interiors',
      website: 'https://comfortinteriors.example',
      reviewsCount: 12,
      rating: 4.0,
    });
    assert.ok(atMedium.includes(AO_SIGNAL_TAGS.MEDIUM_OPP));

    // Same lead with a healthy rating: 1.0 + 1.5 = 2.5 → low band.
    const belowMedium = computeLeadSignalTags({
      title: 'Comfort Interiors',
      website: 'https://comfortinteriors.example',
      reviewsCount: 12,
      rating: 4.6,
    });
    assert.ok(belowMedium.includes(AO_SIGNAL_TAGS.LOW_OPP));
  });

  it('tags weak social and SEO gaps from the pipeline gap badges', () => {
    const tags = computeLeadSignalTags({
      title: 'BAM Office Interiors',
      website: 'https://bamoffice.example',
      hasSchemaMarkup: false,
      reviewsCount: 120,
      rating: 4.7,
    });
    assert.ok(tags.includes(AO_SIGNAL_TAGS.WEAK_SOCIAL));
    assert.ok(tags.includes(AO_SIGNAL_TAGS.SEO_GAPS));
    assert.ok(tags.includes(AO_SIGNAL_TAGS.WEAK_SITE));
    assert.ok(!tags.includes(AO_SIGNAL_TAGS.LOW_REVIEWS));
  });

  it('emits exactly one website-state tag', () => {
    const socialOnly = computeLeadSignalTags({
      title: 'The Supreme Floors',
      phone: '360-555-2222',
      facebook: 'https://facebook.com/supremefloors',
    });
    assert.ok(socialOnly.includes(AO_SIGNAL_TAGS.SOCIAL_ONLY));
    assert.ok(!socialOnly.includes(AO_SIGNAL_TAGS.NO_SITE_FOUND));

    const marketplace = computeLeadSignalTags({
      title: 'Signature Hardwood Floors',
      phone: '360-555-3333',
      website: 'https://booksy.com/en-us/signature-hardwood',
      reviewsCount: 400,
      rating: 4.9,
    });
    assert.ok(marketplace.includes(AO_SIGNAL_TAGS.MARKETPLACE_SITE));
    assert.ok(marketplace.includes(AO_SIGNAL_TAGS.WARM_PROSPECT));

    const hasSite = computeLeadSignalTags({
      title: 'Premium Flooring Installation LLC',
      website: 'https://premiumflooring.example',
      facebook: 'https://facebook.com/premiumflooring',
      instagram: 'https://instagram.com/premiumflooring',
      reviewsCount: 210,
      rating: 4.8,
    });
    assert.deepEqual(hasSite, [AO_SIGNAL_TAGS.LOW_OPP, AO_SIGNAL_TAGS.LOW_PROSPECT, AO_SIGNAL_TAGS.HAS_SITE]);
  });

  it('tags skip prospects without a website-state claim', () => {
    const closed = computeLeadSignalTags({
      title: "Rick's Home Repair",
      businessStatus: 'Permanently closed',
      website: 'https://rickshomerepair.example',
      reviewsCount: 90,
      rating: 4.5,
    });
    assert.ok(closed.includes(AO_SIGNAL_TAGS.SKIP_PROSPECT));
    assert.ok(!closed.includes(AO_SIGNAL_TAGS.HAS_SITE));
    assert.ok(!closed.includes(AO_SIGNAL_TAGS.NO_SITE_FOUND));
  });

  it('skips low reviews when the review count was never enriched', () => {
    assert.equal(hasKnownReviewCount({ reviewsCount: 0 }), true);
    assert.equal(hasKnownReviewCount({ reviewsCount: '' }), false);
    assert.equal(hasKnownReviewCount({}), false);

    const unenriched = computeLeadSignalTags({
      title: 'Talbitzer Homes Hazelnut Grv',
      phone: '360-555-4444',
    });
    assert.ok(unenriched.includes(AO_SIGNAL_TAGS.NO_SITE_FOUND));
    assert.ok(!unenriched.includes(AO_SIGNAL_TAGS.LOW_REVIEWS));

    const knownZero = computeLeadSignalTags({
      title: 'Talbitzer Homes Hazelnut Grv',
      phone: '360-555-4444',
      reviewsCount: 0,
    });
    assert.ok(knownZero.includes(AO_SIGNAL_TAGS.LOW_REVIEWS));
  });

  it('respects the low reviews threshold at its boundary', () => {
    const base = {
      title: 'Comfort Interiors',
      website: 'https://comfortinteriors.example',
      facebook: 'https://facebook.com/comfort',
      instagram: 'https://instagram.com/comfort',
      rating: 4.8,
    };
    assert.ok(computeLeadSignalTags({ ...base, reviewsCount: 30 }).includes(AO_SIGNAL_TAGS.LOW_REVIEWS));
    assert.ok(!computeLeadSignalTags({ ...base, reviewsCount: 31 }).includes(AO_SIGNAL_TAGS.LOW_REVIEWS));
    assert.ok(
      !computeLeadSignalTags({ ...base, reviewsCount: 12 }, {
        workspace: { prospecting: { lowReviewsThreshold: 10 } },
      }).includes(AO_SIGNAL_TAGS.LOW_REVIEWS),
    );
    assert.ok(
      computeLeadSignalTags({ ...base, reviewsCount: 8 }, { lowReviewsThreshold: 10 }).includes(
        AO_SIGNAL_TAGS.LOW_REVIEWS,
      ),
    );
  });

  it('returns nothing for a missing lead and never repeats a tag', () => {
    assert.deepEqual(computeLeadSignalTags(null), []);
    assert.deepEqual(computeLeadSignalTags('nope'), []);
    assert.equal(leadOpportunityScore(null), null);

    const tags = computeLeadSignalTags({
      title: 'Sarkinen Restoration',
      phone: '360-555-1234',
      reviewsCount: 8,
    });
    assert.equal(new Set(tags.map((t) => t.toLowerCase())).size, tags.length);
  });

  it('recognizes and strips signal tags case-insensitively', () => {
    assert.equal(isSignalTag('AO: High opp'), true);
    assert.equal(isSignalTag('ao: no site found'), true);
    assert.equal(isSignalTag('AO: Call back'), false);
    assert.equal(isSignalTag('VIP'), false);
    assert.deepEqual(stripSignalTags(['VIP', 'ao: low reviews', 'AO: Prospected']), [
      'VIP',
      'AO: Prospected',
    ]);
  });

  it('de-duplicates against tags already queued and already on the contact', () => {
    const lead = {
      title: 'Sarkinen Restoration',
      phone: '360-555-1234',
      reviewsCount: 8,
      rating: 3.9,
    };
    const signalTags = computeLeadSignalTags(lead);

    const merged = mergeTagLists(['VIP', 'ao: hot prospect'], signalTags);
    assert.equal(merged.filter((t) => t.toLowerCase() === 'ao: hot prospect').length, 1);
    assert.deepEqual(merged, [
      'VIP',
      'ao: hot prospect',
      AO_SIGNAL_TAGS.HIGH_OPP,
      AO_SIGNAL_TAGS.NO_SITE_FOUND,
      AO_SIGNAL_TAGS.LOW_REVIEWS,
    ]);

    const remote = ['AO: HIGH OPP', 'Newsletter'];
    assert.deepEqual(tagsToAdd(remote, signalTags), [
      AO_SIGNAL_TAGS.HOT_PROSPECT,
      AO_SIGNAL_TAGS.NO_SITE_FOUND,
      AO_SIGNAL_TAGS.LOW_REVIEWS,
    ]);
  });
});
