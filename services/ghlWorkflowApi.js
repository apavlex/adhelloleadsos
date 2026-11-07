/**
 * HighLevel Workflows API (private beta) — create draft workflows from AdHello.
 * Docs: Version v3 on services.leadconnectorhq.com
 */

const ghlClient = require('./ghlClient');

const WORKFLOWS_VERSION = 'v3';

function isWorkflowApiDisabledError(err) {
  const msg = String((err && err.message) || err || '');
  const code = String((err && err.code) || '');
  return (
    code === 'WORKFLOW_API_NOT_ENABLED_FOR_LOCATION' ||
    /WORKFLOW_API_NOT_ENABLED_FOR_LOCATION/i.test(msg) ||
    /workflows?\s*api.*(not enabled|not available|private beta)/i.test(msg)
  );
}

async function workflowsRequest(method, path, { integrationEnv, body, query } = {}) {
  const cfg = ghlClient.resolveConfig(integrationEnv);
  const locationId = cfg.locationId;
  if (!locationId) throw new Error('GHL location ID is not configured.');
  return ghlClient.ghlRequest(method, path, {
    integrationEnv,
    body,
    apiVersion: WORKFLOWS_VERSION,
    query: { locationId, ...(query || {}) },
  });
}

async function getStepTypes(integrationEnv) {
  return workflowsRequest('GET', '/workflows/step-types', { integrationEnv });
}

async function validateDefinition(integrationEnv, definition) {
  return workflowsRequest('POST', '/workflows/definition/validate', {
    integrationEnv,
    body: definition,
  });
}

async function createWorkflow(integrationEnv, definition) {
  return workflowsRequest('POST', '/workflows/', {
    integrationEnv,
    body: definition,
  });
}

async function updateWorkflowStatus(integrationEnv, workflowId, status) {
  const id = String(workflowId || '').trim();
  if (!id) throw new Error('workflowId required');
  return workflowsRequest('PUT', `/workflows/${encodeURIComponent(id)}/status`, {
    integrationEnv,
    body: { status },
  });
}

async function searchWorkflows(integrationEnv, { query, status } = {}) {
  return workflowsRequest('POST', '/workflows/search', {
    integrationEnv,
    body: {
      query: query != null ? String(query) : undefined,
      status: status != null ? String(status) : undefined,
    },
  });
}

function workflowsListUrl(locationId) {
  const loc = String(locationId || '').trim();
  if (!loc) return 'https://app.gohighlevel.com/';
  return `https://app.gohighlevel.com/v2/location/${encodeURIComponent(loc)}/automation/list`;
}

function workflowBuilderUrl(locationId, workflowId) {
  const loc = String(locationId || '').trim();
  const id = String(workflowId || '').trim();
  if (!loc) return 'https://app.gohighlevel.com/';
  if (!id) return workflowsListUrl(loc);
  return `https://app.gohighlevel.com/v2/location/${encodeURIComponent(loc)}/automation/workflows/${encodeURIComponent(id)}`;
}

module.exports = {
  WORKFLOWS_VERSION,
  isWorkflowApiDisabledError,
  getStepTypes,
  validateDefinition,
  createWorkflow,
  updateWorkflowStatus,
  searchWorkflows,
  workflowsListUrl,
  workflowBuilderUrl,
};
