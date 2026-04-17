/**
 * Phase 2–4 sales methodology: pipeline stages + static script library (Personas / dynamic scripting MVP).
 */

const PIPELINE_STAGES = [
  {
    id: 1,
    slug: 'niche_prospecting',
    name: 'Niche Prospecting',
    summary: 'Filter leads by industry and need (e.g. no website, low reviews, thin GBP).',
  },
  {
    id: 2,
    slug: 'cqi',
    name: 'Client Qualification Interview (CQI)',
    summary: 'Discovery: revenue, current marketing spend, pain, decision process.',
  },
  {
    id: 3,
    slug: 'trial_close',
    name: 'The Trial Close',
    summary: 'Pitch a low-friction foot-in-the-door offer (≈ $297) — quick win, low risk.',
  },
  {
    id: 4,
    slug: 'trial_onboarding',
    name: 'Trial Onboarding',
    summary: 'Automate setup for the first small deliverable; set expectations and timeline.',
  },
  {
    id: 5,
    slug: 'retainer_close',
    name: 'Retainer Close',
    summary: 'Move from trial to monthly AI / growth retainer ($1k–$3k+). Anchor to ROI.',
  },
  {
    id: 6,
    slug: 'retainer_onboarding',
    name: 'Retainer Onboarding',
    summary: 'Full integration: tracking, assets, access, weekly rhythm.',
  },
  {
    id: 7,
    slug: 'upsell',
    name: 'The Upsell',
    summary: 'Value ladder: Voice AI, agents, ads, advanced funnels.',
  },
  {
    id: 8,
    slug: 'referral_loop',
    name: 'Referral Loop',
    summary: 'After ~30 days of success, systematic referral asks and case study.',
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
    hrefLabel: 'Saved Leads',
  },
];

module.exports = {
  PIPELINE_STAGES,
  SCRIPT_LIBRARY,
  PERSONAS,
};
