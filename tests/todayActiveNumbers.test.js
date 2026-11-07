/**
 * Today active numbers: Lead and Team stay closed until opened.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const cheerio = require('cheerio');

const partial = path.join(__dirname, '../views/partials/today_active_numbers.ejs');

function render(locals) {
  return ejs.renderFile(partial, locals);
}

describe('today active numbers', () => {
  it('keeps lead and team closed and only shows the open count until cards open', async () => {
    const html = await render({
      leadRows: [
        { key: 'website', label: 'Website', count: 1, href: '/appointments', hint: '1 inbound' },
        { key: 'agency', label: 'Agency', count: 0, href: '/appointments', hint: 'Assigned out' },
        { key: 'referral', label: 'Referrals', count: 2, href: '/network', hint: 'Network' },
        { key: 'purchased', label: 'Purchased', count: 4, href: '/appointments', hint: 'Appts left' },
      ],
      teamRows: [
        { id: 'today', label: 'Today', count: 2, hint: 'jobs on calendar', href: '/network?tab=calendar' },
        { id: 'overdue', label: 'Overdue', count: 1, hint: 'need a status update', href: '/network?tab=field-work' },
        { id: 'open', label: 'Open', count: 5, hint: '2 members', href: '/network?tab=field-work&fw=open' },
        { id: 'week', label: 'This week', count: 3, hint: 'scheduled ahead', href: '/network?tab=calendar' },
      ],
    });
    const $ = cheerio.load(html);
    const groups = $('details[data-source-kind]');
    assert.equal(groups.length, 2);
    assert.equal($('details[open]').length, 0);
    assert.equal($('ul.divide-y').length, 1);

    const lead = $('details[data-source-kind="lead"]');
    const team = $('details[data-source-kind="team"]');
    assert.equal(lead.find('[data-open-count]').attr('data-open-count'), '7');
    assert.equal(team.find('[data-open-count]').attr('data-open-count'), '5');
    assert.match(lead.attr('class'), /today-sources/);
    assert.doesNotMatch(lead.attr('class') || '', /is-hot/);
    assert.doesNotMatch(team.attr('class') || '', /is-hot/);
    const overdueCard = team.find('a').filter(function (_, el) {
      return /Overdue/.test($(el).text());
    });
    assert.equal(overdueCard.length, 1);
    assert.match(overdueCard.attr('class'), /border-brand-border/);
    assert.doesNotMatch(overdueCard.attr('class') || '', /border-rose/);

    const leadSummary = lead.find('summary').text().replace(/\s+/g, ' ');
    assert.match(leadSummary, /Lead/);
    assert.match(leadSummary, /7\s*open/);
    assert.doesNotMatch(leadSummary, /Website/);
    assert.doesNotMatch(leadSummary, /inbound/);
    assert.equal(lead.find('summary a').length, 0);
    assert.match(lead.find('a').text(), /1 inbound/);
    assert.match(lead.find('a').text(), /Website/i);

    const teamSummary = team.find('summary').text().replace(/\s+/g, ' ');
    assert.match(teamSummary, /Team/);
    assert.match(teamSummary, /5\s*open/);
    assert.doesNotMatch(teamSummary, /Overdue/);
    assert.doesNotMatch(teamSummary, /scheduled ahead/);
    assert.match(team.find('a[href*="fw=open"]').text(), /2 members/);
  });

  it('renders nothing when both groups are empty', async () => {
    const html = await render({ leadRows: [], teamRows: [] });
    const $ = cheerio.load(html);
    assert.equal($('details').length, 0);
    assert.equal($('section').length, 0);
  });

  it('renders a single group when the other has no stages', async () => {
    const html = await render({
      leadRows: [{ label: 'Website', count: 0, href: '/appointments', hint: 'Form fills' }],
      teamRows: [],
    });
    const $ = cheerio.load(html);
    assert.equal($('details').length, 1);
    assert.equal($('details').attr('data-source-kind'), 'lead');
    assert.equal($('[data-open-count]').attr('data-open-count'), '0');
    assert.match($('summary').text().replace(/\s+/g, ' '), /0\s*open/);
  });

  it('is the markup Today injects for the deferred active-numbers slot', () => {
    const view = fs.readFileSync(path.join(__dirname, '../views/today.ejs'), 'utf8');
    const route = fs.readFileSync(path.join(__dirname, '../routes/today.js'), 'utf8');
    assert.match(view, /partials\/today_active_numbers/);
    assert.match(view, /data\.activeNumbersHtml/);
    assert.doesNotMatch(view, /today-sources\.is-hot/);
    assert.doesNotMatch(view, /need attention/);
    assert.match(route, /activeNumbersHtml/);
    assert.match(route, /partials\/today_active_numbers/);
  });
});
