/**
 * Pick the highest-ROI activity for the Today "Next 30 min" hero.
 * Order favors warm engagement and money-in-motion over cold prospecting.
 */

const CLOSE_STAGE_RE =
  /\b(proposal|negotiat|qualified|meeting|booked|sent|verbal|contract|closing|close)\b/i;
const LOST_STAGE_RE = /\b(lost|disqualif|nurture|inactive|cancelled|canceled)\b/i;
const WON_STAGE_RE = /\b(won|closed won|active referrals|done|onboarded)\b/i;

function num(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

function countCloseReady(opportunityBoard) {
  const stages = opportunityBoard && Array.isArray(opportunityBoard.stages) ? opportunityBoard.stages : [];
  if (!stages.length) return { count: 0, stageName: '' };
  let count = 0;
  let stageName = '';
  stages.forEach((stage, idx) => {
    const name = String((stage && stage.name) || '');
    if (!name || LOST_STAGE_RE.test(name) || WON_STAGE_RE.test(name)) return;
    const lateByName = CLOSE_STAGE_RE.test(name);
    const lateByPosition = stages.length >= 3 && idx >= Math.max(1, stages.length - 3) && idx < stages.length - 1;
    if (!lateByName && !lateByPosition) return;
    const n = num(stage.count);
    if (n > 0 && !stageName) stageName = name;
    count += n;
  });
  return { count, stageName };
}

function countOverdueFollowUps(nextActions, followUpTasks) {
  const fromActions = (Array.isArray(nextActions) ? nextActions : []).filter(
    (a) => a && a.overdue && (a.kind === 'task' || a.kind === 'next_action' || a.kind === 'cadence'),
  ).length;
  const fromTasks = (Array.isArray(followUpTasks) ? followUpTasks : []).filter((t) => {
    if (!t || !t.scheduledAt) return false;
    const ts = Date.parse(t.scheduledAt);
    return Number.isFinite(ts) && ts < Date.now();
  }).length;
  return Math.max(fromActions, fromTasks);
}

function countDueFollowUps(nextActions, followUpTasks) {
  const dueActions = (Array.isArray(nextActions) ? nextActions : []).filter(
    (a) => a && (a.kind === 'task' || a.kind === 'next_action' || a.kind === 'cadence' || a.kind === 'engagement'),
  ).length;
  const dueTasks = (Array.isArray(followUpTasks) ? followUpTasks : []).length;
  return Math.max(dueActions, dueTasks);
}

function firstHref(list, fallback) {
  const row = Array.isArray(list) ? list.find((x) => x && x.href) : null;
  return (row && row.href) || fallback;
}

/**
 * @param {object} input
 * @returns {{
 *   id: string,
 *   eyebrow: string,
 *   headline: string,
 *   detail: string,
 *   count: number,
 *   ringLabel: string,
 *   primaryLabel: string,
 *   primaryHref: string,
 *   secondaryLabel: string,
 *   secondaryHref: string,
 *   altLabel?: string,
 *   altHref?: string,
 * }}
 */
function buildBestRoiActivity(input = {}) {
  const replies = num(input.repliesWaiting);
  const prospects = num(input.queueNeedingAction);
  const nextActions = input.nextActions || [];
  const followUps = input.followUpTasksToday || [];
  const overdueFollowUps = countOverdueFollowUps(nextActions, followUps);
  const dueFollowUps = countDueFollowUps(nextActions, followUps);
  const leadSources = input.leadSources || {};
  const website = num(leadSources.websiteCount);
  const agency = num(leadSources.agencyCount);
  const inbound = website + agency;
  const referrals = num(leadSources.referralCount);
  const poolOpen = num(leadSources.poolOpen);
  const close = countCloseReady(input.opportunityBoard);
  const fieldNeed = num(input.fieldWorkHome && input.fieldWorkHome.needAttention);
  const memberCount = num(input.networkMemberCount);
  const pendingApps = num(input.pendingApplications);

  const prospectHref = '/focus';
  const pipelineHref = '/prospecting?tab=pipeline';
  const networkReferralsHref = '/network?tab=referrals';
  const networkMembersHref = '/network?tab=members';
  const networkAppsHref = '/network?tab=applications';
  const engagementHref = firstHref(input.callWarmQueue, '/engagement');
  const followHref = firstHref(nextActions, firstHref(followUps, '/tasks'));

  // 1) Warm replies — highest ROI clock
  if (replies > 0) {
    return {
      id: 'replies',
      eyebrow: 'Best ROI · next 30 min',
      headline:
        replies === 1
          ? '1 warm reply is waiting — answer before it cools.'
          : `${replies} warm replies are waiting — answer before they cool.`,
      detail: 'Inbound replies convert faster than cold dials. Handle these first, then resume prospecting.',
      count: replies,
      ringLabel: 'Replies',
      primaryLabel: 'Answer replies',
      primaryHref: engagementHref,
      secondaryLabel: 'Open pipeline',
      secondaryHref: pipelineHref,
      altLabel: 'Network leads',
      altHref: networkReferralsHref,
    };
  }

  // 2) Overdue follow-ups
  if (overdueFollowUps > 0) {
    return {
      id: 'follow_up_overdue',
      eyebrow: 'Best ROI · next 30 min',
      headline:
        overdueFollowUps === 1
          ? '1 follow-up is overdue — clear it now.'
          : `${overdueFollowUps} follow-ups are overdue — clear them now.`,
      detail: 'Broken promises kill deals. Knock out overdue tasks before opening a new calling block.',
      count: overdueFollowUps,
      ringLabel: 'Follow-ups',
      primaryLabel: 'Clear follow-ups',
      primaryHref: followHref,
      secondaryLabel: 'Network leads',
      secondaryHref: networkReferralsHref,
    };
  }

  // 3) Inbound website / agency forms
  if (inbound > 0) {
    return {
      id: 'inbound',
      eyebrow: 'Best ROI · next 30 min',
      headline:
        inbound === 1
          ? '1 inbound lead needs a fast response.'
          : `${inbound} inbound leads need a fast response.`,
      detail: 'Website and agency deliveries are already warm. Contact them before starting cold outreach.',
      count: inbound,
      ringLabel: 'Inbound',
      primaryLabel: 'Open inbound',
      primaryHref: '/appointments',
      secondaryLabel: 'Network leads',
      secondaryHref: networkReferralsHref,
    };
  }

  // 4) Network referrals / pool
  if (referrals > 0) {
    return {
      id: 'network_referrals',
      eyebrow: 'Best ROI · next 30 min',
      headline:
        referrals === 1
          ? '1 network referral is waiting to be worked.'
          : `${referrals} network referrals are waiting to be worked.`,
      detail: poolOpen
        ? `${poolOpen} still in the open pool — route or claim them so partners stay engaged.`
        : 'Partner-sent leads convert when you respond quickly. Open Network leads next.',
      count: referrals,
      ringLabel: 'Network',
      primaryLabel: 'Open network leads',
      primaryHref: networkReferralsHref,
      secondaryLabel: 'Find partners',
      secondaryHref: networkMembersHref,
    };
  }

  // 5) Close open deals (late pipeline)
  if (close.count > 0) {
    return {
      id: 'close_deals',
      eyebrow: 'Best ROI · next 30 min',
      headline:
        close.count === 1
          ? '1 deal is ready to push toward close.'
          : `${close.count} deals are ready to push toward close.`,
      detail: close.stageName
        ? `Focus on ${close.stageName} — proposals and late-stage deals pay more than new dials.`
        : 'Late-stage opportunities pay more than new dials. Push one forward in the next half hour.',
      count: close.count,
      ringLabel: 'To close',
      primaryLabel: 'Close deals',
      primaryHref: pipelineHref,
      secondaryLabel: 'Network leads',
      secondaryHref: networkReferralsHref,
    };
  }

  // 6) Due follow-ups (today, not overdue)
  if (dueFollowUps > 0) {
    return {
      id: 'follow_up_due',
      eyebrow: 'Best ROI · next 30 min',
      headline:
        dueFollowUps === 1
          ? '1 follow-up is due in today’s window.'
          : `${dueFollowUps} follow-ups are due in today’s window.`,
      detail: 'Work scheduled touches in order — then fill leftover minutes with prospects or partners.',
      count: dueFollowUps,
      ringLabel: 'Due',
      primaryLabel: 'Work follow-ups',
      primaryHref: followHref,
      secondaryLabel: 'Network leads',
      secondaryHref: networkReferralsHref,
    };
  }

  // 7) Grow referral partners when the network is thin or apps are pending
  if (pendingApps > 0) {
    return {
      id: 'partner_apps',
      eyebrow: 'Best ROI · next 30 min',
      headline:
        pendingApps === 1
          ? '1 partner application is waiting for review.'
          : `${pendingApps} partner applications are waiting for review.`,
      detail: 'Approving the right partners compounds referral flow — often higher ROI than another cold dial.',
      count: pendingApps,
      ringLabel: 'Apps',
      primaryLabel: 'Review applications',
      primaryHref: networkAppsHref,
      secondaryLabel: 'Network leads',
      secondaryHref: networkReferralsHref,
    };
  }

  if (memberCount > 0 && memberCount < 4) {
    return {
      id: 'find_partners',
      eyebrow: 'Best ROI · next 30 min',
      headline: 'Grow referral partners — your network is still small.',
      detail: 'A few strong partners can out-earn a full cold-calling block. Invite or recruit the next trade ally.',
      count: memberCount,
      ringLabel: 'Partners',
      primaryLabel: 'Find partners',
      primaryHref: networkMembersHref,
      secondaryLabel: 'Network leads',
      secondaryHref: networkReferralsHref,
    };
  }

  // 8) Team field work needing attention (managers)
  if (fieldNeed > 0) {
    return {
      id: 'field_work',
      eyebrow: 'Best ROI · next 30 min',
      headline:
        fieldNeed === 1
          ? '1 team job needs your attention.'
          : `${fieldNeed} team jobs need your attention.`,
      detail: 'Keep field work moving so customer jobs and reviews stay on track.',
      count: fieldNeed,
      ringLabel: 'Team',
      primaryLabel: 'Open field work',
      primaryHref: '/network?tab=field-work&fw=open',
      secondaryLabel: 'Team calendar',
      secondaryHref: '/network?tab=calendar',
    };
  }

  // 9) Cold / early-stage prospect queue
  if (prospects > 0) {
    return {
      id: 'prospects',
      eyebrow: 'Best ROI · next 30 min',
      headline:
        prospects === 1
          ? '1 prospect is ready for a focused calling block.'
          : `${prospects} prospects are ready for a focused calling block.`,
      detail: 'No warmer work is pending — run a tight session, then check Network leads for partner flow.',
      count: prospects,
      ringLabel: 'Queue',
      primaryLabel: 'Start session',
      primaryHref: prospectHref,
      secondaryLabel: 'Network leads',
      secondaryHref: networkReferralsHref,
      altLabel: 'Open pipeline',
      altHref: pipelineHref,
    };
  }

  // 10) Empty / nurture default — push network growth
  return {
    id: 'grow_network',
    eyebrow: 'Best ROI · next 30 min',
    headline: 'Fill the next 30 minutes by growing referral partners.',
    detail: 'Pipeline is quiet. Spend this block inviting partners or checking Network leads — compound ROI over cold volume.',
    count: 0,
    ringLabel: 'Focus',
    primaryLabel: 'Open network leads',
    primaryHref: networkReferralsHref,
    secondaryLabel: 'Find partners',
    secondaryHref: networkMembersHref,
  };
}

module.exports = {
  buildBestRoiActivity,
  countCloseReady,
  CLOSE_STAGE_RE,
};
