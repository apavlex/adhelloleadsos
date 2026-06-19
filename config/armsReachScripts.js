/**
 * Arm's Reach (LMV) — Facebook network post + referral follow-up scripts.
 * Seeds shown in UI; style examples train AI variations.
 */

/** Default Version 1 & 2 on the scripts page. */
const ARMS_REACH_FACEBOOK_SEEDS = [
  `Hey, does anyone know any small businesses looking to bring in extra revenue right now? I have something I'm working on for helping businesses generate new business and looking to test it out with someone in my network. If you have a friend or family member that runs a small business that you think may be a good fit, please tag them here or shoot me a message.`,
  `Does anyone know a small business owner that would benefit from a few new customers right now? I found an interesting way to do that and want to test with someone in my network. If you have a friend or family member that runs a small business that you think might be a good fit, please tag them here or shoot me a message. Thanks!`,
];

/** Additional approved voice examples for AI regeneration. */
const ARMS_REACH_FACEBOOK_STYLE_EXAMPLES = [
  ...ARMS_REACH_FACEBOOK_SEEDS,
  `Quick question for my network - does anyone have a friend or family member who owns a small business? I've been working on something that helps local businesses get in front of more customers and I want to try it out with someone I'm connected to before I take it further. Tag them below or just send me a message, I promise it's a quick conversation.`,
  `Hey friends, random question - does anyone in my network know a small business owner who could use some help getting more customers through the door? I've been working on something I think could be really useful and want to try it out with someone local before I take it further. Tag them in the comments or just send me a message, I'd love to connect.`,
  `Quick question for my network - does anyone have a friend or family member who owns a small business? I've been working on something that helps businesses get in front of more customers and I want to try it out with someone I'm connected to before rolling it out further. If someone comes to mind, feel free to tag them below or just send me a message.`,
];

const ARMS_REACH_REFERRAL_SEED =
  'Hey {{ownerName}}! I saw your post about helping small businesses and {{referrerName}} actually pointed me your way — are you currently taking on new customers?';

const ARMS_REACH_REFERRAL_STYLE_EXAMPLES = [
  'Hey Russ! I saw your post about helping small businesses and Bright Electric actually pointed me your way — are you currently taking on new customers?',
  'Hey {{ownerName}}! {{referrerName}} mentioned you might be open to chatting — I help local businesses get more customers and wanted to see if that\'s something you\'re looking for right now.',
];

const ARMS_REACH_FACEBOOK_EXAMPLES = ARMS_REACH_FACEBOOK_STYLE_EXAMPLES.map((s, i) => `Example ${i + 1}:\n${s}`).join('\n\n');

const ARMS_REACH_DEFAULT_REFERRER_PLACEHOLDER = 'Bright Electric';
const ARMS_REACH_DEFAULT_OWNER_PLACEHOLDER = 'Russ';

module.exports = {
  ARMS_REACH_FACEBOOK_SEEDS,
  ARMS_REACH_FACEBOOK_STYLE_EXAMPLES,
  ARMS_REACH_REFERRAL_SEED,
  ARMS_REACH_REFERRAL_STYLE_EXAMPLES,
  ARMS_REACH_FACEBOOK_EXAMPLES,
  ARMS_REACH_DEFAULT_REFERRER_PLACEHOLDER,
  ARMS_REACH_DEFAULT_OWNER_PLACEHOLDER,
};
