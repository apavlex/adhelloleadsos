const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const { resolveSocialPostProfile } = require('../services/socialPostProfile');
const { generatePostIdeas } = require('../services/socialPostIdeas');
const googleDriveAccess = require('../services/googleDriveAccess');
const { uploadBinaryToDrive, safeDriveFileName } = require('../services/googleDriveUpload');

const REVIEW_FOLDER_NAME = 'Review later';
const SOCIAL_DRIVE_FOLDER = 'AdHello Social Posts';

function userEmail(req) {
  return String((req.user && req.user.email) || '').trim().toLowerCase();
}

function publicBaseUrl(req) {
  const env = String(process.env.BASE_URL || '').trim().replace(/\/$/, '');
  if (env) return env;
  return `${req.protocol}://${req.get('host')}`;
}

function toAbsoluteAssetUrl(req, relativePath) {
  const rel = String(relativePath || '').trim();
  if (!rel) return '';
  if (/^https?:\/\//i.test(rel)) return rel;
  const base = publicBaseUrl(req);
  return rel.startsWith('/') ? `${base}${rel}` : `${base}/${rel}`;
}

async function fetchRemoteImageBuffer(imageUrl) {
  const url = String(imageUrl || '').trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new Error('A valid image URL is required.');
  }
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Could not fetch image (${res.status}).`);
  }
  const contentType = String(res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
  const ab = await res.arrayBuffer();
  if (!ab || !ab.byteLength) throw new Error('Image download was empty.');
  let ext = 'jpg';
  if (/png/i.test(contentType)) ext = 'png';
  else if (/webp/i.test(contentType)) ext = 'webp';
  return { buffer: Buffer.from(ab), contentType, ext };
}

async function loadWorkspaceProfile(wid, presetOverride) {
  const ws = await dbService.getWorkspace(wid).catch(() => null);
  const profile = resolveSocialPostProfile(ws);
  if (presetOverride) {
    profile.niche = presetOverride;
  }
  return { ws, profile };
}

// ── GET /social-posts — main page ─────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const wid = String(req.workspaceId || 'default');
    const savedPosts = await dbService.getSocialPosts(wid).catch(() => []);
    const styleProfile = await dbService.getSocialStyleProfile(wid).catch(() => null);
    const bookmarkFolders = await dbService.getSocialBookmarkFolders(wid).catch(() => []);
    const { profile } = await loadWorkspaceProfile(wid);
    res.render('social-posts', {
      activePage: 'social-posts',
      savedPosts,
      styleProfile,
      bookmarkFolders,
      businessProfile: profile,
      workspaceId: wid,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/social-posts/ideas — generate platform-specific post ideas ───────
router.get('/api/ideas', async (req, res, next) => {
  try {
    const wid = String(req.query.workspaceId || req.workspaceId || 'default');
    const raw = String(req.query.preset || '').trim();
    const { profile } = await loadWorkspaceProfile(wid, raw || null);
    const ideas = generatePostIdeas(profile.niche, null, {
      isAgencyWorkspace: profile.isAgencyWorkspace,
      contentSubject: profile.contentSubject,
    });
    res.json({ success: true, ideas, niche: profile.niche, profile });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/social-posts/ideas/regenerate ────────────────────────────────────
router.post('/api/ideas/regenerate', express.json(), async (req, res, next) => {
  try {
    const wid = String(req.body.workspaceId || req.workspaceId || 'default');
    const nicheInput = String(req.body.niche || '').trim();
    const platform = String(req.body.platform || '').trim();
    const { profile } = await loadWorkspaceProfile(wid, nicheInput || null);
    const ideas = generatePostIdeas(profile.niche, platform || null, {
      isAgencyWorkspace: profile.isAgencyWorkspace,
      contentSubject: profile.contentSubject,
    });
    const platformIdeas = platform ? ideas[platform] || [] : ideas;
    res.json({ success: true, ideas: platformIdeas, niche: profile.niche, platform, profile });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/social-posts/save — save an edited post (feeds style learning) ──
router.post('/api/save', express.json({ limit: '4mb' }), async (req, res, next) => {
  try {
    const wid = String(req.body.workspaceId || req.workspaceId || 'default');
    const platform = String(req.body.platform || '').trim();
    const content = String(req.body.content || '').trim();
    const hooks = String(req.body.hooks || '').trim();
    const cta = String(req.body.cta || '').trim();
    const tags = Array.isArray(req.body.tags) ? req.body.tags : [];
    const folderId = req.body.folderId ? String(req.body.folderId).trim() : null;
    const ideaId = req.body.ideaId ? String(req.body.ideaId).trim() : '';

    if (!platform || !content) {
      return res.status(400).json({ success: false, error: 'platform and content are required.' });
    }

    const { profile } = await loadWorkspaceProfile(wid);

    let artworkUrl = String(req.body.artworkUrl || '').trim();
    let artworkPrompt = String(req.body.artworkPrompt || '').trim();
    if (!artworkUrl && ideaId) {
      const ideaArt = await dbService.getSocialIdeaArtwork(ideaId, wid);
      if (ideaArt && ideaArt.artworkUrl) {
        artworkUrl = ideaArt.artworkUrl;
        artworkPrompt = ideaArt.artworkPrompt || artworkPrompt;
      }
    }

    const record = {
      id: `sp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      platform,
      content,
      hooks,
      cta,
      tags,
      liked: Boolean(req.body.liked),
      imageNote: String(req.body.imageNote || '').trim(),
      niche: String(req.body.niche || profile.niche || '').trim(),
      ideaId,
      folderId: folderId || null,
      bookmarked: true,
      createdAt: new Date().toISOString(),
      workspaceId: wid,
    };
    if (artworkUrl) {
      record.artworkUrl = artworkUrl;
      record.artworkPrompt = artworkPrompt;
      record.artworkUpdatedAt = new Date().toISOString();
    }

    await dbService.saveSocialPost(record, wid);

    const styleUpdate = extractStyleFromPost(record);
    if (styleUpdate) {
      await dbService.updateSocialStyleProfile(wid, styleUpdate);
    }

    res.json({ success: true, id: record.id, post: record });
  } catch (err) {
    next(err);
  }
});

// ── PATCH /api/social-posts/:id — update saved post fields ─────────────────────
router.patch('/api/:id', express.json(), async (req, res, next) => {
  try {
    const wid = String(req.body.workspaceId || req.workspaceId || 'default');
    const patch = {};
    if (req.body.liked !== undefined) patch.liked = Boolean(req.body.liked);
    if (req.body.tags !== undefined) patch.tags = Array.isArray(req.body.tags) ? req.body.tags : [];
    if (req.body.imageNote !== undefined) patch.imageNote = String(req.body.imageNote || '').trim();
    if (req.body.content !== undefined) patch.content = String(req.body.content || '').trim();
    if (req.body.cta !== undefined) patch.cta = String(req.body.cta || '').trim();
    if (req.body.folderId !== undefined) patch.folderId = req.body.folderId ? String(req.body.folderId).trim() : null;
    if (req.body.artworkUrl !== undefined) patch.artworkUrl = String(req.body.artworkUrl || '').trim();
    if (req.body.artworkPrompt !== undefined) patch.artworkPrompt = String(req.body.artworkPrompt || '').trim();
    if (req.body.artworkUpdatedAt !== undefined) {
      patch.artworkUpdatedAt = String(req.body.artworkUpdatedAt || '').trim();
    }
    const post = await dbService.updateSocialPost(req.params.id, patch, wid);
    if (!post) return res.status(404).json({ success: false, error: 'Post not found.' });
    res.json({ success: true, post });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/social-posts/sync-artwork — link generated image to a post/idea ─
router.post('/api/sync-artwork', express.json({ limit: '4mb' }), async (req, res, next) => {
  try {
    const wid = String(req.body.workspaceId || req.workspaceId || 'default');
    const artworkUrl = String(req.body.artworkUrl || '').trim();
    const artworkPrompt = String(req.body.artworkPrompt || '').trim();
    const postId = String(req.body.postId || '').trim();
    const ideaId = String(req.body.ideaId || '').trim();
    if (!artworkUrl) {
      return res.status(400).json({ success: false, error: 'artworkUrl is required.' });
    }
    if (!postId && !ideaId) {
      return res.status(400).json({ success: false, error: 'postId or ideaId is required.' });
    }

    const patch = {
      artworkUrl,
      artworkPrompt,
      artworkUpdatedAt: new Date().toISOString(),
    };
    let post = null;

    if (postId) {
      post = await dbService.updateSocialPost(postId, patch, wid);
    } else if (ideaId) {
      await dbService.saveSocialIdeaArtwork(ideaId, patch, wid);
      const posts = await dbService.getSocialPosts(wid);
      const matched = posts.find((p) => String(p.ideaId || '') === ideaId);
      if (matched) {
        post = await dbService.updateSocialPost(matched.id, patch, wid);
      }
    }

    res.json({ success: true, post, ideaId: ideaId || null, artworkUrl });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/social-posts/idea-artwork — artwork keyed by idea id ─────────────
router.get('/api/idea-artwork', async (req, res, next) => {
  try {
    const wid = String(req.query.workspaceId || req.workspaceId || 'default');
    const artworks = await dbService.getAllSocialIdeaArtworks(wid);
    res.json({ success: true, artworks });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/social-posts/export-drive — sync post text to Google Drive ─────
router.post('/api/export-drive', express.json(), async (req, res, next) => {
  try {
    const email = userEmail(req);
    const access = email ? await googleDriveAccess.getValidAccessToken(email) : null;
    if (!access) {
      return res.status(401).json({
        success: false,
        error: 'Connect Google Drive to export posts.',
        code: 'DRIVE_NOT_CONNECTED',
      });
    }
    const platform = String(req.body.platform || 'post').trim();
    const content = String(req.body.content || '').trim();
    const cta = String(req.body.cta || '').trim();
    const imageNote = String(req.body.imageNote || '').trim();
    const tags = Array.isArray(req.body.tags) ? req.body.tags : [];
    const artworkUrl = toAbsoluteAssetUrl(req, String(req.body.artworkUrl || '').trim());
    if (!content) {
      return res.status(400).json({ success: false, error: 'content is required.' });
    }
    let text = `[${platform.toUpperCase()}]\n\n${content}`;
    if (cta) text += `\n\nCTA: ${cta}`;
    if (tags.length) text += `\n\nTags: ${tags.join(' ')}`;
    if (imageNote) text += `\n\nImage note: ${imageNote}`;
    const fileName = safeDriveFileName(`AdHello_${platform}_${Date.now()}.txt`);
    const uploaded = await uploadBinaryToDrive(access, {
      name: fileName,
      content: Buffer.from(text, 'utf8'),
      mimeType: 'text/plain',
      folderName: SOCIAL_DRIVE_FOLDER,
    });
    let imageUpload = null;
    if (artworkUrl) {
      try {
        const { buffer, contentType, ext } = await fetchRemoteImageBuffer(artworkUrl);
        imageUpload = await uploadBinaryToDrive(access, {
          name: safeDriveFileName(`AdHello_${platform}_artwork_${Date.now()}.${ext}`),
          content: buffer,
          mimeType: contentType,
          folderName: SOCIAL_DRIVE_FOLDER,
        });
      } catch (imgErr) {
        console.warn('[social-posts] artwork drive upload failed:', imgErr && imgErr.message ? imgErr.message : imgErr);
      }
    }
    res.json({
      success: true,
      id: uploaded.id,
      name: uploaded.name,
      webViewLink: uploaded.webViewLink || null,
      imageId: imageUpload && imageUpload.id ? imageUpload.id : null,
      imageName: imageUpload && imageUpload.name ? imageUpload.name : null,
      imageWebViewLink: imageUpload && imageUpload.webViewLink ? imageUpload.webViewLink : null,
    });
  } catch (err) {
    if (err && err.code === 'DRIVE_SCOPE') {
      return res.status(403).json({
        success: false,
        error: 'Reconnect Google Drive to allow saving files.',
        code: 'DRIVE_SCOPE',
      });
    }
    next(err);
  }
});

// ── POST /api/social-posts/ensure-review-folder ───────────────────────────────
router.post('/api/ensure-review-folder', express.json(), async (req, res, next) => {
  try {
    const wid = String(req.body.workspaceId || req.workspaceId || 'default');
    const folders = await dbService.getSocialBookmarkFolders(wid);
    let folder = folders.find((f) => f.name.toLowerCase() === REVIEW_FOLDER_NAME.toLowerCase());
    if (!folder) {
      folder = await dbService.saveSocialBookmarkFolder({ name: REVIEW_FOLDER_NAME }, wid);
    }
    res.json({ success: true, folder });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/social-posts/:id — remove a saved post ────────────────────────
router.delete('/api/:id', async (req, res, next) => {
  try {
    const wid = String(req.workspaceId || 'default');
    await dbService.deleteSocialPost(req.params.id, wid);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── PATCH /api/social-posts/:id/folder — move bookmark to folder ──────────────
router.patch('/api/:id/folder', express.json(), async (req, res, next) => {
  try {
    const wid = String(req.body.workspaceId || req.workspaceId || 'default');
    const folderId = req.body.folderId ? String(req.body.folderId).trim() : null;
    const post = await dbService.updateSocialPostFolder(req.params.id, folderId, wid);
    if (!post) return res.status(404).json({ success: false, error: 'Post not found.' });
    res.json({ success: true, post });
  } catch (err) {
    next(err);
  }
});

// ── Bookmark folders ───────────────────────────────────────────────────────────

router.get('/api/bookmark-folders', async (req, res, next) => {
  try {
    const wid = String(req.query.workspaceId || req.workspaceId || 'default');
    const folders = await dbService.getSocialBookmarkFolders(wid);
    res.json({ success: true, folders });
  } catch (err) {
    next(err);
  }
});

router.post('/api/bookmark-folders', express.json(), async (req, res, next) => {
  try {
    const wid = String(req.body.workspaceId || req.workspaceId || 'default');
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ success: false, error: 'name is required.' });
    const folder = await dbService.saveSocialBookmarkFolder({ name }, wid);
    res.json({ success: true, folder });
  } catch (err) {
    next(err);
  }
});

router.delete('/api/bookmark-folders/:id', async (req, res, next) => {
  try {
    const wid = String(req.workspaceId || 'default');
    await dbService.deleteSocialBookmarkFolder(req.params.id, wid);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── Local Content (Clark County / zip.guide daily scout) ───────────────────────

router.get('/api/local-content', async (req, res, next) => {
  try {
    const wid = String(req.query.workspaceId || req.workspaceId || 'default');
    const { profile } = await loadWorkspaceProfile(wid);
    if (!profile.showLocalContent) {
      return res.json({ success: true, items: [], hidden: true });
    }
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const items = await dbService.getLocalContent(wid, limit);
    res.json({ success: true, items });
  } catch (err) {
    next(err);
  }
});

router.post('/api/local-content', express.json({ limit: '4mb' }), async (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'] || req.query.api_key;
    const expectedKey = process.env.API_INGEST_KEY || 'adhello_secret_123';
    const wid = String(req.body.workspaceId || req.workspaceId || 'default');
    if (apiKey && apiKey === expectedKey) {
      // API key authenticated — proceed
    } else if (!req.session || !req.session.userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    const entry = {
      id: req.body.id || undefined,
      title: String(req.body.title || '').trim(),
      summary: String(req.body.summary || '').trim(),
      postIdea: String(req.body.postIdea || '').trim(),
      category: String(req.body.category || 'general').trim(),
      source: String(req.body.source || '').trim(),
      createdAt: req.body.createdAt || new Date().toISOString(),
    };
    if (!entry.title) {
      return res.status(400).json({ success: false, error: 'title is required.' });
    }
    const saved = await dbService.saveLocalContent(entry, wid);
    res.json({ success: true, item: saved });
  } catch (err) {
    next(err);
  }
});

router.patch('/api/local-content/:id/newsletter', express.json(), async (req, res, next) => {
  try {
    const wid = String(req.body.workspaceId || req.workspaceId || 'default');
    const all = await dbService.getLocalContent(wid, 200);
    const item = all.find((i) => i.id === req.params.id);
    if (!item) return res.status(404).json({ success: false, error: 'Not found' });
    item.newsletter = !item.newsletter;
    item.newsletterAt = new Date().toISOString();
    await dbService.saveLocalContent(item, wid);
    res.json({ success: true, newsletter: item.newsletter });
  } catch (err) {
    next(err);
  }
});

router.delete('/api/local-content/:id', async (req, res, next) => {
  try {
    const wid = String(req.workspaceId || 'default');
    await dbService.deleteLocalContent(req.params.id, wid);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

function extractStyleFromPost(post) {
  const content = post.content || '';
  const words = content.split(/\s+/).length;
  const hasEmoji = /[\u{1F300}-\u{1F9FF}]/u.test(content);
  const hasQuestion = content.includes('?');
  const hasNumbers = /\d/.test(content);
  const sentenceCount = content.split(/[.!?]+/).filter((s) => s.trim()).length;
  const avgWordsPerSentence = sentenceCount > 0 ? Math.round(words / sentenceCount) : words;

  return {
    totalSaved: 1,
    avgWords: words,
    avgWordsPerSentence,
    usesEmoji: hasEmoji,
    usesQuestions: hasQuestion,
    usesNumbers: hasNumbers,
    lastPlatform: post.platform,
    updatedAt: new Date().toISOString(),
  };
}

router.get('/api/saved', async (req, res, next) => {
  try {
    const wid = String(req.query.workspaceId || req.workspaceId || 'default');
    const posts = await dbService.getSocialPosts(wid);
    res.json({ success: true, posts });
  } catch (err) {
    next(err);
  }
});

router.post('/api/save-style', express.json(), async (req, res, next) => {
  try {
    const wid = String(req.body.workspaceId || req.workspaceId || 'default');
    const profile = {
      niche: String(req.body.niche || '').trim(),
      platforms: Array.isArray(req.body.platforms) ? req.body.platforms : [],
      tone: String(req.body.tone || '').trim(),
      hooks: Array.isArray(req.body.hooks) ? req.body.hooks : [],
      ctas: Array.isArray(req.body.ctas) ? req.body.ctas : [],
      avoid: Array.isArray(req.body.avoid) ? req.body.avoid : [],
      updatedAt: new Date().toISOString(),
    };
    await dbService.updateSocialStyleProfile(wid, profile);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
