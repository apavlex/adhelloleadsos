/**
 * Send physical postcards to leads via Lob.com.
 */

const lobClient = require('./lobClient');
const {
  applyMergeFields,
  wrapImageUrlAsPostcardHtml,
  wrapImageWithPersonalizedOverlay,
} = require('./directMailPersonalize');

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseMailableAddress(lead) {
  if (!lead || typeof lead !== 'object') return null;
  let address = String(lead.address || '').trim();
  if (!address || address === 'N/A' || address.length < 5) return null;

  let city = String(lead.city || '').trim();
  let state = String(lead.state || '').trim();
  let zip = String(lead.postalCode || lead.zip || '').trim();

  if ((!city || !state) && address) {
    const tail = address.match(/,\s*([^,]+),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/);
    if (tail) {
      if (!city) city = tail[1].trim();
      if (!state) state = tail[2].toUpperCase();
      if (!zip) zip = tail[3].slice(0, 5);
    }
  }

  if (!city || !state) return null;

  if (!zip) zip = extractZip(address);
  if (!zip) return null;

  let line1 = address.replace(/\b\d{5}(?:-\d{4})?\b/g, '').replace(/,\s*$/, '').trim();
  if (line1.includes(',')) {
    const parts = line1.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 3 && /^[A-Za-z]{2}$/.test(parts[parts.length - 1])) {
      line1 = parts.slice(0, -2).join(', ');
    } else if (parts.length >= 2 && city && state) {
      const last = parts[parts.length - 1];
      if (last.toLowerCase() === city.toLowerCase() || last.toUpperCase() === state) {
        line1 = parts.slice(0, -1).join(', ');
      }
    }
  }
  if (!line1) line1 = address.split(',')[0].trim() || address;

  return {
    name: String(lead.title || 'Business').trim() || 'Business',
    address_line1: line1,
    address_city: city,
    address_state: state,
    address_zip: zip,
  };
}

function extractZip(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const m = s.match(/\b(\d{5})(?:-\d{4})?\b/);
  return m ? m[1] : '';
}

function hasMailableAddress(lead) {
  return !!parseMailableAddress(lead);
}

/** Normalized Lob address fields for UI + send validation. */
function getLeadLobAddressPreview(lead) {
  const parsed = parseMailableAddress(lead);
  const zip =
    String(lead && (lead.postalCode || lead.zip) || '').trim() ||
    (parsed && parsed.address_zip) ||
    extractZip(lead && lead.address) ||
    '';
  return {
    mailable: !!parsed,
    recipientName: parsed ? parsed.name : String((lead && lead.title) || '').trim() || 'Business',
    addressLine1: parsed ? parsed.address_line1 : String((lead && lead.address) || '').trim(),
    city: parsed ? parsed.address_city : String((lead && lead.city) || '').trim(),
    state: parsed ? parsed.address_state : String((lead && lead.state) || '').trim(),
    zip,
    lobTo: parsed,
  };
}

function buildPostcardHtml({ lead, headline, bodyText, ctaUrl }) {
  const mergedHeadline = applyMergeFields(headline, lead) || 'Your free local visibility audit';
  const mergedBody =
    applyMergeFields(bodyText, lead) ||
    'We put together a quick review of how customers find you online.';
  const mergedCta = applyMergeFields(ctaUrl, lead);

  const business = escapeHtml(lead.title || 'Your business');
  const cityLine = escapeHtml([lead.city, lead.state].filter(Boolean).join(', '));
  const head = escapeHtml(mergedHeadline);
  const body = escapeHtml(mergedBody);
  const cta = mergedCta ? escapeHtml(mergedCta) : '';

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

function resolvePostcardCreative(integrationEnv, htmlFallback, overrides, opts) {
  const o = overrides && typeof overrides === 'object' ? overrides : {};
  const personalize = opts && typeof opts === 'object' ? opts : {};
  const lead = personalize.lead;
  const personalizeOverlay = personalize.personalizeOverlay !== false;
  const copy = {
    headline: o.headline,
    bodyText: o.bodyText,
    ctaUrl: o.ctaUrl,
  };

  const frontImageUrl = String(o.frontImageUrl || '').trim();
  const backImageUrl = String(o.backImageUrl || '').trim();

  if (frontImageUrl || backImageUrl) {
    const frontHtml = frontImageUrl
      ? personalizeOverlay && lead
        ? wrapImageWithPersonalizedOverlay(frontImageUrl, {
            lead,
            ...copy,
            showOverlay: true,
          })
        : wrapImageUrlAsPostcardHtml(frontImageUrl)
      : htmlFallback.front;
    const backHtml = backImageUrl
      ? wrapImageUrlAsPostcardHtml(backImageUrl)
      : htmlFallback.back;

    return {
      front: frontHtml,
      back: backHtml,
      mode: 'html',
      usedGenerated: { front: !!frontImageUrl, back: !!backImageUrl },
      personalizedOverlay: !!(frontImageUrl && personalizeOverlay && lead),
    };
  }

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

async function sendPostcardToLead({
  lead,
  integrationEnv,
  headline,
  bodyText,
  ctaUrl,
  frontImageUrl,
  backImageUrl,
  personalizeOverlay,
}) {
  const to = parseMailableAddress(lead);
  if (!to) {
    throw new Error('Lead does not have a complete mailable address (street, city, state, ZIP).');
  }
  if (!lobClient.isConfigured(integrationEnv)) {
    throw new Error('Lob is not configured. Add your API key and return address in Workspace → Integrations.');
  }

  const html = buildPostcardHtml({ lead, headline, bodyText, ctaUrl });
  const creative = resolvePostcardCreative(
    integrationEnv,
    html,
    { frontImageUrl, backImageUrl, headline, bodyText, ctaUrl },
    { lead, personalizeOverlay },
  );
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
    personalizedOverlay: !!creative.personalizedOverlay,
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
  getLeadLobAddressPreview,
  buildPostcardHtml,
  wrapImageUrlAsPostcardHtml,
  resolveDesignUrls,
  resolvePostcardCreative,
  directMailReady,
  sendPostcardToLead,
  sendLetterToLead,
};
