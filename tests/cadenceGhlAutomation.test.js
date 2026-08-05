const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isAutoChannel,
  subjectFromStepTitle,
  bodyFromStep,
} = require('../services/sequenceStepExecutor');
const { isWarmInboundSource, isBookingSource } = require('../services/leadRoutingRules');
const { isWarmReplyBody } = require('../services/inboundReplyRules');

describe('sequenceStepExecutor', () => {
  it('isAutoChannel only email and sms', () => {
    assert.equal(isAutoChannel('email'), true);
    assert.equal(isAutoChannel('sms'), true);
    assert.equal(isAutoChannel('call'), false);
    assert.equal(isAutoChannel('linkedin'), false);
  });

  it('subjectFromStepTitle strips day prefix', () => {
    assert.equal(subjectFromStepTitle('Day 2 — Deliver the PDF'), 'Deliver the PDF');
  });

  it('bodyFromStep expands tokens in hint', () => {
    const lead = { title: 'Acme HVAC', website: 'https://acme.com' };
    const body = bodyFromStep(
      { title: 'Hi', hint: 'Check {{business_name}} at {{domain}}' },
      lead,
      { baseUrl: 'https://app.test' },
    );
    assert.match(body, /Acme HVAC/);
    assert.match(body, /acme\.com/);
  });
});

describe('leadRoutingRules', () => {
  it('detects warm adhello sources', () => {
    assert.equal(isWarmInboundSource('adhello_audit'), true);
    assert.equal(isWarmInboundSource('maps_scrape'), false);
  });

  it('detects booking sources', () => {
    assert.equal(isBookingSource('booking'), true);
    assert.equal(isBookingSource('calendly_invitee'), true);
  });
});

describe('inboundReplyRules', () => {
  it('isWarmReplyBody rejects stop', () => {
    assert.equal(isWarmReplyBody('STOP'), false);
    assert.equal(isWarmReplyBody('Thanks, call me tomorrow'), true);
  });
});
