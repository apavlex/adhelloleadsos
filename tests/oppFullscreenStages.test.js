/**
 * Board fullscreen must show every stage — not trap the user in one-stage zoom.
 */
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');

test('entering opportunity board fullscreen closes one-stage zoom', () => {
  const js = fs.readFileSync(path.join(root, 'public/js/opportunities-board.js'), 'utf8');
  const setFs = js.slice(js.indexOf('function setFullscreen'), js.indexOf('function setFullscreen') + 500);
  assert.match(setFs, /closeStageZoom/);
  assert.match(setFs, /opp-fullscreen/);
});

test('desktop stage zoom keeps a single readable column (not a dense name grid)', () => {
  const css = fs.readFileSync(path.join(root, 'views/partials/opportunity_board.ejs'), 'utf8');
  assert.match(css, /\.opp-stage\.is-zoomed \.opp-stage-cards[\s\S]*?flex-direction:\s*column/);
  assert.doesNotMatch(
    css,
    /\.opp-stage\.is-zoomed \.opp-stage-cards[\s\S]*?grid-template-columns:\s*repeat\(auto-fill/,
  );
});
