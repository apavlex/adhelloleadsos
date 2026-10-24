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

const router = express.Router();

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
    const card = businessVcard.vcardFromMember(loaded.member, extras);
    if (!card) {
      res.setHeader('X-Robots-Tag', 'noindex');
      return res.status(404).type('text/plain').send('Contact card not found.');
    }
    res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${card.filename}"`);
    // Short cache so profile phone edits show up quickly on the next share.
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
