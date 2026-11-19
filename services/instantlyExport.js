/**
 * Map workspace leads onto Instantly bulk-add payloads and send them in chunks of 1000.
 * Campaigns require an email. Lists accept an email or a person/company name.
 */

const instantlyClient = require('./instantlyClient');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_LEADS = 2000;

function clean(value, max = 180) {
  const s = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  if (!s || /^n\/?a$/i.test(s)) return '';
  return s.slice(0, max);
}

function normalizeEmail(value) {
  const email = clean(value, 180).toLowerCase();
  return EMAIL_RE.test(email) ? email : '';
}

function splitName(name) {
  const parts = clean(name, 120).split(' ').filter(Boolean);
  if (!parts.length) return { first_name: '', last_name: '' };
  if (parts.length === 1) return { first_name: parts[0], last_name: '' };
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') };
}

function personName(lead, contact) {
  const fromContact = contact && (contact.name || contact.fullName);
  return clean(
    fromContact ||
      (lead && (lead.contactName || lead.ownerName || lead.decisionMakerName || lead.principal)) ||
      '',
    120,
  );
}

function companyName(lead) {
  return clean((lead && (lead.title || lead.businessName || lead.name)) || '', 160);
}

function websiteOf(lead) {
  const raw = clean(lead && lead.website, 240);
  if (!raw || !raw.includes('.')) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function phoneOf(lead, contact) {
  return clean((contact && contact.phone) || (lead && lead.phone) || '', 40);
}

function customVariables(lead, phone) {
  const vars = {};
  const put = (key, value) => {
    const s = clean(value, 200);
    if (s) vars[key] = s;
  };
  put('phone', phone);
  put('city', lead && lead.city);
  put('state', lead && lead.state);
  put('zip', lead && (lead.zip || lead.postalCode));
  put('trade', lead && (lead.categoryName || lead.keyword));
  put('license', lead && lead.contractorLicenseNumber);
  put('source', lead && (lead.source || lead.sourceType));
  return Object.keys(vars).length ? vars : undefined;
}

function emailSources(lead) {
  const rows = [];
  const seen = new Set();
  const add = (raw, contact) => {
    const email = normalizeEmail(raw);
    if (!email || seen.has(email)) return;
    seen.add(email);
    rows.push({ email, contact: contact || null });
  };
  add(lead && lead.email, null);
  const lists = [lead && lead.contacts, lead && lead.emailContacts, lead && lead.people];
  lists.forEach((list) => {
    if (!Array.isArray(list)) return;
    list.forEach((contact) => add(contact && (contact.email || contact.emailAddress), contact));
  });
  return rows;
}

function payloadFrom(lead, { email, contact, requireEmail }) {
  const name = splitName(personName(lead, contact));
  const company = companyName(lead);
  if (!email && requireEmail) return null;
  if (!email && !name.first_name && !name.last_name && !company) return null;
  const phone = phoneOf(lead, contact);
  const row = {
    email: email || null,
    first_name: name.first_name || (!email && company ? company : '') || null,
    last_name: name.last_name || null,
    company_name: company || null,
    phone: phone || null,
    website: websiteOf(lead) || null,
    custom_variables: customVariables(lead, phone),
  };
  const role = clean(contact && (contact.role || contact.title), 80);
  if (role && !/^email$/i.test(role)) row.job_title = role;
  Object.keys(row).forEach((key) => {
    if (row[key] == null || row[key] === '') delete row[key];
  });
  return row;
}

/**
 * One Instantly row per email. Lists without an email still get a name row.
 * @returns {{ payloads: object[], skipped: { key: string, title: string, reason: string }[] }}
 */
function rowsForLead(lead, { requireEmail }) {
  const key = String((lead && lead.key) || '').trim();
  const title = companyName(lead) || key;
  const emails = emailSources(lead);
  if (emails.length) {
    return {
      payloads: emails
        .map((source) => payloadFrom(lead, { ...source, requireEmail: true }))
        .filter(Boolean)
        .map((payload) => ({ leadKey: key, payload })),
      skipped: [],
    };
  }
  if (requireEmail) {
    return { payloads: [], skipped: [{ key, title, reason: 'no_email' }] };
  }
  const payload = payloadFrom(lead, { email: '', contact: null, requireEmail: false });
  if (!payload) return { payloads: [], skipped: [{ key, title, reason: 'no_name_or_email' }] };
  return { payloads: [{ leadKey: key, payload }], skipped: [] };
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function exportLeads({
  leads,
  campaignId,
  listId,
  integrationEnv,
  client,
  fetchImpl,
  markLead,
} = {}) {
  const api = client || instantlyClient;
  if (!api.isConfigured(integrationEnv)) {
    const err = new Error('Instantly is not connected. Add an API key under Workspace → Integrations.');
    err.code = 'INSTANTLY_NOT_CONFIGURED';
    throw err;
  }
  const campaign = String(campaignId || '').trim();
  const list = String(listId || '').trim();
  if (campaign && list) {
    const err = new Error('Choose either an Instantly campaign or a list.');
    err.status = 400;
    throw err;
  }
  if (!campaign && !list) {
    const err = new Error('Choose an Instantly campaign or list.');
    err.status = 400;
    throw err;
  }
  const source = Array.isArray(leads) ? leads.filter(Boolean).slice(0, MAX_LEADS) : [];
  if (!source.length) {
    const err = new Error('Select at least one lead.');
    err.status = 400;
    throw err;
  }

  const prepared = [];
  const skipped = [];
  const seenEmail = new Set();
  source.forEach((lead) => {
    const built = rowsForLead(lead, { requireEmail: !!campaign });
    skipped.push(...built.skipped);
    built.payloads.forEach((row) => {
      const email = row.payload && row.payload.email ? String(row.payload.email).toLowerCase() : '';
      if (email && seenEmail.has(email)) return;
      if (email) seenEmail.add(email);
      prepared.push(row);
    });
  });

  const totals = {
    uploaded: 0,
    duplicated: 0,
    skippedByInstantly: 0,
    invalidEmail: 0,
    inBlocklist: 0,
    sent: 0,
  };
  const sentKeys = new Set();
  for (let i = 0; i < prepared.length; i += instantlyClient.BATCH_LIMIT) {
    const slice = prepared.slice(i, i + instantlyClient.BATCH_LIMIT);
    // eslint-disable-next-line no-await-in-loop
    const summary = await api.addLeads(integrationEnv, {
      campaignId: campaign,
      listId: list,
      leads: slice.map((row) => row.payload),
      fetchImpl,
      idempotencyKey: `adhello-${Date.now()}-${i}`,
    });
    totals.uploaded += num(summary.leads_uploaded);
    totals.duplicated += num(summary.duplicated_leads);
    totals.skippedByInstantly += num(summary.skipped_count);
    totals.invalidEmail += num(summary.invalid_email_count);
    totals.inBlocklist += num(summary.in_blocklist);
    totals.sent += num(summary.total_sent) || slice.length;
    slice.forEach((row) => {
      if (row.leadKey) sentKeys.add(row.leadKey);
    });
  }

  if (typeof markLead === 'function' && sentKeys.size) {
    const stamp = {
      instantlyExportedAt: new Date().toISOString(),
      instantlyDestinationType: campaign ? 'campaign' : 'list',
      instantlyDestinationId: campaign || list,
    };
    for (const key of sentKeys) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await markLead(key, stamp);
      } catch {
        /* export already landed; a local stamp is optional */
      }
    }
  }

  return {
    destinationType: campaign ? 'campaign' : 'list',
    destinationId: campaign || list,
    leadsConsidered: source.length,
    payloadsSent: prepared.length,
    skippedNoEmail: skipped.filter((row) => row.reason === 'no_email').length,
    skippedIncomplete: skipped.filter((row) => row.reason !== 'no_email').length,
    skipped,
    ...totals,
  };
}

module.exports = {
  MAX_LEADS,
  normalizeEmail,
  rowsForLead,
  exportLeads,
};
