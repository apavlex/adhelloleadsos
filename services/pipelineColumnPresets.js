/**
 * Workspace pipeline table column layouts (Detail density).
 * Compact density still uses the hard-coded compact set in the client.
 */

const PRESET_IDS = Object.freeze({
  LOCAL_AGENCY: 'local_agency',
  CARRIERS: 'carriers',
  CONTRACTORS: 'contractors',
  LISTINGS: 'listings',
  PERMITS: 'permits',
});

/** Columns that exist in the Detail table (excludes check/contactGroup which are structural). */
const ALL_TOGGLE_IDS = Object.freeze([
  'company',
  'permitNumber',
  'permitCategoryCol',
  'permitStatus',
  'permitValue',
  'permitStatusDate',
  'permitContractor',
  'permitOwner',
  'listingPrice',
  'listingBeds',
  'listingBaths',
  'city',
  'state',
  'listingSource',
  'findContact',
  'category',
  'reviews',
  'phone',
  'email',
  'domain',
  'opportunity',
  'lastTouch',
  'engagementSignal',
  'cadence',
  'reviewSnippet',
  'sponsored',
  'website',
  'claimStatus',
  'optimizationScore',
  'socials',
  'added',
  'pipeline',
  'methods',
  'zip',
  'outreachStatus',
  'dealValue',
  'phoneLineType',
  'webPlatform',
  'aiAudit',
  'lastEnriched',
  'actions',
]);

function visFromOnList(onIds) {
  const on = new Set(onIds);
  const vis = {};
  for (const id of ALL_TOGGLE_IDS) {
    vis[id] = on.has(id);
  }
  return vis;
}

const PRESET_CATALOG = Object.freeze([
  {
    id: PRESET_IDS.LOCAL_AGENCY,
    label: 'Local businesses / agency',
    bestFor: 'Maps leads, websites, reviews, SEO & GBP outreach',
    hint: 'Shows reviews, review snippets, sponsored, socials, and website gaps.',
    density: 'comfortable',
    on: [
      'company',
      'findContact',
      'category',
      'reviews',
      'phone',
      'email',
      'domain',
      'opportunity',
      'lastTouch',
      'engagementSignal',
      'cadence',
      'reviewSnippet',
      'sponsored',
      'website',
      'socials',
      'added',
      'pipeline',
      'methods',
      'actions',
    ],
  },
  {
    id: PRESET_IDS.CARRIERS,
    label: 'Carriers / trucking',
    bestFor: 'FMCSA lists, motor carriers, trucking insurance',
    hint: 'Keeps company + MC/DOT/insurance chips, contacts, and pipeline. Hides Maps review/GBP columns.',
    density: 'comfortable',
    on: [
      'company',
      'findContact',
      'category',
      'phone',
      'email',
      'domain',
      'opportunity',
      'lastTouch',
      'cadence',
      'city',
      'state',
      'added',
      'pipeline',
      'methods',
      'actions',
    ],
  },
  {
    id: PRESET_IDS.CONTRACTORS,
    label: 'Contractors / CCB & COI',
    bestFor: 'Licensed trades, HomeElk, bonding & insurance renewals',
    hint: 'Focuses on contacts, opportunity (expiry), and pipeline — not GBP sponsored ads.',
    density: 'comfortable',
    on: [
      'company',
      'findContact',
      'category',
      'phone',
      'email',
      'domain',
      'opportunity',
      'lastTouch',
      'engagementSignal',
      'cadence',
      'website',
      'added',
      'pipeline',
      'methods',
      'actions',
    ],
  },
  {
    id: PRESET_IDS.LISTINGS,
    label: 'Real estate listings',
    bestFor: 'Zillow / MLS / mobile-home style imports',
    hint: 'Price, beds, baths, city, state, and listing source.',
    density: 'comfortable',
    on: [
      'company',
      'listingPrice',
      'listingBeds',
      'listingBaths',
      'city',
      'state',
      'listingSource',
      'phone',
      'email',
      'domain',
      'lastTouch',
      'pipeline',
      'methods',
      'actions',
    ],
  },
  {
    id: PRESET_IDS.PERMITS,
    label: 'Building permits',
    bestFor: 'Permit stacks and contractor outreach from permits',
    hint: 'Permit #, status, value, contractor, and property owner.',
    density: 'comfortable',
    on: [
      'company',
      'permitNumber',
      'permitCategoryCol',
      'permitStatus',
      'permitValue',
      'permitStatusDate',
      'permitContractor',
      'permitOwner',
      'city',
      'state',
      'phone',
      'email',
      'pipeline',
      'methods',
      'actions',
    ],
  },
]);

const PRESET_BY_ID = Object.freeze(Object.fromEntries(PRESET_CATALOG.map((p) => [p.id, p])));

function normalizePipelineColumnPreset(raw) {
  const v = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (
    v === 'agency' ||
    v === 'local' ||
    v === 'local_agency' ||
    v === 'maps' ||
    v === 'agency_gap' ||
    v === 'website'
  ) {
    return PRESET_IDS.LOCAL_AGENCY;
  }
  if (
    v === 'carrier' ||
    v === 'carriers' ||
    v === 'trucking' ||
    v === 'truckers' ||
    v === 'fmcsa' ||
    v === 'motor_carrier'
  ) {
    return PRESET_IDS.CARRIERS;
  }
  if (
    v === 'contractor' ||
    v === 'contractors' ||
    v === 'license_renewal' ||
    v === 'ccb' ||
    v === 'coi' ||
    v === 'homeelk'
  ) {
    return PRESET_IDS.CONTRACTORS;
  }
  if (v === 'listing' || v === 'listings' || v === 'real_estate' || v === 'realestate' || v === 'zillow') {
    return PRESET_IDS.LISTINGS;
  }
  if (v === 'permit' || v === 'permits') return PRESET_IDS.PERMITS;
  if (PRESET_BY_ID[v]) return v;
  return '';
}

function defaultPresetForRoiProfile(roiProfile) {
  const r = String(roiProfile || '').trim().toLowerCase();
  if (r === 'license_renewal') return PRESET_IDS.CONTRACTORS;
  if (r === 'partner_fit') return PRESET_IDS.LOCAL_AGENCY;
  if (r === 'agency_gap') return PRESET_IDS.LOCAL_AGENCY;
  return PRESET_IDS.LOCAL_AGENCY;
}

function defaultPresetForWorkspace(workspace) {
  const ws = workspace && typeof workspace === 'object' ? workspace : {};
  const prospect = ws.prospecting && typeof ws.prospecting === 'object' ? ws.prospecting : {};
  const saved = normalizePipelineColumnPreset(prospect.pipelineColumnPreset);
  if (saved) return saved;

  const name = String(ws.name || '').toLowerCase();
  if (/trucker|trucking|carrier|fmcsa|motor\s*carrier|freight/.test(name)) {
    return PRESET_IDS.CARRIERS;
  }
  if (/homeelk|contractor|ccb|bonding/.test(name)) return PRESET_IDS.CONTRACTORS;

  return defaultPresetForRoiProfile(prospect.roiProfile);
}

function visibilityForPreset(presetId) {
  const id = normalizePipelineColumnPreset(presetId) || PRESET_IDS.LOCAL_AGENCY;
  const preset = PRESET_BY_ID[id] || PRESET_BY_ID[PRESET_IDS.LOCAL_AGENCY];
  return visFromOnList(preset.on);
}

function densityForPreset(presetId) {
  const id = normalizePipelineColumnPreset(presetId) || PRESET_IDS.LOCAL_AGENCY;
  const preset = PRESET_BY_ID[id] || PRESET_BY_ID[PRESET_IDS.LOCAL_AGENCY];
  return preset.density === 'comfortable' ? 'comfortable' : 'compact';
}

function resolveWorkspacePipelineColumnDefaults(workspace) {
  const presetId = defaultPresetForWorkspace(workspace);
  return {
    presetId,
    vis: visibilityForPreset(presetId),
    density: densityForPreset(presetId),
  };
}

module.exports = {
  PRESET_IDS,
  PRESET_CATALOG,
  ALL_TOGGLE_IDS,
  normalizePipelineColumnPreset,
  defaultPresetForRoiProfile,
  defaultPresetForWorkspace,
  visibilityForPreset,
  densityForPreset,
  resolveWorkspacePipelineColumnDefaults,
};
