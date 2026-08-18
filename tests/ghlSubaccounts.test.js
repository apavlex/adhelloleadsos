const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  leadToCreateLocationPayload,
  pickLeadEmail,
  inferCountry,
  namesMatch,
} = require('../services/ghlSubaccounts');
const { ghlLocationDashboardUrl } = require('../services/websiteBuildLinks');

describe('ghlSubaccounts payload', () => {
  it('requires name and companyId', () => {
    assert.throws(() => leadToCreateLocationPayload({}, { companyId: 'co1' }), /Business name/);
    assert.throws(() => leadToCreateLocationPayload({ title: 'Acme' }, {}), /company ID/);
  });

  it('maps lead fields onto a GHL create-location body', () => {
    const payload = leadToCreateLocationPayload(
      {
        title: 'Urban Eden Landscaping',
        phone: '6045551212',
        address: '123 Main St',
        city: 'Vancouver',
        state: 'BC',
        postalCode: 'V6B 1A1',
        website: 'https://urbaneden.example',
        email: 'hello@urbanedenlandscaping.com',
      },
      { companyId: 'agencyCo', snapshotId: 'snap123' },
    );
    assert.equal(payload.name, 'Urban Eden Landscaping');
    assert.equal(payload.companyId, 'agencyCo');
    assert.equal(payload.phone, '+16045551212');
    assert.equal(payload.city, 'Vancouver');
    assert.equal(payload.state, 'BC');
    assert.equal(payload.country, 'CA');
    assert.equal(payload.postalCode, 'V6B 1A1');
    assert.equal(payload.website, 'https://urbaneden.example');
    assert.equal(payload.snapshotId, 'snap123');
    assert.deepEqual(payload.prospectInfo, {
      firstName: 'Urban',
      lastName: 'Eden Landscaping',
      email: 'hello@urbanedenlandscaping.com',
    });
  });

  it('omits prospectInfo without a valid email and infers US from a US state', () => {
    const payload = leadToCreateLocationPayload(
      { title: 'Flooring Pros', email: 'N/A', state: 'WA' },
      { companyId: 'co1' },
    );
    assert.equal(payload.country, 'US');
    assert.equal('prospectInfo' in payload, false);
    assert.equal('snapshotId' in payload, false);
  });

  it('picks a valid contact email and matches names case-insensitively', () => {
    assert.equal(
      pickLeadEmail({
        email: 'N/A',
        contacts: [{ email: 'owner@bayareawater.com' }],
      }),
      'owner@bayareawater.com',
    );
    assert.equal(namesMatch('Urban Eden', 'urban eden'), true);
    assert.equal(namesMatch('A', 'B'), false);
  });

  it('builds a my.adhello.ai location dashboard URL', () => {
    assert.equal(
      ghlLocationDashboardUrl({ locationId: 'loc99' }),
      'https://my.adhello.ai/v2/location/loc99',
    );
  });

  it('infers Canada from address text', () => {
    assert.equal(inferCountry({ address: 'Vancouver, BC, Canada' }), 'CA');
    assert.equal(inferCountry({ country: 'US' }), 'US');
  });
});
