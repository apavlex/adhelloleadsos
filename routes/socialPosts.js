const express = require('express');
const router = express.Router();
const dbService = require('../services/database');

// ── GET /social-posts — main page ─────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const wid = String(req.workspaceId || 'default');
    const savedPosts = await dbService.getSocialPosts(wid).catch(() => []);
    const styleProfile = await dbService.getSocialStyleProfile(wid).catch(() => null);
    res.render('social-posts', {
      activePage: 'social-posts',
      savedPosts,
      styleProfile,
      workspaceId: wid,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/social-posts/ideas — generate platform-specific post ideas ───────
router.get('/api/ideas', async (req, res, next) => {
  try {
    const wid = String(req.query.workspaceId || 'default');
    const raw = String(req.query.preset || '').trim();
    let niche = raw;
    if (!niche) {
      const ws = await dbService.getWorkspace(wid).catch(() => null);
      niche = (ws && ws.socialPostsPreset) || '';
    }
    const ideas = generatePostIdeas(niche);
    res.json({ success: true, ideas, niche });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/social-posts/ideas/regenerate ────────────────────────────────────
// Regenerate a single platform batch (niche in body)
router.post('/api/ideas/regenerate', express.json(), async (req, res, next) => {
  try {
    const niche = String(req.body.niche || '').trim();
    const platform = String(req.body.platform || '').trim();
    const ideas = generatePostIdeas(niche, platform);
    const platformIdeas = platform ? (ideas[platform] || []) : ideas;
    res.json({ success: true, ideas: platformIdeas, niche, platform });
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

    if (!platform || !content) {
      return res.status(400).json({ success: false, error: 'platform and content are required.' });
    }

    const record = {
      id: `sp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      platform,
      content,
      hooks,
      cta,
      tags,
      niche: String(req.body.niche || '').trim(),
      createdAt: new Date().toISOString(),
      workspaceId: wid,
    };

    await dbService.saveSocialPost(record, wid);

    // Extract style signals from the saved post
    const styleUpdate = extractStyleFromPost(record);
    if (styleUpdate) {
      await dbService.updateSocialStyleProfile(wid, styleUpdate);
    }

    res.json({ success: true, id: record.id });
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

// ── Local Content (Clark County / zip.guide daily scout) ───────────────────────

// GET /social-posts/api/local-content — list recent local content items
router.get('/api/local-content', async (req, res, next) => {
  try {
    const wid = String(req.query.workspaceId || req.workspaceId || 'default');
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const items = await dbService.getLocalContent(wid, limit);
    res.json({ success: true, items });
  } catch (err) {
    next(err);
  }
});

// POST /social-posts/api/local-content — save a local content item (from cron or manual)
router.post('/api/local-content', express.json({ limit: '4mb' }), async (req, res, next) => {
  try {
    const wid = String(req.body.workspaceId || req.workspaceId || 'default');
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

// DELETE /social-posts/api/local-content/:id — remove a local content item
router.delete('/api/local-content/:id', async (req, res, next) => {
  try {
    const wid = String(req.workspaceId || 'default');
    await dbService.deleteLocalContent(req.params.id, wid);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── SET workspace niche/preset ─────────────────────────────────────────────────
function extractStyleFromPost(post) {
  const content = post.content || '';
  const words = content.split(/\s+/).length;
  const hasEmoji = /[\u{1F300}-\u{1F9FF}]/u.test(content);
  const hasQuestion = content.includes('?');
  const hasNumbers = /\d/.test(content);
  const sentenceCount = content.split(/[.!?]+/).filter(s => s.trim()).length;
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

// ── GET /api/social-posts/saved — list saved posts for the workspace ──────────
router.get('/api/saved', async (req, res, next) => {
  try {
    const wid = String(req.query.workspaceId || req.workspaceId || 'default');
    const posts = await dbService.getSocialPosts(wid);
    res.json({ success: true, posts });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/social-posts/save-style ─────────────────────────────────────────
router.post('/api/save-style', express.json(), async (req, res, next) => {
  try {
    const wid = String(req.body.workspaceId || req.workspaceId || 'default');
    const profile = {
      niche: String(req.body.niche || '').trim(),
      platforms: Array.isArray(req.body.platforms) ? req.body.platforms : [],
      tone: String(req.body.tone || '').trim(),
      hooks: Array.isArray(req.body.hooks) ? req.body.hooks : [],
      ctas: Array.isArray(req.body.ctas) ? req.body.ctas : [],
     避免: Array.isArray(req.body.avoid) ? req.body.avoid : [],
      updatedAt: new Date().toISOString(),
    };
    await dbService.updateSocialStyleProfile(wid, profile);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── Idea generation engine ─────────────────────────────────────────────────────
function generatePostIdeas(niche = '', platformFilter = null) {
  const n = niche || 'home service business';
  const platforms = platformFilter ? [platformFilter] : ['instagram','facebook','linkedin','x','tiktok'];
  const ideas = {};

  const baseIdeas = {
    instagram: [
      { hook: `Most ${n} owners don't realize this one Google setting is costing them customers...`, carousel: true, cta: 'Save this for later 🔖' },
      { hook: `Before / After: How a ${n} company went from invisible to fully booked`, carousel: true, cta: 'Link in bio to get your free audit' },
      { hook: `3 things your ${n} website is doing wrong (that you can fix today)`, carousel: true, cta: 'Follow for more tips that actually work' },
      { hook: `"We didn't know we were losing customers to Google" — a ${n} owner's story`, story: true, cta: 'DM us AUDIT for your free report' },
      { hook: `The #1 reason ${n} businesses don't show up on Google Maps (it's not what you think)`, single: true, cta: 'Share this with a ${n} owner who needs to see it' },
      { hook: `${n} owners: Here's exactly what happened when we optimized their Google listing (real numbers)`, carousel: true, cta: 'Want these results? Link in bio.' },
      { hook: `Stop losing ${n} leads to competitors who show up higher on Google`, single: true, cta: 'Comment LEADS and we will send you the fix' },
    ],
    facebook: [
      { hook: `Free tip for ${n} business owners: This one Google setting could double your calls`, cta: 'Like & share if you found this helpful' },
      { hook: `We just audited 50 ${n} businesses in [city]. Here's what 47 of them were missing:`, cta: 'Comment "AUDIT" for your free report' },
      { hook: `The ${n} industry has a dirty secret: most businesses are invisible online. Here's the proof`, cta: 'Tag a ${n} business owner who needs to see this' },
      { hook: `"I had no idea Google was hiding my business" — ${n} owner reaction`, cta: 'Learn more at adhello.ai' },
      { hook: `${n} business owners: If your website takes longer than 3 seconds to load, you're losing 50% of your leads. Here's how to fix it.`, cta: 'Free website audit — link in comments' },
      { hook: `POV: You're a ${n} customer searching Google Maps. You pick the first 3 results. Do you even scroll past them? Your customers don't either.`, cta: 'Get found first. Link in bio.' },
    ],
    linkedin: [
      { hook: `I audited 100 ${n} businesses last month. 83 of them had the same problem:`, long: true, cta: 'What is the biggest marketing challenge in your industry? 👇' },
      { hook: `The ${n} industry is being disrupted by one thing: Google's local algorithm. ${n} owners who understand this will thrive. Those who don't will close.`, long: true, cta: 'Agree or disagree? Share your thoughts below.' },
      { hook: `After working with 200+ ${n} businesses, here are the 5 patterns I see in the ones that grow vs. the ones that stagnate:`, long: true, cta: `Pattern #1: They treat their Google Business Profile like a billboard, not a brochure.` },
      { hook: `Most ${n} owners think marketing is ads. It's not. It's being found when someone desperately needs you right now.`, long: true, cta: 'If you run a ${n} business, I wrote a free guide. Link in comments.' },
      { hook: `The average ${n} business loses $4,200/month to poor online visibility. Here's the math:`, long: true, cta: 'Want to know your number? Free audit — link in bio.' },
      { hook: `Just saw a ${n} competitor go from page 5 to #1 on Google Maps in 90 days. Here's exactly what they did (and what you can steal):`, long: true, cta: 'Steal this playbook — link in comments 👇' },
    ],
    x: [
      { hook: `audited 50 ${n} businesses.\n\n47 had no idea Google was hiding them.\n\nthe other 3 hired me.\n\nhere's what i found 🧵`, thread: true, cta: 'want your free audit? link in bio.' },
      { hook: `${n} owners: your google business profile is either working for you or against you. there is no neutral.`, cta: 'get yours checked free → adhello.ai' },
      { hook: `the ${n} owner who shows up first on google maps gets 70% of the calls.\n\nnot the best.\n\nthe most visible.`, cta: 'thread 👇' },
      { hook: `unpopular opinion: ${n} businesses don't need more ads. they need to be findable.`, cta: 'agree? rt if this helped.' },
      { hook: `real talk: i closed 2 ${n} locations strategically to save the flagship. sometimes the best growth move is subtraction.`, cta: 'more on that below 👇' },
      { hook: `${n} industry is booming. but if you don't show up on google, the boom is going to your competitor.`, cta: 'free audit: adhello.ai' },
    ],
    tiktok: [
      { hook: `things i see every ${n} business doing wrong on google (number 3 is costing you the most money)`, short: true, cta: 'follow for part 2' },
      { hook: `showed a ${n} owner his google listing and he literally said "that's not my business"`, short: true, cta: 'dm "audit" to get yours checked free' },
      { hook: `what happens when you google "${n} near me" — most business owners have no idea`, short: true, cta: 'poof 👻 invisible' },
      { hook: `${n} business owners this is your sign to claim your google business profile if you haven't already`, short: true, cta: 'save this and pass it on' },
      { hook: `how a ${n} company went from 3 to 27 calls a week without spending a single dollar on ads`, short: true, cta: 'link in bio for the exact strategy' },
      { hook: `the truth about ${n} marketing in 2025 in 30 seconds`, short: true, cta: 'follow for the rest' },
    ],
  };

  for (const p of platforms) {
    if (baseIdeas[p]) {
      ideas[p] = baseIdeas[p].map((idea, i) => ({
        id: `idea_${p}_${i}`,
        ...idea,
        niche: n,
      }));
    }
  }

  return ideas;
}

module.exports = router;
