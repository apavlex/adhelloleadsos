/**
 * Social Posts + Facebook Groups tools for MCP clients and in-app Alex.
 */
const { z } = require('zod/v3');
const { zodToJsonSchema } = require('zod-to-json-schema');
const dbService = require('../database');
const workspaceService = require('../workspaceService');
const { resolveSocialPostProfile } = require('../socialPostProfile');
const { generatePostIdeas } = require('../socialPostIdeas');
const { FB_GROUP_SCRIPT_CATEGORIES, listFbGroupScriptsFlat } = require('../../config/fbGroupScripts');
const notify = require('../networkNotify');

function toolError(message, code = 'SOCIAL_ERROR') {
  const err = new Error(message);
  err.code = code;
  return err;
}

function pageUrl(ctx, path) {
  const base = (ctx && ctx.baseUrl) || notify.baseUrlFromReq(null) || '';
  return `${String(base).replace(/\/+$/, '')}${path}`;
}

async function requireEditor(ctx) {
  if (ctx && (ctx.canManage === true || ctx.canAssignWork === true)) return;
  const ws = await dbService.getWorkspace(ctx.workspaceId);
  const role = workspaceService.roleForEmail(ws, ctx.userEmail || '');
  if (role === 'viewer') {
    throw toolError('Viewers can\'t change social / Facebook Groups data.', 'FORBIDDEN');
  }
}

function normalizeUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.href;
  } catch {
    return '';
  }
}

function isFacebookGroupUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    const h = u.hostname.replace(/^www\./, '').toLowerCase();
    if (h !== 'facebook.com' && h !== 'm.facebook.com' && h !== 'web.facebook.com') return false;
    return /\/groups\//i.test(u.pathname);
  } catch {
    return false;
  }
}

function canonicalizeGroupUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    const m = u.pathname.match(/\/groups\/([^/?#]+)/i);
    if (!m) return urlStr;
    return `https://www.facebook.com/groups/${m[1]}`;
  } catch {
    return urlStr;
  }
}

function titleFromGroupUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    const m = u.pathname.match(/\/groups\/([^/?#]+)/i);
    if (!m) return '';
    const slug = decodeURIComponent(m[1]).replace(/[-_]+/g, ' ').trim();
    if (/^\d+$/.test(slug)) return `Facebook Group ${slug}`;
    return slug.replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return '';
  }
}

function normalizeFbGroupTags(raw) {
  const list = Array.isArray(raw)
    ? raw
    : String(raw || '')
        .split(/[,#]+/)
        .map((t) => t.trim());
  const seen = new Set();
  const out = [];
  for (const t of list) {
    const tag = String(t || '')
      .trim()
      .replace(/^#/, '')
      .slice(0, 40);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= 20) break;
  }
  return out;
}

function presentPost(p) {
  return {
    id: p.id,
    platform: p.platform || '',
    content: p.content || '',
    hooks: p.hooks || '',
    cta: p.cta || '',
    tags: Array.isArray(p.tags) ? p.tags : [],
    liked: !!p.liked,
    niche: p.niche || '',
    folder_id: p.folderId || null,
    artwork_url: p.artworkUrl || null,
    created_at: p.createdAt || null,
  };
}

function presentGroup(g) {
  const notes = Array.isArray(g.notes) ? g.notes.filter((n) => n && n.text) : [];
  return {
    id: g.id,
    title: g.title || '',
    url: g.url || '',
    bookmarked: !!g.bookmarked,
    category: g.category || '',
    location: g.location || '',
    privacy: g.privacy || '',
    member_count: g.memberCount || null,
    member_count_label: g.memberCountLabel || '',
    last_posted: g.lastPosted || '',
    last_visited: g.lastVisited || '',
    admin_contact: g.adminContact || '',
    tags: Array.isArray(g.tags) ? g.tags : [],
    notes_count: notes.length,
    latest_note: notes[0] ? notes[0].text : g.note || '',
    posts_count: Array.isArray(g.posts) ? g.posts.length : 0,
  };
}

async function listSocialPosts(ctx, input) {
  let posts = await dbService.getSocialPosts(ctx.workspaceId);
  if (input.platform) {
    const want = String(input.platform).toLowerCase();
    posts = posts.filter((p) => String(p.platform || '').toLowerCase() === want);
  }
  posts = posts.slice(0, Math.min(100, input.limit || 40));
  return {
    count: posts.length,
    posts: posts.map(presentPost),
    social_posts_page: pageUrl(ctx, '/social-posts'),
  };
}

async function generateSocialPostIdeas(ctx, input) {
  const ws = await dbService.getWorkspace(ctx.workspaceId);
  const profile = resolveSocialPostProfile(ws);
  if (input.niche) profile.niche = String(input.niche).trim();
  const ideas = generatePostIdeas(profile.niche, input.platform || null, {
    isAgencyWorkspace: profile.isAgencyWorkspace,
    contentSubject: profile.contentSubject,
  });
  return {
    niche: profile.niche,
    profile: {
      niche: profile.niche,
      content_subject: profile.contentSubject,
      is_agency_workspace: !!profile.isAgencyWorkspace,
    },
    ideas,
    social_posts_page: pageUrl(ctx, '/social-posts'),
  };
}

async function saveSocialPost(ctx, input) {
  await requireEditor(ctx);
  const ws = await dbService.getWorkspace(ctx.workspaceId);
  const profile = resolveSocialPostProfile(ws);
  const record = {
    id: `sp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    platform: String(input.platform).trim(),
    content: String(input.content).trim(),
    hooks: String(input.hooks || '').trim(),
    cta: String(input.cta || '').trim(),
    tags: Array.isArray(input.tags) ? input.tags.map((t) => String(t).trim()).filter(Boolean) : [],
    liked: !!input.liked,
    niche: String(input.niche || profile.niche || '').trim(),
    folderId: input.folder_id || null,
    bookmarked: true,
    createdAt: new Date().toISOString(),
    workspaceId: ctx.workspaceId,
  };
  if (input.artwork_url) {
    record.artworkUrl = String(input.artwork_url).trim();
    record.artworkPrompt = String(input.artwork_prompt || '').trim();
    record.artworkUpdatedAt = new Date().toISOString();
  }
  await dbService.saveSocialPost(record, ctx.workspaceId);
  return {
    message: `Saved ${record.platform} post.`,
    post: presentPost(record),
    social_posts_page: pageUrl(ctx, '/social-posts'),
  };
}

async function deleteSocialPost(ctx, input) {
  await requireEditor(ctx);
  if (input.confirm !== true) throw toolError('Pass confirm:true to delete a saved social post.', 'CONFIRM_REQUIRED');
  await dbService.deleteSocialPost(input.post_id, ctx.workspaceId);
  return { message: 'Deleted social post.', post_id: input.post_id };
}

async function listFbGroups(ctx, input) {
  let groups = await dbService.listWorkspaceFbGroups(ctx.workspaceId);
  if (input.bookmarked_only) groups = groups.filter((g) => g && g.bookmarked);
  if (input.tag) {
    const want = String(input.tag).toLowerCase();
    groups = groups.filter((g) => (g.tags || []).some((t) => String(t).toLowerCase() === want));
  }
  groups = groups.slice(0, Math.min(100, input.limit || 50));
  return {
    count: groups.length,
    groups: groups.map(presentGroup),
    fb_groups_page: pageUrl(ctx, '/fb-groups'),
  };
}

async function addFbGroup(ctx, input) {
  await requireEditor(ctx);
  const urlRaw = normalizeUrl(input.url);
  if (!urlRaw) throw toolError('A valid Facebook group URL is required.', 'INVALID_ARGUMENTS');
  if (!isFacebookGroupUrl(urlRaw)) throw toolError('URL must be a facebook.com/groups/… link.', 'INVALID_ARGUMENTS');
  const url = canonicalizeGroupUrl(urlRaw);
  const existing = await dbService.listWorkspaceFbGroups(ctx.workspaceId);
  const dup = existing.find((g) => canonicalizeGroupUrl(g.url) === url);
  if (dup) {
    return {
      message: 'That Facebook group is already saved.',
      group: presentGroup(dup),
      existed: true,
      fb_groups_page: pageUrl(ctx, '/fb-groups'),
    };
  }
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  const note = String(input.note || '').trim().slice(0, 2000);
  const saved = await dbService.saveWorkspaceFbGroup(ctx.workspaceId, {
    id,
    url,
    title: String(input.title || '').trim().slice(0, 200) || titleFromGroupUrl(url) || url,
    category: String(input.category || '').trim().slice(0, 80),
    location: String(input.location || '').trim().slice(0, 120),
    privacy: ['public', 'private'].includes(String(input.privacy || '').toLowerCase())
      ? String(input.privacy).toLowerCase()
      : '',
    tags: normalizeFbGroupTags(input.tags),
    posts: [],
    notes: note ? [{ id: `${Date.now()}_n`, text: note, createdAt: new Date().toISOString() }] : [],
    lastVisited: new Date().toISOString(),
    addedBy: ctx.userEmail || 'AI assistant',
  });
  return {
    message: `Added Facebook group "${saved.title}".`,
    group: presentGroup(saved),
    existed: false,
    fb_groups_page: pageUrl(ctx, '/fb-groups'),
  };
}

async function updateFbGroup(ctx, input) {
  await requireEditor(ctx);
  const existing = await dbService.getWorkspaceFbGroup(ctx.workspaceId, input.group_id);
  if (!existing) throw toolError('Facebook group not found.', 'NOT_FOUND');
  const next = { ...existing };
  if (input.title != null) next.title = String(input.title).trim().slice(0, 200) || next.title;
  if (input.category != null) next.category = String(input.category).trim().slice(0, 80);
  if (input.location != null) next.location = String(input.location).trim().slice(0, 120);
  if (input.privacy != null) {
    const p = String(input.privacy).toLowerCase();
    next.privacy = p === 'public' || p === 'private' ? p : '';
  }
  if (input.bookmarked != null) next.bookmarked = !!input.bookmarked;
  if (input.tags != null) next.tags = normalizeFbGroupTags(input.tags);
  if (input.admin_contact != null) next.adminContact = String(input.admin_contact).trim().slice(0, 200);
  if (input.last_posted != null) next.lastPosted = String(input.last_posted).trim().slice(0, 80);
  if (input.note) {
    const body = String(input.note).trim().slice(0, 4000);
    const entry = { id: `${Date.now()}_n`, text: body, createdAt: new Date().toISOString() };
    next.notes = [entry, ...(Array.isArray(existing.notes) ? existing.notes : [])].slice(0, 40);
  }
  const saved = await dbService.saveWorkspaceFbGroup(ctx.workspaceId, next);
  return {
    message: `Updated Facebook group "${saved.title}".`,
    group: presentGroup(saved),
    fb_groups_page: pageUrl(ctx, '/fb-groups'),
  };
}

async function deleteFbGroup(ctx, input) {
  await requireEditor(ctx);
  if (input.confirm !== true) throw toolError('Pass confirm:true to delete a Facebook group.', 'CONFIRM_REQUIRED');
  const existing = await dbService.getWorkspaceFbGroup(ctx.workspaceId, input.group_id);
  if (!existing) throw toolError('Facebook group not found.', 'NOT_FOUND');
  await dbService.deleteWorkspaceFbGroup(ctx.workspaceId, input.group_id);
  return { message: `Deleted Facebook group "${existing.title}".`, group_id: input.group_id };
}

async function listFbGroupScripts(ctx, input) {
  if (input.category) {
    const cat = FB_GROUP_SCRIPT_CATEGORIES.find(
      (c) => c.id === input.category || c.label.toLowerCase() === String(input.category).toLowerCase(),
    );
    if (!cat) {
      return {
        count: 0,
        categories: FB_GROUP_SCRIPT_CATEGORIES.map((c) => ({ id: c.id, label: c.label, hint: c.hint })),
        scripts: [],
        error_hint: `Unknown category. Use: ${FB_GROUP_SCRIPT_CATEGORIES.map((c) => c.id).join(', ')}`,
      };
    }
    return {
      count: cat.scripts.length,
      category: { id: cat.id, label: cat.label, hint: cat.hint },
      scripts: cat.scripts,
      fb_groups_page: pageUrl(ctx, '/fb-groups'),
    };
  }
  const scripts = listFbGroupScriptsFlat();
  return {
    count: scripts.length,
    categories: FB_GROUP_SCRIPT_CATEGORIES.map((c) => ({ id: c.id, label: c.label, hint: c.hint })),
    scripts,
    fb_groups_page: pageUrl(ctx, '/fb-groups'),
  };
}

const PLATFORMS = ['instagram', 'facebook', 'facebook_group', 'linkedin', 'x', 'tiktok', 'gmb'];

const SOCIAL_TOOLS = [
  {
    name: 'list_social_posts',
    description: 'List saved Social Posts drafts for this workspace (Instagram, Facebook, LinkedIn, etc.).',
    schema: z.object({
      platform: z.enum(PLATFORMS).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    run: listSocialPosts,
  },
  {
    name: 'generate_social_post_ideas',
    description:
      'Generate platform-specific social post idea hooks/CTAs from the workspace niche (Social Posts studio). Does not auto-save.',
    schema: z.object({
      niche: z.string().max(120).optional().describe('Override niche / content subject.'),
      platform: z.enum(PLATFORMS).optional().describe('One platform; omit for all.'),
    }),
    run: generateSocialPostIdeas,
  },
  {
    name: 'save_social_post',
    description: 'Save a social post draft into Social Posts (feeds style learning). Viewers cannot save.',
    schema: z.object({
      platform: z.enum(PLATFORMS),
      content: z.string().min(1).max(8000),
      hooks: z.string().max(2000).optional(),
      cta: z.string().max(500).optional(),
      tags: z.array(z.string()).max(20).optional(),
      niche: z.string().max(120).optional(),
      liked: z.boolean().optional(),
      folder_id: z.string().optional(),
      artwork_url: z.string().url().optional(),
      artwork_prompt: z.string().max(2000).optional(),
    }),
    run: saveSocialPost,
  },
  {
    name: 'delete_social_post',
    description: 'Delete a saved social post. Requires confirm:true.',
    schema: z.object({
      post_id: z.string().min(1),
      confirm: z.boolean(),
    }),
    run: deleteSocialPost,
  },
  {
    name: 'list_fb_groups',
    description: 'List Facebook Groups saved for prospecting in this workspace.',
    schema: z.object({
      bookmarked_only: z.boolean().optional(),
      tag: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    run: listFbGroups,
  },
  {
    name: 'add_fb_group',
    description: 'Add a Facebook group URL to the workspace FB Groups list (for prospecting / posting later).',
    schema: z.object({
      url: z.string().min(1).describe('https://www.facebook.com/groups/…'),
      title: z.string().max(200).optional(),
      note: z.string().max(2000).optional(),
      category: z.string().max(80).optional(),
      location: z.string().max(120).optional(),
      privacy: z.enum(['public', 'private']).optional(),
      tags: z.array(z.string()).max(20).optional(),
    }),
    run: addFbGroup,
  },
  {
    name: 'update_fb_group',
    description:
      'Update a saved Facebook group (title, bookmark, tags, note, last_posted, admin contact, etc.).',
    schema: z.object({
      group_id: z.string().min(1),
      title: z.string().max(200).optional(),
      bookmarked: z.boolean().optional(),
      category: z.string().max(80).optional(),
      location: z.string().max(120).optional(),
      privacy: z.enum(['public', 'private']).optional(),
      tags: z.array(z.string()).max(20).optional(),
      admin_contact: z.string().max(200).optional(),
      last_posted: z.string().max(80).optional(),
      note: z.string().max(4000).optional().describe('Append a new note.'),
    }),
    run: updateFbGroup,
  },
  {
    name: 'delete_fb_group',
    description: 'Remove a Facebook group from the workspace list. Requires confirm:true.',
    schema: z.object({
      group_id: z.string().min(1),
      confirm: z.boolean(),
    }),
    run: deleteFbGroup,
  },
  {
    name: 'list_fb_group_scripts',
    description:
      'List copy/paste Facebook group prospecting scripts (educational, value share, soft ask, profile). No API publish — paste manually.',
    schema: z.object({
      category: z.string().optional().describe('educational | value_share | soft_ask | profile_repost'),
    }),
    run: listFbGroupScripts,
  },
];

const BY_NAME = Object.fromEntries(SOCIAL_TOOLS.map((t) => [t.name, t]));
const SOCIAL_TOOL_NAMES = SOCIAL_TOOLS.map((t) => t.name);

async function executeSocialTool(ctx, name, input) {
  const tool = BY_NAME[name];
  if (!tool) throw toolError(`Unknown tool: ${name}`, 'UNKNOWN_TOOL');
  const parsed = tool.schema.safeParse(input || {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw toolError(`${issue.path.join('.') || 'input'}: ${issue.message}`, 'INVALID_ARGUMENTS');
  }
  return tool.run(ctx, parsed.data);
}

function openAiFunctionTools() {
  return SOCIAL_TOOLS.map((tool) => {
    const { $schema, ...parameters } = zodToJsonSchema(tool.schema, { target: 'openApi3' });
    return { type: 'function', function: { name: tool.name, description: tool.description, parameters } };
  });
}

module.exports = {
  SOCIAL_TOOLS,
  SOCIAL_TOOL_NAMES,
  READ_ONLY_SOCIAL_TOOLS: [
    'list_social_posts',
    'generate_social_post_ideas',
    'list_fb_groups',
    'list_fb_group_scripts',
  ],
  DESTRUCTIVE_SOCIAL_TOOLS: ['delete_social_post', 'delete_fb_group'],
  executeSocialTool,
  openAiFunctionTools,
};
