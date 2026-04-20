/**
 * Curated pipeline presets (per-workspace stage libraries).
 */

const PALETTE = {
  slate: '#94a3b8',
  blue: '#60a5fa',
  violet: '#a78bfa',
  pink: '#f472b6',
  orange: '#fb923c',
  yellow: '#facc15',
  green: '#4ade80',
  red: '#f87171',
};

const PRESETS = {
  agency: {
    label: 'Ad / Social Agency',
    stages: [
      { key: 'new', name: 'New', color: PALETTE.slate, slaHours: 24, isWon: false, isLost: false },
      { key: 'contacted', name: 'Contacted', color: PALETTE.blue, slaHours: 72, isWon: false, isLost: false },
      { key: 'engaged', name: 'Engaged / replied', color: PALETTE.violet, slaHours: 48, isWon: false, isLost: false },
      { key: 'discovery', name: 'Discovery booked', color: PALETTE.pink, slaHours: 72, isWon: false, isLost: false },
      { key: 'proposal_sent', name: 'Proposal sent', color: PALETTE.orange, slaHours: 96, isWon: false, isLost: false },
      { key: 'retainer_signed', name: 'Retainer signed', color: PALETTE.green, slaHours: null, isWon: true, isLost: false },
      { key: 'onboarding', name: 'Onboarding → Active', color: PALETTE.green, slaHours: null, isWon: true, isLost: false },
      { key: 'lost', name: 'Lost', color: PALETTE.red, slaHours: null, isWon: false, isLost: true },
    ],
  },

  retail_install: {
    label: 'Retail + Installation (e.g. flooring)',
    stages: [
      { key: 'new', name: 'New lead', color: PALETTE.slate, slaHours: 24, isWon: false, isLost: false },
      { key: 'contacted', name: 'Contacted', color: PALETTE.blue, slaHours: 48, isWon: false, isLost: false },
      { key: 'site_visit', name: 'Site visit scheduled', color: PALETTE.violet, slaHours: 120, isWon: false, isLost: false },
      { key: 'measured', name: 'Measured & scoped', color: PALETTE.violet, slaHours: 72, isWon: false, isLost: false },
      { key: 'materials_picked', name: 'Materials selected', color: PALETTE.pink, slaHours: 120, isWon: false, isLost: false },
      { key: 'estimate_sent', name: 'Estimate sent', color: PALETTE.orange, slaHours: 96, isWon: false, isLost: false },
      { key: 'negotiating', name: 'Negotiating', color: PALETTE.orange, slaHours: 120, isWon: false, isLost: false },
      { key: 'deposit_received', name: 'Deposit received', color: PALETTE.green, slaHours: null, isWon: true, isLost: false },
      { key: 'installed', name: 'Installed', color: PALETTE.green, slaHours: null, isWon: true, isLost: false },
      { key: 'paid_review', name: 'Paid & review', color: PALETTE.green, slaHours: null, isWon: true, isLost: false },
      { key: 'lost', name: 'Lost', color: PALETTE.red, slaHours: null, isWon: false, isLost: true },
    ],
  },

  saas: {
    label: 'B2B SaaS',
    stages: [
      { key: 'new', name: 'New', color: PALETTE.slate, slaHours: 24, isWon: false, isLost: false },
      { key: 'contacted', name: 'Contacted', color: PALETTE.blue, slaHours: 72, isWon: false, isLost: false },
      { key: 'demo_booked', name: 'Demo booked', color: PALETTE.violet, slaHours: 120, isWon: false, isLost: false },
      { key: 'trial', name: 'Trial active', color: PALETTE.pink, slaHours: 336, isWon: false, isLost: false },
      { key: 'proposal', name: 'Proposal / security review', color: PALETTE.orange, slaHours: 168, isWon: false, isLost: false },
      { key: 'won', name: 'Closed won', color: PALETTE.green, slaHours: null, isWon: true, isLost: false },
      { key: 'churned', name: 'Churned', color: PALETTE.red, slaHours: null, isWon: false, isLost: true },
    ],
  },

  local_service: {
    label: 'Local service (trades, pros)',
    stages: [
      { key: 'new', name: 'New lead', color: PALETTE.slate, slaHours: 24, isWon: false, isLost: false },
      { key: 'contacted', name: 'Contacted', color: PALETTE.blue, slaHours: 48, isWon: false, isLost: false },
      { key: 'quoted', name: 'Quoted', color: PALETTE.violet, slaHours: 72, isWon: false, isLost: false },
      { key: 'scheduled', name: 'Job scheduled', color: PALETTE.pink, slaHours: 168, isWon: false, isLost: false },
      { key: 'completed', name: 'Completed', color: PALETTE.green, slaHours: null, isWon: true, isLost: false },
      { key: 'paid', name: 'Paid', color: PALETTE.green, slaHours: null, isWon: true, isLost: false },
    ],
  },

  ecommerce_b2b: {
    label: 'B2B / wholesale commerce',
    stages: [
      { key: 'new', name: 'New account', color: PALETTE.slate, slaHours: 48, isWon: false, isLost: false },
      { key: 'qualified', name: 'Qualified buyer', color: PALETTE.blue, slaHours: 120, isWon: false, isLost: false },
      { key: 'sample_sent', name: 'Sample / line sheet sent', color: PALETTE.violet, slaHours: 168, isWon: false, isLost: false },
      { key: 'terms_negotiation', name: 'Terms & MOQ', color: PALETTE.pink, slaHours: 240, isWon: false, isLost: false },
      { key: 'pilot_order', name: 'Pilot order', color: PALETTE.orange, slaHours: 336, isWon: false, isLost: false },
      { key: 'active_account', name: 'Active account', color: PALETTE.green, slaHours: null, isWon: true, isLost: false },
      { key: 'inactive', name: 'Inactive / lost', color: PALETTE.red, slaHours: null, isWon: false, isLost: true },
    ],
  },
};

module.exports = { PRESETS, PALETTE };
