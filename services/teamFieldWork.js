/**
 * Owner / manager rollup of every network member's member-app field work
 * (customers, open jobs, photos, notes, upcoming schedule).
 *
 * Data stays per member in memberWork / memberJobMedia; this only assembles
 * a read-only Agency OS view for people who canManage the network.
 */

const work = require('./memberWork');

const VIEWS = ['open', 'upcoming', 'today', 'day', 'calendar', 'all'];

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

/** Same empty-when-zero style as the Reviews app job list. */
function valueLabel(value) {
  const n = Number(value) || 0;
  if (!n) return '';
  return `$${Math.round(n).toLocaleString('en-US')}`;
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

/** In-workspace owner/manager job page (not the member Reviews-app portal). */
function ownerJobHref(memberId, jobId) {
  return `/network/field-work/jobs/${encodeURIComponent(memberId)}/${encodeURIComponent(jobId)}`;
}

/** In-workspace owner/manager customer page. */
function ownerCustomerHref(memberId, customerId) {
  return `/network/field-work/customers/${encodeURIComponent(memberId)}/${encodeURIComponent(customerId)}`;
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

/** Pipeline rank — higher means further along (prefer Estimate over Lead twin). */
function statusRank(status) {
  const i = work.PIPELINE.indexOf(String(status || ''));
  return i >= 0 ? i : -1;
}

/** Display label for a job's day/time (or Unscheduled). */
function scheduleLabel(row) {
  const label = String((row && (row.whenLabel || row.dayLabel)) || '').trim();
  return label || 'Unscheduled';
}

/**
 * Prefer further-along / richer twin. Returns true when `row` should replace `prev`.
 */
function preferFieldRow(row, prev) {
  const rankDiff = statusRank(row.status) - statusRank(prev.status);
  if (rankDiff > 0) return true;
  if (rankDiff < 0) return false;
  // Prefer a dated schedule over an undated twin when status ties.
  const rowDated = !!(row.date);
  const prevDated = !!(prev.date);
  if (rowDated !== prevDated) return rowDated;
  const photoDiff = (Number(row.photoCount) || 0) - (Number(prev.photoCount) || 0);
  if (photoDiff > 0) return true;
  if (photoDiff < 0) return false;
  return String(row.updatedAt || '') > String(prev.updatedAt || '');
}

/**
 * Merge schedule labels + photo hints from a discarded twin onto the kept card.
 */
function mergeTwinOnto(winner, twin) {
  const labels = [];
  const seen = new Set();
  function pushLabel(raw) {
    const label = String(raw || '').trim() || 'Unscheduled';
    const key = label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    labels.push(label);
  }
  (winner.dateLabels || [scheduleLabel(winner)]).forEach(pushLabel);
  (twin.dateLabels || [scheduleLabel(twin)]).forEach(pushLabel);

  const photos = [...(Array.isArray(winner.photos) ? winner.photos : [])];
  const photoIds = new Set(photos.map((p) => p && p.id).filter(Boolean));
  for (const p of (Array.isArray(twin.photos) ? twin.photos : [])) {
    if (!p || (p.id && photoIds.has(p.id))) continue;
    if (p.id) photoIds.add(p.id);
    photos.push(p);
  }
  const photoCount = Math.max(
    Number(winner.photoCount) || 0,
    Number(twin.photoCount) || 0,
    photos.length,
  );
  const latestNote = winner.latestNote || twin.latestNote || '';
  const overdue = !!(winner.overdue || twin.overdue);

  return {
    ...winner,
    dateLabels: labels,
    // Primary when stays the winner's schedule; extras render under it.
    photos: photos.slice(0, 4),
    photoCount,
    latestNote,
    overdue,
  };
}

/**
 * Prefer further-along / richer twin; on a true tie keep the shared *copy*
 * (recipient) so Leads Network shows the teammate who received the lead.
 */
function preferSharedFieldRow(row, prev) {
  if (preferFieldRow(row, prev)) return true;
  if (preferFieldRow(prev, row)) return false;
  const rowCopy = !!(row.sharedFromMemberId && row.sharedFromJobId);
  const prevCopy = !!(prev.sharedFromMemberId && prev.sharedFromJobId);
  if (rowCopy !== prevCopy) return rowCopy;
  return false;
}

function jobRefKey(memberId, jobId) {
  const mid = String(memberId || '').trim();
  const jid = String(jobId || '').trim();
  if (!mid || !jid) return '';
  return `${mid}\0${jid}`;
}

/**
 * Collapse a shared original + teammate copy into one Leads Network card.
 * Share linkage wins over same-name coincidence across unrelated members.
 */
function collapseSharedAcrossMembers(rows) {
  const list = Array.isArray(rows) ? rows.map((r) => ({ ...r })) : [];
  const byRef = new Map();
  for (const row of list) {
    const key = jobRefKey(row.memberId, row.jobId);
    if (key) byRef.set(key, row);
  }

  const pairs = [];
  const paired = new Set();
  for (const row of list) {
    const fromKey = jobRefKey(row.sharedFromMemberId, row.sharedFromJobId);
    if (!fromKey || paired.has(row)) continue;
    const source = byRef.get(fromKey);
    if (!source || source === row) continue;
    pairs.push([source, row]);
    paired.add(source);
    paired.add(row);
  }
  // Source.sharedWith → copy when the copy forgot sharedFrom* somehow.
  for (const row of list) {
    if (paired.has(row)) continue;
    const peers = Array.isArray(row.sharedWith) ? row.sharedWith : [];
    for (const peer of peers) {
      const copy = byRef.get(jobRefKey(peer && peer.memberId, peer && peer.jobId));
      if (!copy || copy === row || paired.has(copy)) continue;
      pairs.push([row, copy]);
      paired.add(row);
      paired.add(copy);
      break;
    }
  }

  const drop = new Set();
  const winners = [];
  for (const [source, copy] of pairs) {
    const keepCopy = preferSharedFieldRow(copy, source);
    const winner = mergeTwinOnto(keepCopy ? copy : source, keepCopy ? source : copy);
    drop.add(source);
    drop.add(copy);
    winners.push(winner);
  }
  return list.filter((row) => !drop.has(row)).concat(winners);
}

/**
 * Collapse same-teammate + same customer name + same title twins (Lead vs
 * Scheduled, etc.), then collapse share-linked originals + teammate copies so
 * Leads Network doesn't list Zimmerman twice after a share.
 */
function dedupeFieldRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const best = new Map();
  for (const row of list) {
    // Key on customer *name* (not id) so a shared copy and an original book
    // for "Zimmerman" collapse even when customerIds differ.
    const key = [
      String(row.memberId || ''),
      String(row.customerName || row.customerId || '').trim().toLowerCase(),
      String(row.title || '').trim().toLowerCase(),
    ].join('\0');
    const seeded = {
      ...row,
      dateLabels: Array.isArray(row.dateLabels) && row.dateLabels.length
        ? row.dateLabels
        : [scheduleLabel(row)],
    };
    const prev = best.get(key);
    if (!prev) {
      best.set(key, seeded);
      continue;
    }
    if (preferFieldRow(seeded, prev)) {
      best.set(key, mergeTwinOnto(seeded, prev));
    } else {
      best.set(key, mergeTwinOnto(prev, seeded));
    }
  }
  return collapseSharedAcrossMembers(Array.from(best.values()));
}

/**
 * Drop shared teammate copies from rollup counts when the source job is also
 * present — same rule as the Open jobs list.
 */
function filterSharedJobDupesForTotals(allJobs) {
  const list = Array.isArray(allJobs) ? allJobs : [];
  const byRef = new Map();
  for (const item of list) {
    const key = jobRefKey(item && item.memberId, item && item.job && item.job.id);
    if (key) byRef.set(key, item);
  }
  const drop = new Set();
  for (const item of list) {
    const job = item && item.job;
    if (!job) continue;
    const fromKey = jobRefKey(job.sharedFromMemberId, job.sharedFromJobId);
    if (!fromKey) continue;
    const source = byRef.get(fromKey);
    if (!source || source === item) continue;
    // Prefer counting the richer / further-along job once.
    const copyRow = {
      status: job.status,
      date: job.date,
      photoCount: Array.isArray(job.photos) ? job.photos.length : 0,
      updatedAt: job.updatedAt,
      sharedFromMemberId: job.sharedFromMemberId,
      sharedFromJobId: job.sharedFromJobId,
    };
    const sourceJob = source.job || {};
    const sourceRow = {
      status: sourceJob.status,
      date: sourceJob.date,
      photoCount: Array.isArray(sourceJob.photos) ? sourceJob.photos.length : 0,
      updatedAt: sourceJob.updatedAt,
      sharedFromMemberId: sourceJob.sharedFromMemberId,
      sharedFromJobId: sourceJob.sharedFromJobId,
    };
    drop.add(preferSharedFieldRow(copyRow, sourceRow) ? source : item);
  }
  return list.filter((item) => !drop.has(item));
}

function cleanDay(value, fallback) {
  const d = work.cleanDate(value);
  return d || fallback || work.todayIn();
}

function cleanMonth(value, today) {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  return String(today || work.todayIn()).slice(0, 7);
}

/**
 * Load every member's customers + jobs once (shared by list + summarize).
 * @returns {Promise<{ member: object, customers: object[], jobs: object[] }[]>}
 */
async function loadMemberBooks(networkId, members) {
  const list = Array.isArray(members) ? members : [];
  const out = [];
  for (const member of list) {
    if (!member || !member.id) continue;
    try {
      const [customers, jobs] = await Promise.all([
        work.listCustomers(networkId, member.id),
        work.listJobs(networkId, member.id),
      ]);
      out.push({ member, customers, jobs });
    } catch (err) {
      console.warn('[teamFieldWork] skip member', member.id, err && err.message);
    }
  }
  return out;
}

function buildActiveNumbers(totals) {
  return [
    {
      id: 'today',
      label: 'Today',
      count: totals.today,
      hint: totals.today === 1 ? 'job on calendar' : 'jobs on calendar',
      href: '/network?tab=calendar',
    },
    {
      id: 'overdue',
      label: 'Overdue',
      count: totals.overdue,
      hint: totals.overdue ? 'need a status update' : 'none behind',
      href: '/network?tab=field-work&fw=open&jobStatus=in_progress',
    },
    {
      id: 'open',
      label: 'Open',
      count: totals.open,
      hint: totals.membersWithWork
        ? `${totals.membersWithWork} member${totals.membersWithWork === 1 ? '' : 's'}`
        : 'projects in flight',
      href: '/network?tab=field-work&fw=open',
    },
    {
      id: 'week',
      label: 'This week',
      count: totals.thisWeek,
      hint: 'scheduled ahead',
      href: '/network?tab=calendar',
    },
  ];
}

function computeTotals(allJobs, today) {
  const { start, end } = work.weekRange(today);
  let open = 0;
  let upcoming = 0;
  let todayCount = 0;
  let overdue = 0;
  let thisWeek = 0;
  let photos = 0;
  let leads = 0;
  let dealsWon = 0;
  let openValue = 0;
  let wonValue = 0;
  const membersWithOpen = new Set();
  const membersWithLeads = new Set();

  const counted = filterSharedJobDupesForTotals(allJobs);
  counted.forEach(({ memberId, job }) => {
    const isOpen = work.isOpen(job);
    const value = Number(job.value) || 0;
    photos += (job.photos || []).length;
    if (job.status === 'lead') {
      leads += 1;
      membersWithLeads.add(memberId);
    }
    // Project value tracks open + completed jobs (not cancelled), so editing
    // Value $ on an open Reviews-app job updates Leads Network Active Numbers.
    if (job.status === 'completed') {
      dealsWon += 1;
      wonValue += value;
    } else if (isOpen) {
      openValue += value;
    }
    if (!isOpen) return;
    open += 1;
    membersWithOpen.add(memberId);
    if (job.date && job.date >= today) upcoming += 1;
    if (job.date === today) todayCount += 1;
    if (job.date && job.date < today && job.status !== 'on_hold') overdue += 1;
    if (job.date && job.date >= start && job.date <= end) thisWeek += 1;
  });

  return {
    open,
    upcoming,
    today: todayCount,
    overdue,
    thisWeek,
    photos,
    membersWithWork: membersWithOpen.size,
    membersWithLeads: membersWithLeads.size,
    leads,
    dealsWon,
    openValue,
    wonValue,
    dealsValue: openValue + wonValue,
    jobs: counted.length,
  };
}

/**
 * Lightweight summary for Home + Network active-number strips.
 */
async function summarizeTeamFieldWork(networkId, members, opts = {}) {
  const today = opts.today || work.todayIn();
  const books = await loadMemberBooks(networkId, members);
  const allJobs = [];
  books.forEach(({ member, jobs }) => {
    (jobs || []).forEach((job) => allJobs.push({ memberId: member.id, job }));
  });
  const totals = computeTotals(allJobs, today);
  return {
    today,
    totals,
    sources: buildActiveNumbers(totals),
    needAttention: totals.today + totals.overdue,
  };
}

/**
 * @param {string} networkId
 * @param {object[]} members
 * @param {{ today?: string, view?: string, day?: string, month?: string, memberId?: string, status?: string, portalBaseByMember?: Record<string,string> }} [opts]
 */
async function listTeamFieldWork(networkId, members, opts = {}) {
  const today = opts.today || work.todayIn();
  const view = VIEWS.includes(opts.view) ? opts.view : 'open';
  const selectedDay = cleanDay(opts.day, today);
  const month = cleanMonth(opts.month, selectedDay);
  const filterMemberId = String(opts.memberId || '').trim();
  const filterStatus = String(opts.status || '').trim();
  const portalBaseByMember = opts.portalBaseByMember || {};

  const books = await loadMemberBooks(
    networkId,
    filterMemberId ? (members || []).filter((m) => m && m.id === filterMemberId) : members,
  );

  const flatJobs = [];
  books.forEach(({ member, jobs }) => {
    (jobs || []).forEach((job) => flatJobs.push({ memberId: member.id, job }));
  });
  const totals = computeTotals(flatJobs, today);

  const calendarJobs = [];
  books.forEach(({ jobs }) => {
    (jobs || []).forEach((job) => {
      if (filterStatus && job.status !== filterStatus) return;
      calendarJobs.push(job);
    });
  });
  const calendar = work.monthGrid(month, calendarJobs, { today, selected: selectedDay });

  const rows = [];
  for (const { member, customers, jobs } of books) {
    const byId = Object.fromEntries(customers.map((c) => [c.id, c]));
    const portalBase = portalBaseByMember[member.id] || '';

    for (const job of jobs) {
      const open = work.isOpen(job);
      const isUpcoming = !!(open && job.date && job.date >= today);
      const isToday = !!(open && job.date === today);

      if (view === 'open' && !open) continue;
      if (view === 'upcoming' && !isUpcoming) continue;
      if (view === 'today' && job.date !== today) continue;
      if ((view === 'day' || view === 'calendar') && job.date !== selectedDay) continue;
      if (view === 'all') {
        /* keep */
      } else if (!['open', 'upcoming', 'today', 'day', 'calendar'].includes(view) && !open) {
        continue;
      }
      if (filterStatus && job.status !== filterStatus) continue;

      const customer = byId[job.customerId] || {};
      const photosMeta = Array.isArray(job.photos) ? job.photos : [];
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
        dayLabel: dayLabel(job.date, today),
        timeLabel: timeLabel(job.time),
        notes: String(job.notes || '').trim(),
        latestNote: latestNote(job, customer),
        value: Number(job.value) || 0,
        valueLabel: valueLabel(job.value),
        photoCount: photosMeta.length,
        photos,
        updatedAt: job.updatedAt || '',
        overdue: !!(job.date && today && job.date < today && open && job.status !== 'on_hold'),
        isOpen: open,
        isUpcoming,
        isToday,
        sharedFromMemberId: String(job.sharedFromMemberId || '').trim(),
        sharedFromJobId: String(job.sharedFromJobId || '').trim(),
        sharedWith: Array.isArray(job.sharedWith) ? job.sharedWith : [],
        ownerJobHref: ownerJobHref(member.id, job.id),
        ownerCustomerHref: (customer.id || job.customerId)
          ? ownerCustomerHref(member.id, customer.id || job.customerId)
          : '',
        portalJobHref: portalBase
          ? `${portalBase}/customers/jobs/${encodeURIComponent(job.id)}`
          : '',
        portalCustomerHref: portalBase && (customer.id || job.customerId)
          ? `${portalBase}/customers/c/${encodeURIComponent(customer.id || job.customerId)}`
          : '',
      });
    }
  }

  const deduped = dedupeFieldRows(rows);
  deduped.sort(compareFieldRows);

  return {
    today,
    view,
    day: selectedDay,
    dayHeading: dayLabel(selectedDay, today) || selectedDay,
    month,
    calendar,
    rows: deduped,
    totals: {
      ...totals,
      showing: deduped.length,
    },
    sources: buildActiveNumbers(totals),
  };
}

/**
 * Load one teammate job for the owner/manager workspace view.
 * @returns {Promise<object|null>}
 */
async function getFieldWorkJob(networkId, member, jobId, opts = {}) {
  if (!member || !member.id || !jobId) return null;
  const job = await work.getJob(networkId, member.id, jobId);
  if (!job) return null;
  const customer = job.customerId
    ? (await work.getCustomer(networkId, member.id, job.customerId)) || {}
    : {};
  const today = opts.today || work.todayIn();
  const portalBase = opts.portalBase || '';
  const photosMeta = Array.isArray(job.photos) ? job.photos : [];
  const photos = photosMeta.map((p) => ({
    id: p.id,
    caption: String(p.caption || '').trim(),
    createdAt: p.createdAt || '',
    href: photoHref(member.id, job.id, p.id),
  }));
  const open = work.isOpen(job);
  return {
    memberId: member.id,
    memberName: memberDisplayName(member),
    memberContact: String(member.contactName || '').trim(),
    customerId: customer.id || job.customerId || '',
    customerName: String(customer.name || 'Customer').trim() || 'Customer',
    customerPhone: String(customer.phone || '').trim(),
    customerEmail: String(customer.email || '').trim(),
    customerAddress: String(customer.address || '').trim(),
    customerNotes: String(customer.notes || '').trim(),
    jobId: job.id,
    title: String(job.title || 'Job').trim() || 'Job',
    status: job.status,
    statusLabel: work.JOB_STATUS_LABELS[job.status] || job.status,
    date: job.date || '',
    time: job.time || '',
    whenLabel: whenLabel(job, today),
    notes: String(job.notes || '').trim(),
    latestNote: latestNote(job, customer),
    value: Number(job.value) || 0,
    valueLabel: valueLabel(job.value),
    photoCount: photosMeta.length,
    photos,
    overdue: !!(job.date && today && job.date < today && open && job.status !== 'on_hold'),
    ownerJobHref: ownerJobHref(member.id, job.id),
    ownerCustomerHref: (customer.id || job.customerId)
      ? ownerCustomerHref(member.id, customer.id || job.customerId)
      : '',
    portalJobHref: portalBase
      ? `${portalBase}/customers/jobs/${encodeURIComponent(job.id)}`
      : '',
    portalCustomerHref: portalBase && (customer.id || job.customerId)
      ? `${portalBase}/customers/c/${encodeURIComponent(customer.id || job.customerId)}`
      : '',
    backHref: '/network?tab=field-work&fw=open',
  };
}

/**
 * Load one teammate customer (+ their jobs) for the owner/manager workspace view.
 * @returns {Promise<object|null>}
 */
async function getFieldWorkCustomer(networkId, member, customerId, opts = {}) {
  if (!member || !member.id || !customerId) return null;
  const customer = await work.getCustomer(networkId, member.id, customerId);
  if (!customer) return null;
  const today = opts.today || work.todayIn();
  const portalBase = opts.portalBase || '';
  const jobs = (await work.listJobs(networkId, member.id))
    .filter((j) => j.customerId === customer.id)
    .map((job) => {
      const open = work.isOpen(job);
      return {
        jobId: job.id,
        title: String(job.title || 'Job').trim() || 'Job',
        status: job.status,
        statusLabel: work.JOB_STATUS_LABELS[job.status] || job.status,
        whenLabel: whenLabel(job, today),
        overdue: !!(job.date && today && job.date < today && open && job.status !== 'on_hold'),
        ownerJobHref: ownerJobHref(member.id, job.id),
        photoCount: Array.isArray(job.photos) ? job.photos.length : 0,
      };
    })
    .sort((a, b) => String(b.jobId).localeCompare(String(a.jobId)));
  return {
    memberId: member.id,
    memberName: memberDisplayName(member),
    memberContact: String(member.contactName || '').trim(),
    customerId: customer.id,
    customerName: String(customer.name || 'Customer').trim() || 'Customer',
    customerPhone: String(customer.phone || '').trim(),
    customerEmail: String(customer.email || '').trim(),
    customerAddress: String(customer.address || '').trim(),
    customerNotes: String(customer.notes || '').trim(),
    jobs,
    ownerCustomerHref: ownerCustomerHref(member.id, customer.id),
    portalCustomerHref: portalBase
      ? `${portalBase}/customers/c/${encodeURIComponent(customer.id)}`
      : '',
    backHref: '/network?tab=field-work&fw=open',
  };
}

module.exports = {
  VIEWS,
  listTeamFieldWork,
  summarizeTeamFieldWork,
  getFieldWorkJob,
  getFieldWorkCustomer,
  memberDisplayName,
  whenLabel,
  latestNote,
  photoHref,
  ownerJobHref,
  ownerCustomerHref,
  cleanDay,
  cleanMonth,
  buildActiveNumbers,
  computeTotals,
  valueLabel,
  dedupeFieldRows,
  statusRank,
  scheduleLabel,
  preferFieldRow,
  preferSharedFieldRow,
  mergeTwinOnto,
  collapseSharedAcrossMembers,
  filterSharedJobDupesForTotals,
};
