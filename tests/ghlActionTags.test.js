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

  it('maps site audit disposition to AO: Site audit', () => {
    assert.equal(dispositionToActionTag('site_audit'), AO_ACTION_TAGS.SITE_AUDIT);
    const tags = computeActionTagsFromLead({ lastDisposition: 'site_audit' });
    assert.deepEqual(tags, [AO_ACTION_TAGS.SITE_AUDIT]);
  });

  it('maps send info and not interested quick logs to AO tags', () => {
    assert.equal(dispositionToActionTag('send_info'), AO_ACTION_TAGS.SEND_INFO);
    assert.equal(dispositionToActionTag('not_interested'), AO_ACTION_TAGS.NOT_INTERESTED);
    assert.deepEqual(computeActionTagsFromLead({ lastDisposition: 'send_info' }), [
      AO_ACTION_TAGS.SEND_INFO,
    ]);
    assert.deepEqual(
      computeActionTagsFromLead({ lastDisposition: 'not_interested', status: 'Closed - Lost' }),
      [AO_ACTION_TAGS.NOT_INTERESTED],
    );
  });

  it('clears action tags for closed won leads', () => {
    const tags = computeActionTagsFromLead({
      lastDisposition: 'callback',
      status: 'Closed - Won',
    });
    assert.deepEqual(tags, []);
  });
});
