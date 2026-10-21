const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'member-app-voice-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const dbService = require('../services/database');
const store = require('../services/networkStore');
const { createMemberPortalToken } = require('../services/networkLinkSign');
const memberApp = require('../routes/memberApp');
const voiceTranscription = require('../services/voiceTranscription');

const savedKey = process.env.OPENAI_API_KEY;
let openAiCalls = [];
let openAiResponder = null;

voiceTranscription.deps.fetch = async (url, init) => {
  const form = init.body;
  const file = form.get('file');
  openAiCalls.push({
    url,
    auth: init.headers.Authorization,
    model: form.get('model'),
    prompt: form.get('prompt'),
    language: form.get('language'),
    fileName: file && file.name,
  });
  const { status = 200, body = { text: 'Kitchen remodel estimate about eight thousand' } } =
    (openAiResponder && openAiResponder(openAiCalls.length)) || {};
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
};

async function setupMember() {
  const network = await store.getOrCreateNetworkForWorkspace(`ws_ma_voice_${Date.now()}`, {
    name: 'Voice Field Co',
  });
  const zone = await store.saveZone(network.id, { name: 'Camas', cities: ['Camas'], zips: ['98607'] });
  const saved = await dbService.saveLeadWithMeta({
    workspaceId: network.ownerWorkspaceId,
    title: 'Field Pros LLC',
    phone: 'N/A',
    city: 'Camas',
    placeId: 'ChIJvoicefield123',
  });
  const { member } = await require('../services/networkReferrals').saveMemberWithSeats(
    network,
    {
      leadKey: saved.key,
      companyName: 'Field Pros LLC',
      contactName: 'Alex',
      phone: '',
      status: 'active',
    },
    { trades: ['flooring'], zoneIds: [zone.id] },
  );
  const token = createMemberPortalToken({ networkId: network.id, memberId: member.id });
  return { network, member, token };
}

function startApp() {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use('/', memberApp);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

async function postVoice(base, token, { body = Buffer.alloc(4000, 1), type = 'audio/webm', query = '' } = {}) {
  const res = await fetch(`${base}/m/${encodeURIComponent(token)}/voice/transcribe${query}`, {
    method: 'POST',
    headers: { 'Content-Type': type, Accept: 'application/json' },
    body,
  });
  return { status: res.status, body: await res.json() };
}

test.beforeEach(() => {
  openAiCalls = [];
  openAiResponder = null;
  voiceTranscription.resetRateLimit();
  process.env.OPENAI_API_KEY = 'sk-test-member-voice';
});

test.after(() => {
  if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = savedKey;
});

test('member app voice transcribe returns text for a valid token', async () => {
  const { token } = await setupMember();
  const { server, base } = await startApp();
  try {
    const res = await postVoice(base, token, { query: '?lang=en' });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.match(res.body.text, /Kitchen remodel/i);
    assert.equal(openAiCalls.length, 1);
    assert.match(openAiCalls[0].prompt, /field app|job or customer notes/i);
    assert.equal(openAiCalls[0].language, 'en');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('member app voice rejects bad tokens with JSON 401', async () => {
  const { server, base } = await startApp();
  try {
    const res = await postVoice(base, 'not-a-real-token');
    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
    assert.equal(openAiCalls.length, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('job page includes voice dictate controls', async () => {
  const { token } = await setupMember();
  const { server, base } = await startApp();
  try {
    const res = await fetch(`${base}/m/${encodeURIComponent(token)}/customers/jobs/new`);
    const html = await res.text();
    assert.equal(res.status, 200);
    assert.match(html, /data-ma-voice-for="jbNotes"/);
    assert.match(html, /data-ma-voice-for="jbTitle"/);
    assert.match(html, /data-ma-voice-for="jbNewName"/);
    assert.match(html, /data-ma-voice-for="jbNewPhone"/);
    assert.match(html, /alex-voice-input\.js/);
    assert.match(html, /__maVoiceEndpoint/);
    assert.match(html, /\/voice\/transcribe/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('new customer form includes voice on all text fields', async () => {
  const { token } = await setupMember();
  const { server, base } = await startApp();
  try {
    const res = await fetch(`${base}/m/${encodeURIComponent(token)}/customers/new`);
    const html = await res.text();
    assert.equal(res.status, 200);
    assert.match(html, /data-ma-voice-for="cuName"/);
    assert.match(html, /data-ma-voice-for="cuPhone"/);
    assert.match(html, /data-ma-voice-for="cuEmail"/);
    assert.match(html, /data-ma-voice-for="cuAddress"/);
    assert.match(html, /data-ma-voice-for="cuNotes"/);
    assert.match(html, /Mic on each field/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
