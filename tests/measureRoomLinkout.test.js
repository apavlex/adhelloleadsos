/**
 * Measure room link-out: native Measure / AR apps → attach screenshot + note.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

describe('measure room link-out', () => {
  it('exposes a measure icon and sheet on job, customer, and quote', () => {
    const icons = fs.readFileSync(path.join(root, 'services/memberAppIcons.js'), 'utf8');
    assert.match(icons, /measure:\s*icon\(/);

    const partial = fs.readFileSync(path.join(root, 'views/member_app/_measure_room.ejs'), 'utf8');
    assert.match(partial, /data-ma-measure-open/);
    assert.match(partial, /data-ma-measure-launch/);
    assert.match(partial, /data-ma-measure-attach/);
    assert.match(partial, /data-ma-measure-chip/);
    assert.match(partial, /Attach screenshot/);

    for (const view of ['job.ejs', 'customer.ejs', 'quote.ejs']) {
      const html = fs.readFileSync(path.join(root, 'views/member_app', view), 'utf8');
      assert.match(html, /_measure_room/, view);
    }
  });

  it('JS opens platform measure apps and reuses photo capture', () => {
    const js = fs.readFileSync(path.join(root, 'public/js/member-app.js'), 'utf8');
    assert.match(js, /function initMeasureRoom/);
    assert.match(js, /initMeasureRoom\(\)/);
    assert.match(js, /iPad\|iPhone\|iPod/);
    assert.match(js, /Android/);
    assert.match(js, /magicplan/);
    assert.match(js, /support\.apple\.com/);
    assert.match(js, /data-ma-photo-open/);
    assert.match(js, /_maMeasureNotePrefix|Measure · /);
  });
});
