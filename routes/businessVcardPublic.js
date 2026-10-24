/**
 * Public per-business vCard download:
 *   GET /c/:slug.vcf  →  text/vcard attachment
 *
 * Slug is the same globally unique reviewSlug used by /rv/:slug.
 */

const express = require('express');
const store = require('../services/networkStore');
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
  const member = await store.getMember(ref.networkId, ref.memberId);
  if (!member || member.reviewSlug !== ref.slug) return null;
  return member;
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
    const member = await loadMemberByReviewSlug(m[1]);
    const card = member ? businessVcard.vcardFromMember(member) : null;
    if (!card) {
      res.setHeader('X-Robots-Tag', 'noindex');
      return res.status(404).type('text/plain').send('Contact card not found.');
    }
    res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${card.filename}"`);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    return res.status(200).send(card.body);
  } catch (err) {
    console.error('[business-vcard]', err.message);
    return res.status(500).type('text/plain').send('Could not build contact card.');
  }
});

module.exports = router;
