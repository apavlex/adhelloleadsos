const { isAgencyOrLocalGuideWorkspace } = require('./socialPostProfile');

function agencyTemplates(n) {
  return {
    instagram: [
      { hook: `Most ${n} owners don't realize this one Google setting is costing them customers...`, carousel: true, cta: 'Save this for later 🔖' },
      { hook: `Before / After: How a ${n} company went from invisible to fully booked`, carousel: true, cta: 'Link in bio to get your free audit' },
      { hook: `3 things your ${n} website is doing wrong (that you can fix today)`, carousel: true, cta: 'Follow for more tips that actually work' },
      { hook: `"We didn't know we were losing customers to Google" — a ${n} owner's story`, story: true, cta: 'DM us AUDIT for your free report' },
      { hook: `The #1 reason ${n} businesses don't show up on Google Maps (it's not what you think)`, single: true, cta: 'Share this with a ${n} owner who needs to see it' },
      { hook: `${n} owners: Here's exactly what happened when we optimized their Google listing (real numbers)`, carousel: true, cta: 'Want these results? Link in bio.' },
      { hook: `Stop losing ${n} leads to competitors who show up higher on Google`, single: true, cta: 'Comment LEADS and we will send you the fix' },
    ],
    facebook: [
      { hook: `Educational: Why most ${n} businesses lose calls to whoever shows up first on Google Maps (and how to check your listing in 2 minutes)`, educational: true, cta: 'Save & share with a ${n} owner' },
      { hook: `Free lesson for ${n} owners: reviews that mention your service + city beat a higher star rating with vague praise`, educational: true, cta: 'Comment REVIEW for a 1-sentence ask template' },
      { hook: `Teach-back: 3 Google Business Profile basics every ${n} owner should fix before spending on ads`, educational: true, cta: 'Like if this was useful — share in your local groups' },
      { hook: `What ${n} customers actually do when they search "near me" — and why the map pack wins`, educational: true, cta: 'Tag a friend who runs a ${n} business' },
      { hook: `${n} tip: if your site takes longer than 3 seconds on mobile, fix speed before buying more ads`, educational: true, cta: 'Comment SPEED for free tools to check' },
      { hook: `Checklist post: claim listing → fresh photos → review ask. The ${n} visibility loop that compounds`, educational: true, cta: 'Share this on your profile or in a group' },
    ],
    facebook_group: [
      { hook: `Quick tip for this group: when people search for ${n} nearby, Google usually shows 3 businesses first. Here's how to check if you're one of them.`, educational: true, group: true, cta: 'Comment VISIBLE if you want the 3-step check' },
      { hook: `Educational post for local owners: a 4.9 with 12 reviews often loses to a 4.6 with 80. Volume + recency matter for ${n}.`, educational: true, group: true, cta: 'Drop REVIEW if you want a text template to ask customers' },
      { hook: `Something useful for ${n} folks here: your Google profile photos and categories often matter more than a fancy website for phone calls.`, educational: true, group: true, cta: 'Happy to share a short checklist — comment CHECKLIST' },
      { hook: `Group question + tip: what's helped YOU get more local ${n} leads — reviews, photos, Google posts, or referrals? Here's one tip that usually helps…`, educational: true, group: true, cta: 'Reply with what worked for you' },
      { hook: `No-pitch tip for ${n} owners in this group: open your listing on mobile cellular and time how long until Call is tappable.`, educational: true, group: true, cta: 'Comment SPEED if yours felt slow' },
      { hook: `Sharing a free ${n} visibility checklist I use with local owners (Google listing, photos, reviews, homepage city+service).`, educational: true, group: true, cta: "Comment CHECKLIST and I'll send it" },
    ],
    linkedin: [
      { hook: `I audited 100 ${n} businesses last month. 83 of them had the same problem:`, long: true, cta: 'What is the biggest marketing challenge in your industry? 👇' },
      { hook: `The ${n} industry is being disrupted by one thing: Google's local algorithm. ${n} owners who understand this will thrive. Those who don't will close.`, long: true, cta: 'Agree or disagree? Share your thoughts below.' },
      { hook: `After working with 200+ ${n} businesses, here are the 5 patterns I see in the ones that grow vs. the ones that stagnate:`, long: true, cta: `Pattern #1: They treat their Google Business Profile like a billboard, not a brochure.` },
      { hook: `Most ${n} owners think marketing is ads. It's not. It's being found when someone desperately needs you right now.`, long: true, cta: 'If you run a ${n} business, I wrote a free guide. Link in comments.' },
      { hook: `The average ${n} business loses $4,200/month to poor online visibility. Here's the math:`, long: true, cta: 'Want to know your number? Free audit — link in bio.' },
      { hook: `Just saw a ${n} competitor go from page 5 to #1 on Google Maps in 90 days. Here's exactly what they did (and what you can steal):`, long: true, cta: 'Steal this playbook — link in comments 👇' },
    ],
    x: [
      { hook: `audited 50 ${n} businesses.\n\n47 had no idea Google was hiding them.\n\nthe other 3 hired me.\n\nhere's what i found 🧵`, thread: true, cta: 'want your free audit? link in bio.' },
      { hook: `${n} owners: your google business profile is either working for you or against you. there is no neutral.`, cta: 'get yours checked free → adhello.ai' },
      { hook: `the ${n} owner who shows up first on google maps gets 70% of the calls.\n\nnot the best.\n\nthe most visible.`, cta: 'thread 👇' },
      { hook: `unpopular opinion: ${n} businesses don't need more ads. they need to be findable.`, cta: 'agree? rt if this helped.' },
      { hook: `real talk: i closed 2 ${n} locations strategically to save the flagship. sometimes the best growth move is subtraction.`, cta: 'more on that below 👇' },
      { hook: `${n} industry is booming. but if you don't show up on google, the boom is going to your competitor.`, cta: 'free audit: adhello.ai' },
    ],
    tiktok: [
      { hook: `things i see every ${n} business doing wrong on google (number 3 is costing you the most money)`, short: true, cta: 'follow for part 2' },
      { hook: `showed a ${n} owner his google listing and he literally said "that's not my business"`, short: true, cta: 'dm "audit" to get yours checked free' },
      { hook: `what happens when you google "${n} near me" — most business owners have no idea`, short: true, cta: 'poof 👻 invisible' },
      { hook: `${n} business owners this is your sign to claim your google business profile if you haven't already`, short: true, cta: 'save this and pass it on' },
      { hook: `how a ${n} company went from 3 to 27 calls a week without spending a single dollar on ads`, short: true, cta: 'link in bio for the exact strategy' },
      { hook: `the truth about ${n} marketing in 2025 in 30 seconds`, short: true, cta: 'follow for the rest' },
    ],
    gmb: [
      { hook: `New on Google: Free ${n} visibility audit — see exactly what's blocking your calls`, cta: 'Book your free audit at adhello.ai' },
      { hook: `Did you know? 76% of people who search for a ${n} visit a business within 24 hours. Is yours ready?`, cta: 'Update your Google Business Profile today' },
      { hook: `We just helped a ${n} business go from invisible to #1 on Google Maps in 90 days. Here's what changed:`, cta: 'Want the same results? Link in bio.' },
      { hook: `Quick tip for ${n} owners: Add fresh photos to your Google listing every month — it boosts visibility by up to 35%`, cta: 'Save this tip and share with a ${n} owner' },
      { hook: `"I didn't know Google had a free listing for my ${n} business" — the #1 thing we hear from new clients`, cta: 'Claim yours free → adhello.ai' },
      { hook: `Holiday hours? Service update? New ${n} offering? Post it on Google Business Profile — customers see it before they call`, cta: 'Need help optimizing? DM us AUDIT' },
    ],
  };
}

function businessTemplates(n) {
  return {
    instagram: [
      { hook: `Before & after: this ${n} project changed everything for the homeowner`, carousel: true, cta: 'Save for inspo — link in bio for a free quote' },
      { hook: `3 signs you need a pro for your next ${n} job (number 2 saves the most money)`, carousel: true, cta: 'DM us for a free estimate' },
      { hook: `What ${n} customers ask us every single week — answered`, carousel: true, cta: 'Follow for more tips from our team' },
      { hook: `"We wish we'd called sooner" — a recent ${n} customer story`, story: true, cta: 'Tap link in bio to book' },
      { hook: `The #1 mistake people make when choosing a ${n} provider`, single: true, cta: 'Share with someone planning a project' },
      { hook: `How we delivered this ${n} job on time and on budget (step by step)`, carousel: true, cta: 'Ready for your project? Link in bio.' },
      { hook: `Premium ${n} without the premium price tag — here's how`, single: true, cta: 'Comment QUOTE for pricing' },
    ],
    facebook: [
      { hook: `Educational: What to know before hiring for ${n} (the questions that save money)`, educational: true, cta: 'Save & share with someone planning a project' },
      { hook: `Teach-back: 3 signs you need a pro for ${n} — and what DIY usually costs later`, educational: true, cta: 'Like if this helps — share on your profile' },
      { hook: `Local tip: the one question to ask every ${n} contractor before you hire`, educational: true, cta: 'Tag a friend planning a project' },
      { hook: `How we scope a ${n} job so homeowners aren't surprised mid-project`, educational: true, cta: 'Comment QUESTIONS for our pre-hire list' },
      { hook: `Before & after lesson from a recent ${n} project — what changed the outcome`, educational: true, cta: 'Share if you know someone starting soon' },
      { hook: `Weekend project? Don't DIY this part of ${n} — here's why (short explainer)`, educational: true, cta: 'Save for later' },
    ],
    facebook_group: [
      { hook: `Useful for homeowners in this group: 3 questions to ask before hiring anyone for ${n}.`, educational: true, group: true, cta: 'Comment QUESTIONS if you want the full list' },
      { hook: `Educational post: what "cheap" ${n} usually costs later — from someone who sees the repairs.`, educational: true, group: true, cta: 'Share with a friend planning a project' },
      { hook: `Quick tip for this group: before you hire ${n}, check recent Google photos + reviews that mention the service.`, educational: true, group: true, cta: 'What else do you check? Reply below' },
      { hook: `Sharing what we wish every ${n} customer knew before starting (no sales pitch — just the gotchas).`, educational: true, group: true, cta: 'Happy to answer honest questions in the comments' },
      { hook: `Group tip: measure twice, schedule once — how delays happen on ${n} jobs and how to avoid them.`, educational: true, group: true, cta: 'Save this for your next project' },
      { hook: `For neighbors here: red flags when hiring for ${n} (watch for #2).`, educational: true, group: true, cta: 'Add your own red flags in the comments' },
    ],
    linkedin: [
      { hook: `After 10+ years in ${n}, here are the 5 things that separate great projects from costly ones:`, long: true, cta: "What's your biggest challenge on active jobs? 👇" },
      { hook: `Why general contractors trust us for ${n} — it's not just price`, long: true, cta: 'Connect if you spec ${n} on commercial jobs.' },
      { hook: `The ${n} industry is changing. Here's what we're doing differently for our clients:`, long: true, cta: 'Agree or disagree? Comment below.' },
      { hook: `Case study: how we helped a client solve a tough ${n} challenge on schedule`, long: true, cta: 'DM for the full project breakdown.' },
      { hook: `What "quality" actually means in ${n} — from someone who does this every day`, long: true, cta: 'Follow for more field-tested insights.' },
      { hook: `Builders and GCs: 3 reasons our ${n} crew keeps getting called back`, long: true, cta: "Let's connect — link in comments." },
    ],
    x: [
      { hook: `just wrapped a ${n} job the customer said they'd been putting off for 2 years.\n\nhere's what changed their mind 🧵`, thread: true, cta: 'free quote → link in bio' },
      { hook: `hot take: cheap ${n} costs more in the long run.`, cta: 'agree? rt.' },
      { hook: `the ${n} question we get asked most:\n\n"how long will this take?"\n\nhonest answer 👇`, cta: 'thread' },
      { hook: `before you hire anyone for ${n}, ask this one question.`, cta: 'save this.' },
      { hook: `another 5-star ${n} project in the books.`, cta: 'dm for availability.' },
      { hook: `pro tip for ${n} projects: measure twice, order once.`, cta: 'follow for more.' },
    ],
    tiktok: [
      { hook: `things customers wish they knew before starting ${n} (part 1)`, short: true, cta: 'follow for part 2' },
      { hook: `POV: you finally hired a pro for ${n} and regret not doing it sooner`, short: true, cta: 'link in bio for a quote' },
      { hook: `this ${n} transformation in 30 seconds`, short: true, cta: 'save this for later' },
      { hook: `red flags when hiring for ${n} — watch for #3`, short: true, cta: 'share with a friend' },
      { hook: `how our team preps for a ${n} job (behind the scenes)`, short: true, cta: 'comment if you want more BTS' },
      { hook: `the truth about ${n} pricing in 30 seconds`, short: true, cta: 'follow for honest answers' },
    ],
    gmb: [
      { hook: `Just finished another ${n} project — see the before & after on our Google listing`, cta: 'Leave us a review if we earned it ⭐' },
      { hook: `Now booking ${n} jobs for [month]. Check our Google listing for availability and recent work`, cta: 'Message us or book online — link on our profile' },
      { hook: `5-star ${n} service in your neighborhood — here's what customers are saying on Google`, cta: 'Read our reviews and book your free estimate' },
      { hook: `Pro tip: Before you hire for ${n}, check their Google reviews and recent project photos`, cta: 'See our latest work on Google Maps' },
      { hook: `We're hiring! Experienced ${n} pros — apply through our Google Business Profile or DM us`, cta: "Share with someone who'd be a great fit" },
      { hook: `Updated hours and services — find everything you need on our Google Business Profile`, cta: 'Save our listing for your next project' },
    ],
  };
}

/**
 * @param {string} niche
 * @param {string|null} platformFilter
 * @param {{ isAgencyWorkspace?: boolean }} [opts]
 */
function generatePostIdeas(niche = '', platformFilter = null, opts = {}) {
  const subject = String(opts.contentSubject || niche || '').trim() || 'local business';
  const platforms = platformFilter
    ? [platformFilter]
    : ['instagram', 'facebook', 'facebook_group', 'linkedin', 'x', 'tiktok', 'gmb'];
  const ideas = {};
  const useAgency =
    typeof opts.isAgencyWorkspace === 'boolean'
      ? opts.isAgencyWorkspace
      : isAgencyOrLocalGuideWorkspace({
          socialPostsPreset: niche,
          coachPrompt: niche,
          name: niche,
        });
  const baseIdeas = useAgency ? agencyTemplates(subject) : businessTemplates(subject);

  for (const p of platforms) {
    if (baseIdeas[p]) {
      ideas[p] = baseIdeas[p].map((idea, i) => ({
        id: `idea_${p}_${i}`,
        ...idea,
        niche: subject,
      }));
    }
  }

  return ideas;
}

module.exports = {
  generatePostIdeas,
  agencyTemplates,
  businessTemplates,
};
