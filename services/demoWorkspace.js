/**
 * Demo workspace for client calls: a fictional Clark County / East Portland
 * contractor network with prospect lists, territories, members, referrals,
 * active cadences, tasks, message history, and a Review app (/m) portfolio
 * (sample customers, jobs, tags) for Get the app demos.
 *
 * Everything is fake: phones are in the reserved 555-01xx range, emails and
 * sites are on example.com, and `isDemo` blocks real sends (workspaceIntegrations,
 * smsOutbound, ghlMessaging, sequenceEngine).
 */

const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');
const dbService = require('./database');
const pipelineStagesService = require('./pipelineStagesService');
const pipelineFolders = require('./pipelineFolders');
const workspaceScriptBootstrap = require('./workspaceScriptBootstrap');
const opportunityBoards = require('./opportunityBoards');
const store = require('./networkStore');
const ex = require('./referralExchange');
const { saveMemberWithSeats } = require('./networkReferrals');
const messageLog = require('./messageLog');
const { getTemplate } = require('./sequenceTemplates');
const customCadences = require('./customCadences');
const memberWork = require('./memberWork');
const memberJobMedia = require('./memberJobMedia');
const networkBrand = require('./networkBrand');
const whiteLabel = require('./whiteLabel');
const { OWNER_MEMBER_ID } = require('./ownerReferralApp');
const { PRESETS } = require('../lib/pipeline/presets');
const { normalizeStages } = require('../lib/pipeline/normalize');

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

const WORKSPACE_NAME = 'Cascade Home Pros';
const NETWORK_NAME = 'Cascade Pro Network';
/** Bump when committed demo photos / white-label logo sync change so demos refresh. */
const DEMO_REVIEW_MEDIA_V = 3;
const DEMO_ASSET_DIR = path.join(__dirname, '..', 'assets', 'demo');
const DEMO_ASSETS = {
  hero: 'demo-hero-home.jpg',
  logo: 'demo-logo-chp.jpg',
  profile: 'demo-profile-alex.jpg',
  kitchen: 'demo-job-kitchen.jpg',
  after: 'demo-job-after.jpg',
  estimate: 'demo-job-estimate.jpg',
  finished: 'demo-job-finished.jpg',
  progress: 'demo-job-progress.jpg',
};
const DEMO_JOB_PHOTO_ASSETS = [
  { asset: DEMO_ASSETS.kitchen, caption: 'Kitchen ready for install' },
  { asset: DEMO_ASSETS.after, caption: 'After photo' },
  { asset: DEMO_ASSETS.estimate, caption: 'Estimate walkthrough' },
  { asset: DEMO_ASSETS.finished, caption: 'Finished project' },
  { asset: DEMO_ASSETS.progress, caption: 'Day 1 progress' },
];

const CITIES = {
  Vancouver: { state: 'WA', zips: ['98683', '98684', '98682'], area: '360' },
  Camas: { state: 'WA', zips: ['98607'], area: '360' },
  Washougal: { state: 'WA', zips: ['98671'], area: '360' },
  'Battle Ground': { state: 'WA', zips: ['98604'], area: '360' },
  Ridgefield: { state: 'WA', zips: ['98642'], area: '360' },
  Portland: { state: 'OR', zips: ['97230', '97233'], area: '503' },
  Gresham: { state: 'OR', zips: ['97030'], area: '503' },
};

const ZONES = [
  { id: 'z1', name: 'Camas & Washougal', cities: ['Camas', 'Washougal'], zips: ['98607', '98671'] },
  { id: 'z2', name: 'East Vancouver', cities: ['Vancouver'], zips: ['98682', '98683', '98684'] },
  { id: 'z3', name: 'North Clark County', cities: ['Battle Ground', 'Ridgefield'], zips: ['98604', '98642'] },
  { id: 'z4', name: 'Portland East', cities: ['Portland', 'Gresham'], zips: ['97230', '97233', '97030'] },
];

const TAGS = {
  hot: { name: 'Hot lead', color: '#F43F5E' },
  member: { name: 'Network member', color: '#10B981' },
  partner: { name: 'Referral partner', color: '#3B82F6' },
  website: { name: 'Needs website', color: '#EAB308' },
  ads: { name: 'Google Ads', color: '#8B5CF6' },
  follow: { name: 'Follow up', color: '#F97316' },
  vip: { name: 'VIP', color: '#A855F7' },
  review: { name: 'Ask for review', color: '#F59E0B' },
  repeat: { name: 'Repeat customer', color: '#14B8A6' },
};

const CATEGORY = {
  hvac: 'HVAC contractor',
  plumbing: 'Plumber',
  electrical: 'Electrician',
  roofing: 'Roofing contractor',
  landscaping: 'Landscaper',
  painting: 'Painter',
  pest_control: 'Pest control service',
  garage_door: 'Garage door supplier',
  remodeling: 'Remodeler',
  gutter: 'Gutter cleaning service',
  handyman: 'Handyman',
  water_treatment: 'Water treatment supplier',
};

/*
 * stage: workspace pipeline stage key (agency preset).
 * opp: [pipeline, stageIndex, value] on the Opportunities board.
 * member: zone ids for a network seat (trade = lead trade). waiting: seat already taken.
 * cadence: [templateId, stepIndex, hours until the step is due].
 */
const LEADS = [
  { title: 'Columbia Comfort Heating & Air', trade: 'hvac', city: 'Vancouver', contact: 'Dana Whitfield', rating: 4.8, reviews: 212, stage: 'onboarding', member: ['z2', 'z3'], tags: ['member', 'ads'], opp: ['referrals', 3, 2400], bookmarked: true },
  { title: 'Camas Valley HVAC', trade: 'hvac', city: 'Camas', contact: 'Marco Delgado', rating: 4.7, reviews: 96, stage: 'retainer_signed', member: ['z1'], tags: ['member'], opp: ['referrals', 3, 1800] },
  { title: 'Northwest Climate Pros', trade: 'hvac', city: 'Battle Ground', contact: 'Kelsey Burke', rating: 4.4, reviews: 41, stage: 'proposal_sent', tags: ['hot', 'ads'], opp: ['marketing', 3, 2200], followUpHours: 2, bookmarked: true },
  { title: 'Riverside Air Systems', trade: 'hvac', city: 'Portland', contact: 'Tom Nguyen', rating: 4.6, reviews: 133, stage: 'engaged', tags: ['hot'], opp: ['marketing', 2, 1900], cadence: ['paul_standard', 1, 1], replied: true },
  { title: 'Evergreen Furnace & AC', trade: 'hvac', city: 'Washougal', contact: 'Lena Ortiz', rating: 4.2, reviews: 18, stage: 'contacted', tags: ['website'], cadence: ['clay_standard', 2, -1] },

  { title: 'Silver Star Plumbing', trade: 'plumbing', city: 'Vancouver', contact: 'Rick Hammond', rating: 4.9, reviews: 304, stage: 'onboarding', member: ['z2'], tags: ['member', 'ads'], opp: ['referrals', 3, 2600], bookmarked: true },
  { title: 'Lacamas Rooter & Drain', trade: 'plumbing', city: 'Camas', contact: 'Jenna Fox', rating: 4.6, reviews: 77, stage: 'retainer_signed', member: ['z1', 'z3'], tags: ['member'], opp: ['referrals', 2, 1500] },
  { title: 'Burnside Plumbing Co.', trade: 'plumbing', city: 'Portland', contact: 'Andre Wallace', rating: 4.5, reviews: 158, stage: 'retainer_signed', member: ['z4'], tags: ['member'], opp: ['referrals', 2, 1700] },
  { title: 'Hockinson Plumbing & Water', trade: 'plumbing', city: 'Battle Ground', contact: 'Beth Sorensen', rating: 4.3, reviews: 29, stage: 'contacted', tags: ['follow'], cadence: ['paul_standard', 2, 3], followUpHours: 4 },
  { title: 'Gresham Pipe Works', trade: 'plumbing', city: 'Gresham', contact: 'Luis Herrera', rating: 4.1, reviews: 22, stage: 'new', tags: ['website'], opp: ['marketing', 0, 1500] },

  { title: 'Brightline Electric', trade: 'electrical', city: 'Vancouver', contact: 'Priya Shah', rating: 4.8, reviews: 189, stage: 'onboarding', member: ['z2', 'z1'], tags: ['member'], opp: ['referrals', 3, 2100] },
  { title: 'Clark County Electric Co.', trade: 'electrical', city: 'Battle Ground', contact: 'Gary Lindqvist', rating: 4.5, reviews: 64, stage: 'retainer_signed', member: ['z3'], tags: ['member'], opp: ['referrals', 2, 1400] },
  { title: 'Steigerwald Electrical', trade: 'electrical', city: 'Washougal', contact: 'Holly Brandt', rating: 4.0, reviews: 11, stage: 'discovery', tags: ['hot', 'website'], opp: ['marketing', 2, 1600], followUpHours: 1 },
  { title: 'Rose City Wiring', trade: 'electrical', city: 'Portland', contact: 'Sam Okafor', rating: 4.4, reviews: 57, stage: 'contacted', cadence: ['clay_standard', 1, -2] },

  { title: 'Summit Peak Roofing', trade: 'roofing', city: 'Vancouver', contact: 'Jake Morrison', rating: 4.7, reviews: 241, stage: 'onboarding', member: ['z2', 'z3'], tags: ['member', 'ads'], opp: ['referrals', 3, 3200], bookmarked: true },
  { title: 'Cascade Shield Roofing', trade: 'roofing', city: 'Camas', contact: 'Erin Walsh', rating: 4.6, reviews: 88, stage: 'retainer_signed', member: ['z1'], tags: ['member'], opp: ['referrals', 2, 2000] },
  { title: 'Rain City Roof & Gutter', trade: 'roofing', city: 'Gresham', contact: 'Victor Petrov', rating: 4.3, reviews: 46, stage: 'proposal_sent', tags: ['hot'], opp: ['marketing', 3, 2800], cadence: ['paul_standard', 2, 6] },
  { title: 'Timberline Roofing NW', trade: 'roofing', city: 'Battle Ground', contact: 'Chris Abbott', rating: 3.9, reviews: 14, stage: 'lost', tags: [] },

  { title: 'Green Acre Landscapes', trade: 'landscaping', city: 'Camas', contact: 'Maya Lindgren', rating: 4.8, reviews: 119, stage: 'onboarding', member: ['z1', 'z2'], tags: ['member'], opp: ['referrals', 3, 1600] },
  { title: 'Fern Prairie Landscaping', trade: 'landscaping', city: 'Washougal', contact: 'Owen Keller', rating: 4.2, reviews: 23, stage: 'engaged', tags: ['follow'], opp: ['marketing', 1, 1200], cadence: ['clay_standard', 3, 26], replied: true },
  { title: 'Pacific Yard Design', trade: 'landscaping', city: 'Portland', contact: 'Ivy Chen', rating: 4.5, reviews: 72, stage: 'new', opp: ['marketing', 0, 1800] },

  { title: 'True Coat Painting', trade: 'painting', city: 'Vancouver', contact: 'Nate Brooks', rating: 4.9, reviews: 167, stage: 'onboarding', member: ['z1', 'z2', 'z3'], tags: ['member'], opp: ['referrals', 3, 1900] },
  { title: 'Mill Plain Painters', trade: 'painting', city: 'Vancouver', contact: 'Rosa Jimenez', rating: 4.6, reviews: 58, stage: 'discovery', member: ['z2'], waiting: true, tags: ['member', 'hot'], opp: ['referrals', 1, 1500] },
  { title: 'Brushstroke NW Painting', trade: 'painting', city: 'Gresham', contact: 'Dylan Price', rating: 4.1, reviews: 19, stage: 'contacted', tags: ['website'], cadence: ['paul_standard', 1, 30] },

  { title: 'Northshield Pest Control', trade: 'pest_control', city: 'Battle Ground', contact: 'Tara Quinn', rating: 4.7, reviews: 143, stage: 'retainer_signed', member: ['z1', 'z2', 'z3'], tags: ['member'], opp: ['referrals', 3, 1300] },
  { title: 'Critter Gone Pest Solutions', trade: 'pest_control', city: 'Portland', contact: 'Ben Ashford', rating: 4.3, reviews: 38, stage: 'new', tags: ['ads'] },

  { title: 'Lift Right Garage Doors', trade: 'garage_door', city: 'Vancouver', contact: 'Paul Becker', rating: 4.6, reviews: 92, stage: 'engaged', tags: ['hot'], opp: ['marketing', 2, 1400], replied: true, followUpHours: 3 },
  { title: 'Gateway Garage Door Co.', trade: 'garage_door', city: 'Gresham', contact: 'Nina Rossi', rating: 4.0, reviews: 16, stage: 'contacted' },

  { title: 'Heritage Home Remodel', trade: 'remodeling', city: 'Camas', contact: 'Grant Ellison', rating: 4.8, reviews: 74, stage: 'onboarding', member: ['z1', 'z2'], tags: ['member'], opp: ['referrals', 3, 3500], bookmarked: true },
  { title: 'Fourth Plain Builders', trade: 'remodeling', city: 'Vancouver', contact: 'Hector Ruiz', rating: 4.4, reviews: 33, stage: 'proposal_sent', tags: ['hot'], opp: ['marketing', 3, 3600], followUpHours: 5 },
  { title: 'Union Ave Remodeling', trade: 'remodeling', city: 'Portland', contact: 'Claire Dubois', rating: 4.5, reviews: 61, stage: 'contacted', opp: ['marketing', 1, 2500], cadence: ['clay_standard', 2, 2] },

  { title: 'Clear Flow Gutters', trade: 'gutter', city: 'Washougal', contact: 'Wes Harper', rating: 4.5, reviews: 47, stage: 'new', opp: ['marketing', 0, 1100] },
  { title: 'Ridgefield Handyman Co.', trade: 'handyman', city: 'Ridgefield', contact: 'Abby Lund', rating: 4.7, reviews: 85, stage: 'retainer_signed', opp: ['marketing', 4, 900] },
  { title: 'Pure Well Water Treatment', trade: 'water_treatment', city: 'Battle Ground', contact: 'Doug Fenwick', rating: 4.2, reviews: 27, stage: 'contacted', tags: ['website'] },

  { title: 'Willow & Oak Interiors', folder: 'partners', category: 'Interior designer', city: 'Camas', contact: 'Sophie Marlowe', rating: 4.9, reviews: 64, stage: 'onboarding', tags: ['partner'], opp: ['referrals', 3, 0], partner: { status: 'connected', sent: 3, received: 4 }, bookmarked: true },
  { title: 'Lakeside Realty Group', folder: 'partners', category: 'Real estate agency', city: 'Vancouver', contact: 'Derek Holm', rating: 4.7, reviews: 138, stage: 'engaged', tags: ['partner'], opp: ['referrals', 0, 0], partner: { status: 'intro_sent', sent: 0, received: 0 } },
  { title: 'Studio Nest Design', folder: 'partners', category: 'Interior designer', city: 'Portland', contact: 'Hana Sato', rating: 4.8, reviews: 52, stage: 'new', tags: ['partner'] },
  { title: 'Northbank Property Management', folder: 'partners', category: 'Property management company', city: 'Vancouver', contact: 'Felicia Grant', rating: 4.4, reviews: 49, stage: 'retainer_signed', tags: ['partner'], opp: ['referrals', 2, 0], partner: { status: 'connected', sent: 1, received: 2 } },
  { title: 'Columbia Home Inspections', folder: 'partners', category: 'Home inspector', city: 'Vancouver', contact: 'Ray Castillo', rating: 4.6, reviews: 101, stage: 'contacted', tags: ['partner'], partner: { status: 'intro_sent', sent: 0, received: 0 } },
];

/*
 * Homeowner referrals between members. path: actions applied after routing.
 * from: lead title of the sending member, or '' for the operator.
 */
const REFERRALS = [
  { from: 'Silver Star Plumbing', trade: 'hvac', zone: 'z2', name: 'Karen Mitchell', city: 'Vancouver', zip: '98683', note: 'Furnace is 20+ years old, wants a replacement quote before winter.', daysAgo: 26, path: ['accept', 'book', 'win'], value: 8400 },
  { from: 'Camas Valley HVAC', trade: 'plumbing', zone: 'z1', name: 'Brian Foster', city: 'Camas', zip: '98607', note: 'Water heater leaking in the garage.', daysAgo: 22, path: ['accept', 'book', 'win'], value: 3200 },
  { from: 'Brightline Electric', trade: 'roofing', zone: 'z2', name: 'Alicia Romero', city: 'Vancouver', zip: '98684', note: 'Missing shingles after the windstorm, needs a full inspection.', daysAgo: 20, path: ['accept', 'book', 'win'], value: 12500 },
  { from: 'Summit Peak Roofing', trade: 'electrical', zone: 'z3', name: 'Greg Patterson', city: 'Battle Ground', zip: '98604', note: 'Panel upgrade for a new heat pump.', daysAgo: 18, path: ['accept', 'book', 'win'], value: 2150 },
  { from: 'Green Acre Landscapes', trade: 'remodeling', zone: 'z1', name: 'Melissa Tran', city: 'Camas', zip: '98607', note: 'Hall bathroom refresh, budget around $7k.', daysAgo: 16, path: ['accept', 'book', 'win'], value: 6800 },
  { from: 'True Coat Painting', trade: 'pest_control', zone: 'z2', name: 'Jason Lee', city: 'Vancouver', zip: '98682', note: 'Carpenter ants in the deck.', daysAgo: 14, path: ['accept', 'win'], value: 1450 },
  { from: '', trade: 'plumbing', zone: 'z4', name: 'Natalie Brooks', city: 'Gresham', zip: '97030', note: 'Repipe estimate for a 1970s ranch.', daysAgo: 12, path: ['accept', 'book', 'win'], value: 4900 },
  { from: 'Cascade Shield Roofing', trade: 'landscaping', zone: 'z1', name: 'Steve Carlson', city: 'Washougal', zip: '98671', note: 'Backyard regrade and drainage.', daysAgo: 9, path: ['accept', 'book'] },
  { from: 'Clark County Electric Co.', trade: 'painting', zone: 'z3', name: 'Amanda Gill', city: 'Ridgefield', zip: '98642', note: 'Exterior repaint, two-story.', daysAgo: 8, path: ['accept', 'book'] },
  { from: 'Lacamas Rooter & Drain', trade: 'hvac', zone: 'z1', name: 'Rachel Kim', city: 'Camas', zip: '98607', note: 'Heat pump quote, ducted.', daysAgo: 6, path: ['accept', 'book'] },
  { from: 'Columbia Comfort Heating & Air', trade: 'roofing', zone: 'z3', name: 'Mike Sullivan', city: 'Battle Ground', zip: '98604', note: 'Roof leak over the kitchen.', daysAgo: 5, path: ['accept'] },
  { from: 'Heritage Home Remodel', trade: 'electrical', zone: 'z1', name: 'Olivia Grant', city: 'Camas', zip: '98607', note: 'EV charger install in the garage.', daysAgo: 4, path: ['accept'] },
  { from: 'Northshield Pest Control', trade: 'plumbing', zone: 'z2', name: 'Daniel Park', city: 'Vancouver', zip: '98683', note: 'Possible slab leak, water bill doubled.', daysAgo: 2, path: [] },
  { from: 'Clark County Electric Co.', trade: 'hvac', zone: 'z3', name: 'Laura Bennett', city: 'Battle Ground', zip: '98604', note: 'AC not cooling upstairs.', daysAgo: 1, path: [] },
  { from: 'Silver Star Plumbing', trade: 'painting', zone: 'z2', name: 'Chris Howard', city: 'Vancouver', zip: '98684', note: 'Interior paint, three bedrooms.', daysAgo: 0.3, path: [] },
  { from: 'True Coat Painting', trade: 'roofing', zone: 'z1', name: 'Heather Young', city: 'Washougal', zip: '98671', note: 'Storm damage, insurance claim open.', daysAgo: 11, path: ['accept', 'lose'] },
  { from: 'Summit Peak Roofing', trade: 'landscaping', zone: 'z2', name: 'Tyler Ward', city: 'Vancouver', zip: '98682', note: 'Weekly lawn service.', daysAgo: 7, path: ['decline'] },
  { from: 'Burnside Plumbing Co.', trade: 'hvac', zone: 'z4', name: 'Monica Reyes', city: 'Gresham', zip: '97030', note: 'Ductless mini-split for a home office.', daysAgo: 1.5, path: [] },
  { from: '', trade: 'pest_control', zone: 'z3', name: 'Kevin Doyle', city: 'Ridgefield', zip: '98642', note: 'Rodents in the crawlspace.', daysAgo: 0.6, path: [] },
];

const STREETS = ['NE 112th Ave', 'SE Mill Plain Blvd', 'NE 3rd Ave', 'NW Lake Rd', 'SE 164th Ave', 'Main St', 'E Evergreen Blvd', 'NE 72nd Ave', 'SE Stark St', 'NE Glisan St', 'SE 192nd Ave', 'NE Fourth Plain Blvd'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/* Lead, folder, tag, and search keys are Date.now() based. */
const nextTick = () => sleep(3);

function slugOf(title) {
  return String(title).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function iso(ms) {
  return new Date(ms).toISOString();
}

function dateKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function phoneBook() {
  const used = { '360': 0, '503': 0 };
  return (area) => {
    const n = used[area] || 0;
    if (n > 99) throw new Error(`Demo phone range for ${area} is full.`);
    used[area] = n + 1;
    return `(${area}) 555-01${String(n).padStart(2, '0')}`;
  };
}

/** Lead history that matches its pipeline stage, oldest first. */
function leadHistory(def, created, now) {
  const first = def.contact.split(' ')[0];
  // Full history spans ~7 days; younger leads get the same steps squeezed into their age.
  const scale = Math.min(1, Math.max(0, now - 2 * HOUR - created) / (7.5 * DAY));
  const at = (daysAfter) => {
    const d = new Date(created + daysAfter * DAY * scale);
    const hour = d.getHours();
    if (hour < 8) d.setHours(hour + 8);
    else if (hour >= 20) d.setHours(hour - 5);
    return iso(Math.min(now - HOUR, d.getTime()));
  };
  const rows = [{ type: 'note', value: `Found on Google Maps: ${def.rating}★ from ${def.reviews} reviews.`, timestamp: at(0) }];
  if (def.stage === 'new') return rows;

  rows.push({ type: 'call_disposition', value: 'Disposition: No answer — left voicemail', code: 'no_answer', timestamp: at(1) });
  rows.push({ type: 'sms_outbound', value: `Hi ${first}, this is Alex with Cascade Home Pros. We send homeowner jobs to one ${CATEGORY[def.trade] ? CATEGORY[def.trade].toLowerCase() : 'pro'} per area around ${def.city}. Open to a quick call this week?`, provider: 'demo', timestamp: at(1.1) });
  if (def.stage === 'contacted') return rows;

  if (def.replied) {
    rows.push({ type: 'sms_inbound', value: 'Yeah, we could use more jobs this fall. What does it cost?', timestamp: iso(now - (1 + (def.reviews % 4)) * HOUR) });
  } else if (def.stage !== 'lost') {
    rows.push({ type: 'sms_inbound', value: 'Yeah, we could use more jobs this fall. What does it cost?', timestamp: at(2) });
  }
  if (def.stage === 'engaged') return rows;
  if (def.stage === 'lost') {
    rows.push({ type: 'note', value: 'Went with an in-house marketing hire. Check back in Q2.', timestamp: at(4) });
    return rows;
  }
  rows.push({ type: 'call_disposition', value: 'Disposition: Connected — interested', code: 'interested', timestamp: at(3) });
  rows.push({ type: 'note', value: `Strategy call booked with ${first}. Wants Google Ads + a territory seat.`, timestamp: at(3.1) });
  if (def.stage === 'discovery') return rows;

  rows.push({ type: 'note', value: 'Sent proposal: territory seat + Local Services Ads management.', timestamp: at(5) });
  if (def.stage === 'proposal_sent') return rows;

  rows.push({ type: 'status_change', value: 'Retainer signed', timestamp: at(7) });
  rows.push({ type: 'note', value: 'Signed 6-month agreement. Onboarding checklist sent.', timestamp: at(7.1) });
  return rows;
}

async function archivePreviousDemos(email) {
  const ids = await dbService.getUserWorkspaceIds(email);
  for (const id of ids || []) {
    const ws = await dbService.getWorkspace(id);
    if (!ws || !ws.isDemo || ws.archivedAt || ws.ownerUserId !== email) continue;
    await dbService.saveWorkspace(id, { ...ws, archivedAt: new Date().toISOString() });
    await dbService.removeUserWorkspaceId(email, id);
    const leads = await dbService.getAllLeads(id);
    for (const lead of leads || []) {
      if (lead && lead.key && lead.isDemo) await dbService.deleteLead(lead.key);
    }
  }
}

async function createWorkspaceDoc(email, slug) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const doc = {
    id,
    ownerUserId: email,
    name: WORKSPACE_NAME,
    slug,
    accentColor: '#0EA5E9',
    coachPrompt:
      'You coach the owner of a home-services referral network in Clark County WA and East Portland. Focus on filling open territory seats, keeping members active, and closing contractor marketing retainers.',
    icp: { keyword: 'HVAC contractor', city: 'Vancouver', state: 'WA', qty: 20 },
    settings: {},
    pipelineIntake: { setupPath: 'preset', presetKey: 'agency' },
    salesIntake: {},
    members: { [email]: { role: 'owner', joinedAt: now, userId: email } },
    roundRobinIndex: 0,
    createdAt: now,
    archivedAt: null,
    isDemo: true,
    avgDealValue: 1800,
  };
  workspaceScriptBootstrap.seedWorkspaceScriptsOnCreate(doc, { presetKey: 'agency' });
  await dbService.saveWorkspace(id, doc);
  await dbService.saveWorkspaceSlug(slug, id);
  await dbService.addUserWorkspaceId(email, id);
  await pipelineStagesService.deleteAllStages(id);
  const stages = await pipelineStagesService.persistNormalizedStages(id, normalizeStages(PRESETS.agency.stages));
  return { id, stages };
}

async function seedFolders(wid) {
  await pipelineFolders.ensurePipelineFoldersWithTree(wid);
  await nextTick();
  const partners = await dbService.createFolder(wid, 'Interior designers & realtors');
  const folders = await dbService.listFolders(wid);
  const byTrade = {};
  for (const f of folders) if (f.tradeSlug) byTrade[f.tradeSlug] = f.key;
  return { byTrade, partnersKey: partners.key, folders };
}

async function removeEmptyTradeFolders(wid, folders, usedKeys) {
  for (const f of folders) {
    if (f.tradeSlug && !usedKeys.has(f.key)) await pipelineFolders.deleteFolderComplete(wid, f.key);
  }
}

async function seedTags(wid) {
  const out = {};
  for (const [id, t] of Object.entries(TAGS)) {
    await nextTick();
    const tag = await dbService.createTag(wid, t.name, t.color);
    out[id] = tag.key;
  }
  return out;
}

function boardsWithReferrals() {
  const base = opportunityBoards.normalizeBoards(undefined).boards;
  const added = opportunityBoards.addPipeline(base, 'Referral Partners', 'referrals');
  const boards = { ...added.boards, activePipelineId: base.pipelines[0].id };
  return { boards, marketing: boards.pipelines[0], referrals: boards.pipelines.find((p) => p.id === added.pipelineId) };
}

function sequenceStateFor([templateId, stepIndex, dueInHours], now) {
  const tpl = getTemplate(templateId);
  const step = tpl.steps[Math.min(stepIndex, tpl.steps.length - 1)];
  const nextDueAt = now + dueInHours * HOUR;
  const anchor = nextDueAt - step.dayOffset * DAY;
  return {
    templateId,
    anchorTime: iso(anchor),
    stepIndex,
    nextDueAt: iso(nextDueAt),
    status: 'active',
    startedAt: iso(anchor),
  };
}

async function seedLeads(ctx) {
  const { wid, stages, folders, tags, boards, now } = ctx;
  const phone = phoneBook();
  const stageByKey = Object.fromEntries(stages.map((s) => [s.key, s]));
  const leads = [];
  for (let i = 0; i < LEADS.length; i += 1) {
    const def = LEADS[i];
    const cityInfo = CITIES[def.city];
    const slug = slugOf(def.title);
    const created = now - (40 - i) * DAY * 0.9;
    const stage = stageByKey[def.stage] || stageByKey.new;
    const folderKey = def.folder === 'partners' ? folders.partnersKey : folders.byTrade[def.trade] || '';
    const history = leadHistory(def, created, now);
    const lastTouch = history[history.length - 1];
    const doc = {
      workspaceId: wid,
      isDemo: true,
      title: def.title,
      contactName: def.contact,
      phone: phone(cityInfo.area),
      email: `${slug}@example.com`,
      website: `https://${slug}.example.com`,
      address: `${1200 + i * 37} ${STREETS[i % STREETS.length]}, ${def.city}, ${cityInfo.state} ${cityInfo.zips[i % cityInfo.zips.length]}`,
      city: def.city,
      state: cityInfo.state,
      categoryName: def.category || CATEGORY[def.trade] || 'Contractor',
      totalScore: def.rating,
      reviewsCount: def.reviews,
      jobType: 'maps_business',
      source: 'maps_search',
      folderKey,
      tags: (def.tags || []).map((t) => tags[t]).filter(Boolean),
      stageId: stage.id,
      status: stage.name,
      bookmarked: !!def.bookmarked,
      phoneLineType: 'mobile',
      phoneLineTypeCheckedAt: iso(now),
      updates: history,
      estimatedValue: def.opp ? def.opp[2] : 0,
    };
    if (def.followUpHours) doc.nextActionAt = iso(now + def.followUpHours * HOUR);
    if (def.replied) {
      const at = history.find((h) => h.type === 'sms_inbound');
      if (at) doc.engagementSignals = { smsRepliedAt: at.timestamp, lastSignalAt: at.timestamp, lastSignalType: 'sms_reply' };
    }
    if (def.cadence) doc.sequenceState = sequenceStateFor(def.cadence, now);
    if (def.opp) {
      const pipeline = def.opp[0] === 'referrals' ? boards.referrals : boards.marketing;
      doc.opportunityPipelineId = pipeline.id;
      doc.opportunityStageId = pipeline.stages[Math.min(def.opp[1], pipeline.stages.length - 1)].id;
      if (def.opp[2]) doc.opportunityValue = def.opp[2];
    }
    if (lastTouch) doc.lastActivityAt = lastTouch.timestamp;

    await nextTick();
    const saved = await dbService.saveLeadWithMeta(doc);
    await dbService.updateLead(
      saved.key,
      {
        createdAt: iso(created),
        logsMode: 'replace',
        logs: [{ type: 'creation', message: 'Lead created from Google Maps search', timestamp: iso(created) }],
      },
      wid,
    );
    leads.push({ def, key: saved.key, doc });
  }
  return leads;
}

async function seedNetwork(ctx) {
  const { wid, email, leads, now } = ctx;
  const created = await store.getOrCreateNetworkForWorkspace(wid, { name: NETWORK_NAME, ownerEmail: email });
  const network = await store.saveNetwork({
    ...created,
    name: NETWORK_NAME,
    autoGhlSubaccount: false,
    seatLimit: 1,
    brand: { appName: NETWORK_NAME, tagline: 'The quick and easy review and referrals engine for your business', accent: '#0EA5E9' },
  });

  const zoneIds = {};
  for (const z of ZONES) {
    const saved = await store.saveZone(network.id, { name: z.name, cities: z.cities, zips: z.zips });
    zoneIds[z.id] = saved.id;
  }

  const memberByTitle = {};
  const memberDefs = leads.filter((l) => l.def.member);
  // Seated members first so the waiting member lands behind the current seat holder.
  memberDefs.sort((a, b) => Number(!!a.def.waiting) - Number(!!b.def.waiting));
  for (const lead of memberDefs) {
    const { member } = await saveMemberWithSeats(
      network,
      {
        leadKey: lead.key,
        companyName: lead.def.title,
        contactName: lead.def.contact,
        phone: lead.doc.phone,
        email: lead.doc.email,
        status: 'active',
        joinedAt: iso(now - (lead.def.waiting ? 3 : 30) * DAY),
        reviewLinks: { google: `https://reviews.example.com/${slugOf(lead.def.title)}` },
      },
      { trades: [lead.def.trade], zoneIds: lead.def.member.map((z) => zoneIds[z]) },
    );
    memberByTitle[lead.def.title] = member;
  }

  const referrals = [];
  for (const r of REFERRALS) {
    const zones = await store.listZones(network.id);
    const zone = zones.find((z) => z.id === zoneIds[r.zone]);
    const members = await store.listMembers(network.id);
    const from = r.from ? memberByTitle[r.from] : null;
    const area = CITIES[r.city].area;
    const at = now - r.daysAgo * DAY;
    const built = ex.buildReferral(
      {
        zoneId: zone.id,
        tradeSlug: r.trade,
        fromMemberId: from ? from.id : 'operator',
        name: r.name,
        phone: ctx.phone(area),
        email: `${slugOf(r.name)}@example.com`,
        city: r.city,
        zip: r.zip,
        note: r.note,
        consent: true,
        by: from ? from.companyName : 'operator',
      },
      iso(at),
    );
    if (!built.ok) throw new Error(`Demo referral: ${built.error}`);
    const route = ex.routeReferral(zone, r.trade, { members, fromMemberId: built.referral.fromMemberId, referrals });
    let referral = ex.applyRouting(built.referral, route, iso(at + 5 * 60 * 1000));
    let step = at + 2 * HOUR;
    for (const action of r.path) {
      if (referral.status === 'unrouted') break;
      step = Math.min(now - 10 * 60 * 1000, step + (action === 'win' ? 3 : 1) * DAY * Math.min(1, r.daysAgo / 6));
      const by = (members.find((m) => m.id === referral.toMemberId) || {}).companyName || 'operator';
      const applied = ex.applyReferralAction(referral, action, { now: iso(step), by, value: r.value });
      if (!applied.ok) throw new Error(`Demo referral ${action}: ${applied.error}`);
      referral = applied.referral;
    }
    referral = await store.saveReferral(network.id, { ...referral, id: store.newId() });
    referrals.push(referral);
  }

  const members = await store.listMembers(network.id);
  for (const member of members) {
    const stats = ex.memberStats(referrals, member.id);
    const given = referrals.filter((r) => r.fromMemberId === member.id).map((r) => r.createdAt).sort();
    const got = referrals.filter((r) => r.toMemberId === member.id).map((r) => r.createdAt).sort();
    const partnerEvents = [{ type: 'connected', at: member.joinedAt, text: `Joined ${NETWORK_NAME}` }];
    if (got.length) partnerEvents.push({ type: 'sent', at: got[got.length - 1], text: 'Homeowner referral sent' });
    if (given.length) partnerEvents.push({ type: 'received', at: given[given.length - 1], text: 'Homeowner referral received' });
    await dbService.updateLead(
      member.leadKey,
      {
        referralPartner: {
          highlighted: true,
          status: 'connected',
          sent: stats.received,
          received: stats.given,
          connectedAt: member.joinedAt,
          lastSentAt: got[got.length - 1] || '',
          lastReceivedAt: given[given.length - 1] || '',
          events: partnerEvents,
        },
      },
      wid,
    );
  }

  for (const lead of leads.filter((l) => l.def.partner)) {
    const p = lead.def.partner;
    const events = [];
    if (p.status === 'connected') events.push({ type: 'connected', at: iso(now - 25 * DAY), text: '' });
    else events.push({ type: 'intro', at: iso(now - 2 * DAY), text: 'Intro email sent' });
    if (p.sent) events.push({ type: 'sent', at: iso(now - 4 * DAY), text: 'Sent a remodel lead' });
    if (p.received) events.push({ type: 'received', at: iso(now - 1 * DAY), text: 'Client needs a painter' });
    await dbService.updateLead(
      lead.key,
      {
        referralPartner: {
          highlighted: true,
          status: p.status,
          sent: p.sent,
          received: p.received,
          connectedAt: p.status === 'connected' ? iso(now - 25 * DAY) : '',
          introSentAt: p.status === 'intro_sent' ? iso(now - 2 * DAY) : '',
          lastSentAt: p.sent ? iso(now - 4 * DAY) : '',
          lastReceivedAt: p.received ? iso(now - DAY) : '',
          events,
        },
      },
      wid,
    );
  }

  const reviewed = ['Silver Star Plumbing', 'Columbia Comfort Heating & Air', 'Summit Peak Roofing'];
  for (const [i, title] of reviewed.entries()) {
    const member = memberByTitle[title];
    if (!member) continue;
    await store.ensureReviewSlug(network.id, member, `${slugOf(title)}-demo`);
    await dbService.putStorageKey(`netreviewstats:${network.id}:${member.id}`, {
      stars: { 1: 0, 2: i, 3: 1, 4: 6 + i * 2, 5: 31 - i * 7 },
      clicks: { google: 24 - i * 5, facebook: 5 - i, other: 1 },
      views: 58 - i * 12,
    });
  }
  const unhappy = memberByTitle['Summit Peak Roofing'];
  if (unhappy) {
    await store.saveFeedback(network.id, {
      memberId: unhappy.id,
      rating: 3,
      name: 'Pat Delaney',
      phone: ctx.phone('360'),
      message: 'Crew was great but the cleanup took an extra day. Would still recommend.',
      createdAt: iso(now - 3 * DAY),
    });
  }

  const inviter = memberByTitle['Heritage Home Remodel'];
  await store.saveApplication(network.id, {
    companyName: 'Rosewood Flooring',
    contactName: 'Elena Vasquez',
    phone: ctx.phone('360'),
    email: 'rosewood-flooring@example.com',
    tradeSlug: 'flooring',
    city: 'Camas',
    note: 'Heritage sends us flooring jobs already. Would love the Camas seat.',
    invitedByMemberId: inviter ? inviter.id : '',
    status: 'pending',
    createdAt: iso(now - DAY),
  });
  await store.saveApplication(network.id, {
    companyName: 'Eastside Mini-Split Co.',
    contactName: 'Jordan Pike',
    phone: ctx.phone('503'),
    email: 'eastside-minisplit@example.com',
    tradeSlug: 'hvac',
    city: 'Gresham',
    note: 'Saw the open HVAC seat in Portland East.',
    status: 'pending',
    createdAt: iso(now - 5 * HOUR),
  });

  return { network, referrals, memberByTitle };
}

function ymd(nowMs, dayDelta) {
  const d = new Date(nowMs + dayDelta * DAY);
  return d.toISOString().slice(0, 10);
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Fallback branded JPEG when a committed demo asset is missing. */
async function demoSceneJpeg({
  width = 1200,
  height = 750,
  from = '#0EA5E9',
  to = '#0F172A',
  title = WORKSPACE_NAME,
  subtitle = 'Demo job photo',
} = {}) {
  const sharp = require('sharp');
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${from}"/>
      <stop offset="100%" stop-color="${to}"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <circle cx="${Math.round(width * 0.82)}" cy="${Math.round(height * 0.22)}" r="${Math.round(height * 0.18)}" fill="rgba(255,255,255,0.12)"/>
  <rect x="48" y="${height - 170}" width="${width - 96}" height="110" rx="24" fill="rgba(15,23,42,0.55)"/>
  <text x="72" y="${height - 112}" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="42" font-weight="700">${escapeXml(title)}</text>
  <text x="72" y="${height - 68}" fill="#bae6fd" font-family="Arial, Helvetica, sans-serif" font-size="26">${escapeXml(subtitle)}</text>
</svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
}

/** Load a committed demo photo from assets/demo (generated job / brand images). */
async function loadDemoAsset(filename, {
  width,
  height,
  fit = 'cover',
  fallbackTitle = WORKSPACE_NAME,
  fallbackSubtitle = 'Demo photo',
  from = '#0EA5E9',
  to = '#0F172A',
} = {}) {
  const sharp = require('sharp');
  const file = path.join(DEMO_ASSET_DIR, String(filename || ''));
  if (filename && fs.existsSync(file)) {
    let img = sharp(file).rotate();
    if (width && height) img = img.resize(width, height, { fit, position: 'attention' });
    return img.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
  }
  return demoSceneJpeg({
    width: width || 1200,
    height: height || 750,
    from,
    to,
    title: fallbackTitle,
    subtitle: fallbackSubtitle,
  });
}

async function attachDemoJobPhoto(networkId, memberId, job, caption, photoSpec = {}) {
  const raw = photoSpec.asset
    ? await loadDemoAsset(photoSpec.asset, {
      width: 1200,
      height: 900,
      fallbackTitle: String(job.title || '').slice(0, 40),
      fallbackSubtitle: caption,
      from: photoSpec.from,
      to: photoSpec.to,
    })
    : await demoSceneJpeg({
      title: String(job.title || '').slice(0, 40),
      subtitle: caption,
      from: photoSpec.from || '#0EA5E9',
      to: photoSpec.to || '#0F172A',
    });
  const prepared = await memberJobMedia.prepareJobPhoto(raw);
  const added = await memberWork.addJobPhoto(networkId, memberId, job.id, prepared, { caption });
  if (!added.ok) throw new Error(`Demo job photo: ${added.error}`);
}

/**
 * Sample customers + jobs (+ photos) for the Review app (/m/:token).
 */
async function seedMemberAppPortfolio(networkId, memberId, { phone, now, tagKeys, tradeLabel, withPhotos = true }) {
  const trade = tradeLabel || 'Service';
  const portfolio = [
    {
      customer: {
        name: 'Avery Moss',
        phone: phone('360'),
        email: 'avery.moss@example.com',
        address: '214 NE 4th Ave, Camas, WA 98607',
        notes: 'Prefers morning appointments. Gate code 4412.',
        tags: ['vip', 'repeat'],
      },
      jobs: [
        {
          title: `${trade} — kitchen install`,
          status: 'scheduled',
          date: ymd(now, 1),
          time: '09:00',
          durationMins: 480,
          value: 4800,
          notes: 'Bring spare trim pieces.',
          photo: { caption: 'Kitchen ready for install', asset: DEMO_ASSETS.kitchen },
        },
        {
          title: 'Touch-up from last visit',
          status: 'completed',
          date: ymd(now, -18),
          time: '13:00',
          durationMins: 90,
          value: 350,
          notes: 'Left a review request.',
          photo: { caption: 'After photo', asset: DEMO_ASSETS.after },
        },
      ],
    },
    {
      customer: {
        name: 'Jordan Reyes',
        phone: phone('360'),
        email: 'jordan.reyes@example.com',
        address: '908 SE Washougal River Rd, Washougal, WA 98671',
        notes: 'Dog in backyard — call on arrival.',
        tags: ['review'],
      },
      jobs: [
        {
          title: `${trade} estimate`,
          status: 'estimate',
          date: ymd(now, 3),
          time: '14:30',
          durationMins: 60,
          value: 1250,
          photo: { caption: 'Estimate walkthrough', asset: DEMO_ASSETS.estimate },
        },
      ],
    },
    {
      customer: {
        name: 'Sam Patel',
        phone: phone('503'),
        email: 'sam.patel@example.com',
        address: '11220 NE Halsey St, Portland, OR 97220',
        notes: 'Paid invoice #1042. Loved the crew.',
        tags: ['repeat', 'review'],
      },
      jobs: [
        {
          title: `${trade} — completed job`,
          status: 'completed',
          date: ymd(now, -6),
          time: '10:00',
          durationMins: 240,
          value: 2100,
          notes: 'Ask for Google review.',
          photo: { caption: 'Finished project', asset: DEMO_ASSETS.finished },
        },
      ],
    },
    {
      customer: {
        name: 'Riley Chen',
        phone: phone('360'),
        email: 'riley.chen@example.com',
        address: '401 Main St, Battle Ground, WA 98604',
        notes: 'New lead from Google.',
        tags: ['hot'],
      },
      jobs: [
        {
          title: 'New inquiry',
          status: 'lead',
          date: '',
          time: '',
          durationMins: 0,
          value: 0,
          notes: 'Wants a call back this week.',
        },
      ],
    },
    {
      customer: {
        name: 'Morgan Blake',
        phone: phone('360'),
        email: 'morgan.blake@example.com',
        address: '15500 NE 10th Ave, Ridgefield, WA 98642',
        notes: 'VIP — text before arriving.',
        tags: ['vip'],
      },
      jobs: [
        {
          title: `${trade} in progress`,
          status: 'in_progress',
          date: ymd(now, 0),
          time: '08:00',
          durationMins: 360,
          value: 3200,
          photo: { caption: 'Day 1 progress', asset: DEMO_ASSETS.progress },
        },
      ],
    },
  ];

  const already = await memberWork.listCustomers(networkId, memberId);
  const haveName = new Set(already.map((c) => String(c.name || '').trim().toLowerCase()).filter(Boolean));

  let customerCount = 0;
  let jobCount = 0;
  let photoCount = 0;
  for (const row of portfolio) {
    const nameKey = String(row.customer.name || '').trim().toLowerCase();
    if (nameKey && haveName.has(nameKey)) continue;
    const created = await memberWork.saveCustomer(networkId, memberId, {
      name: row.customer.name,
      phone: row.customer.phone,
      email: row.customer.email,
      address: row.customer.address,
      notes: row.customer.notes || '',
    }, { source: 'manual' });
    if (!created.ok) throw new Error(`Demo member customer: ${created.error}`);
    if (nameKey) haveName.add(nameKey);
    customerCount += 1;
    const keys = (row.customer.tags || []).map((t) => tagKeys[t]).filter(Boolean);
    if (keys.length) {
      const tagged = await memberWork.setCustomerTags(networkId, memberId, created.customer.id, keys);
      if (!tagged.ok) throw new Error(`Demo member tags: ${tagged.error}`);
    }
    for (const j of row.jobs || []) {
      const job = await memberWork.saveJob(networkId, memberId, {
        customerId: created.customer.id,
        title: j.title,
        status: j.status,
        date: j.date || '',
        time: j.time || '',
        durationMins: j.durationMins || 0,
        value: j.value || 0,
        notes: j.notes || '',
        remindOwnerBeforeMins: j.status === 'scheduled' ? 60 : 0,
        remindCustomerBeforeMins: j.status === 'scheduled' ? 1440 : 0,
      }, { timeZone: 'America/Los_Angeles' });
      if (!job.ok) throw new Error(`Demo member job: ${job.error}`);
      jobCount += 1;
      if (withPhotos && j.photo) {
        await attachDemoJobPhoto(networkId, memberId, job.job, j.photo.caption, j.photo);
        photoCount += 1;
      }
    }
  }
  return { customerCount, jobCount, photoCount };
}

async function seedOwnerReviewBrand(network, owner, now) {
  const heroBuf = await loadDemoAsset(DEMO_ASSETS.hero, {
    width: 1400,
    height: 900,
    fallbackTitle: WORKSPACE_NAME,
    fallbackSubtitle: 'Your local home-services crew',
    from: '#38BDF8',
    to: '#0F172A',
  });
  const hero = await networkBrand.prepareImage('hero', heroBuf);
  const heroAt = await store.saveBrandImage(network.id, 'hero', hero);

  const logoBuf = await loadDemoAsset(DEMO_ASSETS.logo, {
    width: 512,
    height: 512,
    fit: 'cover',
    fallbackTitle: 'CHP',
    fallbackSubtitle: 'Cascade Home Pros',
    from: '#0EA5E9',
    to: '#0369A1',
  });
  const logo = await networkBrand.prepareImage('logo', logoBuf);
  const logoAt = await store.saveBrandImage(network.id, 'logo', logo);
  const heroV = Date.parse(heroAt) || Date.now();
  const logoV = Date.parse(logoAt) || Date.now();

  const profileBuf = await loadDemoAsset(DEMO_ASSETS.profile, {
    width: 640,
    height: 640,
    fit: 'cover',
    fallbackTitle: 'Alex',
    fallbackSubtitle: 'Owner',
    from: '#22D3EE',
    to: '#0E7490',
  });
  const profile = await networkBrand.prepareImage('logo', profileBuf);
  const profileAt = await store.saveProfilePhoto(network.id, owner.id, {
    contentType: 'image/jpeg',
    buffer: profile.buffer,
  });

  const next = await store.saveMember(network.id, {
    ...owner,
    contactName: owner.contactName || 'Alex',
    profilePhotoUpdatedAt: profileAt,
    reviewSmsScript:
      'Hi {{name}} — thanks again for choosing {{company}}. Mind leaving a quick Google review? {{review_link}}',
    reviewEmailSubject: 'Thanks from {{company}} — quick review?',
    reviewEmailScript:
      'Hi {{name}},\n\nWe loved working with you. If you have 30 seconds, a Google review helps neighbors find us:\n{{review_link}}\n\nThanks!\nAlex',
    reviewLinks: {
      google: 'https://g.page/r/cascade-home-pros-demo/review',
      facebook: 'https://www.facebook.com/cascadehomepros',
      yelp: 'https://www.yelp.com/biz/cascade-home-pros-camas',
      nextdoor: 'https://nextdoor.com/pages/cascade-home-pros/',
      other: [{ label: 'Website', url: 'https://cascadehomepros.example.com' }],
    },
    reviewShareImageUpdatedAt: '',
  });
  await store.ensureReviewSlug(network.id, next, 'cascade-home-pros-demo');
  // Seed demo review stats only when empty — never clobber live visit counts on re-seed.
  const existingReviewStats = await store.getReviewStats(network.id, next.id);
  if (!(Number(existingReviewStats.views || 0) > 0)) {
    await dbService.putStorageKey(`netreviewstats:${network.id}:${next.id}`, {
      stars: { 1: 0, 2: 0, 3: 1, 4: 8, 5: 42 },
      clicks: { google: 36, facebook: 7, yelp: 4, nextdoor: 2, other: 3 },
      views: 91,
    });
  }
  const savedNet = await store.saveNetwork({
    ...network,
    brand: {
      ...(network.brand || {}),
      appName: WORKSPACE_NAME,
      tagline: 'The quick and easy review and referrals engine for your business',
      accent: '#0EA5E9',
      heroUrl: `/m/brand/${network.id}/hero?v=${heroV}`,
      logoUrl: `/m/brand/${network.id}/logo?v=${logoV}`,
      // Home shows live reviewStats.views — do not freeze a marketing statValue here.
      statValue: '',
      statLabel: '',
    },
  });
  Object.assign(network, savedNet || {});

  // Owner Home badge uses Workspace → White label when present — keep it in sync.
  const wid = network.ownerWorkspaceId;
  if (wid) {
    const ws = await dbService.getWorkspace(wid);
    if (ws) {
      const logoVersion = await whiteLabel.saveLogo(wid, logoBuf);
      const wl = { ...whiteLabel.settings(ws), appName: WORKSPACE_NAME, logoVersion };
      await dbService.saveWorkspace(wid, { ...ws, whiteLabel: wl, name: ws.name || WORKSPACE_NAME });
    }
  }

  await markDemoReviewMedia(network.id);
  return next;
}

/** A few referrals so Home Pending / Sent tiles are non-zero for the owner app. */
async function seedOwnerReferrals(network, owner, memberByTitle, phone, now) {
  const zones = await store.listZones(network.id);
  const zone = zones[0];
  if (!zone || !owner) return { sent: 0, pending: 0 };
  const toPartner = memberByTitle['Silver Star Plumbing'] || Object.values(memberByTitle)[0];
  const fromPartner = memberByTitle['Columbia Comfort Heating & Air'] || Object.values(memberByTitle)[1];
  let sent = 0;
  let pending = 0;

  if (toPartner) {
    const built = ex.buildReferral(
      {
        zoneId: zone.id,
        tradeSlug: 'plumbing',
        fromMemberId: owner.id,
        name: 'Casey Nguyen',
        phone: phone('360'),
        email: 'casey.nguyen@example.com',
        city: 'Camas',
        zip: '98607',
        note: 'Needs a water heater quote this week.',
        consent: true,
        by: owner.companyName,
      },
      iso(now - 2 * DAY),
    );
    if (built.ok) {
      let referral = ex.applyRouting(
        built.referral,
        { status: 'sent', toMemberId: toPartner.id, reason: 'demo' },
        iso(now - 2 * DAY + HOUR),
      );
      referral = await store.saveReferral(network.id, { ...referral, id: store.newId() });
      sent += 1;
      const won = ex.applyReferralAction(referral, 'accept', {
        now: iso(now - DAY),
        by: toPartner.companyName,
      });
      if (won.ok) {
        const booked = ex.applyReferralAction(won.referral, 'book', {
          now: iso(now - 20 * HOUR),
          by: toPartner.companyName,
        });
        if (booked.ok) await store.saveReferral(network.id, booked.referral);
        else await store.saveReferral(network.id, won.referral);
      } else {
        await store.saveReferral(network.id, referral);
      }
    }
  }

  if (fromPartner) {
    const built = ex.buildReferral(
      {
        zoneId: zone.id,
        tradeSlug: 'handyman',
        fromMemberId: fromPartner.id,
        name: 'Taylor Brooks',
        phone: phone('360'),
        email: 'taylor.brooks@example.com',
        city: 'Vancouver',
        zip: '98683',
        note: 'Deck railing repair — flexible on day.',
        consent: true,
        by: fromPartner.companyName,
      },
      iso(now - 8 * HOUR),
    );
    if (built.ok) {
      const referral = ex.applyRouting(
        built.referral,
        { status: 'sent', toMemberId: owner.id, reason: 'demo' },
        iso(now - 7 * HOUR),
      );
      await store.saveReferral(network.id, { ...referral, id: store.newId() });
      pending += 1;
    }
  }

  return { sent, pending };
}

async function tagKeysFromWorkspace(wid) {
  const catalog = await dbService.listTags(wid);
  const byName = {};
  for (const t of catalog || []) {
    const name = String(t.name || '').trim().toLowerCase();
    if (name) byName[name] = t.key;
  }
  const out = {};
  for (const [id, def] of Object.entries(TAGS)) {
    out[id] = byName[String(def.name).toLowerCase()] || '';
  }
  return out;
}

/**
 * Owner Review app (Get the app) + one featured partner portal with dummy work.
 */
async function seedMemberApps(ctx, network, memberByTitle) {
  const { email, phone, now, tags } = ctx;
  let owner = await store.saveMember(network.id, {
    id: OWNER_MEMBER_ID,
    companyName: WORKSPACE_NAME,
    contactName: 'Alex',
    email,
    phone: phone('360'),
    status: 'active',
    joinedAt: iso(now - 90 * DAY),
  });
  owner = await seedOwnerReviewBrand(network, owner, now);

  const ownerSeed = await seedMemberAppPortfolio(network.id, owner.id, {
    phone,
    now,
    tagKeys: tags,
    tradeLabel: 'Home services',
    withPhotos: true,
  });
  const ownerRefs = await seedOwnerReferrals(network, owner, memberByTitle || {}, phone, now);

  const featured = memberByTitle && memberByTitle['Columbia Comfort Heating & Air'];
  let featuredSeed = { customerCount: 0, jobCount: 0, photoCount: 0 };
  if (featured) {
    featuredSeed = await seedMemberAppPortfolio(network.id, featured.id, {
      phone,
      now,
      tagKeys: tags,
      tradeLabel: 'HVAC',
      withPhotos: true,
    });
  }

  return {
    ownerMemberId: owner.id,
    ownerCustomers: ownerSeed.customerCount,
    ownerJobs: ownerSeed.jobCount,
    ownerPhotos: ownerSeed.photoCount,
    ownerPendingRefs: ownerRefs.pending,
    ownerSentRefs: ownerRefs.sent,
    featuredMemberId: featured ? featured.id : '',
    featuredCustomers: featuredSeed.customerCount,
    featuredJobs: featuredSeed.jobCount,
    featuredPhotos: featuredSeed.photoCount || 0,
  };
}

function demoReviewMediaKey(networkId) {
  return `demoreviewmedia:${networkId}`;
}

async function readDemoReviewMediaV(networkId) {
  const raw = await dbService.peekStorageKey(demoReviewMediaKey(networkId));
  if (!raw) return 0;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Number(parsed && parsed.v) || 0;
  } catch {
    return 0;
  }
}

async function markDemoReviewMedia(networkId) {
  await dbService.putStorageKey(demoReviewMediaKey(networkId), {
    v: DEMO_REVIEW_MEDIA_V,
    at: new Date().toISOString(),
  });
}

/**
 * Attach (or replace) job photos using committed demo assets.
 * @param {{ replace?: boolean }} opts replace=true clears prior photos first (media upgrades).
 */
async function enrichDemoJobPhotos(networkId, memberId, { replace = false } = {}) {
  const jobs = await memberWork.listJobs(networkId, memberId);
  let photoCount = 0;
  let i = 0;
  for (const job of jobs) {
    if (!['completed', 'in_progress', 'scheduled', 'estimate'].includes(String(job.status || ''))) continue;
    if (!replace && (job.photos || []).length > 0) continue;
    if (replace && (job.photos || []).length) {
      for (const p of job.photos) {
        await memberWork.removeJobPhoto(networkId, memberId, job.id, p.id).catch(() => null);
      }
    }
    const spec = DEMO_JOB_PHOTO_ASSETS[i % DEMO_JOB_PHOTO_ASSETS.length];
    i += 1;
    const fresh = await memberWork.getJob(networkId, memberId, job.id) || job;
    await attachDemoJobPhoto(networkId, memberId, fresh, spec.caption, spec);
    photoCount += 1;
  }
  return photoCount;
}

/**
 * Parallel Get the app + Home/Customers can race ensure and double-seed.
 * Coalesce in-flight work per workspace.
 */
const ensureDemoOwnerReviewAppInflight = new Map();

/** Drop duplicate sample customers / owner referrals from a raced seed. */
async function dedupeDemoOwnerPortfolio(networkId, ownerId) {
  const customers = await memberWork.listCustomers(networkId, ownerId);
  const keepByName = new Map();
  const remove = [];
  for (const c of customers) {
    const key = String(c.name || '').trim().toLowerCase();
    if (!key) continue;
    const prev = keepByName.get(key);
    if (!prev) {
      keepByName.set(key, c);
      continue;
    }
    // Keep the older row; remove the later duplicate.
    const prevAt = Date.parse(prev.createdAt || '') || 0;
    const nextAt = Date.parse(c.createdAt || '') || 0;
    if (nextAt < prevAt) {
      remove.push(prev);
      keepByName.set(key, c);
    } else {
      remove.push(c);
    }
  }
  let removedCustomers = 0;
  for (const c of remove) {
    const out = await memberWork.deleteCustomer(networkId, ownerId, c.id);
    if (out && out.ok) removedCustomers += 1;
  }

  const referrals = await store.listReferrals(networkId);
  const ownerRefs = referrals.filter(
    (r) => r.fromMemberId === ownerId || r.toMemberId === ownerId,
  );
  const keepRef = new Map();
  const removeRefs = [];
  for (const r of ownerRefs) {
    const h = r.homeowner || {};
    const key = [
      r.fromMemberId === ownerId ? 'sent' : 'recv',
      String(h.name || '').trim().toLowerCase(),
      String(r.tradeSlug || ''),
    ].join('|');
    const prev = keepRef.get(key);
    if (!prev) {
      keepRef.set(key, r);
      continue;
    }
    const prevAt = Date.parse(prev.createdAt || '') || 0;
    const nextAt = Date.parse(r.createdAt || '') || 0;
    if (nextAt < prevAt) {
      removeRefs.push(prev);
      keepRef.set(key, r);
    } else {
      removeRefs.push(r);
    }
  }
  let removedReferrals = 0;
  for (const r of removeRefs) {
    await dbService.deleteStorageKey(`netref:${networkId}:${r.id}`);
    removedReferrals += 1;
  }
  return { removedCustomers, removedReferrals };
}

/**
 * If a demo workspace's Review app is still empty or thin (built before rich
 * seed, or never reset), fill the owner portfolio when Get the app / Home opens.
 * Also upgrades committed photo assets when DEMO_REVIEW_MEDIA_V bumps.
 * Skips real GHL — demos never sync CRM.
 */
async function ensureDemoOwnerReviewApp(workspaceId, { email = '' } = {}) {
  const wid = String(workspaceId || '').trim();
  if (!wid) return { ok: false, reason: 'no-workspace' };
  const existing = ensureDemoOwnerReviewAppInflight.get(wid);
  if (existing) return existing;
  const run = ensureDemoOwnerReviewAppUnlocked(wid, { email }).finally(() => {
    ensureDemoOwnerReviewAppInflight.delete(wid);
  });
  ensureDemoOwnerReviewAppInflight.set(wid, run);
  return run;
}

async function ensureDemoOwnerReviewAppUnlocked(wid, { email = '' } = {}) {
  const ws = await dbService.getWorkspace(wid);
  if (!ws || !ws.isDemo) return { ok: false, reason: 'not-demo' };
  let network = await store.getNetworkForWorkspace(wid);
  if (!network) return { ok: false, reason: 'no-network' };

  let owner = await store.getMember(network.id, OWNER_MEMBER_ID);
  const ownerEmail = String(email || ws.ownerUserId || '').trim().toLowerCase();
  if (!owner) {
    owner = await store.saveMember(network.id, {
      id: OWNER_MEMBER_ID,
      companyName: WORKSPACE_NAME,
      contactName: 'Alex',
      email: ownerEmail,
      phone: '(360) 555-0199',
      status: 'active',
      joinedAt: new Date().toISOString(),
    });
  }

  // Heal demos that already double-seeded from a Get the app + Home race.
  const deduped = await dedupeDemoOwnerPortfolio(network.id, owner.id);

  const [existingCustomers, jobs, hero, referrals] = await Promise.all([
    memberWork.listCustomers(network.id, owner.id),
    memberWork.listJobs(network.id, owner.id),
    store.getBrandImage(network.id, 'hero'),
    store.listReferrals(network.id),
  ]);
  const photoCount = jobs.reduce((n, j) => n + ((j.photos || []).length), 0);
  const links = (owner.reviewLinks && typeof owner.reviewLinks === 'object') ? owner.reviewLinks : {};
  const hasSocials = !!(links.facebook || links.yelp || links.nextdoor);
  const stats = await store.getReviewStats(network.id, owner.id);
  const hasBrandStats = !!(hero && stats && Number(stats.views || 0) > 0 && hasSocials);
  const ownerRefCount = referrals.filter(
    (r) => r.fromMemberId === owner.id || r.toMemberId === owner.id,
  ).length;
  const mediaV = await readDemoReviewMediaV(network.id);
  const needsMediaUpgrade = mediaV < DEMO_REVIEW_MEDIA_V;

  const needsCustomers = existingCustomers.length === 0;
  const needsBrand = !hasBrandStats || needsMediaUpgrade;
  const needsPhotos = (photoCount === 0 && (needsCustomers || jobs.length > 0)) || needsMediaUpgrade;
  const needsReferrals = ownerRefCount === 0;

  // Older demos froze review visits on brand.statValue (hero stuck at 91 while tiles moved).
  const brand = network.brand && typeof network.brand === 'object' ? network.brand : {};
  const frozenReviewStat = !!(brand.statLabel && String(brand.statLabel).toLowerCase().includes('review'));
  if (frozenReviewStat) {
    const cleared = await store.saveNetwork({
      ...network,
      brand: { ...brand, statValue: '', statLabel: '', statSuffix: '' },
    });
    Object.assign(network, cleared || {});
  }

  if (!needsCustomers && !needsBrand && !needsPhotos && !needsReferrals) {
    return {
      ok: true,
      seeded: false,
      customerCount: existingCustomers.length,
      photoCount,
      deduped,
      clearedFrozenReviewStat: frozenReviewStat,
    };
  }

  const now = Date.now();
  const tags = await tagKeysFromWorkspace(wid);
  // Ensure VIP / review tags exist even on older demos.
  for (const [id, def] of Object.entries(TAGS)) {
    if (tags[id]) continue;
    if (!['vip', 'review', 'repeat', 'hot'].includes(id)) continue;
    await nextTick();
    const tag = await dbService.createTag(wid, def.name, def.color);
    tags[id] = tag.key;
  }
  const phone = phoneBook();

  if (needsBrand) {
    owner = await seedOwnerReviewBrand(network, owner, now);
    network = (await store.getNetwork(network.id)) || network;
  }

  let seeded = { customerCount: existingCustomers.length, jobCount: jobs.length, photoCount };
  if (needsCustomers) {
    seeded = await seedMemberAppPortfolio(network.id, owner.id, {
      phone,
      now,
      tagKeys: tags,
      tradeLabel: 'Home services',
      withPhotos: true,
    });
    await markDemoReviewMedia(network.id);
  } else if (needsPhotos) {
    const added = await enrichDemoJobPhotos(network.id, owner.id, { replace: needsMediaUpgrade });
    seeded = { ...seeded, photoCount: added };
    await markDemoReviewMedia(network.id);
  } else if (needsMediaUpgrade) {
    await markDemoReviewMedia(network.id);
  }

  if (needsReferrals) {
    const members = await store.listMembers(network.id);
    const memberByTitle = {};
    for (const m of members) {
      if (m.id !== OWNER_MEMBER_ID) memberByTitle[m.companyName] = m;
    }
    await seedOwnerReferrals(network, owner, memberByTitle, phone, now);
  }

  return { ok: true, seeded: true, ...seeded, mediaV: DEMO_REVIEW_MEDIA_V, deduped };
}

/** One custom GHL cadence with a few leads on it (demo workspaces never sync to GHL). */
async function seedGhlCadence(ctx) {
  const { wid, email, leads } = ctx;
  const saved = await customCadences.saveCadence(wid, {
    name: 'Territory seat invite',
    goal: 'Book a 15-minute call about the open seat',
    steps: [
      { dayOffset: 0, channel: 'sms', message: "Hi {{first_name}}, it's {{my_name}} with {{sender_business}}. We send homeowner jobs to one pro per trade in {{city}} and that seat is open. Want the details?" },
      { dayOffset: 1, channel: 'call', message: "Mention yesterday's text. Ask how they get most of their jobs and whether they could take 3–5 more a month in {{city}}." },
      { dayOffset: 3, channel: 'email', subject: '{{first_name}}, the {{city}} seat for {{company}}', message: 'Hi {{first_name}},\n\n{{sender_pitch}}\n\nOne seat per trade per area, first come first served. Worth a 15-minute call this week?\n\n{{my_name}}\n{{sender_business}}' },
      { dayOffset: 6, channel: 'sms', message: 'Last note from me, {{first_name}}. Should I hold the {{city}} seat for {{company}} or offer it to the next pro on the list?' },
    ],
  });
  if (!saved.ok) return;
  await customCadences.markGhlSetup(wid, saved.cadence.id);
  const titles = ['Gresham Pipe Works', 'Gateway Garage Door Co.', 'Pure Well Water Treatment', 'Clear Flow Gutters'];
  const keys = leads.filter((l) => titles.includes(l.def.title)).map((l) => l.key);
  await customCadences.launchCadence({ workspaceId: wid, cadenceId: saved.cadence.id, leadKeys: keys, actorEmail: email });
}

async function seedTasks(ctx) {
  const { wid, email, leads, now } = ctx;
  const leadKey = (title) => (leads.find((l) => l.def.title === title) || {}).key || null;
  const today = new Date(now);
  const at = (hour, minute = 0, dayOffset = 0) => {
    const d = new Date(today);
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour, minute, 0, 0);
    return d.toISOString();
  };
  const tasks = [
    { title: 'Call Northwest Climate Pros about the proposal', scheduledAt: at(10), lead: 'Northwest Climate Pros', column: 'todo' },
    { title: 'Send Steigerwald Electrical the Camas seat map', scheduledAt: at(11, 30), lead: 'Steigerwald Electrical', column: 'todo' },
    { title: 'Find an HVAC partner for Portland East (open seat)', scheduledAt: at(13), column: 'todo' },
    { title: 'Approve Rosewood Flooring application', scheduledAt: at(15), column: 'todo' },
    { title: 'Follow up with Lift Right Garage Doors — they replied', scheduledAt: at(16), lead: 'Lift Right Garage Doors', column: 'todo' },
    { title: 'Monthly partner check-in with Willow & Oak Interiors', scheduledAt: at(10, 0, 1), lead: 'Willow & Oak Interiors', column: 'todo' },
    { title: 'Quarterly review: Silver Star Plumbing results', scheduledAt: at(14, 0, 2), lead: 'Silver Star Plumbing', column: 'todo' },
    { title: 'Onboard Ridgefield Handyman Co. to Google LSA', column: 'doing', lead: 'Ridgefield Handyman Co.' },
    { title: 'Send Burnside Plumbing their October referral report', column: 'done', lead: 'Burnside Plumbing Co.' },
  ];
  for (const [i, t] of tasks.entries()) {
    await dbService.saveUserTask(wid, email, {
      id: `demo-${i + 1}-${randomUUID().slice(0, 8)}`,
      title: t.title,
      column: t.column,
      sort: i,
      scheduledAt: t.scheduledAt || null,
      leadKey: t.lead ? leadKey(t.lead) : null,
      source: 'manual',
      createdAt: iso(now - (i + 1) * DAY),
    });
  }
}

async function seedActivity(ctx) {
  const { wid, email, leads, now } = ctx;
  const people = [
    { email, name: '' },
    { email: 'sam.rivera@example.com', name: 'Sam Rivera' },
    { email: 'jordan.lee@example.com', name: 'Jordan Lee' },
  ];
  const pick = (title) => leads.find((l) => l.def.title === title);
  const rows = [
    [0.1, 1, 'outreach', 'sms_sent', 'Texted Riverside Air Systems', 'Riverside Air Systems'],
    [0.3, 0, 'pipeline', 'stage_move', 'Moved Fourth Plain Builders to Proposal sent', 'Fourth Plain Builders'],
    [0.5, 2, 'notes', 'note_added', 'Logged a call with Lift Right Garage Doors', 'Lift Right Garage Doors'],
    [0.9, 0, 'search', 'search_run', 'Searched "roofing contractor" in Gresham, OR — 18 results', null],
    [1.2, 1, 'tags', 'tag_added', 'Tagged 4 leads as Hot lead', null],
    [1.6, 2, 'outreach', 'email_sent', 'Emailed Union Ave Remodeling', 'Union Ave Remodeling'],
    [2.1, 0, 'leads', 'lead_added', 'Added Willow & Oak Interiors as a referral partner', 'Willow & Oak Interiors'],
    [2.8, 1, 'pipeline', 'stage_move', 'Moved Steigerwald Electrical to Qualified', 'Steigerwald Electrical'],
    [3.5, 0, 'outreach', 'sms_campaign', 'Sent "Fall tune-up seats" texts to 9 contractors', null],
    [4.2, 2, 'search', 'search_run', 'Searched "HVAC contractor" in Vancouver, WA — 24 results', null],
    [5.0, 1, 'notes', 'note_added', 'Logged a strategy call with Mill Plain Painters', 'Mill Plain Painters'],
    [6.4, 0, 'pipeline', 'stage_move', 'Moved Ridgefield Handyman Co. to Won', 'Ridgefield Handyman Co.'],
  ];
  for (const [daysAgo, who, category, action, summary, title] of rows) {
    const lead = title ? pick(title) : null;
    dbService.insertTeamActivity({
      workspaceId: wid,
      actorEmail: people[who].email,
      actorName: people[who].name,
      category,
      action,
      summary,
      leadKey: lead ? lead.key : null,
      leadTitle: lead ? lead.def.title : null,
      leadCount: lead ? 1 : 0,
      createdAt: Math.round(now - daysAgo * DAY),
    });
  }

  for (let d = 20; d >= 0; d -= 1) {
    const day = new Date(now - d * DAY);
    if (day.getDay() === 0) continue;
    const wave = Math.sin(d / 2.5) * 6;
    await dbService.saveDailyTracker(wid, email, dateKey(day.getTime()), {
      coldCalls: d === 0 ? 7 : Math.max(8, Math.round(24 + wave + (d % 3) * 3)),
      coldEmails: d === 0 ? 12 : Math.round(35 + wave * 2 + (d % 4) * 4),
      coldDms: d === 0 ? 2 : Math.round(5 + (d % 5)),
      socialPosts: d % 3 === 0 ? 1 : 0,
    });
  }
}

async function seedMessages(ctx) {
  const { wid, email, leads, now } = ctx;
  await dbService.putStorageKey(`msglog:backfill:v1:${wid}`, JSON.stringify({ at: now, imported: 0, demo: true }));
  const actor = { email, name: '' };
  const c = { workspaceId: wid, actor };
  const leadRef = (l) => ({ key: l.key, title: l.def.title, phone: l.doc.phone, email: l.doc.email, workspaceId: wid });

  const smsTargets = leads.filter((l) => ['contacted', 'engaged', 'discovery', 'proposal_sent'].includes(l.def.stage)).slice(0, 9);
  const smsId = `demo-sms-${randomUUID().slice(0, 8)}`;
  const smsTemplate = 'Hi {{first_name}}, we have one open {{trade}} seat in {{city}} for fall tune-up referrals. Want the details?';
  messageLog.startCampaign(c, { id: smsId, channel: 'sms', name: 'Fall tune-up seats', template: smsTemplate, planned: smsTargets.length + 1 });
  smsTargets.forEach((l, i) => {
    const pmid = `demo-sms-${i}-${smsId.slice(-8)}`;
    messageLog.record(c, {
      channel: 'sms',
      source: 'bulk',
      campaignId: smsId,
      lead: leadRef(l),
      body: `Hi ${l.def.contact.split(' ')[0]}, we have one open ${(CATEGORY[l.def.trade] || 'pro').toLowerCase()} seat in ${l.def.city} for fall tune-up referrals. Want the details?`,
      provider: 'demo',
      providerMessageId: pmid,
      status: 'sent',
      createdAt: Math.round(now - 3.5 * DAY + i * 40 * 1000),
    });
    if (i !== 4) messageLog.updateStatus({ workspaceId: wid, providerMessageId: pmid, status: i === 7 ? 'failed' : 'delivered' });
  });
  messageLog.finishCampaign(c, smsId, { skipped: 1 });

  const emailTargets = leads.filter((l) => l.def.member && !l.def.waiting);
  const emailId = `demo-email-${randomUUID().slice(0, 8)}`;
  messageLog.startCampaign(c, {
    id: emailId,
    channel: 'email',
    name: 'October referral report',
    subject: 'Your October referrals from Cascade Pro Network',
    template: 'Hi {{first_name}}, here is how your territory did this month…',
    planned: emailTargets.length,
  });
  emailTargets.forEach((l, i) => {
    const pmid = `demo-email-${i}-${emailId.slice(-8)}`;
    messageLog.record(c, {
      channel: 'email',
      source: 'bulk',
      campaignId: emailId,
      lead: leadRef(l),
      subject: 'Your October referrals from Cascade Pro Network',
      body: `Hi ${l.def.contact.split(' ')[0]}, here is how your territory did this month. Reply with any questions.`,
      provider: 'demo',
      providerMessageId: pmid,
      status: 'sent',
      createdAt: Math.round(now - 1.2 * DAY + i * 25 * 1000),
    });
    const status = i % 4 === 0 ? 'clicked' : i % 3 === 0 ? 'delivered' : 'opened';
    messageLog.updateStatus({ workspaceId: wid, providerMessageId: pmid, status });
  });
  messageLog.finishCampaign(c, emailId, {});

  const oneOff = leads.filter((l) => l.def.replied).slice(0, 3);
  oneOff.forEach((l, i) => {
    messageLog.record(c, {
      channel: 'sms',
      source: 'manual',
      lead: leadRef(l),
      body: `Thanks ${l.def.contact.split(' ')[0]}! Seats start at $1,500/mo and include every homeowner referral in your area. Free for a 15-min call tomorrow?`,
      provider: 'demo',
      providerMessageId: `demo-reply-${i}-${smsId.slice(-8)}`,
      status: 'delivered',
      createdAt: Math.round(now - (i + 1) * 40 * 60 * 1000),
    });
  });
}

async function seedSearches(ctx) {
  const { wid, leads, folders, now } = ctx;
  const runs = [
    { keyword: 'HVAC contractor', city: 'Vancouver', state: 'WA', trade: 'hvac', daysAgo: 4.2, total: 24 },
    { keyword: 'plumber', city: 'Camas', state: 'WA', trade: 'plumbing', daysAgo: 8, total: 17 },
    { keyword: 'roofing contractor', city: 'Gresham', state: 'OR', trade: 'roofing', daysAgo: 0.9, total: 18 },
    { keyword: 'interior designer', city: 'Camas', state: 'WA', partners: true, daysAgo: 12, total: 11 },
  ];
  for (const run of runs) {
    const matches = leads.filter((l) => (run.partners ? l.def.folder === 'partners' : l.def.trade === run.trade));
    const ts = Math.round(now - run.daysAgo * DAY);
    await nextTick();
    await dbService.saveSearch({
      searchId: ts,
      workspaceId: wid,
      jobType: 'maps_business',
      keyword: run.keyword,
      city: run.city,
      state: run.state,
      maxResults: 25,
      resultCount: run.total,
      results: matches.map((l) => ({
        title: l.def.title,
        phone: l.doc.phone,
        website: l.doc.website,
        address: l.doc.address,
        city: l.doc.city,
        state: l.doc.state,
        categoryName: l.doc.categoryName,
        totalScore: l.def.rating,
        reviewsCount: l.def.reviews,
        isDemo: true,
      })),
      targetFolderKey: run.partners ? folders.partnersKey : folders.byTrade[run.trade] || '',
      targetFolderName: run.partners ? 'Interior designers & realtors' : run.keyword,
      timestamp: iso(ts),
    });
  }
}

/**
 * Build a fresh demo workspace for `ownerEmail`, archiving their previous one.
 * @returns {Promise<{ workspaceId: string, networkId: string, leadCount: number, referralCount: number, memberApp: object }>}
 */
async function createDemoWorkspace(ownerEmail, { allocateSlug } = {}) {
  const email = String(ownerEmail || '').trim().toLowerCase();
  if (!email) throw new Error('createDemoWorkspace: owner email required');
  await archivePreviousDemos(email);

  const slug = allocateSlug ? await allocateSlug('cascade-home-pros-demo') : `cascade-home-pros-demo-${randomUUID().slice(0, 6)}`;
  const { id: wid, stages } = await createWorkspaceDoc(email, slug);
  const now = Date.now();

  const folders = await seedFolders(wid);
  const tags = await seedTags(wid);
  const board = boardsWithReferrals();
  const ws = await dbService.getWorkspace(wid);
  await dbService.saveWorkspace(wid, { ...ws, opportunityBoards: board.boards });

  const ctx = { wid, email, stages, folders, tags, boards: board, now };
  const leads = await seedLeads(ctx);
  ctx.leads = leads;
  // Homeowner phones continue after the lead numbers.
  const book = phoneBook();
  for (const l of leads) book(CITIES[l.def.city].area);
  ctx.phone = book;

  const usedFolderKeys = new Set(leads.map((l) => l.doc.folderKey).filter(Boolean));
  await removeEmptyTradeFolders(wid, folders.folders, usedFolderKeys);

  const { network, referrals, memberByTitle } = await seedNetwork(ctx);
  const memberApp = await seedMemberApps(ctx, network, memberByTitle);
  await seedGhlCadence(ctx);
  await seedTasks(ctx);
  await seedActivity(ctx);
  await seedMessages(ctx);
  await seedSearches(ctx);

  return {
    workspaceId: wid,
    networkId: network.id,
    leadCount: leads.length,
    referralCount: referrals.length,
    memberApp,
  };
}

module.exports = {
  createDemoWorkspace,
  ensureDemoOwnerReviewApp,
  WORKSPACE_NAME,
  LEADS,
  REFERRALS,
};
