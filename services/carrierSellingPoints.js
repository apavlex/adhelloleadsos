/**
 * FMCSA / trucking carrier selling points for Money Mode + pipeline.
 * Resolves from top-level lead fields or importFields (already-imported CSVs).
 */

function hasVal(v) {
  const s = v == null ? '' : String(v).trim();
  return !!(s && s !== 'N/A' && s !== '—' && s !== '-' && !/^[/.\-\s]+$/.test(s));
}

function pick(obj, keys) {
  if (!obj || typeof obj !== 'object') return '';
  const entries = Object.entries(obj);
  for (const key of keys) {
    const want = String(key || '').toLowerCase();
    for (const [k, v] of entries) {
      if (String(k || '').toLowerCase() === want && hasVal(v)) return String(v).trim();
    }
  }
  return '';
}

/**
 * @param {object|null|undefined} lead
 * @returns {{
 *   mcNumber: string,
 *   dotNumber: string,
 *   powerUnits: string,
 *   driverCount: string,
 *   cargo: string,
 *   fleetOperations: string,
 *   insuranceCompany: string,
 *   insuranceCoverage: string,
 *   insurancePolicyNo: string,
 *   insuranceEffectiveDate: string,
 *   carrierCoverage: string,
 *   hasAny: boolean,
 *   chips: string[],
 *   summaryLine: string
 * }}
 */
function resolveCarrierSellingPoints(lead) {
  const empty = {
    mcNumber: '',
    dotNumber: '',
    powerUnits: '',
    driverCount: '',
    cargo: '',
    fleetOperations: '',
    insuranceCompany: '',
    insuranceCoverage: '',
    insurancePolicyNo: '',
    insuranceEffectiveDate: '',
    carrierCoverage: '',
    hasAny: false,
    chips: [],
    summaryLine: '',
  };
  if (!lead || typeof lead !== 'object') return empty;

  const imp = lead.importFields && typeof lead.importFields === 'object' ? lead.importFields : {};

  const mcNumber =
    (hasVal(lead.mcNumber) && String(lead.mcNumber).trim()) ||
    pick(imp, ['mc_no', 'mc_number', 'mc']);
  const dotNumber =
    (hasVal(lead.dotNumber) && String(lead.dotNumber).trim()) ||
    pick(imp, ['dot_no', 'dot_number', 'usdot', 'dot']);
  const powerUnits =
    (hasVal(lead.powerUnits) && String(lead.powerUnits).trim()) || pick(imp, ['power', 'power_units']);
  const driverCount =
    (hasVal(lead.driverCount) && String(lead.driverCount).trim()) ||
    pick(imp, ['driver', 'drivers', 'driver_count']);
  const cargo =
    (hasVal(lead.cargo) && String(lead.cargo).trim()) || pick(imp, ['cargo', 'cargo_type']);
  const fleetOperations =
    (hasVal(lead.fleetOperations) && String(lead.fleetOperations).trim()) ||
    pick(imp, ['fleet_operations', 'fleet']);
  const insuranceCompany =
    (hasVal(lead.insuranceCompany) && String(lead.insuranceCompany).trim()) ||
    pick(imp, ['ins_co', 'insurance_company', 'insurer', 'insurance']);
  const insuranceCoverage =
    (hasVal(lead.insuranceCoverage) && String(lead.insuranceCoverage).trim()) ||
    pick(imp, ['cover', 'coverage', 'insurance_coverage']);
  const insurancePolicyNo =
    (hasVal(lead.insurancePolicyNo) && String(lead.insurancePolicyNo).trim()) ||
    pick(imp, ['policy_no', 'policy_number', 'policy']);
  const insuranceEffectiveDate =
    (hasVal(lead.insuranceEffectiveDate) && String(lead.insuranceEffectiveDate).trim()) ||
    pick(imp, ['effdate', 'effective_date', 'insurance_effective']);

  let carrierCoverage =
    (hasVal(lead.carrierCoverage) && String(lead.carrierCoverage).trim()) || '';
  if (!carrierCoverage) {
    carrierCoverage = [insuranceCoverage, insuranceCompany, insurancePolicyNo, insuranceEffectiveDate]
      .filter(Boolean)
      .join(' · ');
  }

  const chips = [];
  if (mcNumber) chips.push(`MC ${mcNumber}`);
  if (dotNumber) chips.push(`DOT ${dotNumber}`);
  if (driverCount) chips.push(`${driverCount} driver${driverCount === '1' ? '' : 's'}`);
  if (powerUnits) chips.push(`Power ${powerUnits}`);
  if (insuranceCompany) chips.push(insuranceCompany);
  if (insuranceCoverage) chips.push(insuranceCoverage);
  if (cargo) chips.push(`Cargo ${cargo}`);

  const hasAny = !!(
    mcNumber ||
    dotNumber ||
    powerUnits ||
    driverCount ||
    cargo ||
    fleetOperations ||
    insuranceCompany ||
    insuranceCoverage ||
    insurancePolicyNo ||
    insuranceEffectiveDate ||
    carrierCoverage
  );

  return {
    mcNumber,
    dotNumber,
    powerUnits,
    driverCount,
    cargo,
    fleetOperations,
    insuranceCompany,
    insuranceCoverage,
    insurancePolicyNo,
    insuranceEffectiveDate,
    carrierCoverage,
    hasAny,
    chips: chips.slice(0, 8),
    summaryLine: chips.slice(0, 6).join(' · '),
  };
}

/**
 * Apply resolved selling points onto a lead object (for panel/API payloads).
 * @param {object} lead
 */
function applyCarrierSellingPoints(lead) {
  if (!lead || typeof lead !== 'object') return lead;
  const pts = resolveCarrierSellingPoints(lead);
  if (!pts.hasAny) return lead;
  if (pts.mcNumber && !hasVal(lead.mcNumber)) lead.mcNumber = pts.mcNumber;
  if (pts.dotNumber && !hasVal(lead.dotNumber)) lead.dotNumber = pts.dotNumber;
  if (pts.powerUnits && !hasVal(lead.powerUnits)) lead.powerUnits = pts.powerUnits;
  if (pts.driverCount && !hasVal(lead.driverCount)) lead.driverCount = pts.driverCount;
  if (pts.cargo && !hasVal(lead.cargo)) lead.cargo = pts.cargo;
  if (pts.fleetOperations && !hasVal(lead.fleetOperations)) lead.fleetOperations = pts.fleetOperations;
  if (pts.insuranceCompany && !hasVal(lead.insuranceCompany)) lead.insuranceCompany = pts.insuranceCompany;
  if (pts.insuranceCoverage && !hasVal(lead.insuranceCoverage)) {
    lead.insuranceCoverage = pts.insuranceCoverage;
  }
  if (pts.insurancePolicyNo && !hasVal(lead.insurancePolicyNo)) {
    lead.insurancePolicyNo = pts.insurancePolicyNo;
  }
  if (pts.insuranceEffectiveDate && !hasVal(lead.insuranceEffectiveDate)) {
    lead.insuranceEffectiveDate = pts.insuranceEffectiveDate;
  }
  if (pts.carrierCoverage && !hasVal(lead.carrierCoverage)) lead.carrierCoverage = pts.carrierCoverage;
  return lead;
}

module.exports = {
  resolveCarrierSellingPoints,
  applyCarrierSellingPoints,
};
