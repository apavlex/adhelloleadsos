/**
 * Default sales-script seeds per workspace type (offer catalog + block text).
 * Copied into each workspace on creation / first load — not shared globally.
 */
const { SCRIPT_LIBRARY } = require('../services/salesConstants');

function blocksFromLibrary(keys) {
  const blockOverrides = {};
  const catalog = [];
  for (const key of keys) {
    const block = SCRIPT_LIBRARY[key];
    if (!block) continue;
    catalog.push({
      key,
      label: block.label || key,
      tabLabel: block.tabLabel || block.label || key,
    });
    blockOverrides[key] = {
      opening: block.opening || '',
      discovery: block.discovery || '',
      valueProp: block.valueProp || '',
      objectionHandling: block.objectionHandling || '',
      close: block.close || '',
    };
  }
  return { catalog, blockOverrides };
}

function makeOffer(key, label, tabLabel, vertical, script) {
  const text = script && typeof script === 'object' ? script : {};
  return {
    catalogEntry: {
      key,
      label,
      tabLabel: tabLabel || label,
      vertical: vertical || '',
      senderBusinessName: '',
    },
    block: {
      opening: text.opening || '',
      discovery: text.discovery || '',
      valueProp: text.valueProp || '',
      objectionHandling: text.objectionHandling || '',
      close: text.close || '',
    },
  };
}

function buildPresetOffers(offerDefs) {
  const catalog = [];
  const blockOverrides = {};
  for (const def of offerDefs) {
    const { catalogEntry, block } = makeOffer(
      def.key,
      def.label,
      def.tabLabel,
      def.vertical,
      def.script,
    );
    catalog.push(catalogEntry);
    blockOverrides[def.key] = block;
  }
  return { catalog, blockOverrides };
}

const AGENCY = blocksFromLibrary(Object.keys(SCRIPT_LIBRARY));

const RETAIL_INSTALL = buildPresetOffers([
  {
    key: 'flooring_install',
    label: 'Flooring Installation',
    tabLabel: 'Installation',
    vertical: 'Flooring',
    script: {
      opening:
        "Hi {{name}}, I noticed {{company}} in {{city}} — great reputation in the area. Quick question: are you actively booking in-home estimates each week, or is most work still coming from referrals and repeat GCs?",
      discovery:
        'What types of jobs do you prefer — residential remodel, new construction, or commercial? How do homeowners or builders find you today — showroom, website, or phone?',
      valueProp:
        'We help flooring retailers and installers turn website traffic and after-hours calls into booked measure appointments — without adding another person to answer the phone.',
      objectionHandling:
        "Totally fair — you don't want another vendor promising leads that never show. We start with one channel (usually missed-call text-back or a focused landing page) and measure booked estimates, not vanity clicks.",
      close:
        "I'd suggest a quick look at how you're capturing demand today and one pilot to improve estimate requests. If it doesn't move booked jobs in 30 days, we stop. Open to a 15-minute call this week?",
    },
  },
  {
    key: 'hardwood_refinish',
    label: 'Hardwood Refinishing',
    tabLabel: 'Refinish',
    vertical: 'Flooring',
    script: {
      opening:
        "Hi {{name}}, I was looking at {{company}} in {{city}} — strong local presence. Are refinish jobs something you're actively marketing, or mostly upsells from install customers?",
      discovery:
        'Typical refinish ticket size? How do customers request quotes — phone, form, or walk-in? Any seasonality where you wish the phone rang more?',
      valueProp:
        'We package refinish offers with before/after proof, fast quote follow-up, and review requests after each job so refinish work becomes a predictable revenue line.',
      objectionHandling:
        'Makes sense — refinish leads can be price-shoppers. We qualify budget and timeline upfront and only book visits that match your minimum job size.',
      close:
        "We could test a refinish-specific landing page plus automated follow-up for web inquiries. Low risk — you'll see quote volume before we expand. Worth a quick walkthrough?",
    },
  },
  {
    key: 'commercial_flooring',
    label: 'Commercial Flooring',
    tabLabel: 'Commercial',
    vertical: 'Flooring',
    script: {
      opening:
        "Hi {{name}}, quick one for {{company}} — are you pursuing commercial flooring bids in {{city}}, or is the business mostly residential right now?",
      discovery:
        'Who typically brings you commercial work — GCs, property managers, or direct owners? What does a good commercial job look like in square footage and margin?',
      valueProp:
        'We help installers build credibility with GC-ready spec sheets, project galleries, and targeted outreach so commercial opportunities stop being accidental.',
      objectionHandling:
        "Commercial can feel like a long sales cycle. We focus on getting you in the bid stack for the right projects — not blasting every GC in the state.",
      close:
        "Happy to share how similar shops landed 2–3 GC relationships in 90 days. If it's not a fit, no hard feelings — want me to send a one-pager?",
    },
  },
  {
    key: 'speed_to_lead',
    label: 'Speed to Lead',
    tabLabel: 'Speed to lead',
    vertical: 'Flooring',
    script: {
      opening:
        "Hi {{name}}, when a homeowner requests a quote from {{company}} while your team is on a job site, how fast does someone actually respond? Most flooring shops lose 30–40% of inbound just from slow follow-up.",
      discovery:
        'Where do leads land — phone, web form, Google, Facebook? Who owns the first reply when the showroom is busy?',
      valueProp:
        'We deploy instant text-back on missed calls and form fills — qualifies the job, offers measure times, and logs everything so hot leads never sit overnight.',
      objectionHandling:
        "You don't want a robot embarrassing the brand. We use your tone and hand off to humans on anything complex. Start with missed-call text-back only — measure speed-to-lead and booked conversations.",
      close:
        "14-day pilot: missed-call text-back plus one form source. If response time doesn't improve, we stop. Open to a 15-minute walkthrough?",
    },
  },
]);

const LOCAL_SERVICE = buildPresetOffers([
  {
    key: 'core_service',
    label: 'Core Service',
    tabLabel: 'Core',
    vertical: 'Local service',
    script: {
      opening:
        "Hi {{name}}, I came across {{company}} in {{city}} — solid local footprint. Quick question: is most of your pipeline referrals today, or are you actively driving new quote requests each week?",
      discovery:
        'What jobs are most profitable for you? How do customers typically reach you — phone, website, or maps?',
      valueProp:
        'We help local service businesses capture more of the demand they already earn — faster follow-up, clearer offers, and simple tracking from first touch to booked job.',
      objectionHandling:
        "Fair — you've probably heard a lot of marketing pitches. We start with one measurable improvement tied to booked work, not a six-month contract.",
      close:
        "I'd suggest a 20-minute look at your current follow-up and one low-risk pilot. If it doesn't improve booked conversations, we part friends. Sound fair?",
    },
  },
  {
    key: 'speed_to_lead',
    label: 'Speed to Lead',
    tabLabel: 'Speed to lead',
    vertical: 'Local service',
    script: {
      opening:
        "Hi {{name}}, when a new lead hits {{company}} after hours, how fast does someone respond? Most local pros lose a third of inbound just from slow follow-up.",
      discovery:
        'Where do leads land — phone, form, Google? Who handles first reply when the crew is on site?',
      valueProp:
        'Instant text-back on missed calls and forms — qualifies the lead and routes hot opportunities to your team in under 60 seconds.',
      objectionHandling:
        'We keep human handoff on complex jobs and use your voice — start with one channel and measure booked outcomes.',
      close:
        '14-day pilot on missed-call text-back. If it does not pay for itself, we stop. Quick walkthrough?',
    },
  },
]);

const SAAS = buildPresetOffers([
  {
    key: 'core_product',
    label: 'Core Product',
    tabLabel: 'Product',
    vertical: 'SaaS',
    script: {
      opening:
        "Hi {{name}}, I noticed {{company}} — curious how you're acquiring new accounts today. Mostly outbound, inbound, or partner referrals?",
      discovery:
        'Who is the economic buyer vs champion? Typical sales cycle length? What proof do prospects need before a demo?',
      valueProp:
        'We tighten positioning, demo narrative, and follow-up cadence so trials convert to paid with clear ROI proof for operational leaders.',
      objectionHandling:
        'Budget cycles are real — we help you land a champion with a low-friction pilot and metrics they can take to finance.',
      close:
        "Open to a 20-minute discovery on your current funnel? I'll share one experiment you can run this week regardless.",
    },
  },
]);

const ECOMMERCE_B2B = buildPresetOffers([
  {
    key: 'wholesale_account',
    label: 'Wholesale Account',
    tabLabel: 'Wholesale',
    vertical: 'B2B commerce',
    script: {
      opening:
        "Hi {{name}}, I saw {{company}} in {{city}} — are you actively opening new wholesale or trade accounts this quarter?",
      discovery:
        'Typical MOQ and reorder rhythm? Who approves new vendors on their side? Sample or line-sheet process today?',
      valueProp:
        'We help suppliers shorten the path from first touch to pilot order with clear line sheets, sample logistics, and follow-up that respects buyer timelines.',
      objectionHandling:
        'Long cycles are normal — we focus on staying top-of-mind without being pushy, and on making the first pilot order frictionless.',
      close:
        "Happy to send a sample workflow outline. If it resonates, we book 20 minutes to map it to your catalog. Fair?",
    },
  },
]);

const SCRIPT_PRESETS = {
  agency: AGENCY,
  retail_install: RETAIL_INSTALL,
  local_service: LOCAL_SERVICE,
  saas: SAAS,
  ecommerce_b2b: ECOMMERCE_B2B,
};

module.exports = {
  SCRIPT_PRESETS,
  blocksFromLibrary,
};
