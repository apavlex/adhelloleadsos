/**
 * LLM-backed prospecting coach brief (shared by POST /sales/outreach-coach, SSE stream, cron warm).
 */
const dbService = require('./database');
const { chatCompletion } = require('./llmClient');
const { filterLeadsForRequest } = require('./workspaceService');
const {
  buildOutreachCoachSnapshot,
  buildNamedCoachActions,
} = require('./outreachCoachSnapshot');

async function generateOutreachCoachPayload(req) {
  const snapshot = await buildOutreachCoachSnapshot(req);
  const { entrepreneurQuote, firstName, stageBreakdown } = snapshot;
  const wid = req.workspaceId;
  if (!wid) throw new Error('generateOutreachCoachPayload requires req.workspaceId');
  const allLeads = await dbService.getAllLeads(wid);
  const workspaceLeads = filterLeadsForRequest(req, allLeads);
  const actions = buildNamedCoachActions(workspaceLeads, snapshot);

  const wsDoc = await dbService.getWorkspace(wid);
  const coachExtra =
    wsDoc && typeof wsDoc.coachPrompt === 'string' && wsDoc.coachPrompt.trim()
      ? `\n\nWorkspace coaching lens:\n${wsDoc.coachPrompt.trim()}`
      : '';

  const ai = await chatCompletion({
    messages: [
      {
        role: 'system',
        content: `You are a concise sales coach for an agency founder using Agency OS. Use ONLY the JSON snapshot — pipeline counts, opportunity tiers, streak, touches vs goal, warm inbound, overdue cadences, reply signals.

Rules:
- Reference real numbers; do not invent metrics.
- In "body", write 2 short paragraphs (plain text, no markdown). Paragraph 1: situational coaching from the data. Paragraph 2: tie the provided entrepreneur quote to today's work (name the author once).
- Do not fabricate quotes beyond entrepreneurQuote.
- Tone: direct, specific, anti-procrastination. Do not give generic pep-talk; ground every sentence in the snapshot.
- Do NOT output a list of next steps — the app shows named lead actions separately.

Respond with JSON only:
{"headline":"max 8 words","body":"two paragraphs separated by \\n\\n","focusToday":"one imperative sentence"}${coachExtra}`,
      },
      {
        role: 'user',
        content: JSON.stringify({
          coachFor: firstName,
          snapshot,
          entrepreneurQuote,
          stageNamesForReference: stageBreakdown.map(
            (s) => `${s.key || s.slug || s.id}: ${s.name} (${s.count} leads)`
          ),
        }),
      },
    ],
    jsonObject: true,
    max_tokens: 650,
    temperature: 0.5,
  });

  if (!ai.content || ai.error) {
    return {
      success: false,
      error:
        'No AI provider configured (set OPENROUTER_API_KEY) or request failed.',
      snapshot,
      actions,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(ai.content);
  } catch {
    return { success: false, error: 'Invalid AI response', snapshot, actions };
  }

  const headline = typeof parsed.headline === 'string' ? parsed.headline.trim() : '';
  const body = typeof parsed.body === 'string' ? parsed.body.trim() : '';
  const focusToday = typeof parsed.focusToday === 'string' ? parsed.focusToday.trim() : '';

  return {
    success: true,
    headline: headline || 'Keep the pipeline moving',
    body: body || '',
    focusToday,
    actions,
    provider: ai.provider || 'unknown',
    snapshot,
  };
}

module.exports = {
  generateOutreachCoachPayload,
};
