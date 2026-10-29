const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-mkt-soc-sop-'));
process.env.APP_DATA_DIR = tmpDir;

const dbService = require('../services/database');
const { TOOL_NAMES, executeCrmTool, getOpenAiFunctionTools } = require('../services/mcp/mcpToolExecutor');
const { getOpenAiToolManifest } = require('../services/mcp/mcpServerFactory');
const { MARKETING_TOOL_NAMES } = require('../services/mcp/mcpMarketing');
const { SOCIAL_TOOL_NAMES } = require('../services/mcp/mcpSocial');
const { SOP_TOOL_NAMES } = require('../services/mcp/mcpSops');

const WID = 'ws_mcp_mkt';
const OWNER = 'owner@mcp-mkt.test';
const VIEWER = 'viewer@mcp-mkt.test';
const owner = { workspaceId: WID, userEmail: OWNER, baseUrl: 'https://leads.example.com' };
const viewer = { workspaceId: WID, userEmail: VIEWER, baseUrl: 'https://leads.example.com' };

describe('Marketing Studio + Social/FB + SOP MCP tools', () => {
  before(async () => {
    await dbService.saveWorkspace(WID, {
      id: WID,
      name: 'Mkt Social SOP Co',
      members: {
        [OWNER]: { role: 'owner' },
        [VIEWER]: { role: 'viewer' },
      },
      brandKit: { businessName: 'Mkt Co', phone: '3605550100' },
    });
    await dbService.saveLead({
      title: 'Camas HVAC Pros',
      company: 'Camas HVAC Pros',
      phone: '3605550199',
      categoryName: 'HVAC',
      city: 'Camas',
      workspaceId: WID,
      source: 'manual',
    });
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {
      /* ignore */
    }
  });

  it('registers every new tool on TOOL_NAMES, inline chat, and the MCP manifest', () => {
    const names = [...MARKETING_TOOL_NAMES, ...SOCIAL_TOOL_NAMES, ...SOP_TOOL_NAMES];
    const fnNames = getOpenAiFunctionTools().map((t) => t.function.name);
    const manifestNames = getOpenAiToolManifest().tools.map((t) => t.name);
    for (const name of names) {
      assert.ok(TOOL_NAMES.includes(name), `TOOL_NAMES missing ${name}`);
      assert.ok(fnNames.includes(name), `inline missing ${name}`);
      assert.ok(manifestNames.includes(name), `manifest missing ${name}`);
    }
    assert.equal(getOpenAiToolManifest().version, '1.10.0');
    assert.equal(new Set(TOOL_NAMES).size, TOOL_NAMES.length);
  });

  it('covers Marketing Studio status, playbooks, brand kit, and the direct-mail queue', async () => {
    const status = await executeCrmTool(owner, 'get_marketing_studio_status', {});
    assert.equal(status.success, true);
    assert.equal(status.brand_kit.business_name, 'Mkt Co');
    assert.ok(Array.isArray(status.design_platforms));
    assert.ok(status.design_platforms.some((p) => p.id === 'postcard'));

    const books = await executeCrmTool(owner, 'list_direct_mail_playbooks', {});
    assert.equal(books.success, true);
    assert.ok(books.count >= 1);

    const leads = await dbService.getAllLeads(WID);
    const lead = leads[0];
    const suggest = await executeCrmTool(owner, 'suggest_direct_mail_playbook', { lead_id: lead.key });
    assert.equal(suggest.success, true);
    assert.ok(suggest.playbook && suggest.playbook.id);

    const queued = await executeCrmTool(owner, 'queue_leads_for_direct_mail', { lead_ids: [lead.key] });
    assert.equal(queued.success, true, queued.error);
    assert.equal(queued.added, 1);

    const queue = await executeCrmTool(owner, 'list_direct_mail_queue', {});
    assert.equal(queue.success, true);
    assert.ok(queue.total >= 1);

    const brand = await executeCrmTool(owner, 'update_marketing_brand_kit', {
      business_name: 'Mkt Co Camas',
      website: 'https://mkt.example.com',
    });
    assert.equal(brand.success, true);
    assert.equal(brand.brand_kit.business_name, 'Mkt Co Camas');

    const denied = await executeCrmTool(viewer, 'queue_leads_for_direct_mail', { lead_ids: [lead.key] });
    assert.equal(denied.success, false);
  });

  it('generates social ideas, saves posts, and manages Facebook groups + scripts', async () => {
    const ideas = await executeCrmTool(owner, 'generate_social_post_ideas', { platform: 'instagram' });
    assert.equal(ideas.success, true);
    assert.ok(ideas.ideas.instagram || ideas.ideas);

    const saved = await executeCrmTool(owner, 'save_social_post', {
      platform: 'instagram',
      content: 'Local tip: claim your Google Business Profile this week.',
      cta: 'Comment CHECKLIST',
    });
    assert.equal(saved.success, true);
    assert.ok(saved.post.id);

    const listed = await executeCrmTool(owner, 'list_social_posts', { platform: 'instagram' });
    assert.equal(listed.success, true);
    assert.ok(listed.count >= 1);

    const badUrl = await executeCrmTool(owner, 'add_fb_group', { url: 'https://example.com/not-a-group' });
    assert.equal(badUrl.success, false);

    const added = await executeCrmTool(owner, 'add_fb_group', {
      url: 'https://www.facebook.com/groups/camasbusinessowners',
      title: 'Camas Business Owners',
      note: 'Post Wednesdays',
      tags: ['local', 'camas'],
    });
    assert.equal(added.success, true, added.error);
    assert.equal(added.group.title, 'Camas Business Owners');

    const updated = await executeCrmTool(owner, 'update_fb_group', {
      group_id: added.group.id,
      bookmarked: true,
      note: 'Bookmarked for Friday',
    });
    assert.equal(updated.success, true);
    assert.equal(updated.group.bookmarked, true);

    const groups = await executeCrmTool(owner, 'list_fb_groups', { bookmarked_only: true });
    assert.ok(groups.groups.some((g) => g.id === added.group.id));

    const scripts = await executeCrmTool(owner, 'list_fb_group_scripts', { category: 'educational' });
    assert.equal(scripts.success, true);
    assert.ok(scripts.count >= 1);
  });

  it('lists, creates, reads, and deletes SOPs', async () => {
    const listed = await executeCrmTool(owner, 'list_sops', {});
    assert.equal(listed.success, true);
    assert.ok(listed.count >= 1, 'built-in SOP should seed');

    const created = await executeCrmTool(owner, 'save_sop', {
      title: 'Monday pipeline review',
      purpose: 'Keep the board honest.',
      owner: 'Manager',
      trigger: 'Every Monday morning',
      steps: ['Open pipeline', 'Move stale deals', 'Assign follow-ups'],
    });
    assert.equal(created.success, true, created.error);
    assert.equal(created.sop.title, 'Monday pipeline review');
    assert.equal(created.sop.steps.length, 3);

    const got = await executeCrmTool(owner, 'get_sop', { sop_id: created.sop.id });
    assert.equal(got.success, true);
    assert.equal(got.sop.steps.length, 3);

    const noConfirm = await executeCrmTool(owner, 'delete_sop', { sop_id: created.sop.id });
    assert.equal(noConfirm.success, false);

    const deleted = await executeCrmTool(owner, 'delete_sop', { sop_id: created.sop.id, confirm: true });
    assert.equal(deleted.success, true);

    const viewerDenied = await executeCrmTool(viewer, 'save_sop', { title: 'Nope' });
    assert.equal(viewerDenied.success, false);
  });
});
