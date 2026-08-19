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

  it('matches original search keyword, category, and searchQuery via q', () => {
    const byKeyword = { title: 'Neighborhood Pros', keyword: 'flooring contractor' };
    const byCategory = { title: 'DryTech', categoryName: 'Water restoration' };
    const byQuery = { title: 'Local Crew', searchQuery: 'restoration' };
    const byNotes = { title: 'Acme Co', notes: 'Interested in hardwood flooring' };
    assert.equal(leadMatchesSearchQuery(byKeyword, 'flooring', ctx), true);
    assert.equal(leadMatchesSearchQuery(byCategory, 'restoration', ctx), true);
    assert.equal(leadMatchesSearchQuery(byQuery, 'restoration', ctx), true);
    assert.equal(leadMatchesSearchQuery(byNotes, 'flooring', ctx), true);
    assert.equal(leadMatchesSearchQuery(byKeyword, 'hvac', ctx), false);
  });

  it('applyLeadListFilters q matches keyword when title does not', () => {
    const leads = [
      { title: 'Neighborhood Pros', keyword: 'flooring' },
      { title: 'City Comfort', keyword: 'hvac' },
    ];
    const filtered = applyLeadListFilters(leads, { q: 'flooring' });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].title, 'Neighborhood Pros');
  });

  it('buildLeadSearchHaystack includes keyword fields', () => {
    const hay = buildLeadSearchHaystack(
      {
        title: 'Biz',
        keyword: 'flooring',
        searchQuery: 'restoration contractor',
        scriptKeywords: ['hardwood', 'lvp'],
      },
      ctx,
    );
    assert.match(hay, /flooring/);
    assert.match(hay, /restoration contractor/);
    assert.match(hay, /hardwood/);
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

  it('filters by maxReviews for low-review prospecting', () => {
    const leads = [
      { title: 'Low reviews', reviewsCount: 12 },
      { title: 'Many reviews', reviewsCount: 150 },
      { title: 'No count', reviewsCount: null },
    ];
    const filtered = applyLeadListFilters(leads, { maxReviews: '30' });
    assert.equal(filtered.length, 2);
    assert.deepEqual(
      filtered.map((l) => l.title).sort(),
      ['Low reviews', 'No count'],
    );
  });

  it('filters by bookmarked only', () => {
    const leads = [
      { title: 'Saved', bookmarked: true },
      { title: 'Not saved', bookmarked: false },
      { title: 'Missing flag' },
    ];
    const filtered = applyLeadListFilters(leads, { bookmarked: '1' });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].title, 'Saved');
  });

  it('filters by category with partial match', () => {
    const leads = [
      { title: 'Green Lawn', categoryName: 'Landscaper' },
      { title: 'Cool Air', categoryName: 'HVAC contractor' },
      { title: 'No cat' },
    ];
    const exact = applyLeadListFilters(leads, { category: 'Landscaper' });
    assert.equal(exact.length, 1);
    assert.equal(exact[0].title, 'Green Lawn');
    const partial = applyLeadListFilters(leads, { category: 'hvac' });
    assert.equal(partial.length, 1);
    assert.equal(partial[0].title, 'Cool Air');
  });

  it('buildPipelineCategoryOptions dedupes and sorts categories', () => {
    const { buildPipelineCategoryOptions } = require('../services/leadListFilters');
    const opts = buildPipelineCategoryOptions([
      { categoryName: 'Landscaper' },
      { categoryName: 'landscaper' },
      { categoryName: 'HVAC contractor' },
      { categoryName: 'N/A' },
    ]);
    assert.deepEqual(opts, ['HVAC contractor', 'Landscaper']);
  });
});
