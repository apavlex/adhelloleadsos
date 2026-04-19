/**
 * Phase 1 IA: sets res.locals.navPrimary for the top nav
 * (today | find | pipeline | outreach | insights).
 */
function iaNav(req, res, next) {
  const p = req.path || '';
  let navPrimary = '';
  if (p === '/today' || p.startsWith('/today/')) {
    navPrimary = 'today';
  } else if (p === '/' || p.startsWith('/search') || p.startsWith('/history') || p.startsWith('/schedules')) {
    navPrimary = 'find';
  } else if (p.startsWith('/leads')) {
    navPrimary = 'pipeline';
  } else if (p.startsWith('/sales/workflow')) {
    navPrimary = 'pipeline';
  } else if (
    p.startsWith('/sales/') ||
    p === '/sequences' ||
    p.startsWith('/sequences/') ||
    p === '/outreach' ||
    p.startsWith('/outreach/')
  ) {
    navPrimary = 'outreach';
  } else if (p.startsWith('/coach')) {
    navPrimary = 'today';
  } else if (p.startsWith('/analytics') || p.startsWith('/insights')) {
    navPrimary = 'insights';
  } else if (p === '/tasks' || p.startsWith('/tasks/')) {
    navPrimary = 'tasks';
  } else if (p === '/resources' || p.startsWith('/resources/')) {
    navPrimary = 'resources';
  }
  res.locals.navPrimary = navPrimary;
  next();
}

module.exports = iaNav;
