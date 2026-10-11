/**
 * Sync member-app customers with GHL CRM contacts (owner workspace location).
 * Separate from CRM prospect lead sync — these are review/customer contacts only.
 * Tags: 2-way with the workspace tag catalog; only active tags are shown/synced.
 */
const ghlClient = require('./ghlClient');
const ghlMessaging = require('./ghlMessaging');
const workspaceIntegrations = require('./workspaceIntegrations');
const dbService = require('./database');
const ghlProspectSync = require('./ghlProspectSync');
const { tagsToAdd, tagKey } = require('./ghlSyncHelpers');
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

function isActiveTag(tag) {
  return !tag || tag.isActive !== false;
}

/** Active workspace tags for the agency that owns this network (UI catalog). */
async function listActiveWorkspaceTags(workspaceId) {
  const catalog = await dbService.listTags(workspaceId);
  return catalog.filter(isActiveTag);
}

/**
 * Map GHL contact tag names → active workspace tag keys only (inactive hidden).
 */
async function activeTagKeysFromGhlNames(workspaceId, ghlTagNames) {
  const keys = await ghlProspectSync.resolveGhlTagNamesToLeadKeys(workspaceId, ghlTagNames, []);
  const active = await listActiveWorkspaceTags(workspaceId);
  const activeKeys = new Set(active.map((t) => t.key));
  return work.normalizeCustomerTags(keys.filter((k) => activeKeys.has(k)));
}

/** Active catalog entries currently on a customer (for chips). */
async function presentCustomerTags(workspaceId, customer) {
  const active = await listActiveWorkspaceTags(workspaceId);
  const byKey = new Map(active.map((t) => [t.key, t]));
  const keys = work.normalizeCustomerTags(customer && customer.tags);
  return keys.map((key) => byKey.get(key)).filter(Boolean);
}

/** Active tags not yet on the customer (for Add). */
async function availableCustomerTags(workspaceId, customer) {
  const active = await listActiveWorkspaceTags(workspaceId);
  const onCustomer = new Set(work.normalizeCustomerTags(customer && customer.tags));
  return active.filter((t) => !onCustomer.has(t.key));
}

/**
 * Push local customer tags to GHL. Only manages active catalog tag names
 * (won't strip unrelated GHL tags or inactive catalog names).
 */
async function pushCustomerTagsToGhl(network, customer, integrationEnv) {
  const env = integrationEnv || (await integrationForNetwork(network));
  if (!ghlClient.isConfigured(env)) {
    return { ok: false, error: 'GHL CRM is not configured.' };
  }
  const contactId = String((customer && customer.ghlContactId) || '').trim();
  if (!contactId) return { ok: false, error: 'Customer is not linked to GHL yet.' };

  const workspaceId = network.ownerWorkspaceId;
  const active = await listActiveWorkspaceTags(workspaceId);
  const byKey = new Map(active.map((t) => [t.key, t.name]));
  const desiredNames = work
    .normalizeCustomerTags(customer && customer.tags)
    .map((k) => byKey.get(k))
    .filter(Boolean);

  const contact = await ghlClient.getContact(contactId, env);
  const remoteTags = Array.isArray(contact && contact.tags) ? contact.tags : [];
  const catalogNameByLower = new Map(
    active.map((t) => [String(t.name || '').trim().toLowerCase(), String(t.name || '').trim()]),
  );
  const remoteManaged = remoteTags.filter((t) => catalogNameByLower.has(tagKey(t)));

  const toAdd = tagsToAdd(remoteTags, desiredNames);
  const desiredLower = new Set(desiredNames.map(tagKey));
  const toRemove = remoteManaged.filter((t) => !desiredLower.has(tagKey(t)));

  if (toRemove.length) {
    await ghlClient.removeTagsFromContact(contactId, toRemove, env);
  }
  if (toAdd.length) {
    await ghlClient.addTagsToContact(contactId, toAdd, env);
  }
  return { ok: true, added: toAdd, removed: toRemove };
}

/**
 * Pull tags for one linked customer from GHL (active catalog only).
 */
async function pullCustomerTagsFromGhl(network, memberId, customer) {
  if (!customer || !customer.id) return { ok: false, error: 'Customer not found.' };
  const integrationEnv = await integrationForNetwork(network);
  if (!ghlClient.isConfigured(integrationEnv)) {
    return { ok: false, error: 'GHL CRM is not configured.' };
  }
  const contactId = String(customer.ghlContactId || '').trim();
  if (!contactId) return { ok: true, customer, skipped: true };

  try {
    const contact = await ghlClient.getContact(contactId, integrationEnv);
    const tags = await activeTagKeysFromGhlNames(
      network.ownerWorkspaceId,
      (contact && contact.tags) || [],
    );
    const saved = await work.setCustomerTags(network.id, memberId, customer.id, tags);
    if (!saved.ok) return saved;
    return { ok: true, customer: saved.customer, tags };
  } catch (err) {
    return { ok: false, error: (err && err.message) || 'Could not refresh tags from GHL.' };
  }
}

/**
 * Pull GHL contacts into the member customer list (create/update by id/phone/email).
 */
async function pullCustomersFromGhl(network, memberId, { maxPages = 5 } = {}) {
  const integrationEnv = await integrationForNetwork(network);
  if (!ghlClient.isConfigured(integrationEnv)) {
    return {
      ok: false,
      error: 'GHL CRM isn’t connected. Ask your agency to connect GHL CRM in Workspace → Integrations.',
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
        // Preserve local notes on update — pull fields always send notes: ''.
        if (match && match.notes) fields.notes = match.notes;
        // eslint-disable-next-line no-await-in-loop
        const tags = await activeTagKeysFromGhlNames(network.ownerWorkspaceId, contact.tags || []);
        // eslint-disable-next-line no-await-in-loop
        const result = await work.saveCustomer(network.id, memberId, fields, {
          id: match ? match.id : undefined,
          ghlContactId,
          ghlSyncedAt: new Date().toISOString(),
          source: 'ghl',
          tags,
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
    return { ok: false, error: 'GHL CRM is not configured.' };
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
        tags: customer.tags,
      },
    );
    if (!saved.ok) return saved;
    await pushCustomerTagsToGhl(network, saved.customer, integrationEnv).catch(() => null);
    return { ok: true, customer: saved.customer, contactId };
  } catch (err) {
    return { ok: false, error: (err && err.message) || 'GHL sync failed.' };
  }
}

/**
 * Add/remove a single active tag and sync to GHL when linked.
 */
async function setCustomerTag(network, memberId, customerId, tagKey, { add } = {}) {
  const key = String(tagKey || '').trim();
  if (!key) return { ok: false, error: 'Pick a tag.' };
  const active = await listActiveWorkspaceTags(network.ownerWorkspaceId);
  const allowed = active.find((t) => t.key === key);
  if (!allowed) {
    return { ok: false, error: 'That tag is inactive or not available.' };
  }
  const customer = await work.getCustomer(network.id, memberId, customerId);
  if (!customer) return { ok: false, error: 'Customer not found.' };
  const current = new Set(work.normalizeCustomerTags(customer.tags));
  if (add) current.add(key);
  else current.delete(key);
  const saved = await work.setCustomerTags(network.id, memberId, customerId, [...current]);
  if (!saved.ok) return saved;

  let ghl = { ok: true, skipped: true };
  if (saved.customer.ghlContactId) {
    ghl = await pushCustomerTagsToGhl(network, saved.customer).catch((err) => ({
      ok: false,
      error: (err && err.message) || 'GHL tag sync failed.',
    }));
  } else if (saved.customer.phone || saved.customer.email) {
    const pushed = await pushCustomerToGhl(network, memberId, saved.customer).catch(() => null);
    if (pushed && pushed.ok) {
      return { ok: true, customer: pushed.customer, tag: allowed, ghl: { ok: true } };
    }
  }
  return { ok: true, customer: saved.customer, tag: allowed, ghl };
}

/**
 * Push customers that are missing a GHL contact id (e.g. after CSV import or new adds).
 */
async function pushCustomersMissingGhl(network, memberId, customers, { limit = 100 } = {}) {
  const integrationEnv = await integrationForNetwork(network);
  if (!ghlClient.isConfigured(integrationEnv)) {
    return { ok: false, error: 'GHL CRM is not configured.', pushed: 0, failed: 0 };
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
    summary: `Synced ${pull.created + pull.updated} from GHL CRM (${pull.created} new). Pushed ${push.pushed || 0} local customers.`,
  };
}

module.exports = {
  contactToFields,
  listActiveWorkspaceTags,
  activeTagKeysFromGhlNames,
  presentCustomerTags,
  availableCustomerTags,
  pushCustomerTagsToGhl,
  pullCustomerTagsFromGhl,
  setCustomerTag,
  pullCustomersFromGhl,
  pushCustomerToGhl,
  pushCustomersMissingGhl,
  syncCustomersWithGhl,
};
