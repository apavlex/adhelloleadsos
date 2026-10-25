/**
 * Shared “ask this customer for a review” flow for MCP (Grok) and GHL webhooks.
 * Uses the member’s saved SMS script + review link + optional vCard.
 */
const store = require('./networkStore');
const work = require('./memberWork');
const notify = require('./networkNotify');
const reviewRequestScript = require('./reviewRequestScript');
const { getReviewPublicBaseUrl } = require('../lib/publicBaseUrl');
const { isOwnerMember } = require('./ownerAppBrand');

function clean(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max || 200);
}

function digits(value) {
  return String(value == null ? '' : value).replace(/\D+/g, '');
}

function norm(value) {
  return String(value == null ? '' : value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Pick which network member’s review page / script to use.
 * @param {object} network
 * @param {object[]} members
 * @param {string} [memberRef]
 */
function resolveReviewMember(network, members, memberRef) {
  const list = (Array.isArray(members) ? members : []).filter((m) => m && m.status !== 'paused');
  if (!list.length) {
    return { ok: false, error: 'No active network members to send a review request from.' };
  }
  if (memberRef) {
    const wanted = clean(memberRef, 120);
    const byId = list.find((m) => m.id === wanted);
    if (byId) return { ok: true, member: byId };
    const q = norm(wanted);
    const hits = list.filter(
      (m) => norm(m.companyName) === q || norm(m.contactName) === q
        || norm(m.companyName).includes(q) || norm(m.contactName).includes(q),
    );
    if (hits.length === 1) return { ok: true, member: hits[0] };
    if (!hits.length) return { ok: false, error: `No member matches "${wanted}".` };
    return {
      ok: false,
      error: `"${wanted}" matches several members: ${hits.map((m) => m.companyName).join(', ')}.`,
    };
  }
  const withSlug = list.filter((m) => m.reviewSlug);
  const owner = withSlug.find((m) => isOwnerMember(m, network)) || list.find((m) => isOwnerMember(m, network));
  if (owner && owner.reviewSlug) return { ok: true, member: owner };
  if (withSlug.length === 1) return { ok: true, member: withSlug[0] };
  if (withSlug.length > 1) {
    return {
      ok: false,
      error: `Several members have review pages (${withSlug.map((m) => m.companyName).join(', ')}). Pass member.`,
    };
  }
  return { ok: false, error: 'Add a review page slug / review links for a member first.' };
}

/**
 * Match a saved customer for this member (phone → email → name).
 */
async function findCustomer(networkId, memberId, { customerId, phone, email, name } = {}) {
  if (customerId && work.isRecordId(customerId)) {
    const row = await work.getCustomer(networkId, memberId, customerId);
    if (row) return row;
  }
  const customers = await work.listCustomers(networkId, memberId);
  const phoneDigits = digits(phone);
  if (phoneDigits.length >= 7) {
    const hit = customers.find((c) => {
      const d = digits(c.phone);
      return d && (d === phoneDigits || d.endsWith(phoneDigits.slice(-10)) || phoneDigits.endsWith(d.slice(-10)));
    });
    if (hit) return hit;
  }
  const em = clean(email, 200).toLowerCase();
  if (em && em.includes('@')) {
    const hit = customers.find((c) => String(c.email || '').trim().toLowerCase() === em);
    if (hit) return hit;
  }
  const q = norm(name);
  if (q) {
    const exact = customers.filter((c) => norm(c.name) === q);
    if (exact.length === 1) return exact[0];
    const partial = customers.filter((c) => norm(c.name).includes(q) || q.includes(norm(c.name)));
    if (partial.length === 1) return partial[0];
  }
  return null;
}

/**
 * Build or send a review request SMS/email for a customer.
 *
 * @param {object} opts
 * @param {object} opts.network
 * @param {string} [opts.memberRef]
 * @param {string} [opts.customerId]
 * @param {string} [opts.customerName]
 * @param {string} [opts.phone]
 * @param {string} [opts.email]
 * @param {string} [opts.channel] auto|sms|email
 * @param {boolean} [opts.useAi]
 * @param {boolean} [opts.preview] If true, return the message without sending
 * @param {string} [opts.baseUrl]
 */
async function requestReview(opts = {}) {
  const network = opts.network;
  if (!network || !network.id) return { ok: false, error: 'Network required.' };

  const members = await store.listMembers(network.id);
  const picked = resolveReviewMember(network, members, opts.memberRef);
  if (!picked.ok) return picked;
  const member = picked.member;

  const customer = await findCustomer(network.id, member.id, {
    customerId: opts.customerId,
    phone: opts.phone,
    email: opts.email,
    name: opts.customerName,
  });

  const phone = clean(opts.phone || (customer && customer.phone), 40);
  const email = clean(opts.email || (customer && customer.email), 200);
  const name = clean(opts.customerName || (customer && customer.name) || 'there', 120) || 'there';

  if ((!phone || phone === 'N/A') && (!email || !email.includes('@'))) {
    return {
      ok: false,
      error: customer
        ? `Saved customer "${customer.name}" has no phone or email.`
        : 'Provide a customer phone or email (or a saved customer name that has one).',
    };
  }

  const keywordDefaults = reviewRequestScript.memberKeywordDefaults(member);
  let jobsForCustomer = [];
  if (customer) {
    jobsForCustomer = (await work.listJobs(network.id, member.id))
      .filter((j) => j.customerId === customer.id);
  }
  const kw = reviewRequestScript.resolveReviewKeywords({
    customer,
    jobs: jobsForCustomer,
    defaults: keywordDefaults,
  });

  const company = member.companyName || 'the business';
  const reviewLink = member.reviewSlug
    ? `${getReviewPublicBaseUrl()}/rv/${encodeURIComponent(member.reviewSlug)}`
    : '';
  const vcardUrl = reviewRequestScript.memberVcardUrl(member);
  const attachVcard = reviewRequestScript.memberAttachVcard(member);

  if (opts.preview) {
    const built = await reviewRequestScript.buildReviewSms({
      member,
      customerName: name,
      companyName: company,
      reviewLink,
      useAi: opts.useAi !== false,
      jobTitle: kw.jobTitle,
      city: kw.city,
      keywords: kw.keywords,
    });
    const message = reviewRequestScript.maybeAttachVcardUrl(built.message, vcardUrl, {
      attach: attachVcard && !!vcardUrl,
      reviewLink: reviewRequestScript.scriptWantsReviewLink(built.script) ? reviewLink : '',
    });
    return {
      ok: true,
      preview: true,
      channel: 'sms',
      member: { id: member.id, company: member.companyName },
      customer: customer
        ? { id: customer.id, name: customer.name, phone: customer.phone || '', email: customer.email || '' }
        : { id: '', name, phone, email },
      message,
      review_link: reviewLink,
      vcard_url: attachVcard ? vcardUrl : '',
      provider: built.provider,
    };
  }

  const result = await notify.sendReviewRequest({
    network,
    member,
    baseUrl: opts.baseUrl || getReviewPublicBaseUrl(),
    toPhone: phone,
    toEmail: email,
    customerName: name,
    customerId: customer ? customer.id : '',
    channel: opts.channel || 'auto',
    useAi: opts.useAi !== false,
    jobTitle: kw.jobTitle,
    city: kw.city,
    keywords: kw.keywords,
  });

  if (!result.ok) return result;

  return {
    ok: true,
    preview: false,
    channel: result.channel,
    member: { id: member.id, company: member.companyName },
    customer: customer
      ? { id: customer.id, name: customer.name, phone: customer.phone || '', email: customer.email || '' }
      : { id: '', name, phone, email },
    message: result.message || result.smsBody || '',
    review_link: result.reviewUrl || reviewLink,
    ask_id: result.askId || (result.ask && result.ask.id) || '',
  };
}

module.exports = {
  resolveReviewMember,
  findCustomer,
  requestReview,
};
