const test = require('node:test');
const assert = require('node:assert/strict');
const instantlyClient = require('../services/instantlyClient');
const instantlyExport = require('../services/instantlyExport');

function mockFetch(handler) {
  return async (url, init) => {
    const result = await handler(url, init);
    const body = result.body == null ? '' : JSON.stringify(result.body);
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      async text() {
        return body;
      },
    };
  };
}

test('campaign rows match Instantly’s lead template', () => {
  const withEmail = instantlyExport.rowsForLead(
    {
      key: 'lead:1',
      title: 'Spark Electric',
      email: 'ada@spark.example',
      contactName: 'Ada Lovelace',
      decisionMakerTitle: 'Owner',
      personalization: 'Saw the new shop on Main.',
      phone: '360-555-0100',
      city: 'Vancouver',
      state: 'WA',
      zip: '98662',
      categoryName: 'Electricians',
      contractorLicenseNumber: 'SPARK123',
      website: 'spark.example',
      linkedin: 'linkedin.com/in/ada',
      icebreaker: 'ignored when personalization is set',
    },
    { requireEmail: true },
  );
  assert.equal(withEmail.payloads.length, 1);
  assert.deepEqual(withEmail.skipped, []);
  const row = withEmail.payloads[0].payload;
  assert.deepEqual(Object.keys(row).sort(), [
    'company_name',
    'custom_variables',
    'email',
    'first_name',
    'job_title',
    'last_name',
    'personalization',
    'phone',
    'website',
  ]);
  assert.equal(row.email, 'ada@spark.example');
  assert.equal(row.first_name, 'Ada');
  assert.equal(row.last_name, 'Lovelace');
  assert.equal(row.company_name, 'Spark Electric');
  assert.equal(row.job_title, 'Owner');
  assert.equal(row.personalization, 'Saw the new shop on Main.');
  assert.equal(row.phone, '+13605550100');
  assert.equal(row.website, 'https://spark.example');
  assert.deepEqual(row.custom_variables, {
    Location: 'Vancouver, WA 98662',
    LinkedIn: 'https://linkedin.com/in/ada',
  });

  const noEmail = instantlyExport.rowsForLead(
    { key: 'lead:2', title: 'Quiet Handy', contactName: 'Sam Quiet' },
    { requireEmail: true },
  );
  assert.equal(noEmail.payloads.length, 0);
  assert.equal(noEmail.skipped[0].reason, 'no_email');
});

test('list rows accept a business name when there is no email', () => {
  const built = instantlyExport.rowsForLead(
    { key: 'lead:3', title: 'Rain Roofing', phone: '503-555-0199' },
    { requireEmail: false },
  );
  assert.equal(built.payloads.length, 1);
  assert.equal(built.payloads[0].payload.email, undefined);
  assert.equal(built.payloads[0].payload.first_name, 'Rain Roofing');
  assert.equal(built.payloads[0].payload.company_name, 'Rain Roofing');
});

test('addLeads posts a bearer token and one destination', async () => {
  let seen;
  const fetchImpl = mockFetch(async (url, init) => {
    seen = { url, init };
    return { status: 200, body: { status: 'success', total_sent: 1, leads_uploaded: 1 } };
  });
  const summary = await instantlyClient.addLeads(
    { INSTANTLY_API_KEY: 'secret-key' },
    {
      campaignId: 'camp-1',
      leads: [{ email: 'ada@spark.example' }],
      fetchImpl,
      idempotencyKey: 'batch-1',
    },
  );
  assert.equal(summary.leads_uploaded, 1);
  assert.equal(seen.url, 'https://api.instantly.ai/api/v2/leads/add');
  assert.equal(seen.init.headers.Authorization, 'Bearer secret-key');
  const body = JSON.parse(seen.init.body);
  assert.equal(body.campaign_id, 'camp-1');
  assert.equal(body.list_id, undefined);
  assert.equal(body.skip_if_in_campaign, true);
  assert.equal(body.verify_leads_on_import, false);
  assert.equal(body.idempotency_key, 'batch-1');
});

test('export skips leads with no email and sums Instantly counts', async () => {
  const marked = [];
  const result = await instantlyExport.exportLeads({
    integrationEnv: { INSTANTLY_API_KEY: 'secret-key' },
    campaignId: 'camp-1',
    leads: [
      { key: 'lead:1', title: 'Spark Electric', email: 'Ada@Spark.example', contactName: 'Ada Lovelace' },
      { key: 'lead:2', title: 'Quiet Handy' },
      { key: 'lead:3', title: 'Spark Again', email: 'ada@spark.example' },
    ],
    client: {
      isConfigured: () => true,
      addLeads: async (_env, payload) => {
        assert.equal(payload.leads.length, 1);
        assert.equal(payload.leads[0].email, 'ada@spark.example');
        return { total_sent: 1, leads_uploaded: 1, duplicated_leads: 0, skipped_count: 0, invalid_email_count: 0, in_blocklist: 0 };
      },
    },
    markLead: async (key, stamp) => {
      marked.push({ key, stamp });
    },
  });
  assert.equal(result.uploaded, 1);
  assert.equal(result.skippedNoEmail, 1);
  assert.equal(result.payloadsSent, 1);
  assert.deepEqual(marked.map((row) => row.key), ['lead:1']);
  assert.equal(marked[0].stamp.instantlyDestinationId, 'camp-1');
});

test('a rejected key surfaces Instantly’s message', async () => {
  const fetchImpl = mockFetch(async () => ({ status: 401, body: { message: 'bad key' } }));
  await assert.rejects(
    () => instantlyClient.listCampaigns({ INSTANTLY_API_KEY: 'nope' }, { fetchImpl, pageLimit: 1, limit: 1 }),
    (err) => err.status === 401 && /bad key/.test(err.message),
  );
});

test('list campaigns follows the cursor', async () => {
  const pages = [];
  const fetchImpl = mockFetch(async (url) => {
    pages.push(url);
    if (!url.includes('starting_after')) {
      return {
        status: 200,
        body: { items: [{ id: 'c1', name: 'One', status: 1 }], next_starting_after: 'c1' },
      };
    }
    return { status: 200, body: { items: [{ id: 'c2', name: 'Two', status: 2 }], next_starting_after: '' } };
  });
  const rows = await instantlyClient.listCampaigns({ INSTANTLY_API_KEY: 'k' }, { fetchImpl, pageLimit: 3, limit: 100 });
  assert.equal(rows.length, 2);
  assert.equal(pages.length, 2);
  assert.match(pages[1], /starting_after=c1/);
  assert.equal(instantlyClient.campaignStatusLabel(1), 'Active');
});
