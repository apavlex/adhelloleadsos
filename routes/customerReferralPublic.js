/**
 * Public customer referral landing: /rf/:code
 * Friend of a top reviewer opens the unique link → becomes an attributed lead.
 */

const express = require('express');
const store = require('../services/networkStore');
const work = require('../services/memberWork');
const notify = require('../services/networkNotify');
const customerReferralLinks = require('../services/customerReferralLinks');
const { brandView } = require('../services/networkBrand');
const { getPublicBaseUrl } = require('../lib/publicBaseUrl');

const router = express.Router();
const form = express.urlencoded({ extended: false });

function notFound(res) {
  res.status(404);
  return res.render('customer_referral_public', {
    missing: true,
    brand: brandView({}),
    company: 'Business',
    referrerName: '',
    code: '',
    flash: null,
    formValues: {},
    done: false,
  });
}

async function loadAdvocatePage(code) {
  const advocate = await customerReferralLinks.getByCode(code);
  if (!advocate) return null;
  const network = await store.getNetwork(advocate.networkId);
  const member = network ? await store.getMember(network.id, advocate.memberId) : null;
  if (!network || !member || member.status !== 'active') return null;
  return { advocate, network, member, brand: brandView(network, member) };
}

router.get('/rf/:code', async (req, res) => {
  try {
    const code = String(req.params.code || '').trim().toLowerCase();
    const page = await loadAdvocatePage(code);
    if (!page) return notFound(res);
    customerReferralLinks.recordClick(code).catch(() => {});
    const referrerFirst = String(page.advocate.name || 'A customer')
      .trim()
      .split(/\s+/)[0] || 'A customer';
    return res.render('customer_referral_public', {
      missing: false,
      done: String(req.query.ok || '') === '1',
      brand: page.brand,
      company: page.member.companyName || page.brand.appName,
      referrerName: referrerFirst,
      code: page.advocate.code,
      flash: null,
      formValues: {},
    });
  } catch (err) {
    console.error('[customer-ref] view failed:', err.message);
    return notFound(res);
  }
});

router.post('/rf/:code', form, async (req, res) => {
  try {
    const code = String(req.params.code || '').trim().toLowerCase();
    const page = await loadAdvocatePage(code);
    if (!page) return notFound(res);
    const body = req.body || {};
    const name = String(body.name || '').trim().slice(0, 120);
    const phone = String(body.phone || '').trim().slice(0, 40);
    const email = String(body.email || '').trim().slice(0, 120);
    const note = String(body.note || '').trim().slice(0, 500);
    if (!name && !phone && !email) {
      return res.status(400).render('customer_referral_public', {
        missing: false,
        done: false,
        brand: page.brand,
        company: page.member.companyName || page.brand.appName,
        referrerName: String(page.advocate.name || 'A customer').trim().split(/\s+/)[0] || 'A friend',
        code: page.advocate.code,
        flash: { error: 'Add your name, phone, or email so we can reach you.' },
        formValues: { name, phone, email, note },
      });
    }

    const referrerLabel = page.advocate.name || 'a customer';
    const saved = await work.saveCustomer(
      page.network.id,
      page.member.id,
      {
        name: name || referrerLabel + ' referral',
        phone,
        email,
        notes: [
          `Referred by ${referrerLabel} (link ${page.advocate.code})`,
          note,
        ].filter(Boolean).join('\n'),
      },
      { source: 'referral' },
    );
    if (!saved.ok) {
      return res.status(400).render('customer_referral_public', {
        missing: false,
        done: false,
        brand: page.brand,
        company: page.member.companyName || page.brand.appName,
        referrerName: String(page.advocate.name || 'A customer').trim().split(/\s+/)[0] || 'A friend',
        code: page.advocate.code,
        flash: { error: saved.error || 'Could not save. Try again.' },
        formValues: { name, phone, email, note },
      });
    }

    await work.setCustomerLeadFlag(page.network.id, page.member.id, saved.customer.id, true).catch(() => {});

    const recorded = await customerReferralLinks.recordConversion(code, {
      name: name || saved.customer.name,
      phone,
      email,
      note,
      leadCustomerId: saved.customer.id,
    });

    const baseUrl = getPublicBaseUrl(req);
    notify.notifyMemberFormLead({
      network: page.network,
      member: page.member,
      baseUrl,
      leadName: saved.customer.name || name || 'New referral',
      formName: `Customer referral · ${referrerLabel}`,
      source: 'customer_referral',
      preview: note || `Brought by ${referrerLabel}`,
    }).catch(() => {});

    if (!recorded.ok) {
      console.warn('[customer-ref] conversion record failed:', recorded.error);
    }

    return res.redirect(303, `/rf/${encodeURIComponent(code)}?ok=1`);
  } catch (err) {
    console.error('[customer-ref] submit failed:', err.message);
    return notFound(res);
  }
});

module.exports = router;
