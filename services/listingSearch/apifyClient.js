const { ApifyClient } = require('apify-client');

function apifyToken(integrationEnv) {
  const fromWs = integrationEnv && integrationEnv.APIFY_API_TOKEN;
  if (typeof fromWs === 'string' && fromWs.trim()) return fromWs.trim();
  return (process.env.APIFY_API_TOKEN || '').trim();
}

function isApifyConfigured(integrationEnv) {
  return Boolean(apifyToken(integrationEnv));
}

function clientFor(integrationEnv) {
  const token = apifyToken(integrationEnv);
  if (!token) {
    throw new Error('APIFY_API_TOKEN is not set (workspace integrations or environment).');
  }
  return new ApifyClient({ token });
}

async function runActor(integrationEnv, actorId, input, label) {
  const client = clientFor(integrationEnv);
  const id = String(actorId || '').trim();
  if (!id) throw new Error(`${label}: actor ID is not configured.`);
  console.log(`[LISTING-${label}] Starting Apify actor ${id}`);
  const run = await client.actor(id).call(input);
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  console.log(`[LISTING-${label}] Retrieved ${items.length} raw items.`);
  return items || [];
}

module.exports = {
  apifyToken,
  isApifyConfigured,
  clientFor,
  runActor,
};
