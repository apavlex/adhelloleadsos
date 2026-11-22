/**
 * Public directory profile lead forms (e.g. homeelk.com/pros/{slug}).
 * Saves the homeowner as a Reviews-app lead, notifies the matched member
 * (inbox + push + SMS/email), and returns the app deep-link to open.
 */
const directoryStore = require('./directoryStore');
const directoryPublic = require('./directoryPublic');
const directoryMemberLink = require('./directoryMemberLink');
const memberWork = require('./memberWork');
const appointmentPackages = require('./appointmentPackages');
const networkNotify = require('./networkNotify');
const notificationLog = require('./notificationLog');
const { getReviewPublicBaseUrl } = require('../lib/publicBaseUrl');

const leadFormUrl = directoryPublic.leadFormUrl;
const { clean, resolveMemberForListing } = directoryMemberLink;

const submitHits = new Map();
const SUBMIT_WINDOW_MS = 60 * 60 * 1000;
const SUBMIT_MAX = 8;

function submitAllowed(ip) {
  const key = String(ip || 'unknown');
  const now = Date.now();
  const recent = (submitHits.get(key) || []).filter((t) => now - t < SUBMIT_WINDOW_MS);
  if (recent.length >= SUBMIT_MAX) return false;
  recent.push(now);
  submitHits.set(key, recent);
  if (submitHits.size > 8000) submitHits.clear();
  return true;
}

async function loadPublishedListing(token, slug) {
  const workspaceId = await directoryStore.resolveWorkspaceIdByToken(token);
  if (!workspaceId) return null;
  const bundle = await directoryStore.ensurePublicToken(workspaceId);
  if (directoryStore.clean(bundle.settings.publicToken, 80) !== directoryStore.clean(token, 80)) {
    return null;
  }
  const row = directoryStore.findBySlug(bundle, slug);
  if (!row || row.published !== true) return null;
  return { workspaceId, bundle, listing: row };
}

function siteBrandLabel(bundle, listing) {
  const pageUrl = clean(bundle && bundle.settings && bundle.settings.pageUrl, 400);
  const brand = clean(bundle && bundle.settings && bundle.settings.businessName, 120);
  try {
    if (pageUrl) {
      const host = new URL(pageUrl.includes('://') ? pageUrl : `https://${pageUrl}`).hostname
        .replace(/^www\./i, '');
      if (host) return host;
    }
  } catch (_) {
    /* fall through */
  }
  return brand || 'Directory';
}

/**
 * @param {string} token
 * @param {string} slug
 * @param {object} input
 * @param {{ ip?: string, origin?: string }} [opts]
 */
async function submitDirectoryLead(token, slug, input, opts = {}) {
  if (!submitAllowed(opts.ip)) {
    const err = new Error('Too many form submissions from this network. Try again later.');
    err.code = 'RATE_LIMIT';
    throw err;
  }

  const resolved = await loadPublishedListing(token, slug);
  if (!resolved) {
    const err = new Error('Business listing not found or not published.');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const { workspaceId, bundle, listing } = resolved;

  const name = clean(input && (input.name || input.full_name || input.fullName), 120);
  const phone = clean(input && (input.phone || input.phone_number || input.phoneNumber), 40);
  const email = clean(input && input.email, 120).toLowerCase();
  const message = clean(
    input && (input.message || input.note || input.notes || input.project || input.details),
    800,
  );
  const pageUrl = clean(input && (input.page_url || input.pageUrl || input.source_url), 500);

  if (!name && !phone && !email) {
    const err = new Error('Add your name, phone, or email so the business can reach you.');
    err.code = 'INVALID';
    throw err;
  }

  const linked = await resolveMemberForListing(workspaceId, listing);
  const siteLabel = siteBrandLabel(bundle, listing);
  const formName = `${siteLabel} · ${listing.name || 'listing'}`;
  const preview = [message, pageUrl ? `From ${pageUrl}` : '']
    .filter(Boolean)
    .join(' — ')
    .slice(0, 200);

  const reviewBase = getReviewPublicBaseUrl();
  const origin = clean(opts.origin, 400) || '';
  const formUrl = leadFormUrl(origin, token, listing.slug);

  if (!linked) {
    try {
      notificationLog.add(
        workspaceId,
        {
          title: `Directory lead · ${listing.name || 'listing'}`,
          body: `${name || phone || email}${preview ? ` — ${preview}` : ''}`.slice(0, 400),
          href: '/directory',
          linkLabel: 'Directory',
        },
        '',
      );
    } catch (_) {
      /* ignore */
    }
    return {
      routed: false,
      reason: 'listing_unclaimed',
      business: { slug: listing.slug, name: listing.name || '' },
      lead_form_url: formUrl,
      message:
        'Thanks — we received your request. This listing is not linked to a Reviews app yet.',
    };
  }

  const { network, member } = linked;
  const notes = [
    `Directory lead from ${siteLabel} (${listing.slug})`,
    pageUrl ? `Page: ${pageUrl}` : '',
    message,
  ]
    .filter(Boolean)
    .join('\n');

  const saved = await memberWork.saveCustomer(
    network.id,
    member.id,
    {
      name: name || phone || email || 'Website lead',
      phone,
      email,
      notes,
    },
    { source: 'website_form' },
  );
  if (!saved.ok || !saved.customer) {
    const err = new Error((saved && saved.error) || 'Could not save your request. Try again.');
    err.code = 'INVALID';
    throw err;
  }

  await memberWork.setCustomerLeadFlag(network.id, member.id, saved.customer.id, true).catch(() => {});

  // Also park on appointment package Leads when linked (silent — we notify once below).
  try {
    await appointmentPackages.attachFormLead(
      workspaceId,
      {
        name: saved.customer.name || name,
        phone,
        email,
        formName,
        preview,
        source: 'website_form',
        at: new Date().toISOString(),
        status: 'open',
        leadKey: listing.leadKey || '',
      },
      {
        silent: true,
        packageId: linked.package && linked.package.id,
        lead: { leadKey: listing.leadKey || '', title: listing.name },
      },
    );
  } catch (err) {
    console.warn('[directoryLead] package attach failed:', err && err.message);
  }

  const appUrl = `${networkNotify.memberPortalLink(reviewBase, network, member)}/customers/c/${encodeURIComponent(saved.customer.id)}`;
  try {
    await networkNotify.notifyMemberFormLead({
      network,
      member,
      baseUrl: reviewBase,
      leadName: saved.customer.name || name || 'New lead',
      formName,
      source: 'website_form',
      preview,
      phone,
      email,
      customerId: saved.customer.id,
    });
  } catch (err) {
    console.warn('[directoryLead] Reviews notify failed:', err && err.message);
  }

  // Workspace CRM bell (agency) — separate from Reviews member inbox.
  try {
    notificationLog.add(
      workspaceId,
      {
        title: `Directory lead → ${member.companyName || listing.name}`,
        body: `${saved.customer.name || name}${preview ? ` — ${preview}` : ''}`.slice(0, 400),
        href: '/directory',
        linkLabel: 'Directory',
      },
      '',
    );
  } catch (_) {
    /* ignore */
  }

  const reviewPack = directoryMemberLink.publicReviewFields(member);

  return {
    routed: true,
    business: { slug: listing.slug, name: listing.name || '' },
    customer_id: saved.customer.id,
    app_url: appUrl,
    review_page_url: reviewPack.review_page_url,
    review_links: reviewPack.review_links,
    lead_form_url: formUrl,
    message: 'Thanks — your request was sent. The business was notified in their Reviews app.',
  };
}

module.exports = {
  clean,
  leadFormUrl,
  resolveMemberForListing,
  submitDirectoryLead,
  submitAllowed,
};
