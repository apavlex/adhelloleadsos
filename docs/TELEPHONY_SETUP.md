# SignalWire Telephony Setup

This app now supports:

- Click-to-call outbound calls per lead
- Outbound SMS per lead
- Voicemail drop attempts
- Inbound SMS + call/SMS status webhooks to append lead activity
- In-app voicemail recording/upload + weekly voicemail drop automation

## Required environment variables

- `BASE_URL` (public app URL, example: `https://leads.adhello.ai`)
- `SIGNALWIRE_ENABLED=1`
- `SIGNALWIRE_SPACE_URL` (example: `example.signalwire.com`)
- `SIGNALWIRE_PROJECT_ID`
- `SIGNALWIRE_TOKEN`
- `SIGNALWIRE_FROM_NUMBER` (E.164, e.g. `+15551234567`)

Recommended:

- `SIGNALWIRE_CALLER_ID` (defaults to `SIGNALWIRE_FROM_NUMBER`)
- `SIGNALWIRE_CALLBACK_NUMBER` (spoken in TTS fallback)
- `TELEPHONY_WEBHOOK_TOKEN` (shared token for webhook auth)
- `VOICEMAIL_DROP_AUDIO_URL` (hosted MP3/WAV to play for voicemail drops)
- `VOICEMAIL_DROP_SCRIPT` (used when no audio URL is provided)
- `TELEPHONY_VOICE_LANGUAGE` (default `en-US`)
- `TELEPHONY_VOICE_NAME` (default `alice`)

## Configure SignalWire webhooks

Use URLs below (replace domain) and include `?token=YOUR_TELEPHONY_WEBHOOK_TOKEN` when token auth is enabled.

- Inbound SMS webhook:
  - `POST https://leads.adhello.ai/api/telephony/sms/inbound`
- SMS status callback:
  - `POST https://leads.adhello.ai/api/telephony/sms/status`
- Voice status callback (outbound **and** inbound — same URL):
  - `POST https://leads.adhello.ai/api/telephony/voice/status`
  - Set this as **Status Callback** on each purchased number so Workspace → Phone **inbound analytics** (connected / missed / voicemail) can increment. The app resolves the workspace by matching the called DID to your phone bank.
- AMD callback (voicemail attempts):
  - `POST https://leads.adhello.ai/api/telephony/voice/amd`
- TwiML call control endpoint:
  - `POST https://leads.adhello.ai/api/telephony/voice/twiml`

## Notes

- Voicemail drop is implemented as an outbound call flow with machine detection enabled and a voicemail message playback script.
- Weekly voicemail automation is configured in the lead detail panel under `Weekly Voicemail Automation`.
- Regulatory compliance (TCPA, state/local calling and recording laws, opt-out handling) must be reviewed before production campaigns.
