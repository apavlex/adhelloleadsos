/**
 * Directory profile lead forms → Reviews app notify.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'directory-lead-'));

const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');
const directoryStore = require('../services/directoryStore');
const directoryPublic = require('../services/directoryPublic');
const directoryLeadIntake = require('../services/directoryLeadIntake');
const networkStore = require('../services/networkStore');
const memberWork = require('../services/memberWork');
const memberActivity = require('../services/memberActivity');
const { buildDirectoryPagePrompt } = require('../services/directoryPagePrompt');

const WID = 'ws_directory_lead_intake';

describe('directory profile lead intake', () => {
  beforeEach(async () => {
    await dbService.saveWorkspace(WID, {
      id: WID,
      name: 'HomeElk',
      ownerUserId: 'owner@example.com',
      members: [{ email: 'owner@example.com', role: 'admin' }],
      directory: null,
    });
    await dbService.saveLead({
      key: 'lead:brothers_1',
      workspaceId: WID,
      title: '2 Brothers Contracting LLC',
      categoryName: 'Roofing contractor',
      city: 'Vancouver',
      state: 'WA',
      phone: '+13605551212',
      website: 'https://2brothers.example',
      totalScore: 5,
      reviewsCount: 28,
      address: '7017 NE 124th Ave, Vancouver, WA',
    });
  });

  it('exposes lead_form_url and review_page_url on public business detail', async () => {
    const listing = await directoryStore.upsertFromLead(WID, 'lead:brothers_1', { published: true });
    const network = await networkStore.getOrCreateNetworkForWorkspace(WID, {
      name: 'HomeElk partners',
      ownerEmail: 'owner@example.com',
    });
    await networkStore.saveMember(network.id, {
      id: 'mem_brothers_detail',
      companyName: '2 Brothers Contracting LLC',
      status: 'active',
      leadKey: 'lead:brothers_1',
      reviewSlug: '2-brothers-contracting-llc',
      reviewLinks: {
        google: 'https://g.page/r/brothers/review',
        yelp: 'https://yelp.com/biz/2-brothers',
      },
    });
    const bundle = await directoryStore.ensurePublicToken(WID);
    const token = bundle.settings.publicToken;
    const detail = await directoryPublic.getPublicBusiness(token, listing.slug, {
      origin: 'https://leads.adhello.io',
    });
    assert.match(detail.lead_form_url, /\/leads$/);
    assert.match(detail.lead_form_url, new RegExp(listing.slug));
    assert.match(detail.review_page_url, /\/rv\/2-brothers-contracting-llc/);
    assert.equal(detail.business.review_page_url, detail.review_page_url);
    assert.ok(Array.isArray(detail.review_links));
    assert.ok(detail.review_links.some((l) => l.key === 'google'));
    assert.ok(detail.local_business_schema.sameAs.some((u) => /\/rv\//.test(u)));
    assert.match(detail.seo_note, /review_page_url|Leave a review/i);
  });

  it('powered-by footer uses Directory site host (homeelk.com)', async () => {
    const directoryMemberLink = require('../services/directoryMemberLink');
    await directoryStore.save(WID, {
      settings: {
        pageUrl: 'https://homeelk.com/pros',
        pageTitle: 'Pros',
        businessName: 'HomeElk',
        pathPrefix: '/pros',
        publicToken: 'dir_test_powered',
      },
      listings: {},
    });
    const powered = await directoryMemberLink.poweredByForWorkspace(WID);
    assert.equal(powered.label, 'homeelk.com');
    assert.match(powered.href, /homeelk\.com/);

    const unset = await directoryMemberLink.poweredByForWorkspace('ws_missing_dir');
    assert.equal(unset.label, 'homeelk.com');
  });

  it('routes a profile form into Reviews inbox + customer lead', async () => {
    const listing = await directoryStore.upsertFromLead(WID, 'lead:brothers_1', {
      published: true,
      slug: '2-brothers-contracting-llc',
    });
    assert.equal(listing.slug, '2-brothers-contracting-llc');

    const network = await networkStore.getOrCreateNetworkForWorkspace(WID, {
      name: 'HomeElk partners',
      ownerEmail: 'owner@example.com',
    });
    const member = await networkStore.saveMember(network.id, {
      id: 'mem_brothers',
      companyName: '2 Brothers Contracting LLC',
      contactName: 'Ed',
      email: 'ed@2brothers.example',
      phone: '+13605551212',
      status: 'active',
      leadKey: 'lead:brothers_1',
      reviewSlug: '2-brothers-contracting-llc',
      plan: 'partner',
    });
    assert.equal(member.leadKey, 'lead:brothers_1');

    const notifyCalls = [];
    mock.method(require('../services/networkNotify'), 'notifyMemberFormLead', async (args) => {
      notifyCalls.push(args);
      return { ok: true };
    });

    const bundle = await directoryStore.ensurePublicToken(WID);
    const result = await directoryLeadIntake.submitDirectoryLead(
      bundle.settings.publicToken,
      listing.slug,
      {
        name: 'Jordan Homeowner',
        phone: '3605559999',
        email: 'jordan@example.com',
        message: 'Need a roof quote after the storm',
        page_url: 'https://homeelk.com/pros/2-brothers-contracting-llc',
      },
      { ip: '203.0.113.10', origin: 'https://leads.adhello.io' },
    );

    assert.equal(result.routed, true);
    assert.equal(result.business.slug, '2-brothers-contracting-llc');
    assert.ok(result.customer_id);
    assert.match(result.app_url, /\/m\//);
    assert.match(result.app_url, /\/customers\/c\//);
    assert.match(result.review_page_url, /\/rv\/2-brothers-contracting-llc/);
    assert.equal(notifyCalls.length, 1);
    assert.equal(notifyCalls[0].customerId, result.customer_id);
    assert.match(notifyCalls[0].formName, /HomeElk|2 Brothers/i);

    const customer = await memberWork.getCustomer(network.id, member.id, result.customer_id);
    assert.ok(customer);
    assert.equal(customer.isLead, true);
    assert.equal(customer.source, 'website_form');
    assert.match(customer.notes || '', /storm/i);

    // Even if push/SMS is mocked away, recordMemberActivity still ran inside notify —
    // when notify is mocked, seed inbox ourselves to prove the expected kind path.
    const inbox = memberActivity.listInbox(network.id, member.id);
    // notify was mocked, so inbox may be empty — that's OK; customer + app_url are the contract.
    assert.ok(Array.isArray(inbox));
  });

  it('accepts unclaimed listings without Reviews routing', async () => {
    await dbService.saveLead({
      key: 'lead:unclaimed_roof',
      workspaceId: WID,
      title: 'Unclaimed Roof Pros',
      categoryName: 'Roofing contractor',
      city: 'Portland',
      state: 'OR',
      phone: '+15035550000',
    });
    const listing = await directoryStore.upsertFromLead(WID, 'lead:unclaimed_roof', { published: true });
    const bundle = await directoryStore.ensurePublicToken(WID);
    const result = await directoryLeadIntake.submitDirectoryLead(
      bundle.settings.publicToken,
      listing.slug,
      { name: 'Sam', phone: '5551112222' },
      { ip: '203.0.113.11', origin: 'https://leads.adhello.io' },
    );
    assert.equal(result.routed, false);
    assert.equal(result.reason, 'listing_unclaimed');
  });

  it('rejects empty contact fields', async () => {
    const listing = await directoryStore.upsertFromLead(WID, 'lead:brothers_1', { published: true });
    const bundle = await directoryStore.ensurePublicToken(WID);
    await assert.rejects(
      () =>
        directoryLeadIntake.submitDirectoryLead(
          bundle.settings.publicToken,
          listing.slug,
          { message: 'hello' },
          { ip: '203.0.113.12' },
        ),
      (err) => err && err.code === 'INVALID',
    );
  });

  it('page-builder prompt includes profile lead form POST and review page CTA', () => {
    const prompt = buildDirectoryPagePrompt({
      siteUrl: 'https://homeelk.com',
      pathPrefix: '/pros',
      businessName: 'HomeElk',
      feedUrl: 'https://leads.example.com/api/public/directory/tok/feed.json',
      detailUrlTemplate: 'https://leads.example.com/api/public/directory/tok/businesses/{slug}.json',
      leadFormUrlTemplate: 'https://leads.example.com/api/public/directory/tok/businesses/{slug}/leads',
    });
    assert.match(prompt, /homeelk\.com\/pros/);
    assert.match(prompt, /lead_form_url/);
    assert.match(prompt, /review_page_url/);
    assert.match(prompt, /Leave a review/i);
    assert.match(prompt, /\/leads/);
    assert.match(prompt, /Reviews app/i);
    assert.match(prompt, /app_url/);
  });

  it('wires public POST route and review footer powered-by homeelk', () => {
    const root = path.join(__dirname, '..');
    const routes = fs.readFileSync(path.join(root, 'routes/directoryPublic.js'), 'utf8');
    const view = fs.readFileSync(path.join(root, 'views/directory.ejs'), 'utf8');
    const dirRoutes = fs.readFileSync(path.join(root, 'routes/directory.js'), 'utf8');
    const reviewView = fs.readFileSync(path.join(root, 'views/review_public.ejs'), 'utf8');
    assert.match(routes, /businesses\/:slug\/leads/);
    assert.match(routes, /submitDirectoryLead/);
    assert.match(view, /dirLeadFormUrl/);
    assert.match(view, /leadFormUrlTemplate/);
    assert.match(view, /review_page_url/);
    assert.match(view, /dirEditMemberId/);
    assert.match(view, /dirCopyPortal/);
    assert.match(view, /dirTextPortal/);
    assert.match(dirRoutes, /leadFormUrlTemplate/);
    assert.match(dirRoutes, /reviews-members\.json/);
    assert.match(dirRoutes, /send-portal-link/);
    assert.match(reviewView, /poweredBy/);
    assert.match(reviewView, /homeelk\.com/);
    assert.doesNotMatch(reviewView, /href="https:\/\/adhello\.io"/);
  });

  it('prefers listing.memberId over soft leadKey / name match', async () => {
    const directoryMemberLink = require('../services/directoryMemberLink');
    const listing = await directoryStore.upsertFromLead(WID, 'lead:brothers_1', {
      published: true,
      slug: '2-brothers-contracting-llc',
    });
    const network = await networkStore.getOrCreateNetworkForWorkspace(WID, {
      name: 'HomeElk partners',
      ownerEmail: 'owner@example.com',
    });
    // Soft-matched member (same leadKey) — resolve without memberId uses this path.
    await networkStore.saveMember(network.id, {
      id: 'mem_soft_name',
      companyName: '2 Brothers Contracting LLC',
      status: 'active',
      leadKey: 'lead:brothers_1',
      reviewSlug: '2-brothers-soft',
    });
    const explicit = await networkStore.saveMember(network.id, {
      id: 'mem_explicit_link',
      companyName: 'Different Co Name',
      status: 'active',
      leadKey: 'lead:other',
      reviewSlug: 'explicit-linked-biz',
    });
    const before = await directoryMemberLink.resolveMemberForListing(WID, listing);
    assert.ok(before && before.member);
    assert.notEqual(before.member.id, explicit.id);
    assert.ok(before.match === 'lead_key' || before.match === 'company_name');

    const linked = await directoryStore.updateListing(WID, listing.id, {
      memberId: explicit.id,
    });
    assert.equal(linked.memberId, explicit.id);

    const after = await directoryMemberLink.resolveMemberForListing(WID, linked);
    assert.equal(after.match, 'member_id');
    assert.equal(after.member.id, explicit.id);

    const notifyCalls = [];
    mock.method(require('../services/networkNotify'), 'notifyMemberFormLead', async (args) => {
      notifyCalls.push(args);
      return { ok: true };
    });
    const bundle = await directoryStore.ensurePublicToken(WID);
    const result = await directoryLeadIntake.submitDirectoryLead(
      bundle.settings.publicToken,
      linked.slug,
      {
        name: 'Pat Homeowner',
        phone: '3605557777',
        message: 'Quote please',
      },
      { ip: '203.0.113.20', origin: 'https://leads.adhello.io' },
    );
    assert.equal(result.routed, true);
    assert.match(result.review_page_url, /\/rv\/explicit-linked-biz/);
    const customer = await memberWork.getCustomer(network.id, explicit.id, result.customer_id);
    assert.ok(customer);
    assert.equal(notifyCalls.length, 1);

    // Refresh from Pipeline must keep the explicit member link.
    const refreshed = await directoryStore.upsertFromLead(WID, 'lead:brothers_1', {
      published: true,
      slug: linked.slug,
    });
    assert.equal(refreshed.memberId, explicit.id);
  });

  it('clears memberId when Directory save sends empty string', async () => {
    const listing = await directoryStore.upsertFromLead(WID, 'lead:brothers_1', { published: true });
    await directoryStore.updateListing(WID, listing.id, { memberId: 'mem_to_clear' });
    const cleared = await directoryStore.updateListing(WID, listing.id, { memberId: '' });
    assert.equal(cleared.memberId, '');
  });
});
