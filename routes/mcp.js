/**
 * MCP Streamable HTTP endpoint for CEO Command Center CRM tools.
 * Compatible with ChatGPT MCP connectors and OpenAI Responses API.
 */
const express = require('express');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { mcpAuthContext } = require('../services/mcp/mcpAuth');
const { mcpRateLimit } = require('../services/mcp/mcpRateLimit');
const { createCrmMcpServer, getOpenAiToolManifest } = require('../services/mcp/mcpServerFactory');

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
  };

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  const server = createCrmMcpServer(ctx);
  await server.connect(transport);
  try {
    await transport.handleRequest(req, res, req.body);
  } finally {
    await server.close().catch(() => {});
  }
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
