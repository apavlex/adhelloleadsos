/**
 * Document HTML prefetch is disabled.
 *
 * Hover/idle warm used to GET full pages (or, in 1.0.665, empty 204s). Empty
 * prefetch responses can be reused as the real navigation document — blank
 * page after the nav spinner clears. Full HTML warm jammed the server.
 * Until we have a safe warm path, do not prefetch documents at all.
 *
 * Workspace settings still navigate normally; this file stays loaded so
 * older caches and tests keep a stable URL.
 */
(function () {
  /* intentionally empty — see file comment */
})();
