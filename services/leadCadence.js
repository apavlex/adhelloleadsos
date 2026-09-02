const dbService = require('./database');
const sequenceEngine = require('./sequenceEngine');
const { isAgencySalesWorkspace } = require('./leadPanelWorkspace');
const { isAuditCadenceTemplate } = require('./sequenceTemplates');

function includesAny(haystack, needles) {
  const h = String(haystack || '').toLowerCase();
  return needles.some((n) => h.includes(n));
}

function agencyCadenceAllowed(opts = {}) {
  if (opts.agency === true) return true;
  if (opts.agency === false) return false;
  if (opts.workspace) return isAgencySalesWorkspace(opts.workspace);
  return false;
}

/**
 * Default for cold local SMB + audit hook: 14-day / 8-touch `audit_local_14` (agency only).
 * Keeps Clay for high-touch hospitality; Bob for regulated verticals.
 */
function recommendCadenceTemplate(lead, workspaceLeads, opts = {}) {
  const agency = agencyCadenceAllowed(opts);
  const category = String((lead && lead.categoryName) || '').toLowerCase();
  const source = String((lead && lead.source) || '').toLowerCase();
  const reviews = parseInt((lead && lead.reviewsCount) || 0, 10) || 0;
  const rating = parseFloat((lead && lead.totalScore) || 0) || 0;
  const hasChat = lead && (lead.hasChatbot === true || lead.hasChatbot === 'true');
  const hasSocial =
    !!(lead && lead.facebook && lead.facebook !== 'N/A') ||
    !!(lead && lead.instagram && lead.instagram !== 'N/A');

  const all = Array.isArray(workspaceLeads) ? workspaceLeads : [];
  const won = all.filter(
    (x) =>
      x &&
      String(x.status || '').toLowerCase().includes('closed - won') &&
      String(x.categoryName || '').trim(),
  );
  const wonCategoryMatches = won.filter((x) => {
    const c = String(x.categoryName || '').toLowerCase();
    return c && category && c === category;
  });

  if (includesAny(category, ['law', 'legal', 'medical', 'dental', 'enterprise', 'finance'])) {
    return { templateId: 'bob_standard', family: 'enterprise_careful' };
  }
  if (includesAny(category, ['restaurant', 'cafe', 'bar', 'food'])) {
    if (reviews < 40 || rating < 4.3 || !hasChat || !hasSocial) {
      return { templateId: 'clay_standard', family: 'reputation_social' };
    }
  }
  if (source.startsWith('adhello_') || source === 'booking' || source.startsWith('booking_')) {
    return { templateId: agency ? 'audit_hot_5' : 'clay_standard', family: agency ? 'warm_inbound' : 'warm_inbound_non_agency' };
  }
  if (wonCategoryMatches.length >= 2) {
    const winsByTemplate = new Map();
    wonCategoryMatches.forEach((x) => {
      const t = String(x.sequenceState && x.sequenceState.templateId ? x.sequenceState.templateId : '');
      if (!t) return;
      winsByTemplate.set(t, (winsByTemplate.get(t) || 0) + 1);
    });
    const top = [...winsByTemplate.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top && top[0]) {
      const templateId = top[0];
      if (!agency && isAuditCadenceTemplate(templateId)) {
        return { templateId: 'clay_standard', family: 'won_history_non_agency' };
      }
      return { templateId, family: 'won_history_match' };
    }
  }

  if (
    includesAny(category, [
      'hvac',
      'plumb',
      'electric',
      'roof',
      'paint',
      'landscap',
      'clean',
      'contract',
      'remodel',
      'garage',
      'pest',
      'locksmith',
      'tow',
      'pool',
      'fence',
      'concrete',
      'handyman',
      'service',
    ])
  ) {
    return {
      templateId: agency ? 'audit_local_14' : 'clay_standard',
      family: agency ? 'audit_local_trade' : 'local_trade_non_agency',
    };
  }

  return {
    templateId: agency ? 'audit_local_14' : 'clay_standard',
    family: agency ? 'audit_local_default' : 'local_default_non_agency',
  };
}

async function autoAttachCadenceIfNeeded({ leadKey, workspaceId }) {
  const fullKey = String(leadKey || '').startsWith('lead:') ? String(leadKey) : `lead:${leadKey}`;
  const lead = await dbService.getLead(fullKey);
  if (!lead) return { attached: false, reason: 'missing_lead' };
  if (lead.sequenceState && lead.sequenceState.status && lead.sequenceState.status !== 'completed') {
    return { attached: false, reason: 'already_active' };
  }
  const wid = String(workspaceId || lead.workspaceId || '').trim();
  const ws = wid ? await dbService.getWorkspace(wid) : null;
  const all = await dbService.getAllLeads(wid || workspaceId);
  const rec = recommendCadenceTemplate(lead, all, { workspace: ws });
  if (!rec || !rec.templateId) return { attached: false, reason: 'no_template' };
  if (isAuditCadenceTemplate(rec.templateId) && !isAgencySalesWorkspace(ws)) {
    return { attached: false, reason: 'audit_cadence_non_agency' };
  }
  await sequenceEngine.startSequence(fullKey, rec.templateId);
  await dbService.updateLead(fullKey, {
    cadenceAuto: {
      templateId: rec.templateId,
      family: rec.family,
      attachedAt: new Date().toISOString(),
    },
    logs: [
      {
        type: 'cadence_auto_attach',
        message: `Auto-attached cadence ${rec.templateId} (${rec.family})`,
        timestamp: new Date().toISOString(),
      },
    ],
  });
  return { attached: true, templateId: rec.templateId, family: rec.family };
}

module.exports = {
  recommendCadenceTemplate,
  autoAttachCadenceIfNeeded,
};
