function formatSearchKeywordDisplay(keyword) {
  return String(keyword || '')
    .trim()
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ');
}

module.exports = { formatSearchKeywordDisplay };
