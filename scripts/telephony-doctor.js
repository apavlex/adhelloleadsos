#!/usr/bin/env node
/**
 * Diagnose the agent dial-in path end to end.
 *
 *   node scripts/telephony-doctor.js                 # inspect the default DID
 *   node scripts/telephony-doctor.js +13607935057    # inspect one number
 *   node scripts/telephony-doctor.js --repair        # re-point the Voice webhooks
 *
 * Reads SIGNALWIRE_* / BASE_URL / TELEPHONY_WEBHOOK_TOKEN from the environment.
 * Tokens are never printed in full.
 *
 * --repair writes THIS environment's BASE_URL and webhook token onto the number.
 * Running it from a laptop whose .env differs from Render would break production,
 * so the repair refuses unless the tokens already agree or --force is passed.
 */

require('dotenv').config();

const signalwire = require('../services/signalwire');

function mask(value) {
  const s = String(value || '');
  if (!s) return '(empty)';
  if (s.length <= 8) return s.slice(0, 2) + '…';
  return s.slice(0, 4) + '…' + s.slice(-4) + ` (len ${s.length})`;
}

function redactUrl(url) {
  const s = String(url || '');
  if (!s) return '(empty)';
  return s.replace(/([?&]token=)[^&]+/i, (_, p) => p + '<token>');
}

function tokenInUrl(url) {
  const m = String(url || '').match(/[?&]token=([^&]+)/i);
  return m ? m[1] : '';
}

async function probe(url, label) {
  if (!url) return console.log(`  ${label}: (no URL)`);
  const startedAt = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'From=%2B15555550100&To=%2B15555550101&CallSid=telephony-doctor',
      signal: AbortSignal.timeout(20000),
    });
    const text = await res.text();
    const ms = Date.now() - startedAt;
    const xmlOk = /^<\?xml/.test(text.trim()) && /<Response>/i.test(text);
    console.log(`  ${label}: HTTP ${res.status} in ${ms}ms, valid LaML: ${xmlOk ? 'yes' : 'NO'}`);
    if (!xmlOk) console.log(`    body: ${text.slice(0, 200)}`);
    else console.log(`    says: ${(text.match(/<Say[^>]*>([^<]*)</) || [])[1] || '(no speech)'}`);
    if (ms > 3000) {
      console.log('    WARNING: slow response — SignalWire drops the call if this times out.');
    }
  } catch (err) {
    console.log(`  ${label}: FAILED after ${Date.now() - startedAt}ms — ${err && err.message}`);
  }
}

async function recentInboundCalls(did) {
  const cfg = signalwire.envConfig();
  const host = String(cfg.spaceUrl || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (!host) return;
  const url = `https://${host}/api/laml/2010-04-01/Accounts/${encodeURIComponent(cfg.projectId)}/Calls.json?PageSize=20`;
  const auth = Buffer.from(`${cfg.projectId}:${cfg.token}`).toString('base64');
  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } });
  const json = await res.json();
  const rows = (json.calls || []).filter((c) => String(c.to || '') === did).slice(0, 10);
  console.log(`\nRecent calls to ${did}:`);
  if (!rows.length) return console.log('  (none)');
  rows.forEach((c) => {
    const billed = c.price != null && c.price !== '';
    console.log(
      `  ${c.date_created} ${c.direction} from ${c.from} status=${c.status} dur=${c.duration}s answered=${billed ? 'yes' : 'NO'}`,
    );
  });
  console.log(
    '  answered=NO on an inbound call means SignalWire never got usable LaML in time —\n' +
      '  that is what makes the caller hear "your call cannot be completed at this time".',
  );
}

async function main() {
  const args = process.argv.slice(2);
  const repair = args.includes('--repair');
  const force = args.includes('--force');
  const cfg = signalwire.envConfig();
  const did = signalwire.normalizePhone(args.find((a) => !a.startsWith('--')) || cfg.fromNumber);

  console.log('AdHello telephony doctor');
  console.log('  BASE_URL (normalized): ' + (cfg.webhookBaseUrl || '(unset)'));
  console.log('  SignalWire space: ' + (cfg.spaceUrl || '(unset)'));
  console.log('  Local webhook token: ' + mask(cfg.webhookToken));
  console.log('  Number under test: ' + (did || '(unset)'));

  if (!signalwire.configured()) {
    console.log('\nSignalWire is not configured in this environment — cannot inspect the number.');
    console.log('Set SIGNALWIRE_PROJECT_ID, SIGNALWIRE_TOKEN, SIGNALWIRE_FROM_NUMBER, SIGNALWIRE_SPACE_URL.');
    process.exitCode = 1;
    return;
  }

  const info = await signalwire.describeIncomingNumber(did);
  if (!info.found) {
    console.log(`\n${did} is NOT in this SignalWire project${info.listError ? ' (' + info.listError + ')' : ''}.`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nLive configuration for ${info.phoneNumber} (${info.friendlyName}):`);
  console.log('  voice capable: ' + info.voiceCapable);
  console.log('  VoiceUrl:          ' + redactUrl(info.current.voiceUrl) + '  [' + (info.matches.voiceUrl ? 'ok' : 'DRIFT') + ']');
  console.log('  VoiceMethod:       ' + (info.current.voiceMethod || '(unset)'));
  console.log('  VoiceFallbackUrl:  ' + redactUrl(info.current.voiceFallbackUrl) + '  [' + (info.matches.voiceFallbackUrl ? 'ok' : 'DRIFT') + ']');
  console.log('  StatusCallback:    ' + redactUrl(info.current.statusCallback) + '  [' + (info.matches.statusCallback ? 'ok' : 'DRIFT') + ']');
  console.log('\nExpected from this environment:');
  console.log('  VoiceUrl:          ' + redactUrl(info.expected.voiceUrl));
  console.log('  VoiceFallbackUrl:  ' + redactUrl(info.expected.voiceFallbackUrl));
  console.log('  StatusCallback:    ' + redactUrl(info.expected.statusCallback));

  const liveToken = tokenInUrl(info.current.voiceUrl);
  const tokensAgree = !liveToken || !cfg.webhookToken || liveToken === cfg.webhookToken;
  if (!tokensAgree) {
    console.log(
      '\nNOTE: the token on the number differs from this environment\'s TELEPHONY_WEBHOOK_TOKEN.\n' +
        '      That is expected on a laptop whose .env is not the Render env. The number should\n' +
        '      carry the token the RUNNING app validates, so repair from Render, not from here.',
    );
  }

  console.log('\nReachability of the configured webhook:');
  await probe(info.current.voiceUrl, 'VoiceUrl');
  await probe(info.current.voiceFallbackUrl, 'VoiceFallbackUrl');

  try {
    await recentInboundCalls(info.phoneNumber);
  } catch (err) {
    console.log('\nCould not list recent calls: ' + (err && err.message));
  }

  if (repair) {
    if (!tokensAgree && !force) {
      console.log('\nRefusing to repair: it would replace the live token with this environment\'s token.');
      console.log('Re-run with --force only if this environment IS production.');
      process.exitCode = 1;
      return;
    }
    const out = await signalwire.configureIncomingNumberForDialIn(info.phoneNumber);
    console.log('\nRepaired. VoiceUrl is now ' + redactUrl(out.voiceUrl));
  } else {
    console.log('\nRun with --repair to re-point the webhooks at ' + (cfg.webhookBaseUrl || 'BASE_URL') + '.');
  }
}

main().catch((err) => {
  console.error('telephony-doctor failed:', err && err.message);
  process.exitCode = 1;
});
