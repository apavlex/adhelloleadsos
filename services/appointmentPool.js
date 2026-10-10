/**
 * Shared appointments marketplace (app-level).
 * AdHello app admins list slots for sale; workspaces buy inventory onto their tracker.
 */
const crypto = require('crypto');
const dbService = require('./database');
const appointmentPackages = require('./appointmentPackages');

const STORE_KEY = 'appointmentPool:v1';

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function str(v) {
  return v == null ? '' : String(v).trim();
}

function emptyStore() {
  return { listings: [], purchases: [], updatedAt: null };
}

function readStore() {
  const raw = dbService.getKvSync(STORE_KEY);
  if (!raw) return emptyStore();
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object') return emptyStore();
    return {
      listings: Array.isArray(parsed.listings) ? parsed.listings : [],
      purchases: Array.isArray(parsed.purchases) ? parsed.purchases : [],
      updatedAt: parsed.updatedAt || null,
    };
  } catch {
    return emptyStore();
  }
}

function writeStore(store) {
  const next = {
    listings: Array.isArray(store.listings) ? store.listings : [],
    purchases: Array.isArray(store.purchases) ? store.purchases : [],
    updatedAt: nowIso(),
  };
  dbService.setKvSync(STORE_KEY, JSON.stringify(next));
  return next;
}

function normalizeListing(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const slotsTotal = Math.min(5000, Math.max(1, Math.round(Number(r.slotsTotal) || 1)));
  const slotsSold = Math.min(slotsTotal, Math.max(0, Math.round(Number(r.slotsSold) || 0)));
  const status = str(r.status).toLowerCase() === 'archived' ? 'archived'
    : (slotsSold >= slotsTotal ? 'sold_out' : 'available');
  return {
    id: str(r.id) || newId('pool'),
    trade: str(r.trade).slice(0, 60) || 'General',
    title: str(r.title).slice(0, 160) || str(r.trade).slice(0, 60) || 'Appointment package',
    note: str(r.note).slice(0, 500) || '',
    commissionNote: str(r.commissionNote).slice(0, 240) || '',
    pricePerSlot: Math.max(0, Math.round(Number(r.pricePerSlot) || 0)),
    slotsTotal,
    slotsSold,
    slotsLeft: Math.max(0, slotsTotal - slotsSold),
    leadKey: str(r.leadKey) || null,
    leadName: str(r.leadName).slice(0, 120) || null,
    createdBy: str(r.createdBy).slice(0, 160) || '',
    createdAt: str(r.createdAt) || nowIso(),
    updatedAt: str(r.updatedAt) || nowIso(),
    status,
  };
}

function listAvailable() {
  return readStore().listings
    .map(normalizeListing)
    .filter((l) => l.status === 'available' && l.slotsLeft > 0)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function listAll() {
  return readStore().listings
    .map(normalizeListing)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/**
 * App admin lists inventory (optionally tied to a lead) for workspaces to buy.
 */
function createListing(input = {}, { by } = {}) {
  const slotsTotal = Math.min(5000, Math.max(1, Math.round(Number(input.slotsTotal || input.purchased) || 1)));
  const listing = normalizeListing({
    id: newId('pool'),
    trade: input.trade,
    title: input.title || input.businessName || input.trade || 'Appointment package',
    note: input.note || input.notes,
    commissionNote: input.commissionNote || input.commission,
    pricePerSlot: input.pricePerSlot,
    slotsTotal,
    slotsSold: 0,
    leadKey: input.leadKey,
    leadName: input.leadName || input.name || input.title,
    createdBy: by || '',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    status: 'available',
  });
  const store = readStore();
  store.listings.unshift(listing);
  writeStore(store);
  return listing;
}

function archiveListing(listingId) {
  const store = readStore();
  const idx = store.listings.findIndex((l) => l.id === listingId);
  if (idx < 0) return null;
  store.listings[idx] = normalizeListing({ ...store.listings[idx], status: 'archived', updatedAt: nowIso() });
  writeStore(store);
  return store.listings[idx];
}

/**
 * Workspace buys slots from a listing → creates a package on their appointment tracker.
 */
async function buyListing(listingId, buyerWorkspaceId, { quantity, by } = {}) {
  const wid = str(buyerWorkspaceId);
  if (!wid) return { ok: false, error: 'Workspace required.' };
  const qty = Math.min(500, Math.max(1, Math.round(Number(quantity) || 1)));
  const store = readStore();
  const idx = store.listings.findIndex((l) => l.id === listingId);
  if (idx < 0) return { ok: false, error: 'That listing is no longer available.' };
  const listing = normalizeListing(store.listings[idx]);
  if (listing.status !== 'available' || listing.slotsLeft < 1) {
    return { ok: false, error: 'That listing is sold out.' };
  }
  if (qty > listing.slotsLeft) {
    return { ok: false, error: `Only ${listing.slotsLeft} appointment${listing.slotsLeft === 1 ? '' : 's'} left on this listing.` };
  }

  const pkg = await appointmentPackages.createPackage(wid, {
    businessName: listing.title || `${listing.trade} package`,
    trade: listing.trade,
    purchased: qty,
    leadsPurchased: qty,
    leadKey: listing.leadKey || null,
    notes: [
      listing.commissionNote ? `Commission: ${listing.commissionNote}` : '',
      listing.note || '',
      `Purchased from appointments pool by ${by || 'workspace'}.`,
    ].filter(Boolean).join(' ').slice(0, 500),
  });

  listing.slotsSold += qty;
  store.listings[idx] = normalizeListing({ ...listing, updatedAt: nowIso() });
  const purchase = {
    id: newId('buy'),
    listingId: listing.id,
    buyerWorkspaceId: wid,
    quantity: qty,
    packageId: pkg.id,
    trade: listing.trade,
    title: listing.title,
    pricePerSlot: listing.pricePerSlot,
    commissionNote: listing.commissionNote,
    by: str(by),
    createdAt: nowIso(),
  };
  store.purchases.unshift(purchase);
  writeStore(store);

  return {
    ok: true,
    listing: normalizeListing(store.listings[idx]),
    purchase,
    package: pkg,
  };
}

function purchasesForWorkspace(workspaceId) {
  const wid = str(workspaceId);
  return readStore().purchases.filter((p) => p.buyerWorkspaceId === wid);
}

function poolSummary() {
  const listings = listAll();
  const available = listings.filter((l) => l.status === 'available');
  return {
    listingsTotal: listings.length,
    availableCount: available.length,
    slotsLeft: available.reduce((sum, l) => sum + l.slotsLeft, 0),
    purchasesTotal: readStore().purchases.length,
  };
}

module.exports = {
  listAvailable,
  listAll,
  createListing,
  archiveListing,
  buyListing,
  purchasesForWorkspace,
  poolSummary,
};
