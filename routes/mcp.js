/**
 * MCP Streamable HTTP endpoint for CEO Command Center CRM tools.
 * Compatible with ChatGPT MCP connectors and OpenAI Responses API.
 */
const express = require('express');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { mcpAuthContext } = require('../services/mcp/mcpAuth');
const { mcpRateLimit } = require('../services/mcp/mcpRateLimit');
const { createCrmMcpServer, getOpenAiToolManifest } = require('../services/mcp/mcpServerFactory');
const { getPublicBaseUrl } = require('../lib/publicBaseUrl');

const router = express.Router();

router.get('/manifest.json', mcpAuthContext, (req, res) => {
  res.json({
    success: true,
    endpoint: '/ceo/mcp',
    transport: 'streamable-http',
    protocol: 'mcp',
    workspaceId: req.workspaceId,
    authMethod: req.mcpAuthMethod,
    ...getOpenAiToolManifest(),
  });
});

async function handleMcpRequest(req, res) {
  const ctx = {
    workspaceId: req.workspaceId,
    userEmail: req.mcpUserEmail || '',
    baseUrl: getPublicBaseUrl(req),
    ...(req.mcpAllWorkspaces ? { allWorkspaces: true, grantId: req.mcpGrantId, workspaceName: (req.workspace && req.workspace.name) || '' } : {}),
  };

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  const server = createCrmMcpServer(ctx);
  // handleRequest returns before tool handlers reply; closing earlier ends the response empty.
  res.on('close', () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

router.post('/', mcpAuthContext, mcpRateLimit, async (req, res, next) => {
  try {
    await handleMcpRequest(req, res);
  } catch (err) {
    next(err);
  }
});

router.get('/', mcpAuthContext, mcpRateLimit, async (req, res, next) => {
  try {
    await handleMcpRequest(req, res);
  } catch (err) {
    next(err);
  }
});

router.delete('/', mcpAuthContext, mcpRateLimit, async (req, res, next) => {
  try {
    await handleMcpRequest(req, res);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
