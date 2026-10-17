/**
 * Owner / manager rollup of every network member's member-app field work
 * (customers, open jobs, photos, notes, upcoming schedule).
 *
 * Data stays per member in memberWork / memberJobMedia; this only assembles
 * a read-only Agency OS view for people who canManage the network.
 */

const work = require('./memberWork');

const VIEWS = ['open', 'upcoming', 'all'];

function memberDisplayName(member) {
  if (!member) return 'Member';
  return String(member.companyName || member.contactName || member.email || 'Member').trim() || 'Member';
}

function dayLabel(date, today) {
  if (!date) return '';
  if (date === today) return 'Today';
  const tomorrow = work.addDays(today, 1);
  if (date === tomorrow) return 'Tomorrow';
  const d = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(d.getTime())) return date;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function timeLabel(time) {
  if (!time) return '';
  const [h, m] = String(time).split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function whenLabel(job, today) {
  return [dayLabel(job.date, today), timeLabel(job.time)].filter(Boolean).join(' · ');
}

function latestNote(job, customer) {
  const jobNote = String((job && job.notes) || '').trim();
  if (jobNote) return jobNote;
  const captions = ((job && job.photos) || [])
    .map((p) => ({ caption: String(p.caption || '').trim(), at: p.createdAt || '' }))
    .filter((p) => p.caption)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  if (captions[0]) return captions[0].caption;
  return String((customer && customer.notes) || '').trim();
}

function photoHref(memberId, jobId, photoId) {
  return `/network/field-work/photos/${encodeURIComponent(memberId)}/${encodeURIComponent(jobId)}/${encodeURIComponent(photoId)}`;
}

function compareFieldRows(a, b) {
  const aUp = a.isUpcoming ? 0 : 1;
  const bUp = b.isUpcoming ? 0 : 1;
  if (aUp !== bUp) return aUp - bUp;
  const ad = a.date || '9999-99-99';
  const bd = b.date || '9999-99-99';
  if (ad !== bd) return ad < bd ? -1 : 1;
  const at = a.time || '99:99';
  const bt = b.time || '99:99';
  if (at !== bt) return at < bt ? -1 : 1;
  return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
}

/**
 * @param {string} networkId
 * @param {object[]} members
 * @param {{ today?: string, view?: string, memberId?: string, status?: string, portalBaseByMember?: Record<string,string> }} [opts]
 */
async function listTeamFieldWork(networkId, members, opts = {}) {
  const today = opts.today || work.todayIn();
  const view = VIEWS.includes(opts.view) ? opts.view : 'open';
  const filterMemberId = String(opts.memberId || '').trim();
  const filterStatus = String(opts.status || '').trim();
  const portalBaseByMember = opts.portalBaseByMember || {};
  const list = Array.isArray(members) ? members : [];

  const rows = [];
  let photoCount = 0;
  let upcomingCount = 0;
  const membersWithOpen = new Set();

  for (const member of list) {
    if (!member || !member.id) continue;
    if (filterMemberId && member.id !== filterMemberId) continue;
    let customers = [];
    let jobs = [];
    try {
      [customers, jobs] = await Promise.all([
        work.listCustomers(networkId, member.id),
        work.listJobs(networkId, member.id),
      ]);
    } catch (err) {
      console.warn('[teamFieldWork] skip member', member.id, err && err.message);
      continue;
    }
    const byId = Object.fromEntries(customers.map((c) => [c.id, c]));
    const portalBase = portalBaseByMember[member.id] || '';

    for (const job of jobs) {
      const open = work.isOpen(job);
      const isUpcoming = !!(open && job.date && job.date >= today);
      if (view === 'open' && !open) continue;
      if (view === 'upcoming' && !isUpcoming) continue;
      if (filterStatus && job.status !== filterStatus) continue;

      const customer = byId[job.customerId] || {};
      const photosMeta = Array.isArray(job.photos) ? job.photos : [];
      photoCount += photosMeta.length;
      if (open) membersWithOpen.add(member.id);
      if (isUpcoming) upcomingCount += 1;

      const photos = photosMeta.slice(0, 4).map((p) => ({
        id: p.id,
        caption: String(p.caption || '').trim(),
        createdAt: p.createdAt || '',
        href: photoHref(member.id, job.id, p.id),
      }));

      rows.push({
        memberId: member.id,
        memberName: memberDisplayName(member),
        memberContact: String(member.contactName || '').trim(),
        customerId: customer.id || job.customerId || '',
        customerName: String(customer.name || 'Customer').trim() || 'Customer',
        customerPhone: String(customer.phone || '').trim(),
        jobId: job.id,
        title: String(job.title || 'Job').trim() || 'Job',
        status: job.status,
        statusLabel: work.JOB_STATUS_LABELS[job.status] || job.status,
        date: job.date || '',
        time: job.time || '',
        whenLabel: whenLabel(job, today),
        notes: String(job.notes || '').trim(),
        latestNote: latestNote(job, customer),
        photoCount: photosMeta.length,
        photos,
        updatedAt: job.updatedAt || '',
        overdue: !!(job.date && today && job.date < today && open && job.status !== 'on_hold'),
        isOpen: open,
        isUpcoming,
        portalJobHref: portalBase
          ? `${portalBase}/customers/jobs/${encodeURIComponent(job.id)}`
          : '',
        portalCustomerHref: portalBase && (customer.id || job.customerId)
          ? `${portalBase}/customers/${encodeURIComponent(customer.id || job.customerId)}`
          : '',
      });
    }
  }

  rows.sort(compareFieldRows);

  return {
    today,
    view,
    rows,
    totals: {
      jobs: rows.length,
      open: rows.filter((r) => r.isOpen).length,
      upcoming: upcomingCount,
      photos: photoCount,
      membersWithWork: membersWithOpen.size,
    },
  };
}

module.exports = {
  VIEWS,
  listTeamFieldWork,
  memberDisplayName,
  whenLabel,
  latestNote,
  photoHref,
};
