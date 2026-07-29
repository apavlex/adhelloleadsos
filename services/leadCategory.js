/**
 * Lead category normalization and guards against business-name false positives.
 */

function normalizeLeadCategoryName(raw, fallback = 'N/A') {
  if (raw == null || raw === '') return fallback;
  if (Array.isArray(raw)) {
    const joined = raw.filter(Boolean).map(String).join(', ').trim();
    return joined || fallback;
  }
  const s = String(raw).trim();
  return s || fallback;
}

function normalizeCompareKey(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function categoryLooksLikeBusinessName(category, title) {
  const c = normalizeCompareKey(category);
  const t = normalizeCompareKey(title);
  if (!c || !t || c === 'n a') return false;
  if (c === t) return true;
  if (c.length >= 8 && t.length >= 8 && (c.includes(t) || t.includes(c))) return true;
  const titleWords = t.split(' ').filter((w) => w.length > 2);
  if (titleWords.length >= 2) {
    const matched = titleWords.filter((w) => c.includes(w)).length;
    if (matched / titleWords.length >= 0.75) return true;
  }
  return false;
}

function sanitizeLeadCategoryName(category, title, fallback = 'N/A') {
  const normalized = normalizeLeadCategoryName(category, fallback);
  if (normalized === 'N/A') return normalized;
  if (title && categoryLooksLikeBusinessName(normalized, title)) return fallback;
  return normalized;
}

module.exports = {
  normalizeLeadCategoryName,
  categoryLooksLikeBusinessName,
  sanitizeLeadCategoryName,
};
