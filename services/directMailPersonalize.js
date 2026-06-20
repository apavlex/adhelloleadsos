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
  return `<html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;width:100%;height:100%;}img{width:100%;height:100%;object-fit:cover;display:block;}</style></head><body><img src="${safe}" alt="" /></body></html>`;
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
    ? `<p style="font-size:8px;margin:8px 0 0;word-break:break-all;opacity:0.85">${cta}</p>`
    : '';

  return `<html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;width:100%;height:100%;}</style></head><body style="margin:0;padding:0;position:relative;width:100%;height:100%;font-family:Georgia,'Times New Roman',serif;">
<img src="${safeSrc}" alt="" style="width:100%;height:100%;object-fit:cover;display:block;" />
<div style="position:absolute;bottom:0;left:0;right:0;box-sizing:border-box;padding:18px 16px 16px;background:linear-gradient(180deg,rgba(0,0,0,0) 0%,rgba(17,24,39,0.82) 38%,rgba(17,24,39,0.94) 100%);color:#fff;">
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
  wrapImageWithPersonalizedOverlay,
};
