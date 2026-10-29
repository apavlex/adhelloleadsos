const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-seo-'));
process.env.APP_DATA_DIR = tmpDir;

const dbService = require('../services/database');
const localSeoStore = require('../services/localSeoStore');
const { TOOL_NAMES, executeCrmTool, getOpenAiFunctionTools } = require('../services/mcp/mcpToolExecutor');
const { getOpenAiToolManifest } = require('../services/mcp/mcpServerFactory');
const { SEO_TOOL_NAMES } = require('../services/mcp/mcpSeo');
const { CRM_COMMAND_HINTS } = require('../services/pavlex/pavlexConstants');

const WID = 'ws_mcp_seo';
const OWNER = 'owner@mcp-seo.test';
const owner = { workspaceId: WID, userEmail: OWNER, baseUrl: 'https://leads.example.com' };

describe('SEO / Local Rank MCP tools', () => {
  before(async () => {
    await dbService.saveWorkspace(WID, {
      id: WID,
      name: 'SEO Focus Co',
      members: { [OWNER]: { role: 'owner' } },
      salesIntake: {
        businessName: 'Camas Floor Pros',
        vertical: 'Flooring',
        website: 'https://camasfloor.example.com',
      },
      icpCity: 'Camas',
      icpState: 'WA',
    });
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {
      /* ignore */
    }
  });

  it('registers every SEO tool on TOOL_NAMES, inline chat, and the MCP manifest', () => {
    const fnNames = getOpenAiFunctionTools().map((t) => t.function.name);
    const manifestNames = getOpenAiToolManifest().tools.map((t) => t.name);
    for (const name of SEO_TOOL_NAMES) {
      assert.ok(TOOL_NAMES.includes(name), `TOOL_NAMES missing ${name}`);
      assert.ok(fnNames.includes(name), `inline missing ${name}`);
      assert.ok(manifestNames.includes(name), `manifest missing ${name}`);
    }
    assert.equal(getOpenAiToolManifest().version, '1.10.0');
    assert.equal(new Set(TOOL_NAMES).size, TOOL_NAMES.length);
    assert.ok(CRM_COMMAND_HINTS.includes('get_seo_overview'));
  });

  it('get_seo_overview returns focus suggestions when Local SEO is empty', async () => {
    const overview = await executeCrmTool(owner, 'get_seo_overview', {});
    assert.equal(overview.success, true);
    assert.ok(Array.isArray(overview.focus_suggestions));
    assert.ok(overview.focus_suggestions.some((s) => s.area === 'local_seo'));
    assert.equal(overview.local_seo.sync_status, 'new');
    assert.ok(overview.business_reviews);
    assert.ok(overview.seo_gap);
    assert.ok(overview.backlinks);
  });

  it('get_local_seo surfaces action plan after research is saved', async () => {
    await localSeoStore.save(WID, {
      syncStatus: 'ready',
      lastSyncedAt: new Date().toISOString(),
      research: {
        scores: { overall: 62, mapsScore: 48, gbpScore: 70, reviewScore: 55 },
        keywordRanks: [
          { keyword: 'flooring camas', mapsRank: 7, localPackRank: null },
          { keyword: 'hardwood flooring', mapsRank: 2, localPackRank: 3 },
        ],
        competitors: [{ title: 'Rival Floors', domain: 'rival.example.com', bestRank: 1, appearances: 4, avgRating: 4.6 }],
        gbp: { title: 'Camas Floor Pros', category: 'Flooring', completeness: 0.7, photos: 12, rating: 4.5, votes: 40 },
        reviews: { rating: 4.5, votes: 40, unanswered: 3, fetched: 40 },
        warnings: [],
      },
      actionPlan: {
        source: 'rules',
        summary: 'Improve Maps visibility and reply to reviews.',
        steps: [
          {
            rank: 1,
            impact: 'high',
            effort: 'low',
            title: 'Reply to unanswered Google reviews',
            why: 'Unanswered reviews hurt trust.',
            how: 'Open Business Reviews and reply to the oldest first.',
          },
          {
            rank: 2,
            impact: 'high',
            effort: 'med',
            title: 'Add more GBP photos',
            why: 'Thin photo sets lose Map Pack clicks.',
            how: 'Upload recent job photos weekly.',
          },
        ],
      },
    });

    const local = await executeCrmTool(owner, 'get_local_seo', { max_steps: 2 });
    assert.equal(local.success, true);
    assert.equal(local.has_research, true);
    assert.equal(local.scores.overall, 62);
    assert.ok(local.focus.top_actions.length >= 1);
    assert.match(local.focus.top_actions[0].title, /review/i);
    assert.ok(local.weak_maps_keywords || local.focus.weak_maps_keywords);

    const overview = await executeCrmTool(owner, 'get_seo_overview', {});
    assert.equal(overview.success, true);
    assert.ok(overview.focus_suggestions.some((s) => /review|photo|Maps|GBP|SEO/i.test(s.suggestion)));
  });

  it('get_workspace_overview includes compact seo block', async () => {
    const overview = await executeCrmTool(owner, 'get_workspace_overview', {});
    assert.equal(overview.success, true);
    assert.ok(overview.seo);
    assert.ok(Array.isArray(overview.seo.focus_suggestions));
    assert.ok(overview.seo.local_seo);
    assert.ok(overview.seo.pages && overview.seo.pages.local_seo === '/local-seo');
  });

  it('get_seo_gap / get_backlinks / get_business_reviews_inbox handle empty state', async () => {
    const gap = await executeCrmTool(owner, 'get_seo_gap', {});
    assert.equal(gap.success, true);
    assert.ok(Array.isArray(gap.projects));
    assert.equal(gap.projects.length, 0);

    const bl = await executeCrmTool(owner, 'get_backlinks', {});
    assert.equal(bl.success, true);
    assert.ok(Array.isArray(bl.projects));

    const reviews = await executeCrmTool(owner, 'get_business_reviews_inbox', {});
    assert.equal(reviews.success, true);
    assert.ok(reviews.summary);
    assert.ok(typeof reviews.focus === 'string');
  });
});
