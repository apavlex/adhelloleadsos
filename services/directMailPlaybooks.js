/**
 * Direct mail playbooks — category + context templates for copy and image prompts.
 */

const PLAYBOOK_CONTEXTS = ['after_call', 'after_email', 'after_voicemail', 'warm', 'nurture'];

const MAIL_PLAYBOOKS = [
  {
    id: 'local_audit_general',
    label: 'Local audit — general',
    description: 'Free GBP/website audit hook for any local business after a touch.',
    contexts: ['after_call', 'after_email', 'warm', 'nurture'],
    categoryPatterns: [],
    headline: '{business} — your local visibility audit is ready',
    body: 'We put together a quick snapshot of how {business} shows up in {city} vs nearby competitors. Scan the QR for your free audit — no pitch on the card.',
    ctaUrl: '{audit_url}',
    imagePromptFront:
      'Professional 4×6 postcard front for a local marketing agency. Warm photo of a thriving small business storefront in {city}. Bold headline area top-left: local growth / get found online. Modern navy and gold palette. Leave top-right corner empty for logo overlay. No placeholder text in curly braces.',
    imagePromptBack:
      'Matching postcard back design. Left side: short bullet list — Google Maps, reviews, website speed. Right side: minimal CTA "Scan to see your score". Same navy and gold brand colors as front. No address block text.',
    personalizeOverlay: true,
  },
  {
    id: 'hvac_audit',
    label: 'HVAC — audit follow-up',
    description: 'After a call or email to HVAC / heating / cooling pros.',
    contexts: ['after_call', 'after_email', 'after_voicemail'],
    categoryPatterns: [/hvac|heating|cooling|furnace|air.?condition/i],
    headline: 'More service calls for {business}',
    body: 'Hi from AdHello — we mapped how homeowners find HVAC companies in {city}. Your audit shows quick wins for Maps and reviews. Scan the QR to view yours.',
    ctaUrl: '{audit_url}',
    imagePromptFront:
      'Postcard front for HVAC company marketing. Hero image: technician at residential AC unit, golden hour. Headline zone: more calls from Google Maps. Blue and orange trade colors, trustworthy local service vibe. Top-right empty for logo.',
    imagePromptBack:
      'HVAC postcard back matching front palette. Icons for reviews, map pack, seasonal tune-up reminders. CTA: scan for free visibility audit.',
    personalizeOverlay: true,
  },
  {
    id: 'plumbing_audit',
    label: 'Plumbing — audit follow-up',
    description: 'Plumbers and drain specialists after phone or email touch.',
    contexts: ['after_call', 'after_email', 'after_voicemail'],
    categoryPatterns: [/plumb|drain|sewer|rooter|pipe/i],
    headline: '{business} — homeowners are searching in {city}',
    body: 'We analyzed local plumbing searches in {city}. Your card includes a personalized audit link — scan the QR to see where you rank and what to fix first.',
    ctaUrl: '{audit_url}',
    imagePromptFront:
      'Plumbing services postcard front. Clean modern van or plumber with wrench, suburban home background. Strong headline area about emergency and scheduled calls from Google. Blue white professional palette.',
    imagePromptBack:
      'Plumbing postcard back with checklist: 24/7 click-to-call, reviews, service area map. Match front colors.',
    personalizeOverlay: true,
  },
  {
    id: 'roofing_storm',
    label: 'Roofing — inspection offer',
    description: 'Roofers after conversation or email — inspection / estimate angle.',
    contexts: ['after_call', 'after_email', 'warm'],
    categoryPatterns: [/roof|shingle|gutter|siding/i],
    headline: 'Free roof visibility check — {business}',
    body: 'Storms and search both drive roof leads in {city}. We built a short report for {business} on how you appear when homeowners compare options online.',
    ctaUrl: '{audit_url}',
    imagePromptFront:
      'Roofing company postcard. Dramatic but trustworthy photo of roof inspection on suburban home. Bold headline about trusted local roofer. Gray, slate, accent red.',
    imagePromptBack:
      'Roofing postcard back: insurance-ready, licensed & insured, before/after thumbnails. QR CTA area bottom-right clear.',
    personalizeOverlay: true,
  },
  {
    id: 'dental_new_patient',
    label: 'Dental — new patient hook',
    description: 'Dental / orthodontics practices after warm conversation.',
    contexts: ['after_call', 'after_email', 'warm'],
    categoryPatterns: [/dental|dentist|ortho|smile|oral/i],
    headline: 'New patients start online — {business}',
    body: 'Families in {city} compare dentists on Google before they call. Your personalized audit shows how {business} looks next to nearby practices.',
    ctaUrl: '{audit_url}',
    imagePromptFront:
      'Dental practice marketing postcard. Bright, friendly smile / modern reception. Soft teal and white palette. Headline about new patient growth from local search.',
    imagePromptBack:
      'Dental postcard back: services list, online booking, reviews stars. Calm professional design matching front.',
    personalizeOverlay: true,
  },
  {
    id: 'new_formation_welcome',
    label: 'New business — welcome kit',
    description: 'Fresh LLC/corp formations — website + Maps setup offer.',
    contexts: ['after_call', 'after_email', 'nurture'],
    categoryPatterns: [/formation|new.?business|llc|startup/i],
    jobTypes: ['business_formations'],
    headline: 'Welcome, {business}!',
    body: 'Congrats on the new company in {city}. Most new owners lose their first customers to bad Google listings. Scan for a free launch checklist and site preview.',
    ctaUrl: '{audit_url}',
    imagePromptFront:
      'Celebratory small business launch postcard. Minimal modern design, confetti subtle, storefront ribbon cutting mood. Headline: welcome new business. Green and navy optimistic palette.',
    imagePromptBack:
      'Launch checklist back: Google Business Profile, simple website, first 5 reviews. Friendly startup tone.',
    personalizeOverlay: true,
  },
  {
    id: 'no_answer_bump',
    label: 'No answer — soft bump',
    description: 'They did not pick up — light physical touch without pressure.',
    contexts: ['after_voicemail', 'nurture'],
    categoryPatterns: [],
    dispositions: ['no_answer', 'voicemail', 'no_pickup'],
    headline: 'Quick note for {business}',
    body: 'We tried reaching you about local lead flow in {city}. No need to call back — scan the QR if you want the free audit we mentioned. Either way, cheers on the great work.',
    ctaUrl: '{audit_url}',
    imagePromptFront:
      'Friendly understated postcard. Local business streetscape in {city}. Soft headline, not salesy. Neutral warm palette, plenty of whitespace.',
    imagePromptBack:
      'Simple back with single QR CTA and one line: free local visibility snapshot.',
    personalizeOverlay: true,
  },
  {
    id: 'connected_thanks',
    label: 'After good call — thank you',
    description: 'Send after a positive conversation to reinforce next step.',
    contexts: ['after_call', 'warm'],
    categoryPatterns: [],
    dispositions: ['connected', 'interested', 'meeting_set', 'callback'],
    headline: 'Great speaking with you, {business}',
    body: 'As discussed, here is your {city} market snapshot link. Scan the QR anytime — we will follow up on the items you cared about.',
    ctaUrl: '{audit_url}',
    imagePromptFront:
      'Professional thank-you postcard design. Handshake or team collaboration photo. Warm trustworthy brand colors. Headline: thanks for your time.',
    imagePromptBack:
      'Back with recap bullets and QR to audit URL. Clean corporate-friendly layout.',
    personalizeOverlay: true,
  },
];

function normalizeContext(raw) {
  const v = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
  if (PLAYBOOK_CONTEXTS.includes(v)) return v;
  if (v === 'voicemail' || v === 'no_answer') return 'after_voicemail';
  if (v === 'email') return 'after_email';
  if (v === 'call') return 'after_call';
  return '';
}

function leadSearchBlob(lead) {
  const l = lead && typeof lead === 'object' ? lead : {};
  return [
    l.title,
    l.company,
    l.categoryName,
    l.keyword,
    l.tradeSlug,
    l.jobType,
    l.source,
    l.notes,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function scorePlaybook(playbook, lead, context) {
  let score = 0;
  const blob = leadSearchBlob(lead);
  const ctx = normalizeContext(context);
  const disposition = String(lead?.lastDisposition || lead?.disposition || '')
    .trim()
    .toLowerCase();

  if (ctx && Array.isArray(playbook.contexts) && playbook.contexts.includes(ctx)) {
    score += 8;
  }

  if (disposition && Array.isArray(playbook.dispositions)) {
    if (playbook.dispositions.some((d) => disposition.includes(String(d).toLowerCase()))) {
      score += 12;
    }
  }

  if (Array.isArray(playbook.jobTypes) && playbook.jobTypes.length) {
    const jt = String(lead?.jobType || '').trim();
    if (playbook.jobTypes.includes(jt)) score += 15;
  }

  for (const pat of playbook.categoryPatterns || []) {
    if (pat instanceof RegExp && pat.test(blob)) {
      score += 10;
      break;
    }
  }

  if (!(playbook.categoryPatterns || []).length && !(playbook.jobTypes || []).length) {
    score += 1;
  }

  return score;
}

function suggestPlaybookForLead(lead, context) {
  const ranked = MAIL_PLAYBOOKS.map((pb) => ({
    ...pb,
    score: scorePlaybook(pb, lead, context),
  }))
    .filter((pb) => pb.score > 0)
    .sort((a, b) => b.score - a.score);

  const best = ranked[0] || MAIL_PLAYBOOKS.find((p) => p.id === 'local_audit_general') || MAIL_PLAYBOOKS[0];
  return {
    playbook: best,
    alternatives: ranked.slice(1, 4),
  };
}

function getPlaybookById(id) {
  return MAIL_PLAYBOOKS.find((p) => String(p.id) === String(id || '').trim()) || null;
}

function listPlaybooks() {
  return MAIL_PLAYBOOKS.map(({ id, label, description, contexts }) => ({
    id,
    label,
    description,
    contexts,
  }));
}

module.exports = {
  PLAYBOOK_CONTEXTS,
  MAIL_PLAYBOOKS,
  normalizeContext,
  suggestPlaybookForLead,
  getPlaybookById,
  listPlaybooks,
  scorePlaybook,
};
