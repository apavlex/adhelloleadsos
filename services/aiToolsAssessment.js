/**
 * AI Tools Assessment — generates slide-deck content from lead + audit data.
 * Output shape matches views/ai_tools_report.ejs fields.
 */

const { chatCompletion } = require('./llmClient');

const SYSTEM_PROMPT = `You are a senior operations consultant preparing an "AI Tools Assessment" deck for a local business owner.
Return ONLY valid JSON matching this exact shape (fill every string; use realistic estimates for a small service business):

{
  "accent": "#F06000",
  "clientName": "Business name",
  "assessmentDate": "Month DD, YYYY",
  "businessType": "e.g. House cleaning · Seattle",
  "primaryFocus": "Short focus area (5-8 words)",
  "pain": "2-3 sentences on operational pain from their digital/ops gaps",
  "outcome": "2-3 sentences on outcome after implementing AI tools",
  "hoursReclaimed": "12",
  "quickWins": [
    { "pain": "Problem statement", "fix": "Tool-led fix" }
  ],
  "solutions": [
    { "tool": "Tool name", "use": "One sentence use case", "cost": "$X/mo", "setup": "X hrs", "saves": "X hrs/wk" }
  ],
  "plan": [
    { "task": "Day task description", "tool": "Tool name" }
  ],
  "after": [
    { "text": "Next-phase initiative", "tool": "Tool or system" }
  ],
  "financial": {
    "monthlyRoi": "$2,400",
    "monthlyRoiCap": "Net monthly value after tool costs",
    "weeklyTime": "12<span class=\\"u\\">hrs</span>",
    "weeklyTimeCap": "Admin + follow-up time returned",
    "monthlyToolCost": "$180",
    "monthlyToolCostCap": "All recommended tools combined"
  },
  "nextSteps": {
    "step1Title": "Review this assessment",
    "step1Desc": "Walk through quick wins and pick your start date.",
    "step2Title": "Schedule your review call",
    "step2Desc": "Book 30 minutes to prioritize tools and rollout."
  }
}

Rules:
- quickWins: exactly 6 items, concrete and specific to the business category.
- solutions: exactly 6 items; mix CRM, scheduling, AI writing, reviews, phone, automation as appropriate.
- plan: exactly 4 day-one through day-four rollout tasks.
- after: exactly 3 next-phase items.
- hoursReclaimed: numeric string only (no units) for the hero stat.
- financial.monthlyRoi and monthlyToolCost: include $; weeklyTime may include HTML <span class="u">hrs</span> suffix inside the big number cell.
- Tone: direct, owner-friendly, no jargon. Reference their website/ops gaps when data supports it.`;

function padList(list, count, factory) {
  const out = Array.isArray(list) ? list.slice(0, count) : [];
  while (out.length < count) out.push(factory(out.length));
  return out;
}

function formatAssessmentDate(d) {
  try {
    return new Date(d).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  } catch {
    return new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  }
}

function emptyAssessment() {
  return {
    accent: '#F06000',
    clientName: '',
    assessmentDate: formatAssessmentDate(new Date()),
    businessType: '',
    primaryFocus: '',
    pain: '',
    outcome: '',
    hoursReclaimed: '',
    quickWins: padList([], 6, () => ({ pain: '', fix: '' })),
    solutions: padList([], 6, () => ({ tool: '', use: '', cost: '', setup: '', saves: '' })),
    plan: padList([], 4, () => ({ task: '', tool: '' })),
    after: padList([], 3, () => ({ text: '', tool: '' })),
    financial: {
      monthlyRoi: '',
      monthlyRoiCap: '',
      weeklyTime: '',
      weeklyTimeCap: '',
      monthlyToolCost: '',
      monthlyToolCostCap: '',
    },
    nextSteps: {
      step1Title: 'Review this assessment',
      step1Desc: '',
      step2Title: 'Schedule your review call',
      step2Desc: '',
    },
    generatedAt: new Date().toISOString(),
    source: 'manual',
  };
}

function buildLeadContext(lead) {
  const l = lead || {};
  const a = l.aiWebsiteAnalysis && typeof l.aiWebsiteAnalysis === 'object' ? l.aiWebsiteAnalysis : {};
  const ps = l.pageSpeedAudit && typeof l.pageSpeedAudit === 'object' ? l.pageSpeedAudit : {};
  const city = [l.city, l.state].filter(Boolean).join(', ');
  return {
    businessName: String(l.title || l.companyName || 'Business').trim(),
    category: String(l.categoryName || l.category || 'Local service').trim(),
    city,
    website: String(l.website || l.url || '').trim(),
    phone: String(l.phone || '').trim(),
    address: String(l.address || '').trim(),
    ownerSignal: String(l.ownerSignal || '').trim(),
    siteHealth100: a.siteHealth100 ?? null,
    analysisScore: a.analysisScore ?? null,
    topGapLabels: Array.isArray(a.topGapLabels) ? a.topGapLabels : [],
    pageSpeedAvg: ps.averageScore ?? null,
    pageSpeedIssues: Array.isArray(ps.topIssues) ? ps.topIssues.slice(0, 6) : [],
    aiReadinessScore: l.aiReadinessScore ?? null,
    aiReadinessGrade: l.aiReadinessGrade ?? null,
    reviewsCount: l.reviewsCount ?? null,
    rating: l.totalScore ?? l.rating ?? null,
  };
}

function buildHeuristicAssessment(lead) {
  const ctx = buildLeadContext(lead);
  const base = emptyAssessment();
  const catLine = ctx.city ? `${ctx.category} · ${ctx.city}` : ctx.category;

  base.clientName = ctx.businessName;
  base.businessType = catLine;
  base.primaryFocus = ctx.ownerSignal
    ? ctx.ownerSignal.split(/[.!?]/)[0].slice(0, 60)
    : 'Automate follow-up & booking';

  const gaps = ctx.topGapLabels.length ? ctx.topGapLabels : ctx.pageSpeedIssues;
  base.pain =
    gaps.length > 0
      ? `Your team is losing time on manual follow-up while ${gaps.slice(0, 2).join(' and ').toLowerCase()} slow down new leads from your website.`
      : `Manual scheduling, follow-up, and review requests are eating hours your team could spend on billable work.`;

  base.outcome =
    'Implementing the recommended AI tools below can automate intake, follow-up, and reporting — so more leads convert without adding headcount.';

  base.hoursReclaimed = '10';

  const winSeeds = [
    { pain: 'Missed calls and slow text follow-up', fix: 'AI phone + SMS assistant with call summaries' },
    { pain: 'Quotes and estimates take too long', fix: 'Template + AI quote builder tied to your CRM' },
    { pain: 'Review requests are inconsistent', fix: 'Automated post-job review SMS with one-tap Google link' },
    { pain: 'Scheduling back-and-forth', fix: 'Online booking + calendar sync' },
    { pain: 'No visibility on lead source ROI', fix: 'Simple dashboard tying calls to booked jobs' },
    { pain: 'Repetitive admin email', fix: 'AI draft for confirmations and follow-ups' },
  ];
  if (ctx.pageSpeedIssues[0]) {
    winSeeds[0].pain = `Website issue: ${ctx.pageSpeedIssues[0]}`;
    winSeeds[0].fix = 'Fix core site speed + add click-to-call and booking CTA';
  }
  base.quickWins = padList(winSeeds, 6, (i) => ({
    pain: `Operational gap ${i + 1}`,
    fix: 'AI-assisted workflow',
  }));

  base.solutions = padList(
    [
      { tool: 'AI Phone Agent', use: 'Answers after-hours, books callbacks, logs to CRM', cost: '$99/mo', setup: '2 hrs', saves: '4 hrs/wk' },
      { tool: 'Review Automation', use: 'Post-job SMS with Google review link', cost: '$49/mo', setup: '1 hr', saves: '2 hrs/wk' },
      { tool: 'Booking Scheduler', use: 'Self-serve booking synced to calendar', cost: '$29/mo', setup: '2 hrs', saves: '3 hrs/wk' },
      { tool: 'CRM + Pipeline', use: 'Track every lead from first touch to close', cost: '$45/mo', setup: '3 hrs', saves: '2 hrs/wk' },
      { tool: 'AI Email Assistant', use: 'Draft confirmations and follow-ups', cost: '$20/mo', setup: '1 hr', saves: '1 hr/wk' },
      { tool: 'Reporting Dashboard', use: 'See calls, bookings, and ad ROI weekly', cost: '$35/mo', setup: '2 hrs', saves: '1 hr/wk' },
    ],
    6,
    () => ({ tool: '', use: '', cost: '', setup: '', saves: '' }),
  );

  base.plan = padList(
    [
      { task: 'Connect phone + CRM; turn on call logging', tool: 'AI Phone Agent' },
      { task: 'Launch review SMS after completed jobs', tool: 'Review Automation' },
      { task: 'Add booking link to site and Google profile', tool: 'Booking Scheduler' },
      { task: 'Review dashboard and assign owner for weekly check-in', tool: 'Reporting Dashboard' },
    ],
    4,
    () => ({ task: '', tool: '' }),
  );

  base.after = padList(
    [
      { text: 'Automate quote follow-up sequences', tool: 'CRM automations' },
      { text: 'Add AI chat on website for after-hours leads', tool: 'Web chat agent' },
      { text: 'Benchmark against top local competitors', tool: 'Market intel pass' },
    ],
    3,
    () => ({ text: '', tool: '' }),
  );

  base.financial = {
    monthlyRoi: '$2,200',
    monthlyRoiCap: 'Estimated net value from time saved + extra booked jobs',
    weeklyTime: '10<span class="u">hrs</span>',
    weeklyTimeCap: 'Admin and follow-up time returned to the team',
    monthlyToolCost: '$277',
    monthlyToolCostCap: 'Combined monthly cost for recommended stack',
  };

  base.nextSteps = {
    step1Title: 'Review this assessment with your team',
    step1Desc: 'Pick 2–3 quick wins to start this week.',
    step2Title: 'Schedule your review call',
    step2Desc: 'Book 30 minutes to finalize tools and rollout dates.',
  };
  base.source = 'heuristic';
  return base;
}

function normalizeAssessment(raw, lead) {
  const base = emptyAssessment();
  const r = raw && typeof raw === 'object' ? raw : {};
  const fin = r.financial && typeof r.financial === 'object' ? r.financial : {};
  const ns = r.nextSteps && typeof r.nextSteps === 'object' ? r.nextSteps : {};

  base.accent = String(r.accent || base.accent).trim() || '#F06000';
  base.clientName = String(r.clientName || lead?.title || '').trim();
  base.assessmentDate = String(r.assessmentDate || base.assessmentDate).trim();
  base.businessType = String(r.businessType || '').trim();
  base.primaryFocus = String(r.primaryFocus || r.primary_focus || '').trim();
  base.pain = String(r.pain || '').trim();
  base.outcome = String(r.outcome || '').trim();
  base.hoursReclaimed = String(r.hoursReclaimed || r.hours_reclaimed || '').trim();

  base.quickWins = padList(
    (r.quickWins || r.quick_wins || []).map((w) => ({
      pain: String((w && w.pain) || '').trim(),
      fix: String((w && w.fix) || '').trim(),
    })),
    6,
    () => ({ pain: '', fix: '' }),
  );

  base.solutions = padList(
    (r.solutions || []).map((s) => ({
      tool: String((s && s.tool) || '').trim(),
      use: String((s && s.use) || '').trim(),
      cost: String((s && s.cost) || '').trim(),
      setup: String((s && s.setup) || '').trim(),
      saves: String((s && s.saves) || '').trim(),
    })),
    6,
    () => ({ tool: '', use: '', cost: '', setup: '', saves: '' }),
  );

  base.plan = padList(
    (r.plan || []).map((p) => ({
      task: String((p && p.task) || '').trim(),
      tool: String((p && p.tool) || '').trim(),
    })),
    4,
    () => ({ task: '', tool: '' }),
  );

  base.after = padList(
    (r.after || []).map((a) => ({
      text: String((a && a.text) || '').trim(),
      tool: String((a && a.tool) || '').trim(),
    })),
    3,
    () => ({ text: '', tool: '' }),
  );

  base.financial = {
    monthlyRoi: String(fin.monthlyRoi || fin.monthly_roi || '').trim(),
    monthlyRoiCap: String(fin.monthlyRoiCap || fin.monthly_roi_cap || '').trim(),
    weeklyTime: String(fin.weeklyTime || fin.weekly_time || '').trim(),
    weeklyTimeCap: String(fin.weeklyTimeCap || fin.weekly_time_cap || '').trim(),
    monthlyToolCost: String(fin.monthlyToolCost || fin.monthly_tool_cost || '').trim(),
    monthlyToolCostCap: String(fin.monthlyToolCostCap || fin.monthly_tool_cost_cap || '').trim(),
  };

  base.nextSteps = {
    step1Title: String(ns.step1Title || ns.step1_title || base.nextSteps.step1Title).trim(),
    step1Desc: String(ns.step1Desc || ns.step1_desc || '').trim(),
    step2Title: String(ns.step2Title || ns.step2_title || base.nextSteps.step2Title).trim(),
    step2Desc: String(ns.step2Desc || ns.step2_desc || '').trim(),
  };

  base.generatedAt = r.generatedAt || new Date().toISOString();
  base.source = r.source || 'ai';
  return base;
}

async function generateAssessment(lead) {
  const ctx = buildLeadContext(lead);
  if (!ctx.businessName) return buildHeuristicAssessment(lead);

  const userMessage = `Generate an AI Tools Assessment for this business:\n${JSON.stringify(ctx, null, 2)}`;

  const { content, error } = await chatCompletion({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
    jsonObject: true,
    max_tokens: 3500,
    temperature: 0.35,
  });

  if (error || !content) {
    return buildHeuristicAssessment(lead);
  }

  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object') {
      return buildHeuristicAssessment(lead);
    }
    const normalized = normalizeAssessment(parsed, lead);
    normalized.source = 'ai';
    return normalized;
  } catch (e) {
    console.warn('[aiToolsAssessment] parse failed:', e.message);
    return buildHeuristicAssessment(lead);
  }
}

function mergeAssessment(stored, patch) {
  if (!patch || typeof patch !== 'object') return normalizeAssessment(stored, null);
  return normalizeAssessment({ ...(stored || {}), ...patch }, stored);
}

module.exports = {
  emptyAssessment,
  buildHeuristicAssessment,
  generateAssessment,
  normalizeAssessment,
  mergeAssessment,
  buildLeadContext,
};
