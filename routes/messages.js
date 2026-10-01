/**
 * Sent history (/messages) — SMS and email sent to leads, grouped into bulk campaigns.
 */
const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const messageLog = require('../services/messageLog');
const { filterLeadsForRequest, userEmail } = require('../services/workspaceService');

const PAGE_SIZE = 50;
const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_OPTIONS = [7, 30, 90, 0];

/** SDR seats only see what they sent plus leads assigned to them. */
async function visibilityFor(req) {
  if ((req.workspaceRole || 'admin') !== 'sdr') return null;
  const leads = filterLeadsForRequest(req, await dbService.getAllLeads(req.workspaceId));
  return {
    actorEmail: String(userEmail(req) || '').toLowerCase(),
    leadKeys: leads.map((l) => (String(l.key).startsWith('lead:') ? l.key : `lead:${l.key}`)),
  };
}

function readFilters(query) {
  const channel = ['sms', 'email'].includes(query.channel) ? query.channel : '';
  const status = ['sent', 'delivered', 'failed', 'opened', 'clicked'].includes(query.status) ? query.status : '';
  const source = messageLog.SOURCE_LABELS[query.source] ? query.source : '';
  const daysRaw = parseInt(query.days, 10);
  const days = DAY_OPTIONS.includes(daysRaw) ? daysRaw : 30;
  const q = String(query.q || '').trim().slice(0, 100);
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  return { channel, status, source, days, q, page };
}

function summarize(counts) {
  const out = { sms: 0, email: 0, failed: 0, delivered: 0, opened: 0 };
  for (const r of counts) {
    if (r.channel === 'sms' || r.channel === 'email') out[r.channel] += r.c;
    if (r.status === 'failed') out.failed += r.c;
    if (['delivered', 'opened', 'clicked'].includes(r.status)) out.delivered += r.c;
    if (['opened', 'clicked'].includes(r.status)) out.opened += r.c;
  }
  return out;
}

function campaignName(c) {
  if (c.name) return c.name;
  if (c.subject) return c.subject;
  const t = String(c.template || '').replace(/\s+/g, ' ').trim();
  if (t) return t.length > 70 ? `${t.slice(0, 70)}…` : t;
  return c.channel === 'email' ? 'Bulk email' : 'Bulk SMS';
}

router.get('/', async (req, res, next) => {
  try {
    await messageLog.ensureBackfill(req.workspaceId);
    const tab = req.query.tab === 'campaigns' ? 'campaigns' : 'messages';
    const filters = readFilters(req.query);
    const visibleTo = await visibilityFor(req);
    const since = filters.days ? Date.now() - filters.days * DAY_MS : 0;
    const summary = summarize(dbService.outboundMessageCounts(req.workspaceId, since));

    let messages = { rows: [], total: 0 };
    let campaigns = { rows: [], total: 0 };
    if (tab === 'campaigns') {
      campaigns = dbService.listOutboundCampaigns({
        workspaceId: req.workspaceId,
        channel: filters.channel,
        actorEmail: visibleTo ? visibleTo.actorEmail : '',
        limit: PAGE_SIZE,
        offset: (filters.page - 1) * PAGE_SIZE,
      });
    } else {
      messages = dbService.listOutboundMessages({
        workspaceId: req.workspaceId,
        channel: filters.channel,
        status: filters.status,
        source: filters.source,
        q: filters.q,
        since,
        visibleTo,
        limit: PAGE_SIZE,
        offset: (filters.page - 1) * PAGE_SIZE,
      });
    }
    const campaignCount = dbService.listOutboundCampaigns({
      workspaceId: req.workspaceId,
      actorEmail: visibleTo ? visibleTo.actorEmail : '',
      limit: 1,
    }).total;

    res.render('messages', {
      title: 'Sent history',
      tab,
      filters,
      dayOptions: DAY_OPTIONS,
      summary,
      campaignCount,
      messages: messages.rows,
      campaigns: campaigns.rows.map((c) => ({ ...c, displayName: campaignName(c) })),
      total: tab === 'campaigns' ? campaigns.total : messages.total,
      pageSize: PAGE_SIZE,
      sourceLabels: messageLog.SOURCE_LABELS,
      campaign: null,
    });
  } catch (e) {
    next(e);
  }
});

router.get('/campaigns/:id', async (req, res, next) => {
  try {
    const campaign = dbService.getOutboundCampaign(req.workspaceId, String(req.params.id || ''));
    if (!campaign) return res.status(404).render('error', { message: 'Campaign not found', error: {} });
    const visibleTo = await visibilityFor(req);
    if (visibleTo && campaign.actor_email !== visibleTo.actorEmail) {
      return res.status(404).render('error', { message: 'Campaign not found', error: {} });
    }
    const filters = readFilters({ ...req.query, days: '0' });
    const messages = dbService.listOutboundMessages({
      workspaceId: req.workspaceId,
      campaignId: campaign.id,
      status: filters.status,
      q: filters.q,
      limit: 500,
    });
    res.render('messages', {
      title: `${campaignName(campaign)} · Sent history`,
      tab: 'campaign',
      filters,
      dayOptions: DAY_OPTIONS,
      summary: null,
      campaignCount: 0,
      messages: messages.rows,
      campaigns: [],
      total: messages.total,
      pageSize: 500,
      sourceLabels: messageLog.SOURCE_LABELS,
      campaign: { ...campaign, displayName: campaignName(campaign) },
    });
  } catch (e) {
    next(e);
  }
});

router.post('/campaigns', express.json(), (req, res) => {
  const b = req.body || {};
  const campaign = messageLog.startCampaign(req, {
    id: b.id,
    channel: b.channel,
    name: b.name,
    subject: b.subject,
    template: b.template,
    planned: b.planned,
  });
  if (!campaign) return res.status(400).json({ success: false, error: 'Invalid campaign' });
  return res.json({ success: true, id: campaign.id, url: `/messages/campaigns/${encodeURIComponent(campaign.id)}` });
});

router.post('/campaigns/:id/finish', express.json(), (req, res) => {
  const changed = messageLog.finishCampaign(req, String(req.params.id || ''), {
    skipped: req.body && req.body.skipped,
  });
  return res.json({ success: !!changed });
});

module.exports = router;
