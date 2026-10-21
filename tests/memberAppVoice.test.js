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

test('new customer form includes one speak-once mic (no field mics)', async () => {
  const { token } = await setupMember();
  const { server, base } = await startApp();
  try {
    const res = await fetch(`${base}/m/${encodeURIComponent(token)}/customers/new`);
    const html = await res.text();
    assert.equal(res.status, 200);
    assert.match(html, /data-ma-voice-add-customer/);
    assert.match(html, /ma-voice-add__mic/);
    assert.match(html, /aria-label="Speak customer info"/);
    // Mic is visible in HTML (not gated behind [hidden]) so “tap the mic” always has a control.
    assert.match(html, /id="maVoiceAddCustomerBtn"[^>]*>[\s\S]*?alex-voice-icon--mic/);
    assert.doesNotMatch(html, /id="maVoiceAddCustomerBtn"[^>]*\bhidden\b/);
    // Idle markup is mic-only — stop/spin squares must not show before voice JS runs.
    assert.doesNotMatch(html, /id="maVoiceAddCustomerBtn"[\s\S]*?alex-voice-icon--stop/);
    assert.match(html, /maVoiceCustomerConfirm/);
    assert.match(html, /Confirm &amp; create/);
    // New customer: one big speak-once mic only — no per-field mics.
    assert.doesNotMatch(html, /data-ma-voice-for="cuName"/);
    assert.doesNotMatch(html, /data-ma-voice-for="cuPhone"/);
    assert.doesNotMatch(html, /data-ma-voice-for="cuEmail"/);
    assert.doesNotMatch(html, /data-ma-voice-for="cuAddress"/);
    assert.doesNotMatch(html, /data-ma-voice-for="cuNotes"/);
    assert.match(html, /ma-voice-add__mic/);
    const css = fs.readFileSync(path.join(__dirname, '../public/css/member-app.css'), 'utf8');
    const js = fs.readFileSync(path.join(__dirname, '../public/js/member-app.js'), 'utf8');
    const voice = fs.readFileSync(path.join(__dirname, '../public/js/alex-voice-input.js'), 'utf8');
    assert.match(css, /maVoiceMicPulse/);
    assert.match(css, /\.ma-voice-add__mic[\s\S]*?88px/);
    assert.match(js, /hideIfUnsupported:\s*false/);
    assert.match(voice, /hideIfUnsupported/);
    assert.match(voice, /alex-voice-icon--stop/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('parse-customer endpoint fills structured fields from speech text', async () => {
  const { token } = await setupMember();
  const { server, base } = await startApp();
  try {
    const res = await fetch(`${base}/m/${encodeURIComponent(token)}/voice/parse-customer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        text: 'Customer name is Riley Quinn phone 360-555-0142 email riley@example.com at 50 Pine St Camas. Prefers mornings.',
      }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.match(body.fields.name, /Riley/i);
    assert.match(body.fields.phone, /360/);
    assert.match(String(body.fields.email || ''), /riley@example\.com/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
