const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const { filterLeadsForRequest } = require('../services/workspaceService');
const { filterBusinessPipelineLeads } = require('../services/leadListFilters');
const referralNetwork = require('../services/referralNetwork');

const ACTION_NOTICE = {
  connect: 'Marked connected.',
  intro: 'Intro marked as sent.',
  highlight: 'Added to your referral network.',
  clear: 'Removed from your referral network.',
  sent: 'Referral sent recorded.',
  received: 'Referral received recorded.',
};

function backUrl(query, notice) {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (notice) params.set('notice', notice);
  const search = params.toString();
  return '/referrals' + (search ? '?' + search : '');
}

async function workspaceLeads(req) {
  const all = await dbService.getAllLeads(req.workspaceId);
  return filterBusinessPipelineLeads(filterLeadsForRequest(req, all));
}

async function findLead(req, key) {
  const id = String(key || '').trim();
  if (!id) return null;
  const leads = await workspaceLeads(req);
  return leads.find((lead) => lead && lead.key === id) || null;
}

router.get('/', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const leads = await workspaceLeads(req);
    res.render('referrals', {
      title: 'Referral network',
      activePage: 'referrals',
      query: q,
      partners: referralNetwork.listPartners(leads, q),
      totals: referralNetwork.networkTotals(leads),
      savedCount: leads.length,
      notice: String(req.query.notice || '').trim(),
    });
  } catch (err) {
    next(err);
  }
});

function highlightKeys(req) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const fromBody = Array.isArray(body.leadKeys) ? body.leadKeys : (body.leadKeys ? [body.leadKeys] : []);
  const fromQuery = String(req.query.leadKeys || '')
    .split(',')
    .map((key) => {
      try { return decodeURIComponent(key); } catch (err) { return key; }
    });
  return [...new Set(
    fromBody.concat(fromQuery)
      .map((key) => String(key || '').trim())
      .filter((key) => key && !/^\d+$/.test(key)),
  )].slice(0, 100);
}

router.post('/highlight', async (req, res) => {
  try {
    const wanted = highlightKeys(req);
    if (!wanted.length) return res.status(400).json({ success: false, error: 'Select a lead first.' });
    let added = 0;
    for (const key of wanted) {
      const lead = await dbService.getLead(key, req.workspaceId);
      if (!lead || !lead.key) continue;
      const applied = referralNetwork.applyPartnerAction(lead, 'highlight');
      if (!applied.ok) continue;
      const saved = await dbService.updateLead(lead.key, { referralPartner: applied.referralPartner }, req.workspaceId);
      if (!saved) continue;
      added += 1;
    }
    if (!added) return res.status(404).json({ success: false, error: 'Those leads are not in this workspace.' });
    res.json({ success: true, added });
  } catch (err) {
    console.error('[referrals] highlight failed:', err.message);
    res.status(500).json({ success: false, error: 'Could not add those leads.' });
  }
});

router.post('/partner', express.urlencoded({ extended: false }), async (req, res) => {
  const q = String(req.body.q || '').trim();
  try {
    const lead = await findLead(req, req.body.leadKey);
    if (!lead) return res.redirect(backUrl(q, 'That partner is not in this workspace.'));
    const applied = referralNetwork.applyPartnerAction(lead, req.body.action);
    if (!applied.ok) return res.redirect(backUrl(q, applied.error));
    await dbService.updateLead(lead.key, { referralPartner: applied.referralPartner }, req.workspaceId);
    res.redirect(backUrl(q, ACTION_NOTICE[String(req.body.action || '').trim()] || 'Updated.'));
  } catch (err) {
    console.error('[referrals] partner update failed:', err.message);
    res.redirect(backUrl(q, 'Could not update that partner.'));
  }
});

module.exports = router;
