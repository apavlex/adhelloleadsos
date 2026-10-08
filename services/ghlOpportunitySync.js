/**
 * Two-way sync between AdHello opportunity boards and GHL opportunity pipelines.
 *
 * - GHL pipelines link to AdHello boards by name (or create a board); stages follow GHL's names and order.
 * - AdHello boards with no GHL pipeline of the same name stay AdHello-only.
 * - Each lead keeps a snapshot of the placement last agreed with GHL (`ghlOpportunitySync`), so a sync
 *   can tell which side changed. When both changed, the most recent change wins.
 */
const crypto = require('crypto');
const dbService = require('./database');
const ghlClient = require('./ghlClient');
const workspaceIntegrations = require('./workspaceIntegrations');
const { normalizeBoards, buildOpportunityBoard } = require('./opportunityBoards');
const { filterBusinessPipelineLeads } = require('./leadListFilters');

const MAX_PIPELINES = 12;
const MAX_STAGES = 20;
const MAX_PAGES = 20;
const MAX_PUSH_PER_RUN = 300;
const CLOSED_STATUSES = new Set(['lost', 'abandoned']);

const SCOPE_HELP =
  'Your GHL token can’t read or edit opportunities. In GHL go to Settings → Private Integrations, edit the token, turn on “View Opportunities” and “Edit Opportunities”, save, then click Sync with GHL again.';

const locks = new Map();
const running = new Map();
const progress = new Map();

const PULL_START = 5;
const PUSH_START = 40;

function reporter(wid) {
  return (percent, label) => {
    progress.set(wid, { percent: Math.max(0, Math.min(99, Math.round(percent))), label: label || '' });
  };
}

function withLock(wid, fn) {
  const prev = locks.get(wid) || Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  const tail = run.catch(() => {});
  locks.set(wid, tail);
  tail.then(() => {
    if (locks.get(wid) === tail) locks.delete(wid);
  });
  return run;
}

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function nameKey(value) {
  const key = String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  return key === 'new lead' ? 'new opportunity' : key;
}

function cleanName(value, fallback) {
  const name = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  return name || fallback;
}

function ms(value) {
  const n = Date.parse(value || '');
  return Number.isFinite(n) ? n : 0;
}

function leadValue(lead) {
  const n = Number(lead && lead.opportunityValue);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function leadTitle(lead) {
  return String((lead && (lead.title || lead.name)) || '').trim().slice(0, 120) || 'Opportunity';
}

function bareKey(key) {
  return String(key || '').trim().replace(/^lead:/i, '');
}

function placementOf(lead) {
  return {
    pipelineId: String((lead && lead.opportunityPipelineId) || ''),
    stageId: String((lead && lead.opportunityStageId) || ''),
    dismissed: !!(lead && lead.opportunityDismissed),
    value: leadValue(lead),
  };
}

function fingerprint(placement) {
  return [placement.pipelineId, placement.stageId, placement.dismissed ? 1 : 0, placement.value].join('|');
}

function snapshot(placement, oppId, remoteUpdatedAt, status) {
  return {
    id: String(oppId || ''),
    fingerprint: fingerprint(placement),
    remoteUpdatedAt: remoteUpdatedAt || new Date().toISOString(),
    status: String(status || 'open').toLowerCase(),
    syncedAt: new Date().toISOString(),
  };
}

function oppUpdatedAt(opp) {
  const at = ms(opp.updatedAt) || ms(opp.lastStageChangeAt) || ms(opp.lastStatusChangeAt) || ms(opp.createdAt);
  return at ? new Date(at).toISOString() : '';
}

function friendlyError(err) {
  const msg = String((err && err.message) || err || 'GHL sync failed');
  const status = Number(err && err.status) || 0;
  if (/not authorized for this scope/i.test(msg) || status === 401 || status === 403) return SCOPE_HELP;
  return msg;
}

/** Link GHL pipelines to AdHello boards (by id, then by name) and mirror their stages. */
function linkBoards(rawBoards, ghlPipelines) {
  const boards = JSON.parse(JSON.stringify(normalizeBoards(rawBoards).boards));
  const summary = { linked: 0, createdBoards: [], addedStages: 0, skippedPipelines: [] };
  let changed = false;
  const remote = (Array.isArray(ghlPipelines) ? ghlPipelines : []).filter(
    (p) => p && p.id && Array.isArray(p.stages) && p.stages.some((s) => s && s.id),
  );
  const remoteIds = new Set(remote.map((p) => String(p.id)));

  boards.pipelines.forEach((pipeline) => {
    if (pipeline.ghlPipelineId && !remoteIds.has(pipeline.ghlPipelineId)) {
      delete pipeline.ghlPipelineId;
      pipeline.stages.forEach((stage) => delete stage.ghlStageId);
      changed = true;
    }
  });

  const claimed = new Set();
  remote.forEach((gp) => {
    const gid = String(gp.id);
    let local =
      boards.pipelines.find((p) => p.ghlPipelineId === gid) ||
      boards.pipelines.find((p) => !p.ghlPipelineId && !claimed.has(p.id) && nameKey(p.name) === nameKey(gp.name));
    if (!local) {
      if (boards.pipelines.length >= MAX_PIPELINES) {
        summary.skippedPipelines.push(cleanName(gp.name, 'Pipeline'));
        return;
      }
      local = { id: newId('opl'), name: cleanName(gp.name, 'Pipeline'), stages: [] };
      boards.pipelines.push(local);
      summary.createdBoards.push(local.name);
      changed = true;
    }
    claimed.add(local.id);
    if (local.ghlPipelineId !== gid) {
      local.ghlPipelineId = gid;
      changed = true;
    }
    const pipelineName = cleanName(gp.name, local.name);
    if (local.name !== pipelineName) {
      local.name = pipelineName;
      changed = true;
    }

    const remoteStages = gp.stages
      .filter((s) => s && s.id)
      .map((s, i) => ({ s, i }))
      .sort((a, b) => (Number(a.s.position) || 0) - (Number(b.s.position) || 0) || a.i - b.i)
      .map(({ s }) => s);
    const remoteStageIds = new Set(remoteStages.map((s) => String(s.id)));
    local.stages.forEach((stage) => {
      if (stage.ghlStageId && !remoteStageIds.has(stage.ghlStageId)) {
        delete stage.ghlStageId;
        changed = true;
      }
    });

    const ordered = [];
    remoteStages.forEach((gs) => {
      const sid = String(gs.id);
      let stage =
        local.stages.find((s) => s.ghlStageId === sid) ||
        local.stages.find((s) => !s.ghlStageId && !ordered.includes(s) && nameKey(s.name) === nameKey(gs.name));
      if (!stage) {
        stage = { id: newId('ops'), name: cleanName(gs.name, 'Stage') };
        summary.addedStages += 1;
        changed = true;
      }
      if (stage.ghlStageId !== sid) {
        stage.ghlStageId = sid;
        changed = true;
      }
      const stageName = cleanName(gs.name, stage.name);
      if (stage.name !== stageName) {
        stage.name = stageName;
        changed = true;
      }
      ordered.push(stage);
    });
    const next = [...ordered, ...local.stages.filter((s) => !ordered.includes(s))].slice(0, MAX_STAGES);
    if (next.map((s) => s.id).join() !== local.stages.map((s) => s.id).join()) changed = true;
    local.stages = next;
    summary.linked += 1;
  });

  return { boards, changed, summary };
}

/** Create AdHello-only stages of linked boards in the matching GHL pipeline so every column syncs. */
async function addMissingStagesToGhl(env, boards, ghlPipelines, report) {
  const added = [];
  const errors = [];
  const byId = new Map((ghlPipelines || []).map((p) => [String(p.id), p]));
  for (const pipeline of boards.pipelines) {
    const gp = pipeline.ghlPipelineId && byId.get(pipeline.ghlPipelineId);
    if (!gp) continue;
    const taken = new Set((gp.stages || []).map((s) => nameKey(s.name)));
    const names = [];
    pipeline.stages.forEach((stage) => {
      const key = nameKey(stage.name);
      if (stage.ghlStageId || taken.has(key)) return;
      taken.add(key);
      names.push(stage.name);
    });
    if (!names.length) continue;
    report(3, `Adding ${names.length} stage${names.length === 1 ? '' : 's'} to GHL “${pipeline.name}”`);
    try {
      // eslint-disable-next-line no-await-in-loop
      await ghlClient.addPipelineStages(gp, names, env);
      names.forEach((name) => added.push(`${pipeline.name} → ${name}`));
    } catch (e) {
      const why = /not authorized for this scope/i.test(String(e && e.message)) || [401, 403].includes(Number(e && e.status))
        ? 'your GHL token can’t edit pipelines'
        : friendlyError(e);
      errors.push(`Couldn’t add ${names.join(', ')} to GHL “${pipeline.name}” (${why}). Add those stages in GHL, then sync again.`);
    }
  }
  return { added, errors };
}

function linkIndex(boards) {
  const byGhlPipeline = new Map();
  boards.pipelines.forEach((pipeline) => {
    if (!pipeline.ghlPipelineId) return;
    const stagesByGhl = new Map();
    pipeline.stages.forEach((stage) => {
      if (stage.ghlStageId) stagesByGhl.set(stage.ghlStageId, stage);
    });
    byGhlPipeline.set(pipeline.ghlPipelineId, { pipeline, stagesByGhl });
  });
  return { byGhlPipeline };
}

function normalizeEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  return e && e !== 'n/a' ? e : '';
}

function phoneKey(phone) {
  const p = String(phone || '').trim();
  if (!p || p === 'N/A') return '';
  return ghlClient.normalizePhoneE164(p).replace(/\D/g, '');
}

function matchByContactInfo(leads, contact) {
  if (!contact) return null;
  const email = normalizeEmail(contact.email);
  if (email) {
    const hit = leads.find((l) => normalizeEmail(l.email) === email);
    if (hit) return hit;
  }
  const phone = phoneKey(contact.phone);
  if (phone) {
    const hit = leads.find((l) => phoneKey(l.phone) === phone);
    if (hit) return hit;
  }
  return null;
}

function createContext(wid, env, boards, leads, deps) {
  const ctx = {
    wid,
    env,
    boards,
    leads,
    index: linkIndex(boards),
    deps: deps || {},
    report: () => {},
    pulledKeys: new Set(),
    stats: { pulled: 0, created: 0, pushed: 0, closed: 0, failed: 0, errors: [] },
    byOpp: new Map(),
    byContact: new Map(),
  };
  leads.forEach((lead) => indexLead(ctx, lead));
  return ctx;
}

function indexLead(ctx, lead) {
  if (!lead) return;
  if (lead.ghlOpportunityId) ctx.byOpp.set(String(lead.ghlOpportunityId), lead);
  const cid = String(lead.ghlContactId || '');
  if (cid && (!ctx.byContact.has(cid) || lead.ghlOpportunityId)) ctx.byContact.set(cid, lead);
}

function replaceLead(ctx, before, after) {
  if (!after) return before;
  const i = ctx.leads.indexOf(before);
  if (i >= 0) ctx.leads[i] = after;
  else ctx.leads.push(after);
  indexLead(ctx, after);
  return after;
}

function recordError(ctx, label, err) {
  ctx.stats.failed += 1;
  if (ctx.stats.errors.length < 5) ctx.stats.errors.push(`${label}: ${friendlyError(err)}`);
}

async function createLeadFromOpportunity(ctx, opp, link, stage, contactId) {
  let contact = opp.contact || null;
  if (contactId) {
    try {
      contact = await ghlClient.getContact(contactId, ctx.env);
    } catch (_) {
      /* fall back to the contact summary on the opportunity */
    }
  }
  const patch = ghlClient.ghlContactToLeadPatch(contact || { id: contactId, name: opp.name }) || {};
  if (!patch.title || patch.title === 'GHL Contact') patch.title = leadTitle({ title: opp.name });
  const placement = {
    pipelineId: link.pipeline.id,
    stageId: stage.id,
    dismissed: false,
    value: Number(opp.monetaryValue) > 0 ? Number(opp.monetaryValue) : 0,
  };
  const key = await dbService.saveLead({
    ...patch,
    ghlContactId: contactId || patch.ghlContactId || '',
    workspaceId: ctx.wid,
    status: 'Not Contacted',
    pipelineStage: 1,
    savedAt: new Date().toISOString(),
    opportunityPipelineId: placement.pipelineId,
    opportunityStageId: placement.stageId,
    opportunityDismissed: false,
    opportunityValue: placement.value,
    opportunitySource: 'GHL',
    ghlOpportunityId: String(opp.id),
    ghlOpportunitySync: snapshot(placement, opp.id, oppUpdatedAt(opp), opp.status),
  });
  const saved = await dbService.getLead(key);
  replaceLead(ctx, null, saved || { key, ghlOpportunityId: String(opp.id), ghlContactId: contactId });
  if (saved) ctx.pulledKeys.add(saved.key);
  ctx.stats.created += 1;
}

async function applyRemoteOpportunity(ctx, opp, link) {
  const oppId = String(opp.id || '');
  if (!oppId) return;
  const status = String(opp.status || 'open').toLowerCase();
  const closed = CLOSED_STATUSES.has(status);
  const stage = link.stagesByGhl.get(String(opp.pipelineStageId || ''));
  if (!stage && !closed) return;
  const contactId = String(opp.contactId || (opp.contact && opp.contact.id) || '');
  const lead =
    ctx.byOpp.get(oppId) ||
    (contactId && ctx.byContact.get(contactId)) ||
    matchByContactInfo(ctx.leads, opp.contact);

  if (!lead) {
    if (closed) return;
    await createLeadFromOpportunity(ctx, opp, link, stage, contactId);
    return;
  }
  // A lead mirrors one GHL opportunity; extra opportunities for the same contact are left alone.
  if (lead.ghlOpportunityId && String(lead.ghlOpportunityId) !== oppId) return;

  const snap = lead.ghlOpportunitySync && lead.ghlOpportunitySync.id === oppId ? lead.ghlOpportunitySync : null;
  const local = placementOf(lead);
  const remoteAt = oppUpdatedAt(opp);
  const remoteChanged = !snap || ms(remoteAt) > ms(snap.remoteUpdatedAt);
  const localChanged = snap ? fingerprint(local) !== snap.fingerprint : !!local.pipelineId || local.dismissed;
  const localAt = ms(lead.opportunityChangedAt) || ms(lead.updatedAt);

  if (!remoteChanged || (localChanged && localAt > ms(remoteAt))) {
    if (!lead.ghlOpportunityId) lead.ghlOpportunityId = oppId;
    if (!snap && localChanged) lead.ghlOpportunitySync = { id: oppId, fingerprint: '', remoteUpdatedAt: remoteAt, status };
    return;
  }

  let next;
  if (closed) {
    const onLinkedBoard =
      !!local.pipelineId && ctx.boards.pipelines.some((p) => p.id === local.pipelineId && p.ghlPipelineId);
    next = onLinkedBoard ? { pipelineId: '', stageId: '', dismissed: true, value: local.value } : local;
  } else {
    next = {
      pipelineId: link.pipeline.id,
      stageId: stage.id,
      dismissed: false,
      value: Number(opp.monetaryValue) > 0 ? Number(opp.monetaryValue) : 0,
    };
  }
  const updated = await dbService.updateLead(
    lead.key,
    {
      opportunityPipelineId: next.pipelineId,
      opportunityStageId: next.stageId,
      opportunityDismissed: next.dismissed,
      opportunityValue: next.value,
      ghlOpportunityId: oppId,
      ghlContactId: lead.ghlContactId || contactId,
      ghlOpportunitySync: snapshot(next, oppId, remoteAt, status),
    },
    ctx.wid,
  );
  replaceLead(ctx, lead, updated);
  ctx.pulledKeys.add(lead.key);
  if (fingerprint(next) !== fingerprint(local)) ctx.stats.pulled += 1;
}

async function pullOpportunities(ctx) {
  const links = [...ctx.index.byGhlPipeline];
  const share = (PUSH_START - PULL_START) / Math.max(1, links.length);
  for (let i = 0; i < links.length; i += 1) {
    const [ghlPipelineId, link] = links[i];
    const base = PULL_START + share * i;
    const label = `Checking GHL “${link.pipeline.name}”`;
    ctx.report(base, label);
    let cursor = null;
    let seen = 0;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      // eslint-disable-next-line no-await-in-loop
      const result = await ghlClient.searchOpportunities(ctx.env, { pipelineId: ghlPipelineId, ...(cursor || {}) });
      const total = Math.max(result.total || 0, seen + result.opportunities.length);
      for (const opp of result.opportunities) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await applyRemoteOpportunity(ctx, opp, link);
        } catch (e) {
          recordError(ctx, (opp && opp.name) || 'Opportunity', e);
        }
        seen += 1;
        ctx.report(base + share * (seen / Math.max(1, total)), `${label}: ${seen} of ${total} deals`);
      }
      if (!result.next) break;
      cursor = result.next;
    }
  }
}

/** Where each card sits on a linked board, as the board itself would draw it. */
function desiredPlacements(ctx) {
  const desired = new Map();
  const leads = filterBusinessPipelineLeads(ctx.leads);
  ctx.boards.pipelines.forEach((pipeline) => {
    if (!pipeline.ghlPipelineId) return;
    const board = buildOpportunityBoard({ boards: ctx.boards, leads, tasks: [], pipelineId: pipeline.id });
    board.stages.forEach((col) => {
      const stage = pipeline.stages.find((s) => s.id === col.id);
      if (!stage || !stage.ghlStageId) return;
      col.cards.forEach((card) => desired.set(String(card.key), { pipeline, stage }));
    });
  });
  return desired;
}

function wantedPlacement(lead, want) {
  return { pipelineId: want.pipeline.id, stageId: want.stage.id, dismissed: false, value: leadValue(lead) };
}

function inSync(lead, want) {
  const snap = lead.ghlOpportunitySync;
  return !!(
    snap &&
    snap.id &&
    !CLOSED_STATUSES.has(snap.status) &&
    snap.fingerprint === fingerprint(wantedPlacement(lead, want))
  );
}

async function ensureContact(ctx, lead) {
  if (lead.ghlContactId) return String(lead.ghlContactId);
  if (ctx.deps.ensureContact) return ctx.deps.ensureContact(lead, ctx);
  const ghlSync = require('./ghlSync');
  const result = await ghlSync.pushLeads({
    workspaceId: ctx.wid,
    integrationEnv: ctx.env,
    leadKeys: [lead.key],
    listSyncFast: true,
  });
  const row = result && result.results && result.results[0];
  if (!row || !row.ok || !row.ghlContactId) throw new Error((row && row.error) || 'Could not create the GHL contact.');
  return String(row.ghlContactId);
}

async function pushOne(ctx, lead, want) {
  const snap = lead.ghlOpportunitySync || null;
  if (want) {
    const placement = wantedPlacement(lead, want);
    const contactId = await ensureContact(ctx, lead);
    const body = {
      pipelineId: want.pipeline.ghlPipelineId,
      pipelineStageId: want.stage.ghlStageId,
      name: leadTitle(lead),
      monetaryValue: placement.value,
    };
    let oppId = String((snap && snap.id) || lead.ghlOpportunityId || '');
    let opp = null;
    if (oppId) {
      if (snap && CLOSED_STATUSES.has(snap.status)) body.status = 'open';
      try {
        opp = await ghlClient.updateOpportunity(oppId, body, ctx.env);
      } catch (e) {
        if (Number(e && e.status) !== 404) throw e;
        oppId = '';
      }
    }
    if (!oppId) {
      opp = await ghlClient.upsertOpportunity({ ...body, contactId, status: 'open' }, ctx.env);
      oppId = String((opp && opp.id) || '');
      if (!oppId) throw new Error('GHL did not return the new opportunity.');
    }
    const status = (opp && opp.status) || body.status || (snap && snap.status) || 'open';
    const updated = await dbService.updateLead(
      lead.key,
      {
        opportunityPipelineId: placement.pipelineId,
        opportunityStageId: placement.stageId,
        opportunityDismissed: false,
        ghlOpportunityId: oppId,
        ghlContactId: contactId,
        ghlOpportunitySync: snapshot(placement, oppId, (opp && oppUpdatedAt(opp)) || '', status),
      },
      ctx.wid,
    );
    replaceLead(ctx, lead, updated);
    ctx.stats.pushed += 1;
    return;
  }

  // Was synced, now off every linked GHL stage: close it in GHL unless it only sits in an AdHello-only stage.
  if (!snap || !snap.id || CLOSED_STATUSES.has(snap.status)) return;
  const local = placementOf(lead);
  if (!local.dismissed && local.pipelineId && ctx.boards.pipelines.some((p) => p.id === local.pipelineId && p.ghlPipelineId)) {
    return;
  }
  const opp = await ghlClient.updateOpportunity(snap.id, { status: 'abandoned' }, ctx.env);
  const updated = await dbService.updateLead(
    lead.key,
    { ghlOpportunitySync: snapshot(local, snap.id, (opp && oppUpdatedAt(opp)) || '', 'abandoned') },
    ctx.wid,
  );
  replaceLead(ctx, lead, updated);
  ctx.stats.closed += 1;
}

async function pushOpportunities(ctx, onlyKeys) {
  const desired = desiredPlacements(ctx);
  const only = onlyKeys ? new Set([...onlyKeys].map(bareKey)) : null;
  const candidates = ctx.leads.filter((lead) => {
    if (!lead || !lead.key) return false;
    if (only && !only.has(bareKey(lead.key))) return false;
    if (ctx.pulledKeys.has(lead.key)) return false;
    return desired.has(String(lead.key)) || !!(lead.ghlOpportunitySync && lead.ghlOpportunitySync.id);
  });
  const work = candidates
    .map((lead) => ({ lead, want: desired.get(String(lead.key)) || null }))
    .filter(({ lead, want }) => !(want && inSync(lead, want)))
    .slice(0, MAX_PUSH_PER_RUN);
  ctx.report(PUSH_START, work.length ? `Sending to GHL: 0 of ${work.length} cards` : 'Finishing up');
  for (let i = 0; i < work.length; i += 1) {
    const { lead, want } = work[i];
    ctx.report(PUSH_START + (100 - PUSH_START) * (i / work.length), `Sending to GHL: ${i + 1} of ${work.length} cards`);
    try {
      // eslint-disable-next-line no-await-in-loop
      await pushOne(ctx, lead, want);
    } catch (e) {
      recordError(ctx, leadTitle(lead), e);
      if (/can’t read or edit opportunities/.test(friendlyError(e))) throw e;
    }
  }
}

async function saveStatus(wid, status) {
  const ws = (await dbService.getWorkspace(wid)) || { id: wid };
  ws.ghlOpportunitySync = status;
  await dbService.saveWorkspace(wid, ws);
}

/**
 * Full two-way sync for one workspace: link boards, pull GHL changes, push AdHello changes.
 * @param {string} workspaceId
 * @param {{ integrationEnv?: object, trigger?: string, deps?: object }} [opts]
 */
function syncWorkspace(workspaceId, opts = {}) {
  const wid = workspaceId || 'default';
  running.set(wid, (running.get(wid) || 0) + 1);
  const report = reporter(wid);
  report(0, 'Waiting to start');
  return withLock(wid, async () => {
    const startedAt = new Date().toISOString();
    let status;
    try {
      const env = opts.integrationEnv || (await workspaceIntegrations.getResolvedIntegrationEnv(wid));
      if (env.DEMO_WORKSPACE || !ghlClient.isConfigured(env)) {
        throw new Error('Connect Go High Level under Workspace → Integrations first.');
      }
      report(1, 'Reading GHL pipelines');
      let ghlPipelines = await ghlClient.listOpportunityPipelines(env);
      const ws = (await dbService.getWorkspace(wid)) || { id: wid };
      let linked = linkBoards(ws.opportunityBoards, ghlPipelines);
      const stageResult = await addMissingStagesToGhl(env, linked.boards, ghlPipelines, report);
      if (stageResult.added.length) {
        ghlPipelines = await ghlClient.listOpportunityPipelines(env);
        const relinked = linkBoards(linked.boards, ghlPipelines);
        linked = { boards: relinked.boards, changed: linked.changed || relinked.changed, summary: linked.summary };
      }
      const boards = normalizeBoards(linked.boards).boards;
      if (linked.changed) {
        ws.opportunityBoards = boards;
        await dbService.saveWorkspace(wid, ws);
      }
      const leads = [...(await dbService.getAllLeads(wid))];
      const ctx = createContext(wid, env, boards, leads, opts.deps);
      ctx.report = report;
      await pullOpportunities(ctx);
      await pushOpportunities(ctx);
      status = {
        ok: true,
        at: new Date().toISOString(),
        startedAt,
        trigger: opts.trigger || 'button',
        linkedBoards: boards.pipelines.filter((p) => p.ghlPipelineId).map((p) => p.name),
        localOnlyBoards: boards.pipelines.filter((p) => !p.ghlPipelineId).map((p) => p.name),
        createdBoards: linked.summary.createdBoards,
        addedStages: linked.summary.addedStages,
        skippedPipelines: linked.summary.skippedPipelines,
        stagesAddedToGhl: stageResult.added,
        ...ctx.stats,
      };
      if (stageResult.errors.length) {
        status.errors = [...stageResult.errors, ...status.errors].slice(0, 5);
        status.failed += stageResult.errors.length;
      }
    } catch (e) {
      status = {
        ok: false,
        at: new Date().toISOString(),
        startedAt,
        trigger: opts.trigger || 'button',
        error: friendlyError(e),
      };
    }
    try {
      await saveStatus(wid, status);
    } catch (e) {
      console.warn('[ghlOpportunitySync] status save failed:', e && e.message);
    }
    return status;
  }).finally(() => {
    const left = (running.get(wid) || 1) - 1;
    if (left > 0) running.set(wid, left);
    else {
      running.delete(wid);
      progress.delete(wid);
    }
  });
}

/** Push just these leads after a card move. Never throws; no-op when no board is linked. */
function pushLeadsNow(workspaceId, leadKeys, opts = {}) {
  const wid = workspaceId || 'default';
  const keys = (Array.isArray(leadKeys) ? leadKeys : [leadKeys]).map((k) => String(k || '').trim()).filter(Boolean);
  if (!keys.length) return Promise.resolve(null);
  return withLock(wid, async () => {
    const ws = await dbService.getWorkspace(wid);
    const boards = normalizeBoards(ws && ws.opportunityBoards).boards;
    if (!boards.pipelines.some((p) => p.ghlPipelineId)) return null;
    const env = opts.integrationEnv || (await workspaceIntegrations.getResolvedIntegrationEnv(wid));
    if (env.DEMO_WORKSPACE || !ghlClient.isConfigured(env)) return null;
    const leads = [...(await dbService.getAllLeads(wid))];
    const ctx = createContext(wid, env, boards, leads, opts.deps);
    await pushOpportunities(ctx, keys);
    if (ctx.stats.errors.length) console.warn('[ghlOpportunitySync] push after move:', ctx.stats.errors.join(' | '));
    return ctx.stats;
  }).catch((e) => {
    console.warn('[ghlOpportunitySync] push after move failed:', friendlyError(e));
    return null;
  });
}

function hasLinkedBoards(ws) {
  const pipelines = ws && ws.opportunityBoards && Array.isArray(ws.opportunityBoards.pipelines)
    ? ws.opportunityBoards.pipelines
    : [];
  return pipelines.some((p) => p && p.ghlPipelineId);
}

let scheduledRunning = false;

/** Every-15-minute pass: re-sync workspaces that have at least one board linked to GHL. */
async function runScheduledSyncs() {
  if (scheduledRunning) return { skipped: true };
  scheduledRunning = true;
  const results = [];
  try {
    const ids = await dbService.listWorkspaceIds();
    for (const wid of ids) {
      // eslint-disable-next-line no-await-in-loop
      const ws = await dbService.getWorkspace(wid);
      if (!hasLinkedBoards(ws)) continue;
      // eslint-disable-next-line no-await-in-loop
      const status = await syncWorkspace(wid, { trigger: 'auto' });
      if (!status.ok) console.warn('[ghlOpportunitySync] auto sync %s: %s', wid, status.error);
      results.push({ workspaceId: wid, ok: status.ok });
    }
  } finally {
    scheduledRunning = false;
  }
  return { results };
}

function statusFor(ws) {
  const wid = (ws && ws.id) || '';
  const isRunning = (running.get(wid) || 0) > 0;
  return {
    running: isRunning,
    progress: isRunning ? progress.get(wid) || { percent: 0, label: '' } : null,
    linked: hasLinkedBoards(ws),
    last: (ws && ws.ghlOpportunitySync) || null,
  };
}

module.exports = {
  SCOPE_HELP,
  linkBoards,
  syncWorkspace,
  pushLeadsNow,
  runScheduledSyncs,
  statusFor,
  hasLinkedBoards,
  friendlyError,
};
