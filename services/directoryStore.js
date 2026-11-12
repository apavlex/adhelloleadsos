/**
 * Public business directory per workspace — curated listings from Pipeline leads.
 * Persists under workspace.directory; public sites read via publish token.
 */
const crypto = require('crypto');
const dbService = require('./database');

const TOKEN_KV_PREFIX = 'directoryToken:';

function newListingId() {
  return `dir_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
}

function newPublicToken() {
  return `dir_${crypto.randomBytes(18).toString('hex')}`;
}

function clean(v, max = 500) {
  return String(v == null ? '' : v)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function slugify(value) {
  const base = clean(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return base || `listing-${crypto.randomBytes(3).toString('hex')}`;
}

function emptyBundle(workspaceId) {
  return {
    workspaceId: String(workspaceId || ''),
    settings: {
      pageUrl: '',
      pageTitle: 'Local Business Directory',
      businessName: '',
      pathPrefix: '/directory',
      publicToken: '',
      showPhone: true,
      showWebsite: true,
      showAddress: true,
      showRating: true,
    },
    listings: {},
    updatedAt: new Date().toISOString(),
  };
}

function leadPublicFields(lead) {
  const l = lead && typeof lead === 'object' ? lead : {};
  const title = clean(l.title || l.name || l.companyName, 160);
  const city = clean(l.city || (l.addressComponents && l.addressComponents.city), 80);
  const state = clean(l.state || (l.addressComponents && l.addressComponents.state), 40);
  const address = clean(l.address || l.fullAddress || [l.street, city, state].filter(Boolean).join(', '), 240);
  const category = clean(l.category || l.primaryCategory || l.jobType, 120);
  const phone = clean(l.phone || l.phoneNumber || '', 40);
  const website = clean(l.website || l.websiteUrl || l.url || '', 400);
  const ratingRaw = l.rating != null ? Number(l.rating) : (l.stars != null ? Number(l.stars) : null);
  const rating = Number.isFinite(ratingRaw) ? Math.round(ratingRaw * 10) / 10 : null;
  const reviewsRaw = l.reviewsCount != null ? Number(l.reviewsCount) : (l.reviewCount != null ? Number(l.reviewCount) : null);
  const reviewCount = Number.isFinite(reviewsRaw) ? Math.max(0, Math.floor(reviewsRaw)) : null;
  const imageUrl = clean(l.imageUrl || l.photoUrl || l.thumbnailUrl || '', 500);
  const description = clean(l.description || l.snippet || l.notes || '', 600);
  return {
    name: title,
    category,
    city,
    state,
    address,
    phone,
    website,
    rating,
    reviewCount,
    imageUrl,
    description,
  };
}

function normalizeListing(raw, fallbackId) {
  const row = raw && typeof raw === 'object' ? raw : {};
  const id = clean(row.id || fallbackId || newListingId(), 80) || newListingId();
  const leadKey = clean(row.leadKey, 200);
  const name = clean(row.name, 160) || 'Business';
  const slug = slugify(row.slug || name);
  return {
    id,
    leadKey,
    slug,
    name,
    category: clean(row.category, 120),
    city: clean(row.city, 80),
    state: clean(row.state, 40),
    address: clean(row.address, 240),
    phone: clean(row.phone, 40),
    website: clean(row.website, 400),
    rating: row.rating == null || row.rating === '' ? null : Number(row.rating),
    reviewCount: row.reviewCount == null || row.reviewCount === '' ? null : Math.max(0, Math.floor(Number(row.reviewCount) || 0)),
    imageUrl: clean(row.imageUrl, 500),
    description: clean(row.description, 600),
    blurb: clean(row.blurb, 400),
    published: row.published === true,
    createdAt: row.createdAt || new Date().toISOString(),
    publishedAt: row.publishedAt || (row.published === true ? new Date().toISOString() : null),
    updatedAt: row.updatedAt || new Date().toISOString(),
  };
}

async function load(workspaceId, opts = {}) {
  const wid = String(workspaceId || '').trim();
  if (!wid) return emptyBundle('');
  const normalize = opts.normalize !== false;
  const ws =
    opts.workspace && typeof opts.workspace === 'object'
      ? opts.workspace
      : (await dbService.getWorkspace(wid)) || { id: wid };
  const raw = ws.directory && typeof ws.directory === 'object' ? ws.directory : null;
  const base = emptyBundle(wid);
  if (!raw) return { ...base, workspace: ws };
  const settings = {
    ...base.settings,
    ...(raw.settings && typeof raw.settings === 'object' ? raw.settings : {}),
  };
  const listings = {};
  const src = raw.listings && typeof raw.listings === 'object' ? raw.listings : {};
  for (const [id, row] of Object.entries(src)) {
    if (!row || typeof row !== 'object') continue;
    listings[id] = normalize ? normalizeListing(row, id) : { ...row, id: row.id || id };
  }
  return {
    workspaceId: wid,
    settings,
    listings,
    updatedAt: raw.updatedAt || null,
    workspace: ws,
  };
}

async function indexPublicToken(workspaceId, token, prevToken) {
  const wid = String(workspaceId || '').trim();
  const next = clean(token, 80);
  const prev = clean(prevToken, 80);
  if (prev && prev !== next) {
    try {
      dbService.deleteKvSync(TOKEN_KV_PREFIX + prev);
    } catch (_) {
      /* ignore */
    }
  }
  if (next) {
    dbService.setKvSync(TOKEN_KV_PREFIX + next, { workspaceId: wid, at: new Date().toISOString() });
  }
}

async function save(workspaceId, patch) {
  const wid = String(workspaceId || '').trim();
  const prev = await load(wid);
  const ws = prev.workspace || (await dbService.getWorkspace(wid)) || { id: wid };
  const nextSettings = {
    ...prev.settings,
    ...((patch && patch.settings) || {}),
  };
  let listings = { ...prev.listings };
  if (patch && patch.listings && typeof patch.listings === 'object') {
    listings = {};
    for (const [id, row] of Object.entries(patch.listings)) {
      if (!row) continue;
      listings[id] = normalizeListing(row, id);
    }
  }
  const next = {
    workspaceId: wid,
    settings: nextSettings,
    listings,
    updatedAt: new Date().toISOString(),
  };
  await dbService.saveWorkspace(wid, { ...ws, id: wid, directory: next });
  await indexPublicToken(wid, next.settings.publicToken, prev.settings.publicToken);
  return { ...next, workspace: { ...ws, directory: next } };
}

async function ensurePublicToken(workspaceId, opts = {}) {
  const bundle = await load(workspaceId, { workspace: opts.workspace, normalize: false });
  if (bundle.settings.publicToken) return bundle;
  return save(workspaceId, {
    settings: { ...bundle.settings, publicToken: newPublicToken() },
  });
}

async function resolveWorkspaceIdByToken(token) {
  const t = clean(token, 80);
  if (!t || !t.startsWith('dir_')) return '';
  let raw = dbService.getKvSync(TOKEN_KV_PREFIX + t);
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return '';
    if (s.startsWith('{')) {
      try {
        raw = JSON.parse(s);
      } catch {
        return s;
      }
    } else {
      return s;
    }
  }
  if (raw && typeof raw === 'object' && raw.workspaceId) return String(raw.workspaceId);
  return '';
}

function listListings(bundle, { published } = {}) {
  let rows = Object.values((bundle && bundle.listings) || {}).filter(Boolean);
  if (published === true) rows = rows.filter((r) => r.published === true);
  if (published === false) rows = rows.filter((r) => r.published !== true);
  return rows.sort((a, b) => {
    if (!!a.published !== !!b.published) return a.published ? -1 : 1;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
}

function inboxSummary(bundle) {
  const rows = Object.values((bundle && bundle.listings) || {});
  return {
    total: rows.length,
    published: rows.filter((r) => r.published === true).length,
    draft: rows.filter((r) => r.published !== true).length,
  };
}

function uniqueSlug(listings, desired, excludeId) {
  let slug = slugify(desired);
  const used = new Set(
    Object.values(listings || {})
      .filter((r) => r && r.id !== excludeId)
      .map((r) => String(r.slug || '').toLowerCase()),
  );
  if (!used.has(slug)) return slug;
  let i = 2;
  while (used.has(`${slug}-${i}`) && i < 500) i += 1;
  return `${slug}-${i}`;
}

async function upsertFromLead(workspaceId, leadKey, opts = {}) {
  const wid = String(workspaceId || '').trim();
  const key = clean(leadKey, 200);
  if (!key) {
    const err = new Error('Lead key is required.');
    err.code = 'INVALID';
    throw err;
  }
  const lead = await dbService.getLead(key, wid);
  if (!lead) {
    const err = new Error('Lead not found in this workspace.');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const fields = leadPublicFields(lead);
  if (!fields.name) {
    const err = new Error('That lead needs a business name before it can be listed.');
    err.code = 'INVALID';
    throw err;
  }
  const bundle = await load(wid);
  const existing = Object.values(bundle.listings).find((r) => r && r.leadKey === key);
  const id = existing ? existing.id : newListingId();
  const now = new Date().toISOString();
  const publish =
    opts.published === undefined
      ? existing
        ? !!existing.published
        : true
      : opts.published === true || opts.published === '1' || opts.published === 'on';
  const slug = uniqueSlug(
    bundle.listings,
    opts.slug || (existing && existing.slug) || fields.name,
    id,
  );
  const row = normalizeListing(
    {
      ...(existing || {}),
      id,
      leadKey: key,
      slug,
      ...fields,
      blurb: opts.blurb != null ? opts.blurb : (existing && existing.blurb) || '',
      description: opts.description != null ? opts.description : fields.description || (existing && existing.description) || '',
      published: publish,
      createdAt: (existing && existing.createdAt) || now,
      publishedAt: publish ? (existing && existing.publishedAt) || now : null,
      updatedAt: now,
    },
    id,
  );
  bundle.listings[id] = row;
  const saved = await save(wid, { listings: bundle.listings, settings: bundle.settings });
  return saved.listings[id];
}

async function updateListing(workspaceId, listingId, patch = {}) {
  const bundle = await load(workspaceId);
  const id = String(listingId || '');
  const prev = bundle.listings[id];
  if (!prev) {
    const err = new Error('Listing not found.');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const now = new Date().toISOString();
  const nextSlug =
    patch.slug != null
      ? uniqueSlug(bundle.listings, patch.slug, id)
      : prev.slug;
  let published = prev.published;
  if (patch.published !== undefined) {
    published = patch.published === true || patch.published === '1' || patch.published === 'on';
  }
  bundle.listings[id] = normalizeListing(
    {
      ...prev,
      ...patch,
      id,
      slug: nextSlug,
      published,
      publishedAt: published ? prev.publishedAt || now : null,
      updatedAt: now,
    },
    id,
  );
  const saved = await save(workspaceId, { listings: bundle.listings, settings: bundle.settings });
  return saved.listings[id];
}

async function setPublished(workspaceId, listingId, published) {
  return updateListing(workspaceId, listingId, { published: !!published });
}

async function removeListing(workspaceId, listingId) {
  const bundle = await load(workspaceId);
  const id = String(listingId || '');
  if (!bundle.listings[id]) {
    const err = new Error('Listing not found.');
    err.code = 'NOT_FOUND';
    throw err;
  }
  delete bundle.listings[id];
  await save(workspaceId, { listings: bundle.listings, settings: bundle.settings });
  return { ok: true, id };
}

function findBySlug(bundle, slug) {
  const want = slugify(slug);
  return Object.values((bundle && bundle.listings) || {}).find(
    (r) => r && r.published === true && slugify(r.slug) === want,
  ) || null;
}

module.exports = {
  TOKEN_KV_PREFIX,
  newListingId,
  newPublicToken,
  clean,
  slugify,
  leadPublicFields,
  emptyBundle,
  load,
  save,
  ensurePublicToken,
  resolveWorkspaceIdByToken,
  listListings,
  inboxSummary,
  upsertFromLead,
  updateListing,
  setPublished,
  removeListing,
  findBySlug,
};
