const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  applyLeadListFilters,
  buildLeadSearchHaystack,
  buildLeadSearchContext,
  leadMatchesSearchQuery,
  scoreLeadSearchMatch,
  normalizeSearchTokens,
} = require('../services/leadListFilters');
const { leadMatchesQuickLogFilter, quickLogFilterTagKey } = require('../services/quickLogConfig');

describe('leadListFilters search', () => {
  const ctx = buildLeadSearchContext(
    [{ key: 'tag:1', name: 'Hot lead' }],
    [{ key: 'folder:1', name: 'Roofing' }],
  );

  it('normalizeSearchTokens splits multi-word queries', () => {
    assert.deepEqual(normalizeSearchTokens('  test note  '), ['test', 'note']);
  });

  it('matches notes in updates', () => {
    const lead = {
      title: 'Acme Plumbing',
      updates: [{ type: 'note', value: 'Follow up after site audit test run' }],
    };
    assert.equal(leadMatchesSearchQuery(lead, 'test', ctx), true);
    assert.equal(leadMatchesSearchQuery(lead, 'site audit', ctx), true);
    assert.equal(leadMatchesSearchQuery(lead, 'missing phrase', ctx), false);
  });

  it('matches tag names via search context', () => {
    const lead = {
      title: 'Example Co',
      tags: ['tag:1'],
    };
    assert.equal(leadMatchesSearchQuery(lead, 'hot', ctx), true);
    assert.equal(leadMatchesSearchQuery(lead, 'hot lead', ctx), true);
  });

  it('matches folder names via search context', () => {
    const lead = {
      title: 'Example Co',
      folderKey: 'folder:1',
    };
    assert.equal(leadMatchesSearchQuery(lead, 'roofing', ctx), true);
  });

  it('matches contact fields and importFields', () => {
    const lead = {
      title: 'Example Co',
      contacts: [{ name: 'Jane Owner', email: 'jane@example.com' }],
      importFields: { Source: 'Facebook marketplace' },
    };
    assert.equal(leadMatchesSearchQuery(lead, 'jane@example.com', ctx), true);
    assert.equal(leadMatchesSearchQuery(lead, 'marketplace', ctx), true);
  });

  it('ranks title matches above note matches', () => {
    const titleLead = { title: 'Test Roofing LLC' };
    const noteLead = {
      title: 'Other Business',
      updates: [{ type: 'note', value: 'test callback tomorrow' }],
    };
    assert.ok(scoreLeadSearchMatch(titleLead, 'test', ctx) < scoreLeadSearchMatch(noteLead, 'test', ctx));
  });

  it('buildLeadSearchHaystack includes status and logs', () => {
    const hay = buildLeadSearchHaystack(
      {
        title: 'Biz',
        status: 'Callback Scheduled',
        logs: [{ type: 'call', message: 'Left voicemail about pricing' }],
      },
      ctx,
    );
    assert.match(hay, /callback scheduled/);
    assert.match(hay, /voicemail about pricing/);
  });

  it('matches quick log labels in free-text search', () => {
    const lead = { title: 'Acme', lastDisposition: 'voicemail' };
    assert.equal(leadMatchesSearchQuery(lead, 'left vm', ctx), true);
    assert.equal(leadMatchesSearchQuery(lead, 'no pickup', ctx), false);
  });

  it('handles circular lead metadata without throwing', () => {
    const lead = { title: 'Comfort Heating', importFields: {} };
    lead.importFields.self = lead.importFields;
    assert.doesNotThrow(() => buildLeadSearchHaystack(lead, ctx));
    assert.equal(leadMatchesSearchQuery(lead, 'comfort', ctx), true);
  });

  it('filters by quick log tag keys', () => {
    const leads = [
      { title: 'A', lastDisposition: 'no_answer' },
      { title: 'B', lastDisposition: 'voicemail' },
      { title: 'C', lastDisposition: 'connected' },
    ];
    const filtered = applyLeadListFilters(leads, {
      tagKey: quickLogFilterTagKey('voicemail'),
    });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].title, 'B');
    assert.equal(leadMatchesQuickLogFilter({ lastDisposition: 'no_answer' }, quickLogFilterTagKey('no_answer')), true);
  });
});
