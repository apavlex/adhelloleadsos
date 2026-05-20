/**
 * Personalized Outreach Generator
 *
 * Generates personalized outreach messages based on:
 * - Business type and category
 * - Detected buying signals
 * - GBP audit score
 * - Outreach channel (email, LinkedIn, phone script)
 *
 * Templates are designed for home service businesses and reference
 * specific problems the prospect is likely facing.
 */

const { getServices } = require('./demoGenerator');

// ── Email Templates ───────────────────────────────────────────────────────────

const emailTemplates = {
  /**
   * Signal-based outreach — references a specific buying signal.
   */
  signalBased: (business, signals, demoUrl) => {
    const topSignal = signals.find(s => s.category === 'buying_signal') || signals[0];
    const signalLine = topSignal ? getSignalLine(topSignal) : '';

    return {
      subject: `${business.title} — quick idea for ${business.city}`,
      body: `Hi there,

I was looking at ${business.title}'s Google listing for ${business.city} and noticed something interesting.

${signalLine}

I built a quick 60-second demo showing how ${business.title} could capture more leads from Google — especially the ones that are slipping through right now.

${demoUrl ? `Demo: ${demoUrl}` : ''}

Worth a quick look? No pitch, just a demo.

Best,
Alex Pavlenko
AdHello — AI for Home Service Businesses`,
    };
  },

  /**
   * GBP audit-based outreach — references specific GBP issues.
   */
  auditBased: (business, auditScore, topIssue, demoUrl) => {
    const urgency = auditScore < 40 ? 'urgent' : auditScore < 60 ? 'important' : 'helpful';

    return {
      subject: `${business.title}'s Google listing is leaving money on the table`,
      body: `Hi there,

I did a quick audit of ${business.title}'s Google Business Profile in ${business.city} — scored it ${auditScore}/100.

The biggest issue: ${topIssue || 'incomplete profile and missing reviews'}.

Here's what that means in plain English: when someone searches for "${business.categoryName || 'your service'}" in ${business.city}, your competitors are showing up above you. Every day that goes by, you're losing calls to them.

I built a quick demo showing exactly how to fix this:
${demoUrl || '[Demo link]'}

Want me to walk you through it? 2 minutes, no pitch.

Best,
Alex Pavlenko
AdHello — We help home service businesses dominate Google`,
    };
  },

  /**
   * Problem-first outreach — leads with a specific problem.
   */
  problemFirst: (business, problemType = 'leads') => {
    const problems = {
      leads: {
        problem: `Most ${business.categoryName || 'home service'} businesses in ${business.city} are losing 50-70% of their leads`,
        cause: 'because they don\'t follow up fast enough',
        solution: 'I built an AI tool that responds to every lead in under 60 seconds — even at 2am',
      },
      reviews: {
        problem: `Your competitors in ${business.city} have 3x more Google reviews than you`,
        cause: 'because they have an automated system asking every customer',
        solution: 'I can set up the same system for you — it gets 5-10 new reviews per month on autopilot',
      },
      website: {
        problem: `When I searched for "${business.categoryName || 'your service'}" in ${business.city}, your website didn't show up on page 1`,
        cause: 'because your site isn\'t optimized for local search',
        solution: 'I built a tool that fixes this in about 2 hours',
      },
      ads: {
        problem: `Businesses in ${business.city} are spending $3,000-8,000/mo on Google Ads`,
        cause: 'because they know every click is a potential customer',
        solution: 'But most of them are wasting 30-40% of that spend. I built an AI tool that optimizes ad targeting automatically',
      },
    };

    const p = problems[problemType] || problems.leads;

    return {
      subject: `Quick question about ${business.title}`,
      body: `Hi there,

${p.problem}.

Why? ${p.cause}.

${p.solution}.

I put together a 60-second demo showing exactly how it works for a ${business.categoryName || 'home service'} business in ${business.city}:
[Demo link]

Worth a look?

Best,
Alex Pavlenko
AdHello — AI for Home Service Businesses`,
    };
  },

  /**
   * Follow-up sequence — day 3, 7, 14.
   */
  followUp: (business, day, demoUrl) => {
    const templates = {
      3: {
        subject: `Re: ${business.title} — quick follow-up`,
        body: `Hi there,

Just following up on my note about ${business.title}'s Google presence in ${business.city}.

Did you get a chance to check out the demo? It shows exactly how to capture more leads from Google.

${demoUrl ? `Demo: ${demoUrl}` : ''}

Happy to answer any questions.

Best,
Alex`,
      },
      7: {
        subject: `${business.title} — one more thing`,
        body: `Hi there,

I know you're busy running ${business.title}, so I'll keep this short.

One thing I noticed: your top competitor in ${business.city} has [X] more Google reviews than you. That's probably why they're showing up first when people search.

The good news? It's fixable. And I can help.

${demoUrl ? `Demo: ${demoUrl}` : ''}

Worth a 2-minute look?

Best,
Alex Pavlenko`,
      },
      14: {
        subject: `Last note about ${business.title}`,
        body: `Hi there,

Last note from me — I promise.

I've been helping ${business.categoryName || 'home service'} businesses in ${business.city} get more leads from Google. The results have been solid: one client went from 12 to 47 reviews in 60 days, another is getting 15 more calls per week.

If you're ever interested, here's the demo:
${demoUrl || '[Demo link]'}

No pressure either way. Good luck with ${business.title}!

Best,
Alex Pavlenko
AdHello`,
      },
    };

    return templates[day] || templates[3];
  },
};

// ── LinkedIn DM Templates ─────────────────────────────────────────────────────

const linkedinTemplates = {
  short: (business, signal) => {
    const signalText = signal ? `Noticed ${signal.description.toLowerCase()}.` : `Came across ${business.title} in ${business.city}.`;

    return `${signalText} Built a quick AI demo showing how ${business.categoryName || 'home service'} businesses can capture more leads from Google. Worth a 60-second look?`;
  },

  valueFirst: (business) => {
    return `Hey — I was looking at ${business.title}'s Google listing and put together a free audit showing what's working and what's missing. Happy to share it if you're interested. No pitch, just insights.`;
  },
};

// ── Phone Scripts ─────────────────────────────────────────────────────────────

const phoneScripts = {
  cold: (business) => ({
    opening: `Hi, is this ${business.title}? This is Alex with AdHello — we help ${business.categoryName || 'home service'} businesses in ${business.city} get more leads from Google. Do you have 30 seconds?`,
    value: `Great. Quick question: when someone searches for "${business.categoryName || 'your service'}" in ${business.city} right now, does ${business.title} show up on the first page of Google Maps?`,
    pain: `That's actually really common. Most businesses in ${business.city} are losing 50-70% of their Google leads to competitors who have better profiles. The good news is it's fixable.`,
    cta: `I put together a quick 60-second demo showing exactly how to fix it for ${business.title}. Can I text you the link?`,
    objectionHandling: {
      'not interested': `Totally understand. Just so you know, the demo is only 60 seconds and it shows exactly what your competitors are doing differently. If it's not useful, no harm done. Can I send it?`,
      'too busy': `I get it — you're running a business. That's exactly why I built this. It takes 60 seconds to watch and it could save you hours of missed calls. Can I text you the link?`,
      'already have a guy': `That's great. This isn't about replacing anyone — it's about making sure you're not leaving money on the table. The demo shows what a complete Google strategy looks like. Worth a quick look?`,
      'send me info': `Absolutely. What's the best email? I'll send over the demo and a quick audit of your Google listing.`,
    },
  }),

  warm: (business, signal) => ({
    opening: `Hi, this is Alex with AdHello. I was looking at ${business.title}'s Google listing and noticed ${signal ? signal.description.toLowerCase() : 'some opportunities to get more leads'}. Do you have 30 seconds?`,
    value: `I help ${business.categoryName || 'home service'} businesses in ${business.city} capture more leads from Google. I built a quick demo specifically for ${business.title} — want to see it?`,
    cta: `I'll text you the link. It's 60 seconds and shows exactly how to get more calls from Google. What's the best number?`,
  }),
};

// ── Helper Functions ──────────────────────────────────────────────────────────

function getSignalLine(signal) {
  const lines = {
    hiring: `Looks like you're hiring — that usually means lead response times start slipping. I built a tool that handles lead follow-up automatically so you never miss a hot lead, even when your team is busy.`,
    google_ads: `I can see you're running Google Ads — smart move. But most businesses waste 30-40% of their ad spend on the wrong clicks. I built an AI tool that optimizes targeting automatically.`,
    new_website: `I noticed you recently got a new website — nice! But a great website doesn't help if Google isn't sending you traffic. I built a tool that fixes that.`,
    reviews_low: `Your Google listing has fewer reviews than your top competitors in ${signal.businessCity || 'your area'}. That's probably why they're showing up first. I can help fix that.`,
    rating_low: `Your Google rating is below 4 stars — that's costing you calls. Most customers won't click on anything below 4 stars. I built a system that helps you get more 5-star reviews automatically.`,
    no_website: `Your Google listing doesn't have a website linked — that's a missed opportunity. Businesses with websites get 3x more customer actions from Google.`,
    no_social: `Your Google listing is missing social media links. That's a free win for local SEO that most businesses overlook.`,
  };
  return lines[signal.type] || `I noticed ${signal.description.toLowerCase()}. I built a quick tool that can help with that.`;
}

/**
 * Generate a complete outreach package for a business.
 */
function generateOutreachPackage(business, options = {}) {
  const {
    signals = [],
    auditScore = null,
    topIssue = null,
    demoUrl = null,
    channel = 'email',
    template = 'signalBased',
  } = options;

  const result = {
    business: {
      title: business.title,
      category: business.categoryName,
      city: business.city,
      state: business.state,
      phone: business.phone,
      email: business.email,
      website: business.website,
    },
    signals,
    auditScore,
    generatedAt: new Date().toISOString(),
  };

  // Generate email
  if (channel === 'email' || channel === 'all') {
    if (template === 'signalBased' && signals.length > 0) {
      result.email = emailTemplates.signalBased(business, signals, demoUrl);
    } else if (template === 'auditBased' && auditScore !== null) {
      result.email = emailTemplates.auditBased(business, auditScore, topIssue, demoUrl);
    } else if (template === 'problemFirst') {
      result.email = emailTemplates.problemFirst(business, options.problemType);
    } else {
      result.email = emailTemplates.signalBased(business, signals, demoUrl);
    }

    // Add follow-up sequence
    result.followUps = {
      day3: emailTemplates.followUp(business, 3, demoUrl),
      day7: emailTemplates.followUp(business, 7, demoUrl),
      day14: emailTemplates.followUp(business, 14, demoUrl),
    };
  }

  // Generate LinkedIn DM
  if (channel === 'linkedin' || channel === 'all') {
    result.linkedin = {
      short: linkedinTemplates.short(business, signals[0]),
      valueFirst: linkedinTemplates.valueFirst(business),
    };
  }

  // Generate phone script
  if (channel === 'phone' || channel === 'all') {
    result.phone = signals.length > 0
      ? phoneScripts.warm(business, signals[0])
      : phoneScripts.cold(business);
  }

  return result;
}

module.exports = {
  emailTemplates,
  linkedinTemplates,
  phoneScripts,
  generateOutreachPackage,
  getSignalLine,
};
