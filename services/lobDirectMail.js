/**
 * Send physical postcards to leads via Lob.com.
 */

const lobClient = require('./lobClient');
const {
  applyMergeFields,
  resolveAuditUrl,
  wrapImageUrlAsPostcardHtml,
  wrapImageUrlAsLobPostcardHtml,
  wrapImageWithPersonalizedOverlay,
} = require('./directMailPersonalize');
const { prepareRemoteImageForLobPostcard } = require('./marketingImageComposite');

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const LOB_RECIPIENT_NAME_MAX = 40;
const DEFAULT_RESIDENT_NAME = 'Current Resident';

function truncateLobRecipientName(name, fallback = DEFAULT_RESIDENT_NAME) {
  const n = String(name || '').trim();
  if (!n) return fallback;
  if (n.length <= LOB_RECIPIENT_NAME_MAX) return n;
  return n.slice(0, LOB_RECIPIENT_NAME_MAX).trim();
}

function looksLikeListingOrAddressTitle(title, lead) {
  const t = String(title || '').trim();
  if (!t) return true;
  if (/\$\s?\d/.test(t)) return true;
  if (/ · /.test(t) && /\$\s?\d/.test(t)) return true;
  if (/^\d+\s+\S+.*,\s*[^,]+,\s*[A-Za-z]{2}\b/.test(t)) return true;
  if (/\b\d{5}(?:-\d{4})?\b/.test(t) && /,\s*[A-Za-z]{2}\s+\d{5}/.test(t)) return true;
  const addr = String((lead && lead.address) || '').trim();
  if (addr && addr.length >= 8) {
    const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const nt = norm(t);
    const na = norm(addr);
    if (nt === na || nt.startsWith(na) || na.startsWith(nt.split(' · ')[0])) return true;
  }
  return false;
}

function resolveLobRecipientName(lead) {
  const l = lead && typeof lead === 'object' ? lead : {};
  const personFields = [l.contactName, l.ownerName, l.name]
    .map((v) => String(v || '').trim())
    .filter(Boolean);
  for (const candidate of personFields) {
    if (!looksLikeListingOrAddressTitle(candidate, l)) {
      return truncateLobRecipientName(candidate);
    }
  }

  const title = String(l.title || '').trim();
  if (title && !looksLikeListingOrAddressTitle(title, l)) {
    return truncateLobRecipientName(title);
  }

  return DEFAULT_RESIDENT_NAME;
}

function extractListingAddressFromTitle(title) {
  const t = String(title || '').trim();
  if (!t) return null;
  const head = t.split(' · ')[0].trim();
  if (!head || head.length < 8) return null;

  const withZip = head.match(/^(.+),\s*([^,]+),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/);
  if (withZip) {
    return {
      address: head,
      city: withZip[2].trim(),
      state: withZip[3].toUpperCase(),
      postalCode: withZip[4].slice(0, 5),
    };
  }

  const noZip = head.match(/^(.+),\s*([^,]+),\s*([A-Za-z]{2})\s*$/);
  if (noZip && /^\d/.test(noZip[1].trim())) {
    return {
      address: head,
      city: noZip[2].trim(),
      state: noZip[3].toUpperCase(),
    };
  }
  return null;
}

function coalesceLeadForMailing(lead) {
  if (!lead || typeof lead !== 'object') return lead;
  const fromTitle = extractListingAddressFromTitle(lead.title);
  if (!fromTitle) return lead;

  const address = String(lead.address || '').trim();
  const city = String(lead.city || '').trim();
  const state = String(lead.state || '').trim();
  const zip = String(lead.postalCode || lead.zip || '').trim();

  const needsAddress = !address || address === 'N/A' || address.length < 5;
  const needsGeo = !city || !state;
  const needsZip = !zip && !extractZip(address);

  if (!needsAddress && !needsGeo && !needsZip) return lead;

  return {
    ...lead,
    address: needsAddress ? fromTitle.address : address,
    city: city || fromTitle.city || '',
    state: state || fromTitle.state || '',
    postalCode: zip || fromTitle.postalCode || '',
    zip: zip || fromTitle.postalCode || '',
  };
}

function parseMailableAddress(lead) {
  if (!lead || typeof lead !== 'object') return null;
  const coalesced = coalesceLeadForMailing(lead);
  let address = String(coalesced.address || '').trim();
  if (!address || address === 'N/A' || address.length < 5) return null;

  let city = String(coalesced.city || '').trim();
  let state = String(coalesced.state || '').trim();
  let zip = String(coalesced.postalCode || coalesced.zip || '').trim();

  if ((!city || !state) && address) {
    const tail = address.match(/,\s*([^,]+),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/);
    if (tail) {
      if (!city) city = tail[1].trim();
      if (!state) state = tail[2].toUpperCase();
      if (!zip) zip = tail[3].slice(0, 5);
    }
  }

  if (!city || !state) return null;

  if (!zip && address) {
    const tailZip = address.match(/,\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/);
    if (tailZip) zip = tailZip[2].slice(0, 5);
  }
  if (!zip) zip = extractZip(address);
  if (!zip) return null;

  let line1 = stripAddressTail(address, { city, state, zip });
  if (!line1 || line1 === address) {
    const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 3 && /^[A-Za-z]{2}$/.test(parts[parts.length - 1])) {
      line1 = parts.slice(0, -2).join(', ');
    } else if (parts.length >= 2) {
      line1 = parts[0];
    }
  }
  if (!line1) line1 = address.split(',')[0].trim() || address;

  return {
    name: resolveLobRecipientName(coalesced),
    address_line1: line1,
    address_city: city,
    address_state: state,
    address_zip: zip,
  };
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripAddressTail(address, { city, state, zip }) {
  let line = String(address || '').trim();
  if (!line) return '';

  if (zip) {
    line = line.replace(new RegExp(`\\b${escapeRegExp(zip)}(?:-\\d{4})?\\s*$`), '').trim();
  }
  if (state) {
    line = line.replace(new RegExp(`,\\s*${escapeRegExp(state)}\\s*$`, 'i'), '').trim();
  }
  if (city) {
    line = line.replace(new RegExp(`,\\s*${escapeRegExp(city)}\\s*$`, 'i'), '').trim();
  }
  return line;
}

function extractZip(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const tail = s.match(/,\s*[A-Za-z]{2}\s+(\d{5})(?:-\d{4})?\s*$/);
  if (tail) return tail[1];
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
    (parsed && parsed.address_zip) ||
    String(lead && (lead.postalCode || lead.zip) || '').trim() ||
    extractZip(lead && lead.address) ||
    '';
  return {
    mailable: !!parsed,
    recipientName: parsed ? parsed.name : resolveLobRecipientName(lead),
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
    ? `<p style="margin-top:16px;font-size:11px;color:#555">Scan the QR code to view your link.</p>`
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

function postcardSideFromImage(imageUrl, opts) {
  const url = String(imageUrl || '').trim();
  if (!url) return '';
  const o = opts && typeof opts === 'object' ? opts : {};
  if (o.personalizeOverlay && o.lead) {
    const html = wrapImageWithPersonalizedOverlay(url, {
      lead: o.lead,
      headline: o.headline,
      bodyText: o.bodyText,
      ctaUrl: o.ctaUrl,
      showOverlay: true,
    });
    if (html) return html;
  }
  if (isPdfOrHttpUrl(url)) return wrapImageUrlAsLobPostcardHtml(url);
  return '';
}

function assertPostcardCreativeSide(label, value, usedSide) {
  if (!usedSide) return;
  const side = String(value || '').trim();
  if (!side) {
    throw new Error(
      `${label} design must be a public https image. Regenerate or reload it on the canvas before sending.`,
    );
  }
}

async function assertReachableImageUrl(imageUrl, label) {
  const url = String(imageUrl || '').trim();
  if (!url || !isPdfOrHttpUrl(url)) return;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(
      `${label} image is not reachable (HTTP ${res.status}). Regenerate the design — hosted image links can expire.`,
    );
  }
  const buf = await res.arrayBuffer();
  if (!buf || !buf.byteLength) {
    throw new Error(`${label} image download was empty. Regenerate the design before sending.`);
  }
}

function withPostcardTrackingParams(url, lead) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (!parsed.searchParams.has('utm_source')) parsed.searchParams.set('utm_source', 'lob_postcard');
    if (!parsed.searchParams.has('utm_medium')) parsed.searchParams.set('utm_medium', 'direct_mail');
    const key = String((lead && lead.key) || '').trim();
    if (key && !parsed.searchParams.has('utm_content')) parsed.searchParams.set('utm_content', key);
    return parsed.toString();
  } catch (_) {
    return raw;
  }
}

function resolveLobQrRedirectUrl(lead, ctaUrl) {
  const template = String(ctaUrl || '').trim();
  const merged = template ? applyMergeFields(template, lead) : resolveAuditUrl(lead);
  const url = withPostcardTrackingParams(String(merged || '').trim(), lead);
  if (!/^https?:\/\//i.test(url)) return '';
  return url;
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
    const overlayOpts = {
      personalizeOverlay,
      lead,
      headline: copy.headline,
      bodyText: copy.bodyText,
      ctaUrl: copy.ctaUrl,
    };
    const frontCreative = frontImageUrl
      ? postcardSideFromImage(frontImageUrl, overlayOpts)
      : htmlFallback.front;
    const backCreative = backImageUrl
      ? postcardSideFromImage(backImageUrl, { ...overlayOpts, personalizeOverlay: false })
      : htmlFallback.back;

    assertPostcardCreativeSide('Front', frontCreative, !!frontImageUrl);
    assertPostcardCreativeSide('Back', backCreative, !!backImageUrl);

    const mode = 'html';

    return {
      front: frontCreative,
      back: backCreative,
      mode,
      usedGenerated: { front: !!frontImageUrl, back: !!backImageUrl },
      personalizedOverlay: !!(frontImageUrl && personalizeOverlay && lead),
      sourceImageUrls: {
        front: frontImageUrl || '',
        back: backImageUrl || '',
      },
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

async function normalizePostcardImageForLob(imageUrl, req, side) {
  const url = String(imageUrl || '').trim();
  if (!url || !/^https?:\/\//i.test(url)) return url;
  if (!req) return url;
  return prepareRemoteImageForLobPostcard(url, req, { side: side === 'back' ? 'back' : 'front' });
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
  includeLobQr,
  req,
}) {
  const to = parseMailableAddress(lead);
  if (!to) {
    throw new Error('Lead does not have a complete mailable address (street, city, state, ZIP).');
  }
  if (!lobClient.isConfigured(integrationEnv)) {
    throw new Error('Lob is not configured. Add your API key and return address in Workspace → Integrations.');
  }

  const normalizedFront = frontImageUrl
    ? await normalizePostcardImageForLob(frontImageUrl, req, 'front')
    : undefined;
  const normalizedBack = backImageUrl
    ? await normalizePostcardImageForLob(backImageUrl, req, 'back')
    : undefined;

  const html = buildPostcardHtml({ lead, headline, bodyText, ctaUrl });
  const creative = resolvePostcardCreative(
    integrationEnv,
    html,
    {
      frontImageUrl: normalizedFront,
      backImageUrl: normalizedBack,
      headline,
      bodyText,
      ctaUrl,
    },
    { lead, personalizeOverlay },
  );
  const sourceUrls = creative.sourceImageUrls || {};
  if (sourceUrls.front) await assertReachableImageUrl(sourceUrls.front, 'Front');
  if (sourceUrls.back) await assertReachableImageUrl(sourceUrls.back, 'Back');
  const qrRedirectUrl =
    includeLobQr !== false ? resolveLobQrRedirectUrl(lead, ctaUrl) : '';
  const data = await lobClient.createPostcard({
    to,
    front: creative.front,
    back: creative.back,
    description: `AdHello postcard — ${lead.title || lead.key || 'lead'}`,
    integrationEnv,
    qrCodeRedirectUrl: qrRedirectUrl,
    qrCodePages: 'front',
  });
  const postcardId = lobClient.assertPostcardCreateResponse(data);

  return {
    provider: 'lob',
    postcardId,
    expectedDeliveryDate: data.expected_delivery_date || null,
    url: data.url || null,
    dashboardUrl: lobClient.lobPostcardDashboardUrl(postcardId),
    qrRedirectUrl: qrRedirectUrl || null,
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
  resolveLobQrRedirectUrl,
  sendPostcardToLead,
  sendLetterToLead,
};
