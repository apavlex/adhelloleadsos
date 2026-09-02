const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isAuditCadenceTemplate } = require('../services/sequenceTemplates');
const {
  workspaceAllowsAuditCadence,
  filterTemplatesForWorkspace,
} = require('../services/auditCadenceGuard');
const { recommendCadenceTemplate } = require('../services/leadCadence');

const agencyWs = { name: 'AdHello Agency', salesScriptsPresetKey: 'agency' };
const flooringWs = { name: 'TPR Flooring', salesScriptsPresetKey: 'retail_install' };

test('isAuditCadenceTemplate matches audit and auto_outreach templates', () => {
  assert.equal(isAuditCadenceTemplate('audit_local_14'), true);
  assert.equal(isAuditCadenceTemplate('audit_hot_5'), true);
  assert.equal(isAuditCadenceTemplate('auto_outreach_7'), true);
  assert.equal(isAuditCadenceTemplate('clay_standard'), false);
  assert.equal(isAuditCadenceTemplate('bob_standard'), false);
});

test('workspaceAllowsAuditCadence only true for agency sales workspaces', () => {
  assert.equal(workspaceAllowsAuditCadence(agencyWs), true);
  assert.equal(workspaceAllowsAuditCadence(flooringWs), false);
});

test('filterTemplatesForWorkspace hides audit playbooks for non-agency', () => {
  const templates = [
    { id: 'audit_local_14', name: 'Audit 14' },
    { id: 'clay_standard', name: 'Clay' },
  ];
  const agencyList = filterTemplatesForWorkspace(templates, agencyWs);
  const flooringList = filterTemplatesForWorkspace(templates, flooringWs);
  assert.equal(agencyList.length, 2);
  assert.equal(flooringList.length, 1);
  assert.equal(flooringList[0].id, 'clay_standard');
});

test('recommendCadenceTemplate uses audit_local_14 for agency trade leads', () => {
  const lead = { categoryName: 'HVAC contractor', source: 'maps' };
  const rec = recommendCadenceTemplate(lead, [], { workspace: agencyWs });
  assert.equal(rec.templateId, 'audit_local_14');
});

test('recommendCadenceTemplate avoids audit templates for flooring workspace', () => {
  const lead = { categoryName: 'HVAC contractor', source: 'maps' };
  const rec = recommendCadenceTemplate(lead, [], { workspace: flooringWs });
  assert.equal(rec.templateId, 'clay_standard');
  assert.equal(isAuditCadenceTemplate(rec.templateId), false);
});

test('recommendCadenceTemplate avoids audit_hot_5 for non-agency warm inbound', () => {
  const lead = { categoryName: 'Restaurant', source: 'adhello_audit' };
  const rec = recommendCadenceTemplate(lead, [], { workspace: flooringWs });
  assert.equal(rec.templateId, 'clay_standard');
});
