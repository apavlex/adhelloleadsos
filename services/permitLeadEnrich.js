/**
 * Map Permit Stack records to CRM leads and buying signals.
 */

function formatAddress(permit) {
  const parts = [
    String(permit.address_street || '').trim(),
    [permit.address_city, permit.address_state].filter(Boolean).join(', '),
    String(permit.address_zip || '').trim(),
  ].filter(Boolean);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function leadTitleFromPermit(permit) {
  const contractor = String(permit.contractor_name || '').trim();
  const owner = String(permit.owner_name || '').trim();
  const street = String(permit.address_street || '').trim();
  if (contractor) return contractor;
  if (owner) return owner;
  if (street) return street;
  return String(permit.permit_number || 'Permit lead').trim();
}

function permitBuyingSignals(permit) {
  const signals = [];
  const category = String(permit.category || '').trim().toLowerCase();
  const value = permit.estimated_value != null ? Number(permit.estimated_value) : null;
  const filed = permit.date_filed ? new Date(permit.date_filed) : null;
  const daysSinceFiled =
    filed && !Number.isNaN(filed.getTime())
      ? Math.floor((Date.now() - filed.getTime()) / (1000 * 60 * 60 * 24))
      : null;

  if (category) {
    signals.push({
      category: 'buying_signal',
      label: `Recent ${category.replace(/_/g, ' ')} permit`,
      detail: String(permit.description_raw || permit.permit_number || '').slice(0, 200),
      source: 'permit_stack',
    });
  }
  if (daysSinceFiled != null && daysSinceFiled <= 30) {
    signals.push({
      category: 'buying_signal',
      label: 'Permit filed in last 30 days',
      detail: permit.date_filed,
      source: 'permit_stack',
    });
  }
  if (Number.isFinite(value) && value >= 10000) {
    signals.push({
      category: 'buying_signal',
      label: 'High-value permit project',
      detail: `$${value.toLocaleString()} estimated`,
      source: 'permit_stack',
    });
  }
  return signals;
}

function permitToLead(permit, ctx) {
  const c = ctx && typeof ctx === 'object' ? ctx : {};
  const p = permit && typeof permit === 'object' ? permit : {};
  const addressLine = formatAddress(p);
  const title = leadTitleFromPermit(p);
  const signals = permitBuyingSignals(p);

  return {
    title,
    address: String(p.address_street || addressLine || '').trim() || undefined,
    city: String(p.address_city || c.city || '').trim() || undefined,
    state: String(p.address_state || c.state || '').trim() || undefined,
    zip: String(p.address_zip || '').trim() || undefined,
    categoryName: String(p.category || c.category || '').trim() || undefined,
    source: 'permit_stack',
    jobType: 'permits',
    contactName: String(p.owner_name || '').trim() || undefined,
    company: String(p.contractor_name || '').trim() || undefined,
    latitude: p.latitude != null ? Number(p.latitude) : undefined,
    longitude: p.longitude != null ? Number(p.longitude) : undefined,
    permitStackId: String(p.id || '').trim() || undefined,
    permitNumber: String(p.permit_number || '').trim() || undefined,
    permitStatus: String(p.status || '').trim() || undefined,
    permitCategory: String(p.category || '').trim() || undefined,
    permitDescription: String(p.description_raw || '').trim() || undefined,
    permitEstimatedValue: p.estimated_value != null ? Number(p.estimated_value) : undefined,
    permitDateFiled: p.date_filed || undefined,
    permitDateIssued: p.date_issued || undefined,
    permitContractor: String(p.contractor_name || '').trim() || undefined,
    permitJurisdiction: String(p.jurisdiction_name || '').trim() || undefined,
    permitPropertyType: String(p.property_type || '').trim() || undefined,
    permitTags: Array.isArray(p.tags) ? p.tags.slice(0, 12) : undefined,
    permitEnrichment: p.enrichment && typeof p.enrichment === 'object' ? p.enrichment : undefined,
    buyingSignals: signals.length ? signals : undefined,
    buyingScore: signals.length ? Math.min(10, 4 + signals.length * 2) : undefined,
    notes: [
      p.permit_number ? `Permit #${p.permit_number}` : '',
      p.status ? `Status: ${p.status}` : '',
      p.description_raw ? p.description_raw.slice(0, 280) : '',
    ]
      .filter(Boolean)
      .join(' · '),
    workspaceId: c.workspaceId,
    folderKey: c.folderKey || undefined,
    pipelineStage: c.pipelineStage != null ? c.pipelineStage : 1,
    updates: [
      {
        type: 'permit_import',
        message: `Imported from Permit Stack (${p.permit_number || p.id || 'permit'})`,
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

function permitsToLeads(results, ctx) {
  const rows = Array.isArray(results) ? results : [];
  return rows.map((row) => permitToLead(row, ctx)).filter((lead) => lead.title);
}

module.exports = {
  formatAddress,
  leadTitleFromPermit,
  permitBuyingSignals,
  permitToLead,
  permitsToLeads,
};
