const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildLeadSearchHaystack,
  buildLeadSearchContext,
  leadMatchesSearchQuery,
  scoreLeadSearchMatch,
  normalizeSearchTokens,
} = require('../services/leadListFilters');

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
});
