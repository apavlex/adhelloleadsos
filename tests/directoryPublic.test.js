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
      category: 'Chimney Sweep',
      city: 'Austin',
      state: 'TX',
      phone: '+15551234567',
      website: 'https://acmechimney.example',
      rating: 4.8,
      reviewsCount: 42,
      address: '100 Main St',
    });
  });

  it('publishes a lead and serves index + slug detail with schema', async () => {
    const listing = await directoryStore.upsertFromLead(WID, 'lead:chimney_1', { published: true });
    assert.equal(listing.published, true);
    assert.equal(listing.slug, 'acme-chimney-sweep');
    assert.equal(listing.name, 'Acme Chimney Sweep');

    const bundle = await directoryStore.ensurePublicToken(WID);
    const token = bundle.settings.publicToken;
    assert.match(token, /^dir_/);

    const feed = await directoryPublic.getPublicFeed(token);
    assert.equal(feed.businesses.length, 1);
    assert.equal(feed.businesses[0].slug, 'acme-chimney-sweep');
    assert.equal(feed.item_list_schema['@type'], 'ItemList');
    assert.equal(feed.item_list_schema.numberOfItems, 1);

    const detail = await directoryPublic.getPublicBusiness(token, 'acme-chimney-sweep');
    assert.equal(detail.business.name, 'Acme Chimney Sweep');
    assert.equal(detail.local_business_schema['@type'], 'LocalBusiness');
    assert.equal(detail.local_business_schema.telephone, '+15551234567');
  });

  it('hides unpublished listings from the public feed', async () => {
    await directoryStore.upsertFromLead(WID, 'lead:chimney_1', { published: false });
    const bundle = await directoryStore.ensurePublicToken(WID);
    const feed = await directoryPublic.getPublicFeed(bundle.settings.publicToken);
    assert.equal(feed.businesses.length, 0);
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

  it('page-builder prompt wires feed + detail + schema instructions', () => {
    const prompt = buildDirectoryPagePrompt({
      siteUrl: 'https://adhello.io',
      pathPrefix: '/directory',
      businessName: 'AdHello',
      feedUrl: 'https://leads.adhello.io/api/public/directory/tok/feed.json',
      detailUrlTemplate: 'https://leads.adhello.io/api/public/directory/tok/businesses/{slug}.json',
    });
    assert.match(prompt, /feed\.json/);
    assert.match(prompt, /\{slug\}/);
    assert.match(prompt, /item_list_schema/);
    assert.match(prompt, /local_business_schema/);
    assert.match(prompt, /AI Studio/);
  });

  it('wires routes, nav, permissions, and pipeline More → Directory', () => {
    const root = path.join(__dirname, '..');
    const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
    const perms = fs.readFileSync(path.join(root, 'services/rolePermissions.js'), 'utf8');
    const nav = fs.readFileSync(path.join(root, 'views/partials/app_nav_items.ejs'), 'utf8');
    const seoNav = fs.readFileSync(path.join(root, 'views/partials/seo_local_rank_nav.ejs'), 'utf8');
    const routes = fs.readFileSync(path.join(root, 'routes/directory.js'), 'utf8');
    const bar = fs.readFileSync(path.join(root, 'views/partials/bulk_action_bar.ejs'), 'utf8');
    const moreIdx = bar.indexOf('id="bulkBarMore"');
    assert.match(server, /directoryPublicRoutes/);
    assert.match(server, /\/directory/);
    assert.match(perms, /id: 'directory'/);
    assert.match(nav, /href="\/directory"/);
    assert.match(seoNav, /href="\/directory"/);
    assert.match(routes, /\/listings\/bulk/);
    assert.match(routes, /upsertManyFromLeads/);
    assert.ok(moreIdx >= 0);
    assert.ok(bar.indexOf('id="bulkAddDirectoryBtn"', moreIdx) > moreIdx);
    assert.match(bar, /\/directory\/listings\/bulk/);
    assert.match(bar, /__bulkDirectoryBound/);
  });
});
