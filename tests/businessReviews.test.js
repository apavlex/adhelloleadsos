const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const dbService = require('../services/database');
const businessReviews = require('../services/businessReviews');
const notificationLog = require('../services/notificationLog');

const WID = 'ws_biz_reviews_test';
const SETTINGS_KEY = businessReviews.SETTINGS_PREFIX + WID;
const STORE_KEY = businessReviews.STORE_PREFIX + WID;
const NOTIF_KEY = `notificationLog:${WID}`;

describe('businessReviews', () => {
  beforeEach(() => {
    dbService.deleteKvSync(SETTINGS_KEY);
    dbService.deleteKvSync(STORE_KEY);
    dbService.deleteKvSync(NOTIF_KEY);
  });

  afterEach(() => {
    dbService.deleteKvSync(SETTINGS_KEY);
    dbService.deleteKvSync(STORE_KEY);
    dbService.deleteKvSync(NOTIF_KEY);
  });

  it('isPaidWorkspace treats activated and non-trial workspaces as paid', () => {
    assert.equal(businessReviews.isPaidWorkspace({ id: 'a' }), true);
    assert.equal(
      businessReviews.isPaidWorkspace({
        id: 'b',
        trial: { endsAt: '2099-01-01T00:00:00.000Z', activatedAt: '2026-01-01T00:00:00.000Z' },
      }),
      true
    );
    assert.equal(
      businessReviews.isPaidWorkspace({
        id: 'c',
        trial: { endsAt: '2099-01-01T00:00:00.000Z' },
      }),
      false
    );
    assert.equal(
      businessReviews.isPaidWorkspace({
        id: 'd',
        trial: { endsAt: '2020-01-01T00:00:00.000Z' },
      }),
      false
    );
  });

  it('normalizeStoredReview + reviewFingerprint are stable for Outscraper rows', () => {
    const raw = {
      review_id: 'rev_abc',
      review_rating: 5,
      review_text: 'Great install crew, on time.',
      author_title: 'Sam P.',
      review_timestamp: 1616000898,
    };
    const a = businessReviews.normalizeStoredReview(raw);
    const b = businessReviews.normalizeStoredReview(raw);
    assert.equal(a.id, 'google:id:rev_abc');
    assert.equal(a.source, 'google');
    assert.equal(a.id, b.id);
    assert.equal(a.rating, 5);
    assert.equal(a.author, 'Sam P.');
    assert.equal(a.reviewedAt, new Date(1616000898 * 1000).toISOString());
  });

  it('mergeReviews marks only subsequent syncs as new and notifies', () => {
    const first = businessReviews.mergeReviews(
      [],
      [
        { review_id: 'r1', review_rating: 5, review_text: 'Awesome work from the team today.', author_title: 'A' },
        { review_id: 'r2', review_rating: 4, review_text: 'Solid job and clean site.', author_title: 'B' },
      ],
      { markNew: true }
    );
    assert.equal(first.reviews.length, 2);
    assert.equal(first.newOnes.length, 0, 'first sync should not notify');

    const second = businessReviews.mergeReviews(
      first.reviews,
      [
        { review_id: 'r1', review_rating: 5, review_text: 'Awesome work from the team today.', author_title: 'A' },
        { review_id: 'r2', review_rating: 4, review_text: 'Solid job and clean site.', author_title: 'B' },
        { review_id: 'r3', review_rating: 2, review_text: 'Late arrival and messy cleanup.', author_title: 'C' },
      ],
      { markNew: true }
    );
    assert.equal(second.newOnes.length, 1);
    assert.equal(second.newOnes[0].id, 'google:id:r3');
    assert.equal(second.reviews.find((r) => r.id === 'google:id:r3').isNew, true);

    const notes = businessReviews.notifyNewReviews(WID, second.newOnes, 'Acme Floors');
    assert.ok(notes.length >= 1);
    const logged = notificationLog.list(WID);
    assert.ok(logged.some((n) => /Google review/i.test(n.title)));
    assert.ok(logged.some((n) => String(n.href || '').includes('/business-reviews')));
  });

  it('saveSettings / getSettings / inboxSummary round-trip', () => {
    const s = businessReviews.saveSettings(WID, {
      query: 'ChIJtest123',
      businessName: 'Acme Floors',
      autoSync: true,
      reviewsLimit: 30,
    });
    assert.equal(s.query, 'ChIJtest123');
    assert.equal(businessReviews.getSettings(WID).businessName, 'Acme Floors');

    const store = {
      reviews: [
        { id: 'id:a', isNew: true, ownerResponse: '', replyDraft: 'Thanks!' },
        { id: 'id:b', isNew: false, ownerResponse: 'Replied', replyDraft: '' },
      ],
      placeRating: 4.8,
      placeReviewsCount: 120,
      placeName: 'Acme Floors',
      lastSyncedAt: '2026-10-23T12:00:00.000Z',
      lastError: null,
      knownIds: ['id:a', 'id:b'],
    };
    dbService.setKvSync(STORE_KEY, store);
    const summary = businessReviews.inboxSummary(businessReviews.getStore(WID));
    assert.equal(summary.total, 2);
    assert.equal(summary.newCount, 1);
    assert.equal(summary.unreplied, 1);
    assert.equal(summary.withDraft, 1);
  });

  it('routes and nav expose Business Reviews', () => {
    const route = fs.readFileSync(path.join(__dirname, '../routes/businessReviews.js'), 'utf8');
    const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const nav = fs.readFileSync(path.join(__dirname, '../views/partials/app_nav_items.ejs'), 'utf8');
    const perms = fs.readFileSync(path.join(__dirname, '../services/rolePermissions.js'), 'utf8');
    const view = fs.readFileSync(path.join(__dirname, '../views/business_reviews.ejs'), 'utf8');
    const sched = fs.readFileSync(path.join(__dirname, '../services/scheduler.js'), 'utf8');

    assert.match(server, /\/business-reviews/);
    assert.match(nav, /\/business-reviews/);
    assert.match(nav, /Business Reviews|Reviews/);
    assert.match(perms, /business-reviews/);
    assert.match(route, /draft-reply/);
    assert.match(route, /PAID_ONLY|paidOnly|isPaidWorkspace/);
    assert.match(view, /Copy reply/);
    assert.match(view, /Generate with AI/);
    assert.match(view, /Unlock your Google review inbox/);
    assert.match(sched, /businessReviews\.syncDueWorkspaces/);
  });

  it('resolveQueryFromMember uses only the Google request-site link', () => {
    assert.equal(
      businessReviews.resolveQueryFromMember({
        companyName: 'Acme',
        reviewLinks: {
          google: 'https://search.google.com/local/writereview?placeid=ChIJabc1234567',
        },
      }),
      'ChIJabc1234567'
    );
    assert.match(
      businessReviews.resolveQueryFromMember({
        companyName: 'Acme Floors',
        reviewLinks: { google: 'https://g.page/r/xyz/review' },
      }),
      /g\.page/
    );
    // Never fall back to CRM lead / company name — that pulls the wrong listing.
    assert.equal(
      businessReviews.resolveQueryFromMember(
        { companyName: 'Acme Floors', reviewLinks: {} },
        { city: 'Portland', state: 'OR', placeId: 'ChIJwrongplace99' }
      ),
      ''
    );
  });

  it('resolveYelpQueryFromMember uses only the Yelp request-site link', () => {
    assert.match(
      businessReviews.resolveYelpQueryFromMember({
        reviewLinks: { yelp: 'https://www.yelp.com/biz/acme-floors-portland' },
      }),
      /yelp\.com\/biz\/acme-floors-portland/
    );
    assert.equal(
      businessReviews.resolveYelpQueryFromMember({
        companyName: 'Acme',
        reviewLinks: { google: 'https://g.page/r/xyz/review' },
      }),
      ''
    );
    assert.equal(
      businessReviews.resolveYelpQueryFromMember({
        reviewLinks: { yelp: 'acme-floors-portland' },
      }),
      'acme-floors-portland'
    );
  });

  it('normalizes Yelp reviews with source and strips HTML', () => {
    const row = businessReviews.normalizeStoredReview({
      source: 'yelp',
      review_id: 'yelpRev1',
      review_rating: 5,
      author_name: 'Pat',
      review_text: 'Great floors<br><br>Would hire again',
      owner_replies: [{ text: 'Thanks Pat!' }],
    });
    assert.equal(row.source, 'yelp');
    assert.match(row.id, /^yelp:id:yelpRev1/);
    assert.doesNotMatch(row.text, /<br/i);
    assert.match(row.text, /Great floors/);
    assert.equal(row.ownerResponse, 'Thanks Pat!');
    const google = businessReviews.normalizeStoredReview({
      source: 'google',
      review_id: 'yelpRev1',
      review_rating: 4,
      review_text: 'Different platform same id',
    });
    assert.notEqual(row.id, google.id);
  });

  it('sanitizeReviewText strips HTML tags and turns br into newlines', () => {
    const raw = '★★★★★<br><br>Great job<br>Would hire again';
    const out = businessReviews.sanitizeReviewText(raw);
    assert.doesNotMatch(out, /<br/i);
    assert.doesNotMatch(out, /</);
    assert.match(out, /Great job/);
    assert.match(out, /\n/);
    assert.equal(
      businessReviews.sanitizeReviewText('<p>Hello &amp; thanks</p>'),
      'Hello & thanks'
    );
  });

  it('memberStorageId scopes settings separately from workspace', () => {
    const sid = businessReviews.memberStorageId('net1', 'mem1');
    assert.equal(sid, 'member:net1:mem1');
    businessReviews.saveSettings(sid, { query: 'ChIJmember', businessName: 'Member Co' });
    assert.equal(businessReviews.getSettings(sid).query, 'ChIJmember');
    assert.equal(businessReviews.getSettings(WID).query, '');
    dbService.deleteKvSync(businessReviews.SETTINGS_PREFIX + sid);
  });

  it('resolveReviewsOutscraperEnv prefers agency provider helper (not workspace env)', async () => {
    const wi = require('../services/workspaceIntegrations');
    const prev = wi.resolveAgencyProviderEnv;
    let calledWith = null;
    wi.resolveAgencyProviderEnv = async (fields) => {
      calledWith = fields;
      return {
        OUTSCRAPER_API_KEY: 'agency-outscraper-test-key',
        OUTSCRAPER_API_BASE: 'https://api.app.outscraper.com',
        AGENCY_SHARED_WORKSPACE_ID: 'ws_agency_test',
      };
    };
    try {
      const env = await businessReviews.resolveReviewsOutscraperEnv();
      assert.deepEqual(calledWith, ['outscraperApiKey', 'outscraperApiBase']);
      assert.equal(env.OUTSCRAPER_API_KEY, 'agency-outscraper-test-key');
      assert.equal(env.AGENCY_SHARED_WORKSPACE_ID, 'ws_agency_test');
    } finally {
      wi.resolveAgencyProviderEnv = prev;
    }
  });

  it('member Review page embeds Google reviews inbox', () => {
    const review = fs.readFileSync(path.join(__dirname, '../views/member_app/review.ejs'), 'utf8');
    const partial = fs.readFileSync(path.join(__dirname, '../views/member_app/_google_reviews.ejs'), 'utf8');
    const route = fs.readFileSync(path.join(__dirname, '../routes/memberApp.js'), 'utf8');
    const svc = fs.readFileSync(path.join(__dirname, '../services/businessReviews.js'), 'utf8');
    assert.match(review, /_google_reviews/);
    // Request | Reviews tabs (like Referrals); Google & Yelp live on the Reviews tab.
    assert.match(review, /ma-seg ma-seg--2/);
    assert.match(review, /Review sections/);
    assert.match(review, />Request</);
    assert.match(review, /view=reviews/);
    assert.match(review, /googleReviewsTabMode:\s*true/);
    assert.match(review, /Show your QR/);
    assert.match(review, /Google & Yelp reviews/);
    assert.match(review, /id="maAutoFollowUp"/);
    assert.match(review, /Automated follow-ups/);
    assert.match(review, /Automated follow-ups are on the monthly plan/);
    assert.match(review, /monthly plan/);
    assert.match(review, /ma-qr/);
    const join = fs.readFileSync(path.join(__dirname, '../views/member_app/join.ejs'), 'utf8');
    assert.match(join, /Automated ~48h follow-up/);
    assert.match(partial, /googleReviewsTabMode/);
    assert.match(partial, /ma-gr-tab/);
    assert.match(partial, /Generate with AI/);
    assert.match(partial, /Generating…/);
    assert.match(partial, /aria-busy/);
    assert.match(partial, /Writing reply…/);
    assert.match(partial, /Copy reply/);
    assert.match(partial, /See Google &amp; Yelp reviews|See Google & Yelp reviews|Google &amp; Yelp reviews/);
    assert.match(partial, /AdHello/);
    assert.match(partial, /ma-fold/);
    assert.match(partial, /maGrList/);
    assert.match(partial, /ma-gr-review/);
    assert.match(partial, /Google request-site link/);
    assert.match(partial, /Yelp request-site link/);
    assert.match(partial, /request sites/);
    assert.doesNotMatch(partial, /id="maGrQuery"/);
    assert.match(route, /reviewView/);
    assert.match(route, /=== 'reviews'/);
    assert.match(route, /googleReviewFocusId/);
    assert.match(route, /google-reviews\/sync/);
    assert.match(route, /resolveQueryFromMember\(member\)/);
    assert.match(route, /resolveYelpQueryFromMember\(member\)/);
    assert.match(route, /resolveReviewsOutscraperEnv/);
    assert.match(svc, /resolveAgencyProviderEnv/);
    assert.match(svc, /resolveReviewsOutscraperEnv/);
    assert.match(svc, /sanitizeReviewText/);
    assert.match(svc, /fetchYelpReviews/);
    assert.doesNotMatch(svc, /getResolvedIntegrationEnv\(/);
    const client = fs.readFileSync(path.join(__dirname, '../services/outscraperClient.js'), 'utf8');
    assert.match(client, /fetchYelpReviews/);
    assert.match(client, /yelp-reviews/);
  });
});
