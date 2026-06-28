const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  formatLeadSourceLabel,
  formatSourceChannelLabel,
  resolveLeadSourceChannel,
} = require('../services/sourceChannelLabels');

describe('sourceChannelLabels', () => {
  it('maps bulk scrape ingest keys to platform names', () => {
    assert.equal(formatSourceChannelLabel('chrome_extension_maps_bulk'), 'Google Maps');
    assert.equal(formatSourceChannelLabel('google_maps'), 'Google Maps');
    assert.equal(formatSourceChannelLabel('yelp'), 'Yelp');
    assert.equal(formatSourceChannelLabel('facebook'), 'Facebook Marketplace');
    assert.equal(formatSourceChannelLabel('instagram'), 'Instagram');
  });

  it('hides internal ingest labels', () => {
    assert.equal(formatSourceChannelLabel('chrome_extension'), '');
    assert.equal(formatSourceChannelLabel('csv_import'), '');
  });

  it('resolves platform from importFields when sourceChannel is missing', () => {
    const lead = {
      sourceChannel: '',
      importFields: { source: 'chrome_extension_maps_bulk', source_channel: 'google_maps' },
    };
    assert.equal(resolveLeadSourceChannel(lead), 'google_maps');
    assert.equal(formatLeadSourceLabel(lead), 'Google Maps');
  });
});
