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
  /\bbookmark/i,
  /\breferral partners?\b/i,
  /\bopportunit(y|ies)\b/i,
  /\bsave\b.+\bscript\b/i,
  /\bscript\b.+\bsave\b/i,
  /\bfind\s+\d+\s+\w+/i,
  /\b(find|search for|pull|get)\b.+\bin\s+[a-z .'-]+,?\s+[a-z]{2}\b/i,
];

function isCrmIntent(message) {
  const text = String(message || '').trim();
  if (!text) return false;
  return CRM_PATTERNS.some((re) => re.test(text));
}

function crmUnavailableMessage(detail) {
  const d = String(detail || '').toLowerCase();
  if (d.includes('openai_api_key')) {
    return (
      'CRM AI runtime is not configured. Add OPENAI_API_KEY in Render → Environment ' +
      '(or your host env vars), then redeploy. ' +
      'You can still ask: "List my folders" or "How many leads do I have?" — those use direct CRM tools.'
    );
  }
  const base = 'CRM connection unavailable. MCP connection failed.';
  if (detail) return `${base} (${detail})`;
  return base;
}

module.exports = {
  isCrmIntent,
  crmUnavailableMessage,
};
