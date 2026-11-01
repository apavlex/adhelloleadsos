/**
 * Document HTML prefetch is OFF.
 *
 * Intent warm (1.0.670) still competed with real navigations on large
 * workspaces — hover kicked off full page/getAllLeads work and the clicked
 * route sat behind it, so the app looked like it “wouldn’t load.”
 *
 * Do not prefetch documents until we have a cheap warm endpoint that does
 * not render HTML. This file stays loaded for a stable cache URL.
 */
(function () {
  /* intentionally empty */
})();
