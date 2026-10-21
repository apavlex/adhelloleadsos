const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyNoteAttribution,
  noteTypeLabel,
  looksLikeAiNote,
} = require('../services/leadNoteAttribution');
const { isManualPanelNote } = require('../services/leadActivityFeed');
const { buildLeadTouchPoints } = require('../services/leadTouchPoints');

test('classifies AI assistant notes', () => {
  const attr = classifyNoteAttribution({
    type: 'note',
    source: 'ai_assistant',
    by: 'AI assistant',
    byEmail: 'bot:ai-assistant',
    value: 'Prospect #162 (prospecting digest). Fit: NW Portland tile.',
  });
  assert.equal(attr.kind, 'ai');
  assert.equal(attr.badge, 'AI');
  assert.equal(noteTypeLabel({ source: 'ai_assistant' }), 'AI note');
});

test('classifies legacy prospecting digest text as AI', () => {
  assert.equal(
    looksLikeAiNote(
      { type: 'note', value: 'Prospect #12 (prospecting digest). Fit: showroom.' },
      'Prospect #12 (prospecting digest). Fit: showroom.',
    ),
    true,
  );
  const attr = classifyNoteAttribution({
    type: 'note',
    value: 'Prospect #12 (prospecting digest). Fit: showroom.',
  });
  assert.equal(attr.kind, 'ai');
});

test('classifies my notes vs teammate notes', () => {
  const me = classifyNoteAttribution(
    {
      type: 'note',
      source: 'panel_post',
      by: 'Alex (pavlex16@gmail.com)',
      byEmail: 'pavlex16@gmail.com',
      value: 'Called — left VM',
    },
    { viewerEmail: 'pavlex16@gmail.com' },
  );
  assert.equal(me.kind, 'me');
  assert.equal(me.badge, 'You');

  const mate = classifyNoteAttribution(
    {
      type: 'note',
      source: 'panel_post',
      by: 'Sam (sam@adhello.io)',
      byEmail: 'sam@adhello.io',
      value: 'Owner wants a proposal',
    },
    { viewerEmail: 'pavlex16@gmail.com' },
  );
  assert.equal(mate.kind, 'teammate');
  assert.match(mate.badge, /Sam/i);
});

test('My notes filter excludes AI notes', () => {
  const ai = {
    typ: 'note',
    text: 'Prospect #1 (prospecting digest)',
    raw: { source: 'ai_assistant', byEmail: 'bot:ai-assistant' },
  };
  const mine = {
    typ: 'note',
    text: 'Follow up Tuesday',
    raw: { source: 'panel_post', byEmail: 'me@example.com' },
  };
  assert.equal(isManualPanelNote(ai), false);
  assert.equal(isManualPanelNote(mine), true);
});

test('buildLeadTouchPoints keeps full note text and attribution', () => {
  const long =
    'Prospect #162 (prospecting digest). Source: http://www.sardonyxpdx.com/. Fit: NW Portland tile + flooring studio with showroom; custom tile installs, collaborates with designers + builders; independent.';
  const tp = buildLeadTouchPoints(
    {
      key: 'lead:x',
      updates: [
        {
          type: 'note',
          value: long,
          timestamp: '2026-10-21T20:51:00.000Z',
          source: 'ai_assistant',
          by: 'AI assistant',
          byEmail: 'bot:ai-assistant',
        },
      ],
    },
    { viewerEmail: 'ops@adhello.io', now: new Date('2026-10-21T21:00:00.000Z') },
  );
  assert.equal(tp.lastTouch.text, long);
  assert.ok(tp.recentTouches[0].isNote);
  assert.equal(tp.recentTouches[0].attribution.kind, 'ai');
  assert.equal(tp.recentTouches[0].typeLabel, 'AI note');
});
