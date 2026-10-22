/**
 * Workspace Alex chat (/chat + floating widget) ships a mic that dictation
 * fills into the composer via AlexVoice → /api/voice/transcribe.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

describe('workspace AI chat voice dictation', () => {
  it('full /chat page shows a mic and loads AlexVoice + chat script', () => {
    const html = fs.readFileSync(path.join(root, 'views/chat.ejs'), 'utf8');
    assert.match(html, /id="pcMic"/);
    assert.match(html, /alex-voice-icon--mic/);
    assert.match(html, /alex-voice-input\.js/);
    assert.match(html, /pavlex-chat-page\.js/);
    assert.match(html, /tap the mic/i);
    assert.doesNotMatch(html, /id="pcMic"[^>]*\shidden\b/);
  });

  it('floating Alex chat shows a mic wired to the composer', () => {
    const html = fs.readFileSync(path.join(root, 'views/partials/ceo_chat_float.ejs'), 'utf8');
    assert.match(html, /id="ceoChatMicFloat"/);
    assert.match(html, /alex-voice-icon--mic/);
    assert.match(html, /id="ceoChatInputFloat"/);
    assert.match(html, /tap the mic/i);
    assert.doesNotMatch(html, /id="ceoChatMicFloat"[^>]*\shidden\b/);
  });

  it('chat scripts attach AlexVoice with server transcription fallback kept visible', () => {
    const page = fs.readFileSync(path.join(root, 'public/js/pavlex-chat-page.js'), 'utf8');
    const float = fs.readFileSync(path.join(root, 'public/js/ceo-chat-float.js'), 'utf8');
    const voice = fs.readFileSync(path.join(root, 'public/js/alex-voice-input.js'), 'utf8');
    const nav = fs.readFileSync(path.join(root, 'views/partials/navbar.ejs'), 'utf8');

    assert.match(page, /AlexVoice\.attach/);
    assert.match(page, /hideIfUnsupported:\s*false/);
    assert.match(page, /pcMic/);
    assert.match(float, /AlexVoice\.attach/);
    assert.match(float, /hideIfUnsupported:\s*false/);
    assert.match(float, /ceoChatMicFloat/);
    assert.match(float, /attachVoice\(\)/);
    assert.match(voice, /\/api\/voice\/transcribe/);
    assert.match(voice, /writeInput/);
    assert.match(nav, /alex-voice-input\.js/);
  });

  it('transcribe API route is mounted for signed-in workspace chat', () => {
    const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
    const route = fs.readFileSync(path.join(root, 'routes/voiceTranscribe.js'), 'utf8');
    assert.match(server, /\/api\/voice/);
    assert.match(route, /\/transcribe/);
    assert.match(route, /transcribeAudio/);
  });
});
