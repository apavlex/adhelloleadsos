/**
 * Map Apify business formation records to CRM leads.
 */

const { JOB_TYPES } = require('./scrapeJobTypes');

function formatPrincipalAddress(record) {
  const p = record && record.principalAddress;
  if (p && typeof p === 'object') {
    const parts = [
      String(p.street || '').trim(),
      [p.city, p.state].filter(Boolean).join(', '),
      String(p.zip || '').trim(),
    ].filter(Boolean);
    if (parts.length) return parts.join(' ').replace(/\s+/g, ' ').trim();
  }
  const parts = [
    String(record?.address || '').trim(),
    [record?.city, record?.stateCode || record?.state].filter(Boolean).join(', '),
    String(record?.postalCode || '').trim(),
  ].filter(Boolean);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function formationBuyingSignals(record) {
  const signals = [];
  const age = record?.ageInDays != null ? Number(record.ageInDays) : null;
  const entity = String(record?.entityCategory || record?.entityType || '').trim();
  if (Number.isFinite(age) && age <= 14) {
    signals.push({
      category: 'buying_signal',
      label: 'Formed in last 14 days',
      detail: record.formationDate || '',
      source: 'business_formation',
    });
  }
  if (entity) {
    signals.push({
      category: 'buying_signal',
      label: `New ${entity}`,
      detail: String(record?.businessName || '').slice(0, 120),
      source: 'business_formation',
    });
  }
  const score = record?.leadScore != null ? Number(record.leadScore) : null;
  if (Number.isFinite(score) && score >= 70) {
    signals.push({
      category: 'buying_signal',
      label: 'High formation lead score',
      detail: `${score}/100`,
      source: 'business_formation',
    });
  }
  return signals;
}

function formationToLead(record, ctx) {
  const c = ctx && typeof ctx === 'object' ? ctx : {};
  const r = record && typeof record === 'object' ? record : {};
  const businessName = String(r.businessName || r.name || '').trim();
  if (!businessName) return null;

  const stateCode = String(r.stateCode || r.state || c.state || '').trim().toUpperCase();
  const city = String(r.city || r.principalAddress?.city || c.city || '').trim() || undefined;
  const agent = r.registeredAgent && typeof r.registeredAgent === 'object' ? r.registeredAgent : {};
  const agentName = String(agent.name || '').trim();
  const registryNumber = String(r.registryNumber || r.filingNumber || r.id || '').trim();
  const signals = formationBuyingSignals(r);
  const addressLine = formatPrincipalAddress(r);

  const lead = {
    title: businessName,
    company: businessName,
    address: addressLine || undefined,
    city,
    state: stateCode || undefined,
    zip: String(r.postalCode || r.principalAddress?.zip || '').trim() || undefined,
    email: String(r.email || '').trim() || undefined,
    contactName: agentName && !agent.isOrganization ? agentName : undefined,
    categoryName: String(r.entityCategory || r.entityType || '').trim() || undefined,
    source: 'business_formation',
    jobType: JOB_TYPES.BUSINESS_FORMATIONS,
    formationRegistryId: registryNumber || undefined,
    formationEntityType: String(r.entityCategory || r.entityType || '').trim() || undefined,
    formationDate: r.formationDate || undefined,
    formationStatus: String(r.status || '').trim() || undefined,
    formationRegisteredAgent: agentName || undefined,
    formationLeadScore: r.leadScore != null ? Number(r.leadScore) : undefined,
    formationJurisdiction: String(r.jurisdiction || stateCode || '').trim() || undefined,
    formationSourceUrl: String(r.sourceUrl || '').trim() || undefined,
    buyingSignals: signals.length ? signals : undefined,
    buyingScore: signals.length ? Math.min(10, 5 + signals.length) : undefined,
    notes: [
      registryNumber ? `Registry #${registryNumber}` : '',
      r.entityCategory || r.entityType ? `Entity: ${r.entityCategory || r.entityType}` : '',
      r.formationDate ? `Formed: ${String(r.formationDate).slice(0, 10)}` : '',
      agentName ? `Registered agent: ${agentName}` : '',
    ]
      .filter(Boolean)
      .join(' · '),
    workspaceId: c.workspaceId,
    folderKey: c.folderKey || undefined,
    pipelineStage: c.pipelineStage != null ? c.pipelineStage : 1,
    updates: [
      {
        type: 'formation_import',
        message: `Imported new business formation (${registryNumber || businessName})`,
        timestamp: new Date().toISOString(),
      },
    ],
  };

  if (registryNumber && stateCode) {
    lead.dedupeKey = `formation:${stateCode.toLowerCase()}:${registryNumber.toLowerCase()}`;
  }

  return lead;
}

function formationsToLeads(results, ctx) {
  const rows = Array.isArray(results) ? results : [];
  return rows.map((row) => formationToLead(row, ctx)).filter(Boolean);
}

module.exports = {
  formatPrincipalAddress,
  formationBuyingSignals,
  formationToLead,
  formationsToLeads,
};
