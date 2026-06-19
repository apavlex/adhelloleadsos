/**
 * Service options for Computer's Reach (Upwork) proposal generator.
 */

const UPWORK_PROPOSAL_SERVICES = [
  { key: 'website_design', label: 'Website Design' },
  { key: 'seo', label: 'SEO' },
  { key: 'social_media', label: 'Social Media Management' },
  { key: 'ppc', label: 'PPC / Paid Ads' },
  { key: 'reputation', label: 'Reputation Management' },
  { key: 'lead_generation', label: 'Lead Generation' },
  { key: 'general', label: 'General Digital Marketing' },
];

const UPWORK_SERVICE_LABEL_BY_KEY = Object.fromEntries(
  UPWORK_PROPOSAL_SERVICES.map((s) => [s.key, s.label]),
);

module.exports = {
  UPWORK_PROPOSAL_SERVICES,
  UPWORK_SERVICE_LABEL_BY_KEY,
};
