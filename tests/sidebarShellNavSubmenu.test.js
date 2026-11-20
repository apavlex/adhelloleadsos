const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const shellSrc = fs.readFileSync(path.join(__dirname, '..', 'public/js/sidebarShell.js'), 'utf8');
const cssSrc = fs.readFileSync(path.join(__dirname, '..', 'public/css/custom.css'), 'utf8');

describe('sidebarShell nav submenus → second bar', () => {
  it('opens Settings / Leads / Add New into the context second bar', () => {
    assert.match(shellSrc, /function openNavSubmenu/);
    assert.match(shellSrc, /nav-submenu-open/);
    assert.match(shellSrc, /openNavSubmenu\('settings'/);
    assert.match(shellSrc, /function openLeadsSubmenu/);
    assert.match(shellSrc, /function openAddNewSubmenu/);
  });

  it('hides collapsed flyout menus instead of floating them', () => {
    assert.match(
      cssSrc,
      /body\.app-with-sidebar\.sidebar-collapsed \.sidebar-settings-menu\s*\{\s*display:\s*none\s*!important;/
    );
    assert.match(
      cssSrc,
      /body\.app-with-sidebar\.sidebar-collapsed \.sidebar-leads-sub\s*\{\s*display:\s*none\s*!important;/
    );
    assert.match(
      cssSrc,
      /body\.app-with-sidebar\.sidebar-collapsed \.sidebar-new-menu\s*\{\s*display:\s*none\s*!important;/
    );
    assert.doesNotMatch(
      cssSrc,
      /sidebar-collapsed \.sidebar-settings-menu:not\(\.hidden\)\s*\{\s*position:\s*absolute/
    );
  });

  it('shows the second bar when a nav submenu is open', () => {
    assert.match(cssSrc, /body\.app-with-sidebar\.nav-submenu-open/);
    assert.match(cssSrc, /nav-submenu-open #appContextSidebar/);
  });
});
