const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'member-cust-csv-'));
process.env.APP_DATA_DIR = tmpDir;

const work = require('../services/memberWork');
const csv = require('../services/memberCustomerCsv');

const NET = 'netcsv1';
const MEM = 'memcsv1';

describe('member customer CSV import', () => {
  before(async () => {
    // warm db
    await work.listCustomers(NET, MEM);
  });

  it('parses name/phone/email columns and imports with dedupe', async () => {
    const buffer = Buffer.from(
      'Name,Phone,Email\nAnn Lee,3605550100,ann@example.com\nBob Builder,5035550199,bob@example.com\n',
      'utf8',
    );
    const parsed = csv.parseCustomerImportFile(buffer, 'customers.csv');
    assert.equal(parsed.ok, true);
    assert.equal(parsed.rows.length, 2);

    const first = await csv.importCustomers(NET, MEM, parsed.rows);
    assert.equal(first.created, 2);
    assert.equal(first.updated, 0);

    const again = await csv.importCustomers(NET, MEM, parsed.rows);
    assert.equal(again.created, 0);
    assert.equal(again.updated, 2);

    const list = await work.listCustomers(NET, MEM);
    assert.equal(list.length, 2);
    assert.equal(list.find((c) => c.name === 'Ann Lee').source, 'csv');
  });

  it('maps first/last name columns', () => {
    const fields = csv.mapRowToCustomer({
      'First Name': 'Pat',
      'Last Name': 'Smith',
      Mobile: '555-0100',
    });
    assert.equal(fields.name, 'Pat Smith');
    assert.equal(fields.phone, '555-0100');
  });
});
