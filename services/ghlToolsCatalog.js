/**
 * GoHighLevel (GHL) tools you can sell to fix GEO/SEO and local visibility gaps.
 * Used by geoSeoGhlAudit to map findings → fulfillment stack.
 */

const GHL_TOOLS = [
  {
    id: 'websites_funnels',
    name: 'Websites & Funnels',
    category: 'web',
    fixes: ['slow site', 'no mobile', 'weak conversion', 'missing cta', 'outdated design', 'landing page'],
    pitch: 'Rebuild or add high-converting pages with forms, tracking, and speed-friendly templates.',
  },
  {
    id: 'reputation_management',
    name: 'Reputation Management',
    category: 'local',
    fixes: ['low reviews', 'review velocity', 'negative sentiment', 'no review requests', 'gbp reviews'],
    pitch: 'Automated review requests, response templates, and reputation monitoring from one dashboard.',
  },
  {
    id: 'listings_seo',
    name: 'Listings & Local SEO',
    category: 'geo',
    fixes: ['nap inconsistency', 'local pack', 'citations', 'geo gaps', 'multi-location', 'maps visibility'],
    pitch: 'Sync NAP across directories and strengthen local pack presence for map and AI local results.',
  },
  {
    id: 'gbp_integration',
    name: 'Google Business Profile',
    category: 'local',
    fixes: ['unclaimed gbp', 'gbp optimization', 'gbp posts', 'gbp categories', 'google business'],
    pitch: 'Keep GBP updated with posts, Q&A, categories, and messaging tied to your CRM pipeline.',
  },
  {
    id: 'seo_blog',
    name: 'SEO & Blog',
    category: 'seo',
    fixes: ['thin content', 'no blog', 'missing meta', 'keyword gaps', 'content freshness', 'schema'],
    pitch: 'Publish service-area and FAQ content that ranks locally and feeds AI search citations.',
  },
  {
    id: 'conversations_sms_email',
    name: 'Conversations (SMS & Email)',
    category: 'conversion',
    fixes: ['slow follow-up', 'missed leads', 'no nurture', 'inbox chaos', 'after hours'],
    pitch: 'Unified inbox for SMS and email so every web lead gets a fast, tracked response.',
  },
  {
    id: 'workflows_automation',
    name: 'Workflows & Automations',
    category: 'ops',
    fixes: ['manual follow-up', 'no automation', 'lead leakage', 'dropped leads', 'crm hygiene'],
    pitch: 'Trigger follow-ups, reminders, and stage moves automatically when forms or calls come in.',
  },
  {
    id: 'calendar_booking',
    name: 'Calendar & Booking',
    category: 'conversion',
    fixes: ['phone tag scheduling', 'no online booking', 'calendar friction', 'appointment'],
    pitch: 'Let prospects book consults or estimates online with reminders and pipeline updates.',
  },
  {
    id: 'forms_surveys',
    name: 'Forms & Surveys',
    category: 'conversion',
    fixes: ['no lead capture', 'weak forms', 'no tracking', 'quote requests'],
    pitch: 'Embed tracked forms and surveys that push straight into pipeline with source attribution.',
  },
  {
    id: 'social_planner',
    name: 'Social Planner',
    category: 'visibility',
    fixes: ['inactive social', 'inconsistent posting', 'social proof', 'brand visibility'],
    pitch: 'Schedule local proof posts, promos, and review highlights without living in five apps.',
  },
  {
    id: 'conversation_ai',
    name: 'Conversation AI',
    category: 'ai',
    fixes: ['no chatbot', 'after hours', 'faq coverage', 'ai search', 'chat widget'],
    pitch: 'AI chat and SMS assistant that answers FAQs, captures leads, and hands off to humans.',
  },
  {
    id: 'missed_call_text_back',
    name: 'Missed Call Text Back',
    category: 'conversion',
    fixes: ['missed calls', 'no click to call', 'phone leads', 'speed to lead'],
    pitch: 'Instant text-back when calls are missed so high-intent callers do not go to competitors.',
  },
  {
    id: 'crm_pipeline',
    name: 'CRM & Pipeline',
    category: 'ops',
    fixes: ['no crm', 'spreadsheet leads', 'no pipeline', 'lost opportunities'],
    pitch: 'Single pipeline from first touch to close with tags, tasks, and revenue visibility.',
  },
  {
    id: 'payments_invoicing',
    name: 'Payments & Invoicing',
    category: 'revenue',
    fixes: ['deposit collection', 'invoicing friction', 'payment links'],
    pitch: 'Collect deposits and invoices inside the same system that runs marketing and follow-up.',
  },
];

function catalogForPrompt() {
  return GHL_TOOLS.map(
    (t) =>
      `- ${t.id}: ${t.name} — ${t.pitch} (fixes: ${t.fixes.slice(0, 4).join(', ')})`,
  ).join('\n');
}

function toolById(id) {
  return GHL_TOOLS.find((t) => t.id === id) || null;
}

module.exports = {
  GHL_TOOLS,
  catalogForPrompt,
  toolById,
};
