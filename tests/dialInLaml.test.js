const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const laml = require('../services/dialInLaml');

function isValidLamlDocument(xml) {
  return (
    typeof xml === 'string' &&
    xml.startsWith('<?xml version="1.0" encoding="UTF-8"?><Response>') &&
    xml.endsWith('</Response>') &&
    !/<Response>\s*<\/Response>/.test(xml)
  );
}

describe('dialInLaml', () => {
  it('every dead-end branch returns a spoken document, never an empty response', () => {
    const branches = [
      laml.buildNoSessionLaml(),
      laml.buildNoLeadLaml(),
      laml.buildTestDialInLaml(),
      laml.buildUnauthorizedLaml(),
      laml.buildErrorLaml(),
    ];
    branches.forEach((xml) => {
      assert.ok(isValidLamlDocument(xml), xml);
      assert.match(xml, /<Say [^>]*>[^<]+<\/Say>/);
      assert.match(xml, /<Hangup\/>/);
    });
  });

  it('tells the agent how to recover when no call is waiting', () => {
    const xml = laml.buildNoSessionLaml();
    assert.match(xml, /No call is waiting/i);
    assert.match(xml, /tap Call/i);
  });

  it('bridges the lead with caller ID and the queue action URL', () => {
    const xml = laml.buildBridgeLaml({
      dialTo: '+13605665293',
      callerId: '+13607935057',
      actionUrl: 'https://leads.adhello.io/api/telephony/voice/twiml/wait?workspaceId=ws1&token=abc',
    });
    assert.ok(isValidLamlDocument(xml));
    assert.match(xml, /<Dial [^>]*callerId="\+13607935057"/);
    assert.match(xml, /answerOnBridge="true"/);
    assert.match(xml, /<Number>\+13605665293<\/Number>/);
    // Ampersands in the action URL must be escaped or SignalWire cannot parse the document.
    assert.match(xml, /action="[^"]*workspaceId=ws1&amp;token=abc"/);
    assert.ok(!/&(?!amp;|lt;|gt;|quot;|apos;)/.test(xml));
  });

  it('omits the action attribute when there is no queue URL', () => {
    const xml = laml.buildBridgeLaml({ dialTo: '+13605665293', callerId: '+13607935057' });
    assert.ok(!/action=/.test(xml));
    assert.match(xml, /<Number>\+13605665293<\/Number>/);
  });

  it('falls back to a spoken message instead of an empty Dial when the lead number is missing', () => {
    const xml = laml.buildBridgeLaml({ dialTo: '', callerId: '+13607935057' });
    assert.ok(!/<Dial/.test(xml));
    assert.match(xml, /No call is waiting/i);
  });

  it('escapes text so an odd lead name or message cannot break the XML', () => {
    const xml = laml.buildSpeakLaml('Bob & "Co" <Flooring>');
    assert.ok(isValidLamlDocument(xml));
    assert.match(xml, /Bob &amp; &quot;Co&quot; &lt;Flooring&gt;/);
  });
});
