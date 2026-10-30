const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const dataForSeo = require('../services/dataForSeoClient');
const { summarizeCompetitors } = require('../services/localSeoParse');

describe('DataForSEO research helpers', () => {
  it('exports search volume + related keyword helpers', () => {
    assert.equal(typeof dataForSeo.searchVolumeLive, 'function');
    assert.equal(typeof dataForSeo.parseSearchVolumeMap, 'function');
    assert.equal(typeof dataForSeo.relatedKeywordsLive, 'function');
    assert.equal(typeof dataForSeo.parseRelatedKeywordRows, 'function');
  });

  it('parseSearchVolumeMap flattens Google Ads volume rows', () => {
    const map = dataForSeo.parseSearchVolumeMap({
      tasks: [
        {
          result: [
            {
              keyword: 'Flooring Camas',
              search_volume: 320,
              competition: 0.42,
              competition_level: 'MEDIUM',
              cpc: 4.5,
              monthly_searches: [{ year: 2026, month: 9, search_volume: 310 }],
            },
          ],
        },
      ],
    });
    const hit = map.get('flooring camas');
    assert.ok(hit);
    assert.equal(hit.searchVolume, 320);
    assert.equal(hit.competition, 0.42);
    assert.equal(hit.cpc, 4.5);
  });

  it('parseRelatedKeywordRows extracts Labs related keywords', () => {
    const rows = dataForSeo.parseRelatedKeywordRows(
      {
        tasks: [
          {
            result: [
              {
                items: [
                  {
                    keyword_data: {
                      keyword: 'hardwood flooring camas',
                      keyword_info: { search_volume: 210, competition: 0.3, cpc: 3.1 },
                      keyword_properties: { keyword_difficulty: 28 },
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
      10
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].keyword, 'hardwood flooring camas');
    assert.equal(rows[0].searchVolume, 210);
    assert.equal(rows[0].keywordDifficulty, 28);
  });

  it('summarizeCompetitors keeps review counts and category', () => {
    const rows = summarizeCompetitors([
      {
        keyword: 'lvp camas',
        competitors: [
          { title: 'Rival Floors', domain: 'rival.example.com', rank: 1, rating: 4.8, votes: 120, category: 'Flooring store' },
          { title: 'Rival Floors', domain: 'rival.example.com', rank: 2, rating: 4.6, votes: 140, category: 'Flooring store' },
        ],
      },
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].reviews, 140);
    assert.equal(rows[0].category, 'Flooring store');
    assert.equal(rows[0].bestRank, 1);
  });

  it('Local SEO sync + tables + MCP live research tools are wired', () => {
    const sync = fs.readFileSync(path.join(__dirname, '../services/localSeoSync.js'), 'utf8');
    const view = fs.readFileSync(path.join(__dirname, '../views/local_seo.ejs'), 'utf8');
    const mcp = fs.readFileSync(path.join(__dirname, '../services/mcp/mcpSeo.js'), 'utf8');
    const factory = fs.readFileSync(path.join(__dirname, '../services/mcp/mcpServerFactory.js'), 'utf8');
    const hints = fs.readFileSync(path.join(__dirname, '../services/pavlex/pavlexConstants.js'), 'utf8');

    assert.match(sync, /searchVolumeLive/);
    assert.match(sync, /relatedKeywordsLive/);
    assert.match(sync, /categoryKeywords/);
    assert.match(view, /Local vol/);
    assert.match(view, /Category research volume/);
    assert.match(view, /ck\.searchVolume/);
    assert.match(mcp, /research_seo_keyword/);
    assert.match(mcp, /research_local_business/);
    assert.match(mcp, /research_category_keywords/);
    assert.match(factory, /OPEN_WORLD_SEO_TOOLS/);
    assert.match(hints, /research_seo_keyword/);
  });
});
