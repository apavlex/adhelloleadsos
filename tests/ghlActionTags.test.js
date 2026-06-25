const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  computeActionTagsFromLead,
  dispositionToActionTag,
  channelToActionTag,
  AO_ACTION_TAGS,
  isActionTag,
} = require('../services/ghlActionTags');

describe('ghlActionTags', () => {
  it('maps disposition callback to AO: Call back', () => {
    assert.equal(dispositionToActionTag('callback'), AO_ACTION_TAGS.CALL_BACK);
    const tags = computeActionTagsFromLead({ lastDisposition: 'callback' });
    assert.deepEqual(tags, [AO_ACTION_TAGS.CALL_BACK]);
  });

  it('maps cadence channel sms to AO: Text', () => {
    assert.equal(channelToActionTag('sms'), AO_ACTION_TAGS.TEXT);
    const tags = computeActionTagsFromLead({ lastTouchChannel: 'sms' });
    assert.deepEqual(tags, [AO_ACTION_TAGS.TEXT]);
  });

  it('prefers disposition over channel', () => {
    const tags = computeActionTagsFromLead({
      lastDisposition: 'voicemail',
      lastTouchChannel: 'sms',
    });
    assert.deepEqual(tags, [AO_ACTION_TAGS.VOICEMAIL]);
  });

  it('recognizes action tags', () => {
    assert.equal(isActionTag('AO: Call back'), true);
    assert.equal(isActionTag('VIP'), false);
  });

  it('clears action tags for closed leads', () => {
    const tags = computeActionTagsFromLead({
      lastDisposition: 'callback',
      status: 'Closed - Won',
    });
    assert.deepEqual(tags, []);
  });
});
