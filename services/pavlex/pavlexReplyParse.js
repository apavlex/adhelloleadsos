/**
 * Clean model output before it reaches the user: strip private reasoning and
 * recover tool calls that models print as text instead of native tool_calls.
 */

const THINK_BLOCK_RE = /<(think|thinking|reasoning|reflection)>[\s\S]*?<\/\1>/gi;
const TOOL_BLOCK_RE =
  /<(tool_call|tool_calls|function_call|toolcall)>\s*([\s\S]*?)\s*(?:<\/\1>|$)|<function=([a-zA-Z0-9_.-]+)>\s*([\s\S]*?)\s*(?:<\/function>|$)/gi;

const REASONING_OPENERS = [
  /^(?:ok(?:ay)?|alright|so|hmm+|well)?[,.\s]*(?:the\s+)?user(?:'s)?\s+(?:is\s+)?(?:asking|asks|asked|wants|wanted|said|says|just\s+said|is\s+requesting|requests|request(?:ed)?|has\s+asked|seems|typed|replied|responded|message)\b/i,
  /^(?:ok(?:ay)?|alright|so)?[,.\s]*let me\s+(?:think|check|analy[sz]e|figure|look at the|review the|see what)/i,
  /^(?:ok(?:ay)?|alright|so)?[,.\s]*i\s+(?:need|should|have)\s+to\s+(?:figure out|determine|check|decide|look at|think)/i,
  /^looking at the (?:available )?tools\b/i,
  /^(?:ok(?:ay)?|alright|so)?[,.\s]*(?:first|now),?\s+i(?:'ll| will| should| need to)\s+(?:check|look|figure|think)/i,
];

function asText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((part) => (typeof part === 'string' ? part : part && typeof part.text === 'string' ? part.text : ''))
      .join('');
  }
  if (typeof value === 'object' && typeof value.text === 'string') return value.text;
  return String(value);
}

/** Remove <think>…</think> style blocks, an unclosed leading <think>, and reasoning before a stray </think>. */
function stripThinking(text) {
  let out = asText(text).replace(THINK_BLOCK_RE, '');
  const strayClose = out.search(/<\/(think|thinking|reasoning)>/i);
  if (strayClose >= 0) {
    out = out.slice(strayClose).replace(/^<\/(think|thinking|reasoning)>/i, '');
  }
  if (/^\s*<(think|thinking|reasoning)>/i.test(out)) return '';
  return out.trim();
}

function looksLikeLeakedReasoning(text) {
  const s = asText(text).trim();
  if (!s) return false;
  return REASONING_OPENERS.some((re) => re.test(s));
}

function tryJson(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function coerceArgs(value) {
  if (value == null) return {};
  if (typeof value === 'string') {
    const parsed = tryJson(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  }
  return typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/** {"name":"x","arguments":{…}} and the common variants (parameters/args/input, function:{name,arguments}). */
function callFromObject(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const fn = obj.function && typeof obj.function === 'object' ? obj.function : null;
  const name = String((fn && fn.name) || obj.name || obj.tool || obj.tool_name || '').trim();
  if (!name) return null;
  const rawArgs =
    (fn && (fn.arguments != null ? fn.arguments : fn.parameters)) ??
    obj.arguments ??
    obj.parameters ??
    obj.args ??
    obj.input ??
    {};
  return { name, arguments: coerceArgs(rawArgs) };
}

/** Body of a <tool_call> block: JSON object/array, `name`, `name {json}`, or `name({json})`. */
function callsFromBlockBody(body) {
  const s = String(body || '').trim().replace(/^```(?:json)?\s*|\s*```$/gi, '').trim();
  if (!s) return [];
  const parsed = tryJson(s);
  if (Array.isArray(parsed)) return parsed.map(callFromObject).filter(Boolean);
  if (parsed && typeof parsed === 'object') {
    const call = callFromObject(parsed);
    return call ? [call] : [];
  }
  const m = s.match(/^([a-zA-Z_][a-zA-Z0-9_.-]*)\s*(?:\(\s*([\s\S]*?)\s*\)|([\s\S]*))$/);
  if (!m) return [];
  const argText = (m[2] != null ? m[2] : m[3] || '').trim();
  return [{ name: m[1], arguments: coerceArgs(argText) }];
}

/**
 * Find tool calls printed as text. Only names in knownToolNames count (when given).
 * @param {string} text
 * @param {Iterable<string>} [knownToolNames]
 * @returns {{ calls: Array<{name:string, arguments:object}>, cleaned: string }}
 */
function extractTextToolCalls(text, knownToolNames) {
  const known = knownToolNames ? new Set(knownToolNames) : null;
  const isKnown = (name) => !known || known.has(name);
  const source = asText(text);
  const calls = [];

  let cleaned = source.replace(TOOL_BLOCK_RE, (match, _tag, body, fnName, fnBody) => {
    const found = fnName ? [{ name: fnName, arguments: coerceArgs(fnBody) }] : callsFromBlockBody(body);
    const usable = found.filter((c) => isKnown(c.name));
    if (!usable.length) return match;
    calls.push(...usable);
    return '';
  });

  if (!calls.length) {
    const trimmed = cleaned.trim();
    const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    const candidate = tryJson(fence ? fence[1] : trimmed);
    const list = Array.isArray(candidate) ? candidate : candidate ? [candidate] : [];
    const objCalls = list.map(callFromObject).filter((c) => c && isKnown(c.name));
    if (objCalls.length && objCalls.length === list.length && known) {
      calls.push(...objCalls);
      cleaned = '';
    }
  }

  return { calls, cleaned: cleaned.trim() };
}

/** Final user-facing text: no reasoning blocks, no leftover tool-call markup. */
function sanitizeAssistantText(text, knownToolNames) {
  const noThink = stripThinking(text);
  const { cleaned } = extractTextToolCalls(noThink, knownToolNames);
  return cleaned
    .replace(TOOL_BLOCK_RE, '')
    .replace(/<\/?(tool_call|tool_calls|function_call|toolcall)>/gi, '')
    .replace(/<\|[a-z_]+\|>/gi, '')
    .trim();
}

/**
 * History replayed to the model: drop earlier replies that were leaked reasoning
 * or bare tool markup so the model doesn't imitate them.
 */
function sanitizeHistory(history, knownToolNames) {
  const out = [];
  for (const m of history || []) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || !m.content) continue;
    if (m.role === 'user') {
      out.push({ role: 'user', content: String(m.content) });
      continue;
    }
    const clean = sanitizeAssistantText(m.content, knownToolNames);
    if (!clean || looksLikeLeakedReasoning(clean)) continue;
    out.push({ role: 'assistant', content: clean });
  }
  return out;
}

/** Top-level JSON objects in a string, e.g. `{"query":"A"}{"query":"B"}`. */
function splitJsonObjects(raw) {
  const s = String(raw || '');
  const out = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') {
      inStr = true;
    } else if (c === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (c === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0) {
        const obj = tryJson(s.slice(start, i + 1));
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) out.push(obj);
      }
    }
  }
  return out;
}

/**
 * Native tool-call arguments as one or more argument objects. Some providers glue
 * parallel calls into one arguments string or double-encode it; plain JSON.parse
 * turns those into {} and the tool fails with "query is required".
 */
function parseToolArgumentList(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return [raw];
  const s = String(raw || '').trim();
  if (!s) return [{}];
  const whole = tryJson(s);
  if (whole && typeof whole === 'object' && !Array.isArray(whole)) return [whole];
  if (typeof whole === 'string' && whole.trim().startsWith('{')) return parseToolArgumentList(whole);
  const parts = splitJsonObjects(s);
  return parts.length ? parts : [{}];
}

module.exports = {
  parseToolArgumentList,
  stripThinking,
  looksLikeLeakedReasoning,
  extractTextToolCalls,
  sanitizeAssistantText,
  sanitizeHistory,
};
