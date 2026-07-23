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
  } else if (p === '/activity' || p.startsWith('/activity/')) {
    navPrimary = 'activity';
  } else if (p === '/resources' || p.startsWith('/resources/')) {
    navPrimary = 'resources';
  } else if (p === '/ceo' || p.startsWith('/ceo/')) {
    navPrimary = 'ceo';
  } else if (p === '/direct-mail' || p.startsWith('/direct-mail/')) {
    navPrimary = 'direct-mail';
  } else if (p === '/social-posts' || p.startsWith('/social-posts/')) {
    navPrimary = 'social-posts';
  }
  res.locals.requestPath = p;
  res.locals.sidebarSettingsOpen =
    p.startsWith('/workspace') ||
    p === '/scripts' ||
    p.startsWith('/scripts/') ||
    p.startsWith('/activation');

  let navLeadsTab = '';
  const leadsTab = String(req.query.tab || '').toLowerCase();
  if (
    p.startsWith('/leads/find') ||
    p === '/' ||
    p.startsWith('/search') ||
    p.startsWith('/results')
  ) {
    navLeadsTab = 'find';
  } else if (p.startsWith('/history')) {
    navLeadsTab = 'history';
  } else if (p.startsWith('/schedules')) {
    navLeadsTab = 'queue';
  } else if (p.startsWith('/prospecting') || p === '/pipeline' || p.startsWith('/pipeline/')) {
    if (leadsTab === 'queue') navLeadsTab = 'queue';
    else if (leadsTab === 'folders') navLeadsTab = 'folders';
    else navLeadsTab = 'pipeline';
  } else if (p.startsWith('/leads') || p.startsWith('/outreach')) {
    navLeadsTab = 'pipeline';
  }
  res.locals.navLeadsTab = navLeadsTab;

  res.locals.navPrimary = navPrimary;
  next();
}

module.exports = iaNav;
