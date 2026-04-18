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
};

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
    href: '/leads',
    hrefLabel: 'Leads',
  },
];

module.exports = {
  PIPELINE_STAGES,
  SCRIPT_LIBRARY,
  PERSONAS,
};
