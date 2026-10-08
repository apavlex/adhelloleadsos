/**
 * Free-trial rules for MCP connections (ChatGPT, Claude, Grok, …), matching
 * middleware/trialGate.js for the web app: paid outbound calls are metered while
 * the trial runs, and tool calls are refused with a readable message once it ends.
 */
const guestEgress = require('../../lib/guestEgress');
const dbService = require('../database');
const trials = require('../trials');

function endedMessage(ws) {
  const c = trials.contactInfo();
  const reach = [c.url, c.email].filter(Boolean).join(' or ');
  return (
    `The free trial for the AdHello workspace "${(ws && ws.name) || 'this workspace'}" has ended, so its tools are paused. ` +
    `The data is saved. To keep going, contact AdHello${reach ? `: ${reach}` : ''}.`
  );
}

function toolCalls(body) {
  return (Array.isArray(body) ? body : [body]).filter((m) => m && m.method === 'tools/call');
}

async function mcpTrialGate(req, res, next) {
  try {
    const ws = req.workspace || (req.workspaceId ? await dbService.getWorkspace(req.workspaceId) : null);
    const st = ws && trials.status(ws);
    if (!st || st.state === 'active') return next();

    if (st.state === 'expired') {
      const calls = toolCalls(req.body);
      if (!calls.length) return next();
      const text = endedMessage(ws);
      const replies = calls.map((m) => ({
        jsonrpc: '2.0',
        id: m.id,
        result: { content: [{ type: 'text', text }], isError: true },
      }));
      return res.status(200).json(Array.isArray(req.body) ? replies : replies[0]);
    }

    if (guestEgress.current()) return next();
    return guestEgress.run({ trial: true, workspaceId: ws.id, check: trials.egressCheck(ws) }, next);
  } catch (err) {
    return next(err);
  }
}

module.exports = { mcpTrialGate, endedMessage };
