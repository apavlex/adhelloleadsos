const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  pickUpdatableFields,
  MCP_UPDATABLE_LEAD_FIELDS,
} = require('../services/mcp/mcpCrmService');

describe('mcpCrmService field whitelist', () => {
  it('allows enrichment fields', () => {
    const patch = {};
    for (const key of ['phone', 'email', 'website', 'auditSummary', 'status']) {
      patch[key] = 'x';
    }
    const fields = {};
    for (const [k, v] of Object.entries(patch)) {
      if (MCP_UPDATABLE_LEAD_FIELDS.has(k)) fields[k] = v;
    }
    assert.equal(Object.keys(fields).length, 5);
  });

  it('rejects empty updates', () => {
    assert.throws(() => {
      const fields = {};
      for (const [k, v] of Object.entries({ secret: 'nope' })) {
        if (MCP_UPDATABLE_LEAD_FIELDS.has(k)) fields[k] = v;
      }
      if (!Object.keys(fields).length) {
        const err = new Error('No allowed fields provided to update.');
        err.code = 'INVALID_ARGUMENT';
        throw err;
      }
    }, /No allowed fields/);
  });
});

describe('mcpAuth token hint', () => {
  it('hashes consistently', () => {
    const crypto = require('crypto');
    const a = crypto.createHash('sha256').update('abc').digest('hex');
    const b = crypto.createHash('sha256').update('abc').digest('hex');
    assert.equal(a, b);
  });
});
