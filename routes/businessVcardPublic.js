/**
 * Public per-business vCard download:
 *   GET /c/:slug.vcf  →  text/vcard attachment
 *
 * Slug is the same globally unique reviewSlug used by /rv/:slug.
 */

const express = require('express');
const store = require('../services/networkStore');
const dbService = require('../services/database');
const businessVcard = require('../services/businessVcard');
const whiteLabel = require('../services/whiteLabel');
const reviewShareImage = require('../services/reviewShareImage');

const router = express.Router();

/**
 * App branding logo for the contact photo (embedded — iOS ignores PHOTO URLs).
 * Prefer Workspace white-label / App branding, then network brand logo, then
 * request-page business logo. Never the personal profile selfie.
 */
async function brandingPhotoForMember(member, network) {
  try {
    if (network && network.ownerWorkspaceId) {
      const wl = await whiteLabel.getLogo(network.ownerWorkspaceId);
      if (wl && wl.buffer && wl.buffer.length) {
        const prepared = await reviewShareImage.compressPublicPageLogo(wl.buffer);
        if (prepared && prepared.buffer) return prepared;
      }
    }
    if (network && network.id) {
      const brandLogo = await store.getBrandImage(network.id, 'logo');
      if (brandLogo && brandLogo.buffer && brandLogo.buffer.length) {
        const prepared = await reviewShareImage.compressPublicPageLogo(brandLogo.buffer);
        if (prepared && prepared.buffer) return prepared;
      }
    }
    if (member && member.reviewLogoUpdatedAt && network) {
      const pageLogo = await reviewShareImage.getPublicPageLogoBuffer(
        network.id,
        member.id,
        'logo',
      );
      if (pageLogo && pageLogo.buffer) return pageLogo;
    }
  } catch (err) {
    console.warn('[business-vcard] branding photo skipped:', err.message);
  }
  return null;
}

async function loadMemberByReviewSlug(slug) {
  const clean = String(slug || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '')
    .slice(0, 80);
  if (!clean) return null;
  const ref = await store.resolveReviewSlug(clean);
  if (!ref) return null;
  const network = await store.getNetwork(ref.networkId);
  const member = await store.getMember(ref.networkId, ref.memberId);
  if (!member || member.reviewSlug !== ref.slug) return null;
  return { member, network };
}

/** Website / phone / email from the linked CRM lead when the member profile is thin. */
async function leadExtrasForMember(member, network) {
  const empty = { website: '', phone: '', email: '' };
  if (!member || !member.leadKey || !network || !network.ownerWorkspaceId) return empty;
  try {
    const lead = await dbService.getLead(member.leadKey, network.ownerWorkspaceId);
    if (!lead) return empty;
    const site = lead.website || lead.url || '';
    const phone = lead.phone || lead.mobile || lead.phoneNumber || '';
    const email = lead.email || '';
    // Named contacts on the lead (owner / primary) as a last-resort phone.
    let contactPhone = '';
    const people = Array.isArray(lead.contacts) ? lead.contacts : [];
    for (const person of people) {
      if (person && person.phone && businessVcard.usablePhone(person.phone)) {
        contactPhone = person.phone;
        break;
      }
    }
    return {
      website: String(site || '').trim().slice(0, 400),
      phone: String(phone || contactPhone || '').trim().slice(0, 40),
      email: String(email || '').trim().slice(0, 200),
    };
  } catch {
    return empty;
  }
}

/** /c/acme.vcf — stable contact card for the business. */
router.get('/c/:slugVcf', async (req, res) => {
  try {
    const raw = String(req.params.slugVcf || '');
    const m = raw.match(/^([a-z0-9][a-z0-9-]{0,78})\.vcf$/i);
    if (!m) {
      res.setHeader('X-Robots-Tag', 'noindex');
      return res.status(404).type('text/plain').send('Contact card not found.');
    }
    const loaded = await loadMemberByReviewSlug(m[1]);
    if (!loaded) {
      res.setHeader('X-Robots-Tag', 'noindex');
      return res.status(404).type('text/plain').send('Contact card not found.');
    }
    const extras = await leadExtrasForMember(loaded.member, loaded.network);
    const photo = await brandingPhotoForMember(loaded.member, loaded.network);
    if (photo && photo.buffer) {
      extras.photoBuffer = photo.buffer;
      extras.photoContentType = photo.contentType || 'image/jpeg';
    }
    const card = businessVcard.vcardFromMember(loaded.member, extras);
    if (!card) {
      res.setHeader('X-Robots-Tag', 'noindex');
      return res.status(404).type('text/plain').send('Contact card not found.');
    }
    res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${card.filename}"`);
    // Short cache so branding / phone edits show up quickly on the next share.
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    // Allow the member app (different subdomain) to fetch and share as a File.
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).send(card.body);
  } catch (err) {
    console.error('[business-vcard]', err.message);
    return res.status(500).type('text/plain').send('Could not build contact card.');
  }
});

module.exports = router;
