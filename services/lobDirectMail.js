/**
 * Send physical postcards to leads via Lob.com.
 */

const lobClient = require('./lobClient');

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function extractZip(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const m = s.match(/\b(\d{5})(?:-\d{4})?\b/);
  return m ? m[1] : '';
}

function parseMailableAddress(lead) {
  if (!lead || typeof lead !== 'object') return null;
  const address = String(lead.address || '').trim();
  if (!address || address === 'N/A' || address.length < 5) return null;
  const city = String(lead.city || '').trim();
  const state = String(lead.state || '').trim();
  if (!city || !state) return null;

  let zip = String(lead.postalCode || lead.zip || '').trim();
  if (!zip) zip = extractZip(address);
  if (!zip) return null;

  let line1 = address.replace(/\b\d{5}(?:-\d{4})?\b/g, '').replace(/,\s*$/, '').trim();
  if (!line1) line1 = address;

  return {
    name: String(lead.title || 'Business').trim() || 'Business',
    address_line1: line1,
    address_city: city,
    address_state: state,
    address_zip: zip,
  };
}

function hasMailableAddress(lead) {
  return !!parseMailableAddress(lead);
}

function buildPostcardHtml({ lead, headline, bodyText, ctaUrl }) {
  const business = escapeHtml(lead.title || 'Your business');
  const cityLine = escapeHtml([lead.city, lead.state].filter(Boolean).join(', '));
  const head = escapeHtml(headline || 'Your free local visibility audit');
  const body = escapeHtml(bodyText || 'We put together a quick review of how customers find you online.');
  const cta = ctaUrl ? escapeHtml(ctaUrl) : '';

  const qrBlock = cta
    ? `<p style="margin-top:16px;font-size:11px;color:#555;word-break:break-all">${cta}</p>`
    : '';

  return {
    front: `<html><head><meta charset="utf-8"></head><body style="margin:0;padding:28px 24px;font-family:Georgia,serif;background:#fffbeb;color:#111827">
      <p style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#92400e;margin:0 0 8px">Local marketing</p>
      <h1 style="font-size:22px;line-height:1.2;margin:0 0 12px">${head}</h1>
      <p style="font-size:14px;line-height:1.5;margin:0 0 8px">Prepared for <strong>${business}</strong>${cityLine ? ` · ${cityLine}` : ''}</p>
      <p style="font-size:13px;line-height:1.5;color:#374151;margin:0">${body}</p>
      ${qrBlock}
    </body></html>`,
    back: `<html><head><meta charset="utf-8"></head><body style="margin:0;padding:24px;font-family:system-ui,sans-serif;font-size:11px;line-height:1.5;color:#374151">
      <p style="margin:0 0 8px"><strong>Return service requested</strong></p>
      <p style="margin:0">Questions? Reply by phone or email — or scan / visit the link on the front for your audit.</p>
    </body></html>`,
  };
}

function directMailReady(integrationEnv) {
  const designs = resolveDesignUrls(integrationEnv);
  const hasCustomPostcard =
    isPdfOrHttpUrl(designs.postcardFront) && isPdfOrHttpUrl(designs.postcardBack);
  return {
    configured: lobClient.isConfigured(integrationEnv),
    testMode: lobClient.isTestMode(integrationEnv),
    hasCustomPostcard,
    hasLetterPdf: isPdfOrHttpUrl(designs.letterPdf),
  };
}

function resolveDesignUrls(integrationEnv) {
  const env = integrationEnv || {};
  return {
    postcardFront: String(env.LOB_POSTCARD_FRONT_URL || process.env.LOB_POSTCARD_FRONT_URL || '').trim(),
    postcardBack: String(env.LOB_POSTCARD_BACK_URL || process.env.LOB_POSTCARD_BACK_URL || '').trim(),
    letterPdf: String(env.LOB_LETTER_PDF_URL || process.env.LOB_LETTER_PDF_URL || '').trim(),
  };
}

function isPdfOrHttpUrl(value) {
  const v = String(value || '').trim();
  return /^https?:\/\//i.test(v);
}

function resolvePostcardCreative(integrationEnv, htmlFallback) {
  const designs = resolveDesignUrls(integrationEnv);
  if (isPdfOrHttpUrl(designs.postcardFront) && isPdfOrHttpUrl(designs.postcardBack)) {
    return { front: designs.postcardFront, back: designs.postcardBack, mode: 'pdf' };
  }
  return {
    front: htmlFallback.front,
    back: htmlFallback.back,
    mode: 'html',
  };
}

async function sendPostcardToLead({ lead, integrationEnv, headline, bodyText, ctaUrl }) {
  const to = parseMailableAddress(lead);
  if (!to) {
    throw new Error('Lead does not have a complete mailable address (street, city, state, ZIP).');
  }
  if (!lobClient.isConfigured(integrationEnv)) {
    throw new Error('Lob is not configured. Add your API key and return address in Workspace → Integrations.');
  }

  const html = buildPostcardHtml({ lead, headline, bodyText, ctaUrl });
  const creative = resolvePostcardCreative(integrationEnv, html);
  const data = await lobClient.createPostcard({
    to,
    front: creative.front,
    back: creative.back,
    description: `AdHello postcard — ${lead.title || lead.key || 'lead'}`,
    integrationEnv,
  });

  return {
    provider: 'lob',
    postcardId: String(data.id || ''),
    expectedDeliveryDate: data.expected_delivery_date || null,
    url: data.url || null,
    to,
    testMode: lobClient.isTestMode(integrationEnv),
    creativeMode: creative.mode,
  };
}

async function sendLetterToLead({ lead, integrationEnv }) {
  const to = parseMailableAddress(lead);
  if (!to) {
    throw new Error('Lead does not have a complete mailable address (street, city, state, ZIP).');
  }
  const { letterPdf } = resolveDesignUrls(integrationEnv);
  if (!isPdfOrHttpUrl(letterPdf)) {
    throw new Error('Upload a letter PDF in Workspace → Integrations before sending letters.');
  }
  if (!lobClient.isConfigured(integrationEnv)) {
    throw new Error('Lob is not configured. Add your API key and return address in Workspace → Integrations.');
  }
  const data = await lobClient.createLetter({
    to,
    fileUrl: letterPdf,
    description: `AdHello letter — ${lead.title || lead.key || 'lead'}`,
    integrationEnv,
  });
  return {
    provider: 'lob',
    letterId: String(data.id || ''),
    expectedDeliveryDate: data.expected_delivery_date || null,
    url: data.url || null,
    to,
    testMode: lobClient.isTestMode(integrationEnv),
  };
}

module.exports = {
  parseMailableAddress,
  hasMailableAddress,
  buildPostcardHtml,
  resolveDesignUrls,
  resolvePostcardCreative,
  directMailReady,
  sendPostcardToLead,
  sendLetterToLead,
};
