/**
 * Phase 2–4 sales methodology: full pipeline (outreach sub-stages + close) + static script library.
 */

const PIPELINE_STAGES = [
  {
    id: 1,
    slug: 'new',
    name: 'New',
    summary: 'Scraped, imported, or triage — not yet in active outreach.',
  },
  {
    id: 2,
    slug: 'contacted',
    name: 'Contacted',
    summary: 'First touch or sequence started (email, LI, DM).',
  },
  {
    id: 3,
    slug: 'engaged_booked',
    name: 'Engaged / Booked',
    summary: 'Reply, positive signal, or call booked — pre-CQI.',
  },
  {
    id: 4,
    slug: 'cqi',
    name: 'CQI (Discovery)',
    summary: 'Client Qualification Interview: revenue, spend, pain, decision process.',
  },
  {
    id: 5,
    slug: 'trial_close',
    name: 'Trial close (≈$297)',
    summary: 'Low-friction foot-in-the-door offer; risk-reversal before retainer.',
  },
  {
    id: 6,
    slug: 'trial_onboarding',
    name: 'Trial onboarding',
    summary: 'Deliver first small win; set expectations and timeline.',
  },
  {
    id: 7,
    slug: 'retainer_close',
    name: 'Retainer close',
    summary: 'Move to monthly retainer ($1k–$3k+); anchor to ROI.',
  },
  {
    id: 8,
    slug: 'retainer_onboarding',
    name: 'Retainer onboarding',
    summary: 'Tracking, assets, access, weekly rhythm — full integration.',
  },
  {
    id: 9,
    slug: 'upsell',
    name: 'Upsell',
    summary: 'Value ladder: voice AI, agents, ads, advanced funnels.',
  },
  {
    id: 10,
    slug: 'referral_loop',
    name: 'Referral loop',
    summary: 'Systematic referral asks, case studies, and compounding growth.',
  },
];

const SCRIPT_LIBRARY = {
  reputation: {
    tabLabel: 'Reputation',
    label: 'Reputation Management',
    opening:
      "Hi {{name}}, I noticed your Google profile in {{city}} — you're clearly busy serving customers. Quick question: are you actively driving new reviews each month, or is it mostly organic?",
    discovery:
      'What happens today when someone leaves a critical review? Who responds, and how fast? How much of your new business comes from maps vs word of mouth?',
    valueProp:
      'We help local operators protect revenue with a review request rhythm, AI-assisted responses, and a simple dashboard so nothing slips — without adding headcount.',
    close:
      "I'd suggest we start with a small pilot: we turn on requests + response playbooks for 30 days. If you don't see cleaner sentiment and more reviews, we part friends. Fair?",
  },
  aiWebsites: {
    tabLabel: 'AI websites',
    label: 'AI Website / Conversion',
    opening:
      "Hi {{name}}, I was looking at how {{company}} shows up online in {{city}}. Curious — is your site mostly a brochure, or is it built to convert calls and form fills every week?",
    discovery:
      'How do leads find you today — maps, paid, referrals? What does a qualified job look like, and what do you wish the site did automatically?',
    valueProp:
      'We rebuild the buyer journey with fast pages, clear CTAs, and optional AI chat so you capture demand you already pay for — then we measure calls and forms.',
    close:
      "We can pre-build a focused landing experience for your top service and connect tracking. Low four figures to prove lift before we talk full site. Want to see a wireframe this week?",
  },
  aiAutomation: {
    tabLabel: 'AI automation',
    label: 'AI Automation & Workflows',
    opening:
      "Hi {{name}}, quick one — at {{company}}, how much of your week still goes to manual follow-ups, scheduling, or copying the same info between tools? I'm asking because we're seeing {{city}} operators claw back 5–10 hours a week with light AI workflows.",
    discovery:
      'What are the top 3 repetitive tasks your team does every week? Where do leads or jobs fall through the cracks today — CRM, inbox, or after-hours?',
    valueProp:
      'We design small, reliable automations: AI-assisted replies, booking flows, CRM updates, and handoffs to humans when it matters — so you scale output without hiring another coordinator.',
    close:
      "I'd start with a 2-week workflow audit plus one pilot automation tied to revenue (e.g. missed-call text-back or quote follow-up). If it doesn't save real time, we stop. Open to a 20-minute scoping call?",
  },
  socialMedia: {
    tabLabel: 'Social media',
    label: 'Social Media Management',
    opening:
      "Hi {{name}}, I've been following how {{company}} shows up in {{city}} — your reviews and footprint are solid. Curious: is social something you want to own in-house, or is consistent posting/replies something you'd rather offload?",
    discovery:
      'Which platforms actually drive leads for you today? Who posts now, and how often? Any campaigns or offers you wish more people saw locally?',
    valueProp:
      'We run a simple rhythm: content calendar, short-form creative, community replies, and monthly reporting tied to calls and DMs — not vanity metrics — so you stay visible without living in the apps.',
    close:
      "We could run a 30-day pilot on one channel with a clear CTA (book / call / offer). You'll see the calendar and approvals before anything goes live. Want me to send two sample post themes for your niche?",
  },
  adManagement: {
    tabLabel: 'Ad management',
    label: 'Paid Ads Management',
    opening:
      "Hi {{name}}, I was looking at how {{company}} competes for leads in {{city}}. Are you running Meta or Google ads today, or is most of your pipeline organic and referrals?",
    discovery:
      'Rough monthly ad spend? Who manages it — agency, freelancer, or in-house? What does a profitable lead or job look like in dollar terms?',
    valueProp:
      'We tighten tracking, creative testing, and weekly optimization so spend maps to booked work — not just clicks. You get plain-English reporting and a single owner accountable to CPA or cost per booked call.',
    close:
      "I'd suggest a 14-day account review plus one new creative angle and conversion event fix. If we don't see a credible path to efficiency, we part friends. Worth a quick look at the account together?",
  },
};

/** Ordered keys for personas / scripting tabs (insights catalog uses all SCRIPT_LIBRARY keys). */
const SCRIPT_LIBRARY_KEYS = Object.keys(SCRIPT_LIBRARY);

const PERSONAS = [
  {
    id: 'paul',
    name: 'Paul',
    role: 'The Prospector',
    color: 'from-amber-400 to-orange-500',
    duties: ['Cold email & DM sequences', 'Lead scraping & filters', 'List hygiene & follow-up cadence'],
    href: '/',
    hrefLabel: 'Open Search',
  },
  {
    id: 'clay',
    name: 'Clay',
    role: 'The Closer',
    color: 'from-violet-500 to-purple-600',
    duties: ['Call scripts & rebuttals', 'Trial and retainer positioning', 'Objection handling'],
    href: '/sales/workflow',
    hrefLabel: 'Pipeline & CQI',
  },
  {
    id: 'bob',
    name: 'Bob',
    role: 'The Builder',
    color: 'from-emerald-400 to-teal-600',
    duties: ['Site and funnel drafts', 'Chatbot logic & handoff', 'Technical fulfillment notes'],
    href: '/prospecting?tab=pipeline',
    hrefLabel: 'Leads',
  },
];

module.exports = {
  PIPELINE_STAGES,
  SCRIPT_LIBRARY,
  SCRIPT_LIBRARY_KEYS,
  PERSONAS,
};
