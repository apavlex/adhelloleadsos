const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');

const { parseCsvToLeadRecords, isExcelImportFilename } = require('../services/csvLeadImport');

function buildXlsxBuffer(rows) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Leads');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

describe('csvLeadImport xlsx', () => {
  it('isExcelImportFilename detects xlsx and xls', () => {
    assert.equal(isExcelImportFilename('leads.xlsx'), true);
    assert.equal(isExcelImportFilename('leads.XLS'), true);
    assert.equal(isExcelImportFilename('leads.csv'), false);
  });

  it('parseCsvToLeadRecords reads first sheet from xlsx', () => {
    const buffer = buildXlsxBuffer([
      { company_name: 'Acme Paint', phone_number: '555-0100', company_website: 'acme.com' },
    ]);
    const leads = parseCsvToLeadRecords(buffer, 'export.xlsx');
    assert.equal(leads.length, 1);
    assert.equal(leads[0].title, 'Acme Paint');
    assert.equal(leads[0].phone, '555-0100');
    assert.match(leads[0].website, /acme\.com/i);
    assert.equal(leads[0].importFilename, 'export.xlsx');
  });
});
