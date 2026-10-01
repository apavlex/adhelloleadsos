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

test('removing a member from a trade or the network frees the spot for whoever is waiting', async () => {
  const network = await store.getOrCreateNetworkForWorkspace('ws_remove', { name: 'Remove network' });
  const zone = await store.saveZone(network.id, { name: 'Camas', cities: ['Camas'], zips: ['98607'] });
  const [trade, other] = network.trades;
  const add = (name, trades) => networkReferrals.saveMemberWithSeats(network, { companyName: name, status: 'active' }, { trades, zoneIds: [zone.id] });

  const first = (await add('Copeland & Co.', [trade, other])).member;
  const second = (await add('BAM Office Interiors', [trade])).member;
  const third = (await add('Haven Staging', [trade])).member;

  const removed = await networkReferrals.removeMemberFromTrade(network, first, trade);
  assert.deepEqual(removed.member.trades, [other]);
  assert.deepEqual(removed.seated, ['BAM Office Interiors']);
  let zones = await store.listZones(network.id);
  assert.deepEqual(ex.seatHolders(zones[0], trade), [second.id]);
  assert.deepEqual(ex.seatHolders(zones[0], other), [first.id]);

  const gone = await networkReferrals.removeMember(network, await store.getMember(network.id, second.id));
  assert.deepEqual(gone.seated, ['Haven Staging']);
  assert.equal(await store.getMember(network.id, second.id), null);
  zones = await store.listZones(network.id);
  assert.deepEqual(ex.seatHolders(zones[0], trade), [third.id]);
});
