/**
 * Shared customer typeahead ranking (member review ask picker).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { searchCustomers, scoreCustomer, norm, digits } =
  require('../lib/customerSearch');

const customers = [
  { id: '1', name: 'ADVANCED CONCRETE TECHNOLOGIES LLC', phone: '+15034386957', email: '' },
  { id: '2', name: 'ALCHEMY HOLDINGS INC', phone: '+15037033754', email: '' },
  { id: '3', name: 'Typewright Studios', phone: '5035550199', email: 'hello@typewright.com' },
  { id: '4', name: 'Pacific Typo Fix', phone: '9715550100', email: 'fix@example.com' },
  { id: '5', name: 'Bob Builder', phone: '3605550100', email: 'bob@builders.io' },
];

describe('customerSearch', () => {
  it('exports the same module the browser UMD loads', () => {
    const umd = require('../public/js/member-customer-search.js');
    assert.equal(searchCustomers, umd.searchCustomers);
    assert.equal(typeof scoreCustomer, 'function');
    assert.equal(norm('  Hello  World '), 'hello world');
    assert.equal(digits('+1 (503) 555-0199'), '15035550199');
  });

  it('ranks prefix and word matches above distant substring hits', () => {
    const ranked = searchCustomers(customers, 'Typ');
    assert.deepEqual(
      ranked.map((c) => c.id),
      ['3', '4'],
    );
    assert.ok(scoreCustomer(customers[2], 'Typ') > scoreCustomer(customers[3], 'Typ'));
  });

  it('matches phone digits when the query looks like a number', () => {
    const ranked = searchCustomers(customers, '503438');
    assert.equal(ranked[0].id, '1');
    assert.ok(ranked.every((c) => digits(c.phone).includes('503438') || norm(c.name).includes('503438')));
  });

  it('matches email local-part / domain fragments', () => {
    const ranked = searchCustomers(customers, 'builders');
    assert.equal(ranked[0].id, '5');
  });

  it('returns original order (capped) when the query is empty', () => {
    const ranked = searchCustomers(customers, '', { limit: 3 });
    assert.deepEqual(ranked.map((c) => c.id), ['1', '2', '3']);
  });

  it('matches address fragments', () => {
    const withAddr = customers.concat([
      { id: '6', name: 'River Bend Co', phone: '', email: '', address: '123 Aspen Way' },
    ]);
    const ranked = searchCustomers(withAddr, 'Aspen');
    assert.equal(ranked[0].id, '6');
  });

  it('wires the review ask form to the typeahead + shared search script', () => {
    const review = fs.readFileSync(path.join(__dirname, '../views/member_app/review.ejs'), 'utf8');
    const tabbar = fs.readFileSync(path.join(__dirname, '../views/member_app/_tabbar.ejs'), 'utf8');
    const app = fs.readFileSync(path.join(__dirname, '../public/js/member-app.js'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '../public/css/member-app.css'), 'utf8');
    const route = fs.readFileSync(path.join(__dirname, '../routes/memberApp.js'), 'utf8');

    assert.match(review, /data-ma-customer-pick/);
    assert.match(review, /Who should we ask/);
    assert.match(review, /data-ma-ask-selected/);
    assert.match(review, /data-ma-ask-manual/);
    assert.match(review, /data-ma-ask-clear/);
    assert.match(review, /Name.*new person/s);
    assert.match(review, /role="combobox"/);
    assert.match(review, /Search customers or type a new name/);
    assert.match(review, /inputmode="search"/);
    assert.match(tabbar, /member-customer-search\.js/);
    assert.match(app, /function initCustomerPick/);
    assert.match(app, /searchApi\.searchCustomers/);
    assert.match(app, /data-ma-ask-selected/);
    assert.match(app, /syncMode/);
    assert.match(css, /\.ma-typeahead__list/);
    assert.match(css, /\.ma-typeahead__item--new/);
    assert.match(css, /\.ma-ask-selected/);
    // Customer page Review opens the ask form with customer=id (selected), not as a new person.
    assert.match(route, /customers\/c\/:id\/request-review/);
    assert.match(route, /customer: data\.customer\.id/);
    assert.match(route, /findCustomerMatch\(customers/);
  });

  it('wires Customers list search to live client-side filtering', () => {
    const customersView = fs.readFileSync(path.join(__dirname, '../views/member_app/customers.ejs'), 'utf8');
    const app = fs.readFileSync(path.join(__dirname, '../public/js/member-app.js'), 'utf8');
    const route = fs.readFileSync(path.join(__dirname, '../routes/memberApp.js'), 'utf8');

    assert.match(customersView, /data-ma-customer-list-search/);
    assert.match(customersView, /data-ma-customer-list/);
    assert.match(customersView, /data-ma-customer-row/);
    assert.match(customersView, /Search by name or phone/);
    assert.match(app, /function initCustomerListSearch/);
    assert.match(app, /data-ma-customer-list-search/);
    assert.match(app, /scoreCustomer/);
    assert.match(route, /live client search/);
    const css = fs.readFileSync(path.join(__dirname, '../public/css/member-app.css'), 'utf8');
    assert.match(css, /\.ma-row\[hidden\]/);
  });
});
