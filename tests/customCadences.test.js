const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-cadences-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');
const cc = require('../services/customCadences');
const { enrollLeadInAutoOutreach } = require('../services/prospectingEnroll');

const WID = 'ws_cadences';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let phoneSeq = 10;
async function lead(title, extra = {}) {
  await sleep(3);
  const n = String((phoneSeq += 1));
  const saved = await dbService.saveLeadWithMeta({
    workspaceId: WID,
    isDemo: true,
    title,
    phone: `(360) 555-01${n}`,
    email: `${title.toLowerCase().replace(/\W+/g, '-')}@example.com`,
    website: `https://${title.toLowerCase().replace(/\W+/g, '-')}.example.com`,
    city: 'Camas',
    ...extra,
  });
  return saved.key;
}

const STEPS = [
  { dayOffset: 3, channel: 'email', subject: 'Hi {{first_name}}', message: '{{sender_pitch}} for {{company}}' },
  { dayOffset: 0, channel: 'sms', message: 'Hey {{first_name}} in {{city}}' },
  { dayOffset: 1, channel: 'call', message: 'Ask about volume' },
  { dayOffset: 2, channel: 'fax', message: 'dropped' },
];

test('custom cadence: save, prompt, launch, skip, stop', async () => {
  await dbService.saveWorkspace(WID, { id: WID, name: 'Cadence test', members: {}, isDemo: true });

  assert.equal((await cc.saveCadence(WID, { name: '', steps: STEPS })).ok, false);
  assert.equal((await cc.saveCadence(WID, { name: 'Empty', steps: [] })).ok, false);

  const { cadence } = await cc.saveCadence(WID, { name: 'Seat Invite & Follow-up', goal: 'Book a call', steps: STEPS });
  assert.equal(cadence.slug, 'seat-invite-and-follow-up');
  assert.deepEqual(cadence.steps.map((s) => s.channel), ['sms', 'call', 'email']);
  assert.equal(cc.tagNameFor(cadence), 'cadence-seat-invite-and-follow-up');

  const renamed = await cc.saveCadence(WID, { id: cadence.id, name: 'Renamed', steps: STEPS });
  assert.equal(renamed.cadence.slug, cadence.slug, 'tag stays stable on rename');
  const dupe = await cc.saveCadence(WID, { name: 'Seat Invite & Follow-up', steps: STEPS });
  assert.equal(dupe.cadence.slug, 'seat-invite-and-follow-up-2');

  const prompt = cc.buildGhlPrompt(renamed.cadence);
  assert.match(prompt, /Contact tag added — cadence-seat-invite-and-follow-up \(exact\)/);
  assert.match(prompt, /Hey \{\{contact\.first_name\}\} in \{\{contact\.city\}\}/);
  assert.match(prompt, /\{\{custom_field\.AdHello Sender Pitch\}\} for \{\{contact\.company_name\}\}/);
  assert.match(prompt, /STEP 3 — DAY 3 · EMAIL[\s\S]*Wait 2 days/);
  assert.match(prompt, /AdHello SMS OK" = Yes/);

  const free = await lead('Free Plumbing');
  const busy = await lead('Busy Roofing', { sequenceState: { status: 'active', templateId: 'clay_standard' } });
  const launched = await cc.launchCadence({ workspaceId: WID, cadenceId: cadence.id, leadKeys: [free, busy] });
  assert.equal(launched.launched, 1);
  assert.equal(launched.syncedToGhl, false);
  assert.equal(launched.skipped[0].reason, 'on_in_app_cadence');

  const tagged = await dbService.getLead(free, WID);
  assert.equal(tagged.ghlCadence.status, 'active');
  const tags = await dbService.listTags(WID);
  const tag = tags.find((t) => t.name === 'cadence-seat-invite-and-follow-up');
  assert.ok(tagged.tags.includes(tag.key));

  const again = await cc.launchCadence({ workspaceId: WID, cadenceId: dupe.cadence.id, leadKeys: [free] });
  assert.equal(again.skipped[0].reason, 'on_other_ghl_cadence');
  const enroll = await enrollLeadInAutoOutreach({ leadKey: free, workspaceId: WID, skipGhlSync: true });
  assert.equal(enroll.reason, 'on_ghl_cadence');

  const ws = await dbService.getWorkspace(WID);
  const listed = cc.cadencesWithLeads(ws, await dbService.getAllLeads(WID));
  assert.equal(listed.find((c) => c.id === cadence.id).leads.length, 1);
  assert.equal(listed.find((c) => c.id === cadence.id).launchCount, 1);

  assert.equal((await cc.stopCadenceForLead({ workspaceId: WID, leadKey: free })).ok, true);
  const stopped = await dbService.getLead(free, WID);
  assert.equal(stopped.ghlCadence.status, 'stopped');
  assert.ok(!stopped.tags.includes(tag.key));

  assert.equal((await cc.deleteCadence(WID, dupe.cadence.id)).ok, true);
  assert.equal(cc.listCadences(await dbService.getWorkspace(WID)).length, 1);
});
