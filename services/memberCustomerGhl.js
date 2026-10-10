/**
 * Sync member-app customers with Go High Level contacts (owner workspace location).
 * Separate from CRM prospect lead sync — these are review/customer contacts only.
 */
const ghlClient = require('./ghlClient');
const ghlMessaging = require('./ghlMessaging');
const workspaceIntegrations = require('./workspaceIntegrations');
const work = require('./memberWork');

function contactDisplayName(contact) {
  const fromParts = [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim();
  return String(
    contact.name ||
      contact.companyName ||
      contact.businessName ||
      fromParts ||
      contact.email ||
      contact.phone ||
      'Customer',
  ).trim();
}

function contactToFields(contact) {
  const phone = contact.phone && contact.phone !== 'N/A' ? String(contact.phone).trim() : '';
  const email = contact.email && contact.email !== 'N/A' ? String(contact.email).trim() : '';
  const address = contact.address1 ? String(contact.address1).trim() : '';
  const city = contact.city ? String(contact.city).trim() : '';
  const state = contact.state ? String(contact.state).trim() : '';
  const fullAddress = [address, city, state].filter(Boolean).join(', ');
  return {
    name: contactDisplayName(contact).slice(0, 120),
    phone,
    email,
    address: fullAddress.slice(0, 200),
    notes: '',
  };
}

async function integrationForNetwork(network) {
  return workspaceIntegrations.getResolvedIntegrationEnv(network.ownerWorkspaceId);
}

/**
 * Pull GHL contacts into the member customer list (create/update by id/phone/email).
 */
async function pullCustomersFromGhl(network, memberId, { maxPages = 5 } = {}) {
  const integrationEnv = await integrationForNetwork(network);
  if (!ghlClient.isConfigured(integrationEnv)) {
    return {
      ok: false,
      error: 'Go High Level isn’t connected. Ask your agency to connect GHL in Workspace → Integrations.',
    };
  }

  const existing = await work.listCustomers(network.id, memberId);
  const pages = Math.min(Math.max(parseInt(maxPages, 10) || 5, 1), 20);
  let startAfterId;
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (let page = 0; page < pages; page += 1) {
    // eslint-disable-next-line no-await-in-loop
    const batch = await ghlClient.listContacts(integrationEnv, { limit: 100, startAfterId });
    const contacts = batch.contacts || [];
    if (!contacts.length) break;

    for (const contact of contacts) {
      const ghlContactId = String(contact.id || '').trim();
      const fields = contactToFields(contact);
      if (!fields.name || (!fields.phone && !fields.email && !ghlContactId)) {
        skipped += 1;
        continue;
      }
      const match = work.findCustomerMatch(existing, {
        ghlContactId,
        email: fields.email,
        phone: fields.phone,
      });
      try {
        // eslint-disable-next-line no-await-in-loop
        const result = await work.saveCustomer(network.id, memberId, fields, {
          id: match ? match.id : undefined,
          ghlContactId,
          ghlSyncedAt: new Date().toISOString(),
          source: 'ghl',
        });
        if (!result.ok) {
          failed += 1;
          continue;
        }
        if (result.created) {
          created += 1;
          existing.push(result.customer);
        } else {
          updated += 1;
          const idx = existing.findIndex((c) => c.id === result.customer.id);
          if (idx >= 0) existing[idx] = result.customer;
        }
      } catch (_) {
        failed += 1;
      }
    }

    startAfterId = batch.nextStartAfterId || undefined;
    if (!startAfterId || contacts.length < 100) break;
  }

  return {
    ok: true,
    created,
    updated,
    skipped,
    failed,
    total: created + updated,
  };
}

/**
 * Push one customer to GHL and persist the contact id on the local record.
 */
async function pushCustomerToGhl(network, memberId, customer) {
  const integrationEnv = await integrationForNetwork(network);
  if (!ghlClient.isConfigured(integrationEnv)) {
    return { ok: false, error: 'GHL is not configured.' };
  }
  if (!customer || (!customer.phone && !customer.email)) {
    return { ok: false, error: 'Need a phone or email to sync with GHL.' };
  }
  try {
    const { contactId } = await ghlMessaging.ensureGhlContactForPerson(
      {
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        companyName: '',
      },
      integrationEnv,
    );
    const saved = await work.saveCustomer(
      network.id,
      memberId,
      {
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        address: customer.address,
        notes: customer.notes,
      },
      {
        id: customer.id,
        ghlContactId: contactId,
        ghlSyncedAt: new Date().toISOString(),
        source: customer.source || 'manual',
        referralId: customer.referralId,
      },
    );
    if (!saved.ok) return saved;
    return { ok: true, customer: saved.customer, contactId };
  } catch (err) {
    return { ok: false, error: (err && err.message) || 'GHL sync failed.' };
  }
}

/**
 * Push customers that are missing a GHL contact id (e.g. after CSV import or new adds).
 */
async function pushCustomersMissingGhl(network, memberId, customers, { limit = 100 } = {}) {
  const integrationEnv = await integrationForNetwork(network);
  if (!ghlClient.isConfigured(integrationEnv)) {
    return { ok: false, error: 'GHL is not configured.', pushed: 0, failed: 0 };
  }
  const list = (Array.isArray(customers) ? customers : []).filter(
    (c) => c && !c.ghlContactId && (c.phone || c.email),
  );
  const max = Math.min(list.length, Math.max(1, limit));
  let pushed = 0;
  let failed = 0;
  for (let i = 0; i < max; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const out = await pushCustomerToGhl(network, memberId, list[i]);
    if (out.ok) pushed += 1;
    else failed += 1;
  }
  return { ok: true, pushed, failed, considered: max };
}

/**
 * Full sync: pull from GHL, then push local customers that aren't linked yet.
 */
async function syncCustomersWithGhl(network, memberId, opts = {}) {
  const pull = await pullCustomersFromGhl(network, memberId, opts);
  if (!pull.ok) return pull;
  const locals = await work.listCustomers(network.id, memberId);
  const push = await pushCustomersMissingGhl(network, memberId, locals, {
    limit: opts.pushLimit || 100,
  });
  return {
    ok: true,
    pull,
    push,
    summary: `Synced ${pull.created + pull.updated} from GHL (${pull.created} new). Pushed ${push.pushed || 0} local customers.`,
  };
}

module.exports = {
  contactToFields,
  pullCustomersFromGhl,
  pushCustomerToGhl,
  pushCustomersMissingGhl,
  syncCustomersWithGhl,
};
