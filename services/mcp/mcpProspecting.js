/**
 * End-to-end prospecting for MCP clients (Grok, Manus, ChatGPT, Claude) and Ask AI: qualify, research,
 * find decision makers, write outreach, enroll in cadences, log call outcomes and work the call queue.
 * Each tool calls the same service the web UI uses.
 */
const { z } = require('zod/v3');
const { zodToJsonSchema } = require('zod-to-json-schema');
const dbService = require('../database');
const workspaceIntegrations = require('../workspaceIntegrations');
const { filterLeadsForRequest } = require('../workspaceService');
const { filterBusinessPipelineLeads } = require('../leadListFilters');
const { applyLeadDisposition, humanizeDisposition } = require('../leadDispositionApply');
const { enrollLeadsBulk } = require('../prospectingEnroll');
const customCadences = require('../customCadences');
const sequenceEngine = require('../sequenceEngine');
const { filterTemplatesForWorkspace } = require('../auditCadenceGuard');
const contactFinder = require('../contactFinder');
const ghlClient = require('../ghlClient');
const { scoreLeadRecord } = require('../opportunityScore');
const { reviewLeadIcpFit } = require('../icpFitReview');
const { researchProspect } = require('../prospectResearch');
const websiteAiAnalysis = require('../websiteAiAnalysis');
const smsPersonalize = require('../smsPersonalize');
const { validateOutreachComposerBody } = require('../outreachComposerSanitize');
const { buildAuditReportUrl } = require('../infoPack');
const { buildCallQueue, DEFAULT_WINDOW_DAYS } = require('../callQueue');
const ghlMessaging = require('../ghlMessaging');
const { buildReqLike, resolveFolderRef, resolveLeadKey } = require('./mcpCrmService');
const { resolveCadence } = require('./mcpCadences');
const leadScriptTools = require('./mcpLeadScripts');

const OUTCOMES = [
  'connected',
  'no_answer',
  'voicemail',
  'gatekeeper',
  'callback',
  'not_interested',
  'wrong_number',
  'send_info',
  'site_audit',
  'sms_replied',
];
const MAX_ENROLL = 100;
const MAX_CADENCE_LAUNCH = 200;
const MAX_SEQUENCE_LEADS = 50;
const MAX_CONTACT_LEADS = 5;
const MAX_SCORE_LEADS = 100;

function toolError(message, code = 'PROSPECTING_ERROR') {
  const err = new Error(message);
  err.code = code;
  return err;
}

function clean(v) {
  const s = String(v == null ? '' : v).trim();
  return s && s !== 'N/A' ? s : '';
}

function leadRef(lead, fullKey) {
  return { id: fullKey, business: clean(lead.title), city: clean(lead.city), state: clean(lead.state) };
}

function idsFrom(input, max) {
  const ids = input.lead_ids && input.lead_ids.length ? input.lead_ids : input.lead_id ? [input.lead_id] : [];
  if (!ids.length) throw toolError('Pass lead_id or lead_ids.', 'INVALID_ARGUMENTS');
  if (ids.length > max) throw toolError(`Up to ${max} leads per call.`, 'INVALID_ARGUMENTS');
  return [...new Set(ids)];
}

/** Resolve each id in this workspace; unknown ids come back as errors instead of failing the whole call. */
async function resolveMany(ctx, ids) {
  const found = [];
  const errors = [];
  for (const id of ids) {
    try {
      // eslint-disable-next-line no-await-in-loop
      found.push(await resolveLeadKey(ctx.workspaceId, id));
    } catch (e) {
      errors.push({ lead_id: id, error: e.message, code: e.code || 'ERROR' });
    }
  }
  return { found, errors };
}

function reqFromBaseUrl(baseUrl) {
  try {
    const u = new URL(String(baseUrl || ''));
    return { protocol: u.protocol.replace(':', ''), headers: { host: u.host }, get: (h) => (String(h).toLowerCase() === 'host' ? u.host : undefined) };
  } catch (_) {
    return null;
  }
}

async function visibleBusinessLeads(ctx) {
  const all = await dbService.getAllLeads(ctx.workspaceId);
  return filterBusinessPipelineLeads(filterLeadsForRequest(buildReqLike(ctx.workspaceId, ctx.userEmail), all));
}

async function logCallOutcome(ctx, input) {
  const { lead, fullKey } = await resolveLeadKey(ctx.workspaceId, input.lead_id);
  const result = await applyLeadDisposition({
    workspaceId: ctx.workspaceId,
    userEmail: ctx.userEmail || '',
    fullKey,
    lead,
    code: input.outcome,
    notes: input.notes || '',
    scheduledAt: input.follow_up_at || '',
    skipFollowUp: input.skip_follow_up === true,
    source: 'api',
    authorName: (ctx.bot && ctx.bot.name) || '',
  });
  const task = result.followUpTask;
  return {
    lead: leadRef(lead, fullKey),
    outcome: humanizeDisposition(input.outcome),
    status: result.status,
    next_step: result.nextStep || '',
    automation: result.automation || '',
    follow_up: task && !result.skipFollowUp ? { task_id: task.id, title: task.title, due: result.scheduledAt || task.scheduledAt || '' } : null,
  };
}

async function enrollAutoOutreach(ctx, input) {
  const base = { workspaceId: ctx.workspaceId, reEnroll: input.re_enroll === true, tag: true, findContacts: input.find_contacts !== false };
  let result;
  let errors = [];
  if (input.lead_ids && input.lead_ids.length) {
    const { found, errors: missing } = await resolveMany(ctx, idsFrom(input, MAX_ENROLL));
    errors = missing;
    if (!found.length) throw toolError('None of those leads are in this workspace.', 'NOT_FOUND');
    result = await enrollLeadsBulk({ ...base, leadKeys: found.map((f) => f.fullKey) });
  } else if (input.folder_id || input.folder_name || input.tag) {
    const filter = {};
    if (input.folder_id || input.folder_name) {
      filter.folderKey = (await resolveFolderRef(ctx.workspaceId, { folder_id: input.folder_id, folder_name: input.folder_name })).key;
    }
    if (input.tag) {
      const want = String(input.tag).trim().toLowerCase();
      const tag = (await dbService.listTags(ctx.workspaceId)).find((t) => String(t.name || '').trim().toLowerCase() === want);
      if (!tag) throw toolError(`No tag named "${input.tag}".`, 'NOT_FOUND');
      filter.tagKey = tag.key;
    }
    result = await enrollLeadsBulk({ ...base, filter });
  } else {
    throw toolError('Pass lead_ids, a folder (folder_id / folder_name) or a tag.', 'INVALID_ARGUMENTS');
  }
  return {
    enrolled: result.enrolled,
    skipped: result.skipped,
    total: result.total,
    emails_found: result.emailsFound,
    daily_cap: result.dailyCap,
    remaining_today: result.remainingBudget,
    skipped_reasons: (result.results || []).filter((r) => r && !r.enrolled).slice(0, 50).map((r) => ({ lead_id: r.leadKey, reason: r.reason || r.error || 'skipped' })),
    ...(errors.length ? { errors } : {}),
  };
}

async function launchCadence(ctx, input) {
  const ws = await dbService.getWorkspace(ctx.workspaceId);
  const cadence = resolveCadence(ws, input.cadence);
  const { found, errors } = await resolveMany(ctx, idsFrom(input, MAX_CADENCE_LAUNCH));
  if (!found.length) throw toolError('None of those leads are in this workspace.', 'NOT_FOUND');
  const result = await customCadences.launchCadence({
    workspaceId: ctx.workspaceId,
    cadenceId: cadence.id,
    leadKeys: found.map((f) => f.fullKey),
    actorEmail: ctx.userEmail || '',
  });
  if (!result.ok) throw toolError(result.error, 'LAUNCH_FAILED');
  return {
    cadence: { id: cadence.id, name: cadence.name },
    launched: result.launched,
    skipped: result.skipped,
    ghl_tag: result.tagName,
    ...(cadence.ghlSetupAt ? {} : { warning: 'This cadence has no GHL workflow set up yet, so the tag is added but nothing sends. Use get_cadence_ghl_prompt to set it up.' }),
    ...(errors.length ? { errors } : {}),
  };
}

async function stopCadence(ctx, input) {
  const { found, errors } = await resolveMany(ctx, idsFrom(input, MAX_CADENCE_LAUNCH));
  const results = [];
  for (const { fullKey, lead } of found) {
    // eslint-disable-next-line no-await-in-loop
    const r = await customCadences.stopCadenceForLead({ workspaceId: ctx.workspaceId, leadKey: fullKey });
    results.push({ ...leadRef(lead, fullKey), stopped: !!r.ok, ...(r.ok ? {} : { error: r.error }) });
  }
  return { stopped: results.filter((r) => r.stopped).length, results, ...(errors.length ? { errors } : {}) };
}

async function manageSequence(ctx, input) {
  const ws = await dbService.getWorkspace(ctx.workspaceId);
  if (input.action === 'list_templates') {
    return { templates: filterTemplatesForWorkspace(sequenceEngine.listTemplates(), ws) };
  }
  const { found, errors } = await resolveMany(ctx, idsFrom(input, MAX_SEQUENCE_LEADS));
  const templateId = input.template_id || 'audit_local_14';
  if (input.action === 'start') {
    const allowed = filterTemplatesForWorkspace(sequenceEngine.listTemplates(), ws).map((t) => t.id);
    if (!allowed.includes(templateId)) throw toolError(`Unknown or unavailable template "${templateId}". Templates: ${allowed.join(', ')}.`, 'NOT_FOUND');
  }
  const days = Math.min(540, Math.max(7, input.days || 90));
  const results = [];
  for (const { fullKey, lead } of found) {
    try {
      if (input.action === 'start') {
        // eslint-disable-next-line no-await-in-loop
        await sequenceEngine.startSequence(fullKey, templateId);
      } else {
        // eslint-disable-next-line no-await-in-loop
        await sequenceEngine.pauseSequence(fullKey);
        if (input.action === 'snooze') {
          const until = new Date(Date.now() + days * 86400000).toISOString();
          const now = new Date().toISOString();
          // eslint-disable-next-line no-await-in-loop
          await dbService.updateLead(
            fullKey,
            {
              cadenceSnooze: { until, days, note: clean(input.note), setAt: now },
              logs: [{ type: 'cadence_snooze', message: `Cadence snoozed ~${days}d — re-engage after ${until.slice(0, 10)}.`, timestamp: now }],
            },
            ctx.workspaceId,
          );
        }
      }
      results.push({ ...leadRef(lead, fullKey), ok: true });
    } catch (e) {
      results.push({ ...leadRef(lead, fullKey), ok: false, error: e.message });
    }
  }
  return {
    action: input.action,
    ...(input.action === 'start' ? { template_id: templateId } : {}),
    ...(input.action === 'snooze' ? { days } : {}),
    done: results.filter((r) => r.ok).length,
    results,
    ...(errors.length ? { errors } : {}),
  };
}

async function findContacts(ctx, input) {
  const { found, errors } = await resolveMany(ctx, idsFrom(input, MAX_CONTACT_LEADS));
  const env = await workspaceIntegrations.getResolvedIntegrationEnv(ctx.workspaceId);
  const results = [];
  for (const { fullKey, lead } of found) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await contactFinder.findContactsForLead(lead, env);
      const { patch, filled } = contactFinder.buildLeadPatchFromFinder(lead, result, ghlClient.isValidEmailForGhl);
      // eslint-disable-next-line no-await-in-loop
      await dbService.updateLead(fullKey, patch, ctx.workspaceId);
      const f = patch.contactFinder || {};
      results.push({
        ...leadRef(lead, fullKey),
        status: f.status || 'none',
        people: result.people,
        emails: result.emails,
        phones: result.phones,
        socials: result.socials,
        sources: result.sources,
        saved_to_lead: filled,
        ...(f.status === 'error' ? { error: f.error || 'Contact search failed.' } : {}),
      });
    } catch (e) {
      results.push({ ...leadRef(lead, fullKey), status: 'error', code: e.code || 'ERROR', error: e.message });
    }
  }
  return { count: results.length, results, ...(errors.length ? { errors } : {}) };
}

async function analyzeWebsite(ctx, input) {
  const { lead, fullKey } = await resolveLeadKey(ctx.workspaceId, input.lead_id);
  const site = clean(lead.website) || clean(lead.url);
  let analysis = await websiteAiAnalysis.analyzeWebsite(site);
  analysis = websiteAiAnalysis.mergePriorAuditSnapshot(analysis, lead.aiWebsiteAnalysis || null);
  const ownerSignal = websiteAiAnalysis.buildOwnerSignal(lead, analysis);
  await dbService.updateLead(
    fullKey,
    {
      aiWebsiteAnalysis: analysis,
      aiWebsiteAnalysisScore: Number(analysis.analysisScore || 0),
      ownerSignal,
      aiWebsiteAnalysisUpdatedAt: new Date().toISOString(),
    },
    ctx.workspaceId,
  );
  return {
    lead: leadRef(lead, fullKey),
    website: analysis.websiteUrl || site,
    gap_score: analysis.analysisScore,
    gap_score_meaning: '0–10, higher = more website problems = better prospect for web / marketing services.',
    top_gaps: analysis.topGapLabels || websiteAiAnalysis.computeTopGapLabels(analysis, 5),
    page_title: analysis.pageTitle,
    https: analysis.hasHttps,
    mobile_friendly: analysis.mobileResponsive,
    load_seconds: analysis.pageLoadSeconds,
    copyright_year: analysis.copyrightYear,
    emails_on_site: analysis.emails,
    phones_on_site: analysis.phones,
    signals: analysis.signals,
    owner_signal: ownerSignal,
    ...(analysis.error ? { error: analysis.error } : {}),
  };
}

async function scoreLeads(ctx, input) {
  const { found, errors } = await resolveMany(ctx, idsFrom(input, MAX_SCORE_LEADS));
  const scored = found
    .map(({ lead, fullKey }) => {
      const s = scoreLeadRecord(lead);
      return {
        ...leadRef(lead, fullKey),
        score: Math.round(s.score * 10) / 10,
        tier: s.tier,
        prospect_tier: (s.localProspect && s.localProspect.prospectTier) || '',
        reasons: s.reasons,
        rating: lead.rating || null,
        reviews: lead.reviewsCount || lead.reviews || null,
        icp: lead.icpReview ? { decision: lead.icpReview.decision, score: lead.icpReview.score, grade: lead.icpReview.grade } : null,
      };
    })
    .sort((a, b) => b.score - a.score);
  return { count: scored.length, scale: '0–10 opportunity score; tier high ≥ 7, medium ≥ 4.', leads: scored, ...(errors.length ? { errors } : {}) };
}

async function reviewIcpFit(ctx, input) {
  const { lead, fullKey } = await resolveLeadKey(ctx.workspaceId, input.lead_id);
  const ws = (await dbService.getWorkspace(ctx.workspaceId)) || { id: ctx.workspaceId };
  const folder = lead.folderKey ? await dbService.getFolder(ctx.workspaceId, lead.folderKey) : null;
  const settings = (folder && folder.outreachAutomation) || {};
  const review = await reviewLeadIcpFit({
    lead: { ...lead, key: fullKey },
    workspace: ws,
    folder,
    settings,
    minIcpScore: input.min_score,
    forceRefresh: input.force_refresh === true,
  });
  return {
    lead: leadRef(lead, fullKey),
    passes: review.passes,
    decision: review.decision,
    score: review.score,
    grade: review.grade,
    reason: review.reason,
    niche_match: review.nicheMatch,
    geo_match: review.geoMatch,
    from_cache: !!review.fromCache,
  };
}

async function researchBusiness(ctx, input) {
  const env = await workspaceIntegrations.getResolvedIntegrationEnv(ctx.workspaceId);
  const brief = await researchProspect(input.business_name, input.city, input.state, input.category || '', { integrationEnv: env });
  return { research: brief };
}

async function personalizeMessage(ctx, input) {
  const channel = input.channel || 'sms';
  const { lead, fullKey } = await resolveLeadKey(ctx.workspaceId, input.lead_id);
  let script = clean(input.script);
  let source = 'given';
  if (!script) {
    const loaded = await leadScriptTools.executeLeadScriptTool(ctx, 'get_lead_script', { lead_id: fullKey, channel });
    script = clean(loaded.message);
    source = loaded.source;
    if (!script) throw toolError(loaded.note || `No ${channel} script for this lead. Pass script.`, 'NO_SCRIPT');
  }
  const checked = validateOutreachComposerBody(script, channel);
  if (!checked.ok) throw toolError(checked.error, 'INVALID_ARGUMENTS');
  const ws = await dbService.getWorkspace(ctx.workspaceId);
  if (channel === 'email') {
    const r = await smsPersonalize.personalizeEmailForLead(lead, checked.text, { context: 'outreach', subject: clean(input.subject) });
    const body = await leadScriptTools.fillMessageForLead(ctx, ws, lead, r.body);
    const subject = await leadScriptTools.fillMessageForLead(ctx, ws, lead, r.subject || input.subject || '');
    const ok = validateOutreachComposerBody(body.message, 'email');
    return {
      lead: leadRef(lead, fullKey),
      channel,
      subject: subject.message,
      message: ok.ok ? ok.text : checked.text,
      script_source: source,
      fell_back_to_script: !ok.ok,
      ...(body.unfilled.length ? { unfilled_placeholders: body.unfilled } : {}),
      next: 'Show the user, then send with send_email.',
    };
  }
  const r = await smsPersonalize.personalizeSmsForLead(lead, checked.text, { context: 'outreach' });
  const filled = await leadScriptTools.fillMessageForLead(ctx, ws, lead, r.message);
  const ok = validateOutreachComposerBody(filled.message, 'sms');
  return {
    lead: leadRef(lead, fullKey),
    channel,
    message: ok.ok ? ok.text : checked.text,
    script_source: source,
    fell_back_to_script: !ok.ok,
    ...(filled.unfilled.length ? { unfilled_placeholders: filled.unfilled } : {}),
    next: 'Show the user, then send with send_sms.',
  };
}

async function getAuditReportLink(ctx, input) {
  const { lead, fullKey } = await resolveLeadKey(ctx.workspaceId, input.lead_id);
  const ws = await dbService.getWorkspace(ctx.workspaceId);
  const links = buildAuditReportUrl({ lead: { ...lead, key: fullKey }, workspaceId: ctx.workspaceId, req: reqFromBaseUrl(ctx.baseUrl), workspace: ws });
  if (!links.ok) throw toolError(links.error || 'Could not build the audit link.', 'AUDIT_LINK_FAILED');
  return {
    lead: leadRef(lead, fullKey),
    report_url: links.reportUrl,
    pdf_url: links.pdfUrl || null,
    sms_snippet: links.smsSnippet || `Open your audit: ${links.reportUrl}`,
    follow_up_email: links.followUpEmail || null,
  };
}

async function getCallQueue(ctx, input) {
  const windowDays = input.window_days || DEFAULT_WINDOW_DAYS;
  const queue = buildCallQueue(await visibleBusinessLeads(ctx), { windowDays, limit: input.limit || 50 });
  return {
    window_days: windowDays,
    count: queue.length,
    queue: queue.map((q) => ({
      lead_id: q.leadKey,
      business: q.leadTitle,
      signal: q.signalLabel,
      signal_at: q.signalAt,
      priority: q.priority,
      stage: (q.prospecting && (q.prospecting.stage || q.prospecting.status)) || '',
    })),
    note: 'Leads that recently opened, clicked or replied, hottest first. Call them, then log_call_outcome.',
  };
}

async function getSmsThread(ctx, input) {
  const { lead, fullKey } = await resolveLeadKey(ctx.workspaceId, input.lead_id);
  const env = await workspaceIntegrations.getResolvedIntegrationEnv(ctx.workspaceId);
  let messages;
  if (input.sync !== false && ghlClient.isConfigured(env)) {
    const r = await ghlMessaging.syncGhlSmsToLead({ lead, integrationEnv: env });
    if (r.patch && r.added > 0) await dbService.updateLead(fullKey, r.patch, ctx.workspaceId);
    messages = r.messages || [];
  } else {
    messages = await ghlMessaging.buildSmsThreadForLead({ lead, integrationEnv: env });
  }
  const limit = input.limit || 50;
  return {
    lead: { ...leadRef(lead, fullKey), phone: clean(lead.phone) },
    count: messages.length,
    messages: messages.slice(-limit).map((m) => ({ direction: m.direction, body: m.body, at: m.timestamp, status: m.status || '' })),
  };
}

const LEAD_IDS = (max) => z.array(z.string().min(1)).min(1).max(max);

const PROSPECTING_TOOLS = [
  {
    name: 'log_call_outcome',
    description:
      'Log what happened on a call or touch with a lead, exactly like the Quick log buttons: sets the status, creates the follow-up task and kicks off the matching automation ' +
      '(voicemail queues a follow-up cadence, no_answer schedules a retry, not_interested closes it out). Use after every call.',
    schema: z.object({
      lead_id: z.string().min(1),
      outcome: z.enum(OUTCOMES),
      notes: z.string().max(4000).optional().describe('What was said; saved on the lead.'),
      follow_up_at: z.string().optional().describe('ISO date/time for the follow-up or callback. Omit to use the default for the outcome.'),
      skip_follow_up: z.boolean().optional().describe('true = no follow-up task.'),
    }),
    run: logCallOutcome,
  },
  {
    name: 'enroll_in_auto_outreach',
    description:
      'Enroll leads in Auto-outreach (the workspace\'s automated email/SMS drip via GHL). Pass lead_ids, or a folder / tag to enroll everything in it. ' +
      'Finds a missing email first unless find_contacts is false (uses enrichment credits). Daily cap applies; already-enrolled leads are skipped unless re_enroll.',
    schema: z.object({
      lead_ids: LEAD_IDS(MAX_ENROLL).optional(),
      folder_id: z.string().min(1).optional(),
      folder_name: z.string().min(1).optional(),
      tag: z.string().min(1).optional().describe('Enroll every lead with this tag (name).'),
      re_enroll: z.boolean().optional(),
      find_contacts: z.boolean().optional().describe('Hunt for a missing email before enrolling (default true).'),
    }),
    run: enrollAutoOutreach,
  },
  {
    name: 'launch_cadence',
    description:
      'Put leads on a custom GHL cadence (from list_custom_cadences, by name or id): tags them and syncs them to GoHighLevel so its workflow starts sending. Up to 200 leads.',
    schema: z.object({
      cadence: z.string().min(1).describe('Cadence name or id.'),
      lead_ids: LEAD_IDS(MAX_CADENCE_LAUNCH),
    }),
    run: launchCadence,
  },
  {
    name: 'stop_cadence',
    description: 'Take leads off their custom GHL cadence (removes the cadence tag so the workflow stops).',
    schema: z.object({ lead_ids: LEAD_IDS(MAX_CADENCE_LAUNCH) }),
    run: stopCadence,
  },
  {
    name: 'manage_sequence',
    description:
      'Built-in follow-up sequences: list_templates, start a template on leads, pause it, or snooze (pause and re-engage after N days). ' +
      'A lead on a custom GHL cadence must be stopped first (stop_cadence).',
    schema: z.object({
      action: z.enum(['list_templates', 'start', 'pause', 'snooze']),
      lead_ids: LEAD_IDS(MAX_SEQUENCE_LEADS).optional(),
      template_id: z.string().min(1).optional().describe('For start (see list_templates). Default audit_local_14.'),
      days: z.number().int().min(7).max(540).optional().describe('For snooze (default 90).'),
      note: z.string().max(500).optional().describe('For snooze.'),
    }),
    run: manageSequence,
  },
  {
    name: 'find_contacts',
    description:
      'Find decision makers at a business (owner / manager names, titles, direct emails, phones, LinkedIn and socials) from its website, and save them on the lead. ' +
      'Paid lookup; needs the lead to have a website. Up to 5 leads per call (each takes a while).',
    schema: z.object({
      lead_id: z.string().min(1).optional(),
      lead_ids: LEAD_IDS(MAX_CONTACT_LEADS).optional(),
    }),
    run: findContacts,
  },
  {
    name: 'analyze_website',
    description:
      'Audit a lead\'s website (HTTPS, mobile, speed, outdated copyright, contact emails/phones, chat/booking signals) and save it on the lead. ' +
      'Returns a 0–10 gap score and the top problems to pitch. Free.',
    schema: z.object({ lead_id: z.string().min(1) }),
    run: analyzeWebsite,
  },
  {
    name: 'score_leads',
    description:
      'Opportunity score (0–10) and prospect tier (Hot / Warm / Cold / Skip) for up to 100 leads, with the reasons, sorted best first. Free; use it to pick who to work.',
    schema: z.object({
      lead_id: z.string().min(1).optional(),
      lead_ids: LEAD_IDS(MAX_SCORE_LEADS).optional(),
    }),
    run: scoreLeads,
  },
  {
    name: 'review_icp_fit',
    description:
      'AI check of whether a lead fits the ideal customer profile for its offer (niche and service-area match), with a 0–10 score, grade and reason. Saved on the lead; cached unless force_refresh.',
    schema: z.object({
      lead_id: z.string().min(1),
      min_score: z.number().min(0).max(10).optional().describe('Passing score (default from the folder settings or 7).'),
      force_refresh: z.boolean().optional(),
    }),
    run: reviewIcpFit,
  },
  {
    name: 'research_business',
    description:
      'Research any business before outreach (it does not need to be a lead): Google profile, competitors, website problems, news / hiring signals, and a ready outreach package. Uses paid search credits.',
    schema: z.object({
      business_name: z.string().min(1),
      city: z.string().min(1),
      state: z.string().min(1),
      category: z.string().optional().describe('Trade, e.g. "roofer".'),
    }),
    run: researchBusiness,
  },
  {
    name: 'personalize_message',
    description:
      'Write a personalized SMS or email for a lead with AI, starting from the lead\'s saved script (or the script you pass) and its reviews, website and city. ' +
      'Returns the final text to show the user and then send with send_sms / send_email.',
    schema: z.object({
      lead_id: z.string().min(1),
      channel: z.enum(['sms', 'email']).optional().describe('Default sms.'),
      script: z.string().max(8000).optional().describe('Starting text. Omit to use the lead\'s script.'),
      subject: z.string().max(200).optional().describe('Email subject hint.'),
    }),
    run: personalizeMessage,
  },
  {
    name: 'get_audit_report_link',
    description: 'Shareable link to the lead\'s hosted website / Google audit report (plus PDF, a ready SMS line and a follow-up email) to send after a call.',
    schema: z.object({ lead_id: z.string().min(1) }),
    run: getAuditReportLink,
  },
  {
    name: 'get_call_queue',
    description: 'Who to call right now: leads that recently opened an email, clicked, visited or replied, hottest first.',
    schema: z.object({
      window_days: z.number().int().min(1).max(60).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    run: getCallQueue,
  },
  {
    name: 'get_sms_thread',
    description: 'Full two-way text conversation with a lead (pulls the latest from GoHighLevel). Read it before replying.',
    schema: z.object({
      lead_id: z.string().min(1),
      sync: z.boolean().optional().describe('Pull the latest from GHL first (default true).'),
      limit: z.number().int().min(1).max(200).optional().describe('Most recent messages to return (default 50).'),
    }),
    run: getSmsThread,
  },
];

const BY_NAME = Object.fromEntries(PROSPECTING_TOOLS.map((t) => [t.name, t]));
const PROSPECTING_TOOL_NAMES = PROSPECTING_TOOLS.map((t) => t.name);

async function executeProspectingTool(ctx, name, input) {
  const tool = BY_NAME[name];
  if (!tool) throw toolError(`Unknown tool: ${name}`, 'UNKNOWN_TOOL');
  const parsed = tool.schema.safeParse(input || {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw toolError(`${issue.path.join('.') || 'input'}: ${issue.message}`, 'INVALID_ARGUMENTS');
  }
  return tool.run(ctx, parsed.data);
}

function openAiFunctionTools() {
  return PROSPECTING_TOOLS.map((tool) => {
    const { $schema, ...parameters } = zodToJsonSchema(tool.schema, { target: 'openApi3' });
    return { type: 'function', function: { name: tool.name, description: tool.description, parameters } };
  });
}

module.exports = {
  PROSPECTING_TOOLS,
  PROSPECTING_TOOL_NAMES,
  READ_ONLY_PROSPECTING_TOOLS: ['score_leads', 'get_call_queue', 'get_audit_report_link'],
  DESTRUCTIVE_PROSPECTING_TOOLS: ['stop_cadence'],
  OPEN_WORLD_PROSPECTING_TOOLS: [
    'enroll_in_auto_outreach',
    'launch_cadence',
    'find_contacts',
    'analyze_website',
    'review_icp_fit',
    'research_business',
    'personalize_message',
    'get_sms_thread',
  ],
  executeProspectingTool,
  openAiFunctionTools,
};
