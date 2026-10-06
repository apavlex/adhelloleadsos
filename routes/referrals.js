const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const { filterLeadsForRequest, userEmail } = require('../services/workspaceService');
const { filterBusinessPipelineLeads } = require('../services/leadListFilters');
const referralNetwork = require('../services/referralNetwork');
const networkStore = require('../services/networkStore');
const networkReferrals = require('../services/networkReferrals');
const { tradesForNetwork } = require('../services/networkTrades');
const workspaceIntegrations = require('../services/workspaceIntegrations');
const { suggestReferralNiches, applyNichesToNetwork, nicheSearchUrl } = require('../services/suggestReferralNiches');

const ACTION_NOTICE = {
  connect: 'Marked connected.',
  intro: 'Intro marked as sent.',
  highlight: 'Added to your referral partners.',
  clear: 'Removed from referral partners.',
  sent: 'Lead sent recorded.',
  received: 'Lead received recorded.',
  note: 'Note saved on the lead.',
  ghl: 'Synced to Go High Level.',
};

/** A business removed from Referral Partners also gives up its network seats. Returns a notice, or '' if it wasn't a member. */
async function leaveNetwork(req, lead) {
  const network = await networkStore.getNetworkForWorkspace(req.workspaceId);
  const member = network ? await networkStore.findMemberByLeadKey(network.id, lead.key) : null;
  if (!member) return '';
  if (req.canManageWorkspace === false) {
    return `Removed from referral partners. ${member.companyName} is still in the network; an owner or admin can remove them from Network → Members.`;
  }
  const wasPartner = !!(lead.referralPartner && lead.referralPartner.highlighted);
  const { seated } = await networkReferrals.removeMember(network, member);
  return `Removed ${member.companyName} from ${wasPartner ? 'referral partners and ' : ''}the network.${seated.length ? ` Seated ${seated.join(', ')}.` : ''}`;
}

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

/** Best description of the business we have on file, for the niche finder. */
function describeBusiness(ws) {
  const w = ws || {};
  if (w.referralNiches && w.referralNiches.description) return String(w.referralNiches.description).trim();
  const pi = w.pipelineIntake || {};
  if (pi.businessDescription) return String(pi.businessDescription).trim();
  const si = w.salesIntake || {};
  return [si.businessName || w.name, si.vertical, si.offerName, si.targetAudience && `serving ${si.targetAudience}`]
    .filter(Boolean)
    .join(', ')
    .trim();
}

function presentNiches(ws) {
  const saved = ws && ws.referralNiches;
  const items = saved && Array.isArray(saved.items) ? saved.items : [];
  return {
    items: items.map((n) => ({ name: n.name, why: n.why || '', searchUrl: nicheSearchUrl(n, ws.icp) })),
    fallback: !!(saved && saved.fallback),
    generatedAt: (saved && saved.generatedAt) || null,
  };
}

async function findLead(req, key) {
  const id = String(key || '').trim();
  if (!id) return null;
  const lead = await dbService.getLead(id, req.workspaceId);
  return lead && lead.key ? lead : null;
}

router.get('/', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const focus = String(req.query.focus || '').trim();
    const leads = await workspaceLeads(req);
    const network = await networkStore.getNetworkForWorkspace(req.workspaceId);
    const [zones, members] = network
      ? await Promise.all([networkStore.listZones(network.id), networkStore.listMembers(network.id)])
      : [[], []];
    const ws = (await dbService.getWorkspace(req.workspaceId)) || {};
    const partners = referralNetwork.listPartners(leads, q);
    if (focus && !partners.some((p) => p.key === focus)) {
      const lead = leads.find((l) => l && l.key === focus);
      if (lead) partners.unshift(referralNetwork.presentPartner(lead));
    }
    res.render('referrals', {
      networkSetup: {
        trades: network ? tradesForNetwork(network).map((t) => ({ slug: t.slug, name: t.name })) : [],
        zones: zones.map((z) => ({ id: z.id, name: z.name })),
        memberLeadKeys: members.map((m) => m.leadKey),
      },
      title: 'Referral partners',
      activePage: 'referrals',
      query: q,
      focus,
      partners,
      totals: referralNetwork.networkTotals(leads),
      savedCount: leads.length,
      notice: String(req.query.notice || '').trim(),
      referralNiches: presentNiches(ws),
      nicheDescription: describeBusiness(ws),
      canManageNiches: req.canManageWorkspace !== false,
      openNiches: req.query.niches === '1',
    });
  } catch (err) {
    next(err);
  }
});

router.post('/niches', express.urlencoded({ extended: false }), async (req, res) => {
  if (req.canManageWorkspace === false) {
    return res.redirect(backUrl('', 'Only an owner or admin can change partner niches.'));
  }
  try {
    const ws = (await dbService.getWorkspace(req.workspaceId)) || { id: req.workspaceId };
    const description = String(req.body.businessDescription || '').trim().slice(0, 1500) || describeBusiness(ws);
    if (description.length < 3) return res.redirect(backUrl('', 'Describe your business first.'));
    let integrationEnv = null;
    try {
      integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);
    } catch (_) {
      integrationEnv = null;
    }
    const { niches, fallback } = await suggestReferralNiches(
      { businessDescription: description, businessName: ws.name },
      { integrationEnv }
    );
    const fresh = (await dbService.getWorkspace(req.workspaceId)) || ws;
    fresh.referralNiches = { items: niches, fallback, description, generatedAt: new Date().toISOString() };
    await dbService.saveWorkspace(req.workspaceId, fresh);
    let notice = fallback
      ? `AI was busy, so we picked ${niches.length} common partner niches. Try again later for ones tailored to you.`
      : `Found ${niches.length} referral partner niches for your business.`;
    try {
      const { applied } = await applyNichesToNetwork(req.workspaceId, niches, {
        name: ws.name ? `${ws.name} network` : 'Referral network',
        ownerEmail: userEmail(req) || '',
      });
      if (!applied) notice += ' Your network already has members, so its trades were left as they are.';
    } catch (e) {
      console.warn('[referrals] niche network update failed:', e.message);
    }
    res.redirect(backUrl('', notice) + '&niches=1#partnerNiches');
  } catch (err) {
    console.error('[referrals] niche suggestion failed:', err.message);
    res.redirect(backUrl('', 'Could not find partner niches. Please try again.'));
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
    const action = String(req.body.action || '').trim();
    const note = String(req.body.note || '').trim();
    const wantsJson = /application\/json/i.test(String(req.get('accept') || ''));
    const applied = referralNetwork.applyPartnerAction(lead, action, undefined, note);
    if (!applied.ok) {
      if (wantsJson) return res.status(400).json({ success: false, error: applied.error });
      return res.redirect(backUrl(q, applied.error));
    }
    const patch = { referralPartner: applied.referralPartner };
    if (action === 'note') {
      const ts = applied.referralPartner.lastNoteAt || new Date().toISOString();
      const updates = Array.isArray(lead.updates) ? lead.updates.slice() : [];
      updates.push({ type: 'note', value: note, timestamp: ts, source: 'referral_partner' });
      patch.updates = updates;
      patch.logs = [{ type: 'note', message: note, timestamp: ts }];
    }
    const saved = await dbService.updateLead(lead.key, patch, req.workspaceId);
    let notice = ACTION_NOTICE[action] || 'Updated.';
    if (action === 'clear') notice = await leaveNetwork(req, lead) || notice;
    if (wantsJson) {
      return res.json({
        success: true,
        notice,
        card: referralNetwork.presentPartner(saved || Object.assign({}, lead, patch)),
      });
    }
    res.redirect(backUrl(q, notice));
  } catch (err) {
    console.error('[referrals] partner update failed:', err.message);
    res.redirect(backUrl(q, 'Could not update that partner.'));
  }
});

module.exports = router;
