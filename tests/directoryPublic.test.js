/**
 * Public directory feed + detail + store publish flow.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'directory-public-'));

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');
const directoryStore = require('../services/directoryStore');
const directoryPublic = require('../services/directoryPublic');
const { buildDirectoryPagePrompt } = require('../services/directoryPagePrompt');

const WID = 'ws_directory_public';

describe('public business directory', () => {
  beforeEach(async () => {
    await dbService.saveWorkspace(WID, {
      id: WID,
      name: 'Directory Co',
      ownerUserId: 'owner@example.com',
      members: [{ email: 'owner@example.com', role: 'admin' }],
      directory: null,
    });
    await dbService.saveLead({
      key: 'lead:chimney_1',
      workspaceId: WID,
      title: 'Acme Chimney Sweep',
      categoryName: 'Chimney Sweep',
      city: 'Austin',
      state: 'TX',
      phone: '+15551234567',
      website: 'https://acmechimney.example',
      totalScore: 4.8,
      reviewsCount: 42,
      address: '100 Main St',
      description: 'Family-owned chimney cleaning and repair across Austin.',
      reviewSnippets: [
        'They were on time and cleaned everything carefully.',
        'Great communication and fair pricing.',
      ],
      reviewIntel: {
        summary: 'Customers praise punctuality and careful cleanup; a sales angle is review velocity.',
      },
    });
  });

  it('publishes a lead and serves index + slug detail with schema', async () => {
    const listing = await directoryStore.upsertFromLead(WID, 'lead:chimney_1', { published: true });
    assert.equal(listing.published, true);
    assert.equal(listing.slug, 'acme-chimney-sweep');
    assert.equal(listing.name, 'Acme Chimney Sweep');
    assert.equal(listing.category, 'Chimney Sweep');
    assert.match(listing.description, /Family-owned/);
    assert.equal(listing.rating, 4.8);
    assert.equal(listing.reviewCount, 42);
    assert.equal(listing.reviewSentiment, 'positive');
    assert.equal(listing.reviewSnippets.length, 2);
    assert.match(listing.reviewSummary, /punctuality/i);

    const bundle = await directoryStore.ensurePublicToken(WID);
    const token = bundle.settings.publicToken;
    assert.match(token, /^dir_/);

    const feed = await directoryPublic.getPublicFeed(token);
    assert.equal(feed.businesses.length, 1);
    assert.equal(feed.businesses[0].slug, 'acme-chimney-sweep');
    assert.equal(feed.businesses[0].category, 'Chimney Sweep');
    assert.equal(feed.businesses[0].review_sentiment, 'positive');
    assert.equal(feed.businesses[0].reviews.length, 2);
    assert.match(feed.businesses[0].description, /Family-owned/);
    assert.equal(feed.item_list_schema['@type'], 'ItemList');
    assert.equal(feed.item_list_schema.numberOfItems, 1);

    const detail = await directoryPublic.getPublicBusiness(token, 'acme-chimney-sweep');
    assert.equal(detail.business.name, 'Acme Chimney Sweep');
    assert.equal(detail.local_business_schema['@type'], 'LocalBusiness');
    assert.equal(detail.local_business_schema.telephone, '+15551234567');
    assert.equal(detail.local_business_schema.aggregateRating.ratingValue, 4.8);
    assert.equal(detail.local_business_schema.review.length, 2);
    assert.equal(detail.local_business_schema.review[0]['@type'], 'Review');
  });

  it('hides unpublished listings from the public feed', async () => {
    await directoryStore.upsertFromLead(WID, 'lead:chimney_1', { published: false });
    const bundle = await directoryStore.ensurePublicToken(WID);
    const feed = await directoryPublic.getPublicFeed(bundle.settings.publicToken);
    assert.equal(feed.businesses.length, 0);
  });

  it('uses Maps category, never pipeline jobType maps_business', async () => {
    await dbService.saveLead({
      key: 'lead:hvac_1',
      workspaceId: WID,
      title: 'Northside Air',
      jobType: 'maps_business',
      sourceType: 'maps_business',
      categoryName: 'HVAC contractor',
      city: 'Portland',
      state: 'OR',
    });
    const listing = await directoryStore.upsertFromLead(WID, 'lead:hvac_1', { published: true });
    assert.equal(listing.category, 'HVAC contractor');
    assert.notEqual(listing.category, 'maps_business');

    await dbService.saveLead({
      key: 'lead:jobtype_only',
      workspaceId: WID,
      title: 'Jobtype Only Co',
      jobType: 'maps_business',
      city: 'Tigard',
      state: 'OR',
    });
    const bare = await directoryStore.upsertFromLead(WID, 'lead:jobtype_only', { published: true });
    assert.equal(bare.category, '');

    // Stale rows that already stored maps_business get repaired from the lead.
    const bundle = await directoryStore.load(WID);
    const staleId = Object.keys(bundle.listings)[0];
    bundle.listings[staleId] = {
      ...bundle.listings[staleId],
      leadKey: 'lead:hvac_1',
      category: 'maps_business',
    };
    await directoryStore.save(WID, { listings: bundle.listings, settings: bundle.settings });
    const repaired = await directoryStore.repairJobTypeCategories(
      WID,
      await directoryStore.load(WID, { normalize: false }),
    );
    assert.ok(repaired.changed >= 1);
    const fixed = directoryStore.listListings(repaired.bundle).find((r) => r.leadKey === 'lead:hvac_1');
    assert.equal(fixed.category, 'HVAC contractor');
    assert.equal(directoryStore.isJobTypeCategorySlug('maps_business'), true);
    assert.equal(directoryStore.leadCategoryLabel({ jobType: 'maps_business' }), '');
    assert.equal(
      directoryStore.leadCategoryLabel({ jobType: 'maps_business', categoryName: 'Air duct cleaning' }),
      'Air duct cleaning',
    );
  });

  it('bulk-adds selected pipeline leads into the workspace directory only', async () => {
    await dbService.saveLead({
      key: 'lead:chimney_2',
      workspaceId: WID,
      title: 'Bee Cave Chimney',
      category: 'Chimney Sweep',
      city: 'Bee Cave',
      state: 'TX',
      phone: '+15559876543',
    });
    const result = await directoryStore.upsertManyFromLeads(
      WID,
      ['lead:chimney_1', 'lead:chimney_2', 'lead:missing'],
      { published: true },
    );
    assert.equal(result.added, 2);
    assert.equal(result.failed, 1);
    const bundle = await directoryStore.load(WID);
    assert.equal(directoryStore.listListings(bundle, { published: true }).length, 2);
  });

  it('updates listing fields from the edit drawer save path', async () => {
    const listing = await directoryStore.upsertFromLead(WID, 'lead:chimney_1', { published: true });
    const updated = await directoryStore.updateListing(WID, listing.id, {
      name: 'Acme Chimney Pros',
      category: 'Chimney sweep',
      description: 'Edited description for the website.',
      reviewSentiment: 'mostly_positive',
      reviewSnippets: 'On time and careful.\nFair pricing.',
      blurb: 'Trusted chimney crew',
      published: true,
    });
    assert.equal(updated.name, 'Acme Chimney Pros');
    assert.equal(updated.category, 'Chimney sweep');
    assert.match(updated.description, /Edited description/);
    assert.equal(updated.reviewSentiment, 'mostly_positive');
    assert.equal(updated.reviewSnippets.length, 2);
    assert.equal(updated.blurb, 'Trusted chimney crew');

    // maps_business cannot stick as a category via edit either.
    const cleared = await directoryStore.updateListing(WID, listing.id, { category: 'maps_business' });
    assert.equal(cleared.category, '');
  });

  it('page-builder prompt uses workspace custom domain, not AdHello.io', () => {
    const { originFromPageUrl } = require('../services/directoryPagePrompt');
    assert.equal(originFromPageUrl('https://flooringquote.com/directory'), 'https://flooringquote.com');

    const prompt = buildDirectoryPagePrompt({
      siteUrl: 'https://flooringquote.com',
      pathPrefix: '/directory',
      businessName: 'Flooring Quote',
      feedUrl: 'https://leads.example.com/api/public/directory/tok/feed.json',
      detailUrlTemplate: 'https://leads.example.com/api/public/directory/tok/businesses/{slug}.json',
    });
    assert.match(prompt, /flooringquote\.com\/directory/);
    assert.match(prompt, /Flooring Quote/);
    assert.match(prompt, /feed\.json/);
    assert.match(prompt, /\{slug\}/);
    assert.match(prompt, /item_list_schema/);
    assert.match(prompt, /local_business_schema/);
    assert.match(prompt, /review_sentiment/);
    assert.match(prompt, /reviews\[\]\.text|reviews:\s*\[\{\s*text/);
    assert.match(prompt, /do not use AdHello branding/i);
    assert.doesNotMatch(prompt, /https:\/\/adhello\.io\/directory/);

    const unset = buildDirectoryPagePrompt({ businessName: 'Flooring Quote' });
    assert.match(unset, /SET LIVE DIRECTORY URL/i);
    assert.doesNotMatch(unset, /https:\/\/adhello\.io/);
  });

  it('wires routes, nav, permissions, and pipeline More → Directory', () => {
    const root = path.join(__dirname, '..');
    const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
    const perms = fs.readFileSync(path.join(root, 'services/rolePermissions.js'), 'utf8');
    const nav = fs.readFileSync(path.join(root, 'views/partials/app_nav_items.ejs'), 'utf8');
    const seoNav = fs.readFileSync(path.join(root, 'views/partials/seo_local_rank_nav.ejs'), 'utf8');
    const routes = fs.readFileSync(path.join(root, 'routes/directory.js'), 'utf8');
    const view = fs.readFileSync(path.join(root, 'views/directory.ejs'), 'utf8');
    const bar = fs.readFileSync(path.join(root, 'views/partials/bulk_action_bar.ejs'), 'utf8');
    const moreIdx = bar.indexOf('id="bulkBarMore"');
    assert.match(server, /directoryPublicRoutes/);
    assert.match(server, /\/directory/);
    assert.match(perms, /id: 'directory'/);
    assert.match(nav, /href="\/directory"/);
    assert.match(seoNav, /href="\/directory"/);
    assert.match(routes, /\/listings\/bulk/);
    assert.match(routes, /upsertManyFromLeads/);
    // First paint is a shell (like Reviews/Q&A); listings hydrate from inbox.json.
    assert.match(routes, /shell:\s*true/);
    assert.match(routes, /inboxHydrate/);
    assert.match(routes, /\/inbox\.json/);
    assert.match(view, /\/directory\/inbox\.json/);
    assert.match(view, /applyInbox/);
    assert.match(view, /showReviews/);
    assert.match(view, /reviewSentiment/);
    assert.match(view, /js-dir-open/);
    assert.match(view, /dirEditDrawer/);
    assert.match(view, /dirEditForm/);
    assert.match(view, /openEdit/);
    assert.match(routes, /showReviews/);
    assert.match(routes, /updateListing/);
    assert.match(routes, /\/listings\/:id\.json/);
    assert.match(routes, /router\.post\('\/listings\/:id'/);
    assert.ok(moreIdx >= 0);
    assert.ok(bar.indexOf('id="bulkAddDirectoryBtn"', moreIdx) > moreIdx);
    assert.match(bar, /\/directory\/listings\/bulk/);
    assert.match(bar, /__bulkDirectoryBound/);
  });
});
