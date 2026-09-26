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
const {
  listPlaybooks,
  getPlaybookById,
  suggestPlaybookForLead,
  normalizeContext,
} = require('../services/directMailPlaybooks');
const kieImageClient = require('../services/kieImageClient');
const { chatCompletion, parseLlmJson, providersForChain } = require('../services/llmClient');
const {
  sanitizeDesignImagePrompt,
  userAskedForDesign,
  buildFallbackDesignImagePrompt,
  hasRichCreativeDirection,
  isVagueDesignBrief,
  formatDesignCoachClarifyReply,
  formatDesignCoachReplyForDisplay,
  sanitizeDesignCoachReply,
  replyClaimsDraftReady,
} = require('../services/designCoachImagePrompt');
const {
  DM_PLATFORMS,
  platformLabel,
  platformAspectRatio,
  platformGenerationSpec,
} = require('../services/dmPlatforms');
const googleDriveAccess = require('../services/googleDriveAccess');
const { downloadDriveFileAsImageBuffer } = require('../services/googleDriveImages');
const {
  uploadBinaryToDrive,
  safeImageFileName,
  DEFAULT_MARKETING_FOLDER_NAME,
} = require('../services/googleDriveUpload');
const {
  applyLogoOverlayFromBuffers,
  fetchImageBuffer,
  getCreativeStorageDir,
  saveCompositedImageBuffer,
} = require('../services/marketingImageComposite');
const brandKitLogo = require('../services/brandKitLogo');
const ghlProspectSync = require('../services/ghlProspectSync');

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

async function getWorkspaceForBrand(req) {
  const wid = req.workspaceId;
  let ws = (await dbService.getWorkspace(wid)) || { id: wid };
  const beforeLogo = ws.brandKitLogo;
  ws = await brandKitLogo.migrateLegacyLogoIfNeeded(ws);
  if (ws.brandKitLogo !== beforeLogo && ws.brandKitLogo) {
    await dbService.saveWorkspace(wid, ws);
  }
  return ws;
}

async function mergeBrandKitForGeneration(req, clientRaw) {
  const ws = await getWorkspaceForBrand(req);
  const serverKit = resolveBrandKitForClient(ws);
  const clientKit = normalizeBrandKit(clientRaw);
  const clientSentUseLogo =
    clientRaw && typeof clientRaw === 'object' && Object.prototype.hasOwnProperty.call(clientRaw, 'useLogoInDesign');
  const useLogoInDesign = clientSentUseLogo ? clientKit.useLogoInDesign : serverKit.useLogoInDesign !== false;
  const logoData = await brandKitLogo.loadLogoBuffer(ws);
  const hasLogo = Boolean(logoData && logoData.buffer && logoData.buffer.length);
  return normalizeBrandKit({
    ...serverKit,
    ...clientKit,
    logoUrl: serverKit.logoUrl || clientKit.logoUrl,
    useLogoInDesign: hasLogo ? useLogoInDesign !== false : false,
  });
}

const LOGO_OVERLAY_POSITION = 'top-right';
const LOGO_OVERLAY_MAX_WIDTH_RATIO = 0.16;

async function applyLogoOverlaySafe(req, baseBuffer, imageUrl, logoData) {
  return applyLogoOverlayFromBuffers(req, {
    baseBuffer,
    logoBuffer: logoData.buffer,
    logoMimeType: logoData.mimeType,
    position: LOGO_OVERLAY_POSITION,
    maxWidthRatio: LOGO_OVERLAY_MAX_WIDTH_RATIO,
    padding: 28,
    prefix: 'logo_overlay',
  });
}

/**
 * Browser canvas must use a same-origin path. Absolute BASE_URL can point at a
 * different host (.ai vs .io) and cookie-gated creative URLs then fail to load.
 */
function browserFacingAssetUrl(relativePath) {
  const rel = String(relativePath || '').trim();
  if (!rel) return '';
  if (/^https?:\/\//i.test(rel)) {
    try {
      const parsed = new URL(rel);
      if (
        parsed.pathname.startsWith('/direct-mail/') ||
        parsed.pathname.startsWith('/uploads/')
      ) {
        return parsed.pathname + parsed.search;
      }
    } catch (_) {
      /* keep absolute */
    }
    return rel;
  }
  return rel.startsWith('/') ? rel : `/${rel}`;
}

async function hostGeneratedImageBuffer(req, buffer, prefix) {
  const relative = await saveCompositedImageBuffer(req, buffer, prefix || 'generated');
  return browserFacingAssetUrl(relative);
}

async function finalizeGeneratedImage(req, imageUrl, brandKit, { taskId } = {}) {
  let finalImageUrl = imageUrl;
  let logoOverlayApplied = false;
  let logoSkipReason = null;
  let logoOverlayError = null;
  if (!finalImageUrl) {
    return { finalImageUrl: '', logoOverlayApplied, logoSkipReason: 'no_image', fatal: true };
  }

  const ws = await getWorkspaceForBrand(req);
  const k = await mergeBrandKitForGeneration(req, brandKit);

  async function downloadBaseBuffer(url) {
    try {
      return await fetchImageBuffer(url);
    } catch (firstErr) {
      let candidates = [];
      if (taskId) {
        try {
          const record = await kieImageClient.getTaskRecord(taskId);
          candidates = kieImageClient.extractImageUrls(record).filter((u) => u && u !== url);
        } catch (_) {
          /* ignore */
        }
      }
      try {
        const downloadable = await kieImageClient.resolveDownloadableUrl(url);
        if (downloadable && downloadable !== url) candidates.push(downloadable);
      } catch (_) {
        /* ignore */
      }
      let lastErr = firstErr;
      for (const candidate of candidates) {
        try {
          return await fetchImageBuffer(candidate);
        } catch (err) {
          lastErr = err;
        }
      }
      throw lastErr;
    }
  }

  let baseBuffer = null;
  try {
    baseBuffer = await downloadBaseBuffer(finalImageUrl);
  } catch (fetchErr) {
    console.warn(
      '[direct-mail] generated image fetch failed:',
      fetchErr && fetchErr.message ? fetchErr.message : fetchErr,
    );
    return {
      finalImageUrl: '',
      logoOverlayApplied: false,
      logoSkipReason: 'base_fetch_failed',
      logoOverlayError: fetchErr && fetchErr.message ? fetchErr.message : String(fetchErr),
      fatal: true,
    };
  }

  const wantOverlay = k.useLogoInDesign !== false;
  let logoData = null;
  if (wantOverlay) {
    try {
      logoData = await brandKitLogo.loadLogoBuffer(ws);
    } catch (loadErr) {
      console.warn('[direct-mail] logo load failed:', loadErr && loadErr.message ? loadErr.message : loadErr);
      logoSkipReason = 'logo_load_failed';
      logoOverlayError = loadErr && loadErr.message ? loadErr.message : String(loadErr);
    }
  } else {
    logoSkipReason = 'overlay_disabled';
  }

  const hasLogo = Boolean(logoData && logoData.buffer && logoData.buffer.length);
  if (wantOverlay && !hasLogo && !logoSkipReason) {
    logoSkipReason = 'no_stored_logo';
  }

  if (wantOverlay && hasLogo) {
    try {
      const composited = await applyLogoOverlaySafe(req, baseBuffer, finalImageUrl, logoData);
      finalImageUrl = browserFacingAssetUrl(composited) || composited;
      logoOverlayApplied = true;
      return { finalImageUrl, logoOverlayApplied, logoSkipReason: null, logoOverlayError: null };
    } catch (overlayErr) {
      console.warn(
        '[direct-mail] logo overlay failed:',
        overlayErr && overlayErr.message ? overlayErr.message : overlayErr,
      );
      logoOverlayError = overlayErr && overlayErr.message ? overlayErr.message : String(overlayErr);
      try {
        const composited = await applyLogoOverlaySafe(req, baseBuffer, finalImageUrl, logoData);
        finalImageUrl = browserFacingAssetUrl(composited) || composited;
        logoOverlayApplied = true;
        return { finalImageUrl, logoOverlayApplied, logoSkipReason: null, logoOverlayError: null };
      } catch (retryErr) {
        console.warn(
          '[direct-mail] logo overlay retry failed:',
          retryErr && retryErr.message ? retryErr.message : retryErr,
        );
        logoSkipReason = 'overlay_failed';
        logoOverlayError = retryErr && retryErr.message ? retryErr.message : String(retryErr);
      }
    }
  }

  // Always re-host the KIE tempfile — browsers cannot reliably load temporary CDN URLs.
  try {
    finalImageUrl = await hostGeneratedImageBuffer(req, baseBuffer, 'generated');
  } catch (hostErr) {
    console.warn(
      '[direct-mail] generated image host failed:',
      hostErr && hostErr.message ? hostErr.message : hostErr,
    );
    return {
      finalImageUrl: '',
      logoOverlayApplied: false,
      logoSkipReason: logoSkipReason || 'host_failed',
      logoOverlayError: hostErr && hostErr.message ? hostErr.message : String(hostErr),
      fatal: true,
    };
  }

  return { finalImageUrl, logoOverlayApplied, logoSkipReason, logoOverlayError };
}

function kieHttpError(err, req, fallback) {
  // Prefer the already-friendly message when kieFriendly is set — never return the boolean flag itself.
  const fromKie =
    err && err.kieFriendly && typeof err.message === 'string' && err.message.trim()
      ? err.message.trim()
      : '';
  const friendly =
    fromKie ||
    kieImageClient.friendlyKieImageError(err && err.message, {
      prompt: req.body && req.body.prompt,
      aspectRatio: req.body && req.body.aspectRatio,
      resolution: req.body && req.body.resolution,
    }) ||
    (err && typeof err.message === 'string' && err.message.trim()) ||
    fallback ||
    'Image generation failed.';
  const status = err && err.status === 400 ? 400 : 502;
  return { status, error: String(friendly) };
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

function detectImageKind(buffer) {
  if (!buffer || buffer.length < 12) return null;
  // JPEG
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: 'jpg', contentType: 'image/jpeg' };
  }
  // PNG
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return { ext: 'png', contentType: 'image/png' };
  }
  // GIF
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return { ext: 'gif', contentType: 'image/gif' };
  }
  // WEBP (RIFF....WEBP)
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return { ext: 'webp', contentType: 'image/webp' };
  }
  return null;
}

async function fetchRemoteImageBuffer(imageUrl) {
  const raw = String(imageUrl || '').trim();
  if (!raw) throw new Error('A valid image URL is required.');

  // Prefer local disk for same-origin uploads (avoids BASE_URL / loopback fetch failures).
  let pathname = '';
  try {
    if (/^https?:\/\//i.test(raw)) pathname = new URL(raw).pathname;
    else if (raw.startsWith('/')) pathname = raw.split('?')[0];
  } catch (_) {
    pathname = '';
  }
  if (pathname.startsWith('/uploads/') || pathname.startsWith('/direct-mail/')) {
    const absPath = path.join(process.cwd(), 'public', pathname.replace(/^\/+/, ''));
    const publicRoot = path.join(process.cwd(), 'public');
    const resolved = path.resolve(absPath);
    if (!resolved.startsWith(path.resolve(publicRoot) + path.sep) && resolved !== path.resolve(publicRoot)) {
      throw new Error('Invalid image path.');
    }
    try {
      const buffer = await fs.readFile(resolved);
      if (!buffer || !buffer.length) throw new Error('Image file was empty.');
      const kind = detectImageKind(buffer);
      if (!kind) throw new Error('Saved file is not a valid image.');
      return { buffer, contentType: kind.contentType, ext: kind.ext };
    } catch (e) {
      if (e && (e.message === 'Invalid image path.' || e.message === 'Saved file is not a valid image.')) {
        throw e;
      }
      // Fall through to HTTP fetch if the file is not on this host.
    }
  }

  const url = /^https?:\/\//i.test(raw)
    ? raw
    : raw.startsWith('/')
      ? null
      : '';
  if (!url) {
    // Relative path that wasn't on disk — build absolute from BASE_URL later via caller.
    throw new Error('Could not read that image from disk. Generate again, then download.');
  }
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' },
  });
  if (!res.ok) {
    throw new Error(`Could not fetch image (${res.status}). The link may have expired — generate again.`);
  }
  const headerType = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (headerType && !/^image\//.test(headerType) && headerType !== 'application/octet-stream') {
    throw new Error('Download URL did not return an image (got ' + headerType + '). Generate again, then retry.');
  }
  const ab = await res.arrayBuffer();
  if (!ab || !ab.byteLength) throw new Error('Image download was empty.');
  const buffer = Buffer.from(ab);
  const kind = detectImageKind(buffer);
  if (!kind) {
    const sniff = buffer.slice(0, 40).toString('utf8').replace(/\s+/g, ' ').trim();
    if (/^<!doctype|^<html|^\s*\{/i.test(sniff)) {
      throw new Error('Download returned a web page instead of an image. Generate again, then retry.');
    }
    throw new Error('Downloaded file is not a valid image. Generate again, then retry.');
  }
  return { buffer, contentType: kind.contentType, ext: kind.ext };
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

function resolveBrandKitForClient(ws) {
  const kit = normalizeBrandKit(ws && ws.brandKit);
  if (brandKitLogo.hasStoredLogo(ws)) {
    const stored = brandKitLogo.normalizeStoredLogo(ws.brandKitLogo);
    kit.logoUrl = brandKitLogo.logoDisplayUrl(kit.updatedAt || (stored && stored.updatedAt));
  }
  return kit;
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
    lines.push(
      `Logo: ON — saved in Brand settings; composited unchanged in the ${LOGO_OVERLAY_POSITION.replace('-', ' ')} after the user clicks Generate (do not draw or describe a logo in imagePrompt; leave that corner clear)`,
    );
  } else if (k.logoUrl) {
    lines.push('Logo: uploaded (overlay off — AI may weave business name into the layout; do not add a second logo mark)');
  }
  return lines.length ? lines.join('\n') : '(no business info set yet)';
}

function buildDesignCoachSystemPrompt({
  slot,
  platform,
  aspectRatio,
  headline,
  bodyText,
  ctaUrl,
  brandKit,
  frontImageUrl,
  currentImageUrl,
  frontPrompt,
  matchFrontStyle,
  incrementalEdit,
}) {
  const plat = platformLabel(platform);
  const isPostcard = platform === 'postcard';
  const ratio = aspectRatio || platformAspectRatio(platform, '16:9');
  const formatSpec = String(platformGenerationSpec(platform, slot) || '').trim();
  const lobBackRules =
    isPostcard && slot === 'back'
      ? `For Lob 4×6 postcard BACK (landscape 3:2, 1875×1275px):
- Full-bleed photo background edge to edge — the entire card is one continuous image, not a small inset.
- Lob prints recipient address + postage in the bottom-right ink-free zone (~53% width × 56% height). Do NOT put text, logos, or contact info in that zone — photo background is fine there.
- Keep all marketing copy on the LEFT half, at least 0.3″ from every edge (trim cuts content near edges).
- Do NOT duplicate the FRONT contact footer — no repeated address block, business hours list, or full contact strip like the front.
- Use action-oriented CTAs instead: "Call us" (phone as a bold CTA button/callout), "Scan QR code" (leave a clear square placeholder zone on the left for a future QR — stylized block or empty square with label, NOT in the address zone), and "Visit our website" (URL as a CTA line).
- Phone and website appear as CTA elements, not as a repeated address/hours footer.
- Do NOT draw USPS postage, PRSRT, barcodes, or "Current Resident" — Lob adds these at print time.
- Do NOT use placeholder text like {business} or curly-brace merge tokens in the image.`
      : '';
  const lobFrontRules =
    isPostcard && slot === 'front'
      ? `For Lob 4×6 postcard FRONT (landscape 3:2):
- Full-bleed photo background edge to edge — no white placeholder boxes.
- Keep ALL text and contact info at least 0.3″ from every edge (especially bottom — Lob trims bleed).
- Do not place text in the bottom-right ~1″ where Lob prints the QR code; photo/background may continue there.
- Do NOT use placeholder text like {business} or curly-brace merge tokens in the image.`
      : '';
  const socialFormatRules =
    !isPostcard && formatSpec
      ? `Format requirements for ${plat}:
- ${formatSpec}
- Single-sided creative only (no front/back). Match ${ratio} composition exactly.
- Do NOT describe this as a postcard, Lob mailer, or dual-sided print piece.`
      : '';
  const frontStyleContext =
    slot === 'back' && (frontImageUrl || matchFrontStyle)
      ? `An existing FRONT-side design is already approved${frontImageUrl ? ' (reference image will be passed to GPT Image 2)' : ''}.
${frontPrompt ? `Front design prompt for style context:\n${String(frontPrompt).slice(0, 1200)}\n` : ''}
When the user asks to match the front, coordinate with it, or make a similar design for the back:
- imagePrompt MUST reuse the same color palette, typography style, graphic language, and brand mood as the front — but use a COMPLETELY DIFFERENT layout suited to the back (CTA-focused left half, bullet benefits, QR placeholder).
- Do NOT recreate or lightly vary the front hero composition, headline stack, or contact footer on the back.
- Adapt layout for postcard BACK rules (CTA-focused left half, no contact footer duplication) while keeping visual continuity with the front.
- Do NOT invent a completely different aesthetic (e.g. dark overlay panel vs bright marketing front) unless the user explicitly asks for a new direction.`
      : '';
  return `You are an ad creative design coach for a local marketing agency. The user is designing a ${plat} creative (${ratio} aspect ratio${isPostcard ? `, ${slot} side` : ''}).

Business info (${isPostcard && slot === 'back' ? 'for CTA elements on back — phone and website only; do NOT repeat address/hours footer from front' : 'include in layout when relevant — phone, website, hours, address, logo placement'}):
${brandKitSummary(brandKit)}

Ad copy context:
- Headline: ${headline || '(not set yet)'}
- Body: ${bodyText || '(not set yet)'}
- CTA URL (optional): ${ctaUrl || '(none — omit URL on postcard)'}

Merge tokens ({business}, {city}, {state}, {audit_url}) are applied at SEND time in HTML overlays — never bake them into generated artwork.

${frontStyleContext ? `${frontStyleContext}\n\n` : ''}${lobBackRules}
${lobFrontRules}
${socialFormatRules}

Help the user brainstorm visuals and write a strong image prompt for the selected Marketing Studio format. Images are generated via KIE (GPT Image 2, Grok Imagine, Flux.2, or Nano Banana 2). When logo overlay is enabled (see Business info), the saved brand logo is composited in the top-right after Generate — the image model must leave that corner empty and must not draw any logo, wordmark, or duplicate brand mark.

Logo coaching rules:
- If Business info says "Logo: ON", confirm the user's uploaded logo will appear automatically in the top-right after Generate. Do NOT say you cannot see the logo file or that the logo is missing — you never receive image bytes in chat; the server handles overlay.
- Never instruct the image model to recreate, invent, or approximate the logo in imagePrompt.

${currentImageUrl || incrementalEdit ? `The user already has a design on the canvas${currentImageUrl ? ' (reference will be passed to GPT Image 2)' : ''}.
When they ask to remove, delete, change, move, or tweak something ("remove the seal", "make headline smaller", "drop the badge"):
- imagePrompt MUST be an INCREMENTAL EDIT instruction starting with "INCREMENTAL EDIT — use the attached image as the exact starting design."
- Tell the model to make ONLY that change and preserve everything else unchanged.
- Do NOT rewrite the whole creative from scratch.` : ''}

Respond with JSON only, no markdown. Example shape:
{"reply":"Happy to help.\\n\\n1. Photo or illustration?\\n2. Main colors?\\n3. Headline or hero subject?","imagePrompt":null}

imagePrompt rules:
- Use JSON null (not the string "null") while the brief is still too vague to write a strong production prompt.
- When ready, set imagePrompt to a rich English production prompt for GPT Image 2 — art-directed, specific, and optimized (not a template dump of platform + brief + contact fields).
- A strong imagePrompt names: platform (${plat}), ${ratio} composition, camera/lighting or illustration style, subject matter, color palette, typography treatment, layout zones, and mood. Weave in concrete scene details from the conversation.
- Never paste the user's vague request verbatim as the whole prompt. Translate it into visual direction.
- ${isPostcard && slot === 'back' ? 'For postcard back: CTA layout (Call, Scan QR placeholder, Visit website) — not a duplicated contact footer.' : 'Include business contact details in the design when the user wants them on the ad.'}
- Never copy these instructions, schema text, or the word "null" into imagePrompt. Write the actual visual prompt, or null.

Reply field rules (critical):
- "reply" is marketer-facing chat text only. Use \\n for line breaks so questions appear as a readable list (intro line, blank line, then 1. 2. 3.).
- NEVER put chain-of-thought, planning, "need JSON", "developer role", system instructions, or meta reasoning in "reply".
- Output ONLY the JSON object — no text before or after it.

Workflow (important):
- Your job is to lead the user to a production-ready imagePrompt they can review and edit BEFORE artwork is generated.
- Never tell the user the image is being generated, that you already generated it, or to wait for artwork. Generation happens only when they click Generate after editing the prompt.
- When you set imagePrompt, the reply must say the draft prompt is ready to edit (in Prompt & refine / the prompt editor) and they should tweak it, then click Generate when happy. Invite one small tweak if useful.
- NEVER say you drafted a prompt, locked a look in, or that the prompt is ready unless imagePrompt is a non-null production string in the same JSON object.
- Do not pressure them to click Generate immediately — editing the prompt first is the next step.

Clarify-first rules (critical):
- If the user only names a format + industry/topic (e.g. "facebook cover for home services / flooring / HVAC") with little visual direction, set imagePrompt to null and ask 2–3 short, specific questions in reply (multi-line list). Prioritize: (1) photo vs illustration, (2) color palette or brand colors, (3) main headline/hook or hero subject (who/what is in the shot).
- Ask only what is still missing. Never repeat a clarifying question the user already answered in this conversation.
- Do NOT draft a generic prompt just because they said "make an ad / create a cover / design a banner." Vague make-requests need questions first unless conversation history already has rich direction.
- Once they give enough (colors, photo/illustration, mood, headline/hook, hero subject, layout preference, or similar), set imagePrompt now — write an optimized production prompt from the full conversation + business info. Reply confirms the direction and points them to edit the draft; do not re-ask answered questions.
- If they explicitly say "just draft it", "use your best judgment", "surprise me", or answer enough after your questions, draft immediately with smart creative choices — still specific, never generic filler.
- ${isPostcard && slot === 'back' ? 'Postcard BACK: use action CTAs (Call us with phone, Scan QR placeholder square, Visit website with URL). Do NOT duplicate the front contact footer (address, hours block).' : 'When business info is provided, weave phone, website, hours, and address into the imagePrompt layout.'}
- Optimize for ${plat}: safe margins, readable text at mobile size, professional local-business marketing aesthetic.
- ${isPostcard && slot === 'back' ? 'Postcard back: full-bleed image; CTA blocks on left half only; no text in bottom-right address zone; QR placeholder on left marketing area. Match front style when a front design exists.' : isPostcard ? 'Postcard front: full-bleed photo; full contact footer OK; no text in bottom-right QR zone or near edges.' : `Single-sided ${plat} — follow format requirements above; one strong focal creative at ${ratio}.`}
- Escape double quotes inside strings as \\".`;
}

function augmentIncrementalEditPrompt(prompt) {
  const change = String(prompt || '').trim();
  if (!change) return change;
  if (/^INCREMENTAL EDIT/i.test(change)) return change;
  return (
    'INCREMENTAL EDIT — use the attached image as the exact starting design. ' +
    `Make ONLY this single change and preserve everything else unchanged (layout, colors, typography, photos, contact info, spacing): ${change}. ` +
    'Do not redesign or recompose the whole piece.'
  );
}

function augmentImagePromptWithBrand(prompt, brandKit, platform, slot, { matchFrontStyle, styleReferenceUrl, editMode } = {}) {
  let base = String(prompt || '').trim();
  if (!base) return base;
  if (editMode) base = augmentIncrementalEditPrompt(base);
  const k = normalizeBrandKit(brandKit);
  const plat = platformLabel(platform);
  const isPostcard = String(platform || '').trim() === 'postcard';
  const side = String(slot || 'front').trim();
  const isPostcardBack = isPostcard && side === 'back';
  const extras = [];
  if (k.businessName) extras.push(`Business: ${k.businessName}`);
  if (k.phone) {
    extras.push(
      isPostcardBack ? `Call-us CTA phone: ${k.phone}` : `Phone: ${k.phone}`,
    );
  }
  if (!isPostcardBack && k.email) extras.push(`Email: ${k.email}`);
  if (k.website) {
    extras.push(
      isPostcardBack ? `Visit-website CTA URL: ${k.website}` : `Website: ${k.website}`,
    );
  }
  if (!isPostcardBack && k.address) extras.push(`Address: ${k.address}`);
  if (!isPostcardBack && k.hours) extras.push(`Hours: ${k.hours}`);
  if (k.useLogoInDesign) {
    base =
      'CRITICAL LOGO RULE: Do not draw, render, or approximate any logo, wordmark, monogram, brand icon, company mark, placeholder badge, or white logo box anywhere on the design — not top-center, not center, not top-left, not top-right, not any corner or edge. Leave the top-right corner completely empty — only background photo, no white box, no placeholder, no fake logo. The client\'s real logo file is composited automatically in the top-right after generation. Business name may appear as plain typography in the contact block, never as a logo mark.\n\n' +
      base;
    extras.push(
      'Keep the top-right corner completely empty (background photo only) for the post-generation logo overlay — never draw a fake logo in top-center, center, top-left, or anywhere else',
    );
  } else if (k.logoUrl) {
    extras.push(
      'Logo overlay is off — weave the business name into typography if needed, but do not place a separate logo mark that would conflict with a later overlay',
    );
  }
  let lobSpec = platformGenerationSpec(platform, side);
  if (isPostcard && side === 'back' && (matchFrontStyle || styleReferenceUrl)) {
    lobSpec +=
      ' Use the attached front design reference for color palette, typography, and brand mood ONLY — create a DISTINCT back-side layout (left-half bullets + CTAs), not a duplicate or minor variation of the front hero.';
  }
  const suffix = extras.length
    ? `\n\nPlatform: ${plat}.${lobSpec}${isPostcardBack ? ` CTA elements: ${extras.join('; ')}. Include a clear square QR placeholder zone on the left.` : ` Include on the ad where appropriate: ${extras.join('; ')}.`}`
    : `\n\nPlatform: ${plat}.${lobSpec}`;
  return base + suffix;
}

async function resolveLogoReferenceUrl(req, brandKit) {
  const k = normalizeBrandKit(brandKit);
  if (!k.logoUrl || k.useLogoInDesign !== false) return '';
  try {
    const ws = (await dbService.getWorkspace(req.workspaceId)) || { id: req.workspaceId };
    await brandKitLogo.migrateLegacyLogoIfNeeded(ws);
    const published = await brandKitLogo.publishLogoPublicFile(req, ws);
    if (!published || !published.relativePath) return '';
    return toAbsoluteAssetUrl(req, published.relativePath);
  } catch (err) {
    console.warn(
      '[direct-mail] logo public publish failed:',
      err && err.message ? err.message : err,
    );
    return '';
  }
}

function buildGenerationInputUrls(req, { styleReferenceUrl, referenceUrl, logoReferenceUrl, editMode }) {
  const urls = [];
  const ref = toAbsoluteAssetUrl(req, String(referenceUrl || '').trim());
  const styleRef = toAbsoluteAssetUrl(req, String(styleReferenceUrl || '').trim());
  const logoRef = toAbsoluteAssetUrl(req, String(logoReferenceUrl || '').trim());

  if (editMode && ref) {
    return [ref];
  }

  if (styleRef) urls.push(styleRef);
  else if (ref) urls.push(ref);
  if (logoRef && !urls.includes(logoRef)) urls.push(logoRef);
  return urls;
}

function formatDesignCoachError(ai) {
  if (ai && typeof ai.error === 'string' && ai.error.trim()) return ai.error.trim();
  const provider = ai && ai.provider ? String(ai.provider) : '';
  if (provider === 'timeout') {
    return 'Design coach is taking too long. Try a shorter brief, or use the draft prompt and click Generate.';
  }
  if (provider && provider !== 'none') {
    return `Design coach is unavailable (${provider}). Check AI provider keys on the server and try again.`;
  }
  return 'Design coach is unavailable. Set OPENROUTER_API_KEY, or KIE/Gemini/OpenAI keys on the server.';
}

function withTimeout(promise, ms, label) {
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      resolve({ content: null, provider: 'timeout', timedOut: true, error: true, errorMessage: label || 'Timed out' });
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function runDesignCoachChat(messages) {
  // OpenRouter for chat (same stack as other AI coaches). Images stay on KIE Generate.
  // Cap wait so chat stays snappy, but give free models enough time to return JSON + prompt.
  return withTimeout(
    chatCompletion({
      messages,
      jsonObject: true,
      max_tokens: 1200,
      temperature: 0.4,
      providerChain: 'openrouter',
    }),
    15000,
    'Design coach timed out',
  );
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
    const [integrationEnv, all, wsRaw, folders, tags, driveImport] = await Promise.all([
      workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId),
      dbService.getAllLeads(req.workspaceId),
      dbService.getWorkspace(req.workspaceId),
      dbService.listFolders(req.workspaceId),
      dbService.listTags(req.workspaceId),
      googleDriveAccess.buildDriveImportBundle(req, userEmail(req)),
    ]);
    const ready = lobDirectMail.directMailReady(integrationEnv);
    const ws = wsRaw || { id: req.workspaceId };

    const visible = filterLeadsForRequest(req, all);
    const pipelineVisible = excludeOutreachFolderLeads(visible);
    const selectedKeyOrder = parseBulkSelectionKeys(req.query.keys);
    const selectedOnly = selectedKeyOrder.length > 0;

    const dmQueueMeta = await directMailQueue.listDirectMailQueueLeads(req.workspaceId, visible);
    const queueByKey = new Map(
      (dmQueueMeta && Array.isArray(dmQueueMeta.leads) ? dmQueueMeta.leads : []).map((q) => [q.key, q])
    );

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
    } else if (dmQueueMeta && Array.isArray(dmQueueMeta.leads) && dmQueueMeta.leads.length) {
      dmIsQueueSession = true;
      const byKey = new Map(visible.map((l) => [l.key, l]));
      tableLeads = [];
      for (const q of dmQueueMeta.leads) {
        const lead = byKey.get(q.key);
        if (lead) tableLeads.push(lead);
      }
    } else {
      dmQueueEmpty = true;
      tableLeads = pipelineVisible.filter((l) => lobDirectMail.hasMailableAddress(l)).slice(0, 120);
    }

    const mailableLeads = tableLeads.map((l) => {
      const lob = lobDirectMail.getLeadLobAddressPreview(l);
      const auditUrl = resolveAuditUrl(l);
      const q = queueByKey.get(l.key);
      const addedAt = (q && q.addedAt) || directMailQueue.leadQueuedAt(l) || '';
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
        categoryName: directMailQueue.normalizeCategoryName(l.categoryName),
        addedAt,
        queuedDay: (q && q.queuedDay) || directMailQueue.queuedDayFromTimestamp(addedAt),
      };
    });

    const mailableCount = mailableLeads.filter((l) => l.mailable).length;
    const skippedCount = selectedOnly ? mailableLeads.length - mailableCount : 0;

    const brandKit = resolveBrandKitForClient(ws);

    res.render('direct-mail', {
      activePage: 'direct-mail',
      lobReady: ready,
      kieImageReady: kieImageClient.isConfigured(),
      kieImageModels: kieImageClient.listImageModels(),
      kieDefaultModelKey: kieImageClient.DEFAULT_MODEL_KEY,
      mailableLeads,
      dmSelectionCount: selectedOnly ? selectedKeyOrder.length : null,
      dmIsSelectionSession: selectedOnly,
      dmIsQueueSession,
      dmQueueEmpty,
      dmMailableCount: mailableCount,
      dmSkippedCount: skippedCount,
      recentSends: collectRecentSends(visible, 20),
      canManageWorkspace: !!req.canManageWorkspace,
      brandKit,
      brandKitJson: JSON.stringify(brandKit),
      driveImport,
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
      kieImageModels: kieImageClient.listImageModels(),
      kieDefaultModelKey: kieImageClient.DEFAULT_MODEL_KEY,
      chatReady,
      brandKit: resolveBrandKitForClient(ws),
      platforms: DM_PLATFORMS,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/api/playbooks', async (req, res, next) => {
  try {
    res.json({ success: true, playbooks: listPlaybooks() });
  } catch (err) {
    next(err);
  }
});

router.get('/api/playbooks/suggest', async (req, res, next) => {
  try {
    const leadKey = leadKeyFromParam(req.query.leadKey);
    const context = normalizeContext(req.query.context);
    if (!leadKey) {
      return res.status(400).json({ success: false, error: 'leadKey is required' });
    }
    const lead = await dbService.getLead(leadKey, req.workspaceId);
    if (!lead) {
      return res.status(404).json({ success: false, error: 'Lead not found' });
    }
    const all = await dbService.getAllLeads(req.workspaceId);
    const visible = filterLeadsForRequest(req, all);
    if (!visible.some((l) => String(l.key) === String(leadKey))) {
      return res.status(403).json({ success: false, error: 'Lead not accessible' });
    }
    const result = suggestPlaybookForLead(lead, context);
    res.json({
      success: true,
      context: context || null,
      playbook: result.playbook,
      alternatives: (result.alternatives || []).map(({ id, label, description }) => ({
        id,
        label,
        description,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/api/playbooks/:id', async (req, res, next) => {
  try {
    const playbook = getPlaybookById(req.params.id);
    if (!playbook) {
      return res.status(404).json({ success: false, error: 'Playbook not found' });
    }
    res.json({ success: true, playbook });
  } catch (err) {
    next(err);
  }
});

router.get('/api/brand-kit', async (req, res, next) => {
  try {
    const ws = (await dbService.getWorkspace(req.workspaceId)) || { id: req.workspaceId };
    res.json({ success: true, brandKit: resolveBrandKitForClient(ws) });
  } catch (err) {
    next(err);
  }
});

router.get('/api/brand-kit/logo', async (req, res, next) => {
  try {
    const wid = req.workspaceId;
    let ws = (await dbService.getWorkspace(wid)) || { id: wid };
    const beforeLogo = ws.brandKitLogo;
    ws = await brandKitLogo.migrateLegacyLogoIfNeeded(ws);
    if (ws.brandKitLogo !== beforeLogo) {
      await dbService.saveWorkspace(wid, ws);
    }

    const logoData = await brandKitLogo.loadLogoBuffer(ws);
    if (!logoData || !logoData.buffer) {
      return res.status(404).end();
    }

    res.setHeader('Content-Type', logoData.mimeType || 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.send(logoData.buffer);
  } catch (err) {
    next(err);
  }
});

router.get('/api/creative/:filename', async (req, res, next) => {
  try {
    const filename = path.basename(String(req.params.filename || ''));
    if (!filename || !/\.jpe?g$/i.test(filename)) {
      return res.status(404).end();
    }
    const wid = String(req.workspaceId || 'default')
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '_');
    if (!filename.startsWith(`${wid}_`)) {
      return res.status(404).end();
    }
    const candidates = [
      path.join(getCreativeStorageDir(), filename),
      path.join(process.cwd(), 'public', 'uploads', 'creative', filename),
    ];
    for (const absPath of candidates) {
      try {
        const buf = await fs.readFile(absPath);
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'private, max-age=86400');
        return res.send(buf);
      } catch (err) {
        if (!err || err.code !== 'ENOENT') throw err;
      }
    }
    return res.status(404).end();
  } catch (err) {
    return next(err);
  }
});

async function compositeLogoOnWorkspaceUpload(req, baseBuffer) {
  const ws = await getWorkspaceForBrand(req);
  const logoData = await brandKitLogo.loadLogoBuffer(ws);
  if (!logoData || !logoData.buffer || !logoData.buffer.length) {
    throw new Error('No logo found in Brand settings.');
  }
  return applyLogoOverlaySafe(req, baseBuffer, '', logoData);
}

router.post('/api/composite-with-logo', (req, res, next) => {
  creativeUpload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, error: err.message || 'Upload failed' });
    next();
  });
}, async (req, res, next) => {
  try {
    if (!req.file || !req.file.buffer || !req.file.buffer.length) {
      return res.status(400).json({ success: false, error: 'Generated image file is required.' });
    }
    const composited = await compositeLogoOnWorkspaceUpload(req, req.file.buffer);
    const imageUrl = browserFacingAssetUrl(composited) || composited;
    return res.json({
      success: true,
      imageUrl,
      logoOverlayApplied: true,
    });
  } catch (err) {
    console.warn(
      '[direct-mail] composite-with-logo failed:',
      err && err.message ? err.message : err,
    );
    return res.status(502).json({
      success: false,
      error: (err && err.message) || 'Logo compositing failed.',
    });
  }
});

router.post('/api/apply-logo-overlay', express.json({ limit: '32kb' }), async (req, res, next) => {
  try {
    const imageUrl = String((req.body && req.body.imageUrl) || '').trim();
    if (!imageUrl) {
      return res.status(400).json({ success: false, error: 'imageUrl is required.' });
    }
    const brandKit = await mergeBrandKitForGeneration(req, (req.body && req.body.brandKit) || {});
    const taskId = String((req.body && req.body.taskId) || '').trim();
    const result = await finalizeGeneratedImage(req, imageUrl, brandKit, { taskId: taskId || undefined });
    if (result.fatal || !result.finalImageUrl) {
      return res.status(502).json({
        success: false,
        error:
          'Could not save the generated image for preview. Try Generate again in a moment.',
        logoSkipReason: result.logoSkipReason || null,
        logoOverlayError: result.logoOverlayError || null,
      });
    }
    return res.json({
      success: true,
      imageUrl: result.finalImageUrl,
      logoOverlayApplied: result.logoOverlayApplied,
      logoSkipReason: result.logoSkipReason,
      logoOverlayError: result.logoOverlayError || null,
    });
  } catch (err) {
    return next(err);
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
    res.json({ success: true, brandKit: resolveBrandKitForClient(ws) });
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

    const ws = (await dbService.getWorkspace(req.workspaceId)) || { id: req.workspaceId, members: {} };
    const prev = normalizeBrandKit(ws.brandKit);
    const { brandKitLogo: storedLogo, brandKitPatch } = brandKitLogo.buildLogoWorkspacePatch(prev, {
      buffer: req.file.buffer,
      mimeType: req.file.mimetype || brandKitLogo.mimeFromExt(path.extname(req.file.originalname || '')),
    });
    const nextKit = normalizeBrandKit(brandKitPatch);
    ws.brandKit = nextKit;
    ws.brandKitLogo = storedLogo;
    await dbService.saveWorkspace(req.workspaceId, ws);

    const clientKit = resolveBrandKitForClient(ws);

    res.json({
      success: true,
      logoUrl: clientKit.logoUrl,
      logoAbsoluteUrl: toAbsoluteAssetUrl(req, clientKit.logoUrl),
      brandKit: clientKit,
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
      .map((m) => ({ role: m.role, content: m.content.slice(0, 2200) }));

    const slot = String(body.slot || 'front').toLowerCase() === 'back' ? 'back' : 'front';
    const headline = String(body.headline || '').trim();
    const bodyText = String(body.bodyText || '').trim();
    const ctaUrl = String(body.ctaUrl || '').trim();
    const platform = String(body.platform || 'postcard').trim() || 'postcard';
    const aspectRatio = String(body.aspectRatio || platformAspectRatio(platform, '16:9')).trim() || '16:9';
    const brandKit = await mergeBrandKitForGeneration(req, body.brandKit);
    const frontImageUrl = toAbsoluteAssetUrl(req, String(body.frontImageUrl || '').trim());
    const currentImageUrl = toAbsoluteAssetUrl(req, String(body.currentImageUrl || '').trim());
    const frontPrompt = String(body.frontPrompt || '').trim();
    const matchFrontStyle = body.matchFrontStyle === true;
    const incrementalEdit = body.incrementalEdit === true;

    const DEFAULT_CLARIFY = formatDesignCoachClarifyReply({ platformLabel: platformLabel(platform) });
    const DRAFT_READY =
      'Got it — locking that look in.\n\nI drafted an optimized image prompt from your direction. Edit it in Prompt & refine (or tell me what to change), then click Generate when you are happy with it.';
    const SKIP_CLARIFY =
      /\b(just draft|draft it|best judgment|surprise me|use your (best )?judgment|skip (the )?questions|go ahead and (draft|write)|enough —?\s*draft)\b/i.test(
        userMessage,
      );

    const conversationText = [...history.map((m) => m.content), userMessage].join('\n');
    const richEnough =
      hasRichCreativeDirection(userMessage) ||
      hasRichCreativeDirection(conversationText) ||
      SKIP_CLARIFY;
    const vagueBrief = isVagueDesignBrief(userMessage) && !richEnough;

    const fallbackPromptOpts = {
      userMessage: conversationText.slice(-2200),
      platformLabel: platformLabel(platform),
      aspectRatio,
      headline,
      bodyText,
      brandKitSummary: brandKitSummary(brandKit),
    };

    // First vague make-a-cover message: return a clean multi-line clarify (skip flaky model meta text).
    if (!incrementalEdit && vagueBrief && history.length === 0) {
      return res.json({
        success: true,
        reply: DEFAULT_CLARIFY,
        imagePrompt: null,
        provider: 'local-clarify',
      });
    }

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
          frontImageUrl,
          currentImageUrl,
          frontPrompt,
          matchFrontStyle,
          incrementalEdit,
        }),
      },
      ...history,
      { role: 'user', content: userMessage.slice(0, 2200) },
    ];

    const ai = await runDesignCoachChat(messages);
    if (!ai.content) {
      // Timed out / provider failed: draft only when we already have rich direction; otherwise ask.
      if (!vagueBrief && (richEnough || userAskedForDesign(userMessage))) {
        const imagePrompt = buildFallbackDesignImagePrompt(fallbackPromptOpts);
        if (imagePrompt) {
          return res.json({
            success: true,
            reply: DRAFT_READY,
            imagePrompt,
            provider: ai.timedOut ? 'local-timeout' : 'local-fallback',
          });
        }
      }
      if (vagueBrief || userAskedForDesign(userMessage)) {
        return res.json({
          success: true,
          reply: DEFAULT_CLARIFY,
          imagePrompt: null,
          provider: ai.timedOut ? 'local-timeout-clarify' : 'local-clarify',
        });
      }
      return res.status(502).json({
        success: false,
        error: formatDesignCoachError(ai),
      });
    }

    const parsed = parseLlmJson(ai.content) || {};
    let reply = formatDesignCoachReplyForDisplay(parsed.reply);
    let imagePrompt = sanitizeDesignImagePrompt(
      parsed.imagePrompt != null ? parsed.imagePrompt : parsed.image_prompt,
    );

    // Never show raw model reasoning / failed JSON as the chat message.
    if (!reply) {
      const rawFallback = sanitizeDesignCoachReply(
        String(ai.content || '')
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```$/i, '')
          .trim(),
      );
      reply = formatDesignCoachReplyForDisplay(rawFallback);
    }

    const lastAssistant = [...history].reverse().find((m) => m.role === 'assistant');
    const lastAskedClarify =
      lastAssistant &&
      /photo or illustration|brand (colors|palette)|headline\/hook|quick questions so i can write|a few quick questions|tell me more about the look|main hook|just draft it|who or what should be the hero|photo, illustration, or mixed/i.test(
        String(lastAssistant.content || ''),
      );
    const userAnsweredClarify =
      lastAskedClarify &&
      (richEnough ||
        hasRichCreativeDirection(userMessage) ||
        userMessage.length >= 20 ||
        SKIP_CLARIFY);

    // Only force a local draft when the model failed to produce one AND we have enough direction
    // (or the user just answered clarifying questions / asked to skip). Never dump a template on a vague brief.
    const shouldDraftPrompt =
      !imagePrompt && !vagueBrief && (richEnough || userAnsweredClarify || SKIP_CLARIFY);

    if (shouldDraftPrompt) {
      if (!reply || /null if still exploring|null or a detailed english prompt|ready for gpt image/i.test(reply)) {
        reply = DRAFT_READY;
      }
      imagePrompt = buildFallbackDesignImagePrompt(fallbackPromptOpts);
    }

    // Model drafted on a vague brief — strip it and ask instead (unless they skipped questions).
    if (imagePrompt && vagueBrief && !SKIP_CLARIFY && !userAnsweredClarify) {
      imagePrompt = '';
      if (!reply || replyClaimsDraftReady(reply)) {
        reply = DEFAULT_CLARIFY;
      }
    }

    // Invariant: never claim a draft is ready without a usable imagePrompt.
    if (!imagePrompt && (replyClaimsDraftReady(reply) || shouldDraftPrompt || userAnsweredClarify || SKIP_CLARIFY)) {
      imagePrompt = buildFallbackDesignImagePrompt(fallbackPromptOpts);
      if (imagePrompt && (!reply || replyClaimsDraftReady(reply))) {
        reply = DRAFT_READY;
      }
    }
    if (replyClaimsDraftReady(reply) && !imagePrompt) {
      reply = DEFAULT_CLARIFY;
    }
    if (imagePrompt && (!reply || /null if still exploring|null or a detailed english prompt/i.test(reply))) {
      reply = DRAFT_READY;
    }

    if (!reply) reply = imagePrompt ? DRAFT_READY : DEFAULT_CLARIFY;
    reply = formatDesignCoachReplyForDisplay(reply) || reply;

    res.json({
      success: true,
      reply,
      imagePrompt: imagePrompt || null,
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

    const modelKey = String(body.modelKey || kieImageClient.DEFAULT_MODEL_KEY).trim();
    const modelMeta = kieImageClient.getImageModel(modelKey);
    const platform = String(body.platform || 'postcard').trim() || 'postcard';
    const slot = String(body.slot || 'front').toLowerCase() === 'back' ? 'back' : 'front';
    const brandKit = await mergeBrandKitForGeneration(req, body.brandKit);
    const editMode = body.editMode === true;
    const matchFrontStyle = !editMode && body.matchFrontStyle === true;
    const styleReferenceUrl = editMode
      ? ''
      : toAbsoluteAssetUrl(req, String(body.styleReferenceUrl || '').trim());
    const referenceAbs = body.referenceUrl
      ? toAbsoluteAssetUrl(req, String(body.referenceUrl).trim())
      : '';
    prompt = augmentImagePromptWithBrand(prompt, brandKit, platform, slot, {
      matchFrontStyle: matchFrontStyle || (slot === 'back' && !!styleReferenceUrl),
      styleReferenceUrl: styleReferenceUrl || (editMode ? '' : referenceAbs),
      editMode,
    });

    if (kieImageClient.isVagueImagePrompt(prompt, { editMode })) {
      return res.status(400).json({
        success: false,
        error: kieImageClient.friendlyKieImageError('', {
          prompt,
          editMode,
          modelKey: modelMeta.key,
        }),
      });
    }

    const aspectRatio =
      String(body.aspectRatio || platformAspectRatio(platform, '16:9')).trim() || '16:9';
    const resolution = String(body.resolution || '2K').trim() || '2K';
    const logoReferenceUrl = editMode ? '' : await resolveLogoReferenceUrl(req, brandKit);
    const inputUrls = buildGenerationInputUrls(req, {
      referenceUrl: referenceAbs,
      styleReferenceUrl,
      logoReferenceUrl,
      editMode,
    });

    const createOpts = {
      prompt,
      inputUrls,
      aspectRatio,
      resolution,
      modelKey: modelMeta.key,
      editMode,
    };

    let created;
    try {
      created = await kieImageClient.createTask(createOpts);
    } catch (firstErr) {
      const styleOnly = inputUrls.filter((u) => u !== logoReferenceUrl);
      if (styleOnly.length && styleOnly.length < inputUrls.length) {
        created = await kieImageClient.createTask({ ...createOpts, inputUrls: styleOnly });
      } else if (styleOnly.length && !editMode) {
        created = await kieImageClient.createTask({
          ...createOpts,
          inputUrls: [],
          editMode: false,
        });
      } else {
        throw firstErr;
      }
    }

    rememberImageJob(created.taskId, {
      slot,
      brandKit,
      model: created.model,
      modelKey: created.modelKey || modelMeta.key,
      modelLabel: created.modelLabel || modelMeta.label,
      prompt,
      workspaceId: req.workspaceId,
    });

    res.json({
      success: true,
      status: 'processing',
      slot,
      taskId: created.taskId,
      model: created.model,
      modelKey: created.modelKey || modelMeta.key,
      modelLabel: created.modelLabel || modelMeta.label,
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

    let job = getImageJob(taskId);
    if (job && job.workspaceId && job.workspaceId !== req.workspaceId) {
      return res.status(404).json({ success: false, error: 'Image job not found or expired.' });
    }
    // Survive Render redeploys / multi-instance: still poll KIE when the in-memory job map was wiped.
    if (!job) {
      job = {
        slot: String(req.query.slot || 'front').toLowerCase() === 'back' ? 'back' : 'front',
        brandKit: {},
        model: '',
        prompt: '',
        workspaceId: req.workspaceId,
        recovered: true,
      };
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
      const brandKit = await mergeBrandKitForGeneration(req, job.brandKit || {});
      const { finalImageUrl, logoOverlayApplied, logoSkipReason, logoOverlayError, fatal } =
        await finalizeGeneratedImage(req, urls[0], brandKit, { taskId });
      forgetImageJob(taskId);
      if (fatal || !finalImageUrl) {
        return res.status(502).json({
          success: false,
          status: 'failed',
          error:
            'Image was generated but could not be saved for preview. Click Generate again in a moment.',
          logoSkipReason: logoSkipReason || null,
          logoOverlayError: logoOverlayError || null,
        });
      }
      return res.json({
        success: true,
        status: 'success',
        slot: job.slot,
        taskId,
        model: job.model,
        imageUrl: finalImageUrl,
        urls,
        logoOverlayApplied,
        logoSkipReason,
        logoOverlayError: logoOverlayError || null,
      });
    }

    if (state === 'fail') {
      forgetImageJob(taskId);
      const msg = data.failMsg || data.failCode || 'Image generation failed.';
      const friendly = kieImageClient.friendlyKieImageError(String(msg), {
        prompt: job.prompt,
        aspectRatio: req.query.aspectRatio,
        resolution: req.query.resolution,
      });
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
          lastTouchChannel: 'direct_mail',
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
        const queuedNote = [
          `Lob postcard queued${sent.postcardId ? ` (${sent.postcardId})` : ''}${sent.testMode ? ' [test]' : ''}`,
          sent.qrRedirectUrl ? `QR: ${sent.qrRedirectUrl}` : '',
        ]
          .filter(Boolean)
          .join('\n');
        ghlProspectSync.triggerGhlProspectSync(fullKey, req.workspaceId, {
          trigger: 'postcard_queued',
          note: queuedNote,
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

router.post('/api/google-drive/import-image', express.json({ limit: '32kb' }), async (req, res, next) => {
  try {
    const email = userEmail(req);
    const access = email ? await googleDriveAccess.getValidAccessToken(email) : null;
    if (!access) {
      return res.status(401).json({
        success: false,
        error: 'Connect Google Drive first (Pipeline → Import, or link below).',
        code: 'DRIVE_NOT_CONNECTED',
      });
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const fileId = String(body.fileId || '').trim();
    if (!fileId) {
      return res.status(400).json({ success: false, error: 'fileId is required.' });
    }
    const target = String(body.target || 'creative').toLowerCase() === 'logo' ? 'logo' : 'creative';
    const slot = String(body.slot || 'front').toLowerCase() === 'back' ? 'back' : 'front';

    const downloaded = await downloadDriveFileAsImageBuffer(access, fileId);
    if (!downloaded.buffer || !downloaded.buffer.length) {
      return res.status(502).json({ success: false, error: 'Downloaded image was empty.' });
    }

    if (target === 'logo') {
      const ws = (await dbService.getWorkspace(req.workspaceId)) || { id: req.workspaceId, members: {} };
      const prev = normalizeBrandKit(ws.brandKit);
      const { brandKitLogo: storedLogo, brandKitPatch } = brandKitLogo.buildLogoWorkspacePatch(prev, {
        buffer: downloaded.buffer,
        mimeType: downloaded.mimeType || 'image/png',
      });
      ws.brandKit = normalizeBrandKit(brandKitPatch);
      ws.brandKitLogo = storedLogo;
      await dbService.saveWorkspace(req.workspaceId, ws);
      const clientKit = resolveBrandKitForClient(ws);
      return res.json({
        success: true,
        target: 'logo',
        logoUrl: clientKit.logoUrl,
        brandKit: clientKit,
      });
    }

    const wid = String(req.workspaceId || 'default')
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '_');
    const extFromName = path.extname(String(downloaded.name || '')).toLowerCase();
    const ext =
      extFromName && ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(extFromName)
        ? extFromName
        : /\.png/i.test(String(downloaded.mimeType || ''))
          ? '.png'
          : /\.gif/i.test(String(downloaded.mimeType || ''))
            ? '.gif'
            : /\.webp/i.test(String(downloaded.mimeType || ''))
              ? '.webp'
              : '.jpg';
    const relDir = path.join('public', 'uploads', 'creative');
    const absDir = path.join(process.cwd(), relDir);
    await fs.mkdir(absDir, { recursive: true });
    const filename = `${wid}_drive_${Date.now()}${ext}`;
    await fs.writeFile(path.join(absDir, filename), downloaded.buffer);
    const publicUrl = `/uploads/creative/${filename}`;

    return res.json({
      success: true,
      target: 'creative',
      slot,
      imageUrl: publicUrl,
      imageAbsoluteUrl: toAbsoluteAssetUrl(req, publicUrl),
      fileName: downloaded.name || filename,
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/api/download-image', express.json(), async (req, res) => {
  try {
    const body = req.body || {};
    const imageUrl = toAbsoluteAssetUrl(req, body.imageUrl) || String(body.imageUrl || '').trim();
    const { buffer, contentType, ext } = await fetchRemoteImageBuffer(imageUrl);
    const fileName = marketingDesignFileName(body.platform, body.slot, ext);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  } catch (err) {
    const message = (err && err.message) || 'Download failed.';
    res.status(400).json({ success: false, error: message });
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
