const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs').promises;
const path = require('path');

const dbService = require('../services/database');
const workspaceIntegrations = require('../services/workspaceIntegrations');
const { filterLeadsForRequest } = require('../services/workspaceService');
const { excludeOutreachFolderLeads } = require('../services/leadListFilters');
const { parseBulkSelectionKeys, orderLeadsByKeys, resolveLeadsBySelectedKeys } = require('../services/bulkSelectionKeys');
const lobClient = require('../services/lobClient');
const lobDirectMail = require('../services/lobDirectMail');
const { resolveAuditUrl } = require('../services/directMailPersonalize');
const directMailQueue = require('../services/directMailQueue');
const kieImageClient = require('../services/kieImageClient');
const { chatCompletion, parseLlmJson, providersForChain } = require('../services/llmClient');
const googleDriveAccess = require('../services/googleDriveAccess');
const {
  uploadBinaryToDrive,
  safeImageFileName,
  DEFAULT_MARKETING_FOLDER_NAME,
} = require('../services/googleDriveUpload');
const { applyLogoOverlayToRemoteImage } = require('../services/marketingImageComposite');

const pendingImageJobs = new Map();
const IMAGE_JOB_TTL_MS = 30 * 60 * 1000;

function pruneImageJobs() {
  const now = Date.now();
  for (const [id, meta] of pendingImageJobs.entries()) {
    if (now - (meta.createdAt || 0) > IMAGE_JOB_TTL_MS) pendingImageJobs.delete(id);
  }
}

function rememberImageJob(taskId, meta) {
  pruneImageJobs();
  pendingImageJobs.set(String(taskId), { ...meta, createdAt: Date.now() });
}

function getImageJob(taskId) {
  pruneImageJobs();
  return pendingImageJobs.get(String(taskId || '').trim()) || null;
}

function forgetImageJob(taskId) {
  pendingImageJobs.delete(String(taskId || '').trim());
}

async function finalizeGeneratedImage(req, imageUrl, brandKit) {
  let finalImageUrl = imageUrl;
  let logoOverlayApplied = false;
  if (brandKit.logoUrl && brandKit.useLogoInDesign && finalImageUrl) {
    try {
      const logoAbs = toAbsoluteAssetUrl(req, brandKit.logoUrl);
      finalImageUrl = await applyLogoOverlayToRemoteImage(req, {
        baseImageUrl: finalImageUrl,
        logoUrl: logoAbs,
        position: 'top-left',
      });
      logoOverlayApplied = true;
    } catch (overlayErr) {
      console.warn(
        '[direct-mail] logo overlay failed:',
        overlayErr && overlayErr.message ? overlayErr.message : overlayErr,
      );
    }
  }
  return { finalImageUrl, logoOverlayApplied };
}

function kieHttpError(err, req, fallback) {
  const friendly =
    (err && err.kieFriendly) ||
    kieImageClient.friendlyKieImageError(err && err.message, {
      prompt: req.body && req.body.prompt,
    }) ||
    fallback ||
    'Image generation failed.';
  const status = err && err.status === 400 ? 400 : 502;
  return { status, error: friendly };
}

function userEmail(req) {
  return String((req.user && req.user.email) || '').trim().toLowerCase();
}

function marketingDesignFileName(platform, slot, ext) {
  const plat = String(platform || 'postcard').trim() || 'postcard';
  const side = String(slot || 'front').toLowerCase() === 'back' ? 'back' : 'front';
  const suffix = ext || 'jpg';
  return safeImageFileName(`AdHello_${plat}_${side}_${Date.now()}.${suffix}`);
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

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(jpeg|jpg|png|gif|webp|svg\+xml)$/i.test(String(file.mimetype || ''));
    cb(ok ? null : new Error('Logo must be a JPEG, PNG, GIF, WebP, or SVG image.'), ok);
  },
});

const creativeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(jpeg|jpg|png|gif|webp)$/i.test(String(file.mimetype || ''));
    cb(ok ? null : new Error('Upload a JPEG, PNG, GIF, or WebP image.'), ok);
  },
});

const DM_PLATFORMS = {
  postcard: { label: '4×6 Postcard', aspectRatio: '3:2', dualSided: true },
  instagram_feed: { label: 'Instagram Feed', aspectRatio: '1:1', dualSided: false },
  instagram_story: { label: 'Instagram Story / Reels', aspectRatio: '9:16', dualSided: false },
  instagram_portrait: { label: 'Instagram Portrait', aspectRatio: '4:5', dualSided: false },
  facebook_feed: { label: 'Facebook Feed', aspectRatio: '1:1', dualSided: false },
  facebook_cover: { label: 'Facebook Cover', aspectRatio: '16:9', dualSided: false },
  facebook_story: { label: 'Facebook Story', aspectRatio: '9:16', dualSided: false },
  linkedin_post: { label: 'LinkedIn Post', aspectRatio: '1:1', dualSided: false },
  linkedin_banner: { label: 'LinkedIn Banner', aspectRatio: '16:9', dualSided: false },
  google_display: { label: 'Google Display', aspectRatio: '16:9', dualSided: false },
  youtube_thumb: { label: 'YouTube Thumbnail', aspectRatio: '16:9', dualSided: false },
  custom: { label: 'Custom ratio', aspectRatio: null, dualSided: false },
};

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

function normalizeBrandKit(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    businessName: String(src.businessName || '').trim().slice(0, 120),
    address: String(src.address || '').trim().slice(0, 240),
    phone: String(src.phone || '').trim().slice(0, 40),
    hours: String(src.hours || '').trim().slice(0, 240),
    website: String(src.website || '').trim().slice(0, 240),
    email: String(src.email || '').trim().slice(0, 120),
    logoUrl: String(src.logoUrl || '').trim().slice(0, 500),
    useLogoInDesign: src.useLogoInDesign !== false,
    updatedAt: String(src.updatedAt || '').trim(),
  };
}

function brandKitSummary(kit) {
  const k = normalizeBrandKit(kit);
  const lines = [];
  if (k.businessName) lines.push(`Business name: ${k.businessName}`);
  if (k.phone) lines.push(`Phone: ${k.phone}`);
  if (k.email) lines.push(`Email: ${k.email}`);
  if (k.website) lines.push(`Website: ${k.website}`);
  if (k.address) lines.push(`Address: ${k.address}`);
  if (k.hours) lines.push(`Hours: ${k.hours}`);
  if (k.logoUrl && k.useLogoInDesign) {
    lines.push('Logo: uploaded (overlaid unchanged after generation — leave top-left space clear)');
  } else if (k.logoUrl) {
    lines.push('Logo: uploaded (overlay disabled)');
  }
  return lines.length ? lines.join('\n') : '(no business info set yet)';
}

function platformLabel(key) {
  const row = DM_PLATFORMS[String(key || '').trim()] || DM_PLATFORMS.custom;
  return row.label || 'Custom';
}

function buildDesignCoachSystemPrompt({
  slot,
  platform,
  aspectRatio,
  headline,
  bodyText,
  ctaUrl,
  brandKit,
}) {
  const plat = platformLabel(platform);
  const isPostcard = platform === 'postcard';
  const ratio = aspectRatio || '3:2';
  const lobBackRules =
    isPostcard && slot === 'back'
      ? `For Lob 4×6 postcard BACK (landscape 3:2, 1875×1275px):
- Lob automatically prints recipient address + postage in the bottom-right ink-free zone (~53% width × 56% height). NEVER put marketing copy, return address, postage indicia, barcodes, or recipient address in that area — leave it as plain background only.
- Keep all marketing text, logo, and contact info in the LEFT 45% of the card only.
- Do NOT draw USPS postage, PRSRT, barcodes, or "Current Resident" — Lob adds these at print time.
- Do NOT use placeholder text like {business} or curly-brace merge tokens in the image.`
      : '';
  const lobFrontRules =
    isPostcard && slot === 'front'
      ? `For Lob 4×6 postcard FRONT (landscape 3:2):
- Keep ALL text and contact info at least 0.3″ from the bottom edge (Lob trims bleed — bottom lines get cut off otherwise).
- Leave bottom-right ~0.75″ square empty for Lob QR code (white placeholder box is OK).
- Do NOT use placeholder text like {business} or curly-brace merge tokens in the image.`
      : '';
  return `You are an ad creative design coach for a local marketing agency. The user is designing a ${plat} creative (${ratio} aspect ratio${isPostcard ? `, ${slot} side` : ''}).

Business info (include in layout when relevant — phone, website, hours, address, logo placement):
${brandKitSummary(brandKit)}

Ad copy context:
- Headline: ${headline || '(not set yet)'}
- Body: ${bodyText || '(not set yet)'}
- CTA URL (optional): ${ctaUrl || '(none — omit URL on postcard)'}

Merge tokens ({business}, {city}, {state}, {audit_url}) are applied at SEND time in HTML overlays — never bake them into generated artwork.

${lobBackRules}
${lobFrontRules}

Help the user brainstorm visuals and write a strong GPT Image 2 prompt. Images are generated via KIE GPT Image 2. When a logo is enabled, it is overlaid unchanged after generation — do not ask the model to redraw the logo inside the image.

Respond with JSON only, no markdown:
{"reply":"2-4 sentences: coaching, questions, or creative direction","imagePrompt":"null or a detailed English prompt ready for GPT Image 2 — specify platform (${plat}), ${ratio} composition, typography zones, brand colors, mood. Include business contact details in the design when the user wants them on the ad. Null if still exploring."}

Rules:
- imagePrompt must be null until the user wants to generate or asks for a final prompt.
- If the user asks you to generate, create, or make the design (including phrases like "make an ad", "create an ad", "design a post"), set imagePrompt from the conversation and business info — do not leave it null.
- When business info is provided, weave phone, website, hours, and address into the imagePrompt layout.
- Optimize for ${plat}: safe margins, readable text at mobile size, professional local-business marketing aesthetic.
- ${isPostcard && slot === 'back' ? 'Postcard back: marketing on left half only; bottom-right must be empty for Lob address block.' : isPostcard ? 'Postcard front: leave bottom-right clear for QR.' : 'Single-sided social/display ad — one strong focal creative.'}
- Escape double quotes inside strings as \\".`;
}

function augmentImagePromptWithBrand(prompt, brandKit, platform, slot) {
  const base = String(prompt || '').trim();
  if (!base) return base;
  const k = normalizeBrandKit(brandKit);
  const extras = [];
  if (k.businessName) extras.push(`Business: ${k.businessName}`);
  if (k.phone) extras.push(`Phone: ${k.phone}`);
  if (k.email) extras.push(`Email: ${k.email}`);
  if (k.website) extras.push(`Website: ${k.website}`);
  if (k.address) extras.push(`Address: ${k.address}`);
  if (k.hours) extras.push(`Hours: ${k.hours}`);
  if (k.logoUrl && k.useLogoInDesign) {
    extras.push(
      'Leave clear empty space in the top-left corner for a logo overlay — do not draw, invent, or distort a logo in the generated image',
    );
  }
  const plat = platformLabel(platform);
  const isPostcard = String(platform || '').trim() === 'postcard';
  const side = String(slot || 'front').trim();
  let lobSpec = '';
  if (isPostcard && side === 'back') {
    lobSpec =
      ' Lob 4×6 postcard BACK: landscape 3:2. Marketing copy and contact info on LEFT 45% only. Bottom-right ink-free zone must be blank background — no text, no postage, no barcodes, no recipient address (Lob adds these). Never render {business} or placeholder tokens.';
  } else if (isPostcard) {
    lobSpec =
      ' Lob 4×6 postcard FRONT: landscape 3:2. Leave bottom-right ~1 inch clear for QR code. Never render {business} or placeholder tokens in the artwork.';
  }
  const suffix = extras.length
    ? `\n\nPlatform: ${plat}.${lobSpec} Include on the ad where appropriate: ${extras.join('; ')}.`
    : `\n\nPlatform: ${plat}.${lobSpec}`;
  return base + suffix;
}

function formatDesignCoachError(ai) {
  if (ai && typeof ai.error === 'string' && ai.error.trim()) return ai.error.trim();
  const provider = ai && ai.provider ? String(ai.provider) : '';
  if (provider && provider !== 'none') {
    return `Design coach is unavailable (${provider}). Check AI provider keys on the server and try again.`;
  }
  return 'Design coach is unavailable. Set OPENROUTER_API_KEY, or KIE/Gemini/OpenAI keys on the server.';
}

async function runDesignCoachChat(messages) {
  let ai = await chatCompletion({
    messages,
    jsonObject: true,
    max_tokens: 900,
    temperature: 0.65,
    providerChain: 'openrouter',
  });
  if (ai.content) return ai;
  ai = await chatCompletion({
    messages,
    jsonObject: true,
    max_tokens: 900,
    temperature: 0.65,
    providerChain: 'legacy',
  });
  return ai;
}

function appendLeadUpdate(lead, entry) {
  const updates = Array.isArray(lead && lead.updates) ? [...lead.updates] : [];
  updates.push({ timestamp: new Date().toISOString(), ...entry });
  return updates;
}

function leadKeyFromParam(raw) {
  return String(raw || '').trim();
}

function collectRecentSends(leads, limit = 30) {
  const rows = [];
  for (const lead of leads) {
    const logs = Array.isArray(lead.logs) ? lead.logs : [];
    for (const log of logs) {
      if (!log || log.type !== 'direct_mail_outbound') continue;
      rows.push({
        leadKey: lead.key,
        title: lead.title || 'Lead',
        message: log.message || 'Postcard sent',
        timestamp: log.timestamp || '',
        postcardId: log.postcardId || '',
        lobUrl: log.lobUrl || '',
        dashboardUrl: log.postcardId ? lobClient.lobPostcardDashboardUrl(log.postcardId) : '',
        testMode: /\[test\]/i.test(String(log.message || '')),
      });
    }
  }
  rows.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  return rows.slice(0, limit);
}

router.get('/', async (req, res, next) => {
  try {
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);
    const ready = lobDirectMail.directMailReady(integrationEnv);

    const all = await dbService.getAllLeads(req.workspaceId);
    const visible = filterLeadsForRequest(req, all);
    const pipelineVisible = excludeOutreachFolderLeads(visible);
    const selectedKeyOrder = parseBulkSelectionKeys(req.query.keys);
    const selectedOnly = selectedKeyOrder.length > 0;

    let tableLeads;
    let dmIsQueueSession = false;
    let dmQueueEmpty = false;

    if (selectedOnly) {
      tableLeads = await resolveLeadsBySelectedKeys({
        dbService,
        workspaceId: req.workspaceId,
        visibleLeads: visible,
        keyOrder: selectedKeyOrder,
      });
    } else {
      const queue = await directMailQueue.listDirectMailQueueLeads(req.workspaceId, visible);
      if (queue.leads.length) {
        dmIsQueueSession = true;
        const byKey = new Map(visible.map((l) => [l.key, l]));
        tableLeads = [];
        for (const q of queue.leads) {
          const lead = byKey.get(q.key);
          if (lead) tableLeads.push(lead);
        }
      } else {
        dmQueueEmpty = true;
        tableLeads = pipelineVisible.filter((l) => lobDirectMail.hasMailableAddress(l));
      }
    }

    const mailableLeads = tableLeads.map((l) => {
      const lob = lobDirectMail.getLeadLobAddressPreview(l);
      const auditUrl = resolveAuditUrl(l);
      return {
        key: l.key,
        title: l.title || 'Untitled',
        address: lob.addressLine1 || l.address || '',
        city: lob.city || l.city || '',
        state: lob.state || l.state || '',
        zip: lob.zip || '',
        auditUrl,
        status: l.status || '',
        nextChannel: l.next_channel || '',
        website: l.website || '',
        stitchDesignUrl: l.stitchDesignUrl || '',
        stitchScreenshotUrl: l.stitchScreenshotUrl || '',
        mailable: lob.mailable,
        lobReady: lob.mailable,
        preselected: selectedOnly,
      };
    });

    const mailableCount = mailableLeads.filter((l) => l.mailable).length;
    const skippedCount = selectedOnly ? mailableLeads.length - mailableCount : 0;

    const ws = (await dbService.getWorkspace(req.workspaceId)) || { id: req.workspaceId };
    const brandKit = normalizeBrandKit(ws.brandKit);
    const folders = await dbService.listFolders(req.workspaceId);
    const tags = await dbService.listTags(req.workspaceId);
    let dmQueueMeta = null;
    if (dmIsQueueSession) {
      dmQueueMeta = await directMailQueue.listDirectMailQueueLeads(req.workspaceId, visible);
    }

    res.render('direct-mail', {
      activePage: 'direct-mail',
      lobReady: ready,
      kieImageReady: kieImageClient.isConfigured(),
      mailableLeads,
      dmSelectionCount: selectedOnly ? selectedKeyOrder.length : null,
      dmIsSelectionSession: selectedOnly,
      dmIsQueueSession,
      dmQueueEmpty,
      dmMailableCount: mailableCount,
      dmSkippedCount: skippedCount,
      recentSends: collectRecentSends(visible),
      canManageWorkspace: !!req.canManageWorkspace,
      brandKit,
      brandKitJson: JSON.stringify(brandKit),
      folders: folders || [],
      tags: tags || [],
      dmQueueTagKey: dmQueueMeta ? dmQueueMeta.tagKey : '',
      dmQueueFolderKey: dmQueueMeta ? dmQueueMeta.folderKey : '',
    });
  } catch (err) {
    next(err);
  }
});

router.get('/api/status', async (req, res, next) => {
  try {
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);
    const ready = lobDirectMail.directMailReady(integrationEnv);
    const ws = (await dbService.getWorkspace(req.workspaceId)) || { id: req.workspaceId };
    const chatReady =
      providersForChain('openrouter').length > 0 || providersForChain('legacy').length > 0;
    let kieImageStatus = { configured: kieImageClient.isConfigured(), ok: false, message: '' };
    if (kieImageStatus.configured) {
      try {
        kieImageStatus = await kieImageClient.testConnection();
      } catch (e) {
        kieImageStatus = {
          configured: true,
          ok: false,
          message: e && e.message ? e.message : 'KIE connection check failed.',
        };
      }
    } else {
      kieImageStatus.message = 'Set KIE_AI_API_KEY in Render → Environment, then redeploy.';
    }
    res.json({
      success: true,
      ...ready,
      kieImageReady: kieImageStatus.ok,
      kieImageConfigured: kieImageStatus.configured,
      kieImageStatus,
      chatReady,
      brandKit: normalizeBrandKit(ws.brandKit),
      platforms: DM_PLATFORMS,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/api/brand-kit', async (req, res, next) => {
  try {
    const ws = (await dbService.getWorkspace(req.workspaceId)) || { id: req.workspaceId };
    res.json({ success: true, brandKit: normalizeBrandKit(ws.brandKit) });
  } catch (err) {
    next(err);
  }
});

router.patch('/api/brand-kit', express.json({ limit: '64kb' }), async (req, res, next) => {
  try {
    const wid = req.workspaceId;
    let ws = (await dbService.getWorkspace(wid)) || { id: wid, members: {} };
    const prev = normalizeBrandKit(ws.brandKit);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const nextKit = normalizeBrandKit({
      ...prev,
      businessName: Object.prototype.hasOwnProperty.call(body, 'businessName') ? body.businessName : prev.businessName,
      address: Object.prototype.hasOwnProperty.call(body, 'address') ? body.address : prev.address,
      phone: Object.prototype.hasOwnProperty.call(body, 'phone') ? body.phone : prev.phone,
      hours: Object.prototype.hasOwnProperty.call(body, 'hours') ? body.hours : prev.hours,
      website: Object.prototype.hasOwnProperty.call(body, 'website') ? body.website : prev.website,
      email: Object.prototype.hasOwnProperty.call(body, 'email') ? body.email : prev.email,
      useLogoInDesign: Object.prototype.hasOwnProperty.call(body, 'useLogoInDesign')
        ? body.useLogoInDesign !== false
        : prev.useLogoInDesign,
      logoUrl: prev.logoUrl,
    });
    nextKit.updatedAt = new Date().toISOString();
    ws.brandKit = nextKit;
    await dbService.saveWorkspace(wid, ws);
    res.json({ success: true, brandKit: nextKit });
  } catch (err) {
    next(err);
  }
});

router.post('/api/upload-creative', (req, res, next) => {
  creativeUpload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, error: err.message || 'Upload failed' });
    next();
  });
}, async (req, res, next) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ success: false, error: 'Image file is required.' });
    }
    const wid = String(req.workspaceId || 'default')
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '_');
    const extFromName = path.extname(String(req.file.originalname || '')).toLowerCase();
    const ext =
      extFromName && ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(extFromName)
        ? extFromName
        : '.jpg';
    const relDir = path.join('public', 'uploads', 'creative');
    const absDir = path.join(process.cwd(), relDir);
    await fs.mkdir(absDir, { recursive: true });
    const stamp = Date.now();
    const filename = `${wid}_creative_${stamp}${ext}`;
    const absPath = path.join(absDir, filename);
    await fs.writeFile(absPath, req.file.buffer);
    const publicUrl = `/uploads/creative/${filename}`;
    const slot = String(req.body && req.body.slot || 'front').toLowerCase() === 'back' ? 'back' : 'front';

    res.json({
      success: true,
      imageUrl: publicUrl,
      imageAbsoluteUrl: toAbsoluteAssetUrl(req, publicUrl),
      slot,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/api/brand-kit/logo', (req, res, next) => {
  logoUpload.single('logo')(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, error: err.message || 'Upload failed' });
    next();
  });
}, async (req, res, next) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ success: false, error: 'Logo image is required.' });
    }
    const wid = String(req.workspaceId || 'default')
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '_');
    const extFromName = path.extname(String(req.file.originalname || '')).toLowerCase();
    const ext =
      extFromName && ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'].includes(extFromName)
        ? extFromName
        : '.png';
    const relDir = path.join('public', 'uploads', 'brand-kit');
    const absDir = path.join(process.cwd(), relDir);
    await fs.mkdir(absDir, { recursive: true });
    const stamp = Date.now();
    const filename = `${wid}_logo_${stamp}${ext}`;
    const absPath = path.join(absDir, filename);
    await fs.writeFile(absPath, req.file.buffer);
    const publicUrl = `/uploads/brand-kit/${filename}`;

    const ws = (await dbService.getWorkspace(req.workspaceId)) || { id: req.workspaceId, members: {} };
    const prev = normalizeBrandKit(ws.brandKit);
    const nextKit = {
      ...prev,
      logoUrl: publicUrl,
      updatedAt: new Date().toISOString(),
    };
    ws.brandKit = nextKit;
    await dbService.saveWorkspace(req.workspaceId, ws);

    res.json({
      success: true,
      logoUrl: publicUrl,
      logoAbsoluteUrl: toAbsoluteAssetUrl(req, publicUrl),
      brandKit: nextKit,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/api/design-chat', async (req, res, next) => {
  try {
    const body = req.body || {};
    const userMessage = String(body.message || '').trim();
    if (!userMessage) {
      return res.status(400).json({ success: false, error: 'Message is required.' });
    }

    const history = (Array.isArray(body.history) ? body.history : [])
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-12)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));

    const slot = String(body.slot || 'front').toLowerCase() === 'back' ? 'back' : 'front';
    const headline = String(body.headline || '').trim();
    const bodyText = String(body.bodyText || '').trim();
    const ctaUrl = String(body.ctaUrl || '').trim();
    const platform = String(body.platform || 'postcard').trim() || 'postcard';
    const aspectRatio = String(body.aspectRatio || DM_PLATFORMS[platform]?.aspectRatio || '3:2').trim() || '3:2';
    const brandKit = normalizeBrandKit(body.brandKit);

    const messages = [
      {
        role: 'system',
        content: buildDesignCoachSystemPrompt({
          slot,
          platform,
          aspectRatio,
          headline,
          bodyText,
          ctaUrl,
          brandKit,
        }),
      },
      ...history,
      { role: 'user', content: userMessage.slice(0, 4000) },
    ];

    const ai = await runDesignCoachChat(messages);
    if (!ai.content) {
      return res.status(502).json({
        success: false,
        error: formatDesignCoachError(ai),
      });
    }

    const parsed = parseLlmJson(ai.content) || {};
    res.json({
      success: true,
      reply: String(parsed.reply || 'Tell me more about the look you want — brand colors, photo vs illustration, and the main hook.').trim(),
      imagePrompt: parsed.imagePrompt ? String(parsed.imagePrompt).trim() : null,
      provider: ai.provider || null,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/api/generate-image', async (req, res, next) => {
  try {
    if (!kieImageClient.isConfigured()) {
      return res.status(400).json({
        success: false,
        error: 'KIE API key is not configured. Set KIE_AI_API_KEY or KIE_API_KEY on the server.',
      });
    }

    const body = req.body || {};
    let prompt = String(body.prompt || '').trim();
    if (!prompt) {
      return res.status(400).json({ success: false, error: 'Image prompt is required.' });
    }

    const platform = String(body.platform || 'postcard').trim() || 'postcard';
    const slot = String(body.slot || 'front').toLowerCase() === 'back' ? 'back' : 'front';
    const brandKit = normalizeBrandKit(body.brandKit);
    prompt = augmentImagePromptWithBrand(prompt, brandKit, platform, slot);

    if (kieImageClient.isVagueImagePrompt(prompt)) {
      return res.status(400).json({
        success: false,
        error: kieImageClient.friendlyKieImageError('', { prompt }),
      });
    }

    const aspectRatio =
      String(body.aspectRatio || DM_PLATFORMS[platform]?.aspectRatio || '3:2').trim() || '3:2';
    const resolution = String(body.resolution || '2K').trim() || '2K';
    const referenceAbs = body.referenceUrl
      ? toAbsoluteAssetUrl(req, String(body.referenceUrl).trim())
      : '';
    const inputUrls = Array.isArray(body.inputUrls)
      ? body.inputUrls.map((u) => toAbsoluteAssetUrl(req, String(u || '').trim())).filter(Boolean)
      : referenceAbs
        ? [referenceAbs]
        : [];

    let created;
    try {
      created = await kieImageClient.createTask({
        prompt,
        inputUrls,
        aspectRatio,
        resolution,
      });
    } catch (firstErr) {
      if (inputUrls.length) {
        created = await kieImageClient.createTask({
          prompt,
          inputUrls: [],
          aspectRatio,
          resolution,
        });
      } else {
        throw firstErr;
      }
    }

    rememberImageJob(created.taskId, {
      slot,
      brandKit,
      model: created.model,
      prompt,
      workspaceId: req.workspaceId,
    });

    res.json({
      success: true,
      status: 'processing',
      slot,
      taskId: created.taskId,
      model: created.model,
    });
  } catch (err) {
    const { status, error } = kieHttpError(
      err,
      req,
      'Could not start image generation. Check KIE_AI_API_KEY on the server.',
    );
    return res.status(status).json({ success: false, error });
  }
});

router.get('/api/generate-image/status', async (req, res, next) => {
  try {
    if (!kieImageClient.isConfigured()) {
      return res.status(400).json({
        success: false,
        error: 'KIE API key is not configured. Set KIE_AI_API_KEY or KIE_API_KEY on the server.',
      });
    }

    const taskId = String(req.query.taskId || '').trim();
    if (!taskId) {
      return res.status(400).json({ success: false, error: 'taskId is required.' });
    }

    const job = getImageJob(taskId);
    if (!job || job.workspaceId !== req.workspaceId) {
      return res.status(404).json({ success: false, error: 'Image job not found or expired.' });
    }

    const record = await kieImageClient.getTaskRecord(taskId);
    const data = record.data || {};
    const state = String(data.state || '').toLowerCase();

    if (state === 'success') {
      const urls = kieImageClient.extractImageUrls(record);
      if (!urls.length) {
        forgetImageJob(taskId);
        return res.status(502).json({
          success: false,
          status: 'failed',
          error: 'Image generation finished but no result URL was returned.',
        });
      }
      const { finalImageUrl, logoOverlayApplied } = await finalizeGeneratedImage(
        req,
        urls[0],
        job.brandKit || {},
      );
      forgetImageJob(taskId);
      return res.json({
        success: true,
        status: 'success',
        slot: job.slot,
        taskId,
        model: job.model,
        imageUrl: finalImageUrl,
        urls,
        logoOverlayApplied,
      });
    }

    if (state === 'fail') {
      forgetImageJob(taskId);
      const msg = data.failMsg || data.failCode || 'Image generation failed.';
      const friendly = kieImageClient.friendlyKieImageError(String(msg), { prompt: job.prompt });
      return res.status(502).json({ success: false, status: 'failed', error: friendly });
    }

    res.json({
      success: true,
      status: 'processing',
      state: state || 'processing',
      taskId,
      slot: job.slot,
    });
  } catch (err) {
    const { status, error } = kieHttpError(err, req, 'Could not check image generation status.');
    return res.status(status).json({ success: false, error });
  }
});

router.post('/api/send', async (req, res, next) => {
  try {
    const keys = Array.isArray(req.body && req.body.keys)
      ? req.body.keys.map((k) => String(k || '').trim()).filter(Boolean)
      : req.body && req.body.key
        ? [String(req.body.key).trim()].filter(Boolean)
        : [];
    if (!keys.length) {
      return res.status(400).json({ success: false, error: 'Select at least one lead.' });
    }

    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);
    if (!lobClient.isConfigured(integrationEnv)) {
      return res.status(400).json({
        success: false,
        error: 'Connect Lob in Workspace → Integrations before sending mail.',
      });
    }

    const headline = String((req.body && req.body.headline) || '').trim();
    const bodyText = String((req.body && req.body.bodyText) || '').trim();
    const ctaUrl = String((req.body && req.body.ctaUrl) || '').trim();
    const frontImageUrl = toAbsoluteAssetUrl(req, String((req.body && req.body.frontImageUrl) || '').trim());
    const backImageUrl = toAbsoluteAssetUrl(req, String((req.body && req.body.backImageUrl) || '').trim());
    const personalizeOverlay = req.body && req.body.personalizeOverlay !== false;
    const includeLobQr = req.body && req.body.includeLobQr !== false;

    const results = [];
    for (const key of keys) {
      const fullKey = leadKeyFromParam(key);
      const lead = await dbService.getLead(fullKey, req.workspaceId);
      if (!lead) {
        results.push({ key: fullKey, ok: false, error: 'Lead not found' });
        continue;
      }
      try {
        const sent = await lobDirectMail.sendPostcardToLead({
          lead,
          integrationEnv,
          headline: headline || undefined,
          bodyText: bodyText || undefined,
          ctaUrl: ctaUrl || undefined,
          frontImageUrl: frontImageUrl || undefined,
          backImageUrl: backImageUrl || undefined,
          personalizeOverlay,
          includeLobQr,
          req,
        });
        const updates = appendLeadUpdate(lead, {
          type: 'direct_mail_outbound',
          value: sent.postcardId || 'postcard',
          provider: 'lob',
          postcardId: sent.postcardId || '',
          lobUrl: sent.url || '',
        });
        await dbService.updateLead(fullKey, {
          status: lead.status === 'Not Contacted' ? 'Mail Sent' : lead.status,
          updates,
          logs: [
            {
              type: 'direct_mail_outbound',
              message: `Lob postcard queued${sent.postcardId ? ` (${sent.postcardId})` : ''}${sent.qrRedirectUrl ? ' · QR' : ''}${sent.testMode ? ' [test]' : ''}`,
              timestamp: new Date().toISOString(),
              postcardId: sent.postcardId || '',
              lobUrl: sent.url || '',
              qrRedirectUrl: sent.qrRedirectUrl || '',
              provider: 'lob',
            },
          ],
        });
        results.push({
          key: fullKey,
          ok: true,
          postcardId: sent.postcardId,
          expectedDeliveryDate: sent.expectedDeliveryDate,
          testMode: sent.testMode,
          lobUrl: sent.url || '',
          qrRedirectUrl: sent.qrRedirectUrl || '',
          dashboardUrl: sent.dashboardUrl || lobClient.lobPostcardDashboardUrl(sent.postcardId),
        });
      } catch (e) {
        results.push({ key: fullKey, ok: false, error: e && e.message ? e.message : 'Send failed' });
      }
    }

    const okCount = results.filter((r) => r.ok).length;
    const failMessages = results.filter((r) => !r.ok).map((r) => r.error).filter(Boolean);
    const testMode = lobClient.isTestMode(integrationEnv);
    const sample = results.find((r) => r.ok && r.postcardId);
    res.json({
      success: okCount > 0,
      sent: okCount,
      failed: results.length - okCount,
      testMode,
      lobDashboardUrl: 'https://dashboard.lob.com/postcards',
      samplePostcardId: sample ? sample.postcardId : '',
      sampleDashboardUrl: sample ? sample.dashboardUrl : '',
      sampleLobUrl: sample ? sample.lobUrl : '',
      results,
      error: okCount > 0 ? undefined : failMessages[0] || 'Send failed',
    });
  } catch (err) {
    next(err);
  }
});

router.get('/api/lob-recent', async (req, res, next) => {
  try {
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);
    if (!lobClient.isConfigured(integrationEnv)) {
      return res.status(400).json({ success: false, error: 'Lob is not configured.' });
    }
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 30);
    const data = await lobClient.listPostcards({ integrationEnv, limit });
    const rows = Array.isArray(data && data.data)
      ? data.data.map((row) => ({
          id: row.id || '',
          description: row.description || '',
          sendDate: row.send_date || row.date_created || '',
          url: row.url || '',
          dashboardUrl: lobClient.lobPostcardDashboardUrl(row.id),
        }))
      : [];
    res.json({
      success: true,
      testMode: lobClient.isTestMode(integrationEnv),
      lobDashboardUrl: 'https://dashboard.lob.com/postcards',
      count: data && data.count != null ? data.count : rows.length,
      postcards: rows,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/api/queue', express.json(), async (req, res, next) => {
  try {
    const leadKeysRaw = Array.isArray(req.body && req.body.leadKeys) ? req.body.leadKeys : [];
    const leadKeys = leadKeysRaw.map((k) => String(k || '').trim()).filter(Boolean);
    if (!leadKeys.length) {
      return res.status(400).json({ success: false, error: 'leadKeys is required.' });
    }

    const all = await dbService.getAllLeads(req.workspaceId);
    const visible = filterLeadsForRequest(req, all);
    const result = await directMailQueue.addLeadsToDirectMailQueue(req.workspaceId, leadKeys, visible);

    if (!result.leads.length && leadKeys.length) {
      return res.status(404).json({
        success: false,
        error: 'Could not queue those leads. Open a saved lead or check your access.',
        ...result,
      });
    }

    res.json({
      success: true,
      ...result,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/api/queue/remove', express.json(), async (req, res, next) => {
  try {
    const leadKeysRaw = Array.isArray(req.body && req.body.leadKeys) ? req.body.leadKeys : [];
    const leadKeys = leadKeysRaw.map((k) => String(k || '').trim()).filter(Boolean);
    if (!leadKeys.length) {
      return res.status(400).json({ success: false, error: 'leadKeys is required.' });
    }
    const all = await dbService.getAllLeads(req.workspaceId);
    const visible = filterLeadsForRequest(req, all);
    const result = await directMailQueue.removeLeadsFromDirectMailQueue(
      req.workspaceId,
      leadKeys,
      visible,
    );
    res.json({ success: result.removed > 0, ...result });
  } catch (err) {
    next(err);
  }
});

router.get('/api/queue', async (req, res, next) => {
  try {
    const all = await dbService.getAllLeads(req.workspaceId);
    const visible = filterLeadsForRequest(req, all);
    const result = await directMailQueue.listDirectMailQueueLeads(req.workspaceId, visible);
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

router.post('/api/download-image', express.json(), async (req, res, next) => {
  try {
    const body = req.body || {};
    const imageUrl = toAbsoluteAssetUrl(req, body.imageUrl);
    const { buffer, contentType, ext } = await fetchRemoteImageBuffer(imageUrl);
    const fileName = marketingDesignFileName(body.platform, body.slot, ext);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

router.post('/api/save-to-drive', express.json(), async (req, res, next) => {
  try {
    const email = userEmail(req);
    const access = email ? await googleDriveAccess.getValidAccessToken(email) : null;
    if (!access) {
      return res.status(401).json({
        success: false,
        error: 'Connect Google Drive from Pipeline first (export menu).',
        code: 'DRIVE_NOT_CONNECTED',
      });
    }
    const body = req.body || {};
    const imageUrl = toAbsoluteAssetUrl(req, body.imageUrl);
    const { buffer, contentType, ext } = await fetchRemoteImageBuffer(imageUrl);
    const fileName = marketingDesignFileName(body.platform, body.slot, ext);
    const uploaded = await uploadBinaryToDrive(access, {
      name: fileName,
      content: buffer,
      mimeType: contentType,
      folderName: DEFAULT_MARKETING_FOLDER_NAME,
    });
    res.json({
      success: true,
      id: uploaded.id,
      name: uploaded.name,
      webViewLink: uploaded.webViewLink || null,
      folderName: DEFAULT_MARKETING_FOLDER_NAME,
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

module.exports = router;
