const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pavlex-emp-'));
process.env.APP_DATA_DIR = tmpDataDir;

const {
  DEFAULT_EMPLOYEE_ID,
  listEmployees,
  getEmployee,
  normalizeEmployeeId,
  resolveEmployeeId,
  directoryEmployees,
} = require('../services/pavlex/pavlexEmployees');
const employeeStore = require('../services/pavlex/pavlexEmployeeStore');
const { resolvePavlexToolLlmChain } = require('../services/pavlex/pavlexLlmConfig');
const { formatHistory } = require('../services/pavlex/pavlexGrokHandoff');

describe('pavlexEmployees', () => {
  it('lists Alex, Grokbot, and directory specialists', () => {
    const list = listEmployees();
    assert.ok(list.length >= 2);
    assert.equal(list[0].id, 'alex');
    assert.ok(list.some((e) => e.id === 'grokbot'));
    assert.equal(DEFAULT_EMPLOYEE_ID, 'alex');
    const fromDir = directoryEmployees();
    assert.ok(fromDir.some((e) => e.id === 'copy-grok'));
    assert.ok(fromDir.some((e) => e.id === 'research-grok'));
    assert.ok(list.some((e) => e.id === 'copy-grok'));
  });

  it('normalizes aliases and unknown ids', () => {
    assert.equal(normalizeEmployeeId('grok'), 'grokbot');
    assert.equal(normalizeEmployeeId('Grok-Bot'), 'grokbot');
    assert.equal(resolveEmployeeId('mystery'), 'alex');
    assert.equal(resolveEmployeeId('copy-grok'), 'copy-grok');
  });

  it('stores workspace custom specialists and prefers them', () => {
    const emp = employeeStore.upsertWorkspaceEmployee('ws_bots', {
      id: 'permit-grok',
      name: 'Permit Grok',
      title: 'Permit hunter',
      family: 'grok',
      identityPrompt: 'You find permit leads.',
    });
    assert.equal(emp.id, 'permit-grok');
    assert.equal(getEmployee('permit-grok', 'ws_bots').name, 'Permit Grok');
    assert.ok(listEmployees('ws_bots').some((e) => e.id === 'permit-grok'));
    assert.equal(employeeStore.deleteWorkspaceEmployee('ws_bots', 'permit-grok'), true);
  });

  it('routes Grok employees through personal xAI then OpenRouter', () => {
    const prev = {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
      XAI_API_KEY: process.env.XAI_API_KEY,
    };
    delete process.env.OPENAI_API_KEY;
    process.env.OPENROUTER_API_KEY = 'or-test';
    delete process.env.XAI_API_KEY;
    try {
      const grok = getEmployee('grokbot');
      const withXai = resolvePavlexToolLlmChain({
        preferredOpenRouterModels: grok.preferredOpenRouterModels,
        preferredXaiModels: grok.preferredXaiModels,
        integrationEnv: { XAI_API_KEY: 'xai-test', OPENROUTER_API_KEY: 'or-test' },
      });
      assert.equal(withXai[0].provider, 'xai');
      assert.equal(withXai[0].model, 'grok-4');
      assert.ok(withXai.some((c) => c.provider === 'openrouter' && c.model === 'x-ai/grok-4'));

      const alex = resolvePavlexToolLlmChain({
        preferredOpenRouterModels: [],
        preferredXaiModels: [],
        integrationEnv: { XAI_API_KEY: 'xai-test', OPENROUTER_API_KEY: 'or-test' },
      });
      assert.equal(alex[0].provider, 'openrouter');
    } finally {
      Object.keys(prev).forEach((k) => {
        if (prev[k] === undefined) delete process.env[k];
        else process.env[k] = prev[k];
      });
    }
  });

  it('formats handoff history', () => {
    const text = formatHistory([
      { role: 'user', content: 'Find designers' },
      { role: 'assistant', content: 'Started a search.' },
    ]);
    assert.match(text, /User: Find designers/);
    assert.match(text, /Assistant: Started a search/);
  });
});
