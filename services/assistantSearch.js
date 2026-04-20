const dbService = require('./database');

function tokenizeQuery(q) {
  return String(q || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .slice(0, 12);
}

function leadHaystack(lead) {
  return [
    lead.title,
    lead.city,
    lead.state,
    lead.website,
    lead.email,
    lead.phone,
    lead.category,
    lead.industry,
    lead.source,
    String(lead.pipelineStage ?? ''),
    lead.status,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function scoreHaystack(haystack, words) {
  if (!words.length) return 0;
  let s = 0;
  for (const w of words) {
    if (haystack.includes(w)) s += 1;
  }
  return s;
}

/**
 * Load leads + resources, rank by keyword overlap with user query, format for LLM + UI citations.
 * @param {{ workspaceId: string, email: string, query: string }} opts
 */
async function buildAssistantContext(opts) {
  const workspaceId = opts.workspaceId;
  const email = opts.email;
  const query = opts.query || '';
  const words = tokenizeQuery(query);

  const [leads, resources] = await Promise.all([
    dbService.listLeads(workspaceId),
    dbService.listUserResources(workspaceId, email),
  ]);

  let leadsForContext;
  let resForContext;

  if (words.length === 0) {
    leadsForContext = leads.slice(0, 14).map((lead) => ({ lead, score: 0 }));
    resForContext = resources.slice(0, 8).map((r) => ({ r, score: 0 }));
  } else {
    const leadScored = leads
      .map((lead) => ({
        lead,
        score: scoreHaystack(leadHaystack(lead), words),
      }))
      .sort((a, b) => b.score - a.score);

    const resScored = resources
      .map((r) => {
        const hay = [r.title, r.url, r.note, r.kind].join(' ').toLowerCase();
        return { r, score: scoreHaystack(hay, words) };
      })
      .sort((a, b) => b.score - a.score);

    leadsForContext = leadScored.filter((x) => x.score > 0).slice(0, 22);
    if (leadsForContext.length === 0) {
      leadsForContext = leads.slice(0, 8).map((lead) => ({ lead, score: 0 }));
    }

    resForContext = resScored.filter((x) => x.score > 0).slice(0, 14);
    if (resForContext.length === 0) {
      resForContext = resources.slice(0, 6).map((r) => ({ r, score: 0 }));
    }
  }

  let contextText = '';
  const citations = [];
  const capLeadCite = words.length === 0 ? 5 : 12;
  const capResCite = words.length === 0 ? 4 : 8;
  let nLeadCite = 0;
  let nResCite = 0;

  for (const { lead, score } of leadsForContext.slice(0, 18)) {
    const shortKey = String(lead.key || '').replace(/^lead:/i, '');
    const parts = [
      `Lead: "${lead.title || 'Untitled'}"`,
      [lead.city, lead.state].filter(Boolean).join(', ') || null,
      lead.website && lead.website !== 'N/A' ? lead.website : null,
      typeof lead.pipelineStage === 'number' ? `pipeline stage ${lead.pipelineStage}` : null,
    ].filter(Boolean);
    contextText += `- ${parts.join(' · ')}\n`;

    if (citations.length < 14 && (score > 0 || words.length === 0)) {
      citations.push({
        type: 'lead',
        title: lead.title || 'Lead',
        href: `/focus?lead=${encodeURIComponent(shortKey)}`,
      });
    }
  }

  for (const { r, score } of resForContext.slice(0, 12)) {
    const noteBit = r.note ? ` — ${String(r.note).slice(0, 100)}` : '';
    contextText += `- Resource (${r.kind}): "${r.title}" ${r.url}${noteBit}\n`;

    if (nResCite < capResCite && (score > 0 || words.length === 0)) {
      citations.push({
        type: 'resource',
        title: r.title,
        href: r.url,
        page: '/resources',
      });
      nResCite += 1;
    }
  }

  if (!contextText.trim()) {
    contextText = '(No leads or saved resources in this workspace yet.)';
  }

  return { contextText, citations };
}

module.exports = {
  buildAssistantContext,
};
