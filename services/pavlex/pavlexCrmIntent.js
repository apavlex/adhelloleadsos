/**
 * Detect whether a Pavlex message requires live CRM MCP tools (not LLM guessing).
 */
const CRM_PATTERNS = [
  /\bleads?\b/i,
  /\bfolders?\b/i,
  /\bpipeline\b/i,
  /\bcontacts?\b/i,
  /\bcrm\b/i,
  /\bprospects?\b/i,
  /\bsearch\b.+\blead/i,
  /\bfind\b.+\b(lead|company|business)/i,
  /\blist\b.+\b(lead|folder)/i,
  /\bhow many\b/i,
  /\bcount\b/i,
  /\bshow\b.+\b(lead|folder|pipeline)/i,
  /\bupdate\b.+\blead/i,
  /\bbulk\b/i,
  /\btags?\b/i,
  /\blandscaping\b/i,
  /\bacme\b/i,
];

function isCrmIntent(message) {
  const text = String(message || '').trim();
  if (!text) return false;
  return CRM_PATTERNS.some((re) => re.test(text));
}

function crmUnavailableMessage(detail) {
  const base = 'CRM connection unavailable. MCP connection failed.';
  if (detail) return `${base} (${detail})`;
  return base;
}

module.exports = {
  isCrmIntent,
  crmUnavailableMessage,
};
