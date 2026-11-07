/**
 * Build and push GHL workflows from AdHello cadences / auto-outreach prompts
 * so operators do not have to copy-paste into Workflow AI Builder.
 */

const crypto = require('crypto');
const ghlClient = require('./ghlClient');
const ghlWorkflowApi = require('./ghlWorkflowApi');
const customCadences = require('./customCadences');
const workspaceIntegrations = require('./workspaceIntegrations');

function sid(prefix) {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
}

function mergeGhlText(text) {
  return customCadences.toGhlMerge
    ? customCadences.toGhlMerge(text)
    : String(text || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, token) => {
        const map = {
          first_name: '{{contact.first_name}}',
          company: '{{contact.company_name}}',
          city: '{{contact.city}}',
          website: '{{contact.website}}',
        };
        return map[String(token).toLowerCase()] || m;
      });
}

/**
 * Prefer known public Workflows API types; remap if getStepTypes exposes aliases.
 */
function pickType(available, preferred, aliases) {
  const list = Array.isArray(available) ? available : [];
  const names = new Set(
    list
      .map((t) => String((t && (t.type || t.key || t.id || t.name)) || '').trim())
      .filter(Boolean),
  );
  if (!names.size) return preferred;
  if (names.has(preferred)) return preferred;
  for (const a of aliases || []) {
    if (names.has(a)) return a;
  }
  return preferred;
}

function flattenStepTypes(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.stepTypes)) return payload.stepTypes;
  if (Array.isArray(payload.triggers) || Array.isArray(payload.actions)) {
    return [].concat(payload.triggers || [], payload.actions || []);
  }
  if (payload.data && typeof payload.data === 'object') return flattenStepTypes(payload.data);
  return [];
}

async function resolveTypeMap(integrationEnv) {
  let available = [];
  try {
    const raw = await ghlWorkflowApi.getStepTypes(integrationEnv);
    available = flattenStepTypes(raw);
  } catch (err) {
    if (ghlWorkflowApi.isWorkflowApiDisabledError(err)) throw err;
    /* proceed with defaults when step-types fails for other reasons */
  }
  return {
    contactTag: pickType(available, 'contact_tag', ['contactTag', 'tag_added', 'contact_tag_added']),
    wait: pickType(available, 'wait', ['delay', 'wait_time']),
    sendEmail: pickType(available, 'send_email', ['email', 'sendEmail', 'send_email_message']),
    sendSms: pickType(available, 'send_sms', ['sms', 'sendSms', 'send_sms_message', 'twilio_sms']),
    createTask: pickType(available, 'create_task', ['task', 'createTask', 'add_task']),
    addTag: pickType(available, 'add_contact_tag', ['add_tag', 'addContactTag', 'contact_add_tag']),
  };
}

function waitAction(types, id, name, { minutes, days }) {
  const attrs =
    days != null
      ? { type: 'time', startAfter: { when: 'after', type: 'days', value: Number(days) || 1 } }
      : { type: 'time', startAfter: { when: 'after', type: 'minutes', value: Number(minutes) || 2 } };
  return {
    id,
    type: types.wait,
    name,
    attributes: attrs,
  };
}

function buildCadenceDefinition(cadence, types) {
  const c = customCadences.normalizeCadence
    ? customCadences.normalizeCadence(cadence)
    : cadence;
  const tag = customCadences.tagNameFor(c);
  const actions = [];
  const edges = [];

  const waitSyncId = sid('wait-sync');
  actions.push(waitAction(types, waitSyncId, 'Wait for AdHello sync', { minutes: 2 }));
  let prevId = waitSyncId;
  let prevDay = 0;

  (c.steps || []).forEach((step, i) => {
    const gap = Math.max(0, Number(step.dayOffset) - prevDay);
    prevDay = Number(step.dayOffset) || prevDay;
    if (gap > 0) {
      const waitId = sid(`wait-d${step.dayOffset}`);
      actions.push(waitAction(types, waitId, `Wait ${gap} day${gap === 1 ? '' : 's'}`, { days: gap }));
      edges.push({ from: prevId, to: waitId });
      prevId = waitId;
    }

    const stepId = sid(`step-${i + 1}`);
    if (step.channel === 'sms') {
      actions.push({
        id: stepId,
        type: types.sendSms,
        name: `Day ${step.dayOffset} SMS`,
        attributes: {
          message: mergeGhlText(step.message),
        },
      });
    } else if (step.channel === 'email') {
      actions.push({
        id: stepId,
        type: types.sendEmail,
        name: `Day ${step.dayOffset} Email`,
        attributes: {
          subject: mergeGhlText(step.subject || 'Quick idea for {{contact.company_name}}'),
          body: mergeGhlText(step.message),
          html: false,
        },
      });
    } else if (step.channel === 'call' || step.channel === 'voicemail') {
      actions.push({
        id: stepId,
        type: types.createTask,
        name: step.channel === 'voicemail' ? `Day ${step.dayOffset} Voicemail` : `Day ${step.dayOffset} Call`,
        attributes: {
          title: mergeGhlText(
            step.channel === 'voicemail'
              ? `Leave voicemail for {{contact.first_name}} at {{contact.company_name}} — ${c.name}`
              : `Call {{contact.first_name}} at {{contact.company_name}} — ${c.name}`,
          ),
          body: mergeGhlText(step.message),
          dueInDays: 0,
        },
      });
    } else {
      return;
    }
    edges.push({ from: prevId, to: stepId });
    prevId = stepId;
  });

  const doneId = sid('tag-done');
  actions.push({
    id: doneId,
    type: types.addTag,
    name: 'Mark cadence done',
    attributes: { tags: [`${tag}-done`] },
  });
  edges.push({ from: prevId, to: doneId });

  return {
    name: `AdHello · ${c.name}`,
    source: { system: 'adhello', cadenceId: c.id || undefined },
    triggers: [
      {
        type: types.contactTag,
        name: 'Contact tag added',
        attributes: { tags: [tag] },
      },
    ],
    actions,
    edges,
    settings: {
      allowMultiple: false,
      stopOnResponse: true,
    },
  };
}

function buildAutoOutreachDefinition(types) {
  const tag = 'auto-outreach';
  const waitId = sid('wait-sync');
  const emailId = sid('email-d0');
  const wait3Id = sid('wait-d3');
  const smsId = sid('sms-d3');
  const wait5Id = sid('wait-d5');
  const taskId = sid('task-d5');
  const doneId = sid('tag-done');

  return {
    name: 'AdHello · Auto outreach',
    source: { system: 'adhello', kind: 'auto-outreach' },
    triggers: [
      {
        type: types.contactTag,
        name: 'Contact tag added',
        attributes: { tags: [tag] },
      },
    ],
    actions: [
      waitAction(types, waitId, 'Wait for AdHello sync', { minutes: 2 }),
      {
        id: emailId,
        type: types.sendEmail,
        name: 'Day 0 email',
        attributes: {
          subject: '{{contact.first_name}}, quick idea for {{contact.company_name}} in {{contact.city}}',
          body: [
            'Hi {{contact.first_name}},',
            '',
            "I'm with {{custom_values.adhello_sender_business}}. I was looking at local businesses in {{contact.city}} and noticed {{contact.company_name}} may have room to improve online.",
            '',
            '{{custom_values.adhello_sender_pitch}}',
            '',
            'Here is a free quick scan — no signup required:',
            '{{custom_values.adhello_audit_link}}',
            '',
            'If useful, reply and I can walk you through the top fix.',
            '',
            'Best,',
            '{{custom_values.adhello_sender_business}}',
          ].join('\n'),
          html: false,
        },
      },
      waitAction(types, wait3Id, 'Wait 3 days', { days: 3 }),
      {
        id: smsId,
        type: types.sendSms,
        name: 'Day 3 SMS (mobile)',
        attributes: {
          message:
            'Hi {{contact.first_name}} — {{custom_values.adhello_sender_business}} here. Did you get a chance to peek at the quick scan for {{contact.company_name}}? Happy to walk through the top fix.',
        },
      },
      waitAction(types, wait5Id, 'Wait 2 more days', { days: 2 }),
      {
        id: taskId,
        type: types.createTask,
        name: 'Day 5 follow-up task',
        attributes: {
          title: 'Follow up with {{contact.company_name}} (auto-outreach)',
          body: 'No reply yet after email + SMS. Call or personalize next touch.',
          dueInDays: 0,
        },
      },
      {
        id: doneId,
        type: types.addTag,
        name: 'Mark auto-outreach done',
        attributes: { tags: ['auto-outreach-done'] },
      },
    ],
    edges: [
      { from: waitId, to: emailId },
      { from: emailId, to: wait3Id },
      { from: wait3Id, to: smsId },
      { from: smsId, to: wait5Id },
      { from: wait5Id, to: taskId },
      { from: taskId, to: doneId },
    ],
    settings: {
      allowMultiple: false,
      stopOnResponse: true,
    },
  };
}

function extractWorkflowId(created) {
  if (!created || typeof created !== 'object') return '';
  return String(
    created.id ||
      created.workflowId ||
      (created.workflow && (created.workflow.id || created.workflow.workflowId)) ||
      (created.data && (created.data.id || created.data.workflowId)) ||
      '',
  ).trim();
}

async function createDraftFromDefinition(integrationEnv, definition, { publish = false } = {}) {
  if (!ghlClient.isConfigured(integrationEnv)) {
    const err = new Error('Connect Go High Level under Workspace → Integrations first.');
    err.code = 'GHL_NOT_CONFIGURED';
    throw err;
  }
  const cfg = ghlClient.resolveConfig(integrationEnv);

  let validated;
  try {
    validated = await ghlWorkflowApi.validateDefinition(integrationEnv, definition);
  } catch (err) {
    if (ghlWorkflowApi.isWorkflowApiDisabledError(err)) {
      err.code = 'WORKFLOW_API_NOT_ENABLED_FOR_LOCATION';
      throw err;
    }
    throw err;
  }

  if (validated && validated.valid === false) {
    const first =
      (Array.isArray(validated.errors) && validated.errors[0] && (validated.errors[0].message || validated.errors[0])) ||
      'Workflow definition failed validation';
    const err = new Error(typeof first === 'string' ? first : JSON.stringify(first));
    err.code = 'WORKFLOW_INVALID';
    err.details = validated;
    throw err;
  }

  const created = await ghlWorkflowApi.createWorkflow(integrationEnv, definition);
  const workflowId = extractWorkflowId(created);
  if (publish && workflowId) {
    try {
      await ghlWorkflowApi.updateWorkflowStatus(integrationEnv, workflowId, 'published');
    } catch (_) {
      /* draft is still useful */
    }
  }

  return {
    workflowId,
    created,
    openUrl: ghlWorkflowApi.workflowBuilderUrl(cfg.locationId, workflowId),
    listUrl: ghlWorkflowApi.workflowsListUrl(cfg.locationId),
    status: publish ? 'published' : 'draft',
  };
}

async function buildCadenceWorkflow(workspaceId, cadenceId, { publish = false } = {}) {
  const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(workspaceId);
  const ws = await require('./database').getWorkspace(workspaceId);
  const list = customCadences.listCadences(ws);
  const cadence = list.find((c) => c && c.id === cadenceId);
  if (!cadence) {
    const err = new Error('Cadence not found');
    err.code = 'NOT_FOUND';
    throw err;
  }

  const prompt = customCadences.buildGhlPrompt(cadence);
  const cfg = ghlClient.resolveConfig(integrationEnv);
  const fallback = {
    mode: 'prompt_fallback',
    prompt,
    openUrl: ghlWorkflowApi.workflowsListUrl(cfg.locationId),
    listUrl: ghlWorkflowApi.workflowsListUrl(cfg.locationId),
    message:
      'GHL Workflows API is not enabled on this location yet. Prompt copied for Workflow AI Builder — open Automations → Workflows → AI Builder and paste.',
  };

  try {
    const types = await resolveTypeMap(integrationEnv);
    const definition = buildCadenceDefinition(cadence, types);
    const result = await createDraftFromDefinition(integrationEnv, definition, { publish });
    await customCadences.markGhlSetup(workspaceId, cadence.id);
    return {
      mode: 'api',
      prompt,
      cadenceId: cadence.id,
      cadenceName: cadence.name,
      tagName: customCadences.tagNameFor(cadence),
      ...result,
      message: result.workflowId
        ? `Draft workflow created in GHL${publish ? ' and published' : ''}. Review steps, then publish if needed.`
        : 'Workflow created in GHL. Open Automations to review.',
    };
  } catch (err) {
    if (ghlWorkflowApi.isWorkflowApiDisabledError(err) || err.code === 'WORKFLOW_API_NOT_ENABLED_FOR_LOCATION') {
      return { ...fallback, code: 'WORKFLOW_API_NOT_ENABLED_FOR_LOCATION' };
    }
    if (err.code === 'GHL_NOT_CONFIGURED') throw err;
    // Validation / create failures: still give the prompt path so the user can finish in AI Builder.
    return {
      ...fallback,
      code: err.code || 'BUILD_FAILED',
      error: err.message,
      message: `Could not create the workflow via API (${err.message}). Prompt is ready for GHL Workflow AI Builder.`,
    };
  }
}

async function buildAutoOutreachWorkflow(workspaceId, { publish = false } = {}) {
  const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(workspaceId);
  const cfg = ghlClient.resolveConfig(integrationEnv);
  const prompt = require('./ghlAutoOutreachPromptText').PROMPT;

  const fallback = {
    mode: 'prompt_fallback',
    prompt,
    openUrl: ghlWorkflowApi.workflowsListUrl(cfg.locationId),
    listUrl: ghlWorkflowApi.workflowsListUrl(cfg.locationId),
    message:
      'GHL Workflows API is not enabled on this location yet. Use Workflow AI Builder with the auto-outreach prompt (copied).',
  };

  try {
    const types = await resolveTypeMap(integrationEnv);
    const definition = buildAutoOutreachDefinition(types);
    const result = await createDraftFromDefinition(integrationEnv, definition, { publish });
    return {
      mode: 'api',
      prompt,
      tagName: 'auto-outreach',
      ...result,
      message: result.workflowId
        ? `Auto-outreach draft created in GHL${publish ? ' and published' : ''}. Review merge fields, then publish.`
        : 'Auto-outreach workflow created in GHL.',
    };
  } catch (err) {
    if (ghlWorkflowApi.isWorkflowApiDisabledError(err) || err.code === 'WORKFLOW_API_NOT_ENABLED_FOR_LOCATION') {
      return { ...fallback, code: 'WORKFLOW_API_NOT_ENABLED_FOR_LOCATION' };
    }
    if (err.code === 'GHL_NOT_CONFIGURED') throw err;
    return {
      ...fallback,
      code: err.code || 'BUILD_FAILED',
      error: err.message,
      message: `Could not create via API (${err.message}). Prompt ready for Workflow AI Builder.`,
    };
  }
}

/**
 * Create a GHL draft from an arbitrary generated setup prompt (workflow coach).
 * Uses API when available; otherwise returns prompt fallback for AI Builder paste.
 */
async function buildFromPrompt(workspaceId, { name, prompt, publish = false } = {}) {
  const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(workspaceId);
  const cfg = ghlClient.resolveConfig(integrationEnv);
  const text = String(prompt || '').trim();
  if (!text) {
    const err = new Error('Prompt is required');
    err.code = 'NO_PROMPT';
    throw err;
  }

  const fallback = {
    mode: 'prompt_fallback',
    prompt: text,
    openUrl: ghlWorkflowApi.workflowsListUrl(cfg.locationId),
    listUrl: ghlWorkflowApi.workflowsListUrl(cfg.locationId),
    message: 'Open GHL → Automations → Workflows → AI Builder and paste the prompt (already copied).',
  };

  // Structured create from free-form prompt is not reliably available without NL→definition.
  // Prefer API auto-outreach-shaped draft only when the prompt looks like AdHello auto-outreach;
  // otherwise hand off to Workflow AI Builder with the prompt.
  if (/auto-outreach|contact tag added/i.test(text) && /day\s*0|send email/i.test(text)) {
    try {
      const types = await resolveTypeMap(integrationEnv);
      const definition = buildAutoOutreachDefinition(types);
      if (name) definition.name = String(name).slice(0, 120);
      const result = await createDraftFromDefinition(integrationEnv, definition, { publish });
      return {
        mode: 'api',
        prompt: text,
        ...result,
        message: 'Draft workflow created in GHL from your prompt structure. Review and publish.',
      };
    } catch (err) {
      if (err.code === 'GHL_NOT_CONFIGURED') throw err;
      return { ...fallback, code: err.code || 'BUILD_FAILED', error: err.message };
    }
  }

  return fallback;
}

module.exports = {
  buildCadenceDefinition,
  buildAutoOutreachDefinition,
  buildCadenceWorkflow,
  buildAutoOutreachWorkflow,
  buildFromPrompt,
  resolveTypeMap,
};
