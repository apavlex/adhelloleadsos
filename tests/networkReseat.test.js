const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'network-reseat-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../services/networkStore');
const ex = require('../services/referralExchange');
const networkReferrals = require('../services/networkReferrals');

test('raising the partner limit seats members who were waiting for a full trade', async () => {
  const network = await store.getOrCreateNetworkForWorkspace('ws_reseat', { name: 'Reseat network' });
  const zone = await store.saveZone(network.id, { name: 'Camas', cities: ['Camas'], zips: ['98607'] });
  const trade = network.trades[0];
  const add = (name) => networkReferrals.saveMemberWithSeats(network, { companyName: name, status: 'active' }, { trades: [trade], zoneIds: [zone.id] });

  const first = await add('Copeland & Co.');
  const second = await add('BAM Office Interiors');
  assert.equal(second.conflicts.length, 1);

  let zones = await store.listZones(network.id);
  assert.deepEqual(ex.seatHolders(zones[0], trade), [first.member.id]);

  const raised = await store.saveNetwork({ ...network, seatLimit: 2 });
  const seated = await networkReferrals.reseatWaitingMembers(raised);
  assert.deepEqual(seated, ['BAM Office Interiors']);

  zones = await store.listZones(network.id);
  assert.deepEqual(ex.seatHolders(zones[0], trade), [first.member.id, second.member.id]);

  assert.deepEqual(await networkReferrals.reseatWaitingMembers(raised), []);
});
