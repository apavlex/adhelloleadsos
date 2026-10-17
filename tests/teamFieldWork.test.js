const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const teamFieldWork = require('../services/teamFieldWork');

describe('teamFieldWork helpers', () => {
  it('builds photo hrefs for owner rollup', () => {
    assert.equal(
      teamFieldWork.photoHref('partner1', 'jobabc123', 'photo456xyz'),
      '/network/field-work/photos/partner1/jobabc123/photo456xyz',
    );
  });

  it('prefers job notes, then photo caption, then customer notes', () => {
    assert.equal(
      teamFieldWork.latestNote(
        { notes: 'Job site wet', photos: [{ caption: 'Before', createdAt: '2026-01-02' }] },
        { notes: 'Customer note' },
      ),
      'Job site wet',
    );
    assert.equal(
      teamFieldWork.latestNote(
        { notes: '', photos: [{ caption: 'After drywall', createdAt: '2026-01-03' }] },
        { notes: 'Customer note' },
      ),
      'After drywall',
    );
    assert.equal(
      teamFieldWork.latestNote({ notes: '', photos: [] }, { notes: 'Call back Friday' }),
      'Call back Friday',
    );
  });

  it('labels schedule times', () => {
    assert.equal(teamFieldWork.whenLabel({ date: '2099-01-15', time: '14:30' }, '2099-01-14'), 'Tomorrow · 2:30 PM');
    assert.equal(teamFieldWork.whenLabel({ date: '2099-01-14', time: '' }, '2099-01-14'), 'Today');
  });
});

describe('teamFieldWork.listTeamFieldWork', () => {
  it('rolls up open jobs across members and skips closed by default', async () => {
    const work = require('../services/memberWork');
    const origCustomers = work.listCustomers;
    const origJobs = work.listJobs;
    work.listCustomers = async (_net, memberId) => {
      if (memberId === 'm1') return [{ id: 'c1', name: 'Taylor Brooks', notes: 'From referral' }];
      if (memberId === 'm2') return [{ id: 'c2', name: 'Alex Rivera', notes: '' }];
      return [];
    };
    work.listJobs = async (_net, memberId) => {
      if (memberId === 'm1') {
        return [
          {
            id: 'jobopen01',
            customerId: 'c1',
            title: 'Handyman referral',
            status: 'in_progress',
            date: '',
            time: '',
            notes: 'Waiting on parts',
            photos: [{ id: 'ph001abc', caption: 'Kitchen', createdAt: '2026-01-01' }],
            updatedAt: '2026-01-02T00:00:00.000Z',
          },
          {
            id: 'jobdone01',
            customerId: 'c1',
            title: 'Finished paint',
            status: 'completed',
            date: '2026-01-01',
            time: '09:00',
            notes: '',
            photos: [],
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ];
      }
      if (memberId === 'm2') {
        return [
          {
            id: 'jobupcom1',
            customerId: 'c2',
            title: 'Install fence',
            status: 'scheduled',
            date: '2099-06-01',
            time: '10:00',
            notes: '',
            photos: [],
            updatedAt: '2026-01-03T00:00:00.000Z',
          },
        ];
      }
      return [];
    };

    try {
      const rollup = await teamFieldWork.listTeamFieldWork(
        'net1',
        [
          { id: 'm1', companyName: 'Brightline Electric' },
          { id: 'm2', companyName: 'Fence Pros' },
        ],
        {
          today: '2026-05-01',
          view: 'open',
          portalBaseByMember: {
            m1: 'https://example.test/m/token1',
            m2: 'https://example.test/m/token2',
          },
        },
      );
      assert.equal(rollup.rows.length, 2);
      assert.equal(rollup.totals.open, 2);
      assert.equal(rollup.totals.upcoming, 1);
      assert.equal(rollup.totals.membersWithWork, 2);
      assert.equal(rollup.rows[0].title, 'Install fence');
      assert.equal(rollup.rows[0].isUpcoming, true);
      assert.equal(rollup.rows[1].customerName, 'Taylor Brooks');
      assert.equal(rollup.rows[1].latestNote, 'Waiting on parts');
      assert.equal(rollup.rows[1].photos[0].href, '/network/field-work/photos/m1/jobopen01/ph001abc');
      assert.equal(rollup.rows[1].portalJobHref, 'https://example.test/m/token1/customers/jobs/jobopen01');

      const upcomingOnly = await teamFieldWork.listTeamFieldWork(
        'net1',
        [
          { id: 'm1', companyName: 'Brightline Electric' },
          { id: 'm2', companyName: 'Fence Pros' },
        ],
        { today: '2026-05-01', view: 'upcoming' },
      );
      assert.equal(upcomingOnly.rows.length, 1);
      assert.equal(upcomingOnly.rows[0].memberName, 'Fence Pros');

      const all = await teamFieldWork.listTeamFieldWork(
        'net1',
        [
          { id: 'm1', companyName: 'Brightline Electric' },
          { id: 'm2', companyName: 'Fence Pros' },
        ],
        { today: '2026-05-01', view: 'all' },
      );
      assert.equal(all.rows.length, 3);
    } finally {
      work.listCustomers = origCustomers;
      work.listJobs = origJobs;
    }
  });
});
