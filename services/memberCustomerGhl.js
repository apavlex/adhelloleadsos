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

/** GHL / workspace tag names that mean “business partner”, not a homeowner customer. */
const PARTNER_TAG_NAME_RES = [
  /^referral\s*partner$/i,
  /^gb:\s*referral\s*network$/i,
  /\breferral\s*network\b/i,
];

function ghlTagNamesLookLikePartner(tagNames) {
  const names = (Array.isArray(tagNames) ? tagNames : [])
    .map((t) => String(t || '').trim())
    .filter(Boolean);
  return names.some((name) => PARTNER_TAG_NAME_RES.some((re) => re.test(name)));
}

/**
 * Ensure the shared “Referral partner” catalog tag exists so sync + list filters can use it.
 */
async function ensureReferralPartnerTag(workspaceId) {
  const catalog = await dbService.listTags(workspaceId);
  const hit = catalog.find((t) => /^referral\s*partner$/i.test(String(t.name || '').trim()));
  if (hit) {
    if (hit.isActive === false) {
      return (await dbService.setTagActive(workspaceId, hit.key, true)) || { ...hit, isActive: true };
    }
    return hit;
  }
  return dbService.createTag(workspaceId, 'Referral partner', '#3B82F6');
}

const WEBSITE_FORM_TAG_NAME = 'Website form';
const WEBSITE_FORM_TAG_COLOR = '#0EA5E9';

/** Shared “Website form” catalog tag — syncs to GHL when the contact is linked. */
async function ensureWebsiteFormTag(workspaceId) {
  const catalog = await dbService.listTags(workspaceId);
  const hit = catalog.find((t) => /^website\s*form$/i.test(String(t.name || '').trim()));
  if (hit) {
    if (hit.isActive === false) {
      return (await dbService.setTagActive(workspaceId, hit.key, true)) || { ...hit, isActive: true };
    }
    return hit;
  }
  return dbService.createTag(workspaceId, WEBSITE_FORM_TAG_NAME, WEBSITE_FORM_TAG_COLOR);
}

/**
 * Mark a Reviews contact as a lead from a website form: isLead + Website form tag + source.
 * Idempotent. Syncs the tag to GHL when linked.
 */
async function stampWebsiteFormLead(network, memberId, customer) {
  if (!network || !memberId || !customer || !customer.id) {
    return { ok: false, error: 'Customer required.' };
  }
  let next = customer;
  // Member removed them from Leads / marked as customer — keep Website form tag/source
  // but do not put them back on the Received list until they Mark as lead again.
  const leadDismissed = !!String(next.leadRemovedAt || '').trim();
  if (!next.isLead && !leadDismissed) {
    const marked = await work.setCustomerLeadFlag(network.id, memberId, next.id, true);
    if (marked.ok && marked.customer) next = marked.customer;
  }

  const wid = String(network.ownerWorkspaceId || '').trim();
  if (wid) {
    const tag = await ensureWebsiteFormTag(wid);
    const tagKey = String((tag && tag.key) || '').trim();
    const hasTag = work.normalizeCustomerTags(next.tags).includes(tagKey);
    const needSource = next.source !== 'website_form' && next.source !== 'referral' && next.source !== 'agency';
    if (tagKey && (!hasTag || needSource)) {
      const keys = new Set(work.normalizeCustomerTags(next.tags));
      if (tagKey) keys.add(tagKey);
      const saved = await work.saveCustomer(
        network.id,
        memberId,
        {
          name: next.name,
          phone: next.phone,
          email: next.email,
          address: next.address,
          notes: next.notes,
        },
        {
          id: next.id,
          tags: [...keys],
          ghlContactId: next.ghlContactId,
          ghlSyncedAt: next.ghlSyncedAt,
          source: needSource ? 'website_form' : next.source,
          referralId: next.referralId,
          isReferralPartner: next.isReferralPartner,
        },
      );
      if (saved.ok && saved.customer) {
        next = saved.customer;
        // Re-apply lead flag — saveCustomer preserves isLead from existing via spread,
        // but be safe if the record was re-normalized without it.
        if (!next.isLead && !leadDismissed && !next.leadRemovedAt) {
          const again = await work.setCustomerLeadFlag(network.id, memberId, next.id, true);
          if (again.ok && again.customer) next = again.customer;
        }
        await pushCustomerTagsToGhl(network, next).catch(() => null);
      }
    }
  } else if (next.source !== 'website_form' && next.source !== 'referral' && next.source !== 'agency') {
    const saved = await work.saveCustomer(
      network.id,
      memberId,
      {
        name: next.name,
        phone: next.phone,
        email: next.email,
        address: next.address,
        notes: next.notes,
      },
      {
        id: next.id,
        tags: next.tags,
        ghlContactId: next.ghlContactId,
        ghlSyncedAt: next.ghlSyncedAt,
        source: 'website_form',
        referralId: next.referralId,
        isReferralPartner: next.isReferralPartner,
      },
    );
    if (saved.ok && saved.customer) next = saved.customer;
  }

  return { ok: true, customer: next };
}

/** True when a local customer should be treated as a referral business, not a homeowner. */
function customerLooksLikePartner(customer, tagNameByKey = null) {
  if (customer && customer.isReferralPartner === true) return true;
  const keys = work.normalizeCustomerTags(customer && customer.tags);
  if (!keys.length) return false;
  if (tagNameByKey && typeof tagNameByKey.get === 'function') {
    return ghlTagNamesLookLikePartner(keys.map((k) => tagNameByKey.get(k) || ''));
  }
  return false;
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

  const partnerTag = await ensureReferralPartnerTag(network.ownerWorkspaceId).catch(() => null);
  const existing = await work.listCustomers(network.id, memberId);
  const pages = Math.min(Math.max(parseInt(maxPages, 10) || 5, 1), 20);
  let startAfterId;
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let skippedPartners = 0;
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
      const isPartner = ghlTagNamesLookLikePartner(contact.tags || []);
      // Don't import new partner businesses into the homeowner customer list.
      if (isPartner && !match) {
        skipped += 1;
        skippedPartners += 1;
        continue;
      }
      try {
        // Preserve local notes on update — pull fields always send notes: ''.
        if (match && match.notes) fields.notes = match.notes;
        // eslint-disable-next-line no-await-in-loop
        let tags = await activeTagKeysFromGhlNames(network.ownerWorkspaceId, contact.tags || []);
        if (isPartner && partnerTag && partnerTag.key && !tags.includes(partnerTag.key)) {
          tags = work.normalizeCustomerTags([...tags, partnerTag.key]);
        }
        // eslint-disable-next-line no-await-in-loop
        const result = await work.saveCustomer(network.id, memberId, fields, {
          id: match ? match.id : undefined,
          ghlContactId,
          ghlSyncedAt: new Date().toISOString(),
          source: 'ghl',
          tags,
          isReferralPartner: isPartner,
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
    skippedPartners,
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
 * Resolve a workspace tag by key or name. Creates (or reactivates) when adding by name.
 * @returns {{ ok: true, tag } | { ok: false, error: string }}
 */
async function resolveWorkspaceTag(workspaceId, { tagKey, tagName, createIfMissing = false } = {}) {
  const catalog = await dbService.listTags(workspaceId);
  const key = String(tagKey || '').trim();
  if (key) {
    const found = catalog.find((t) => t.key === key);
    if (!found) return { ok: false, error: 'That tag is not available.' };
    if (found.isActive === false) {
      if (!createIfMissing) return { ok: false, error: 'That tag is inactive or not available.' };
      const revived = await dbService.setTagActive(workspaceId, key, true);
      return { ok: true, tag: revived || { ...found, isActive: true } };
    }
    return { ok: true, tag: found };
  }

  const name = String(tagName || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!name) return { ok: false, error: 'Enter a tag name.' };
  const existing = catalog.find(
    (t) => String(t.name || '').trim().toLowerCase() === name.toLowerCase(),
  );
  if (existing) {
    if (existing.isActive === false) {
      if (!createIfMissing) return { ok: false, error: 'That tag is inactive or not available.' };
      const revived = await dbService.setTagActive(workspaceId, existing.key, true);
      return { ok: true, tag: revived || { ...existing, isActive: true } };
    }
    return { ok: true, tag: existing };
  }
  if (!createIfMissing) return { ok: false, error: 'No matching tag. Create it to continue.' };
  const created = await dbService.createTag(workspaceId, name);
  return { ok: true, tag: created };
}

/**
 * Add/remove a single active tag and sync to GHL when linked.
 * For add: pass tagKey and/or tagName (name can create a new workspace tag).
 */
async function setCustomerTag(network, memberId, customerId, tagKey, { add, tagName } = {}) {
  const customer = await work.getCustomer(network.id, memberId, customerId);
  if (!customer) return { ok: false, error: 'Customer not found.' };

  let tag;
  if (add) {
    const resolved = await resolveWorkspaceTag(network.ownerWorkspaceId, {
      tagKey,
      tagName,
      createIfMissing: true,
    });
    if (!resolved.ok) return resolved;
    tag = resolved.tag;
  } else {
    const key = String(tagKey || '').trim();
    if (!key) return { ok: false, error: 'Pick a tag.' };
    const resolved = await resolveWorkspaceTag(network.ownerWorkspaceId, {
      tagKey: key,
      createIfMissing: false,
    });
    // Allow removing a stored key even if the catalog entry was deactivated.
    tag = resolved.ok ? resolved.tag : { key, name: key };
  }

  const key = String(tag.key || '').trim();
  if (!key) return { ok: false, error: 'Pick a tag.' };

  const current = new Set(work.normalizeCustomerTags(customer.tags));
  if (add) current.add(key);
  else current.delete(key);
  const catalog = await listActiveWorkspaceTags(network.ownerWorkspaceId);
  const nameByKey = new Map(catalog.map((t) => [t.key, t.name]));
  nameByKey.set(key, tag.name || nameByKey.get(key) || '');
  const partnerByTags = ghlTagNamesLookLikePartner(
    [...current].map((k) => nameByKey.get(k) || ''),
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
      tags: [...current],
      isReferralPartner: partnerByTags,
      ghlContactId: customer.ghlContactId,
      ghlSyncedAt: customer.ghlSyncedAt,
      source: customer.source,
      referralId: customer.referralId,
    },
  );
  if (!saved.ok) return saved;

  // Local save wins first — GHL catch-up runs in the background so the
  // member app can feel instant when tapping suggestion chips.
  if (saved.customer.ghlContactId) {
    pushCustomerTagsToGhl(network, saved.customer).catch(() => null);
  } else if (saved.customer.phone || saved.customer.email) {
    pushCustomerToGhl(network, memberId, saved.customer).catch(() => null);
  }
  return { ok: true, customer: saved.customer, tag, ghl: { ok: true, pending: true } };
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
    (c) => c && !c.ghlContactId && !c.isReferralPartner && (c.phone || c.email),
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
  const partnerNote = pull.skippedPartners
    ? ` Skipped ${pull.skippedPartners} referral partner${pull.skippedPartners === 1 ? '' : 's'}.`
    : '';
  return {
    ok: true,
    pull,
    push,
    summary: `Synced ${pull.created + pull.updated} from GHL CRM (${pull.created} new). Pushed ${push.pushed || 0} local customers.${partnerNote}`,
  };
}

async function saveCustomerFormAnswers(network, memberId, customer, answers, addressOverride) {
  const saved = await work.saveCustomer(
    network.id,
    memberId,
    {
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      address: addressOverride != null ? addressOverride : customer.address,
      notes: customer.notes,
    },
    {
      id: customer.id,
      tags: customer.tags,
      ghlContactId: customer.ghlContactId,
      ghlSyncedAt: customer.ghlSyncedAt,
      source: customer.source,
      referralId: customer.referralId,
      isReferralPartner: customer.isReferralPartner,
      formAnswers: answers,
    },
  );
  return saved.ok && saved.customer ? saved.customer : customer;
}

/**
 * Backfill website form Q&A onto a Reviews customer profile.
 * Only for contacts that actually came from a website form — never invent
 * Company / Type / Address from the GHL contact record for manual leads.
 * Prefers answers already stamped on the workspace lead; otherwise pulls from GHL.
 */
async function ensureFormAnswersOnCustomer(network, memberId, customer) {
  if (!network || !memberId || !customer || !customer.id) return customer;
  const src = String(customer.source || '').trim().toLowerCase();
  const {
    normalizeFormAnswers,
    fetchContactFormAnswers,
    looksLikeOnlyContactProfileAnswers,
  } = require('./ghlFormAnswers');

  // No website form → keep Form answers closed; clear any CRM crumbs we previously saved.
  if (src !== 'website_form') {
    if (Array.isArray(customer.formAnswers) && customer.formAnswers.length) {
      return saveCustomerFormAnswers(network, memberId, customer, []);
    }
    return customer;
  }

  const existing = Array.isArray(customer.formAnswers) ? customer.formAnswers : [];
  if (existing.length && !looksLikeOnlyContactProfileAnswers(existing)) {
    return customer;
  }

  const ghlId = String(customer.ghlContactId || '').trim();
  let answers = [];

  const wid = String(network.ownerWorkspaceId || '').trim();
  if (wid && ghlId) {
    try {
      const leads = await dbService.getAllLeads(wid);
      const lead = (Array.isArray(leads) ? leads : []).find(
        (l) => l && String(l.ghlContactId || '').trim() === ghlId,
      );
      if (lead) {
        if (Array.isArray(lead.formAnswers) && lead.formAnswers.length
          && !looksLikeOnlyContactProfileAnswers(lead.formAnswers)) {
          answers = normalizeFormAnswers(lead.formAnswers);
        } else {
          const events = Array.isArray(lead.inboundEvents) ? lead.inboundEvents : [];
          for (let i = events.length - 1; i >= 0; i -= 1) {
            const ev = events[i];
            if (!ev || String(ev.type || '') !== 'form') continue;
            if (Array.isArray(ev.answers) && ev.answers.length
              && !looksLikeOnlyContactProfileAnswers(ev.answers)) {
              answers = normalizeFormAnswers(ev.answers);
              break;
            }
          }
        }
      }
    } catch (err) {
      console.warn('[memberCustomerGhl] form answers from lead failed:', err && err.message);
    }
  }

  if (!answers.length && ghlId) {
    try {
      const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(wid);
      if (ghlClient.isConfigured(integrationEnv)) {
        answers = await fetchContactFormAnswers(ghlId, integrationEnv, {
          email: customer.email,
          phone: customer.phone,
          name: customer.name,
          address: customer.address,
          includeCoreFallback: false,
          // Custom fields / submissions only — not Company / Type / Address from the contact card.
          contactFallback: 'custom',
        });
      }
    } catch (err) {
      console.warn('[memberCustomerGhl] form answers from GHL failed:', err && err.message);
    }
  }

  if (looksLikeOnlyContactProfileAnswers(answers)) answers = [];

  // Clear previously invented CRM crumbs when we still have nothing real.
  if (!answers.length) {
    if (existing.length) {
      return saveCustomerFormAnswers(network, memberId, customer, []);
    }
    return customer;
  }

  let address = customer.address || '';
  if (!address) {
    const { addressFromFormAnswers } = require('./ghlFormAnswers');
    address = addressFromFormAnswers(answers) || '';
  }

  return saveCustomerFormAnswers(network, memberId, customer, answers, address);
}

module.exports = {
  contactToFields,
  listActiveWorkspaceTags,
  activeTagKeysFromGhlNames,
  presentCustomerTags,
  availableCustomerTags,
  resolveWorkspaceTag,
  ghlTagNamesLookLikePartner,
  ensureReferralPartnerTag,
  ensureWebsiteFormTag,
  stampWebsiteFormLead,
  ensureFormAnswersOnCustomer,
  WEBSITE_FORM_TAG_NAME,
  customerLooksLikePartner,
  pushCustomerTagsToGhl,
  pullCustomerTagsFromGhl,
  setCustomerTag,
  pullCustomersFromGhl,
  pushCustomerToGhl,
  pushCustomersMissingGhl,
  syncCustomersWithGhl,
};
