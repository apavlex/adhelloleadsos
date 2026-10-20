const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

describe('trial switcher badge UI', () => {
  it('workspace switcher renders Trial / Expired / Active badges', () => {
    const ejs = fs.readFileSync(
      path.join(ROOT, 'views/partials/workspace_switcher_menu.ejs'),
      'utf8',
    );
    assert.match(ejs, /trialState === 'trial'/);
    assert.match(ejs, /trialState === 'expired'/);
    assert.match(ejs, /trialLabel/);
  });

  it('workspace Advanced exposes Activate account for platform admins', () => {
    const ejs = fs.readFileSync(
      path.join(ROOT, 'views/workspace/sections/advanced.ejs'),
      'utf8',
    );
    assert.match(ejs, /Activate account/);
    assert.match(ejs, /value="activate"/);
  });

  it('network members expose Activate account for trial app members', () => {
    const ejs = fs.readFileSync(path.join(ROOT, 'views/network.ejs'), 'utf8');
    assert.match(ejs, /activate-plan/);
    assert.match(ejs, /Activate account/);
  });
});
