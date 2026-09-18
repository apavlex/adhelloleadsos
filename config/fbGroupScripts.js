/**
 * Facebook Groups prospecting — educational + soft-connect script pack.
 * Copy/paste into groups or personal profile. No API publish.
 */

const FB_GROUP_SCRIPT_CATEGORIES = [
  {
    id: 'educational',
    label: 'Educational',
    hint: 'Teach something useful — best for groups and your profile.',
    scripts: [
      {
        id: 'edu_google_maps',
        title: 'Why Google Maps picks winners',
        body: `Quick tip for local business owners:\n\nWhen someone searches "[your service] near me," Google usually shows 3 businesses in the map pack. Those three get most of the calls — not always the best shop, the most visible one.\n\nThree things that move the needle:\n1) A claimed, complete Google Business Profile\n2) Fresh photos and posts (monthly is enough)\n3) Reviews that mention the service + city\n\nHappy to share a simple checklist if anyone wants it — drop a comment.`,
      },
      {
        id: 'edu_reviews',
        title: 'Reviews that actually help',
        body: `Something I see a lot with local businesses:\n\nA 4.9 rating with 12 reviews often loses to a 4.6 with 80 reviews. Volume + recency matter almost as much as the star average.\n\nEasy win: after every good job, text a short review link the same day. Don't wait for "when you get a chance."\n\nIf you want a 1-sentence text template that works, comment REVIEW and I'll paste it.`,
      },
      {
        id: 'edu_website_speed',
        title: 'Website speed vs missed calls',
        body: `Unpopular but true:\n\nIf your website takes longer than ~3 seconds on mobile, a big chunk of people bounce before they ever call.\n\nQuick self-check:\n• Open your site on your phone on cellular (not Wi‑Fi)\n• Time how long until you can tap Call or Get Quote\n\nIf it's slow, fix that before spending more on ads. Happy to point people to free speed tools — comment SPEED.`,
      },
      {
        id: 'edu_invisible',
        title: 'Invisible online (common pattern)',
        body: `Pattern I keep seeing with good local businesses:\n\nGreat work. Happy customers. Almost invisible when someone searches on Google.\n\nUsually it's not "bad marketing" — it's missing basics: incomplete Google listing, no recent photos, website that doesn't say the service + city on the homepage, or reviews that never mention what you do.\n\nIf you run a local business and aren't sure how you show up, I'm happy to share what to check first (no pitch required). Comment VISIBLE.`,
      },
    ],
  },
  {
    id: 'value_share',
    label: 'Value share',
    hint: 'Share a tip or resource; soft invite to connect.',
    scripts: [
      {
        id: 'val_checklist',
        title: 'Free visibility checklist',
        body: `I put together a short checklist local owners use before they spend on ads:\n\n☐ Google Business Profile claimed + categories set\n☐ 10+ recent photos\n☐ Phone + website clickable on mobile\n☐ Homepage says service + city in plain English\n☐ Last 5 reviews mention what you do\n\nIf you want the one-pager, comment CHECKLIST and I'll send it over.`,
      },
      {
        id: 'val_before_after',
        title: 'Before / after lesson',
        body: `Lesson from a recent local business we looked at:\n\nBefore: incomplete Google listing, old photos, almost no reviews mentioning the service.\nAfter focusing on those basics: more map visibility and more calls — without running ads yet.\n\nNot magic. Just being findable when someone needs you today.\n\nCurious what others here have done that moved the needle for local leads?`,
      },
    ],
  },
  {
    id: 'soft_ask',
    label: 'Soft ask',
    hint: 'Ask for intros or conversations without hard-selling.',
    scripts: [
      {
        id: 'ask_intro',
        title: 'Looking for local owners',
        body: `Hey group — quick ask.\n\nI'm looking to connect with a few local small business owners who want more inbound calls from Google (not more ad spend necessarily).\n\nIf that's you, or you know someone, comment or DM me. Happy to share a free visibility checklist either way.`,
      },
      {
        id: 'ask_feedback',
        title: 'Feedback request',
        body: `Would love this group's feedback:\n\nWhat's the #1 thing that made YOU trust a local contractor / service business online — reviews, photos, website, Google listing, referrals?\n\nTrying to make better recommendations for owners in this area. Appreciate any thoughts 👇`,
      },
    ],
  },
  {
    id: 'profile_repost',
    label: 'Profile / group ready',
    hint: 'Works on your personal profile and in groups.',
    scripts: [
      {
        id: 'prof_tip',
        title: 'One tip post',
        body: `One tip for friends who own a local business:\n\nYour Google Business Profile is often more important than your website for phone calls.\n\nSpend 20 minutes this week:\n1) Confirm categories + hours\n2) Add 5 fresh photos\n3) Ask two happy customers for a review that mentions the service\n\nSmall moves. Real difference. Share with an owner who needs this.`,
      },
      {
        id: 'prof_question',
        title: 'Conversation starter',
        body: `Question for my network (business owners especially):\n\nIf a stranger searched for what you do in your city tomorrow morning, would they find you in the top 3 on Google Maps?\n\nIf you're not sure, that's worth checking. Happy to walk someone through what to look for — message me.`,
      },
    ],
  },
];

function listFbGroupScriptsFlat() {
  const out = [];
  for (const cat of FB_GROUP_SCRIPT_CATEGORIES) {
    for (const s of cat.scripts) {
      out.push({
        ...s,
        categoryId: cat.id,
        categoryLabel: cat.label,
      });
    }
  }
  return out;
}

module.exports = {
  FB_GROUP_SCRIPT_CATEGORIES,
  listFbGroupScriptsFlat,
};
