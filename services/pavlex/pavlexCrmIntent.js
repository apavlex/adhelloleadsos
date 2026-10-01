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
  /\breferrals?\b/i,
  /\b(partners?|partnerships?)\b.+\b(find|get|need|who|which)\b|\b(find|get|need|who|which)\b.+\b(partners?|partnerships?)\b/i,
  /\bsend\s+me\s+(work|jobs|business|customers|clients)\b/i,
  /\bopportunit(y|ies)\b/i,
  /\bsave\b.+\bscripts?\b/i,
  /\bscripts?\b.+\bsave\b/i,
  /\btasks?\b/i,
  /\bassign(ed)?\b/i,
  /\bghl\b/i,
  /\bgo\s?high\s?level\b/i,
  /\bteam\s?mates?\b|\bteam members?\b|\bmy team\b/i,
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

/**
 * What the user sees when no model produced an answer. The raw provider detail is logged
 * server-side; this only names the kind of problem and what to do about it.
 */
function chatUnavailableMessage(detail, { toolsRan = false } = {}) {
  const d = String(detail || '');
  const suffix = toolsRan ? ' Some CRM actions may already have run — check before retrying.' : '';
  if (/No LLM key|No LLM configured|No LLM providers configured/i.test(d)) {
    return (
      'Alex needs an AI key on the server. Add OPENROUTER_API_KEY (or OPENAI_API_KEY) in Render → Environment, ' +
      'then redeploy. CRM shortcuts work now: "List my folders", "How many leads do I have?", "Find Acme Roofing".'
    );
  }
  if (/\b401\b|invalid api key|unauthori[sz]ed|no auth credentials|incorrect api key/i.test(d)) {
    return `The AI key Alex uses was rejected. Update OPENROUTER_API_KEY or OPENAI_API_KEY in Render → Environment.${suffix}`;
  }
  if (/\b402\b|insufficient|credits|quota|billing/i.test(d)) {
    return `The AI account Alex uses is out of credits. Add credits at openrouter.ai (or your AI provider) and try again.${suffix}`;
  }
  if (/\b429\b|rate.?limit|overloaded|capacity|too many requests/i.test(d)) {
    return `The AI model is busy right now. Please try again in a minute.${suffix}`;
  }
  if (/timed out|timeout/i.test(d)) {
    return `The AI model took too long to answer. Please try again.${suffix}`;
  }
  return `Alex couldn't get an answer from the AI model just now. Please try again in a moment.${suffix}`;
}

module.exports = {
  isCrmIntent,
  crmUnavailableMessage,
  chatUnavailableMessage,
};
