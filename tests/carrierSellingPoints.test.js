const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveCarrierSellingPoints,
  applyCarrierSellingPoints,
} = require('../services/carrierSellingPoints');
const { normalizeLeadForPanel } = require('../services/leadPanelNormalize');
const { parseImportFile } = require('../services/csvLeadImport');

describe('carrierSellingPoints', () => {
  it('resolves insurance and driver counts from importFields for already-imported CSV leads', () => {
    const pts = resolveCarrierSellingPoints({
      title: '8K TRANSPORTATION LLC',
      importFields: {
        mc_no: '123',
        dot_no: '456',
        power: 'A',
        driver: '3',
        cargo: 'D',
        ins_co: 'PROGRESSIVE COUNTY MUTUAL',
        cover: 'BI&PD',
        policy_no: 'CA01532554',
        effdate: '12/12/2023',
      },
    });
    assert.equal(pts.mcNumber, '123');
    assert.equal(pts.dotNumber, '456');
    assert.equal(pts.driverCount, '3');
    assert.equal(pts.powerUnits, 'A');
    assert.equal(pts.insuranceCompany, 'PROGRESSIVE COUNTY MUTUAL');
    assert.equal(pts.insuranceCoverage, 'BI&PD');
    assert.equal(pts.hasAny, true);
    assert.ok(pts.chips.some((c) => /PROGRESSIVE/i.test(c)));
    assert.ok(pts.chips.some((c) => /3 driver/i.test(c)));
  });

  it('normalizeLeadForPanel backfills top-level carrier fields from importFields', () => {
    const out = normalizeLeadForPanel({
      title: 'Carrier Co',
      phone: '5125550100',
      importFields: {
        mc_no: '1079735',
        driver: '1',
        ins_co: 'PROGRESSIVE COUNTY MUTUAL',
        cover: 'BI&PD',
      },
    });
    assert.equal(out.mcNumber, '1079735');
    assert.equal(out.driverCount, '1');
    assert.equal(out.insuranceCompany, 'PROGRESSIVE COUNTY MUTUAL');
    assert.equal(out.insuranceCoverage, 'BI&PD');
  });

  it('FMCSA CSV import stores structured selling-point fields', () => {
    const csv = [
      'Type,MC No.,Auth,DOT No,Name,Address,City,St,Zip,County,Phone,Fax No,Company Rep,Email,Power,Driver,Cargo,Fleet Operations,Safety Rate,Rating Date,Ins Co,Cover,EffDate,Month,Day,Year,Policy No',
      'MC,1079735,C,3368666,ADEBOLA ADEDAYO JOHNSON,23110 BROAD SPRINGS COURT,,TX,77488,WHARTON,5126624236,,ADEBOLA JOHNSON,beejayyjohnson@gmail.com,A,1,D,A,,  /  /,PROGRESSIVE COUNTY MUTUAL,BI&PD,12/12/2023,12,12,2023,CA01532554',
    ].join('\n');
    const { leads } = parseImportFile(Buffer.from(csv, 'utf8'), 'TX - December cleaned.csv');
    assert.equal(leads.length, 1);
    const lead = leads[0];
    assert.equal(lead.mcNumber, '1079735');
    assert.equal(lead.dotNumber, '3368666');
    assert.equal(lead.powerUnits, 'A');
    assert.equal(lead.driverCount, '1');
    assert.equal(lead.cargo, 'D');
    assert.equal(lead.fleetOperations, 'A');
    assert.equal(lead.insuranceCompany, 'PROGRESSIVE COUNTY MUTUAL');
    assert.equal(lead.insuranceCoverage, 'BI&PD');
    assert.equal(lead.insurancePolicyNo, 'CA01532554');
    assert.equal(lead.insuranceEffectiveDate, '12/12/2023');
    assert.match(lead.carrierCoverage, /BI&PD/);
  });

  it('applyCarrierSellingPoints is a no-op when nothing is present', () => {
    const lead = { title: 'Acme Paint', phone: '5035550100' };
    const out = applyCarrierSellingPoints(lead);
    assert.equal(out.mcNumber, undefined);
    assert.equal(out.insuranceCompany, undefined);
  });
});
