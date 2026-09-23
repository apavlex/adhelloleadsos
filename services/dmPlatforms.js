/**
 * Marketing Studio format presets — shared by API and UI.
 * Keep ids stable; they are stored on saved designs and passed to image generation.
 */

const DM_PLATFORMS = {
  postcard: {
    label: '4×6 Postcard',
    aspectRatio: '3:2',
    dualSided: true,
    hint: 'Lob 4×6 postcard: landscape 3:2 full-bleed. Keep text 0.3″ from edges.',
  },
  instagram_feed: {
    label: 'Instagram Feed',
    aspectRatio: '1:1',
    dualSided: false,
    hint: 'Instagram feed square 1:1. Strong focal image, short readable headline, mobile-first.',
  },
  instagram_story: {
    label: 'Instagram Story / Reels',
    aspectRatio: '9:16',
    dualSided: false,
    hint: 'Instagram Story / Reels 9:16 vertical. Keep key text in the safe center; avoid top and bottom UI zones.',
  },
  instagram_portrait: {
    label: 'Instagram Portrait',
    aspectRatio: '4:5',
    dualSided: false,
    hint: 'Instagram portrait 4:5. Tall crop, bold type, one clear offer.',
  },
  facebook_feed: {
    label: 'Facebook Feed',
    aspectRatio: '1:1',
    dualSided: false,
    hint: 'Facebook feed square 1:1. Scroll-stopping photo, short headline, clear CTA.',
  },
  facebook_cover: {
    label: 'Facebook Cover',
    aspectRatio: '16:9',
    dualSided: false,
    hint: 'Facebook Cover / page banner 16:9 wide. Wide hero composition; keep important text away from profile-photo overlap on the left.',
  },
  facebook_story: {
    label: 'Facebook Story',
    aspectRatio: '9:16',
    dualSided: false,
    hint: 'Facebook Story 9:16 vertical. Full-bleed vertical creative with safe margins for stickers/UI.',
  },
  linkedin_post: {
    label: 'LinkedIn Post',
    aspectRatio: '1:1',
    dualSided: false,
    hint: 'LinkedIn post square 1:1. Professional tone, clean typography, business-appropriate imagery.',
  },
  linkedin_banner: {
    label: 'LinkedIn Banner',
    aspectRatio: '16:9',
    dualSided: false,
    hint: 'LinkedIn profile/company banner 16:9 wide. Wide brand panel; leave space for profile photo overlap on the left.',
  },
  google_display: {
    label: 'Google Display',
    aspectRatio: '16:9',
    dualSided: false,
    hint: 'Google Display landscape 16:9. Bold offer, high contrast, minimal text for ad thumbnail clarity.',
  },
  google_business_post: {
    label: 'Google Business Post',
    aspectRatio: '4:3',
    dualSided: false,
    hint: 'Google Business Profile post 4:3 (1200×900). One hero photo, bold headline, minimal on-image text — caption is added in Google separately. No QR codes or dense contact footers.',
  },
  youtube_thumb: {
    label: 'YouTube Thumbnail',
    aspectRatio: '16:9',
    dualSided: false,
    hint: 'YouTube thumbnail 16:9. Large faces or product, huge readable title text, high contrast for small sizes.',
  },
  custom: {
    label: 'Custom ratio',
    aspectRatio: null,
    dualSided: false,
    hint: 'Custom marketing creative. Follow the selected aspect ratio; sharp hierarchy and mobile-readable text.',
  },
};

const PLATFORM_IDS = Object.keys(DM_PLATFORMS);

function getPlatform(key) {
  const id = String(key || '').trim();
  return DM_PLATFORMS[id] || DM_PLATFORMS.custom;
}

function platformLabel(key) {
  return getPlatform(key).label || 'Custom';
}

function platformAspectRatio(key, fallback) {
  const row = getPlatform(key);
  if (row.aspectRatio) return row.aspectRatio;
  return String(fallback || '16:9').trim() || '16:9';
}

function platformGenerationSpec(platform, slot) {
  const key = String(platform || '').trim();
  const side = String(slot || 'front').trim();
  if (key === 'postcard' && side === 'back') {
    return (
      ' Lob 4×6 postcard BACK: landscape 3:2 full-bleed. CTA-focused left half only (Call us, Scan QR placeholder square, Visit website) — do NOT duplicate front contact footer (no address/hours block). 0.3″ from edges. No text in bottom-right address zone (photo OK). Never render {business} or placeholder tokens.'
    );
  }
  if (key === 'postcard') {
    return (
      ' Lob 4×6 postcard FRONT: landscape 3:2 full-bleed photo. No text within 0.3″ of edges or in bottom-right QR zone (photo OK, no white box). Never render {business} or placeholder tokens. Never draw a company logo or wordmark — real logo is added top-right after generation when enabled.'
    );
  }
  const hint = getPlatform(key).hint || DM_PLATFORMS.custom.hint;
  return ` ${hint}`;
}

module.exports = {
  DM_PLATFORMS,
  PLATFORM_IDS,
  getPlatform,
  platformLabel,
  platformAspectRatio,
  platformGenerationSpec,
};
