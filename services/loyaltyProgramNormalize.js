'use strict';

/**
 * Normalize chrome-extension / ingest loyalty scan fields onto a lead.
 * Explicit yes/no only — unknown is omitted so we never persist a maybe.
 */
function parseLoyaltyProgramFields(body) {
  if (!body || typeof body !== 'object') return null;

  let status = '';
  const raw = body.loyaltyProgram != null ? body.loyaltyProgram : body.hasLoyaltyProgram;
  if (raw === true) status = 'yes';
  else if (raw === false) status = 'no';
  else {
    const s = String(raw ?? '')
      .trim()
      .toLowerCase();
    if (['yes', 'true', '1', 'y', 'found'].includes(s)) status = 'yes';
    else if (['no', 'false', '0', 'n', 'not_found', 'not found', 'none'].includes(s)) status = 'no';
  }
  if (status !== 'yes' && status !== 'no') return null;

  const evidence = String(body.loyaltyProgramEvidence || body.loyaltyEvidence || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
  const url = String(body.loyaltyProgramUrl || body.loyaltyUrl || '')
    .trim()
    .slice(0, 2000);
  const checkedAt = String(body.loyaltyProgramCheckedAt || '').trim() || new Date().toISOString();

  return {
    loyaltyProgram: status,
    hasLoyaltyProgram: status === 'yes',
    loyaltyProgramEvidence: evidence,
    loyaltyProgramUrl: url,
    loyaltyProgramCheckedAt: checkedAt,
  };
}

function applyLoyaltyProgramOverwrite(out, incoming) {
  const parsed = parseLoyaltyProgramFields(incoming);
  if (!parsed || !out) return out;
  Object.assign(out, parsed);
  return out;
}

module.exports = {
  parseLoyaltyProgramFields,
  applyLoyaltyProgramOverwrite,
};
