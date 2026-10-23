/**
 * Flooring partner → material quote requests (measure, photos, notes, materials).
 * Replaces referral Send for app_flooring / flooring signupOffer members.
 * The supplier is always the network owner (host workspace) — not another partner.
 */

const dbService = require('./database');
const store = require('./networkStore');
const notify = require('./networkNotify');
const jobMedia = require('./memberJobMedia');
const freeAppSignup = require('./freeAppSignup');

const QUOTE_PREFIX = 'netmatquote:';
const PHOTO_PREFIX = 'netmatquotephoto:';
const MAX_PHOTOS = 8;
const MAX_PHOTO_CAPTION = 200;
const SCOPE_ID = /^[a-z0-9_]{1,64}$/i;
const RECORD_ID = /^[a-z0-9]{6,40}$/;

function cleanText(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Network owner email — the material supplier for flooring quote requests. */
async function resolveNetworkOwnerEmail(network) {
  const direct = String((network && network.ownerEmail) || '').trim().toLowerCase();
  if (direct) return direct;
  if (!network || !network.ownerWorkspaceId) return '';
  try {
    const ws = await dbService.getWorkspace(network.ownerWorkspaceId);
    const members = ws && ws.members && typeof ws.members === 'object' ? ws.members : {};
    const owner = Object.entries(members).find(([, row]) => row && row.role === 'owner');
    return owner ? String(owner[0] || '').trim().toLowerCase() : '';
  } catch {
    return '';
  }
}

function cleanBlock(value, max) {
  return String(value == null ? '' : value).replace(/\r\n/g, '\n').trim().slice(0, max);
}

function quoteKey(networkId, quoteId) {
  return `${QUOTE_PREFIX}${networkId}:${quoteId}`;
}

function photoKey(networkId, quoteId, photoId) {
  if (!SCOPE_ID.test(String(networkId || '')) || !RECORD_ID.test(String(quoteId || ''))
    || !RECORD_ID.test(String(photoId || ''))) {
    throw new Error('materialQuotes: invalid id');
  }
  return `${PHOTO_PREFIX}${networkId}:${quoteId}:${photoId}`;
}

async function readJson(key) {
  const raw = await dbService.peekStorageKey(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function normalizePhotos(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p) => p && RECORD_ID.test(String(p.id || '')))
    .slice(0, MAX_PHOTOS)
    .map((p) => ({
      id: String(p.id),
      caption: cleanText(p.caption, MAX_PHOTO_CAPTION),
      createdAt: cleanText(p.createdAt, 40),
    }));
}

function normalizeQuote(raw) {
  const q = raw && typeof raw === 'object' ? raw : {};
  const site = q.jobSite && typeof q.jobSite === 'object' ? q.jobSite : {};
  return {
    id: cleanText(q.id, 40),
    fromMemberId: cleanText(q.fromMemberId, 40),
    /** Network owner (supplier) — who the quote is for. */
    toOwnerEmail: cleanText(q.toOwnerEmail, 200).toLowerCase(),
    toOwnerWorkspaceId: cleanText(q.toOwnerWorkspaceId, 80),
    jobSite: {
      name: cleanText(site.name, 120),
      phone: cleanText(site.phone, 40),
      email: cleanText(site.email, 200),
      address: cleanText(site.address, 200),
      city: cleanText(site.city, 80),
      zip: cleanText(site.zip, 10),
    },
    materials: cleanBlock(q.materials, 2000),
    measure: cleanBlock(q.measure, 2000),
    notes: cleanBlock(q.notes, 2000),
    photos: normalizePhotos(q.photos),
    status: q.status === 'closed' ? 'closed' : 'requested',
    createdAt: cleanText(q.createdAt, 40),
    updatedAt: cleanText(q.updatedAt, 40),
    events: Array.isArray(q.events) ? q.events.slice(0, 40) : [],
  };
}

/**
 * Validate quote form body into a new material-quote record (no id yet).
 * Requires materials + measure (the quote ask) and a job-site name.
 */
function buildQuote(input, { fromMemberId, by } = {}) {
  const body = input && typeof input === 'object' ? input : {};
  const stamp = new Date().toISOString();
  const jobSite = {
    name: cleanText(body.name || body.jobSiteName, 120),
    phone: cleanText(body.phone, 40),
    email: cleanText(body.email, 200),
    address: cleanText(body.address, 200),
    city: cleanText(body.city, 80),
    zip: cleanText(body.zip, 10),
  };
  const materials = cleanBlock(body.materials, 2000);
  const measure = cleanBlock(body.measure, 2000);
  const notes = cleanBlock(body.notes || body.note, 2000);
  if (!jobSite.name) return { ok: false, error: 'Add the job site or customer name.' };
  if (!materials) return { ok: false, error: 'List the materials you need quoted.' };
  if (!measure) return { ok: false, error: 'Add the measure (rooms, sq ft, or dimensions).' };
  const confirm = body.confirm === true || body.confirm === 'on' || body.confirm === '1' || body.confirm === 'true';
  if (!confirm) return { ok: false, error: 'Confirm these details are ready for a material quote.' };
  const who = cleanText(by, 160) || 'member';
  return {
    ok: true,
    quote: {
      id: '',
      fromMemberId: String(fromMemberId || '').trim(),
      jobSite,
      materials,
      measure,
      notes,
      photos: [],
      status: 'requested',
      createdAt: stamp,
      updatedAt: stamp,
      events: [{ type: 'requested', at: stamp, by: who, text: 'Material quote requested' }],
    },
  };
}

async function saveQuote(networkId, quote) {
  const next = normalizeQuote({
    ...quote,
    id: quote.id || store.newId(),
    updatedAt: new Date().toISOString(),
  });
  await dbService.putStorageKey(quoteKey(networkId, next.id), next);
  return next;
}

async function getQuote(networkId, quoteId) {
  if (!RECORD_ID.test(String(quoteId || ''))) return null;
  const row = await readJson(quoteKey(networkId, quoteId));
  return row ? normalizeQuote(row) : null;
}

async function listQuotesForMember(networkId, memberId) {
  const keys = await dbService.listStorageKeysWithPrefix(`${QUOTE_PREFIX}${networkId}:`);
  const out = [];
  for (const key of keys) {
    const row = await readJson(key);
    if (!row) continue;
    const q = normalizeQuote(row);
    if (q.fromMemberId === memberId) out.push(q);
  }
  return out.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

async function saveQuotePhoto(networkId, quoteId, photoId, prepared) {
  const updatedAt = new Date().toISOString();
  await dbService.putStorageKey(photoKey(networkId, quoteId, photoId), {
    contentType: (prepared && prepared.contentType) || 'image/jpeg',
    data: Buffer.from(prepared.buffer).toString('base64'),
    updatedAt,
  });
  return updatedAt;
}

async function getQuotePhoto(networkId, quoteId, photoId) {
  if (!RECORD_ID.test(String(photoId || ''))) return null;
  const row = await readJson(photoKey(networkId, quoteId, photoId));
  if (!row || !row.data) return null;
  return {
    contentType: String(row.contentType || 'image/jpeg'),
    buffer: Buffer.from(String(row.data), 'base64'),
    updatedAt: row.updatedAt || '',
  };
}

/**
 * Attach prepared photo buffers to a saved quote.
 * @param {Array<{ buffer: Buffer, contentType?: string, caption?: string }>} preparedList
 */
async function attachPhotos(networkId, quote, preparedList) {
  const list = Array.isArray(preparedList) ? preparedList : [];
  let next = quote;
  for (const item of list) {
    if (!item || !item.buffer) continue;
    if (next.photos.length >= MAX_PHOTOS) break;
    const prepared = item.contentType && item.buffer.length
      ? item
      : await jobMedia.prepareJobPhoto(item.buffer);
    const photoId = store.newId();
    const createdAt = await saveQuotePhoto(networkId, next.id, photoId, prepared);
    next = await saveQuote(networkId, {
      ...next,
      photos: [
        ...next.photos,
        {
          id: photoId,
          caption: cleanText(item.caption, MAX_PHOTO_CAPTION),
          createdAt,
        },
      ],
    });
  }
  return next;
}

/**
 * Flooring partner submits a material quote request to the network owner (supplier).
 */
async function submitQuote({ network, member, input, photoFiles = [], baseUrl } = {}) {
  if (!network || !member) return { ok: false, error: 'Network member required.' };
  if (!freeAppSignup.isFlooringOffer(member)) {
    return { ok: false, error: 'Material quotes are for flooring partners.' };
  }
  if (member.status !== 'active') {
    return { ok: false, error: 'Your membership is paused. Contact your supplier.' };
  }
  const built = buildQuote(input, {
    fromMemberId: member.id,
    by: member.companyName || member.contactName || 'partner',
  });
  if (!built.ok) return built;

  // Supplier = network owner only (never another member / trade partner).
  const ownerEmail = await resolveNetworkOwnerEmail(network);

  let quote = await saveQuote(network.id, {
    ...built.quote,
    toOwnerEmail: ownerEmail,
    toOwnerWorkspaceId: network.ownerWorkspaceId || '',
  });

  const prepared = [];
  for (const file of (Array.isArray(photoFiles) ? photoFiles : []).slice(0, MAX_PHOTOS)) {
    if (!file || !file.buffer) continue;
    try {
      prepared.push({
        ...(await jobMedia.prepareJobPhoto(file.buffer)),
        caption: '',
      });
    } catch (err) {
      console.warn('[materialQuotes] photo prepare failed:', err.message);
    }
  }
  if (prepared.length) {
    quote = await attachPhotos(network.id, quote, prepared);
  }

  const notified = await notify.notifyMaterialQuote({
    network,
    member,
    quote,
    baseUrl,
  }).catch((err) => ({ ok: false, error: err.message }));

  return { ok: true, quote, notified };
}

module.exports = {
  MAX_PHOTOS,
  buildQuote,
  normalizeQuote,
  saveQuote,
  getQuote,
  listQuotesForMember,
  getQuotePhoto,
  attachPhotos,
  submitQuote,
};
