const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const loc = require('../public/js/find-location-resolve.js');

describe('parseCityStateFromQuery', () => {
  it('parses city, state with mixed case and spaces', () => {
    assert.deepEqual(loc.parseCityStateFromQuery('kent, wa'), { city: 'kent', state: 'WA' });
    assert.deepEqual(loc.parseCityStateFromQuery('kent,wa'), { city: 'kent', state: 'WA' });
    assert.deepEqual(loc.parseCityStateFromQuery('  Kent,  WA  '), { city: 'Kent', state: 'WA' });
  });

  it('parses city ST without a comma', () => {
    assert.deepEqual(loc.parseCityStateFromQuery('kent wa'), { city: 'kent', state: 'WA' });
  });

  it('parses city, ST ZIP', () => {
    assert.deepEqual(loc.parseCityStateFromQuery('Kent, WA 98032'), { city: 'Kent', state: 'WA' });
  });

  it('does not require a geocode hit for a typed city,state', () => {
    const picked = loc.pickResolvedLocation('kent, wa', null, {});
    assert.equal(picked.ok, true);
    assert.equal(picked.city, 'kent');
    assert.equal(picked.state, 'WA');
    assert.equal(picked.source, 'typed');
  });
});

describe('pickResolvedLocation timeout fallback', () => {
  it('still advances with typed city,state when geocode times out', () => {
    const picked = loc.pickResolvedLocation('kent, wa', null, { timedOut: true });
    assert.equal(picked.ok, true);
    assert.equal(picked.city, 'kent');
    assert.equal(picked.state, 'WA');
    assert.equal(picked.source, 'typed-timeout');
    assert.match(loc.statusMessageForLocation(picked), /Using kent, WA/);
  });

  it('prefers a complete geocode result over the typed string', () => {
    const picked = loc.pickResolvedLocation('kent, wa', {
      city: 'Kent',
      state: 'WA',
      label: 'Kent, WA, USA',
    }, {});
    assert.equal(picked.ok, true);
    assert.equal(picked.source, 'geocode');
    assert.equal(picked.label, 'Kent, WA, USA');
  });

  it('does not stay on Looking up when geocode hangs — resolveQueryWithGeocode times out', async () => {
    await new Promise((resolve, reject) => {
      loc.resolveQueryWithGeocode(
        'kent, wa',
        function hangingGeocode() { /* never calls back */ },
        40,
        function (result) {
          try {
            assert.equal(result.timedOut, true);
            assert.equal(result.picked.ok, true);
            assert.equal(result.picked.city, 'kent');
            assert.equal(result.picked.state, 'WA');
            resolve();
          } catch (err) {
            reject(err);
          }
        }
      );
    });
  });

  it('fails closed when neither geocode nor typed city,state is available', async () => {
    await new Promise((resolve, reject) => {
      loc.resolveQueryWithGeocode(
        '123 Main Street',
        function hangingGeocode() { /* never calls back */ },
        40,
        function (result) {
          try {
            assert.equal(result.timedOut, true);
            assert.equal(result.picked.ok, false);
            assert.match(result.picked.error, /timed out/i);
            resolve();
          } catch (err) {
            reject(err);
          }
        }
      );
    });
  });
});
