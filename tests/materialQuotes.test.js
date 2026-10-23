/**
 * Flooring partner material quote requests (measure / photos / notes / materials).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mat-quote-'));

const { describe, it, before, mock } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const dbService = require('../services/database');
const store = require('../services/networkStore');
const freeAppSignup = require('../services/freeAppSignup');
const materialQuotes = require('../services/materialQuotes');
const { createMemberPortalToken } = require('../services/networkLinkSign');
const memberApp = require('../routes/memberApp');

describe('materialQuotes', () => {
  let network;
  let flooringMember;
  let freeMember;

  before(async () => {
    await dbService.saveWorkspace('ws_mat_quote', {
      name: 'Flooring Supplier Co',
      slug: 'flooring-supplier',
      members: { 'ops@supplier.test': { role: 'owner' } },
    });
    network = await store.getOrCreateNetworkForWorkspace('ws_mat_quote', {
      name: 'Flooring Supplier',
      ownerEmail: 'ops@supplier.test',
    });
    flooringMember = await store.saveMember(network.id, {
      companyName: 'Camas Floors LLC',
      contactName: 'Fran',
      phone: '503-555-0144',
      status: 'active',
      plan: freeAppSignup.PLAN_APP_FLOORING,
      signupOffer: freeAppSignup.OFFER_FLOORING,
      trades: ['flooring'],
    });
    freeMember = await store.saveMember(network.id, {
      companyName: 'Trial Plumber',
      contactName: 'Pat',
      status: 'active',
      plan: freeAppSignup.PLAN_APP_FREE,
      trades: ['plumbing'],
    });
  });

  it('validates materials, measure, name, and confirm', () => {
    const empty = materialQuotes.buildQuote({});
    assert.equal(empty.ok, false);
    assert.match(empty.error, /job site|customer/i);

    const noMats = materialQuotes.buildQuote({
      name: 'Smith',
      measure: '200 sq ft',
      confirm: 'on',
    });
    assert.equal(noMats.ok, false);
    assert.match(noMats.error, /materials/i);

    const noMeasure = materialQuotes.buildQuote({
      name: 'Smith',
      materials: 'LVP',
      confirm: 'on',
    });
    assert.equal(noMeasure.ok, false);
    assert.match(noMeasure.error, /measure/i);

    const ok = materialQuotes.buildQuote({
      name: 'Smith residence',
      phone: '503-555-0100',
      city: 'Camas',
      materials: 'LVP + underlayment',
      measure: 'Living 18x14 — ~250 sq ft',
      notes: 'Glue-down preferred',
      confirm: 'on',
    }, { fromMemberId: 'm1', by: 'Camas Floors' });
    assert.equal(ok.ok, true);
    assert.equal(ok.quote.jobSite.name, 'Smith residence');
    assert.equal(ok.quote.materials, 'LVP + underlayment');
    assert.equal(ok.quote.measure, 'Living 18x14 — ~250 sq ft');
    assert.equal(ok.quote.notes, 'Glue-down preferred');
    assert.equal(ok.quote.fromMemberId, 'm1');
    assert.equal(ok.quote.status, 'requested');
  });

  it('submits a quote for flooring partners and notifies the supplier', async () => {
    const notify = require('../services/networkNotify');
    let ping = null;
    mock.method(notify, 'notifyMaterialQuote', async (args) => {
      ping = args;
      return { ok: true, taskId: 'task1' };
    });

    const result = await materialQuotes.submitQuote({
      network,
      member: flooringMember,
      input: {
        name: 'River remodel',
        city: 'Vancouver',
        materials: '¾" oak, stair nosing',
        measure: 'Hall 4x22, stairs 12 risers',
        notes: 'Need by Friday',
        confirm: 'on',
      },
    });
    assert.equal(result.ok, true);
    assert.ok(result.quote.id);
    assert.equal(result.quote.materials.includes('oak'), true);
    // Supplier is the network owner — never another trade partner.
    assert.equal(result.quote.toOwnerEmail, 'ops@supplier.test');
    assert.equal(result.quote.toOwnerWorkspaceId, network.ownerWorkspaceId);
    assert.equal(ping.member.id, flooringMember.id);
    assert.equal(ping.quote.id, result.quote.id);

    const listed = await materialQuotes.listQuotesForMember(network.id, flooringMember.id);
    assert.ok(listed.some((q) => q.id === result.quote.id));
    mock.restoreAll();
  });

  it('rejects quote submit for non-flooring free members', async () => {
    const result = await materialQuotes.submitQuote({
      network,
      member: freeMember,
      input: {
        name: 'X',
        materials: 'pipe',
        measure: '1',
        confirm: 'on',
      },
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /flooring/i);
  });

  it('serves Quote tab and accepts POST /quote for flooring partners', async () => {
    const notify = require('../services/networkNotify');
    mock.method(notify, 'notifyMaterialQuote', async () => ({ ok: true }));

    const token = createMemberPortalToken({ networkId: network.id, memberId: flooringMember.id });
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'views'));
    app.locals.assetVersion = 'test';
    app.use('/', memberApp);
    const server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const base = `http://127.0.0.1:${server.address().port}/m/${token}`;
    try {
      const home = await (await fetch(base)).text();
      assert.match(home, /href="[^"]*\/quote"[^>]*>[\s\S]*?<span class="ma-tab__label">Quote<\/span>/);
      assert.doesNotMatch(home, /ma-tab__label">Join<\/span>/);
      assert.doesNotMatch(home, /ma-tab__label">Send<\/span>/);
      assert.match(home, /Material quote/);

      const get = await fetch(`${base}/quote`);
      assert.equal(get.status, 200);
      const html = await get.text();
      assert.match(html, /Request a material quote/);
      assert.match(html, /name="materials"/);
      assert.match(html, /name="measure"/);
      assert.match(html, /name="notes"/);
      assert.match(html, /name="photos"/);
      assert.match(html, /Request quote/);

      const sendRedirect = await fetch(`${base}/send`, { redirect: 'manual' });
      assert.equal(sendRedirect.status, 303);
      assert.match(sendRedirect.headers.get('location') || '', /\/quote$/);

      const post = await fetch(`${base}/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          name: 'Oak Ave job',
          city: 'Camas',
          materials: 'LVP 7"',
          measure: 'Kitchen 12x14',
          notes: 'Floating install',
          confirm: 'on',
        }),
        redirect: 'manual',
      });
      assert.equal(post.status, 303);
      assert.match(post.headers.get('location') || '', /ok=quote_sent/);

      const quotes = await materialQuotes.listQuotesForMember(network.id, flooringMember.id);
      assert.ok(quotes.some((q) => q.jobSite.name === 'Oak Ave job'));
    } finally {
      await new Promise((r) => server.close(r));
      mock.restoreAll();
    }
  });
});
