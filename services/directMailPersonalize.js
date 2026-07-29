/**
 * Per-lead merge fields for Direct Mail copy and AI art overlays.
 */

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function resolveAuditUrl(lead) {
  if (!lead || typeof lead !== 'object') return '';
  const candidates = [
    lead.stitchDesignUrl,
    lead.stitchScreenshotUrl,
    lead.website && lead.website !== 'N/A' ? lead.website : '',
  ];
  for (const raw of candidates) {
    const url = String(raw || '').trim();
    if (/^https?:\/\//i.test(url)) return url;
  }
  return '';
}

function buildMergeContext(lead) {
  const l = lead && typeof lead === 'object' ? lead : {};
  return {
    business: String(l.title || 'Your business').trim() || 'Your business',
    city: String(l.city || '').trim(),
    state: String(l.state || '').trim(),
    audit_url: resolveAuditUrl(l),
  };
}

function applyMergeFields(template, lead) {
  const text = String(template || '');
  if (!text) return '';
  const ctx = buildMergeContext(lead);
  return text.replace(/\{(business|city|state|audit_url)\}/gi, (_, key) => ctx[String(key).toLowerCase()] || '');
}

function hasMergeTokens(template) {
  return /\{(business|city|state|audit_url)\}/i.test(String(template || ''));
}

function wrapImageUrlAsPostcardHtml(imageUrl) {
  const src = String(imageUrl || '').trim();
  if (!/^https?:\/\//i.test(src)) return '';
  const safe = src.replace(/"/g, '&quot;');
  return `<html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;width:6.25in;height:4.25in;overflow:hidden;}img{width:6.25in;height:4.25in;display:block;}</style></head><body><img src="${safe}" alt="" /></body></html>`;
}

function wrapImageUrlAsLobPostcardHtml(imageUrl) {
  return wrapImageUrlAsPostcardHtml(imageUrl);
}

function wrapImageWithPersonalizedOverlay(imageUrl, opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const lead = o.lead;
  const src = String(imageUrl || '').trim();
  if (!/^https?:\/\//i.test(src)) return '';
  if (!o.showOverlay) return wrapImageUrlAsPostcardHtml(src);

  const ctx = buildMergeContext(lead);
  const head = escapeHtml(applyMergeFields(o.headline, lead));
  const body = escapeHtml(applyMergeFields(o.bodyText, lead));
  const cta = escapeHtml(applyMergeFields(o.ctaUrl, lead));
  const business = escapeHtml(ctx.business);
  const cityLine = escapeHtml([ctx.city, ctx.state].filter(Boolean).join(', '));
  const safeSrc = src.replace(/"/g, '&quot;');

  const headBlock = head
    ? `<h1 style="font-size:17px;margin:0 0 6px;line-height:1.2;font-weight:700">${head}</h1>`
    : '';
  const businessBlock = `<p style="font-size:11px;margin:0 0 4px;opacity:0.95">Prepared for <strong>${business}</strong>${cityLine ? ` · ${cityLine}` : ''}</p>`;
  const bodyBlock = body
    ? `<p style="font-size:10px;margin:0;line-height:1.45;opacity:0.92">${body}</p>`
    : '';
  const ctaBlock = cta
    ? `<p style="font-size:9px;margin:8px 0 0;opacity:0.9">Scan the QR code for your link.</p>`
    : '';

  return `<html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;width:6.25in;height:4.25in;overflow:hidden;}</style></head><body style="margin:0;padding:0;position:relative;width:6.25in;height:4.25in;font-family:Georgia,'Times New Roman',serif;">
<img src="${safeSrc}" alt="" style="width:6.25in;height:4.25in;display:block;" />
<div style="position:absolute;left:0.2in;top:0.2in;max-width:3.1in;box-sizing:border-box;padding:10px 12px;border-radius:8px;background:rgba(17,24,39,0.88);color:#fff;">
${headBlock}${businessBlock}${bodyBlock}${ctaBlock}
</div>
</body></html>`;
}

module.exports = {
  escapeHtml,
  resolveAuditUrl,
  buildMergeContext,
  applyMergeFields,
  hasMergeTokens,
  wrapImageUrlAsPostcardHtml,
  wrapImageUrlAsLobPostcardHtml,
  wrapImageWithPersonalizedOverlay,
};
