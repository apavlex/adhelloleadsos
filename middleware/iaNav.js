/**
 * Phase 1 IA: sets res.locals.navPrimary for the top nav
 * (today | find | prospecting | reports).
 */
function iaNav(req, res, next) {
  const p = req.path || '';
  let navPrimary = '';
  if (p === '/today' || p.startsWith('/today/') || p === '/focus' || p.startsWith('/focus/')) {
    navPrimary = 'today';
  } else if (
    p === '/' ||
    p.startsWith('/leads/find') ||
    p.startsWith('/search') ||
    p.startsWith('/history') ||
    p.startsWith('/schedules')
  ) {
    navPrimary = 'find';
  } else if (p.startsWith('/pipeline/stages')) {
    /* POST /pipeline/stages/explain — no primary nav */
  } else if (p.startsWith('/prospecting') || p === '/pipeline' || p.startsWith('/pipeline/')) {
    navPrimary = 'prospecting';
  } else if (p.startsWith('/leads')) {
    navPrimary = 'prospecting';
  } else if (p.startsWith('/sales/personas')) {
    navPrimary = 'sales';
  } else if (p.startsWith('/sales/workflow')) {
    navPrimary = 'pipeline';
  } else if (p === '/sequences' || p.startsWith('/sequences/')) {
    navPrimary = 'sequences';
  } else if (p.startsWith('/sales/')) {
    navPrimary = 'sales';
  } else if (p === '/outreach' || p.startsWith('/outreach/')) {
    navPrimary = 'prospecting';
  } else if (p.startsWith('/coach')) {
    navPrimary = 'today';
  } else if (p.startsWith('/analytics') || p.startsWith('/insights') || p.startsWith('/reports')) {
    navPrimary = 'reports';
  } else if (p === '/tasks' || p.startsWith('/tasks/')) {
    navPrimary = 'tasks';
  } else if (p === '/resources' || p.startsWith('/resources/')) {
    navPrimary = 'resources';
  } else if (p === '/ceo' || p.startsWith('/ceo/')) {
    navPrimary = 'ceo';
  }
  res.locals.requestPath = p;
  res.locals.sidebarSettingsOpen =
    p.startsWith('/workspace') ||
    p === '/scripts' ||
    p.startsWith('/scripts/') ||
    p.startsWith('/activation');
  res.locals.navPrimary = navPrimary;
  next();
}

module.exports = iaNav;
