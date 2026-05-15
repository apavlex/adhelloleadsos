/**
 * Ranked "who to contact today" rows for /today — Focus queue + next cadence channel/hint.
 */

const { excludeOutreachFolderLeads } = require('./leadListFilters');
const { buildFocusQueue, shortLeadKey } = require('./focusQueue');
const { getTemplate } = require('./sequenceTemplates');
const { expandCadenceText } = require('./cadenceTokens');
const { scoreLeadRecord } = require('./opportunityScore');

function channelLabel(ch) {
  const c = String(ch || 'task').toLowerCase();
  if (c === 'call') return 'Phone';
  if (c === 'email') return 'Email';
  if (c === 'sms') return 'SMS';
  if (c === 'linkedin') return 'LinkedIn';
  return c.charAt(0).toUpperCase() + c.slice(1);
}

/**
 * @param {object} lead
 * @param {string} baseUrl
 */
function nextCadencePresentation(lead, baseUrl) {
  const st = lead.sequenceState;
  const safeUrl = String(baseUrl || '').replace(/\/$/, '');

  if (st && st.status === 'completed') {
    return {
      mode: 'completed',
      channel: null,
      channelLabel: null,
      stepTitle: 'Cadence finished',
      stepHint: 'Re-engage or move pipeline stage.',
      dueAt: null,
      overdue: false,
    };
  }

  if (st && st.status === 'active') {
    const tpl = getTemplate(st.templateId);
    if (tpl && tpl.steps && tpl.steps.length && typeof st.stepIndex === 'number') {
      const idx = Math.min(Math.max(0, st.stepIndex), tpl.steps.length - 1);
      const step = tpl.steps[idx];
      if (step) {
        const dueMs = st.nextDueAt ? Date.parse(st.nextDueAt) : NaN;
        const overdue = Number.isFinite(dueMs) && dueMs < Date.now();
        return {
          mode: 'active',
          channel: step.channel || 'task',
          channelLabel: channelLabel(step.channel),
          stepTitle: expandCadenceText(step.title || '', lead, { baseUrl: safeUrl }),
          stepHint: expandCadenceText(step.hint || '', lead, { baseUrl: safeUrl }),
          dueAt: st.nextDueAt || null,
          overdue,
        };
      }
    }
  }

  const { tier, score } = scoreLeadRecord(lead);
  return {
    mode: 'none',
    channel: null,
    channelLabel: null,
    stepTitle: 'No active cadence',
    stepHint: `Opportunity ${tier} (${score.toFixed(1)}/10). Open Focus to start a sequence or call manually.`,
    dueAt: null,
    overdue: false,
  };
}

/**
 * @param {object[]} leads — workspace-visible leads
 * @param {string} baseUrl
 * @param {number} [max]
 */
function buildTodayContactQueue(leads, baseUrl, max = 20) {
  const filtered = excludeOutreachFolderLeads(Array.isArray(leads) ? leads : []);
  const ordered = buildFocusQueue(filtered, 200);
  const cap = Math.min(Math.max(5, max), 50);

  return ordered.slice(0, cap).map((lead) => {
    const scored = scoreLeadRecord(lead);
    const { tier, score, localProspect } = scored;
    const cadence = nextCadencePresentation(lead, baseUrl);
    const short = shortLeadKey(lead);
    return {
      leadKey: lead.key,
      focusParam: short,
      title: String(lead.title || lead.company || 'Lead').slice(0, 120),
      city: lead.city || '',
      state: lead.state || '',
      phone: lead.phone && lead.phone !== 'N/A' ? lead.phone : '',
      email: lead.email && lead.email !== 'N/A' ? lead.email : '',
      opportunityTier: tier,
      opportunityScore: score,
      prospectTier: localProspect.prospectTier,
      websiteStatusLabel: localProspect.websiteStatusLabel,
      prospectConfidence: localProspect.confidence,
      prospectWhy: localProspect.why,
      cadence,
    };
  });
}

module.exports = {
  buildTodayContactQueue,
  nextCadencePresentation,
  channelLabel,
};
