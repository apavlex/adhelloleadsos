/**
 * Car's Reach (Networking) — specialties and seed scripts for BNI / meetups.
 */

const CARS_REACH_SPECIALTIES = [
  { key: 'website_design', label: 'Website Design' },
  { key: 'seo', label: 'SEO' },
  { key: 'social_media', label: 'Social Media Management' },
  { key: 'ppc', label: 'PPC / Paid Ads' },
  { key: 'reputation', label: 'Reputation Management' },
  { key: 'lead_generation', label: 'Lead Generation' },
  { key: 'general', label: 'General Digital Marketing' },
];

const CARS_REACH_SPECIALTY_LABEL = Object.fromEntries(
  CARS_REACH_SPECIALTIES.map((s) => [s.key, s.label]),
);

/** Default elevator speech template ({{name}}, {{specialty}}). */
const CARS_REACH_ELEVATOR_SEED = `Hi, I'm {{name}} — I design websites that turn visitors into paying customers. If you know a small business owner who's frustrated that their site looks dated or doesn't actually bring in leads, I'd love a quick intro.`;

const CARS_REACH_ELEVATOR_EXAMPLES = [
  CARS_REACH_ELEVATOR_SEED,
  `Hi, I'm {{name}} — I help local businesses get found online through {{specialty}}. Most owners I talk to know they need a stronger web presence but don't have time to figure it out — I make that simple. If someone comes to mind, I'd appreciate the intro.`,
  `Hi, I'm {{name}} — I specialize in {{specialty}} for small businesses. I work with owners who want more calls and form fills from their marketing without adding another full-time job to their plate. Happy to connect if you meet someone who fits.`,
];

const CARS_REACH_FOLLOWUP_SEED = `Hey {{theirName}}! It was great connecting with you at {{whereMet}} — I really enjoyed hearing about your {{theirBusinessType}} practice. If there's ever a good time to grab coffee and swap intro strategies, I'd love to.`;

const CARS_REACH_FOLLOWUP_EXAMPLES = [
  CARS_REACH_FOLLOWUP_SEED,
  `Hey {{theirName}}, it was great connecting with you at {{whereMet}}! I really enjoyed hearing about your {{theirBusinessType}} business. If you ever want to compare notes on what's working locally, I'm always up for a quick coffee.`,
];

const CARS_REACH_APPOINTMENT_SEED = `Tell you what, I know we're both here to meet people. How about we hop on a quick 15-minute call {{suggestedTime}}? No pitch — just to see if it makes sense to stay in touch and maybe swap referrals.`;

const CARS_REACH_APPOINTMENT_EXAMPLES = [
  CARS_REACH_APPOINTMENT_SEED,
  `Hey, I know we've both got a lot of people to connect with tonight. Would you be open to a quick 15-minute call {{suggestedTime}}? Zero pressure — just to see if there's a fit and maybe trade intros down the road.`,
  `I don't want to hold you up from working the room — what if we grabbed 15 minutes {{suggestedTime}} for a quick call? No agenda, just to see if we should keep each other in mind for referrals.`,
];

function fillTemplate(tpl, vars) {
  let s = String(tpl || '');
  Object.entries(vars || {}).forEach(([k, v]) => {
    s = s.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v || '').trim());
  });
  return s;
}

function defaultElevatorScript(name, specialtyKey) {
  const n = String(name || 'there').trim() || 'there';
  const label = CARS_REACH_SPECIALTY_LABEL[specialtyKey] || 'digital marketing';
  let out = fillTemplate(CARS_REACH_ELEVATOR_SEED, { name: n, specialty: label });
  if (specialtyKey === 'website_design') return out;
  return fillTemplate(
    `Hi, I'm {{name}} — I help small businesses with {{specialty}}. If you know an owner who's ready for more leads but stuck doing everything themselves, I'd love a quick intro.`,
    { name: n, specialty: label },
  );
}

function defaultFollowupScript(theirName, theirBusinessType, whereMet) {
  return fillTemplate(CARS_REACH_FOLLOWUP_SEED, {
    theirName: String(theirName || 'there').trim() || 'there',
    theirBusinessType: String(theirBusinessType || 'business').trim() || 'business',
    whereMet: String(whereMet || 'the event').trim() || 'the event',
  });
}

function defaultAppointmentScript(suggestedTime) {
  const t = String(suggestedTime || '').trim();
  const timePhrase = t ? `on ${t}` : 'this week';
  return fillTemplate(CARS_REACH_APPOINTMENT_SEED, { suggestedTime: timePhrase });
}

module.exports = {
  CARS_REACH_SPECIALTIES,
  CARS_REACH_SPECIALTY_LABEL,
  CARS_REACH_ELEVATOR_EXAMPLES,
  CARS_REACH_FOLLOWUP_EXAMPLES,
  CARS_REACH_APPOINTMENT_EXAMPLES,
  defaultElevatorScript,
  defaultFollowupScript,
  defaultAppointmentScript,
};
