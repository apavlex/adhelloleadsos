/**
 * Flooring contacts: Customer / Lead / Quote kind + prefill material quote.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'contact-quote-'));

const { describe, it, before, mock } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const dbService = require('../services/database');
const store = require('../services/networkStore');
const freeAppSignup = require('../services/freeAppSignup');
const work = require('../services/memberWork');
const { createMemberPortalToken } = require('../services/networkLinkSign');
const memberApp = require('../routes/memberApp');

describe('contact quote kind (flooring)', () => {
  let network;
  let member;
  let token;
  let base;

  before(async () => {
    await dbService.saveWorkspace('ws_cqk', {
      name: 'Flooring Supplier',
      slug: 'fs-cqk',
      members: { 'ops@supplier.test': { role: 'owner' } },
    });
    network = await store.getOrCreateNetworkForWorkspace('ws_cqk', {
      name: 'Flooring Supplier',
      ownerEmail: 'ops@supplier.test',
    });
    member = await store.saveMember(network.id, {
      companyName: 'Camas Floors',
      contactName: 'Fran',
      status: 'active',
      plan: freeAppSignup.PLAN_APP_FLOORING,
      signupOffer: freeAppSignup.OFFER_FLOORING,
      trades: ['flooring'],
    });
    token = createMemberPortalToken({ networkId: network.id, memberId: member.id });
  });

  it('toggles customer → lead → quote → customer', async () => {
    const created = await work.saveCustomer(network.id, member.id, {
      name: 'Smith Residence',
      phone: '503-555-0199',
      address: '12 Oak St',
      notes: 'Wants LVP',
    });
    assert.equal(created.ok, true);
    assert.equal(work.customerKind(created.customer), 'customer');

    const asLead = await work.setCustomerKind(network.id, member.id, created.customer.id, 'lead');
    assert.equal(asLead.ok, true);
    assert.equal(asLead.customer.isLead, true);
    assert.equal(asLead.customer.isQuoteRequest, false);
    assert.equal(work.customerKind(asLead.customer), 'lead');

    const asQuote = await work.setCustomerKind(network.id, member.id, created.customer.id, 'quote');
    assert.equal(asQuote.ok, true);
    assert.equal(asQuote.customer.isQuoteRequest, true);
    assert.equal(asQuote.customer.isLead, false);
    assert.equal(work.customerKind(asQuote.customer), 'quote');

    const quotes = await work.listContactQuotes(network.id, member.id);
    assert.ok(quotes.some((c) => c.id === created.customer.id));
    const leads = await work.listContactLeads(network.id, member.id);
    assert.equal(leads.some((c) => c.id === created.customer.id), false);

    const asCustomer = await work.setCustomerKind(network.id, member.id, created.customer.id, 'customer');
    assert.equal(work.customerKind(asCustomer.customer), 'customer');
  });

  it('shows Customer/Lead/Quote toggle and prefills /quote from contact', async () => {
    const notify = require('../services/networkNotify');
    mock.method(notify, 'notifyMaterialQuote', async () => ({ ok: true }));

    const created = await work.saveCustomer(network.id, member.id, {
      name: 'River Remodel',
      phone: '503-555-0111',
      city: 'Camas',
      address: '9 River Rd',
      notes: 'Stairs + hall',
    });
    assert.equal(created.ok, true);

    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'views'));
    app.locals.assetVersion = 'test';
    app.use('/', memberApp);
    const server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    base = `http://127.0.0.1:${server.address().port}/m/${token}`;
    try {
      const detail = await fetch(`${base}/customers/c/${created.customer.id}`);
      assert.equal(detail.status, 200);
      const html = await detail.text();
      assert.match(html, /Customer<\/span>/);
      assert.match(html, /Lead<\/span>/);
      assert.match(html, /Quote<\/span>/);
      assert.match(html, /mark-quote/);
      assert.match(html, /openQuote/);

      const mark = await fetch(`${base}/customers/c/${created.customer.id}/mark-quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ openQuote: '1' }),
        redirect: 'manual',
      });
      assert.equal(mark.status, 303);
      const loc = mark.headers.get('location') || '';
      assert.match(loc, /\/quote\?customer=/);
      assert.match(loc, /ok=marked_quote/);

      const saved = await work.getCustomer(network.id, member.id, created.customer.id);
      assert.equal(saved.isQuoteRequest, true);

      const quotePage = await fetch(`${base}/quote?customer=${created.customer.id}`);
      assert.equal(quotePage.status, 200);
      const quoteHtml = await quotePage.text();
      assert.match(quoteHtml, /River Remodel/);
      assert.match(quoteHtml, /503-555-0111/);
      assert.match(quoteHtml, /9 River Rd/);
      assert.match(quoteHtml, /name="customerId"/);
      assert.match(quoteHtml, /Stairs \+ hall|Stairs &amp; hall|Stairs \+/);

      const leadsPage = await (await fetch(`${base}/referrals`)).text();
      assert.match(leadsPage, /Quote requests/);
      assert.match(leadsPage, /River Remodel/);
      assert.match(leadsPage, /Request quote/);
    } finally {
      await new Promise((r) => server.close(r));
      mock.restoreAll();
    }
  });
});
